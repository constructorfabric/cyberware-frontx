import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';

import { Section } from '../shared';

const INVOICES = [
  { id: 'INV001', status: 'Paid', amount: '$250.00' },
  { id: 'INV002', status: 'Pending', amount: '$150.00' },
  { id: 'INV003', status: 'Unpaid', amount: '$350.00' },
];

export default function TableExample() {
  return (
    <>
      <Section title="Basic">
        <Table>
          <TableCaption>A list of recent invoices.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead style={{ textAlign: 'right' }}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {INVOICES.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>{invoice.id}</TableCell>
                <TableCell>{invoice.status}</TableCell>
                <TableCell style={{ textAlign: 'right' }}>{invoice.amount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Footer">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead style={{ textAlign: 'right' }}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {INVOICES.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>{invoice.id}</TableCell>
                <TableCell style={{ textAlign: 'right' }}>{invoice.amount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell style={{ textAlign: 'right' }}>$750.00</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Section>

      <Section title="Actions">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {INVOICES.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>{invoice.id}</TableCell>
                <TableCell style={{ textAlign: 'right' }}>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="sm">Actions</Button>} />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>View</DropdownMenuItem>
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Row states">
        <Table>
          <TableBody>
            <TableRow data-state="selected">
              <TableCell>gears-scheduler (selected)</TableCell>
              <TableCell>
                <Badge variant="success">running</Badge>
              </TableCell>
            </TableRow>
            <TableRow data-state="stale">
              <TableCell>gears-connector (stale)</TableCell>
              <TableCell>
                <Badge variant="warning">needs action</Badge>
              </TableCell>
            </TableRow>
            <TableRow data-state="restricted">
              <TableCell>gears-vault (restricted)</TableCell>
              <TableCell>
                <Badge variant="danger">no access</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Density">
        <Table density="compact">
          <TableBody>
            <TableRow>
              <TableCell>compact density</TableCell>
              <TableCell>row one</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>compact density</TableCell>
              <TableCell>row two</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>
    </>
  );
}
