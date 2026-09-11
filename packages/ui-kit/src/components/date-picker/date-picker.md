# DatePicker

A field that opens a `Calendar` in a `Popover` to pick a day or a range.

## Upstream is a recipe, not a component — this is a deviation

shadcn/ui ships this as a documentation recipe
([date-picker.mdx](https://ui.shadcn.com/docs/components/base/date-picker)),
not a registry item: "A date picker is built from `Popover` and `Calendar`
— there is no `DatePicker` root component." The doc shows five hand-rolled
variants (a plain trigger, a range trigger, a dropdown-caption date-of-birth
variant, a typed-input variant, a time variant) that a consumer copies and
adapts per use.

This port productizes the recipe into one real, importable component
instead: `DatePicker` keeps the recipe's own prop names (`selected`,
`onSelect`, `mode`, `captionLayout`) so the composition is recognizable to
anyone who has read the upstream doc, but a consumer imports it rather than
re-copying the Popover/Calendar/Button wiring for every date field in an
app. See "Deviations from upstream" below for what the productization
narrows or drops relative to the doc's five variants.

## When to use

- A form field or filter where the value is a single day or a date range
  and a grid picker is the intended input method, not free typing.
- Reach for `Calendar` directly instead when the calendar should sit inline
  on the page (a dashboard's own date panel) rather than behind a trigger.

## Props

`mode` discriminates `selected`/`onSelect`'s type, mirroring `Calendar`'s
own `DayPicker` underneath:

| Prop | Type | Default |
|------|------|---------|
| `mode` | `single` \| `range` | `single` |
| `selected` | `Date \| undefined` (single) or `DateRange \| undefined` (range) | — (required) |
| `onSelect` | `(value) => void`, typed to match `selected` | — (required) |
| `variant` | `button` \| `input` — **single mode only**, see below | `button` |
| `placeholder` | `string` | `'Pick a date'` |
| `captionLayout` | `label` \| `dropdown` \| `dropdown-months` \| `dropdown-years` — forwarded to `Calendar` | `label` |
| `numberOfMonths` | `number` — **range mode only** | `2` |
| `closeOnSelect` | `boolean` — close the popover once a day is picked | `true` (single) / `false` (range) |
| `disabled` | `Calendar`'s own `disabled` matcher | — |
| `locale` | date-fns `Locale` — the month grid, the trigger label, AND the `input` variant's formatting and parsing | date-fns' default (en-US) |
| `openCalendarLabel` | `string` — accessible name for the `input` variant's calendar button | `'Open calendar'` |
| `open` / `defaultOpen` / `onOpenChange` | `Popover`'s own open-state props | — |
| `container` | Portal container, forwarded to `PopoverContent` | — |
| `className` / `id` / `aria-label` | Forwarded to the trigger (`button` variant) or the field (`input` variant) | — |

`variant`'s two values map to two of upstream's five recipe flavors:

- `button` (default) — upstream's date-picker-demo/-basic/-dob recipes: a
  `Button` trigger showing the formatted date (`date-fns`'s `PPP`/
  `LLL dd, y` formats), or the placeholder in `--muted-foreground` when
  empty.
- `input` — upstream's date-picker-input recipe: a free-typed `Input` with
  a calendar-icon `Button` in its `end` slot (see input.md's slot docs).
  The field accepts one format, the one it displays — a full
  `"June 01, 2025"` (long month, day, four-digit year, in `locale`) — and
  commits only when what is typed is a complete, real date in it. Nothing
  reaches `onSelect` on the way there. `ArrowDown` opens the calendar
  without reaching for the trailing button.

## Definition of done

- **Single mode**: one day selected, trigger/field reflects it, `Calendar`
  opens on the month containing the selection.
- **Range mode**: `numberOfMonths={2}` by default so both the start and end
  month are visible without navigating; the trigger shows
  `"{from} - {to}"` once both ends are picked, just the start date while
  only `from` is set, and the placeholder while empty.
- **Dropdown caption**: `captionLayout="dropdown"` reproduces upstream's
  date-of-birth recipe — pass it through untouched, `Calendar` does the
  rest (see calendar.md).
- **Typed input**: the `input` variant's text buffer is independent of the
  committed `selected` value, so typing is never reverted or reformatted
  under the caret — but it resyncs automatically when `selected` changes
  from OUTSIDE the field (an external reset, a value arriving late).
- **Visible month follows the selection.** Opening the popover lands on
  the month of the current `selected` (the range's start, in range mode),
  including a selection that arrived after mount; the user's own month
  navigation then takes over until `selected` changes again.
- **Popover chrome**: the calendar sits in a padding-free popup (upstream's
  `className="w-auto p-0"`) — `Calendar` supplies its own spacing, so
  `Popover`'s own default padding would double up with it.

## Examples

```tsx
import { DatePicker } from '@gears-frontx/ui-kit';

// Single date, button trigger (the default)
const [date, setDate] = useState<Date>();
<DatePicker selected={date} onSelect={setDate} />

// Typed field with a calendar-icon affordance
<DatePicker variant="input" selected={date} onSelect={setDate} placeholder="June 01, 2025" />

// Date range, two months
const [range, setRange] = useState<DateRange>();
<DatePicker mode="range" selected={range} onSelect={setRange} />

// Date of birth: dropdown month/year navigation, closes on pick
<DatePicker
  selected={date}
  onSelect={setDate}
  captionLayout="dropdown"
  placeholder="Select date"
/>
```

## Deviations from upstream

- **One component, not five copy-pasted recipes.** `mode` and `variant`
  cover four of upstream's five flavors (demo/basic, range, dob, input);
  the fifth (a natural-language `chrono-node` parser) is out of scope —
  it is a third-party NLP dependency, and no other kit component pulls in
  a parsing library for one input mode.
- **`variant="input"` is single-mode only** — no ranged free-typed field
  is productized, since upstream's own recipe set has no such example to
  port from (its input recipe is single-date).
- **The typed-input parse is strict where upstream's is not.** Upstream's
  recipe reads the field with `new Date(string)`, which accepts far more
  than the format it displays and invents the rest: a half-typed
  `"June 7"` is a valid Date to V8 — June 7th of 2001 — so every prefix
  on the way to a real date commits a different wrong year. This port
  parses the display format with `date-fns` instead and commits nothing
  until the whole of it is there, four-digit year included. Same accepted
  format (`"June 01, 2025"`, now localized by `locale`), no guessing.
- **No `Field`/`FieldLabel` wrapper.** Upstream's basic/range/dob recipes
  wrap the whole picker in a `Field` with a fixed width and a label; this
  component is the picker alone; a consumer wires its own `Field`
  composition around it exactly the way `Input`/`Select` expect, rather
  than `DatePicker` hard-coding one label pattern (`Field`'s own port has
  no automatic label wiring either — see field.md).
