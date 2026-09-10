// @cpt-FEATURE:cpt-frontx-feature-composed-provenance:p1
// @cpt-flow:cpt-frontx-flow-composed-provenance-validate-project:p1
// @cpt-algo:cpt-frontx-algo-composed-provenance-validate-project:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-validate-project:p1
//
// `validate --project` — checks `.frontx/project.json` against reality
// (the registry, the local inventory, and the filesystem) rather than only
// against its own structural shape (FEATURE §2 "Validate the Project State
// Document" / §3 "Validate the Project State Document Against Reality").
// Reuses, rather than redeclares:
//   - `readProjectState` (`../project-state/io.ts`) for the top-level/entry
//     structural read `inst-psio-if-malformed` already enforces
//     (`{formatVersion, templates, projectOwnedRoots}`, an entry's
//     `origin`/`version` being strings and `targets` an array of strings).
//     This file adds only what that read does NOT check
//     (`inst-valpa-if-malformed`'s own extra clauses): a duplicate target
//     within one name's `targets[]`, a duplicate across two different
//     names, and an entry not normalized to a canonical project-relative
//     path.
//   - `resolveToInventory` (`../resolver/resolve.ts`) for origin resolution
//     — the ONE place a `path:` local origin's folder is proven to still
//     exist and a remote origin is proven to still resolve, so this file
//     never re-derives existence a second, independent way. `inventory.
//     lookup` alone would NOT notice a deleted local `path:` folder — this
//     is why the FEATURE spec requires an actual resolution attempt here,
//     not a lookup against whatever the local inventory cached.
//   - `readManifestFromContent` (`../manifest/validate-contract.ts`) on the
//     resolved `content` for BOTH the version comparison and this name's
//     current `excludedSubtrees` — ONE resolution serves both checks, never
//     a second resolve-again-for-exclusions pass through
//     `resolveRegisteredExcludedSubtrees` (`../scaffold/registered-
//     manifest.ts`): this algorithm already pays to resolve every name for
//     its version, so the declared exclusions are read off that SAME
//     resolved manifest rather than a second, independently-triggered
//     resolution of the identical content.
//   - `checkTargetConflicts` (`../scaffold/conflict-check.ts`) for the
//     geometry check, resubmitting the FULL recorded set against itself
//     (`inst-valpa-conflict-check`'s own text: "checking the recorded set
//     for internal consistency rather than against a new staged batch").
//
// This algorithm returns on the FIRST finding (`inst-valpa-if-malformed` /
// `-if-origin-unavailable` / `-if-version-mismatch` / `-if-target-conflict` /
// `-if-root-missing`), unlike `validate`'s pre-publish sibling
// (`cpt-frontx-algo-template-manifest-validate-contract`), which
// accumulates every violation before reporting: this algorithm's own Output
// line names exactly ONE outcome, never a list.
import path from 'node:path';
import { readProjectState, projectStatePath } from '../project-state/io';
import type { ProjectStateDocument, ReadProjectStateFn } from '../project-state/types';
import { resolveToInventory } from '../resolver/resolve';
import { parseLocalOrigin } from '../resolver/types';
import type { FetchFn, ListFolderFilesFn, PathExistsFn, ResolveOrigin, ResolveResult } from '../resolver/types';
import { joinUnderTarget } from '../paths/relative-path';
import { readManifestFromContent } from '../manifest/validate-contract';
import type { ReadFileFn } from '../manifest/types';
import { parseSourceSpec } from '../spec-parser/parse';
import { checkTargetConflicts } from '../scaffold/conflict-check';
import type { CanonicalizeTargetFn, TargetClaim } from '../scaffold/conflict-check';

export interface ValidateProjectDeps {
  readProjectStateFn: ReadProjectStateFn;
  canonicalizeFn: CanonicalizeTargetFn;
  existsFn: PathExistsFn;
  listFolderFilesFn: ListFolderFilesFn;
  readFileFn: ReadFileFn;
  fetchFn: FetchFn;
}

