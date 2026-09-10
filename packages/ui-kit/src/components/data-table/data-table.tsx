//
// Load-bearing: DataTable calls useState/useTable directly in its own
// render body, so this can't be dropped. Coupled to CLIENT_COMPONENTS in
// scripts/verify-consumer.sh — keep both in sync if this ever changes.
'use client';

import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { cx } from 'class-variance-authority';
import { ArrowUpDownIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../button/public.js';
import { Checkbox } from '../checkbox/public.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table/public.js';
import styles from './data-table.module.css';

/*
 * TanStack Table v9 is feature-based (see @tanstack/react-table's own
 * `tableFeatures()` JSDoc): a table only gets the row models/APIs of the
 * features listed here, and this list is what makes them tree-shakeable.
 * The kit bakes ONE shared features object rather than asking every
 * consumer to hand-roll their own `data-table-features.ts` (the upstream
 * doc recipe's own "Set up Table Features" step) — that file's whole
 * purpose was giving every column-def/table-instance file in an app the
 * same `TFeatures` type to key off; shipping it from the kit means a
 * consumer building a DataTable never has to write it. rowSelectionFeature
 * needs no matching row-model slot (see FeatureSlotPrereqs) — it filters
 * rows already produced by the other row models, it doesn't build one of
 * its own.
 */
export const dataTableFeatures = tableFeatures({
  rowSelectionFeature,
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

/** Pass this as `TFeatures` to `Column`/`Row`/`Table`/`ColumnDef` so each type knows which feature APIs `DataTable` registers. */
export type DataTableFeatures = typeof dataTableFeatures;

/** A `createColumnHelper` pre-bound to `DataTableFeatures` — the one column helper every `DataTable` column def should be built with. */
export function dataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

/*
 * Ready-made row-selection column: the upstream recipe's own "Row
 * Selection" step (docs/components/base/data-table.mdx) hand-writes this
 * exact header/cell pair with shadcn's Checkbox every time a table needs
 * selection — productized here as one call so a consumer spreads it into
 * `columns` instead of recreating it. `enableSorting: false` matches the
 * recipe: a selection column has no data of its own to sort by. The
 * recipe's paired `enableHiding: false` is dropped — that option only
 * exists on `ColumnDef` when `columnVisibilityFeature` is registered (see
 * `FeatureSlotPrereqs` in @tanstack/table-core), and this port
 * deliberately doesn't register it (see data-table.md's scope note); with
 * no visibility feature there is nothing for a selection column to opt
 * out of hiding from.
 */
export interface DataTableSelectionColumnLabels {
  /** Accessible name for the header checkbox. @default 'Select all' */
  selectAllLabel?: string;
  /** Accessible name for each row checkbox. @default 'Select row' */
  selectRowLabel?: string;
}

export function dataTableSelectionColumn<TData extends RowData>({
  selectAllLabel = 'Select all',
  selectRowLabel = 'Select row',
}: DataTableSelectionColumnLabels = {}): ColumnDef<DataTableFeatures, TData> {
  return dataTableColumnHelper<TData>().display({
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
        aria-label={selectAllLabel}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
        aria-label={selectRowLabel}
      />
    ),
    enableSorting: false,
  });
}

export interface DataTableSortButtonProps<TData extends RowData, TValue = unknown> {
  /** The column instance a `ColumnDef`'s `header` render function receives. */
  column: Column<DataTableFeatures, TData, TValue>;
  children: ReactNode;
  className?: string;
}

/**
 * Productizes the recipe's inline "Sorting" example (a ghost `Button` +
 * `ArrowUpDown` icon toggling `column.toggleSorting`) into one reusable
 * piece for a column's `header` render function, e.g.
 * `header: ({ column }) => <DataTableSortButton column={column}>Email</DataTableSortButton>`.
 */
export function DataTableSortButton<TData extends RowData, TValue = unknown>({
  column,
  children,
  className,
}: DataTableSortButtonProps<TData, TValue>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cx(styles.sortButton, className)}
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
    >
      {/*
       * One wrapping span, not two bare children: `Button` has no trailing-
       * icon slot (`icon` is leading-only, see button.tsx), so passing
       * `children` and `ArrowUpDownIcon` as siblings here means `Button`
       * folds BOTH of them into its own single `.label` span
       * (`hasLabel && <span className={styles.label}>{children}</span>`,
       * where `children` is everything this component was given, arrow
       * included). That span is a plain inline box - it carries no
       * `display`/`align-items` of its own - so the label content and the
       * arrow icon end up as bare inline siblings glued together with no
       * gap, and the icon's vertical position falls out of ordinary
       * inline `vertical-align: baseline` against whatever font metrics
       * the label content happens to establish. Different header content
       * (a plain string here, an icon+text span in the dashboard's
       * activity table) sets a different baseline, which is why the same
       * markup misaligned differently in the two tables. Wrapping both in
       * one `sortButtonInner` flex box makes `Button` see (and fold) only
       * ONE child - an atomic inline-flex box that centers and gaps its
       * own two children itself, independent of whatever inline context
       * it lands in.
       */}
      <span className={styles.sortButtonInner}>
        {children}
        <ArrowUpDownIcon className={styles.sortIcon} />
      </span>
    </Button>
  );
}

