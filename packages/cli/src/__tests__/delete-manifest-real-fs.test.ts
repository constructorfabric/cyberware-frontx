// @cpt-flow:cpt-frontx-flow-cli-scaffolding-delete-target:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
//
// Real-filesystem coverage for `scaffold/delete-plan.ts`'s owning-template
// exclusion join (`inst-dp-compute-ownership`) — the one disk shape no fake
// `ReadFileFn` can fully stand in for, since a real adapter (`createFsRead
// FileFn`) throwing a real `NotRegularFileError` for a FIFO, or a manifest
// genuinely absent because its origin folder was removed by hand, are both
// facts about the actual filesystem, not something a test double could get
// wrong on its own. `mkfifo` (a POSIX utility on every platform this suite
// runs on) creates the node without ever opening it — `createFsReadFileFn`
// itself never opens a FIFO for reading either (it classifies via
// `lstat`/`stat` first), so this suite never hangs.
//
// Two distinct fixes are pinned here:
//   - The manifest-unreadable refusal must survive regardless of anything
//     else this suite changes (a real regression introduced and closed in
//     the same round: `resolveRegisteredExcludedSubtrees` briefly widened
//     this case to `[]` for its OTHER three callers, and `delete-plan.ts`
//     must still refuse for its own owning-template join).
//   - A genuinely ABSENT manifest, or an origin that can no longer be
//     proven to stay inside the project root, must now ALSO refuse when the
//     owning template's project-state entry carries no RECORDED
//     `excludedSubtrees` — the disproved shape this suite used to assert
//     (`inst-dp-if-manifest-absent`, now retired) let a developer's own
//     `excludedSubtrees`-protected file land in `toDelete` under `ok:true`
//     the moment a vendored `path:` origin folder was removed, which is the
//     ORDINARY lifecycle of that folder, not an exotic failure.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteTarget } from '../commands/delete';
import type { DeletePlanInventoryPort } from '../scaffold/delete-plan';
import type { ProjectStateDocument } from '../project-state/types';
import {
  createFsCanonicalizeTargetFn,
  createFsListTargetFilesFn,
  createFsListUnenumerableTargetEntriesFn,
  createFsReadFileFn,
  createFsRemoveProjectFileFn,
  createFsAssertPathWithinRootFn,
  createFsReadProjectStateFn,
  createFsWriteProjectStateFn,
} from '../adapters/fs-project-io';

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

const noInventory: DeletePlanInventoryPort = { lookup: () => undefined };

async function writeProjectState(repoRoot: string, document: ProjectStateDocument): Promise<void> {
  await mkdir(path.join(repoRoot, '.frontx'), { recursive: true });
  await writeFile(path.join(repoRoot, '.frontx', 'project.json'), JSON.stringify(document), 'utf-8');
}

