import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DataTable,
  dataTableColumnHelper,
  dataTableSelectionColumn,
  DataTableSortButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit';

import { Section } from '../shared';

interface Payment {
  id: string;
  amount: number;
  status: 'pending' | 'processing' | 'success' | 'failed';
  email: string;
}

const payments: Payment[] = [
  { id: '728ed52f', amount: 100, status: 'pending', email: 'm@example.com' },
  { id: '489e1d42', amount: 125, status: 'processing', email: 'example@gmail.com' },
  { id: 'a1b2c3d4', amount: 250, status: 'success', email: 'jane@example.com' },
  { id: 'e5f6g7h8', amount: 75, status: 'failed', email: 'john@example.com' },
];

const columnHelper = dataTableColumnHelper<Payment>();

const currency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

// `.columns([...])`, not a bare array literal: it uses variadic tuple
// inference to keep each column's own TValue (string, number, ...)
// instead of a plain array literal widening every element to a shared
// supertype — see createColumnHelper's own doc comment.
const basicColumns = columnHelper.columns([
  columnHelper.accessor('status', { header: 'Status' }),
  columnHelper.accessor('email', { header: 'Email' }),
  columnHelper.accessor('amount', { header: 'Amount', cell: ({ getValue }) => currency(getValue()) }),
]);

const sortableColumns = columnHelper.columns([
  columnHelper.accessor('status', { header: 'Status' }),
  columnHelper.accessor('email', {
    header: ({ column }) => <DataTableSortButton column={column}>Email</DataTableSortButton>,
  }),
  columnHelper.accessor('amount', {
    header: ({ column }) => <DataTableSortButton column={column}>Amount</DataTableSortButton>,
    cell: ({ getValue }) => currency(getValue()),
  }),
]);

const selectableColumns = columnHelper.columns([
  dataTableSelectionColumn<Payment>(),
  columnHelper.accessor('status', { header: 'Status' }),
  columnHelper.accessor('email', { header: 'Email' }),
  columnHelper.accessor('amount', { header: 'Amount', cell: ({ getValue }) => currency(getValue()) }),
]);

const columnsWithActions = columnHelper.columns([
  columnHelper.accessor('status', { header: 'Status' }),
  columnHelper.accessor('email', { header: 'Email' }),
  columnHelper.accessor('amount', { header: 'Amount', cell: ({ getValue }) => currency(getValue()) }),
  columnHelper.display({
    id: 'actions',
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="Row actions" />}>
          …
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => navigator.clipboard.writeText(row.original.id)}>
            Copy payment ID
          </DropdownMenuItem>
          <DropdownMenuItem>View customer</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Refund</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }),
]);

/*
 * The people-table row the Studio Data Table frame draws: a toned avatar
 * beside a two-line identity stack, with every column after the first set
 * in --muted-foreground so the row has one focal point. Nothing here is a
 * kit API — it is the composition a consumer writes into a cell, shown so
 * the demo exercises a row taller than the single-line default.
 */
interface Member {
  name: string;
  email: string;
  role: string;
  scope: string;
  active: string;
  tone: 'accent' | 'info' | 'success' | 'warning';
}

const members: Member[] = [
  { name: 'Aisha Rahman', email: 'aisha@constructor.dev', role: 'Project admin', scope: 'Direct', active: 'Now', tone: 'accent' },
  { name: 'Morgan Lee', email: 'morgan@constructor.dev', role: 'Editor', scope: 'Architecture Guild', active: '12 min ago', tone: 'info' },
  { name: 'Priya Nair', email: 'priya@constructor.dev', role: 'Reviewer', scope: 'Direct', active: '2 h ago', tone: 'success' },
  { name: 'Jordan Blake', email: 'jordan@constructor.dev', role: 'Viewer', scope: 'Platform Program', active: '1 d ago', tone: 'warning' },
];

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('');

const memberHelper = dataTableColumnHelper<Member>();

const memberColumns = memberHelper.columns([
  memberHelper.accessor('name', {
    header: 'Member',
    cell: ({ row }) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Avatar>
          <AvatarFallback tone={row.original.tone} variant="solid">
            {initials(row.original.name)}
          </AvatarFallback>
        </Avatar>
        <div style={{ display: 'grid' }}>
          <span style={{ fontWeight: 600 }}>{row.original.name}</span>
          <span style={{ color: 'var(--muted-foreground)' }}>{row.original.email}</span>
        </div>
      </div>
    ),
  }),
  memberHelper.accessor('role', {
    header: 'Project role',
    cell: ({ getValue }) => <span style={{ color: 'var(--muted-foreground)' }}>{getValue()}</span>,
  }),
  memberHelper.accessor('scope', {
    header: 'Access via',
    cell: ({ getValue }) => <Badge variant="outline">{getValue()}</Badge>,
  }),
  memberHelper.accessor('active', {
    header: ({ column }) => <DataTableSortButton column={column}>Last active</DataTableSortButton>,
    cell: ({ getValue }) => <span style={{ color: 'var(--muted-foreground)' }}>{getValue()}</span>,
  }),
]);

export default function DataTableExample() {
  return (
    <>
      <Section title="Basic">
        <DataTable columns={basicColumns} data={payments} />
      </Section>

      <Section title="Sorting">
        <DataTable columns={sortableColumns} data={payments} />
      </Section>

      <Section title="Row selection">
        <DataTable columns={selectableColumns} data={payments} enableRowSelection />
      </Section>

      <Section title="Row actions">
        <DataTable columns={columnsWithActions} data={payments} />
      </Section>

      <Section title="Pagination">
        <DataTable columns={basicColumns} data={payments} pageSize={2} />
      </Section>

      <Section title="Empty">
        <DataTable columns={basicColumns} data={[]} emptyMessage="No payments yet." />
      </Section>

      <Section title="Row composition">
        <DataTable columns={memberColumns} data={members} enableRowSelection />
      </Section>
    </>
  );
}
