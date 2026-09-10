# Calendar

A month grid for picking one day, several days, or a range. Wraps
[react-day-picker](https://daypicker.dev) — the kit ships no calendar
primitive of its own; `date-picker/` composes this component with `Popover`
and `Button`/`Input` for the common "field that opens a calendar" pattern.

## When to use

- Any date or date-range input where a grid picker reads better than typing
  a raw date string — booking a range, scheduling a date, filtering by
  period.
- Reach for `date-picker/`'s `DatePicker` instead of this component directly
  when the calendar should live behind a trigger (field or button) rather
  than sit inline on the page.

## Props (kit level)

Every `DayPicker` prop passes through unchanged (`mode`, `selected`,
`onSelect`, `numberOfMonths`, `disabled`, `locale`, ... — see
[react-day-picker's docs](https://daypicker.dev/api/type-aliases/DayPickerProps)).
The kit only fixes defaults and re-authors the styling surface:

| Prop | Type | Default |
|------|------|---------|
| `showOutsideDays` | `boolean` — render the previous/next month's days that fill out the grid | `true` |
| `captionLayout` | `label` \| `dropdown` \| `dropdown-months` \| `dropdown-years` | `label` |
| `className` | `string` — merged onto the root | — |
| `classNames` | `Partial<ClassNames>` — merged over the kit's own per-slot classes, keyed by react-day-picker's own slot names (`root`, `months`, `day`, `range_start`, ...) | — |

`captionLayout`'s four values split into two visually distinct renders,
both covered by calendar.module.css:

- `label` — a plain "August 2026" text caption (`.captionLabel`).
- `dropdown` / `dropdown-months` / `dropdown-years` — one or both of the
  month/year captions become a clickable chip with a chevron
  (`.captionLabel.captionLabelDropdown`), an invisible native `<select>`
  layered on top of it for the actual interaction.

## Definition of done

- **Selection modes**: `mode="single"` fills the one selected day
  (`--primary`); `mode="range"` fills the start/end days and shades every
  day in between (`--muted`), including outside-of-column corners at a week
  wrap (`.week > .day:first-child:has([data-selected])` /
  `:last-child`, replacing upstream's Tailwind arbitrary-attribute
  selector).
- **Today**: gets a `--muted` cell fill (`.today`) unless it is also
  selected, in which case the selection fill on the day button wins and the
  cell's own rounding is suppressed so the two don't visually double up.
- **Outside days**: `showOutsideDays` renders them dimmed
  (`--muted-foreground`, `.outside`) rather than hidden, so the grid never
  reflows between months.
- **Disabled days**: `.disabled` dims to 50% opacity and the day button
  itself carries the native `disabled` attribute (via react-day-picker),
  so they are unreachable by keyboard, not just visually muted.
- **DayButton**: `CalendarDayButton` (exported, like upstream's
  `CalendarDayButton`) is the default `components.DayButton` — it derives
  `data-selected-single`/`data-range-start`/`data-range-end`/
  `data-range-middle` from react-day-picker's own `modifiers` and moves
  focus onto itself when react-day-picker's roving-tabindex lands on it
  (arrow-key navigation). Pass your own `components.DayButton` to replace
  it, or import `CalendarDayButton` to compose on top of it.
- **Dropdown navigation**: `captionLayout="dropdown"` (and its two partial
  variants) render native month/year `<select>` elements, invisibly
  overlaying the visible chip — the same interop pattern as `select.tsx`'s
  Base UI trigger, applied to a plain `<select>` since react-day-picker
  renders one directly rather than exposing a styleable primitive.

## Examples

```tsx
import { Calendar } from '@gears-frontx/ui-kit';

// Single day
const [date, setDate] = useState<Date>();
<Calendar mode="single" selected={date} onSelect={setDate} />

// Range, two months side by side
const [range, setRange] = useState<DateRange>();
<Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} />

// Date-of-birth style dropdown navigation
<Calendar mode="single" selected={date} onSelect={setDate} captionLayout="dropdown" />
```

## Deviations from upstream

- Upstream merges `getDefaultClassNames()` (react-day-picker's own
  `rdp-*` class hooks) alongside its Tailwind classes. This port drops
  that merge: the kit imports no react-day-picker stylesheet for those
  hooks to matter against, so carrying them forward would only be inert
  noise in the DOM.
- Upstream threads a `buttonVariant` prop through to a shadcn `Button` for
  the prev/next nav buttons (any of Button's variants). The kit's nav
  buttons are plain CSS (ghost-only look) rather than a rendered `Button`
  instance — narrower than upstream's axis, kept out of scope as a
  variant no `date-picker.tsx` usage needs today.
- Upstream's `day` cell carries a `::after` pseudo-element on
  `range_start`/`range_end` that overflows 1rem past the cell edge to
  patch a table/flex cell-boundary seam. The kit's day cells already sit
  flush against each other (no gap in `.week`'s flex row), so there is no
  seam to patch and the pseudo-element is dropped.
- The nav overlay (`.nav`, absolutely positioned across the whole caption
  row) adds `pointer-events: none`, with the two buttons taking their own
  back. Upstream leaves this to paint order alone (the caption's `<select>`
  comes later in the DOM, so it happens to sit above the nav), which
  silently breaks the moment anything gives the nav a stacking order.
  Declaring the pass-through states the intent instead.
- `CalendarDayButton` carries no `data-day` attribute of its own, where
  upstream repeats one on the button. react-day-picker already sets
  `data-day="YYYY-MM-DD"` on the gridcell that wraps it, so the button
  copy added nothing but a second, locale-formatted spelling of the same
  day — query the cell's ISO value instead.
