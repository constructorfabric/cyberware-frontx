// @cpt-flow:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1
// @cpt-state:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// PLAN CORRECTION (2026-07-14) — REOPENED: this module MUST NOT import
// the CLI package and MUST NOT link the F14 engine's `computeChangeSet`/
// `applyChangeSet` exports. It drives the SINGLE engine strictly through the
// injected `invokeUpgradeCommand` — the `frontx upgrade` COMMAND/INVOCATION
// SURFACE (`InvokeUpgradeCommandFn`) — never a compile-time package
// dependency (DESIGN §3.4; ADR-0027 `cpt-frontx-adr-ai-driven-upgrade-orchestration`).
import { enrichUpgradeChangeSet } from './enrich.js';
import { OrchestrationLifecycleState, type OrchestrationLifecycleStateValue } from './state.js';
import { resolveTargetOrigin } from './types.js';
import type {
  ChangeSet,
  EnrichedReviewPackage,
  InvokeUpgradeCommandFn,
  PresentEnrichedReviewFn,
  ReadProvenanceFn,
  ReviewDecision,
} from './types.js';
// The project's single state document shape and its NAMED-template lookup
// are promoted to the neutral `src/project-state.ts` (F16's AI-extension
// trust gate reads the SAME document) — imported directly rather than
// re-exported through this package's own `types.ts`.
import { selectTemplateEntry } from '../project-state.js';

// All dependencies are injected. `invokeUpgradeCommand` MUST drive the F14
// engine strictly through the `frontx upgrade` command/invocation surface —
// this layer orchestrates and enriches that single engine, it never
// reimplements it and never imports it as a package
// (cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
export interface OrchestrationDeps {
  readProvenance: ReadProvenanceFn;
  invokeUpgradeCommand: InvokeUpgradeCommandFn;
  presentEnrichedReview: PresentEnrichedReviewFn;
}

export type OrchestrationResult =
  | { status: 'applied'; targetVersion: string; reviewPackage: EnrichedReviewPackage; lifecycleHistory: readonly OrchestrationLifecycleStateValue[] }
  | { status: 'declined'; reviewPackage: EnrichedReviewPackage; lifecycleHistory: readonly OrchestrationLifecycleStateValue[] }
  | { status: 'project-invalid'; code: 'PROJECT_INVALID'; message: string }
  | { status: 'template-not-registered'; code: 'TEMPLATE_NOT_REGISTERED'; message: string }
  | { status: 'target-not-applied'; code: 'TARGET_NOT_APPLIED'; message: string }
  | { status: 'origin-unavailable'; code: 'ORIGIN_UNAVAILABLE'; message: string }
  // A genuine refusal from the command surface's FIRST, unconfirmed call —
  // `CONTENT_CONFLICT`, `TARGET_CONFLICT`, `PROJECT_INVALID`, or any other
  // non-`CONFIRMATION_REQUIRED` `ok:false` code the engine can return before
  // a change set is ever computed (`InvokeUpgradeCommandFn`'s
  // `'resolution-failed'` status). `onChangeSet` is never invoked for this
  // status, so it is recognized by `commandResult.status` directly, never
  // inferred from the absence of a review package — that inference is what
  // used to fold this refusal into `'empty-changeset'` below. `code` is
  // relayed verbatim rather than flattened into `message`, mirroring
  // `UpgradeCommandJsonResult.code`'s own optionality: it is always present
  // for a real refusal, and only absent for an incomplete test double.
  | { status: 'resolution-failed'; code?: string; message: string }
  | { status: 'empty-changeset' }
  | { status: 'apply-failed'; message: string; lifecycleHistory: readonly OrchestrationLifecycleStateValue[] };

// @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-request-upgrade
/**
 * AI-driven upgrade orchestration: reads the project's single state document
 * and selects the NAMED template's entry to upgrade, drives the SINGLE F14
 * CLI change-set engine through its `frontx upgrade <templateName>
 * <new-origin>` command surface, enriches its output with change-impact
 * analysis and downstream-effect assessment, enforces an unconditional
 * review gate before any apply, and applies or declines
 * (cpt-frontx-flow-ai-upgrade-orchestration-upgrade).
 *
 * `appliedTemplateName` is the registered template's name as keyed in the
 * project's single state document's `templates` map (`inst-request-upgrade`)
 * — the developer either names it directly or the AI first lists the
 * registered templates from that document so one can be chosen.
 */
