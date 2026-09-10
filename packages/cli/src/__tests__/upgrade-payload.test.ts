// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
//
// Fixture coverage for `createResolvePayloadFn`/`versionMatchesRecorded`
// (`../upgrade/payload.ts`), against fake `ReadFileFn`/`ListDiskFilesFn`/
// `CanonicalizeTargetFn`/`FetchFn` seams — no real filesystem, no real
// network, matching this package's dependency-injection test convention
// (see `register.test.ts` and `assembler.test.ts`'s own headers).
import { describe, expect, it, vi } from 'vitest';
import { createResolvePayloadFn, versionMatchesRecorded } from '../upgrade/payload';
import type { ResolvePayloadDeps } from '../upgrade/payload';
import { BUNDLE_MARKER } from '../bundle/envelope';
import { MANIFEST_FILENAME, isTemplatePayloadPath } from '../manifest/types';
import { TemplateInventory } from '../inventory/TemplateInventory';
import type { ResolvedPayload } from '../upgrade/types';

function manifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'shell',
    version: '1.0.0',
    excludedSubtrees: [],
    description: 'Fixture template for payload resolution tests.',
    ...overrides,
  });
}

// Every deps field defaults to a stub that fails loudly if a test relies on
// a branch it did not deliberately configure — matching `assembler.test.ts`'s
// own `makeDeps` convention. `readFileFn` now reads EVERY local file
// (manifest included) — the resolver's own `ReadFolderFileFn` seam — since
// `resolveLocalPayload` no longer carries a second, payload-only reader.
function fakeDeps(overrides: Partial<ResolvePayloadDeps> = {}): ResolvePayloadDeps {
  return {
    repoRoot: '/repo',
    fetchFn:
      overrides.fetchFn ??
      vi.fn(async () => {
        throw new Error('fetchFn not stubbed for this test');
      }),
    readFileFn:
      overrides.readFileFn ??
      vi.fn(async () => {
        throw new Error('readFileFn not stubbed for this test');
      }),
    listDiskFiles:
      overrides.listDiskFiles ??
      vi.fn(async () => {
        throw new Error('listDiskFiles not stubbed for this test');
      }),
    existsFn: overrides.existsFn ?? vi.fn(async () => true),
    canonicalizeFn:
      overrides.canonicalizeFn ??
      vi.fn(() => {
        throw new Error('canonicalizeFn not stubbed for this test');
      }),
  };
}

