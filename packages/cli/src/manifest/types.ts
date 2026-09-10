// @cpt-algo:cpt-frontx-algo-template-manifest-validate-contract:p1
// @cpt-state:cpt-frontx-state-template-manifest-validation-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-manifest-single-description:p1
//
// The manifest contract's concrete schema - cpt-frontx-contract-template-
// manifest. EXACTLY four declared fields: name, version, excludedSubtrees,
// description. `schemaVersion`, `ownershipBoundaries` (with its
// `exclusiveSubtrees`/`sharedFiles` children), and `referencedTemplates`
// are no longer declared: composition is now driven by the caller's
// explicit application of each template rather than by one template naming
// the others it composes with, and a template's ownership is now computed
// algorithmically as its whole target minus its declared exclusions rather
// than separately declared as exclusive subtrees or shared-file regions
// (FEATURE §1.2). A manifest declaring any of those retired fields is
// never read as this shape by any command - `cpt-frontx-algo-template-
// manifest-refuse-legacy` (./refuse-legacy.ts) refuses it outright instead
// of translating it into this one. The now-legacy interfaces
// (`OwnershipBoundary`, `SharedFileEntry`, `MergeStrategy`,
// `ReferencedTemplate`) moved to `./legacy-ownership.ts`, a temporary
// module kept only so retiring composition/assembly/upgrade code still
// compiles during the migration.

export const MANIFEST_FILENAME = 'frontx-template.json';

// The CLI-owned reserved namespace root, exported as the ONE named spelling
// of it in this package.
//
// This comment used to argue the opposite — that the literal was restated
// here rather than shared, because `isTemplatePayloadPath` below asks a
// TEMPLATE-relative question while `scaffold/conflict-check.ts` and
// `scaffold/effective-ownership.ts` ask a PROJECT-relative one, so the three
// copies were "not a second copy of their term". Those two modules carried
// the same argument in their own words, each pointing at the others. Three
// files agreeing in prose that they are allowed to disagree in code is
// exactly the shape this package's own "one formulation, never a second"
// discipline exists to prevent: the QUESTIONS differ, but the reserved NAME
// they are all asking about is one fact, and a rename would have had to be
// made identically in three places or silently split the CLI's reserved
// namespace in two. The name is shared from here; each caller keeps its own
// question.
//
// Deliberately NOT shared with `adapters/github-fetch.ts`'s
// `~/.frontx/inventory`: that is the USER-HOME inventory root, a different
// location that merely happens to spell the same dot-directory, and folding
// the two would tie a project's reserved namespace to a machine-wide store.
export const FRONTX_NAMESPACE_ROOT = '.frontx';

// Whether `templateRelativePath` - a path relative to the template
// directory itself (as it appears inside the template's own installed
// content), NEVER project- or target-relative - is part of a template's
// *payload*. FEATURE §1.2 ("Payload - owned here") owns this definition:
// the payload is "the whole template directory minus its own manifest
// (`frontx-template.json`) minus the conventional
// `.frontx/ai/<manifest-name>/` bundle folder", and is precisely "the
// concrete file set `install` acquires and `apply` materializes into a
// target". This is the ONE formulation of that question - every caller
// that needs to know whether a template-relative path belongs to the
// payload (`upgrade/payload.ts`'s classification, `commands/apply.ts`'s
// materialization, `scaffold/existing-content.ts`'s reconciliation) routes
// through this function rather than restating the two-term subtraction a
// second time. Restating it a second time is exactly the defect this
// function closes: `apply` and `existing-content` used to filter only by
// effective ownership, which subtracts `.frontx` but not the manifest
// itself, so a target ended up carrying its own template's
// `frontx-template.json`.
//
// Operates on the TEMPLATE-relative path, deliberately, not a project- or
// target-relative one: a target named `sub` would re-root the manifest as
// `sub/frontx-template.json`, and a caller comparing a project-relative
// path against the bare `MANIFEST_FILENAME` would silently fail to exclude
// it for any target other than `.`. Every call site must therefore apply
// this predicate to `item.path` (or the equivalent template-relative
// field) BEFORE joining it under a target.
//
// The `.frontx` term uses a whole-segment comparison, never a bare
// `startsWith`: a sibling folder named `.frontx-extras/` must not be
// mistaken for the reserved namespace root.
export function isTemplatePayloadPath(templateRelativePath: string): boolean {
  if (templateRelativePath === MANIFEST_FILENAME) return false;
  const segments = templateRelativePath.split('/');
  return segments[0] !== FRONTX_NAMESPACE_ROOT;
}

