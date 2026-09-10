// @cpt-algo:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1
//
// `inst-invoke-engine` requires the engine be invoked with "the target
// version's resolved origin". These pin the resolution itself: the rule is
// mirrored from the resolver's own source-spec grammar rather than
// re-derived, so a divergence between the two shows up here.
import { describe, it, expect } from 'vitest';

import { resolveTargetOrigin } from '../types.js';

describe('resolveTargetOrigin (inst-invoke-engine — the target version rebased onto the recorded origin)', () => {
  it('replaces the recorded ref with the target version', () => {
    expect(resolveTargetOrigin('github:acme/my-template@v1.0.0', '2.0.0')).toEqual({
      ok: true,
      origin: 'github:acme/my-template@2.0.0',
    });
  });

  it('preserves a subtree selector', () => {
    expect(resolveTargetOrigin('github:gs-layer/gears-frontx//template-shell@b9c496f', 'v0.2.0')).toEqual({
      ok: true,
      origin: 'github:gs-layer/gears-frontx//template-shell@v0.2.0',
    });
  });

  // The resolver bounds the selector at the FIRST `@`, so a ref that itself
  // contains one is replaced whole rather than split at its own `@`.
  it('bounds the recorded ref at the first @, replacing it entirely', () => {
    expect(resolveTargetOrigin('github:acme/repo@release@2024', '3.0.0')).toEqual({
      ok: true,
      origin: 'github:acme/repo@3.0.0',
    });
  });

  it('refuses a local path: origin, which has no ref to rebase', () => {
    const result = resolveTargetOrigin('path:./templates/mine', '2.0.0');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringContaining('local origin') });
  });

  it('refuses an origin carrying no @ref selector', () => {
    expect(resolveTargetOrigin('github:acme/my-template', '2.0.0').ok).toBe(false);
  });

  // An empty selector counts as no selector, exactly as the resolver treats it.
  it('refuses an origin whose @ selector is empty', () => {
    expect(resolveTargetOrigin('github:acme/my-template@', '2.0.0').ok).toBe(false);
  });

  it('refuses an origin with no host: prefix', () => {
    expect(resolveTargetOrigin('acme/my-template@v1.0.0', '2.0.0').ok).toBe(false);
  });
});
