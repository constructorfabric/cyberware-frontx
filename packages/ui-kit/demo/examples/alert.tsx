import { Alert, AlertAction, AlertDescription, AlertTitle, Button } from '@gears-frontx/ui-kit';

import { DemoIcon, Section } from '../shared';

export default function AlertExample() {
  return (
    <>
      <Section title="Default">
        <Alert>
          <AlertTitle>Update available</AlertTitle>
          <AlertDescription>A new version is ready to install.</AlertDescription>
        </Alert>
      </Section>

      <Section title="With icon">
        <Alert>
          <DemoIcon />
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>You can add components using the CLI.</AlertDescription>
        </Alert>
      </Section>

      <Section title="Destructive">
        <Alert variant="destructive">
          <DemoIcon />
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>We couldn't charge your card ending in 4242.</AlertDescription>
        </Alert>
      </Section>

      <Section title="With action">
        <Alert variant="destructive">
          <DemoIcon />
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>We couldn't charge your card ending in 4242.</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      </Section>
    </>
  );
}
