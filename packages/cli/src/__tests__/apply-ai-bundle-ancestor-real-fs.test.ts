// @cpt-flow:cpt-frontx-flow-cli-scaffolding-add-template:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-ai-bundle:p1
//
// Real-filesystem coverage for a live repro on the built binary: `apply`
// aborted `INTERNAL` (exit 2) materializing the CLI-owned AI-extension
// bundle for a SCOPED manifest name (`@x/a`) whenever a non-directory
// already stood at the scope component of its own destination
// (`.frontx/ai/@x`) — a regular file or a FIFO, both reproduced here with
// `mkfifo` (a POSIX utility on every platform this suite runs on, matching
// this suite's own `assemble-registered-manifest-real-fs.test.ts` and
// `delete-manifest-real-fs.test.ts` convention). `fs.mkdirSync(...,
// { recursive: true })` throws `EEXIST`/`ENOTDIR` the moment it reaches such
// a component, which `runApplyPipeline`'s own bundle-step catch could only
// honestly report as `INTERNAL` — not `PathContainmentError`, since nothing
// here ever escaped the project root.
//
// `.frontx/ai/` is ground the CLI alone writes and removes (ADR 0031), so a
// non-directory found strictly BETWEEN `.frontx/ai/` and the bundle's own
// destination is now RECLAIMED rather than refused
// (`inst-aib-reclaim-ancestor-blocker`, `adapters/fs-ai-bundle.ts`). A
// DIRECTORY found there is never touched — it may legitimately hold another
// scoped name's own already-materialized bundle, proven here by keeping
// `@x/other`'s bundle intact while `@x/a`'s is added beside it. The bundle
// DESTINATION itself standing as a symlink into the project was already
// handled correctly before this fix (`clearBundleDestination`) — pinned here
// so it cannot regress.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, symlink, lstat } from 'node:fs/promises';
import { readdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runApplyPipeline } from '../commands/apply';
import type { ApplyPipelineDeps, RemoveEmptyDirFn } from '../commands/apply';
import type { UniformApplyInventoryPort } from '../scaffold/assembler';
import type { ProjectStateDocument } from '../project-state/types';
import {
  createFsCanonicalizeTargetFn,
  createFsPathExistsFn,
  createFsReadFileFn,
  createFsWriteFileFn,
  createFsRemoveProjectFileFn,
  createFsAssertPathWithinRootFn,
} from '../adapters/fs-project-io';
import { createFsListDiskFilesFn } from '../adapters/fs-upgrade-io';
import { createFsReadInstalledContentFn } from '../adapters/fs-existing-content';
import { createFsBundleExistsFn, createFsCopyBundleFn, createFsRemoveBundleFn } from '../adapters/fs-ai-bundle';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

function makeFifo(fifoPath: string): void {
  execFileSync('mkfifo', [fifoPath]);
}

function manifest(name: string): Record<string, unknown> {
  return { name, version: '1.0.0', excludedSubtrees: [], description: `Fixture template "${name}"` };
}

// Mirrors `fs-containment.test.ts`'s own `createFsRemoveEmptyDirFn` fixture
// exactly — a real, filesystem-backed `RemoveEmptyDirFn` for this suite's
// real-temp-directory harness.
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

// Wires every seam `runApplyPipeline` needs to the REAL adapters, applying a
// single locally-registered (`path:`) scoped template `@x/a` from `vendor-a`
// to target `app` — the exact repro's own shape.
async function realDeps(repoRoot: string): Promise<ApplyPipelineDeps> {
  const templateName = '@x/a';
  let projectStateContent: string | null = JSON.stringify({
    formatVersion: 1,
    templates: { [templateName]: { origin: 'path:vendor-a', version: '1.0.0', targets: [] } },
    projectOwnedRoots: [],
  } satisfies ProjectStateDocument);

  const noInventory: UniformApplyInventoryPort = {
    lookup: () => undefined,
    install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
  };

  return {
    inventory: noInventory,
    fetchFn: vi.fn(async () => ''),
    readFileFn: createFsReadFileFn(),
    canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
    existsFn: createFsPathExistsFn(),
    listFolderFilesFn: createFsListDiskFilesFn(),
    resolveInstalledContentPathFn: (name: string) => name,
    readInstalledContentFn: createFsReadInstalledContentFn(repoRoot),
    readExistingContentFn: async () => [],
    writeFileFn: createFsWriteFileFn(),
    readProjectStateFn: async () => projectStateContent,
    writeProjectStateFn: async (_absolutePath, content) => {
      projectStateContent = content;
    },
    bundleExistsFn: createFsBundleExistsFn(),
    copyBundleFn: createFsCopyBundleFn(),
    removeBundleFn: createFsRemoveBundleFn(),
    assertPathWithinRootFn: createFsAssertPathWithinRootFn(repoRoot),
    removeProjectFileFn: createFsRemoveProjectFileFn(),
    removeEmptyDirFn: createFsRemoveEmptyDirFn(),
  };
}

