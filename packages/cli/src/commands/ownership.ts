// @cpt-FEATURE:cpt-frontx-feature-composed-provenance:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-ownership-management:p1
//
// `ownership add|remove|list` — cpt-frontx-algo-composed-provenance-
// ownership-add, cpt-frontx-algo-composed-provenance-ownership-remove, and
// the read-only `list` flow (cpt-frontx-flow-composed-provenance-ownership-
// list, which cites the shared project-state-io algorithm directly rather
// than a distinct algorithm of its own). Reads and writes the single
// project state document this feature owns (`../project-state/io.ts`)
// through the injected `ReadProjectStateFn`/`WriteProjectStateFn` seams; no
// direct filesystem access here beyond what the injected
// `ReadTargetPathStateFn`/`CanonicalizeTargetFn` seams already isolate.
import path from 'node:path';
import { resolveRegisteredExcludedSubtrees } from '../scaffold/registered-manifest';
import { readProjectState, mutateProjectState } from '../project-state/io';
import type { ReadProjectStateFn, WriteProjectStateFn, TemplateEntry } from '../project-state/types';
import { checkTargetConflicts } from '../scaffold/conflict-check';
import type { CanonicalizeTargetFn, TargetClaim, TargetConflictEntry } from '../scaffold/conflict-check';
import { pathWithinTarget, joinUnderTarget } from '../paths/relative-path';
import type { ReadTargetPathStateFn } from './add-template';
import type { InventoryEntry } from '../inventory/types';
import type { ReadFileFn } from '../manifest/types';
import type { ErrorCode } from '../envelope';

// Narrow port over `TemplateInventory` — `ownership add` needs only
// `lookup`, to join a registered name's `targets[]` (project state) with
// that name's installed manifest's `excludedSubtrees` (`TargetClaim`'s own
// doc comment, `conflict-check.ts`).
export interface OwnershipInventoryPort {
  lookup(name: string): InventoryEntry | undefined;
}

export type OwnershipAddOutcome =
  | { ok: true; outcome: 'added' | 'noop'; path: string; projectOwnedRoots: string[] }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

export type OwnershipRemoveOutcome =
  | { ok: true; path: string; projectOwnedRoots: string[] }
  | { ok: false; code: ErrorCode; message: string };

export type OwnershipListOutcome =
  | { ok: true; projectOwnedRoots: string[] }
  | { ok: false; code: ErrorCode; message: string };

/**
 * The recorded-target claim set every registered template's `targets[]`
 * joins onto its own manifest's `excludedSubtrees` — a target recorded in
 * the project state store does NOT itself carry `excludedSubtrees`
 * (`project-state/types.ts`'s `TemplateEntry` has no such field), so the
 * join happens here (`inst-cpoadd-read-targets`). The declared list itself
 * is re-derived through `resolveRegisteredExcludedSubtrees`
 * (`../scaffold/registered-manifest.ts`) — the ONE shared formulation that
 * correctly resolves BOTH a remote (inventory-installed) and a local
 * `path:`-registered name's current manifest, rather than `inventory.lookup`
 * alone (which silently returns `[]` for a local origin — the bug this
 * checkpoint's live check surfaced; `commands/apply.ts`'s own
 * `buildRecordedTargetClaims` calls the identical shared function for the
 * identical join). A genuinely absent manifest joins as `[]`; a manifest
 * that could not currently be READ (`resolveRegisteredExcludedSubtrees`'s
 * own `{ known: false }`) joins as `[]` here too — `name` here is some
 * OTHER registered template than the one `ownership add`/`remove` is acting
 * on, and its broken origin is not this join's failure to raise
 * (`cpt-frontx-cli-nfr-template-scale`'s per-template independence). Either
 * way this join cannot do better than the manifest it can read, and
 * defaulting to NO exclusion is the fail-closed direction — it can only
 * under-exempt nested ground, never wrongly exempt it.
 */
