// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
import { describe, it, expect } from 'vitest';
import {
  discoverAndActivateForInstalledTemplate,
  discoverAndActivateFromInstalledTemplateFs,
  validateBundleForPublish,
} from '../discover-and-activate.js';
import type { BundleFsReader } from '../fs-discovery.js';
import { AiExtensionLifecycleState } from '../types.js';
import type { BaseCapabilities } from '../scan.js';
import type { ProjectStateDocument } from '../../project-state.js';

function makeFakeReader(files: Record<string, string>): BundleFsReader {
  const dirChildren = new Map<string, Set<string>>();
  for (const filePath of Object.keys(files)) {
    const parts = filePath.split('/');
    for (let i = 1; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i).join('/');
      const child = parts[i];
      if (!dirChildren.has(dir)) dirChildren.set(dir, new Set());
      dirChildren.get(dir)?.add(child);
    }
  }
  return {
    readFile: (path: string) => files[path],
    listDir: (path: string) => {
      const children = dirChildren.get(path);
      return children ? Array.from(children) : undefined;
    },
  };
}

function emptyBase(): BaseCapabilities {
  return new Map([
    ['skills', []],
    ['workflows', []],
    ['guidelines', []],
    ['reference_artifacts', []],
  ]);
}

/**
 * The trust gate (§1.1-1.2) reads `.frontx/project.json` through the same
 * injected reader every FILESYSTEM-realization test below uses; this helper
 * registers a trusted, pinned origin for each named identity so those tests
 * keep exercising the structural scan/compose behavior they were written
 * for, unaffected by the new trust check that now runs before it.
 */
function trustedState(...identities: string[]): string {
  return JSON.stringify(trustedStateObject(...identities));
}

/**
 * Object form of the SAME trust document, for `discoverAndActivateForInstalledTemplate`
 * — the non-fs entry point takes a `ProjectStateDocument` directly, not a
 * serialized `.frontx/project.json`.
 */
function trustedStateObject(...identities: string[]): ProjectStateDocument {
  return {
    formatVersion: 1,
    templates: Object.fromEntries(identities.map((identity) => [identity, { origin: `path:./templates/${identity}`, version: '1.0.0', targets: ['.'] }])),
    projectOwnedRoots: [],
  };
}

describe('bundle-and-publish leg', () => {
  it('confirms conformance and allows publication for a fully-conforming bundle', () => {
    const bundle = [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' }];
    const result = validateBundleForPublish(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects publication when a declared entry names a category outside the closed set', () => {
    const bundle = [{ id: 'ext-1', category: 'mocks', path: 'mocks/ext-1.md' }];
    const result = validateBundleForPublish(bundle);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects publication when a declared entry omits a required structural element', () => {
    const bundle = [{ id: 'ext-1', category: 'skills' }];
    const result = validateBundleForPublish(bundle);
    expect(result.ok).toBe(false);
  });
});

describe('install-discover-activate leg', () => {
  it('installing a conforming template makes its extensions agent-visible with no manual configuration', () => {
    const bundle = [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1.md' }];
    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 0, 'my-template', trustedStateObject('my-template'));
    expect(result.errors).toHaveLength(0);
    expect(result.composed.get('skills')?.get('skill-1')).toBeDefined();
  });

  it('a malformed entry on install is reported as a structural error and not activated', () => {
    const bundle = [{ id: 'broken', category: 'skills' }];
    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 0, 'my-template', trustedStateObject('my-template'));
    expect(result.errors).toHaveLength(1);
    expect(result.composed.get('skills')?.has('broken')).toBe(false);
  });

  it('discovery is parameterized over the contract: any conforming bundle is found regardless of namespace', () => {
    const bundleA = [{ id: 'acme-skill', category: 'skills', path: 'skills/acme-skill.md' }];
    const bundleB = [{ id: 'other-vendor-skill', category: 'skills', path: 'skills/other-vendor-skill.md' }];
    const projectState = trustedStateObject('acme-template', 'other-vendor-template');
    const resultA = discoverAndActivateForInstalledTemplate(bundleA, emptyBase(), 0, 'acme-template', projectState);
    const resultB = discoverAndActivateForInstalledTemplate(bundleB, emptyBase(), 0, 'other-vendor-template', projectState);
    expect(resultA.composed.get('skills')?.get('acme-skill')).toBeDefined();
    expect(resultB.composed.get('skills')?.get('other-vendor-skill')).toBeDefined();
  });

  it('an untrusted identity is denied — the SAME public entry point the earlier bypass was demonstrated through', () => {
    const bundle = [{ id: 'evil-skill', category: 'skills', path: 'skills/evil.md' }];
    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 1, 'untrusted-template', null);
    expect(result.composed.get('skills')?.has('evil-skill')).toBe(false);
    expect(result.composed.get('skills')?.size ?? 0).toBe(0);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0].identity).toBe('untrusted-template');
  });

  it('the SAME identity activates normally once a project state document registers its origin', () => {
    const bundle = [{ id: 'good-skill', category: 'skills', path: 'skills/good.md' }];
    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 1, 'trusted-template', trustedStateObject('trusted-template'));
    expect(result.composed.get('skills')?.get('good-skill')).toBeDefined();
    expect(result.denials).toHaveLength(0);
  });
});