async function setupTemplate(repoRoot: string): Promise<void> {
  await mkdir(path.join(repoRoot, 'vendor-a'), { recursive: true });
  await writeFile(path.join(repoRoot, 'vendor-a', 'frontx-template.json'), JSON.stringify(manifest('@x/a')), 'utf-8');
  await writeFile(path.join(repoRoot, 'vendor-a', 'index.ts'), 'export const a = 1;', 'utf-8');
  await mkdir(path.join(repoRoot, 'vendor-a', '.frontx', 'ai', '@x', 'a'), { recursive: true });
  await writeFile(
    path.join(repoRoot, 'vendor-a', '.frontx', 'ai', '@x', 'a', 'SKILL.md'),
    'bundle content for @x/a',
    'utf-8',
  );
}

describe('apply — AI-extension bundle materialization over a blocked scope component (real filesystem)', () => {
  it('reclaims a REGULAR FILE standing at the scope component and still materializes the bundle', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-aib-ancestor-file-'));
    await setupTemplate(root);
    await mkdir(path.join(root, 'app'), { recursive: true });
    await mkdir(path.join(root, '.frontx', 'ai'), { recursive: true });
    await writeFile(path.join(root, '.frontx', 'ai', '@x'), 'a stray file, not a directory', 'utf-8');

    const deps = await realDeps(root);
    const result = await runApplyPipeline({ templates: { '@x/a': ['app'] } }, root, false, deps);

    expect(result.ok).toBe(true);
    const bundled = await readFile(path.join(root, '.frontx', 'ai', '@x', 'a', 'SKILL.md'), 'utf-8');
    expect(bundled).toBe('bundle content for @x/a');
    const scopeStat = await lstat(path.join(root, '.frontx', 'ai', '@x'));
    expect(scopeStat.isDirectory()).toBe(true);
  });

  it('reclaims a FIFO standing at the scope component and still materializes the bundle', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-aib-ancestor-fifo-'));
    await setupTemplate(root);
    await mkdir(path.join(root, 'app'), { recursive: true });
    await mkdir(path.join(root, '.frontx', 'ai'), { recursive: true });
    makeFifo(path.join(root, '.frontx', 'ai', '@x'));

    const deps = await realDeps(root);
    const result = await runApplyPipeline({ templates: { '@x/a': ['app'] } }, root, false, deps);

    expect(result.ok).toBe(true);
    const bundled = await readFile(path.join(root, '.frontx', 'ai', '@x', 'a', 'SKILL.md'), 'utf-8');
    expect(bundled).toBe('bundle content for @x/a');
    const scopeStat = await lstat(path.join(root, '.frontx', 'ai', '@x'));
    expect(scopeStat.isDirectory()).toBe(true);
  });

  it('control: a DIRECTORY at the scope component holding another name\'s bundle is kept intact, and the new bundle lands beside it', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-aib-ancestor-dir-'));
    await setupTemplate(root);
    await mkdir(path.join(root, 'app'), { recursive: true });
    // `@x/other`'s own bundle already stands at the same scope component —
    // an ORDINARY directory, never touched by this step.
    await mkdir(path.join(root, '.frontx', 'ai', '@x', 'other'), { recursive: true });
    await writeFile(path.join(root, '.frontx', 'ai', '@x', 'other', 'SKILL.md'), 'other bundle — must survive', 'utf-8');

    const deps = await realDeps(root);
    const result = await runApplyPipeline({ templates: { '@x/a': ['app'] } }, root, false, deps);

    expect(result.ok).toBe(true);
    const bundled = await readFile(path.join(root, '.frontx', 'ai', '@x', 'a', 'SKILL.md'), 'utf-8');
    expect(bundled).toBe('bundle content for @x/a');
    const otherSurvived = await readFile(path.join(root, '.frontx', 'ai', '@x', 'other', 'SKILL.md'), 'utf-8');
    expect(otherSurvived).toBe('other bundle — must survive');
  });

  it('control: nothing standing at the scope component materializes the bundle exactly as before', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-aib-ancestor-none-'));
    await setupTemplate(root);
    await mkdir(path.join(root, 'app'), { recursive: true });

    const deps = await realDeps(root);
    const result = await runApplyPipeline({ templates: { '@x/a': ['app'] } }, root, false, deps);

    expect(result.ok).toBe(true);
    const bundled = await readFile(path.join(root, '.frontx', 'ai', '@x', 'a', 'SKILL.md'), 'utf-8');
    expect(bundled).toBe('bundle content for @x/a');
  });

  // DEFECT 2: a symlinked ANCESTOR (the scope component, strictly between
  // `.frontx/ai/` and the bundle's own destination) resolving to a directory
  // INSIDE the project is no longer a blocker at all, following the same fix
  // to `firstNonDirectoryComponentOf` that stops treating a directory
  // reached through a symlink as something other than a directory (DEFECT
  // 1). It is traversed exactly like an ordinary directory: the link
  // survives, and the bundle is written straight into the directory it
  // aliases — never reclaimed and replaced with a plain directory the way a
  // regular file or FIFO at the same position still is, above.
  it('traverses a symlinked scope component resolving to a directory INSIDE the project — the link survives and the bundle lands in the aliased directory', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-aib-ancestor-symlink-inside-'));
    await setupTemplate(root);
    await mkdir(path.join(root, 'app'), { recursive: true });
    await mkdir(path.join(root, '.frontx', 'ai'), { recursive: true });
    const devDir = path.join(root, 'dev-owned-scope-dir');
    await mkdir(devDir, { recursive: true });
    await writeFile(path.join(devDir, 'KEEP.md'), 'developer file already here', 'utf-8');
    await symlink(devDir, path.join(root, '.frontx', 'ai', '@x'));

    const deps = await realDeps(root);
    const result = await runApplyPipeline({ templates: { '@x/a': ['app'] } }, root, false, deps);

    expect(result.ok).toBe(true);
    const scopeStat = await lstat(path.join(root, '.frontx', 'ai', '@x'));
    expect(scopeStat.isSymbolicLink()).toBe(true); // the link itself survives, never reclaimed
    const bundled = await readFile(path.join(root, '.frontx', 'ai', '@x', 'a', 'SKILL.md'), 'utf-8');
    expect(bundled).toBe('bundle content for @x/a');
    // Written straight into the aliased directory, not beside the link.
    const bundledThroughAlias = await readFile(path.join(devDir, 'a', 'SKILL.md'), 'utf-8');
    expect(bundledThroughAlias).toBe('bundle content for @x/a');
    const keptFile = await readFile(path.join(devDir, 'KEEP.md'), 'utf-8');
    expect(keptFile).toBe('developer file already here');
  });

  // DEFECT 2 (containment, unchanged): a symlinked ancestor resolving
  // OUTSIDE the project root is still refused — traversing an ancestor that
  // resolves to a directory only ever applies to ground `assertPathWithinProjectRoot`
  // has already proven stays inside the project.
  it('still refuses a symlinked scope component resolving OUTSIDE the project root', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-aib-ancestor-symlink-outside-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-aib-outside-'));
    try {
      await setupTemplate(root);
      await mkdir(path.join(root, 'app'), { recursive: true });
      await mkdir(path.join(root, '.frontx', 'ai'), { recursive: true });
      await symlink(outsideDir, path.join(root, '.frontx', 'ai', '@x'));

      const deps = await realDeps(root);
      const result = await runApplyPipeline({ templates: { '@x/a': ['app'] } }, root, false, deps);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVALID_PATH');
      const outsideEntries = await readdir(outsideDir);
      expect(outsideEntries).toEqual([]); // nothing written through the escaping link
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  // PIN: the bundle DESTINATION itself (`.frontx/ai/@x/a`, not an ancestor of
  // it) standing as a symlink into the project was already reclaimed
  // correctly before this fix (`clearBundleDestination`) — proven here so it
  // cannot regress alongside the new ancestor-reclaim behaviour above.
  it('pin: a symlink standing exactly at the bundle destination is reclaimed, and the file it pointed at survives', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-aib-destination-symlink-'));
    await setupTemplate(root);
    await mkdir(path.join(root, 'app'), { recursive: true });
    await mkdir(path.join(root, '.frontx', 'ai', '@x'), { recursive: true });
    await writeFile(path.join(root, 'elsewhere-target.txt'), 'PRECIOUS — must survive', 'utf-8');
    await symlink(path.join(root, 'elsewhere-target.txt'), path.join(root, '.frontx', 'ai', '@x', 'a'));

    const deps = await realDeps(root);
    const result = await runApplyPipeline({ templates: { '@x/a': ['app'] } }, root, false, deps);

    expect(result.ok).toBe(true);
    const destStat = await lstat(path.join(root, '.frontx', 'ai', '@x', 'a'));
    expect(destStat.isSymbolicLink()).toBe(false);
    expect(destStat.isDirectory()).toBe(true);
    const bundled = await readFile(path.join(root, '.frontx', 'ai', '@x', 'a', 'SKILL.md'), 'utf-8');
    expect(bundled).toBe('bundle content for @x/a');
    const survived = await readFile(path.join(root, 'elsewhere-target.txt'), 'utf-8');
    expect(survived).toBe('PRECIOUS — must survive');
  });
});
