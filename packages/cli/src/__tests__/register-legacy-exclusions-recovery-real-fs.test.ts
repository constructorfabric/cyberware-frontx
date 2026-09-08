// @cpt-algo:cpt-frontx-algo-composed-provenance-register:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
//
// Real-filesystem, end-to-end coverage for defect-3 (a legacy entry — one
// registered before `TemplateEntry.excludedSubtrees` existed — must be able
// to ACQUIRE the field through the ordinary recovery path `delete`'s own
// refusal names). Reproduced live as a closed loop before this fix:
//
//   delete .                          => CONTENT_CONFLICT, remedy:
//                                         'register path:vendor-a --replace'
//   register path:vendor-a --replace  => INVALID_PATH when the origin
//                                         folder is gone
//   (origin restored) register --replace => {"ok":true,"outcome":"noop"}
//                                         and the field is STILL absent
//
// The remedy the refusal named did not work even when the developer did
// exactly what it said: `register --replace` resolving the SAME origin is
// otherwise a no-op for the `{origin, version}` pair, and that no-op used
// to skip the write entirely. This suite drives `registerTemplate` and
// `deleteTarget` directly against the REAL `fs-project-io.ts` adapters, the
// only way to prove the recorded value actually lands in
// `.frontx/project.json` and that a SUBSEQUENT `delete` then honours it.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplate } from '../commands/register';
import type { RegisterInventoryPort } from '../commands/register';
import { deleteTarget } from '../commands/delete';
import type { DeletePlanInventoryPort } from '../scaffold/delete-plan';
import type { ProjectStateDocument } from '../project-state/types';
import type { FetchFn } from '../resolver/types';
import {
  createFsCanonicalizeTargetFn,
  createFsPathExistsFn,
  createFsReadFileFn,
  createFsListTargetFilesFn,
  createFsListUnenumerableTargetEntriesFn,
  createFsRemoveProjectFileFn,
  createFsAssertPathWithinRootFn,
  createFsReadProjectStateFn,
  createFsWriteProjectStateFn,
} from '../adapters/fs-project-io';
import { createFsListDiskFilesFn } from '../adapters/fs-upgrade-io';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

// Neither `register` nor `delete` ever calls `install`/full `lookup` for a
// local `path:` origin (both resolve it directly from disk) — a fixture
// that throws if either is actually reached would fail loudly rather than
// silently mask a wiring mistake.
const noInventory: RegisterInventoryPort & DeletePlanInventoryPort = {
  lookup: () => undefined,
  install: vi.fn(async () => ({
    ok: false as const,
    error: { code: 'ORIGIN_UNAVAILABLE' as const, message: 'install not stubbed for this test' },
  })),
};

const noopFetch: FetchFn = vi.fn(async () => '');

function manifest(name: string, excludedSubtrees: string[]): Record<string, unknown> {
  return { name, version: '1.0.0', excludedSubtrees, description: `Fixture template "${name}"` };
}

async function writeProjectState(repoRoot: string, document: ProjectStateDocument): Promise<void> {
  await mkdir(path.join(repoRoot, '.frontx'), { recursive: true });
  await writeFile(path.join(repoRoot, '.frontx', 'project.json'), JSON.stringify(document), 'utf-8');
}

function realFns(repoRoot: string) {
  return {
    canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
    existsFn: createFsPathExistsFn(),
    listFolderFilesFn: createFsListDiskFilesFn(),
    readFileFn: createFsReadFileFn(),
    listTargetFilesFn: createFsListTargetFilesFn(),
    listUnenumerableTargetEntriesFn: createFsListUnenumerableTargetEntriesFn(),
    removeFileFn: createFsRemoveProjectFileFn(),
    assertPathWithinRootFn: createFsAssertPathWithinRootFn(repoRoot),
    readProjectStateFn: createFsReadProjectStateFn(),
    writeProjectStateFn: createFsWriteProjectStateFn(),
  };
}

const neverConfirm = async (): Promise<'confirmed' | 'declined'> => {
  throw new Error('confirmDeletionFn must not be called in --json mode');
};

