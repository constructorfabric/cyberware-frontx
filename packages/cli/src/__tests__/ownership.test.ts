// @cpt-algo:cpt-frontx-algo-composed-provenance-ownership-add:p1
// @cpt-algo:cpt-frontx-algo-composed-provenance-ownership-remove:p1
// @cpt-flow:cpt-frontx-flow-composed-provenance-ownership-list:p1
import { describe, expect, it, vi } from 'vitest';
import { ownershipAdd, ownershipList, ownershipRemove } from '../commands/ownership';
import type { OwnershipInventoryPort } from '../commands/ownership';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry } from '../inventory/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { TargetPathState } from '../commands/add-template';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';
import type { ReadFileFn } from '../manifest/types';

function fakeProjectState(initial: ProjectStateDocument | null = null): {
  read: ReadProjectStateFn;
  write: WriteProjectStateFn;
  written: () => ProjectStateDocument | null;
} {
  let stored = initial ? JSON.stringify(initial) : null;
  const write: WriteProjectStateFn = vi.fn(async (_absolutePath, content) => {
    stored = content;
  });
  return {
    read: async () => stored,
    write,
    written: () => (stored ? (JSON.parse(stored) as ProjectStateDocument) : null),
  };
}

// Every fixture below is already a well-formed project-relative POSIX path,
// so canonicalization is the identity — mirrors `conflict-check.test.ts`'s
// own fake seam for the same reason.
const identityCanonicalize: CanonicalizeTargetFn = (rawTarget) => rawTarget;

function targetStateFn(existingPaths: Set<string>): (absolutePath: string) => Promise<TargetPathState> {
  return async (absolutePath: string) => (existingPaths.has(absolutePath) ? 'directory' : 'absent');
}

// None of the fixtures below register a `path:` (local) origin, so this
// fake is never actually invoked — kept failing rather than a harmless
// stub so a fixture that starts using a local origin without also wiring a
// real `readFileFn` fails loudly instead of silently re-introducing the
// exact `inventory.lookup`-only bug this checkpoint fixed.
const neverCalledReadFileFn: ReadFileFn = async () => {
  throw new Error('readFileFn should not be called for a remote-origin fixture');
};

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

