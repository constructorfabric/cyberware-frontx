import { Button, Kbd, Tooltip, TooltipContent, TooltipTrigger } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function TooltipExample() {
  return (
    <>
      <Section title="Hover">
        <Row>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost">Hover me</Button>} />
            <TooltipContent>Visual-only hint.</TooltipContent>
          </Tooltip>
        </Row>
      </Section>

      <Section title="Side">
        <Row>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Top</Button>} />
            <TooltipContent side="top">Top</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Right</Button>} />
            <TooltipContent side="right">Right</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Bottom</Button>} />
            <TooltipContent side="bottom">Bottom</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Left</Button>} />
            <TooltipContent side="left">Left</TooltipContent>
          </Tooltip>
        </Row>
      </Section>

      <Section title="With shortcut">
        <Row>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Save</Button>} />
            <TooltipContent>
              <Row style={{ gap: 'var(--space-1)' }}>
                Save
                <Kbd>Ctrl</Kbd>
                <Kbd>S</Kbd>
              </Row>
            </TooltipContent>
          </Tooltip>
        </Row>
      </Section>

      <Section title="Disabled trigger">
        <Row>
          <Tooltip>
            <TooltipTrigger
              render={
                <span>
                  <Button variant="outline" disabled>
                    Disabled
                  </Button>
                </span>
              }
            />
            <TooltipContent>Not available right now.</TooltipContent>
          </Tooltip>
        </Row>
      </Section>
    </>
  );
}
