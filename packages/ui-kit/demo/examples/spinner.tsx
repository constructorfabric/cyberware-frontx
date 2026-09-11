import { Badge, InputGroup, InputGroupAddon, InputGroupInput, Spinner } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function SpinnerExample() {
  return (
    <>
      <Section title="Basic">
        <Row>
          <Spinner />
        </Row>
      </Section>

      <Section title="Sizes">
        <Row>
          <Spinner style={{ width: 'var(--icon-size-xs)', height: 'var(--icon-size-xs)' }} />
          <Spinner style={{ width: 'var(--icon-size-sm)', height: 'var(--icon-size-sm)' }} />
          <Spinner style={{ width: 'var(--icon-size-md)', height: 'var(--icon-size-md)' }} />
          <Spinner style={{ width: 'var(--icon-size-lg)', height: 'var(--icon-size-lg)' }} />
        </Row>
      </Section>

      <Section title="With label">
        <Row>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Spinner aria-label="Saving changes" />
            Saving changes…
          </p>
        </Row>
      </Section>

      <Section title="In a badge">
        <Row>
          <Badge variant="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <Spinner style={{ width: 'var(--icon-size-xs)', height: 'var(--icon-size-xs)' }} />
            Syncing
          </Badge>
        </Row>
      </Section>

      <Section title="In an input group">
        <Row>
          <InputGroup style={{ maxWidth: 240 }}>
            <InputGroupInput placeholder="Searching…" readOnly value="constructor" />
            <InputGroupAddon align="inline-end">
              <Spinner style={{ width: 'var(--icon-size-xs)', height: 'var(--icon-size-xs)' }} />
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>
    </>
  );
}
