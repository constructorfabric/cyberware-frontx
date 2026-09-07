// @cpt-algo:cpt-frontx-algo-upgrade-changeset-classify:p1
//
// Real-filesystem coverage for `classifyTarget`'s (`../upgrade/classify.ts`)
// ancestor probe: `readDiskEntry` is `lstat`-based on the full leaf path
// only, which correctly reports a symlinked LEAF, but any directory
// component between the project root and the leaf that is itself a symlink
// (or an ordinary regular file, where a directory is required) is simply
// followed — or fails to resolve through — transparently by the OS on every
// read, unless this module's own ancestor probe catches it first. A plan
// naming `workspace/dir/sub/b.txt` where `workspace/dir` was such a
// component would otherwise compare, and let the commit algorithm land,
// content at wherever the bad component actually resolves to, never at the
// path the plan names.
//
// `fakeReadDiskEntry` (`./upgrade-classify.test.ts`) cannot honestly exercise
// this: a fake keyed by absolute path string can trivially "get it right"
// for whichever path a test happens to look up, but it can never reproduce
// what the REAL `lstat`-based seam does when an intermediate path segment is
// a symlink — the OS resolves it transparently on the way to the leaf,
// which is exactly the behavior this suite has to defend against. It uses
// the real `createFsReadDiskEntryFn` (`../adapters/fs-upgrade-io.ts`) against
// a real temporary directory with real symlinks, mirroring
// `fs-containment.test.ts`'s own real-temp-directory convention for the
// identical reason on the apply side.
import path from 'node:path';
import { mkdtemp, mkdir, rm, symlink, rename, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyTarget } from '../upgrade/classify';
import type { ClassifyInput } from '../upgrade/classify';
import { createFsReadDiskEntryFn } from '../adapters/fs-upgrade-io';
import { createFsCanonicalizeTargetFn } from '../adapters/fs-project-io';
import type { ResolvedPayload } from '../upgrade/types';

function payload(files: Record<string, string>): ResolvedPayload {
  return {
    name: 'my-template',
    version: '1.0.0',
    origin: 'path:tpl',
    files: new Map(Object.entries(files)),
    excludedSubtrees: [],
  };
}

const identityCanonicalize = (raw: string): string | null => raw;

let repoRoot: string | undefined;

