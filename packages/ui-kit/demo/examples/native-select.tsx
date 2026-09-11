import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function NativeSelectExample() {
  return (
    <>
      <Section title="Basic">
        <Row>
          <NativeSelect aria-label="Region" defaultValue="eu">
            <NativeSelectOption value="eu">Europe</NativeSelectOption>
            <NativeSelectOption value="us">Americas</NativeSelectOption>
          </NativeSelect>
          <NativeSelect size="sm" aria-label="Region (compact)" defaultValue="eu">
            <NativeSelectOption value="eu">Europe</NativeSelectOption>
            <NativeSelectOption value="us">Americas</NativeSelectOption>
          </NativeSelect>
        </Row>
      </Section>

      <Section title="Groups">
        <NativeSelect aria-label="Role">
          <NativeSelectOptGroup label="Engineering">
            <NativeSelectOption value="frontend">Frontend</NativeSelectOption>
            <NativeSelectOption value="backend">Backend</NativeSelectOption>
            <NativeSelectOption value="devops">DevOps</NativeSelectOption>
          </NativeSelectOptGroup>
          <NativeSelectOptGroup label="Business">
            <NativeSelectOption value="sales">Sales</NativeSelectOption>
          </NativeSelectOptGroup>
        </NativeSelect>
      </Section>

      <Section title="Disabled">
        <NativeSelect disabled aria-label="Region (disabled)" defaultValue="apple">
          <NativeSelectOption value="apple">Apple</NativeSelectOption>
          <NativeSelectOption value="banana">Banana</NativeSelectOption>
          <NativeSelectOption value="blueberry">Blueberry</NativeSelectOption>
        </NativeSelect>
      </Section>

      <Section title="Invalid">
        <NativeSelect aria-invalid aria-label="Region (invalid)" defaultValue="apple">
          <NativeSelectOption value="apple">Apple</NativeSelectOption>
          <NativeSelectOption value="banana">Banana</NativeSelectOption>
          <NativeSelectOption value="blueberry">Blueberry</NativeSelectOption>
        </NativeSelect>
      </Section>
    </>
  );
}
