// @cpt-algo:cpt-frontx-algo-cli-scaffolding-conflict-check:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
// @cpt-algo:cpt-frontx-algo-composed-provenance-ownership-add:p1
//
// Real-filesystem coverage for the ownership model's ground-identity defect:
// APFS (macOS) and NTFS (Windows) fold case for path identity, so `app` and
// `App` name the SAME on-disk location, but the checker, `delete`,
// `ownership add`, and containment all used to compare paths as raw byte
// strings — `app`/`App` passed the conflict checker as two independent
// targets, `delete app` removed a DIFFERENT template's files sharing the
// same physical directory under `App`, `ownership add App` was accepted
// where `ownership add app` was refused, and an absolute path through a
// case-flipped ancestor segment was refused as `INVALID_PATH` even though it
// resolved inside the project root.
//
// Every test below detects the RUNNING volume's own case sensitivity the
// same way the product does (`isVolumeCaseInsensitive`, `../paths/volume-
// case.ts`) and asserts the behavior that volume implies, so this suite is
// meaningful on both APFS/NTFS (case-insensitive) and ext4 (case-sensitive,
// this package's CI) rather than passing vacuously on one and missing the
// defect on the other.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { isVolumeCaseInsensitive } from '../paths/volume-case';
import { checkTargetConflicts } from '../scaffold/conflict-check';
import { computeDeletionPlan } from '../scaffold/delete-plan';
import type { DeletePlanInventoryPort } from '../scaffold/delete-plan';
import { ownershipAdd } from '../commands/ownership';
import type { OwnershipInventoryPort } from '../commands/ownership';
import type { ProjectStateDocument } from '../project-state/types';
import {
  createFsCanonicalizeTargetFn,
  createFsReadFileFn,
  createFsListTargetFilesFn,
  createFsListUnenumerableTargetEntriesFn,
  createFsReadProjectStateFn,
  createFsWriteProjectStateFn,
} from '../adapters/fs-project-io';
import { createFsReadTargetPathStateFn } from '../adapters/fs-target-path';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

function manifest(name: string): Record<string, unknown> {
  return { name, version: '1.0.0', excludedSubtrees: [], description: `Fixture template "${name}"` };
}

async function writeProjectState(repoRoot: string, document: ProjectStateDocument): Promise<void> {
  await mkdir(path.join(repoRoot, '.frontx'), { recursive: true });
  await writeFile(path.join(repoRoot, '.frontx', 'project.json'), JSON.stringify(document), 'utf-8');
}

const noInventory: DeletePlanInventoryPort & OwnershipInventoryPort = { lookup: () => undefined };

describe('volume case-sensitivity probe (real filesystem)', () => {
  it('reports the truth for the directory the test is running in', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-case-probe-truth-'));
    const marker = path.join(root, 'CaseProbeMarker.txt');
    await writeFile(marker, 'x', 'utf-8');
    // An independent check of the SAME fact `isVolumeCaseInsensitive` exists
    // to answer, using a plain `stat` on the flipped spelling rather than
    // that module's own probe primitive — this is the assertion that the
    // product's answer is not merely self-consistent but actually true.
    const flippedResolves = await stat(path.join(root, 'caseprobemarker.txt')).then(
      () => true,
      () => false,
    );
    expect(isVolumeCaseInsensitive(root)).toBe(flippedResolves);
  });
});

describe('pre-flight conflict check — two spellings of one target in a single batch (real filesystem)', () => {
  it('refuses as TARGET_CONFLICT on a case-insensitive volume, and admits both independently on a case-sensitive one', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-case-batch-'));
    const insensitive = isVolumeCaseInsensitive(root);
    const canonicalizeFn = createFsCanonicalizeTargetFn(root);

    const verdict = checkTargetConflicts({
      targetsUnderCheck: [
        { target: 'app', templateName: '@x/t1', excludedSubtrees: [] },
        { target: 'App', templateName: '@x/t2', excludedSubtrees: [] },
      ],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn,
    });

    if (insensitive) {
      expect(verdict.ok).toBe(false);
      if (!verdict.ok && verdict.kind === 'TARGET_CONFLICT') {
        expect(verdict.conflicts.length).toBeGreaterThan(0);
      }
    } else {
      expect(verdict).toEqual({ ok: true });
    }
  });
});