async function buildRecordedTargets(
  templates: Record<string, TemplateEntry>,
  repoRoot: string,
  inventory: OwnershipInventoryPort,
  readFileFn: ReadFileFn,
  canonicalizeFn: CanonicalizeTargetFn,
): Promise<TargetClaim[]> {
  const claims: TargetClaim[] = [];
  for (const [name, entry] of Object.entries(templates)) {
    if (entry.targets.length === 0) continue;
    // The manifest's own `excludedSubtrees` entries are declared relative to
    // the TEMPLATE's own target (`manifest/types.ts`'s own doc comment on
    // the field: "the strict descendants of the template's own target"),
    // never to the project root — `checkTargetConflicts`'s nesting check
    // compares a `TargetClaim`'s `excludedSubtrees` against a full
    // project-relative descendant path (`conflict-check.test.ts`'s own
    // fixtures confirm this: `['packages/app/admin/']` for a target
    // `'packages/app'`), so each declared entry is joined under EVERY target
    // this name is applied to before it becomes a `TargetClaim` — a name
    // applied at two targets carves out the same relative exclusion under
    // each one independently.
    const resolution = await resolveRegisteredExcludedSubtrees(name, entry.origin, {
      repoRoot,
      inventory,
      readFileFn,
      canonicalizeFn,
    });
    // `resolution.known === false` (the manifest could not currently be
    // read) joins as `[]`, exactly like a genuinely absent one — dropping
    // `name`'s declared exclusions can only make its own claim WIDER, never
    // silently permit a conflict, and an unrelated template's broken origin
    // must never block the ownership change actually being made.
    const declaredExclusions = resolution.known ? resolution.excludedSubtrees : [];
    for (const target of entry.targets) {
      const excludedSubtrees = declaredExclusions.map((declared) => joinUnderTarget(target, declared));
      claims.push({ target, templateName: name, excludedSubtrees });
    }
  }
  return claims;
}

/**
 * Whether a `checkTargetConflicts` conflict entry is, from `ownership add`'s
 * own narrower contract (FEATURE composed-provenance, `inst-cpoadd-if-
 * conflict`), NOT a real refusal: the shared checker is nesting-aware in
 * BOTH directions (correct for assemble/apply's batch check), but `ownership
 * add` must refuse only when the candidate coincides with or is an ANCESTOR
 * of an applied target — a candidate that is a strict DESCENDANT of one is
 * the intended case the command exists to serve (PRD `cpt-frontx-fr-cli-
 * ownership-management`'s own rationale: protecting "the project's own
 * files that live inside a template's target") and must be accepted.
 *
 * Rather than hand-rolling a second path-geometry implementation, this
 * re-examines the shared checker's own verdict using the SAME
 * `pathWithinTarget` primitive `checkTargetConflicts` itself is built on
 * (`../paths/relative-path.ts`) — one canonicalization path, read in one
 * direction here. A reserved-ground entry (a single contestant — `.frontx`,
 * a reserved environment entry) carries no ancestor/descendant relationship
 * at all and is never narrowed by this predicate.
 */
function isPermittedDescendantConflict(conflict: TargetConflictEntry): boolean {
  if (conflict.contestants.length !== 2) return false; // reserved-ground: always a real refusal
  const candidateSide = conflict.contestants.find((c) => c.templateName === null);
  const targetSide = conflict.contestants.find((c) => c.templateName !== null);
  if (!candidateSide || !targetSide) return false;
  if (candidateSide.target === targetSide.target) return false; // coincidence: always a real refusal
  return pathWithinTarget(candidateSide.target, targetSide.target);
}

/**
 * cpt-frontx-algo-composed-provenance-ownership-add — accepts only an
 * existing, in-root path; refuses a path coinciding with or ancestor to any
 * applied target; otherwise appends it to `projectOwnedRoots` (or confirms
 * it is already present) without creating, moving, or deleting any file.
 */
