// @cpt-algo:cpt-frontx-algo-composed-provenance-validate-project:p1
//
// Fixture coverage for `validateProject`, against fake project-state,
// resolver, and filesystem seams — decoupled from any real network or
// filesystem, matching this package's dependency-injection test convention
// (`ownership.test.ts`/`register.test.ts`'s own header).
import { describe, expect, it, vi } from 'vitest';
import { validateProject } from '../commands/validate-project';
import type { ValidateProjectDeps } from '../commands/validate-project';
import type { ProjectStateDocument, ReadProjectStateFn } from '../project-state/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { FetchFn, ListFolderFilesFn, PathExistsFn } from '../resolver/types';
import type { ReadFileFn } from '../manifest/types';

const REPO_ROOT = '/repo';

function manifestContent(name: string, version: string, excludedSubtrees: string[] = []): string {
  return JSON.stringify({ name, version, excludedSubtrees, description: `Fixture template "${name}".` });
}

// A read-only fake for `.frontx/project.json` — `null` for an ABSENT
// document, the raw JSON string otherwise. Both the algorithm's own
// structural read AND its separate absence probe (`inst-valpa-if-absent`)
// go through this SAME function, exactly as production wiring does.
function fakeReadProjectStateFn(content: ProjectStateDocument | string | null): ReadProjectStateFn {
  const raw = content === null ? null : typeof content === 'string' ? content : JSON.stringify(content);
  return vi.fn(async () => raw);
}

// Keyed by absolute path, mirroring `ownership.test.ts`'s own
// `fakeReadFileFn` — used for a LOCAL `path:` origin's manifest read.
function fakeReadFileFn(filesByAbsolutePath: Record<string, string>): ReadFileFn {
  return vi.fn(async (absolutePath: string) => {
    const content = filesByAbsolutePath[absolutePath];
    if (content === undefined) throw new Error(`ENOENT: no such file at ${absolutePath}`);
    return content;
  });
}

// Keyed by "github:owner/repo@ref" — reconstructed from the GitHub tarball
// URL the resolver builds, mirroring `cli.test.ts`'s own `fetchFn` fixture
// exactly, since `validateProject` resolves a REMOTE origin through the
// identical shared resolver every other command does.
function fakeFetchFn(manifestsBySpec: Record<string, string>): FetchFn {
  return vi.fn(async (url: string) => {
    const match = /\/repos\/([^/]+)\/([^/]+)\/tarball\/(.+)$/.exec(url);
    if (!match) throw new Error(`unexpected fetch url in this fixture: "${url}"`);
    const key = `github:${match[1]}/${match[2]}@${match[3]}`;
    const manifest = manifestsBySpec[key];
    if (!manifest) throw new Error(`no manifest registered for fetch spec "${key}"`);
    return manifest;
  });
}

const identityCanonicalize: CanonicalizeTargetFn = (rawTarget) => rawTarget;
const alwaysExists: PathExistsFn = vi.fn(async () => true);
const noFolderFiles: ListFolderFilesFn = vi.fn(async () => []);
const throwingReadFileFn: ReadFileFn = vi.fn(async () => {
  throw new Error('readFileFn should not be called in this fixture — no local origin is registered');
});
const throwingFetchFn: FetchFn = vi.fn(async () => {
  throw new Error('fetchFn should not be called in this fixture — no remote origin is registered, or a fail-fast return should have preempted it');
});

function buildDeps(overrides: Partial<ValidateProjectDeps> = {}): ValidateProjectDeps {
  return {
    readProjectStateFn: overrides.readProjectStateFn ?? fakeReadProjectStateFn(null),
    canonicalizeFn: overrides.canonicalizeFn ?? identityCanonicalize,
    existsFn: overrides.existsFn ?? alwaysExists,
    listFolderFilesFn: overrides.listFolderFilesFn ?? noFolderFiles,
    readFileFn: overrides.readFileFn ?? throwingReadFileFn,
    fetchFn: overrides.fetchFn ?? throwingFetchFn,
  };
}

