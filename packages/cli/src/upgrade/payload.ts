// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
//
// Resolves ONE origin to its payload — the `ResolvePayloadFn` seam
// (`./types.ts`) both the baseline's re-resolution and the candidate's
// resolution go through. There is exactly one implementation because
// `cpt-frontx-adr-project-upgrade-mechanism` requires both sides of a
// classification to be obtained "by resolving an origin through the one
// shared resolver every other command already uses"; two formulations here
// would be two different ideas of what a payload is, compared against each
// other.
//
// WHY NOTHING IS STAGED ON DISK. The ADR requires that every resolution
// serving an upgrade "reads its content without ever adopting a new identity
// into the project or disturbing the registered slot, holding that content
// outside the slot until the transition's own commit promotes it", and
// illustrates that with a staging location inside the inventory store —
// accepting, as a stated consequence, that "a staging location orphaned by a
// killed process is never reclaimed automatically ... it sits as inert
// residue inside the inventory store until a developer notices and removes
// it by hand".
//
// This implementation holds both payloads ENTIRELY IN MEMORY instead, which
// satisfies the requirement strictly and makes that consequence vacuous —
// there is no location to orphan. It is possible because the shared resolver
// already hands the fetched content back as one in-memory string
// (`resolver/types.ts`'s `InventoryReadyRecord.content`), bundle-shaped when
// the payload is multi-file (`bundle/envelope.ts`'s `$frontxTemplateFiles`
// envelope), and because `resolveToInventory` is a pure resolution that
// writes nothing: adopting content into a slot is `TemplateInventory.install`'s
// separate job, which this module never calls. A local `path:` origin's
// payload is read from its own folder, which is the developer's own source
// tree rather than a staging location either. The deviation is from the ADR's
// ILLUSTRATED MECHANISM, never from its requirement, and it is strictly safer
// on the one axis the ADR itself flagged as bad.
//
// KNOWN LIMITATION, inherited rather than introduced: a remote origin's
// payload reaches this module only if the fetch adapter returns a
// bundle-shaped string. `adapters/fs-content-store.ts` already reads and
// writes that envelope, but nothing in this repository currently PRODUCES a
// multi-file bundle from a real network fetch, and both real templates are
// local `path:` origins. A remote origin whose fetch returns a bare manifest
// therefore resolves to an EMPTY payload here — honestly empty, not an
// error — which classification will read as "this version declares no
// files". That is the truthful reading of what the resolver actually
// returned; it is not this module's place to invent payload content the
// fetch never delivered.
import { readBundleFiles } from '../bundle/envelope';
import { parseSourceSpec } from '../spec-parser/parse';
import { resolveToInventory } from '../resolver/resolve';
import { readManifestFromContent } from '../manifest/validate-contract';
import { MANIFEST_FILENAME, isTemplatePayloadPath } from '../manifest/types';
import type { ReadFileFn } from '../manifest/types';
import { parseLocalOrigin } from '../resolver/types';
import type { FetchFn, InventoryReadyRecord, PathExistsFn } from '../resolver/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ListDiskFilesFn, ResolvedPayload, ResolvePayloadFn, ResolvePayloadResult } from './types';

// A template's own `.frontx/ai/<manifest-name>/` folder is NOT payload it
// applies onto a target — it is content the CLI materialises separately,
// through `cpt-frontx-algo-cli-scaffolding-ai-bundle` (which an upgrade's
// commit invokes as its own step, `inst-com-refresh-bundle`). Excluded from
// the payload here (via `isTemplatePayloadPath`, `../manifest/types.ts` —
// the ONE shared formulation of the payload definition
// `cpt-frontx-feature-template-manifest` §1.2 fixes, also used by
// `commands/apply.ts` and `scaffold/existing-content.ts`) so classification
// never sees it as an ordinary file. The candidate boundary would exclude
// it anyway (`.frontx` is one of the six subtraction terms), so this is
// belt-and-braces rather than the only guard — but it keeps the payload
// honest about what it is, independent of whichever boundary a caller
// happens to compute.

export interface ResolvePayloadDeps {
  repoRoot: string;
  fetchFn: FetchFn;
  // Reads a local `path:` origin's files, one at a time — the resolver's own
  // `ReadFolderFileFn` seam (`resolver/types.ts`), reused here under this
  // module's pre-existing name. The same function now reads BOTH the
  // manifest and every other payload file, since the shared resolver reads a
  // local origin's whole folder uniformly rather than through two
  // independently-maintained read paths.
  readFileFn: ReadFileFn;
  // Enumerates a local `path:` origin folder's own regular files — the
  // resolver's own `ListFolderFilesFn` seam, reused under this module's
  // pre-existing name (it already matched that shape exactly).
  listDiskFiles: ListDiskFilesFn;
  // Confirms a local `path:` origin's folder actually exists — the
  // resolver's own existence check, which containment alone cannot answer.
  existsFn: PathExistsFn;
  // Proves a local origin's relative path stays inside the project root —
  // the SAME seam register and apply already hold a `path:` origin to.
  canonicalizeFn: CanonicalizeTargetFn;
}