describe('install-discover-activate leg — FILESYSTEM realization (§1.5 id-scoped AI-Extension Bundle Convention)', () => {
  const PROJECT_ROOT = 'scaffolded-project';
  const AI_ROOT = `${PROJECT_ROOT}/.frontx/ai`;
  const PROJECT_STATE_PATH = `${PROJECT_ROOT}/.frontx/project.json`;

  it('a conforming id-scoped on-disk bundle reaches ACTIVATED and is composed with the base capabilities', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('my-template'),
      [`${AI_ROOT}/my-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/my-template/skills/skill-1/SKILL.md`]: '# Skill 1',
    });

    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);

    expect(result.errors).toHaveLength(0);
    expect(result.composed.get('skills')?.get('skill-1')?.source).toBe('template');
    expect(result.lifecycleResults.some((r) => r.state === AiExtensionLifecycleState.ACTIVATED)).toBe(true);
  });

  it('a malformed on-disk entry reaches REJECTED and is not activated; conforming entries are unaffected', () => {
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

    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);

    expect(result.errors).toHaveLength(1);
    expect(result.composed.get('skills')?.has('broken-skill')).toBe(false);
    expect(result.composed.get('skills')?.get('ok-skill')).toBeDefined();
    expect(result.lifecycleResults.some((r) => r.state === AiExtensionLifecycleState.REJECTED)).toBe(true);
  });

  it('no `.frontx/ai/` bundles at all activates nothing and reports no errors', () => {
    const reader = makeFakeReader({});
    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);
    expect(result.errors).toHaveLength(0);
    expect(result.composed.get('skills')?.size ?? 0).toBe(0);
    expect(result.lifecycleResults).toHaveLength(0);
  });

  it('a missing extension.json anchor for one bundle is a structural error and that bundle activates nothing', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('anchorless-template'),
      [`${AI_ROOT}/anchorless-template/skills/x/README.md`]: 'no anchor here',
    });
    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);
    expect(result.errors).toHaveLength(1);
    expect(result.composed.get('skills')?.size ?? 0).toBe(0);
    expect(result.lifecycleResults).toHaveLength(1);
    expect(result.lifecycleResults[0].state).toBe(AiExtensionLifecycleState.REJECTED);
  });

  it('a bundle-root subdirectory outside the closed set is a structural error and is not activated', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('my-template'),
      [`${AI_ROOT}/my-template/extension.json`]: JSON.stringify({ id: 'bundle', contractVersion: '1.0.0', entries: [] }),
      [`${AI_ROOT}/my-template/mocks/oob.md`]: 'oob content',
    });
    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/outside the closed-set/);
  });

  it('multiple disjoint co-located id-scoped bundles are each discovered and activated; a malformed bundle does not affect the other', () => {
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

    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/not valid JSON/);
    expect(result.composed.get('skills')?.get('good-skill')?.source).toBe('template');
    expect(result.lifecycleResults.some((r) => r.state === AiExtensionLifecycleState.ACTIVATED)).toBe(true);
    expect(result.lifecycleResults.some((r) => r.state === AiExtensionLifecycleState.REJECTED)).toBe(true);
  });
});

