// Path-shape predicates shared by the modules that accept a path-like string
// from outside the CLI: a subtree segment in a developer-supplied source-spec,
// an identity a template's manifest declares, and the exclusive subtrees a
// manifest claims as ownership ground. All of them end up addressing a location
// under a root the CLI owns, so all of them answer to one rule rather than to
// several that can drift apart — the drift this module exists to prevent is one
// caller deciding containment by bare string prefix while another decides it by
// path segment, which makes the same two paths overlap for one and not the
// other.
//
// Ground equality below folds through `foldForIdentity`
// (`./volume-case.ts`) rather than comparing raw strings: on a
// case-insensitive volume (macOS/APFS, Windows/NTFS) two spellings differing
// only in case name the same ground, and treating them as different is the
// defect a caller-supplied path this module exists to compare correctly
// would otherwise reintroduce one segment at a time.
import { foldForIdentity } from './volume-case';

// A safe relative path: no surrounding whitespace, not absolute, no backslash,
// no unsafe character, and no empty, "." or ".." segment. Rejecting rather than
// normalizing keeps one spelling per addressed location and keeps the value
// unable to climb out of the root it is resolved against.
export function isSafeRelativePath(value: string): boolean {
  if (value.trim() !== value) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  if (hasUnsafePathChar(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

// Characters that must never reach a filesystem adapter in a path-like value.
// A control character (NUL among them) makes the platform API throw, which
// escapes the result union every caller here returns instead. A colon carries a
// Windows drive designator, so `C:/outside` would be an absolute path on one
// platform and an ordinary relative segment on the other — neither a template
// identity nor a subtree segment has a legitimate use for either.
function hasUnsafePathChar(value: string): boolean {
  if (value.includes(':')) return true;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// A trailing slash spells a declaration as a directory; it is not part of the
// location addressed. A manifest may write `"src/"` or `"src"` and mean the same
// subtree, so every comparison below strips it first — otherwise the two
// spellings would disagree about the same ground and one of them would slip past
// the check the other is refused by.
export function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

// Whether `path` addresses `subtree` itself or a location inside it, compared by
// whole path segments. A bare `path.startsWith(subtree)` places `src-app/main.ts`
// and `srcx.ts` inside a claim on `src`, so a template declaring one directory
// would silently capture every sibling whose name merely extends it.
export function pathWithinSubtree(path: string, subtree: string): boolean {
  const root = foldForIdentity(withoutTrailingSlash(subtree));
  const target = foldForIdentity(withoutTrailingSlash(path));
  return target === root || target.startsWith(`${root}/`);
}

// A declaration that addresses no location: empty, or still carrying a trailing
// separator once the one directory-spelling slash is taken off, as `src//` and
// `/` do. Only the directory-spelling slash is meaningful; a second one is a
// spelling this module refuses to guess at, so such a value names no directory
// any content item can be inside of.
function addressesNoLocation(value: string): boolean {
  const stripped = withoutTrailingSlash(value);
  return stripped === '' || stripped.endsWith('/');
}

// Whether two paths address ground that cannot be held independently — the same
// location, or one inside the other — which is `pathWithinSubtree` asked in both
// directions, with the difference that BOTH sides here are declarations rather
// than one declaration and one concrete path.
//
// That is what makes the degenerate guard belong here and not in
// `pathWithinSubtree`: a declaration addressing no location nests with no
// DISTINCT claim, because there is no file it and another claim could both own.
// Without the guard `src//` would contest `src` — the one slash comes off,
// `src/` prefixes `src/`, and the check refuses an assembly over a claim from
// which `pathWithinSubtree` hands the assembler no file at all. The asymmetry
// that leaves `src//main.ts` inside `src` is deliberate and stays: there the
// value is a concrete content path, where a doubled separator still names a real
// file in a real directory. Refusing the degenerate declaration outright is the
// manifest contract's job, not this predicate's (issue #546).
//
// Two IDENTICAL claims are the exception the equality test carries, and it has
// to come first: `src//` against `src//` is one declaration two templates both
// wrote, which is the plainest contest there is. Letting the degenerate guard
// answer false for it would admit the assembly, and since `pathWithinSubtree`
// then scopes both contributions to no content item, seed would report success
// and write a provenance record for each template over a repository that
// received none of their files.
//
// Over two template identities this is the inventory's nesting check: identity
// is used as a path under the inventory root, so a scoped `@acme/tools` and an
// `@acme/tools/extra` occupy nested directories, and a bounded update of the
// outer one clears its directory recursively and takes the inner one's files
// with it, leaving the inner template listed in the index with nothing on disk.
// The guard cannot change that caller's verdicts — `isSafeRelativePath` rejects
// an identity with an empty segment, so no identity reaching here carries a
// slash for it to fire on.
// Over two manifests' exclusive-subtree claims it is the overlap the pre-flight
// conflict check refuses (`cpt-frontx-dod-cli-scaffolding-conflict-check`).
export function pathsNest(a: string, b: string): boolean {
  if (foldForIdentity(a) === foldForIdentity(b)) return true;
  if (addressesNoLocation(a) || addressesNoLocation(b)) return false;
  return pathWithinSubtree(a, b) || pathWithinSubtree(b, a);
}

// A concrete applied TARGET — unlike a declaration such as `excludedSubtrees`
// or `projectOwnedRoots`, which may legitimately address no location at all
// — can be `.`, the project root itself, and a project root is a real
// location that contains every other well-formed relative path
// unconditionally (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own text
// uses exactly this example: "a target `.` at the project root"). Neither
// `pathWithinSubtree` nor `pathsNest` can recognize this today, because both
// treat an argument shaped like `.` the same way they treat a degenerate
// DECLARATION — which is the correct behavior for a declaration, and the
// wrong one for a target. `pathWithinTarget`/`targetsNest` are the ONE place
// that adds the one exception a target needs, rather than changing what
// `pathWithinSubtree`/`pathsNest` mean for every other caller that already
// relies on their existing behavior for a declaration.
export function pathWithinTarget(path: string, target: string): boolean {
  if (target === '.') return true;
  return pathWithinSubtree(path, target);
}

// Whether two concrete applied TARGETS coincide or nest, in either
// direction — the target-aware counterpart to `pathsNest` above, needed for
// exactly the reason `pathWithinTarget` is: a target may legitimately be
// `.`, the project root, which nests with every other target.
export function targetsNest(a: string, b: string): boolean {
  if (a === '.' || b === '.') return true;
  return pathsNest(a, b);
}

// Re-roots a target-relative declaration (a manifest's declared
// `excludedSubtrees` entry, a payload's template-relative content path, or
// an upgrade operation's relative path — every one of them authored the
// same way, target-relative) under a concrete applied `target`, producing a
// project-relative path. `target` may legitimately be `.`, the project root
// (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own text uses exactly
// this example: "a target `.` at the project root") — a plain
// `${target}/${relativePath}` join would then wrongly spell
// `./docs/readme.md` instead of the plain `docs/readme.md` a real
// project-relative path resolves to, so `.` is the one case joined as a
// bare pass-through instead. This was independently restated by every
// caller that re-roots a declaration under a target — the one join
// operation the whole package now shares.
export function joinUnderTarget(target: string, relativePath: string): string {
  return target === '.' ? relativePath : `${target}/${relativePath}`;
}
