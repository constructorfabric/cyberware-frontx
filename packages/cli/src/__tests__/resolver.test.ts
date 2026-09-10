// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
import { describe, it, expect, vi } from 'vitest';
import { resolveToInventory } from '../resolver/resolve';
import { BUNDLE_MARKER } from '../bundle/envelope';
import type { StructuredRef } from '../spec-parser/types';
import type { FetchFn, ListFolderFilesFn, LocalOriginDeps, PathExistsFn, ReadFolderFileFn } from '../resolver/types';
import type { TemplateManifest } from '../manifest/types';
import { MANIFEST_FILENAME } from '../manifest/types';
import { NotRegularFileError } from '../adapters/fs-project-io';

const validRef: StructuredRef = {
  host: 'github',
  owner: 'acme',
  repo: 'my-template',
  ref: 'v1.2.0',
};

// A contract-valid manifest, serialized to the string a `FetchFn` returns.
// The identity ("widget-kit") is deliberately different from `validRef.repo`
// ("my-template") so a test asserting on it proves identity is read from the
// manifest rather than inherited from the repository segment.
function manifestContent(name: string, version = '1.0.0'): string {
  const manifest: TemplateManifest = {
    name,
    version,
    excludedSubtrees: [],
    description: 'Fixture template for resolve-to-inventory tests.',
  };
  return JSON.stringify(manifest);
}

