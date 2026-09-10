# Pagination

Page-number navigation built from real anchors, styled through `Button`'s
own variant classes so a page link looks exactly like a ghost/outline
button. No Base UI primitive backs it — pure styling translation over
semantic markup (`nav` > `ul` > `li`), the same shape as `Table`/
`Breadcrumb`.

## When to use

- Navigating between server-rendered pages of a result set, where each page
  is a real URL (`<PaginationLink href="?page=2">`).

## When not to use

- Client-side "load more"/infinite scroll — use a plain `Button`.
- A single prev/next stepper with no page numbers — `PaginationPrevious`/
  `PaginationNext` alone (skip `PaginationLink`) already cover that.

## Parts

| Part | Renders | Notes |
|------|---------|-------|
| `Pagination` | `<nav aria-label="pagination">` | The root landmark |
| `PaginationContent` | `<ul>` | Row of page items |
| `PaginationItem` | `<li>` | One item |
| `PaginationLink` | `<a>` | A page number; square by default |
| `PaginationPrevious` | `<a>` | Chevron + "Previous" (hidden below 640px) |
| `PaginationNext` | `<a>` | "Next" + chevron (hidden below 640px) |
| `PaginationEllipsis` | `<span>` | Collapsed-pages indicator |

## Props (kit level)

`PaginationLink`:

| Prop | Type | Default |
|------|------|---------|
| `isActive` | `boolean` — outline variant + `aria-current="page"` when true, ghost otherwise | `false` |
| `size` | `default` \| `sm` \| `lg` (Button's own size scale) | `default` |
| `square` | `boolean` — square, icon-sized footprint | `true` |

`PaginationPrevious`/`PaginationNext` accept the same props minus `size`/
`square` (fixed to `default`/`false`), plus `text` to relabel the button.

## Implementation note

`PaginationLink` is styled through the exact same CSS classes `Button`
renders with (`button.module.css`'s `.button`/`.variantOutline`/
`.variantGhost`/`.sizeDefault` etc.) — visually and behaviorally the same
"button" surface, applied to a real `<a>` instead of Base UI's `Button`
primitive, so pagination items are real, crawlable, cmd-clickable links.

## Examples

```tsx
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@gears-frontx/ui-kit';

<Pagination>
  <PaginationContent>
    <PaginationItem>
      <PaginationPrevious href="?page=1" />
    </PaginationItem>
    <PaginationItem>
      <PaginationLink href="?page=1">1</PaginationLink>
    </PaginationItem>
    <PaginationItem>
      <PaginationLink href="?page=2" isActive>
        2
      </PaginationLink>
    </PaginationItem>
    <PaginationItem>
      <PaginationEllipsis />
    </PaginationItem>
    <PaginationItem>
      <PaginationNext href="?page=3" />
    </PaginationItem>
  </PaginationContent>
</Pagination>
```

## Anti-patterns

- Do not wrap a client-side handler in `href="#"` and call
  `preventDefault()` as the only navigation mechanism — a real `href` keeps
  the page crawlable and cmd/middle-click-able, matching a genuine link's
  semantics.
- Do not set `isActive` on more than one `PaginationLink` at a time — only
  one page is "current".