describe('createResolvePayloadFn — local "path:" origin', () => {
  it('reads the manifest, collects payload files, and takes name/version/excludedSubtrees from the manifest, recording origin exactly as given', async () => {
    const manifest = manifestJson({ name: 'shell', version: '2.3.0', excludedSubtrees: ['nested/'] });
    // `readFileFn` now reads EVERY file the resolver's local branch
    // enumerates (manifest included) — the resolver's own `ReadFolderFileFn`
    // seam, reused here in place of the retired, payload-only
    // `readPayloadFileFn`.
    const readFileFn = vi.fn(async (p: string) => {
      if (p === '/repo/templates/shell/frontx-template.json') return manifest;
      if (p.endsWith('README.md')) return '# hello';
      if (p.endsWith('src/index.ts')) return 'export {}';
      throw new Error(`unexpected read: ${p}`);
    });
    const listDiskFiles = vi.fn(async (dir: string) => {
      expect(dir).toBe('/repo/templates/shell');
      return ['frontx-template.json', 'README.md', 'src/index.ts'];
    });
    const deps = fakeDeps({ canonicalizeFn: (raw) => raw, readFileFn, listDiskFiles });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('path:templates/shell');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.name).toBe('shell');
    expect(result.payload.version).toBe('2.3.0');
    expect(result.payload.excludedSubtrees).toEqual(['nested/']);
    // A local origin has nothing external to pin against — it is recorded
    // exactly as given (the module's own header comment, `payload.ts:213-216`).
    expect(result.payload.origin).toBe('path:templates/shell');
    expect(Object.fromEntries(result.payload.files)).toEqual({
      'README.md': '# hello',
      'src/index.ts': 'export {}',
    });
  });

  it('never includes the manifest file itself in the resolved payload', async () => {
    const deps = fakeDeps({
      canonicalizeFn: (raw) => raw,
      readFileFn: vi.fn(async () => manifestJson()),
      listDiskFiles: vi.fn(async () => ['frontx-template.json']),
    });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('path:templates/shell');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.files.has(MANIFEST_FILENAME)).toBe(false);
    expect(result.payload.files.size).toBe(0);
  });

  // A payload excludes the CLI-owned `.frontx` namespace root wholesale
  // (`payload.ts:66-79`), but the exclusion is a WHOLE-SEGMENT comparison,
  // never a bare `startsWith` — a sibling folder that merely shares the
  // same leading characters (`.frontx-extras/`) is ordinary template
  // content and must survive.
  //
  // BEHAVIOUR CHANGE (checkpoint: shared local-origin resolver): a local
  // origin's `.frontx` content used to be skipped BEFORE it was ever read —
  // `resolveLocalPayload`'s own enumeration loop filtered `isNonPayloadPath`
  // before calling `readPayloadFileFn` at all. The shared resolver
  // (`cpt-frontx-algo-template-resolution-resolve-to-inventory`) acquires a
  // local origin's WHOLE folder uniformly, exactly as a remote fetch already
  // acquires a whole repository bundle it cannot selectively skip either —
  // `.frontx` content IS now read, and is excluded only from the FINAL
  // `payload.files` map, by `buildPayloadFromResolved`'s `isNonPayloadPath`
  // filter (the identical filter a remote bundle's `.frontx` entries already
  // went through). The excluded content never appears in the result either
  // way; only whether it is read at all has changed.
  it('excludes files under the reserved .frontx namespace root, but includes a sibling directory that only shares a name prefix', async () => {
    const readFileFn = vi.fn(async (p: string) => {
      if (p.endsWith(MANIFEST_FILENAME)) return manifestJson();
      if (p.endsWith('.frontx/ai/@scope/tpl/x.md')) return 'ai bundle content';
      if (p.endsWith('.frontx-extras/note.md')) return 'sibling content';
      throw new Error(`unexpected read: ${p}`);
    });
    const deps = fakeDeps({
      canonicalizeFn: (raw) => raw,
      readFileFn,
      listDiskFiles: vi.fn(async () => [
        'frontx-template.json',
        '.frontx/ai/@scope/tpl/x.md',
        '.frontx-extras/note.md',
      ]),
    });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('path:templates/shell');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Read (the resolver acquires the whole folder)...
    expect(readFileFn).toHaveBeenCalledWith(expect.stringContaining('.frontx/ai/@scope/tpl/x.md'));
    // ...but excluded from the final payload regardless.
    expect(result.payload.files.has('.frontx/ai/@scope/tpl/x.md')).toBe(false);
    expect(result.payload.files.get('.frontx-extras/note.md')).toBe('sibling content');
  });

  describe('refusals', () => {
    it('refuses ORIGIN_UNAVAILABLE when canonicalization cannot prove the relative path stays inside the project root', async () => {
      const deps = fakeDeps({ canonicalizeFn: () => null });
      const resolvePayload = createResolvePayloadFn(deps);

      const result = await resolvePayload('path:../outside');

      expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
    });

    it('refuses ORIGIN_UNAVAILABLE when canonicalization resolves the origin to the project root itself', async () => {
      const deps = fakeDeps({ canonicalizeFn: () => '.' });
      const resolvePayload = createResolvePayloadFn(deps);

      const result = await resolvePayload('path:.');

      expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
    });

    it('refuses ORIGIN_UNAVAILABLE when the manifest read throws', async () => {
      const deps = fakeDeps({
        canonicalizeFn: (raw) => raw,
        readFileFn: vi.fn(async () => {
          throw new Error('ENOENT: no such file');
        }),
      });
      const resolvePayload = createResolvePayloadFn(deps);

      const result = await resolvePayload('path:templates/missing');

      expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
    });

    it('refuses ORIGIN_UNAVAILABLE when a payload file read throws', async () => {
      const deps = fakeDeps({
        canonicalizeFn: (raw) => raw,
        readFileFn: vi.fn(async (p: string) => {
          if (p.endsWith(MANIFEST_FILENAME)) return manifestJson();
          throw new Error('EACCES: permission denied');
        }),
        listDiskFiles: vi.fn(async () => ['broken.txt']),
      });
      const resolvePayload = createResolvePayloadFn(deps);

      const result = await resolvePayload('path:templates/shell');

      expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
    });

    it('refuses ORIGIN_UNAVAILABLE when enumeration throws', async () => {
      const deps = fakeDeps({
        canonicalizeFn: (raw) => raw,
        readFileFn: vi.fn(async () => manifestJson()),
        listDiskFiles: vi.fn(async () => {
          throw new Error('ENOTDIR: not a directory');
        }),
      });
      const resolvePayload = createResolvePayloadFn(deps);

      const result = await resolvePayload('path:templates/shell');

      expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
    });
  });

  // A legacy-shaped manifest is refused as `ORIGIN_UNAVAILABLE`, like every
  // other unreadable manifest — NOT as `INVALID_MANIFEST`.
  //
  // This pins the resolution of an inconsistency an adversarial review caught:
  // `readDeclared` used to forward `readManifestFromContent`'s own
  // `'INVALID_MANIFEST'` code for the legacy case alone, while folding every
  // ordinary four-field violation into `ORIGIN_UNAVAILABLE`. That emitted a
  // code upgrade's own FEATURE never lists among its refusals, by the very
  // vocabulary argument used to justify folding the other class — and it
  // diverged from `scaffold/assembler.ts`, cited as the precedent, which folds
  // the legacy case in too. One rule for one question; the undeclared fields
  // still reach the developer through the message.
  it('refuses ORIGIN_UNAVAILABLE for a legacy-shaped local manifest, still naming the undeclared fields', async () => {
    const legacy = manifestJson({
      schemaVersion: '1.0',
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const listDiskFiles = vi.fn();
    const deps = fakeDeps({
      canonicalizeFn: (raw) => raw,
      readFileFn: vi.fn(async () => legacy),
      listDiskFiles,
    });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('path:templates/shell');

    expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
    if (result.ok) return;
    expect(result.message).toContain('schemaVersion');
    expect(result.message).toContain('ownershipBoundaries');
    // The resolver validates the manifest BEFORE enumerating the rest of the
    // folder (`inst-resolve-local-path-read`'s own manifest-first read), so
    // a legacy/invalid manifest short-circuits without ever walking it.
    expect(listDiskFiles).not.toHaveBeenCalled();
  });

  // The companion to the legacy case above: an ORDINARY four-field-contract
  // violation folds the same way. The two together are the whole rule — every
  // unreadable manifest is `ORIGIN_UNAVAILABLE` to upgrade, whatever made it
  // unreadable.
  //
  // The asymmetry with `commands/register.ts` (which calls this same class of
  // defect `INVALID_MANIFEST`) is deliberate and FEATURE-driven, not an
  // oversight: upgrade's flows and DoDs never list `INVALID_MANIFEST` among
  // its refusals, while composed-provenance's `register` does.
  it('refuses ORIGIN_UNAVAILABLE for an ordinary four-field-contract violation too, folding every unreadable manifest the same way', async () => {
    const missingName = JSON.parse(manifestJson()) as Record<string, unknown>;
    delete missingName.name;
    const deps = fakeDeps({
      canonicalizeFn: (raw) => raw,
      readFileFn: vi.fn(async () => JSON.stringify(missingName)),
    });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('path:templates/shell');

    expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
  });
});

