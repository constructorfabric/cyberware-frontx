# NavigationMenu

A horizontal navigation bar whose items can expand into a rich dropdown
panel. Wraps Base UI's dedicated `@base-ui/react/navigation-menu`
primitive — a different family from `dropdown-menu` (`@base-ui/react/menu`)
despite the similar trigger/content vocabulary.

The defining mechanic: there is **one shared popup and one shared
Viewport** for the whole menu, not one per item. When a different trigger
becomes active, that item's `NavigationMenuContent` is portaled into the
same Viewport and the popup morphs (`--popup-width`/`--popup-height`,
`--positioner-width`/`--positioner-height`) to the newly active content's
measured size — see `NavigationMenuContent.mjs`'s `ReactDOM.createPortal`
and `NavigationMenuTrigger.mjs`'s `setSharedFixedSize` in
`node_modules/@base-ui/react/navigation-menu/`.

Composition: `NavigationMenu` (root — also renders the shared
Portal → Positioner → Popup → Viewport tree automatically) →
`NavigationMenuList` → `NavigationMenuItem` → `NavigationMenuTrigger`
(chevron via `NavigationMenuIcon`) + `NavigationMenuContent` (portals into
the shared Viewport when active). A plain `NavigationMenuLink` can sit
directly in an `NavigationMenuItem` with no trigger/content, for a row
entry that just navigates.

## When to use

- A page's primary horizontal navigation bar, where some entries expand
  into a panel of links/sections and others are plain links.
- Desktop-oriented top-level navigation with hover-or-click expansion.

## When not to use

- A menu of actions anchored to a button (not persistent page navigation)
  — use `dropdown-menu`.
- Picking one value bound to a form field — use `select`.
- Small screens / a single flat link list — plain `<nav>` markup or a
  drawer is simpler than this component's shared-viewport machinery.

## Props (kit level)

`NavigationMenu` (root) — holds the composed Portal/Positioner/Popup/
Viewport tree, so the positioning props that sit on `Content` in
DropdownMenu/Select sit here instead:

| Prop | Type | Default |
|------|------|---------|
| `value` / `defaultValue` | the active item's value | uncontrolled, `null` |
| `onValueChange` | `(value, eventDetails) => void` | — |
| `orientation` | `horizontal` \| `vertical` | `horizontal` |
| `delay` / `closeDelay` | `number` (ms) — hover open/close delay | `50` / `50` |
| `side` | `top` \| `bottom` \| `left` \| `right` \| `inline-start` \| `inline-end` | `bottom` |
| `align` | `start` \| `center` \| `end` | `start` |
| `sideOffset` / `alignOffset` | `number` | `8` / `0` |
| `container` | DOM node to portal the shared popup into | `<body>` |
| `positionMethod` | `absolute` \| `fixed` — pass `fixed` when the menu sits inside a `transform`/`filter` container | `absolute` |
| `collisionBoundary` / `collisionPadding` | see Base UI NavigationMenu.Positioner | viewport / `5` |
| `className` | `string` — merged after the kit class | — |

`NavigationMenuTrigger` / `NavigationMenuContent` / `NavigationMenuLink` /
`NavigationMenuList` / `NavigationMenuItem` / `NavigationMenuViewport`:
thin styled pass-throughs, no extra props beyond Base UI's own (see each
part's `.d.ts` under `node_modules/@base-ui/react/navigation-menu/`).

`NavigationMenuLink`: `active` (marks the current page, styles via
`[data-active]` and sets `aria-current="page"`), `closeOnClick` (`false`
by default — a plain in-content link does not auto-close the menu unless
asked to).

`navigationMenuTriggerStyle()` — a `cva()` className recipe (no variants
yet) that makes a plain `NavigationMenuLink` look identical to a
`NavigationMenuTrigger`, for a row entry that navigates directly with no
dropdown (e.g. "Pricing" beside "Products"/"Solutions"). Same name and
purpose as the upstream shadcn export.

`NavigationMenuIcon` — the trigger's chevron, exported because it is a
real Base UI part (state-aware: it reads "is this item's popup open" from
item context) rather than a private helper. Must be rendered inside a
`NavigationMenuItem`; `NavigationMenuTrigger` already includes one by
default.

