import { useState } from 'react';

import { ToggleGroup, ToggleGroupItem } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function ToggleGroupExample() {
  const [align, setAlign] = useState<string[]>(['left']);

  return (
    <>
      <Section title="Default">
        <Row>
          <ToggleGroup aria-label="Text alignment" value={align} onValueChange={setAlign}>
            <ToggleGroupItem value="left" aria-label="Align left">
              L
            </ToggleGroupItem>
            <ToggleGroupItem value="center" aria-label="Align center">
              C
            </ToggleGroupItem>
            <ToggleGroupItem value="right" aria-label="Align right">
              R
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>

      <Section title="Outline">
        <Row>
          <ToggleGroup aria-label="Text formatting" multiple variant="outline" defaultValue={['bold']}>
            <ToggleGroupItem value="bold" aria-label="Bold">
              B
            </ToggleGroupItem>
            <ToggleGroupItem value="italic" aria-label="Italic">
              I
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>

      <Section title="Sizes">
        <Row style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <ToggleGroup aria-label="View mode, small" size="sm" defaultValue={['list']}>
            <ToggleGroupItem value="list" aria-label="List view">
              List
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              Grid
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup aria-label="View mode, default" defaultValue={['list']}>
            <ToggleGroupItem value="list" aria-label="List view">
              List
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              Grid
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup aria-label="View mode, large" size="lg" defaultValue={['list']}>
            <ToggleGroupItem value="list" aria-label="List view">
              List
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              Grid
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>

      <Section title="Vertical orientation">
        <Row>
          <ToggleGroup aria-label="View mode" orientation="vertical" defaultValue={['list']}>
            <ToggleGroupItem value="list" aria-label="List view">
              List
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              Grid
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>

      <Section title="Disabled">
        <Row>
          <ToggleGroup aria-label="Text alignment, disabled" disabled defaultValue={['left']}>
            <ToggleGroupItem value="left" aria-label="Align left">
              L
            </ToggleGroupItem>
            <ToggleGroupItem value="center" aria-label="Align center">
              C
            </ToggleGroupItem>
            <ToggleGroupItem value="right" aria-label="Align right">
              R
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>
    </>
  );
}
