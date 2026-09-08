// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
// @cpt-flow:cpt-frontx-flow-upgrade-changeset-review-approval:p1
// @cpt-flow:cpt-frontx-flow-upgrade-changeset-restore:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-rollback:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-single-engine:p1
// @cpt-state:cpt-frontx-state-upgrade-changeset-lifecycle:p1
//
// Both actor flows §2 describes — a forward upgrade and a restore — drive
// the SAME engine (`cpt-frontx-dod-upgrade-changeset-single-engine`): read
// the baseline, validate (`cpt-frontx-algo-upgrade-changeset-validate`),
// present, approve/decline, commit (`cpt-frontx-algo-upgrade-changeset-
// commit`), map every commit outcome to its own return. Restore is not a
// second implementation of any of that — it is this engine invoked with the
// name's recorded PRECEDING `{origin, version}` as the candidate and its
// recorded version supplied as the expected version to check
// (`ValidateInput.candidateExpectedVersion`), and the currently recorded
// entry as the baseline. `driveUpgrade` below is the ONE private driver both
// exported entry points call — never a second "present, approve, commit, map
// outcomes" formulation.
//
// `driveUpgrade` reads the project state document EXACTLY ONCE per call, and
// hands the freshly-read `entry` to a small `deriveCandidate` callback that
// is the ONLY thing distinguishing the two directions: forward always
// succeeds with the developer's own origin and no recorded expectation;
// restore succeeds with the recorded preceding pair, or reports
// `NOTHING_TO_RESTORE` when there is none. Neither direction reads the
// project state document a second time to work out its own candidate — a
// second read here would risk seeing a different document than the one
// `driveUpgrade` already committed to (however unlikely in practice, this
// engine's own discipline elsewhere is "read once, never re-derive from a
// second read of the same store").
//
// A GAP in the FEATURE's own numbered steps, filled here rather than
// silently worked around: neither flow's §2 step list spells out a distinct
// instruction for the case where validation returns its `noop` outcome — the
// forward flow's own `inst-if-no-target` only lists FAILURE reasons
// (unresolvable, identity mismatch, content conflict, target conflict), and
// falling through to `inst-present-changeset` for a `noop` would present a
// plan that does not exist. The lifecycle states (§4,
// `inst-st-read-to-noop`) and the acceptance criteria ("resolves to the
// name's already-recorded `{origin, version}` is an idempotent no-op") both
// require this branch to exist and to skip presentation/approval/commit
// entirely, so it is implemented here as an explicit branch keyed to no
// numbered `inst-*` id — reported as a spec gap in this checkpoint's
// handoff, not invented silently.
import { commitUpgrade } from './commit';
import type { CommitDeps, CommitOutcome } from './commit';
import { validateUpgrade } from './validate';
import type { ValidateInput } from './validate';
import { readProjectState, mutateProjectState } from '../project-state/io';
import type { ReadProjectStateFn, TemplateEntry, WriteProjectStateFn } from '../project-state/types';
import type {
  ListDiskFilesFn,
  OriginVersion,
  PresentUpgradePlanFn,
  ReadDiskEntryFn,
  RenameDiskFileFn,
  ResolvePayloadFn,
  UnlinkDiskFileFn,
  UpgradePlan,
  UpgradeRefusal,
  WriteDiskFileFn,
} from './types';

export type UpgradeFlowOutcome =
  | { ok: true; outcome: 'noop'; at: OriginVersion }
  | { ok: true; outcome: 'declined'; plan: UpgradePlan }
  | { ok: true; outcome: 'success'; plan: UpgradePlan; reclaimedTempPaths: string[] }
  | UpgradeRefusal;

// Every seam both `commitUpgrade` and `validateUpgrade` need, gathered in one
// place so the two exported entry points share one dependency shape. Note
// what is DELIBERATELY ABSENT: no `refreshAiBundle` implementation is wired
// to a concrete function here — `promoteInventory`/`refreshAiBundle` are
// passed straight through to `commitUpgrade` exactly as the caller supplies
// them. `commit.ts`'s own header names `refreshAiBundle` a seam this
// feature's wiring layer (this file) closes over `../scaffold/ai-bundle.ts`'s
// `materializeOrRemoveAiBundle` and the resolved candidate payload to build —
// that wiring is NOT done in this checkpoint: `materializeOrRemoveAiBundle`'s
// transition union has no dedicated "refresh" kind today (a known nuance for
// whoever wires it, not resolved here), so inventing a mapping now would be
// guessing at a shape the next pass may need to change anyway.
export interface UpgradeEngineDeps {
  repoRoot: string;
  readProjectStateFn: ReadProjectStateFn;
  writeProjectStateFn: WriteProjectStateFn;
  resolvePayload: ResolvePayloadFn;
  // Manifest-only resolution of ANOTHER registered template's declared
  // exclusions — see `validate.ts`'s `ValidateInput` doc comment for why this
  // is deliberately NOT `resolvePayload`. The wiring layer satisfies it with
  // `resolveRegisteredExcludedSubtrees` (`../scaffold/registered-manifest.ts`).
  resolveRegisteredExclusions: (name: string, origin: string) => Promise<string[]>;
  readDiskEntry: ReadDiskEntryFn;
  writeDiskFile: WriteDiskFileFn;
  renameDiskFile: RenameDiskFileFn;
  unlinkDiskFile: UnlinkDiskFileFn;
  listDiskFiles: ListDiskFilesFn;
  canonicalizeFn: (raw: string) => string | null;
  presentPlan: PresentUpgradePlanFn;
  promoteInventory: (name: string) => Promise<void>;
  refreshAiBundle: (name: string) => Promise<void>;
}

