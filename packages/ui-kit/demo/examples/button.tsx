import { useState } from 'react';

import { Button } from '@gears-frontx/ui-kit';

import { DemoIcon, Row, Section } from '../shared';

function LoadingDemo() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      loading={busy}
      onClick={() => {
        setBusy(true);
        setTimeout(() => setBusy(false), 1500);
      }}
    >
      Click me
    </Button>
  );
}

export default function ButtonExample() {
  return (
    <>
      <Section title="Variants">
        <Row>
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </Row>
      </Section>
      <Section title="Sizes">
        <Row>
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
        </Row>
      </Section>
      <Section title="With icon">
        <Row>
          <Button icon={<DemoIcon />}>With icon</Button>
          <Button variant="secondary" icon={<DemoIcon />}>
            Secondary
          </Button>
          <Button variant="outline" icon={<DemoIcon />}>
            Outline
          </Button>
        </Row>
      </Section>
      <Section title="Icon only">
        <Row>
          <Button size="sm" icon={<DemoIcon />} aria-label="Icon only small" />
          <Button icon={<DemoIcon />} aria-label="Icon only default" />
          <Button size="lg" icon={<DemoIcon />} aria-label="Icon only large" />
          <Button variant="secondary" icon={<DemoIcon />} aria-label="Icon only secondary" />
        </Row>
      </Section>
      <Section title="Disabled">
        <Row>
          <Button disabled>Default</Button>
          <Button variant="outline" disabled>
            Outline
          </Button>
          <Button disabled icon={<DemoIcon />} aria-label="Disabled icon only" />
        </Row>
      </Section>
      <Section title="Loading">
        <Row>
          <Button loading>Loading</Button>
          <Button variant="secondary" loading>
            Loading
          </Button>
          <Button variant="outline" loading icon={<DemoIcon />} aria-label="Loading icon only" />
          <LoadingDemo />
        </Row>
      </Section>
      <Section title="As link">
        <Row>
          <Button
            render={<a href="#" onClick={(event) => event.preventDefault()} />}
            nativeButton={false}
            variant="outline"
          >
            Open reports
          </Button>
        </Row>
      </Section>
    </>
  );
}
