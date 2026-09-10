---
name: review-interface
version: 0.1.0
description: Review a generated or hand-built FrontX interface against the installed UI kit, semantic tokens, the bundle's composition patterns, responsive intent, accessibility, state completeness, and content hierarchy. Use after interface generation or when a quality-gate violation is suspected (inconsistent components or tokens, broken responsive behavior, missing states, or accessibility gaps). Return advisory findings and prioritized corrections; do not act as a release gate in v0.1.
---

# Review a FrontX interface

Review the actual implementation and rendered result when available. Prefer evidence over taste language.

## Establish the comparison basis

1. Read the installed UI kit documentation, `design-contract.json`, `quality-gates.json`, `review-rubric.json`, `component-state-matrix.json`, `guideline-index.json`, and only the detailed guidelines the index routes to the surface (routing rules below). Installed UI kit documentation wins when it conflicts with the bundle's contract or guidelines.
2. Identify the screen's primary job and expected composition pattern. If the job or pattern cannot be determined from the request and code, ask the requester to confirm it, or flag the assumed job/pattern as unconfirmed in the verdict.
3. Inspect the implementation for real component reuse; visual similarity alone is insufficient.
4. Inspect every available width and state. If a state is absent, report it as unverified rather than assuming success.

Route the guideline load through `guideline-index.json` (generated from each guideline's front matter — the canonical routing table): load every `core`-tier guideline, plus each `conditional` guideline whose `loadWhen` triggers match the surface under review. If no trigger matches, or the surface is ambiguous or spans several screen types, load all guidelines — routing may only ever narrow a confident match, never skip on doubt. Name the routing decision (loaded, skipped, matching trigger) in the verdict so wrong routing is reviewable.

Read only the routed guidelines; when the ui-kit
`llms.txt` or component docs are large, read section headings first and pull
full sections only for components in use. If any of `design-contract.json`,
`quality-gates.json`, `review-rubric.json`, `component-state-matrix.json`,
`guideline-index.json`, the
routed guidelines, or the installed ui-kit documentation cannot be found or
read, report **comparison basis unavailable** — naming the missing file and
how to supply it — and stop rather than reviewing without it.

The contract files (`design-contract.json`, `quality-gates.json`,
`component-state-matrix.json`, `layout-contract.json`, `review-rubric.json`)
live under this bundle's `reference-artifacts/` directory and the detailed
guidelines under `guidelines/`, siblings of `skills/` and `workflows/` (see
`extension.json` for the authoritative map).

Whoever composes a delegated prompt — including this agent when it delegates —
must hand the contract over explicitly: name the concrete paths of the
comparison basis — `design-contract.json`, `quality-gates.json`,
`component-state-matrix.json`, the relevant guidelines — and instruct the
reviewer to read them first. Findings produced without the basis are taste
language regardless of how precise they sound.

For spacing, alignment, and sizing findings, prefer measured evidence from the
rendered page (element rects, computed styles) over source reading whenever the
app is running: source shows each spacing intent separately, while the render
shows what they sum to — stacked margins, gaps, and reserved heights compose
into a single visual distance only measurement can check. When the app is
running, spacing/alignment findings must cite the measurement readout (e.g.
`getBoundingClientRect: toolbar left=20, title left=24`) alongside the
summary; when it is not running, tag the numeric claim `inferred-from-source`.

## Review order

1. **Blockers** — blocker IDs from `quality-gates.json`, checked first.
2. **System violations** — component, token, type, icon, radius, shadow and semantic-color inconsistencies.
3. **Layout and behavior** — grid, density, responsive transformations, interaction states, recovery, motion and accessibility.
4. **Hierarchy and data** — primary action, grouping, content order, chart/table meaning, evidence and redundant copy.
5. **Polish** — optical alignment, icon sizing, border ownership, truncation and microcopy.

Walk every named sub-item in each tier; `review-rubric.json` defines the scoring granularity.

These tiers map onto `review-rubric.json` as follows: Blockers → the blocker
gate IDs across all categories; System violations →
`system-components-tokens` + `color-typography-polish`; Layout and behavior →
`grid-density-responsive` + `interaction-accessibility` +
`states-feedback-recovery`; Hierarchy and data → `task-hierarchy-content` +
`data-display-evidence`; Polish → `color-typography-polish`.

Score the result with `review-rubric.json`, but never let the total hide a blocker.

## Output

Severity is exactly one of blocker, major, minor, as assigned by
`quality-gates.json`; blocker denotes priority for human triage, never an
automated gate.

Return:

- a one- to two-sentence verdict (pass, blockers present, or needs revision);
- blockers first;
- prioritized corrections with rule ID (`ruleId`), severity, location, evidence, impact, correction, and verification;
- score by rubric category;
- widths and states that were exercised and came back clean — cleanliness is a result, name it;
- unverified items that require the separate testing stage (`verify-interface` resolves these).

Use precise language such as `LAY-004 · 24 px gap where the installed compact-row token is 16 px`, not `spacing feels off`. Mark widths, states, motion and keyboard behavior unverified when they were not observed. Do not rewrite the interface unless the request includes implementation.

Evidence language, worked:

- Poor finding: `Spacing feels bad.` Better: `LAY-003 · getBoundingClientRect: toolbar left=20, title left=24 — project toolbar uses 20 px left inset while title and table use 24 px. This breaks the shared content edge. Change toolbar inset to the installed page inset token.`
- Poor finding: `Colors are ugly.` Better: `COL-002 · Open state uses warning orange although no risk is implied. Use neutral state text; reserve warning for review-required or degraded conditions.`

A full report follows the Output section shape end-to-end.

When the request does include implementation, no finding is resolved until the
fix has been observed rendered — re-measure the corrected spacing or alignment,
or re-run `verify-interface`, in the same round. If a finding is not resolved
after two correction rounds, stop iterating and report it as blocked with the
observed evidence. A fix verified only by type-check and lint is a hypothesis;
report it as applied-but-unverified if the rendered check cannot be run.

This output is advisory in v0.1: do not mark a build failed, modify CI, or
create a release gate. If asked to gate a build or block a merge on these
findings, decline that action, explain the advisory v0.1 scope, and still
return the findings for a human to act on.
