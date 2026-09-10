// Real-fs coverage for containment across the whole payload, not only the
// target: a symlink somewhere under an already-canonicalized project root,
// or an already-computed deletion/upgrade plan, that resolves OUTSIDE the
// project entirely must be refused.
//
// The concrete scenario this guards against: registering a local template,
// then `mkdir -p app && ln -s /somewhere/OUTSIDE app/src`, then `apply`ing
// the template to target `app`, would otherwise write the template's
// payload straight into `/somewhere/OUTSIDE` — the target itself (`app`) is
// canonicalized and proven to stay inside the project root, but the
// individual PAYLOAD PATH under it (`app/src/index.ts`) is not, and
// `fs.writeFileSync`/`fs.mkdirSync`/`fs.cpSync`/`fs.rmSync` all follow a
// symlink on the way to the final path component regardless of what the
// caller believes the destination to be.
//
// `assertPathWithinProjectRoot` (`../adapters/fs-project-io.ts`) is the ONE
// shared "is this absolute path inside the root, symlinks resolved" check
// every real adapter that writes into, or removes from, a project now uses.
// This suite proves it directly against a real filesystem — a fake
// `CanonicalizeTargetFn`/`WriteFileFn` seam cannot honestly exercise an
// ACTUAL escaping symlink — modeled on `fs-canonicalize-target.test.ts`'s
// own real-temp-directory convention.
import path from 'node:path';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPathWithinProjectRoot,
  createFsAssertPathWithinRootFn,
  createFsWriteFileFn,
  createFsWriteProjectStateFn,
  createFsReadProjectStateFn,
  createFsRemoveProjectFileFn,
  createFsPathExistsFn,
  ExistingSymlinkDestinationError,
} from '../adapters/fs-project-io';
import {
  createFsWriteDiskFileFn,
  createFsRenameDiskFileFn,
  createFsUnlinkDiskFileFn,
} from '../adapters/fs-upgrade-io';
import { createFsCopyBundleFn, createFsRemoveBundleFn } from '../adapters/fs-ai-bundle';
import { createFsReadExistingContentFn } from '../adapters/fs-existing-content';
import { runApplyPipeline, rollbackWrittenPaths } from '../commands/apply';
import type { ApplyPipelineDeps, RemoveEmptyDirFn } from '../commands/apply';
import type { UniformApplyInventoryPort } from '../scaffold/assembler';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { BundleExistsFn, CopyBundleFn, RemoveBundleFn } from '../scaffold/ai-bundle';
import type { ReadExistingContentFn, ReadInstalledContentFn } from '../scaffold/existing-content';
import type { ContentItem, WriteFileFn } from '../scaffold/types';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';
import type { ReadFileFn } from '../manifest/types';
import type { InventoryEntry } from '../inventory/types';
import { InventoryState } from '../inventory/types';

// ATOMICITY FIX (`ApplyPipelineDeps` now carries `removeProjectFileFn`/
// `removeEmptyDirFn` too, `../commands/apply.ts`) — a real, filesystem-backed
// `RemoveEmptyDirFn` for this suite's real-temp-directory harness, mirroring
// `cli.ts`'s own production `createFsRemoveEmptyDirFn` exactly (no-op unless
// the directory exists and is now completely empty; never forced, never
// recursive). This suite already proves every OTHER real adapter directly
// against the filesystem — a fake standing in for this one would leave
// `runApplyPipeline`'s own rollback (`rollbackWrittenPaths`) untested against
// real directories the way its sibling suites already test real symlinks.
function createFsRemoveEmptyDirFn(): RemoveEmptyDirFn {
  return async function removeEmptyDir(absolutePath: string): Promise<void> {
    let entries: string[];
    try {
      entries = readdirSync(absolutePath);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      rmdirSync(absolutePath);
    } catch {
      // Already gone, or not a plain directory — nothing further to do.
    }
  };
}

describe('assertPathWithinProjectRoot', () => {
  let root: string;
  let outsideDir: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    root = '';
    outsideDir = '';
  });

  async function makeRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-containment-root-'));
    root = dir;
    return dir;
  }

  it('does not throw for an ordinary path inside the root that does not exist yet', async () => {
    const dir = await makeRoot();

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'src', 'index.ts'))).not.toThrow();
  });

  it('does not throw for an ordinary, already-existing path inside the root', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await writeFile(path.join(dir, 'app', 'file.txt'), 'content', 'utf-8');

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'file.txt'))).not.toThrow();
  });

  // A project may legitimately contain its own symlinks — only an escape
  // past the root is refused, never an internal one.
  it('does not throw when a symlink on the path resolves to somewhere still inside the root', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app', 'real-src'), { recursive: true });
    await symlink(path.join(dir, 'app', 'real-src'), path.join(dir, 'app', 'src'));

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'src', 'index.ts'))).not.toThrow();
  });

  // The escape this whole check exists to catch, exactly as reproduced
  // against the built binary: `app/src` replaced with a symlink to
  // somewhere outside the project, the destination path itself not created
  // yet.
  it('throws when a symlinked ancestor directory resolves outside the root, for a path that does not exist yet', async () => {
    const dir = await makeRoot();
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-containment-outside-'));
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(outsideDir, path.join(dir, 'app', 'src'));

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'src', 'index.ts'))).toThrow(
      /outside the project root/,
    );
  });

  // The removal-side mirror: the full path already exists (via the escaping
  // symlink), so real path resolution succeeds outright rather than via the
  // nearest-existing-ancestor walk.
  it('throws when the full path already exists only by resolving through an escaping symlink', async () => {
    const dir = await makeRoot();
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-containment-outside-'));
    await writeFile(path.join(outsideDir, 'index.ts'), 'leaked', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(outsideDir, path.join(dir, 'app', 'src'));

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'src', 'index.ts'))).toThrow(
      /outside the project root/,
    );
  });

  it('throws, naming the root, when the project root itself cannot be resolved', () => {
    expect(() =>
      assertPathWithinProjectRoot('/definitely/does/not/exist/frontx-fixture-root', '/definitely/does/not/exist/frontx-fixture-root/x'),
    ).toThrow('/definitely/does/not/exist/frontx-fixture-root');
  });

  // A DANGLING symlink — one that exists but whose own target does not —
  // must not be treated as an ordinary not-yet-existing path component:
  // `fs.realpathSync` fails identically for "never existed" and "exists but
  // its target doesn't", so a walk that distinguishes the two cases only by
  // that failure cannot tell them apart. The OS still follows a dangling
  // link on write, so this must refuse exactly like an escaping REAL
  // symlink does.
  it('throws when the final path component is a dangling symlink pointing outside the root', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink('/definitely/does/not/exist/frontx-dangling-outside-target.txt', path.join(dir, 'app', 'README.md'));

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'README.md'))).toThrow(
      /outside the project root/,
    );
  });

  // The legitimate mirror of the above: a project may contain its own
  // dangling symlink (e.g. a not-yet-materialized generated file) as long as
  // its target still lands inside the root — only an escape past the root is
  // refused.
  it('does not throw when the final path component is a dangling symlink pointing inside the root', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'app', 'generated.txt'), path.join(dir, 'app', 'README.md'));

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'README.md'))).not.toThrow();
  });

  // The same shape, one level up: a dangling symlink in an INTERMEDIATE
  // position (not the final component being written) has to be caught too —
  // the old walk-up-to-nearest-existing-ancestor algorithm could climb
  // straight past it as just another unresolved segment.
  it('throws when an INTERMEDIATE path component is a dangling symlink pointing outside the root', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink('/definitely/does/not/exist/frontx-dangling-outside-dir', path.join(dir, 'app', 'src'));

    expect(() => assertPathWithinProjectRoot(dir, path.join(dir, 'app', 'src', 'index.ts'))).toThrow(
      /outside the project root/,
    );
  });
});

