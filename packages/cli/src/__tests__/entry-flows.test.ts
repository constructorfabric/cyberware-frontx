// @cpt-flow:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-add-template:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-seed-repository:p1
//
// REWRITE (checkpoint 3): the prior suite exercised the OLD `seedRepository`/
// `addTemplate` (a bare `templateRef` against an empty-target guard, staged
// through the legacy preset/composition + exclusiveSubtrees/sharedFiles
// ownership model). The CURRENT flows this suite covers are structurally
// different — an explicit target-keyed batch against names already
// registered in the project state store (`cpt-frontx-algo-cli-scaffolding-
// uniform-apply`) — so every fixture below is new; nothing here reuses the
// old suite's fakes.
import { describe, it, expect, vi } from 'vitest';
import { assembleBatch } from '../commands/assemble';
import { runApplyPipeline } from '../commands/apply';
import { seedRepository } from '../commands/seed-repository';
import type { SeedRepositoryDeps } from '../commands/seed-repository';
import { projectStatePath } from '../project-state/io';
import type { UniformApplyBatch, UniformApplyInventoryPort } from '../scaffold/assembler';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { BundleExistsFn, CopyBundleFn, RemoveBundleFn } from '../scaffold/ai-bundle';
import type { ReadExistingContentFn, ReadInstalledContentFn } from '../scaffold/existing-content';
import type { AssertPathWithinRootFn, ContentItem, WriteFileFn } from '../scaffold/types';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';
import { PathContainmentError } from '../adapters/fs-project-io';
import type { ReadFileFn } from '../manifest/types';
import type { InventoryEntry } from '../inventory/types';
import { InventoryState } from '../inventory/types';

const REPO_ROOT = '/repo';

function manifest(name: string, excludedSubtrees: string[] = []): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    excludedSubtrees,
    description: `Fixture template "${name}" for the new uniform-batch entry-flow tests.`,
  };
}

// One isolated fake per test: an in-memory "repository" (`files`, keyed by
// the SAME absolute path `writeFileFn`/`readExistingContentFn` operate on),
// an in-memory "local template inventory" (`templateContent`, keyed by
// installed-content-path — the identity of the template's own name here,
// since `resolveInstalledContentPathFn` below is the identity function),
// and an in-memory "project state store" (`projectStateContent`) — no real
// filesystem or network access anywhere in this suite, per this package's
// dependency-injection test convention.
function makeHarness() {
  const files = new Map<string, string>();
  const templateContent = new Map<string, ContentItem[]>();
  const installedEntries = new Map<string, InventoryEntry>();
  const templateHasBundle = new Set<string>();
  const projectHasBundle = new Set<string>();
  let projectStateContent: string | null = null;

  const inventory: UniformApplyInventoryPort = {
    lookup: (name) => installedEntries.get(name),
    install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
  };

  const readInstalledContentFn: ReadInstalledContentFn = async (installedContentPath) =>
    templateContent.get(installedContentPath) ?? [];

  // Mirrors `adapters/fs-existing-content.ts`'s real `createFsReadExistingContentFn`
  // exactly, over the in-memory `files` map instead of a real filesystem:
  // every entry under `target`'s absolute directory, re-rooted to a
  // project-relative path.
  const readExistingContentFn: ReadExistingContentFn = async (target) => {
    const prefix = target === '.' ? `${REPO_ROOT}/` : `${REPO_ROOT}/${target}/`;
    const items: ContentItem[] = [];
    for (const [absolutePath, content] of files) {
      if (!absolutePath.startsWith(prefix)) continue;
      items.push({ path: absolutePath.slice(REPO_ROOT.length + 1), content });
    }
    return items;
  };

  const writeFileFn: WriteFileFn = async (destPath, content) => {
    files.set(destPath, content);
  };

  // Identity: every target in this suite's fixtures is already a well-formed
  // project-relative path (or `.`), so real symlink/`..`-escape resolution is
  // not this suite's concern (that seam has its own real-fs coverage
  // elsewhere in this package).
  const canonicalizeFn: CanonicalizeTargetFn = (rawTarget) => rawTarget;

  // No-op for the identical reason `canonicalizeFn` above is an identity:
  // `REPO_ROOT` (`/repo`) is a notional path with no real filesystem
  // backing, so the real, symlink-resolving `assertPathWithinProjectRoot`
  // cannot honestly run against it — that seam's own real-fs coverage lives
  // in `__tests__/fs-containment.test.ts`, including its required
  // `runApplyPipeline` end-to-end regression against a REAL project root.
  const assertPathWithinRootFn: AssertPathWithinRootFn = () => undefined;

  const readProjectStateFn: ReadProjectStateFn = async () => projectStateContent;
  const writeProjectStateFn: WriteProjectStateFn = async (_absolutePath, content) => {
    projectStateContent = content;
  };

  // `root` is the FIRST_TARGET_GAINED transition's `installedContentPath` —
  // the identity-resolved template name in this suite's fixtures — so a
  // bundle is reported present only for the exact name that declared one.
  const bundleExistsFn: BundleExistsFn = vi.fn(
    async (root: string, manifestName: string) => templateHasBundle.has(manifestName) && root === manifestName,
  );
  const copyBundleFn: CopyBundleFn = vi.fn(async (_sourceRoot: string, _destRoot: string, manifestName: string) => {
    projectHasBundle.add(manifestName);
  });
  const removeBundleFn: RemoveBundleFn = vi.fn(async (_root: string, manifestName: string) => {
    projectHasBundle.delete(manifestName);
  });

  const readFileFn: ReadFileFn = vi.fn(async () => {
    throw new Error('readFileFn not stubbed for this test');
  });

  // The resolver's own local-`path:`-origin seams. Every fixture in this
  // suite that exercises a local origin does so by overriding `readFileFn`
  // directly (never through the `files` map, which models WRITTEN targets,
  // not template source folders), so a local origin folder is presumed to
  // exist and to hold no files beyond whatever `readFileFn` itself
  // fixtures by path.
  const existsFn = vi.fn(async () => true);
  const listFolderFilesFn = vi.fn(async () => [] as string[]);

  // `seed`'s own rollback seams (`inst-seed-rollback`) — a plain "remove
  // this one file" over the SAME in-memory `projectStateContent` store
  // `readProjectStateFn`/`writeProjectStateFn` above already share for
  // exactly the project state path, and over the SAME in-memory `files`
  // map for any OTHER absolute path — `rollbackSeedWrites`'s own
  // `writtenPaths` cleanup reuses this identical
  // seam to remove whatever payload files a failed apply phase reported as
  // written, so this fake must genuinely model "remove whatever is really
  // at this absolute path" rather than unconditionally nulling project
  // state regardless of which path was asked for. A no-op for the
  // `.frontx`-directory removal (this harness models no real filesystem, so
  // there is no real directory for it to reconsider). Kept on the ONE
  // `deps` object below — typed `SeedRepositoryDeps`, a strict superset of
  // `ApplyPipelineDeps` — so every existing `assembleBatch`/
  // `runApplyPipeline` call in this file keeps working unchanged (a wider
  // object structurally satisfies the narrower parameter type they expect).
  const removeProjectFileFn = vi.fn(async (absolutePath: string) => {
    if (absolutePath === projectStatePath(REPO_ROOT)) {
      projectStateContent = null;
    } else {
      files.delete(absolutePath);
    }
  });
  const removeEmptyDirFn = vi.fn(async () => undefined);

  const deps: SeedRepositoryDeps = {
    inventory,
    fetchFn: vi.fn(async () => ''),
    readFileFn,
    canonicalizeFn,
    existsFn,
    listFolderFilesFn,
    resolveInstalledContentPathFn: (name: string) => name,
    readInstalledContentFn,
    readExistingContentFn,
    writeFileFn,
    readProjectStateFn,
    writeProjectStateFn,
    bundleExistsFn,
    copyBundleFn,
    removeBundleFn,
    assertPathWithinRootFn,
    removeProjectFileFn,
    removeEmptyDirFn,
  };

  function registerInstalled(name: string, manifestJson: Record<string, unknown>, content: ContentItem[]): void {
    installedEntries.set(name, {
      name,
      source: `github:acme/${name}@v1`,
      ref: 'v1',
      status: InventoryState.INSTALLED,
      content: JSON.stringify(manifestJson),
    });
    templateContent.set(name, content);
  }

  function seedProjectState(document: ProjectStateDocument): void {
    projectStateContent = JSON.stringify(document);
  }

  function readProjectStateDocument(): ProjectStateDocument {
    return projectStateContent
      ? (JSON.parse(projectStateContent) as ProjectStateDocument)
      : { formatVersion: 1, templates: {}, projectOwnedRoots: [] };
  }

  return {
    deps,
    files,
    templateContent,
    templateHasBundle,
    projectHasBundle,
    registerInstalled,
    seedProjectState,
    readProjectStateDocument,
  };
}

