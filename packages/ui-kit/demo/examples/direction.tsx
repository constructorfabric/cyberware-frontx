import { Button, DirectionProvider, Input, Label, useDirection } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

function CurrentDirection() {
  const direction = useDirection();
  return <p style={{ margin: 0 }}>Reading direction: {direction}</p>;
}

function LoginForm({ idSuffix }: { idSuffix: string }) {
  const direction = useDirection();
  const emailId = `direction-demo-email-${idSuffix}`;
  return (
    <div dir={direction} style={{ display: 'grid', gap: 'var(--space-2)', maxWidth: '16rem' }}>
      <Label htmlFor={emailId}>Email</Label>
      <Input id={emailId} type="email" placeholder="name@example.com" />
      <Button>Sign in</Button>
    </div>
  );
}

export default function DirectionExample() {
  return (
    <>
      <Section title="Default (ltr)">
        <CurrentDirection />
        <LoginForm idSuffix="ltr" />
      </Section>

      <Section title="RTL provider">
        <DirectionProvider direction="rtl">
          <CurrentDirection />
          <LoginForm idSuffix="rtl" />
        </DirectionProvider>
      </Section>
    </>
  );
}
