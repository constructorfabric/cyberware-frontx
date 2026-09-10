import {
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function PopoverExample() {
  return (
    <>
      <Section title="Basic">
        <Popover>
          <PopoverTrigger render={<Button variant="outline">Open popover</Button>} />
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Dimensions</PopoverTitle>
              <PopoverDescription>Set the dimensions for the layer.</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </Section>

      <Section title="Align">
        <Row>
          {(['start', 'center', 'end'] as const).map((align) => (
            <Popover key={align}>
              <PopoverTrigger render={<Button variant="outline">{align}</Button>} />
              <PopoverContent align={align}>
                <PopoverDescription>Aligned to {align}.</PopoverDescription>
              </PopoverContent>
            </Popover>
          ))}
        </Row>
      </Section>

      <Section title="With form">
        <Popover>
          <PopoverTrigger render={<Button variant="outline">Edit dimensions</Button>} />
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Dimensions</PopoverTitle>
              <PopoverDescription>Set the dimensions for the layer.</PopoverDescription>
            </PopoverHeader>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="popover-width">Width</FieldLabel>
                <Input id="popover-width" defaultValue="100%" />
              </Field>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="popover-height">Height</FieldLabel>
                <Input id="popover-height" defaultValue="25px" />
              </Field>
            </FieldGroup>
          </PopoverContent>
        </Popover>
      </Section>
    </>
  );
}