// Wires every seam `deleteTarget` needs to the REAL adapters
// (`adapters/fs-project-io.ts`) rooted at `repoRoot` — the same
// construction `cli.ts`'s own dispatch performs, reproduced here directly
// rather than through the CLI entrypoint, matching this suite's own
// `fs-containment.test.ts` convention of driving real command logic against
// a real temp directory without spawning a process.
function realDeps(repoRoot: string) {
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

describe('deleteTarget — owning template manifest unreadable (real filesystem)', () => {
  it('refuses CONTENT_CONFLICT on --dry-run AND --yes when the manifest is a FIFO, leaving the developer\'s excluded file untouched on disk', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-delete-manifest-fifo-'));

    // A locally-registered template declaring `userland/` excluded, applied
    // to target `t` — mirrors an ordinary `path:` registration plus apply,
    // constructed directly on disk rather than through those commands
    // (this suite's own concern is `delete`, not `apply`/`register`).
    await mkdir(path.join(root, 'vendor', 'app-template'), { recursive: true });
    await mkdir(path.join(root, 't', 'userland'), { recursive: true });
    await writeFile(path.join(root, 't', 'src.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 't', 'userland', 'mine.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');

    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: { origin: 'path:vendor/app-template', version: '1.0.0', targets: ['t'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    // The manifest is a FIFO — present, but not a regular file.
    makeFifo(path.join(root, 'vendor', 'app-template', 'frontx-template.json'));

    const deps = realDeps(root);
    const neverConfirm = async (): Promise<'confirmed' | 'declined'> => {
      throw new Error('confirmDeletionFn must not be called in --json mode');
    };

    const dryRunResult = await deleteTarget(
      't',
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
    expect(dryRunResult).toMatchObject({ ok: false, code: 'CONTENT_CONFLICT' });

    const yesResult = await deleteTarget(
      't',
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
    expect(yesResult).toMatchObject({ ok: false, code: 'CONTENT_CONFLICT' });

    // The developer's own file, protected by the template's declared
    // `excludedSubtrees`, survives with its exact original content — nothing
    // was deleted, and nothing silently reconciled it away either.
    const survived = await readFile(path.join(root, 't', 'userland', 'mine.txt'), 'utf-8');
    expect(survived).toBe('DEVELOPER-OWNED — must survive');

    // The project state document is untouched: `t` is still recorded under
    // `appTemplate`'s `targets[]`.
    const stateAfter = JSON.parse(
      await readFile(path.join(root, '.frontx', 'project.json'), 'utf-8'),
    ) as ProjectStateDocument;
    expect(stateAfter.templates.appTemplate.targets).toEqual(['t']);
  });

  // The companion case: the manifest is genuinely ABSENT (the whole origin
  // folder was removed by hand), not merely unreadable, AND the owning
  // template's project-state entry carries no RECORDED `excludedSubtrees`
  // (a legacy entry from before that field existed). This USED to proceed,
  // treating the missing declaration as `[]` — the disproved shape: a
  // vendored `path:` origin folder is transient by design and its removal
  // is the ORDINARY lifecycle, not an exotic failure, so folding it to `[]`
  // silently widened `toDelete` to include the developer's own
  // `excludedSubtrees`-protected file. It now REFUSES instead, exactly like
  // the unreadable case above, naming the remedy (re-register the origin).
  it('refuses when the manifest is genuinely absent and no excludedSubtrees is recorded, leaving the developer\'s excluded file untouched', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-delete-manifest-absent-'));

    await mkdir(path.join(root, 't', 'userland'), { recursive: true });
    await writeFile(path.join(root, 't', 'src.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 't', 'userland', 'mine.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
    // Deliberately no `vendor/app-template/` folder at all on disk, and no
    // `excludedSubtrees` recorded on the entry below.

    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { appTemplate: { origin: 'path:vendor/app-template', version: '1.0.0', targets: ['t'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const deps = realDeps(root);
    const dryRunResult = await deleteTarget(
      't',
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
      async () => {
        throw new Error('confirmDeletionFn must not be called in --json mode');
      },
    );

    expect(dryRunResult).toMatchObject({ ok: false, code: 'CONTENT_CONFLICT' });

    const survived = await readFile(path.join(root, 't', 'userland', 'mine.txt'), 'utf-8');
    expect(survived).toBe('DEVELOPER-OWNED — must survive');
  });

  // The recorded declaration is honoured even once the origin folder is
  // gone entirely — the fix's primary case: deletion no longer depends on a
  // vendored `path:` origin folder still being on disk once its declaration
  // was recorded at registration.
  it('honours a RECORDED excludedSubtrees after the origin folder has been removed entirely, preserving the developer\'s excluded file', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-delete-recorded-exclusions-'));

    await mkdir(path.join(root, 't', 'userland'), { recursive: true });
    await writeFile(path.join(root, 't', 'src.txt'), 'template-owned', 'utf-8');
    await writeFile(path.join(root, 't', 'userland', 'mine.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
    // No `vendor/app-template/` folder at all on disk — removed after apply,
    // same as the repro. The declaration below is what stands in for it.

    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: {
        appTemplate: {
          origin: 'path:vendor/app-template',
          version: '1.0.0',
          targets: ['t'],
          excludedSubtrees: ['userland/'],
        },
      },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const deps = realDeps(root);
    const dryRunResult = await deleteTarget(
      't',
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
      async () => {
        throw new Error('confirmDeletionFn must not be called in --json mode');
      },
    );

    expect(dryRunResult).toMatchObject({ ok: true, outcome: 'dry-run' });
    if (!dryRunResult.ok) return;
    expect(dryRunResult.toDelete).toEqual(['t/src.txt']);
    expect(dryRunResult.toPreserve).toContain('t/userland/');

    const survived = await readFile(path.join(root, 't', 'userland', 'mine.txt'), 'utf-8');
    expect(survived).toBe('DEVELOPER-OWNED — must survive');
  });

  // No recorded declaration AND the origin cannot be resolved at all — an
  // escaping symlink standing where the origin folder is expected, so
  // `canonicalizeFn` returns `null` for it. Must refuse exactly like a
  // genuinely absent manifest, never widen.
  it('refuses when no excludedSubtrees is recorded and the origin folder is an escaping symlink', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-delete-escaping-origin-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'frontx-delete-escaping-origin-outside-'));

    try {
      await mkdir(path.join(root, 't', 'userland'), { recursive: true });
      await mkdir(path.join(root, 'vendor'), { recursive: true });
      await writeFile(path.join(root, 't', 'src.txt'), 'template-owned', 'utf-8');
      await writeFile(path.join(root, 't', 'userland', 'mine.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
      await symlink(outside, path.join(root, 'vendor', 'app-template'));

      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: { appTemplate: { origin: 'path:vendor/app-template', version: '1.0.0', targets: ['t'] } },
        projectOwnedRoots: [],
      };
      await writeProjectState(root, document);

      const deps = realDeps(root);
      const dryRunResult = await deleteTarget(
        't',
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
        async () => {
          throw new Error('confirmDeletionFn must not be called in --json mode');
        },
      );

      expect(dryRunResult).toMatchObject({ ok: false, code: 'CONTENT_CONFLICT' });

      const survived = await readFile(path.join(root, 't', 'userland', 'mine.txt'), 'utf-8');
      expect(survived).toBe('DEVELOPER-OWNED — must survive');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
