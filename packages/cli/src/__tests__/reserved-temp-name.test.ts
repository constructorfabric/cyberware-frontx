// Adversarial-review finding (LOW): the reserved temp-file predicate must
// match ANY path segment carrying the suffix (not only the leaf filename)
// and must compare case-insensitively (APFS/NTFS are both case-insensitive
// filesystems) - otherwise a payload directory or differently-cased file
// collides with the convention the two consumers share without either of
// them noticing.
import { describe, it, expect } from 'vitest';
import { isReservedTempName, RESERVED_TEMP_SUFFIX } from '../paths/reserved-temp-name';

describe('isReservedTempName', () => {
  it('matches a leaf filename carrying the suffix', () => {
    expect(isReservedTempName(`src/app.ts${RESERVED_TEMP_SUFFIX}`)).toBe(true);
  });

  it('does not match an ordinary filename', () => {
    expect(isReservedTempName('src/app.ts')).toBe(false);
  });

  // A payload directory carrying the reserved name is refused for the same
  // reason a file with that name is: every path beneath it carries the
  // reserved suffix in an ancestor segment. That is a publish-side rule this
  // predicate owns, wider than what the upgrade engine itself writes.
  it('matches when a NON-LEAF path segment carries the suffix (a payload directory named this way)', () => {
    expect(isReservedTempName(`evil${RESERVED_TEMP_SUFFIX}/package.json`)).toBe(true);
  });

  it('matches the bare suffixed segment on its own', () => {
    expect(isReservedTempName(`evil${RESERVED_TEMP_SUFFIX}`)).toBe(true);
  });

  // APFS (macOS default) and NTFS are both case-insensitive: a payload file
  // spelled in a different case is the SAME on-disk file as the engine's
  // own temp for that destination.
  it('matches case-insensitively', () => {
    expect(isReservedTempName('FOO.FRONTX-UPGRADE-TMP')).toBe(true);
    expect(isReservedTempName('foo.Frontx-Upgrade-Tmp')).toBe(true);
  });

  it('matches case-insensitively on a non-leaf segment too', () => {
    expect(isReservedTempName('EVIL.FRONTX-UPGRADE-TMP/package.json')).toBe(true);
  });

  it('does not match a filename that merely contains the suffix as a substring mid-name', () => {
    expect(isReservedTempName(`app${RESERVED_TEMP_SUFFIX}.bak`)).toBe(false);
  });

  it('handles a backslash-separated path the same way as a forward-slash one', () => {
    expect(isReservedTempName(`evil${RESERVED_TEMP_SUFFIX}\\package.json`)).toBe(true);
  });
});
