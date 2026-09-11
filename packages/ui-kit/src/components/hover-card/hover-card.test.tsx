import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';
import styles from './hover-card.module.css';

afterEach(cleanup);

// delay={0} on the trigger keeps hover-open assertions deterministic with
// real timers — Base UI's own default open delay is 600ms (see hover-card.md).
function renderHoverCard(open?: boolean) {
  return render(
    <HoverCard defaultOpen={open}>
      <HoverCardTrigger href="/users/shadcn" delay={0}>
        @shadcn
      </HoverCardTrigger>
      <HoverCardContent>The React Framework – created and maintained by @shadcn.</HoverCardContent>
    </HoverCard>,
  );
}

describe('HoverCard', () => {
  it('renders a link trigger and keeps the popup out of the DOM until opened', () => {
    renderHoverCard();
    const trigger = screen.getByRole('link', { name: '@shadcn' });
    expect(trigger).toBeTruthy();
    expect(trigger.tagName).toBe('A');
    expect(screen.queryByText(/created and maintained/)).toBeNull();
  });

  it('opens on trigger hover and renders content with kit classes', async () => {
    renderHoverCard();
    const trigger = screen.getByRole('link', { name: '@shadcn' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    const content = await waitFor(() => screen.getByText(/created and maintained/));
    expect(content.className).toContain(styles.popup);
  });

  it('closes on trigger mouse leave', async () => {
    renderHoverCard();
    const trigger = screen.getByRole('link', { name: '@shadcn' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    await waitFor(() => screen.getByText(/created and maintained/));
    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(screen.queryByText(/created and maintained/)).toBeNull());
  });

  it('does not open a disabled-by-delay trigger before the delay elapses', async () => {
    render(
      <HoverCard>
        <HoverCardTrigger href="/users/shadcn">@shadcn</HoverCardTrigger>
        <HoverCardContent>The React Framework – created and maintained by @shadcn.</HoverCardContent>
      </HoverCard>,
    );
    const trigger = screen.getByRole('link', { name: '@shadcn' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    // Real (non-zero, 600ms default) delay: absence can't be waitFor-ed
    // positively, so give a short moment and assert it hasn't opened yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/created and maintained/)).toBeNull();
  });

  it('portals the popup into a provided container', async () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <HoverCard defaultOpen>
        <HoverCardTrigger href="/users/shadcn">@shadcn</HoverCardTrigger>
        <HoverCardContent container={container}>
          The React Framework – created and maintained by @shadcn.
        </HoverCardContent>
      </HoverCard>,
    );
    const content = await waitFor(() => screen.getByText(/created and maintained/));
    expect(container.contains(content)).toBe(true);
    container.remove();
  });
});
