// A manifest carrying a malformed legacy `ownershipBoundaries` category must
// not be coerced into a well-formed-LOOKING empty boundary (`{
// exclusiveSubtrees: [], sharedFiles: [] }`) rather than `undefined`: every
// consumer's absence guard (`x === undefined ? ... : ...`) would then never
// fire, and `uniformApply` would filter every content item against an empty
// boundary - the template would apply ZERO files and still report success.
// This suite pins the property: absent AND malformed both mean "this
// manifest cannot drive the legacy geometry"; only a genuinely well-formed
// legacy boundary is ever returned.
import { describe, it, expect } from 'vitest';
import { readLegacyOwnershipBoundary, readLegacyReferencedTemplates } from '../manifest/legacy-ownership';

function contentWith(ownershipBoundaries: unknown): string {
  return JSON.stringify({ name: 'tpl', version: '1.0.0', ownershipBoundaries });
}

describe('readLegacyOwnershipBoundary - absence vs malformed presence', () => {
  it('returns undefined when ownershipBoundaries is entirely absent', () => {
    const content = JSON.stringify({ name: 'tpl', version: '1.0.0' });
    expect(readLegacyOwnershipBoundary(content)).toBeUndefined();
  });

  it('returns undefined when ownershipBoundaries is not an object', () => {
    expect(readLegacyOwnershipBoundary(contentWith('packages'))).toBeUndefined();
    expect(readLegacyOwnershipBoundary(contentWith(['packages']))).toBeUndefined();
    expect(readLegacyOwnershipBoundary(contentWith(null))).toBeUndefined();
  });

  // The exact reproduction from the review: an empty object used to
  // silently become `{ exclusiveSubtrees: [], sharedFiles: [] }`.
  it('returns undefined for an empty ownershipBoundaries object ({}), not a coerced empty boundary', () => {
    expect(readLegacyOwnershipBoundary(contentWith({}))).toBeUndefined();
  });

  it('returns undefined when exclusiveSubtrees is present but not an array', () => {
    expect(
      readLegacyOwnershipBoundary(contentWith({ exclusiveSubtrees: 'packages', sharedFiles: [] })),
    ).toBeUndefined();
  });

  it('returns undefined when exclusiveSubtrees contains a non-string entry', () => {
    expect(
      readLegacyOwnershipBoundary(contentWith({ exclusiveSubtrees: ['packages', 42], sharedFiles: [] })),
    ).toBeUndefined();
  });

  it('returns undefined when sharedFiles is present but not an array', () => {
    expect(
      readLegacyOwnershipBoundary(contentWith({ exclusiveSubtrees: [], sharedFiles: 'package.json' })),
    ).toBeUndefined();
  });

  it('returns undefined when a sharedFiles entry is missing path or mergeStrategy', () => {
    expect(
      readLegacyOwnershipBoundary(
        contentWith({ exclusiveSubtrees: [], sharedFiles: [{ path: 'package.json' }] }),
      ),
    ).toBeUndefined();
  });

  // The retired manifest-contract validator used to enforce this closed set
  // (`inst-if-merge-strategy-invalid`); nothing enforces it now except this
  // accessor.
  it('returns undefined when a sharedFiles entry declares a mergeStrategy outside the closed set', () => {
    expect(
      readLegacyOwnershipBoundary(
        contentWith({
          exclusiveSubtrees: [],
          sharedFiles: [{ path: 'package.json', mergeStrategy: 'deep-merge', ownedRegions: [] }],
        }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined when ownedRegions is present but not an array', () => {
    expect(
      readLegacyOwnershipBoundary(
        contentWith({
          exclusiveSubtrees: [],
          sharedFiles: [{ path: 'package.json', mergeStrategy: 'region-union', ownedRegions: 'scripts.build' }],
        }),
      ),
    ).toBeUndefined();
  });

  it('returns undefined when ownedRegions contains a non-string entry', () => {
    expect(
      readLegacyOwnershipBoundary(
        contentWith({
          exclusiveSubtrees: [],
          sharedFiles: [{ path: 'package.json', mergeStrategy: 'region-union', ownedRegions: ['scripts.build', 7] }],
        }),
      ),
    ).toBeUndefined();
  });

  // An `exclusive` shared-file entry never needed ownedRegions under the
  // retired contract - absence is tolerated (defaults to `[]`), which is
  // NOT the same defect as a present-but-malformed value above.
  it('tolerates an absent ownedRegions on an exclusive shared-file entry, defaulting to []', () => {
    const result = readLegacyOwnershipBoundary(
      contentWith({
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'package.json', mergeStrategy: 'exclusive' }],
      }),
    );
    expect(result).toEqual({
      exclusiveSubtrees: [],
      sharedFiles: [{ path: 'package.json', mergeStrategy: 'exclusive', ownedRegions: [] }],
    });
  });

  it('returns a well-formed legacy boundary unchanged', () => {
    const result = readLegacyOwnershipBoundary(
      contentWith({
        exclusiveSubtrees: ['packages/', 'src/'],
        sharedFiles: [{ path: 'package.json', mergeStrategy: 'region-union', ownedRegions: ['scripts.build'] }],
      }),
    );
    expect(result).toEqual({
      exclusiveSubtrees: ['packages/', 'src/'],
      sharedFiles: [{ path: 'package.json', mergeStrategy: 'region-union', ownedRegions: ['scripts.build'] }],
    });
  });

  it('returns a well-formed legacy boundary that legitimately declares no ground at all', () => {
    // The one shape that MUST still come back as a valid (not undefined)
    // empty boundary: both categories explicitly declared as empty arrays -
    // a template author's deliberate statement, not a malformed omission.
    const result = readLegacyOwnershipBoundary(contentWith({ exclusiveSubtrees: [], sharedFiles: [] }));
    expect(result).toEqual({ exclusiveSubtrees: [], sharedFiles: [] });
  });
});

// The sibling accessor draws the same absent-vs-malformed line, for the same
// reason: an empty reference list is how a LEAF template is recognised, so a
// malformed declaration degrading into one would have a preset apply its
// root template alone and report success.
describe('readLegacyReferencedTemplates - absence vs malformed presence', () => {
  const manifestWith = (referenced: unknown): string =>
    JSON.stringify({
      name: '@scope/tpl',
      version: '1.0.0',
      excludedSubtrees: [],
      description: 'A template.',
      ...(referenced === undefined ? {} : { referencedTemplates: referenced }),
    });

  it('returns an empty list when the category is absent (an ordinary leaf template)', () => {
    expect(readLegacyReferencedTemplates(manifestWith(undefined))).toEqual([]);
  });

  it('returns an empty list for an explicitly empty list (a deliberate leaf declaration)', () => {
    expect(readLegacyReferencedTemplates(manifestWith([]))).toEqual([]);
  });

  it('returns the declared references unchanged', () => {
    expect(readLegacyReferencedTemplates(manifestWith([{ ref: '@scope/other' }]))).toEqual([
      { ref: '@scope/other' },
    ]);
  });

  it.each([
    ['a non-array declaration', { ref: '@scope/other' }],
    ['an entry that is not an object', ['@scope/other']],
    ['an entry whose ref is not a string', [{ ref: 42 }]],
    ['an entry whose ref is an empty string', [{ ref: '   ' }]],
    ['an entry missing ref entirely', [{ reff: '@scope/other' }]],
  ])('returns undefined for %s, never a silently empty list', (_label, referenced) => {
    expect(readLegacyReferencedTemplates(manifestWith(referenced))).toBeUndefined();
  });

  it('returns undefined for content that is not parseable at all', () => {
    expect(readLegacyReferencedTemplates('{ not json')).toBeUndefined();
  });
});
