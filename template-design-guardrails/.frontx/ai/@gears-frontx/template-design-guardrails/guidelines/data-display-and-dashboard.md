---
summary: Decision-first metrics, charts, tables, evidence routing, and dense-workbench rules.
tier: conditional
loadWhen:
  - table or workbench screens
  - dashboard or timeline screens
  - metrics, charts, or dense data display
---

# Standard: Data display, dashboards and dense workbenches

## Start with a decision

Every metric or table **MUST** answer one of these:

- What changed?
- Is action required?
- Where is the problem?
- Who owns the next step?
- What evidence supports the conclusion?

Remove metrics that do not affect a decision or provide a route to evidence.

## KPI anatomy

A KPI set uses one shared anatomy:

1. label;
2. primary value and unit;
3. timeframe or comparison basis;
4. delta or status when meaningful;
5. drill-down.

Numbers in a KPI family **MUST** share baseline, size and formatting. Do not place the primary value at a different vertical position in each widget.

## Charts

- Title states the metric, not the chart type.
- Time range and aggregation are visible.
- Axes, units, zero baseline and comparison basis are explicit when needed for correct interpretation.
- Hover detail also works by keyboard when points are interactive.
- Interactive charts provide a tabular or textual alternative.
- Direct labels are preferred to distant legends when space permits.
- Area fills should be translucent and subordinate to the line or points.
- Mark notable points, current value and target rather than leaving an unexplained shape.
- Do not use a donut when a simpler proportion bar or count communicates the decision more directly.

## Status distributions

- Segmented bars use proportional lengths, thin geometry and small gaps or no gaps according to the installed pattern.
- Legend order matches segment order.
- Legend values align and use the same number format.
- The overall total and denominator are visible.
- Avoid thick rounded segments that resemble unrelated pills.

## Source or system health

- Show the total healthy/total count once.
- Align source name, state and last update in stable columns.
- Preserve the last trustworthy sync value on failure.
- Use a small semantic cue plus state text; do not invent a unique icon for every source.

## Delivery and timelines

- Milestones share one horizontal scale.
- Completed, current, blocked and future states have consistent geometry and semantic cues.
- Labels align to milestones and do not float independently from their markers.
- A blocked gate names the blocker and owner; a future gate names its condition or date.
- Gantt-like views **MUST** expose the time scale, today marker, dependencies when shown and a non-drag alternative for changes.

## Tables

- Keep the primary entity and state scan-friendly.
- Put type beneath the primary label when a separate type column creates conflict or width pressure.
- Use plain status text with a small dot where a chip adds unnecessary visual weight.
- Move long evidence to an inspector; keep a concise evidence link or count in the row.
- Prefer taller readable rows over tiny type and crowded columns.
- Column headers align with cell content.
- Pagination is mandatory when the shown range is smaller than the result set.

## Dashboard grid

- Default to two widget widths: half and full.
- Use thirds only for parallel KPI cards with identical anatomy.
- Equal-width widgets in the same row **MUST** share height and internal baselines.
- A full-width widget is reserved for a relationship, sequence, table or issue list that benefits from width.
- Empty space inside a widget is a signal to reduce the widget span or improve the information, not to add decoration.

## Data honesty

- No score without a formula or route to its components.
- No trend without timeframe and comparison basis.
- No status without threshold or evidence.
- No precision that the source does not support.
- Partial, stale and estimated data **MUST** be marked explicitly.

