# Sheet

An edge-anchored panel for a focused task, form, or detail view without
leaving the current page context. Wraps the same Base UI Dialog primitives
`Dialog` does; the panel is portalled, focus trapping, page-scroll locking,
and Escape/outside-press dismissal come from Base UI. Base UI does **not**
supply a touch-screen-reader escape hatch on its own — when `modal` is
`true` (the default) or `'trap-focus'`, its own docs require the consumer
to render a `Dialog.Close` inside `Dialog.Popup` for that. The kit satisfies
this by having `SheetContent` render a close button by default
(`showCloseButton`, see below).

Composition: `Sheet` (root, holds open state) → `SheetTrigger` →
`SheetContent` (portals `SheetHeader` / `SheetFooter` / `SheetTitle` /
`SheetDescription` / consumer content, anchored to one of four edges via
`side`) → optional `SheetClose` for a consumer-composed close action (e.g.
a footer "Cancel" button).

## When to use

- A focused task, form, or detail view that benefits from staying anchored
  to a screen edge instead of centered and floating over the page (a
  filter panel, a record's detail view, a multi-field form).
- Content the user must read or decide on before continuing, where the
  edge-anchored motion better fits a "slide-in panel" mental model than
  `dialog`'s centered pop-up.

## When not to use

- A centered, page-blocking confirmation or short prompt — use `dialog`.
- Passive information that does not need to block the page — a sheet is
  modal by default; if it genuinely must not block, pair `modal={false}`
  on the root with `showBackdrop={false}` on `SheetContent` (one without
  the other still blocks: `modal` alone leaves the backdrop covering and
  click-closing over the page).
- Menus of actions anchored to a trigger — use `dropdown-menu`.
- Single-line contextual hints — use `tooltip`.

## Props (kit level)

`Sheet` (root): `open` / `defaultOpen`, `onOpenChange`, `modal` (`true`
default; `false`; `'trap-focus'`) — see Base UI Dialog.Root.

`SheetContent`:

| Prop | Type | Default |
|------|------|---------|
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` — which viewport edge the panel is anchored to | `'right'` |
| `showCloseButton` | `boolean` — renders a top-right close (X) button | `true` |
| `showBackdrop` | `boolean` — renders the dimming backdrop; set `false` together with `modal={false}` on the root for a genuinely non-modal sheet | `true` |
| `closeLabel` | `string` — accessible name for that button, the panel's only kit-authored text; same contract as `Dialog`'s `closeLabel` | `'Close'` |
| `container` | DOM node to portal the panel into | `<body>` |
| `initialFocus` / `finalFocus` | `boolean \| RefObject \| function` — see Base UI Dialog.Popup | default focus behavior |
| `className` | `string` — merged after the kit class | — |

Setting `showCloseButton={false}` removes the only built-in escape hatch
touch screen reader users have out of a modal sheet (see above) — only do
this if you compose your own `SheetClose` somewhere inside `SheetContent`
(e.g. in the footer).

The panel portals to `<body>` by default, so if your theme lives on a
subtree (`data-theme` on a section instead of `<html>`), pass that section
as `container` or the panel renders with the root theme.

`SheetTrigger` and `SheetClose` are unstyled pass-throughs (native
`<button>` semantics) — compose them with `Button` via their `render` prop
for a styled trigger or close action, same as the built-in close button
does internally.

## Side variants

`side` picks one of four edge anchors, each with its own sizing and slide
direction:

- `top` — full width, height sized to content (capped and scrollable past
  the viewport), slides down from above.
- `right` (default) — full height, 75% width capped at `24rem` from the
  640px breakpoint up, slides in from the right.
- `bottom` — full width, height sized to content (capped and scrollable
  past the viewport), slides up from below.
- `left` — full height, 75% width capped at `24rem` from the 640px
  breakpoint up, slides in from the left.

Every variant is square — the kit's Sheet does not round any corner,
matching the upstream source (unlike `Dialog`'s fully-rounded, centered
popup, an edge-anchored panel has no corner that reads as "inner").

## Examples

```tsx
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gears-frontx/ui-kit';

<Sheet>
  <SheetTrigger render={<Button variant="outline" />}>Edit profile</SheetTrigger>
  <SheetContent side="right">
    <SheetHeader>
      <SheetTitle>Edit profile</SheetTitle>
      <SheetDescription>
        Make changes to your profile here. Click save when you're done.
      </SheetDescription>
    </SheetHeader>
    <SheetFooter>
      <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
      <Button onClick={handleSave}>Save changes</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

## Wide content

`SheetContent` lays its children out as a single-column grid, and the
column's minimum width is floored at zero — so content wider than the
panel overflows *inside* it rather than stretching the panel past its
side's width. Same contract as `Dialog`'s: a wide child (a `Table`, a
`<pre>` code block, a long unbroken string, an image) needs its own
horizontal scroll container or should wrap; see `dialog.md`'s "Wide
content" for the full reasoning.

## Scrolling content

`SheetHeader` and `SheetFooter` are `position: sticky` (top / bottom) with
an opaque background matching the panel, by default. That covers two
shapes:

- A consumer-wrapped middle region (`overflow-y: auto` on a child div
  between header and footer) - the panel itself never needs to scroll, so
  the sticky positioning is inert and simply does nothing.
- Long content dropped in unwrapped (as in the "Scrollable content"
  example) - `SheetContent`'s own `overflow-y: auto` becomes the scroll
  container (see "Wide content" above for the matching horizontal case),
  and header/footer stay pinned at the top/bottom of it, masking whatever
  scrolls underneath. No inline `background` or `position` prop needed on
  `SheetFooter` for this - it is the built-in behavior, same contract as
  `Dialog`'s (see `dialog.md`'s "Scrolling content").

For the mask to be complete, `SheetContent` itself carries no padding: the
inset lives on its direct children instead (side inset on every child, top
inset on the first, bottom inset on the last), so header and footer span
the panel's full width and reach its top and bottom edges. Padding on the
scroll container would have left strips that no sticky region can cover -
see `dialog.md`'s "Scrolling content" for the mechanism. Consequence when
styling children: a `className` that sets `padding` on a region overrides
the inset (same single-class weight) rather than adding to it, and a
full-width child reaches the panel edges by zeroing its `padding-inline`.

## Anti-patterns

- Do not nest interactive page content's focus expectations across the
  backdrop — modal mode (the default) already traps focus and moves it
  in/out on open/close; use `initialFocus` / `finalFocus` on
  `SheetContent` if you need to redirect it, don't fight it with manual
  focus management (imperative `.focus()` calls in effects).
- Do not omit `SheetTitle` — Base UI's accessibility tree needs it even
  if it is visually hidden via `className`; do not delete it for a
  "cleaner" look.
- Do not use `Sheet` for a centered confirmation prompt — use `dialog`.
- Do not use `Sheet` for a simple toast/notification — use `toast`.