export async function orchestrateAiDrivenUpgrade(
  projectRoot: string,
  appliedTemplateName: string,
  targetVersion: string,
  deps: OrchestrationDeps,
): Promise<OrchestrationResult> {
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-request-upgrade

  const lifecycleHistory: OrchestrationLifecycleStateValue[] = [OrchestrationLifecycleState.PROVENANCE_READ];

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-read-provenance
  // Reads the project's single state document
  // (`cpt-frontx-contract-project-provenance`) — one document, keyed by
  // registered template name, never a per-target origin/version.
  const projectState = await deps.readProvenance(projectRoot);
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-read-provenance

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-provenance-unreadable
  if (!projectState) {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-unreadable
    return {
      status: 'project-invalid',
      code: 'PROJECT_INVALID',
      message: "The project's single state document (.frontx/project.json) is absent or unreadable — AI-driven upgrade cannot proceed.",
    };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-unreadable
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-provenance-unreadable

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-not-registered
  // Looks up the NAMED template's entry in the document's `templates` map;
  // absent when the document holds no matching entry for that name.
  const selectedEntry = selectTemplateEntry(projectState, appliedTemplateName);
  if (!selectedEntry) {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-not-registered
    return {
      status: 'template-not-registered',
      code: 'TEMPLATE_NOT_REGISTERED',
      message: `No "templates[${JSON.stringify(appliedTemplateName)}]" entry found in the project's single state document — AI-driven upgrade cannot proceed.`,
    };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-not-registered
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-not-registered

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-no-targets
  if (selectedEntry.targets.length === 0) {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-no-targets
    return {
      status: 'target-not-applied',
      code: 'TARGET_NOT_APPLIED',
      message: `"${appliedTemplateName}" is registered but its "targets" array is empty — no applied target to upgrade; AI-driven upgrade cannot proceed.`,
    };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-provenance-no-targets
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-no-targets

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-extract-provenance
  // Extract the SELECTED template's name, its current `origin`/`version`,
  // and every target listed under it from its `templates[name]` entry — the
  // command surface receives projectRoot/templateName/targetVersion and
  // resolves its own baseline internally when computing the change set;
  // this orchestration layer's extraction is what makes the enriched review
  // package reflect the SELECTED template, `targets` included.
  const selectedTemplate = {
    name: appliedTemplateName,
    origin: selectedEntry.origin,
    version: selectedEntry.version,
    targets: selectedEntry.targets,
  };
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-extract-provenance

  let reviewPackage: EnrichedReviewPackage | undefined;
  let sawEmptyChangeSet = false;

  // The target version's RESOLVED origin, rebased onto the origin this name
  // is currently recorded at. `inst-invoke-engine` asks for the resolved
  // origin, and the engine reads its second argument as a source-spec, so
  // the bare version this orchestration takes as input cannot travel there
  // unchanged (`resolveTargetOrigin`).
  const resolvedTarget = resolveTargetOrigin(selectedEntry.origin, targetVersion);
  if (!resolvedTarget.ok) {
    return { status: 'origin-unavailable', code: 'ORIGIN_UNAVAILABLE', message: resolvedTarget.message };
  }

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-invoke-enrichment
  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-invoke-engine
  // Invokes the engine via `upgrade <templateName> <new-origin>`, passing the
  // selected template's name and the target version's resolved origin
  // directly (§1.1) — so the engine validates the new origin against every
  // target listed under that name as one atomic unit, and neither layer can
  // name a template the other did not.
  const commandResult = await deps.invokeUpgradeCommand(
    projectRoot,
    appliedTemplateName,
    resolvedTarget.origin,
    async (changeSet: ChangeSet) => {
      // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-invoke-engine
      // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-receive-changeset
      const enrichment = enrichUpgradeChangeSet(changeSet, selectedTemplate);
      // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-receive-changeset

      if (enrichment.status === 'empty') {
        sawEmptyChangeSet = true;
        // The command surface still requires a decision; declining is a safe
        // no-op signal — the empty-changeset short-circuit below is what the
        // caller actually observes.
        return 'declined' satisfies ReviewDecision;
      }

      reviewPackage = enrichment.package;

      // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-analyzed
      lifecycleHistory.push(OrchestrationLifecycleState.ANALYZED);
      // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-analyzed

      // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-present-review
      const decision = await deps.presentEnrichedReview(reviewPackage);
      // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-present-review

      // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-reviewed
      lifecycleHistory.push(OrchestrationLifecycleState.REVIEWED);
      // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-reviewed

      return decision;
    },
  );
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-invoke-enrichment

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-changeset
  // Checked BEFORE the empty-changeset fallback below: a genuine refusal
  // from the command surface's first call (`CONTENT_CONFLICT`,
  // `TARGET_CONFLICT`, `PROJECT_INVALID`, ...) never invokes `onChangeSet`
  // either, so `reviewPackage` is `undefined` for it too — the exact same
  // shape a real no-op (`commandResult.status === 'noop'`) leaves behind.
  // Distinguishing them by `commandResult.status` here is what keeps a real
  // refusal from reaching the caller as "there is nothing to update."
  if (!commandResult.ok && commandResult.status === 'resolution-failed') {
    return {
      status: 'resolution-failed',
      code: commandResult.code,
      message: commandResult.message ?? 'The upgrade command surface refused to resolve a change set.',
    };
  }

  if (sawEmptyChangeSet || !reviewPackage) {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-empty-changeset
    return { status: 'empty-changeset' };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-empty-changeset
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-check-changeset

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-approve
  if (commandResult.status === 'applied') {
    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-engine-apply
    // The engine apply step (writing project files non-destructively) is
    // triggered by the command surface itself, strictly after the developer
    // approval this orchestration layer returned above — never before it.
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-engine-apply

    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-update-provenance
    // Provenance is updated to the newer template version inside the engine's
    // apply step, behind the command surface — cpt-frontx-dod-ai-upgrade-orchestration-single-engine.
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-update-provenance

    // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-applied
    lifecycleHistory.push(OrchestrationLifecycleState.APPLIED);
    // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-applied

    // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-applied
    return { status: 'applied', targetVersion, reviewPackage, lifecycleHistory };
    // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-applied
  }
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-approve

  if (commandResult.status === 'apply-failed') {
    return { status: 'apply-failed', message: commandResult.message ?? 'Engine apply failed.', lifecycleHistory };
  }

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-decline
  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-no-write
  // Decline or flagged incompatibility: the command surface's engine apply
  // step was never triggered, so no project files are written and the
  // project remains at its current version.
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-no-write

  // @cpt-begin:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-declined
  lifecycleHistory.push(OrchestrationLifecycleState.DECLINED);
  // @cpt-end:cpt-frontx-state-ai-upgrade-orchestration-lifecycle:p1:inst-to-declined

  // @cpt-begin:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-declined
  return { status: 'declined', reviewPackage, lifecycleHistory };
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-return-declined
  // @cpt-end:cpt-frontx-flow-ai-upgrade-orchestration-upgrade:p1:inst-gate-decline
}