// This algorithm's own closed error vocabulary — a SUBSET of the shared
// sixteen-code `ErrorCode` (`../envelope.ts`), narrowed to exactly the five
// codes FEATURE §3's Output line names. Kept as its own exported union
// (rather than the full `ErrorCode`) so the dispatcher's own outcome
// renderer (`cli.ts`'s `renderValidateProjectOutcome`) gets a compile-time
// exhaustive switch — a sixth code added to this algorithm later without a
// matching dispatch branch fails to compile instead of silently falling
// through to PASS.
export type ValidateProjectErrorCode =
  | 'PROJECT_INVALID'
  | 'VERSION_MISMATCH'
  | 'ORIGIN_UNAVAILABLE'
  | 'TARGET_CONFLICT'
  | 'INVALID_PATH';

export type ValidateProjectOutcome =
  | { ok: true }
  | { ok: false; code: ValidateProjectErrorCode; message: string; details?: Record<string, unknown> };

// Builds the shared resolver's own `ResolveOrigin` discriminant from a
// recorded `templates[name].origin` string. `null` when the string is
// neither `path:`-prefixed nor a parseable source-spec — a case reported
// exactly like any other unresolvable origin (`ORIGIN_UNAVAILABLE`, naming
// the name and the origin): the structural check (`findStructuralIssue`
// below, realizing `inst-valpa-if-malformed`) only confirms `origin` IS a
// string, never that it is a WELL-FORMED one, and a malformed source-spec is
// exactly as unresolvable as one whose registry is unreachable.
function buildResolveOrigin(origin: string): ResolveOrigin | null {
  if (parseLocalOrigin(origin) !== undefined) {
    return { kind: 'local', origin };
  }
  const parsed = parseSourceSpec(origin);
  return parsed.ok ? { kind: 'remote', ref: parsed.value } : null;
}

interface StructuralIssue {
  message: string;
  details: Record<string, unknown>;
}

/**
 * The extra structural checks `readProjectState` does NOT already enforce
 * — `inst-valpa-if-malformed`'s own additional clauses beyond the shared
 * `{formatVersion, templates, projectOwnedRoots}`/entry-shape guard: a
 * `targets[]` duplicate within one name, a duplicate across two different
 * names, and an entry not normalized to a canonical project-relative path.
 *
 * A target is non-canonical when canonicalizing it yields something
 * DIFFERENT from the recorded string (a canonicalization failure — `null`
 * — is, definitionally, different from any recorded string) — the ONE seam
 * (`CanonicalizeTargetFn`) this whole package already uses to decide
 * canonicality, never a hand-rolled string check.
 */
function findStructuralIssue(document: ProjectStateDocument, canonicalizeFn: CanonicalizeTargetFn): StructuralIssue | null {
  for (const [name, entry] of Object.entries(document.templates)) {
    const seenInThisName = new Set<string>();
    for (const target of entry.targets) {
      if (seenInThisName.has(target)) {
        return {
          message: `Template "${name}"'s targets[] carries a duplicate entry: "${target}".`,
          details: { name, target },
        };
      }
      seenInThisName.add(target);

      if (canonicalizeFn(target) !== target) {
        return {
          message: `Template "${name}"'s target "${target}" is not normalized to a canonical project-relative path.`,
          details: { name, target },
        };
      }

    }
  }
  // The SAME target recorded under two DIFFERENT names is deliberately NOT a
  // structural finding here. `inst-valpa-if-malformed` scopes this step to
  // "any `targets[]` array carries a duplicate entry" — a duplicate WITHIN one
  // array — while the flow's own error scenario routes cross-name coincidence
  // elsewhere and explicitly names the mechanism: "Two recorded targets —
  // under the same or different registered names — coincide or nest without a
  // declared `excludedSubtrees` exemption, detected by resubmitting the full
  // recorded set through the Conflict Checker's geometry
  // (`cpt-frontx-algo-cli-scaffolding-conflict-check`): `TARGET_CONFLICT`,
  // naming the contesting names and the contested ground."
  //
  // Reporting it as `PROJECT_INVALID` here would both use the wrong code and
  // pre-empt the geometry check that is supposed to find it — and it would
  // lose what that check reports, since `TARGET_CONFLICT` names the contested
  // GROUND and the contesting names, which a structural message about a
  // duplicated key does not. `inst-valpa-conflict-check` catches it below:
  // `checkTargetConflicts`' `inst-cc-record-same-target` treats an identical
  // target under the same name as an idempotent no-op but under a DIFFERENT
  // name as a conflict, which is exactly this case.
  return null;
}

