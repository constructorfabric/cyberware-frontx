// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
// @cpt-algo:cpt-frontx-algo-composed-provenance-unregister:p1
//
// Real-filesystem coverage for two defects in how a deletion plan resolves
// a registered name's declared `excludedSubtrees`:
//
//   DEFECT 1 (MED-HIGH) — "the current manifest wins" mirrors the hazard it
//   fixed. An EARLIER round made the RECORDED value win unconditionally,
//   which let a vanished origin's stale record widen a plan. The round that
//   fixed THAT made the CURRENT manifest win instead, which opened the
//   OPPOSITE hazard: narrowing the vendored manifest after `apply` let
//   `delete` un-protect ground the RECORDED declaration protected when the
//   template was applied. Reproduced live:
//
//     register with `excludedSubtrees: ["userland/"]`, apply at `.`,
//     developer creates `userland/mine.txt`
//     => delete . --dry-run: toPreserve [..."userland/"...]  (protected)
//     developer NARROWS the vendored manifest to `excludedSubtrees: []`
//     => delete . --dry-run: toDelete ["a.txt","userland/mine.txt"]
//     (and `--yes` removes it) — the recorded value is still ["userland/"]
//
//   The fix: a deletion plan resolves the declared exclusions as the UNION
//   of the RECORDED declaration and the CURRENT manifest's, in both
//   directions, and SIGNALS the drift on the plan's own reported shape
//   whenever the two sources disagree.
//
//   DEFECT 2 (MED-HIGH) — a legacy entry whose origin is gone has no way
//   out. An entry recorded before `excludedSubtrees` existed, whose origin
//   folder has since been removed, was a closed loop: `delete` refuses
//   naming `register --replace` as the remedy, but that command also
//   refuses (`INVALID_PATH`) because the origin is gone, `upgrade` refuses
//   resolving the OLD origin, `upgrade --restore` has nothing to restore,
//   and `unregister` refused `TARGETS_EXIST`, sending the developer back to
//   `delete`. The fix: `unregister` drops an entry in this ONE verified
//   state — its origin confirmed unresolvable AND no `excludedSubtrees`
//   ever recorded, so no target of its can ever yield a computable deletion
//   plan — leaving every file on disk untouched and the registration alone
//   forgotten. `delete`'s own refusal then names `unregister`, not
//   `register --replace`, as the remedy for exactly this state.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { computeDeletionPlan } from '../scaffold/delete-plan';
import type { DeletePlanInventoryPort } from '../scaffold/delete-plan';
import { deleteTarget } from '../commands/delete';
import { unregisterTemplate } from '../commands/unregister';
import type { UnregisterOriginResolveDeps } from '../commands/unregister';
import type { ProjectStateDocument } from '../project-state/types';
import {
  createFsCanonicalizeTargetFn,
  createFsReadFileFn,
  createFsListTargetFilesFn,
  createFsListUnenumerableTargetEntriesFn,
  createFsRemoveProjectFileFn,
  createFsAssertPathWithinRootFn,
  createFsReadProjectStateFn,
  createFsWriteProjectStateFn,
} from '../adapters/fs-project-io';
import { makeFifo, fifosAvailable } from './support/fifo';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});


function manifestJson(name: string, excludedSubtrees: string[]): Record<string, unknown> {
  return { name, version: '1.0.0', excludedSubtrees, description: `Fixture template "${name}"` };
}

async function writeProjectState(repoRoot: string, document: ProjectStateDocument): Promise<void> {
  await mkdir(path.join(repoRoot, '.frontx'), { recursive: true });
  await writeFile(path.join(repoRoot, '.frontx', 'project.json'), JSON.stringify(document), 'utf-8');
}

const noInventory: DeletePlanInventoryPort = { lookup: () => undefined };

