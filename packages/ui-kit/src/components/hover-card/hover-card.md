# HoverCard

A portalled preview panel that opens when its trigger is hovered or
focused. Wraps Base UI's `PreviewCard` primitives (`@base-ui/react/preview-card`)
under the upstream `hover-card` name — the kit component name follows
shadcn/ui's registry, not the Base UI primitive it wraps. Positioning,
portalling, hover/focus interaction, and Escape/outside-press dismissal
come from Base UI.

Composition: `HoverCard` (root, holds open state) → `HoverCardTrigger`
(renders an `<a>`) → `HoverCardContent` (portals and positions a caret-less
card against the trigger).

## When to use

- A preview of something the trigger links to — a user's profile behind
  their `@handle`, a summary of a referenced document — where following the
  link is the primary action and the card is a low-commitment preview of
  it.

## When not to use

- An icon-only control revealing supplementary text with no link of its
  own — use `tooltip`.
- Content the user opens deliberately by clicking — use `popover`.
- A menu of actions — use `dropdown-menu`.

## Props (kit level)

`HoverCard` (root): `open` / `defaultOpen`, `onOpenChange`,
`onOpenChangeComplete`, `handle` (for a trigger placed outside the root,
see Base UI's detached-trigger pattern) — see Base UI PreviewCard.Root.

`HoverCardTrigger`: `delay` (ms before opening on hover, Base UI default
`600`), `closeDelay` (ms before closing, default `300`). Renders a native
`<a>` — pass `href`, or `render` to compose your own link/router component.

`delay` is measured as hover intent — the timer runs from pointer movement
over the trigger, not from entry, so sweeping the cursor past the trigger
without pausing won't open it. (In tests, dispatch a `mousemove` after
`mouseenter` to arm it.)

`HoverCardContent`:

| Prop | Type | Default |
|------|------|---------|
| `side` | `top` \| `bottom` \| `left` \| `right` \| `inline-start` \| `inline-end` | `bottom` |
| `align` | `start` \| `center` \| `end` | `center` |
| `sideOffset` / `alignOffset` | `number` | `4` / `4` |
| `container` | DOM node to portal the popup into | `<body>` |
| `positionMethod` | `absolute` \| `fixed` — pass `fixed` when the trigger sits inside a `transform`/`filter` container | `absolute` |
| `collisionBoundary` / `collisionPadding` | see Base UI PreviewCard.Positioner — bound and pad the flip/shift collision logic | viewport / `5` |
| `className` | `string` — merged after the kit class | — |

The popup portals to `<body>` by default, so if your theme lives on a
subtree (`data-theme` on a section instead of `<html>`), pass that section
as `container` or the popup renders with the root theme — same contract as
`Dialog`/`Tooltip`/`Popover`/`DropdownMenu`.

## Examples

```tsx
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@gears-frontx/ui-kit';

<HoverCard>
  <HoverCardTrigger href="/users/shadcn">@shadcn</HoverCardTrigger>
  <HoverCardContent>
    The React Framework – created and maintained by @shadcn.
  </HoverCardContent>
</HoverCard>;
```

## Anti-patterns

- Do not put content in a hover card that a touch or keyboard-only (non-
  focus) user needs to complete a task — hover has no touch equivalent;
  keep the trigger's own link/action meaningful on its own so those users
  lose only the preview, not the functionality.
- Do not use `HoverCard` in place of `Tooltip` for a plain supplementary
  label — a hover card's trigger is expected to be a link or reference, not
  an arbitrary icon.
