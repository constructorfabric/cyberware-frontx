import { cx } from 'class-variance-authority';
import { format, isValid, parse } from 'date-fns';
import type { Locale } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { Button } from '../button/button';
import { Calendar, type CalendarProps } from '../calendar/calendar';
import { Input } from '../input/input';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';

import styles from './date-picker.module.css';

interface DatePickerBaseProps {
  /** Shown in the trigger/input when nothing is selected. */
  placeholder?: string;
  /** Forwarded to the popover's `Calendar` — see calendar.md's caption-layout axis. */
  captionLayout?: CalendarProps['captionLayout'];
  disabled?: CalendarProps['disabled'];
  /**
   * date-fns locale for the month grid AND for every date this component
   * writes or reads as text: the trigger label, the `input` variant's
   * formatted value, and the parse of what the user types there. Passing
   * it to `Calendar` alone would translate the grid while leaving the
   * field in English, so it is one prop covering both.
   * @default date-fns' own default (en-US)
   */
  locale?: Locale;
  className?: string;
  id?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where to portal the calendar popup — see PopoverContent's own doc. */
  container?: Parameters<typeof PopoverContent>[0]['container'];
  /**
   * Accessible name for the `input` variant's trailing calendar button —
   * the one label this component renders that no consumer text supplies.
   * @default 'Open calendar'
   */
  openCalendarLabel?: string;
  'aria-label'?: string;
}

export interface DatePickerSingleProps extends DatePickerBaseProps {
  mode?: 'single';
  /**
   * `button` (default) renders a Button trigger showing the formatted date
   * — upstream's date-picker-demo/-basic/-dob recipes. `input` renders a
   * free-typed field with a calendar-icon button in its `end` slot —
   * upstream's date-picker-input recipe. `range` mode has no `input`
   * variant (see date-picker.md's Deviations).
   */
  variant?: 'button' | 'input';
  selected: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  /** Close the popover once a day is picked. @default true */
  closeOnSelect?: boolean;
}

export interface DatePickerRangeProps extends DatePickerBaseProps {
  mode: 'range';
  selected: DateRange | undefined;
  onSelect: (range: DateRange | undefined) => void;
  /** @default 2 */
  numberOfMonths?: number;
  /** Close the popover once a day is picked. @default false — a range needs two clicks. */
  closeOnSelect?: boolean;
}

/**
 * `mode` discriminates `selected`/`onSelect`'s type the same way
 * `Calendar`'s underlying `DayPicker` does — see calendar.tsx.
 */
export type DatePickerProps = DatePickerSingleProps | DatePickerRangeProps;

/*
 * The `input` variant's one date format, used in both directions. Matches
 * upstream's date-picker-input recipe (long month name, day, year) and,
 * with the default locale, produces exactly the string its
 * `toLocaleDateString('en-US', { day: '2-digit', month: 'long', year:
 * 'numeric' })` produced — the difference is that date-fns can parse it
 * back, which is what makes a typed field safe to commit from.
 */
const INPUT_FORMAT = 'MMMM dd, yyyy';

// A four-digit year is required before a typed date counts as complete.
// date-fns reads "June 7, 20" (a year still being typed) as the year 20,
// which is a valid Date and would otherwise commit.
const MIN_FULL_YEAR = 1000;

function formatInputValue(date: Date | undefined, locale: Locale | undefined) {
  if (!date) {
    return '';
  }
  return format(date, INPUT_FORMAT, { locale });
}

/**
 * Parses a typed field value, returning a date ONLY for a complete one.
 *
 * The obvious `new Date(value)` is what this deliberately is not: it reads
 * a half-typed "June 7" as June 7th of the year 2001 (V8's own fallback
 * for a yearless date string), so every keystroke on the way to a real
 * date commits a different wrong year to `onSelect`. Requiring the whole
 * format means the field commits once, when the user has actually
 * finished typing a date, and stays quiet until then.
 */
function parseTypedDate(value: string, locale: Locale | undefined): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = parse(trimmed, INPUT_FORMAT, new Date(), { locale });
  if (!isValid(parsed) || parsed.getFullYear() < MIN_FULL_YEAR) {
    return undefined;
  }
  return parsed;
}

function formatRangeLabel(range: DateRange | undefined, locale: Locale | undefined) {
  if (!range?.from) {
    return undefined;
  }
  const from = format(range.from, 'LLL dd, y', { locale });
  if (!range.to) {
    return from;
  }
  return `${from} - ${format(range.to, 'LLL dd, y', { locale })}`;
}

/**
 * Popover + Calendar + Button/Input composed into a real kit component.
 * Upstream ships this as a doc recipe (apps/v4/content/docs/components/
 * base/date-picker.mdx), not a registry item — "there is no `DatePicker`
 * root component" per that doc's own Composition section. This is the
 * kit's deviation: the recipe's prop surface (`selected`/`onSelect`,
 * `mode`, `captionLayout`) is kept, but wrapped as one component so a
 * consumer doesn't hand-assemble Popover/Calendar/Button per usage — see
 * date-picker.md's Deviations for the full rationale.
 */
