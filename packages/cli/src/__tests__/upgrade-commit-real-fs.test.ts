// @cpt-algo:cpt-frontx-algo-upgrade-changeset-commit:p1
//
// Real-filesystem coverage for `commitUpgrade` (`../upgrade/commit.ts`) wired
// to the REAL `fs-upgrade-io.ts` adapters, against a real temporary project
// directory. `upgrade-commit.test.ts`'s own in-memory harness cannot exercise
// this defect at all: its fake `writeDiskFile` is `disk.set(absolutePath,
// content)` — a plain map write that has no notion of a symlink, so it can
// never reproduce what `fs.writeFileSync` actually does when the path it is
// given is a live symlink (follows it, silently landing content wherever the
// link points), nor what `fs.renameSync` does when the SOURCE of a rename is
// itself a symlink (moves the link entry itself, not a regular file, into the
// destination). Both are exactly the OS-level behaviors `inst-com-verify-
// temp-occupancy` exists to keep this algorithm from ever reaching.
//
// This suite reproduces the review's own manipulation verbatim: something
// other than this engine — a directory, a symlink (dangling, pointing inside
// the project, or pointing outside it), or a special file (a FIFO) — is
// planted at a destination's OWN reserved temporary path before `upgrade` is
// ever invoked, mirroring a prior crashed attempt's litter of the wrong shape
// or a developer's own coincidentally-named file. None of these may ever be
// written through, renamed over, or silently discarded; a regular file at
// that same path (genuine litter this algorithm's own convention could have
// produced) is the control case proving the fix does not regress the
// existing reclaim-and-succeed path.
//
// A UNIX domain socket is not exercised here as its own shape: the real
// `readDiskEntry` (`createFsReadDiskEntryFn`, `../adapters/fs-upgrade-io.ts`)
// reports a FIFO, a socket, and a device node identically as `kind:
// 'special'` — one `!stat.isFile()` branch with no sub-kind distinction —
// and `verifyTempOccupancy` (`../upgrade/commit.ts`) branches on that same
// `'special'` kind generically, never on a FIFO specifically. The FIFO case
// below exercises that exact branch; a socket would take the identical path
// through identical code, so it carries no separate test.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { commitUpgrade } from '../upgrade/commit';
import type { CommitDeps, CommitOutcome } from '../upgrade/commit';
import type { UpgradeOperation, UpgradePlan } from '../upgrade/types';
import type { ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';
import { RESERVED_TEMP_SUFFIX } from '../paths/reserved-temp-name';
import {
  createFsReadDiskEntryFn,
  createFsWriteDiskFileFn,
  createFsRenameDiskFileFn,
  createFsUnlinkDiskFileFn,
  createFsListDiskFilesFn,
} from '../adapters/fs-upgrade-io';

let repoRoot: string | undefined;
let outsideRoot: string | undefined;

afterEach(async () => {
  if (repoRoot !== undefined) {
    await rm(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  }
  if (outsideRoot !== undefined) {
    await rm(outsideRoot, { recursive: true, force: true });
    outsideRoot = undefined;
  }
});

function makeFifo(fifoPath: string): void {
  execFileSync('mkfifo', [fifoPath]);
}

/** Real `CommitDeps`, every disk seam backed by the genuine `fs-upgrade-io.ts`
 * adapters against `root`; only the project-state store and the two
 * post-commit steps stay lightweight in-memory fakes, since neither is the
 * seam this suite exists to pin. */
function makeRealDeps(root: string): CommitDeps {
  let projectStateContent: string | null = null;
  const readProjectStateFn: ReadProjectStateFn = async () => projectStateContent;
  const writeProjectStateFn: WriteProjectStateFn = async (_absolutePath, content) => {
    projectStateContent = content;
  };
  return {
    repoRoot: root,
    readDiskEntry: createFsReadDiskEntryFn(),
    writeDiskFile: createFsWriteDiskFileFn(root),
    renameDiskFile: createFsRenameDiskFileFn(root),
    unlinkDiskFile: createFsUnlinkDiskFileFn(root),
    listDiskFiles: createFsListDiskFilesFn(),
    readProjectStateFn,
    writeProjectStateFn,
    promoteInventory: async () => {},
    refreshAiBundle: async () => {},
  };
}

function op(overrides: Partial<UpgradeOperation> & Pick<UpgradeOperation, 'target' | 'path' | 'op'>): UpgradeOperation {
  return { expectedDisk: null, baselineContent: null, ...overrides };
}

function makePlan(operations: UpgradeOperation[]): UpgradePlan {
  return {
    name: 'acme-tool',
    from: { origin: 'path:v1', version: '1.0.0' },
    to: { origin: 'path:v2', version: '2.0.0' },
    targets: ['app'],
    exclusionRootsByTarget: { app: [] },
    operations,
    skipped: [],
  };
}

type Shape = 'directory' | 'fifo' | 'dangling-symlink' | 'symlink-inside' | 'symlink-outside';

/** Plants `shape` at `tempPath` (a destination's own reserved temporary
 * path), returning what to assert stayed untouched afterward: for a live
 * symlink, the real file it points at and that file's own original content. */
async function plantAtTempPath(
  shape: Shape,
  tempAbsolutePath: string,
  root: string,
): Promise<{ linkTarget?: string; linkTargetContent?: string }> {
  switch (shape) {
    case 'directory':
      await mkdir(tempAbsolutePath, { recursive: true });
      return {};
    case 'fifo':
      makeFifo(tempAbsolutePath);
      return {};
    case 'dangling-symlink':
      await symlink(path.join(root, 'nowhere', 'ghost.txt'), tempAbsolutePath);
      return {};
    case 'symlink-inside': {
      const victim = path.join(root, 'victim-inside.txt');
      await writeFile(victim, 'PRECIOUS-INSIDE', 'utf-8');
      await symlink(victim, tempAbsolutePath);
      return { linkTarget: victim, linkTargetContent: 'PRECIOUS-INSIDE' };
    }
    case 'symlink-outside': {
      outsideRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-outside-'));
      const victim = path.join(outsideRoot, 'victim-outside.txt');
      await writeFile(victim, 'PRECIOUS-OUTSIDE', 'utf-8');
      await symlink(victim, tempAbsolutePath);
      return { linkTarget: victim, linkTargetContent: 'PRECIOUS-OUTSIDE' };
    }
  }
}

const SHAPES: Shape[] = ['directory', 'fifo', 'dangling-symlink', 'symlink-inside', 'symlink-outside'];

describe('commitUpgrade against a real filesystem — a foreign entry already occupying a reserved temp path', () => {
  for (const shape of SHAPES) {
    it(`refuses CONTENT_CONFLICT for an ADD, without hanging, writing through, or landing a ${shape} as the destination`, async () => {
      repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-occupied-'));
      await mkdir(path.join(repoRoot, 'app'), { recursive: true });
      const dest = path.join(repoRoot, 'app', 'new.txt');
      const temp = dest + RESERVED_TEMP_SUFFIX;
      const planted = await plantAtTempPath(shape, temp, repoRoot);

      const deps = makeRealDeps(repoRoot);
      const plan = makePlan([
        op({ target: 'app', path: 'app/new.txt', op: 'ADD', expectedDisk: null, baselineContent: null, newContent: 'v2' }),
      ]);

      const result: CommitOutcome = await commitUpgrade(plan, deps);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('CONTENT_CONFLICT');
      expect(result.details).toMatchObject({ drifted: [{ target: 'app', path: 'app/new.txt' }] });

      // The destination this ADD would have created never came into being —
      // an ADD's own "nothing was there before" state survives the refusal.
      await expect(lstat(dest)).rejects.toThrow();

      // The offending entry itself is untouched — never reclaimed, never
      // renamed away, never written through.
      const tempStat = await lstat(temp);
      if (shape === 'directory') expect(tempStat.isDirectory()).toBe(true);
      else if (shape === 'fifo') expect(tempStat.isFIFO()).toBe(true);
      else expect(tempStat.isSymbolicLink()).toBe(true);

      if (planted.linkTarget !== undefined) {
        const content = await readFile(planted.linkTarget, 'utf-8');
        expect(content).toBe(planted.linkTargetContent);
      }
    });

    it(`refuses CONTENT_CONFLICT for a REPLACE, leaving the destination's own baseline content and a ${shape} temp entry both exactly as they were`, async () => {
      repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-occupied-'));
      await mkdir(path.join(repoRoot, 'app'), { recursive: true });
      const dest = path.join(repoRoot, 'app', 'existing.txt');
      await writeFile(dest, 'BASELINE', 'utf-8');
      const temp = dest + RESERVED_TEMP_SUFFIX;
      await plantAtTempPath(shape, temp, repoRoot);

      const deps = makeRealDeps(repoRoot);
      const plan = makePlan([
        op({
          target: 'app',
          path: 'app/existing.txt',
          op: 'REPLACE',
          expectedDisk: 'BASELINE',
          baselineContent: 'BASELINE',
          newContent: 'v2',
        }),
      ]);

      const result = await commitUpgrade(plan, deps);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('CONTENT_CONFLICT');

      // The destination is a REGULAR FILE, unchanged — never turned into a
      // symlink, never left as a directory, by a rename this refusal
      // prevented from ever being reached.
      const destStat = await lstat(dest);
      expect(destStat.isFile()).toBe(true);
      expect(await readFile(dest, 'utf-8')).toBe('BASELINE');
    });
  }

  it('a REMOVE is unaffected by a foreign entry at its own (irrelevant) temp-suffixed path — REMOVE never opens one', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-occupied-'));
    await mkdir(path.join(repoRoot, 'app'), { recursive: true });
    const dest = path.join(repoRoot, 'app', 'to-remove.txt');
    await writeFile(dest, 'BASELINE', 'utf-8');
    const temp = dest + RESERVED_TEMP_SUFFIX;
    const victim = path.join(repoRoot, 'victim.txt');
    await writeFile(victim, 'UNTOUCHED', 'utf-8');
    await symlink(victim, temp);

    const deps = makeRealDeps(repoRoot);
    const plan = makePlan([
      op({ target: 'app', path: 'app/to-remove.txt', op: 'REMOVE', expectedDisk: 'BASELINE', baselineContent: 'BASELINE' }),
    ]);

    const result = await commitUpgrade(plan, deps);

    expect(result.ok).toBe(true);
    await expect(lstat(dest)).rejects.toThrow();
    // The symlink at the unrelated temp-suffixed path was never touched:
    // still a symlink, and its target's content is unchanged.
    expect((await lstat(temp)).isSymbolicLink()).toBe(true);
    expect(await readFile(victim, 'utf-8')).toBe('UNTOUCHED');
  });

  it("control: a genuinely stale REGULAR FILE at the temp path is still reclaimed and the upgrade still succeeds", async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-occupied-'));
    await mkdir(path.join(repoRoot, 'app'), { recursive: true });
    const dest = path.join(repoRoot, 'app', 'new.txt');
    const temp = dest + RESERVED_TEMP_SUFFIX;
    await writeFile(temp, 'stale litter from a crashed attempt', 'utf-8');

    const deps = makeRealDeps(repoRoot);
    const plan = makePlan([
      op({ target: 'app', path: 'app/new.txt', op: 'ADD', expectedDisk: null, baselineContent: null, newContent: 'v2' }),
    ]);

    const result = await commitUpgrade(plan, deps);

    expect(result.ok).toBe(true);
    const destStat = await lstat(dest);
    expect(destStat.isFile()).toBe(true);
    expect(await readFile(dest, 'utf-8')).toBe('v2');
    await expect(lstat(temp)).rejects.toThrow();
  });
});