describe('delete — one spelling never removes files belonging to a template recorded under the other (real filesystem)', () => {
  it('protects the other spelling\'s recorded ground on a case-insensitive volume, and stays confined to its own target on a case-sensitive one', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-case-delete-'));
    const insensitive = isVolumeCaseInsensitive(root);
    await mkdir(path.join(root, 'vendor-t1'), { recursive: true });
    await mkdir(path.join(root, 'vendor-t2'), { recursive: true });
    await writeFile(path.join(root, 'vendor-t1', 'frontx-template.json'), JSON.stringify(manifest('@x/t1')), 'utf-8');
    await writeFile(path.join(root, 'vendor-t2', 'frontx-template.json'), JSON.stringify(manifest('@x/t2')), 'utf-8');

    if (insensitive) {
      // The state a pre-existing, un-refused double-registration left behind:
      // one physical directory, two spellings, each template's `targets[]`
      // recording its OWN spelling.
      await mkdir(path.join(root, 'app'), { recursive: true });
      await writeFile(path.join(root, 'app', 't1.txt'), 't1 payload', 'utf-8');
      await writeFile(path.join(root, 'App', 't2.txt'), 't2 payload', 'utf-8'); // same directory, case-insensitive
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: {
          '@x/t1': { origin: 'path:vendor-t1', version: '1.0.0', targets: ['app'] },
          '@x/t2': { origin: 'path:vendor-t2', version: '1.0.0', targets: ['App'] },
        },
        projectOwnedRoots: [],
      };
      await writeProjectState(root, document);
      const canonicalizeFn = createFsCanonicalizeTargetFn(root);

      const plan = await computeDeletionPlan(
        'app',
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
      // `t2.txt` (recorded under the OTHER template's spelling) is never a
      // candidate for removal — the whole ground is shared with a nested
      // target under `App`, so nothing here is deleted at all.
      expect(plan.toDelete).not.toContain('app/t2.txt');
      expect(plan.toDelete).toEqual([]);
    } else {
      // Two independent, genuinely different directories on this volume —
      // deleting one must never touch the other's files at all.
      await mkdir(path.join(root, 'app'), { recursive: true });
      await mkdir(path.join(root, 'App'), { recursive: true });
      await writeFile(path.join(root, 'app', 't1.txt'), 't1 payload', 'utf-8');
      await writeFile(path.join(root, 'App', 't2.txt'), 't2 payload', 'utf-8');
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: {
          '@x/t1': { origin: 'path:vendor-t1', version: '1.0.0', targets: ['app'] },
          '@x/t2': { origin: 'path:vendor-t2', version: '1.0.0', targets: ['App'] },
        },
        projectOwnedRoots: [],
      };
      await writeProjectState(root, document);
      const canonicalizeFn = createFsCanonicalizeTargetFn(root);

      const plan = await computeDeletionPlan(
        'app',
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
      expect(plan.toDelete).toEqual(['app/t1.txt']);
      expect(plan.toDelete).not.toContain('App/t2.txt');

      const otherFile = await stat(path.join(root, 'App', 't2.txt')).then(
        () => true,
        () => false,
      );
      expect(otherFile).toBe(true);
    }
  });
});

