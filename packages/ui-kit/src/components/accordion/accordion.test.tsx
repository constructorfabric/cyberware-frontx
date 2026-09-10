import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';
import styles from './accordion.module.css';

afterEach(cleanup);

function renderAccordion(rootProps: Parameters<typeof Accordion>[0] = {}) {
  return render(
    <Accordion {...rootProps}>
      <AccordionItem value="item-1">
        <AccordionTrigger>Is it accessible?</AccordionTrigger>
        <AccordionContent>Yes. It adheres to the WAI-ARIA design pattern.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Is it styled?</AccordionTrigger>
        <AccordionContent>Yes, with the kit's own tokens.</AccordionContent>
      </AccordionItem>
    </Accordion>,
  );
}

describe('Accordion', () => {
  it('renders every trigger and keeps panels closed by default', () => {
    renderAccordion();
    expect(screen.getByRole('button', { name: 'Is it accessible?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Is it styled?' })).toBeTruthy();
    expect(
      screen.queryByText('Yes. It adheres to the WAI-ARIA design pattern.'),
    ).toBeNull();
  });

  it('expands a panel on trigger click and renders it with kit classes', () => {
    renderAccordion();
    fireEvent.click(screen.getByRole('button', { name: 'Is it accessible?' }));
    const content = screen.getByText('Yes. It adheres to the WAI-ARIA design pattern.');
    expect(content.className).toContain(styles.content);
    expect(content.parentElement?.className).toContain(styles.panel);
  });

  it('collapses an open panel on a second trigger click', async () => {
    renderAccordion();
    const trigger = screen.getByRole('button', { name: 'Is it accessible?' });
    fireEvent.click(trigger);
    expect(screen.getByText('Yes. It adheres to the WAI-ARIA design pattern.')).toBeTruthy();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.queryByText('Yes. It adheres to the WAI-ARIA design pattern.')).toBeNull(),
    );
  });

  // Default Accordion behavior: opening one item closes any other open item
  // (single-expansion), matching upstream's default `type="single"`.
  it('closes the previously open item when a sibling opens, by default', async () => {
    renderAccordion();
    fireEvent.click(screen.getByRole('button', { name: 'Is it accessible?' }));
    expect(screen.getByText('Yes. It adheres to the WAI-ARIA design pattern.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Is it styled?' }));
    expect(screen.getByText("Yes, with the kit's own tokens.")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText('Yes. It adheres to the WAI-ARIA design pattern.')).toBeNull(),
    );
  });

  it('allows multiple open items when multiple is set', () => {
    renderAccordion({ multiple: true });
    fireEvent.click(screen.getByRole('button', { name: 'Is it accessible?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Is it styled?' }));
    expect(screen.getByText('Yes. It adheres to the WAI-ARIA design pattern.')).toBeTruthy();
    expect(screen.getByText("Yes, with the kit's own tokens.")).toBeTruthy();
  });

  it('marks the trigger of an open panel via data-panel-open', () => {
    renderAccordion();
    const trigger = screen.getByRole('button', { name: 'Is it accessible?' });
    expect(trigger.hasAttribute('data-panel-open')).toBe(false);
    fireEvent.click(trigger);
    expect(trigger.hasAttribute('data-panel-open')).toBe(true);
  });

  it('does not expand a disabled item', () => {
    render(
      <Accordion>
        <AccordionItem value="item-1" disabled>
          <AccordionTrigger>Disabled item</AccordionTrigger>
          <AccordionContent>Hidden</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    const trigger = screen.getByRole('button', { name: 'Disabled item' });
    expect(trigger.getAttribute('data-disabled')).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('opens an item initially via defaultValue', () => {
    render(
      <Accordion defaultValue={['item-1']}>
        <AccordionItem value="item-1">
          <AccordionTrigger>Is it accessible?</AccordionTrigger>
          <AccordionContent>Yes. It adheres to the WAI-ARIA design pattern.</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText('Yes. It adheres to the WAI-ARIA design pattern.')).toBeTruthy();
  });
});
