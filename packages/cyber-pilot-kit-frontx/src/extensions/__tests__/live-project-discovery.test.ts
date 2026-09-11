// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
//
// `discoverAndActivateFromScaffoldedProject` — LIVE filesystem realization,
// exercised against a REAL temp directory tree (via `createFsBundleReader`,
// no fake reader), with >=2 disjoint per-template id-scoped subtrees under
// `.frontx/ai/`, proving discovery + composition under installation-order
// precedence and structural-error reporting for a malformed bundle.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { discoverAndActivateFromScaffoldedProject } from '../live-project-discovery.js';
import type { BaseCapabilities } from '../scan.js';

function emptyBase(): BaseCapabilities {
  return new Map([
    ['skills', []],
    ['workflows', []],
    ['guidelines', []],
    ['reference_artifacts', []],
  ]);
}

let projectRoot: string;

afterEach(() => {
  if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
});

describe('discoverAndActivateFromScaffoldedProject (live fs, id-scoped .frontx/ai/<template-identity>/)', () => {
  it('discovers and composes >=2 disjoint identity subtrees from a real .frontx/ai/ tree', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'frontx-ai-discovery-'));
    const aiRoot = joinWithinRoot(projectRoot, '.frontx', 'ai');

    // First conforming bundle: template-alpha, contributes one skill.
    const alphaRoot = joinWithinRoot(aiRoot, 'template-alpha');
    mkdirSync(joinWithinRoot(alphaRoot, 'skills', 'greet'), { recursive: true });
    writeFileSync(joinWithinRoot(alphaRoot, 'skills', 'greet', 'SKILL.md'), '# greet skill');
    writeFileSync(
      joinWithinRoot(alphaRoot, 'extension.json'),
      JSON.stringify({ id: 'template-alpha', entries: [{ id: 'greet', category: 'skills', path: 'skills/greet' }] }),
    );

    // Second, DISJOINT conforming bundle: template-beta, contributes one workflow.
    const betaRoot = joinWithinRoot(aiRoot, 'template-beta');
    mkdirSync(joinWithinRoot(betaRoot, 'workflows'), { recursive: true });
    writeFileSync(joinWithinRoot(betaRoot, 'workflows', 'release.md'), '# release workflow');
    writeFileSync(
      joinWithinRoot(betaRoot, 'extension.json'),
      JSON.stringify({
        id: 'template-beta',
        entries: [{ id: 'release', category: 'workflows', path: 'workflows/release.md' }],
      }),
    );

    const result = discoverAndActivateFromScaffoldedProject(projectRoot, emptyBase(), 0);

    expect(result.errors).toHaveLength(0);
    expect(result.composed.get('skills')?.get('greet')?.entry.id).toBe('greet');
    expect(result.composed.get('workflows')?.get('release')?.entry.id).toBe('release');
  });

  it('reports a structural error for a malformed bundle without affecting a sibling conforming bundle', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'frontx-ai-discovery-'));
    const aiRoot = joinWithinRoot(projectRoot, '.frontx', 'ai');

    // Malformed: anchor declares an entry whose category is outside the closed set.
    const malformedRoot = joinWithinRoot(aiRoot, 'template-malformed');
    mkdirSync(malformedRoot, { recursive: true });
    writeFileSync(
      joinWithinRoot(malformedRoot, 'extension.json'),
      JSON.stringify({ id: 'template-malformed', entries: [{ id: 'bad', category: 'mocks', path: 'mocks/bad.md' }] }),
    );

    // Sibling conforming bundle under the same .frontx/ai/.
    const conformingRoot = joinWithinRoot(aiRoot, 'template-conforming');
    mkdirSync(joinWithinRoot(conformingRoot, 'guidelines'), { recursive: true });
    writeFileSync(joinWithinRoot(conformingRoot, 'guidelines', 'style.md'), '# style guideline');
    writeFileSync(
      joinWithinRoot(conformingRoot, 'extension.json'),
      JSON.stringify({
        id: 'template-conforming',
        entries: [{ id: 'style', category: 'guidelines', path: 'guidelines/style.md' }],
      }),
    );

    const result = discoverAndActivateFromScaffoldedProject(projectRoot, emptyBase(), 0);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.entryId === 'bad')).toBe(true);
    expect(result.composed.get('guidelines')?.get('style')?.entry.id).toBe('style');
  });

  it('yields no discovered bundles (not itself a structural error) when .frontx/ai/ is absent', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'frontx-ai-discovery-'));

    const result = discoverAndActivateFromScaffoldedProject(projectRoot, emptyBase(), 0);

    expect(result.errors).toHaveLength(0);
    expect(result.composed.get('skills')?.size ?? 0).toBe(0);
  });
});
