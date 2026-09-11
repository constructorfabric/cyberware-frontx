# Drawer

An edge-anchored panel that opens with — and can be dismissed by — a swipe
gesture, in addition to the usual trigger/Escape/outside-press paths. Wraps
Base UI's dedicated `@base-ui/react/drawer` primitive (upstream shadcn/ui
dropped the third-party `vaul` library for this component in favor of it).
Unlike `sheet` (built on the same Dialog primitive `dialog` is, with a
CSS-only slide transition and no gesture), Drawer's slide, the "peeking
stack" look for nested drawers, and swipe-release momentum are all driven
live by custom properties Base UI itself writes during the gesture — see
"Swipe mechanics" below.

Composition: `Drawer` (root, holds open state, translates the kit's `side`
prop to Base UI's own `swipeDirection`) → `DrawerTrigger` → `DrawerContent`
(portals `DrawerBackdrop` conditionally, `DrawerHeader` / `DrawerFooter` /
`DrawerTitle` / `DrawerDescription` / consumer content, and an optional
`DrawerSwipeHandle`) → optional `DrawerClose` for a consumer-composed close
action.

## When to use

- A focused task, form, or detail view that benefits from a touch-native,
  swipe-to-dismiss interaction — a mobile-style bottom sheet, a filter panel
  a user can flick away.
- Content anchored to a screen edge where the drawer's own drag/release
  physics (not just a CSS transition) are part of the intended feel.

## When not to use

- The same edge-anchored panel shape without gesture dismissal — use
  `sheet`, which is lighter (no swipe-tracking runtime cost) and shares the
  identical `side` vocabulary and `Header`/`Footer`/`Title`/`Description`
  composition.
- A centered, page-blocking confirmation or short prompt — use `dialog`.
- Menus of actions anchored to a trigger — use `dropdown-menu`.
- Single-line contextual hints — use `tooltip`.

## Props (kit level)

`Drawer` (root): `open` / `defaultOpen`, `onOpenChange`, `modal` (`true`
default; `false`; `'trap-focus'`), `snapPoints` / `snapPoint` /
`defaultSnapPoint` / `onSnapPointChange` / `snapToSequentialPoints` — see
Base UI `Drawer.Root`. Plus:

| Prop | Type | Default |
|------|------|---------|
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` — which viewport edge the drawer opens from and swipes back out toward | `'bottom'` |
| `showSwipeHandle` | `boolean` — renders a small `aria-hidden` grab-handle bar at the panel's innermost edge | `false` |

`side` is this port's own renaming of Base UI's `swipeDirection` prop
(`'up' \| 'down' \| 'left' \| 'right'`, the direction a dismiss swipe
travels) to match `sheet`'s own edge-anchored vocabulary — a straight 1:1
map (`down`↔`bottom`, `up`↔`top`, left/right unchanged), not a new axis:
dismissing a bottom-anchored drawer is always a downward swipe, so naming
the prop after the edge reads more intuitively without losing any
distinction Base UI itself draws. `Drawer` does not accept `swipeDirection`
directly — pass `side` instead.

`DrawerContent`:

| Prop | Type | Default |
|------|------|---------|
| `container` | DOM node to portal the popup into | `<body>` |
| `initialFocus` / `finalFocus` | `boolean \| RefObject \| function` — see Base UI `Drawer.Popup` | default focus behavior |
| `className` | `string` — merged after the kit class | — |

`side` and `showSwipeHandle` are read from the ancestor `Drawer`, not passed
to `DrawerContent` directly — same context-based handoff upstream's own
fetched source uses (`Drawer`/`DrawerContent` are siblings in the JSX tree,
not parent/child, so this is how `DrawerContent` learns which edge without
prop-drilling through whatever markup sits between them).

**No `showCloseButton`/`closeLabel`/`showBackdrop` props** — a deliberate
divergence from `dialog`/`sheet`, not an oversight; see "Accessibility gap"
below.

`DrawerTrigger`, `DrawerClose`, and `DrawerPortal` are unstyled pass-throughs
— compose `DrawerTrigger`/`DrawerClose` with `Button` via their `render`
prop for a styled trigger or close action.

## Swipe mechanics

The slide/dismiss animation is driven by custom properties Base UI's own
`Drawer.Viewport`/`Drawer.Popup` write directly onto the DOM during a live
gesture (`--drawer-swipe-movement-x`/`-y`, `--drawer-swipe-progress`,
`--drawer-swipe-strength`, `--nested-drawers`, plus the measured
`--drawer-height`/`--drawer-frontmost-height`/`--drawer-snap-point-offset`)
— all of these are listed in `tokens.test.ts`'s `BASE_UI_RUNTIME_VARS`
exemption list, which is what keeps them out of that file's
"theme-defined or same-part local variables only" guard.

The enter/exit slide itself is a plain CSS transition between the
`[data-starting-style]`/`[data-ending-style]` transform (`--closed-transform`,
the panel parked one full panel-length past its own edge) and the resting
transform on `.popup`. Measured on the demo at a 900x513 viewport, a bottom
drawer travels `y: 515 → 308` on open and `308 → 515` on close, a right one
`x: 902 → 516` and back — monotonic, with the backdrop's opacity crossing
`0 → 1` on the same curve. Nominal duration is upstream's own
`450ms cubic-bezier(0.22, 1, 0.36, 1)` for the enter and
`calc(--drawer-swipe-strength * 400ms)` for the exit; because that curve
front-loads the motion, ~90% of the travel lands inside the first ~180ms.

`--drawer-inset` is the consumer-facing hook for insetting the panel from
its edge, and **any override must carry a unit** — `1rem`, or `0px` for
none, never a bare `0`. It is substituted into `--closed-transform`'s
`calc()`, where a unitless number added to a length is a type error: the
custom property then becomes invalid at computed-value time, `transform`
falls back to `none`, and both the enter and the exit slide disappear while
the backdrop keeps fading — which reads as the animation running backwards
rather than as a missing animation. `drawer.test.tsx` guards the values this
file itself declares; an override is only reachable by this rule.

Direction-specific geometry (`bottom: 0` / `transform-origin` /
`--closed-transform` / the swipe-driven `--translate-x`/`-y` math) is keyed
to Base UI's own `data-swipe-direction` attribute, not to the kit's `side`
class — that attribute is what Base UI itself keeps in sync with live
`swipeDirection` state, so it's the only mechanism guaranteed correct if a
consumer changes `side` on an already-mounted `Drawer` without a remount.
The kit's own `.sideTop`/`.sideRight`/`.sideBottom`/`.sideLeft` classes (via
`side`, mirroring `sheet`'s identical convention) instead own only the
static, prop-time visual choice a runtime attribute doesn't need to encode:
which edge's border is re-enabled (the popup's own border starts at `0`
width on every side — the OUTER edge sits flush against the viewport
boundary, where a border would be invisible at best).

Under `prefers-reduced-motion: reduce`, the popup's `transform`/`height`/
`filter` transitions are suppressed and only `opacity` survives — same
split as `dialog`/`toast`. Unlike those two, Drawer's own opacity carries no
independent visual signal here (the only opacity value the upstream source
ever sets is an imperceptible `0.9999` Safari-repaint nudge during exit), so
in practice a reduced-motion user sees the panel snap directly between open
and closed with no visible animation — the WCAG 2.3.3-compliant outcome,
via the same code shape as every other kit popup rather than a special-cased
`transition: none`.

## Body positioning

Base UI's Drawer primitive does not require any global `body`/`html` rule
to compute its own transforms correctly — this differs from some other
swipe-driven drawer libraries (vaul among them) that need a `body { position:
relative }`-style rule so their own translate math resolves against the
right containing block. Base UI's Drawer positions and transforms entirely
through `position: fixed` plus its own measured/written custom properties
(see "Swipe mechanics" above), independent of the page's own `body`
positioning — verified against the primitive's shipped source
(`node_modules/@base-ui/react/drawer/viewport/DrawerViewport.mjs` and
`popup/DrawerPopup.mjs`), which reads/writes only drawer-local refs and
custom properties, never anything computed from `document.body`'s box. No
global CSS is needed (and the kit's CSS Modules build could not add one
regardless) — a consumer moving from a vaul-based drawer that DID carry such
a global rule can drop it once every drawer on the page is this component.

## Accessibility gap (raised, not silently patched)

`dialog` and `sheet` both render a built-in close (X) button by default,
because Base UI's own docs require a `*.Close` inside a modal `*.Popup` as
the one touch-screen-reader escape hatch out of a focus-trapped modal.
Drawer's popup uses the identical `FloatingFocusManager`-based modal trap
(`modal={modal !== false}`, verified in
`node_modules/@base-ui/react/drawer/popup/DrawerPopup.mjs`) — the same
underlying mechanism, so the same requirement plausibly applies. The
upstream shadcn source this port replicates, however, renders no such
button and exposes no `showCloseButton`/`closeLabel` prop at all; this port
stayed faithful to that exact shape rather than inventing a feature upstream
doesn't have. **Compose a `DrawerClose` inside `DrawerContent` yourself**
(a header or footer "Cancel"/"Done" button, as the example below does) until
this gap is resolved — one way or another — at the architecture level.

## Examples

```tsx
import {
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@gears-frontx/ui-kit';

<Drawer>
  <DrawerTrigger render={<Button variant="outline" />}>Edit profile</DrawerTrigger>
  <DrawerContent>
    <DrawerHeader>
      <DrawerTitle>Edit profile</DrawerTitle>
      <DrawerDescription>Make changes to your profile here.</DrawerDescription>
    </DrawerHeader>
    <DrawerFooter>
      <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
      <Button onClick={handleSave}>Save changes</Button>
    </DrawerFooter>
  </DrawerContent>
</Drawer>
```

A side drawer with the grab handle shown:

```tsx
<Drawer side="right" showSwipeHandle>
  <DrawerTrigger render={<Button variant="outline" />}>Open</DrawerTrigger>
  <DrawerContent>
    <DrawerHeader>
      <DrawerTitle>Filters</DrawerTitle>
    </DrawerHeader>
  </DrawerContent>
</Drawer>
```

## Side variants

`side` picks one of four edge anchors — same four values, same sizing
intent, as `sheet`'s own `side`:

- `top` — full width, height sized to content (capped at `calc(100dvh -
  6rem)`, scrollable past that), slides down from above.
- `right` — full height, 75% width capped at `24rem` from the 640px
  breakpoint up, slides in from the right.
- `bottom` (default) — full width, height sized to content (capped and
  scrollable, same as `top`), slides up from below.
- `left` — full height, 75% width capped at `24rem` from the 640px
  breakpoint up, slides in from the left.

The popup is square (no `border-radius`) — the upstream base recipe class
supplying its actual visual chrome wasn't fetchable (see the CSS file's own
header comment), and `sheet.md` already established the kit's precedent for
that exact gap: stay unrounded rather than invent a value.

## Anti-patterns

- Do not omit `DrawerTitle` — Base UI's accessibility tree needs it even if
  visually hidden via `className`.
- Do not rely on `className`/CSS alone to change which edge the drawer
  opens from — always set `side` on `Drawer` (the root); the swipe/dismiss
  geometry is keyed to Base UI's own `data-swipe-direction` attribute, which
  only `side` (via `swipeDirection`) actually drives.
- Do not use `Drawer` where `sheet`'s plain slide-in would do — the swipe
  gesture and its runtime cost are the entire reason to reach for this
  component over `sheet`; skip it for a panel nothing will ever drag.
- Do not use `Drawer` for a simple toast/notification — use `toast`.
