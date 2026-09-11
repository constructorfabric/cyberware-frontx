import { useState } from 'react';

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxValue,
  useComboboxAnchor,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Section } from '../shared';

interface Region {
  value: string;
  label: string;
}

const REGIONS: Region[] = [
  { value: 'frankfurt', label: 'Frankfurt' },
  { value: 'dublin', label: 'Dublin' },
  { value: 'virginia', label: 'Virginia' },
  { value: 'oregon', label: 'Oregon' },
];

const FRAMEWORKS = ['React', 'Vue', 'Svelte', 'Solid'];

const EUROPE: Region[] = [
  { value: 'eu-central', label: 'Frankfurt' },
  { value: 'eu-west', label: 'Dublin' },
];

const AMERICAS: Region[] = [
  { value: 'us-east', label: 'Virginia' },
  { value: 'us-west', label: 'Oregon (soon)' },
];

const GROUPS = [
  { value: 'Europe', items: EUROPE },
  { value: 'Americas', items: AMERICAS },
];

function MultipleDemo() {
  const anchor = useComboboxAnchor();
  return (
    <Combobox multiple items={FRAMEWORKS}>
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(values: string[]) => (
            <>
              {values.map((value) => (
                <ComboboxChip key={value}>{value}</ComboboxChip>
              ))}
              <ComboboxChipsInput aria-label="Frameworks" placeholder="Add a framework" />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No frameworks found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export default function ComboboxExample() {
  const [region, setRegion] = useState<Region | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '20rem' }}>
      <Section title="Basic">
        <Combobox items={REGIONS} value={region} onValueChange={setRegion}>
          <ComboboxInput aria-label="Region" placeholder="Select a region…" showClear />
          <ComboboxContent>
            <ComboboxEmpty>No region matches your search.</ComboboxEmpty>
            <ComboboxList>
              {(item: Region) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Section>
      <Section title="Multiple">
        <MultipleDemo />
      </Section>
      <Section title="Groups">
        <Combobox items={GROUPS}>
          <ComboboxInput aria-label="Region" placeholder="Search a region…" showClear />
          <ComboboxContent>
            <ComboboxEmpty>No region matches your search.</ComboboxEmpty>
            <ComboboxList>
              {(group: (typeof GROUPS)[number]) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(item: Region) => (
                      <ComboboxItem key={item.value} value={item} disabled={item.value === 'us-west'}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                  <ComboboxSeparator />
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Section>
      <Section title="Custom items">
        <Combobox items={REGIONS}>
          <ComboboxInput aria-label="Region" placeholder="Select a region…" />
          <ComboboxContent>
            <ComboboxEmpty>No region matches your search.</ComboboxEmpty>
            <ComboboxList>
              {(item: Region) => (
                <ComboboxItem key={item.value} value={item}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ width: 14, height: 14 }}>
                      <DemoIcon />
                    </span>
                    {item.label}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Section>
      <Section title="Invalid">
        <Combobox items={REGIONS}>
          <ComboboxInput aria-label="Region" placeholder="Select a region…" aria-invalid />
          <ComboboxContent>
            <ComboboxEmpty>No region matches your search.</ComboboxEmpty>
            <ComboboxList>
              {(item: Region) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Section>
      <Section title="Disabled">
        <Combobox items={REGIONS} disabled>
          <ComboboxInput aria-label="Region" placeholder="Select a region…" />
          <ComboboxContent>
            <ComboboxEmpty>No region matches your search.</ComboboxEmpty>
            <ComboboxList>
              {(item: Region) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Section>
      <Section title="Auto highlight">
        <Combobox items={REGIONS} autoHighlight>
          <ComboboxInput aria-label="Region" placeholder="Select a region…" />
          <ComboboxContent>
            <ComboboxEmpty>No region matches your search.</ComboboxEmpty>
            <ComboboxList>
              {(item: Region) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Section>
    </div>
  );
}