describe('resolveToInventory', () => {
  // inst-resolve-fetch-fail-check, inst-resolve-fetch-fail
  it('unreachable registry aborts before inventory write', async () => {
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await resolveToInventory({ kind: 'remote', ref: validRef }, { fetchFn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/fetch|network|unreachable/i);
  });

  // inst-resolve-name, inst-resolve-addr, inst-resolve-fetch,
  // inst-resolve-write, inst-resolve-index, inst-resolve-return
  it('successful fetch returns inventory-ready record identified by the manifest, not the repository', async () => {
    const content = manifestContent('widget-kit');
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(content);
    const result = await resolveToInventory({ kind: 'remote', ref: validRef }, { fetchFn });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('widget-kit');
    expect(result.value.ref).toBe('v1.2.0');
    expect(result.value.content).toBe(content);
    // inst-resolve-pin — a `FetchFn` that reports no pin at all (a bare
    // string return, exactly like `adapters/local-fetch.ts`) falls back to
    // today's pre-existing behavior: the typed ref, recorded honestly
    // unpinned, rather than failing or fabricating one.
    expect(result.value.source).toBe('github:acme/my-template@v1.2.0');
  });

  // inst-resolve-pin — a `FetchFn` that DOES report a pin (the shape
  // `adapters/github-fetch.ts` produces) has that pin recorded as the
  // resolved `source` instead of the typed ref, while the fetch itself is
  // still addressed to the typed ref (the pin cannot be known before the
  // fetch that settles it returns).
  it('a fetch reporting a pinned ref records that pin as the source, never the typed ref, while still fetching the typed ref', async () => {
    const content = manifestContent('widget-kit');
    const pinnedRef = '1234567890123456789012345678901234567890';
    const fetchFn: FetchFn = vi.fn().mockResolvedValue({ content, pinnedRef });

    const result = await resolveToInventory({ kind: 'remote', ref: validRef }, { fetchFn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('widget-kit');
    expect(result.value.source).toBe(`github:acme/my-template@${pinnedRef}`);
    expect(fetchFn).toHaveBeenCalledWith('https://api.github.com/repos/acme/my-template/tarball/v1.2.0');
  });

  // inst-resolve-fetch-fail — no partial state on failure
  it('fetch failure returns resolution error (no partial state)', async () => {
    const fetchFn: FetchFn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
    const result = await resolveToInventory({ kind: 'remote', ref: validRef }, { fetchFn });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // No partial record fields
    expect((result as { value?: unknown }).value).toBeUndefined();
  });

  // inst-resolve-if-legacy-manifest / inst-resolve-legacy-manifest-fail —
  // wired this checkpoint: `readManifestFromContent` now runs
  // `refuseLegacyManifest` before the four-field contract check, so a
  // resolved template declaring an undeclared field (schemaVersion,
  // ownershipBoundaries, referencedTemplates) is refused with
  // INVALID_MANIFEST naming every undeclared field, and nothing is written
  // to local inventory (this function itself never writes; the assertion
  // below is that no inventory-ready record is returned for a caller to
  // write from).
  it('a legacy-shaped resolved manifest is refused with INVALID_MANIFEST naming the undeclared fields, writing nothing to inventory', async () => {
    const legacyManifest = JSON.stringify({
      name: 'widget-kit',
      version: '1.0.0',
      schemaVersion: '1.0',
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
      description: 'Fixture template declaring the retired shape.',
    });
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(legacyManifest);

    const result = await resolveToInventory({ kind: 'remote', ref: validRef }, { fetchFn });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_MANIFEST');
    expect(result.error.undeclaredFields).toEqual(
      expect.arrayContaining(['schemaVersion', 'ownershipBoundaries', 'ownershipBoundaries.exclusiveSubtrees', 'ownershipBoundaries.sharedFiles']),
    );
    expect((result as { value?: unknown }).value).toBeUndefined();
  });

  // inst-resolve-host-unsupported / inst-resolve-host-unsupported-fail: a
  // well-formed reference naming a host this resolver carries no fetch
  // adapter for is refused with INVALID_INPUT, BEFORE any fetch is attempted
  // — never fabricating an address and never reaching `inst-resolve-pin`'s
  // unpinned-origin fallback for a host that was never going to be pinnable.
  it('refuses INVALID_INPUT for a well-formed reference naming an unsupported host, never calling fetch or writing to inventory', async () => {
    const unsupportedRef: StructuredRef = { host: 'gitlab', owner: 'acme', repo: 'tpl', ref: 'v1.0.0' };
    const fetchFn: FetchFn = vi.fn(async () => {
      throw new Error('fetchFn must not be called for an unsupported host');
    });

    const result = await resolveToInventory({ kind: 'remote', ref: unsupportedRef }, { fetchFn });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toMatch(/gitlab/);
    expect(result.error.message).toMatch(/github/);
    // The refusal happens before any fetch — asserted explicitly, not merely
    // inferred from the error code, since a fabricated-address fetch that
    // happened to also fail would produce the same code with no proof the
    // address was never built.
    expect(fetchFn).not.toHaveBeenCalled();
    expect((result as { value?: unknown }).value).toBeUndefined();
  });

  // Guard against an over-broad refusal: `github` — the one host this
  // resolver does carry a fetch adapter for — must keep resolving exactly as
  // before. Already exercised by "successful fetch returns inventory-ready
  // record..." and "a fetch reporting a pinned ref..." above (both use
  // `validRef`, `host: 'github'`), restated here as its own named case so a
  // future host-support regression fails a test that says so directly.
  it('a github reference still resolves exactly as before', async () => {
    const content = manifestContent('widget-kit');
    const fetchFn: FetchFn = vi.fn().mockResolvedValue(content);

    const result = await resolveToInventory({ kind: 'remote', ref: validRef }, { fetchFn });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('widget-kit');
    expect(fetchFn).toHaveBeenCalledWith('https://api.github.com/repos/acme/my-template/tarball/v1.2.0');
  });
});

// @cpt-begin:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-origin-kind-check
// Fixture coverage for the local `path:<relative-path>` origin branch —
// `inst-resolve-origin-kind-check`, `inst-resolve-local-path-check`,
// `inst-resolve-local-path-fail-check`/`-fail`, `inst-resolve-local-path-
// read`, `inst-resolve-local-path-continue`. Every dependency is faked (no
// real filesystem), matching this suite's own remote-branch convention above.
//
// `inst-resolve-host-unsupported` lives entirely inside `resolveRemoteOrigin`
// and this branch never calls it — every case below uses `noopFetch`, which
// throws if invoked, so a local origin remaining unaffected by the new
// host-support refusal is proven the same way the rest of this branch's
// fetch-independence already is: the fetch adapter is never reached at all.
describe('resolveToInventory — local "path:" origin', () => {
  // A minimal local folder: canonicalizeFn is a pass-through, the folder
  // "exists", and `files` (relative path -> content) is what
  // `listFolderFilesFn`/`readFolderFileFn` serve.
  function localDeps(files: Record<string, string>, overrides: Partial<LocalOriginDeps> = {}): LocalOriginDeps {
    const existsFn: PathExistsFn = overrides.existsFn ?? (async () => true);
    const listFolderFilesFn: ListFolderFilesFn = overrides.listFolderFilesFn ?? (async () => Object.keys(files));
    const readFolderFileFn: ReadFolderFileFn =
      overrides.readFolderFileFn ??
      (async (absolutePath: string) => {
        for (const [relativePath, content] of Object.entries(files)) {
          if (absolutePath.endsWith(relativePath)) return content;
        }
        throw new Error(`no fixture content for ${absolutePath}`);
      });
    return {
      repoRoot: overrides.repoRoot ?? '/repo',
      canonicalizeFn: overrides.canonicalizeFn ?? ((rawPath: string) => rawPath),
      existsFn,
      listFolderFilesFn,
      readFolderFileFn,
    };
  }

  const noopFetch: FetchFn = vi.fn(async () => {
    throw new Error('fetchFn must not be called for a local origin');
  });

  // inst-resolve-local-path-continue: identity + unpinned origin + the
  // folder's own content, wrapped as the shared bundle envelope.
  it('resolves a local origin to its identity, an unpinned origin recorded exactly as given, and the folder\'s content', async () => {
    const files = {
      [MANIFEST_FILENAME]: manifestContent('widget-kit'),
      'README.md': '# widget-kit',
    };
    const result = await resolveToInventory(
      { kind: 'local', origin: 'path:templates/widget-kit' },
      { fetchFn: noopFetch, local: localDeps(files) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('widget-kit');
    // Unpinned: recorded EXACTLY as given, never rewritten.
    expect(result.value.source).toBe('path:templates/widget-kit');
    expect(result.value.ref).toBe('');
    const bundle = JSON.parse(result.value.content) as Record<string, Record<string, string>>;
    expect(bundle[BUNDLE_MARKER][MANIFEST_FILENAME]).toBe(files[MANIFEST_FILENAME]);
    expect(bundle[BUNDLE_MARKER]['README.md']).toBe('# widget-kit');
  });

  // inst-resolve-local-path-fail-check / -fail: an escaping path.
  it('refuses INVALID_PATH for a path the canonicalizer cannot prove stays inside the project root', async () => {
    const result = await resolveToInventory(
      { kind: 'local', origin: 'path:../outside' },
      { fetchFn: noopFetch, local: localDeps({}, { canonicalizeFn: () => null }) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PATH');
  });

  // The project root itself: refused alongside an escape, since a
  // root-spelled local origin folder would later subtract everything from
  // its own template's effective ownership — the resolver's OWN containment
  // check, not left to each of its three callers to duplicate.
  it('refuses INVALID_PATH for a path canonicalizing to the project root', async () => {
    const existsFn = vi.fn(async () => true);
    const result = await resolveToInventory(
      { kind: 'local', origin: 'path:.' },
      { fetchFn: noopFetch, local: localDeps({}, { canonicalizeFn: () => '.', existsFn }) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PATH');
    // The root is refused by canonicalization alone; existence is never
    // even consulted for it.
    expect(existsFn).not.toHaveBeenCalled();
  });

  // inst-resolve-local-path-check's "and confirm it exists" clause: a
  // canonical, in-root path that simply is not there.
  it('refuses INVALID_PATH for a canonical path that does not exist', async () => {
    const readFolderFileFn = vi.fn();
    const result = await resolveToInventory(
      { kind: 'local', origin: 'path:templates/missing' },
      { fetchFn: noopFetch, local: localDeps({}, { existsFn: async () => false, readFolderFileFn }) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PATH');
    expect(readFolderFileFn).not.toHaveBeenCalled();
  });

  // inst-resolve-if-legacy-manifest, run identically for a local origin: the
  // shared manifest-identity tail refuses a legacy-shaped local manifest the
  // same way it already refuses one fetched remotely.
  it('a legacy-shaped manifest in a local folder is refused, naming the undeclared fields', async () => {
    const legacyManifest = JSON.stringify({
      name: 'widget-kit',
      version: '1.0.0',
      schemaVersion: '1.0',
      description: 'Fixture template declaring the retired shape.',
    });
    const listFolderFilesFn = vi.fn(async () => [MANIFEST_FILENAME, 'other.txt']);
    const result = await resolveToInventory(
      { kind: 'local', origin: 'path:templates/widget-kit' },
      {
        fetchFn: noopFetch,
        local: localDeps({ [MANIFEST_FILENAME]: legacyManifest }, { listFolderFilesFn }),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_MANIFEST');
    expect(result.error.undeclaredFields).toEqual(expect.arrayContaining(['schemaVersion']));
    // The manifest is validated BEFORE the rest of the folder is enumerated:
    // a legacy/invalid manifest short-circuits without ever walking the
    // folder's other content.
    expect(listFolderFilesFn).not.toHaveBeenCalled();
  });

  // inst-resolve-identity-missing, for a local origin whose manifest is
  // absent or unreadable — folded into the shared tail's own INVALID_MANIFEST
  // refusal, exactly as an unparseable remote manifest already is.
  it('refuses INVALID_MANIFEST for a local folder whose manifest is absent or unreadable', async () => {
    const listFolderFilesFn = vi.fn();
    const result = await resolveToInventory(
      { kind: 'local', origin: 'path:templates/no-manifest' },
      {
        fetchFn: noopFetch,
        local: localDeps(
          {},
          {
            readFolderFileFn: async () => {
              throw new Error('ENOENT: no such file');
            },
            listFolderFilesFn,
          },
        ),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_MANIFEST');
    expect(listFolderFilesFn).not.toHaveBeenCalled();
  });

  // The regression this pins: a FIFO (or any other typed refusal) standing
  // at the manifest path used to be swallowed identically to genuine
  // absence — `manifestText = ''` — which then reported "manifest is
  // unparseable: invalid JSON" downstream even though NOTHING was ever
  // parsed; the manifest was never read at all. A typed refusal now short-
  // circuits with `CONTENT_CONFLICT`, naming what actually stood in the way,
  // rather than being handed to the shared identity tail as if the folder
  // had simply never had a manifest. Genuine absence (a plain, untyped
  // `Error`, exactly as the sibling test above already fixtures it) still
  // falls through to that shared tail unchanged — this fix widens what is
  // refused, it does not narrow what is tolerated.
  it('refuses CONTENT_CONFLICT, naming what actually blocked the read, when the local manifest read throws a typed refusal', async () => {
    const listFolderFilesFn = vi.fn();
    const typedError = new NotRegularFileError('/repo/templates/widget-kit/frontx-template.json', 'fifo');
    const result = await resolveToInventory(
      { kind: 'local', origin: 'path:templates/widget-kit' },
      {
        fetchFn: noopFetch,
        local: localDeps(
          {},
          {
            readFolderFileFn: async () => {
              throw typedError;
            },
            listFolderFilesFn,
          },
        ),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONTENT_CONFLICT');
    expect(result.error.message).toContain(typedError.message);
    // The manifest read short-circuits before the rest of the folder is ever
    // walked, exactly as the legacy-manifest and absent-manifest cases above.
    expect(listFolderFilesFn).not.toHaveBeenCalled();
  });
});
// @cpt-end:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1:inst-resolve-origin-kind-check