export function DatePicker(props: DatePickerProps) {
  const {
    placeholder = 'Pick a date',
    captionLayout = 'label',
    disabled,
    locale,
    openCalendarLabel = 'Open calendar',
    className,
    id,
    open: openProp,
    defaultOpen,
    onOpenChange,
    container,
  } = props;
  const ariaLabel = props['aria-label'];

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // Whichever endpoint the active mode anchors on: the day itself in
  // single mode, the range's start in range mode.
  const anchor = props.mode === 'range' ? props.selected?.from : props.selected;
  const singleSelected = props.mode === 'range' ? undefined : props.selected;

  // The visible month, and (for the `input` variant) the typed buffer.
  // The buffer is kept separate from `selected` because a value mid-typing
  // is not yet a date and must not clobber the last committed selection —
  // the same problem upstream's date-picker-input recipe solves the same
  // way with its own `value` state.
  const [month, setMonth] = useState<Date | undefined>(anchor);
  const [typedValue, setTypedValue] = useState(() => formatInputValue(singleSelected, locale));

  // Both follow `selected` when it changes from OUTSIDE this component —
  // a "clear" button elsewhere on the page, a form reset, a stored value
  // arriving late. Seeding them once at mount instead (what this used to
  // do for the month) left a picker whose selection had moved on opening
  // on the month it was first mounted with, which for a date arriving
  // after mount means "today" forever.
  //
  // Resynced during render (react.dev's "adjusting state when a prop
  // changes" pattern) rather than from a `useEffect`, so the change lands
  // in the same commit instead of one visibly-stale render later. Keyed on
  // the anchor's TIME, not its identity: a consumer that rebuilds its
  // `Date` on every render would otherwise reset the month the user just
  // navigated to, and the caveat "pass a stable Date reference" is a
  // sharper edge than this component needs to have.
  const anchorTime = anchor?.getTime();
  const [syncedTime, setSyncedTime] = useState(anchorTime);
  if (anchorTime !== syncedTime) {
    setSyncedTime(anchorTime);
    setMonth(anchor);
    setTypedValue(formatInputValue(singleSelected, locale));
  }

  if (props.mode === 'range') {
    const { selected, onSelect, numberOfMonths = 2, closeOnSelect = false } = props;
    const label = formatRangeLabel(selected, locale);
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              id={id}
              className={cx(styles.trigger, className)}
              data-empty={!selected?.from || undefined}
              aria-label={ariaLabel}
              // Button's own `icon` slot, not a raw child — see the single-mode
              // trigger below for why (same fix, same reason).
              icon={<CalendarIcon />}
            />
          }
        >
          {label ?? <span>{placeholder}</span>}
        </PopoverTrigger>
        <PopoverContent className={styles.content} align="start" container={container}>
          <Calendar
            mode="range"
            selected={selected}
            onSelect={(value) => {
              onSelect(value);
              if (closeOnSelect) {
                setOpen(false);
              }
            }}
            month={month}
            onMonthChange={setMonth}
            numberOfMonths={numberOfMonths}
            locale={locale}
            captionLayout={captionLayout}
            disabled={disabled}
          />
        </PopoverContent>
      </Popover>
    );
  }

  const { selected, onSelect, variant = 'button', closeOnSelect = true } = props;

  // Every path that commits a selection also moves `syncedTime` forward,
  // so the echo of that same value coming back through `selected` is not
  // mistaken for an outside change and does not re-run the resync above.
  // Without it, typing a complete date would reformat the field under the
  // caret ("June 7, 2025" snapping to "June 07, 2025" mid-keystroke).
  const handleCalendarSelect = (date: Date | undefined) => {
    onSelect(date);
    setMonth(date);
    setTypedValue(formatInputValue(date, locale));
    setSyncedTime(date?.getTime());
    if (closeOnSelect) {
      setOpen(false);
    }
  };

  if (variant === 'input') {
    return (
      <Input
        id={id}
        value={typedValue}
        placeholder={placeholder}
        className={className}
        aria-label={ariaLabel}
        onChange={(event) => {
          const { value } = event.target;
          setTypedValue(value);
          const parsed = parseTypedDate(value, locale);
          if (parsed) {
            onSelect(parsed);
            setMonth(parsed);
            setSyncedTime(parsed.getTime());
          } else if (!value.trim()) {
            // Emptying the field clears the selection; anything else is an
            // incomplete date, which commits nothing either way.
            onSelect(undefined);
            setSyncedTime(undefined);
          }
        }}
        onKeyDown={(event) => {
          // Matches upstream's date-picker-input recipe: ArrowDown opens
          // the calendar from the field without needing to reach for the
          // trailing button.
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        end={
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<CalendarIcon />}
                  aria-label={ariaLabel ?? openCalendarLabel}
                />
              }
            />
            <PopoverContent className={styles.content} align="end" sideOffset={8} container={container}>
              <Calendar
                mode="single"
                selected={selected}
                onSelect={handleCalendarSelect}
                month={month}
                onMonthChange={setMonth}
                locale={locale}
                captionLayout={captionLayout}
                disabled={disabled}
              />
            </PopoverContent>
          </Popover>
        }
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            id={id}
            className={cx(styles.trigger, className)}
            data-empty={!selected || undefined}
            aria-label={ariaLabel}
            // Button's `icon` slot (never a raw child, per button.tsx's own
            // doc comment): a child mixed in with the label text lands in
            // Button's plain-block `.label` span instead of its flex
            // `.icon`+`.label` row, which silently drops the gap and
            // vertical centering Button would otherwise give it for free.
            icon={<CalendarIcon />}
          />
        }
      >
        {selected ? format(selected, 'PPP', { locale }) : <span>{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent className={styles.content} align="start" container={container}>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleCalendarSelect}
          month={month}
          onMonthChange={setMonth}
          locale={locale}
          captionLayout={captionLayout}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