function realDeleteDeps(repoRoot: string) {
  return {
    canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
    listTargetFilesFn: createFsListTargetFilesFn(),
    listUnenumerableTargetEntriesFn: createFsListUnenumerableTargetEntriesFn(),
    readFileFn: createFsReadFileFn(),
    removeFileFn: createFsRemoveProjectFileFn(),
    assertPathWithinRootFn: createFsAssertPathWithinRootFn(repoRoot),
    readProjectStateFn: createFsReadProjectStateFn(),
    writeProjectStateFn: createFsWriteProjectStateFn(),
  };
}

function realUnregisterResolveDeps(repoRoot: string): UnregisterOriginResolveDeps {
  return {
    repoRoot,
    inventory: noInventory,
    readFileFn: createFsReadFileFn(),
    canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
  };
}

const neverConfirm = async (): Promise<'confirmed' | 'declined'> => {
  throw new Error('confirmDeletionFn must not be called in --json mode');
};

describe('delete-plan\'s union of RECORDED and CURRENT excludedSubtrees (real filesystem)', () => {
  it('a narrowed manifest cannot un-protect ground the recorded declaration already protected, and reports the drift', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-union-narrow-'));

    await mkdir(path.join(root, 'vendor-a'), { recursive: true });
    await mkdir(path.join(root, 'userland'), { recursive: true });
    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 'userland', 'mine.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
    await writeFile(path.join(root, 'vendor-a', 'index.ts'), 'export const a = 1;', 'utf-8');

    // Registered and applied with `userland/` declared and RECORDED.
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/a': { origin: 'path:vendor-a', version: '1.0.0', targets: ['.'], excludedSubtrees: ['userland/'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    // The developer NARROWS the vendored manifest after apply.
    await writeFile(path.join(root, 'vendor-a', 'frontx-template.json'), JSON.stringify(manifestJson('@x/a', [])), 'utf-8');

    const deps = realDeleteDeps(root);
    const dryRun = await deleteTarget(
      '.',
      root,
      { jsonMode: true, dryRun: true, yes: false },
      noInventory,
      deps.canonicalizeFn,
      deps.listTargetFilesFn,
      deps.listUnenumerableTargetEntriesFn,
      deps.readFileFn,
      deps.removeFileFn,
      deps.assertPathWithinRootFn,
      deps.readProjectStateFn,
      deps.writeProjectStateFn,
      neverConfirm,
    );
    expect(dryRun).toMatchObject({ ok: true, outcome: 'dry-run' });
    if (!dryRun.ok) return;
    expect(dryRun.toDelete).toEqual(['a.txt']);
    expect(dryRun.toPreserve).toContain('userland/');
    expect(dryRun.exclusionsDrift).toEqual({ current: [], recorded: ['userland/'] });

    // `--yes` actually deletes: the developer's file, protected by the union,
    // survives.
    const deleted = await deleteTarget(
      '.',
      root,
      { jsonMode: true, dryRun: false, yes: true },
      noInventory,
      deps.canonicalizeFn,
      deps.listTargetFilesFn,
      deps.listUnenumerableTargetEntriesFn,
      deps.readFileFn,
      deps.removeFileFn,
      deps.assertPathWithinRootFn,
      deps.readProjectStateFn,
      deps.writeProjectStateFn,
      neverConfirm,
    );
    expect(deleted).toMatchObject({ ok: true, outcome: 'deleted' });

    const survived = await readFile(path.join(root, 'userland', 'mine.txt'), 'utf-8');
    expect(survived).toBe('DEVELOPER-OWNED — must survive');
    await expect(readFile(path.join(root, 'a.txt'), 'utf-8')).rejects.toThrow();
  });

  it('a widened manifest is honoured too — the union works in both directions', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-union-widen-'));

    await mkdir(path.join(root, 'vendor-b'), { recursive: true });
    await mkdir(path.join(root, 'extra'), { recursive: true });
    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 'extra', 'note.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
    await writeFile(path.join(root, 'vendor-b', 'index.ts'), 'export const b = 1;', 'utf-8');

    // Registered with an explicitly EMPTY recorded declaration.
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/b': { origin: 'path:vendor-b', version: '1.0.0', targets: ['.'], excludedSubtrees: [] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    // The developer WIDENS the vendored manifest after apply.
    await writeFile(path.join(root, 'vendor-b', 'frontx-template.json'), JSON.stringify(manifestJson('@x/b', ['extra/'])), 'utf-8');

    const canonicalizeFn = createFsCanonicalizeTargetFn(root);
    const plan = await computeDeletionPlan(
      '.',
      root,
      document,
      noInventory,
      canonicalizeFn,
      createFsListTargetFilesFn(),
      createFsReadFileFn(),
      createFsListUnenumerableTargetEntriesFn(),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toDelete).toEqual(['a.txt']);
    expect(plan.toPreserve).toContain('extra/');
    expect(plan.exclusionsDrift).toEqual({ current: ['extra/'], recorded: [] });
  });

  it('reports no drift when the two sources agree', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-union-agree-'));

    await mkdir(path.join(root, 'vendor-c'), { recursive: true });
    await mkdir(path.join(root, 'shared'), { recursive: true });
    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 'shared', 'keep.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
    await writeFile(path.join(root, 'vendor-c', 'index.ts'), 'export const c = 1;', 'utf-8');
    await writeFile(path.join(root, 'vendor-c', 'frontx-template.json'), JSON.stringify(manifestJson('@x/c', ['shared/'])), 'utf-8');

    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/c': { origin: 'path:vendor-c', version: '1.0.0', targets: ['.'], excludedSubtrees: ['shared/'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const canonicalizeFn = createFsCanonicalizeTargetFn(root);
    const plan = await computeDeletionPlan(
      '.',
      root,
      document,
      noInventory,
      canonicalizeFn,
      createFsListTargetFilesFn(),
      createFsReadFileFn(),
      createFsListUnenumerableTargetEntriesFn(),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toDelete).toEqual(['a.txt']);
    expect(plan.toPreserve).toContain('shared/');
    expect(plan.exclusionsDrift).toBeUndefined();
  });

  it('a vanished origin still honours the recorded declaration alone, with no widening beyond it', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-union-vanished-'));

    await mkdir(path.join(root, 'protected'), { recursive: true });
    await mkdir(path.join(root, 'extra'), { recursive: true });
    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 'protected', 'keep.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
    // Never declared by any source: this file is NOT protected, proving the
    // absent origin does not widen the plan beyond the recorded value.
    await writeFile(path.join(root, 'extra', 'should-be-deleted.txt'), 'undeclared ground', 'utf-8');
    // Deliberately no `vendor-d/` folder at all on disk.

    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/d': { origin: 'path:vendor-d', version: '1.0.0', targets: ['.'], excludedSubtrees: ['protected/'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const canonicalizeFn = createFsCanonicalizeTargetFn(root);
    const plan = await computeDeletionPlan(
      '.',
      root,
      document,
      noInventory,
      canonicalizeFn,
      createFsListTargetFilesFn(),
      createFsReadFileFn(),
      createFsListUnenumerableTargetEntriesFn(),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toPreserve).toContain('protected/');
    expect(plan.toDelete).toContain('extra/should-be-deleted.txt');
    expect(plan.exclusionsDrift).toBeUndefined();
  });
});