function toCommitDeps(deps: UpgradeEngineDeps): CommitDeps {
  return {
    repoRoot: deps.repoRoot,
    readDiskEntry: deps.readDiskEntry,
    writeDiskFile: deps.writeDiskFile,
    renameDiskFile: deps.renameDiskFile,
    unlinkDiskFile: deps.unlinkDiskFile,
    listDiskFiles: deps.listDiskFiles,
    readProjectStateFn: deps.readProjectStateFn,
    writeProjectStateFn: deps.writeProjectStateFn,
    promoteInventory: deps.promoteInventory,
    refreshAiBundle: deps.refreshAiBundle,
  };
}

// What distinguishes a forward upgrade from a restore, given the SAME
// already-read `entry` `driveUpgrade` read once for its own registered/
// empty-targets gates: the candidate to validate against, or a refusal when
// there is none (restore's `NOTHING_TO_RESTORE`, the only way this can fail —
// a forward upgrade's own `deriveCandidate` never returns the `ok: false`
// arm at all).
type DeriveCandidateFn = (
  entry: TemplateEntry,
) => { ok: true; origin: string; expectedVersion?: string } | { ok: false; refusal: UpgradeRefusal };

/**
 * Maps one failed `CommitOutcome` onto its own `UpgradeRefusal` — a
 * pass-through in VALUE (every field `commitUpgrade` already produced is
 * exactly what this function returns), but each branch below is marked with
 * the `inst-if-commit-*` / `inst-rst-if-commit-*` id it realizes and the
 * lifecycle-state claim `cpt-frontx-state-upgrade-changeset-lifecycle` makes
 * for that outcome, per this checkpoint's instructions: "the flow must map
 * each to the FEATURE's own per-outcome state claim." The five outcomes
 * split two ways at that state level even though every one of them is
 * reported as a refusal-shaped value: a drift refusal and either flavor of
 * I/O failure land the engine in REFUSED (nothing committed), while a
 * promotion failure or a bundle-refresh failure still land it in COMMITTED
 * (the transition itself stands; only a later, re-derivable step did not).
 */
function mapCommitFailure(outcome: Extract<CommitOutcome, { ok: false }>): UpgradeRefusal {
  if (outcome.code === 'CONTENT_CONFLICT') {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-drift
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-drift
    // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-refused
    // Pre-rename drift: no destination touched, nothing committed.
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-drift
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-drift
    return outcome;
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-drift
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-drift
    // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-refused
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-drift
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-drift
  }
  const details = outcome.details ?? {};
  if ('slot' in details) {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-promotion-failed
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-promotion-failed
    // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-committed
    // Promotion failure AFTER the commit point: the transition itself
    // stands committed — this is COMMITTED, not REFUSED, even though the
    // return value is refusal-shaped.
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-promotion-failed
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-promotion-failed
    return outcome;
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-promotion-failed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-promotion-failed
    // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-committed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-promotion-failed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-promotion-failed
  }
  if ('bundle' in details) {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-bundle-refresh-failed
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-bundle-refresh-failed
    // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-committed
    // Bundle-refresh failure AFTER promotion: the transition and the
    // promoted inventory entry both stand — also COMMITTED.
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-bundle-refresh-failed
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-bundle-refresh-failed
    return outcome;
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-bundle-refresh-failed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-bundle-refresh-failed
    // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-committed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-bundle-refresh-failed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-bundle-refresh-failed
  }
  if ('unrecovered' in details) {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-recovery-failed
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-recovery-failed
    // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-refused
    // Recovery itself failed for one or more paths — REFUSED; the project
    // state store and inventory entry remain untouched regardless.
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-recovery-failed
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-recovery-failed
    return outcome;
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-recovery-failed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-recovery-failed
    // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-refused
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-recovery-failed
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-recovery-failed
  }
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-recovered
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-recovered
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-refused
  // A recovered I/O failure: every target, `templates[name]`, and the
  // inventory entry are exactly as before the attempt — REFUSED.
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-recovered
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-recovered
  return outcome;
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-commit-recovered
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-commit-recovered
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-approved-to-refused
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-commit-recovered
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-commit-recovered
}