// SYMLINK-DESTINATION FIX: `createFsWriteFileFn` must not hand `destPath`
// straight to `fs.writeFileSync`, which follows a symlink at its FINAL path
// component exactly as it follows one at an intermediate component. When
// `destPath` is itself an existing symlink aliasing a DIFFERENT on-disk
// file — an INTERNAL alias that `assertPathWithinProjectRoot`'s own escape
// check passes cleanly since nothing about it ever leaves the project root
// — an unguarded write would silently overwrite whatever the link pointed
// at, exactly what `--adopt-existing` promises never to do. This suite
// proves the fix directly against a real filesystem, and that an ordinary
// ANCESTOR symlink (not the final component) is completely unaffected.
describe('createFsWriteFileFn (destination-symlink refusal)', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-write-symlink-dest-'));
    repoRoot = dir;
    return dir;
  }

  it('refuses to write when the destination already exists as a symlink aliasing another file inside the project', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'shared'), { recursive: true });
    await writeFile(path.join(dir, 'shared', 'precious.txt'), 'PRECIOUS-CONTENT', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'shared', 'precious.txt'), path.join(dir, 'app', 'config.json'));
    const writeFileFn = createFsWriteFileFn();

    await expect(writeFileFn(path.join(dir, 'app', 'config.json'), 'TEMPLATE-CONTENT')).rejects.toThrow(
      ExistingSymlinkDestinationError,
    );

    // The heart of the fix: the aliased file's content is untouched.
    expect(await readFile(path.join(dir, 'shared', 'precious.txt'), 'utf-8')).toBe('PRECIOUS-CONTENT');
  });

  it('refuses to write when the destination already exists as a symlink pointing outside the project', async () => {
    const dir = await makeRepo();
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-write-symlink-outside-'));
    try {
      await writeFile(path.join(outsideDir, 'precious.txt'), 'OUTSIDE-CONTENT', 'utf-8');
      await mkdir(path.join(dir, 'app'), { recursive: true });
      await symlink(path.join(outsideDir, 'precious.txt'), path.join(dir, 'app', 'config.json'));
      const writeFileFn = createFsWriteFileFn();

      await expect(writeFileFn(path.join(dir, 'app', 'config.json'), 'TEMPLATE-CONTENT')).rejects.toThrow(
        ExistingSymlinkDestinationError,
      );
      expect(await readFile(path.join(outsideDir, 'precious.txt'), 'utf-8')).toBe('OUTSIDE-CONTENT');
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  // The legitimate mirror: only the FINAL component is inspected, so a
  // project legitimately structured through a symlinked ANCESTOR directory
  // keeps writing into its real target exactly as it always has.
  it('still writes normally through an ancestor symlink (not the final component)', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app', 'real-src'), { recursive: true });
    await symlink(path.join(dir, 'app', 'real-src'), path.join(dir, 'app', 'src'));
    const writeFileFn = createFsWriteFileFn();

    await writeFileFn(path.join(dir, 'app', 'src', 'index.ts'), 'payload');

    expect(await readFile(path.join(dir, 'app', 'real-src', 'index.ts'), 'utf-8')).toBe('payload');
  });

  it('still writes normally for a brand-new destination, no symlink involved', async () => {
    const dir = await makeRepo();
    const writeFileFn = createFsWriteFileFn();

    await writeFileFn(path.join(dir, 'app', 'index.ts'), 'payload');

    expect(await readFile(path.join(dir, 'app', 'index.ts'), 'utf-8')).toBe('payload');
  });

  it('still overwrites normally when the destination is an ordinary (non-symlink) existing file', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await writeFile(path.join(dir, 'app', 'index.ts'), 'old', 'utf-8');
    const writeFileFn = createFsWriteFileFn();

    await writeFileFn(path.join(dir, 'app', 'index.ts'), 'new');

    expect(await readFile(path.join(dir, 'app', 'index.ts'), 'utf-8')).toBe('new');
  });
});

describe('createFsWriteProjectStateFn containment (escape 2 — the project-state writer)', () => {
  let root: string;
  let outsideDir: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    root = '';
    outsideDir = '';
  });

  async function makeRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-pstate-containment-root-'));
    root = dir;
    return dir;
  }

  // `createFsWriteProjectStateFn` must perform a containment check: without
  // one, a `.frontx` symlink escaping the project root would let
  // `register`/`unregister`/`ownership add|remove` write `project.json`
  // anywhere on disk.
  it('refuses to write project.json when .frontx is a symlink leaving the root, writing nothing outside', async () => {
    const dir = await makeRoot();
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-pstate-outside-'));
    await symlink(outsideDir, path.join(dir, '.frontx'));
    const writeProjectState = createFsWriteProjectStateFn();

    await expect(writeProjectState(path.join(dir, '.frontx', 'project.json'), '{}')).rejects.toThrow(
      /outside the project root/,
    );
    expect(existsSync(path.join(outsideDir, 'project.json'))).toBe(false);
  });

  it('writes project.json normally when .frontx is an ordinary directory inside the root', async () => {
    const dir = await makeRoot();
    const writeProjectState = createFsWriteProjectStateFn();

    await writeProjectState(path.join(dir, '.frontx', 'project.json'), '{"ok":true}');

    expect(await readFile(path.join(dir, '.frontx', 'project.json'), 'utf-8')).toBe('{"ok":true}');
  });

  // DANGLING-SYMLINK-INSIDE FIX: a `.frontx` DANGLING symlink whose target
  // resolves INSIDE the project — legitimately ALLOWED by
  // `assertPathWithinProjectRoot` (the test above, in the outer `describe`,
  // pins that) — can have a resolved target whose own parent directory does
  // not exist yet. A literal `fs.mkdirSync(path.dirname(absolutePath))`
  // creates nothing the symlink's resolved target needs, since the literal
  // parent (containing the link itself) already exists, so without
  // resolving the link first the write would fail with an uncaught `ENOENT`
  // past every caller's error handling.
  it('writes project.json through a dangling .frontx symlink pointing inside the root, creating its resolved parent chain', async () => {
    const dir = await makeRoot();
    await symlink(path.join('internal', 'nested', 'frontx-real'), path.join(dir, '.frontx'));
    const writeProjectState = createFsWriteProjectStateFn();

    await writeProjectState(path.join(dir, '.frontx', 'project.json'), '{"ok":true}');

    expect(await readFile(path.join(dir, 'internal', 'nested', 'frontx-real', 'project.json'), 'utf-8')).toBe(
      '{"ok":true}',
    );
    // Readable back through the symlink itself too, now that its target
    // exists.
    expect(await readFile(path.join(dir, '.frontx', 'project.json'), 'utf-8')).toBe('{"ok":true}');
  });
});

