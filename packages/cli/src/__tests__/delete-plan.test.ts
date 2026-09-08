// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
import { describe, expect, it } from 'vitest';
import { computeDeletionPlan } from '../scaffold/delete-plan';
import type { DeletePlanInventoryPort, ListTargetFilesFn, ListUnenumerableTargetEntriesFn } from '../scaffold/delete-plan';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry } from '../inventory/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ProjectStateDocument, TemplateEntry } from '../project-state/types';
import type { ReadFileFn } from '../manifest/types';

// Every fixture target below is already a well-formed project-relative
// POSIX path, so canonicalization is the identity — mirrors
// `ownership.test.ts`'s/`conflict-check.test.ts`'s own fake seam for the
// same reason.
const identityCanonicalize: CanonicalizeTargetFn = (rawTarget) => rawTarget;

function fakeInventory(manifestsByName: Record<string, { excludedSubtrees: string[] }> = {}): DeletePlanInventoryPort {
  return {
    lookup: (name: string): InventoryEntry | undefined => {
      const manifest = manifestsByName[name];
      if (!manifest) return undefined;
      return {
        name,
        source: `github:acme/${name}@v1.0.0`,
        ref: 'v1.0.0',
        status: InventoryState.INSTALLED,
        content: JSON.stringify({
          name,
          version: '1.0.0',
          excludedSubtrees: manifest.excludedSubtrees,
          description: 'A template.',
        }),
      };
    },
  };
}

function fakeListTargetFiles(filesByAbsoluteDir: Record<string, string[]>): ListTargetFilesFn {
  return async (absoluteDir: string) => filesByAbsoluteDir[absoluteDir] ?? [];
}

// None of the `github:`-origin fixtures below ever reach a `readFileFn` call
// (only a `path:`-origin owner does) — kept failing rather than a harmless
// stub so a fixture that starts using a local origin without also wiring a
// real `readFileFn` fails loudly instead of silently re-introducing the
// exact `inventory.lookup`-only bug this checkpoint fixed.
const neverCalledReadFileFn: ReadFileFn = async () => {
  throw new Error('readFileFn should not be called for a remote-origin fixture');
};

// The ordinary case for a fixture built from a path->content map: every entry
// the walk reports is a regular file, so there is nothing standing inside the
// target that a deletion cannot enumerate.
const noUnenumerableEntries: ListUnenumerableTargetEntriesFn = async () => [];

// A real project-relative `readFileFn` fake keyed by absolute path — used by
// the local-origin regression test below, mirroring how `register.ts`
// itself reads a `path:` origin's manifest directly off disk.
function fakeReadFileFn(filesByAbsolutePath: Record<string, string>): ReadFileFn {
  return async (absolutePath: string) => {
    const content = filesByAbsolutePath[absolutePath];
    if (content === undefined) throw new Error(`ENOENT: no such file at ${absolutePath}`);
    return content;
  };
}

function entry(targets: string[], overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return { origin: 'github:acme/tmpl@v1', version: '1.0.0', targets, ...overrides };
}

function doc(templates: Record<string, TemplateEntry>, projectOwnedRoots: string[] = []): ProjectStateDocument {
  return { formatVersion: 1, templates, projectOwnedRoots };
}

