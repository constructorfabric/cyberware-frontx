import { useState } from 'react';

import { Button, InputOtp, InputOtpGroup, InputOtpSeparator, InputOtpSlot } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function InputOtpExample() {
  const [code, setCode] = useState('');

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
      <Section title="Basic">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label htmlFor="otp-basic">Verification code</label>
          <InputOtp id="otp-basic" length={6}>
            <InputOtpGroup>
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
            </InputOtpGroup>
            <InputOtpSeparator />
            <InputOtpGroup>
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
            </InputOtpGroup>
          </InputOtp>
        </div>
      </Section>

      <Section title="Disabled">
        <InputOtp length={4} disabled aria-label="Verification code">
          <InputOtpGroup>
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
          </InputOtpGroup>
        </InputOtp>
      </Section>

      <Section title="Controlled">
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <InputOtp length={4} value={code} onValueChange={setCode} aria-label="Verification code">
            <InputOtpGroup>
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
            </InputOtpGroup>
          </InputOtp>
          <span>Value: {code || '—'}</span>
        </div>
      </Section>

      <Section title="Invalid">
        <InputOtp length={4} defaultValue="12" aria-label="Verification code">
          <InputOtpGroup>
            <InputOtpSlot aria-invalid />
            <InputOtpSlot aria-invalid />
            <InputOtpSlot aria-invalid />
            <InputOtpSlot aria-invalid />
          </InputOtpGroup>
        </InputOtp>
      </Section>

      <Section title="Four digits">
        <InputOtp length={4} validationType="numeric" aria-label="PIN code">
          <InputOtpGroup>
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
          </InputOtpGroup>
        </InputOtp>
      </Section>

      <Section title="Alphanumeric">
        <InputOtp length={6} validationType="alphanumeric" aria-label="Invite code">
          <InputOtpGroup>
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
            <InputOtpSlot />
          </InputOtpGroup>
        </InputOtp>
      </Section>

      <Section title="Form">
        <form
          style={{ display: 'grid', gap: 'var(--space-3)' }}
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="otp-form">One-time password</label>
          <InputOtp id="otp-form" length={6} required>
            <InputOtpGroup>
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
              <InputOtpSlot />
            </InputOtpGroup>
          </InputOtp>
          <Row>
            <Button type="submit">Verify</Button>
            <Button type="button" variant="outline">
              Resend
            </Button>
          </Row>
        </form>
      </Section>
    </div>
  );
}
