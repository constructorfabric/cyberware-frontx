import { AspectRatio } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

function Placeholder({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'flex',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--muted)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {label}
    </span>
  );
}

export default function AspectRatioExample() {
  return (
    <>
      <Section title="Default">
        <div style={{ width: '20rem' }}>
          <AspectRatio ratio={16 / 9}>
            <Placeholder label="16 / 9" />
          </AspectRatio>
        </div>
      </Section>

      <Section title="Square">
        <div style={{ width: '12rem' }}>
          <AspectRatio ratio={1}>
            <Placeholder label="1 / 1" />
          </AspectRatio>
        </div>
      </Section>

      <Section title="Portrait">
        <div style={{ width: '10rem' }}>
          <AspectRatio ratio={9 / 16}>
            <Placeholder label="9 / 16" />
          </AspectRatio>
        </div>
      </Section>
    </>
  );
}
