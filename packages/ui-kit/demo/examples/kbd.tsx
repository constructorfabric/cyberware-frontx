import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  KbdGroup,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function KbdExample() {
  return (
    <>
      <Section title="Key">
        <Row>
          <span>Press</span>
          <Kbd>Esc</Kbd>
          <span>to close.</span>
        </Row>
      </Section>

      <Section title="Group">
        <Row>
          <span>Open the command palette:</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Row>
      </Section>

      <Section title="Button">
        <Button variant="outline">
          Accept <Kbd>⏎</Kbd>
        </Button>
      </Section>

      <Section title="Tooltip">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Save</Button>} />
            <TooltipContent>
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>S</Kbd>
              </KbdGroup>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Section>

      <Section title="Input group">
        <InputGroup style={{ maxWidth: '16rem' }}>
          <InputGroupInput placeholder="Search…" aria-label="Search" />
          <InputGroupAddon align="inline-end">
            <Kbd>⌘K</Kbd>
          </InputGroupAddon>
        </InputGroup>
      </Section>
    </>
  );
}
