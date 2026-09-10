import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DateRange } from 'react-day-picker';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Calendar } from './calendar';
import styles from './calendar.module.css';

afterEach(cleanup);

// January 2024 pinned as the visible month throughout: deterministic day
// numbers/weekday layout, and Jan 1 2024 is a Monday, which keeps the first
// row free of outside-month filler days for the range/selection assertions.
const JAN_1 = new Date(2024, 0, 1);

function dayCell(container: HTMLElement, iso: string) {
  const cell = container.querySelector(`[data-day="${iso}"]`);
  expect(cell, `no day cell for ${iso}`).not.toBeNull();
  return cell as HTMLElement;
}

describe('Calendar', () => {
  it('renders a single-month grid and reports a click through onSelect', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Calendar mode="single" defaultMonth={JAN_1} selected={undefined} onSelect={onSelect} />,
    );
    expect(screen.getByRole('grid')).toBeTruthy();
    const button = dayCell(container, '2024-01-15').querySelector('button');
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
    // OnSelectHandler's first arg is the selected date itself.
    const selected = onSelect.mock.calls[0]?.[0] as Date;
    expect(selected.getDate()).toBe(15);
  });

  it('marks the single selected day on the day button, not the cell', () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={JAN_1} selected={new Date(2024, 0, 15)} onSelect={vi.fn()} />,
    );
    const button = dayCell(container, '2024-01-15').querySelector('button');
    expect(button?.hasAttribute('data-selected-single')).toBe(true);
    expect(button?.className).toContain(styles.dayButton);
  });

  it('fills a range: start/end on the buttons, the days between on the cells', () => {
    const range: DateRange = { from: new Date(2024, 0, 10), to: new Date(2024, 0, 12) };
    const { container } = render(
      <Calendar mode="range" defaultMonth={JAN_1} selected={range} onSelect={vi.fn()} />,
    );
    expect(dayCell(container, '2024-01-10').querySelector('button')?.hasAttribute('data-range-start')).toBe(
      true,
    );
    expect(dayCell(container, '2024-01-12').querySelector('button')?.hasAttribute('data-range-end')).toBe(
      true,
    );
    const middleCell = dayCell(container, '2024-01-11');
    expect(middleCell.className).toContain(styles.rangeMiddle);
    expect(middleCell.querySelector('button')?.hasAttribute('data-range-middle')).toBe(true);
  });

  it('marks the explicit `today` day with the kit today class', () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={JAN_1} today={new Date(2024, 0, 20)} selected={undefined} onSelect={vi.fn()} />,
    );
    expect(dayCell(container, '2024-01-20').className).toContain(styles.today);
  });

  it('dims outside-month days without hiding them, and skips them by default when disabled elsewhere', () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={JAN_1} selected={undefined} onSelect={vi.fn()} />,
    );
    // Jan 2024 starts on a Monday, so the grid still shows no outside days
    // in its first row — the last row past Jan 31 is where they appear.
    const outsideCell = container.querySelector('[data-outside]');
    expect(outsideCell, 'expected at least one outside-month cell').not.toBeNull();
    expect(outsideCell?.className).toContain(styles.outside);
  });

  it('disables a matched day so it cannot be selected', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Calendar
        mode="single"
        defaultMonth={JAN_1}
        selected={undefined}
        onSelect={onSelect}
        disabled={new Date(2024, 0, 10)}
      />,
    );
    const cell = dayCell(container, '2024-01-10');
    expect(cell.className).toContain(styles.disabled);
    const button = cell.querySelector('button');
    expect((button as HTMLButtonElement | null)?.disabled).toBe(true);
    fireEvent.click(button as HTMLButtonElement);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders native month/year selects under captionLayout="dropdown"', () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={JAN_1} selected={undefined} onSelect={vi.fn()} captionLayout="dropdown" />,
    );
    expect(container.querySelectorAll('select').length).toBe(2);
  });

  // The selects rendering is not the same thing as the selects working: they
  // are wired through to month navigation only as long as the kit keeps
  // passing react-day-picker's own dropdown props straight through.
  it('navigates the displayed month when the month select changes', () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={JAN_1} selected={undefined} onSelect={vi.fn()} captionLayout="dropdown" />,
    );
    const monthSelect = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(monthSelect, { target: { value: '3' } });
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('April');
  });

  it('applies the kit root/months/month classes', () => {
    const { container } = render(
      <Calendar mode="single" defaultMonth={JAN_1} selected={undefined} onSelect={vi.fn()} />,
    );
    expect(container.querySelector(`.${styles.root}`)).not.toBeNull();
    expect(container.querySelector(`.${styles.months}`)).not.toBeNull();
    expect(container.querySelector(`.${styles.month}`)).not.toBeNull();
  });
});
