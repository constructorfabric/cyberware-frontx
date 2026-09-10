// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
//
// Projects an internal `UpgradePlan` down to the shape a DEVELOPER (or a
// calling program) is shown for review.
//
// WHY THIS PROJECTION EXISTS. `UpgradePlan.operations` carries three content
// fields the COMMIT algorithm needs and the reviewer must never be handed:
// `expectedDisk` (what classification saw, which `inst-com-verify-destinations`
// re-checks immediately before the first rename), `newContent` (the bytes an
// `ADD`/`REPLACE` will land), and `baselineContent` (what
// `inst-com-restore-on-error` writes back to reverse a landed operation).
// They exist so the plan a developer approved is the plan that lands, byte for
// byte, without a recomputation in between.
//
// Passing that structure straight into the result envelope puts up to THREE
// FULL COPIES of every changed file's contents into the command's output. That
// is wrong on two counts, and the second is the load-bearing one:
//
//   - It contradicts what the plan IS. `cpt-frontx-adr-project-upgrade-
//     mechanism` fixes whole-file granularity precisely so that "a plan a
//     developer reviews before anything is written must be reviewable as a
//     list of files and actions, not as textual deltas inside them", and
//     states there is "no hunk, region-marker, or line-level representation
//     anywhere in this plan". File CONTENT in the reviewable payload is a
//     textual delta by another name — worse, an unlabelled one.
//   - It publishes the BASELINE's content alongside the candidate's. A
//     reviewer asked to approve a transition does not need, and should not be
//     handed, a copy of what is currently on disk plus a copy of what was
//     there at the recorded baseline.
//
// So the reviewable projection carries exactly what the FEATURE's own
// `inst-present-changeset` step enumerates: the `from` and `to` origin/version
// pairs, every target the plan covers, one `{target, path, op}` per classified
// path, and every `SKIPPED` path with the reason it was skipped. Nothing else.
import type { SkipReason, UpgradeOpKind, UpgradePlan } from './types';

// One classified path as a reviewer sees it: which target, which path, which
// of the five whole-file operations. No content, by construction rather than
// by a caller remembering to strip it.
export interface ReviewableOperation {
  target: string;
  path: string;
  op: UpgradeOpKind;
}

export interface ReviewableSkippedPath {
  target: string;
  path: string;
  reason: SkipReason;
}

export interface ReviewablePlan {
  name: string;
  from: { origin: string; version: string };
  to: { origin: string; version: string };
  targets: string[];
  operations: ReviewableOperation[];
  skipped: ReviewableSkippedPath[];
}

/**
 * The ONE projection every caller that shows a plan to anyone goes through —
 * the machine-readable envelope's `details.plan` and the human presenter
 * alike. Kept as a single function so no caller can accidentally serialize
 * the internal plan directly, which is exactly the defect this module was
 * added to close.
 */
export function renderReviewablePlan(plan: UpgradePlan): ReviewablePlan {
  return {
    name: plan.name,
    from: { origin: plan.from.origin, version: plan.from.version },
    to: { origin: plan.to.origin, version: plan.to.version },
    targets: [...plan.targets],
    // Explicit field-by-field construction, never a spread-minus-omit: a
    // spread would silently start carrying any content field a future
    // `UpgradeOperation` gains, which is precisely how this leak would come
    // back.
    operations: plan.operations.map((operation) => ({
      target: operation.target,
      path: operation.path,
      op: operation.op,
    })),
    skipped: plan.skipped.map((entry) => ({
      target: entry.target,
      path: entry.path,
      reason: entry.reason,
    })),
  };
}
