import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

const longParagraphs = Array.from({ length: 12 }, (_, index) => (
  <p key={index}>
    Paragraph {index + 1}. Make changes to your profile here. Click save when you&apos;re done
    reviewing every field.
  </p>
));

export default function SheetExample() {
  return (
    <>
      <Section title="Sides">
        <Row>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Top</SheetTrigger>
            <SheetContent side="top">
              <SheetHeader>
                <SheetTitle>Edit profile</SheetTitle>
                <SheetDescription>Make changes to your profile here.</SheetDescription>
              </SheetHeader>
              <SheetFooter>
                <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
                <Button>Save changes</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Right</SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Edit profile</SheetTitle>
                <SheetDescription>Make changes to your profile here.</SheetDescription>
              </SheetHeader>
              <SheetFooter>
                <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
                <Button>Save changes</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Bottom</SheetTrigger>
            <SheetContent side="bottom">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
                <SheetDescription>Narrow the results before applying.</SheetDescription>
              </SheetHeader>
              <SheetFooter>
                <SheetClose render={<Button variant="outline" />}>Reset</SheetClose>
                <Button>Apply</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Left</SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Jump to another section.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </Row>
      </Section>

      <Section title="Scrollable content">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Open</SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Edit profile</SheetTitle>
              <SheetDescription>Scroll to review every field before saving.</SheetDescription>
            </SheetHeader>
            {longParagraphs}
            {/* Sticky + opaque by default now - no inline workaround needed. */}
            <SheetFooter>
              <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
              <Button>Save changes</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Section>

      <Section title="No close button">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Open</SheetTrigger>
          <SheetContent side="right" showCloseButton={false}>
            <SheetHeader>
              <SheetTitle>Edit profile</SheetTitle>
              <SheetDescription>Make changes to your profile here.</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
              <Button>Save changes</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Section>
    </>
  );
}
