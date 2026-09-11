import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Card,
  CardContent,
} from '@gears-frontx/ui-kit';

import { Section } from '../shared';

export default function AccordionExample() {
  return (
    <>
      <Section title="Default">
        <Accordion defaultValue={['item-1']}>
          <AccordionItem value="item-1">
            <AccordionTrigger>Is it accessible?</AccordionTrigger>
            <AccordionContent>Yes. It adheres to the WAI-ARIA design pattern.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Is it styled?</AccordionTrigger>
            <AccordionContent>Yes, with the kit's own tokens.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger>Is it animated?</AccordionTrigger>
            <AccordionContent>Yes, the panel height animates open and closed.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Section>

      <Section title="Multiple open">
        <Accordion multiple defaultValue={['item-1', 'item-2']}>
          <AccordionItem value="item-1">
            <AccordionTrigger>First section</AccordionTrigger>
            <AccordionContent>Both this and the next panel can stay open.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Second section</AccordionTrigger>
            <AccordionContent>Opening a third panel won't close either of these.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger>Third section</AccordionTrigger>
            <AccordionContent>Closed by default.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Section>

      <Section title="Disabled">
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: '1fr 1fr' }}>
          <Accordion defaultValue={['item-1']}>
            <AccordionItem value="item-1">
              <AccordionTrigger>Open item</AccordionTrigger>
              <AccordionContent>This one behaves normally.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2" disabled>
              <AccordionTrigger>Disabled item</AccordionTrigger>
              <AccordionContent>You will never see this.</AccordionContent>
            </AccordionItem>
          </Accordion>
          <Accordion disabled defaultValue={['item-1']}>
            <AccordionItem value="item-1">
              <AccordionTrigger>Whole accordion disabled</AccordionTrigger>
              <AccordionContent>No trigger in this accordion responds.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>Second item</AccordionTrigger>
              <AccordionContent>Also unreachable.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </Section>

      <Section title="Borders">
        <div
          style={{
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)',
            paddingInline: 'var(--space-4)',
          }}
        >
          <Accordion defaultValue={['item-1']}>
            <AccordionItem value="item-1">
              <AccordionTrigger>Shipping</AccordionTrigger>
              <AccordionContent>Orders ship within two business days.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>Returns</AccordionTrigger>
              <AccordionContent>Free returns within 30 days.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
              <AccordionTrigger>Warranty</AccordionTrigger>
              <AccordionContent>Two years, parts and labor.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </Section>

      <Section title="In a card">
        <Card>
          <CardContent>
            <Accordion defaultValue={['item-1']}>
              <AccordionItem value="item-1">
                <AccordionTrigger>What's included in the plan?</AccordionTrigger>
                <AccordionContent>Unlimited seats and priority support.</AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>Can I cancel anytime?</AccordionTrigger>
                <AccordionContent>Yes, from the billing settings page.</AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </Section>
    </>
  );
}
