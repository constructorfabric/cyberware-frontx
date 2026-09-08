// @cpt-flow:cpt-frontx-flow-cli-scaffolding-delete-target:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
//
// Real-filesystem coverage for the owning-template-manifest-unreadable
// defect (`scaffold/registered-manifest.ts`'s absent-vs-unreadable
// discrimination, consumed by `scaffold/delete-plan.ts`'s `inst-dp-compute-
// ownership`) — the one disk shape no fake `ReadFileFn` can fully stand in
// for, since the defect this suite pins was a real adapter (`createFsRead
// FileFn`) throwing a real `NotRegularFileError` that a shared module used
// to swallow, not anything a test double could get wrong on its own.
// `mkfifo` (a POSIX utility on every platform this suite runs on) creates
// the node without ever opening it — `createFsReadFileFn` itself never
// opens a FIFO for reading either (it classifies via `lstat`/`stat` first),
// so this suite never hangs.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
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
  // folder was removed by hand), not merely unreadable. This is the
  // documented, accepted trade-off (`inst-dp-if-manifest-absent`) — the
  // deletion PROCEEDS, since there is no exclusion declaration left to
  // enforce, unlike the FIFO case above where a real declaration exists but
  // could not be read.
  it('proceeds (does not refuse) when the manifest is genuinely absent rather than unreadable', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-delete-manifest-absent-'));

    await mkdir(path.join(root, 't'), { recursive: true });
    await writeFile(path.join(root, 't', 'src.txt'), 'template-owned', 'utf-8');
    // Deliberately no `vendor/app-template/` folder at all on disk.

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

    expect(dryRunResult).toMatchObject({ ok: true, outcome: 'dry-run' });
    if (!dryRunResult.ok) return;
    expect(dryRunResult.toDelete).toContain('t/src.txt');
  });
});
