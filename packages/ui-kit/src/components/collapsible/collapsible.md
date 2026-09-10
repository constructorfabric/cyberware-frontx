# Collapsible

A single expandable/collapsible section. Wraps the Base UI Collapsible
primitives; open/close state, keyboard interaction, and the panel's
height-animation values come from Base UI. No variants — this is a
structural, single-purpose component.

Composition: `Collapsible` (root, holds open state) → `CollapsibleTrigger`
(a native `<button>`) → `CollapsibleContent` (the panel, unmounted while
closed unless `keepMounted` is set).

## When to use

- A single section a user can show/hide on demand — "Show more", an
  expandable filter panel, a details/summary-style block where you need
  more control over styling or animation than the native `<details>`
  element offers.

## When not to use

- A list of many mutually-exclusive or independently-expandable sections
  — use `Accordion`; this component is a single panel, not a group.
- A popup anchored to a trigger (menu, tooltip, popover) — `Collapsible`
  reflows the document in place; it does not portal or position content
  relative to the trigger.

## Props (kit level)

`Collapsible` (root): `open` / `defaultOpen`, `onOpenChange`, `disabled` —
see Base UI `Collapsible.Root`.

`CollapsibleTrigger`: all native `<button>` props; disabled forwards to
the native `disabled` attribute (unlike `Button`'s own `loading`
handling, there is no `focusableWhenDisabled` override here).

`CollapsibleContent`: `keepMounted` (keep the panel in the DOM while
closed, default `false`), `hiddenUntilFound` (hide via `hidden="until-found"`
so the browser's built-in page search can still expand it — overrides
`keepMounted`), `className` — merged after the kit class.

## Behavior

- The panel animates open/close by height, using Base UI's own measured
  content height (`--collapsible-panel-height`) rather than a fixed
  `max-height` — the transition always matches the content's real size,
  however tall it is.
- By default the panel is removed from the DOM entirely while closed (not
  just visually hidden) — pass `keepMounted` on `CollapsibleContent` to
  keep it mounted (e.g. so its inputs retain focus/state across toggles).
- `disabled` on the root suppresses the trigger's interaction; the trigger
  itself still renders (it isn't hidden), just inert.

## Examples

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@gears-frontx/ui-kit';

<Collapsible>
  <CollapsibleTrigger>What is included?</CollapsibleTrigger>
  <CollapsibleContent>Everything in the Pro plan, plus priority support.</CollapsibleContent>
</Collapsible>;

// Starts open, and stays mounted (state-preserving) while collapsed
<Collapsible defaultOpen>
  <CollapsibleTrigger>Advanced options</CollapsibleTrigger>
  <CollapsibleContent keepMounted>
    <input placeholder="Custom endpoint" />
  </CollapsibleContent>
</Collapsible>;
```

## Anti-patterns

- Do not nest interactive controls the user needs while the panel is
  closed inside `CollapsibleContent` without `keepMounted` — closed
  content is removed from the DOM by default and cannot hold focus or
  retain uncontrolled input state across a collapse.
- Do not reach for this component to build a menu or tooltip — it has no
  portal, no positioning, and no dismiss-on-outside-press; see
  `DropdownMenu`/`Tooltip`/`Dialog` for those patterns.
