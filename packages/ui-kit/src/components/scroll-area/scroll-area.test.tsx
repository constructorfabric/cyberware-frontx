import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ScrollArea, ScrollBar } from './scroll-area';
import styles from './scroll-area.module.css';

afterEach(cleanup);

describe('ScrollArea', () => {
  it('renders its children inside a viewport with the kit classes', () => {
    render(
      <ScrollArea data-testid="area">
        <p>Row content</p>
      </ScrollArea>,
    );
    expect(screen.getByText('Row content')).toBeTruthy();
    const area = screen.getByTestId('area');
    expect(area.className).toContain(styles.root);
  });

  it('merges a consumer className onto the root without dropping the kit class', () => {
    render(
      <ScrollArea className="consumer" data-testid="area">
        content
      </ScrollArea>,
    );
    const area = screen.getByTestId('area');
    expect(area.className).toContain(styles.root);
    expect(area.className).toContain('consumer');
  });

  // jsdom performs no real layout, so Base UI never measures overflow and
  // the scrollbar ScrollArea auto-renders stays hidden by default
  // (Scrollbar's own `keepMounted` default is `false` — see
  // ScrollAreaScrollbar.js). ScrollBar also requires a ScrollArea.Root
  // ancestor for context (it throws standalone), so the remaining tests
  // render an extra, forced-mounted ScrollBar inside a ScrollArea to assert
  // on its DOM shape instead of depending on unavailable layout measurement.
  it('renders a vertical ScrollBar with a thumb when forced mounted', () => {
    render(
      <ScrollArea>
        <ScrollBar keepMounted data-testid="bar" />
      </ScrollArea>,
    );
    const bar = screen.getByTestId('bar');
    expect(bar.className).toContain(styles.scrollbar);
    expect(bar.getAttribute('data-orientation')).toBe('vertical');
    expect(bar.querySelector(`.${styles.thumb}`)).toBeTruthy();
  });

  it('switches orientation via the orientation prop', () => {
    render(
      <ScrollArea>
        <ScrollBar keepMounted orientation="horizontal" data-testid="bar" />
      </ScrollArea>,
    );
    expect(screen.getByTestId('bar').getAttribute('data-orientation')).toBe('horizontal');
  });

  it('merges a consumer className onto a standalone ScrollBar', () => {
    render(
      <ScrollArea>
        <ScrollBar keepMounted className="consumer" data-testid="bar" />
      </ScrollArea>,
    );
    const bar = screen.getByTestId('bar');
    expect(bar.className).toContain(styles.scrollbar);
    expect(bar.className).toContain('consumer');
  });

  it('lets a consumer add a second ScrollBar alongside the one ScrollArea renders', () => {
    const { container } = render(
      <ScrollArea>
        <p>Row content</p>
        <ScrollBar keepMounted orientation="horizontal" data-testid="h-bar" />
      </ScrollArea>,
    );
    // ScrollArea's own vertical bar stays hidden (unmeasured, see above);
    // only the consumer's forced-mounted horizontal one renders — proving
    // ScrollBar is usable standalone alongside the composed ScrollArea,
    // not only as its internal, non-overridable default.
    expect(container.querySelectorAll(`.${styles.scrollbar}`)).toHaveLength(1);
    expect(screen.getByTestId('h-bar').getAttribute('data-orientation')).toBe('horizontal');
  });
});