export async function ownershipAdd(
  rawPath: string,
  repoRoot: string,
  inventory: OwnershipInventoryPort,
  readTargetPathStateFn: ReadTargetPathStateFn,
  canonicalizeFn: CanonicalizeTargetFn,
  readProjectStateFn: ReadProjectStateFn,
  writeProjectStateFn: WriteProjectStateFn,
  readFileFn: ReadFileFn,
): Promise<OwnershipAddOutcome> {
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-accept
  // `path` is accepted as this function's own parameter.
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-accept

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-if-missing
  // A genuine on-disk-existence check — deliberately NOT `canonicalizeFn`
  // alone, which is built for a target that may not exist yet and only
  // refuses an ESCAPE, never absence (`fs-project-io.ts`'s own doc comment
  // on `createFsCanonicalizeTargetFn`). Reuses the SAME `ReadTargetPathStateFn`
  // seam `add-template.ts`'s occupied-ground guard already probes existence
  // through, rather than adding a second one: its `'absent'` branch is
  // exactly the answer this check needs, and no other outcome
  // (`'directory'`/`'file'`) is treated differently here.
  const absolutePath = path.resolve(repoRoot, rawPath);
  const targetState = await readTargetPathStateFn(absolutePath);
  if (targetState === 'absent') {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-missing
    return {
      ok: false,
      code: 'INVALID_PATH',
      message: `Path "${rawPath}" does not exist; ownership add accepts only an existing path.`,
      details: { path: rawPath },
    };
    // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-missing
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-if-missing

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-canonicalize
  // The project root itself is a legitimate candidate here, spelled `.` by
  // the canonicalize adapter, never `""` — `paths/relative-path.ts`'s
  // `pathWithinTarget`/`targetsNest` (which the geometry check below is
  // built on) recognize `.` as containing every applied target, so `.`
  // correctly conflicts with any existing target and correctly succeeds
  // when there is none — the FEATURE's own error scenarios name no third
  // refusal for the root, so none is added here.
  const canonical = canonicalizeFn(rawPath);
  if (canonical === null) {
    return {
      ok: false,
      code: 'INVALID_PATH',
      message: `Path "${rawPath}" could not be proven to stay inside the project root.`,
      details: { path: rawPath },
    };
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-canonicalize

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-read-targets
  const stateResult = await readProjectState(repoRoot, readProjectStateFn);
  if (!stateResult.ok) {
    return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
  }
  const recordedTargets = await buildRecordedTargets(
    stateResult.document.templates,
    repoRoot,
    inventory,
    readFileFn,
    canonicalizeFn,
  );
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-read-targets

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-check-geometry
  // `projectOwnedRoots: []` here, DELIBERATELY not the document's own
  // current array: this call's whole job is to check the candidate against
  // every APPLIED TARGET, never against ground the project already owns —
  // re-adding a path already present in `projectOwnedRoots` is this
  // algorithm's OWN no-op (below), decided by this algorithm, not a
  // conflict the shared checker should raise against the project owning its
  // own ground. Passing the real array would make the checker's reserved-
  // ground rule (`inst-cc-if-reserved-ground`) fire on the exact-match case,
  // turning the intended no-op into a spurious `TARGET_CONFLICT`.
  // `localOriginFolders` stays empty for the reason `ConflictCheckInput`'s
  // own doc comment gives: `ownership add` has no template origin of its
  // own to exclude.
  const verdict = checkTargetConflicts({
    targetsUnderCheck: [{ target: canonical, templateName: null, excludedSubtrees: [] }],
    recordedTargets,
    projectOwnedRoots: [],
    canonicalizeFn,
  });
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-check-geometry

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-if-conflict
  if (!verdict.ok) {
    if (verdict.kind === 'INVALID_PATH') {
      // Defensive: `canonical` above already refused an escape, so the
      // checker's own internal re-canonicalization of the SAME
      // already-canonical string cannot genuinely disagree — kept only so
      // this branch is exhaustive over `ConflictCheckResult`'s discriminant
      // rather than assumed away.
      return {
        ok: false,
        code: 'INVALID_PATH',
        message: `Path "${rawPath}" could not be proven to stay inside the project root.`,
        details: { path: rawPath },
      };
    }
    // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-conflict
    // Narrow the shared checker's both-directions verdict to this command's
    // own one-direction contract (see `isPermittedDescendantConflict`'s doc
    // comment): drop every conflict that only exists because the candidate
    // is a strict descendant of an applied target, which this command must
    // accept rather than refuse.
    const realConflicts = verdict.conflicts.filter((conflict) => !isPermittedDescendantConflict(conflict));
    if (realConflicts.length > 0) {
      const contestingTemplates = [
        ...new Set(
          realConflicts.flatMap((conflict) =>
            conflict.contestants.map((contestant) => contestant.templateName).filter((n): n is string => n !== null),
          ),
        ),
      ];
      return {
        ok: false,
        code: 'TARGET_CONFLICT',
        message:
          `Path "${rawPath}" coincides with, or is an ancestor of, an applied ` +
          `target (${contestingTemplates.join(', ') || 'unknown'}).`,
        details: { path: rawPath, conflicts: realConflicts },
      };
    }
    // Every conflict the shared checker found was a permitted strict-
    // descendant relationship — fall through to the accept path below.
    // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-conflict
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-if-conflict

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-else
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-if-present
  if (stateResult.document.projectOwnedRoots.includes(canonical)) {
    // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-noop
    return { ok: true, outcome: 'noop', path: canonical, projectOwnedRoots: stateResult.document.projectOwnedRoots };
    // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-noop
  }
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-if-present

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-else-append
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-write
  const written = await mutateProjectState(
    repoRoot,
    { kind: 'add-owned-root', path: canonical },
    readProjectStateFn,
    writeProjectStateFn,
  );
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-write
  if (!written.ok) return { ok: false, code: 'PROJECT_INVALID', message: written.message };
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-success
  // @cpt-begin:cpt-frontx-state-composed-provenance-ownership-root-lifecycle:p1:inst-orl-unmarked-to-marked
  return { ok: true, outcome: 'added', path: canonical, projectOwnedRoots: written.document.projectOwnedRoots };
  // @cpt-end:cpt-frontx-state-composed-provenance-ownership-root-lifecycle:p1:inst-orl-unmarked-to-marked
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-return-success
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-else-append
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-add:p1:inst-cpoadd-else
}

/**
 * cpt-frontx-algo-composed-provenance-ownership-remove — unconditionally
 * removes `path` from `projectOwnedRoots` (or no-ops if it was already
 * absent); touches no file on disk.
 */
export async function ownershipRemove(
  rawPath: string,
  repoRoot: string,
  canonicalizeFn: CanonicalizeTargetFn,
  readProjectStateFn: ReadProjectStateFn,
  writeProjectStateFn: WriteProjectStateFn,
): Promise<OwnershipRemoveOutcome> {
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-accept
  // `path` is accepted as this function's own parameter.
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-accept

  // `ownership add` records the CANONICAL project-relative spelling
  // (`inst-cpoadd-canonicalize`), so removal by the raw, uncanonicalized
  // string a developer happens to type (`./docs` when `add` stored `docs`)
  // would report success while leaving the stored entry untouched —
  // confirmed live before this canonicalization existed. A path that no
  // longer resolves (already deleted from disk since it was added) must
  // stay removable, so a canonicalization failure falls back to the raw
  // string rather than refusing outright — `remove` has no error scenario
  // in the FEATURE spec at all, and a stale entry for ground that no longer
  // exists is exactly the case this fallback exists to still clear.
  const resolved = canonicalizeFn(rawPath);
  const removalTarget = resolved === null ? rawPath : resolved;

  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-read-state
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-remove
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-write
  // `mutateProjectState` performs the read-then-write in one call
  // (`project-state/io.ts`'s own `inst-psio-if-mutate`); there is no
  // separate read step to perform first.
  const written = await mutateProjectState(
    repoRoot,
    { kind: 'remove-owned-root', path: removalTarget },
    readProjectStateFn,
    writeProjectStateFn,
  );
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-write
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-remove
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-read-state
  if (!written.ok) return { ok: false, code: 'PROJECT_INVALID', message: written.message };
  // @cpt-begin:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-return-success
  // @cpt-begin:cpt-frontx-state-composed-provenance-ownership-root-lifecycle:p1:inst-orl-marked-to-unmarked
  return { ok: true, path: removalTarget, projectOwnedRoots: written.document.projectOwnedRoots };
  // @cpt-end:cpt-frontx-state-composed-provenance-ownership-root-lifecycle:p1:inst-orl-marked-to-unmarked
  // @cpt-end:cpt-frontx-algo-composed-provenance-ownership-remove:p1:inst-cporem-return-success
}

/**
 * cpt-frontx-flow-composed-provenance-ownership-list — read-only: returns
 * the current `projectOwnedRoots` (empty when no document exists yet) and
 * writes nothing. This flow cites the shared project-state-io algorithm
 * directly (FEATURE §2) rather than a distinct algorithm of its own, so the
 * markers below are the flow's own `inst-olist-*` IDs, not a second
 * `inst-cpo*` set.
 */
export async function ownershipList(
  repoRoot: string,
  readProjectStateFn: ReadProjectStateFn,
): Promise<OwnershipListOutcome> {
  // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-read
  const stateResult = await readProjectState(repoRoot, readProjectStateFn);
  // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-read

  // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-if-invalid
  if (!stateResult.ok) {
    // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-invalid
    return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
    // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-invalid
  }
  // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-if-invalid

  // @cpt-begin:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-roots
  return { ok: true, projectOwnedRoots: stateResult.document.projectOwnedRoots };
  // @cpt-end:cpt-frontx-flow-composed-provenance-ownership-list:p1:inst-olist-return-roots
}
