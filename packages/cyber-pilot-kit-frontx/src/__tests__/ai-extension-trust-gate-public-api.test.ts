// @cpt-dod:cpt-frontx-dod-template-ai-extensions-contract-conformance:p1
//
// Regression test for a real bypass found empirically: `discoverAndActivateForInstalledTemplate`
// is exported from `src/index.ts` and, before the fix this test guards, took
// `(bundle, baseCapabilities, installOrder)` — no identity, no project
// state — so it ran no trust check at all and activated an untrusted
// bundle's entries outright. Probing the PUBLIC entry point (`../index.js`,
// exactly as any external consumer of this package would import it) is
// deliberate: a fix that only closes an internal call site while leaving
// the exported function's own signature unguarded would leave this exact
// bypass open again.
import { describe, it, expect } from 'vitest';
import { discoverAndActivateForInstalledTemplate } from '../index.js';
import type { ProjectStateDocument } from '../index.js';

function emptyBase() {
  return new Map([
    ['skills', []],
    ['workflows', []],
    ['guidelines', []],
    ['reference_artifacts', []],
  ]) as Parameters<typeof discoverAndActivateForInstalledTemplate>[1];
}

describe('trust gate — public API cannot be bypassed (discoverAndActivateForInstalledTemplate)', () => {
  it('an identity with no registered origin activates NOTHING and reports exactly one denial', () => {
    const bundle = [{ id: 'evil-skill', category: 'skills', path: 'skills/evil.md' }];

    // No project state document at all — the exact call shape the original
    // probe used (`new Map()` for base capabilities, no identity, no state).
    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 1, 'untrusted-template', null);

    const skills = result.composed.get('skills');
    expect(skills?.has('evil-skill')).toBe(false);
    expect(skills?.size ?? 0).toBe(0);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0].identity).toBe('untrusted-template');
  });

  it('the SAME call, with a project state document that registers that identity\'s origin, activates normally', () => {
    const bundle = [{ id: 'good-skill', category: 'skills', path: 'skills/good.md' }];
    const projectState: ProjectStateDocument = {
      formatVersion: 1,
      templates: { 'trusted-template': { origin: 'path:./templates/trusted-template', version: '1.0.0', targets: ['.'] } },
      projectOwnedRoots: [],
    };

    const result = discoverAndActivateForInstalledTemplate(bundle, emptyBase(), 1, 'trusted-template', projectState);

    const skills = result.composed.get('skills');
    expect(skills?.get('good-skill')).toBeDefined();
    expect(result.denials).toHaveLength(0);
  });
});
