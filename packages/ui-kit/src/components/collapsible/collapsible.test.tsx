import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import styles from './collapsible.module.css';

afterEach(cleanup);

function renderCollapsible(rootProps: Parameters<typeof Collapsible>[0] = {}) {
  return render(
    <Collapsible {...rootProps}>
      <CollapsibleTrigger>Toggle</CollapsibleTrigger>
      <CollapsibleContent>Panel content</CollapsibleContent>
    </Collapsible>,
  );
}

describe('Collapsible', () => {
  it('renders a trigger and keeps the panel out of the DOM until opened', () => {
    renderCollapsible();
    expect(screen.getByRole('button', { name: 'Toggle' })).toBeTruthy();
    expect(screen.queryByText('Panel content')).toBeNull();
  });

  it('opens on trigger click and renders content with the kit class', async () => {
    renderCollapsible();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    const content = await waitFor(() => screen.getByText('Panel content'));
    expect(content.className).toContain(styles.content);
  });

  it('closes on a second trigger click', async () => {
    renderCollapsible();
    const trigger = screen.getByRole('button', { name: 'Toggle' });
    fireEvent.click(trigger);
    await waitFor(() => screen.getByText('Panel content'));
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByText('Panel content')).toBeNull());
  });

  it('starts open when defaultOpen is set', () => {
    renderCollapsible({ defaultOpen: true });
    expect(screen.getByText('Panel content')).toBeTruthy();
  });

  it('reports open state changes via onOpenChange', () => {
    const onOpenChange = vi.fn();
    renderCollapsible({ onOpenChange });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('applies the trigger kit class and ignores clicks while disabled', () => {
    renderCollapsible({ disabled: true });
    const trigger = screen.getByRole('button', { name: 'Toggle' });
    expect(trigger.className).toContain(styles.trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText('Panel content')).toBeNull();
  });

  it('merges a consumer className onto the trigger without dropping the kit class', () => {
    render(
      <Collapsible>
        <CollapsibleTrigger className="consumer">Toggle</CollapsibleTrigger>
        <CollapsibleContent>Panel content</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: 'Toggle' });
    expect(trigger.className).toContain(styles.trigger);
    expect(trigger.className).toContain('consumer');
  });
});
