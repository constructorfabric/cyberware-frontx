# Spinner

A spinning loading indicator — lucide's `loader-circle` icon rotating
continuously via CSS. No Base UI primitive and no variant axis: a single
visual, sized like the kit's other small icons.

## When to use

- A standalone loading indicator next to text ("Saving...") or inside a
  container that has no button of its own to carry `loading`.
- Building a custom loading affordance where `Button`'s own built-in
  `loading` prop (see `button.md`) doesn't apply — e.g. a loading state
  inside a `Card` or a table cell.

## When not to use

- Inside a `Button` — use `Button`'s `loading` prop instead; it already
  centers a spinner, sets `aria-busy`, and keeps the button's label in the
  accessibility tree. Reaching for this component there duplicates that
  wiring by hand.

## Props (kit level)

`Spinner` takes no kit-specific props — every prop is the underlying
native `<svg>` element's props, forwarded as-is. Two attributes carry a
default that a consumer can still override by passing their own:

| Attribute | Default | Override for |
|-----------|---------|--------------|
| `role` | `status` | A different live-region role, if the surrounding markup already announces the loading state. |
| `aria-label` | `Loading` (upstream's own hardcoded string) | A localized or more specific label ("Saving changes"). |

## Examples

```tsx
import { Spinner } from '@gears-frontx/ui-kit';

// Standalone, with its default "Loading" label
<Spinner />

// Inline next to text, with a specific label
<p style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
  <Spinner aria-label="Saving changes" />
  Saving changes...
</p>
```

## Anti-patterns

- Do not use this inside `Button` — use `loading` there (see `button.md`);
  `Button`'s own spinner is a separate, simpler CSS-only implementation
  already wired to `aria-busy`.
- Do not drop the `aria-label` via an empty override (`aria-label=""`) —
  a spinner with no accessible name announces nothing to assistive tech;
  either keep the default or supply a real label.