describe('validateProject (cpt-frontx-algo-composed-provenance-validate-project)', () => {
  it('PASSes on a structurally sound document — every version matches, every origin resolves, no geometry conflict, every owned root exists', async () => {
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { app: { origin: 'path:vendor/app', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: ['docs'],
    };
    const deps = buildDeps({
      readProjectStateFn: fakeReadProjectStateFn(document),
      readFileFn: fakeReadFileFn({ '/repo/vendor/app/frontx-template.json': manifestContent('app', '1.0.0') }),
    });

    const result = await validateProject(REPO_ROOT, deps);

    expect(result).toEqual({ ok: true });
  });

  it('PASSes on an ABSENT document', async () => {
    const deps = buildDeps({ readProjectStateFn: fakeReadProjectStateFn(null) });
    const result = await validateProject(REPO_ROOT, deps);
    expect(result).toEqual({ ok: true });
  });

  it('PASSes on an empty-but-present document', async () => {
    const document: ProjectStateDocument = { formatVersion: 1, templates: {}, projectOwnedRoots: [] };
    const deps = buildDeps({ readProjectStateFn: fakeReadProjectStateFn(document) });
    const result = await validateProject(REPO_ROOT, deps);
    expect(result).toEqual({ ok: true });
  });

  describe('PROJECT_INVALID', () => {
    it('for an unparseable document', async () => {
      const deps = buildDeps({ readProjectStateFn: fakeReadProjectStateFn('{ not valid json') });
      const result = await validateProject(REPO_ROOT, deps);
      expect(result).toMatchObject({ ok: false, code: 'PROJECT_INVALID' });
    });

    it('for a duplicate entry within one name\'s targets[]', async () => {
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: { app: { origin: 'path:vendor/app', version: '1.0.0', targets: ['packages/app', 'packages/app'] } },
        projectOwnedRoots: [],
      };
      const deps = buildDeps({ readProjectStateFn: fakeReadProjectStateFn(document) });

      const result = await validateProject(REPO_ROOT, deps);

      expect(result).toMatchObject({ ok: false, code: 'PROJECT_INVALID', details: { name: 'app', target: 'packages/app' } });
      // Fail-fast BEFORE any resolution is attempted for the offending name.
      expect(throwingFetchFn).not.toHaveBeenCalled();
    });

    it('for a non-canonical target entry', async () => {
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: { app: { origin: 'path:vendor/app', version: '1.0.0', targets: ['./packages/app'] } },
        projectOwnedRoots: [],
      };
      const canonicalizeFn: CanonicalizeTargetFn = (rawTarget) => (rawTarget === './packages/app' ? 'packages/app' : rawTarget);
      const deps = buildDeps({ readProjectStateFn: fakeReadProjectStateFn(document), canonicalizeFn });

      const result = await validateProject(REPO_ROOT, deps);

      expect(result).toMatchObject({
        ok: false,
        code: 'PROJECT_INVALID',
        details: { name: 'app', target: './packages/app' },
      });
    });
  });

  it('reports VERSION_MISMATCH naming the name, the recorded version, and the manifest version', async () => {
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: { app: { origin: 'path:vendor/app', version: '2.0.0', targets: [] } },
      projectOwnedRoots: [],
    };
    const deps = buildDeps({
      readProjectStateFn: fakeReadProjectStateFn(document),
      readFileFn: fakeReadFileFn({ '/repo/vendor/app/frontx-template.json': manifestContent('app', '1.0.0') }),
    });

    const result = await validateProject(REPO_ROOT, deps);

    expect(result).toMatchObject({
      ok: false,
      code: 'VERSION_MISMATCH',
      details: { name: 'app', recordedVersion: '2.0.0', manifestVersion: '1.0.0' },
    });
  });

  describe('ORIGIN_UNAVAILABLE', () => {
    it('for an unresolvable remote origin', async () => {
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: { app: { origin: 'github:acme/app@abc123', version: '1.0.0', targets: [] } },
        projectOwnedRoots: [],
      };
      const deps = buildDeps({
        readProjectStateFn: fakeReadProjectStateFn(document),
        fetchFn: fakeFetchFn({}), // no fixture registered — every fetch fails
      });

      const result = await validateProject(REPO_ROOT, deps);

      expect(result).toMatchObject({
        ok: false,
        code: 'ORIGIN_UNAVAILABLE',
        details: { name: 'app', origin: 'github:acme/app@abc123' },
      });
    });

    it('for a local path: origin whose folder no longer exists', async () => {
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: { app: { origin: 'path:vendor/app', version: '1.0.0', targets: [] } },
        projectOwnedRoots: [],
      };
      const missingFolderExistsFn: PathExistsFn = vi.fn(async () => false);
      const deps = buildDeps({ readProjectStateFn: fakeReadProjectStateFn(document), existsFn: missingFolderExistsFn });

      const result = await validateProject(REPO_ROOT, deps);

      expect(result).toMatchObject({
        ok: false,
        code: 'ORIGIN_UNAVAILABLE',
        details: { name: 'app', origin: 'path:vendor/app' },
      });
    });
  });

  describe('TARGET_CONFLICT', () => {
    // The SAME target under two DIFFERENT names is a geometry finding, not a
    // structural one. `inst-valpa-if-malformed` scopes its duplicate check to
    // "any `targets[]` array carries a duplicate entry" — within ONE array —
    // while the flow's error scenario routes cross-name coincidence here
    // explicitly: "Two recorded targets — under the same or different
    // registered names — coincide or nest ... `TARGET_CONFLICT`, naming the
    // contesting names and the contested ground."
    //
    // An earlier revision reported this as `PROJECT_INVALID` from the
    // structural pass, which used the wrong code AND lost what this check
    // reports: the contested ground and both contestants, which a message
    // about a duplicated key does not carry.
    it('for the same target recorded under two DIFFERENT names, naming the ground and both contestants', async () => {
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: {
          app: { origin: 'path:vendor/app', version: '1.0.0', targets: ['packages/shared'] },
          other: { origin: 'path:vendor/other', version: '1.0.0', targets: ['packages/shared'] },
        },
        projectOwnedRoots: [],
      };
      const deps = buildDeps({
        readProjectStateFn: fakeReadProjectStateFn(document),
        readFileFn: fakeReadFileFn({
          '/repo/vendor/app/frontx-template.json': manifestContent('app', '1.0.0'),
          '/repo/vendor/other/frontx-template.json': manifestContent('other', '1.0.0'),
        }),
      });

      const result = await validateProject(REPO_ROOT, deps);

      expect(result).toMatchObject({ ok: false, code: 'TARGET_CONFLICT' });
      if (!result.ok) {
        const conflicts = result.details?.conflicts as Array<{ ground: string; contestants: Array<{ templateName: string | null }> }>;
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].ground).toBe('packages/shared');
        expect(conflicts[0].contestants.map((c) => c.templateName).sort()).toEqual(['app', 'other']);
      }
    });

    it('for two targets nesting without an excludedSubtrees exemption, naming the contesting names and ground', async () => {
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: {
          outer: { origin: 'path:vendor/outer', version: '1.0.0', targets: ['packages/outer'] },
          inner: { origin: 'path:vendor/inner', version: '1.0.0', targets: ['packages/outer/inner'] },
        },
        projectOwnedRoots: [],
      };
      const deps = buildDeps({
        readProjectStateFn: fakeReadProjectStateFn(document),
        readFileFn: fakeReadFileFn({
          '/repo/vendor/outer/frontx-template.json': manifestContent('outer', '1.0.0'), // no exemption
          '/repo/vendor/inner/frontx-template.json': manifestContent('inner', '1.0.0'),
        }),
      });

      const result = await validateProject(REPO_ROOT, deps);

      expect(result).toMatchObject({ ok: false, code: 'TARGET_CONFLICT' });
      if (!result.ok) {
        const conflicts = result.details?.conflicts as Array<{ ground: string; contestants: Array<{ templateName: string | null }> }>;
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].ground).toBe('packages/outer contains packages/outer/inner');
        expect(conflicts[0].contestants.map((c) => c.templateName).sort()).toEqual(['inner', 'outer']);
      }
    });

    it('accepts the same nesting when the outer name\'s manifest declares the exemption', async () => {
      const document: ProjectStateDocument = {
        formatVersion: 1,
        templates: {
          outer: { origin: 'path:vendor/outer', version: '1.0.0', targets: ['packages/outer'] },
          inner: { origin: 'path:vendor/inner', version: '1.0.0', targets: ['packages/outer/inner'] },
        },
        projectOwnedRoots: [],
      };
      const deps = buildDeps({
        readProjectStateFn: fakeReadProjectStateFn(document),
        readFileFn: fakeReadFileFn({
          '/repo/vendor/outer/frontx-template.json': manifestContent('outer', '1.0.0', ['inner/']),
          '/repo/vendor/inner/frontx-template.json': manifestContent('inner', '1.0.0'),
        }),
      });

      const result = await validateProject(REPO_ROOT, deps);

      expect(result).toEqual({ ok: true });
    });
  });

  // Pins the design's own idempotency assumption: submitting the FULL
  // recorded set against itself (`targetsUnderCheck` carrying everything,
  // `recordedTargets: []`) must not manufacture a self-conflict for a
  // target against its own entry, nor between two unrelated, non-nesting
  // targets — including two targets recorded under the SAME name.
  it('does NOT self-report on a multi-target, multi-name document with no real conflicts', async () => {
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: {
        app: { origin: 'path:vendor/app', version: '1.0.0', targets: ['packages/app-one', 'packages/app-two'] },
        widget: { origin: 'path:vendor/widget', version: '1.0.0', targets: ['packages/widget'] },
      },
      projectOwnedRoots: [],
    };
    const deps = buildDeps({
      readProjectStateFn: fakeReadProjectStateFn(document),
      readFileFn: fakeReadFileFn({
        '/repo/vendor/app/frontx-template.json': manifestContent('app', '1.0.0'),
        '/repo/vendor/widget/frontx-template.json': manifestContent('widget', '1.0.0'),
      }),
    });

    const result = await validateProject(REPO_ROOT, deps);

    expect(result).toEqual({ ok: true });
  });

  it('reports INVALID_PATH naming a projectOwnedRoots entry absent from disk', async () => {
    const document: ProjectStateDocument = { formatVersion: 1, templates: {}, projectOwnedRoots: ['missing-dir'] };
    const missingRootExistsFn: PathExistsFn = vi.fn(async () => false);
    const deps = buildDeps({ readProjectStateFn: fakeReadProjectStateFn(document), existsFn: missingRootExistsFn });

    const result = await validateProject(REPO_ROOT, deps);

    expect(result).toMatchObject({ ok: false, code: 'INVALID_PATH', details: { path: 'missing-dir' } });
  });

  // Fail-fast (`cpt-frontx-algo-composed-provenance-validate-project`'s own
  // "returns on the FIRST finding"): a version mismatch on the FIRST
  // registered name must preempt every later check — the second name's
  // origin is never resolved, and the missing owned root is never reached.
  it('reports only the earlier VERSION_MISMATCH when the document also has a missing owned root, and never resolves the second name\'s origin', async () => {
    const document: ProjectStateDocument = {
      formatVersion: 1,
      templates: {
        app: { origin: 'path:vendor/app', version: '2.0.0', targets: [] },
        later: { origin: 'github:acme/later@abc123', version: '1.0.0', targets: [] },
      },
      projectOwnedRoots: ['missing-dir'],
    };
    const existsFn: PathExistsFn = vi.fn(async () => true);
    const fetchFn = fakeFetchFn({}); // would fail if ever called — asserted below that it is not
    const deps = buildDeps({
      readProjectStateFn: fakeReadProjectStateFn(document),
      readFileFn: fakeReadFileFn({ '/repo/vendor/app/frontx-template.json': manifestContent('app', '1.0.0') }),
      existsFn,
      fetchFn,
    });

    const result = await validateProject(REPO_ROOT, deps);

    expect(result).toMatchObject({ ok: false, code: 'VERSION_MISMATCH', details: { name: 'app' } });
    expect(fetchFn).not.toHaveBeenCalled();
    // `existsFn` fires exactly once — for "app"'s own local origin folder —
    // never again for "later" (never reached) or for the missing owned root
    // (the algorithm returned long before that final loop runs).
    expect(existsFn).toHaveBeenCalledTimes(1);
  });
});
