// @cpt-flow:cpt-frontx-flow-upgrade-changeset-review-approval:p1
//
// Real-filesystem coverage for the other half of defect-3: `upgrade
// <name> <origin>` landing on the SAME `{origin, version}` pair already
// recorded is an idempotent no-op — but a legacy entry (registered before
// `TemplateEntry.excludedSubtrees` existed) must still ACQUIRE the field on
// that call, exactly as `register --replace` now does
// (`register-legacy-exclusions-recovery-real-fs.test.ts`). Reproduced live:
// `frontx upgrade @x/a path:vendor-a --json --yes` against a legacy entry
// reported `{"outcome":"noop"}` and the field stayed absent forever.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { upgradeToOrigin } from '../upgrade/flow';
import type { UpgradeEngineDeps } from '../upgrade/flow';
import { createResolvePayloadFn } from '../upgrade/payload';
import type { ProjectStateDocument } from '../project-state/types';
import {
  createFsCanonicalizeTargetFn,
  createFsPathExistsFn,
  createFsReadFileFn,
  createFsReadProjectStateFn,
  createFsWriteProjectStateFn,
} from '../adapters/fs-project-io';
import {
  createFsReadDiskEntryFn,
  createFsWriteDiskFileFn,
  createFsRenameDiskFileFn,
  createFsUnlinkDiskFileFn,
  createFsListDiskFilesFn,
} from '../adapters/fs-upgrade-io';

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

function realDeps(repoRoot: string): UpgradeEngineDeps {
  return {
    repoRoot,
    readProjectStateFn: createFsReadProjectStateFn(),
    writeProjectStateFn: createFsWriteProjectStateFn(),
    resolvePayload: createResolvePayloadFn({
      repoRoot,
      fetchFn: vi.fn(async () => ''),
      readFileFn: createFsReadFileFn(),
      listDiskFiles: createFsListDiskFilesFn(),
      existsFn: createFsPathExistsFn(),
      canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
    }),
    // Only one registered template in this fixture — never actually called.
    resolveRegisteredExclusions: async () => [],
    readDiskEntry: createFsReadDiskEntryFn(),
    writeDiskFile: createFsWriteDiskFileFn(repoRoot),
    renameDiskFile: createFsRenameDiskFileFn(repoRoot),
    unlinkDiskFile: createFsUnlinkDiskFileFn(repoRoot),
    listDiskFiles: createFsListDiskFilesFn(),
    canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
    presentPlan: async () => {
      throw new Error('presentPlan must not be called for an idempotent no-op');
    },
    promoteInventory: async () => {},
    refreshAiBundle: async () => {},
  };
}

describe('upgrade landing on the same origin — recording a missing excludedSubtrees against a real filesystem', () => {
  it('records excludedSubtrees onto a legacy entry even though the {origin, version} transition is a no-op', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-legacy-exclusions-'));

    await mkdir(path.join(root, 'vendor-a'), { recursive: true });
    await writeFile(
      path.join(root, 'vendor-a', 'frontx-template.json'),
      JSON.stringify(manifest('@x/a', ['userland/'])),
      'utf-8',
    );
    await writeFile(path.join(root, 'vendor-a', 'index.ts'), 'export const a = 1;', 'utf-8');

    await mkdir(path.join(root, 'app', 'userland'), { recursive: true });
    await writeFile(path.join(root, 'app', 'index.ts'), 'export const a = 1;', 'utf-8');

    // A LEGACY entry: no recorded `excludedSubtrees` at all.
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/a': { origin: 'path:vendor-a', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const deps = realDeps(root);

    const result = await upgradeToOrigin('@x/a', 'path:vendor-a', deps);

    expect(result).toMatchObject({ ok: true, outcome: 'noop' });

    const stateAfter = JSON.parse(
      await readFile(path.join(root, '.frontx', 'project.json'), 'utf-8'),
    ) as ProjectStateDocument;
    expect(stateAfter.templates['@x/a']).toMatchObject({
      origin: 'path:vendor-a',
      version: '1.0.0',
      targets: ['app'],
      excludedSubtrees: ['userland/'],
    });
    // An upgrade landing on the SAME origin is not a real transition — no
    // `previous` pair is created for it.
    expect(stateAfter.templates['@x/a'].previous).toBeUndefined();
  });
});
