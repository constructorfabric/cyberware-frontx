# Accordion

A vertically stacked set of headers that expand to reveal associated
content. Wraps the Base UI Accordion primitives; keyboard navigation
between triggers, ARIA expanded/controls wiring, and (by default)
single-item expansion come from Base UI.

Composition: `Accordion` (root, holds open state) → one or more
`AccordionItem` (each identified by `value`) → `AccordionTrigger` (renders
the header button plus a rotating chevron) → `AccordionContent` (the
height-animated panel).

## When to use

- A list of independent sections (FAQ, settings groups) where showing all
  of them at once would be too much, and the user opens what's relevant.

## When not to use

- A single show/hide toggle for one piece of content — reach for a plain
  conditional render, or `collapsible` once the kit ports it; an accordion
  implies more than one section.
- Primary navigation — use `tabs`.

## Props (kit level)

`Accordion` (root): `value` / `defaultValue` (array of open item values),
`onValueChange`, `multiple` (allow more than one item open at once,
`false` default — the default is single-expansion: opening one item closes
any other open item), `disabled`, `hiddenUntilFound` (lets the browser's
in-page search find and expand closed panels), `keepMounted` — see Base UI
Accordion.Root.

`AccordionItem`: `value` (unique identifier, required to control/default
which item is open), `disabled`.

`AccordionTrigger` and `AccordionContent` take no kit-level props beyond
`className` — they render the header/trigger button and the animated panel
respectively; `AccordionTrigger` always renders a chevron, matching
upstream (no prop to hide it).

## Examples

```tsx
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@gears-frontx/ui-kit';

<Accordion>
  <AccordionItem value="item-1">
    <AccordionTrigger>Is it accessible?</AccordionTrigger>
    <AccordionContent>Yes. It adheres to the WAI-ARIA design pattern.</AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger>Is it styled?</AccordionTrigger>
    <AccordionContent>Yes, with the kit's own tokens.</AccordionContent>
  </AccordionItem>
</Accordion>;
```

## Panel height animation

`AccordionContent` animates open/close by transitioning `height` between
`0` and Base UI's own `--accordion-panel-height` custom property (a live,
`ResizeObserver`-backed measurement of the panel's content, written on the
`Accordion.Panel` element) — the standard technique for animating to an
otherwise-unknowable `auto` height. `prefers-reduced-motion: reduce` turns
the transition off; the panel still opens and closes, just without the
grow/shrink animation.

**Known gap:** `--accordion-panel-height` is not currently listed in
`src/tokens.test.ts`'s `BASE_UI_RUNTIME_VARS` exemption set, unlike the
positioner vars (`--anchor-width`, `--transform-origin`, ...) the kit's
other overlays already consume. It should be added there — the guard test
scans every component module for undeclared `var()` usage and this one is
a genuine Base UI runtime variable, not a themeable token, so it belongs in
the exemption list rather than theme.css.

## Anti-patterns

- Do not put interactive form controls that must always be visible (a
  required field the user might miss) inside a collapsed panel — a screen
  reader user tabbing through the page won't discover it until they choose
  to expand that section.
- Do not nest an `Accordion` inside another `Accordion`'s panel for a
  "sub-section" effect without checking `value` uniqueness across both —
  Base UI scopes keyboard navigation to the nearest `Accordion.Root`, but
  `value`s are only unique within one root.
