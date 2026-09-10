import { Avatar, AvatarFallback, HoverCard, HoverCardContent, HoverCardTrigger } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function HoverCardExample() {
  return (
    <>
      <Section title="Basic">
        {/*
          Row, not a bare trigger: Section is `display: grid`, whose default
          `justify-items: normal` stretches a direct grid-item child to the
          column's full width once it blockifies (the trigger's plain `<a>`
          becomes `display: block`) — the popup then centers on that
          stretched box, not on the visible text. Row's flex context sizes
          the trigger to its content instead, same as every other trigger in
          this file (see "Sides" below) and the kit's other demos (e.g.
          tooltip.tsx's "Hover" section).
        */}
        <Row>
          <HoverCard>
            <HoverCardTrigger href="https://github.com/shadcn" target="_blank" rel="noreferrer">
              @shadcn
            </HoverCardTrigger>
            <HoverCardContent>
              <Row>
                <Avatar>
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                The React Framework – created and maintained by @shadcn.
              </Row>
            </HoverCardContent>
          </HoverCard>
        </Row>
      </Section>

      <Section title="Sides">
        <Row>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <HoverCard key={side}>
              <HoverCardTrigger href="#">
                {side}
              </HoverCardTrigger>
              <HoverCardContent side={side}>Positioned on the {side}.</HoverCardContent>
            </HoverCard>
          ))}
        </Row>
      </Section>
    </>
  );
}