function registeredEntry(origin: string, targets: string[] = []) {
  return { origin, version: '1.0.0', targets };
}

describe('assembleBatch — stateless preview (cpt-frontx-flow-cli-scaffolding-assemble-preview)', () => {
  // inst-asm-return-preview
  it('reports a clean pass and leaves the repository and the project state store byte-identical', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'index.ts', content: 'x' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });
    const filesBefore = new Map(h.files);
    const stateBefore = h.readProjectStateDocument();

    const batch: UniformApplyBatch = { templates: { 'template-a': ['apps/foo'] } };
    const result = await assembleBatch(batch, REPO_ROOT, h.deps, h.deps.readProjectStateFn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toEqual([
      expect.objectContaining({ templateName: 'template-a', target: 'apps/foo' }),
    ]);
    expect(h.files).toEqual(filesBefore);
    expect(h.readProjectStateDocument()).toEqual(stateBefore);
  });

  // inst-asm-if-resolve-fail / inst-asm-return-resolve-fail
  it('refuses TEMPLATE_NOT_REGISTERED for a name with no entry in the project state store', async () => {
    const h = makeHarness();
    const result = await assembleBatch(
      { templates: { missing: ['apps/foo'] } },
      REPO_ROOT,
      h.deps,
      h.deps.readProjectStateFn,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TEMPLATE_NOT_REGISTERED');
  });

  // inst-asm-if-conflict / inst-asm-return-conflict — checked against
  // everything ALREADY APPLIED, read from the project state store.
  it('refuses TARGET_CONFLICT when the batch lands on a target another template already occupies', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), []);
    h.registerInstalled('template-b', manifest('template-b'), []);
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'template-a': registeredEntry('github:acme/template-a@v1', ['apps/foo']),
        'template-b': registeredEntry('github:acme/template-b@v1'),
      },
      projectOwnedRoots: [],
    });

    const result = await assembleBatch(
      { templates: { 'template-b': ['apps/foo'] } },
      REPO_ROOT,
      h.deps,
      h.deps.readProjectStateFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGET_CONFLICT');
    expect(h.files.size).toBe(0);
  });
});

