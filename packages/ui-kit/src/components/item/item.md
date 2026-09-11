# Item

A single row in a list of similar things — a notification, a file, a
search result, a settings row. Unlike Card, Item is built for repetition:
`ItemGroup` spaces a run of them and gives the run `role="list"`.

Item's root is the one part in this file with real behavior: it is built
on Base UI's headless `useRender`/`mergeProps` utilities (not a stateful
primitive) so it can render as something other than a `<div>` — e.g. a
whole item as a link via `render={<a href="..." />}`. Every other part is
a plain styled element, same as Card.

Composition: `ItemGroup` (→ `Item`+, separated by optional
`ItemSeparator`) → `Item` (→ `ItemMedia`, `ItemContent` (→ `ItemTitle`,
`ItemDescription`), `ItemActions`, `ItemHeader`, `ItemFooter`).

## When to use

- A row in a list/table-like collection where each row shares the same
  shape (icon/avatar, title + description, trailing action).
- A single row that should itself be a navigation target — pass
  `render={<a href="..." />}` instead of wrapping a link around it.

## When not to use

- A one-off bounded panel of unrelated content — use `Card`.
- Genuinely tabular data (sortable columns, cell alignment) — use `table`.

## Props (kit level)

`Item`:

| Prop | Type | Default |
|------|------|---------|
| `variant` | `'default' \| 'outline' \| 'muted'` | `'default'` |
| `size` | `'default' \| 'sm' \| 'xs'` | `'default'` |
| `render` | `ReactElement \| ((props, state) => ReactElement)` — replaces the root element; `state` is `{ variant, size }` | — |
| `className` | `string` — merged after variant/size classes | — |

`ItemMedia`:

| Prop | Type | Default |
|------|------|---------|
| `variant` | `'default' \| 'icon' \| 'image'` — `image` also shrinks to match the ancestor `Item`'s `size` | `'default'` |

Every other part (`ItemContent`, `ItemTitle`, `ItemDescription`,
`ItemActions`, `ItemHeader`, `ItemFooter`, `ItemGroup`) takes no
kit-specific props — native element props, forwarded as-is.
`ItemSeparator` takes the kit `Separator`'s own props (its `orientation`
is fixed to `'horizontal'`).

`Item` reflects neither `variant` nor `size` as a DOM attribute — no
`data-slot`/`data-variant`/`data-size`, per the kit-wide convention (see
`card.md`). Style off the exported classes if you need to target a
specific combination from outside the component.

## Examples

```tsx
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  Button,
} from '@gears-frontx/ui-kit';

<ItemGroup>
  <Item>
    <ItemMedia variant="icon">
      <FileIcon />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>Q3 report.pdf</ItemTitle>
      <ItemDescription>Uploaded 2 days ago, 1.2 MB</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Button variant="ghost" size="sm">Download</Button>
    </ItemActions>
  </Item>
  <ItemSeparator />
  <Item variant="outline" size="sm" render={<a href="/files/2" />}>
    Notes.txt
  </Item>
</ItemGroup>
```

## Anti-patterns

- Do not wrap an `<a>` around an entire `Item` for row-level navigation —
  use `render={<a href="..." />}` on `Item` itself; a nested interactive
  wrapper doesn't get the row's own hover/focus treatment and risks
  interactive-in-interactive nesting once `ItemActions` has its own
  buttons.
- Do not expect `ItemGroup`'s spacing to react to a size set only via
  `className` — the shrink-to-smallest-size behavior reads the `Item`
  size *class* `Item` itself emits from its `size` prop, not an arbitrary
  consumer class.
- Do not put more than one `ItemContent` expecting both to grow — the
  second one goes fixed-width (`flex: none`), matching upstream: the
  pattern is a primary content block plus a fixed trailing block (e.g. a
  timestamp), not two equal columns.
