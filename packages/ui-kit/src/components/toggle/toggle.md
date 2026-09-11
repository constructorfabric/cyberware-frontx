# Toggle

A two-state button that can be on or off. Wraps the Base UI Toggle
primitive: renders a `<button>`, state via `data-pressed`, standalone or as
an item inside `ToggleGroup`.

## When to use

- A single, independent on/off control that looks and behaves like a
  button — formatting actions (bold, italic), a "favorite" star, a view
  toggle.

## When not to use

- A labelled settings switch that applies immediately — use `switch`.
- A set of related, usually mutually-exclusive options — use `toggle-group`.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `pressed` / `defaultPressed` | controlled / uncontrolled pressed state | `false` |
| `onPressedChange` | `(pressed: boolean, eventDetails) => void` | — |
| `variant` | `default` \| `outline` | `default` |
| `size` | `default` \| `sm` \| `lg` | `default` |
| `value` | identifies this toggle inside a `ToggleGroup` | — |
| `className` | `string` — merged after variant/size classes | — |

Other props follow Base UI Toggle (`disabled`, `render`, ...).

## Examples

```tsx
import { Toggle } from '@gears-frontx/ui-kit';

// Standalone, uncontrolled
<Toggle aria-label="Bold" defaultPressed>
  <BoldIcon />
</Toggle>

// Controlled
<Toggle pressed={starred} onPressedChange={setStarred} aria-label="Favorite">
  <StarIcon />
</Toggle>

// Outline variant, large size
<Toggle variant="outline" size="lg" aria-label="Italic">
  <ItalicIcon />
</Toggle>
```

## Anti-patterns

- Do not render one without a visible label or `aria-label` — an icon-only
  toggle carries no accessible name otherwise.
- Do not reach for `Toggle` when the options are mutually exclusive or form
  a related set — `toggle-group` manages that shared state; wiring several
  independent `Toggle`s by hand duplicates what the group already does.