describe('computeDeletionPlan (cpt-frontx-algo-cli-scaffolding-delete-plan)', () => {
  it('refuses TARGET_NOT_APPLIED when the target matches no registered template\'s targets array', async () => {
    const result = await computeDeletionPlan(
      'packages/app',
      '/repo',
      doc({ appTemplate: entry(['packages/other']) }),
      fakeInventory(),
      identityCanonicalize,
      fakeListTargetFiles({}),
      neverCalledReadFileFn,
      noUnenumerableEntries,
    );

    expect(result).toMatchObject({ ok: false, code: 'TARGET_NOT_APPLIED', details: { target: 'packages/app' } });
  });

  it('excludes a declared excludedSubtrees entry from toDelete and surfaces it in toPreserve', async () => {
    const document = doc({ appTemplate: entry(['packages/app']) });
    const result = await computeDeletionPlan(
      'packages/app',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: ['docs/'] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo/packages/app': ['src/index.ts', 'docs/readme.md'],
      }),
      neverCalledReadFileFn,
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.templateName).toBe('appTemplate');
    expect(result.toDelete).toEqual(['packages/app/src/index.ts']);
    expect(result.toPreserve).toContain('packages/app/docs/');
    expect(result.toDelete).not.toContain('packages/app/docs/readme.md');
  });

  it('preserves a different template\'s nested target even with no matching excludedSubtrees declaration', async () => {
    // Defensive independent check (`inst-dp-find-nested`): protects a
    // nested applied instance even if the owner's CURRENT manifest no
    // longer declares that ground excluded (e.g. drifted since apply).
    const document = doc({
      appTemplate: entry(['packages/app']),
      adminTemplate: entry(['packages/app/admin']),
    });
    const result = await computeDeletionPlan(
      'packages/app',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] }, adminTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo/packages/app': ['src/index.ts', 'admin/index.ts'],
      }),
      neverCalledReadFileFn,
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toPreserve).toContain('packages/app/admin');
    expect(result.toDelete).not.toContain('packages/app/admin/index.ts');
    expect(result.toDelete).toContain('packages/app/src/index.ts');
  });

  it('subtracts a projectOwnedRoots entry beneath the target from toDelete and surfaces it in toPreserve, but ignores one elsewhere', async () => {
    const document = doc({ appTemplate: entry(['packages/app']) }, ['packages/app/vendor', 'packages/other-app']);
    const result = await computeDeletionPlan(
      'packages/app',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo/packages/app': ['src/index.ts', 'vendor/lib.js'],
      }),
      neverCalledReadFileFn,
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toPreserve).toContain('packages/app/vendor');
    expect(result.toPreserve).not.toContain('packages/other-app');
    expect(result.toDelete).not.toContain('packages/app/vendor/lib.js');
    expect(result.toDelete).toContain('packages/app/src/index.ts');
  });

  it('subtracts the owner\'s own local path: origin folder from toDelete AND surfaces it in toPreserve when it lies beneath the target', async () => {
    // Amended `inst-dp-set-preserve`: the owning template's own local
    // origin folder is the DEVELOPER's own ground (same footing as a
    // `projectOwnedRoots` entry), so — unlike `.frontx` — it is now named
    // back in `toPreserve` when it sits beneath the target being deleted,
    // in addition to already being excluded from effective ownership
    // (and therefore from `toDelete`) by `computeExclusionRoots`.
    const document = doc({ appTemplate: entry(['.'], { origin: 'path:vendor/app-template' }) });
    const result = await computeDeletionPlan(
      '.',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo': ['src/index.ts', 'vendor/app-template/frontx-template.json'],
      }),
      // A `path:` origin, so this DOES reach `readFileFn` (never
      // `inventory.lookup`) — no manifest fixture is registered at this
      // path, so it fails closed to `excludedSubtrees: []`, exactly as
      // `fakeInventory`'s own `excludedSubtrees: []` above already asserted
      // before this checkpoint's fix made that fixture irrelevant here.
      fakeReadFileFn({}),
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toDelete).not.toContain('vendor/app-template/frontx-template.json');
    expect(result.toPreserve).toContain('vendor/app-template');
    expect(result.toDelete).not.toContain('vendor/app-template');
    expect(result.toDelete).toContain('src/index.ts');
  });

  it('does NOT surface the owner\'s own local path: origin folder in toPreserve when it lies OUTSIDE the target', async () => {
    // The containment test (`pathWithinTarget`) must be doing real work —
    // an origin folder that is not beneath the target being deleted is not
    // part of this deletion's blast radius at all, so it has no reason to
    // appear in the report.
    const document = doc({ appTemplate: entry(['packages/app'], { origin: 'path:vendor/app' }) });
    const result = await computeDeletionPlan(
      'packages/app',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo/packages/app': ['src/index.ts'],
      }),
      fakeReadFileFn({}),
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toPreserve).not.toContain('vendor/app');
    expect(result.toDelete).toContain('packages/app/src/index.ts');
  });

  it('adds nothing to toPreserve for a remote (non-path:) origin, since there is no local origin folder to name', async () => {
    // A non-root target sidesteps the unconditional `.git`/`.DS_Store`/
    // `Thumbs.db` reserved-entry terms (surfaced only at the project root
    // in the fixtures above) so this assertion isolates the local-origin
    // term this test is actually about.
    const document = doc({ appTemplate: entry(['packages/app']) }); // default origin: 'github:acme/tmpl@v1'
    const result = await computeDeletionPlan(
      'packages/app',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo/packages/app': ['src/index.ts'],
      }),
      neverCalledReadFileFn,
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toPreserve).toEqual([]);
    expect(result.toDelete).toContain('packages/app/src/index.ts');
  });

  it('never lists `.frontx` in toPreserve, even at the project root — that half of the rule is unchanged', async () => {
    const document = doc({ appTemplate: entry(['.'], { origin: 'path:vendor/app-template' }) });
    const result = await computeDeletionPlan(
      '.',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo': ['src/index.ts', '.frontx/ai/appTemplate/marker.txt'],
      }),
      fakeReadFileFn({}),
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toPreserve).not.toContain('.frontx');
    expect(result.toDelete).not.toContain('.frontx/ai/appTemplate/marker.txt');
    expect(result.toDelete).toContain('src/index.ts');
  });

  // Regression, confirmed LIVE on real disk: deleting a root target used to
  // sweep a DIFFERENT registered template's local origin folder into
  // `toDelete` — genuinely deleting that other template's manifest and
  // installed content even while it was still applied elsewhere. Only the
  // OWNER's own local origin folder was ever excluded; nothing protected an
  // unrelated registered template's origin folder sitting inside the
  // deleting target.
  it('preserves a DIFFERENT registered template\'s local origin folder, never listing it in toDelete', async () => {
    const document = doc({
      appTemplate: entry(['.'], { origin: 'path:vendor/app-template' }),
      nestedTemplate: entry(['nested'], { origin: 'path:vendor/nested-template' }),
    });
    const result = await computeDeletionPlan(
      '.',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: ['nested/'] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo': [
          'src/index.ts',
          'vendor/app-template/frontx-template.json',
          'vendor/nested-template/frontx-template.json',
          'vendor/nested-template/payload.txt',
        ],
      }),
      fakeReadFileFn({}),
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toPreserve).toContain('vendor/nested-template');
    expect(result.toDelete).not.toContain('vendor/nested-template/frontx-template.json');
    expect(result.toDelete).not.toContain('vendor/nested-template/payload.txt');
    expect(result.toDelete).toContain('src/index.ts');
  });

  // Regression: this algorithm's own `inst-dp-compute-ownership` used to
  // re-derive the owning template's declared `excludedSubtrees` via
  // `inventory.lookup(ownerName)` ALONE, which can never find a `path:`
  // (local-origin) template's manifest — that manifest is read directly off
  // disk at register time, bypassing the inventory entirely
  // (`commands/register.ts`'s own `resolveOrigin`). `fakeInventory()` here
  // deliberately does NOT register the name, so this test fails if the
  // production code falls back to `inventory.lookup` instead of reading the
  // local origin's manifest through `readFileFn`.
  it('excludes a declared excludedSubtrees entry from toDelete for a LOCAL (path:-registered) template', async () => {
    const document = doc({ appTemplate: entry(['packages/app'], { origin: 'path:vendor/app' }) });
    const result = await computeDeletionPlan(
      'packages/app',
      '/repo',
      document,
      fakeInventory(), // deliberately does not know "appTemplate" — proves the local-origin path is used
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo/packages/app': ['src/index.ts', 'docs/readme.md'],
      }),
      fakeReadFileFn({
        '/repo/vendor/app/frontx-template.json': JSON.stringify({
          name: 'appTemplate',
          version: '1.0.0',
          excludedSubtrees: ['docs/'],
          description: 'A local template.',
        }),
      }),
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toDelete).toEqual(['packages/app/src/index.ts']);
    expect(result.toPreserve).toContain('packages/app/docs/');
    expect(result.toDelete).not.toContain('packages/app/docs/readme.md');
  });

  it('at the project root (`.`), preserves .git/.DS_Store/Thumbs.db, a nested other template\'s target, and a projectOwnedRoots entry — never listing any of them in toDelete', async () => {
    const document = doc(
      {
        appTemplate: entry(['.']),
        adminTemplate: entry(['admin']),
      },
      ['docs'],
    );
    const result = await computeDeletionPlan(
      '.',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] }, adminTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({
        '/repo': ['src/index.ts', '.git/config', '.DS_Store', 'Thumbs.db', 'admin/index.ts', 'docs/readme.md'],
      }),
      neverCalledReadFileFn,
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toPreserve).toEqual(expect.arrayContaining(['.git', '.DS_Store', 'Thumbs.db', 'admin', 'docs']));
    for (const preserved of ['.git/config', '.DS_Store', 'Thumbs.db', 'admin/index.ts', 'docs/readme.md']) {
      expect(result.toDelete).not.toContain(preserved);
    }
    expect(result.toDelete).toContain('src/index.ts');
  });

  it('resolves an absent target directory to an empty candidate set rather than throwing', async () => {
    const document = doc({ appTemplate: entry(['packages/gone']) });
    const result = await computeDeletionPlan(
      'packages/gone',
      '/repo',
      document,
      fakeInventory({ appTemplate: { excludedSubtrees: [] } }),
      identityCanonicalize,
      fakeListTargetFiles({}),
      neverCalledReadFileFn,
      noUnenumerableEntries,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toDelete).toEqual([]);
  });
});
