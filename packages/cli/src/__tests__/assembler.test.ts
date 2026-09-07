// @cpt-algo:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1
//
// REWRITE (checkpoint 3): the prior suite exercised the OLD `uniformApply`
// (a `templateRef[]` resolved through a preset/composition tree, filtered by
// the legacy `exclusiveSubtrees`/`sharedFiles` ownership shape) and the
// `runAssemblyOp` driver built on top of it. The rewritten `uniformApply`
// (`../scaffold/assembler.ts`) stages an explicit, target-keyed batch
// against names already registered in the project state store — a
// structurally different algorithm with no content-reading step at all
// (`cpt-frontx-algo-cli-scaffolding-uniform-apply`, FEATURE §3). This suite
// covers exactly that algorithm's own branches; it does not test
// `runAssemblyOp` (`../scaffold/state.ts`'s driver has zero real callers —
// see that file's own header comment — and its contract no longer matches
// this rewritten function at all).
import { describe, it, expect, vi } from 'vitest';
import { uniformApply } from '../scaffold/assembler';
import type { UniformApplyBatch, UniformApplyDeps, UniformApplyInventoryPort } from '../scaffold/assembler';
import { isWithinEffectiveOwnership } from '../scaffold/effective-ownership';
import { checkTargetConflicts } from '../scaffold/conflict-check';
import type { TargetClaim } from '../scaffold/conflict-check';
import type { ProjectStateDocument, TemplateEntry } from '../project-state/types';
import type { InventoryEntry } from '../inventory/types';
import { InventoryState } from '../inventory/types';

function manifestContent(name: string, excludedSubtrees: string[] = []): string {
  return JSON.stringify({
    name,
    version: '1.0.0',
    excludedSubtrees,
    description: `Fixture template "${name}" for uniform-apply staging tests.`,
  });
}

function makeDocument(
  templates: Record<string, TemplateEntry> = {},
  projectOwnedRoots: string[] = [],
): ProjectStateDocument {
  return { formatVersion: 1, templates, projectOwnedRoots };
}

function makeInventoryEntry(name: string, content: string): InventoryEntry {
  return { name, source: `github:acme/${name}@v1`, ref: 'v1', status: InventoryState.INSTALLED, content };
}

// Every deps field defaults to a stub that fails loudly if a test relies on
// a branch it did not deliberately configure — `readFileFn`'s default
// throws rather than silently returning empty content, and `install`'s
// default reports failure rather than silently succeeding.
function makeDeps(overrides: Partial<UniformApplyDeps> = {}): UniformApplyDeps {
  const inventory: UniformApplyInventoryPort = overrides.inventory ?? {
    lookup: vi.fn(() => undefined),
    install: vi.fn(async () => ({ ok: false as const, error: { message: 'install not stubbed for this test' } })),
  };
  return {
    repoRoot: '/repo',
    inventory,
    fetchFn: vi.fn(async () => ''),
    readFileFn: vi.fn(async () => {
      throw new Error('readFileFn not stubbed for this test');
    }),
    canonicalizeFn: (raw) => raw,
    // A local origin's folder is presumed to exist and to hold no files
    // beyond the manifest `readFileFn` above fixtures by path — this
    // suite's local-origin tests exercise identity/ownership staging, not
    // the resolver's own folder-enumeration branch.
    existsFn: vi.fn(async () => true),
    listFolderFilesFn: vi.fn(async () => []),
    resolveInstalledContentPathFn: (name) => `/inventory/${name}`,
    ...overrides,
  };
}

