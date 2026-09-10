import { Badge, Spinner } from '@gears-frontx/ui-kit';

import { DemoIcon, Row, Section } from '../shared';

export default function BadgeExample() {
  return (
    <>
      <Section title="Variants">
        <Row>
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="destructive">destructive</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="ghost">ghost</Badge>
          <Badge variant="link">link</Badge>
        </Row>
      </Section>

      {/* Mockup row order: Neutral (= secondary) first, then the five tones. */}
      <Section title="Tones">
        <Row>
          <Badge variant="secondary">neutral</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
          <Badge variant="info">info</Badge>
          <Badge variant="accent">accent</Badge>
        </Row>
      </Section>

      <Section title="With icon">
        <Row>
          <Badge>
            <DemoIcon />
            default
          </Badge>
          <Badge variant="secondary">
            <DemoIcon />
            secondary
          </Badge>
          <Badge variant="outline">
            <DemoIcon />
            outline
          </Badge>
        </Row>
      </Section>

      <Section title="With spinner">
        <Row>
          <Badge variant="secondary">
            <Spinner style={{ width: 'var(--icon-size-xs)', height: 'var(--icon-size-xs)' }} />
            Syncing
          </Badge>
        </Row>
      </Section>

      <Section title="Link">
        <Row>
          <Badge variant="outline" render={<a href="#plans" />}>
            as a link
          </Badge>
        </Row>
      </Section>
    </>
  );
}
