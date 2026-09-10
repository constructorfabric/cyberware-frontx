// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1
//
// Real-filesystem coverage for two, now-superseded, defects in how `delete`
// resolves a registered name's declared `excludedSubtrees`:
//
//   - An EARLIER round made the RECORDED value win unconditionally, so a
//     developer who edited the vendored manifest after registration watched
//     `delete` honour the STALE recorded list while `assemble` (which always
//     reads the CURRENT manifest) read the edited one — a file the CURRENT
//     manifest declared protected was deleted on the strength of that
//     disagreement.
//   - The round that fixed THAT made the CURRENT manifest win instead,
//     which mirrored the identical hazard in the other direction: NARROWING
//     the vendored manifest after `apply` (`excludedSubtrees: ["userland/"]`
//     down to `["other/"]`) let `delete` sweep a developer's OWN
//     `userland/`-protected file into `toDelete`, since the stale RECORDED
//     protection was simply discarded rather than honoured.
//
// This suite pins the fix current at HEAD: `delete`'s own plan resolves the
// declared exclusions as the UNION of the CURRENT manifest and the RECORDED
// value, so narrowing the manifest can never un-protect ground the recorded
// declaration already protected, while `assemble` (unaffected by this fix,
// by design — it materializes what the manifest says TODAY, a different
// question) still reads the CURRENT manifest alone and reports the drift
// between the two sources on the plan itself.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeDeletionPlan } from '../scaffold/delete-plan';
import type { DeletePlanInventoryPort } from '../scaffold/delete-plan';
import { resolveAndCheckBatch } from '../commands/apply';
import type { ResolveAndCheckDeps } from '../commands/apply';
import type { UniformApplyInventoryPort } from '../scaffold/assembler';
import type { ProjectStateDocument, ReadProjectStateFn } from '../project-state/types';
import {
  createFsCanonicalizeTargetFn,
  createFsPathExistsFn,
  createFsReadFileFn,
  createFsListTargetFilesFn,
  createFsListUnenumerableTargetEntriesFn,
} from '../adapters/fs-project-io';
import { createFsListDiskFilesFn } from '../adapters/fs-upgrade-io';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

function manifest(name: string, excludedSubtrees: string[]): Record<string, unknown> {
  return { name, version: '1.0.0', excludedSubtrees, description: `Fixture template "${name}"` };
}

async function writeProjectState(repoRoot: string, document: ProjectStateDocument): Promise<void> {
  await mkdir(path.join(repoRoot, '.frontx'), { recursive: true });
  await writeFile(path.join(repoRoot, '.frontx', 'project.json'), JSON.stringify(document), 'utf-8');
}

const noInventory: DeletePlanInventoryPort & UniformApplyInventoryPort = {
  lookup: () => undefined,
  install: vi.fn(async () => ({
    ok: false as const,
    error: { code: 'ORIGIN_UNAVAILABLE' as const, message: 'install not stubbed for this test' },
  })),
};

describe('delete and assemble agreeing on an edited manifest\'s declared excludedSubtrees (real filesystem)', () => {
  it('unions the CURRENT manifest\'s declared ground with the RECORDED one in a computed deletion plan, while a staged assemble batch still reads the CURRENT manifest alone', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-edited-manifest-agree-'));

    await mkdir(path.join(root, 'vendor-a'), { recursive: true });
    await mkdir(path.join(root, 't', 'userland'), { recursive: true });
    await mkdir(path.join(root, 't', 'other'), { recursive: true });
    await writeFile(path.join(root, 'vendor-a', 'index.ts'), 'export const a = 1;', 'utf-8');
    await writeFile(path.join(root, 't', 'a.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 't', 'userland', 'mine.txt'), 'no longer declared excluded', 'utf-8');
    await writeFile(path.join(root, 't', 'other', 'o.txt'), 'CURRENTLY DECLARED EXCLUDED — must survive', 'utf-8');

    // Registered with `userland/` declared and RECORDED — mirrors the state
    // a real `register` + `apply` would have left.
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: {
        '@x/a': { origin: 'path:vendor-a', version: '1.0.0', targets: ['t'], excludedSubtrees: ['userland/'] },
      },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    // The developer edits the vendored manifest directly, after
    // registration: the CURRENT declaration now excludes `other/` instead.
    await writeFile(
      path.join(root, 'vendor-a', 'frontx-template.json'),
      JSON.stringify(manifest('@x/a', ['other/'])),
      'utf-8',
    );

    const canonicalizeFn = createFsCanonicalizeTargetFn(root);

    // `delete`'s computed plan: BOTH `other/o.txt` (the CURRENT manifest's
    // own declared ground) and `userland/mine.txt` (the RECORDED
    // declaration's ground) survive — the union protects whichever source
    // named it, so narrowing the manifest away from `userland/` can never
    // un-protect the developer's own file there. Only `a.txt`, named by
    // neither source, is deleted. The two sources disagree (`other/` vs.
    // `userland/`), so the plan also reports that drift.
    const plan = await computeDeletionPlan(
      't',
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
    expect(plan.toDelete).toEqual(['t/a.txt']);
    expect(plan.toDelete).not.toContain('t/userland/mine.txt');
    expect(plan.toDelete).not.toContain('t/other/o.txt');
    expect(plan.toPreserve).toContain('t/other/');
    expect(plan.toPreserve).toContain('t/userland/');
    expect(plan.exclusionsDrift).toEqual({ current: ['other/'], recorded: ['userland/'] });

    // `assemble`'s own staged batch reads the IDENTICAL current manifest —
    // its declared `excludedSubtrees` names the same ground `delete` just
    // preserved, never the stale recorded one.
    const readProjectStateFn: ReadProjectStateFn = async () => JSON.stringify(document);
    const assembleDeps: ResolveAndCheckDeps = {
      inventory: noInventory,
      fetchFn: vi.fn(async () => ''),
      readFileFn: createFsReadFileFn(),
      canonicalizeFn,
      existsFn: createFsPathExistsFn(),
      listFolderFilesFn: createFsListDiskFilesFn(),
      resolveInstalledContentPathFn: (name: string) => name,
    };
    const assembled = await resolveAndCheckBatch({ templates: { '@x/a': ['t'] } }, root, assembleDeps, readProjectStateFn);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    const entry = assembled.assembly.entries.find((e) => e.templateName === '@x/a' && e.target === 't');
    expect(entry?.excludedSubtrees).toEqual(['other/']);

    // Nothing was actually written by either read-only computation.
    const other = await readFile(path.join(root, 't', 'other', 'o.txt'), 'utf-8');
    expect(other).toBe('CURRENTLY DECLARED EXCLUDED — must survive');
  });
});
