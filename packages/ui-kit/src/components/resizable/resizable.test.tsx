import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './resizable';
import styles from './resizable.module.css';

afterEach(cleanup);

/*
 * jsdom performs no real layout (every element measures 0x0 — see
 * src/__test-utils__/setup.ts's ResizeObserver polyfill comment), so
 * react-resizable-panels never computes a real pixel-to-percentage layout:
 * panels always end up at whatever `defaultSize` says (or an even split
 * with none given), and dragging a handle cannot be exercised without real
 * pointer-driven layout math. These tests verify structure, prop wiring,
 * and the vendor's own data/aria attributes (what jsdom CAN prove) — not
 * actual resizing (what it can't).
 *
 * Also: Group/Panel/Separator each claim `data-testid` for their OWN
 * id-based test-id convention (see their .d.ts doc comments) — a
 * consumer-passed `data-testid` prop is silently overwritten with the
 * element's `id` rather than kept, so these tests use `id` (and
 * `getElementById`/role queries) instead of RTL's usual `data-testid`
 * convention.
 */

describe('Resizable', () => {
  it('renders a Group with data-group and the group class, merging a consumer className', () => {
    const { container } = render(
      <ResizablePanelGroup className="consumer">
        <ResizablePanel>Left</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>Right</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const group = container.firstElementChild;
    expect(group?.getAttribute('data-group')).toBe('true');
    expect(group?.className).toContain(styles.group);
    expect(group?.className).toContain('consumer');
  });

  it('renders a Group with the vertical orientation and default horizontal otherwise', () => {
    const { container: horizontal } = render(
      <ResizablePanelGroup>
        <ResizablePanel>A</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(horizontal.firstElementChild).toHaveProperty('style.flexDirection', 'row');

    cleanup();
    const { container: vertical } = render(
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel>A</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(vertical.firstElementChild).toHaveProperty('style.flexDirection', 'column');
  });

  it('renders Panel as a bare pass-through with no kit class of its own', () => {
    render(
      <ResizablePanelGroup>
        <ResizablePanel id="left-panel">Content</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const panel = document.getElementById('left-panel');
    expect(panel?.getAttribute('data-panel')).toBe('true');
    expect(panel?.textContent).toBe('Content');
    expect(panel?.className).toBe('');
  });

  it('renders Handle with role separator, an aria-orientation opposite the Group orientation, and the handle class', () => {
    render(
      <ResizablePanelGroup>
        <ResizablePanel>Left</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>Right</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const handle = screen.getByRole('separator');
    // Default Group orientation is 'horizontal' (panels side by side), so
    // the divider between them is drawn as a VERTICAL line — the opposite
    // relationship separator.module.css/button-group.module.css already
    // document for their own orientation props.
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.className).toContain(styles.handle);
  });

  it('flips the handle aria-orientation for a vertical Group', () => {
    render(
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel>Top</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>Bottom</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('renders no grip by default and one with the grip class when withHandle is set', () => {
    render(
      <ResizablePanelGroup>
        <ResizablePanel>Left</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>Right</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(screen.getByRole('separator').querySelector('svg')).toBeNull();

    cleanup();
    render(
      <ResizablePanelGroup>
        <ResizablePanel>Left</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>Right</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const handle = screen.getByRole('separator');
    expect(handle.querySelector('svg')).not.toBeNull();
    expect(handle.querySelector(`.${styles.grip}`)).not.toBeNull();
  });
});
