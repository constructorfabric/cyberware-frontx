# Input

A single-line text field. Wraps the Base UI Input primitive: a native
`<input>`.

## When to use

- Any single-line free-text value: names, emails, search queries, numbers,
  file uploads (`type="file"`).
- Inside `Field`, with `id`/`aria-describedby` wired by hand — the kit has
  no component that wires label association or validation display
  automatically (see field.md).

## When not to use

- Multi-line text — use `textarea`.
- Picking from a fixed set of options — use `select`, `radio-group`, or
  `checkbox`.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `value` / `defaultValue` | controlled / uncontrolled value | — |
| `onValueChange` | `(value: string, eventDetails) => void` — fires on every change | — |
| `icon` | `ReactNode` — leading icon slot, decorative (`aria-hidden`, no pointer events); pair with the right native `type` for semantics | — |
| `end` | `ReactNode` — trailing slot for live content (icon-button, adornment); rendered after the input, sized for an icon or a compact `size="sm"` icon-only Button | — |
| `className` | `string` — merged after the kit class | — |

All other props are native `<input>` props (`type`, `placeholder`,
`disabled`, `required`, `aria-invalid`, ...) and are forwarded as-is.
`aria-invalid` switches the border and ring to the destructive color.

Icons are explicit: `icon` draws a leading icon inside the field (via a
presentational wrapper the component adds only when a slot is present),
`end` overlays trailing content such as a clear button. Semantics still
come from the native `type` — a search field is `type="search"` (searchbox
role) plus a magnifier passed to `icon`; nothing renders automatically.
A disabled input dims its `icon` and `end` slots too (0.42 opacity) — a
clear button left in `end` doesn't stay visually live just because it isn't
the native control. Removing `end`'s tab stop is a separate fix: passing
`disabled` straight to `Input` also sets `inert` on the `end` wrapper,
which drops it from the tab order and blocks activation — the actual fix
for a keyboard user, since dimming alone (`pointer-events: none`) only
disarms the mouse. Both the dimming and the `inert` only fire from this
direct `disabled` prop — the kit's `Field` wires no disabled state of its
own (see field.md), so there is no other path to observe. Consumers who
disable a field through their own state should pass `disabled` straight to
`Input` (and to any interactive `end` content) rather than relying on
anything upstream.

## File inputs

`type="file"` keeps the same field box as any other Input; the browser's
file-selector button inside it is styled to match, per upstream: no border,
no fill, `Label` typography at the label weight, and `--control-height-sm`
(one step below the field) so it sits inside the field's padding rather
than against its border. The kit also zeroes the UA's own padding/margin on
that pseudo-element — the kit ships no preflight, so without that reset the
browser's defaults indent the button past the field's padding. The filename
text beside it is the input's own value text and is not separately
styleable. Consumers who need a different affordance (a drop zone, a real
Button that proxies the click) build it themselves; this is the plain
native control, dressed.

## Examples

```tsx
import { Input } from '@gears-frontx/ui-kit';

// Uncontrolled with placeholder
<Input placeholder="Project name" />

// Search field: the native type brings the searchbox role, the icon slot
// brings the magnifier, and `end` can hold a clear button
<Input
  type="search"
  placeholder="Search projects…"
  icon={<MagnifierIcon />}
  end={<Button variant="ghost" size="sm" icon={<CrossIcon />} aria-label="Clear" />}
/>

// Controlled
<Input value={email} onValueChange={setEmail} type="email" />

// Invalid state (set by hand from your form's validation)
<Input aria-invalid={true} defaultValue="not-an-email" />

// Disabled
<Input disabled value="read only for now" />
```

## Anti-patterns

- Do not use `onChange` + `event.target.value` when `onValueChange` is
  enough — it hands you the string directly.
- Do not restyle via inline `style` — sizing/spacing tweaks belong to layout
  containers, colors to theme tokens.
- Do not expect label/error/description wiring for free — pair `Input`
  with `Field` and wire `id`/`aria-describedby` yourself (see field.md).
- Do not put an interactive control in `icon` — that slot is aria-hidden
  and pointer-transparent; live content goes in `end`.
