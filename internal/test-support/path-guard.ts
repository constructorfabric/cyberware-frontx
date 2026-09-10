import path from 'node:path';

/**
 * Discriminated error thrown by `joinWithinRoot()`, so callers (and tests)
 * can assert on a stable `code` instead of matching the human-readable
 * `message` with a regex — the message text is free to be reworded without
 * breaking every consumer.
 */
export class PathGuardError extends Error {
  constructor(
    public readonly code: 'UNSAFE_SEGMENT' | 'ESCAPES_ROOT',
    message: string,
  ) {
    super(message);
    this.name = 'PathGuardError';
  }
}

/**
 * Character-level safety check for a single path segment.
 *
 * Modeled on `isSafePathSegment()` in
 * `scripts/check-test-dependency-versions.mjs` (~L158), extended with an
 * explicit `:` rejection: on POSIX hosts `path.relative`/`path.resolve`
 * based containment checks do not treat `:` specially (colons are legal in
 * POSIX filenames), so a Windows drive-relative segment such as `C:temp.txt`
 * would otherwise slip past character screening on this dev machine. This
 * check rejects any segment containing `:` regardless of host OS.
 */
function isSafePathSegment(segment: string): boolean {
  if (typeof segment !== 'string' || segment.length === 0) {
    return false;
  }
  if (segment === '.' || segment === '..') {
    return false;
  }
  if (
    segment.includes(path.sep) ||
    segment.includes(path.posix.sep) ||
    segment.includes(path.win32.sep) ||
    segment.includes('\0') ||
    segment.includes(':')
  ) {
    return false;
  }
  return true;
}

/**
 * Join `segments` onto `root`, validating each segment individually and then
 * confirming (via `path.relative`) that the resulting path cannot escape
 * `root`.
 *
 * This is a pure string/segment-level guard: it does no filesystem
 * canonicalization and provides no symlink-escape defense.
 *
 * `root` is assumed to be a trusted, non-attacker-controlled path (e.g.
 * produced by `fs.mkdtempSync`) and is not screened by this function — only
 * `...segments` undergo the per-segment character screening described above.
 *
 * Calling with zero segments is an intentional no-op: it returns
 * `path.resolve(root)` unchanged.
 *
 * @throws {PathGuardError} with code `'UNSAFE_SEGMENT'` if any segment is
 *   unsafe, or code `'ESCAPES_ROOT'` if the joined result escapes `root`.
 */
export function joinWithinRoot(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (!isSafePathSegment(segment)) {
      throw new PathGuardError(
        'UNSAFE_SEGMENT',
        `joinWithinRoot: unsafe segment: ${JSON.stringify(segment)}`,
      );
    }
  }

  const resolvedRoot = path.resolve(root);
  const joined = path.resolve(resolvedRoot, ...segments);
  const relativeToRoot = path.relative(resolvedRoot, joined);
  // Defense-in-depth: this containment check guards against a *future*
  // weakening of `isSafePathSegment` (e.g. if the `:` rejection above were
  // ever loosened). Given the current character-level guarantees — every
  // segment is individually forbidden from being '.', '..', empty, or
  // containing a path separator, null byte, or ':' — no segment can ever
  // combine with others to produce a `joined` path outside `resolvedRoot`,
  // so this branch is not currently reachable/exercised by any test.
  //
  // The separator-qualified `..`-prefix check below (`!== '..'` and
  // `!startsWith('..' + path.sep)`) is also a deliberate correction of the
  // same naive substring-only `startsWith('..')` pattern, which would
  // false-positive-reject a legitimate segment like `'..hidden'`. That naive
  // pattern appears in two places this helper does NOT replace:
  // `resolvePackageJsonPathWithinRoot` in
  // `scripts/check-test-dependency-versions.mjs`, and `assertWithinRoot` in
  // `packages/cli/src/adapters/fs-installed-content-path.ts` (production
  // code, `cpt-frontx-algo-template-resolution-bounded-update` boundary
  // invariant). Fixing either of those copies is out of scope for issue
  // #597 — this comment exists so the known bug is not left documented only
  // in this file's own copy.
  const isInsideRoot =
    relativeToRoot === '' ||
    (relativeToRoot !== '..' &&
      !relativeToRoot.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeToRoot));

  if (!isInsideRoot) {
    throw new PathGuardError(
      'ESCAPES_ROOT',
      `joinWithinRoot: joined path escapes root (${JSON.stringify(resolvedRoot)}): ${JSON.stringify(joined)}`,
    );
  }

  return joined;
}
