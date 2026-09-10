# Slider

A draggable control for picking a number (or a range) from a bounded
scale. Wraps the Base UI Slider primitive (Root/Control/Track/Indicator/
Thumb): pointer drag, click-on-track, and arrow-key/Page-key input, one
`Thumb` per value for range sliders.

## When to use

- A single numeric value from a continuous or stepped range: volume,
  zoom, a price ceiling.
- A range of two values: a min/max price filter.

## When not to use

- A small, fixed set of discrete options — use `toggle-group` or
  `radio-group`.
- Precise numeric entry — pair with (or use instead) a numeric `input`.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `value` / `defaultValue` | controlled / uncontrolled — a number, or a `[min, max]` array for a range | — |
| `onValueChange` | `(value, eventDetails) => void`, fires while dragging | — |
| `onValueCommitted` | `(value, eventDetails) => void`, fires once the interaction ends | — |
| `min` / `max` | bounds of the scale | `0` / `100` |
| `step` | granularity the thumb snaps to | `1` |
| `orientation` | `horizontal` \| `vertical` | `horizontal` |
| `disabled` | `boolean` | `false` |
| `className` | `string` — merged after the kit class | — |

Other props follow Base UI Slider.Root (`name`, `form`, `largeStep`,
`minStepsBetweenValues`, `thumbCollisionBehavior`, ...). The number of
rendered thumbs is derived from `value`/`defaultValue`'s length — a
`[10, 20]` default renders two thumbs automatically. Anything else is one
thumb, including a slider given neither prop: Base UI initializes that one
to the scalar `min`, so a second thumb would have no value behind it.

## Examples

```tsx
import { Slider } from '@gears-frontx/ui-kit';

// Single value
<Slider defaultValue={50} aria-label="Volume" />

// Range (two thumbs, derived from the array)
<Slider defaultValue={[20, 80]} aria-label="Price range" />

// Stepped, controlled
<Slider value={zoom} onValueChange={setZoom} min={50} max={200} step={10} aria-label="Zoom" />

// Vertical
<Slider orientation="vertical" defaultValue={30} aria-label="Brightness" />

// Disabled
<Slider defaultValue={40} disabled aria-label="Locked" />
```

## Anti-patterns

- Do not render one without a visible label or `aria-label` — the thumb
  is a native range input under the hood and needs an accessible name.
- Do not use `onValueChange` for a network call on every pixel of drag —
  use `onValueCommitted` for anything that shouldn't fire continuously.
