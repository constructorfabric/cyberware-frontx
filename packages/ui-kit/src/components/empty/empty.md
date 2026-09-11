# Empty

A placeholder for a list, table, or panel with nothing to show — "no
results", "no items yet", a first-run state. Empty has no Base UI
primitive: every part is a plain styled `div` with no interactive or
ARIA behavior of its own.

Composition: `Empty` (root) → `EmptyHeader` (→ `EmptyMedia`, `EmptyTitle`,
`EmptyDescription`) → `EmptyContent` (typically one or more actions).

## When to use

- A table, list, or search result with zero rows.
- A first-run/onboarding panel before any data exists.

## When not to use

- A loading state — use `Skeleton` or `Spinner` while data is in flight;
  `Empty` is for the settled "there is genuinely nothing here" state.
- An error state with a retry action that isn't "no data" — a fetch
  failure reads better as its own message than as `Empty`, though nothing
  stops you from reusing the same parts for one.

## Props (kit level)

`EmptyMedia`:

| Prop | Type | Default |
|------|------|---------|
| `variant` | `'default' \| 'icon'` — `icon` draws a muted rounded square behind the icon; `default` stays transparent | `'default'` |
| `className` | `string` — merged after the variant class | — |

`Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, and
`EmptyContent` take no kit-specific props — every prop is the underlying
native element's props (`EmptyDescription` renders a `<div>`, matching
upstream, despite its own props type naming `<p>` — see `empty.tsx`),
forwarded as-is.

## Examples

```tsx
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@gears-frontx/ui-kit';

<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon">
      <SearchIcon />
    </EmptyMedia>
    <EmptyTitle>No results</EmptyTitle>
    <EmptyDescription>Try a different search term or clear your filters.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
  </EmptyContent>
</Empty>

// A bare illustration, no icon chrome
<Empty>
  <EmptyMedia>
    <img src="/empty-inbox.svg" alt="" width={96} height={96} />
  </EmptyMedia>
  <EmptyTitle>Inbox zero</EmptyTitle>
</Empty>
```

## Anti-patterns

- Do not use `variant="icon"` for a full illustration/image — the muted
  square is sized for a small glyph; drop to `variant="default"` (the
  default) for anything larger, or omit `EmptyMedia` entirely.
- Do not put form controls needing `Field`'s label/error wiring inside
  `EmptyContent` — it's for actions (buttons, links), not inputs.
