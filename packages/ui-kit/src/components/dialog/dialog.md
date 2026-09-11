# Dialog

A modal overlay for a focused task or confirmation. Wraps the Base UI
Dialog primitives; the popup is portalled, focus trapping, page-scroll
locking, and Escape/outside-press dismissal come from Base UI. Base UI
does **not** supply a touch-screen-reader escape hatch on its own — when
`modal` is `true` (the default) or `'trap-focus'`, its own docs require
the consumer to render a `Dialog.Close` inside `Dialog.Popup` for that.
The kit satisfies this by having `DialogContent` render a close button
by default (`showCloseButton`, see below).

Composition: `Dialog` (root, holds open state) → `DialogTrigger` →
`DialogContent` (portals `DialogHeader` / `DialogFooter` /
`DialogTitle` / `DialogDescription` / consumer content) → optional
`DialogClose` for a consumer-composed close action (e.g. a footer
"Cancel" button).

## When to use

- A focused task or confirmation that should block interaction with the
  rest of the page until the user acts or dismisses it.
- Content the user must read or decide on before continuing (destructive
  action confirmation, a short form).

## When not to use

- Passive information that does not need to block the page — a dialog is
  modal by default; if it genuinely must not block, pair `modal={false}`
  on the root with `showBackdrop={false}` on `DialogContent` (one without
  the other still blocks: `modal` alone leaves the backdrop covering and
  click-closing over the page).
- Menus of actions anchored to a trigger — use `dropdown-menu`.
- Single-line contextual hints — use `tooltip`.

## Props (kit level)

`Dialog` (root): `open` / `defaultOpen`, `onOpenChange`, `modal` (`true`
default; `false`; `'trap-focus'`) — see Base UI Dialog.Root.

`DialogContent`:

| Prop | Type | Default |
|------|------|---------|
| `showCloseButton` | `boolean` — renders a top-right close (X) button | `true` |
| `showBackdrop` | `boolean` — renders the dimming backdrop; set `false` together with `modal={false}` on the root for a genuinely non-modal dialog | `true` |
| `closeLabel` | `string` — accessible name for that button, the popup's only kit-authored text; same contract as `Toaster`'s `closeLabel` | `'Close'` |
| `container` | DOM node to portal the popup into | `<body>` |
| `initialFocus` / `finalFocus` | `boolean \| RefObject \| function` — see Base UI Dialog.Popup | default focus behavior |
| `className` | `string` — merged after the kit class | — |

Setting `showCloseButton={false}` removes the only built-in escape hatch
touch screen reader users have out of a modal dialog (see above) — only
do this if you compose your own `DialogClose` somewhere inside
`DialogContent` (e.g. in the footer).

The popup portals to `<body>` by default, so if your theme lives on a
subtree (`data-theme` on a section instead of `<html>`), pass that
section as `container` or the popup renders with the root theme.

`DialogTrigger` and `DialogClose` are unstyled pass-throughs (native
`<button>` semantics) — compose them with `Button` via their `render`
prop for a styled trigger or close action, same as the built-in close
button does internally.

## Examples

```tsx
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@gears-frontx/ui-kit';

<Dialog>
  <DialogTrigger render={<Button variant="destructive" />}>Delete project</DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delete project</DialogTitle>
      <DialogDescription>
        This action cannot be undone. This will permanently delete the project.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
      <Button variant="destructive" onClick={handleDelete}>
        Delete
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

## Wide content

`DialogContent` lays its children out as a single-column grid capped at
`28rem` (`calc(100% - 2rem)` below 640px), and the column's minimum width
is floored at zero — so content wider than the popup overflows *inside*
it rather than stretching the dialog past its cap.

That means a wide child needs its own horizontal scroll container:
`Table` already ships one (its wrapper scrolls and is keyboard-reachable),
so a table drops in as-is. Anything else wide — a `<pre>` code block, a
long unbroken string, an image — either wrap in an element with
`overflow-x: auto`, or let it wrap (`overflow-wrap: anywhere` for
unbreakable strings). Widening the dialog itself is a `className` width on
`DialogContent`, not something to fix from the child.

## Scrolling content

`DialogHeader` and `DialogFooter` are `position: sticky` (top / bottom)
with an opaque background matching the popup, by default. That covers two
shapes:

- A consumer-wrapped middle region (`overflow-y: auto` on a child div
  between header and footer, as in the "Scrollable content" example) -
  the popup itself never needs to scroll, so the sticky positioning is
  inert and simply does nothing.
- Long content dropped in unwrapped (as in the "Sticky footer" example) -
  `DialogContent`'s own `max-height` + `overflow-y: auto` becomes the
  scroll container (see "Wide content" above for the matching horizontal
  case), and header/footer stay pinned at the top/bottom of it, masking
  whatever scrolls underneath. No inline `background` or `position` prop
  needed on `DialogFooter` for this - it is the built-in behavior.

For the mask to be complete, `DialogContent` itself carries no padding:
the inset lives on its direct children instead (side inset on every child,
top inset on the first, bottom inset on the last), so header and footer
span the popup's full width and reach its top and bottom edges. A scroll
container's padding would not have worked - it does not clip content
(overflow clips at the padding box) and sticky offsets resolve against the
scrollport already inset by it, so scrolled text stayed visible in the
strips beside and beyond the pinned regions.

This matters when you style children of `DialogContent`: a `className`
that sets `padding` on `DialogHeader`, `DialogFooter`, or on a middle
region overrides that inset rather than adding to it (the kit rule is
deliberately held at single-class weight so your class can win), and a
full-width child such as a divider or a banner reaches the popup edges by
zeroing its own `padding-inline`.

## Anti-patterns

- Do not nest interactive page content's focus expectations across the
  backdrop — modal mode (the default) already traps focus and moves it
  in/out on open/close; use `initialFocus` / `finalFocus` on
  `DialogContent` if you need to redirect it, don't fight it with manual
  focus management (imperative `.focus()` calls in effects).
- Do not omit `DialogTitle` — Base UI's accessibility tree needs it even
  if it is visually hidden via `className`; do not delete it for a
  "cleaner" look.
- Do not use `Dialog` for a simple toast/notification — use `toast`.