describe('legacy excludedSubtrees recovery — register --replace and delete against a real filesystem', () => {
  it('walks the full recovery path: delete refuses, register --replace on a gone origin is INVALID_PATH, and once the origin is restored register --replace records the field so delete then succeeds', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-legacy-exclusions-recovery-'));

    // The target `.` — template-owned `a.txt` plus the developer's own
    // `userland/mine.txt`, which the origin's manifest (once resolvable)
    // declares excluded.
    await mkdir(path.join(root, 'userland'), { recursive: true });
    await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 'userland', 'mine.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');

    // A LEGACY entry — registered before `excludedSubtrees` existed — whose
    // origin folder is ALREADY gone: the ordinary lifecycle of a vendored
    // `path:` origin once applied (`QUICK_START` §4).
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/a': { origin: 'path:vendor-a', version: '1.0.0', targets: ['.'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const fns = realFns(root);

    // 1. `delete .` refuses: neither the current manifest (origin gone) nor
    //    a recorded declaration can establish what to exclude. The remedy
    //    names `register ... --replace`.
    const firstDelete = await deleteTarget(
      '.',
      root,
      { jsonMode: true, dryRun: true, yes: false },
      noInventory,
      fns.canonicalizeFn,
      fns.listTargetFilesFn,
      fns.listUnenumerableTargetEntriesFn,
      fns.readFileFn,
      fns.removeFileFn,
      fns.assertPathWithinRootFn,
      fns.readProjectStateFn,
      fns.writeProjectStateFn,
      neverConfirm,
    );
    expect(firstDelete).toMatchObject({ ok: false, code: 'CONTENT_CONFLICT' });
    if (!firstDelete.ok) {
      expect(firstDelete.message).toContain('register path:vendor-a --replace');
    }

    // 2. Following the named remedy while the origin is STILL gone refuses
    //    with INVALID_PATH — the remedy does not yet work.
    const registerWhileGone = await registerTemplate(
      'path:vendor-a',
      true,
      root,
      noInventory,
      noopFetch,
      fns.readFileFn,
      fns.canonicalizeFn,
      fns.readProjectStateFn,
      fns.writeProjectStateFn,
      fns.existsFn,
      fns.listFolderFilesFn,
    );
    expect(registerWhileGone).toMatchObject({ ok: false, code: 'INVALID_PATH' });

    // 3. The origin folder is restored.
    await mkdir(path.join(root, 'vendor-a'), { recursive: true });
    await writeFile(
      path.join(root, 'vendor-a', 'frontx-template.json'),
      JSON.stringify(manifest('@x/a', ['userland/'])),
      'utf-8',
    );
    await writeFile(path.join(root, 'vendor-a', 'index.ts'), 'export const a = 1;', 'utf-8');

    // 4. The identical `register --replace` call now succeeds. The
    //    `{origin, version}` pair is unchanged from what was already
    //    recorded — an ordinary no-op by that measure alone — but the entry
    //    is MISSING `excludedSubtrees`, so this call RECORDS it: the fix.
    const registerOnceRestored = await registerTemplate(
      'path:vendor-a',
      true,
      root,
      noInventory,
      noopFetch,
      fns.readFileFn,
      fns.canonicalizeFn,
      fns.readProjectStateFn,
      fns.writeProjectStateFn,
      fns.existsFn,
      fns.listFolderFilesFn,
    );
    expect(registerOnceRestored).toMatchObject({ ok: true, outcome: 'recorded' });
    if (registerOnceRestored.ok) {
      expect(registerOnceRestored.entry.excludedSubtrees).toEqual(['userland/']);
    }

    const stateAfterRegister = JSON.parse(
      await readFile(path.join(root, '.frontx', 'project.json'), 'utf-8'),
    ) as ProjectStateDocument;
    expect(stateAfterRegister.templates['@x/a'].excludedSubtrees).toEqual(['userland/']);

    // 5. `delete .` now succeeds, computed from the newly-recorded
    //    declaration — the loop is closed.
    const secondDelete = await deleteTarget(
      '.',
      root,
      { jsonMode: true, dryRun: true, yes: false },
      noInventory,
      fns.canonicalizeFn,
      fns.listTargetFilesFn,
      fns.listUnenumerableTargetEntriesFn,
      fns.readFileFn,
      fns.removeFileFn,
      fns.assertPathWithinRootFn,
      fns.readProjectStateFn,
      fns.writeProjectStateFn,
      neverConfirm,
    );
    expect(secondDelete).toMatchObject({ ok: true, outcome: 'dry-run' });
    if (secondDelete.ok) {
      expect(secondDelete.toDelete).toEqual(['a.txt']);
      expect(secondDelete.toPreserve).toContain('userland/');
      // The owning template's own restored local origin folder is the
      // developer's own ground too, and survives right alongside it.
      expect(secondDelete.toPreserve).toContain('vendor-a');
    }

    const survived = await readFile(path.join(root, 'userland', 'mine.txt'), 'utf-8');
    expect(survived).toBe('DEVELOPER-OWNED — must survive');
  });
});