describe('unregister\'s escape for an unusable orphan entry (real filesystem)', () => {
  it('closes the legacy loop: delete refuses naming unregister, and unregister then drops the entry leaving every file untouched', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-orphan-escape-'));

    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');
    // Deliberately no `vendor-e/` folder at all, and no `excludedSubtrees`
    // ever recorded — a legacy entry from before that field existed, whose
    // origin has since vanished entirely.
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/e': { origin: 'path:vendor-e', version: '1.0.0', targets: ['.'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const deps = realDeleteDeps(root);

    // Step 1: `delete .` refuses, naming `unregister` as the remedy — not
    // `register --replace`, which cannot succeed against a gone origin.
    const firstDelete = await deleteTarget(
      '.',
      root,
      { jsonMode: true, dryRun: true, yes: false },
      noInventory,
      deps.canonicalizeFn,
      deps.listTargetFilesFn,
      deps.listUnenumerableTargetEntriesFn,
      deps.readFileFn,
      deps.removeFileFn,
      deps.assertPathWithinRootFn,
      deps.readProjectStateFn,
      deps.writeProjectStateFn,
      neverConfirm,
    );
    expect(firstDelete).toMatchObject({ ok: false, code: 'CONTENT_CONFLICT' });
    if (!firstDelete.ok) {
      expect(firstDelete.message).toContain('unregister @x/e');
    }

    // Step 2: `unregister @x/e` follows that remedy and succeeds — the loop
    // is closed. Every file on disk is untouched, and the entry is gone.
    const unregistered = await unregisterTemplate(
      '@x/e',
      root,
      deps.readProjectStateFn,
      deps.writeProjectStateFn,
      realUnregisterResolveDeps(root),
    );
    expect(unregistered).toEqual({ ok: true, name: '@x/e', outcome: 'orphan-dropped', orphanedTargets: ['.'] });

    const survived = await readFile(path.join(root, 'a.txt'), 'utf-8');
    expect(survived).toBe('template-owned');

    const stateAfter = JSON.parse(await readFile(path.join(root, '.frontx', 'project.json'), 'utf-8')) as ProjectStateDocument;
    expect(stateAfter.templates['@x/e']).toBeUndefined();
  });

  it('still refuses TARGETS_EXIST for a name whose origin resolves normally', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-orphan-live-origin-'));

    await mkdir(path.join(root, 'vendor-f'), { recursive: true });
    await writeFile(path.join(root, 'vendor-f', 'index.ts'), 'export const f = 1;', 'utf-8');
    await writeFile(path.join(root, 'vendor-f', 'frontx-template.json'), JSON.stringify(manifestJson('@x/f', [])), 'utf-8');
    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');

    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/f': { origin: 'path:vendor-f', version: '1.0.0', targets: ['.'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const deps = realDeleteDeps(root);
    const result = await unregisterTemplate(
      '@x/f',
      root,
      deps.readProjectStateFn,
      deps.writeProjectStateFn,
      realUnregisterResolveDeps(root),
    );
    expect(result).toMatchObject({ ok: false, code: 'TARGETS_EXIST', details: { name: '@x/f', targets: ['.'] } });

    const stateAfter = JSON.parse(await readFile(path.join(root, '.frontx', 'project.json'), 'utf-8')) as ProjectStateDocument;
    expect(stateAfter.templates['@x/f']).toBeDefined();
  });

  it.skipIf(!fifosAvailable())('still refuses TARGETS_EXIST for a name whose manifest is merely unreadable (a FIFO), never treating that as the orphan state', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-orphan-fifo-'));

    await mkdir(path.join(root, 'vendor-g'), { recursive: true });
    makeFifo(path.join(root, 'vendor-g', 'frontx-template.json'));
    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');

    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/g': { origin: 'path:vendor-g', version: '1.0.0', targets: ['.'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const deps = realDeleteDeps(root);
    const result = await unregisterTemplate(
      '@x/g',
      root,
      deps.readProjectStateFn,
      deps.writeProjectStateFn,
      realUnregisterResolveDeps(root),
    );
    expect(result).toMatchObject({ ok: false, code: 'TARGETS_EXIST', details: { name: '@x/g', targets: ['.'] } });

    const stateAfter = JSON.parse(await readFile(path.join(root, '.frontx', 'project.json'), 'utf-8')) as ProjectStateDocument;
    expect(stateAfter.templates['@x/g']).toBeDefined();
  });
});
