import { Checkbox, Field, FieldDescription, Input, Label, Switch } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function LabelExample() {
  return (
    <>
      <Section title="Wrapped control">
        <Row>
          <Label>
            <Checkbox defaultChecked /> Accept terms and conditions
          </Label>
        </Row>
      </Section>

      <Section title="Explicit association">
        <Row>
          <Label htmlFor="label-email">Email</Label>
          <Input id="label-email" type="email" placeholder="you@company.com" />
        </Row>
      </Section>

      <Section title="Label in Field">
        <Field>
          <Label htmlFor="label-username">Username</Label>
          <Input id="label-username" placeholder="shadcn" aria-describedby="label-username-desc" />
          <FieldDescription id="label-username-desc">This is your public display name.</FieldDescription>
        </Field>
      </Section>

      <Section title="With Switch">
        <Row>
          <Label>
            <Switch defaultChecked /> Enable notifications
          </Label>
        </Row>
      </Section>
    </>
  );
}
