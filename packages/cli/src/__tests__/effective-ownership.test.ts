// @cpt-algo:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
import { describe, expect, it } from 'vitest';
import { computeExclusionRoots, isWithinEffectiveOwnership } from '../scaffold/effective-ownership';

describe('computeExclusionRoots / isWithinEffectiveOwnership (the shared six-term subtraction)', () => {
  it('owns every path under the target when nothing is excluded', () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });
    expect(isWithinEffectiveOwnership('packages/app/src/index.ts', 'packages/app', roots)).toBe(true);
  });

  it('excludes a declared excludedSubtrees entry, re-rooted under the target', () => {
    const roots = computeExclusionRoots({
      target: 'packages/app',
      excludedSubtrees: ['docs/'],
      projectOwnedRoots: [],
    });
    expect(isWithinEffectiveOwnership('packages/app/docs/readme.md', 'packages/app', roots)).toBe(false);
    expect(isWithinEffectiveOwnership('packages/app/src/index.ts', 'packages/app', roots)).toBe(true);
  });

  it('excludes a projectOwnedRoots entry beneath the target', () => {
    const roots = computeExclusionRoots({
      target: '.',
      excludedSubtrees: [],
      projectOwnedRoots: ['docs'],
    });
    expect(isWithinEffectiveOwnership('docs/notes.md', '.', roots)).toBe(false);
    expect(isWithinEffectiveOwnership('src/index.ts', '.', roots)).toBe(true);
  });

  it('unconditionally excludes .frontx and the reserved environment entries beneath the target', () => {
    const roots = computeExclusionRoots({ target: '.', excludedSubtrees: [], projectOwnedRoots: [] });
    expect(isWithinEffectiveOwnership('.frontx/project.json', '.', roots)).toBe(false);
    expect(isWithinEffectiveOwnership('.git/config', '.', roots)).toBe(false);
    expect(isWithinEffectiveOwnership('.DS_Store', '.', roots)).toBe(false);
    expect(isWithinEffectiveOwnership('Thumbs.db', '.', roots)).toBe(false);
  });

  // The local-origin term is not optional: a `path:`-installed template
  // whose own source folder sits beneath its own target would otherwise
  // have that folder computed into the target's owned ground and removed
  // (`inst-dp-compute-ownership`'s own text names exactly this failure).
  it('excludes the template\'s own local origin folder when it sits beneath the target', () => {
    const roots = computeExclusionRoots({
      target: '.',
      excludedSubtrees: [],
      projectOwnedRoots: [],
      localOriginFolder: 'vendor/my-template',
    });
    expect(isWithinEffectiveOwnership('vendor/my-template/frontx-template.json', '.', roots)).toBe(false);
  });

  it('a root that does not sit beneath the target excludes nothing, unconditionally included or not', () => {
    const roots = computeExclusionRoots({
      target: 'packages/app',
      excludedSubtrees: [],
      projectOwnedRoots: ['packages/other-owned'],
    });
    expect(isWithinEffectiveOwnership('packages/app/src/index.ts', 'packages/app', roots)).toBe(true);
  });

  it('a path outside the target entirely is never within its effective ownership', () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });
    expect(isWithinEffectiveOwnership('packages/other/index.ts', 'packages/app', roots)).toBe(false);
  });

  // Sibling names that share a string prefix must not be confused for
  // nesting — the same segment-wise discipline `pathWithinSubtree` already
  // enforces everywhere else this codebase compares paths.
  it('does not treat a string-prefix sibling as inside the target', () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });
    expect(isWithinEffectiveOwnership('packages/app-shell/index.ts', 'packages/app', roots)).toBe(false);
  });

  it('multiple declared excludedSubtrees entries are each re-rooted independently', () => {
    const roots = computeExclusionRoots({
      target: 'packages/app',
      excludedSubtrees: ['docs/', 'vendor/'],
      projectOwnedRoots: [],
    });
    expect(isWithinEffectiveOwnership('packages/app/docs/readme.md', 'packages/app', roots)).toBe(false);
    expect(isWithinEffectiveOwnership('packages/app/vendor/lib.js', 'packages/app', roots)).toBe(false);
    expect(isWithinEffectiveOwnership('packages/app/src/index.ts', 'packages/app', roots)).toBe(true);
  });
});
