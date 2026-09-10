# Breadcrumb

A trail of ancestor links ending in the current page. No Base UI primitive
backs it (there is none) — pure styling translation over semantic markup
(`nav` > `ol` > `li`), the same shape as `Table`, except `BreadcrumbLink`
gets `render`-prop polymorphism from Base UI's `useRender`/`mergeProps`
utilities (the same shape `Badge` uses) for routing through a consumer
app's own link component.

## When to use

- Showing the user's position in a hierarchical structure (Home / Section /
  Page) with clickable ancestors.

## When not to use

- Tab-style section switching on one page — use `Tabs`.
- A single "back" action — use `Button` with a leading icon.

## Parts

| Part | Renders | Notes |
|------|---------|-------|
| `Breadcrumb` | `<nav aria-label="breadcrumb">` | The root landmark |
| `BreadcrumbList` | `<ol>` | Wraps, no bullets |
| `BreadcrumbItem` | `<li>` | One crumb |
| `BreadcrumbLink` | `<a>` (or `render`) | An ancestor the user can navigate to |
| `BreadcrumbPage` | `<span>` | The current page — not a link |
| `BreadcrumbSeparator` | `<li>` | Decorative divider between crumbs, defaults to a chevron |
| `BreadcrumbEllipsis` | `<span>` | Collapsed-crumbs indicator |

## Props (kit level)

`BreadcrumbLink` accepts a `render` prop (`useRender.ComponentProps<'a'>`) to
render through a consumer's own link component instead of a raw `<a>`:

```tsx
<BreadcrumbLink render={<RouterLink to="/reports" />}>Reports</BreadcrumbLink>
```

`BreadcrumbSeparator` accepts optional `children` to replace the default
chevron (e.g. a bare `/`). Every other part forwards its native element
props unchanged.

## Examples

```tsx
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gears-frontx/ui-kit';

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/">Home</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbEllipsis />
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbLink href="/reports">Reports</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>Q3 summary</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

## Anti-patterns

- Do not make the current page a `BreadcrumbLink` — use `BreadcrumbPage`; it
  reports `aria-current="page"` and is deliberately not clickable
  (`aria-disabled="true"`).
- Do not put interactive content inside `BreadcrumbSeparator`/
  `BreadcrumbEllipsis` — both are `aria-hidden`/decorative and must not
  carry the trail's only route to an action.