describe('createResolvePayloadFn — remote origin', () => {
  it('resolves a bundle-shaped remote origin: files carry the bundle entries minus the manifest and .frontx, version/excludedSubtrees come from the manifest inside the bundle, origin is the resolved source', async () => {
    const manifest = manifestJson({ name: 'shell', version: '3.1.4', excludedSubtrees: ['docs/'] });
    const bundleContent = JSON.stringify({
      [BUNDLE_MARKER]: {
        [MANIFEST_FILENAME]: manifest,
        'README.md': '# hi',
        '.frontx/ai/@scope/shell/x.md': 'ai bundle content',
        'src/app.ts': 'export {}',
      },
    });
    const fetchFn = vi.fn(async () => bundleContent);
    const deps = fakeDeps({ fetchFn });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('github:acme/foo@v1.0.0');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.name).toBe('shell');
    expect(result.payload.version).toBe('3.1.4');
    expect(result.payload.excludedSubtrees).toEqual(['docs/']);
    expect(Object.fromEntries(result.payload.files)).toEqual({
      'README.md': '# hi',
      'src/app.ts': 'export {}',
    });
    // The resolved (pinned) address, not necessarily the raw string —
    // `resolveToInventory` reconstructs it from the parsed structured
    // reference (`resolver/resolve.ts`'s `buildSourceSpec`), which for a
    // well-formed spec happens to reproduce the same string byte-for-byte;
    // see the final report for why a literal divergence is not observable
    // through this code path today.
    expect(result.payload.origin).toBe('github:acme/foo@v1.0.0');
  });

  // Deliberate per the module's own header ("a remote origin whose fetch
  // returns a bare manifest therefore resolves to an EMPTY payload here —
  // honestly empty, not an error", `upgrade/payload.ts:41-46`). Pinned
  // explicitly so this behaviour cannot silently regress into an error.
  it('resolves a bare-manifest remote origin OK with an empty files map, per the module header', async () => {
    const manifest = manifestJson({ name: 'shell', version: '1.2.3' });
    const fetchFn = vi.fn(async () => manifest);
    const deps = fakeDeps({ fetchFn });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('github:acme/foo@v1.0.0');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.name).toBe('shell');
    expect(result.payload.version).toBe('1.2.3');
    expect(result.payload.files.size).toBe(0);
  });

  // Regression: the REMOTE branch used to propagate the resolver's own
  // `INVALID_MANIFEST` while the LOCAL branch folded every failure to
  // `ORIGIN_UNAVAILABLE` — the two halves of one function disagreeing about
  // which shared code an unreadable manifest earns. Nothing covered it, so it
  // survived an adversarial review that flagged the identical incoherence in
  // `readDeclared`, and two later changes widened it (the resolver began
  // setting `INVALID_MANIFEST` on its generic identity-missing branch, and a
  // local origin began reaching the resolver too).
  it('refuses ORIGIN_UNAVAILABLE, never INVALID_MANIFEST, for a legacy-shaped REMOTE manifest — the same fold the local branch applies', async () => {
    const legacy = manifestJson({
      name: 'shell',
      version: '1.2.3',
      schemaVersion: '1.0',
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const fetchFn = vi.fn(async () => legacy);
    const deps = fakeDeps({ fetchFn });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('github:acme/foo@v1.0.0');

    expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
    if (result.ok) return;
    // The undeclared fields still reach the developer through the message.
    expect(result.message).toContain('schemaVersion');
  });

  it('refuses ORIGIN_UNAVAILABLE when the origin fails to parse as a source-spec', async () => {
    const deps = fakeDeps();
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('not-a-valid-spec-at-all');

    expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
  });

  it('refuses ORIGIN_UNAVAILABLE when resolution (the fetch) fails', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network unreachable');
    });
    const deps = fakeDeps({ fetchFn });
    const resolvePayload = createResolvePayloadFn(deps);

    const result = await resolvePayload('github:acme/foo@v1.0.0');

    expect(result).toMatchObject({ ok: false, code: 'ORIGIN_UNAVAILABLE' });
  });
});

