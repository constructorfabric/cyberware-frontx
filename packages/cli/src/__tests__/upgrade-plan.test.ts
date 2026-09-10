// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
//
// Pins the reviewable-plan projection (`../upgrade/plan.ts`).
//
// This exists because the defect it closes was live: every path that showed a
// plan — the `--json` envelope's `details.plan`, the success/declined `data`
// payloads, and the interactive presenter, which `JSON.stringify`d the whole
// thing to stdout — serialized the INTERNAL plan, so `expectedDisk`,
// `newContent` and `baselineContent` travelled with it. That put up to three
// full copies of every changed file's bytes (including the baseline's own
// content) into what a developer was asked to review, contradicting
// `cpt-frontx-adr-project-upgrade-mechanism`'s whole-file granularity: "a plan
// a developer reviews before anything is written must be reviewable as a list
// of files and actions, not as textual deltas inside them".
import { describe, expect, it } from 'vitest';
import { renderReviewablePlan } from '../upgrade/plan';
import type { UpgradePlan } from '../upgrade/types';

const SECRET = 'THE-FILE-CONTENT-THAT-MUST-NOT-BE-PUBLISHED';

function internalPlan(): UpgradePlan {
  return {
    name: '@scope/tpl',
    from: { origin: 'path:vendor/v1', version: '1.0.0' },
    to: { origin: 'path:vendor/v2', version: '2.0.0' },
    targets: ['app', 'admin'],
    // Internal boundary bookkeeping the projection must also strip — asserted
    // below, since it is not part of the review vocabulary either.
    exclusionRootsByTarget: { app: ['app/vendor'], admin: [] },
    toExcludedSubtrees: [],
    operations: [
      { target: 'app', path: 'app/a.ts', op: 'REPLACE', expectedDisk: SECRET, newContent: SECRET, baselineContent: SECRET },
      { target: 'app', path: 'app/b.ts', op: 'ADD', expectedDisk: null, newContent: SECRET, baselineContent: null },
      { target: 'app', path: 'app/c.ts', op: 'REMOVE', expectedDisk: SECRET, baselineContent: SECRET },
      { target: 'admin', path: 'admin/d.ts', op: 'KEEP_LOCAL', expectedDisk: SECRET, baselineContent: SECRET },
      { target: 'admin', path: 'admin/e.ts', op: 'UNCHANGED', expectedDisk: SECRET, baselineContent: SECRET },
    ],
    skipped: [
      { target: 'app', path: 'app/docs/x.md', reason: 'OUTSIDE_BOUNDARY' },
      { target: 'app', path: 'app/y.frontx-upgrade-tmp', reason: 'RESERVED_TEMP_NAME' },
    ],
  };
}

describe('renderReviewablePlan', () => {
  // The load-bearing assertion: serialize the projection and prove the file
  // contents are nowhere in it. Written against the SERIALIZED form on
  // purpose — that is what actually reaches a caller's stdout or an envelope,
  // and a per-field assertion would miss a leak through a nested field a
  // future change adds.
  it('carries no file content at all — not the candidate, the baseline, or what was on disk', () => {
    const serialized = JSON.stringify(renderReviewablePlan(internalPlan()));

    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('expectedDisk');
    expect(serialized).not.toContain('newContent');
    expect(serialized).not.toContain('baselineContent');
    expect(serialized).not.toContain('exclusionRootsByTarget');
  });

  it('keeps exactly the review vocabulary: from/to, every target, and one file-and-action per classified path', () => {
    const reviewable = renderReviewablePlan(internalPlan());

    expect(reviewable.name).toBe('@scope/tpl');
    expect(reviewable.from).toEqual({ origin: 'path:vendor/v1', version: '1.0.0' });
    expect(reviewable.to).toEqual({ origin: 'path:vendor/v2', version: '2.0.0' });
    expect(reviewable.targets).toEqual(['app', 'admin']);
    expect(reviewable.operations).toEqual([
      { target: 'app', path: 'app/a.ts', op: 'REPLACE' },
      { target: 'app', path: 'app/b.ts', op: 'ADD' },
      { target: 'app', path: 'app/c.ts', op: 'REMOVE' },
      { target: 'admin', path: 'admin/d.ts', op: 'KEEP_LOCAL' },
      { target: 'admin', path: 'admin/e.ts', op: 'UNCHANGED' },
    ]);
  });

  // Every `SKIPPED` path survives the projection WITH its reason: the FEATURE
  // requires a reserved-temp-name collision be reported "naming that
  // collision, never silently dropped from the plan", so dropping `skipped`
  // from the reviewable shape would defeat its own discoverability channel.
  it('keeps every SKIPPED path and its reason, including a reserved-temp-name collision', () => {
    const reviewable = renderReviewablePlan(internalPlan());

    expect(reviewable.skipped).toEqual([
      { target: 'app', path: 'app/docs/x.md', reason: 'OUTSIDE_BOUNDARY' },
      { target: 'app', path: 'app/y.frontx-upgrade-tmp', reason: 'RESERVED_TEMP_NAME' },
    ]);
  });

  // Field-by-field construction, never a spread-minus-omit: proven by feeding
  // an operation carrying an extra property and asserting it does not travel.
  // This is what keeps a future content field added to `UpgradeOperation` from
  // silently reopening the leak.
  it('does not pass through an unexpected extra field on an operation', () => {
    const plan = internalPlan();
    (plan.operations[0] as unknown as Record<string, unknown>).futureContentField = SECRET;

    const serialized = JSON.stringify(renderReviewablePlan(plan));

    expect(serialized).not.toContain('futureContentField');
    expect(serialized).not.toContain(SECRET);
  });

  it('does not mutate or alias the plan it projects', () => {
    const plan = internalPlan();
    const reviewable = renderReviewablePlan(plan);

    reviewable.targets.push('mutated');
    expect(plan.targets).toEqual(['app', 'admin']);
    expect(plan.operations[0].newContent).toBe(SECRET);
  });
});
