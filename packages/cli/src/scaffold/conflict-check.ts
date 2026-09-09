import { pathWithinSubtree, pathWithinTarget, targetsNest } from '../paths/relative-path';
import { foldForIdentity } from '../paths/volume-case';
import { CLI_RESERVED_ROOTS } from './effective-ownership';

// Resolves a caller-supplied target path against the project root, fail-
// closed: `null` when the path cannot be PROVEN to stay inside the root
// (a `..` segment or a symlink that escapes it), otherwise the canonical
// project-relative POSIX path (`inst-cc-canonicalize`). A pure seam — no
// direct filesystem access in this module (the algorithm's own convention,
// matched by every other scaffold/manifest seam) — the real implementation
// is `createFsCanonicalizeTargetFn` (`../adapters/fs-project-io.ts`).
export type CanonicalizeTargetFn = (rawTarget: string) => string | null;

// A single ownership claim over a target, tagged with the template name that
// makes it (or `null` for an `ownership add` candidate, which claims no
// template ownership at all — it is a `projectOwnedRoots` candidate, not a
// template's target) and that template's declared `excludedSubtrees` (`[]`
// when `templateName` is `null`, or when the template declares none). The
// SAME shape describes both a target already recorded in the project state
// store and a target under check: `inst-cc-combine` tags both halves of the
// comparison set identically, and `inst-cc-if-ancestor`'s permitted-nesting
// exception (`inst-cc-if-excluded-nest`) needs a claim's `excludedSubtrees`
// regardless of which side of a pair it ends up playing the ancestor role on
// — a staged batch can itself carry two templates whose targets nest, not
// only a staged target nesting under something already applied.
//
// A target already recorded in the project state store's `targets[]` does
// NOT itself carry `excludedSubtrees` (`project-state/types.ts`'s
// `TemplateEntry` has no such field — only `origin`, `version`, `targets`);
// that declaration lives in the owning template's MANIFEST. Constructing
// this shape for a recorded target is therefore the caller's join, not this
// algorithm's: read the name's `targets[]` from the project state document,
// look up that name's installed manifest, and pair each target with the
// SAME `excludedSubtrees` array for every target that name owns.
export interface TargetClaim {
  target: string;
  templateName: string | null;
  excludedSubtrees: string[];
}

export interface TargetConflictContestant {
  target: string;
  templateName: string | null;
}

// One contested ground and every claim contesting it. A reserved-ground
// conflict (`inst-cc-record-reserved`) names only the one target under check
// that landed on it — the reservation itself is not a competing template
// claim, so there is no second contestant to name.
export interface TargetConflictEntry {
  ground: string;
  contestants: TargetConflictContestant[];
}

export type ConflictCheckResult =
  | { ok: true }
  | { ok: false; kind: 'INVALID_PATH'; path: string }
  | { ok: false; kind: 'TARGET_CONFLICT'; conflicts: TargetConflictEntry[] };

export interface ConflictCheckInput {
  // Either a staged batch's targets, or a single `ownership add` candidate
  // (`templateName: null`, `excludedSubtrees: []`) — this algorithm judges
  // both through the identical geometry (`cpt-frontx-dod-cli-scaffolding-
  // conflict-check`).
  targetsUnderCheck: TargetClaim[];
  // Every target already recorded across every registered template's
  // `targets[]`, each tagged with its owning template name and that
  // template's declared `excludedSubtrees` (see `TargetClaim`'s doc comment
  // for how a caller joins this from the project state store).
  recordedTargets: TargetClaim[];
  projectOwnedRoots: string[];
  // Folders a locally-installed template's own origin occupies inside the
  // project — empty by default, the honest state for `ownership add`, which
  // has no template origin of its own to exclude from its own check.
  localOriginFolders?: string[];
  canonicalizeFn: CanonicalizeTargetFn;
}

// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-conflict-check:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-conflict-check:p1
/**
 * The nesting-aware, fail-closed pre-flight target conflict check
 * (`cpt-frontx-algo-cli-scaffolding-conflict-check`) — the ONE shared
 * geometry every caller that must check a target or a candidate path against
 * everything already claimed runs through identically: a staged batch's
 * targets (`assemble`/`apply`), or a single `ownership add` candidate. A
 * future `delete` and `upgrade` read the same geometry for their own plans,
 * but call it differently (a single already-applied target, not a batch) —
 * this function's contract does not change for them, only what they pass.
 *
 * Canonicalizes every target under check to a project-relative path first
 * (`inst-cc-canonicalize`), fail-closed: a target that cannot be proven to
 * stay inside the project root through a symlink or a `..` segment refuses
 * the WHOLE check with `INVALID_PATH` before any comparison runs, rather
 * than silently dropping just that one target.
 *
 * Then runs one nesting-aware intersection check over the canonicalized
 * batch plus everything already recorded: the same target claimed by two
 * different templates is a conflict; the same target claimed twice by the
 * same template is an idempotent no-op; an undeclared ancestor/descendant
 * relationship is a conflict unless the descendant lies at or inside the
 * ancestor template's declared `excludedSubtrees`; and a target landing
 * inside `projectOwnedRoots`, `.frontx`, a local origin folder, or a
 * reserved environment entry is always a conflict regardless of nesting
 * direction — the reverse (one of those landing inside the target under
 * check) is a permitted subtraction, never judged here at all.
 *
 * Every conflict found is collected before returning — never short-circuited
 * on the first one — so a refusal report names every contested ground in
 * one pass, before any file is written or any `projectOwnedRoots` entry is
 * added.
 */
