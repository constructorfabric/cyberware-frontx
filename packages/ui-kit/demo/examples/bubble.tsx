import type { CSSProperties } from 'react';
import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  BubbleReactions,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@gears-frontx/ui-kit';
import { Row, Section } from '../shared';

/* The transcript below is the whole point of this page: a Bubble in
   isolation is a filled, content-width box, which is also what a Button is.
   Only a real exchange - two senders, two fills, two alignments, wrapped
   lines - shows what the component is for, so the conversation leads and
   the axis-by-axis sections follow it. */
const conversation: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4)',
};

/* `align-self` on a Bubble resolves against the INLINE axis only in a flex
   column, so every container holding a mixed-alignment transcript is one.
   A grid would push `align="end"` down the block axis instead. */
const transcript: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

export default function BubbleExample() {
  return (
    <>
      <Section title="Conversation">
        <ScrollArea
          style={{
            height: '22rem',
            maxWidth: '34rem',
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--card)',
          }}
        >
          <div style={conversation}>
            <Bubble variant="secondary">
              <BubbleContent>Morning. Did the nightly build ever finish?</BubbleContent>
            </Bubble>

            <BubbleGroup>
              <Bubble align="end">
                <BubbleContent>It did, 04:12.</BubbleContent>
              </Bubble>
              <Bubble align="end">
                <BubbleContent>Two failures though, both in the router suite.</BubbleContent>
              </Bubble>
            </BubbleGroup>

            <BubbleGroup>
              <Bubble variant="secondary">
                <BubbleContent>Failing how?</BubbleContent>
              </Bubble>
              <Bubble variant="secondary">
                <BubbleContent>Timing, or a real regression?</BubbleContent>
              </Bubble>
            </BubbleGroup>

            <Bubble align="end">
              <BubbleContent>
                Timing. They both pass on a rerun, so I raised the navigation wait and pushed the
                fix to the release branch.
              </BubbleContent>
            </Bubble>

            <Bubble variant="secondary">
              <BubbleContent>
                Good. While you are in there, could you drop the old registry route as well? Nothing
                has resolved it since the March migration and it still shows up in the docs.
              </BubbleContent>
            </Bubble>

            {/* The reaction pill overhangs the bubble's bottom edge, so this
                row buys back the space on the Bubble itself. A wrapper div
                would take its place as the flex item and strand
                `align="end"` at the start of the row. */}
            <Bubble align="end" style={{ marginBlockEnd: 'var(--space-2)' }}>
              <BubbleContent>Already gone, same commit.</BubbleContent>
              <BubbleReactions role="img" aria-label="Reactions: thumbs up">
                <span>👍</span>
              </BubbleReactions>
            </Bubble>

            <Bubble variant="ghost">
              <BubbleContent>Alex added Dana to the conversation.</BubbleContent>
            </Bubble>

            <Bubble variant="secondary">
              <BubbleContent>Thanks. I will re-run the suite once CI picks it up.</BubbleContent>
            </Bubble>

            <Bubble variant="destructive" align="end">
              <BubbleContent>Not delivered. Tap to retry.</BubbleContent>
            </Bubble>
          </div>
        </ScrollArea>
      </Section>

      <Section title="Variants">
        <div style={{ ...transcript, maxWidth: '34rem' }}>
          <Bubble variant="default" align="end">
            <BubbleContent>default - the current user's own messages.</BubbleContent>
          </Bubble>
          <Bubble variant="secondary">
            <BubbleContent>secondary - everything the other side says.</BubbleContent>
          </Bubble>
          <Bubble variant="muted">
            <BubbleContent>muted - a quoted reply or quiet supporting line.</BubbleContent>
          </Bubble>
          <Bubble variant="tinted">
            <BubbleContent>tinted - a lighter take on the primary bubble.</BubbleContent>
          </Bubble>
          <Bubble variant="outline">
            <BubbleContent>outline - a bordered bubble for richer content.</BubbleContent>
          </Bubble>
          <Bubble variant="ghost">
            <BubbleContent>ghost - unframed, spans the full row: system notices and assistant prose.</BubbleContent>
          </Bubble>
          <Bubble variant="destructive" align="end">
            <BubbleContent>destructive - this one failed to send.</BubbleContent>
          </Bubble>
        </div>
      </Section>

      <Section title="Alignment">
        <div style={{ ...transcript, maxWidth: '34rem' }}>
          <Bubble variant="secondary" align="start">
            <BubbleContent>Aligned to the start, for the other side.</BubbleContent>
          </Bubble>
          <Bubble align="end">
            <BubbleContent>Aligned to the end, for the current user.</BubbleContent>
          </Bubble>
        </div>
      </Section>

      <Section title="Bubble group">
        <div style={{ maxWidth: '34rem' }}>
          <BubbleGroup>
            <Bubble align="end">
              <BubbleContent>Consecutive messages from one sender stack tighter,</BubbleContent>
            </Bubble>
            <Bubble align="end">
              <BubbleContent>so a burst reads as one turn.</BubbleContent>
            </Bubble>
          </BubbleGroup>
        </div>
      </Section>

      <Section title="Links and buttons">
        <Bubble variant="muted">
          <BubbleContent render={<button type="button" onClick={() => {}} />}>
            Tap to load the earlier history
          </BubbleContent>
        </Bubble>
      </Section>

      <Section title="Reactions">
        <div style={{ paddingBlockEnd: 'var(--space-4)' }}>
          <Bubble variant="secondary">
            <BubbleContent>Ship it.</BubbleContent>
            <BubbleReactions side="top" align="start" role="img" aria-label="Reactions: fire">
              <span>🔥</span>
            </BubbleReactions>
          </Bubble>
        </div>
      </Section>

      <Section title="Show more">
        <Bubble variant="outline" style={{ maxWidth: 'none' }}>
          <BubbleContent>
            <Collapsible style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <div>Here is a short preview of a much longer message.</div>
              <CollapsibleContent keepMounted>
                The rest of the message only appears once expanded, keeping the
                conversation compact by default.
              </CollapsibleContent>
              <CollapsibleTrigger>Show more</CollapsibleTrigger>
            </Collapsible>
          </BubbleContent>
        </Bubble>
      </Section>

      <Section title="Tooltip">
        <Row>
          <Tooltip>
            <TooltipTrigger
              render={
                <Bubble variant="secondary" style={{ cursor: 'default' }}>
                  <BubbleContent>Message delivered.</BubbleContent>
                </Bubble>
              }
            />
            <TooltipContent>Read 2:41 PM</TooltipContent>
          </Tooltip>
        </Row>
      </Section>

      <Section title="Popover">
        <Row>
          <Popover>
            <PopoverTrigger
              render={
                <Bubble variant="destructive" align="end" style={{ cursor: 'pointer' }}>
                  <BubbleContent>Failed to send.</BubbleContent>
                </Bubble>
              }
            />
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>Error details</PopoverTitle>
                <PopoverDescription>The network request timed out after 30 seconds.</PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
        </Row>
      </Section>
    </>
  );
}
