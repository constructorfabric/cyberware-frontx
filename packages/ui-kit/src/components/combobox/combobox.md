# Combobox

A filterable text field for picking from a list, wrapping Base UI's
dedicated `Combobox` primitive (not a Popover+search composition). The
input itself displays and edits the current value; the popup filters as
you type. Portalled, keyboard navigation, typeahead-by-typing, and form
submission (hidden native input on the root) come from Base UI.

Composition, single-select: `Combobox` (root, holds the value) →
`ComboboxInput` (the field itself; renders its own trailing trigger/clear
buttons) → `ComboboxContent` → `ComboboxEmpty` / `ComboboxList` /
`ComboboxItem` — `ComboboxGroup` / `ComboboxLabel` / `ComboboxSeparator`
for grouped lists. `ComboboxContent` does not wrap its children in a list
the way `SelectContent` does — place `ComboboxEmpty` and `ComboboxList` as
its direct children yourself, so an empty-results message can sit
alongside (not inside) the scrolling list.

Composition, multi-select: swap `ComboboxInput` for `ComboboxChips` (a
container of `ComboboxChip` pills plus a trailing `ComboboxChipsInput`),
and anchor the popup to the chips instead of a single-line field with
`useComboboxAnchor()`.

## When to use

- A single value from a long or unbounded list, filterable by typing —
  the list a `select` covers by scrolling doesn't fit a combobox until it
  is long enough that typing beats scrolling.
- Multiple values from a list, shown as removable chips (`multiple`).

## When not to use

- 2–6 always-visible options — use `radio-group`.
- A short, non-searchable list — use `select`; a combobox invites typing a
  query that doesn't need to exist.

## Props (kit level)

`Combobox` (root): `value` / `defaultValue`, `onValueChange`, `multiple`,
`name`, `disabled`, `required`, `autoHighlight` — see Base UI
`Combobox.Root`. Always pass `items` as well: without it, filtering and
the built-in label/value stringification (for `{ value, label }`-shaped
items) don't run.

`ComboboxInput`:

| Prop | Type | Default |
|------|------|---------|
| `showTrigger` | `boolean` — renders the trailing chevron button that opens the popup | `true` |
| `showClear` | `boolean` — renders a trailing clear button once a value is chosen. Base UI only mounts it while there's something to clear, and it visually replaces the trigger in the same corner rather than the two ever stacking | `false` |
| `toggleLabel` | `string` — accessible name for the chevron button | `'Toggle options'` |
| `clearLabel` | `string` — accessible name for the clear button | `'Clear value'` |
| `className` | `string` — merged after the kit class | — |

Both trailing buttons are icon-only, so those two labels ARE their
accessible names — override them for any language but English, the same
way `Dialog`'s `closeLabel` and `SidebarTrigger`'s `label` work.

`ComboboxContent` accepts positioning props (`side`, `sideOffset`,
`align`, `alignOffset`, `anchor`, plus the escape hatch for fields inside a
`transform`/`filter` container: `positionMethod="fixed"`,
`collisionBoundary`, `collisionPadding`) and `container` — the popup
portals to `<body>` by default, so if your theme lives on a subtree
(`data-theme` on a section instead of `<html>`), pass that section as
`container` or the popup renders with the root theme. `ComboboxItem` takes
`value` (required) and `disabled`. `aria-invalid` on `ComboboxInput` (or
`ComboboxChips`, for multi-select) switches its border and ring to the
destructive color.

`ComboboxChip` takes `showRemove` (`boolean`, default `true`) to omit the
remove button on a fixed/read-only chip, and `removeLabel` (`string`,
default `'Remove'`) for that button's accessible name — worth naming the
chip itself (`removeLabel={`Remove ${label}`}`) once a form carries
several.

## Examples

Single-select, filterable, with groups:

```tsx
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
} from '@gears-frontx/ui-kit';

const TIMEZONES = [
  { value: 'europe', label: 'Europe', items: ['Frankfurt', 'Dublin'] },
  { value: 'americas', label: 'Americas', items: ['Virginia', 'Oregon'] },
];

<Combobox items={TIMEZONES}>
  <ComboboxInput aria-label="Timezone" placeholder="Select a timezone" showClear />
  <ComboboxContent>
    <ComboboxEmpty>No timezones found.</ComboboxEmpty>
    <ComboboxList>
      {(group) => (
        <ComboboxGroup key={group.value} items={group.items}>
          <ComboboxLabel>{group.label}</ComboboxLabel>
          {group.items.map((item) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          ))}
        </ComboboxGroup>
      )}
    </ComboboxList>
  </ComboboxContent>
</Combobox>
```

Multi-select, chips:

```tsx
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@gears-frontx/ui-kit';

function FrameworkPicker() {
  const anchor = useComboboxAnchor();
  return (
    <Combobox multiple items={FRAMEWORKS}>
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(values: string[]) =>
            values.map((value) => (
              <ComboboxChip key={value}>{value}</ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput aria-label="Frameworks" placeholder="Add a framework" />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No frameworks found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
```

## Not ported from upstream

Upstream's own `combobox.tsx` (the shadcn/ui base-variant registry file
this was ported from) surfaces only a subset of Base UI's Combobox
primitive. Skipped for the same reason upstream skips them — no kit API
exists beyond what upstream demonstrates:

- `Combobox.Row` / `virtualized` — virtualized/grid list rendering.
- `Combobox.Status` — a live-region announcer separate from `Empty`.
- `Combobox.Backdrop` / `Combobox.Arrow` / `Combobox.Icon` — upstream
  renders no modal backdrop, no positioner arrow, and inlines its chevron
  as a plain child rather than through the `Icon` part.
- `Combobox.InputGroup` (the Base UI part, distinct from the unrelated
  shadcn `input-group` registry component upstream actually composes
  with) — never referenced by upstream's own source.
- `useFilter` / `useFilteredItems` — upstream relies on `Combobox.Root`'s
  built-in filtering (pass `items`); these hooks are for externally
  controlled filtering, which upstream's example never does.
- A standalone `Clear` export — upstream defines `ComboboxClear` but does
  not export it from its file; it only appears composed into its
  `ComboboxInput` via `showClear`, which this kit mirrors exactly.

`ComboboxInput`'s field text also skips the literal-1rem/1.5rem small-screen
step `input.module.css`/`textarea.module.css` drop to below the desktop
breakpoint (an iOS Safari focus-zoom guard) — that pattern depends on a
`tokens.test.ts` `EXCEPTIONS` entry naming the file, and this port is out of
scope to add `combobox.module.css`'s own entry to that list. `.input` uses
the Studio/Label token metrics unconditionally instead, same as this kit's
button-based triggers (which never had the zoom problem to begin with).

## Anti-patterns

- Do not use a combobox for navigation — that is a menu/link pattern.
- Do not omit `items` — without it, object-shaped values render as
  `[object Object]` in the field instead of their label.