`NavigationMenuIndicator` — an optional small arrow that tracks the
active trigger. Must be rendered as a child of the **same**
`NavigationMenuItem` as its `NavigationMenuTrigger`: Base UI's `Icon` part
(which both `NavigationMenuIcon` and `NavigationMenuIndicator` wrap) reads
its active state from that item's own context and throws if used outside
one — unlike the classic Radix indicator, this is not one shared
list-level element with computed `left`/`width` math.

The popup portals to `<body>` by default, so if your theme lives on a
subtree (`data-theme` on a section instead of `<html>`), pass that section
as `container` on `NavigationMenu` — same contract as `Dialog`/`Select`/
`DropdownMenu`.

## Visual states (no variant/size props)

Unlike most of the kit, `NavigationMenu` defines no `.variantXxx`/
`.sizeXxx` axis — none of its parts have a variant or size prop upstream.
Every visual state is driven by Base UI's own data attributes instead:

- `.trigger[data-popup-open]` / `:hover` — accent fill, same tone as a
  highlighted menu item elsewhere in the kit.
- `.triggerIcon[data-popup-open]` — chevron rotates 180°.
- `.popup[data-starting-style]` / `[data-ending-style]` — fade only; the
  popup's width/height already carry the size change (see below), so no
  additional scale transform is layered on top.
- `.positioner[data-instant]` — Base UI's own flag for a change that must
  not animate (initial open, and while the window resizes) — suppresses
  the position transition entirely for that frame.
- `.content[data-starting-style]` / `[data-ending-style]` plus
  `[data-activation-direction='left' | 'right']` — the per-item panel
  fades and slides horizontally as the active item changes; `'up'`/
  `'down'` are deliberately left unstyled, matching the upstream shadcn
  port (the shared-Viewport mechanic is a horizontal-orientation concept).
- `.link[data-active]` — marks the current-page link.
- `.indicator[data-popup-open]` — the tracking arrow becomes visible under
  the active trigger.

All geometry-changing transitions (the positioner's position, the popup's
width/height, the content's slide) are suppressed under
`prefers-reduced-motion: reduce`; opacity fades are kept, per the kit's
established mixed-transition idiom (see `dropdown-menu.md`/`select.md`).

## Examples

```tsx
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@gears-frontx/ui-kit';

<NavigationMenu>
  <NavigationMenuList>
    <NavigationMenuItem>
      <NavigationMenuTrigger>Products</NavigationMenuTrigger>
      <NavigationMenuContent>
        <NavigationMenuLink href="/products/a">Product A</NavigationMenuLink>
        <NavigationMenuLink href="/products/b">Product B</NavigationMenuLink>
      </NavigationMenuContent>
    </NavigationMenuItem>
    <NavigationMenuItem>
      <NavigationMenuLink className={navigationMenuTriggerStyle()} href="/pricing">
        Pricing
      </NavigationMenuLink>
    </NavigationMenuItem>
  </NavigationMenuList>
</NavigationMenu>
```

## Known gap

Base UI writes four runtime CSS custom properties this port consumes —
`--positioner-width`, `--positioner-height` (on the positioner) and
`--popup-width`, `--popup-height` (on the popup) — the direct equivalent
of `--anchor-width`/`--anchor-height` used elsewhere in the kit, and the
mechanism behind the shared-Viewport morph described above (see
`node_modules/@base-ui/react/navigation-menu/utils/setSharedFixedSize.mjs`).
They are listed in `tokens.test.ts`'s `BASE_UI_RUNTIME_VARS` exempt list,
which is what keeps `navigation-menu.module.css` passing that file's
"consumes only theme-defined or same-part local variables" guard.

## Anti-patterns

- Do not use `NavigationMenu` for a menu of actions anchored to a button
  — use `dropdown-menu`.
- Do not nest a second `NavigationMenu` inside a `NavigationMenuContent`
  for anything beyond a genuine mega-menu sub-navigation — Base UI
  supports nesting (the root renders a `<div>` instead of `<nav>` when
  nested), but it multiplies the shared-viewport machinery this component
  already carries.
- Do not render `NavigationMenuIcon`/`NavigationMenuIndicator` outside a
  `NavigationMenuItem` — both throw (Base UI's own item-context guard).
