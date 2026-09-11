# Alert

A banner-style callout for a page-level message — status, a warning, or a
short instruction that sits in the flow of the page rather than
interrupting it (that's `dialog`'s job). Alert has no Base UI primitive:
every part is a plain styled `div`, and the root carries `role="alert"` so
assistive tech announces it when it mounts.

Composition: `Alert` (root) → `AlertTitle` (optional), `AlertDescription`
(optional), `AlertAction` (optional, top-right corner). A leading `<svg>`
as `Alert`'s first child switches the layout to two columns — icon on the
left spanning both rows, title/description on the right — detected
structurally, no prop to set.

## When to use

- A status message tied to the current page/section (form-wide validation
  summary, a one-time notice, a "here's what changed" banner).
- Pairing a short instruction with an optional action (`AlertAction`) the
  user can take right there, without leaving the page.

## When not to use

- A blocking message the user must dismiss before continuing — use
  `dialog`.
- A transient, self-dismissing notification — use `toast`.
- A field-level validation message tied to one control — use `Field`'s
  `FieldError`.

## Props (kit level)

`Alert`:

| Prop | Type | Default |
|------|------|---------|
| `variant` | `'default' \| 'destructive'` | `'default'` |
| `className` | `string` — merged after the variant class | — |

`AlertTitle`, `AlertDescription`, and `AlertAction` take no kit-specific
props — every prop is the underlying `<div>`'s props, forwarded as-is.

## Examples

```tsx
import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from '@gears-frontx/ui-kit';

// Plain status message
<Alert>
  <AlertTitle>Update available</AlertTitle>
  <AlertDescription>A new version is ready to install.</AlertDescription>
</Alert>

// With a leading icon (switches to the two-column layout) and an action
<Alert variant="destructive">
  <WarningIcon />
  <AlertTitle>Payment failed</AlertTitle>
  <AlertDescription>We couldn't charge your card ending in 4242.</AlertDescription>
  <AlertAction>
    <Button size="sm" variant="outline">Retry</Button>
  </AlertAction>
</Alert>
```

## Anti-patterns

- Do not put more than one leading icon — the two-column layout is
  detected off `Alert`'s *first* direct `<svg>` child; a second one just
  renders as a second grid item, not a second icon column.
- Do not rely on `AlertAction`'s corner position for anything but a single
  compact action (a button, an icon button) — it reserves a fixed amount
  of padding on the alert's right edge, not a layout that grows with wider
  content.
- Do not use `Alert` for anything the user must acknowledge before
  proceeding — it has no dismiss/focus-trap behavior; that's `dialog`.
