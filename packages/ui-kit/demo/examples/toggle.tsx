import { Toggle } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function ToggleExample() {
  return (
    <>
      <Section title="Default">
        <Row>
          <Toggle aria-label="Bold">B</Toggle>
          <Toggle aria-label="Italic" defaultPressed>
            I
          </Toggle>
        </Row>
      </Section>

      <Section title="Outline">
        <Row>
          <Toggle aria-label="Bold" variant="outline">
            B
          </Toggle>
          <Toggle aria-label="Italic" variant="outline" defaultPressed>
            I
          </Toggle>
        </Row>
      </Section>

      <Section title="With text">
        <Row>
          <Toggle aria-label="Toggle italic" defaultPressed>
            Italic
          </Toggle>
        </Row>
      </Section>

      <Section title="Sizes">
        <Row>
          <Toggle aria-label="Small" size="sm">
            S
          </Toggle>
          <Toggle aria-label="Default" size="default">
            D
          </Toggle>
          <Toggle aria-label="Large" size="lg">
            L
          </Toggle>
        </Row>
      </Section>

      <Section title="Disabled">
        <Row>
          <Toggle aria-label="Disabled" disabled>
            D
          </Toggle>
        </Row>
      </Section>
    </>
  );
}
