# Popover

A portalled panel anchored to a trigger, opened by click by default. Wraps
the Base UI Popover primitives; positioning, portalling, and Escape/
outside-press dismissal come from Base UI. Unlike `dialog`, a popover is
non-modal by default: it does not trap focus or lock page scroll, and does
not render a backdrop.

Composition: `Popover` (root, holds open state) → `PopoverTrigger` →
`PopoverContent` (portals and positions `PopoverHeader` / `PopoverTitle` /
`PopoverDescription` / consumer content against the trigger).

## When to use

- A focused piece of UI anchored to a control — a filter panel, a settings
  form for one field, a small piece of interactive content the user opens
  deliberately.

## When not to use

- A menu of actions — use `dropdown-menu`.
- A supplementary, non-interactive hint — use `tooltip`.
- Content revealed on hover rather than click, where the trigger's own
  purpose is only to preview something (e.g. a user's profile card behind
  their name) — use `hover-card`.
- A focused task that should block the rest of the page — use `dialog`.

## Props (kit level)

`Popover` (root): `open` / `defaultOpen`, `onOpenChange`,
`onOpenChangeComplete`, `modal` (`false` default; `true`; `'trap-focus'`),
`handle` (for a trigger placed outside the root, see Base UI's
detached-trigger pattern) — see Base UI Popover.Root.

`PopoverTrigger`: `openOnHover` (`false` default — pass `true` to also open
on hover, e.g. an info icon whose only job is revealing more text), `delay`
/ `closeDelay` (ms, only meaningful with `openOnHover`; Base UI defaults
`300`/`0`). Renders a native `<button>`.

`PopoverContent`:

| Prop | Type | Default |
|------|------|---------|
| `side` | `top` \| `bottom` \| `left` \| `right` \| `inline-start` \| `inline-end` | `bottom` |
| `align` | `start` \| `center` \| `end` | `center` |
| `sideOffset` / `alignOffset` | `number` | `4` / `0` |
| `container` | DOM node to portal the popup into | `<body>` |
| `positionMethod` | `absolute` \| `fixed` — pass `fixed` when the trigger sits inside a `transform`/`filter` container | `absolute` |
| `collisionBoundary` / `collisionPadding` | see Base UI Popover.Positioner — bound and pad the flip/shift collision logic | viewport / `5` |
| `className` | `string` — merged after the kit class | — |

The popup portals to `<body>` by default, so if your theme lives on a
subtree (`data-theme` on a section instead of `<html>`), pass that section
as `container` or the popup renders with the root theme — same contract as
`Dialog`/`Tooltip`/`DropdownMenu`.

## Examples

```tsx
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@gears-frontx/ui-kit';

<Popover>
  <PopoverTrigger render={<Button variant="outline">Open popover</Button>} />
  <PopoverContent>
    <PopoverHeader>
      <PopoverTitle>Dimensions</PopoverTitle>
      <PopoverDescription>Set the dimensions for the layer.</PopoverDescription>
    </PopoverHeader>
  </PopoverContent>
</Popover>;
```

## Anti-patterns

- Do not use `Popover` for a fly-out list of actions — `dropdown-menu`
  ships the role, keyboard navigation, and item variants for that.
- Do not skip `modal={true}` (or `'trap-focus'`) when the popover's own
  content needs to trap focus (a small form the user must complete before
  moving on) — the default is intentionally non-modal.
