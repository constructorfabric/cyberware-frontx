import { useState } from 'react';

import {
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@gears-frontx/ui-kit';

import { Section, Row } from '../shared';

export default function DrawerExample() {
  const [snapPoint, setSnapPoint] = useState<number | string | null>(0.5);

  return (
    <>
      <Section title="Sides">
        <Row>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <Drawer key={side} side={side}>
              <DrawerTrigger render={<Button variant="outline" />}>{side}</DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Edit profile</DrawerTitle>
                  <DrawerDescription>Make changes to your profile here.</DrawerDescription>
                </DrawerHeader>
                <DrawerFooter>
                  <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
                  <Button>Save changes</Button>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          ))}
        </Row>
      </Section>

      <Section title="Swipe handle">
        <Drawer side="bottom" showSwipeHandle>
          <DrawerTrigger render={<Button variant="outline" />}>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Filters</DrawerTitle>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      </Section>

      <Section title="Non-modal">
        <Drawer modal={false}>
          <DrawerTrigger render={<Button variant="outline" />}>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Non-modal drawer</DrawerTitle>
              <DrawerDescription>The rest of the page stays interactive.</DrawerDescription>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      </Section>

      <Section title="Snap points">
        <Drawer snapPoints={[0.3, 0.5, 1]} snapPoint={snapPoint} onSnapPointChange={setSnapPoint}>
          <DrawerTrigger render={<Button variant="outline" />}>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Snap points</DrawerTitle>
              <DrawerDescription>Drag between 30%, 50%, and full height.</DrawerDescription>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      </Section>

      <Section title="Nested">
        <Drawer>
          <DrawerTrigger render={<Button variant="outline" />}>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Parent drawer</DrawerTitle>
            </DrawerHeader>
            <DrawerFooter>
              <Drawer>
                <DrawerTrigger render={<Button variant="outline" />}>Open nested</DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>Nested drawer</DrawerTitle>
                  </DrawerHeader>
                  <DrawerFooter>
                    <DrawerClose render={<Button variant="outline" />}>Close</DrawerClose>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
              <DrawerClose render={<Button variant="outline" />}>Close</DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Section>
    </>
  );
}