afterEach(async () => {
  if (repoRoot !== undefined) {
    await rm(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  }
});

function baseInput(overrides: Partial<ClassifyInput>): ClassifyInput {
  return {
    target: 'workspace',
    repoRoot: repoRoot!,
    baseline: payload({}),
    candidate: payload({}),
    projectOwnedRoots: [],
    otherTemplateTargets: [],
    additionalExclusionRoots: [],
    readDiskEntry: createFsReadDiskEntryFn(),
    canonicalizeFn: identityCanonicalize,
    ...overrides,
  };
}

describe('classifyTarget against a real filesystem — symlinked ancestor directory component', () => {
  it('refuses fail-closed, and never lands content through, an ancestor directory replaced by a symlink pointing elsewhere in the project', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-ancestor-'));
    const ws = path.join(repoRoot, 'workspace');
    await mkdir(path.join(ws, 'dir', 'sub'), { recursive: true });
    await writeFile(path.join(ws, 'dir', 'sub', 'b.txt'), 'V1', 'utf-8');

    // The exact reproduction shape: move the real directory aside, then
    // symlink its former location to the stash — the classic "swap a
    // directory for a link to somewhere else" attack this fix closes.
    await mkdir(path.join(repoRoot, 'stash'), { recursive: true });
    await rename(path.join(ws, 'dir'), path.join(repoRoot, 'stash', 'dir'));
    await symlink(path.join('..', 'stash', 'dir'), path.join(ws, 'dir'));

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'dir/sub/b.txt': 'V1' }),
        candidate: payload({ 'dir/sub/b.txt': 'V2' }),
      }),
    );

    expect(result.conflictPaths).toEqual(['workspace/dir/sub/b.txt']);
    expect(result.operations).toEqual([]);

    // Nothing was compared or landed at the resolved location either — the
    // stash keeps its original content, exactly as classification (which
    // never writes anything) leaves everything it touches.
    const stashed = await readFile(path.join(repoRoot, 'stash', 'dir', 'sub', 'b.txt'), 'utf-8');
    expect(stashed).toBe('V1');
  });

  it('refuses fail-closed for ADD and REMOVE through the same symlinked ancestor, not only REPLACE', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-ancestor-'));
    const ws = path.join(repoRoot, 'workspace');
    await mkdir(path.join(ws, 'dir'), { recursive: true });
    await writeFile(path.join(ws, 'dir', 'remove.txt'), 'gone-baseline', 'utf-8');
    // `add.txt` is deliberately never created: the ADD case's baseline AND
    // disk are both absent before the ancestor is compromised.

    await mkdir(path.join(repoRoot, 'stash'), { recursive: true });
    await rename(path.join(ws, 'dir'), path.join(repoRoot, 'stash', 'dir'));
    await symlink(path.join('..', 'stash', 'dir'), path.join(ws, 'dir'));

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'dir/remove.txt': 'gone-baseline' }),
        candidate: payload({ 'dir/add.txt': 'brand-new' }),
      }),
    );

    expect(result.conflictPaths.sort()).toEqual(['workspace/dir/add.txt', 'workspace/dir/remove.txt']);
    expect(result.operations).toEqual([]);
  });

  it('does not flag an ordinary real ancestor directory, and classifies ADD/REPLACE/REMOVE normally through it', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-ancestor-'));
    const ws = path.join(repoRoot, 'workspace');
    await mkdir(path.join(ws, 'dir', 'sub'), { recursive: true });
    await writeFile(path.join(ws, 'dir', 'sub', 'replace.txt'), 'old', 'utf-8');
    await writeFile(path.join(ws, 'dir', 'sub', 'remove.txt'), 'gone-baseline', 'utf-8');

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'dir/sub/replace.txt': 'old', 'dir/sub/remove.txt': 'gone-baseline' }),
        candidate: payload({ 'dir/sub/replace.txt': 'new', 'dir/sub/add.txt': 'brand-new' }),
      }),
    );

    expect(result.conflictPaths).toEqual([]);
    const opsByPath = Object.fromEntries(result.operations.map((op) => [op.path, op.op]));
    expect(opsByPath).toEqual({
      'workspace/dir/sub/replace.txt': 'REPLACE',
      'workspace/dir/sub/remove.txt': 'REMOVE',
      'workspace/dir/sub/add.txt': 'ADD',
    });
  });

  // --- the full matrix: every ancestor shape × every operation class -----
  //
  // Six of eleven claimed ancestor shapes are pinned here — {leaf is a
  // symlink, an ancestor BELOW the target is a symlink, the TARGET ITSELF is
  // a symlink, an ancestor ABOVE the target is a symlink, an ancestor is a
  // DANGLING symlink, an ancestor is an ordinary REGULAR FILE} — crossed
  // with every operation class {ADD, REPLACE, REMOVE}, against a real
  // filesystem. Each
  // case asserts both that classification refuses fail-closed and that the
  // content standing behind the bad ancestor is byte-for-byte unchanged —
  // classification never writes anything, but pinning that behavior here
  // catches a future change to this module that starts doing so from ever
  // reaching a released build unnoticed.
  type OpCase = 'ADD' | 'REPLACE' | 'REMOVE';
  const OP_CASES: OpCase[] = ['ADD', 'REPLACE', 'REMOVE'];

  // Every scenario pre-creates the SAME leaf content ('PROTECTED') regardless
  // of `op`: classification's fail-closed refusal on a bad ancestor does not
  // depend on what the leaf itself would otherwise resolve to, so one fixed
  // disk shape exercises all three operation classes identically.
  function payloadsFor(op: OpCase, leafRel: string): { baseline: ResolvedPayload; candidate: ResolvedPayload } {
    if (op === 'ADD') return { baseline: payload({}), candidate: payload({ [leafRel]: 'candidate-new' }) };
    if (op === 'REMOVE') return { baseline: payload({ [leafRel]: 'PROTECTED' }), candidate: payload({}) };
    return { baseline: payload({ [leafRel]: 'PROTECTED' }), candidate: payload({ [leafRel]: 'candidate-new' }) };
  }

  interface Scenario {
    name: string;
    leafRel: string;
    setup: (repoRoot: string) => Promise<{ target: string }>;
    verifyUnchanged: (repoRoot: string) => Promise<void>;
  }

  const scenarios: Scenario[] = [
    {
      name: 'leaf itself is a symlink aliasing another real file',
      leafRel: 'leaf.txt',
      async setup(root) {
        await mkdir(path.join(root, 'workspace'), { recursive: true });
        await writeFile(path.join(root, 'protected-real.txt'), 'PROTECTED', 'utf-8');
        await symlink(path.join('..', 'protected-real.txt'), path.join(root, 'workspace', 'leaf.txt'));
        return { target: 'workspace' };
      },
      async verifyUnchanged(root) {
        expect(await readFile(path.join(root, 'protected-real.txt'), 'utf-8')).toBe('PROTECTED');
      },
    },
    {
      name: 'an ancestor BELOW the target is a symlink',
      leafRel: 'dir/sub/leaf.txt',
      async setup(root) {
        const ws = path.join(root, 'workspace');
        await mkdir(path.join(ws, 'dir', 'sub'), { recursive: true });
        await writeFile(path.join(ws, 'dir', 'sub', 'leaf.txt'), 'PROTECTED', 'utf-8');
        await mkdir(path.join(root, 'stash'), { recursive: true });
        await rename(path.join(ws, 'dir'), path.join(root, 'stash', 'dir'));
        await symlink(path.join('..', 'stash', 'dir'), path.join(ws, 'dir'));
        return { target: 'workspace' };
      },
      async verifyUnchanged(root) {
        expect(await readFile(path.join(root, 'stash', 'dir', 'sub', 'leaf.txt'), 'utf-8')).toBe('PROTECTED');
      },
    },
    {
      name: 'the TARGET ITSELF is a symlink',
      leafRel: 'dir/sub/leaf.txt',
      async setup(root) {
        const ws = path.join(root, 'workspace');
        await mkdir(path.join(ws, 'dir', 'sub'), { recursive: true });
        await writeFile(path.join(ws, 'dir', 'sub', 'leaf.txt'), 'PROTECTED', 'utf-8');
        await mkdir(path.join(root, 'stash'), { recursive: true });
        await rename(ws, path.join(root, 'stash', 'workspacereal'));
        await symlink(path.join('stash', 'workspacereal'), ws);
        return { target: 'workspace' };
      },
      async verifyUnchanged(root) {
        expect(await readFile(path.join(root, 'stash', 'workspacereal', 'dir', 'sub', 'leaf.txt'), 'utf-8')).toBe('PROTECTED');
      },
    },
    {
      name: 'an ancestor ABOVE the target is a symlink',
      leafRel: 'leaf.txt',
      async setup(root) {
        await mkdir(path.join(root, 'stash', 'real-workspace', 'app'), { recursive: true });
        await writeFile(path.join(root, 'stash', 'real-workspace', 'app', 'leaf.txt'), 'PROTECTED', 'utf-8');
        await symlink(path.join('stash', 'real-workspace'), path.join(root, 'workspace'));
        return { target: 'workspace/app' };
      },
      async verifyUnchanged(root) {
        expect(await readFile(path.join(root, 'stash', 'real-workspace', 'app', 'leaf.txt'), 'utf-8')).toBe('PROTECTED');
      },
    },
    {
      name: 'an ancestor is a DANGLING symlink',
      leafRel: 'dir/sub/leaf.txt',
      async setup(root) {
        await mkdir(path.join(root, 'workspace'), { recursive: true });
        await symlink(path.join('nowhere', 'does-not-exist'), path.join(root, 'workspace', 'dir'));
        return { target: 'workspace' };
      },
      async verifyUnchanged(root) {
        // Nothing exists behind a dangling link — the only thing to protect
        // is that classification never materializes the dangling target.
        expect(existsSync(path.join(root, 'nowhere'))).toBe(false);
      },
    },
    {
      name: 'an ancestor is an ordinary REGULAR FILE, standing where a directory is required',
      leafRel: 'dir/sub/leaf.txt',
      async setup(root) {
        await mkdir(path.join(root, 'workspace'), { recursive: true });
        await writeFile(path.join(root, 'workspace', 'dir'), 'PROTECTED-ANCESTOR-FILE', 'utf-8');
        return { target: 'workspace' };
      },
      async verifyUnchanged(root) {
        expect(await readFile(path.join(root, 'workspace', 'dir'), 'utf-8')).toBe('PROTECTED-ANCESTOR-FILE');
      },
    },
  ];

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      for (const op of OP_CASES) {
        it(`refuses fail-closed for ${op}, and leaves the content behind the bad ancestor byte-for-byte unchanged`, async () => {
          repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-ancestor-matrix-'));
          const { target } = await scenario.setup(repoRoot);
          const { baseline, candidate } = payloadsFor(op, scenario.leafRel);
          const expectedProjectPath = target === '.' ? scenario.leafRel : `${target}/${scenario.leafRel}`;

          const result = await classifyTarget(baseInput({ target, baseline, candidate }));

          expect(result.conflictPaths).toEqual([expectedProjectPath]);
          expect(result.uncomparablePaths).toEqual([expectedProjectPath]);
          expect(result.operations).toEqual([]);
          await scenario.verifyUnchanged(repoRoot);
        });
      }
    });
  }

  // --- the escaping branch, pinned against a REAL canonicalizer ----------
  //
  // Every scenario above uses `identityCanonicalize` (`raw => raw`), which
  // can never report an escape — so `escapingPaths`/`INVALID_PATH` (as
  // opposed to the internal-symlink `CONTENT_CONFLICT` case every scenario
  // above already pins) was never exercised against a real filesystem here,
  // only against a fake `canonicalizeFn` in `upgrade-classify.test.ts`. Wired
  // to the real `createFsCanonicalizeTargetFn` (`../adapters/fs-project-io.ts`
  // — the same containment resolution `apply`'s own pre-flight uses), for
  // both shapes that can escape: an ancestor symlink, and the leaf itself.

  it('reports an ancestor symlink whose REAL target escapes the project root as escaping, against the real canonicalizer', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-ancestor-escape-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-outside-'));
    await writeFile(path.join(outside, 'lib.ts'), 'OUTSIDE-CONTENT', 'utf-8');
    const ws = path.join(repoRoot, 'workspace');
    await mkdir(ws, { recursive: true });
    await symlink(outside, path.join(ws, 'vendor'));

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'vendor/lib.ts': 'old' }),
        candidate: payload({ 'vendor/lib.ts': 'new' }),
        canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
      }),
    );

    expect(result.conflictPaths).toEqual(['workspace/vendor/lib.ts']);
    expect(result.uncomparablePaths).toEqual(['workspace/vendor/lib.ts']);
    expect(result.escapingPaths).toEqual(['workspace/vendor/lib.ts']);
    expect(result.operations).toEqual([]);
    expect(await readFile(path.join(outside, 'lib.ts'), 'utf-8')).toBe('OUTSIDE-CONTENT');

    await rm(outside, { recursive: true, force: true });
  });

  it('reports the LEAF itself as escaping when it is a symlink whose REAL target leaves the project root, against the real canonicalizer', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-leaf-escape-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-outside-'));
    await writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE-CONTENT', 'utf-8');
    const ws = path.join(repoRoot, 'workspace');
    await mkdir(ws, { recursive: true });
    await symlink(path.join(outside, 'secret.txt'), path.join(ws, 'leaf.txt'));

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'leaf.txt': 'old' }),
        candidate: payload({ 'leaf.txt': 'new' }),
        canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
      }),
    );

    expect(result.conflictPaths).toEqual(['workspace/leaf.txt']);
    expect(result.uncomparablePaths).toEqual(['workspace/leaf.txt']);
    expect(result.escapingPaths).toEqual(['workspace/leaf.txt']);
    expect(result.operations).toEqual([]);
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf-8')).toBe('OUTSIDE-CONTENT');

    await rm(outside, { recursive: true, force: true });
  });

  it('does NOT report an ancestor symlink whose REAL target stays inside the project root as escaping, against the real canonicalizer', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-ancestor-internal-'));
    const ws = path.join(repoRoot, 'workspace');
    await mkdir(path.join(ws, 'real-vendor'), { recursive: true });
    await writeFile(path.join(ws, 'real-vendor', 'lib.ts'), 'old', 'utf-8');
    await symlink(path.join(ws, 'real-vendor'), path.join(ws, 'vendor'));

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'vendor/lib.ts': 'old' }),
        candidate: payload({ 'vendor/lib.ts': 'new' }),
        canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
      }),
    );

    expect(result.uncomparablePaths).toEqual(['workspace/vendor/lib.ts']);
    expect(result.escapingPaths).toEqual([]);
  });

  // --- control: an upgrade whose payload never passes through the bad
  // ancestor at all must classify normally, refusing nothing --------------

  it('leaves an unrelated real symlinked directory elsewhere in the target — never an ancestor of any enumerated payload path — entirely untouched', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-ancestor-'));
    const ws = path.join(repoRoot, 'workspace');
    await mkdir(path.join(ws, 'src'), { recursive: true });
    await writeFile(path.join(ws, 'src', 'a.ts'), 'v1', 'utf-8');

    // An ordinary internal symlink — e.g. a workspace-linked node_modules
    // dependency — that no payload path ever passes through. Regression for
    // "run the fix backwards": the ancestor probe must never even reach it.
    await mkdir(path.join(ws, 'real_vendor'), { recursive: true });
    await writeFile(path.join(ws, 'real_vendor', 'marker.txt'), 'UNTOUCHED', 'utf-8');
    await symlink('real_vendor', path.join(ws, 'vendor'));

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/a.ts': 'v1' }),
        candidate: payload({ 'src/a.ts': 'v1' }),
      }),
    );

    expect(result.conflictPaths).toEqual([]);
    expect(result.operations).toEqual([expect.objectContaining({ path: 'workspace/src/a.ts', op: 'UNCHANGED' })]);
    const marker = await readFile(path.join(ws, 'real_vendor', 'marker.txt'), 'utf-8');
    expect(marker).toBe('UNTOUCHED');
  });
});
