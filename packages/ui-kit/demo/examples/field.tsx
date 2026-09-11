import { useState } from 'react';

import {
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  RadioGroup,
  RadioGroupItem,
  Slider,
  Switch,
  Textarea,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function FieldExample() {
  const [invalid, setInvalid] = useState(true);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)', maxWidth: 480 }}>
      <Section title="Input">
        <Field>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <Input id="username" placeholder="shadcn" aria-describedby="username-desc" />
          <FieldDescription id="username-desc">This is your public display name.</FieldDescription>
        </Field>
      </Section>

      <Section title="Textarea">
        <Field>
          <FieldLabel htmlFor="feedback">Feedback</FieldLabel>
          <Textarea id="feedback" placeholder="Tell us what you think" aria-describedby="feedback-desc" />
          <FieldDescription id="feedback-desc">Shared with the product team only.</FieldDescription>
        </Field>
      </Section>

      <Section title="Select">
        <Field>
          <FieldLabel htmlFor="department">Department</FieldLabel>
          <NativeSelect id="department" defaultValue="eng" aria-describedby="department-desc">
            <NativeSelectOption value="eng">Engineering</NativeSelectOption>
            <NativeSelectOption value="design">Design</NativeSelectOption>
            <NativeSelectOption value="sales">Sales</NativeSelectOption>
          </NativeSelect>
          <FieldDescription id="department-desc">Where this teammate mostly works.</FieldDescription>
        </Field>
      </Section>

      <Section title="Slider">
        <Field>
          <FieldLabel htmlFor="price">Price range</FieldLabel>
          <Slider id="price" defaultValue={[50]} aria-describedby="price-desc" />
          <FieldDescription id="price-desc">Set the maximum monthly budget.</FieldDescription>
        </Field>
      </Section>

      <Section title="Checkbox">
        <Field orientation="horizontal">
          <Checkbox id="notify" defaultChecked aria-labelledby="notify-title" aria-describedby="notify-desc" />
          <FieldContent>
            <FieldTitle id="notify-title">Email notifications</FieldTitle>
            <FieldDescription id="notify-desc">Receive updates about your account activity.</FieldDescription>
          </FieldContent>
        </Field>
      </Section>

      <Section title="Radio">
        <FieldSet>
          <FieldLegend>Subscription plan</FieldLegend>
          <RadioGroup defaultValue="pro">
            <Field orientation="horizontal">
              <RadioGroupItem value="free" id="plan-free" />
              <FieldLabel htmlFor="plan-free">Free</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="pro" id="plan-pro" />
              <FieldLabel htmlFor="plan-pro">Pro</FieldLabel>
            </Field>
          </RadioGroup>
        </FieldSet>
      </Section>

      <Section title="Switch">
        <FieldGroup>
          <FieldSet>
            <FieldLegend variant="label">Security</FieldLegend>
            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Two-factor authentication</FieldTitle>
                <FieldDescription>Require a code in addition to your password.</FieldDescription>
              </FieldContent>
              <Switch />
            </Field>
          </FieldSet>
        </FieldGroup>
      </Section>

      <Section title="Fieldset">
        <FieldSet>
          <FieldLegend>Address</FieldLegend>
          <Row style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <Field>
              <FieldLabel htmlFor="street">Street</FieldLabel>
              <Input id="street" placeholder="1 Infinite Loop" />
            </Field>
            <Field>
              <FieldLabel htmlFor="city">City</FieldLabel>
              <Input id="city" placeholder="Cupertino" />
            </Field>
          </Row>
        </FieldSet>
      </Section>

      <Section title="Field group">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email-notifications">Email</FieldLabel>
            <Input id="email-notifications" type="email" placeholder="you@company.com" />
          </Field>
          <FieldSeparator>or continue with</FieldSeparator>
          <Field>
            <FieldLabel htmlFor="phone-notifications">Phone</FieldLabel>
            <Input id="phone-notifications" type="tel" placeholder="+1 555 0100" />
          </Field>
        </FieldGroup>
      </Section>

      <Section title="Validation and errors">
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor="server-email">Email</FieldLabel>
          <Input
            id="server-email"
            type="email"
            defaultValue="not-an-email"
            aria-invalid={invalid}
            aria-describedby="server-email-error"
            onChange={(event) => setInvalid(!event.currentTarget.value.includes('@'))}
          />
          <FieldError id="server-email-error" errors={invalid ? [{ message: 'Enter a valid email address.' }] : []} />
        </Field>
      </Section>

      <Section title="Responsive layout">
        <Field orientation="responsive">
          <FieldLabel htmlFor="full-name">Full name</FieldLabel>
          <Input id="full-name" placeholder="Jane Doe" />
        </Field>
      </Section>
    </div>
  );
}
