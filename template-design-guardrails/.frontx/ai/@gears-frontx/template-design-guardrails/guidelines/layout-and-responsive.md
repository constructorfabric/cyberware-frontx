---
summary: Spacing system, grid ownership, width tiers, and wide/medium/narrow region transformations.
tier: core
---

# Standard: Grid, layout and responsive behavior

## Spatial system

This section is the single guideline-layer home of the spacing system; the machine-readable values live in `layout-contract.json`.

- The installed spacing tokens are authoritative: the shell ships Tailwind's 4 px base scale with an 8 px primary rhythm.
- Preferred values are `4, 8, 12, 16, 20, 24, 32` px — the kit's `--space-*` scale; larger region gaps compose from these (e.g. 2 × 24 px).
- Use 4 px only for optical correction, icon proximity and dense internal component gaps. Use 8 px multiples for page and pattern structure.
- Use 4–8 px within a compact control, 8–16 px between related fields or row content, 16–24 px between pattern groups and 24–32 px between page regions.
- A bounded container — a card, a bordered or shadowed row, any element that draws its own edge — **MUST** carry internal padding on the sides it draws: 4 px is the floor, 12–24 px the normal range. Content ink (text, a checkbox, an icon) never sits flush against a drawn edge. The one exemption is a full-bleed media card, where an image or video deliberately spans the container's full width; any non-media content in that card is still padded. The runtime checker measures this as `card-missing-padding`.
- A spacing utility class **MUST** actually resolve to a CSS rule in the running app. In a host-composed setup (MFE sources styled by the host's Tailwind build) a class the build never scanned matches nothing and renders flush while the source reads correct — verify spacing in the rendered app, never by reading class names. The runtime checker measures this as `dead-spacing-class`.
- Negative margins **SHOULD NOT** correct structural alignment. Use grid ownership or an explicit optical token.
- Do not create adjacent gaps that differ by only 1–3 px unless correcting a documented optical alignment.

## Page regions before components

Define these regions before placing cards:

1. application shell;
2. primary navigation;
3. optional contextual navigation;
4. page header and actions;
5. toolbar or filters;
6. main task surface;
7. optional inspector or secondary context;
8. table or page footer.

One parent **MUST** own each divider, border and inset. Adjacent children **MUST NOT** draw doubled borders.

## Alignment contract

- Page title, toolbar, primary content and footer **MUST** share a content inset.
- Repeated items **MUST** share column starts, baselines and action alignment.
- Icons align to the optical center of the control; text aligns to text baselines, not icon geometry.
- A selected-row marker **MUST NOT** change row geometry.
- Numeric columns follow the typography guideline's tabular-numeral rule and **SHOULD** use right alignment when comparison is the job.
- Labels and values **MUST NOT** drift between cards in the same family.

## Fallback grid

Use the host grid when it exists. Otherwise:

- wide: 12 columns, 24 px gutters, 32 px outer margins;
- medium: 8 columns, 20 px gutters, 24 px outer margins;
- narrow: 4 columns, 16 px gutters, 16 px outer margins.

These are starting values, not fixed breakpoints. Breakpoints **MUST** occur when content fails, not because of a device name.

## Width and sizing rules

- Prefer two reusable content spans: full and half. Dashboard widget widths are defined in the data-display guideline's dashboard grid.
- Text measure for prose follows the typography minimums in the visual-foundations guideline (approximately 45–75 characters per line).
- Forms **SHOULD** use a readable content width rather than stretching fields across the viewport.
- Inspectors **MAY** be persistent on wide layouts, overlay on medium layouts and become a full-height layer or separate route on narrow layouts.
- Dashboards **MUST** use a documented widget grid. Do not make every widget a new size.

## Responsive transformation, not scaling

Define at least three content-driven states:

### Wide

- persistent primary navigation;
- optional secondary navigation and inspector;
- multi-column content where comparison is useful.

### Medium

- collapse or overlay secondary navigation first;
- reduce low-value columns before narrowing the primary entity;
- move tertiary actions to a labeled overflow menu;
- keep the page job and primary action visible.

### Narrow

- use one primary reading and action flow;
- stack parallel regions in decision order;
- convert an inspector to a full-height layer or route;
- use an approved compact list when a data table cannot reflow, otherwise preserve table semantics with local horizontal scrolling;
- remove sticky positioning if it obscures focused or readable content.

The same transformation, region by region:

| Region | Wide | Medium | Narrow |
| --- | --- | --- | --- |
| Navigation | persistent primary navigation | secondary navigation collapses or overlays first | one primary reading and action flow |
| Secondary content / columns | multi-column content where comparison is useful | low-value columns reduce before the primary entity narrows | parallel regions stack in decision order |
| Inspector | optional persistent secondary navigation and inspector | overlay inspector | inspector becomes a full-height layer or route |
| Actions | — | tertiary actions move to a labeled overflow menu; page job and primary action stay visible | sticky positioning is removed if it obscures focused or readable content |
| Table / list | full data table | reduce low-value columns before narrowing the primary entity | approved compact list when the table cannot reflow, otherwise table semantics with local horizontal scrolling |

The Inspector row follows the width and sizing rules above; the other rows restate the Wide/Medium/Narrow bullets.

## Overflow and long content

- Ordinary page content **MUST NOT** cause horizontal page scrolling at 320 CSS px, except genuinely two-dimensional content such as a data grid or timeline. This is the owning statement of the 320 px reflow rule (LAY-002); the accessibility guideline defers to it.
- Truncation rules (including the keyboard-accessible reveal) are defined in the typography guideline's truncation section.
- Actions and statuses **MUST NOT** be clipped.
- Menus, dialogs, popovers and tooltips **MUST** stay inside the viewport and remain reachable at zoom.
- Loading content **SHOULD** reserve final geometry to avoid layout shifts (the geometry-reservation rule).

## Density acceptance

- Equal controls use equal heights.
- Repeated rows use one vertical rhythm.
- Icon-to-label gap defaults to 8 px unless the kit defines another value.
- Pointer targets meet the accessibility guideline's 24 × 24 CSS px minimum; use 40–44 px for primary touch controls when the product density permits.
- Do not solve pressure by shrinking body text, replacing meaningful labels with ambiguous icons or making hit targets smaller.

## Layout rejection examples

Reject a layout when:

- page regions use unrelated insets;
- equal widgets have different anatomy;
- blank cards exist only to balance a grid;
- a desktop composition is uniformly scaled down;
- a responsive state changes reading order without changing DOM or keyboard order;
- a floating panel hides the focused control;
- every card, row or field invents its own padding.