export interface DataTableProps<TData extends RowData> {
  /** Built with `dataTableColumnHelper()` (or plain objects typed against `DataTableFeatures`). */
  columns: ColumnDef<DataTableFeatures, TData>[];
  data: TData[];
  /** Rows per page. @default 10 */
  pageSize?: number;
  /**
   * Enables the table's row-selection state and the "N of M row(s)
   * selected" footer text. The checkbox column itself is a separate
   * opt-in — include `dataTableSelectionColumn()` in `columns` (this flag
   * alone renders no checkboxes, matching how the upstream recipe treats
   * `state.rowSelection` and the `select` column def as independent
   * steps). @default false
   */
  enableRowSelection?: boolean;
  /** Content for the one row spanning every column when `data` is empty. @default 'No results.' */
  emptyMessage?: ReactNode;
  /** Label on the previous-page button. @default 'Previous' */
  previousLabel?: ReactNode;
  /** Label on the next-page button. @default 'Next' */
  nextLabel?: ReactNode;
  /**
   * The selection summary shown while `enableRowSelection` is set. A
   * function, not a string, because the sentence it replaces counts things
   * — and a language with more than one plural form cannot be expressed by
   * substituting numbers into a fixed template.
   * @default `${selected} of ${total} row(s) selected.`
   */
  selectionSummary?: (selected: number, total: number) => ReactNode;
  className?: string;
}

function defaultSelectionSummary(selected: number, total: number) {
  return `${selected} of ${total} row(s) selected.`;
}

/**
 * A productized version of the shadcn/ui "Data Table" doc recipe (Table +
 * `@tanstack/react-table`, no standalone upstream registry item exists —
 * see data-table.md). Owns column defs' rendering, sorting, pagination,
 * and (opt-in) row-selection state so a consumer only supplies `columns`
 * and `data`, the same `<DataTable columns={columns} data={data} />`
 * shape the recipe itself calls out as the point of extracting this into
 * a reusable component.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  pageSize = 10,
  enableRowSelection = false,
  emptyMessage = 'No results.',
  previousLabel = 'Previous',
  nextLabel = 'Next',
  selectionSummary = defaultSelectionSummary,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });

  // `pageSize` is a live prop, not just a seed: a consumer wiring it to a
  // "rows per page" select expects the table to follow. Resynced during
  // render (react.dev's "adjusting state when a prop changes" pattern),
  // not from a `useEffect`, so the new page size lands in the same commit
  // as the prop change instead of one render — and one visibly wrong
  // table — later. The page index is rescaled rather than reset so the
  // rows the reader was looking at stay on screen: the first row of the
  // current page keeps its place under the new size.
  const [syncedPageSize, setSyncedPageSize] = useState(pageSize);
  if (pageSize !== syncedPageSize) {
    setSyncedPageSize(pageSize);
    setPagination((current) => ({
      pageSize,
      pageIndex: Math.max(0, Math.floor((current.pageIndex * current.pageSize) / pageSize)),
    }));
  }

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    enableRowSelection,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    state: {
      sorting,
      rowSelection,
      pagination,
    },
  });

  const rows = table.getRowModel().rows;

  return (
    /*
     * One card, not the recipe's card-plus-detached-footer: the Studio Data
     * Table frame (40001455:6353) draws the pagination bar inside the same
     * bordered container as the rows, separated from the last one by the
     * same rule that separates any two rows. `className` lands on that card
     * — it was the outer div's before, and the outer div only existed to
     * hold the footer outside.
     */
    <div className={cx(styles.wrapper, className)}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
                {/*
                 * getAllCells(), not the recipe's getVisibleCells(): that
                 * method only exists when columnVisibilityFeature is
                 * registered (see FeatureSlotPrereqs), and this port
                 * deliberately doesn't register it — visibility toggling
                 * is out of scope (see data-table.md). Every column this
                 * component's own consumer declares is shown, always.
                 */}
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className={styles.emptyCell}>
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className={styles.footer}>
        {enableRowSelection && (
          <div className={styles.selectedCount}>
            {selectionSummary(
              table.getFilteredSelectedRowModel().rows.length,
              table.getFilteredRowModel().rows.length,
            )}
          </div>
        )}
        <div className={styles.paginationControls}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {previousLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {nextLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