describe('fs-upgrade-io containment (createFsWriteDiskFileFn / createFsRenameDiskFileFn / createFsUnlinkDiskFileFn)', () => {
  let root: string;
  let outsideDir: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    root = '';
    outsideDir = '';
  });

  async function makeRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-containment-'));
    root = dir;
    return dir;
  }

  it('createFsWriteDiskFileFn refuses a write whose ancestor is a symlink escaping the root, writing nothing outside', async () => {
    const dir = await makeRoot();
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-outside-'));
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(outsideDir, path.join(dir, 'app', 'src'));
    const writeDiskFile = createFsWriteDiskFileFn(dir);

    await expect(writeDiskFile(path.join(dir, 'app', 'src', 'index.ts'), 'payload')).rejects.toThrow(
      /outside the project root/,
    );
    expect(existsSync(path.join(outsideDir, 'index.ts'))).toBe(false);
  });

  it('createFsRenameDiskFileFn refuses a rename whose destination escapes the root via a symlinked ancestor', async () => {
    const dir = await makeRoot();
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-outside-'));
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(outsideDir, path.join(dir, 'app', 'src'));
    const from = path.join(dir, 'staged.tmp');
    await writeFile(from, 'payload', 'utf-8');
    const renameDiskFile = createFsRenameDiskFileFn(dir);

    await expect(renameDiskFile(from, path.join(dir, 'app', 'src', 'index.ts'))).rejects.toThrow(
      /outside the project root/,
    );
    expect(existsSync(path.join(outsideDir, 'index.ts'))).toBe(false);
  });

  it('createFsUnlinkDiskFileFn refuses a removal whose path escapes the root via a symlinked ancestor', async () => {
    const dir = await makeRoot();
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-outside-'));
    await writeFile(path.join(outsideDir, 'keep.txt'), 'do not delete me', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(outsideDir, path.join(dir, 'app', 'src'));
    const unlinkDiskFile = createFsUnlinkDiskFileFn(dir);

    await expect(unlinkDiskFile(path.join(dir, 'app', 'src', 'keep.txt'))).rejects.toThrow(/outside the project root/);
    expect(existsSync(path.join(outsideDir, 'keep.txt'))).toBe(true);
  });

  it('createFsWriteDiskFileFn allows a symlink that stays inside the root, and writes the real target', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app', 'real-src'), { recursive: true });
    await symlink(path.join(dir, 'app', 'real-src'), path.join(dir, 'app', 'src'));
    const writeDiskFile = createFsWriteDiskFileFn(dir);

    await writeDiskFile(path.join(dir, 'app', 'src', 'index.ts'), 'payload');

    expect(await readFile(path.join(dir, 'app', 'real-src', 'index.ts'), 'utf-8')).toBe('payload');
  });

  it('createFsWriteDiskFileFn is unaffected for an ordinary write inside the root, no symlinks involved', async () => {
    const dir = await makeRoot();
    const writeDiskFile = createFsWriteDiskFileFn(dir);

    await writeDiskFile(path.join(dir, 'app', 'src', 'index.ts'), 'payload');

    expect(await readFile(path.join(dir, 'app', 'src', 'index.ts'), 'utf-8')).toBe('payload');
  });

  // DANGLING-SYMLINK-INSIDE FIX: `app/README.md` a DANGLING symlink whose
  // target resolves INSIDE the root can have its own parent directory
  // ("app/missing") not exist yet. Containment already allows this
  // (`fs-containment.test.ts`'s own `assertPathWithinProjectRoot` suite
  // above pins that); without resolving the link first, the write would
  // fail with an uncaught `ENOENT` regardless, since `fs.writeFileSync`
  // follows the symlink to a directory nothing had created.
  it('createFsWriteDiskFileFn writes through a dangling symlink pointing inside the root, creating its resolved parent chain', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'app', 'missing', 'target.txt'), path.join(dir, 'app', 'README.md'));
    const writeDiskFile = createFsWriteDiskFileFn(dir);

    await writeDiskFile(path.join(dir, 'app', 'README.md'), 'payload');

    expect(await readFile(path.join(dir, 'app', 'missing', 'target.txt'), 'utf-8')).toBe('payload');
  });

  // The same shape for `renameDiskFile`, but as an INTERMEDIATE ancestor:
  // `rename(2)` does not dereference the FINAL component of its destination
  // (it replaces whatever directory entry sits there, symlink or not), but
  // it does resolve every component ABOVE that one exactly like any other
  // path — so a dangling symlink one level up still needs its resolved
  // parent chain created before the rename can land.
  it('createFsRenameDiskFileFn renames through a dangling symlink ancestor pointing inside the root, creating its resolved parent chain', async () => {
    const dir = await makeRoot();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    const from = path.join(dir, 'staged.tmp');
    await writeFile(from, 'payload', 'utf-8');
    await symlink(path.join(dir, 'internal', 'dir'), path.join(dir, 'app', 'link'));
    const renameDiskFile = createFsRenameDiskFileFn(dir);

    await renameDiskFile(from, path.join(dir, 'app', 'link', 'file.txt'));

    expect(await readFile(path.join(dir, 'internal', 'dir', 'file.txt'), 'utf-8')).toBe('payload');
  });
});

describe('fs-ai-bundle containment (createFsCopyBundleFn / createFsRemoveBundleFn)', () => {
  let sourceRoot: string;
  let destRoot: string;
  let outsideDir: string;
  const MANIFEST_NAME = 'acme/fixture-template';

  afterEach(async () => {
    if (sourceRoot) await rm(sourceRoot, { recursive: true, force: true });
    if (destRoot) await rm(destRoot, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    sourceRoot = '';
    destRoot = '';
    outsideDir = '';
  });

  async function writeSourceBundle(root: string): Promise<void> {
    const bundleDir = path.join(root, '.frontx', 'ai', MANIFEST_NAME);
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, 'extension.json'), JSON.stringify({ name: MANIFEST_NAME }));
  }

  it('createFsCopyBundleFn refuses when the destination project root resolves outside via a symlinked ancestor', async () => {
    sourceRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-source-'));
    await writeSourceBundle(sourceRoot);
    destRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-dest-'));
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-outside-'));
    // `.frontx` itself is the escaping symlink here — the whole bundle
    // convention folder lives under it.
    await symlink(outsideDir, path.join(destRoot, '.frontx'));
    const copyBundle: CopyBundleFn = createFsCopyBundleFn();

    await expect(copyBundle(sourceRoot, destRoot, MANIFEST_NAME)).rejects.toThrow(/outside the project root/);
    expect(existsSync(path.join(outsideDir, 'ai', MANIFEST_NAME))).toBe(false);
  });

  it('createFsRemoveBundleFn refuses when the target project root resolves outside via a symlinked ancestor', async () => {
    destRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-dest-'));
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-outside-'));
    await mkdir(path.join(outsideDir, 'ai', MANIFEST_NAME), { recursive: true });
    await writeFile(path.join(outsideDir, 'ai', MANIFEST_NAME, 'keep.txt'), 'do not delete me', 'utf-8');
    await symlink(outsideDir, path.join(destRoot, '.frontx'));
    const removeBundle: RemoveBundleFn = createFsRemoveBundleFn();

    await expect(removeBundle(destRoot, MANIFEST_NAME)).rejects.toThrow(/outside the project root/);
    expect(existsSync(path.join(outsideDir, 'ai', MANIFEST_NAME, 'keep.txt'))).toBe(true);
  });

  it('createFsCopyBundleFn is unaffected for an ordinary destination, no symlinks involved', async () => {
    sourceRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-source-'));
    await writeSourceBundle(sourceRoot);
    destRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-dest-'));
    const copyBundle: CopyBundleFn = createFsCopyBundleFn();

    await copyBundle(sourceRoot, destRoot, MANIFEST_NAME);

    expect(existsSync(path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME, 'extension.json'))).toBe(true);
  });

  // STALE-MERGE FIX: a real directory already standing at the bundle path is
  // REPLACED, not merged into. `delete` can leave exactly such a directory
  // behind — it reports that residue itself, through `aiBundleResidue` — so
  // the next apply for the same name finds the OLD bundle's files at the
  // destination. `fs.cpSync`'s recursive merge only ever adds and
  // overwrites, so a file the previous bundle shipped and the new one
  // dropped would survive, producing a bundle that is neither version with
  // nothing in any report saying so.
  it('createFsCopyBundleFn replaces a pre-existing real bundle directory rather than merging into it', async () => {
    sourceRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-source-'));
    await writeSourceBundle(sourceRoot);
    destRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-dest-'));
    const destBundle = path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME);
    await mkdir(path.join(destBundle, 'skills'), { recursive: true });
    // A file the OLD bundle shipped and the source bundle does not.
    await writeFile(path.join(destBundle, 'skills', 'retired.md'), 'from a previous version', 'utf-8');
    const copyBundle: CopyBundleFn = createFsCopyBundleFn();

    await copyBundle(sourceRoot, destRoot, MANIFEST_NAME);

    expect(existsSync(path.join(destBundle, 'extension.json'))).toBe(true);
    expect(existsSync(path.join(destBundle, 'skills', 'retired.md'))).toBe(false);
  });

  // The live symlink case the reclaim must NOT get wrong: the entry at the
  // bundle path is removed, but whatever it pointed at — ordinary project
  // ground reachable from elsewhere — keeps its content.
  it('createFsCopyBundleFn clears a live symlink at the bundle path without touching what it points at', async () => {
    sourceRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-source-'));
    await writeSourceBundle(sourceRoot);
    destRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-dest-'));
    const pointedAt = path.join(destRoot, 'developer-own-folder');
    await mkdir(pointedAt, { recursive: true });
    await writeFile(path.join(pointedAt, 'precious.txt'), 'PRECIOUS', 'utf-8');
    await mkdir(path.dirname(path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME)), { recursive: true });
    await symlink(pointedAt, path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME));
    const copyBundle: CopyBundleFn = createFsCopyBundleFn();

    await copyBundle(sourceRoot, destRoot, MANIFEST_NAME);

    expect(existsSync(path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME, 'extension.json'))).toBe(true);
    expect(await readFile(path.join(pointedAt, 'precious.txt'), 'utf-8')).toBe('PRECIOUS');
    expect(existsSync(path.join(pointedAt, 'extension.json'))).toBe(false);
  });
});

