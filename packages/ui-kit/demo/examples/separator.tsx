import { Separator } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function SeparatorExample() {
  return (
    <>
      <Section title="Horizontal">
        <div style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: 420 }}>
          <p style={{ margin: 0 }}>Account settings</p>
          <Separator />
          <p style={{ margin: 0 }}>Danger zone</p>
        </div>
      </Section>

      <Section title="Vertical">
        <Row style={{ height: '1.5rem' }}>
          <span>Bold</span>
          <Separator orientation="vertical" />
          <span>Italic</span>
          <Separator orientation="vertical" />
          <span>Underline</span>
        </Row>
      </Section>

      <Section title="Decorative">
        <Row style={{ height: '1.5rem' }}>
          <span>Left</span>
          <Separator orientation="vertical" aria-hidden="true" />
          <span>Right</span>
        </Row>
      </Section>
    </>
  );
}
