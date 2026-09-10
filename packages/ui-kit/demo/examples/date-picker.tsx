import { useState } from 'react';
import type { DateRange } from 'react-day-picker';

import { DatePicker, DirectionProvider } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

export default function DatePickerExample() {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [dob, setDob] = useState<Date | undefined>(undefined);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [inputDate, setInputDate] = useState<Date | undefined>(undefined);
  const [rtlDate, setRtlDate] = useState<Date | undefined>(undefined);

  return (
    <>
      <Section title="Basic">
        <DatePicker selected={date} onSelect={setDate} />
      </Section>

      <Section title="Range">
        <DatePicker mode="range" selected={range} onSelect={setRange} />
      </Section>

      <Section title="Date of birth">
        <DatePicker selected={dob} onSelect={setDob} captionLayout="dropdown" placeholder="Select date" />
      </Section>

      <Section title="Input">
        <DatePicker
          variant="input"
          selected={inputDate}
          onSelect={setInputDate}
          placeholder="June 01, 2025"
        />
      </Section>

      <Section title="RTL">
        <DirectionProvider direction="rtl">
          <DatePicker selected={rtlDate} onSelect={setRtlDate} />
        </DirectionProvider>
      </Section>
    </>
  );
}
