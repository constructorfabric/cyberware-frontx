# ContextMenu

A menu of actions triggered by right-click (or long-press) at the pointer,
rather than a click on a trigger element. Wraps the Base UI Context Menu
primitives, which reuse the same underlying Menu parts as `DropdownMenu` —
the popup is portalled, keyboard navigation (arrow keys, typeahead, roving
focus), and Escape/outside-press dismissal come from Base UI.

Composition: `ContextMenu` (root, holds open state) → `ContextMenuTrigger`
(wraps the right-clickable area) → `ContextMenuContent` (portals
`ContextMenuGroup` / `ContextMenuItem` / `ContextMenuCheckboxItem` /
`ContextMenuRadioGroup` + `ContextMenuRadioItem` / `ContextMenuSeparator` /
`ContextMenuShortcut`). `ContextMenuLabel` requires a `ContextMenuGroup` or
`ContextMenuRadioGroup` ancestor — Base UI throws if it is used outside one
(it looks up the group it labels from context). Nest a submenu with
`ContextMenuSub` → `ContextMenuSubTrigger` → `ContextMenuSubContent`.

## When to use

- Actions scoped to a specific element the user right-clicks (a table row,
  a canvas object, a file in a list).
- Mutually exclusive or independent toggles that live inside the menu
  (`ContextMenuRadioItem`, `ContextMenuCheckboxItem`).

## When not to use

- An action anchored to a visible, clickable trigger (a "more" button, an
  avatar) — use `dropdown-menu` instead; a context menu's only entry point
  is right-click/long-press.
- Picking one value from a list bound to a form field — use `select`.
- A focused task or confirmation that should block the page — use
  `dialog`.

## Props (kit level)

`ContextMenu` (root): `open` / `defaultOpen`, `onOpenChange` — see Base UI
Context Menu Root. Unlike `DropdownMenu`'s root, `modal` / `openOnHover` /
`delay` / `closeDelay` are not accepted — a context menu is always modal
and has no hover-open concept, it only opens from the trigger's
`contextmenu` event.

`ContextMenuTrigger`: renders a `<div>` that listens for the native
`contextmenu` (right-click) event and opens the menu anchored at the
pointer position — it is not a clickable trigger like
`DropdownMenuTrigger`; wrap whatever content the menu should apply to (a
table row, a canvas, a whole page section). Its own class only applies
`user-select: none`, so a right-click doesn't also drag-select the wrapped
content.

`ContextMenuContent` / `ContextMenuSubContent`:

| Prop | Type | Default |
|------|------|---------|
| `side` | `top` \| `bottom` \| `left` \| `right` \| `inline-start` \| `inline-end` | `right` (Content and SubContent) |
| `align` | `start` \| `center` \| `end` | `start` |
| `sideOffset` / `alignOffset` | `number` | `0` / `4` (Content and SubContent) |
| `container` | DOM node to portal the popup into; `ContextMenuSubContent` inherits the nearest Content's unless given its own | `<body>` |
| `positionMethod` | `absolute` \| `fixed` — pass `fixed` when the trigger sits inside a `transform`/`filter` container (an animated panel), where absolute positioning resolves against the wrong box | `absolute` |
| `collisionBoundary` / `collisionPadding` | see Base UI Menu.Positioner — bound and pad the flip/shift collision logic | viewport / `5` |
| `className` | `string` — merged after the kit class | — |

`ContextMenuContent`'s popup does not size to a trigger width the way
`DropdownMenuContent` does (`--anchor-width`): the menu anchors to a
virtual point (the pointer), not a real trigger element, so there is no
trigger box to match — it uses a fixed `min-width: 9rem` instead.
`ContextMenuSubContent` sizes to its own content with a smaller
`min-width: 8rem`, since a submenu's anchor is its own (usually narrow)
`ContextMenuSubTrigger` item. Both are floors, not widths: pass a `width`
(via `className` or `style`) when a menu should hold one fixed size
regardless of its longest label — the shortcut column is pushed to the end
of the row, so a content-sized popup leaves no gap between a label and its
shortcut.

The popup portals to `<body>` by default, so if your theme lives on a
subtree (`data-theme` on a section instead of `<html>`), pass that section
as `container` or the popup renders with the root theme — same contract as
`Dialog`, `Select`, and `DropdownMenu`.

`ContextMenuItem`: `variant` — `default` | `destructive`, `disabled`,
`closeOnClick` (`true` by default — Base UI closes the menu on selection),
`inset` — indents the item's text to align with a sibling item's text past
its leading icon column, for a menu that mixes icon and non-icon rows.
`ContextMenuLabel` and `ContextMenuSubTrigger` accept the same `inset`.

`ContextMenuCheckboxItem`: `checked` / `defaultChecked`,
`onCheckedChange`, `inset`; `ContextMenuRadioGroup` + `ContextMenuRadioItem`:
`value` / `defaultValue`, `onValueChange` on the group, `value` and `inset`
on each item — both leave `closeOnClick` at Base UI's default of `false` so
the menu stays open after a toggle. A selected radio row is marked with the
same check glyph as a checked checkbox row, not a dot; the group is what
makes the selection exclusive.

### Icons and shortcuts inside a row

An `<svg>` placed inside `ContextMenuItem`, `ContextMenuCheckboxItem`,
`ContextMenuRadioItem`, or `ContextMenuSubTrigger` is sized to
`--icon-size-sm` and stopped from shrinking, so icons line up across rows
whatever their labels are — you do not have to size the icon yourself, and
an icon with no `width`/`height` of its own will not blow the row open.
Override by out-specifying that rule or setting the size inline.

`ContextMenuShortcut` pushes itself to the end of the row and renders in
`--muted-foreground`, turning `--accent-foreground` while the row is
highlighted. It is legal on a checkbox or radio row as well as a plain one:
those rows already reserve end padding for their indicator, so the shortcut
lands clear of it.

## Examples

```tsx
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@gears-frontx/ui-kit';

<ContextMenu>
  <ContextMenuTrigger>Right-click this area</ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuGroup>
      <ContextMenuLabel>Account</ContextMenuLabel>
      <ContextMenuItem>
        Profile
        <ContextMenuShortcut>⇧⌘P</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuGroup>
    <ContextMenuSeparator />
    <ContextMenuCheckboxItem checked={showBookmarks} onCheckedChange={setShowBookmarks}>
      Show bookmarks
    </ContextMenuCheckboxItem>
    <ContextMenuSeparator />
    <ContextMenuRadioGroup value={view} onValueChange={setView}>
      <ContextMenuRadioItem value="list">List view</ContextMenuRadioItem>
      <ContextMenuRadioItem value="grid">Grid view</ContextMenuRadioItem>
    </ContextMenuRadioGroup>
    <ContextMenuSeparator />
    <ContextMenuSub>
      <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem>Extensions</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSeparator />
    <ContextMenuItem variant="destructive" onClick={handleDelete}>
      Delete
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

## Anti-patterns

- Do not use `ContextMenu` as a substitute for a visible, discoverable
  trigger — right-click/long-press has no visual affordance, so any action
  a user needs to find without already knowing it exists belongs in
  `DropdownMenu` instead.
- Do not put `ContextMenuCheckboxItem` / `ContextMenuRadioItem` directly
  under `ContextMenuContent` when they represent a bound single-select
  value elsewhere in the app — use `select` or `radio-group` for form
  state instead.
- Do not nest more than one level of `ContextMenuSub` — deep submenu
  chains are hard to navigate with a mouse or keyboard.
