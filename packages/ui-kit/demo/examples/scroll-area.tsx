import { ScrollArea, ScrollBar } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

const items = Array.from({ length: 30 }, (_, index) => `Row ${index + 1}`);
const tiles = Array.from({ length: 12 }, (_, index) => `Tile ${index + 1}`);

export default function ScrollAreaExample() {
  return (
    <>
      <Section title="Vertical">
        <ScrollArea
          style={{
            height: '12rem',
            width: '14rem',
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <ul style={{ margin: 0, padding: '0.75rem 1rem', listStyle: 'none' }}>
            {items.map((item) => (
              <li key={item} style={{ padding: '0.25rem 0' }}>
                {item}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Section>

      <Section title="Horizontal">
        <ScrollArea
          style={{
            width: '24rem',
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
            {tiles.map((tile) => (
              <div
                key={tile}
                style={{
                  flex: '0 0 auto',
                  width: '6rem',
                  height: '4rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--muted)',
                  color: 'var(--muted-foreground)',
                }}
              >
                {tile}
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Section>
    </>
  );
}