function fakeInventory(manifestsByName: Record<string, { excludedSubtrees: string[] }> = {}): OwnershipInventoryPort {
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

describe('ownershipAdd (cpt-frontx-algo-composed-provenance-ownership-add)', () => {
  it('refuses with INVALID_PATH when the path does not exist on disk', async () => {
    const { read, write, written } = fakeProjectState();
    const result = await ownershipAdd(
      'docs/missing',
      '/repo',
      fakeInventory(),
      targetStateFn(new Set()),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PATH', details: { path: 'docs/missing' } });
    expect(written()).toBeNull();
  });

  // `.` is a legitimate, addressable target — the project root itself,
  // canonicalized to `.` (never `""`, which is reserved for what every
  // containment predicate this command's geometry check depends on already
  // treats as "addresses no location" for a declaration). Root is an
  // ancestor of every applied target, so it correctly conflicts here.
  it('refuses with TARGET_CONFLICT when the path resolves to the project root and something is already applied', async () => {
    const existingPaths = new Set(['/repo']);
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: { app: { origin: 'github:acme/app@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const rootCanonicalize: CanonicalizeTargetFn = () => '.';

    const result = await ownershipAdd(
      '.',
      '/repo',
      fakeInventory({ app: { excludedSubtrees: [] } }),
      targetStateFn(existingPaths),
      rootCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'TARGET_CONFLICT' });
    expect(write).not.toHaveBeenCalled();
    expect(written()?.projectOwnedRoots).toEqual([]);
  });

  it('succeeds in marking the project root itself as project-owned when nothing is applied yet', async () => {
    const existingPaths = new Set(['/repo']);
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: {},
      projectOwnedRoots: [],
    });
    const rootCanonicalize: CanonicalizeTargetFn = () => '.';

    const result = await ownershipAdd(
      '.',
      '/repo',
      fakeInventory(),
      targetStateFn(existingPaths),
      rootCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toEqual({ ok: true, outcome: 'added', path: '.', projectOwnedRoots: ['.'] });
    expect(written()?.projectOwnedRoots).toEqual(['.']);
  });

  it('refuses with TARGET_CONFLICT when the path coincides with an applied target', async () => {
    const existingPaths = new Set(['/repo/packages/app']);
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { app: { origin: 'github:acme/app@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });

    const result = await ownershipAdd(
      'packages/app',
      '/repo',
      fakeInventory({ app: { excludedSubtrees: [] } }),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'TARGET_CONFLICT', details: { path: 'packages/app' } });
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses with TARGET_CONFLICT when the path is an ANCESTOR of an applied target', async () => {
    const existingPaths = new Set(['/repo/packages']);
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { app: { origin: 'github:acme/app@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });

    const result = await ownershipAdd(
      'packages',
      '/repo',
      fakeInventory({ app: { excludedSubtrees: [] } }),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'TARGET_CONFLICT', details: { path: 'packages' } });
    expect(write).not.toHaveBeenCalled();
  });

  // The regression that matters: reusing the assembly Conflict Checker's
  // both-directions containment rule used to refuse EXACTLY the case
  // `ownership add` exists to serve — protecting a developer file that lives
  // inside a template's own target (FEATURE composed-provenance,
  // `inst-cpoadd-if-conflict`; PRD `cpt-frontx-fr-cli-ownership-management`).
  // A strict descendant of an applied target must be accepted.
  it('accepts a path that is a strict DESCENDANT of an applied target (direct child)', async () => {
    const existingPaths = new Set(['/repo/app/mine']);
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: { t: { origin: 'github:acme/t@v1.0.0', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });

    const result = await ownershipAdd(
      'app/mine',
      '/repo',
      fakeInventory({ t: { excludedSubtrees: [] } }),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toEqual({ ok: true, outcome: 'added', path: 'app/mine', projectOwnedRoots: ['app/mine'] });
    expect(written()?.projectOwnedRoots).toEqual(['app/mine']);
  });

  it('accepts a path that is a strict DESCENDANT of an applied target (several levels deep)', async () => {
    const existingPaths = new Set(['/repo/app/a/b/c']);
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: { t: { origin: 'github:acme/t@v1.0.0', version: '1.0.0', targets: ['app'] } },
      projectOwnedRoots: [],
    });

    const result = await ownershipAdd(
      'app/a/b/c',
      '/repo',
      fakeInventory({ t: { excludedSubtrees: [] } }),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toEqual({ ok: true, outcome: 'added', path: 'app/a/b/c', projectOwnedRoots: ['app/a/b/c'] });
    expect(written()?.projectOwnedRoots).toEqual(['app/a/b/c']);
  });

  // Under the old both-directions rule this case was unreachable: a template
  // applied at the project root (`.`) makes EVERY path a descendant of `.`,
  // so `ownership add` could never succeed at all for such a project. The
  // one-direction rule fixes exactly this.
  it('accepts a path when a template is applied at the project root itself', async () => {
    const existingPaths = new Set(['/repo/docs']);
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: { shell: { origin: 'github:acme/shell@v1.0.0', version: '1.0.0', targets: ['.'] } },
      projectOwnedRoots: [],
    });

    const result = await ownershipAdd(
      'docs',
      '/repo',
      fakeInventory({ shell: { excludedSubtrees: [] } }),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toEqual({ ok: true, outcome: 'added', path: 'docs', projectOwnedRoots: ['docs'] });
    expect(written()?.projectOwnedRoots).toEqual(['docs']);
  });

  it('appends a free path to projectOwnedRoots, touching no file', async () => {
    const existingPaths = new Set(['/repo/docs']);
    const { read, write, written } = fakeProjectState();

    const result = await ownershipAdd(
      'docs',
      '/repo',
      fakeInventory(),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toEqual({ ok: true, outcome: 'added', path: 'docs', projectOwnedRoots: ['docs'] });
    expect(written()?.projectOwnedRoots).toEqual(['docs']);
  });

  it('is a no-op when the path is already present in projectOwnedRoots', async () => {
    const existingPaths = new Set(['/repo/docs']);
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: {},
      projectOwnedRoots: ['docs'],
    });

    const result = await ownershipAdd(
      'docs',
      '/repo',
      fakeInventory(),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toEqual({ ok: true, outcome: 'noop', path: 'docs', projectOwnedRoots: ['docs'] });
    // no write performed on the no-op path
    expect(written()).toEqual({ formatVersion: 1, templates: {}, projectOwnedRoots: ['docs'] });
  });

  it('permits a path nested inside an applied target that is declared as an excludedSubtrees exemption', async () => {
    const existingPaths = new Set(['/repo/packages/app/nested']);
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { app: { origin: 'github:acme/app@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });

    const result = await ownershipAdd(
      'packages/app/nested',
      '/repo',
      fakeInventory({ app: { excludedSubtrees: ['nested/'] } }),
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toMatchObject({ ok: true, outcome: 'added' });
  });

  // Regression: `buildRecordedTargets` used to re-derive a registered name's
  // current `excludedSubtrees` via `inventory.lookup(name)` ALONE, which can
  // never find a `path:` (local-origin) template's manifest — that manifest
  // is read directly off disk at register time, bypassing the inventory
  // entirely (`commands/register.ts`'s own `resolveOrigin`). Confirmed live:
  // this silently defaulted the exclusion to `[]`, wrongly refusing a path
  // the local template's manifest explicitly permits. `fakeInventory()` here
  // deliberately does NOT register the name, so this test fails if the
  // production code falls back to `inventory.lookup` instead of reading the
  // local origin's manifest through `readFileFn`.
  it('permits a path nested inside a LOCAL (path:-registered) applied target declared as an excludedSubtrees exemption', async () => {
    const existingPaths = new Set(['/repo/packages/app/nested']);
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { app: { origin: 'path:vendor/app', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const readFileFn = fakeReadFileFn({
      '/repo/vendor/app/frontx-template.json': JSON.stringify({
        name: 'app',
        version: '1.0.0',
        excludedSubtrees: ['nested/'],
        description: 'A local template.',
      }),
    });

    const result = await ownershipAdd(
      'packages/app/nested',
      '/repo',
      fakeInventory(), // deliberately does not know "app" — proves the local-origin path is used
      targetStateFn(existingPaths),
      identityCanonicalize,
      read,
      write,
      readFileFn,
    );

    expect(result).toMatchObject({ ok: true, outcome: 'added' });
  });

  it('refuses with INVALID_PATH when canonicalization proves the path escapes the project root', async () => {
    const escapingCanonicalize: CanonicalizeTargetFn = () => null;
    const { read, write } = fakeProjectState();

    const result = await ownershipAdd(
      '../outside',
      '/repo',
      fakeInventory(),
      targetStateFn(new Set(['/repo/../outside'])),
      escapingCanonicalize,
      read,
      write,
      neverCalledReadFileFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PATH' });
  });
});

describe('ownershipRemove (cpt-frontx-algo-composed-provenance-ownership-remove)', () => {
  it('removes a path present in projectOwnedRoots without touching any file', async () => {
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: {},
      projectOwnedRoots: ['docs', 'assets'],
    });

    const result = await ownershipRemove('docs', '/repo', identityCanonicalize, read, write);

    expect(result).toEqual({ ok: true, path: 'docs', projectOwnedRoots: ['assets'] });
    expect(written()?.projectOwnedRoots).toEqual(['assets']);
  });

  it('is a no-op when the path is not present in projectOwnedRoots', async () => {
    const { read, write } = fakeProjectState({ formatVersion: 1, templates: {}, projectOwnedRoots: ['assets'] });

    const result = await ownershipRemove('docs', '/repo', identityCanonicalize, read, write);

    expect(result).toEqual({ ok: true, path: 'docs', projectOwnedRoots: ['assets'] });
  });

  // Regression: `ownership add ./docs` stores the CANONICAL spelling
  // (`docs`), and `ownership remove ./docs` used to remove nothing at all —
  // it reported `ok: true` while `docs` stayed in `projectOwnedRoots`,
  // confirmed live before this canonicalization existed.
  it('removes the stored canonical entry even when the developer types an equivalent, non-canonical spelling', async () => {
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: {},
      projectOwnedRoots: ['docs'],
    });
    const canonicalizeToDocs: CanonicalizeTargetFn = () => 'docs';

    const result = await ownershipRemove('./docs', '/repo', canonicalizeToDocs, read, write);

    expect(result).toEqual({ ok: true, path: 'docs', projectOwnedRoots: [] });
    expect(written()?.projectOwnedRoots).toEqual([]);
  });

  // Regression: a path removed from disk since it was added can no longer
  // be canonicalized (a real `CanonicalizeTargetFn` returns `null` for a
  // dangling reference) — the stale entry must still be removable by its
  // own stored spelling, since `remove` has no error scenario at all.
  it('falls back to the raw spelling when canonicalization fails, so a stale entry for deleted ground stays removable', async () => {
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: {},
      projectOwnedRoots: ['docs'],
    });
    const failingCanonicalize: CanonicalizeTargetFn = () => null;

    const result = await ownershipRemove('docs', '/repo', failingCanonicalize, read, write);

    expect(result).toEqual({ ok: true, path: 'docs', projectOwnedRoots: [] });
    expect(written()?.projectOwnedRoots).toEqual([]);
  });
});

describe('ownershipList (cpt-frontx-flow-composed-provenance-ownership-list)', () => {
  it('returns an empty array when no document exists yet', async () => {
    const { read } = fakeProjectState(null);
    const result = await ownershipList('/repo', read);
    expect(result).toEqual({ ok: true, projectOwnedRoots: [] });
  });

  it('returns the current projectOwnedRoots for a populated document', async () => {
    const { read } = fakeProjectState({ formatVersion: 1, templates: {}, projectOwnedRoots: ['docs', 'assets'] });
    const result = await ownershipList('/repo', read);
    expect(result).toEqual({ ok: true, projectOwnedRoots: ['docs', 'assets'] });
  });

  it('refuses with PROJECT_INVALID when the document cannot be parsed', async () => {
    const read: ReadProjectStateFn = vi.fn(async () => '{ not valid json');
    const result = await ownershipList('/repo', read);
    expect(result).toMatchObject({ ok: false, code: 'PROJECT_INVALID' });
  });
});
