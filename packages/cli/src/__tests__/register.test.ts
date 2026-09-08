// @cpt-algo:cpt-frontx-algo-composed-provenance-register:p1
//
// Fixture coverage for `registerTemplate`, against fake `RegisterInventoryPort`
// and project-state seams — decoupled from the real resolver/fetch pipeline
// and from any real filesystem, matching this package's dependency-injection
// test convention (see `project-state/__tests__/io.test.ts`'s own header).
import { describe, expect, it, vi } from 'vitest';
import { registerTemplate } from '../commands/register';
import type { RegisterInventoryPort } from '../commands/register';
import { InventoryState } from '../inventory/types';
import type { InventoryEntry, InventoryResult } from '../inventory/types';
import type { FetchFn, ListFolderFilesFn, PathExistsFn } from '../resolver/types';
import type { ReadFileFn } from '../manifest/types';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import { TemplateInventory } from '../inventory/TemplateInventory';
import { InventoryIndex } from '../inventory/InventoryIndex';
import { InventoryStore } from '../inventory/InventoryStore';

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

function manifestContent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'foo',
    version: '1.0.0',
    excludedSubtrees: [],
    description: 'Establishes the project shell.',
    ...overrides,
  });
}

function fakeInventory(overrides: Partial<RegisterInventoryPort> = {}): RegisterInventoryPort {
  const entry: InventoryEntry = {
    name: 'foo',
    source: 'github:acme/foo@v1.0.0',
    ref: 'v1.0.0',
    status: InventoryState.INSTALLED,
    content: manifestContent(),
  };
  return {
    install: overrides.install ?? (async (): Promise<InventoryResult<{ name: string; ref: string }>> => ({
      ok: true,
      value: { name: entry.name, ref: entry.ref },
    })),
    lookup: overrides.lookup ?? (() => entry),
  };
}

const noopFetch: FetchFn = vi.fn(async () => '');
// Identity: none of these fixtures exercise an escaping or root-resolving
// path, so canonicalization is a pass-through here.
const identityCanonicalize: CanonicalizeTargetFn = (rawTarget) => rawTarget;
const throwingReadFileFn: ReadFileFn = vi.fn(async () => {
  throw new Error('local read not exercised in this fixture');
});
// A local origin's folder is presumed to exist and to hold no files beyond
// the manifest a fixture's own `readFileFn` returns by path — none of the
// REMOTE-origin fixtures below (the majority of this suite) ever reach the
// resolver's local branch at all, and every LOCAL-origin fixture that does
// supplies its own `readFileFn`.
const existsFn: PathExistsFn = vi.fn(async () => true);
const listFolderFilesFn: ListFolderFilesFn = vi.fn(async () => []);

