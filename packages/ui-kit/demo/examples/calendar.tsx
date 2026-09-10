import { useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { Button, Calendar } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

const CALENDAR_STYLE = { border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' };

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
];

function SingleDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  return <Calendar mode="single" selected={date} onSelect={setDate} style={CALENDAR_STYLE} />;
}

function RangeDemo() {
  const [range, setRange] = useState<DateRange | undefined>();
  return (
    <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={2} style={CALENDAR_STYLE} />
  );
}

function MultipleDemo() {
  const [dates, setDates] = useState<Date[] | undefined>();
  return <Calendar mode="multiple" selected={dates} onSelect={setDates} style={CALENDAR_STYLE} />;
}

function DropdownDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      captionLayout="dropdown"
      style={CALENDAR_STYLE}
    />
  );
}

function PresetsDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Row>
        {PRESETS.map(({ label, days }) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            onClick={() => {
              const next = new Date();
              next.setDate(next.getDate() + days);
              setDate(next);
            }}
          >
            {label}
          </Button>
        ))}
      </Row>
      <Calendar mode="single" selected={date} onSelect={setDate} style={CALENDAR_STYLE} />
    </div>
  );
}

function DisabledDemo() {
  const [date, setDate] = useState<Date | undefined>();
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      disabled={{ dayOfWeek: [0, 6] }}
      style={CALENDAR_STYLE}
    />
  );
}

export default function CalendarExample() {
  return (
    <>
      <Section title="Single date">
        <SingleDemo />
      </Section>
      <Section title="Range, two months">
        <RangeDemo />
      </Section>
      <Section title="Multiple dates">
        <MultipleDemo />
      </Section>
      <Section title="Dropdown navigation">
        <DropdownDemo />
      </Section>
      <Section title="Disabled dates">
        <DisabledDemo />
      </Section>
      <Section title="Presets">
        <PresetsDemo />
      </Section>
    </>
  );
}
