import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DataTable,
  dataTableColumnHelper,
  dataTableSelectionColumn,
  DataTableSortButton,
} from './data-table';
import styles from './data-table.module.css';

interface Payment {
  id: string;
  amount: number;
  status: 'pending' | 'success';
}

// Deliberately not pre-sorted by amount — a dataset that already happened
// to arrive in ascending order would let a broken sort toggle pass by
// coincidence.
const payments: Payment[] = [
  { id: 'p-0', amount: 50, status: 'pending' },
  { id: 'p-1', amount: 10, status: 'success' },
  { id: 'p-2', amount: 30, status: 'pending' },
];

const columnHelper = dataTableColumnHelper<Payment>();

// `.columns([...])`, not a bare array literal — preserves each column's
// own TValue instead of widening the array to a shared supertype (see
// createColumnHelper's own doc comment; excluded from tsc via
// tsconfig.json's test-file exclusion, but kept correct regardless).
const columns = columnHelper.columns([
  dataTableSelectionColumn<Payment>(),
  columnHelper.accessor('status', { header: 'Status' }),
  columnHelper.accessor('amount', {
    header: ({ column }) => <DataTableSortButton column={column}>Amount</DataTableSortButton>,
  }),
]);

function bodyRowAmounts() {
  return Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelectorAll('td')[2]?.textContent,
  );
}

afterEach(cleanup);

describe('DataTable', () => {
  it('renders column headers and every row when data fits one page', () => {
    render(<DataTable columns={columns} data={payments} pageSize={20} />);
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Amount/ })).toBeTruthy();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('shows the configurable empty message spanning every column when data is empty', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="Nothing here" />);
    const emptyCell = screen.getByText('Nothing here');
    expect(emptyCell.className).toContain(styles.emptyCell);
    expect(emptyCell.getAttribute('colspan')).toBe(String(columns.length));
  });

  it('defaults the empty message to "No results."', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText('No results.')).toBeTruthy();
  });

  it('wraps the label and the sort arrow in one inline-flex box, not as bare Button children', () => {
    // Regression test for the misaligned-arrow bug: `Button` folds every
    // non-icon child into ONE `.label` span (see button.tsx), so passing
    // the label and the arrow icon as two separate children of `Button`
    // (rather than one already-wrapped child) put them back at the mercy
    // of ordinary inline layout - no gap, baseline-dependent vertical
    // position. This asserts the button's accessible content lives inside
    // a single `sortButtonInner` element that itself contains both the
    // text and the icon, so `Button` only ever sees one child to fold.
    render(<DataTable columns={columns} data={payments} pageSize={20} />);
    const button = screen.getByRole('button', { name: /Amount/ });
    const inner = button.querySelector(`.${styles.sortButtonInner}`);
    expect(inner).toBeTruthy();
    expect(inner?.textContent).toBe('Amount');
    expect(inner?.querySelector('svg')).toBeTruthy();
    // The wrapper is Button's ONLY child (aside from the loading spinner,
    // never rendered here) - i.e. it is not itself nested inside another
    // sibling, confirming Button folds exactly one child.
    expect(button.querySelectorAll(`.${styles.sortButtonInner}`)).toHaveLength(1);
  });

  it('sorts ascending then descending via DataTableSortButton', () => {
    render(<DataTable columns={columns} data={payments} pageSize={20} />);
    expect(bodyRowAmounts()).toEqual(['50', '10', '30']);

    fireEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(bodyRowAmounts()).toEqual(['10', '30', '50']);

    fireEvent.click(screen.getByRole('button', { name: /Amount/ }));
    expect(bodyRowAmounts()).toEqual(['50', '30', '10']);
  });

  it('paginates with Previous/Next and disables at each bound', () => {
    render(<DataTable columns={columns} data={payments} pageSize={2} />);
    const previous = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(previous.hasAttribute('disabled')).toBe(true);
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);

    fireEvent.click(next);
    expect(previous.hasAttribute('disabled')).toBe(false);
    expect(next.hasAttribute('disabled')).toBe(true);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);

    fireEvent.click(previous);
    expect(previous.hasAttribute('disabled')).toBe(true);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  // `pageSize` used to be read once, into initial state, so a "rows per
  // page" control wired to it changed nothing after first render.
  it('follows a changed pageSize, keeping the current rows in view', () => {
    const { rerender } = render(<DataTable columns={columns} data={payments} pageSize={1} />);
    expect(bodyRowAmounts()).toEqual(['50']);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(bodyRowAmounts()).toEqual(['30']);

    // Page 3 of 1-per-page starts at row index 2, which is page 2 at
    // 2-per-page — the row the reader was on is still on screen.
    rerender(<DataTable columns={columns} data={payments} pageSize={2} />);
    expect(bodyRowAmounts()).toEqual(['30']);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);

    rerender(<DataTable columns={columns} data={payments} pageSize={20} />);
    expect(bodyRowAmounts()).toEqual(['50', '10', '30']);
  });

  // Every string DataTable renders on its own used to be a hardcoded
  // English literal, which made a localized table a fork.
  it('takes an override for every string it renders itself', () => {
    const localizedColumns = columnHelper.columns([
      dataTableSelectionColumn<Payment>({
        selectAllLabel: 'Alle auswählen',
        selectRowLabel: 'Zeile auswählen',
      }),
      columnHelper.accessor('status', { header: 'Status' }),
    ]);
    render(
      <DataTable
        columns={localizedColumns}
        data={payments}
        pageSize={2}
        enableRowSelection
        previousLabel="Zurück"
        nextLabel="Weiter"
        selectionSummary={(selected, total) => `${selected} von ${total} ausgewählt`}
      />,
    );
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeTruthy();
    expect(screen.getByText('0 von 3 ausgewählt')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Alle auswählen' })).toBeTruthy();
    expect(screen.getAllByRole('checkbox', { name: 'Zeile auswählen' })).toHaveLength(2);
  });

  it('hides the selected-row count unless enableRowSelection is set', () => {
    render(<DataTable columns={columns} data={payments} pageSize={20} />);
    expect(screen.queryByText(/row\(s\) selected/)).toBeNull();
  });

  it('selects individual rows through the built-in checkbox column and reports the count', () => {
    render(<DataTable columns={columns} data={payments} pageSize={20} enableRowSelection />);
    expect(screen.getByText('0 of 3 row(s) selected.')).toBeTruthy();

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    fireEvent.click(rowCheckboxes[0]!);
    expect(screen.getByText('1 of 3 row(s) selected.')).toBeTruthy();

    fireEvent.click(rowCheckboxes[1]!);
    expect(screen.getByText('2 of 3 row(s) selected.')).toBeTruthy();
  });

  it('selects and deselects every row through the header checkbox', () => {
    render(<DataTable columns={columns} data={payments} pageSize={20} enableRowSelection />);
    const selectAll = screen.getByRole('checkbox', { name: 'Select all' });

    fireEvent.click(selectAll);
    expect(screen.getByText('3 of 3 row(s) selected.')).toBeTruthy();

    fireEvent.click(selectAll);
    expect(screen.getByText('0 of 3 row(s) selected.')).toBeTruthy();
  });

  it('marks a selected row with data-state for table.module.css styling', () => {
    render(<DataTable columns={columns} data={payments} pageSize={20} enableRowSelection />);
    const rowCheckboxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    fireEvent.click(rowCheckboxes[0]!);
    const row = rowCheckboxes[0]!.closest('tr');
    expect(row?.getAttribute('data-state')).toBe('selected');
  });
});
