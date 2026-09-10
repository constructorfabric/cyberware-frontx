# Menubar

A horizontal row of menus, like a desktop app's File/Edit/View bar. Wraps
Base UI's `Menubar` (the roving-tabindex container) plus the kit's own
`dropdown-menu` parts — each top-level menu is a plain `MenubarMenu`
(`DropdownMenu`), and Base UI detects its `Menubar` ancestor automatically to
coordinate keyboard/hover switching between sibling menus.

Composition: `Menubar` (root bar) → one or more `MenubarMenu` →
`MenubarTrigger` → `MenubarContent` (same content parts as `dropdown-menu`:
`MenubarGroup` / `MenubarItem` / `MenubarCheckboxItem` /
`MenubarRadioGroup` + `MenubarRadioItem` / `MenubarSeparator` /
`MenubarShortcut`). Nest a submenu with `MenubarSub` → `MenubarSubTrigger`
→ `MenubarSubContent`, identical to `dropdown-menu`.

Every part past `Menubar` and `MenubarTrigger` is a direct re-export of the
matching `dropdown-menu` part (same component, same props, same styling) —
see `dropdown-menu.md` for `MenubarContent`'s positioning props,
`MenubarItem`'s `variant` axis, `MenubarCheckboxItem`/`MenubarRadioItem`'s
behavior, and the submenu contract. This file documents only what's unique
to Menubar: the bar container and the top-level trigger.

## When to use

- A persistent, always-visible row of menus at the top of an app or a
  toolbar (File/Edit/View, a document's command bar).
- Prefer `dropdown-menu` alone for a single "more actions" menu that isn't
  part of a row of peers.

## When not to use

- Primary page navigation between routes — use `navigation-menu`.
- A single anchored action menu — use `dropdown-menu` directly (`Menubar`
  adds nothing for exactly one menu).

## Props (kit level)

`Menubar` (root): `modal` (`true` default), `disabled`, `orientation`
(`horizontal` default), `loopFocus` — see Base UI `Menubar`. `className` is
merged after the kit's bar styling (border, radius, `--surface` fill).

`MenubarTrigger`: same as `DropdownMenuTrigger` (an unstyled pass-through in
`dropdown-menu`), styled here as a toolbar button — background on hover and
while its own menu is open (`data-popup-open`), a `--ring` focus box-shadow,
disabled at 0.42 opacity. No `variant`/`size` axis — a single look, matching
upstream.

`MenubarMenu`, `MenubarContent`, `MenubarGroup`, `MenubarLabel`,
`MenubarItem`, `MenubarCheckboxItem`, `MenubarRadioGroup`,
`MenubarRadioItem`, `MenubarSeparator`, `MenubarShortcut`, `MenubarSub`,
`MenubarSubTrigger`, `MenubarSubContent`: identical props to their
`dropdown-menu` counterparts (`DropdownMenu`, `DropdownMenuContent`, ...) —
these are the same components, re-exported under the `Menubar*` name.
`MenubarContent` overrides only the positioning defaults (`align="start"`,
`alignOffset={-4}`, `sideOffset={8}`) to match upstream's menubar-specific
placement under a toolbar trigger rather than a standalone one.

## Examples

```tsx
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@gears-frontx/ui-kit';

<Menubar>
  <MenubarMenu>
    <MenubarTrigger>File</MenubarTrigger>
    <MenubarContent>
      <MenubarItem>
        New Tab
        <MenubarShortcut>⌘T</MenubarShortcut>
      </MenubarItem>
      <MenubarItem disabled>New Window</MenubarItem>
      <MenubarSeparator />
      <MenubarItem variant="destructive">Close Window</MenubarItem>
    </MenubarContent>
  </MenubarMenu>
  <MenubarMenu>
    <MenubarTrigger>View</MenubarTrigger>
    <MenubarContent>
      <MenubarCheckboxItem checked={showBookmarks} onCheckedChange={setShowBookmarks}>
        Show bookmarks
      </MenubarCheckboxItem>
      <MenubarSeparator />
      <MenubarRadioGroup value={zoom} onValueChange={setZoom}>
        <MenubarRadioItem value="100">100%</MenubarRadioItem>
        <MenubarRadioItem value="150">150%</MenubarRadioItem>
      </MenubarRadioGroup>
    </MenubarContent>
  </MenubarMenu>
</Menubar>
```

## Anti-patterns

- Do not put a single `MenubarMenu` inside `Menubar` for one menu that has
  no siblings — use `dropdown-menu` directly, since `Menubar`'s only value
  is coordinating a row of peers.
- Do not use `Menubar` for page navigation — see `navigation-menu`.