/**
 * The one private driver both `upgradeToOrigin` and `restorePreceding` call.
 * `deriveCandidate` is the only thing that differs between the two
 * directions — everything else, including every refusal and every
 * commit-outcome mapping, is identical for both.
 */
async function driveUpgrade(name: string, deriveCandidate: DeriveCandidateFn, deps: UpgradeEngineDeps): Promise<UpgradeFlowOutcome> {
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-read-provenance
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-refused
  const stateResult = await readProjectState(deps.repoRoot, deps.readProjectStateFn);
  if (!stateResult.ok) {
    return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
  }
  const document = stateResult.document;
  const entry = document.templates[name];
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-read-provenance

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-not-registered
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-not-registered
  if (entry === undefined) {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-abort-not-registered
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-not-registered
    return {
      ok: false,
      code: 'TEMPLATE_NOT_REGISTERED',
      message: `"${name}" has no entry in the project state store; no diff computed.`,
      details: { name },
    };
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-not-registered
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-abort-not-registered
  }
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-not-registered
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-not-registered

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-empty-targets
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-empty-targets
  if (entry.targets.length === 0) {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-abort-empty-targets
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-empty-targets
    return {
      ok: false,
      code: 'TARGET_NOT_APPLIED',
      message: `"${name}" has no applied targets; there is no ground for upgrade to reconcile. Use "register --replace" instead.`,
      details: { name },
    };
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-empty-targets
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-abort-empty-targets
  }
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-empty-targets
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-empty-targets

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-unavailable
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-else
  // For a forward upgrade this never returns the `ok: false` arm — see
  // `upgradeToOrigin`'s own `deriveCandidate`. For restore, this is exactly
  // `inst-rst-if-unavailable`: no `{origin, version}` recorded as the name's
  // preceding entry. Never reachable for a name that HAS one — a second
  // restore in a row toggles back because THIS call's own commit (below)
  // records a fresh preceding pair before that later call ever reaches this
  // check again (see `restorePreceding`'s own header comment).
  const candidate = deriveCandidate(entry);
  if (!candidate.ok) {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-unavailable
    return candidate.refusal;
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-unavailable
  }
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-else
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-unavailable
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-refused

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-compute-diff
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke-validate
  // The ONE resolution of the candidate origin this whole call makes —
  // inside this single `validateUpgrade` invocation, never resolved a
  // second time by either exported entry point before or after this call
  // (`cpt-frontx-dod-upgrade-changeset-rollback`'s own requirement, which
  // applies identically to a forward upgrade's candidate).
  const validateInput: ValidateInput = {
    name,
    entry,
    candidateOrigin: candidate.origin,
    candidateExpectedVersion: candidate.expectedVersion,
    document,
    repoRoot: deps.repoRoot,
    resolvePayload: deps.resolvePayload,
    resolveRegisteredExclusions: deps.resolveRegisteredExclusions,
    readDiskEntry: deps.readDiskEntry,
    canonicalizeFn: deps.canonicalizeFn,
  };
  const validated = await validateUpgrade(validateInput);
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke-validate
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-compute-diff

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-no-target
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-validate-fails
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-refused
  if (!validated.ok) {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-abort-no-target
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-validate-fail
    // `templates[name]` and the local inventory entry unchanged for every
    // target; no plan is presented — checked BEFORE any presentation, for
    // both directions.
    return validated;
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-validate-fail
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-abort-no-target
  }
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-refused
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-validate-fails
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-no-target

  // See this file's header comment: neither flow's numbered steps name this
  // branch, but the lifecycle states and acceptance criteria both require
  // it — an idempotent no-op skips presentation, approval, and commit
  // entirely, and consumes no reversal.
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-noop
  if (validated.kind === 'noop') {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-noop-missing-exclusions
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-noop-missing-exclusions
    // A no-op for the pair {origin, version} is not a no-op for a document
    // missing a field this engine now writes — the identical rule
    // `commands/register.ts`'s own `inst-cpreg-if-noop-missing-exclusions`
    // applies to `register --replace` landing on the same origin. `entry`
    // is the SAME already-read baseline this call read once above at
    // `inst-read-provenance`/`inst-rst-invoke`; never re-read.
    if (entry.excludedSubtrees === undefined) {
      const repaired: TemplateEntry = { ...entry, excludedSubtrees: validated.excludedSubtrees };
      // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-record-noop-exclusions
      // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-record-noop-exclusions
      const written = await mutateProjectState(
        deps.repoRoot,
        { kind: 'set-template', name, entry: repaired },
        deps.readProjectStateFn,
        deps.writeProjectStateFn,
      );
      // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-record-noop-exclusions
      // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-record-noop-exclusions
      if (!written.ok) {
        return { ok: false, code: 'PROJECT_INVALID', message: written.message };
      }
    }
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-noop-missing-exclusions
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-noop-missing-exclusions
    return { ok: true, outcome: 'noop', at: validated.at };
  }
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-noop

  const plan = validated.plan;

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-present-changeset
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-present
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-validated-to-presented
  // The plan presented is the plan committed below — never recomputed.
  const decision = await deps.presentPlan(plan);
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-validated-to-presented
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-present
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-present-changeset

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-else-declined
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-else-declined
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-presented-to-declined
  if (decision === 'declined') {
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-no-write-on-decline
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-no-write-on-decline
    // Nothing written to any project file, to `templates[name]`, or to the
    // local inventory entry — `commitUpgrade` is never called on this path.
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-no-write-on-decline
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-no-write-on-decline
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-declined
    // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-declined
    return { ok: true, outcome: 'declined', plan };
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-declined
    // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-declined
  }
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-presented-to-declined
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-else-declined
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-else-declined

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-approved
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-approved
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-presented-to-approved
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-apply-changeset
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-reverse-content
  // `commitUpgrade` is direction-agnostic: `plan.from`/`plan.to` already
  // carry the right pair for either direction (restore's `from` is the
  // CURRENT entry, its `to` is the recorded preceding pair), so landing the
  // plan and recording the origin just left as the new preceding origin is
  // the SAME call for both flows — restore needs no separate commit step.
  const commitOutcome = await commitUpgrade(plan, toCommitDeps(deps));
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-reverse-content
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-apply-changeset
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-presented-to-approved

  if (!commitOutcome.ok) {
    return mapCommitFailure(commitOutcome);
  }

  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-success
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-success
  return { ok: true, outcome: 'success', plan: commitOutcome.plan, reclaimedTempPaths: commitOutcome.reclaimedTempPaths };
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-return-success
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-return-success
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-if-approved
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-if-approved
}

