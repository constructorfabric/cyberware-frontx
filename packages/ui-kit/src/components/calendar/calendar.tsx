import { cx } from 'class-variance-authority';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  DayPicker,
  type DayButtonProps,
  type DayPickerProps,
} from 'react-day-picker';

import styles from './calendar.module.css';

/*
 * react-day-picker hands its Chevron slot an `orientation` rather than a
 * component, so the four directions are looked up here. Four distinct lucide
 * glyphs rather than one rotated by CSS: rotating a chevron by an arbitrary
 * multiple of 90deg is easy to get backwards.
 */
const CHEVRONS: Record<'up' | 'down' | 'left' | 'right', LucideIcon> = {
  down: ChevronDownIcon,
  up: ChevronUpIcon,
  left: ChevronLeftIcon,
  right: ChevronRightIcon,
};

function CalendarChevron({
  orientation = 'down',
  className,
}: {
  orientation?: 'up' | 'down' | 'left' | 'right';
  className?: string;
}) {
  const Chevron = CHEVRONS[orientation];
  return <Chevron className={cx(styles.chevron, className)} />;
}

// A type alias, not `interface extends`: DayPickerProps is itself a union
// (PropsBase & (PropsSingle | PropsSingleRequired | PropsMulti | ...)) to
// discriminate on `mode`, and TS only allows `extends` against an object
// type or an intersection of object types with statically known members —
// not a union. `className` is already optional on DayPickerProps; restated
// here only so its own doc comment has somewhere to live.
export type CalendarProps = DayPickerProps & {
  /** Merged onto the calendar's root element, after the kit's own layout class. */
  className?: string;
};

/**
 * Wraps react-day-picker's `DayPicker` (the kit ships no calendar primitive
 * of its own). Upstream re-authors the ENTIRE
 * visual surface through DayPicker's `classNames` prop, one Tailwind
 * utility string per UI slot; this port keeps that same seam but feeds it
 * CSS Modules classes instead, so the mapping below is the direct
 * translation of the shadcn/ui `base` registry's calendar.tsx (MIT).
 *
 * `captionLayout="label"` (plain month/year text) is the default, matching
 * upstream; pass `"dropdown"` for the date-of-birth style month+year
 * selects (see date-picker.tsx's dob-flavored usage).
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  locale,
  formatters,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cx(styles.root, className)}
      locale={locale}
      formatters={{
        // Upstream's own override: the ramp's default is the localized FULL
        // month name, which overflows the dropdown chip's compact width —
        // forced to the abbreviated form regardless of what the consumer's
        // own `formatters` might otherwise leave at the default.
        formatMonthDropdown: (date) => date.toLocaleString(locale?.code, { month: 'short' }),
        ...formatters,
      }}
      classNames={{
        months: styles.months,
        month: styles.month,
        nav: styles.nav,
        button_previous: styles.buttonPrevious,
        button_next: styles.buttonNext,
        month_caption: styles.monthCaption,
        dropdowns: styles.dropdowns,
        dropdown_root: styles.dropdownRoot,
        dropdown: styles.dropdown,
        caption_label: cx(styles.captionLabel, captionLayout !== 'label' && styles.captionLabelDropdown),
        month_grid: styles.monthGrid,
        weekdays: styles.weekdays,
        weekday: styles.weekday,
        week: styles.week,
        week_number_header: styles.weekNumberHeader,
        week_number: styles.weekNumber,
        day: styles.day,
        range_start: styles.rangeStart,
        range_middle: styles.rangeMiddle,
        range_end: styles.rangeEnd,
        today: styles.today,
        outside: styles.outside,
        disabled: styles.disabled,
        hidden: styles.hidden,
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation }) => (
          <CalendarChevron orientation={orientation} className={chevronClassName} />
        ),
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...weekNumberProps }) => (
          <td {...weekNumberProps}>
            <div className={styles.weekNumberCell}>{children}</div>
          </td>
        ),
        ...components,
      }}
      {...props}
    />
  );
}

/**
 * The default `DayButton`: same custom-component seam upstream uses to
 * carry the range/single-selection fill and the focus ring onto the actual
 * button element (the parent `day` cell's own modifiers classes handle the
 * today/outside/disabled/range-continuation styling instead — see
 * calendar.module.css). Exported like upstream's `CalendarDayButton` so a
 * consumer overriding `components.DayButton` further can still compose
 * this one rather than starting from scratch.
 */
// `day` is destructured only to keep react-day-picker's own CalendarDay
// object out of `...props`, where it would land on the DOM button as an
// unknown attribute.
export function CalendarDayButton({ className, day: _day, modifiers, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  // react-day-picker moves keyboard focus by re-rendering with a new
  // `modifiers.focused` day rather than calling `.focus()` itself (it has
  // no ref into a custom DayButton) — this effect is what actually moves
  // the browser's focus when arrow-key navigation lands on this day.
  useEffect(() => {
    if (modifiers.focused) {
      ref.current?.focus();
    }
  }, [modifiers.focused]);

  return (
    <button
      ref={ref}
      type="button"
      // No `data-day` of its own: react-day-picker already puts
      // `data-day={day.isoDate}` on the gridcell wrapping this button, so a
      // second copy here only added a locale-formatted (and therefore
      // runtime-dependent) duplicate of an attribute that already exists in
      // a stable form one level up.
      data-selected-single={
        (modifiers.selected &&
          !modifiers.range_start &&
          !modifiers.range_end &&
          !modifiers.range_middle) ||
        undefined
      }
      data-range-start={modifiers.range_start || undefined}
      data-range-end={modifiers.range_end || undefined}
      data-range-middle={modifiers.range_middle || undefined}
      className={cx(styles.dayButton, className)}
      {...props}
    />
  );
}
