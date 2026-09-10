// @cpt-algo:cpt-frontx-algo-template-manifest-validate-contract:p1
// @cpt-algo:cpt-frontx-algo-template-manifest-refuse-legacy:p2
// @cpt-dod:cpt-frontx-dod-template-manifest-legacy-refused-outright:p2
import { readBundleFiles } from '../bundle/envelope';
import { isSafeRelativePath } from '../paths/relative-path';
import { refuseLegacyManifest } from './refuse-legacy';
import { MANIFEST_FILENAME } from './types';
import type { ManifestViolation, ManifestValidationResult, TemplateManifest } from './types';

// Result type for manifest parsing + validation in one step. The failure
// branch's `code`/`undeclaredFields` are additive (optional) so every
// existing caller that reads only `.ok`/`.message` keeps compiling
// unchanged; a caller that cares distinguishes a legacy-manifest refusal
// (`code: 'INVALID_MANIFEST'`, `undeclaredFields` populated) from an
// ordinary four-field contract violation (neither present).
export type ReadManifestResult =
  | { ok: true; manifest: TemplateManifest }
  | { ok: false; message: string; code?: 'INVALID_MANIFEST'; undeclaredFields?: string[] };

// The resolver seam (`FetchFn`, `packages/cli/src/resolver/types.ts`) may
// hand back either a bare manifest string (legacy single-file content) or a
// multi-file bundle envelope — the same envelope `FsContentStore` (adapters
// layer) already materializes to real on-disk files
// (`cpt-frontx-dod-template-resolution-install-by-spec`). Every caller of
// `readManifestFromContent` (composition resolution, uniform-apply,
// materialize) reads `InventoryEntry.content` — the exact string the
// resolver/inventory stored — so this single read path unwraps the bundle
// envelope down to its manifest file BEFORE validating/parsing, keeping
// every downstream caller's contract ("content is the manifest") unchanged
// whether the underlying fetch was single-file or multi-file. The envelope
// shape itself is owned by `bundle/envelope.ts`, a core module: `manifest/`
// stays free of any dependency on the IO `adapters/` layer without carrying
// its own copy of the parse.
function unwrapBundleEnvelope(content: string): string {
  const files = readBundleFiles(content);
  if (files === undefined) return content;
  const manifestText = files[MANIFEST_FILENAME];
  return typeof manifestText === 'string' ? manifestText : content;
}

// Parse and validate manifest content in one step, returning the typed manifest.
// This is the single read path — the same authoritative shape consumed at
// install, apply, and assembly time (cpt-frontx-dod-template-manifest-single-description).
//
// `refuseLegacyManifest` runs BEFORE the four-field contract check, on the
// PARSED JSON rather than the raw text: a legacy manifest carrying
// `ownershipBoundaries` would otherwise trip the four-field check too, but
// for the wrong reason (a generic "excludedSubtrees is required"-style
// violation) and with the wrong message — the read-side counterpart to
// pre-publish validation (`cpt-frontx-algo-template-manifest-refuse-legacy`)
// exists precisely so every manifest-reading command surfaces the specific
// `INVALID_MANIFEST` refusal naming every undeclared field present, never a
// translated or partially-credited shape.
export function readManifestFromContent(content: string): ReadManifestResult {
  const manifestText = unwrapBundleEnvelope(content);

  // A manifest that fails to parse at all is not this check's concern —
  // `validateManifestContract` below already produces the canonical
  // unparseable-manifest violation, and `JSON.parse` never returns
  // `undefined` for a value it successfully parses, so `undefined` is a
  // safe sentinel for "skip the legacy check, let the contract check report
  // the parse failure."
  let parsedForLegacyCheck: unknown;
  try {
    parsedForLegacyCheck = JSON.parse(manifestText);
  } catch {
    parsedForLegacyCheck = undefined;
  }

  if (parsedForLegacyCheck !== undefined) {
    const legacyCheck = refuseLegacyManifest(parsedForLegacyCheck);
    if (!legacyCheck.ok) {
      return {
        ok: false,
        message: legacyCheck.refusal.message,
        code: legacyCheck.refusal.code,
        undeclaredFields: legacyCheck.refusal.undeclaredFields,
      };
    }
  }

  const validation = validateManifestContract(manifestText);
  if (validation.status === 'REJECTED') {
    return {
      ok: false,
      message: validation.violations.map((v) => v.message).join('; '),
    };
  }
  return { ok: true, manifest: JSON.parse(manifestText) as TemplateManifest };
}