describe('ownership add — both spellings of one path (real filesystem)', () => {
  it('answers the way the running volume implies for both spellings of one applied target', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-case-ownership-'));
    const insensitive = isVolumeCaseInsensitive(root);
    await mkdir(path.join(root, 'app'), { recursive: true });
    await writeFile(path.join(root, 'app', 'a.txt'), 'owned by @x/t1', 'utf-8');
    if (!insensitive) {
      // On a case-sensitive volume `App` is a genuinely different, real
      // location — created here so both spellings name something that
      // actually exists (`ownership add` refuses only a path that does not).
      await mkdir(path.join(root, 'App'), { recursive: true });
    }
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { '@x/t1': { origin: 'path:vendor-t1', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);

    const canonicalizeFn = createFsCanonicalizeTargetFn(root);
    const readTargetPathStateFn = createFsReadTargetPathStateFn();
    const readProjectStateFn = createFsReadProjectStateFn();
    const writeProjectStateFn = createFsWriteProjectStateFn();
    const readFileFn = createFsReadFileFn();

    const exact = await ownershipAdd(
      'app',
      root,
      noInventory,
      readTargetPathStateFn,
      canonicalizeFn,
      readProjectStateFn,
      writeProjectStateFn,
      readFileFn,
    );
    const otherSpelling = await ownershipAdd(
      'App',
      root,
      noInventory,
      readTargetPathStateFn,
      canonicalizeFn,
      readProjectStateFn,
      writeProjectStateFn,
      readFileFn,
    );

    // `app` itself always coincides with the applied target and is always
    // refused, on either volume.
    expect(exact.ok).toBe(false);

    if (insensitive) {
      // The SAME ground under its other spelling is refused identically —
      // the defect this test exists to close accepted it instead.
      expect(otherSpelling.ok).toBe(false);
      if (!exact.ok && !otherSpelling.ok) {
        expect(exact.code).toBe(otherSpelling.code);
      }
    } else {
      // A genuinely different, unclaimed, existing location: accepted.
      expect(otherSpelling.ok).toBe(true);
    }
  });
});

describe('a `path:` origin folder spelled differently than its own registration (real filesystem)', () => {
  it('is excluded from a computed deletion plan under its actual on-disk spelling, never swept into toDelete', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-case-origin-folder-'));
    const insensitive = isVolumeCaseInsensitive(root);
    // The origin folder ("tpl") sits INSIDE its own target ("myapp") — the
    // ordinary vendored-`path:` shape (`QUICK_START` §4).
    await mkdir(path.join(root, 'myapp', 'tpl'), { recursive: true });
    await writeFile(path.join(root, 'myapp', 'tpl', 'frontx-template.json'), JSON.stringify(manifest('@x/t4')), 'utf-8');
    await writeFile(path.join(root, 'myapp', 'tpl', 'payload.txt'), 'template source, never delete', 'utf-8');
    await writeFile(path.join(root, 'myapp', 'app.txt'), 'applied payload', 'utf-8');

    const document: ProjectStateDocument = {
      formatVersion: 1,
      // Registered as `path:myapp/TPL` — a different spelling of the
      // actual `myapp/tpl` folder on disk.
      templates: { '@x/t4': { origin: 'path:myapp/TPL', version: '1.0.0', targets: ['myapp'] } },
      projectOwnedRoots: [],
    };
    await writeProjectState(root, document);
    const canonicalizeFn = createFsCanonicalizeTargetFn(root);

    const plan = await computeDeletionPlan(
      'myapp',
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

    if (insensitive) {
      // `path:myapp/TPL` and the real `myapp/tpl` name the SAME ground —
      // none of the origin folder's own content is ever a delete candidate.
      expect(plan.toDelete).toEqual(['myapp/app.txt']);
      expect(plan.toDelete.some((entry) => entry.startsWith('myapp/tpl/'))).toBe(false);
    } else {
      // `myapp/TPL` genuinely does not exist on this volume — the origin
      // folder derivation resolves nothing to exclude, so the REAL `tpl`
      // folder (a different, unregistered location the owning template
      // knows nothing about) is ordinary applied ground.
      expect(plan.toDelete).toContain('myapp/app.txt');
    }
  });
});

describe('containment — an absolute path spelled in another case (real filesystem)', () => {
  it('is accepted on a case-insensitive volume and refused as a genuinely different location on a case-sensitive one', async () => {
    const prefix = 'FrontxCaseIdentity-';
    root = await mkdtemp(path.join(tmpdir(), prefix));
    const insensitive = isVolumeCaseInsensitive(root);
    await mkdir(path.join(root, 'docs'), { recursive: true });

    const rootBase = path.basename(root);
    const flippedBase = rootBase.slice(0, prefix.length - 1).toLowerCase() + rootBase.slice(prefix.length - 1);
    const flippedRoot = path.join(path.dirname(root), flippedBase);
    expect(flippedRoot).not.toBe(root);

    const canonicalizeFn = createFsCanonicalizeTargetFn(root);
    const resolved = canonicalizeFn(path.join(flippedRoot, 'docs'));

    if (insensitive) {
      expect(resolved).toBe('docs');
    } else {
      expect(resolved).toBeNull();
    }
  });
});
