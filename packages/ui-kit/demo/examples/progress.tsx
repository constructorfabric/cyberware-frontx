import { useState } from 'react';

import { Progress, ProgressLabel, ProgressValue, Slider } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

export default function ProgressExample() {
  const [value, setValue] = useState(42);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)', maxWidth: '20rem' }}>
      <Section title="Basic">
        <Progress value={64} aria-label="Uploading" />
      </Section>

      <Section title="Indeterminate">
        <Progress value={null} aria-label="Importing" />
      </Section>

      <Section title="With label and value">
        <Progress value={value}>
          <ProgressLabel>Uploading</ProgressLabel>
          <ProgressValue />
        </Progress>
      </Section>

      <Section title="Controlled">
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <Progress value={value} aria-label="Controlled progress" />
          <Slider value={[value]} onValueChange={(next: number[]) => setValue(next[0])} />
        </div>
      </Section>
    </div>
  );
}
