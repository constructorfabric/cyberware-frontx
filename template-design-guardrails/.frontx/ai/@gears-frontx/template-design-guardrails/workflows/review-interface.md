# Workflow: Review a FrontX interface

Use with `review-interface` after generation or on an existing screen.

Advisory only; never a release gate — see final paragraph.

1. Read the installed UI kit documentation, `reference-artifacts/design-contract.json`, `reference-artifacts/quality-gates.json`, `reference-artifacts/review-rubric.json`, and `reference-artifacts/component-state-matrix.json`. If any of these cannot be found or read, report **comparison basis unavailable** — naming the missing file and how to supply it — and stop rather than proceeding on assumptions. If the review target or scope is ambiguous in a way that changes which files or states are evaluated, ask the requester; otherwise state the assumption made.
2. Identify the screen job and expected composition. If the job or pattern cannot be determined from the request and code, ask the requester to confirm it, or flag the assumed job/pattern as unconfirmed in the verdict.
3. Inspect code for UI kit imports, semantic HTML, token use, real component reuse, and interaction states.
4. Inspect the rendered screen at available widths. Do not claim widths or states that were not observed.
5. Apply the five-tier review order from the `review-interface` skill (blockers, system violations, layout and behavior, hierarchy and data, polish); within each tier, record gate IDs at their severities using the finding shape from `quality-gates.json`.
6. Score every rubric category using observed evidence only.
7. Mark unavailable widths, states, keyboard behavior, motion and automation as unverified.
8. For implemented fixes, do not mark a finding resolved until the fix was re-observed rendered or re-verified via `verify-interface` in the same round; otherwise label it applied-but-unverified. Route contrast, tiny-text, control-height, and horizontal-scroll checks through `verify-interface` before finalizing the correction list. If a finding is not resolved after two correction rounds, stop iterating and report it as blocked with the observed evidence.
9. Return a correction list in implementation order and a verification step for each correction. Return shape: the skill's `## Output` section is the full contract — this step is its condensed form.

The v0.1 review is advisory. Do not mark a build failed, modify CI, or create a release gate. Automated browser, accessibility, screenshot, and regression checks are a separate testing-stage responsibility. If asked to gate a build or block a merge on these findings, decline that action, explain the advisory v0.1 scope, and still return the findings for a human to act on.
