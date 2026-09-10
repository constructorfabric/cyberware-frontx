# AspectRatio

Constrains a child (typically an image or embed) to a fixed width-to-height
ratio using plain CSS `aspect-ratio` — no Base UI primitive, no variants.
Translated from shadcn/ui's `AspectRatio` (MIT), which is itself just a
`<div>` with a `--ratio` custom property and `aspect-ratio: var(--ratio)`.

## When to use

- Reserving layout space for an image, video, or map embed before it loads,
  so the page doesn't jump once it does.
- A gallery or card grid where every tile must share one proportion
  regardless of its content's native size.

## When not to use

- Content with a natural, already-fixed size (e.g. a fixed-size icon) —
  `aspect-ratio` on a box whose content doesn't stretch to fill it does
  nothing useful.
- As a cropping tool — this component reserves the *box*; the child (an
  `<img>` with `object-fit: cover`, for example) still decides how it fills
  that box.

## Props

| Prop | Type | Default |
|------|------|---------|
| `ratio` | `number` (width / height, e.g. `16 / 9`) | — (required) |
| `className` | `string` — merged after the kit class | — |

All other props are native `<div>` props and are forwarded as-is, including
`style` — a consumer's own inline `style` is merged with (not overwritten
by) the `--ratio` custom property this component sets.

## Examples

```tsx
import { AspectRatio } from '@gears-frontx/ui-kit';

<div style={{ width: '20rem' }}>
  <AspectRatio ratio={16 / 9}>
    <img
      src="/photo.jpg"
      alt="A description"
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  </AspectRatio>
</div>;

// Square tiles in a grid
<AspectRatio ratio={1}>
  <img src="/thumb.jpg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
</AspectRatio>;
```

## Anti-patterns

- Do not rely on this component to crop or fit the child's content — it
  only reserves the box's proportions; give the child its own
  `object-fit`/`overflow` handling.
- Do not pass an inline `style` with its own `--ratio` key expecting the
  `ratio` prop to still win — the two objects are merged with the
  consumer's `style` spread last, so a `--ratio` key inside it silently
  overrides the one this component derives from `ratio`. Use the `ratio`
  prop for the ratio; reserve `style` for everything else.
