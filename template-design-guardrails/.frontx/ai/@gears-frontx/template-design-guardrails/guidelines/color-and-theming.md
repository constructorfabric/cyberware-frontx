---
summary: Color roles, theming, contrast pairing, and visualization palettes.
tier: conditional
loadWhen:
  - dashboard or timeline screens
  - theme creation or modification
  - charts or visualization palettes
  - custom status or severity colors
---

# Standard: Color, theming and visualization palettes

## Color has a job

Every non-neutral color **MUST** perform one of these jobs:

- action or selection;
- semantic status;
- informational categorization;
- data-series differentiation;
- brand identity in a bounded area.

If a color has no named job, remove it.

## Semantic hierarchy

- Primary text carries essential meaning.
- Secondary text carries supporting metadata.
- Muted text **MUST NOT** contain the only explanation of an error, action or state.
- Surfaces establish hierarchy with small luminance steps — adjacent surfaces in the same hierarchy differ by at most one step of the installed surface-token scale (e.g. background → surface → surface-elevated); avoid a patchwork of tinted cards.
- Borders should be quieter than text but still meet non-text contrast when they define a control or state.
- Accent is scarce. One selected item plus one primary action should not create five competing purple regions.

## Status usage

- success: completed, passed, synced or healthy — not merely enabled;
- warning: degraded, waiting or needs review;
- danger: failed, blocked, destructive or unsafe;
- info: detected, neutral progress or external observation;
- neutral: open, unchanged, not started, ordinary metadata, borders and disabled treatment when no risk is implied.

An open state **MUST NOT** appear warning-colored unless being open is itself risky.
Status colors **MUST** be paired with concise text or a familiar icon. Brand/accent
color **MUST NOT** be reused as a semantic error or warning color.

## Selection versus status

- Selection uses accent surface/border/text tokens; accent means primary action,
  active selection and authored emphasis.
- Status uses semantic tokens.
- A selected failed row uses a quiet selection surface while the failure remains a small danger cue; do not flood the full row red or purple.
- Hover, selected, focused and status states **MUST** remain visually distinguishable in combination.

## Light and dark themes

- Theme output **MUST** preserve semantic roles, not literal RGB relationships.
- Recheck text, non-text and focus contrast in each theme.
- Dark mode **MUST** use `color-scheme: dark` when appropriate so browser controls match.
- Saturated colors usually need reduced area and adjusted luminance in dark mode.
- Images, charts, shadows, disabled states and code blocks **MUST** be reviewed in both themes when both are supported.

## Data visualization

- Use semantic colors only for semantic series. Ordinary categories use a color-blind-safe categorical palette.
- A chart **MUST NOT** require color alone: add labels, direct annotation, shape, pattern or a usable legend.
- Use one palette and ordering for the same metric family across screens.
- Lines and points **MUST** remain visible against the plot and grid.
- Avoid rainbow scales for ordered data. Use sequential or diverging scales with a named midpoint.
- Do not use red/green as the only contrast between two series.

## Forbidden patterns

- gradients without a product role;
- saturated status chips for every ordinary state;
- decorative colored icons that compete with data;
- blue links in a product whose action/link token is purple;
- gray text below contrast requirements;
- opaque chart fills that dominate content;
- color combinations chosen independently per widget.

