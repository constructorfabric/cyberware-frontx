// @cpt-flow:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1
//
// Real-filesystem coverage for a regression in `scaffold/registered-
// manifest.ts`'s `resolveRegisteredExcludedSubtrees`: it started THROWING
// for an unreadable manifest (correct for `scaffold/delete-plan.ts`'s own
// owning-template join) without accounting for its other three callers,
// each of which resolves an OTHER registered template's declared
// exclusions while checking a batch for a COMPLETELY DIFFERENT template.
// Reproduced live on the built binary: `chmod 000` on one `path:`-registered
// template's manifest blocked `apply`/`assemble` for an unrelated,
// disjoint template — violating the per-template independence
// `cpt-frontx-cli-nfr-template-scale` fixes. `mkfifo` (used here, as in
// this suite's own `delete-manifest-real-fs.test.ts`) reproduces the
// "present but unreadable" fact without depending on `chmod`, which a
// root-run test process would not be blocked by.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAndCheckBatch } from '../commands/apply';
import type { ResolveAndCheckDeps } from '../commands/apply';
import type { UniformApplyInventoryPort } from '../scaffold/assembler';
import type { ProjectStateDocument, ReadProjectStateFn } from '../project-state/types';
import { createFsCanonicalizeTargetFn, createFsPathExistsFn, createFsReadFileFn, createFsReadProjectStateFn } from '../adapters/fs-project-io';
import { createFsListDiskFilesFn } from '../adapters/fs-upgrade-io';

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

const noInventory: UniformApplyInventoryPort = {
  lookup: () => undefined,
  install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
};

async function writeProjectState(repoRoot: string, document: ProjectStateDocument): Promise<void> {
  await mkdir(path.join(repoRoot, '.frontx'), { recursive: true });
  await writeFile(path.join(repoRoot, '.frontx', 'project.json'), JSON.stringify(document), 'utf-8');
}

// Two disjoint, already-registered-and-applied local `path:` templates —
// `@x/a` at `dir-a` and `@x/b` at `dir-b` — mirroring the live repro
// exactly. `readProjectStateFn` is the one seam this suite does not read
// from a real file on disk (a plain closure over `document` is enough; the
// defect lives in manifest resolution, not project-state I/O).
async function setup(repoRoot: string, bManifestReadable: boolean): Promise<{ deps: ResolveAndCheckDeps; readProjectStateFn: ReadProjectStateFn }> {
  await mkdir(path.join(repoRoot, 'vendor-a'), { recursive: true });
  await mkdir(path.join(repoRoot, 'vendor-b'), { recursive: true });
  await mkdir(path.join(repoRoot, 'dir-a'), { recursive: true });
  await mkdir(path.join(repoRoot, 'dir-b'), { recursive: true });
  await writeFile(path.join(repoRoot, 'vendor-a', 'frontx-template.json'), JSON.stringify(manifest('@x/a')), 'utf-8');
  await writeFile(path.join(repoRoot, 'vendor-a', 'index.ts'), 'export const a = 1;', 'utf-8');
  if (bManifestReadable) {
    await writeFile(path.join(repoRoot, 'vendor-b', 'frontx-template.json'), JSON.stringify(manifest('@x/b')), 'utf-8');
  } else {
    makeFifo(path.join(repoRoot, 'vendor-b', 'frontx-template.json'));
  }

  const document: ProjectStateDocument = {
    formatVersion: 1,
    templates: {
      '@x/a': { origin: 'path:vendor-a', version: '1.0.0', targets: ['dir-a'] },
      '@x/b': { origin: 'path:vendor-b', version: '1.0.0', targets: ['dir-b'] },
    },
    projectOwnedRoots: [],
  };
  await writeProjectState(repoRoot, document);

  const deps: ResolveAndCheckDeps = {
    inventory: noInventory,
    fetchFn: vi.fn(async () => ''),
    readFileFn: createFsReadFileFn(),
    canonicalizeFn: createFsCanonicalizeTargetFn(repoRoot),
    existsFn: createFsPathExistsFn(),
    listFolderFilesFn: createFsListDiskFilesFn(),
    resolveInstalledContentPathFn: (name: string) => name,
  };

  return { deps, readProjectStateFn: createFsReadProjectStateFn() };
}

describe('resolveAndCheckBatch — per-template independence of an unrelated unreadable manifest (real filesystem)', () => {
  it('stages a NEW target for @x/a while @x/b\'s manifest is a FIFO, instead of blocking on it', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-assemble-other-unreadable-'));
    const { deps, readProjectStateFn } = await setup(root, false);

    const result = await resolveAndCheckBatch({ templates: { '@x/a': ['dir-a2'] } }, root, deps, readProjectStateFn);

    expect(result).toMatchObject({ ok: true });
  });

  it('control: the identical batch succeeds when @x/b\'s manifest is readable too', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-assemble-other-readable-'));
    const { deps, readProjectStateFn } = await setup(root, true);

    const result = await resolveAndCheckBatch({ templates: { '@x/a': ['dir-a2'] } }, root, deps, readProjectStateFn);

    expect(result).toMatchObject({ ok: true });
  });
});