describe('registerTemplate (cpt-frontx-algo-composed-provenance-register)', () => {
  it('creates a new entry for a previously unregistered name', async () => {
    const { read, write, written } = fakeProjectState();
    const inventory = fakeInventory();

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toEqual({
      ok: true,
      outcome: 'created',
      name: 'foo',
      entry: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: [], excludedSubtrees: [] },
    });
    expect(written()?.templates.foo).toEqual({ origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: [], excludedSubtrees: [] });
  });

  it('is a no-op when the resolved origin is the same as the already-recorded one', async () => {
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    });
    const inventory = fakeInventory();

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toEqual({
      ok: true,
      outcome: 'noop',
      name: 'foo',
      entry: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: [] },
    });
  });

  it('refuses a different origin for an already-registered name without --replace', async () => {
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v0.9.0', version: '0.9.0', targets: [] } },
      projectOwnedRoots: [],
    });
    const inventory = fakeInventory();

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toMatchObject({ ok: false, code: 'REGISTRATION_CONFLICT' });
  });

  it('--replace succeeds when the existing entry has no applied targets, clearing any previous entry', async () => {
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: {
        foo: { origin: 'github:acme/foo@v0.9.0', version: '0.9.0', targets: [], previous: { origin: 'github:acme/foo@v0.8.0', version: '0.8.0' } },
      },
      projectOwnedRoots: [],
    });
    const inventory = fakeInventory();

    const result = await registerTemplate('github:acme/foo@v1.0.0', true, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toEqual({
      ok: true,
      outcome: 'replaced',
      name: 'foo',
      entry: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: [], excludedSubtrees: [] },
    });
    expect(written()?.templates.foo).not.toHaveProperty('previous');
  });

  it('--replace is refused with TARGETS_EXIST when the existing entry has applied targets, entry preserved', async () => {
    const existingEntry = { origin: 'github:acme/foo@v0.9.0', version: '0.9.0', targets: ['packages/foo'] };
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { foo: existingEntry },
      projectOwnedRoots: [],
    });
    const inventory = fakeInventory();

    const result = await registerTemplate('github:acme/foo@v1.0.0', true, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toMatchObject({ ok: false, code: 'TARGETS_EXIST', details: { name: 'foo', targets: ['packages/foo'] } });
    expect(write).not.toHaveBeenCalled();
    // entry preserved: re-reading gives back the same document
    const reread = await read('/repo/.frontx/project.json');
    expect(reread && JSON.parse(reread).templates.foo).toEqual(existingEntry);
  });

  it('reports ORIGIN_UNAVAILABLE and writes nothing when install fails', async () => {
    const { read, write } = fakeProjectState();
    const inventory = fakeInventory({
      install: async () => ({ ok: false, error: { message: 'unreachable registry' } }),
    });

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toEqual({ ok: false, code: 'ORIGIN_UNAVAILABLE', message: 'unreachable registry' });
    expect(write).not.toHaveBeenCalled();
  });

  it('reports INVALID_MANIFEST naming "name" when the resolved manifest is missing it', async () => {
    const { read, write } = fakeProjectState();
    const drifted = JSON.parse(manifestContent()) as Record<string, unknown>;
    delete drifted.name;
    const inventory = fakeInventory({
      lookup: () => ({ name: 'foo', source: 'github:acme/foo@v1.0.0', ref: 'v1.0.0', status: InventoryState.INSTALLED, content: JSON.stringify(drifted) }),
    });

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toMatchObject({ ok: false, code: 'INVALID_MANIFEST', details: { field: 'name' } });
    expect(write).not.toHaveBeenCalled();
  });

  it('reports INVALID_MANIFEST naming "version" when the resolved manifest is missing it', async () => {
    const { read, write } = fakeProjectState();
    const drifted = JSON.parse(manifestContent()) as Record<string, unknown>;
    delete drifted.version;
    const inventory = fakeInventory({
      lookup: () => ({ name: 'foo', source: 'github:acme/foo@v1.0.0', ref: 'v1.0.0', status: InventoryState.INSTALLED, content: JSON.stringify(drifted) }),
    });

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toMatchObject({ ok: false, code: 'INVALID_MANIFEST', details: { field: 'version' } });
  });

  it('reports INVALID_MANIFEST naming "description" when the resolved manifest declares it empty', async () => {
    const { read, write } = fakeProjectState();
    const drifted = JSON.parse(manifestContent()) as Record<string, unknown>;
    drifted.description = '   ';
    const inventory = fakeInventory({
      lookup: () => ({ name: 'foo', source: 'github:acme/foo@v1.0.0', ref: 'v1.0.0', status: InventoryState.INSTALLED, content: JSON.stringify(drifted) }),
    });

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toMatchObject({ ok: false, code: 'INVALID_MANIFEST', details: { field: 'description' } });
  });

  // Checkpoint 3+4: `readManifestFromContent` now runs `refuseLegacyManifest`
  // before the four-field contract check, so a resolved manifest carrying an
  // undeclared field is refused here too — naming the undeclared fields
  // rather than the generic "missing name/version/description" message, per
  // this algorithm's own `inst-cpreg-if-invalid-manifest` step.
  it('reports INVALID_MANIFEST naming the undeclared field(s) when the resolved manifest is legacy-shaped', async () => {
    const { read, write } = fakeProjectState();
    const legacy = manifestContent({ schemaVersion: '1.0', ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] } });
    const inventory = fakeInventory({
      lookup: () => ({ name: 'foo', source: 'github:acme/foo@v1.0.0', ref: 'v1.0.0', status: InventoryState.INSTALLED, content: legacy }),
    });

    const result = await registerTemplate('github:acme/foo@v1.0.0', false, '/repo', inventory, noopFetch, throwingReadFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_MANIFEST',
      details: {
        undeclaredFields: expect.arrayContaining(['schemaVersion', 'ownershipBoundaries', 'ownershipBoundaries.exclusiveSubtrees', 'ownershipBoundaries.sharedFiles']),
      },
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('records a local "path:" origin exactly as given, with no install/fetch step', async () => {
    const { read, write, written } = fakeProjectState();
    const inventory: RegisterInventoryPort = {
      install: vi.fn(async () => {
        throw new Error('a local path: origin must never reach TemplateInventory.install');
      }),
      lookup: vi.fn(),
    };
    const readFileFn: ReadFileFn = vi.fn(async (filePath: string) => {
      expect(filePath).toContain('templates/local-foo');
      return manifestContent({ name: 'local-foo' });
    });

    const result = await registerTemplate('path:templates/local-foo', false, '/repo', inventory, noopFetch, readFileFn, identityCanonicalize, read, write, existsFn, listFolderFilesFn);

    expect(result).toEqual({
      ok: true,
      outcome: 'created',
      name: 'local-foo',
      entry: { origin: 'path:templates/local-foo', version: '1.0.0', targets: [], excludedSubtrees: [] },
    });
    expect(written()?.templates['local-foo']?.origin).toBe('path:templates/local-foo');
  });

  // BEHAVIOUR CHANGE (checkpoint: shared local-origin resolver): this used to
  // report `ORIGIN_UNAVAILABLE`, folding "the folder does not exist" and "the
  // folder exists but its manifest cannot be read" into one undifferentiated
  // read failure — `resolveOrigin`'s own local branch read the manifest file
  // directly with no separate existence check at all. The shared resolver
  // (`cpt-frontx-algo-template-resolution-resolve-to-inventory`) now checks
  // existence BEFORE ever attempting to read a manifest
  // (`inst-resolve-local-path-check`/`inst-resolve-local-path-fail`), and the
  // FEATURE's own vocabulary for "names a path that does not exist" is
  // `INVALID_PATH`, not `ORIGIN_UNAVAILABLE` (which the FEATURE reserves for
  // an unreachable REMOTE registry). A non-existent local folder is exactly
  // this case, so the refusal this fixture now names is more precise, not
  // merely different.
  it('refuses INVALID_PATH for a local "path:" origin whose folder does not exist', async () => {
    const { read, write } = fakeProjectState();
    const inventory: RegisterInventoryPort = { install: vi.fn(), lookup: vi.fn() };
    const missingFolderExistsFn: PathExistsFn = vi.fn(async () => false);
    const readFileFn: ReadFileFn = vi.fn(async () => {
      throw new Error('ENOENT: no such file');
    });

    const result = await registerTemplate(
      'path:templates/missing',
      false,
      '/repo',
      inventory,
      noopFetch,
      readFileFn,
      identityCanonicalize,
      read,
      write,
      missingFolderExistsFn,
      listFolderFilesFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PATH' });
    expect(readFileFn).not.toHaveBeenCalled();
  });

  // The companion case: the folder EXISTS but its manifest file is absent or
  // unreadable — the resolver's shared manifest-identity tail
  // (`inst-resolve-identity-missing`) refuses this with `INVALID_MANIFEST`,
  // the same code a corrupt remote manifest already produces.
  it('refuses INVALID_MANIFEST for a local "path:" origin whose folder exists but whose manifest cannot be read', async () => {
    const { read, write } = fakeProjectState();
    const inventory: RegisterInventoryPort = { install: vi.fn(), lookup: vi.fn() };
    const readFileFn: ReadFileFn = vi.fn(async () => {
      throw new Error('ENOENT: no such file');
    });

    const result = await registerTemplate(
      'path:templates/no-manifest',
      false,
      '/repo',
      inventory,
      noopFetch,
      readFileFn,
      identityCanonicalize,
      read,
      write,
      existsFn,
      listFolderFilesFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_MANIFEST' });
  });

  // Regression: a `path:` origin used to reach `readFileFn` with no
  // containment check at all, so `path:../outside-tmpl` silently registered
  // content from outside the project root (confirmed live before this
  // check existed). `INVALID_PATH` is the ADR's own code for a path that
  // fails the CLI's fail-closed canonicalization.
  it('refuses a "path:" origin the canonicalizer cannot prove stays inside the project root, with INVALID_PATH', async () => {
    const { read, write, written } = fakeProjectState();
    const inventory: RegisterInventoryPort = { install: vi.fn(), lookup: vi.fn() };
    const readFileFn: ReadFileFn = vi.fn();
    const escapingCanonicalize: CanonicalizeTargetFn = () => null;

    const result = await registerTemplate(
      'path:../outside-tmpl',
      false,
      '/repo',
      inventory,
      noopFetch,
      readFileFn,
      escapingCanonicalize,
      read,
      write,
      existsFn,
      listFolderFilesFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PATH' });
    expect(readFileFn).not.toHaveBeenCalled();
    expect(written()).toBeNull();
  });

  // Regression: the project root itself must be refused the same way an
  // escape is — a root-spelled origin folder is the sixth term of the
  // effective-ownership subtraction, so it would silently empty the
  // template's own ownership at every target it is applied to.
  //
  // The fake below returns `.`, the spelling the REAL adapter produces for
  // the root (`createFsCanonicalizeTargetFn`, `adapters/fs-project-io.ts`).
  // It used to return `''` — a spelling no adapter emits — so this test
  // passed while `frontx register path:.` was in fact accepted in
  // production. A test double that contradicts its seam's own contract
  // proves nothing about the real path.
  it('refuses a "path:" origin that resolves to the project root itself, with INVALID_PATH', async () => {
    const { read, write, written } = fakeProjectState();
    const inventory: RegisterInventoryPort = { install: vi.fn(), lookup: vi.fn() };
    const readFileFn: ReadFileFn = vi.fn();
    const rootCanonicalize: CanonicalizeTargetFn = () => '.';

    const result = await registerTemplate(
      'path:.',
      false,
      '/repo',
      inventory,
      noopFetch,
      readFileFn,
      rootCanonicalize,
      read,
      write,
      existsFn,
      listFolderFilesFn,
    );

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PATH' });
    expect(readFileFn).not.toHaveBeenCalled();
    expect(written()).toBeNull();
  });
});

describe('registerTemplate — end-to-end pinning through the REAL inventory', () => {
  // Every other test in this file injects a `RegisterInventoryPort` fake, which
  // is right for exercising register's own branches but cannot show what the
  // resolver actually settles on. `inst-resolve-pin` requires the RECORDED
  // origin be the fetch's immutable SHA rather than the typed, possibly-moving
  // ref — and `cpt-frontx-adr-project-upgrade-mechanism` builds its whole
  // baseline story on that ("re-resolving it returns byte-identical content by
  // construction"). Whether the pin survives the full chain
  // (resolver -> TemplateInventory.install -> lookup -> register's
  // `storedOrigin` -> `TemplateEntry.origin`) is therefore worth one real
  // assertion rather than a reading of the code: a break anywhere along it
  // would silently record a moving ref as though it were immutable.
  const SHA = 'a'.repeat(40);

  function manifestFor(name: string): string {
    return JSON.stringify({
      name,
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'Fixture template for the end-to-end pinning assertion.',
    });
  }

  it('records the fetch-settled SHA as templates[name].origin, not the typed ref', async () => {
    const { read, write, written } = fakeProjectState();
    // A real inventory over in-memory index/store — no port fake, so the
    // resolver's own pinning decision is what reaches the project state.
    const inventory = new TemplateInventory(new InventoryIndex(), new InventoryStore());
    // A pin-reporting fetch, exactly as `github-fetch.ts` now reports one.
    const pinningFetch = vi.fn(async (_url: string) => ({ content: manifestFor('foo'), pinnedRef: SHA }));

    const result = await registerTemplate(
      'github:acme/foo@main',
      false,
      '/repo',
      inventory,
      pinningFetch,
      throwingReadFileFn,
      identityCanonicalize,
      read,
      write,
      existsFn,
      listFolderFilesFn,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The typed ref was `@main`; the recorded origin must carry the SHA.
    expect(result.entry.origin).toBe(`github:acme/foo@${SHA}`);
    expect(result.entry.origin).not.toContain('@main');
    expect(written()?.templates.foo?.origin).toBe(`github:acme/foo@${SHA}`);
    // The FETCH still addressed the typed ref — pinning records, it does not
    // redirect what was fetched.
    expect(pinningFetch.mock.calls[0]?.[0]).toContain('main');
  });

  it('falls back to the typed ref when the fetch reports no pin, rather than inventing one', async () => {
    const { read, write, written } = fakeProjectState();
    const inventory = new TemplateInventory(new InventoryIndex(), new InventoryStore());
    // A bare-string fetch — the narrower, still-valid realization of the seam
    // (`local-fetch.ts` is one), reporting no pin at all.
    const unpinnedFetch = vi.fn(async () => manifestFor('foo'));

    const result = await registerTemplate(
      'github:acme/foo@v1.0.0',
      false,
      '/repo',
      inventory,
      unpinnedFetch,
      throwingReadFileFn,
      identityCanonicalize,
      read,
      write,
      existsFn,
      listFolderFilesFn,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.origin).toBe('github:acme/foo@v1.0.0');
    expect(written()?.templates.foo?.origin).toBe('github:acme/foo@v1.0.0');
  });
});
