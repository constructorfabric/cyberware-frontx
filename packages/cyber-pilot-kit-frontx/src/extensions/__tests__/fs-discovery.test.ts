// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
import { describe, it, expect } from 'vitest';
import { discoverExtensionBundlesFromFs, type BundleFsReader } from '../fs-discovery.js';

/**
 * In-memory `BundleFsReader` for fully deterministic, disk-free scan tests.
 * `listDir` mirrors production `readdirSync` + directory-filter semantics:
 * it returns only DIRECTORY child names, never leaf file names, matching
 * `createFsBundleReader`'s real-fs behavior.
 */
function makeFakeReader(files: Record<string, string>): BundleFsReader {
  const dirChildren = new Map<string, Set<string>>();
  for (const filePath of Object.keys(files)) {
    const parts = filePath.split('/');
    // Every proper ancestor of the file's immediate parent is a directory
    // whose child (the next path segment) is itself also a directory.
    for (let i = 1; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i).join('/');
      const child = parts[i];
      if (!dirChildren.has(dir)) dirChildren.set(dir, new Set());
      dirChildren.get(dir)?.add(child);
    }
  }
  return {
    readFile(path: string): string | undefined {
      return files[path];
    },
    listDir(path: string): string[] | undefined {
      const children = dirChildren.get(path);
      return children ? Array.from(children) : undefined;
    },
  };
}

const PROJECT_ROOT = 'scaffolded-project';
const AI_ROOT = `${PROJECT_ROOT}/.frontx/ai`;
const PROJECT_STATE_PATH = `${PROJECT_ROOT}/.frontx/project.json`;

/**
 * The trust gate (§1.1-1.2) reads `.frontx/project.json` through the same
 * injected reader every other test in this file already uses; this helper
 * builds a document that registers a trusted, pinned origin for each named
 * identity so the pre-existing structural-scan tests below keep exercising
 * ONLY the structural behavior they were written for, unaffected by the new
 * trust check that now runs before it.
 */
function trustedState(...identities: string[]): string {
  return JSON.stringify({
    formatVersion: 1,
    templates: Object.fromEntries(
      identities.map((identity) => [identity, { origin: `path:./templates/${identity.replace('/', '-')}`, version: '1.0.0', targets: ['.'] }]),
    ),
    projectOwnedRoots: [],
  });
}

