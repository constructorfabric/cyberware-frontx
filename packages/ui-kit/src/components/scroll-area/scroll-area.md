# ScrollArea

A custom-styled scrollable container. Wraps the Base UI ScrollArea
primitives; scroll physics, overflow detection, and the thumb's drag
behavior come from Base UI — this component only supplies the visual
scrollbar/thumb in place of the browser's native one. No variants.

Composition (fixed, not a full part-by-part export — see "Upstream source"
below): `ScrollArea` (root) renders a Viewport wrapping your `children`,
one vertical `ScrollBar`, and a Corner. `ScrollBar` is exported separately
only so you can add a second one for the other axis.

## When to use

- A fixed-height (or fixed-width) panel — a sidebar list, a chat log, a
  code block — where you want a scrollbar that matches the kit's visual
  language across browsers/platforms instead of each OS's native chrome.

## When not to use

- The page's own root scroll — let the browser handle that; wrapping the
  whole page in `ScrollArea` fights the browser's native scroll
  restoration, `:target` anchoring, and find-in-page.
- Content that never needs to scroll — this component adds a
  measurement/positioning layer for no benefit over a plain `<div>`.

## Upstream source

The base registry item (`apps/v4/registry/bases/base/ui/scroll-area.tsx`)
exports exactly two names, `ScrollArea` and `ScrollBar` — not one export per
Base UI part. This kit replicates that same two-export surface rather than
also exporting `Viewport`/`Content`/`Corner` individually; `Corner` in
particular is rendered internally by `ScrollArea` and takes no `className`
in either shadcn variant (base or new-york) — Base UI's own
`ScrollAreaCorner` sizes and positions itself from measured scrollbar/thumb
geometry, with nothing left for a consumer stylesheet to add.

The base registry source ships Root/Viewport structurally but — true to
the "base" variant's minimal-by-design intent — leaves the scrollbar
track's width, its invisible padding border, and the thumb's pill shape
unset; this kit fills those in from the sibling new-york variant (same
Base UI props, same visual intent), since every kit component ships fully
themed rather than as a bare structural shell: `0.625rem` track width, a
1px transparent inset border, `9999px`-radius thumb.

## Props (kit level)

`ScrollArea` (root): `overflowEdgeThreshold`, `className` — merged after
the kit class. All other props are native `<div>` props, forwarded to Base
UI's `ScrollArea.Root`.

`ScrollBar`:

| Prop | Type | Default |
|------|------|---------|
| `orientation` | `vertical` \| `horizontal` | `vertical` |
| `keepMounted` | `boolean` — keep the track in the DOM when the content doesn't overflow that axis | `false` |
| `className` | `string` — merged after the kit class | — |

## Examples

```tsx
import { ScrollArea } from '@gears-frontx/ui-kit';

<ScrollArea style={{ height: '18rem', width: '16rem' }}>
  <ul>
    {items.map((item) => (
      <li key={item.id}>{item.label}</li>
    ))}
  </ul>
</ScrollArea>;
```

```tsx
import { ScrollArea, ScrollBar } from '@gears-frontx/ui-kit';

// Both axes: ScrollArea already renders the vertical bar; add a second,
// horizontal ScrollBar as an extra child for the other axis.
<ScrollArea style={{ height: '12rem', width: '24rem' }}>
  <table>{/* wide content */}</table>
  <ScrollBar orientation="horizontal" />
</ScrollArea>;
```

## Anti-patterns

- Do not expect `ScrollArea` to size itself — like the upstream source it
  ships no intrinsic height/width; give it one via `style` or `className`
  (a fixed height, `max-height`, or a flex/grid cell with a bounded size).
- Do not import `Viewport`, `Content`, or `Corner` from this component —
  they are not exported; the composition is fixed the same way it is
  upstream. Reach for the raw `@base-ui/react/scroll-area` primitives
  directly if you need a different composition.
