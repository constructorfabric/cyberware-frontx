import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './message-scroller';
import styles from './message-scroller.module.css';

afterEach(cleanup);

/*
 * jsdom has no layout engine: it never actually scrolls (scrollHeight/
 * clientHeight always read 0), so `@shadcn/react`'s auto-follow tracking,
 * `data-scrollable`/`data-active` derived from real scroll position, and
 * `content-visibility: auto`'s render-cost skipping cannot be exercised
 * here. These tests verify part rendering and prop wiring — that the kit
 * classes land, that composition (Button as the jump button's `render`
 * target) works, and that the primitive's own state attributes pass
 * through — not scroll physics. See message-scroller.md's "Testing" note.
 */
function renderScroller() {
  return render(
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            <MessageScrollerItem messageId="1">Hello</MessageScrollerItem>
            <MessageScrollerItem messageId="2" scrollAnchor>
              World
            </MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" />
      </MessageScroller>
    </MessageScrollerProvider>,
  );
}

describe('MessageScroller', () => {
  it('renders the viewport/content/item chain with kit classes', () => {
    renderScroller();
    expect(screen.getByRole('region', { name: 'Messages' }).className).toContain(
      styles.viewport,
    );
    expect(screen.getByRole('log').className).toContain(styles.content);
    const item = screen.getByText('Hello');
    expect(item.className).toContain(styles.item);
    expect(item.getAttribute('data-message-id')).toBe('1');
  });

  it('marks the scroll-anchor item via the messageId/scrollAnchor props', () => {
    renderScroller();
    expect(screen.getByText('World').getAttribute('data-scroll-anchor')).toBe('true');
    expect(screen.getByText('Hello').getAttribute('data-scroll-anchor')).toBe('false');
  });

  it('renders the jump button as a kit Button via the render prop, icon-only by default', () => {
    renderScroller();
    const button = screen.getByRole('button', { name: 'Scroll to end' });
    expect(button.className).toContain(styles.button);
    expect(button.getAttribute('data-direction')).toBe('end');
    // No visible label passed: the underlying kit Button goes icon-only
    // (see button.tsx's hasLabel/hasIcon derivation) rather than rendering
    // an empty label span.
    expect(button.getAttribute('data-icon-only')).toBe('true');
  });

  it('accepts an explicit aria-label override', () => {
    render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent />
          </MessageScrollerViewport>
          <MessageScrollerButton direction="start" aria-label="Back to top" />
        </MessageScroller>
      </MessageScrollerProvider>,
    );
    expect(screen.getByRole('button', { name: 'Back to top' })).toBeTruthy();
  });

  it('supports a fully custom render target, overriding the default Button composition', () => {
    render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent />
          </MessageScrollerViewport>
          <MessageScrollerButton
            direction="end"
            render={<a href="#end" data-testid="custom-jump" />}
          >
            Jump
          </MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>,
    );
    const custom = screen.getByTestId('custom-jump');
    expect(custom.tagName).toBe('A');
    expect(custom.textContent).toBe('Jump');
  });

  it('scopes the bottom-anchor rule to transcripts built from MessageScrollerItem', () => {
    // jsdom has no layout engine (see the file header), so this cannot
    // measure the resulting spacer/gap pixels - it instead pins down the
    // CSS selector's scoping contract: `.content:has(> [data-scroll-anchor])`
    // must match a real chat transcript (every MessageScrollerItem renders
    // `data-scroll-anchor`, regardless of whether `messageId`/`scrollAnchor`
    // are passed) and must NOT match a plain reading surface like the mail
    // pane's, which puts un-wrapped content straight into
    // MessageScrollerContent with no MessageScrollerItem at all.
    renderScroller();
    const content = screen.getByRole('log');
    expect(content.querySelector('[data-scroll-anchor]')).toBeTruthy();

    cleanup();
    render(
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent>
              <div>Plain reading content, no MessageScrollerItem</div>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>,
    );
    const plainContent = screen.getByRole('log');
    expect(plainContent.querySelector('[data-scroll-anchor]')).toBeNull();
  });

  it('merges a consumer className alongside the kit class on every part', () => {
    render(
      <MessageScrollerProvider>
        <MessageScroller className="consumer-root">
          <MessageScrollerViewport className="consumer-viewport">
            <MessageScrollerContent className="consumer-content" />
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>,
    );
    const viewport = screen.getByRole('region', { name: 'Messages' });
    expect(viewport.className).toContain(styles.viewport);
    expect(viewport.className).toContain('consumer-viewport');
    expect(viewport.parentElement?.className).toContain('consumer-root');
  });
});
