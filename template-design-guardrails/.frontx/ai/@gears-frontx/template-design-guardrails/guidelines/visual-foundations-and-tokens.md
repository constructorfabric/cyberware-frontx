---
summary: Token policy and layers, elevation, density, and type minimums governing every visual value.
tier: core
---

# Standard: Visual foundations and tokens

## Token policy

- Installed product tokens are authoritative and are the only token source; the bundle ships no fallback token set. This section is the single guideline-layer home of the token-sourcing policy.
- All visual values **MUST** resolve to an installed token or a value derived from one (for example via `color-mix`). A missing semantic role is a gap to record for the UI-kit owner, not a license to invent a value. Layout constraints come from `layout-contract.json`.
- Generated code **MUST** reference the installed semantic tokens such as `var(--foreground)` or the Tailwind utility mapped to them (`text-foreground`), not literal values or palette steps.
- Primitive palette values **MAY** exist inside the theme implementation; application code **MUST NOT** depend on them directly.
- Tokens **MUST** use a stable name, value, type and description. Alias semantic tokens to foundations rather than duplicating values.
- A theme change **MUST NOT** require changing component markup.

## Token layers

Use three layers:

1. **Foundation** — raw color, dimension, font, radius, shadow and motion values.
2. **Semantic** — text, surface, border, action, focus, status and layout roles.
3. **Component** — only when a component requires a stable role not expressible by semantic tokens.

Do not introduce component tokens simply to preserve accidental CSS values.

## Spacing

The spacing system (4 px base, 8 px primary rhythm, the installed step scale and its usage bands) is defined once, in the layout guideline's spatial system; the complete list of permitted steps is `spacingScalePx` in `layout-contract.json`, and no other value is a spacing step. Apply it, do not restate it.

## Typography roles

Use the installed type ramp, mapped to these roles rather than arbitrary sizes:

- display: rare product or empty-state emphasis;
- page title;
- section title;
- component title;
- body;
- label;
- supporting metadata;
- code/machine metadata.

The installed ramp is the authority on sizes: the kit's `--text-*-size` tokens (body, label, meta, mono, and the heading and display steps) are the only text sizes, and a screen built from those roles is correctly sized by construction. Floors, stated as roles rather than pixels so they cannot drift from the tokens:

- body copy: the body role, never label or smaller;
- controls, actions, navigation items and form labels: the label role or larger — the label size is the smallest text the kit ships on anything interactive;
- supporting metadata: the meta role, never for primary actions or essential explanations;
- code and machine metadata: the mono role, and nothing visible is ever smaller than it;
- line height: at least 1.4 for body copy and 1.2 for headings;
- paragraph width: approximately 45–75 characters.

Roles do not step down at narrow widths: a control that is label-sized at the wide tier is label-sized at 320 px too, and the reduced viewport is met with layout (stacking, wrapping, collapsing auxiliary regions), never with smaller text. The runtime checker enforces the last two floors at every width the verification matrix sweeps: `tiny-text` for visible text below the mono size and `small-control-text` for interactive text below the label size, both read from the installed tokens rather than hard-coded.

Typography **MUST** communicate hierarchy without depending on many unrelated font sizes or weights.

## Radius and shape

- Radii come from the installed kit; local composition reuses the kit's radius steps rather than introducing new values. Reserve the largest step for large containers.
- Nested radii **MUST** be concentric: child radius cannot exceed its parent and should account for the parent padding.
- Do not turn every control into a pill. Reserve full radius for tags, status chips, avatars and compact segmented controls.

## Borders and elevation

- Use borders for grouping and elevation for overlap or hierarchy, not both at maximum contrast.
- One surface should own the boundary between adjacent regions.
- Shadows use two layers: a soft ambient layer and a tighter key layer.
- Elevation **MUST NOT** be used as decoration on ordinary in-flow cards.
- Dark themes require tuned shadow, border and surface tokens; do not invert light colors mechanically.

## Icons

- Use one installed icon family.
- Standard sizes: 16 px for controls in compact density, 20 px for ordinary controls, 24 px for navigation or standalone actions.
- Icon stroke/fill style **MUST** remain consistent within a region.
- Text characters, emoji and improvised SVGs **MUST NOT** replace standard UI icons.
- Icons **SHOULD** accompany labels; icon-only controls require strong convention and must satisfy the accessibility guideline's naming and tooltip rules.

## Token rejection examples

Reject:

- `#7c3aed`, `18px`, `13px` and `border-radius: 11px` scattered through feature code;
- Tailwind arbitrary values that bypass existing tokens;
- semantic statuses mapped directly to brand colors;
- a second shadow or radius system introduced by a generated page;
- inline styles that cannot respond to theme or density changes.