export function checkTargetConflicts(input: ConflictCheckInput): ConflictCheckResult {
  const localOriginFolders = input.localOriginFolders ?? [];

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-foreach-target
  const canonicalizedUnderCheck: TargetClaim[] = [];
  for (const claim of input.targetsUnderCheck) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-canonicalize
    const canonical = input.canonicalizeFn(claim.target);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-canonicalize

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-escape
    // The project root itself is a legitimate target, spelled `.` by the
    // canonicalize adapter (`adapters/fs-project-io.ts`'s
    // `createFsCanonicalizeTargetFn`) — never `""`, which every containment
    // predicate this algorithm calls (`targetsNest`, `pathWithinTarget`,
    // `pathWithinSubtree`) treats as a DECLARATION addressing no location at
    // all, not a target. Only a genuine canonicalization failure (`null`) is
    // refused here.
    if (canonical === null) {
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-escape

      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-escape
      // Fail-closed rather than guessing: refuse the WHOLE check, naming the
      // one target that could not be proven to stay inside the project root.
      return { ok: false, kind: 'INVALID_PATH', path: claim.target };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-escape
    }
    canonicalizedUnderCheck.push({ ...claim, target: canonical });
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-foreach-target

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-combine
  // Every entry tagged with `staged` so `inst-cc-foreach-pair` can narrow to
  // pairs with at least one side under check — mirrors the same narrowing
  // the legacy checker (`./conflict.ts`) already applies for the same
  // reason: a recorded/recorded overlap describes what the repository
  // already holds, not something THIS operation created, and refusing an
  // unrelated batch cannot repair it.
  const combined: Array<TargetClaim & { staged: boolean }> = [
    ...canonicalizedUnderCheck.map((claim) => ({ ...claim, staged: true })),
    ...input.recordedTargets.map((claim) => ({ ...claim, staged: false })),
  ];
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-combine

  const conflicts: TargetConflictEntry[] = [];

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-foreach-pair
  for (let i = 0; i < combined.length; i++) {
    for (let j = i + 1; j < combined.length; j++) {
      const a = combined[i];
      const b = combined[j];
      if (!a.staged && !b.staged) continue; // both already recorded: not this operation's business

      // `targetsNest` (never a bare string-prefix test) decides whether these
      // two claims coincide or nest at all — `packages/app` and
      // `packages/app-shell` share a string prefix but no path segment, so
      // it correctly reports no relationship between them; `.` (the project
      // root, a legitimate target) nests with every other target. It also
      // folds case per the project volume (`paths/volume-case.ts`), so two
      // spellings of one location on a case-insensitive volume nest here
      // even before either has ever been materialized on disk.
      if (!targetsNest(a.target, b.target)) continue;

      // `foldForIdentity`, not a bare `===`: two spellings of the SAME
      // not-yet-existing ground (a batch's own two entries, neither
      // materialized yet) can only be recognized as coinciding here — once
      // either is created, `canonicalizeFn` converges them on its own — so
      // this decision has to agree with `targetsNest`'s own fold above,
      // never a byte-exact comparison `targetsNest` would already treat as
      // nesting.
      if (foldForIdentity(a.target) === foldForIdentity(b.target)) {
        // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-same-template-noop
        if (a.templateName !== null && a.templateName === b.templateName) {
          // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-same-template-noop

          // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-noop
          continue; // idempotent re-apply of the same template's own target
          // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-noop
        }

        // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-same-target-diff-template
        // Falls through here whenever the identical target is NOT the same
        // template's own re-claim — two different template names, or a
        // template claim coinciding with a name-less `ownership add`
        // candidate: neither is a no-op, both are a conflict.
        // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-same-target-diff-template

        // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-same-target
        conflicts.push({
          ground: a.target,
          contestants: [
            { target: a.target, templateName: a.templateName },
            { target: b.target, templateName: b.templateName },
          ],
        });
        // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-same-target
        continue;
      }

      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-ancestor
      // Distinct paths that still `targetsNest`: one is a strict ancestor of
      // the other, decided by `pathWithinTarget`'s whole-segment comparison
      // in each direction — never by string-prefix. `pathWithinTarget`
      // (not the bare `pathWithinSubtree`) because either side may
      // legitimately be `.`, the project root, which is an ancestor of
      // every other target.
      const aIsAncestor = pathWithinTarget(b.target, a.target);
      const ancestor = aIsAncestor ? a : b;
      const descendant = aIsAncestor ? b : a;

      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-excluded-nest
      // A descendant equal to a declared entry is INSIDE it too
      // (`pathWithinSubtree`'s own equal-path branch) — the entry is ground
      // the ancestor host reserved for a guest to occupy exactly there.
      const permittedNest = ancestor.excludedSubtrees.some((excluded) => pathWithinSubtree(descendant.target, excluded));
      if (permittedNest) {
        // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-excluded-nest

        // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-permit-nest
        continue; // the outer template deliberately carved out this ground
        // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-permit-nest
      }

      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-else-undeclared-nest
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-ancestor
      conflicts.push({
        ground: `${ancestor.target} contains ${descendant.target}`,
        contestants: [
          { target: ancestor.target, templateName: ancestor.templateName },
          { target: descendant.target, templateName: descendant.templateName },
        ],
      });
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-ancestor
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-else-undeclared-nest
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-ancestor
    }
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-foreach-pair

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-reserved-ground
  // Run once per target under check, over the reserved-ground list, rather
  // than nested inside `inst-cc-foreach-pair` above: that loop's "pair"
  // shape has no natural second half for a `projectOwnedRoots` entry or
  // `.frontx` (neither is a `TargetClaim` — neither carries a template name
  // or `excludedSubtrees`), and running it once per (target, recorded-target)
  // pair instead of once per target would report the SAME reserved-ground
  // hit once per already-recorded target sharing the batch, a duplicate the
  // spec's "refuse the whole batch" report never intends.
  //
  // Only a target UNDER CHECK is judged here — a target already recorded
  // passed this exact check the moment it was itself staged, so re-running
  // it now would only repeat a verdict this operation did not create.
  const reservedGround = buildReservedGround(input.projectOwnedRoots, localOriginFolders);
  for (const claim of canonicalizedUnderCheck) {
    for (const reserved of reservedGround) {
      // `pathWithinTarget`, NOT the bare `pathWithinSubtree`: this is the
      // SAME reserved-ground list `scaffold/effective-ownership.ts` subtracts
      // with `pathWithinTarget` (its `isWithinEffectiveOwnership`), and the
      // two predicates disagree on exactly one reachable input — a reserved
      // path spelled `.`, which `pathWithinTarget` reads as the project root
      // containing every target and `pathWithinSubtree` matches only against
      // the literal string `.`.
      //
      // That divergence was a real, reachable defect, and precisely the
      // "two comparison points for one geometry" class both checkpoint-2
      // HIGH bugs came from: `ownership add .` is legitimate on a project
      // with no applied target yet (this feature's own error scenarios name
      // no refusal for it), so `projectOwnedRoots` genuinely can hold `.`.
      // With `pathWithinSubtree` here, a subsequent `apply` into any target
      // passed this check unrefused, while effective ownership — computed
      // with the OTHER predicate — subtracted the whole project: apply
      // reported success, wrote zero files, and recorded the target anyway.
      // One predicate for one list is what makes the check and the
      // subtraction agree by construction rather than by coincidence.
      if (!pathWithinTarget(claim.target, reserved.path)) continue;

      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-reserved
      // Always a conflict regardless of nesting direction — the landing
      // direction judged here is target-under-check-inside-reserved-ground;
      // the reverse (reserved ground landing inside the target under check)
      // is never reported at all (see `inst-cc-if-reverse-containment`
      // below).
      conflicts.push({
        ground: reserved.label,
        contestants: [{ target: claim.target, templateName: claim.templateName }],
      });
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-record-reserved
    }
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-reserved-ground

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-reverse-containment
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-permit-reverse
  // A `projectOwnedRoots` entry or a local origin folder landing INSIDE a
  // target under check (the reverse of the direction checked above) is a
  // permitted subtraction from that target's effective ownership, not a
  // conflict — deliberately absent as a check, not merely unreported: the
  // loop above only ever tests target-under-check-inside-reserved-ground,
  // never the reverse direction, so this permission holds by construction
  // rather than by a second branch that would have to agree with it.
  //
  // "Permitted here" is only half of the promise, though, and the other half
  // lives outside this checker: for the permission to mean anything, the
  // pipeline that runs AFTER the check must actually subtract that ground
  // rather than claim it. For `projectOwnedRoots` and the applying
  // template's own origin folder, `scaffold/effective-ownership.ts` does
  // (terms two and six). For ANOTHER registered template's origin folder it
  // did not, until `scaffold/assembler.ts`'s `collectOtherLocalOriginFolders`
  // appended those roots to each staged entry's `exclusionRoots` — before
  // that, this comment's promise was true of the check and false of the
  // apply, and existing-content reconciliation demanded `--adopt-existing`
  // over ground this very block calls reserved.
  //
  // `.frontx` and the reserved environment entries sitting inside a target
  // under check (an ordinary root-level `apply` target contains both) are
  // likewise not merely permitted here but subtracted downstream. Note the
  // exact scope of that subtraction, which is narrower than "wherever they
  // sit beneath the target": `computeExclusionRoots` adds them at their
  // PROJECT-ROOT spelling only (`.git`, `.DS_Store`), so a nested spelling
  // such as `pkg/a/.DS_Store` is NOT excluded from a target at `pkg/a`. That
  // follows from whole-target ownership — a template owns its whole target,
  // and the reserved entries are project-level facts, not per-directory ones
  // — and the FEATURE's own acceptance criteria pin only the root case. It
  // is recorded here rather than glossed over, because the previous wording
  // of this comment claimed the broader guarantee and did not have it.
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-permit-reverse
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-reverse-containment

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-any-conflict
  if (conflicts.length > 0) {
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-if-any-conflict

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-conflict
    return { ok: false, kind: 'TARGET_CONFLICT', conflicts };
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-conflict
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-pass
  return { ok: true };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-conflict-check:p1:inst-cc-return-pass
}

interface ReservedGroundEntry {
  label: string;
  path: string;
}

// The full reserved-ground list `inst-cc-if-reserved-ground` checks a
// target under check against: `.frontx` (the CLI-owned namespace, always
// reserved), every fixed reserved environment entry (`.git`, `.DS_Store`,
// `Thumbs.db`), every current `projectOwnedRoots` entry, and every local
// origin folder the caller passed (empty for `ownership add` today, per
// this algorithm's own input contract). `label` is what a refusal report
// names as the contested ground; `path` is what `pathWithinSubtree` tests
// the target under check against.
//
// The FIXED half — `.frontx` and the environment entries — comes from
// `CLI_RESERVED_ROOTS` (`./effective-ownership.ts`), not from a second
// literal composed here. It used to be composed here, and separately in the
// six-term subtraction, from a shared `RESERVED_ENVIRONMENT_ENTRIES` array
// and each module's own `.frontx` literal: the ENTRIES were one formulation
// while the COMPOSITE was two, so "what the CLI reserves unconditionally"
// could have been changed in one list and not the other. The variable half
// stays here, because this algorithm's variable terms are genuinely its own
// (see that constant's doc comment).
function buildReservedGround(projectOwnedRoots: string[], localOriginFolders: string[]): ReservedGroundEntry[] {
  return [
    ...CLI_RESERVED_ROOTS.map((entry) => ({ label: entry, path: entry })),
    ...projectOwnedRoots.map((root) => ({ label: `projectOwnedRoots: ${root}`, path: root })),
    ...localOriginFolders.map((folder) => ({ label: `local origin folder: ${folder}`, path: folder })),
  ];
}
