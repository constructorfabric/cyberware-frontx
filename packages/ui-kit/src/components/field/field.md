# Field

A primitive-free, 10-part form-layout system — a faithful port of
[shadcn/ui's base Field](https://ui.shadcn.com/docs/components/base/field).
Nothing here is a Base UI primitive and nothing wires ids, `htmlFor`, or
`aria-describedby` automatically — you connect `FieldLabel`'s `htmlFor` to
the control's `id`, and a description/error's `id` to the control's
`aria-describedby`, by hand. That is the trade-off of this port: it buys
upstream's richer layout vocabulary (orientation, grouping, legends,
separators) at the cost of any automatic wiring.

## Parts

- **`Field`** — the field root (`role="group"`). `orientation`:
  `vertical` (default, stacked), `horizontal` (label beside control), or
  `responsive` (stacked until its `FieldGroup` ancestor has room, then
  horizontal — see below).
- **`FieldLabel`** — the kit `Label`, styled for this composition. Wire
  `htmlFor` to the control's `id` yourself.
- **`FieldDescription`** — helper text under/above the control. Wire its
  `id` to the control's `aria-describedby` yourself.
- **`FieldError`** — validation message(s), `role="alert"`. Pass `children`
  directly, or an `errors` array (`{ message }[]`, e.g. from a form
  library) — deduped by message, rendered as plain text for one error or a
  bulleted list for several. Renders nothing when there is no content.
- **`FieldContent`** — wraps a `FieldTitle` + `FieldDescription` pair
  beside a control in `horizontal`/`responsive` orientation (e.g. a
  Switch with its own title and description).
- **`FieldTitle`** — a label-weight caption for the `FieldContent` case
  above (not a `<label>` — it doesn't associate with a control).
- **`FieldGroup`** — wraps one or more `Field`s; also the container-query
  root a `responsive` `Field` measures against (its own inline size, not
  the viewport).
- **`FieldSet`** / **`FieldLegend`** — a native `<fieldset>`/`<legend>`
  pair for a titled group of fields (e.g. a radio set). `FieldLegend`'s
  `variant` is `legend` (default, heading-weight) or `label` (reads as a
  plain field label instead of a section title).
- **`FieldSeparator`** — a labelled divider between groups (e.g. "or
  continue with"), built on the kit's own `Separator`.

`data-invalid`/`data-disabled` on `Field` are plain attributes you set —
this file derives no validation or disabled state of its own. Set them (or
`aria-invalid`/`disabled` directly on the control) based on whatever
validation your form actually runs.

## When to use

- Every labelled control in a form — this is the kit's only form-layout
  system; wire ids by hand as shown below.

## When not to use

- Purely decorative text next to a control that is not its label or
  description — that's plain markup, not `FieldDescription`.

## Props (kit level)

`Field`:

| Prop | Type | Default |
|------|------|---------|
| `orientation` | `vertical` \| `horizontal` \| `responsive` | `vertical` |
| `className` | `string` — merged after the orientation class | — |

`FieldLegend`:

| Prop | Type | Default |
|------|------|---------|
| `variant` | `legend` \| `label` | `legend` |

`FieldError`:

| Prop | Type | Default |
|------|------|---------|
| `errors` | `Array<{ message?: string } \| undefined>` — ignored when `children` is passed | — |

All other props on every part are the underlying native element's props
(`FieldSet` → `<fieldset>`, `FieldLegend` → `<legend>`, `FieldLabel` →
`Label`'s props, `FieldDescription` → `<p>`, `FieldError`/`FieldContent`/
`FieldGroup`/`FieldSeparator`/`FieldTitle` → `<div>`) and are forwarded
as-is.

## Examples

```tsx
import { Field, FieldDescription, FieldError, FieldLabel, Input } from '@gears-frontx/ui-kit';

// Manual id/htmlFor/aria-describedby wiring — this port does none of it for you
<Field>
  <FieldLabel htmlFor="email">Email</FieldLabel>
  <Input id="email" type="email" required aria-describedby="email-desc" />
  <FieldDescription id="email-desc">We only use it for the invoice.</FieldDescription>
</Field>

// External validation
<Field data-invalid={Boolean(serverError)}>
  <FieldLabel htmlFor="slug">Slug</FieldLabel>
  <Input id="slug" value={slug} onValueChange={setSlug} aria-invalid={Boolean(serverError)} />
  {serverError && <FieldError>{serverError}</FieldError>}
</Field>
```

```tsx
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle,
  Switch,
} from '@gears-frontx/ui-kit';

// Grouped, responsive fields — horizontal once the surrounding FieldGroup has room
<FieldGroup>
  <FieldSet>
    <FieldLegend variant="label">Notifications</FieldLegend>
    <Field orientation="responsive">
      <FieldContent>
        <FieldTitle>Product updates</FieldTitle>
        <FieldDescription>Release notes and roadmap changes.</FieldDescription>
      </FieldContent>
      <Switch />
    </Field>
  </FieldSet>
</FieldGroup>
```

## Anti-patterns

- Do not expect `id`/`htmlFor`/`aria-describedby` to wire themselves — this
  port deliberately does none of that; wire them by hand, every time.
- Do not put two controls in one `Field` — one field, one control.
- Do not render validation text outside `FieldError` — screen readers
  lose the association if you don't also wire `aria-describedby` yourself.
