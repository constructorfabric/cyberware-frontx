# InputGroup

Composes an `Input`/`Textarea` with icon, text, and button addons into one
visually unified field — the group draws the border, background, focus ring
and error border; the wrapped control draws none of its own. No Base UI
primitive backs it — pure styling composition over `Input`/`Textarea`/
`Button`.

The group is `--control-height-lg` tall, the same as a standalone `Input`,
so a group and a plain field line up in the same form. A `block-start`/
`block-end` addon or a wrapped `Textarea` grows it past that floor.

## When to use

- A field with a fixed prefix/suffix (`$`, `.com`, a unit).
- A field with an attached action that shares the field's own border (a
  clear button, a copy button, a password reveal toggle).

## When not to use

- A single leading icon or one small trailing action — `Input`'s own
  `icon`/`end` slots are simpler and don't need the extra parts here.
- Joining independent, differently-sized controls (not one logical field) —
  use `ButtonGroup` instead.

## Parts

| Part | Renders | Notes |
|------|---------|-------|
| `InputGroup` | `<div role="group">` | Draws the field chrome |
| `InputGroupAddon` | `<div role="group">` | Icon/text/button cluster; click focuses the field |
| `InputGroupButton` | `Button` | Compact ghost button, `xs` by default |
| `InputGroupText` | `<span>` | Static label/icon, not clickable |
| `InputGroupInput` | `Input` | Border/background stripped — the group draws them |
| `InputGroupTextarea` | `Textarea` | Same stripping, plus `resize: none` |

## Props (kit level)

`InputGroupAddon`:

| Prop | Type | Default |
|------|------|---------|
| `align` | `inline-start` \| `inline-end` \| `block-start` \| `block-end` | `inline-start` |

`InputGroupButton`:

| Prop | Type | Default |
|------|------|---------|
| `size` | `xs` \| `sm` | `xs` |
| `variant` | every `Button` variant | `ghost` |
| `type` | `button` \| `submit` \| `reset` | `button` |

`InputGroupInput`/`InputGroupTextarea` forward every `Input`/`Textarea`
prop unchanged.

## States

The group reads these off the wrapped control, so they are set on
`InputGroupInput`/`InputGroupTextarea`, never on `InputGroup` itself:

| State | Set by | Result |
|-------|--------|--------|
| Focus | the control taking `:focus-visible` | `--ring` border + inset ring on the GROUP |
| Error | `aria-invalid` on the control | `--destructive` border + inset ring on the group |
| Disabled | `disabled` on the control | the whole group dims to 0.42, once |

A disabled `InputGroupButton` inside an addon dims only itself — a dead
action is not a dead field.

## Layout

`inline-start`/`inline-end` addons share the field's row; `block-start`/
`block-end` addons take a full-width row above/below it. Both axes can be
used in the same group (upstream's flex-column switch supports only one at
a time). An inline addon absorbs the field's inset on its own side, so the
text stays flush with where a standalone `Input` would put it.

## Implementation note

Upstream offers `InputGroupButton` sizes `xs`/`sm`/`icon-xs`/`icon-sm`.
This port keeps `xs` and `sm` and drops the two icon-only twins: "icon-only"
is a state `Button` derives from its own `icon` prop with no `children`, and
it squares up whatever size is active (see button.tsx). So upstream's
`size="icon-xs"` is this kit's
`<InputGroupButton icon={<XIcon />} aria-label="Clear" />`.

`xs` sits one step below the kit's smallest control height and is composed
from it (`--control-height-sm` minus `--space-2`) rather than hardcoded, so
retuning the control scale keeps the relationship. Inside a group the
button's focus ring also draws at a tighter offset than the kit's default —
the standard 2px standoff overshoots the group's own border.

## Examples

```tsx
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '@gears-frontx/ui-kit';

// Prefixed amount field
<InputGroup>
  <InputGroupAddon>
    <InputGroupText>$</InputGroupText>
  </InputGroupAddon>
  <InputGroupInput type="number" placeholder="0.00" aria-label="Amount" />
</InputGroup>

// Search field with a leading icon and a trailing shortcut hint
<InputGroup>
  <InputGroupAddon>
    <SearchIcon />
  </InputGroupAddon>
  <InputGroupInput type="search" placeholder="Search" aria-label="Search" />
  <InputGroupAddon align="inline-end">
    <Kbd>⌘K</Kbd>
  </InputGroupAddon>
</InputGroup>

// Search field with a trailing clear button (icon-only, xs)
<InputGroup>
  <InputGroupInput placeholder="Search" aria-label="Search" />
  <InputGroupAddon align="inline-end">
    <InputGroupButton icon={<XIcon />} aria-label="Clear" onClick={clear} />
  </InputGroupAddon>
</InputGroup>

// Multi-line field with a helper/toolbar row underneath
<InputGroup>
  <InputGroupTextarea placeholder="Notes" aria-label="Notes" />
  <InputGroupAddon align="block-end">
    <InputGroupText>0/280</InputGroupText>
  </InputGroupAddon>
</InputGroup>

// Error state — aria-invalid on the control, the group draws the border
<InputGroup>
  <InputGroupAddon>
    <InputGroupText>@</InputGroupText>
  </InputGroupAddon>
  <InputGroupInput aria-label="Email" aria-invalid aria-describedby="email-error" />
</InputGroup>
```

## Anti-patterns

- Do not put more than one focusable field inside a single `InputGroup` —
  it is one logical field with one set of addons, not a mini form.
- Do not put `aria-invalid` or `disabled` on `InputGroup` itself — the
  group reads both off the control, and neither means anything on a `div`.
- Do not rely on `InputGroupAddon`'s click-to-focus for anything other than
  padding around static content — a button inside the addon keeps its own
  click handling; the addon's own `onClick` only forwards, it does not
  suppress the button's.