/**
 * Builds the one `ResolvePayloadFn` the upgrade engine uses for both the
 * baseline and the candidate.
 */
export function createResolvePayloadFn(deps: ResolvePayloadDeps): ResolvePayloadFn {
  return async function resolvePayload(origin: string): Promise<ResolvePayloadResult> {
    return parseLocalOrigin(origin) !== undefined
      ? resolveLocalPayload(origin, deps)
      : resolveRemotePayload(origin, deps);
  };
}

// Reads a manifest's four declared fields, or fails with the refusal the
// contract check produced. Shared by both branches so a legacy-shaped
// manifest is refused identically whichever origin kind carried it —
// `refuseLegacyManifest` is already wired into `readManifestFromContent`, so
// an undeclared-field manifest cannot reach classification from either side.
//
// EVERY unreadable manifest folds into `ORIGIN_UNAVAILABLE`, whatever made it
// unreadable — a legacy shape predating the four-field contract just as much
// as an ordinary contract violation (a missing `name`, an empty
// `description`, a malformed `excludedSubtrees`).
//
// This is a deliberate asymmetry with `commands/register.ts`, which reports
// the same class of defect as `INVALID_MANIFEST`, and it is correct because
// their FEATUREs give them different vocabularies:
// `cpt-frontx-feature-upgrade-changeset`'s flows and DoDs never list
// `INVALID_MANIFEST` among upgrade's refusals at all, while
// composed-provenance's `register` does. `scaffold/assembler.ts` made exactly
// this fold first, and stated the reasoning in its own
// `inst-ua-read-manifest` comment: "the origin's content, once resolved,
// turned out not to be usable, which is the same practical outcome as the
// origin never having resolved at all."
//
// An earlier version of this function kept `INVALID_MANIFEST` reachable for
// the legacy shape alone. That was incoherent on its own terms: it emitted a
// code upgrade's FEATURE never names, by the very vocabulary argument used to
// justify folding the other class, and it diverged from the assembler it cited
// as precedent — which folds legacy in too. One rule for one question.
// The success half is nested under `declared` rather than spread alongside
// `ok`, so this union cannot collide with `ResolvePayloadResult`'s own
// `{ok: true; payload}` arm — both would otherwise carry `ok: true` and
// TypeScript could narrow neither.
type DeclaredResult =
  | { ok: true; declared: { name: string; version: string; excludedSubtrees: string[] } }
  | { ok: false; failure: ResolvePayloadResult };

function readDeclared(manifestContent: string, origin: string): DeclaredResult {
  const result = readManifestFromContent(manifestContent);
  if (!result.ok) {
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'ORIGIN_UNAVAILABLE',
        message: `Origin "${origin}" resolved, but its manifest could not be read: ${result.message}`,
      },
    };
  }
  return {
    ok: true,
    declared: {
      name: result.manifest.name,
      version: result.manifest.version,
      excludedSubtrees: result.manifest.excludedSubtrees,
    },
  };
}

// Both origin kinds converge here once the shared resolver has acquired
// their content: extract the manifest text from the acquired bundle, read
// its declared fields, and build the payload's `files` map from every OTHER
// bundle entry. Unifying this half of `resolveLocalPayload`/
// `resolveRemotePayload` (previously two independently-maintained copies of
// the identical bundle-unwrap-and-filter logic) is a direct consequence of
// routing a local origin through the same resolver a remote one already
// used: both now hand back the identical `InventoryReadyRecord` shape.
function buildPayloadFromResolved(record: InventoryReadyRecord, origin: string): ResolvePayloadResult {
  // The resolver hands back ONE string. It is either the bundle envelope
  // (multi-file payload) or a bare manifest — `readBundleFiles` returns
  // `undefined` for the latter rather than an empty map, precisely so a
  // caller can tell "not a bundle" from "a bundle with no files"
  // (`bundle/envelope.ts`'s own doc comment). A local origin's acquired
  // content is always bundle-shaped (the resolver's own local branch builds
  // one even for a single-file folder); only a remote origin can still hand
  // back a bare manifest, per this module's own header.
  const bundleFiles = readBundleFiles(record.content);
  const manifestContent = bundleFiles
    ? typeof bundleFiles[MANIFEST_FILENAME] === 'string'
      ? (bundleFiles[MANIFEST_FILENAME] as string)
      : record.content
    : record.content;

  const declared = readDeclared(manifestContent, origin);
  if (!declared.ok) return declared.failure;

  const files = new Map<string, string>();
  if (bundleFiles) {
    for (const [relativePath, value] of Object.entries(bundleFiles)) {
      if (typeof value !== 'string') continue;
      if (!isTemplatePayloadPath(relativePath)) continue;
      files.set(relativePath, value);
    }
  }
  // A bare-manifest resolution yields an empty payload — see this module's
  // header on why that is the honest reading rather than an error.

  return {
    ok: true,
    payload: {
      name: declared.declared.name,
      version: declared.declared.version,
      // The resolved address: the pinned form for a remote origin, or the
      // local origin recorded exactly as given — either way this is
      // `record.source`, never the raw caller-typed string re-derived here,
      // so a local origin's "recorded exactly as given" guarantee comes from
      // the SAME resolver field a remote origin's pin already does.
      origin: record.source,
      files,
      excludedSubtrees: declared.declared.excludedSubtrees,
    },
  };
}