/**
 * cpt-frontx-algo-composed-provenance-validate-project — checks the project
 * state document against reality: every registered name's currently
 * resolvable manifest version matches its recorded version, every
 * registered origin still resolves, the full recorded `targets[]` set
 * carries no ownership-geometry conflict, and every `projectOwnedRoots`
 * entry still exists on disk. Returns on the FIRST finding.
 */
export async function validateProject(repoRoot: string, deps: ValidateProjectDeps): Promise<ValidateProjectOutcome> {
  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-read
  const stateResult = await readProjectState(repoRoot, deps.readProjectStateFn);
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-read

  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-malformed
  if (!stateResult.ok) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-invalid
    return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
    // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-invalid
  }
  const document = stateResult.document;

  const structuralIssue = findStructuralIssue(document, deps.canonicalizeFn);
  if (structuralIssue !== null) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-invalid
    return { ok: false, code: 'PROJECT_INVALID', message: structuralIssue.message, details: structuralIssue.details };
    // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-invalid
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-malformed

  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-absent
  // `readProjectState` (`project-state/io.ts`'s own `inst-psio-if-absent` /
  // `inst-psio-absent-default`) returns the SAME initial empty document for
  // a genuinely ABSENT file as for one that exists and is merely empty —
  // this algorithm's own step 3 must tell the two apart honestly rather
  // than claim a branch that never ran, so this probe reads the raw seam
  // directly, once, at the SAME location `projectStatePath` computes: a
  // second, deliberately narrow, read-only use of the injected
  // `ReadProjectStateFn` — never a second PARSE of its content, since `null`
  // is absence, full stop, with nothing left to parse.
  const rawProbe = await deps.readProjectStateFn(projectStatePath(repoRoot));
  if (rawProbe === null) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-pass-absent
    return { ok: true };
    // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-pass-absent
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-absent

  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-foreach-name
  const excludedSubtreesByName = new Map<string, string[]>();
  for (const [name, entry] of Object.entries(document.templates)) {
    const resolveOrigin = buildResolveOrigin(entry.origin);

    let resolved: ResolveResult;
    if (resolveOrigin === null) {
      resolved = { ok: false, error: { message: `Origin "${entry.origin}" is not a well-formed source-spec or local path.` } };
    } else {
      resolved = await resolveToInventory(resolveOrigin, {
        fetchFn: deps.fetchFn,
        local: {
          repoRoot,
          canonicalizeFn: deps.canonicalizeFn,
          existsFn: deps.existsFn,
          listFolderFilesFn: deps.listFolderFilesFn,
          readFolderFileFn: deps.readFileFn,
        },
      });
    }

    // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-origin-unavailable
    if (!resolved.ok) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-origin-unavailable
      return {
        ok: false,
        code: 'ORIGIN_UNAVAILABLE',
        message: `Template "${name}"'s origin "${entry.origin}" could not be resolved: ${resolved.error.message}`,
        details: { name, origin: entry.origin },
      };
      // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-origin-unavailable
    }

    // The resolver already validated this manifest as part of resolving
    // successfully (`resolver/resolve.ts`'s own `resolveManifestIdentity`
    // tail, run for BOTH origin kinds before `resolved.ok` can be true), so
    // `readManifestFromContent` re-reading the SAME content here cannot
    // genuinely fail — folded into this SAME `ORIGIN_UNAVAILABLE` branch
    // (this name's resolution effectively did not yield a usable manifest)
    // rather than an unchecked `.manifest` access, mirroring the defensive
    // discipline `commands/apply.ts`'s own `resolveAndCheckBatch` already
    // applies to an equally-unreachable re-check of its own conflict
    // verdict.
    const manifestResult = readManifestFromContent(resolved.value.content);
    if (!manifestResult.ok) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-origin-unavailable
      return {
        ok: false,
        code: 'ORIGIN_UNAVAILABLE',
        message: `Template "${name}"'s resolved manifest could not be read: ${manifestResult.message}`,
        details: { name, origin: entry.origin },
      };
      // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-origin-unavailable
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-origin-unavailable

    // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-version-mismatch
    if (manifestResult.manifest.version !== entry.version) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-version-mismatch
      return {
        ok: false,
        code: 'VERSION_MISMATCH',
        message:
          `Template "${name}"'s recorded version "${entry.version}" does not match its currently resolvable ` +
          `manifest's version "${manifestResult.manifest.version}".`,
        details: { name, recordedVersion: entry.version, manifestVersion: manifestResult.manifest.version },
      };
      // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-version-mismatch
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-version-mismatch

    // Stashed for the conflict check below — the SAME resolved manifest this
    // loop iteration already paid to resolve, never a second resolution
    // through `resolveRegisteredExcludedSubtrees` (this file's own header
    // note explains the choice).
    excludedSubtreesByName.set(name, manifestResult.manifest.excludedSubtrees);
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-foreach-name

  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-conflict-check
  // The FULL recorded set, tagged with its owning name and that name's
  // declared `excludedSubtrees`, submitted ENTIRELY as `targetsUnderCheck`
  // with `recordedTargets: []` — so `checkTargetConflicts` checks the
  // recorded set against ITSELF (every claim marked "staged", per that
  // function's own `inst-cc-combine`) rather than against a second,
  // already-recorded batch: there IS no second batch here, only the one
  // document. That function's own pairwise loop only ever compares DISTINCT
  // indices (`i < j`), so this submission cannot manufacture a spurious
  // self-conflict for one target against its own entry — pinned by this
  // file's own test suite (`validate-project.test.ts`'s "does NOT
  // self-report" case) rather than merely asserted here.
  const recordedTargets: TargetClaim[] = [];
  for (const [name, entry] of Object.entries(document.templates)) {
    if (entry.targets.length === 0) continue;
    const declaredExclusions = excludedSubtreesByName.get(name) ?? [];
    for (const target of entry.targets) {
      const excludedSubtrees = declaredExclusions.map((declared) => joinUnderTarget(target, declared));
      recordedTargets.push({ target, templateName: name, excludedSubtrees });
    }
  }

  const verdict = checkTargetConflicts({
    targetsUnderCheck: recordedTargets,
    recordedTargets: [],
    projectOwnedRoots: document.projectOwnedRoots,
    canonicalizeFn: deps.canonicalizeFn,
  });

  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-target-conflict
  if (!verdict.ok) {
    if (verdict.kind === 'INVALID_PATH') {
      // Defensive: every recorded target already passed the canonical-form
      // structural check above (`findStructuralIssue`), so the checker's
      // own internal re-canonicalization of an already-canonical string
      // cannot genuinely disagree — kept only so this branch is exhaustive
      // over `ConflictCheckResult`'s discriminant rather than assumed away
      // (mirrors `commands/apply.ts`'s/`commands/ownership.ts`'s identical
      // defensive branch).
      return {
        ok: false,
        code: 'INVALID_PATH',
        message: `Recorded target "${verdict.path}" could not be proven to stay inside the project root.`,
        details: { target: verdict.path },
      };
    }
    // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-target-conflict
    const contestingNames = [
      ...new Set(
        verdict.conflicts.flatMap((conflict) =>
          conflict.contestants.map((contestant) => contestant.templateName).filter((n): n is string => n !== null),
        ),
      ),
    ];
    return {
      ok: false,
      code: 'TARGET_CONFLICT',
      message: `The recorded targets carry an intersecting claim contested by: ${contestingNames.join(', ') || 'unknown'}.`,
      details: { conflicts: verdict.conflicts },
    };
    // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-target-conflict
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-target-conflict
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-conflict-check

  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-foreach-root
  for (const root of document.projectOwnedRoots) {
    const exists = await deps.existsFn(path.join(repoRoot, root));
    // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-root-missing
    if (!exists) {
      // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-root-missing
      return {
        ok: false,
        code: 'INVALID_PATH',
        message: `projectOwnedRoots entry "${root}" no longer exists on disk.`,
        details: { path: root },
      };
      // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-root-missing
    }
    // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-if-root-missing
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-foreach-root

  // @cpt-begin:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-pass
  return { ok: true };
  // @cpt-end:cpt-frontx-algo-composed-provenance-validate-project:p1:inst-valpa-return-pass
}