describe('runApplyPipeline — materializing a batch (cpt-frontx-flow-cli-scaffolding-add-template)', () => {
  // inst-add-materialize / inst-add-record / inst-add-return-done
  it('materializes a fresh target, records it, and reports it as applied (never noop)', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'src/index.ts', content: 'hello' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([{ templateName: 'template-a', target: 'apps/foo' }]);
    expect(result.noop).toEqual([]);
    expect(h.files.get('/repo/apps/foo/src/index.ts')).toBe('hello');
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual(['apps/foo']);
  });

  // inst-add-if-recorded-noop / inst-add-noop-target — decided by the
  // target's presence in `targets[]` ALONE, never by reading or diffing
  // on-disk content.
  it('is an idempotent no-op-by-record for a target already recorded under its template, never reading or overwriting its on-disk content', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'src/index.ts', content: 'hello' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1', ['apps/foo']) },
      projectOwnedRoots: [],
    });
    // Deliberately drifted from the payload — proves reconciliation never
    // runs for a recorded target, and this content is never inspected or
    // overwritten.
    h.files.set('/repo/apps/foo/src/index.ts', 'drifted on-disk content');

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([]);
    expect(result.noop).toEqual([{ templateName: 'template-a', target: 'apps/foo' }]);
    expect(h.files.get('/repo/apps/foo/src/index.ts')).toBe('drifted on-disk content');
  });

  // inst-add-existing-content / inst-add-return-existing-conflict
  it('refuses CONTENT_CONFLICT for an unrecorded target whose on-disk content differs from the payload, writing no file', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'src/index.ts', content: 'hello' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });
    h.files.set('/repo/apps/foo/src/index.ts', 'pre-existing different content');

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    expect(h.files.get('/repo/apps/foo/src/index.ts')).toBe('pre-existing different content');
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual([]);
  });

  // inst-add-existing-content / inst-add-return-existing-conflict — the
  // `--adopt-existing` decision.
  it('refuses EXISTING_PATHS_REQUIRE_DECISION for an undeclared on-disk path unless --adopt-existing is given, which leaves it untouched', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'src/index.ts', content: 'hello' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });
    h.files.set('/repo/apps/foo/README.md', 'hand-written notes');

    const refused = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('EXISTING_PATHS_REQUIRE_DECISION');
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual([]);

    const adopted = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, true, h.deps);
    expect(adopted.ok).toBe(true);
    expect(h.files.get('/repo/apps/foo/README.md')).toBe('hand-written notes');
    expect(h.files.get('/repo/apps/foo/src/index.ts')).toBe('hello');
  });

  // A target may legitimately be `.`, the project root.
  it('materializes a target of "." (the project root) correctly', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'package.json', content: '{}' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['.'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    expect(h.files.get('/repo/package.json')).toBe('{}');
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual(['.']);
  });

  // inst-add-materialize-bundle — run ONCE per name gaining its first target
  // across the WHOLE batch, never once per target.
  it('materializes the AI-extension bundle exactly once when a name gains its first target across a multi-target batch', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [
      { path: 'a1/index.ts', content: 'one' },
      { path: 'a2/index.ts', content: 'two' },
    ]);
    h.templateHasBundle.add('template-a');
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline(
      { templates: { 'template-a': ['apps/one', 'apps/two'] } },
      REPO_ROOT,
      false,
      h.deps,
    );

    expect(result.ok).toBe(true);
    expect(h.deps.copyBundleFn).toHaveBeenCalledTimes(1);
    expect(h.projectHasBundle.has('template-a')).toBe(true);
  });

  it('does not re-materialize the bundle for a name that already had a target before this batch', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'index.ts', content: 'x' }]);
    h.templateHasBundle.add('template-a');
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1', ['apps/existing']) },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/new'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    expect(h.deps.copyBundleFn).not.toHaveBeenCalled();
  });

  it('never materializes a bundle the payload does not carry (no-op)', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'index.ts', content: 'x' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    expect(h.deps.copyBundleFn).not.toHaveBeenCalled();
  });

  // inst-add-conflict-check — an undeclared ancestor/descendant nesting
  // against an already-applied target.
  it('refuses TARGET_CONFLICT for an undeclared ancestor/descendant nesting against an already-applied target', async () => {
    const h = makeHarness();
    h.registerInstalled('outer', manifest('outer'), [{ path: 'index.ts', content: 'x' }]);
    h.registerInstalled('inner', manifest('inner'), [{ path: 'index.ts', content: 'y' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        outer: registeredEntry('github:acme/outer@v1', ['apps']),
        inner: registeredEntry('github:acme/inner@v1'),
      },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { inner: ['apps/inner'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGET_CONFLICT');
    expect(h.files.size).toBe(0);
  });

  // The same nesting is accepted when the outer template declares it via
  // `excludedSubtrees`.
  it('accepts the same nesting when the outer template declares the inner target via excludedSubtrees', async () => {
    const h = makeHarness();
    h.registerInstalled('outer', manifest('outer', ['inner/']), [{ path: 'index.ts', content: 'x' }]);
    h.registerInstalled('inner', manifest('inner'), [{ path: 'index.ts', content: 'y' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        outer: registeredEntry('github:acme/outer@v1', ['apps']),
        inner: registeredEntry('github:acme/inner@v1'),
      },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { inner: ['apps/inner'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    expect(h.files.get('/repo/apps/inner/index.ts')).toBe('y');
  });

  // Regression, end to end through the real pipeline — the live-check
  // equivalent of `assembler.test.ts`'s unit-level assertion. Another
  // registered template's local `path:` origin folder physically sits inside
  // the applying target. Before the fix it was inside the applying template's
  // effective ownership, so existing-content reconciliation reported the
  // other template's real files as `additionalPaths` and refused with
  // `EXISTING_PATHS_REQUIRE_DECISION` — over ground `conflict-check.ts`'s own
  // `inst-cc-permit-reverse` calls a permitted subtraction. `--adopt-existing`
  // was the only escape, and a blunt one: it adopts every unrelated stray
  // path in the target too.
  it('applies at a target containing ANOTHER template\'s local origin folder without demanding --adopt-existing, leaving that folder untouched', async () => {
    const h = makeHarness();
    h.registerInstalled('root-template', manifest('root-template'), [{ path: 'root.txt', content: 'from root-template' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'root-template': registeredEntry('github:acme/root-template@v1'),
        // Registered from a local path, but NOT applied anywhere: this test
        // isolates the origin FOLDER as the only reserved ground in play.
        // (An applied target nested under `.` would additionally trip the
        // ordinary undeclared-nesting rule, which is a different, correct
        // refusal and would mask what this test is about.)
        'vendored-template': registeredEntry('path:vendor/vendored-template'),
      },
      projectOwnedRoots: [],
    });
    h.files.set('/repo/vendor/vendored-template/frontx-template.json', JSON.stringify(manifest('vendored-template')));
    h.files.set('/repo/vendor/vendored-template/payload.txt', 'vendored payload');

    // `adoptExisting: false` — the whole point: no blunt escape hatch.
    const result = await runApplyPipeline({ templates: { 'root-template': ['.'] } }, REPO_ROOT, false, h.deps);

    expect(result).toMatchObject({ ok: true, applied: [{ templateName: 'root-template', target: '.' }] });
    expect(h.files.get('/repo/root.txt')).toBe('from root-template');
    // The other template's own ground is byte-identical — never rewritten,
    // never removed, never reported.
    expect(h.files.get('/repo/vendor/vendored-template/frontx-template.json')).toBe(
      JSON.stringify(manifest('vendored-template')),
    );
    expect(h.files.get('/repo/vendor/vendored-template/payload.txt')).toBe('vendored payload');
  });

  // Regression (defect confirmed on a live run): `computePayloadForTarget`
  // used to filter ONLY by effective ownership, which subtracts `.frontx`
  // but not the manifest itself — so `apply` copied the template's own
  // `frontx-template.json` into every target it materialized. A target
  // carrying that file looks like a template directory to this repo's own
  // template discovery (manifest presence). `isTemplatePayloadPath`
  // (`../manifest/types.ts`) is now the one shared formulation both `apply`
  // and `existing-content` reconciliation route through.
  it('never materializes the template\'s own manifest file into a target of "."', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [
      { path: 'src/index.ts', content: 'hello' },
      // The real fs adapter enumerates a template's whole installed
      // content unfiltered, including its own manifest file
      // (`adapters/fs-existing-content.ts`'s `createFsReadInstalledContentFn`)
      // — this fixture reproduces that raw shape rather than presuming the
      // reader already filtered it.
      { path: 'frontx-template.json', content: JSON.stringify(manifest('template-a')) },
    ]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['.'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    expect(h.files.get('/repo/src/index.ts')).toBe('hello');
    expect(h.files.has('/repo/frontx-template.json')).toBe(false);
  });

  // The same regression, for a NON-`.` (nested) target — the hazard the
  // defect brief calls out explicitly: a target named `sub` re-roots the
  // manifest as `sub/frontx-template.json`, which a naive project-relative
  // comparison against the bare `MANIFEST_FILENAME` would never recognize.
  // `isTemplatePayloadPath` is applied to the still-template-relative
  // `item.path`, BEFORE it is joined under the target, so this must hold
  // for a nested target exactly as it does for `.`.
  it('never materializes the template\'s own manifest file into a nested target', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [
      { path: 'src/index.ts', content: 'hello' },
      { path: 'frontx-template.json', content: JSON.stringify(manifest('template-a')) },
    ]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['sub/dir'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(true);
    expect(h.files.get('/repo/sub/dir/src/index.ts')).toBe('hello');
    expect(h.files.has('/repo/sub/dir/frontx-template.json')).toBe(false);
  });

  // Regression: nothing de-duplicated a batch's targets, and the conflict
  // check deliberately no-ops a same-name-same-target pair, so a duplicate
  // reached the record step and was appended to `targets[]` twice — a project
  // state document asserting one target is applied twice, which no sequence
  // of real operations could otherwise produce.
  it('records a target once when the same batch entry names it twice, including under two equivalent spellings', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'index.ts', content: 'x' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    const result = await runApplyPipeline(
      { templates: { 'template-a': ['apps/foo', 'apps/foo'] } },
      REPO_ROOT,
      false,
      h.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toEqual([{ templateName: 'template-a', target: 'apps/foo' }]);
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual(['apps/foo']);
  });

  // `runApplyPipeline` materializes a batch's payload BEFORE the AI-bundle
  // step, which can still refuse — this call never committed anything to
  // the project state store, so every file it wrote is unambiguously its
  // own to remove (`details.writtenPaths` still names what WAS written, but
  // the message says it was removed, and the payload is genuinely gone).
  // The code is `INTERNAL`, not `INVALID_PATH`: an ordinary thrown error
  // (a permission error, a missing source, disk exhaustion) is a real
  // failure to copy the bundle, never itself proof the destination escapes
  // the project root — that narrower diagnosis belongs only to the
  // `PathContainmentError` case covered by the sibling test below.
  it('rolls back the payload, and reports INTERNAL with it removed, when the AI-bundle step throws an ordinary error', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'src/index.ts', content: 'hello' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });
    h.deps.bundleExistsFn = vi.fn(async () => true);
    h.deps.copyBundleFn = vi.fn(async () => {
      throw new Error('simulated bundle copy failure');
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    expect(result.message).toContain('could not be materialized');
    expect(result.message).not.toContain('could not be proven to stay inside the ground the CLI owns');
    expect(result.details?.writtenPaths).toEqual(['apps/foo/src/index.ts']);
    expect(result.message).toContain('apps/foo/src/index.ts');
    expect(result.message).toContain('removed');
    // The heart of the fix: the payload this call wrote is gone, not merely
    // unrecorded.
    expect(h.files.get('/repo/apps/foo/src/index.ts')).toBeUndefined();
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual([]);
  });

  // The sibling case: the bundle copy's OWN fail-closed containment refusal
  // (`PathContainmentError`, thrown by the real `createFsCopyBundleFn` when
  // its destination cannot be proven to stay inside the project root) is
  // the one thrown failure this step still reports as `INVALID_PATH` — the
  // discrimination the generic error case above proves does NOT apply here.
  it('reports INVALID_PATH, not INTERNAL, when the AI-bundle step throws its own PathContainmentError', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'src/index.ts', content: 'hello' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });
    h.deps.bundleExistsFn = vi.fn(async () => true);
    h.deps.copyBundleFn = vi.fn(async () => {
      throw new PathContainmentError('/repo/.frontx/ai/template-a', '/repo');
    });

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_PATH');
    expect(result.message).toContain('could not be proven to stay inside the ground the CLI owns');
    expect(h.files.get('/repo/apps/foo/src/index.ts')).toBeUndefined();
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual([]);
  });

  // BUNDLE-ROLLBACK FIX: a refusal reached AFTER the AI-extension bundle
  // step had ALREADY materialized a bundle for one or more names, but
  // during the LATER project-state record step (a two-name batch, both
  // bundles successfully copied, then the very first `mutateProjectState`
  // write throws — modeling a read-only `.frontx` on a real filesystem),
  // must not roll back only the payload files and leave every bundle this
  // call itself materialized standing: `targets: []` for both names, yet
  // both bundle directories still on disk, which a later `validate
  // --project` would PASS over despite naming nothing in the state
  // document. Both names' bundles must come back out with the payload.
  it('also removes every AI-extension bundle this call materialized when the record step throws before anything committed', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'ta.txt', content: 'a' }]);
    h.registerInstalled('template-b', manifest('template-b'), [{ path: 'tb.txt', content: 'b' }]);
    h.templateHasBundle.add('template-a');
    h.templateHasBundle.add('template-b');
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'template-a': registeredEntry('github:acme/template-a@v1'),
        'template-b': registeredEntry('github:acme/template-b@v1'),
      },
      projectOwnedRoots: [],
    });
    // Models a read-only `.frontx`: every attempt to persist the project
    // state document throws before this call ever commits a single name, so
    // `recordedAnyThisCall` stays false for the whole call — exactly the
    // condition under which a rollback is unconditional.
    h.deps.writeProjectStateFn = vi.fn(async () => {
      throw new Error('simulated EACCES on .frontx/project.json');
    });

    const result = await runApplyPipeline(
      { templates: { 'template-a': ['ta'], 'template-b': ['tb'] } },
      REPO_ROOT,
      false,
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    // Both bundles were actually materialized before the record step threw.
    expect(h.deps.copyBundleFn).toHaveBeenCalledTimes(2);
    // ...and both are gone again after the rollback — the heart of the fix.
    expect(h.projectHasBundle.has('template-a')).toBe(false);
    expect(h.projectHasBundle.has('template-b')).toBe(false);
    expect(h.deps.removeBundleFn).toHaveBeenCalledTimes(2);
    // The payload files are gone too (pre-existing behavior, unaffected).
    expect(h.files.get('/repo/ta/ta.txt')).toBeUndefined();
    expect(h.files.get('/repo/tb/tb.txt')).toBeUndefined();
    // The message is honest about BOTH removals, and `details` names them.
    expect(result.message).toContain('AI-extension bundle');
    expect(result.message).toContain('template-a');
    expect(result.message).toContain('template-b');
    expect(result.details?.bundledNames).toEqual(expect.arrayContaining(['template-a', 'template-b']));
    expect(result.details?.writtenPaths).toEqual(expect.arrayContaining(['ta/ta.txt', 'tb/tb.txt']));
  });

  // The one case a rollback deliberately does NOT run: an earlier name in
  // the SAME batch already committed its targets to the project state store
  // before a LATER name's own record step fails. `recordedAnyThisCall` is
  // true here, so `writtenPaths`/`bundledNamesThisCall` are correctly left
  // standing rather than removed — but the cli-scaffolding FEATURE still
  // promises `details.bundledNames` "regardless of whether the rollback
  // ran", precisely because `seed` (which always deletes the whole project
  // state document on any refusal, committed name or not) reads that exact
  // field to know which bundles are still its own to remove. Reported here
  // by making the SECOND name's own project-state write throw — the two
  // scratch templates a real read-only `.frontx` would produce this from are
  // not reproducible against the built binary at all: both `mutateProjectState`
  // calls in the record loop run back to back with no macrotask-level yield
  // between the first write completing and the second one starting (the real
  // read/write seams are synchronous `fs.*Sync` calls wrapped in `async`
  // functions), so no external process — or even a timer in the same
  // process — can land a permission change in that window. This is the
  // deterministic equivalent: the first name's write genuinely succeeds
  // (`recordedAnyThisCall` becomes true), and the second's throws.
  it('still reports bundledNames — as remaining, not removed — when an earlier name already committed before a later name\'s write throws', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'ta.txt', content: 'a' }]);
    h.registerInstalled('template-b', manifest('template-b'), [{ path: 'tb.txt', content: 'b' }]);
    h.templateHasBundle.add('template-a');
    h.templateHasBundle.add('template-b');
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'template-a': registeredEntry('github:acme/template-a@v1'),
        'template-b': registeredEntry('github:acme/template-b@v1'),
      },
      projectOwnedRoots: [],
    });
    const realWrite = h.deps.writeProjectStateFn;
    let writeCalls = 0;
    h.deps.writeProjectStateFn = vi.fn(async (absolutePath: string, content: string) => {
      writeCalls++;
      if (writeCalls === 1) return realWrite(absolutePath, content);
      throw new Error('simulated EACCES on the second name\'s own record-step write');
    });

    const result = await runApplyPipeline(
      { templates: { 'template-a': ['ta'], 'template-b': ['tb'] } },
      REPO_ROOT,
      false,
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    // Both bundles were materialized before the record loop ever started,
    // and NEITHER is removed — this refusal cannot roll back once a name in
    // this same batch already committed.
    expect(h.deps.removeBundleFn).not.toHaveBeenCalled();
    expect(h.projectHasBundle.has('template-a')).toBe(true);
    expect(h.projectHasBundle.has('template-b')).toBe(true);
    // Exactly one of the two names committed its target; the other did not.
    const committedCount = [
      h.readProjectStateDocument().templates['template-a'].targets.length,
      h.readProjectStateDocument().templates['template-b'].targets.length,
    ].filter((count) => count > 0).length;
    expect(committedCount).toBe(1);
    // The heart of the fix: `bundledNames` names BOTH bundles this call
    // materialized, not only the committed name's — `seed`'s own rollback
    // needs the uncommitted name's bundle named here to clean it up, and the
    // message says plainly that these remain rather than falsely claiming a
    // removal that never ran.
    expect(result.details?.bundledNames).toEqual(expect.arrayContaining(['template-a', 'template-b']));
    expect(result.message).toContain('AI-extension bundle');
    expect(result.message).toContain('remain on disk');
    expect(result.message).not.toContain('have also been removed');
  });

  // The mirror of the throw above, hitting the OTHER broken call site: the
  // second name's own `mutateProjectState` call returns `{ ok: false }`
  // (its OWN read of the just-committed document fails to parse) rather
  // than throwing — the record loop's `!written.ok` branch, not the
  // pipeline's outer `catch`.
  it('still reports bundledNames when an earlier name already committed and a later name\'s own read fails to parse', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'ta.txt', content: 'a' }]);
    h.registerInstalled('template-b', manifest('template-b'), [{ path: 'tb.txt', content: 'b' }]);
    h.templateHasBundle.add('template-a');
    h.templateHasBundle.add('template-b');
    h.seedProjectState({
      formatVersion: 1,
      templates: {
        'template-a': registeredEntry('github:acme/template-a@v1'),
        'template-b': registeredEntry('github:acme/template-b@v1'),
      },
      projectOwnedRoots: [],
    });
    // Two reads succeed genuinely (the pipeline's own initial resolve, then
    // the first name's own `mutateProjectState` read) before the third read
    // — the SECOND name's own `mutateProjectState` read of the document the
    // first name's write just produced — returns unparseable content,
    // exactly as a document a concurrent writer corrupted underneath this
    // call would.
    const realRead = h.deps.readProjectStateFn;
    let readCalls = 0;
    h.deps.readProjectStateFn = vi.fn(async (absolutePath: string) => {
      readCalls++;
      return readCalls <= 2 ? realRead(absolutePath) : 'not valid json {{{';
    });

    const result = await runApplyPipeline(
      { templates: { 'template-a': ['ta'], 'template-b': ['tb'] } },
      REPO_ROOT,
      false,
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PROJECT_INVALID');
    expect(h.deps.removeBundleFn).not.toHaveBeenCalled();
    expect(h.projectHasBundle.has('template-a')).toBe(true);
    expect(h.projectHasBundle.has('template-b')).toBe(true);
    expect(result.details?.bundledNames).toEqual(expect.arrayContaining(['template-a', 'template-b']));
    expect(result.message).toContain('AI-extension bundle');
    expect(result.message).toContain('remain on disk');
  });

  // The mirror case, run BACKWARDS per the review's own instruction: a batch
  // that adds a SECOND target to a name that already had one (and therefore
  // already has a bundle from an earlier call) must NOT have that
  // pre-existing bundle swept up by a later rollback — its bundle predates
  // this call, so this call never added it to `bundledNamesThisCall` in the
  // first place (the bundle loop's own `targetsBefore > 0` skip), and the
  // rollback must never reach for it.
  it('never removes a name\'s pre-existing bundle when a later batch adding its SECOND target fails', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'index.ts', content: 'x' }]);
    h.templateHasBundle.add('template-a');
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });

    // First call: ordinary success, materializes the bundle for template-a's
    // FIRST target.
    const first = await runApplyPipeline({ templates: { 'template-a': ['apps/one'] } }, REPO_ROOT, false, h.deps);
    expect(first.ok).toBe(true);
    expect(h.projectHasBundle.has('template-a')).toBe(true);
    vi.mocked(h.deps.copyBundleFn).mockClear();
    vi.mocked(h.deps.removeBundleFn).mockClear();

    // Second call: adds a SECOND target to the SAME name, then fails during
    // the record step (the bundle loop never runs for template-a at all this
    // time, since `targetsBefore > 0`).
    h.deps.writeProjectStateFn = vi.fn(async () => {
      throw new Error('simulated EACCES on .frontx/project.json');
    });
    const second = await runApplyPipeline({ templates: { 'template-a': ['apps/two'] } }, REPO_ROOT, false, h.deps);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    // The bundle copy step never even ran for this call (no first-target
    // transition to react to), and the pre-existing bundle is untouched.
    expect(h.deps.copyBundleFn).not.toHaveBeenCalled();
    expect(h.deps.removeBundleFn).not.toHaveBeenCalled();
    expect(h.projectHasBundle.has('template-a')).toBe(true);
    // The message never claims a bundle was removed — none was.
    expect(second.message).not.toContain('AI-extension bundle');
    expect(second.details?.bundledNames).toBeUndefined();
  });

  // ORDERING FIX: a payload path that cannot be proven to stay inside the
  // project root must be checked BEFORE existing-content reconciliation's
  // own `contentConflicts` refusal — checking it after would let an
  // escaping path that reconciliation ALSO happens to flag (its own symlink
  // test cannot tell an escape apart from an ordinary internal symlink) be
  // reported as `CONTENT_CONFLICT` instead of `INVALID_PATH`, the wrong
  // remedy for the actual problem. This fixture does not need a real
  // symlink to prove the ORDERING: the same path is made to fail BOTH
  // checks at once (existing content that genuinely differs, modeling
  // reconciliation's own refusal cause; and `assertPathWithinRootFn`
  // throwing for that exact absolute path, modeling a containment escape)
  // — whichever code wins the race is the one reported, and it must be
  // `INVALID_PATH`.
  it('reports INVALID_PATH ahead of CONTENT_CONFLICT for a path that fails both checks at once', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'file.txt', content: 'FROM-TEMPLATE' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });
    // Existing content genuinely differs — reconciliation's OWN reason to
    // refuse this path with CONTENT_CONFLICT, were containment not checked
    // first.
    h.files.set('/repo/apps/foo/file.txt', 'DIFFERENT-ON-DISK');
    // ...and the identical path also fails containment.
    h.deps.assertPathWithinRootFn = (absolutePath: string) => {
      if (absolutePath === '/repo/apps/foo/file.txt') throw new Error('simulated escape');
    };

    const result = await runApplyPipeline({ templates: { 'template-a': ['apps/foo'] } }, REPO_ROOT, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_PATH');
    expect(result.details).toEqual({ paths: ['apps/foo/file.txt'] });
  });

  // `--adopt-existing`'s own contract is to leave an undeclared on-disk
  // path untouched, but a DECLARED payload path that is
  // itself a pre-existing symlink is invisible to existing-content
  // reconciliation (`adapters/fs-existing-content.ts` reports neither
  // `isFile()` nor `isDirectory()` for a symlink dirent) — writing it
  // follows the symlink and can silently overwrite whatever it aliases,
  // including a path this SAME batch just adopted. This fake models
  // exactly that blind spot (`readExistingContentFn` below reports nothing
  // at the symlinked payload path, exactly as the real adapter would), and
  // `writeFileFn` models the write actually landing on the aliased path —
  // proving `runApplyPipeline` detects the corruption after the fact and
  // refuses, rather than reporting success over content it silently
  // altered.
  it('refuses CONTENT_CONFLICT when materializing a batch alters a path --adopt-existing had just adopted', async () => {
    const h = makeHarness();
    h.registerInstalled('template-a', manifest('template-a'), [{ path: 'alias.txt', content: 'FROM-TEMPLATE' }]);
    h.seedProjectState({
      formatVersion: 1,
      templates: { 'template-a': registeredEntry('github:acme/template-a@v1') },
      projectOwnedRoots: [],
    });
    // The adopted file, pre-existing under a DIFFERENT target.
    h.files.set('/repo/shared/precious.txt', 'PRECIOUS');
    // `linked/alias.txt` is a symlink aliasing `shared/precious.txt` on a
    // real filesystem — this fake's own `readExistingContentFn` (a plain
    // prefix scan over `files`) already reports nothing under `linked/` at
    // all, faithfully matching the real adapter's blind spot for that
    // shape without needing an actual symlink; `writeFileFn` is overridden
    // for JUST this test to model the write physically landing on the
    // aliased path, exactly as `fs.writeFileSync` would through a real one.
    const realWriteFileFn = h.deps.writeFileFn;
    h.deps.writeFileFn = async (destPath, content) => {
      if (destPath === '/repo/linked/alias.txt') {
        await realWriteFileFn('/repo/shared/precious.txt', content);
        return;
      }
      await realWriteFileFn(destPath, content);
    };

    const result = await runApplyPipeline(
      { templates: { 'template-a': ['shared', 'linked'] } },
      REPO_ROOT,
      true,
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    expect(result.details?.paths).toEqual(['shared/precious.txt']);
    // Nothing was recorded as applied — the corruption is caught before
    // the record step, even though the writes themselves already happened.
    expect(h.readProjectStateDocument().templates['template-a'].targets).toEqual([]);
  });
});

