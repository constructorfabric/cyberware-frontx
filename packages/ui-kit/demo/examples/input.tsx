import { useState } from 'react';

import {
  Badge,
  Button,
  ButtonGroup,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
} from '@gears-frontx/ui-kit';

import { CloseIcon, DemoIcon, Row, Section } from '../shared';

export default function InputExample() {
  const [query, setQuery] = useState('');

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)', maxWidth: 480 }}>
      <Section title="Basic">
        <Input placeholder="Project name" />
      </Section>

      <Section title="Field">
        <Field>
          <FieldLabel htmlFor="in-username">Username</FieldLabel>
          <Input id="in-username" placeholder="shadcn" aria-describedby="in-username-desc" />
          <FieldDescription id="in-username-desc">This is your public display name.</FieldDescription>
        </Field>
      </Section>

      <Section title="Field group">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="in-first">First name</FieldLabel>
            <Input id="in-first" placeholder="Jane" />
          </Field>
          <Field>
            <FieldLabel htmlFor="in-last">Last name</FieldLabel>
            <Input id="in-last" placeholder="Doe" />
          </Field>
          <Row>
            <Button type="reset" variant="outline">
              Reset
            </Button>
            <Button type="submit">Submit</Button>
          </Row>
        </FieldGroup>
      </Section>

      <Section title="Disabled">
        <Input disabled placeholder="Read only for now" />
      </Section>

      <Section title="Invalid">
        <Input aria-invalid defaultValue="not-an-email" />
      </Section>

      <Section title="File">
        <Input type="file" />
      </Section>

      <Section title="Inline">
        {/*
         * Upstream's own inline demo is a horizontal Field holding just
         * Input + Button as siblings, no wrapper: Input's `width: 100%`
         * makes its flex-basis the whole row, so it overflows and shrinks
         * back to exactly the space Button leaves. That mechanism is
         * already in input.module.css (`width: 100%` + `min-width: 0`) and
         * needs nothing here — but it only works if nothing else in the
         * row claims the free space, which is why the two overrides below
         * exist and the previous wrapper Row does not.
         */}
        <Field orientation="horizontal">
          {/*
           * `.orientationHorizontal > .fieldLabel` (field.module.css) is
           * `flex: 1 1 auto`, written for a label beside a FIXED-width
           * control (Switch, Checkbox) that it should push to the far
           * edge. Input wants that space itself, so label and control end
           * up splitting the row's slack in half: at 480px the label grew
           * to 256px and the field was left with 114px. `flex: none` puts
           * the label back at its natural width so the whole remainder
           * goes to the input.
           */}
          <FieldLabel htmlFor="in-search" style={{ flex: 'none' }}>
            Search
          </FieldLabel>
          <Input id="in-search" placeholder="Search projects…" />
          {/*
           * Upstream's Button carries `shrink-0`; the kit's does not (see
           * button.module.css), so it would otherwise absorb part of the
           * overflow instead of leaving it all to the input — it survives
           * today only because `white-space: nowrap` floors it at
           * min-content. Stated rather than relied upon. `size="lg"` is
           * the field-height step (40px), matching Input.
           */}
          <Button size="lg" style={{ flexShrink: 0 }}>
            Search
          </Button>
        </Field>
      </Section>

      <Section title="Grid">
        {/*
         * --space-4, not --space-3: at --space-3 the gutter BETWEEN two
         * fields measured the same 12px as the gap WITHIN one (label to
         * input), so proximity read the four boxes as one block instead of
         * two fields. One step up separates the two relationships while
         * staying under FieldGroup's own --space-6 row rhythm.
         */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <Field>
            <FieldLabel htmlFor="in-city">City</FieldLabel>
            <Input id="in-city" placeholder="Cupertino" />
          </Field>
          <Field>
            <FieldLabel htmlFor="in-zip">ZIP</FieldLabel>
            <Input id="in-zip" placeholder="95014" />
          </Field>
        </div>
      </Section>

      <Section title="Required">
        <Field>
          <FieldLabel htmlFor="in-email">Email</FieldLabel>
          <Input id="in-email" type="email" required placeholder="you@company.com" aria-describedby="in-email-desc" />
          <FieldDescription id="in-email-desc">Required to receive account notices.</FieldDescription>
        </Field>
      </Section>

      <Section title="Badge">
        <Field>
          {/*
           * --space-2 is the gap upstream's own FieldLabel carries for a
           * badge sitting next to the label text; Row's default --space-3
           * detached the two. The row stays taller than the label (the
           * badge is 26px against 16px of text), so the label text sits
           * 17px above the input where every other section reads 12 —
           * that is the badge's own box, not a rhythm error, and matches
           * how upstream stacks the same pair.
           */}
          <Row style={{ gap: 'var(--space-2)' }}>
            <FieldLabel htmlFor="in-nickname">Nickname</FieldLabel>
            <Badge variant="secondary">Recommended</Badge>
          </Row>
          <Input id="in-nickname" placeholder="What should we call you?" />
        </Field>
      </Section>

      <Section title="Input group">
        <InputGroup style={{ maxWidth: '20rem' }}>
          <InputGroupAddon>
            <DemoIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search"
            aria-label="Search"
            value={query}
            onValueChange={setQuery}
          />
        </InputGroup>
      </Section>

      <Section title="Button group">
        {/*
         * Input defaults to control-height-lg (40px); Button's own default
         * is one step down at control-height-md (36px) — see
         * button-group.md "Sizing". ButtonGroup doesn't normalize child
         * height itself, so an unset Button joins 4px short of Input's
         * height, its border misaligned top and bottom. `size="lg"` matches
         * the two so the strip's outer border reads as one continuous edge.
         */}
        <ButtonGroup>
          <Input placeholder="you@company.com" icon={<DemoIcon />} />
          <Button
            variant="outline"
            size="lg"
            icon={<CloseIcon />}
            aria-label="Clear"
            onClick={() => setQuery('')}
          />
        </ButtonGroup>
      </Section>

      <Section title="Form">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="in-form-name">Name</FieldLabel>
            <Input id="in-form-name" placeholder="Jane Doe" />
          </Field>
          <Field>
            <FieldLabel htmlFor="in-form-email">Email</FieldLabel>
            <Input id="in-form-email" type="email" placeholder="you@company.com" />
          </Field>
          <Field>
            <FieldLabel htmlFor="in-form-country">Country</FieldLabel>
            <NativeSelect id="in-form-country" defaultValue="us">
              <NativeSelectOption value="us">United States</NativeSelectOption>
              <NativeSelectOption value="ca">Canada</NativeSelectOption>
            </NativeSelect>
          </Field>
          {/*
           * A full-width submit stacked directly under the fields shares
           * their left and right edges, so it also has to share their
           * height — Button's default md step is 36px against the fields'
           * 40px and read as a short box. `size="lg"` is the same
           * field-height step Input uses. (The Field-group section's
           * Reset/Submit pair is left at the default: it is a separate
           * action row aligned to nothing but its own left edge, which is
           * the pairing button-group.md documents.)
           */}
          <Button type="submit" size="lg">
            Create account
          </Button>
        </FieldGroup>
      </Section>
    </div>
  );
}