async function resolveLocalPayload(origin: string, deps: ResolvePayloadDeps): Promise<ResolvePayloadResult> {
  // Every local-origin acquisition failure folds to `ORIGIN_UNAVAILABLE`,
  // whatever the resolver's own code — this module's own header explains
  // why: upgrade's FEATURE never lists `INVALID_MANIFEST` (or `INVALID_PATH`)
  // among its own refusals, so the resolver's finer vocabulary is
  // deliberately NOT propagated here, unlike `commands/register.ts`, which
  // does propagate it. This is the identical fold `readDeclared` below
  // already applies to a post-resolution manifest defect; extending it to
  // the resolver's OWN containment/existence/identity refusal keeps one rule
  // for the whole question rather than two.
  const resolved = await resolveToInventory(
    { kind: 'local', origin },
    {
      fetchFn: deps.fetchFn,
      local: {
        repoRoot: deps.repoRoot,
        canonicalizeFn: deps.canonicalizeFn,
        existsFn: deps.existsFn,
        listFolderFilesFn: deps.listDiskFiles,
        readFolderFileFn: deps.readFileFn,
      },
    },
  );
  if (!resolved.ok) {
    return {
      ok: false,
      code: 'ORIGIN_UNAVAILABLE',
      message: `Local origin "${origin}" could not be resolved: ${resolved.error.message}`,
    };
  }
  return buildPayloadFromResolved(resolved.value, origin);
}

async function resolveRemotePayload(origin: string, deps: ResolvePayloadDeps): Promise<ResolvePayloadResult> {
  const parsed = parseSourceSpec(origin);
  if (!parsed.ok) {
    return { ok: false, code: 'ORIGIN_UNAVAILABLE', message: `Origin "${origin}" is not a valid source spec: ${parsed.error.message}` };
  }
  // `resolveToInventory` RESOLVES without adopting: it returns the fetched
  // record and writes nothing to the inventory store. Adoption is
  // `TemplateInventory.install`'s separate job, which this module never
  // calls — which is exactly what "without disturbing the registered slot"
  // requires.
  const resolved = await resolveToInventory({ kind: 'remote', ref: parsed.value }, { fetchFn: deps.fetchFn });
  if (!resolved.ok) {
    // Folded to `ORIGIN_UNAVAILABLE` exactly as `resolveLocalPayload` above
    // folds its own resolver failure, and for the identical reason (see that
    // comment and this module's header): upgrade's FEATURE never lists
    // `INVALID_MANIFEST` among its refusals.
    //
    // This branch used to propagate the resolver's `INVALID_MANIFEST` while
    // the local branch folded it — the two halves of ONE function disagreeing
    // about which of the shared codes an unreadable manifest earns, which is
    // the same incoherence an adversarial review already flagged once in
    // `readDeclared` below. Two things widened it since: the resolver now
    // sets `code: 'INVALID_MANIFEST'` on its generic identity-missing branch
    // (previously it set no code at all, so this ternary almost never fired),
    // and a local origin now reaches the resolver too. One rule for one
    // question.
    return {
      ok: false,
      code: 'ORIGIN_UNAVAILABLE',
      message: `Origin "${origin}" could not be resolved: ${resolved.error.message}`,
    };
  }
  return buildPayloadFromResolved(resolved.value, origin);
}

/**
 * A payload's declared version, compared against a version the project state
 * document recorded beside the origin that produced it. The ONE place this
 * comparison is spelled, used by both `inst-val-check-baseline` (the
 * baseline's own honesty check) and `inst-val-if-candidate-version-mismatch`
 * (a restore's candidate, which carries a recorded expectation of its own) —
 * two callers, one rule, so the two can never drift into disagreeing about
 * what "the recorded version still matches" means.
 */
export function versionMatchesRecorded(resolved: ResolvedPayload, recordedVersion: string): boolean {
  return resolved.version === recordedVersion;
}
