# AlertDialog

A modal overlay that interrupts the user with content they must explicitly
acknowledge — typically a destructive-action confirmation. Wraps the Base
UI AlertDialog primitives (which reuse Dialog's own Popup/Backdrop/Portal/
Title/Description under the hood); focus trapping, page-scroll locking, and
Escape dismissal come from Base UI. Unlike `Dialog`, an alert dialog does
**not** close on outside press — the whole point is that the user must
make an explicit choice via `AlertDialogAction` or `AlertDialogCancel`, not
dismiss it by clicking away.

Composition: `AlertDialog` (root, holds open state) → `AlertDialogTrigger`
→ `AlertDialogContent` (portals `AlertDialogHeader` — optionally with
`AlertDialogMedia` — `AlertDialogTitle`, `AlertDialogDescription`, and
`AlertDialogFooter` with `AlertDialogCancel` / `AlertDialogAction`).

## When to use

- A destructive or otherwise consequential action that needs an explicit
  confirm/cancel choice before it proceeds (delete, discard unsaved
  changes, an irreversible state change).

## When not to use

- Content the user can dismiss by clicking away — use `dialog`.
- A passive notification — use `toast`.
- A menu of actions — use `dropdown-menu`.

## Props (kit level)

`AlertDialog` (root): `open` / `defaultOpen`, `onOpenChange`,
`onOpenChangeComplete` — see Base UI AlertDialog.Root. Always modal; there
is no `modal={false}` escape hatch (unlike `Dialog`).

`AlertDialogContent`:

| Prop | Type | Default |
|------|------|---------|
| `size` | `'default' \| 'sm'` — `sm` narrows the max width and stacks `AlertDialogCancel`/`AlertDialogAction` into two equal columns instead of a row | `'default'` |
| `showBackdrop` | `boolean` — renders the dimming backdrop | `true` |
| `container` | DOM node to portal the popup into | `<body>` |
| `initialFocus` / `finalFocus` | `boolean \| RefObject \| function` — see Base UI Dialog.Popup | default focus behavior |
| `className` | `string` — merged after the kit class | — |

The popup portals to `<body>` by default, so if your theme lives on a
subtree (`data-theme` on a section instead of `<html>`), pass that section
as `container` or the popup renders with the root theme — same contract as
`Dialog`.

`AlertDialogAction` and `AlertDialogCancel` are both a Base UI
`AlertDialog.Close` rendered as a kit `Button` (any `variant`/`size`;
`default` for the action, `outline` for the cancel) — clicking either one
closes the dialog. Your own `onClick` still runs, and runs first, so the
usual "do the thing, then dismiss" flow needs no extra wiring.

`AlertDialogAction` additionally takes `Button`'s `loading` and `icon`,
which `AlertDialogCancel` does not: the confirming action is the one that
does work. An async confirm calls `event.preventBaseUIHandler()` in its
`onClick` to keep the dialog open, sets `loading`, and drives `open`
itself when the work resolves — a `loading` Button is disabled, so the
same action cannot be pressed twice while the request is in flight.

```tsx
<AlertDialogAction
  variant="destructive"
  loading={deleting}
  onClick={(event) => {
    event.preventBaseUIHandler();
    setDeleting(true);
    void deleteAccount().finally(() => {
      setDeleting(false);
      setOpen(false);
    });
  }}
>
  Delete
</AlertDialogAction>
```

## Examples

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from '@gears-frontx/ui-kit';

<AlertDialog>
  <AlertDialogTrigger render={<Button variant="destructive">Delete account</Button>} />
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. This will permanently delete your account.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction variant="destructive" onClick={handleDelete}>
        Continue
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>;
```

## Scrolling content

`AlertDialogHeader` and `AlertDialogFooter` are `position: sticky` (top /
bottom) with an opaque background matching the popup, by default. That
covers two shapes:

- A consumer-wrapped middle region (`overflow-y: auto` on a child div
  between header and footer) - the popup itself never needs to scroll, so
  the sticky positioning is inert and simply does nothing.
- Long content dropped in unwrapped (as in the "Scrollable content"
  example) - `AlertDialogContent`'s own `max-height` + `overflow-y: auto`
  becomes the scroll container, and header/footer stay pinned at the
  top/bottom of it, masking whatever scrolls underneath. No inline
  `background` or `position` prop needed on `AlertDialogFooter` for this -
  it is the built-in behavior, same contract as `Dialog`'s (see
  `dialog.md`'s "Scrolling content").

For the mask to be complete, `AlertDialogContent` itself carries no
padding: the inset lives on its direct children instead (side inset on
every child, top inset on the first, bottom inset on the last), so header
and footer span the popup's full width and reach its top and bottom edges.
Padding on the scroll container would have left strips that no sticky
region can cover - see `dialog.md`'s "Scrolling content" for the
mechanism. Consequence when styling children: a `className` that sets
`padding` on a region overrides the inset (same single-class weight)
rather than adding to it, and a full-width child reaches the popup edges
by zeroing its `padding-inline`.

## Anti-patterns

- Do not rely on outside click or a backdrop click to close an alert
  dialog — Base UI deliberately does not wire that; the user must choose
  `AlertDialogAction` or `AlertDialogCancel`.
- Do not omit `AlertDialogTitle` — Base UI's accessibility tree needs it
  even if visually hidden via `className`.
- Do not use `AlertDialog` for a dismissible, non-blocking notice — use
  `dialog` (with a close button or outside-press dismissal) or `toast`.