// Single authoritative contract - cpt-frontx-contract-template-manifest.
// EXACTLY four declared fields. The manifest declares NO content and
// carries NO file bodies - every consumer reads content items from the
// resolved on-disk installed content path, never from this shape. The same
// shape is checked at pre-publish validation and consumed at install,
// register, apply, and assembly time - no per-command divergence
// (cpt-frontx-dod-template-manifest-single-description).
export interface TemplateManifest {
  name: string; // (1) identity
  version: string; // (2) version - versioned shape

  // (3) the strict descendants of the template's own target where the
  // author intends another template to nest - the one input to a
  // template's effective ownership boundary that whole-target ownership
  // cannot derive on its own (cpt-frontx-adr-template-ownership-boundary-
  // declaration). Possibly empty. Each entry names a directory reserved
  // for a nested template's own target - never a single file or a glob
  // pattern - and must be a well-formed target-relative directory path
  // ending in a trailing "/", with no ".." segment, that resolves to a
  // strict descendant of the template's own target.
  excludedSubtrees: string[];

  // (4) required, non-empty prose: the sole carrier of both selection
  // semantics (what the template establishes, for a caller holding no
  // reference to choose it by) and post-instantiation usage semantics
  // (how it should be used once applied, and what it contributes). Its
  // absence is itself a violation, not a permitted omission - a field
  // declared empty states nothing.
  description: string;
}

export interface ManifestViolation {
  field: string;
  message: string;
}

export type ManifestValidationResult =
  | { status: 'VALIDATED'; violations: [] }
  | { status: 'REJECTED'; violations: ManifestViolation[] };

// State machine states - cpt-frontx-state-template-manifest-validation-lifecycle
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-validated
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-rejected
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-rejected-to-draft
// @cpt-begin:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-validated-to-published
export type ManifestValidationState = 'DRAFT' | 'VALIDATED' | 'REJECTED' | 'PUBLISHED';
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-validated-to-published
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-rejected-to-draft
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-rejected
// @cpt-end:cpt-frontx-state-template-manifest-validation-lifecycle:p1:inst-draft-to-validated

// ReadFileFn — injected for testability (no fs calls in core logic)
export type ReadFileFn = (path: string) => Promise<string>;

// ListPayloadFilesFn - enumerates every regular file reachable under
// `templateDir` itself, POSIX-relative to `templateDir` with NO leading
// slash (never descending into `node_modules`; a dot-prefixed file or
// directory is ordinary content and IS included; a mid-walk symlink is
// resolved via `stat`, not skipped by type, and one resolving outside
// `templateDir` is skipped rather than thrown). The content self-
// containment algorithm (cpt-frontx-algo-template-manifest-validate-
// content-self-containment) calls this exactly ONCE, for the whole
// candidate template directory, to obtain every file it then filters down
// to the template's own payload (manifest file, AI-extension bundle
// folder, and declared `excludedSubtrees` entries removed). This replaced
// the five-category contract's version of this seam, which took a second
// `contentOwnedPath` argument and was called once PER declared content-
// owning path in a loop; there is exactly one authoritative enumeration
// call now, over the whole directory. Throws, naming the path, when the OS
// refuses a `readdir`/`stat` or when `templateDir` itself cannot be
// resolved — a check that could not look must never report the outcome of
// having looked. Injected so the algorithm never touches a real filesystem
// itself.
export type ListPayloadFilesFn = (templateDir: string) => Promise<string[]>;

// ResolveDeclaredExclusionFn - confirms a single declared `excludedSubtrees`
// entry resolves honestly, without enumerating its content (that ground is
// excluded from the payload precisely because it is reserved for a nested
// template, not this one). Returns `'ABSENT'` when nothing exists at the
// path — the ORDINARY case, since the manifest is authored before any
// target is known and the entry normally does not exist in the candidate
// directory yet — and `'RESOLVED'` when it exists and resolves inside
// `templateDir`. THROWS, naming the path, when it exists but is a broken
// symlink, cannot be resolved, or resolves outside `templateDir`, and when
// the OS refuses to inspect it: a declared boundary that does not hold is
// refused rather than treated as empty content. The content self-
// containment algorithm calls this once per declared `excludedSubtrees`
// entry, letting the throw propagate to the command boundary that owns the
// exit code, exactly as the old per-subtree seam's refusal did. Injected so
// the algorithm never touches a real filesystem itself.
export type ResolveDeclaredExclusionFn = (templateDir: string, excludedSubtree: string) => Promise<'ABSENT' | 'RESOLVED'>;