describe('uniformApply — staging an explicit batch (cpt-frontx-algo-cli-scaffolding-uniform-apply)', () => {
  // cpt-frontx-cli-nfr-template-scale's assembly threshold: at least 20
  // templates evaluated in ONE batch, with every ownership conflict reported —
  // containment between targets included, not only exact-path equality —
  // before any repository file is written. The "before any write" half holds by
  // construction rather than by assertion here: `UniformApplyDeps` carries no
  // write seam at all — staging reads and records, and materialization is a
  // later step in `commands/apply.ts` that a refused conflict check never
  // reaches. Asserting it in this test would mean asserting the absence of a
  // function the type does not declare.
  it('evaluates a 24-template batch and reports containment between targets, not only equality', async () => {
    const NAMES = Array.from({ length: 24 }, (_, i) => `tpl-${String(i).padStart(2, '0')}`);

    const templates: Record<string, TemplateEntry> = {};
    const contentByName = new Map<string, string>();
    for (const name of NAMES) {
      templates[name] = { origin: `github:acme/${name}@v1`, version: '1.0.0', targets: [] };
      contentByName.set(name, manifestContent(name));
    }
    const document = makeDocument(templates);

    const deps = makeDeps({
      inventory: {
        lookup: vi.fn((name: string) => {
          const content = contentByName.get(name);
          return content === undefined ? undefined : makeInventoryEntry(name, content);
        }),
        install: vi.fn(async () => ({ ok: false as const, error: { message: 'nothing needs installing here' } })),
      },
      readFileFn: vi.fn(async () => ''),
    });

    // Every target is disjoint except the last pair, which is a CONTAINMENT
    // rather than an equality: `apps/tpl-22` contains `apps/tpl-22/nested`,
    // and neither declares the other as an excluded subtree.
    const batch: UniformApplyBatch = {
      templates: Object.fromEntries(
        NAMES.map((name, i) => [name, [i === 23 ? 'apps/tpl-22/nested' : `apps/${name}`]]),
      ),
    };

    const staged = await uniformApply(batch, document, deps);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(new Set(staged.assembly.entries.map((e) => e.templateName)).size).toBe(24);

    const claims: TargetClaim[] = staged.assembly.entries.map((entry) => ({
      templateName: entry.templateName,
      target: entry.target,
      excludedSubtrees: entry.excludedSubtrees,
    }));
    const verdict = checkTargetConflicts({
      targetsUnderCheck: claims,
      recordedTargets: [],
      projectOwnedRoots: [],
      localOriginFolders: [],
      canonicalizeFn: (raw) => raw,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.kind).toBe('TARGET_CONFLICT');
    const contested = JSON.stringify(verdict);
    expect(contested).toContain('apps/tpl-22');
    expect(contested).toContain('apps/tpl-22/nested');
  });

  // inst-ua-if-not-registered / inst-ua-return-not-registered
  it('refuses TEMPLATE_NOT_REGISTERED for a name with no entry in the project state store', async () => {
    const document = makeDocument({});
    const deps = makeDeps();
    const batch: UniformApplyBatch = { templates: { 'missing-template': ['apps/foo'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TEMPLATE_NOT_REGISTERED');
    expect(result.name).toBe('missing-template');
  });

  // inst-ua-if-not-installed / inst-ua-if-install-fail / inst-ua-return-unavailable
  it('refuses ORIGIN_UNAVAILABLE when a registered-but-uninstalled origin fails to auto-install', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
    });
    const install = vi.fn(async () => ({ ok: false as const, error: { message: 'network unreachable' } }));
    const inventory: UniformApplyInventoryPort = { lookup: vi.fn(() => undefined), install };
    const deps = makeDeps({ inventory });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['apps/foo'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.code !== 'ORIGIN_UNAVAILABLE') throw new Error(`expected ORIGIN_UNAVAILABLE, got ${result.code}`);
    expect(result.name).toBe('template-a');
    expect(result.origin).toBe('github:acme/template-a@v1');
    expect(install).toHaveBeenCalledWith('github:acme/template-a@v1', deps.fetchFn);
  });

  // inst-ua-if-not-installed's own condition: content already available skips install entirely.
  it('does not call install when the registered origin is already available locally', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
    });
    const entry = makeInventoryEntry('template-a', manifestContent('template-a'));
    const install = vi.fn();
    const inventory: UniformApplyInventoryPort = { lookup: vi.fn(() => entry), install };
    const deps = makeDeps({ inventory });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['apps/foo'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(true);
    expect(install).not.toHaveBeenCalled();
  });

  // inst-ua-auto-install's success branch: not yet available, install succeeds,
  // staged using the now-installed entry's installed content path.
  it('auto-installs a registered origin not yet available, then stages the installed entry', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
    });
    const entry = makeInventoryEntry('template-a', manifestContent('template-a'));
    let installed = false;
    const install = vi.fn(async () => {
      installed = true;
      return { ok: true as const, value: { name: 'template-a', ref: 'v1' } };
    });
    const inventory: UniformApplyInventoryPort = { lookup: vi.fn(() => (installed ? entry : undefined)), install };
    const deps = makeDeps({ inventory });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['apps/foo'] } };

    const result = await uniformApply(batch, document, deps);

    expect(install).toHaveBeenCalledWith('github:acme/template-a@v1', deps.fetchFn);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assembly.entries[0].installedContentPath).toBe('/inventory/template-a');
  });

  // A registered origin resolving to unreadable content is folded into the
  // algorithm's own closed ORIGIN_UNAVAILABLE/TEMPLATE_NOT_REGISTERED vocabulary.
  it('refuses ORIGIN_UNAVAILABLE when the resolved content is not a valid manifest', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
    });
    const entry = makeInventoryEntry('template-a', JSON.stringify({ name: 'template-a' })); // missing fields
    const inventory: UniformApplyInventoryPort = { lookup: vi.fn(() => entry), install: vi.fn() };
    const deps = makeDeps({ inventory });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['apps/foo'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ORIGIN_UNAVAILABLE');
  });

  // inst-ua-stage-entry, run once per batch target: each gets its own
  // independently-computed effective ownership.
  it('stages each of a name\'s multiple batch targets with its own effective ownership', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
    });
    const entry = makeInventoryEntry('template-a', manifestContent('template-a', ['docs/']));
    const inventory: UniformApplyInventoryPort = { lookup: vi.fn(() => entry), install: vi.fn() };
    const deps = makeDeps({ inventory });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['apps/foo', 'apps/bar'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assembly.entries).toHaveLength(2);
    const [foo, bar] = result.assembly.entries;
    expect(foo.target).toBe('apps/foo');
    expect(bar.target).toBe('apps/bar');
    // Each target's own declared `docs/` is carved from ITS OWN ownership...
    expect(isWithinEffectiveOwnership('apps/foo/docs/readme.md', 'apps/foo', foo.exclusionRoots)).toBe(false);
    expect(isWithinEffectiveOwnership('apps/bar/docs/readme.md', 'apps/bar', bar.exclusionRoots)).toBe(false);
    // ...and never leaks into carving the OTHER target's ownership — proving
    // the computation is independent per target, not shared/reused.
    expect(isWithinEffectiveOwnership('apps/foo/docs/readme.md', 'apps/foo', bar.exclusionRoots)).toBe(true);
  });

  // A target may legitimately be "." (the project root) — `pathWithinTarget`'s
  // own exception, exercised here through the whole staging path.
  it('computes effective ownership correctly for a target of "." (the project root)', async () => {
    const document = makeDocument(
      { 'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] } },
      ['docs'],
    );
    const entry = makeInventoryEntry('template-a', manifestContent('template-a'));
    const inventory: UniformApplyInventoryPort = { lookup: vi.fn(() => entry), install: vi.fn() };
    const deps = makeDeps({ inventory });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['.'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [rootEntry] = result.assembly.entries;
    expect(rootEntry.target).toBe('.');
    expect(isWithinEffectiveOwnership('src/index.ts', '.', rootEntry.exclusionRoots)).toBe(true);
    expect(isWithinEffectiveOwnership('.frontx/project.json', '.', rootEntry.exclusionRoots)).toBe(false);
    expect(isWithinEffectiveOwnership('docs/readme.md', '.', rootEntry.exclusionRoots)).toBe(false);
  });

  // inst-ua-read-manifest feeding inst-ua-compute-ownership: a declared
  // `excludedSubtrees` entry is carved out of the target's effective ownership.
  it('carves a declared excludedSubtrees entry out of the target\'s effective ownership', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
    });
    const entry = makeInventoryEntry('template-a', manifestContent('template-a', ['docs/']));
    const inventory: UniformApplyInventoryPort = { lookup: vi.fn(() => entry), install: vi.fn() };
    const deps = makeDeps({ inventory });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['packages/app'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [staged] = result.assembly.entries;
    expect(staged.excludedSubtrees).toEqual(['docs/']);
    expect(isWithinEffectiveOwnership('packages/app/docs/readme.md', 'packages/app', staged.exclusionRoots)).toBe(false);
    expect(isWithinEffectiveOwnership('packages/app/src/index.ts', 'packages/app', staged.exclusionRoots)).toBe(true);
  });

  // A registered origin recorded with the `path:` prefix
  // (`commands/register.ts`'s local-origin form) is resolved directly,
  // never through the inventory — mirroring register's own resolution of
  // the identical origin form.
  it('resolves a local "path:" origin directly, never touching the inventory', async () => {
    const document = makeDocument({
      'local-template': { origin: 'path:vendor/local-template', version: '1.0.0', targets: [] },
    });
    const install = vi.fn();
    const lookup = vi.fn(() => undefined);
    const readFileFn = vi.fn(async (filePath: string) => {
      expect(filePath).toBe('/repo/vendor/local-template/frontx-template.json');
      return manifestContent('local-template', ['docs/']);
    });
    const deps = makeDeps({ inventory: { lookup, install }, readFileFn });
    const batch: UniformApplyBatch = { templates: { 'local-template': ['.'] } };

    const result = await uniformApply(batch, document, deps);

    expect(install).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [staged] = result.assembly.entries;
    // Absolute, not the bare canonical relative folder: every downstream
    // reader (content reading, the AI-bundle seams) is entitled to use this
    // value as a root directly, with no repo root of its own to join it
    // against — see `scaffold/types.ts`'s `ContributionEntry.installedContentPath`
    // doc comment for the one rule this asserts.
    expect(staged.installedContentPath).toBe('/repo/vendor/local-template');
    // Both the declared `docs/` AND the local origin's own folder are
    // carved out of the root target's effective ownership.
    expect(isWithinEffectiveOwnership('docs/readme.md', '.', staged.exclusionRoots)).toBe(false);
    expect(isWithinEffectiveOwnership('vendor/local-template/frontx-template.json', '.', staged.exclusionRoots)).toBe(false);
    expect(isWithinEffectiveOwnership('src/index.ts', '.', staged.exclusionRoots)).toBe(true);
  });

  it('refuses ORIGIN_UNAVAILABLE for a local "path:" origin that cannot be proven to stay inside the project root', async () => {
    const document = makeDocument({
      'escaping-template': { origin: 'path:../outside', version: '1.0.0', targets: [] },
    });
    const deps = makeDeps({ canonicalizeFn: () => null });
    const batch: UniformApplyBatch = { templates: { 'escaping-template': ['.'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ORIGIN_UNAVAILABLE');
  });

  // A registered name contributing zero batch targets is still validated
  // for registration, but triggers no install attempt or ownership
  // computation — there is nothing to resolve content for.
  it('validates registration but stages nothing for a name with zero batch targets', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
    });
    const install = vi.fn();
    const lookup = vi.fn(() => undefined);
    const deps = makeDeps({ inventory: { lookup, install } });
    const batch: UniformApplyBatch = { templates: { 'template-a': [] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assembly.entries).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  // The handoff contract: the staged output is exactly what
  // `checkTargetConflicts` needs to consume directly as `TargetClaim[]` —
  // proven here by constructing that array from the staged output and
  // feeding it a batch that deliberately collides, so a wiring bug (a
  // swapped or dropped field) would show up as a MISSED conflict rather
  // than a silently-plausible-looking pass.
  it('stages output that checkTargetConflicts consumes directly as TargetClaim[], detecting a real conflict', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
      'template-b': { origin: 'github:acme/template-b@v1', version: '1.0.0', targets: [] },
    });
    const entryA = makeInventoryEntry('template-a', manifestContent('template-a'));
    const entryB = makeInventoryEntry('template-b', manifestContent('template-b'));
    const inventory: UniformApplyInventoryPort = {
      lookup: vi.fn((name: string) => (name === 'template-a' ? entryA : name === 'template-b' ? entryB : undefined)),
      install: vi.fn(),
    };
    const deps = makeDeps({ inventory });
    // Both templates claim the identical target — an undeclared, genuine conflict.
    const batch: UniformApplyBatch = {
      templates: { 'template-a': ['apps/shared'], 'template-b': ['apps/shared'] },
    };

    const result = await uniformApply(batch, document, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const claims: TargetClaim[] = result.assembly.entries.map((entry) => ({
      templateName: entry.templateName,
      target: entry.target,
      excludedSubtrees: entry.excludedSubtrees,
    }));

    const verdict = checkTargetConflicts({
      targetsUnderCheck: claims,
      recordedTargets: [],
      projectOwnedRoots: document.projectOwnedRoots,
      canonicalizeFn: (raw) => raw,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    if (verdict.kind !== 'TARGET_CONFLICT') throw new Error(`expected TARGET_CONFLICT, got ${verdict.kind}`);
    expect(verdict.conflicts).toHaveLength(1);
    expect(verdict.conflicts[0].contestants.map((c) => c.templateName).sort()).toEqual(['template-a', 'template-b']);
  });

  // Regression (the apply-side half of a bug whose delete-side half
  // `delete-plan.test.ts` covers): a staged entry's `exclusionRoots` used to
  // carry only the SIX shared terms, whose local-origin term is the applying
  // template's OWN folder. Another registered template's local `path:` origin
  // folder therefore stayed INSIDE the applying target's effective ownership
  // — contradicting `conflict-check.ts`'s own `inst-cc-permit-reverse`, which
  // promises such a folder landing inside a target is "a permitted
  // subtraction from that target's effective ownership, not a conflict".
  //
  // `exclusionRoots` is the one list BOTH existing-content reconciliation and
  // materialization filter by, so the omission had two live consequences:
  // reconciliation reported the other template's real files as
  // `additionalPaths` (demanding `--adopt-existing` over ground the checker
  // itself calls reserved — confirmed live during this checkpoint's own live
  // check), and a payload path colliding with that folder would have been
  // written into it.
  it('subtracts ANOTHER registered template\'s local path: origin folder from the applying target\'s effective ownership', async () => {
    const document = makeDocument({
      'template-a': { origin: 'github:acme/template-a@v1', version: '1.0.0', targets: [] },
      'template-b': { origin: 'path:vendor/template-b', version: '1.0.0', targets: ['nested'] },
    });
    const entryA = makeInventoryEntry('template-a', manifestContent('template-a'));
    const inventory: UniformApplyInventoryPort = {
      lookup: vi.fn((name: string) => (name === 'template-a' ? entryA : undefined)),
      install: vi.fn(),
    };
    const deps = makeDeps({ inventory });
    // template-a applies at the project root, which physically contains
    // template-b's own origin folder (`vendor/template-b`).
    const batch: UniformApplyBatch = { templates: { 'template-a': ['.'] } };

    const result = await uniformApply(batch, document, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [staged] = result.assembly.entries;
    expect(staged.exclusionRoots).toContain('vendor/template-b');
    // The predicate both reconciliation and materialization consult agrees:
    // template-b's own files are outside template-a's effective ownership,
    // while ordinary root-level ground stays inside it.
    expect(isWithinEffectiveOwnership('vendor/template-b/frontx-template.json', '.', staged.exclusionRoots)).toBe(false);
    expect(isWithinEffectiveOwnership('vendor/template-b/payload.txt', '.', staged.exclusionRoots)).toBe(false);
    expect(isWithinEffectiveOwnership('src/index.ts', '.', staged.exclusionRoots)).toBe(true);
  });

  // The applying template's OWN origin folder is still subtracted by the
  // shared six-term formula, not by the new other-origins pass — asserted
  // separately so a future change that conflates the two (dropping the sixth
  // term because "the other-origins pass covers it") fails here.
  it('still subtracts the applying template\'s OWN local origin folder, which the other-origins pass deliberately skips', async () => {
    const document = makeDocument({
      'template-a': { origin: 'path:vendor/template-a', version: '1.0.0', targets: [] },
    });
    const readFileFn = vi.fn(async (absolutePath: string) => {
      if (absolutePath === '/repo/vendor/template-a/frontx-template.json') return manifestContent('template-a');
      throw new Error(`unexpected read of ${absolutePath}`);
    });
    const deps = makeDeps({ readFileFn });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['.'] } };

    const result = await uniformApply(batch, document, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [staged] = result.assembly.entries;
    expect(staged.exclusionRoots).toContain('vendor/template-a');
    expect(isWithinEffectiveOwnership('vendor/template-a/frontx-template.json', '.', staged.exclusionRoots)).toBe(false);
  });

  // Regression: this guard used to test `canonical === ''`, a spelling the
  // real `createFsCanonicalizeTargetFn` never produces — it returns `.` for
  // the project root by its own documented contract. A root-spelled origin
  // folder is the sixth subtraction term, so accepting it would silently
  // empty the template's own effective ownership at every target.
  it('refuses a local path: origin resolving to the project root, whose canonical spelling is "." and not ""', async () => {
    const document = makeDocument({
      'template-a': { origin: 'path:.', version: '1.0.0', targets: [] },
    });
    // A readFileFn that WOULD succeed for the root manifest — so the only
    // thing that can produce a refusal here is the containment guard itself.
    // With the default throwing stub this test would pass even with the guard
    // removed (the read would fail instead), proving nothing about the guard.
    const readFileFn = vi.fn(async () => manifestContent('template-a'));
    const deps = makeDeps({ canonicalizeFn: () => '.', readFileFn });
    const batch: UniformApplyBatch = { templates: { 'template-a': ['apps/foo'] } };

    const result = await uniformApply(batch, document, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ORIGIN_UNAVAILABLE');
    expect(result.message).toContain('could not be proven to stay inside the project root');
    expect(readFileFn).not.toHaveBeenCalled();
  });
});
