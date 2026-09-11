/**
 * Form Elements Category
 *
 * Demonstrates: Field, Label, Input, Textarea, Select, Checkbox, RadioGroup, Switch
 */

import React, { useState } from 'react';
import {
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@gears-frontx/ui-kit';
import { ElementDemo } from './ElementDemo';
import styles from '../UIKitElements.module.css';

interface FormElementsProps {
  t: (key: string) => string;
  /**
   * Element inside this MFE's shadow root that Select's popup portals into.
   * Left to the kit's `<body>` default the popup lands in the light DOM, where
   * neither the adopted component stylesheets nor this host's tokens reach it.
   */
  portalContainer: React.RefObject<HTMLElement | null>;
}

/**
 * Select renders the closed trigger from this list, not from the popup's items:
 * without it the trigger shows the raw value until the popup has been opened
 * once. Hoisted to module level so the array keeps a stable identity across
 * renders.
 */
const REGION_ITEMS = [
  { value: 'eu-central', label: 'Frankfurt' },
  { value: 'eu-west', label: 'Dublin' },
  { value: 'us-east', label: 'Virginia' },
];

/**
 * Which of the two `ValidityState` flags the demo reacts to, kept as a reason
 * rather than as the message it resolves to: the host can switch language while
 * an error is on screen, and a stored message would keep the language it was
 * produced in until the field is blurred again.
 */
type EmailErrorReason = 'required' | 'malformed';

const EMAIL_ERROR_KEYS: Record<EmailErrorReason, string> = {
  required: 'form_email_required',
  malformed: 'form_email_invalid',
};

export const FormElements: React.FC<FormElementsProps> = ({ t, portalContainer }) => {
  const [region, setRegion] = useState('eu-central');
  const [plan, setPlan] = useState('free');
  const [notifications, setNotifications] = useState(true);
  const [emailError, setEmailError] = useState<EmailErrorReason | null>(null);

  /**
   * Field derives no validation of its own, so the demo runs the check the
   * browser already did: `<input type="email" required>` fills in `validity`
   * either way, and this only picks which message the field shows. Read on
   * blur rather than on every keystroke so a half-typed address is not
   * flagged as malformed while it is still being typed.
   */
  const validateEmail = (event: React.SyntheticEvent<HTMLInputElement>) => {
    const { validity } = event.currentTarget;
    if (validity.valueMissing) {
      setEmailError('required');
    } else if (validity.typeMismatch) {
      setEmailError('malformed');
    } else {
      setEmailError(null);
    }
  };

  /**
   * A message already on screen has to come off the moment the field is
   * corrected, so once there is one, every keystroke re-runs the same check.
   * The gate is what keeps the blur-only rule intact for a field that has not
   * been flagged yet: with no error showing there is nothing to clear, and
   * validating from the first character is exactly what reading on blur avoids.
   */
  const revalidateEmail = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (emailError) {
      validateEmail(event);
    }
  };

  return (
    <section id="category-forms" className={styles.category}>
      <h2 className={styles.categoryTitle}>{t('category.forms')}</h2>

      <ElementDemo
        id="field"
        title={t('element.field.title')}
        description={t('element.field.description')}
      >
        <div className={styles.stack}>
          {/*
            Field is the kit's layout for a labelled control and nothing more:
            it wires no ids and derives no validity, so `htmlFor`,
            `aria-describedby` and the invalid state are all set by hand here.
            The description stays in `aria-describedby` when the error joins it
            — replacing it would drop the hint the moment it is most useful.
          */}
          <Field data-invalid={emailError ? true : undefined}>
            <FieldLabel htmlFor="form-demo-email">Email</FieldLabel>
            <Input
              id="form-demo-email"
              type="email"
              required
              placeholder="you@company.com"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={
                emailError
                  ? 'form-demo-email-description form-demo-email-error'
                  : 'form-demo-email-description'
              }
              onBlur={validateEmail}
              onChange={revalidateEmail}
            />
            <FieldDescription id="form-demo-email-description">
              We only use it for the invoice.
            </FieldDescription>
            <FieldError id="form-demo-email-error">
              {emailError ? t(EMAIL_ERROR_KEYS[emailError]) : null}
            </FieldError>
          </Field>
        </div>
      </ElementDemo>

      <ElementDemo
        id="label"
        title={t('element.label.title')}
        description={t('element.label.description')}
      >
        {/*
          Label is a styled native `<label>` with no id wiring of its own, for
          controls that stand outside a Field. Nesting the control gives the
          pair one click target without an `htmlFor`.
        */}
        <Label>
          <Checkbox name="standalone-terms" />
          Nesting the control needs no htmlFor
        </Label>

        <div className={styles.stack}>
          <Label htmlFor="label-demo-input">Associated through htmlFor</Label>
          <Input id="label-demo-input" placeholder="Project name" />
        </div>
      </ElementDemo>

      <ElementDemo
        id="input"
        title={t('element.input.title')}
        description={t('element.input.description')}
      >
        <div className={styles.stack}>
          <Input type="text" placeholder="Plain text" />
          <Input type="password" placeholder="Password" />
          {/* `type="search"` grows a magnifier and a searchbox role, with no prop. */}
          <Input type="search" placeholder="Search projects" />
          <Input aria-invalid defaultValue="Rejected value" />
          <Input disabled placeholder="Disabled" />
        </div>
      </ElementDemo>

      <ElementDemo
        id="textarea"
        title={t('element.textarea.title')}
        description={t('element.textarea.description')}
      >
        <div className={styles.stack}>
          <Textarea placeholder="Type your message here..." />
          <Textarea rows={6} placeholder="Six rows to start with" />
        </div>
      </ElementDemo>

      <ElementDemo
        id="select"
        title={t('element.select.title')}
        description={t('element.select.description')}
      >
        <div className={styles.stack}>
          <Field>
            {/*
              SelectTrigger renders the button that carries the field's
              accessible name, so the label points at the trigger's own id.
            */}
            <FieldLabel htmlFor="form-demo-region">Region</FieldLabel>
            {/*
              Select reports `null` when a selection is cleared, which this demo
              has no control for; the fallback keeps the trigger showing a region
              rather than the placeholder.
            */}
            <Select
              items={REGION_ITEMS}
              value={region}
              onValueChange={(value) => setRegion(value ?? REGION_ITEMS[0].value)}
            >
              <SelectTrigger id="form-demo-region">
                <SelectValue placeholder="Pick a region" />
              </SelectTrigger>
              <SelectContent container={portalContainer}>
                {/* The group carries the list padding; items directly under the content lose it. */}
                <SelectGroup>
                  <SelectLabel>Europe</SelectLabel>
                  {REGION_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </ElementDemo>

      <ElementDemo
        id="checkbox"
        title={t('element.checkbox.title')}
        description={t('element.checkbox.description')}
      >
        <Label className={styles.inlineControl}>
          <Checkbox name="terms" />
          Accept terms and conditions
        </Label>
        <Label className={styles.inlineControl}>
          <Checkbox name="newsletter" defaultChecked />
          Checked by default
        </Label>
        <Label className={styles.inlineControl}>
          {/* Reports `aria-checked="mixed"` rather than a third boolean state. */}
          <Checkbox name="partial" indeterminate />
          Indeterminate
        </Label>
        <Label className={styles.inlineControl}>
          <Checkbox name="locked" disabled />
          Disabled
        </Label>
      </ElementDemo>

      <ElementDemo
        id="radio"
        title={t('element.radio.title')}
        description={t('element.radio.description')}
      >
        <RadioGroup value={plan} onValueChange={(value) => setPlan(String(value))}>
          <Label className={styles.inlineControl}>
            <RadioGroupItem value="free" />
            Free
          </Label>
          <Label className={styles.inlineControl}>
            <RadioGroupItem value="pro" />
            Pro
          </Label>
          <Label className={styles.inlineControl}>
            <RadioGroupItem value="enterprise" disabled />
            Enterprise (unavailable)
          </Label>
        </RadioGroup>
        <p className={styles.note}>
          Selected: <span className={styles.mono}>{plan}</span>
        </p>
      </ElementDemo>

      <ElementDemo
        id="switch"
        title={t('element.switch.title')}
        description={t('element.switch.description')}
      >
        <Label className={styles.inlineControl}>
          <Switch checked={notifications} onCheckedChange={setNotifications} />
          Enable notifications
        </Label>
        <Label className={styles.inlineControl}>
          <Switch size="sm" defaultChecked />
          Small switch
        </Label>
        <Label className={styles.inlineControl}>
          <Switch disabled />
          Disabled
        </Label>
      </ElementDemo>
    </section>
  );
};

FormElements.displayName = 'FormElements';