describe('versionMatchesRecorded', () => {
  function payloadWithVersion(version: string): ResolvedPayload {
    return { name: 'shell', version, origin: 'path:shell', files: new Map(), excludedSubtrees: [] };
  }

  it('returns true when the resolved payload version equals the recorded version', () => {
    expect(versionMatchesRecorded(payloadWithVersion('1.0.0'), '1.0.0')).toBe(true);
  });

  it('returns false when the resolved payload version differs from the recorded version', () => {
    expect(versionMatchesRecorded(payloadWithVersion('1.0.0'), '1.0.1')).toBe(false);
  });
});

// Acceptance criteria (FEATURE.md:426-428) — the architectural fact behind
// all three: `createResolvePayloadFn` (this module) is the ONE function an
// upgrade's candidate resolution and baseline re-resolution both go through
// (`upgrade/validate.ts`'s `resolvePayload` seam), and its own
// `ResolvePayloadDeps` (above) carries no reference to a `TemplateInventory`
// at all — structurally, it has nothing to write through. These tests make
// that fact observable rather than merely inferred from the type shape: a
// REAL `TemplateInventory` sits alongside `resolvePayload` in every test
// below, and the assertions are on ITS state (`lookup`/`list`) before and
// after resolution runs, not on a mock call count or a staging directory
// that was never created in the first place.
describe('createResolvePayloadFn — never touches the local inventory store (cpt-frontx-dod-template-resolution-staged-mode)', () => {
  // FEATURE.md:426 — a candidate or baseline re-resolution for an upgrade or
  // restore never writes into the registered name's own slot and never
  // indexes the acquired content: the slot's pre-resolution content is still
  // there immediately after, and nothing new appears in `list`.
  it('leaves the registered slot and list() byte-identical after resolving a new candidate for the same name', async () => {
    const inventory = new TemplateInventory();
    await inventory.install('github:acme/shell@v1.0.0', vi.fn(async () => manifestJson({ name: 'shell', version: '1.0.0' })));
    const slotBefore = inventory.lookup('shell');
    const listBefore = await inventory.list();

    // The candidate: a NEW version of the SAME registered name, resolved the
    // way an upgrade's own candidate resolution would, entirely in memory.
    const resolvePayload = createResolvePayloadFn(
      fakeDeps({ fetchFn: vi.fn(async () => manifestJson({ name: 'shell', version: '2.0.0' })) }),
    );
    const result = await resolvePayload('github:acme/shell@v2.0.0');

    // The resolution itself succeeded and carries the NEW content...
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.version).toBe('2.0.0');

    // ...yet the registered slot is untouched: same object shape, same
    // content, and `list()` still reports exactly the one entry it did
    // before this resolution ever ran.
    expect(inventory.lookup('shell')).toEqual(slotBefore);
    expect(await inventory.list()).toEqual(listBefore);
  });

  // FEATURE.md:427, first half — two upgrades of DIFFERENT template names
  // resolved from origins pinned to the same commit SHA each hold their own
  // acquired content; neither is visible to, or removable by, the other, and
  // neither shares an address with the other because neither has one. "No
  // address" is made concrete here as "no inventory entry under either
  // name" — the only notion of an address this system has for acquired
  // content.
  it('resolves two different names from the same commit SHA to independent content, with neither indexed anywhere', async () => {
    const inventory = new TemplateInventory();
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('/tools/')
        ? manifestJson({ name: 'tools', version: '2.0.0' })
        : manifestJson({ name: 'widgets', version: '2.0.0' }),
    );
    const resolvePayload = createResolvePayloadFn(fakeDeps({ fetchFn }));

    const [toolsResult, widgetsResult] = await Promise.all([
      resolvePayload('github:acme/tools@abc123def'),
      resolvePayload('github:acme/widgets@abc123def'),
    ]);

    expect(toolsResult.ok).toBe(true);
    expect(widgetsResult.ok).toBe(true);
    if (!toolsResult.ok || !widgetsResult.ok) return;
    expect(toolsResult.payload.name).toBe('tools');
    expect(widgetsResult.payload.name).toBe('widgets');
    // Each payload owns its own `files` map — mutating one is not observable
    // through the other, which is what "holds its own acquired content"
    // means for an in-memory value with no shared backing store.
    toolsResult.payload.files.set('mutated-by-tools', 'x');
    expect(widgetsResult.payload.files.has('mutated-by-tools')).toBe(false);
    // Neither resolution materialized anything an inventory entry, so there
    // is no address either invocation could remove out from under the other.
    expect(inventory.lookup('tools')).toBeUndefined();
    expect(inventory.lookup('widgets')).toBeUndefined();
    expect(await inventory.list()).toEqual([]);
  });

  // FEATURE.md:427, second half — a CONCURRENT upgrade candidate and restore
  // baseline of the SAME registered name each hold their own content and
  // neither disturbs the registered slot, even when both resolutions are
  // in flight at once (`Promise.all`, not sequential awaits).
  it('resolves a concurrent candidate and baseline of the same name independently, without disturbing the registered slot', async () => {
    const inventory = new TemplateInventory();
    await inventory.install('github:acme/shell@v1.0.0', vi.fn(async () => manifestJson({ name: 'shell', version: '1.0.0' })));
    const slotBefore = inventory.lookup('shell');

    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/v1.0.0')
        ? manifestJson({ name: 'shell', version: '1.0.0' })
        : manifestJson({ name: 'shell', version: '2.0.0' }),
    );
    const resolvePayload = createResolvePayloadFn(fakeDeps({ fetchFn }));

    // "origin-a" models the baseline re-resolution a restore performs;
    // "origin-b" models an upgrade's candidate — run concurrently, exactly as
    // an upgrade's own validation and a restore of the same name could race.
    const [baseline, candidate] = await Promise.all([
      resolvePayload('github:acme/shell@v1.0.0'),
      resolvePayload('github:acme/shell@v2.0.0'),
    ]);

    expect(baseline.ok).toBe(true);
    expect(candidate.ok).toBe(true);
    if (!baseline.ok || !candidate.ok) return;
    expect(baseline.payload.version).toBe('1.0.0');
    expect(candidate.payload.version).toBe('2.0.0');
    expect(baseline.payload.files).not.toBe(candidate.payload.files);

    // The registered slot for "shell" is exactly what it was before either
    // concurrent resolution ran, and `list()` reports no second entry.
    expect(inventory.lookup('shell')).toEqual(slotBefore);
    expect(await inventory.list()).toHaveLength(1);
  });

  // FEATURE.md:428 — a REFUSED resolution (the origin cannot be reached, or
  // its manifest cannot be read) leaves nothing behind anywhere in the local
  // inventory store, because its resolution materialized nothing in the
  // first place. ("Declined" and "crashed" are covered where they actually
  // happen — `commitUpgrade`'s own post-resolution steps
  // — by `upgrade-flow.test.ts`'s "declining the presented plan writes
  // nothing anywhere" and its INTERNAL-mapping tests; this test covers the
  // resolution failure itself, which is this module's own concern.)
  it('leaves the registered slot and list() untouched when a candidate resolution is refused', async () => {
    const inventory = new TemplateInventory();
    await inventory.install('github:acme/shell@v1.0.0', vi.fn(async () => manifestJson({ name: 'shell', version: '1.0.0' })));
    const slotBefore = inventory.lookup('shell');
    const listBefore = await inventory.list();

    const refusedResolve = createResolvePayloadFn(
      fakeDeps({
        fetchFn: vi.fn(async () => {
          throw new Error('network unreachable');
        }),
      }),
    );
    const refused = await refusedResolve('github:acme/shell@v2.0.0');

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('ORIGIN_UNAVAILABLE');
    // No slot change, no index entry, no residue at any other address.
    expect(inventory.lookup('shell')).toEqual(slotBefore);
    expect(await inventory.list()).toEqual(listBefore);
  });
});

