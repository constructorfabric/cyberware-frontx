import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Label,
  RadioGroup,
  RadioGroupItem,
} from '@gears-frontx/ui-kit';

import { Section } from '../shared';

export default function RadioGroupExample() {
  return (
    <>
      <Section title="Default">
        <RadioGroup defaultValue="a" style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <Label>
            <RadioGroupItem value="a" /> Option A
          </Label>
          <Label>
            <RadioGroupItem value="b" /> Option B
          </Label>
        </RadioGroup>
      </Section>

      <Section title="Description">
        <RadioGroup defaultValue="pro" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Field>
            <FieldLabel>
              <RadioGroupItem value="free" /> Free
            </FieldLabel>
            <FieldDescription>Basic features for individuals.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>
              <RadioGroupItem value="pro" /> Pro
            </FieldLabel>
            <FieldDescription>Everything in Free, plus team collaboration.</FieldDescription>
          </Field>
        </RadioGroup>
      </Section>

      <Section title="Fieldset">
        <FieldSet>
          <FieldLegend>Notification frequency</FieldLegend>
          <RadioGroup defaultValue="daily" style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Label>
              <RadioGroupItem value="realtime" /> Real-time
            </Label>
            <Label>
              <RadioGroupItem value="daily" /> Daily digest
            </Label>
            <Label>
              <RadioGroupItem value="weekly" /> Weekly digest
            </Label>
          </RadioGroup>
        </FieldSet>
      </Section>

      <Section title="Disabled">
        <RadioGroup defaultValue="a" disabled style={{ display: 'flex', gap: 'var(--space-4)' }}>
          <Label>
            <RadioGroupItem value="a" /> Option A
          </Label>
          <Label>
            <RadioGroupItem value="b" /> Option B
          </Label>
        </RadioGroup>
      </Section>

      <Section title="Invalid">
        <FieldSet>
          <FieldLegend>Notification method</FieldLegend>
          <RadioGroup style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Label>
              <RadioGroupItem value="email" aria-invalid /> Email
            </Label>
            <Label>
              <RadioGroupItem value="sms" aria-invalid /> SMS
            </Label>
          </RadioGroup>
          <FieldError>Pick a notification method.</FieldError>
        </FieldSet>
      </Section>
    </>
  );
}
