import { useState } from 'react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

const REGIONS = [
  { value: 'eu-central', label: 'Frankfurt' },
  { value: 'eu-west', label: 'Dublin' },
  { value: 'us-east', label: 'Virginia' },
  { value: 'us-west', label: 'Oregon' },
];

const GROUPED_REGIONS = [
  { group: 'Europe', items: [REGIONS[0]!, REGIONS[1]!] },
  { group: 'Americas', items: [REGIONS[2]!, REGIONS[3]!] },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

export default function SelectExample() {
  const [region, setRegion] = useState<string | null>(null);
  return (
    <>
      <Section title="Default">
        <Select value={region} onValueChange={setRegion} items={REGIONS}>
          <SelectTrigger aria-label="Region">
            <SelectValue placeholder="Pick a region" />
          </SelectTrigger>
          <SelectContent>
            {REGIONS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section title="Groups">
        <Select items={REGIONS}>
          <SelectTrigger aria-label="Region, grouped">
            <SelectValue placeholder="Pick a region" />
          </SelectTrigger>
          <SelectContent>
            {GROUPED_REGIONS.map(({ group, items }, index) => (
              <SelectGroup key={group}>
                {index > 0 && <SelectSeparator />}
                <SelectLabel>{group}</SelectLabel>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <Section title="Scrollable">
        <Select defaultValue="18" items={HOURS}>
          <SelectTrigger aria-label="Hour">
            <SelectValue placeholder="Hour" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Hours</SelectLabel>
              {HOURS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Section>

      <Row>
        <Section title="Filter">
          <Select items={REGIONS}>
            <SelectTrigger aria-label="Region filter" variant="filter">
              <SelectValue placeholder="Filter · 2" />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title="Disabled">
          <Select disabled items={REGIONS}>
            <SelectTrigger aria-label="Region">
              <SelectValue placeholder="Pick a region" />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title="Invalid">
          <Select items={REGIONS}>
            <SelectTrigger aria-label="Region" aria-invalid>
              <SelectValue placeholder="Pick a region" />
            </SelectTrigger>
            <SelectContent>
              {REGIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      </Row>
    </>
  );
}