describe('discoverExtensionBundlesFromFs (§1.5 id-scoped AI-Extension Bundle Convention)', () => {
  it('discovers a single id-scoped bundle root and feeds its conforming entries', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('acme-template'),
      [`${AI_ROOT}/acme-template/extension.json`]: JSON.stringify({
        id: 'acme-template-ai-bundle',
        contractVersion: '1.0.0',
        entries: [
          { id: 'skill-1', category: 'skills', path: 'skills/skill-1' },
          { id: 'workflow-1', category: 'workflows', path: 'workflows/workflow-1.md' },
          { id: 'guideline-1', category: 'guidelines', path: 'guidelines/guideline-1.md' },
          { id: 'ref-1', category: 'reference_artifacts', path: 'reference-artifacts/ref-1.yaml' },
        ],
      }),
      [`${AI_ROOT}/acme-template/skills/skill-1/SKILL.md`]: '# Skill 1',
      [`${AI_ROOT}/acme-template/workflows/workflow-1.md`]: '# Workflow 1',
      [`${AI_ROOT}/acme-template/guidelines/guideline-1.md`]: '# Guideline 1',
      [`${AI_ROOT}/acme-template/reference-artifacts/ref-1.yaml`]: 'key: value',
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);

    expect(bundles).toHaveLength(1);
    expect(bundles[0].identity).toBe('acme-template');
    expect(bundles[0].structuralErrors).toHaveLength(0);
    expect(bundles[0].bundle).toHaveLength(4);
    expect(bundles[0].bundle).toContainEqual({ id: 'skill-1', category: 'skills', path: 'skills/skill-1' });
  });

  it('discovers a scoped npm-style identity (`@scope/name`) bundle root two path segments deep', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('@gears-frontx/frontx-template-shell'),
      [`${AI_ROOT}/@gears-frontx/frontx-template-shell/extension.json`]: JSON.stringify({
        id: 'frontx-template-shell-ai-bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/@gears-frontx/frontx-template-shell/skills/skill-1/SKILL.md`]: '# Skill 1',
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);

    expect(bundles).toHaveLength(1);
    expect(bundles[0].identity).toBe('@gears-frontx/frontx-template-shell');
    expect(bundles[0].structuralErrors).toHaveLength(0);
    expect(bundles[0].bundle).toContainEqual({ id: 'skill-1', category: 'skills', path: 'skills/skill-1' });
  });

  it('discovers multiple co-applied scoped bundles under the same npm scope independently', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('@gears-frontx/template-a', '@gears-frontx/template-b'),
      [`${AI_ROOT}/@gears-frontx/template-a/extension.json`]: JSON.stringify({
        id: 'template-a-bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-a', category: 'skills', path: 'skills/skill-a' }],
      }),
      [`${AI_ROOT}/@gears-frontx/template-a/skills/skill-a/SKILL.md`]: '# Skill A',
      [`${AI_ROOT}/@gears-frontx/template-b/extension.json`]: JSON.stringify({
        id: 'template-b-bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-b', category: 'skills', path: 'skills/skill-b' }],
      }),
      [`${AI_ROOT}/@gears-frontx/template-b/skills/skill-b/SKILL.md`]: '# Skill B',
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    const byIdentity = new Map(bundles.map((b) => [b.identity, b]));

    expect(bundles).toHaveLength(2);
    expect(byIdentity.get('@gears-frontx/template-a')?.structuralErrors).toHaveLength(0);
    expect(byIdentity.get('@gears-frontx/template-b')?.structuralErrors).toHaveLength(0);
  });

  it('an npm scope directory with no nested package name yields a missing-anchor structural error under the scope identity', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('@empty-scope'),
      [`${AI_ROOT}/@empty-scope/.keep`]: '',
    });
    // makeFakeReader only registers directories that are proper ancestors of
    // a FILE's parent; give `@empty-scope` itself no listable children by
    // using a reader that reports it as an existing, empty directory.
    const emptyScopeReader: BundleFsReader = {
      readFile: reader.readFile,
      listDir(path: string) {
        if (path === AI_ROOT) return ['@empty-scope'];
        if (path === `${AI_ROOT}/@empty-scope`) return [];
        return reader.listDir(path);
      },
    };

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, emptyScopeReader);

    expect(bundles).toHaveLength(1);
    expect(bundles[0].identity).toBe('@empty-scope');
    expect(bundles[0].structuralErrors[0].message).toMatch(/missing AI-extension bundle anchor/);
  });

  it('discovers multiple disjoint co-located id-scoped bundles independently', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('acme-template', 'other-template'),
      [`${AI_ROOT}/acme-template/extension.json`]: JSON.stringify({
        id: 'acme-bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'acme-skill', category: 'skills', path: 'skills/acme-skill' }],
      }),
      [`${AI_ROOT}/acme-template/skills/acme-skill/SKILL.md`]: '# Acme Skill',
      [`${AI_ROOT}/other-template/extension.json`]: JSON.stringify({
        id: 'other-bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'other-skill', category: 'skills', path: 'skills/other-skill' }],
      }),
      [`${AI_ROOT}/other-template/skills/other-skill/SKILL.md`]: '# Other Skill',
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);

    expect(bundles).toHaveLength(2);
    const byIdentity = new Map(bundles.map((b) => [b.identity, b]));
    expect(byIdentity.get('acme-template')?.bundle).toContainEqual({
      id: 'acme-skill',
      category: 'skills',
      path: 'skills/acme-skill',
    });
    expect(byIdentity.get('other-template')?.bundle).toContainEqual({
      id: 'other-skill',
      category: 'skills',
      path: 'skills/other-skill',
    });
    expect(byIdentity.get('acme-template')?.structuralErrors).toHaveLength(0);
    expect(byIdentity.get('other-template')?.structuralErrors).toHaveLength(0);
  });

  it('a malformed anchor in one bundle yields a structural error for it while other bundles still discover', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('broken-template', 'good-template'),
      [`${AI_ROOT}/broken-template/extension.json`]: '{not json',
      [`${AI_ROOT}/good-template/extension.json`]: JSON.stringify({
        id: 'good-bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'good-skill', category: 'skills', path: 'skills/good-skill' }],
      }),
      [`${AI_ROOT}/good-template/skills/good-skill/SKILL.md`]: '# Good Skill',
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    const byIdentity = new Map(bundles.map((b) => [b.identity, b]));

    expect(byIdentity.get('broken-template')?.bundle).toHaveLength(0);
    expect(byIdentity.get('broken-template')?.structuralErrors[0].message).toMatch(/not valid JSON/);
    expect(byIdentity.get('good-template')?.bundle).toHaveLength(1);
    expect(byIdentity.get('good-template')?.structuralErrors).toHaveLength(0);
  });

  it('a bundle with no extension.json anchor yields a structural error and an empty bundle', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('anchorless-template'),
      [`${AI_ROOT}/anchorless-template/skills/x/README.md`]: 'no anchor here',
    });
    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].bundle).toHaveLength(0);
    expect(bundles[0].structuralErrors[0].message).toMatch(/missing AI-extension bundle anchor/);
  });

  it('an identity-less anchor (missing "id") yields a structural error and an empty bundle', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('no-id-template'),
      [`${AI_ROOT}/no-id-template/extension.json`]: JSON.stringify({ contractVersion: '1.0.0', entries: [] }),
    });
    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    expect(bundles[0].bundle).toHaveLength(0);
    expect(bundles[0].structuralErrors[0].message).toMatch(/missing a bundle identity/);
  });

  it('a bundle-root subdirectory outside the four-slot closed set yields a "category outside the closed set" structural error, scoped to that bundle', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('my-template'),
      [`${AI_ROOT}/my-template/extension.json`]: JSON.stringify({ id: 'bundle', contractVersion: '1.0.0', entries: [] }),
      [`${AI_ROOT}/my-template/mocks/oob.md`]: 'oob content',
    });
    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].structuralErrors).toHaveLength(1);
    expect(bundles[0].structuralErrors[0].message).toMatch(/outside the closed-set/);
  });

  it('a skill entry whose directory is missing SKILL.md is REJECTED, not silently skipped', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('my-template'),
      [`${AI_ROOT}/my-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'broken-skill', category: 'skills', path: 'skills/broken-skill' }],
      }),
      [`${AI_ROOT}/my-template/skills/broken-skill/README.md`]: 'not a skill file',
    });
    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    expect(bundles[0].bundle).toHaveLength(0);
    expect(bundles[0].structuralErrors).toHaveLength(1);
    expect(bundles[0].structuralErrors[0].message).toMatch(/missing SKILL\.md/);
  });

  it('a malformed entry does not affect conforming entries from the same bundle', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('my-template'),
      [`${AI_ROOT}/my-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [
          { id: 'broken-skill', category: 'skills', path: 'skills/broken-skill' },
          { id: 'ok-skill', category: 'skills', path: 'skills/ok-skill' },
        ],
      }),
      [`${AI_ROOT}/my-template/skills/ok-skill/SKILL.md`]: '# OK Skill',
    });
    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    expect(bundles[0].structuralErrors).toHaveLength(1);
    expect(bundles[0].bundle).toHaveLength(1);
    expect(bundles[0].bundle).toContainEqual({ id: 'ok-skill', category: 'skills', path: 'skills/ok-skill' });
  });

  it('an entry naming a category outside the closed set is a structural error, not a silent skip', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('my-template'),
      [`${AI_ROOT}/my-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'oob-entry', category: 'mocks', path: 'mocks/oob-entry.md' }],
      }),
    });
    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    expect(bundles[0].bundle).toHaveLength(0);
    expect(bundles[0].structuralErrors[0].message).toMatch(/outside the closed set/);
  });

  it('no `.frontx/ai/` directory at all yields no discovered bundles (not an error)', () => {
    const reader = makeFakeReader({});
    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);
    expect(bundles).toHaveLength(0);
  });
});

describe('discoverExtensionBundlesFromFs — trust gate (§1.1-1.2, §4 transition 1)', () => {
  it('an identity with no registered origin is DENIED, and no slot of its bundle is ever read', () => {
    const files: Record<string, string> = {
      [PROJECT_STATE_PATH]: trustedState(), // no identity registered at all
      [`${AI_ROOT}/untrusted-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/untrusted-template/skills/skill-1/SKILL.md`]: '# Skill 1',
    };
    const baseReader = makeFakeReader(files);
    const readCalls: string[] = [];
    const listCalls: string[] = [];
    const spyReader: BundleFsReader = {
      readFile(path) {
        readCalls.push(path);
        return baseReader.readFile(path);
      },
      listDir(path) {
        listCalls.push(path);
        return baseReader.listDir(path);
      },
    };

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, spyReader);

    expect(bundles).toHaveLength(1);
    expect(bundles[0].identity).toBe('untrusted-template');
    expect(bundles[0].denial).toBeDefined();
    expect(bundles[0].denial?.identity).toBe('untrusted-template');
    expect(bundles[0].bundle).toHaveLength(0);
    expect(bundles[0].structuralErrors).toHaveLength(0);

    // Proves "denied before any slot is scanned": nothing under the denied
    // identity's own bundle root — not even its extension.json anchor — was
    // ever read or listed.
    const bundleRoot = `${AI_ROOT}/untrusted-template`;
    expect(readCalls.some((path) => path.startsWith(bundleRoot))).toBe(false);
    expect(listCalls.some((path) => path.startsWith(bundleRoot))).toBe(false);
  });

  it('a `path:` origin is trusted exactly like a remote pinned origin', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: JSON.stringify({
        formatVersion: 1,
        templates: { 'local-template': { origin: 'path:./templates/local-template', version: '0.0.0', targets: ['.'] } },
        projectOwnedRoots: [],
      }),
      [`${AI_ROOT}/local-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/local-template/skills/skill-1/SKILL.md`]: '# Skill 1',
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);

    expect(bundles[0].denial).toBeUndefined();
    expect(bundles[0].bundle).toHaveLength(1);
  });

  it('an absent project.json denies every discovered bundle', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/acme-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/acme-template/skills/skill-1/SKILL.md`]: '# Skill 1',
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);

    expect(bundles[0].denial).toBeDefined();
    expect(bundles[0].bundle).toHaveLength(0);
    expect(bundles[0].structuralErrors).toHaveLength(0);
  });

  it('an unparseable project.json denies every discovered bundle', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: '{not json',
      [`${AI_ROOT}/acme-template/extension.json`]: JSON.stringify({ id: 'bundle', contractVersion: '1.0.0', entries: [] }),
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);

    expect(bundles[0].denial).toBeDefined();
  });

  it('a project.json missing a "templates" map denies every discovered bundle (deny is the safe direction)', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: JSON.stringify({ formatVersion: 1 }),
      [`${AI_ROOT}/acme-template/extension.json`]: JSON.stringify({ id: 'bundle', contractVersion: '1.0.0', entries: [] }),
    });

    const bundles = discoverExtensionBundlesFromFs(PROJECT_ROOT, reader);

    expect(bundles[0].denial).toBeDefined();
  });
});
