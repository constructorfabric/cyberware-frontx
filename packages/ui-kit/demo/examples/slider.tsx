import { useState } from 'react';

import { Slider } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

export default function SliderExample() {
  const [zoom, setZoom] = useState(100);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)', maxWidth: '20rem' }}>
      <Section title="Basic">
        <Slider defaultValue={50} aria-label="Volume" />
      </Section>

      <Section title="Range">
        <Slider defaultValue={[20, 80]} aria-label="Price range" />
      </Section>

      <Section title="Multiple thumbs">
        <Slider defaultValue={[10, 40, 70]} aria-label="Stops" />
      </Section>

      <Section title="Vertical">
        <div style={{ height: '10rem' }}>
          <Slider orientation="vertical" defaultValue={30} aria-label="Brightness" />
        </div>
      </Section>

      <Section title="Controlled">
        <Slider value={zoom} onValueChange={setZoom} min={50} max={200} step={10} aria-label="Zoom" />
      </Section>

      <Section title="Disabled">
        <Slider defaultValue={40} disabled aria-label="Locked" />
      </Section>
    </div>
  );
}
