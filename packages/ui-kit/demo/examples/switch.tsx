import { useState } from 'react';

import { Field, FieldContent, FieldDescription, FieldTitle, Label, Switch } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function SwitchExample() {
  const [shared, setShared] = useState(true);
  return (
    <>
      <Section title="Basic">
        <Row>
          <Label>
            <Switch defaultChecked /> Airplane mode
          </Label>
        </Row>
      </Section>

      <Section title="With description">
        <Field orientation="horizontal" style={{ maxWidth: 380 }}>
          <FieldContent>
            <FieldTitle>Sync focus</FieldTitle>
            <FieldDescription>Shared across devices, off outside the app.</FieldDescription>
          </FieldContent>
          <Switch checked={shared} onCheckedChange={setShared} />
        </Field>
      </Section>

      <Section title="Sizes">
        <Row>
          <Label>
            <Switch size="sm" defaultChecked /> Small
          </Label>
          <Label>
            <Switch defaultChecked /> Default
          </Label>
        </Row>
      </Section>

      <Section title="Disabled">
        <Row>
          <Label>
            <Switch disabled /> Off
          </Label>
          <Label>
            <Switch disabled defaultChecked /> On
          </Label>
        </Row>
      </Section>

      <Section title="Invalid">
        <Row>
          <Label>
            <Switch aria-invalid /> Required setting
          </Label>
        </Row>
      </Section>
    </>
  );
}
