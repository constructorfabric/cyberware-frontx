import {
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Row, Section } from '../shared';

export default function ButtonGroupExample() {
  return (
    <>
      <Section title="Orientation">
        <Row>
          <ButtonGroup>
            <Button variant="outline">Left</Button>
            <Button variant="outline">Center</Button>
            <Button variant="outline">Right</Button>
          </ButtonGroup>
          <ButtonGroup orientation="vertical">
            <Button variant="outline">Top</Button>
            <Button variant="outline">Middle</Button>
            <Button variant="outline">Bottom</Button>
          </ButtonGroup>
        </Row>
      </Section>
      <Section title="Sizes">
        <Row style={{ alignItems: 'flex-start' }}>
          <ButtonGroup>
            <Button size="sm" variant="outline">
              Left
            </Button>
            <Button size="sm" variant="outline">
              Right
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button variant="outline">Left</Button>
            <Button variant="outline">Right</Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button size="lg" variant="outline">
              Left
            </Button>
            <Button size="lg" variant="outline">
              Right
            </Button>
          </ButtonGroup>
        </Row>
      </Section>
      <Section title="With separator">
        <Row>
          <ButtonGroup>
            <Button variant="outline">Copy</Button>
            <Button variant="outline">Paste</Button>
            <ButtonGroupSeparator />
            <Button variant="outline">Cut</Button>
          </ButtonGroup>
        </Row>
        <Row>
          <ButtonGroup orientation="vertical">
            <ButtonGroupText>Sort</ButtonGroupText>
            <ButtonGroupSeparator />
            <Button variant="outline">Newest first</Button>
            <Button variant="outline">Oldest first</Button>
          </ButtonGroup>
        </Row>
      </Section>
      <Section title="Split">
        <Row>
          <ButtonGroup>
            <Button>Save</Button>
            <Button aria-label="More save options" icon={<DemoIcon />} />
          </ButtonGroup>
        </Row>
      </Section>
      <Section title="With dropdown menu">
        <Row>
          <ButtonGroup>
            <Button>Save</Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button aria-label="More save options" icon={<DemoIcon />} />}
              />
              <DropdownMenuContent>
                <DropdownMenuItem>Save as draft</DropdownMenuItem>
                <DropdownMenuItem>Save and close</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        </Row>
      </Section>
      <Section title="With select">
        <Row>
          <ButtonGroup>
            <Select
              defaultValue="usd"
              items={[
                { value: 'usd', label: 'USD' },
                { value: 'eur', label: 'EUR' },
              ]}
            >
              <SelectTrigger aria-label="Currency">
                <SelectValue placeholder="Currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usd">USD</SelectItem>
                <SelectItem value="eur">EUR</SelectItem>
              </SelectContent>
            </Select>
            {/* Select's default size is control-height-lg (40px, the Field
             * spec) — Button's own default is control-height-md (36px, the
             * Button spec). A ButtonGroup joins them into one strip, so the
             * Button must opt into the matching size explicitly: unlike
             * upstream shadcn (where Button/Input/Select all share a single
             * default height), this kit intentionally sizes fields one step
             * above buttons, so alignment inside a group is the composer's
             * job, not the group's — see button-group.md. */}
            <Button variant="outline" size="lg">
              Convert
            </Button>
          </ButtonGroup>
        </Row>
      </Section>
      <Section title="With input">
        <Row>
          <ButtonGroup>
            <Input placeholder="Amount" />
            {/* Same size match as "With select" above: Input defaults to
             * control-height-lg, so the attached Button opts into size="lg"
             * to join at the same height. */}
            <Button variant="outline" size="lg">
              Max
            </Button>
          </ButtonGroup>
        </Row>
      </Section>
    </>
  );
}
