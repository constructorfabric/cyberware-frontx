// @cpt-algo:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-flow-complete:p1
// @cpt-dod:cpt-frontx-dod-ai-upgrade-orchestration-single-engine:p1
//
// PLAN CORRECTION (2026-07-14) — REOPENED: this module no longer invokes the
// F14 engine directly (that would require importing the CLI package,
// forbidden by DESIGN §3.4 / ADR-0027). The engine is invoked, through the
// `frontx upgrade` command/invocation surface, by `orchestrate.ts`
// (inst-extract-provenance / inst-invoke-engine), which passes the raw
// change set the command surface computed into this module's pure
// enrichment step (inst-receive-changeset onward) — a plain function with no
// engine dependency of its own.
import type {
  ChangeSet,
  ChangeImpactAnalysis,
  ChangeImpactEntry,
  DownstreamEffectAssessment,
  EnrichmentResult,
  SelectedTemplate,
} from './types.js';

// @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-impact-analysis
/**
 * Change-impact analysis: which project files are affected, what kind of
 * change each represents, and whether it requires developer attention before
 * apply (a conflict against local developer modifications always does).
 */
export function computeChangeImpact(changeSet: ChangeSet): ChangeImpactAnalysis {
  const entries: ChangeImpactEntry[] = [
    ...changeSet.clean.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      requiresAttention: false,
    })),
    ...changeSet.conflicts.map((entry) => ({
      path: entry.path,
      kind: entry.templateKind,
      requiresAttention: true,
    })),
  ];
  return { entries };
}
// @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-impact-analysis

// @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-downstream-assess
/**
 * Downstream-effect assessment: surfaces incompatibilities between the
 * proposed template change set and the project's local modifications, so the
 * developer can decline at the review gate rather than discover them post-apply.
 */
export function computeDownstreamEffects(changeSet: ChangeSet): DownstreamEffectAssessment {
  const incompatibilities = changeSet.conflicts.map(
    (conflict) =>
      `Local modification at "${conflict.path}" conflicts with the template's ${conflict.templateKind} change — manual reconciliation is required.`,
  );
  return { incompatibilities };
}
// @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-downstream-assess

/**
 * Enriches an already-computed change set (received from the `frontx
 * upgrade` command surface, cpt-frontx-algo-ai-upgrade-orchestration-enrich
 * `inst-receive-changeset`) with change-impact analysis and downstream-effect
 * assessment, combined against the SELECTED template's name, current
 * `origin`/`version`, and every target listed under it (extracted by the
 * caller from that template's `templates[name]` entry,
 * `inst-extract-provenance`) so the resulting review package reflects the
 * SELECTED template, not any other entry in the project's single state
 * document. Contains no engine logic of its own — it is a pure function over
 * the change set the SINGLE F14 engine produced
 * (cpt-frontx-dod-ai-upgrade-orchestration-single-engine).
 */
export function enrichUpgradeChangeSet(changeSet: ChangeSet, selectedTemplate: SelectedTemplate): EnrichmentResult {
  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-check-empty
  if (changeSet.clean.length === 0 && changeSet.conflicts.length === 0) {
    // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-empty-signal
    return { status: 'empty' };
    // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-empty-signal
  }
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-check-empty

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-impact-analysis
  const impactAnalysis = computeChangeImpact(changeSet);
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-impact-analysis
  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-downstream-assess
  const downstreamAssessment = computeDownstreamEffects(changeSet);
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-downstream-assess

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-combine-results
  const enriched = { selectedTemplate, changeSet, impactAnalysis, downstreamAssessment };
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-combine-results

  // @cpt-begin:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-return-enriched
  return { status: 'enriched', package: enriched };
  // @cpt-end:cpt-frontx-algo-ai-upgrade-orchestration-enrich:p1:inst-return-enriched
}