describe('install-discover-activate leg — trust gate (§1.1-1.2, §6 DENIED acceptance criterion)', () => {
  const PROJECT_ROOT = 'scaffolded-project';
  const AI_ROOT = `${PROJECT_ROOT}/.frontx/ai`;
  const PROJECT_STATE_PATH = `${PROJECT_ROOT}/.frontx/project.json`;

  it('an untrusted identity activates nothing, is reported as a denial distinct from a structural error, and no slot of it is ever read', () => {
    const files: Record<string, string> = {
      [PROJECT_STATE_PATH]: trustedState(), // no identity registered
      [`${AI_ROOT}/untrusted-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/untrusted-template/skills/skill-1/SKILL.md`]: '# Skill 1',
    };
    const baseReader = makeFakeReader(files);
    const readCalls: string[] = [];
    const spyReader: BundleFsReader = {
      readFile(path) {
        readCalls.push(path);
        return baseReader.readFile(path);
      },
      listDir: baseReader.listDir,
    };

    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, spyReader, emptyBase(), 0);

    expect(result.composed.get('skills')?.size ?? 0).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0].identity).toBe('untrusted-template');

    // A denial is a distinct outcome from a structural error/REJECTED entry
    // (§6): nothing landed in `errors` or as a REJECTED lifecycle result for
    // this identity, and no slot under its bundle root was ever read.
    expect(result.lifecycleResults.some((r) => r.state === AiExtensionLifecycleState.REJECTED)).toBe(false);
    expect(readCalls.some((path) => path.startsWith(`${AI_ROOT}/untrusted-template`))).toBe(false);
  });

  it('a trusted identity activates normally alongside an untrusted sibling, which contributes only a denial', () => {
    const reader = makeFakeReader({
      [PROJECT_STATE_PATH]: trustedState('trusted-template'),
      [`${AI_ROOT}/trusted-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/trusted-template/skills/skill-1/SKILL.md`]: '# Skill 1',
      [`${AI_ROOT}/untrusted-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-2', category: 'skills', path: 'skills/skill-2' }],
      }),
      [`${AI_ROOT}/untrusted-template/skills/skill-2/SKILL.md`]: '# Skill 2',
    });

    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);

    expect(result.composed.get('skills')?.get('skill-1')?.source).toBe('template');
    expect(result.composed.get('skills')?.has('skill-2')).toBe(false);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0].identity).toBe('untrusted-template');
  });

  it('an absent project.json denies every discovered identity', () => {
    const reader = makeFakeReader({
      [`${AI_ROOT}/some-template/extension.json`]: JSON.stringify({
        id: 'bundle',
        contractVersion: '1.0.0',
        entries: [{ id: 'skill-1', category: 'skills', path: 'skills/skill-1' }],
      }),
      [`${AI_ROOT}/some-template/skills/skill-1/SKILL.md`]: '# Skill 1',
    });

    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);

    expect(result.composed.get('skills')?.size ?? 0).toBe(0);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0].identity).toBe('some-template');
  });

  it('a `path:` origin is trusted, activating a locally-developed template', () => {
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

    const result = discoverAndActivateFromInstalledTemplateFs(PROJECT_ROOT, reader, emptyBase(), 0);

    expect(result.denials).toHaveLength(0);
    expect(result.composed.get('skills')?.get('skill-1')?.source).toBe('template');
  });
});