describe('seedRepository — bootstrap a fresh project (cpt-frontx-flow-cli-scaffolding-seed-repository)', () => {
  // inst-seed-if-already-seeded / inst-seed-return-already-seeded
  it('refuses INVALID_INPUT when the directory already carries a project state document', async () => {
    const h = makeHarness();
    h.seedProjectState({ formatVersion: 1, templates: {}, projectOwnedRoots: [] });

    const result = await seedRepository(REPO_ROOT, { templates: {} }, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });

  // inst-seed-foreach-default's own error scenario: a non-default name.
  // This refusal is a pre-flight check, before `.frontx/project.json` is
  // ever created — so a directory refused this way is left exactly as it
  // was found, never locked out of a later `seed` call by a document this
  // same refusal wrote.
  it('refuses TEMPLATE_NOT_REGISTERED for a batch entry that is not one of the CLI\'s official default templates, writing nothing', async () => {
    const h = makeHarness();

    const result = await seedRepository(REPO_ROOT, { templates: { 'not-a-default': ['.'] } }, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TEMPLATE_NOT_REGISTERED');
    expect(await h.deps.readProjectStateFn(projectStatePath(REPO_ROOT))).toBeNull();
  });

  // `seed` must not create `.frontx/project.json` BEFORE resolving any
  // batch entry: if a default cannot actually be resolved (e.g. its local
  // origin folder cannot be proven to exist), creating the document early
  // would leave an empty one behind — and `seed`'s own already-seeded guard
  // would then permanently refuse the very directory the aborted seed was
  // supposed to leave untouched. Resolving every named default BEFORE the
  // first write means this failure leaves nothing behind and a later
  // `seed` call on the same directory is accepted.
  it('leaves no .frontx/project.json when a batch entry names an official default that cannot be resolved, and accepts a later seed', async () => {
    const h = makeHarness();
    h.deps.existsFn = vi.fn(async () => false);

    const result = await seedRepository(
      REPO_ROOT,
      { templates: { '@gears-frontx/frontx-template-shell': ['.'] } },
      false,
      h.deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(await h.deps.readProjectStateFn(projectStatePath(REPO_ROOT))).toBeNull();

    const secondAttempt = await seedRepository(REPO_ROOT, { templates: {} }, false, h.deps);
    expect(secondAttempt.ok).toBe(true);
  });

  // inst-seed-create-project-state — created UNCONDITIONALLY, even for a
  // batch naming nothing to register or apply.
  it('creates the initial project state document even for an empty batch', async () => {
    const h = makeHarness();

    const result = await seedRepository(REPO_ROOT, { templates: {} }, false, h.deps);

    expect(result.ok).toBe(true);
    expect(h.readProjectStateDocument()).toEqual({ formatVersion: 1, templates: {}, projectOwnedRoots: [] });
  });

  // inst-seed-register-default / inst-seed-resolve..inst-seed-return-done —
  // auto-registers the official default THROUGH the register algorithm,
  // then applies it through the IDENTICAL mechanism `apply` uses
  // (`runApplyPipeline`, called directly above by `apply`'s own tests) —
  // proving the sharing rather than duplicating every materialization edge
  // case a second time.
  it('auto-registers a fresh official default template and applies it, in one call', async () => {
    const h = makeHarness();
    h.deps.readFileFn = vi.fn(async (filePath: string) => {
      if (filePath.endsWith('template-shell/frontx-template.json')) {
        return JSON.stringify(manifest('@gears-frontx/frontx-template-shell'));
      }
      throw new Error(`unexpected readFileFn path: ${filePath}`);
    });
    h.templateContent.set(`${REPO_ROOT}/template-shell`, [{ path: 'package.json', content: '{}' }]);

    const result = await seedRepository(
      REPO_ROOT,
      { templates: { '@gears-frontx/frontx-template-shell': ['.'] } },
      false,
      h.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registeredDefaults).toEqual(['@gears-frontx/frontx-template-shell']);
    expect(result.applied).toEqual([{ templateName: '@gears-frontx/frontx-template-shell', target: '.' }]);
    const document = h.readProjectStateDocument();
    expect(document.templates['@gears-frontx/frontx-template-shell']).toMatchObject({
      origin: 'path:template-shell',
      targets: ['.'],
    });
    expect(h.files.get('/repo/package.json')).toBe('{}');
  });

  // Proves seed shares apply's own reconciliation — the identical refusal
  // `apply` itself produces for the same on-disk situation, rather than a
  // second, independently-formulated seed-only check.
  //
  // This refusal is reached AFTER `seed` has already written
  // `.frontx/project.json` and registered the default — `runApplyPipeline`
  // itself refuses before writing any payload file, but the state document
  // `seed` wrote earlier must not survive the refusal, or it would
  // permanently lock the directory out of a later `seed` call. Rollback
  // undoes that write on this exact path too.
  it('refuses CONTENT_CONFLICT for a batch target whose on-disk content already differs from the payload, exactly as apply does — and rolls back, leaving the directory seedable again', async () => {
    const h = makeHarness();
    h.deps.readFileFn = vi.fn(async () => JSON.stringify(manifest('@gears-frontx/frontx-template-shell')));
    h.templateContent.set(`${REPO_ROOT}/template-shell`, [{ path: 'package.json', content: '{}' }]);
    h.files.set('/repo/package.json', 'not what the template would write');

    const batch: UniformApplyBatch = { templates: { '@gears-frontx/frontx-template-shell': ['.'] } };
    const result = await seedRepository(REPO_ROOT, batch, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    // No project state document, and no registered template, survives the
    // refusal...
    expect(await h.deps.readProjectStateFn(projectStatePath(REPO_ROOT))).toBeNull();

    // ...so a second seed against the identical (still-conflicting)
    // directory is refused with the SAME CONTENT_CONFLICT again, never
    // INVALID_INPUT ("already seeded") — proving the first call's own state
    // write did not survive its own refusal.
    const secondAttempt = await seedRepository(REPO_ROOT, batch, false, h.deps);
    expect(secondAttempt.ok).toBe(false);
    if (secondAttempt.ok) return;
    expect(secondAttempt.code).toBe('CONTENT_CONFLICT');
  });

  // Unlike the refusal above, the AI-bundle step refuses AFTER
  // `runApplyPipeline` already materializes the batch's payload — so
  // `apply`'s own outcome carries `details.writtenPaths` naming a REAL file
  // still on disk. `seed`'s rollback must not undo only its own two writes
  // (the state document and the `.frontx` directory it created): it
  // removes exactly the paths `apply` named too, so a late refusal leaves
  // the directory exactly as empty as an early one, and a second seed is
  // accepted.
  it('rolls back a payload file apply already materialized when the apply phase refuses late, leaving the directory seedable again', async () => {
    const h = makeHarness();
    h.deps.readFileFn = vi.fn(async () => JSON.stringify(manifest('@gears-frontx/frontx-template-shell')));
    h.templateContent.set(`${REPO_ROOT}/template-shell`, [{ path: 'package.json', content: '{}' }]);
    h.deps.bundleExistsFn = vi.fn(async () => true);
    h.deps.copyBundleFn = vi.fn(async () => {
      throw new Error('simulated bundle copy failure');
    });

    const batch: UniformApplyBatch = { templates: { '@gears-frontx/frontx-template-shell': ['.'] } };
    const result = await seedRepository(REPO_ROOT, batch, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The payload apply materialized is gone — rolled back, not merely
    // unrecorded — and so is the state document apply's own failure never
    // wrote to (seed's OWN pre-apply write, from BEFORE this call).
    expect(h.files.has('/repo/package.json')).toBe(false);
    expect(await h.deps.readProjectStateFn(projectStatePath(REPO_ROOT))).toBeNull();
    // The report is honest about what happened: the CURRENT truth (rolled
    // back, nothing remains) leads the message, rather than restating
    // apply's own now-stale "still on disk" claim as though it were still
    // true — and `writtenPaths` itself is dropped, since nothing it names
    // is still on disk.
    expect(result.message.startsWith('Seed has rolled back everything this attempt wrote')).toBe(true);
    expect(result.details?.writtenPaths).toBeUndefined();

    const secondAttempt = await seedRepository(REPO_ROOT, { templates: {} }, false, h.deps);
    expect(secondAttempt.ok).toBe(true);
  });

  // `seed` needs a `try`/`catch` around `runApplyPipeline`: without one, a
  // thrown failure (EACCES, ENOSPC, a native abort) would bypass rollback
  // entirely, propagating out of `seedRepository` itself with the state
  // document (and any directory it created) left behind, permanently
  // locking the directory out of a later `seed`. This throws from the
  // batch's own existing-content reconciliation — a step `apply.ts` does
  // NOT wrap in its own try (that only covers materialize-onward, see that
  // file's own comment), so it genuinely escapes `runApplyPipeline`
  // uncaught and reaches `seedRepository`'s own `try`/`catch`, which
  // returns a structured refusal instead of throwing, and rolls back
  // exactly as it does for a returned refusal.
  it('rolls back and returns a structured refusal, never throwing, when the apply phase throws', async () => {
    const h = makeHarness();
    h.deps.readFileFn = vi.fn(async () => JSON.stringify(manifest('@gears-frontx/frontx-template-shell')));
    h.deps.readInstalledContentFn = vi.fn(async () => {
      throw new Error('EACCES: permission denied');
    });

    const batch: UniformApplyBatch = { templates: { '@gears-frontx/frontx-template-shell': ['.'] } };
    const result = await seedRepository(REPO_ROOT, batch, false, h.deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL');
    expect(result.message).toContain('EACCES');
    expect(await h.deps.readProjectStateFn(projectStatePath(REPO_ROOT))).toBeNull();

    const secondAttempt = await seedRepository(REPO_ROOT, { templates: {} }, false, h.deps);
    expect(secondAttempt.ok).toBe(true);
  });
});
