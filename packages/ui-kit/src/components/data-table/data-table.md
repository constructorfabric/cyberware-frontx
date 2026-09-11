# DataTable

A sortable, paginated, optionally row-selectable table built on the kit's
own `Table` (`../table`) and [`@tanstack/react-table`](https://tanstack.com/table).

## Deviation from upstream

Unlike every other port in this batch, upstream shadcn/ui ships **no**
`data-table.tsx` registry item — [the Data Table
doc](https://ui.shadcn.com/docs/components/base/data-table) is explicitly a
guide, not a component: "instead of a data-table component, I thought it
would be more helpful to provide a guide on how to build your own." This
port productizes that guide into a real, reusable `DataTable` component,
per this task's own brief — the recipe's shape stays recognizable
(`<DataTable columns={columns} data={data} />`, `ColumnDef`s built with a
column helper, `Table`/`TableHeader`/`TableBody`/... underneath), but three
pieces of hand-written boilerplate the guide repeats at every call site are
shipped as reusable exports instead:

- `dataTableFeatures` / `DataTableFeatures` — the guide's own "Set up Table
  Features" step has the consumer write a `data-table-features.ts` module
  once per app and share its `TFeatures` type across every column-def file.
  The kit ships this once, and `dataTableColumnHelper()` is
  `createColumnHelper<DataTableFeatures, TData>()` pre-bound to it.
- `dataTableSelectionColumn()` — the guide's "Row Selection" step
  hand-writes a `select` display column with shadcn's `Checkbox` in its
  `header`/`cell`. Same column def, built with the kit's `Checkbox`,
  available as one call. Its checkboxes are icon-only, so their accessible
  names are the whole label: override them with
  `dataTableSelectionColumn({ selectAllLabel, selectRowLabel })` (default
  `'Select all'` / `'Select row'`).
- `DataTableSortButton` — the guide's "Sorting" step hand-writes a ghost
  `Button` + arrow icon toggling `column.toggleSorting` inline in a
  column's `header`. Generalized into one reusable piece.

## Chrome

`Table` stays primitive markup with no chrome of its own; `DataTable` is
where the Studio Data Table frame's card lives. One element wraps the whole
widget: a 1px `--border` on `--surface` at `--radius-lg`, with the table's
rows above and the pagination bar **inside** it — the frame draws that bar
within the same bordered container, separated from the last row by the same
rule that separates any two rows, not floating below the card as the
upstream recipe's utilities left it.

The card deliberately does **not** clip (`overflow` stays visible). Nothing
needs it — a row can never reach a rounded corner, since the header bar is
always above the body and the footer bar always below it — and clipping cost
the focus ring on the footer's own buttons.

`DataTableSortButton` gives up Button's own type role and inherits the
header cell's instead (mono, uppercase, `--subtle-foreground`), so a
sortable column reads identically to an unsortable one plus its direction
icon. Note that `text-transform` has to be inherited back explicitly there:
the UA stylesheet sets `text-transform: none` on every `<button>`, which
beats ordinary inheritance.

Scope is deliberately narrower than the full guide: **column defs,
sorting, row selection, and pagination** only — no column filtering, no
column-visibility toggling, no row actions dropdown, no virtualization, no
column resizing. Each of those is itself a whole guide section the upstream
doc treats as separable; nothing here stops a consumer building any of them
directly against the `table` instance TanStack Table itself exposes (this
component doesn't hide it — see "Escape hatch" below), but `DataTable`
doesn't wire them up automatically.

**TanStack Table v9 API note:** the pinned `@tanstack/react-table@9.1.2` is
a from-scratch rewrite of v8's `useReactTable` — tree-shakeable features
declared with `tableFeatures()`, `useTable()` instead of `useReactTable()`,
row models built with `create*RowModel()` instead of passed in as
`get*RowModel()` options. `DataTable` is built against this real v9 shape
(verified against the package's own shipped `.d.ts` files, not assumed from
v8 familiarity) — a `useLegacyTable` v8-compatibility hook also ships in
this version but is intentionally not used here, since `DataTable` is new
code, not a migration.

## When to use

- Tabular data with more rows than fit comfortably on one screen, where
  the user needs to sort a column, select rows for a bulk action, or page
  through results.

## When not to use

- A short, static list with no sorting/paging/selection need — use
  `Table`'s parts directly (see `../table`).
- Anything needing filtering, column visibility toggling, grouping,
  expansion, or virtualization — build directly against `useTable` (see
  "Escape hatch" below); `DataTable` does not wire these up.

## Props

| Prop | Type | Default |
|------|------|---------|
| `columns` | `ColumnDef<DataTableFeatures, TData>[]` | required |
| `data` | `TData[]` | required |
| `pageSize` | `number` — live, not just a starting value: change it and the table repaginates, keeping the current rows in view | `10` |
| `enableRowSelection` | `boolean` — see below | `false` |
| `emptyMessage` | `ReactNode` — content of the one row spanning every column when `data` is empty | `'No results.'` |
| `previousLabel` / `nextLabel` | `ReactNode` — the pagination buttons' labels | `'Previous'` / `'Next'` |
| `selectionSummary` | `(selected: number, total: number) => ReactNode` — the footer's selection sentence | `` `${selected} of ${total} row(s) selected.` `` |
| `className` | `string` — on the card (the outermost element) | — |

Every string this component renders on its own is one of the props above,
so a non-English table needs no fork: `previousLabel`/`nextLabel` and
`emptyMessage` are plain nodes, and `selectionSummary` is a function
because it counts things — a language with more than one plural form
cannot be served by substituting numbers into a fixed template. The
checkbox column's own two labels are `dataTableSelectionColumn`'s
arguments: `dataTableSelectionColumn({ selectAllLabel, selectRowLabel })`.

`enableRowSelection` gates two independent things: the table option that
lets rows actually be selected, and whether the footer's "N of M row(s)
selected." text renders at all. It does **not** inject a checkbox column —
include `dataTableSelectionColumn()` in `columns` yourself (see below).
This split matches the guide's own treatment of `state.rowSelection` and
the `select` column def as two separate steps a consumer can adopt
independently.

## Building columns

```tsx
import {
  DataTable,
  dataTableColumnHelper,
  dataTableSelectionColumn,
  DataTableSortButton,
} from '@gears-frontx/ui-kit';

type Payment = {
  id: string;
  amount: number;
  status: 'pending' | 'processing' | 'success' | 'failed';
  email: string;
};

const columnHelper = dataTableColumnHelper<Payment>();

// `.columns([...])`, not a bare array literal — its variadic tuple
// inference keeps each column's own TValue instead of widening the whole
// array to a shared supertype (see createColumnHelper's own doc comment).
const columns = columnHelper.columns([
  dataTableSelectionColumn<Payment>(),
  columnHelper.accessor('status', { header: 'Status' }),
  columnHelper.accessor('email', {
    header: ({ column }) => <DataTableSortButton column={column}>Email</DataTableSortButton>,
  }),
  columnHelper.accessor('amount', {
    header: 'Amount',
    cell: ({ getValue }) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(getValue()),
  }),
]);

function PaymentsTable({ data }: { data: Payment[] }) {
  return <DataTable columns={columns} data={data} enableRowSelection />;
}
```

A display column not built through `dataTableSelectionColumn()` (a "row
actions" dropdown menu, say) is still a plain `columnHelper.display({...})`
— the same shape the upstream guide's own "Row Actions" section shows,
composing `DropdownMenu` and reading `row.original` in the cell function.

## Escape hatch

`DataTable` does not hide TanStack Table — every `ColumnDef` and the
`table` instance it builds from `columns`/`data` behave exactly as
`@tanstack/react-table`'s own docs describe. Anything the guide covers that
this component doesn't wire up (filtering, column visibility, row
actions, manual/server-side pagination) is a matter of building your own
component the same way `DataTable`'s own source does — reuse
`dataTableFeatures`/`dataTableColumnHelper` for a consistent `TFeatures`
type, or register a different `tableFeatures()` set entirely for a table
that needs filtering too.

## Anti-patterns

- Do not pass a `columns` array whose defs mix `DataTableFeatures` with
  another features object's column defs — every `ColumnDef` in one table
  must share the same `TFeatures` type parameter.
- Do not rely on `enableRowSelection` alone to show checkboxes — it only
  gates selectability and the footer count; the column itself is opt-in.
