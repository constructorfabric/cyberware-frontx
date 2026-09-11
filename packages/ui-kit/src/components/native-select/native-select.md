# NativeSelect

A real `<select>`, styled to match the kit's field chrome. No Base UI
primitive backs it (there is no Base UI NativeSelect) — this is pure
styling translation over native markup, the same shape as `Table`.

## When to use

- A choice list where the platform's own native picker (OS-drawn options,
  keyboard-typeahead, mobile wheel picker) is preferable to a custom popup —
  long lists, forms optimized for mobile, or anywhere `Select`'s Base UI
  popup would be overkill.
- Progressive-enhancement contexts (no-JS forms, SSR fallbacks) where a
  real `<select>` must keep working without a popup primitive.

## When not to use

- Custom item content (icons, descriptions, groups with rich styling) —
  `<option>` cannot render arbitrary markup; use `Select` instead.

## Sizing

The wrapper declares no `width` of its own — standalone it shrinks to fit
its content (a plain `inline-flex` box with `width: auto` sizes the same
way `inline-block` does), and inside a vertical `Field` it stretches to
fill the field (a flex column's default `align-items: stretch` only takes
effect on a child whose own width is `auto`, which `field.module.css`'s
`.orientationVertical` relies on for every field control). Both behaviors
fall out of ordinary CSS layout, not a rule written to detect either case —
so the wrapper also stretches inside any other stretch-inducing ancestor
(e.g. a bare grid row), matching `Input`'s own always-`width: 100%` chrome
rather than introducing a NativeSelect-specific exception.

This replaced an explicit `width: fit-content` that fought
`field.module.css`'s `.orientationVertical > * { width: 100% }` for the
win at equal (0-1-0) specificity — a collision resolved only by which
stylesheet a consumer's bundler happened to concatenate last. Mirrors
upstream: shadcn's `SelectTrigger` ships its own `w-fit` while `Field`'s
vertical orientation applies `[&>*]:w-full` to its children, the same two
rules on the same node — Tailwind's utility-layer generation order
resolves that deterministically in their build, a guarantee this kit's
CSS Modules don't have. Not declaring a competing width here removes the
collision instead of trying to out-cascade it.

The field height itself is `--control-height-lg` (40px), not
`--control-height-md` — fields sit one step up from the md button, the
same rule `Input`/`Select` already follow (see input.module.css); only
`size="sm"` drops to `--control-height-sm`.

## Props (kit level)

| Prop | Type | Default |
|------|------|---------|
| `size` | `default` \| `sm` | `default` |
| `className` | `string` — merged onto the wrapper | — |

All other props are native `<select>` props (`value`, `onChange`,
`disabled`, `aria-*`, ...) and are forwarded to the `<select>` itself.

`NativeSelectOption` and `NativeSelectOptGroup` are thin styled wrappers
around `<option>`/`<optgroup>` — forward every native prop unchanged.

## Examples

```tsx
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@gears-frontx/ui-kit';

<NativeSelect aria-label="Region" defaultValue="eu">
  <NativeSelectOption value="eu">Europe</NativeSelectOption>
  <NativeSelectOption value="us">Americas</NativeSelectOption>
</NativeSelect>

// Grouped options
<NativeSelect aria-label="Timezone">
  <NativeSelectOptGroup label="Europe">
    <NativeSelectOption value="cet">Central European Time</NativeSelectOption>
  </NativeSelectOptGroup>
</NativeSelect>

// Compact size, disabled
<NativeSelect size="sm" disabled aria-label="Region">
  <NativeSelectOption value="eu">Europe</NativeSelectOption>
</NativeSelect>
```

## Anti-patterns

- Do not reach for this when item content needs more than plain text —
  `Select` is the composable, richly-stylable alternative.
- Do not restyle `<option>`/`<optgroup>` fill/text via the kit's own theme
  tokens — most engines render native popup chrome with OS colors
  regardless of author CSS, which is why this component uses the
  `Canvas`/`CanvasText` system keywords instead (see native-select.module.css).