// Ownership category (3): the environment-owned names no template's ground
// may be confused with — version-control metadata and platform droppings.
//
// This is the SAME closed set the seed flow treats as carrying no content
// when it inspects a target directory (`NON_CONTENT_ENTRIES` in
// `commands/seed-repository.ts`, which imports this constant rather than
// restating it). Kept exported for that reason alone: it is a term of the
// ownership/seed domain model, not a manifest-declaration rule this
// algorithm enforces. The four-field contract's `excludedSubtrees` check
// (below) validates exactly two things the spec's own steps state —
// well-formedness and strict-descendant-of-target — and neither is a
// reserved-namespace check. `.frontx` as a whole is unconditionally
// excluded from every template's effective ownership by whole-target
// ownership itself (`cpt-frontx-adr-template-ownership-boundary-
// declaration`), and this manifest contract has no declared category
// through which a template could claim ground under `.frontx` or `.git` in
// the first place (FEATURE §1.2, "Reserved CLI-owned `.frontx/`
// namespace") — that reservation is documented there as a fact of the
// domain model, not a rule this validator re-checks, so an `excludedSubtrees`
// entry naming `.frontx` or `.git` is refused by neither well-formedness
// nor the descendant check alone; this validator simply never rejects for
// naming either.
export const RESERVED_ENVIRONMENT_ENTRIES: readonly string[] = ['.git', '.DS_Store', 'Thumbs.db'];

// A well-formed target-relative directory path: ends with a trailing "/",
// and is otherwise held to the SAME "usable as a relative path" standard
// the identity field already is - `isSafeRelativePath` (imported above),
// reused here rather than re-derived, so this check and the identity check
// can never independently drift on what "relative" means (the drift
// `src/paths/relative-path.ts`'s own header exists to prevent).
// `isSafeRelativePath` already rejects an absolute path (a leading "/"), a
// backslash, a drive-prefixed value (any ":" character), and an empty,
// "."  or ".." segment. Two things this category adds on top, because
// `isSafeRelativePath` does not itself cover them: a home-relative
// ("~"-rooted) value is no more a target-relative path than an absolute or
// drive-prefixed one is, and a glob wildcard is malformed for a reason
// specific to this category - the entry reserves a directory for a nested
// template's own target, not a hook into a file's own content or a
// discovery pattern over one. The trailing "/" is the one directory marker
// pre-publish validation can decide without inspecting a filesystem: the
// entry names ground reserved for a nested template's own target, and the
// manifest is authored before any target is known, so the path normally
// does not exist in the candidate directory and has no on-disk type to
// check - the trailing slash is a syntactic contract, not a filesystem
// fact.
// Exported so `project-state/types.ts`'s own `TemplateEntry.excludedSubtrees`
// — the RECORDED counterpart of this same declaration
// (`cpt-frontx-dod-composed-provenance-contract-ownership`) — is guarded by
// this identical well-formedness check rather than a second formulation of
// it: `project-state/io.ts`'s own entry-shape guard imports this function
// directly.
export function isWellFormedExcludedSubtree(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value.endsWith('/')) return false;
  if (/[*?]/.test(value)) return false;
  const withoutTrailingSlash = value.slice(0, -1);
  if (withoutTrailingSlash === '~' || withoutTrailingSlash.startsWith('~/')) return false;
  return isSafeRelativePath(withoutTrailingSlash);
}

// Whether a declared (and separately well-formedness-checked)
// `excludedSubtrees` entry resolves to a STRICT descendant of the
// template's own target — not empty, not the target itself, and not
// otherwise escaping it. Purely syntactic: relative to the template's own
// target, never to a filesystem, since no target is known at manifest
// authoring time. A "." segment denotes the target itself and contributes
// no ground beyond it; any other segment names real ground under the
// target.
// Exported for the identical reason `isWellFormedExcludedSubtree` above is:
// `project-state/io.ts`'s entry-shape guard reuses this exact check for a
// RECORDED `excludedSubtrees` entry rather than reformulating "what a
// declared excluded subtree looks like" a second time.
export function isStrictDescendantOfTarget(value: string): boolean {
  const resolved: string[] = [];
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // Nothing left to ascend from means the entry has walked out of the
      // target; anything above the target is not a descendant of it.
      if (resolved.length === 0) return false;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  // An entry that resolves to nothing at all denotes the target itself,
  // which is not a STRICT descendant of itself.
  return resolved.length > 0;
}