// `isTemplatePayloadPath` (`../manifest/types.ts`) is the ONE shared
// formulation of FEATURE §1.2's payload definition — this module's own
// `buildPayloadFromResolved` above now calls it instead of restating a
// private `isNonPayloadPath`, and `commands/apply.ts`/
// `scaffold/existing-content.ts` route through the identical function.
// Direct unit coverage of the predicate itself, independent of any one
// call site's own wiring.
describe('isTemplatePayloadPath (../manifest/types.ts) — the shared payload-membership predicate', () => {
  it('excludes the manifest file itself', () => {
    expect(isTemplatePayloadPath(MANIFEST_FILENAME)).toBe(false);
  });

  it('excludes anything under the reserved .frontx namespace root', () => {
    expect(isTemplatePayloadPath('.frontx/project.json')).toBe(false);
    expect(isTemplatePayloadPath('.frontx/ai/@scope/tpl/x.md')).toBe(false);
  });

  // Whole-segment comparison, never a bare `startsWith`: a sibling folder
  // that only shares a name prefix with the reserved namespace is ordinary
  // payload content.
  it('does NOT exclude a sibling directory that only shares a name prefix (.frontx-extras)', () => {
    expect(isTemplatePayloadPath('.frontx-extras/note.md')).toBe(true);
  });

  it('includes ordinary payload content', () => {
    expect(isTemplatePayloadPath('src/index.ts')).toBe(true);
    expect(isTemplatePayloadPath('package.json')).toBe(true);
  });
});
