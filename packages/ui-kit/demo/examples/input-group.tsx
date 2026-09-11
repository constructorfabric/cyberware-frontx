import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Kbd,
  Spinner,
} from '@gears-frontx/ui-kit';

import { CloseIcon, Row, Section } from '../shared';

// Local to this example: the shared set has no magnifier, and an addon
// sizes a bare <svg> child itself (input-group.module.css's `.addon > svg`),
// so these carry a viewBox and nothing else — which is exactly the case
// that rule exists to cover.
function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 2.5H3.5a1 1 0 0 0-1 1v7" strokeLinecap="round" />
    </svg>
  );
}

const column = { flexDirection: 'column', alignItems: 'stretch', maxWidth: '22rem' } as const;

export default function InputGroupExample() {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
      <Section title="Alignment">
        <Row style={column}>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput type="number" placeholder="0.00" aria-label="Amount" />
          </InputGroup>
          <InputGroup>
            <InputGroupInput placeholder="Search" aria-label="Search" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton icon={<CloseIcon />} aria-label="Clear" />
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>To:</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea placeholder="Message" aria-label="Message" rows={2} />
          </InputGroup>
          <InputGroup>
            <InputGroupTextarea placeholder="Notes" aria-label="Notes" rows={2} />
            <InputGroupAddon align="block-end">
              <InputGroupText>Markdown supported</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Search">
        <Row style={column}>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput type="search" placeholder="Search components…" aria-label="Search" />
            <InputGroupAddon align="inline-end">
              <Kbd>⌘K</Kbd>
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Prefix and suffix text">
        <Row style={column}>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>https://</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput placeholder="example" aria-label="URL" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>.com</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput type="number" placeholder="0.00" aria-label="Price" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>USD</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Buttons">
        <Row style={column}>
          {/* Default xs against the opt-in sm, so the two steps of the
              in-group scale are visible side by side. */}
          <InputGroup>
            <InputGroupInput placeholder="Search" aria-label="Search (xs button)" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton>Search</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupInput placeholder="Search" aria-label="Search (sm button)" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="sm">Search</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>@</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput defaultValue="frontx" aria-label="Handle" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton icon={<CopyIcon />} aria-label="Copy" />
              <InputGroupButton icon={<CloseIcon />} aria-label="Clear" />
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Dropdown">
        <Row style={column}>
          <InputGroup>
            <InputGroupInput placeholder="Filter by status" aria-label="Filter" />
            <InputGroupAddon align="inline-end">
              <DropdownMenu>
                <DropdownMenuTrigger render={<InputGroupButton>Status</InputGroupButton>} />
                <DropdownMenuContent>
                  <DropdownMenuItem>Open</DropdownMenuItem>
                  <DropdownMenuItem>Closed</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Textarea">
        <Row style={column}>
          <InputGroup>
            <InputGroupTextarea placeholder="Notes" aria-label="Notes" rows={3} />
            <InputGroupAddon align="block-end">
              <InputGroupText>0/280</InputGroupText>
              <InputGroupButton style={{ marginInlineStart: 'auto' }}>Save</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Error">
        <Row style={column}>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>@</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              defaultValue="not an email"
              aria-label="Email"
              aria-invalid
              aria-describedby="input-group-error"
            />
          </InputGroup>
          <span
            id="input-group-error"
            style={{
              color: 'var(--destructive)',
              fontSize: 'var(--text-meta-size)',
              lineHeight: 'var(--text-meta-line-height)',
            }}
          >
            Enter a valid email address.
          </span>
          <InputGroup>
            <InputGroupTextarea defaultValue="Too short" aria-label="Bio" aria-invalid rows={2} />
            <InputGroupAddon align="block-end">
              <InputGroupText>9/280</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Disabled">
        <Row style={column}>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search" aria-label="Search" disabled />
            <InputGroupAddon align="inline-end">
              <Kbd>⌘K</Kbd>
            </InputGroupAddon>
          </InputGroup>
          {/* Only the action is disabled here — the field stays live, so the
              group must NOT dim as a whole. */}
          <InputGroup>
            <InputGroupInput placeholder="Nothing to clear" aria-label="Filter" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton disabled>Clear</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>

      <Section title="Loading">
        <Row style={column}>
          <InputGroup>
            <InputGroupInput placeholder="Checking availability…" aria-label="Domain" />
            <InputGroupAddon align="inline-end">
              <Spinner />
            </InputGroupAddon>
          </InputGroup>
        </Row>
      </Section>
    </div>
  );
}