// The one required end-to-end regression: `apply` itself refuses, through
// the REAL project-file writer (`createFsWriteFileFn`, unchanged — the
// guard for this seam lives in `commands/apply.ts`'s own pre-flight pass,
// since `WriteFileFn` is a `CliDeps`-injected value shared by `apply` and
// `seed` with a DIFFERENT applicable root each, whose exact call arity this
// package's `cli.test.ts` dispatch suite already asserts — see `commands/
// apply.ts`'s own containment-fix comment for the full reasoning). This
// suite's harness cannot be `__tests__/entry-flows.test.ts`'s: that suite's
// `writeFileFn`/`canonicalizeFn` are pure in-memory fakes with no real
// filesystem access at all, so it cannot honestly model an actual escaping
// symlink the way this file's real-temp-directory harness can.
describe('apply end-to-end containment (runApplyPipeline with the real project-file writer)', () => {
  let repoRoot: string;
  let outsideDir: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    repoRoot = '';
    outsideDir = '';
  });

  function manifest(name: string): Record<string, unknown> {
    return { name, version: '1.0.0', excludedSubtrees: [], description: `Fixture template "${name}"` };
  }

  it('refuses INVALID_PATH, writing nothing outside the project, when a payload path resolves through an escaping symlink', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-apply-containment-repo-'));
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-apply-containment-outside-'));
    // The exact reproduction from the PR-review defect: the target directory
    // exists, and the path segment BELOW it has been replaced with a
    // symlink to somewhere outside the project.
    await mkdir(path.join(repoRoot, 'app'), { recursive: true });
    await symlink(outsideDir, path.join(repoRoot, 'app', 'src'));

    const templateName = '@acme/t';
    const installedEntries = new Map<string, InventoryEntry>();
    installedEntries.set(templateName, {
      name: templateName,
      source: `github:acme/t@v1`,
      ref: 'v1',
      status: InventoryState.INSTALLED,
      content: JSON.stringify(manifest(templateName)),
    });
    const templateContent = new Map<string, ContentItem[]>([
      [templateName, [{ path: 'src/index.ts', content: 'hello' }]],
    ]);

    let projectStateContent: string | null = JSON.stringify({
      formatVersion: 1,
      templates: { [templateName]: { origin: `github:acme/t@v1`, version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    } satisfies ProjectStateDocument);

    const inventory: UniformApplyInventoryPort = {
      lookup: (name) => installedEntries.get(name),
      install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
    };
    const readInstalledContentFn: ReadInstalledContentFn = async (installedContentPath) =>
      templateContent.get(installedContentPath) ?? [];
    // Nothing pre-exists at the target from this reconciliation's point of
    // view — this test's own escaping symlink is a REAL on-disk fixture
    // proven by the write-time guard, not by existing-content reconciliation.
    const readExistingContentFn: ReadExistingContentFn = async () => [];
    const canonicalizeFn: CanonicalizeTargetFn = (rawTarget) => rawTarget;
    const readProjectStateFn: ReadProjectStateFn = async () => projectStateContent;
    const writeProjectStateFn: WriteProjectStateFn = async (_absolutePath, content) => {
      projectStateContent = content;
    };
    const readFileFn: ReadFileFn = vi.fn(async () => {
      throw new Error('readFileFn not stubbed for this test');
    });
    const bundleExistsFn: BundleExistsFn = vi.fn(async () => false);
    const copyBundleFn: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundleFn: RemoveBundleFn = vi.fn(async () => undefined);

    const deps: ApplyPipelineDeps = {
      inventory,
      fetchFn: vi.fn(async () => ''),
      readFileFn,
      canonicalizeFn,
      // REAL, not a `vi.fn(async () => true)` stub: the pipeline's pre-write
      // pass asks this seam which ancestor directories were already standing
      // before materialization, and `rollbackWrittenPaths` prunes only the
      // ones that were not. A stub that answers "yes, it exists" to every
      // path makes every directory look like the developer's own and turns
      // the rollback into a silent no-op — the fixture would then assert a
      // pruning that never happened.
      existsFn: createFsPathExistsFn(),
      listFolderFilesFn: vi.fn(async () => []),
      resolveInstalledContentPathFn: (name: string) => name,
      readInstalledContentFn,
      readExistingContentFn,
      // The REAL adapter — this is the exact seam the reported defect wrote
      // through.
      writeFileFn: createFsWriteFileFn() as WriteFileFn,
      readProjectStateFn,
      writeProjectStateFn,
      bundleExistsFn,
      copyBundleFn,
      removeBundleFn,
      // The REAL containment guard, curried over the REAL repository root —
      // this is what actually refuses the escape below.
      assertPathWithinRootFn: createFsAssertPathWithinRootFn(repoRoot),
      removeProjectFileFn: createFsRemoveProjectFileFn(),
      removeEmptyDirFn: createFsRemoveEmptyDirFn(),
    };

    const result = await runApplyPipeline({ templates: { [templateName]: ['app'] } }, repoRoot, false, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_PATH');
    // The heart of the regression: nothing was written outside the project,
    // and the project state document was never mutated to record the
    // target as applied.
    expect(existsSync(path.join(outsideDir, 'index.ts'))).toBe(false);
    expect(JSON.parse(projectStateContent ?? 'null').templates[templateName].targets).toEqual([]);
  });

  // ESCAPE 1's exact end-to-end reproduction: `mkdir -p app && ln -s
  // /outside/nonexistent.txt app/README.md`, then `apply` a template whose
  // payload lands on `app/README.md`. The dangling link's own target does
  // not exist, so the old containment walk treated it as an ordinary
  // not-yet-existing path and let the write through.
  it('refuses INVALID_PATH, writing nothing outside the project, when a payload path resolves through a dangling symlink pointing outside', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-apply-dangling-repo-'));
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-apply-dangling-outside-'));
    const outsideTarget = path.join(outsideDir, 'nonexistent.txt');
    await mkdir(path.join(repoRoot, 'app'), { recursive: true });
    await symlink(outsideTarget, path.join(repoRoot, 'app', 'README.md'));

    const templateName = '@acme/t';
    const installedEntries = new Map<string, InventoryEntry>();
    installedEntries.set(templateName, {
      name: templateName,
      source: `github:acme/t@v1`,
      ref: 'v1',
      status: InventoryState.INSTALLED,
      content: JSON.stringify(manifest(templateName)),
    });
    const templateContent = new Map<string, ContentItem[]>([
      [templateName, [{ path: 'README.md', content: 'hello' }]],
    ]);

    let projectStateContent: string | null = JSON.stringify({
      formatVersion: 1,
      templates: { [templateName]: { origin: `github:acme/t@v1`, version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    } satisfies ProjectStateDocument);

    const inventory: UniformApplyInventoryPort = {
      lookup: (name) => installedEntries.get(name),
      install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
    };
    const readInstalledContentFn: ReadInstalledContentFn = async (installedContentPath) =>
      templateContent.get(installedContentPath) ?? [];
    const readExistingContentFn: ReadExistingContentFn = async () => [];
    const canonicalizeFn: CanonicalizeTargetFn = (rawTarget) => rawTarget;
    const readProjectStateFn: ReadProjectStateFn = async () => projectStateContent;
    const writeProjectStateFn: WriteProjectStateFn = async (_absolutePath, content) => {
      projectStateContent = content;
    };
    const readFileFn: ReadFileFn = vi.fn(async () => {
      throw new Error('readFileFn not stubbed for this test');
    });
    const bundleExistsFn: BundleExistsFn = vi.fn(async () => false);
    const copyBundleFn: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundleFn: RemoveBundleFn = vi.fn(async () => undefined);

    const deps: ApplyPipelineDeps = {
      inventory,
      fetchFn: vi.fn(async () => ''),
      readFileFn,
      canonicalizeFn,
      // REAL, not a `vi.fn(async () => true)` stub: the pipeline's pre-write
      // pass asks this seam which ancestor directories were already standing
      // before materialization, and `rollbackWrittenPaths` prunes only the
      // ones that were not. A stub that answers "yes, it exists" to every
      // path makes every directory look like the developer's own and turns
      // the rollback into a silent no-op — the fixture would then assert a
      // pruning that never happened.
      existsFn: createFsPathExistsFn(),
      listFolderFilesFn: vi.fn(async () => []),
      resolveInstalledContentPathFn: (name: string) => name,
      readInstalledContentFn,
      readExistingContentFn,
      writeFileFn: createFsWriteFileFn() as WriteFileFn,
      readProjectStateFn,
      writeProjectStateFn,
      bundleExistsFn,
      copyBundleFn,
      removeBundleFn,
      assertPathWithinRootFn: createFsAssertPathWithinRootFn(repoRoot),
      removeProjectFileFn: createFsRemoveProjectFileFn(),
      removeEmptyDirFn: createFsRemoveEmptyDirFn(),
    };

    const result = await runApplyPipeline({ templates: { [templateName]: ['app'] } }, repoRoot, false, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_PATH');
    expect(existsSync(outsideTarget)).toBe(false);
    expect(JSON.parse(projectStateContent ?? 'null').templates[templateName].targets).toEqual([]);
  });
});

// End-to-end coverage of the gap a snapshot-and-refuse check alone leaves
// open: `commands/apply.ts` snapshots an adopted path and refuses
// `CONTENT_CONFLICT` after the fact if it changed, but that only turns
// silent corruption into REPORTED corruption — the file is still destroyed
// by the time the refusal fires. This suite proves PREVENTION, through both
// real adapters this task owns together: `createFsReadExistingContentFn`
// (the walker that SEES the symlink, `adapters/fs-existing-content.ts`) and
// `createFsWriteFileFn` (the writer that REFUSES to write through one,
// `adapters/fs-project-io.ts`) — either one alone already closes this exact
// scenario; this suite exercises them together, as production wiring
// actually does.
describe('apply --adopt-existing end-to-end: a declared payload path aliasing another file via symlink', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  function manifest(name: string): Record<string, unknown> {
    return { name, version: '1.0.0', excludedSubtrees: [], description: `Fixture template "${name}"` };
  }

  it('refuses CONTENT_CONFLICT and leaves the aliased file intact, instead of overwriting it', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-adopt-symlink-repo-'));
    // The exact reproduction named in the task brief: `shared/precious.txt`
    // holds known content, and the template's own declared payload path is
    // a symlink aliasing it.
    await mkdir(path.join(repoRoot, 'shared'), { recursive: true });
    await writeFile(path.join(repoRoot, 'shared', 'precious.txt'), 'PRECIOUS-CONTENT', 'utf-8');
    await mkdir(path.join(repoRoot, 'app'), { recursive: true });
    await symlink(path.join(repoRoot, 'shared', 'precious.txt'), path.join(repoRoot, 'app', 'config.json'));

    const templateName = '@acme/t';
    const installedEntries = new Map<string, InventoryEntry>();
    installedEntries.set(templateName, {
      name: templateName,
      source: `github:acme/t@v1`,
      ref: 'v1',
      status: InventoryState.INSTALLED,
      content: JSON.stringify(manifest(templateName)),
    });
    const templateContent = new Map<string, ContentItem[]>([
      [templateName, [{ path: 'config.json', content: 'TEMPLATE-CONTENT' }]],
    ]);

    let projectStateContent: string | null = JSON.stringify({
      formatVersion: 1,
      templates: { [templateName]: { origin: `github:acme/t@v1`, version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    } satisfies ProjectStateDocument);

    const inventory: UniformApplyInventoryPort = {
      lookup: (name) => installedEntries.get(name),
      install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
    };
    const readInstalledContentFn: ReadInstalledContentFn = async (installedContentPath) =>
      templateContent.get(installedContentPath) ?? [];
    // The REAL adapter under test — this is the seam the reported defect
    // proved blind to a symlink already standing at the target.
    const readExistingContentFn: ReadExistingContentFn = createFsReadExistingContentFn(repoRoot);
    const canonicalizeFn: CanonicalizeTargetFn = (rawTarget) => rawTarget;
    const readProjectStateFn: ReadProjectStateFn = async () => projectStateContent;
    const writeProjectStateFn: WriteProjectStateFn = async (_absolutePath, content) => {
      projectStateContent = content;
    };
    const readFileFn: ReadFileFn = vi.fn(async () => {
      throw new Error('readFileFn not stubbed for this test');
    });
    const bundleExistsFn: BundleExistsFn = vi.fn(async () => false);
    const copyBundleFn: CopyBundleFn = vi.fn(async () => undefined);
    const removeBundleFn: RemoveBundleFn = vi.fn(async () => undefined);

    const deps: ApplyPipelineDeps = {
      inventory,
      fetchFn: vi.fn(async () => ''),
      readFileFn,
      canonicalizeFn,
      // REAL, not a `vi.fn(async () => true)` stub: the pipeline's pre-write
      // pass asks this seam which ancestor directories were already standing
      // before materialization, and `rollbackWrittenPaths` prunes only the
      // ones that were not. A stub that answers "yes, it exists" to every
      // path makes every directory look like the developer's own and turns
      // the rollback into a silent no-op — the fixture would then assert a
      // pruning that never happened.
      existsFn: createFsPathExistsFn(),
      listFolderFilesFn: vi.fn(async () => []),
      resolveInstalledContentPathFn: (name: string) => name,
      readInstalledContentFn,
      readExistingContentFn,
      // The REAL adapter under test too — belt and suspenders with the
      // walker above; either fix alone already prevents the corruption.
      writeFileFn: createFsWriteFileFn() as WriteFileFn,
      readProjectStateFn,
      writeProjectStateFn,
      bundleExistsFn,
      copyBundleFn,
      removeBundleFn,
      assertPathWithinRootFn: createFsAssertPathWithinRootFn(repoRoot),
      removeProjectFileFn: createFsRemoveProjectFileFn(),
      removeEmptyDirFn: createFsRemoveEmptyDirFn(),
    };

    // `--adopt-existing` (the third argument, `true`): the exact flag the
    // defect's own promise ("leave existing content untouched") was made
    // under, and broken by.
    const result = await runApplyPipeline({ templates: { [templateName]: ['app'] } }, repoRoot, true, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    // The heart of the fix: the aliased file survives, byte-for-byte, and
    // the batch was never recorded as applied.
    expect(await readFile(path.join(repoRoot, 'shared', 'precious.txt'), 'utf-8')).toBe('PRECIOUS-CONTENT');
    expect(JSON.parse(projectStateContent ?? 'null').templates[templateName].targets).toEqual([]);
  });
});

// DIRECTORY-SYMLINK FIX: neither of the two suites above catches a
// symlinked DIRECTORY — only a symlinked FILE standing exactly at a
// payload path. This suite proves the fix at the SAME end-to-end depth
// (real `createFsReadExistingContentFn` walker feeding real
// `reconcileExistingContent`, real `createFsWriteFileFn` writer) for both
// variants: A, the symlinked directory stands INSIDE the target; B, it
// stands inside the project but OUTSIDE the target. Without the fix, both
// would report `ok:true` (variant B) or a too-late `CONTENT_CONFLICT`
// (variant A, via the adopted-path snapshot check, only after the precious
// bytes were already overwritten) — this suite proves PREVENTION: the
// precious file survives, byte for byte, and the batch is refused before a
// single byte is written through the link.
describe('apply --adopt-existing end-to-end: a symlinked DIRECTORY standing over a payload path', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  function manifest(name: string): Record<string, unknown> {
    return { name, version: '1.0.0', excludedSubtrees: [], description: `Fixture template "${name}"` };
  }

  function makeApplyDeps(args: {
    repoRoot: string;
    templateName: string;
    payload: ContentItem[];
    getProjectStateContent: () => string | null;
    setProjectStateContent: (content: string) => void;
  }): ApplyPipelineDeps {
    const installedEntries = new Map<string, InventoryEntry>();
    installedEntries.set(args.templateName, {
      name: args.templateName,
      source: `github:acme/t@v1`,
      ref: 'v1',
      status: InventoryState.INSTALLED,
      content: JSON.stringify(manifest(args.templateName)),
    });
    const templateContent = new Map<string, ContentItem[]>([[args.templateName, args.payload]]);
    const inventory: UniformApplyInventoryPort = {
      lookup: (name) => installedEntries.get(name),
      install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
    };
    return {
      inventory,
      fetchFn: vi.fn(async () => ''),
      readFileFn: vi.fn(async () => {
        throw new Error('readFileFn not stubbed for this test');
      }),
      canonicalizeFn: (rawTarget: string) => rawTarget,
      // REAL, not a `vi.fn(async () => true)` stub: the pipeline's pre-write
      // pass asks this seam which ancestor directories were already standing
      // before materialization, and `rollbackWrittenPaths` prunes only the
      // ones that were not. A stub that answers "yes, it exists" to every
      // path makes every directory look like the developer's own and turns
      // the rollback into a silent no-op — the fixture would then assert a
      // pruning that never happened.
      existsFn: createFsPathExistsFn(),
      listFolderFilesFn: vi.fn(async () => []),
      resolveInstalledContentPathFn: (name: string) => name,
      readInstalledContentFn: async (installedContentPath) => templateContent.get(installedContentPath) ?? [],
      readExistingContentFn: createFsReadExistingContentFn(args.repoRoot),
      writeFileFn: createFsWriteFileFn() as WriteFileFn,
      readProjectStateFn: async () => args.getProjectStateContent(),
      writeProjectStateFn: async (_absolutePath, content) => args.setProjectStateContent(content),
      bundleExistsFn: vi.fn(async () => false),
      copyBundleFn: vi.fn(async () => undefined),
      removeBundleFn: vi.fn(async () => undefined),
      assertPathWithinRootFn: createFsAssertPathWithinRootFn(args.repoRoot),
      removeProjectFileFn: createFsRemoveProjectFileFn(),
      removeEmptyDirFn: createFsRemoveEmptyDirFn(),
    };
  }

  // Variant A: `app/dir -> app/realdir` (a REAL directory the link aliases),
  // and `app/realdir/file.txt` already holds precious content. The
  // template's payload declares `app/dir/file.txt`, target `.`.
  it('variant A (symlink inside the target): refuses CONTENT_CONFLICT and leaves the aliased file byte-for-byte intact', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-dirsymlink-a-'));
    await mkdir(path.join(repoRoot, 'app', 'realdir'), { recursive: true });
    await writeFile(path.join(repoRoot, 'app', 'realdir', 'file.txt'), 'PRECIOUS-DO-NOT-TOUCH', 'utf-8');
    await symlink(path.join(repoRoot, 'app', 'realdir'), path.join(repoRoot, 'app', 'dir'));

    const templateName = '@acme/dirsymlink-a';
    let projectStateContent: string | null = JSON.stringify({
      formatVersion: 1,
      templates: { [templateName]: { origin: 'github:acme/t@v1', version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    } satisfies ProjectStateDocument);

    const deps = makeApplyDeps({
      repoRoot,
      templateName,
      payload: [{ path: 'app/dir/file.txt', content: 'TEMPLATE-CONTENT' }],
      getProjectStateContent: () => projectStateContent,
      setProjectStateContent: (content) => {
        projectStateContent = content;
      },
    });

    const result = await runApplyPipeline({ templates: { [templateName]: ['.'] } }, repoRoot, true, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    // The heart of the fix: the bytes behind the link are untouched, and
    // nothing was recorded as applied.
    expect(await readFile(path.join(repoRoot, 'app', 'realdir', 'file.txt'), 'utf-8')).toBe('PRECIOUS-DO-NOT-TOUCH');
    expect(JSON.parse(projectStateContent ?? 'null').templates[templateName].targets).toEqual([]);
  });

  // Variant B: `dst/app/dir -> ../../shared` (escaping the TARGET, `dst`,
  // but still resolving inside the PROJECT), and `shared/file.txt` already
  // holds precious content. The template's payload declares
  // `app/dir/file.txt`, target `dst`. This is the WORSE reproduction: no
  // refusal at all before this fix, because the post-materialization
  // adopted-path re-read only ever looks inside the target and can never
  // see a change landing outside it.
  it('variant B (symlink inside the project but outside the target): refuses CONTENT_CONFLICT and leaves the aliased file byte-for-byte intact', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-dirsymlink-b-'));
    await mkdir(path.join(repoRoot, 'shared'), { recursive: true });
    await writeFile(path.join(repoRoot, 'shared', 'file.txt'), 'PRECIOUS-DO-NOT-TOUCH', 'utf-8');
    await mkdir(path.join(repoRoot, 'dst', 'app'), { recursive: true });
    await symlink(path.join('..', '..', 'shared'), path.join(repoRoot, 'dst', 'app', 'dir'));

    const templateName = '@acme/dirsymlink-b';
    let projectStateContent: string | null = JSON.stringify({
      formatVersion: 1,
      templates: { [templateName]: { origin: 'github:acme/t@v1', version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    } satisfies ProjectStateDocument);

    const deps = makeApplyDeps({
      repoRoot,
      templateName,
      payload: [{ path: 'app/dir/file.txt', content: 'TEMPLATE-CONTENT' }],
      getProjectStateContent: () => projectStateContent,
      setProjectStateContent: (content) => {
        projectStateContent = content;
      },
    });

    const result = await runApplyPipeline({ templates: { [templateName]: ['dst'] } }, repoRoot, true, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    // The heart of the fix: content OUTSIDE the target, aliased through the
    // link, survives byte-for-byte — the exact ground the old adopted-path
    // re-read could never even see.
    expect(await readFile(path.join(repoRoot, 'shared', 'file.txt'), 'utf-8')).toBe('PRECIOUS-DO-NOT-TOUCH');
    expect(JSON.parse(projectStateContent ?? 'null').templates[templateName].targets).toEqual([]);
  });
});

// DANGLING-SYMLINK-INSIDE FIX for `createFsWriteFileFn`: the last writer in
// this package that still called `fs.mkdirSync(path.dirname(destPath),
// ...)` literally instead of `resolveWriteParentDir` — see
// `createFsWriteProjectStateFn`'s own analogous suite above, and
// `fs-upgrade-io`'s own analogous suite below it, for the identical fix
// already proven for every OTHER writer.
describe('createFsWriteFileFn (dangling-symlink-inside parent resolution)', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  it('writes through a dangling symlink pointing inside the root, creating its resolved parent chain instead of crashing on mkdir', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-writefile-dangling-'));
    await mkdir(path.join(repoRoot, 'app'), { recursive: true });
    // `app/dir` is a DANGLING symlink whose LEXICAL target
    // (`missing-parent/real-dir`) resolves inside the project root —
    // deliberately ALLOWED by containment, and exactly the reproduction:
    // `mkdirSync(path.dirname('app/dir/file.txt'))` used to call
    // `mkdirSync('app/dir')` literally, which creates nothing
    // `missing-parent/real-dir` needs, since `app/dir` already "exists" (as
    // the link itself).
    await symlink(path.join('missing-parent', 'real-dir'), path.join(repoRoot, 'app', 'dir'));
    const writeFileFn = createFsWriteFileFn();

    await writeFileFn(path.join(repoRoot, 'app', 'dir', 'file.txt'), 'payload');

    expect(await readFile(path.join(repoRoot, 'app', 'missing-parent', 'real-dir', 'file.txt'), 'utf-8')).toBe(
      'payload',
    );
  });
});

// A deliberate `PathContainmentError` must not fall through
// `runApplyPipeline`'s blanket catch as `INTERNAL`, exit 2 — it needs the
// same `INVALID_PATH` user-error every OTHER containment refusal in this
// package already reports. This suite proves it with `.frontx` itself
// replaced by a symlink to a directory OUTSIDE the project, through the
// REAL project-state reader/writer, so the error is thrown from exactly
// where production throws it (`createFsWriteProjectStateFn`'s own
// containment check, reached from `mutateProjectState` during the record
// step), never simulated with a fake that throws on command.
describe('apply end-to-end: PathContainmentError from the record step is reported as INVALID_PATH, not INTERNAL', () => {
  let repoRoot: string;
  let outsideDir: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    repoRoot = '';
    outsideDir = '';
  });

  function manifest(name: string): Record<string, unknown> {
    return { name, version: '1.0.0', excludedSubtrees: [], description: `Fixture template "${name}"` };
  }

  it('reports INVALID_PATH (exit-mapped, `--json`-safe) and rolls back the payload this call itself wrote', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-pcontainment-apply-repo-'));
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-pcontainment-apply-outside-'));
    const templateName = '@acme/pcontainment';
    // The project state document already exists — readable through the
    // symlink below exactly as `createFsReadProjectStateFn` reads any other
    // file — but every WRITE to it must resolve inside `repoRoot`, which
    // this symlink defeats.
    const initialDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { [templateName]: { origin: 'github:acme/t@v1', version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    };
    await mkdir(outsideDir, { recursive: true });
    await writeFile(path.join(outsideDir, 'project.json'), JSON.stringify(initialDocument, null, 2), 'utf-8');
    await symlink(outsideDir, path.join(repoRoot, '.frontx'));

    const installedEntries = new Map<string, InventoryEntry>();
    installedEntries.set(templateName, {
      name: templateName,
      source: 'github:acme/t@v1',
      ref: 'v1',
      status: InventoryState.INSTALLED,
      content: JSON.stringify(manifest(templateName)),
    });
    const templateContent = new Map<string, ContentItem[]>([
      [templateName, [{ path: 'src/index.ts', content: 'hello' }]],
    ]);
    const inventory: UniformApplyInventoryPort = {
      lookup: (name) => installedEntries.get(name),
      install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
    };

    const deps: ApplyPipelineDeps = {
      inventory,
      fetchFn: vi.fn(async () => ''),
      readFileFn: vi.fn(async () => {
        throw new Error('readFileFn not stubbed for this test');
      }),
      canonicalizeFn: (rawTarget: string) => rawTarget,
      // REAL, not a `vi.fn(async () => true)` stub: the pipeline's pre-write
      // pass asks this seam which ancestor directories were already standing
      // before materialization, and `rollbackWrittenPaths` prunes only the
      // ones that were not. A stub that answers "yes, it exists" to every
      // path makes every directory look like the developer's own and turns
      // the rollback into a silent no-op — the fixture would then assert a
      // pruning that never happened.
      existsFn: createFsPathExistsFn(),
      listFolderFilesFn: vi.fn(async () => []),
      resolveInstalledContentPathFn: (name: string) => name,
      readInstalledContentFn: async (installedContentPath) => templateContent.get(installedContentPath) ?? [],
      readExistingContentFn: createFsReadExistingContentFn(repoRoot),
      writeFileFn: createFsWriteFileFn() as WriteFileFn,
      // Both REAL — the exact seams that throw `PathContainmentError` in
      // production (`createFsWriteProjectStateFn`) and read the document
      // it protects (`createFsReadProjectStateFn`).
      readProjectStateFn: createFsReadProjectStateFn(),
      writeProjectStateFn: createFsWriteProjectStateFn(),
      bundleExistsFn: vi.fn(async () => false),
      copyBundleFn: vi.fn(async () => undefined),
      removeBundleFn: vi.fn(async () => undefined),
      assertPathWithinRootFn: createFsAssertPathWithinRootFn(repoRoot),
      removeProjectFileFn: createFsRemoveProjectFileFn(),
      removeEmptyDirFn: createFsRemoveEmptyDirFn(),
    };

    const result = await runApplyPipeline({ templates: { [templateName]: ['app'] } }, repoRoot, false, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The heart of the fix: a deliberate, typed refusal reported as the
    // SAME `INVALID_PATH` code every other containment escape in this
    // package uses — never `INTERNAL`.
    expect(result.code).toBe('INVALID_PATH');
    expect(result.message).toMatch(/outside the project root/);
    expect(result.details).toMatchObject({ path: expect.stringContaining('.frontx') });
    // ATOMICITY FIX: this call never recorded anything (the record step is
    // exactly where it failed), so the payload it wrote is unambiguously
    // its own to remove — the file, and the now-empty `app` directory it
    // created, are both actually gone.
    expect(existsSync(path.join(repoRoot, 'app', 'src', 'index.ts'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'app'))).toBe(false);
    // The document OUTSIDE the project is untouched — the refusal fired
    // before any write to it landed.
    expect(JSON.parse(await readFile(path.join(outsideDir, 'project.json'), 'utf-8'))).toEqual(initialDocument);
  });
});

// `rollbackWrittenPaths` (`../commands/apply.ts`) is the ONE shared removal
// formulation both `apply`'s own post-materialization rollback and `seed`'s
// own rollback (`commands/seed-repository.ts`) call — without it, a
// rolled-back `seed` can leave dozens of empty directories behind (a live
// run left 73-99). Proven here directly against a real filesystem,
// independent of either caller's own batch-resolution machinery.
describe('rollbackWrittenPaths (real fs): removes written files and prunes the directories they leave empty', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  it('removes every written file and prunes every directory left empty, deepest-first, bounded by repoRoot', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-rollback-writtenpaths-'));
    await mkdir(path.join(repoRoot, 'apps', 'foo', 'src', 'deep'), { recursive: true });
    await writeFile(path.join(repoRoot, 'apps', 'foo', 'src', 'deep', 'a.ts'), 'a', 'utf-8');
    await writeFile(path.join(repoRoot, 'apps', 'foo', 'src', 'b.ts'), 'b', 'utf-8');
    await mkdir(path.join(repoRoot, 'apps', 'bar'), { recursive: true });
    // A sibling file OUTSIDE `writtenPaths` — its directory must survive.
    await writeFile(path.join(repoRoot, 'apps', 'bar', 'keep.txt'), 'keep', 'utf-8');

    await rollbackWrittenPaths(
      repoRoot,
      ['apps/foo/src/deep/a.ts', 'apps/foo/src/b.ts'],
      createFsRemoveProjectFileFn(),
      createFsRemoveEmptyDirFn(),
      // Every directory below `apps` was created by this notional call;
      // `apps` itself was not, so it is not in the set and the walk stops
      // there even before its surviving sibling would have saved it.
      new Set([
        path.join(repoRoot, 'apps', 'foo'),
        path.join(repoRoot, 'apps', 'foo', 'src'),
        path.join(repoRoot, 'apps', 'foo', 'src', 'deep'),
      ]),
      // No bundle materialization in play for this test — the two new
      // BUNDLE-ROLLBACK FIX arguments are covered on their own below.
      vi.fn(async () => {}),
      new Set(),
    );

    // The written files are gone.
    expect(existsSync(path.join(repoRoot, 'apps', 'foo', 'src', 'deep', 'a.ts'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'apps', 'foo', 'src', 'b.ts'))).toBe(false);
    // Every directory those removals left empty is pruned, deepest-first —
    // `apps/foo` itself included, since nothing else was ever written there.
    expect(existsSync(path.join(repoRoot, 'apps', 'foo'))).toBe(false);
    // `apps` itself survives: `apps/bar/keep.txt` still lives beneath it.
    expect(existsSync(path.join(repoRoot, 'apps'))).toBe(true);
    expect(existsSync(path.join(repoRoot, 'apps', 'bar', 'keep.txt'))).toBe(true);
    // `repoRoot` itself is never a removal candidate.
    expect(existsSync(repoRoot)).toBe(true);
  });

  it('is a no-op for an empty writtenPaths list', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-rollback-writtenpaths-empty-'));

    await expect(
      rollbackWrittenPaths(
        repoRoot,
        [],
        createFsRemoveProjectFileFn(),
        createFsRemoveEmptyDirFn(),
        new Set(),
        vi.fn(async () => {}),
        new Set(),
      ),
    ).resolves.toBeUndefined();
    expect(existsSync(repoRoot)).toBe(true);
  });

  // OVER-PRUNING FIX (found by re-running this round's own fix against the
  // built binary, before it shipped): the pruning walk used to climb every
  // emptied ancestor up to `repoRoot`, which deleted a directory the
  // DEVELOPER created and the batch merely wrote into. A rollback may undo
  // only what the call itself did.
  it('never prunes a directory that was already standing before the call wrote into it', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-rollback-preexisting-'));
    // The developer's own empty directory. The batch writes BENEATH it, in
    // a subdirectory it creates itself.
    await mkdir(path.join(repoRoot, 'app', 'dir'), { recursive: true });
    await writeFile(path.join(repoRoot, 'app', 'dir', 'file.txt'), 'written by this call', 'utf-8');

    await rollbackWrittenPaths(
      repoRoot,
      ['app/dir/file.txt'],
      createFsRemoveProjectFileFn(),
      createFsRemoveEmptyDirFn(),
      // Only `app/dir` was created by this call; `app` was already there.
      new Set([path.join(repoRoot, 'app', 'dir')]),
      vi.fn(async () => {}),
      new Set(),
    );

    expect(existsSync(path.join(repoRoot, 'app', 'dir', 'file.txt'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'app', 'dir'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'app'))).toBe(true);
  });

  // The caller that cannot answer "did this exist already" prunes nothing —
  // `seed`'s own rollback passes exactly this, since it learns
  // `writtenPaths` only from an apply that has already finished writing.
  it('prunes no directory at all when the caller passes an empty created-set', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-rollback-noprune-'));
    await mkdir(path.join(repoRoot, 'a', 'b'), { recursive: true });
    await writeFile(path.join(repoRoot, 'a', 'b', 'f.txt'), 'f', 'utf-8');

    await rollbackWrittenPaths(
      repoRoot,
      ['a/b/f.txt'],
      createFsRemoveProjectFileFn(),
      createFsRemoveEmptyDirFn(),
      new Set(),
      vi.fn(async () => {}),
      new Set(),
    );

    expect(existsSync(path.join(repoRoot, 'a', 'b', 'f.txt'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'a', 'b'))).toBe(true);
  });

  // BUNDLE-ROLLBACK FIX: a rollback must not remove only the payload files
  // named in `writtenPaths`, leaving every `.frontx/ai/<name>/` bundle this
  // same call materialized standing — `targets: []` for the name, but its
  // CLI-owned bundle directory still on disk, so a later `validate
  // --project` would report PASS over ground no state document mentioned.
  // Proven directly here, independent of `apply`'s own batch machinery:
  // every name in `bundledNamesThisCall` gets `removeBundleFn` called for
  // it, exactly once, regardless of whether it also had a payload file in
  // `writtenPaths`.
  it('also removes every AI-extension bundle named in bundledNamesThisCall', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-rollback-bundles-'));
    const removedBundles: string[] = [];
    const removeBundleFn = vi.fn(async (root: string, name: string) => {
      expect(root).toBe(repoRoot);
      removedBundles.push(name);
    });

    await rollbackWrittenPaths(
      repoRoot,
      [],
      createFsRemoveProjectFileFn(),
      createFsRemoveEmptyDirFn(),
      new Set(),
      removeBundleFn,
      new Set(['@scratch/a', '@scratch/b']),
    );

    expect(removeBundleFn).toHaveBeenCalledTimes(2);
    expect(removedBundles.sort()).toEqual(['@scratch/a', '@scratch/b']);
  });

  // The mirror case: a name never added to `bundledNamesThisCall` (an
  // already-bundled name this call only added a SECOND target to, per
  // `runApplyPipeline`'s own `targetsBefore > 0` skip) must never have
  // `removeBundleFn` called for it — its bundle predates this call and its
  // record stands untouched.
  it('never calls removeBundleFn for a name outside bundledNamesThisCall', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-rollback-no-bundle-touch-'));
    const removeBundleFn = vi.fn(async () => {});

    await rollbackWrittenPaths(
      repoRoot,
      [],
      createFsRemoveProjectFileFn(),
      createFsRemoveEmptyDirFn(),
      new Set(),
      removeBundleFn,
      new Set(),
    );

    expect(removeBundleFn).not.toHaveBeenCalled();
  });
});
