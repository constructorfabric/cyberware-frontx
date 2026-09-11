---
summary: Required anatomy, states, keyboard behavior, and token mapping for interactive components.
tier: conditional
loadWhen:
  - form or authentication screens
  - table or workbench screens
  - overlay, inspector, or master-detail screens
  - custom interactive controls beyond ui-kit defaults
---

# Standard: Component anatomy and interaction

## Component rule

Every interactive component requires:

1. semantic role and accessible name;
2. stable anatomy;
3. default, hover, active/pressed, focus-visible and disabled behavior;
4. selected, loading, error, read-only or expanded states when applicable;
5. keyboard behavior;
6. token mapping;
7. density and responsive behavior.

Use `component-state-matrix.json` as the minimum inventory. Keyboard and focus mechanics of kit components (composite-widget key models, focus trap and return, Escape, `aria-expanded` wiring) are kit-guaranteed while the component is used unmodified — do not restate or reimplement them; `verify-interface` observes the rendered result.

## Buttons and links

- Use a button for an action and a link for navigation.
- One region has at most one primary button — the foundations guideline's one-dominant-action rule applied to buttons.
- Destructive actions **MUST** use danger semantics and confirmation proportional to consequence.
- Loading buttons preserve width, accessible name and status.
- Disabled controls **SHOULD** explain why when the reason is not obvious.

## Inputs and selection controls

- Labels remain visible after input.
- Placeholder is example content, not a label.
- Error, help and character-count content share one reserved message region.
- Search fields use search semantics and a clear control when clearing is useful.

## Menus, popovers, dialogs and inspectors

- A dialog is for a bounded decision, not a substitute for a full page.
- An inspector keeps list context and displays detail for the selected entity; its selection **SHOULD** be URL-addressable when routing exists.
- Overflow menus hold tertiary actions, not the only route to a common primary task.

## Tabs and navigation

- Tabs switch views within the same scope; navigation changes location or hierarchy.
- The selected tab is visually and programmatically distinct.
- Do not duplicate the same destination in tabs and local navigation without a documented reason.

## Tables and data grids

- Use a semantic table for read-oriented tabular data.
- Use an interactive grid only when cell-level keyboard navigation is genuinely required.
- Sorting belongs in the column header with a directional icon adjacent to the label and `aria-sort` on the sorted header.
- Column controls belong in the table header region, not as a large page action.
- Selection, hover, focus and status **MUST** remain distinguishable.
- Pagination belongs in the table footer and states range, total and current page.
- Row actions use one consistent overflow pattern; frequent primary actions may be visible.

## Cards and widgets

- A card exists only when its boundary creates a meaningful group or interaction target.
- Cards in a family share title, value, supporting content and action baselines.
- A widget declares title, metric basis, timeframe, state, visualization and drill-down as applicable.
- Do not nest cards for decoration.

## Feedback components

- Inline validation stays with the field.
- Banners carry page- or section-level consequences.
- Toasts confirm transient non-blocking outcomes.
- Progress indicators name the operation and expose completion or failure.

## State combination check

Review at least these combinations where applicable:

- selected + hover;
- selected + focus-visible;
- selected + error/status;
- disabled + tooltip/reason;
- loading + cancellation;
- stale + partial data;
- narrow viewport + open overlay;
- zoom + sticky/floating content.

The same combinations, restated as a matrix:

| State | Paired with |
| --- | --- |
| selected | hover, focus-visible, error/status |
| disabled | tooltip/reason |
| loading | cancellation |
| stale | partial data |
| narrow viewport | open overlay |
| zoom | sticky/floating content |

