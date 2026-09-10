import { useState } from 'react';

import {
  Field,
  FieldDescription,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
  Textarea,
} from '@gears-frontx/ui-kit';

import { Section } from '../shared';

export default function TextareaExample() {
  const [message, setMessage] = useState('');
  return (
    <>
      <Section title="Basic">
        <Textarea placeholder="Describe the issue…" style={{ maxWidth: 420 }} />
      </Section>

      <Section title="In a field">
        <Field style={{ maxWidth: 420 }}>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea id="notes" aria-describedby="notes-desc" placeholder="Multi-line text…" />
          <FieldDescription id="notes-desc">Visible only to your team.</FieldDescription>
        </Field>
      </Section>

      <Section title="Disabled">
        <Textarea disabled defaultValue="Read-only content." style={{ maxWidth: 420 }} />
      </Section>

      <Section title="Invalid">
        <Textarea aria-invalid defaultValue="Too long…" style={{ maxWidth: 420 }} />
      </Section>

      <Section title="With button">
        <InputGroup style={{ maxWidth: 420 }}>
          <InputGroupTextarea
            placeholder="Type your message…"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton disabled={message.trim() === ''}>Send</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Section>
    </>
  );
}
