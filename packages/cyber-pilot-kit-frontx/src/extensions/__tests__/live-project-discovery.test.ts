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

/** A base kit capability set carrying ONE skill no installed template overrides. */
function baseWithOneSkill(): BaseCapabilities {
  return new Map([
    ['skills', [{ id: 'base-skill', category: 'skills', path: 'base/base-skill.md' } as const]],
    ['workflows', []],
    ['guidelines', []],
    ['reference_artifacts', []],
  ]);
}

/**
 * Writes a trusted `.frontx/project.json` registering a pinned `path:`
 * origin for each named identity — the trust gate (§1.1-1.2) now requires
 * this before ANY bundle activates, including in this suite's real-fs
 * exercises.
 */
function writeTrustedProjectState(projectRoot: string, ...identities: string[]): void {
  mkdirSync(join(projectRoot, '.frontx'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.frontx', 'project.json'),
    JSON.stringify({
      formatVersion: 1,
      templates: Object.fromEntries(identities.map((identity) => [identity, { origin: `path:./templates/${identity}`, version: '1.0.0', targets: ['.'] }])),
      projectOwnedRoots: [],
    }),
  );
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

    writeTrustedProjectState(projectRoot, 'template-alpha', 'template-beta');

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

    writeTrustedProjectState(projectRoot, 'template-malformed', 'template-conforming');

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

  it('a bundle whose identity has no registered origin in a real project.json is DENIED, not activated', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'frontx-ai-discovery-'));
    const aiRoot = join(projectRoot, '.frontx', 'ai');

    const untrustedRoot = join(aiRoot, 'template-untrusted');
    mkdirSync(join(untrustedRoot, 'skills', 'greet'), { recursive: true });
    writeFileSync(join(untrustedRoot, 'skills', 'greet', 'SKILL.md'), '# greet skill');
    writeFileSync(
      join(untrustedRoot, 'extension.json'),
      JSON.stringify({ id: 'template-untrusted', entries: [{ id: 'greet', category: 'skills', path: 'skills/greet' }] }),
    );

    // A real project.json that registers a DIFFERENT identity — this bundle's
    // own identity carries no entry in it at all.
    writeTrustedProjectState(projectRoot, 'some-other-template');

    const result = discoverAndActivateFromScaffoldedProject(projectRoot, emptyBase(), 0);

    expect(result.composed.get('skills')?.size ?? 0).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0].identity).toBe('template-untrusted');
  });

  // Regression: two co-applied TRUSTED identities discovered in the SAME
  // scan are PEERS — neither is the other's base. A prior fix folded each
  // identity's composed output forward as the NEXT identity's base
  // (`composedToBaseCapabilities`), which silently relabeled an earlier
  // template's contribution as a 'base' one from the second call's
  // perspective (`CapabilityContribution.source` documents 'base' as
  // strictly "the framework's base kit"). This test proves that no longer
  // happens: reproduces the reporter's real on-disk repro shape (two
  // trusted templates plus a planted untrusted bundle) through a REAL temp
  // directory tree (`createFsBundleReader`, no fake reader), rather than
  // depending on the reporter's throwaway scratch-path fixture.
  it('preserves true provenance and precedence across co-applied identities, and denies a planted untrusted one', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'frontx-ai-discovery-'));
    const aiRoot = join(projectRoot, '.frontx', 'ai');

    // template-alpha: a unique skill, plus a contribution to the SAME
    // slot+id ('shared-skill') a sibling template also declares.
    const alphaRoot = join(aiRoot, 'template-alpha');
    mkdirSync(join(alphaRoot, 'skills', 'greet'), { recursive: true });
    writeFileSync(join(alphaRoot, 'skills', 'greet', 'SKILL.md'), '# greet skill');
    mkdirSync(join(alphaRoot, 'skills', 'shared-skill'), { recursive: true });
    writeFileSync(join(alphaRoot, 'skills', 'shared-skill', 'SKILL.md'), '# shared skill (alpha version)');
    writeFileSync(
      join(alphaRoot, 'extension.json'),
      JSON.stringify({
        id: 'template-alpha',
        entries: [
          { id: 'greet', category: 'skills', path: 'skills/greet' },
          { id: 'shared-skill', category: 'skills', path: 'skills/shared-skill' },
        ],
      }),
    );

    // template-beta: a unique skill, plus its OWN version of 'shared-skill'.
    const betaRoot = join(aiRoot, 'template-beta');
    mkdirSync(join(betaRoot, 'skills', 'wave'), { recursive: true });
    writeFileSync(join(betaRoot, 'skills', 'wave', 'SKILL.md'), '# wave skill');
    // Beta's own version of `shared-skill` sits at a DISTINCT path. Both
    // peers declaring the identical `path` made the winner unobservable:
    // `AiExtensionEntry` carries only `{id, category, path}`, so two
    // same-id entries with the same path are indistinguishable in the
    // composed result and any assertion on it passes whichever one won.
    mkdirSync(join(betaRoot, 'skills', 'shared-skill-beta'), { recursive: true });
    writeFileSync(join(betaRoot, 'skills', 'shared-skill-beta', 'SKILL.md'), '# shared skill (beta version)');
    writeFileSync(
      join(betaRoot, 'extension.json'),
      JSON.stringify({
        id: 'template-beta',
        entries: [
          { id: 'wave', category: 'skills', path: 'skills/wave' },
          { id: 'shared-skill', category: 'skills', path: 'skills/shared-skill-beta' },
        ],
      }),
    );

    // Planted, UNTRUSTED bundle — never registered in project.json.
    const evilRoot = join(aiRoot, '@evil-corp', 'planted-bundle');
    mkdirSync(join(evilRoot, 'skills', 'evil-skill'), { recursive: true });
    writeFileSync(join(evilRoot, 'skills', 'evil-skill', 'SKILL.md'), '# planted skill');
    writeFileSync(
      join(evilRoot, 'extension.json'),
      JSON.stringify({ id: 'planted-bundle', entries: [{ id: 'evil-skill', category: 'skills', path: 'skills/evil-skill' }] }),
    );

    // Only the two legitimate identities are registered with a pinned origin.
    writeTrustedProjectState(projectRoot, 'template-alpha', 'template-beta');

    const result = discoverAndActivateFromScaffoldedProject(projectRoot, baseWithOneSkill(), 1);
    const skills = result.composed.get('skills');

    // A base-kit entry no template overrides keeps source 'base'.
    expect(skills?.get('base-skill')?.source).toBe('base');

    // BOTH trusted identities' distinct contributions are labelled
    // 'template' — neither is mislabelled 'base', regardless of which of
    // the two was folded through the algorithm first.
    expect(skills?.get('greet')?.source).toBe('template');
    expect(skills?.get('wave')?.source).toBe('template');

    // Same slot+id from two peer templates: `discoverExtensionBundlesFromFs`
    // returns identities in sorted order (alpha, then beta), both fed
    // through the SAME `installOrder` (1) here — the precedence rule's tie
    // break is "candidate.installOrder >= existing.installOrder", so the
    // LATER-processed identity (beta) wins. If a future change to the
    // precedence rule flips this, this assertion fails loudly rather than
    // silently keeping the old (coincidentally identical) winner.
    expect(skills?.get('shared-skill')?.source).toBe('template');
    // The path is what names the WINNER: alpha declared `skills/shared-skill`
    // and beta `skills/shared-skill-beta` for the same id, so this asserts
    // beta won rather than merely asserting that something won.
    expect(skills?.get('shared-skill')?.entry.path).toBe('skills/shared-skill-beta');
    expect(skills?.get('shared-skill')?.installOrder).toBe(1);

    // The planted untrusted identity contributes nothing and is denied exactly once.
    expect(skills?.has('evil-skill')).toBe(false);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0].identity).toBe('@evil-corp/planted-bundle');
    expect(result.errors).toHaveLength(0);
  });
});