/**
 * `cpt-frontx-flow-upgrade-changeset-review-approval` — `upgrade
 * <templateName> <new-origin>`. The forward direction: a developer-supplied
 * origin, no recorded expected version — `deriveCandidate` below always
 * succeeds, so `NOTHING_TO_RESTORE` is structurally unreachable from this
 * entry point.
 */
// @cpt-begin:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-invoke-upgrade
export async function upgradeToOrigin(
  templateName: string,
  newOrigin: string,
  deps: UpgradeEngineDeps,
): Promise<UpgradeFlowOutcome> {
  return driveUpgrade(templateName, () => ({ ok: true, origin: newOrigin }), deps);
}
// @cpt-end:cpt-frontx-flow-upgrade-changeset-review-approval:p1:inst-invoke-upgrade

/**
 * `cpt-frontx-flow-upgrade-changeset-restore` — `upgrade <templateName>
 * --restore`. Drives the SAME engine with the name's recorded preceding
 * `{origin, version}` as the candidate and its own recorded version as the
 * expected version `validateUpgrade` checks the resolved candidate against —
 * read from the SAME single project-state read `driveUpgrade` performs
 * internally (never a second read here to work out the candidate), and
 * resolved exactly ONCE, inside that single `validateUpgrade` call, never
 * resolved a second time by this function before or after.
 *
 * `commitUpgrade` then records the origin restore is now LEAVING (the
 * current entry's own `{origin, version}`, i.e. `plan.from`) as the name's
 * new preceding origin — which is exactly what makes a SECOND restore,
 * requested immediately after this one, toggle back rather than ever
 * reaching `NOTHING_TO_RESTORE`: that later call's own `deriveCandidate`
 * reads `entry.previous` fresh from ITS OWN read of the project state
 * document, and this restore's own commit is what left a fresh pair there
 * before that later call ever runs.
 */
export async function restorePreceding(templateName: string, deps: UpgradeEngineDeps): Promise<UpgradeFlowOutcome> {
  // @cpt-begin:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke
  return driveUpgrade(
    templateName,
    (entry) =>
      entry.previous === undefined
        ? {
            ok: false,
            refusal: {
              ok: false,
              code: 'NOTHING_TO_RESTORE',
              message: `"${templateName}" has no preceding {origin, version} recorded — it has never been upgraded, or a later "register --replace" cleared the pair.`,
              details: { name: templateName },
            },
          }
        : { ok: true, origin: entry.previous.origin, expectedVersion: entry.previous.version },
    deps,
  );
  // @cpt-end:cpt-frontx-flow-upgrade-changeset-restore:p1:inst-rst-invoke
}
