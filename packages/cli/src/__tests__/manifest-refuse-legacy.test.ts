// @cpt-algo:cpt-frontx-algo-template-manifest-refuse-legacy:p2
// @cpt-dod:cpt-frontx-dod-template-manifest-legacy-refused-outright:p2
import { describe, it, expect } from 'vitest';
import { refuseLegacyManifest } from '../manifest/refuse-legacy';

function currentManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'my-tpl',
    version: '1.0.0',
    excludedSubtrees: [],
    description: 'Establishes the project shell.',
    ...overrides,
  };
}

describe('refuseLegacyManifest - inst-mrl-discriminate / inst-mrl-if-current / inst-mrl-return-current', () => {
  it('a current four-field manifest passes through unchanged', () => {
    const input = currentManifest();
    const result = refuseLegacyManifest(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest).toEqual(input);
  });

  it('a non-object input passes through with no undeclared fields to discriminate on', () => {
    const result = refuseLegacyManifest('not-an-object');
    expect(result.ok).toBe(true);
  });
});

describe('refuseLegacyManifest - inst-mrl-else-legacy / inst-mrl-return-legacy-refused', () => {
  it('refuses a manifest declaring schemaVersion', () => {
    const result = refuseLegacyManifest(currentManifest({ schemaVersion: '1.0' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('INVALID_MANIFEST');
    expect(result.refusal.undeclaredFields).toEqual(['schemaVersion']);
  });

  it('refuses a manifest declaring ownershipBoundaries', () => {
    const result = refuseLegacyManifest(
      currentManifest({ ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.undeclaredFields).toContain('ownershipBoundaries');
  });

  it('names ownershipBoundaries\' own exclusiveSubtrees/sharedFiles children when present', () => {
    const result = refuseLegacyManifest(
      currentManifest({
        ownershipBoundaries: { exclusiveSubtrees: ['src/generated'], sharedFiles: [{ path: 'package.json' }] },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.undeclaredFields).toEqual(
      expect.arrayContaining(['ownershipBoundaries', 'ownershipBoundaries.exclusiveSubtrees', 'ownershipBoundaries.sharedFiles']),
    );
  });

  it('refuses a manifest declaring referencedTemplates', () => {
    const result = refuseLegacyManifest(currentManifest({ referencedTemplates: [{ ref: 'github:acme/mfe@v1' }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.undeclaredFields).toEqual(['referencedTemplates']);
  });

  it('names every undeclared field together in one refusal when several are present', () => {
    const result = refuseLegacyManifest(
      currentManifest({
        schemaVersion: '1.0',
        ownershipBoundaries: { exclusiveSubtrees: [], sharedFiles: [] },
        referencedTemplates: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // ownershipBoundaries' own exclusiveSubtrees/sharedFiles children are
    // present (as empty arrays) in this fixture, so they are named too,
    // alongside their parent.
    expect(result.refusal.undeclaredFields).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'ownershipBoundaries',
        'ownershipBoundaries.exclusiveSubtrees',
        'ownershipBoundaries.sharedFiles',
        'referencedTemplates',
      ]),
    );
    expect(result.refusal.undeclaredFields).toHaveLength(5);
  });

  // No partial credit: the refusal fires the same way regardless of whether
  // `exclusiveSubtrees` was already effectively whole-target (absent, empty,
  // or exactly ["."], with empty `sharedFiles`) or named a genuine proper
  // subset of its target.
  it.each([
    ['absent exclusiveSubtrees', {}],
    ['empty exclusiveSubtrees', { exclusiveSubtrees: [] }],
    ['exclusiveSubtrees exactly ["."]', { exclusiveSubtrees: ['.'] }],
    ['a genuine proper-subset exclusiveSubtrees (a 30-entry-style whitelist)', { exclusiveSubtrees: ['packages/react', 'packages/state', 'src-app'] }],
  ])('refuses a legacy manifest the same way regardless of whether ownershipBoundaries was effectively whole-target: %s', (_label, boundariesOverrides) => {
    const result = refuseLegacyManifest(
      currentManifest({
        ownershipBoundaries: { sharedFiles: [], ...boundariesOverrides },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('INVALID_MANIFEST');
  });

  // No partial credit either way for `description`.
  it.each([
    ['a usable description', 'Establishes the project shell and contributes the build toolchain.'],
    ['an empty description', ''],
    ['a missing description', undefined],
  ])('refuses a legacy manifest the same way regardless of whether description is usable: %s', (_label, description) => {
    const base = currentManifest({ schemaVersion: '1.0' });
    if (description === undefined) delete base.description;
    else base.description = description;

    const result = refuseLegacyManifest(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('INVALID_MANIFEST');
    expect(result.refusal.undeclaredFields).toEqual(['schemaVersion']);
  });
});
