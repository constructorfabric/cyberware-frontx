# Card

A container for grouping related content and actions — a flat bounded
surface: background, a 1px `--border` stroke, no drop shadow. The
boundary is a real CSS `border`, so your own `border` on the root
replaces it rather than adding a second edge beside it. Card is not a
floating popup and deliberately does not share Dialog's/DropdownMenu's
`--popover-*` chrome. Card has no Base UI primitive: every part is a
plain styled `div` (no portal, no open state, no keyboard behavior to
inherit).

Composition: `Card` (root) → `CardHeader` (→ `CardTitle`, optional
`CardDescription`, optional `CardAction`) → `CardContent` → `CardFooter`.
Every part except `Card` itself is a passthrough over
`ComponentProps<'div'>` — no kit-specific props of its own.

## When to use

- Grouping a self-contained unit of content (a stat, a settings section,
  an item in a list of similar items) with a clear visual boundary.
- A summary or preview that pairs a title/description with an action
  (`CardAction`) or a set of actions (`CardFooter`).

## When not to use

- A focused task that should block the rest of the page — use `dialog`.
- Purely tabular data — the kit's `table` component fits rows/columns
  better than a boundary-and-padding container.
- A single line of muted supporting text with no need for a boundary or
  background — plain text is lighter.

## Props (kit level)

`Card`:

| Prop | Type | Default |
|------|------|---------|
| `size` | `'default' \| 'sm'` — scales the card's internal padding and gap, and `CardTitle`'s font size | `'default'` |
| `className` | `string` — merged after the kit class | — |

`CardHeader` becomes a two-column grid (content, then `CardAction`) when
it contains a `CardAction`, and a two-row grid (title, then
`CardDescription`) when it contains a `CardDescription` — both detected
structurally, no prop to set.

Direct `img` children of `Card` are flush against the edges: no top
padding when the image is the first child, and the image's own corners
are rounded to match the card (first child rounds the top corners, last
child the bottom ones) — useful for a media card with a full-bleed image.

`CardTitle` renders a plain `div`, not a heading element — like every
other part, it has no `render` prop to swap it (Card has no Base UI
primitive to supply one). When a card is a real page landmark rather
than a decorative grouping, supply your own heading (e.g. wrap the text
in an `h2`/`h3`) so the page keeps a document outline; `CardTitle` alone
contributes nothing to it.

`CardFooter` is a plain flex row and contributes **no gap of its own** —
two buttons dropped straight into it render flush against each other.
Space them on the footer, the way the upstream card demos do
(`justify-end gap-2` there): `style={{ gap: 'var(--space-2)' }}` or your
own class.

`CardHeader` and `CardFooter` sit flush against `CardContent`, with no
divider by default. To add one, put a border on the part via `className`
(e.g. `border-top: 1px solid var(--border)` on `CardFooter`) and pair it
with `style={{ paddingTop: 'var(--card-spacing)' }}`, so the divider gets
the same inner padding as the rest of the card instead of sitting flush
against the border.

`--card-spacing` is a plain CSS custom property (unlike class names, CSS
Modules does not scope custom property names), so it resolves correctly
read from `style` on any Card part, and automatically follows `size`.

## Examples

```tsx
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@gears-frontx/ui-kit';

<Card>
  <CardHeader>
    <CardTitle>Team plan</CardTitle>
    <CardDescription>Billed monthly, 5 seats in use.</CardDescription>
    <CardAction>
      <Button variant="ghost" size="sm">
        Manage
      </Button>
    </CardAction>
  </CardHeader>
  <CardContent>
    <p>Next invoice on the 1st.</p>
  </CardContent>
  <CardFooter style={{ gap: 'var(--space-2)' }}>
    <Button variant="outline">Cancel</Button>
    <Button>Upgrade</Button>
  </CardFooter>
</Card>;
```

A compact card, sized down as a unit with `size="sm"`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gears-frontx/ui-kit';

<Card size="sm">
  <CardHeader>
    <CardTitle>Storage</CardTitle>
    <CardDescription>12 GB of 20 GB used</CardDescription>
  </CardHeader>
  <CardContent>
    <p>8 GB free</p>
  </CardContent>
</Card>;
```

## Anti-patterns

- Avoid nesting a `Card` inside another `Card` for visual grouping within
  the same surface — use `CardContent` layout (a grid or flex wrapper
  inside it) instead; two stacked shadow rings read as a bug, not a
  hierarchy. (Sizing itself is not the concern: `--card-spacing` and
  `CardTitle`'s font size resolve to each `Card`'s own `size`, so a
  nested `Card` is never skewed by an ancestor `Card`'s size — this is
  purely a "don't stack two boundaries" visual guideline.)
- Do not put interactive form controls that need `Field`'s label/error
  wiring directly as `CardContent` children without `Field` — `Card`
  supplies a boundary, not form semantics.
- Do not rely on `CardHeader`'s grid columns switching when you only want
  a fixed two-column header layout — that behavior is driven by whether a
  `CardAction` is present, not by a layout prop.