// @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-read-manifest
// The raw manifest string is passed in by the caller (command layer reads the file).
// This function is pure: no filesystem access, fully testable.
export function validateManifestContract(raw: string): ManifestValidationResult {
// @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-read-manifest
  const violations: ManifestViolation[] = [];

  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-parse-manifest
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-parse-error
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-parse-violation
    violations.push({ field: 'manifest', message: 'manifest is unparseable: invalid JSON' });
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-parse-violation
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-return-parse-rejected
    return { status: 'REJECTED', violations };
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-return-parse-rejected
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-parse-error
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-parse-manifest

  // Guard: must be a plain object after parsing
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    violations.push({ field: 'manifest', message: 'manifest must be a JSON object' });
    return { status: 'REJECTED', violations };
  }

  const obj = parsed as Record<string, unknown>;

  // ── Category 1: identity ──────────────────────────────────────────────────
  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-identity
  const name = obj['name'];
  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-identity-missing
  if (typeof name !== 'string' || name.trim() === '') {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-identity-violation
    violations.push({ field: 'name', message: 'identity field "name" is required and must be a non-empty string' });
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-identity-violation
  } else if (!isSafeRelativePath(name)) {
    // The identity addresses the template's installed content path and its
    // own `.frontx/ai/<identity>/` bundle subtree, so pre-publish
    // validation refuses a value install would refuse. Without this the
    // two gates disagree and a template can pass validation yet never be
    // installable.
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-identity-violation
    violations.push({
      field: 'name',
      message:
        'identity field "name" must be usable as a repository-relative path: no leading "/", ' +
        'no backslash, no ":" or control character, and no empty, "." or ".." segment',
    });
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-identity-violation
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-identity-missing
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-identity

  // ── Category 2: version (versioned shape) ─────────────────────────────────
  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-version
  const version = obj['version'];
  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-version-missing
  if (typeof version !== 'string' || version.trim() === '') {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-version-violation
    violations.push({ field: 'version', message: 'version field is required and must conform to the versioned shape (a non-empty string)' });
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-version-violation
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-version-missing
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-version

  // ── Category 3: excludedSubtrees ──────────────────────────────────────────
  // No other boundary category is declared: a template owns its entire
  // applied target by default, and this is the sole exclusion to it.
  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-excluded-subtrees
  const excludedSubtreesRaw = obj['excludedSubtrees'];
  const excludedSubtreesIsArray = Array.isArray(excludedSubtreesRaw);
  if (!excludedSubtreesIsArray) {
    violations.push({
      field: 'excludedSubtrees',
      message: 'excludedSubtrees is required and must be an array (possibly empty) of target-relative directory paths',
    });
  }
  const excludedSubtrees = excludedSubtreesIsArray ? (excludedSubtreesRaw as unknown[]) : [];
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-excluded-subtrees

  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-for-each-excluded-subtree
  for (let i = 0; i < excludedSubtrees.length; i++) {
    const entry = excludedSubtrees[i];

    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-excluded-subtree-malformed
    if (!isWellFormedExcludedSubtree(entry)) {
      // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-excluded-subtree-malformed-violation
      violations.push({
        field: `excludedSubtrees[${i}]`,
        message:
          'an excludedSubtrees entry must be a well-formed target-relative directory path ending in a trailing "/": ' +
          'no leading "/", no backslash, no ":" or control character, no home-relative "~" root, and no empty, ".", ' +
          '".." segment or glob wildcard — relative to the template\'s own target, not to the repository it is ' +
          'eventually applied into',
      });
      // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-excluded-subtree-malformed-violation
    }
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-excluded-subtree-malformed

    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-excluded-subtree-escapes-target
    if (typeof entry === 'string' && !isStrictDescendantOfTarget(entry)) {
      // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-excluded-subtree-escapes-violation
      violations.push({
        field: `excludedSubtrees[${i}]`,
        message: 'an excludedSubtrees entry must be a strict descendant of the template\'s own target',
      });
      // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-excluded-subtree-escapes-violation
    }
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-excluded-subtree-escapes-target
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-for-each-excluded-subtree

  // ── Category 4: description ───────────────────────────────────────────────
  // Presence-and-shape only. Whether the prose actually describes the
  // template is what selection depends on and what no structural check can
  // establish, so validation never judges it.
  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-description
  const description = obj['description'];
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-check-description

  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-description-invalid
  if (typeof description !== 'string' || description.trim() === '') {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-description-violation
    violations.push({
      field: 'description',
      message: 'description is required and must be a non-empty string: its absence is itself a violation, not a permitted omission',
    });
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-add-description-violation
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-description-invalid

  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-violations
  if (violations.length > 0) {
    // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-return-rejected
    return { status: 'REJECTED', violations };
    // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-return-rejected
  }
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-if-violations

  // @cpt-begin:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-return-validated
  return { status: 'VALIDATED', violations: [] };
  // @cpt-end:cpt-frontx-algo-template-manifest-validate-contract:p1:inst-return-validated
}
