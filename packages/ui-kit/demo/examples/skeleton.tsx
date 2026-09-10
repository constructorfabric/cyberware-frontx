import { Skeleton } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function SkeletonExample() {
  return (
    <>
      <Section title="Avatar">
        <Row>
          <Skeleton style={{ width: 44, height: 44, borderRadius: '50%' }} />
        </Row>
      </Section>

      <Section title="Text">
        <div style={{ display: 'grid', gap: 'var(--space-2)', maxWidth: 260 }}>
          <Skeleton style={{ height: 16, width: '100%' }} />
          <Skeleton style={{ height: 16, width: '80%' }} />
          <Skeleton style={{ height: 16, width: '60%' }} />
        </div>
      </Section>

      <Section title="Card">
        <div style={{ display: 'grid', gap: 'var(--space-3)', width: 260 }}>
          <Skeleton style={{ height: 140, width: '100%' }} />
          <Skeleton style={{ height: 16, width: '75%' }} />
          <Skeleton style={{ height: 16, width: '50%' }} />
        </div>
      </Section>

      <Section title="Form">
        <div style={{ display: 'grid', gap: 'var(--space-3)', width: 260 }}>
          <Skeleton style={{ height: 12, width: '30%' }} />
          <Skeleton style={{ height: 36, width: '100%' }} />
          <Skeleton style={{ height: 12, width: '30%' }} />
          <Skeleton style={{ height: 36, width: '100%' }} />
          <Skeleton style={{ height: 36, width: 96 }} />
        </div>
      </Section>

      <Section title="Table">
        <div style={{ display: 'grid', gap: 'var(--space-2)', width: 320 }}>
          {Array.from({ length: 5 }, (_, row) => (
            <Row key={row} style={{ flexWrap: 'nowrap' }}>
              <Skeleton style={{ height: 32, width: 32, borderRadius: '50%' }} />
              <Skeleton style={{ height: 14, flex: 1 }} />
              <Skeleton style={{ height: 14, width: 48 }} />
            </Row>
          ))}
        </div>
      </Section>
    </>
  );
}
