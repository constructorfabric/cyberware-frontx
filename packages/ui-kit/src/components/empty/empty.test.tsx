import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './empty';
import styles from './empty.module.css';

afterEach(cleanup);

function renderEmpty() {
  return render(
    <Empty data-testid="empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <svg data-testid="icon" />
        </EmptyMedia>
        <EmptyTitle>No results</EmptyTitle>
        <EmptyDescription>Try a different search.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <button type="button">Clear filters</button>
      </EmptyContent>
    </Empty>,
  );
}

describe('Empty', () => {
  it('renders every part with its kit class', () => {
    renderEmpty();
    expect(screen.getByTestId('empty').className).toContain(styles.empty);
    expect(screen.getByText('No results').className).toContain(styles.emptyTitle);
    expect(screen.getByText('Try a different search.').className).toContain(
      styles.emptyDescription,
    );
    expect(screen.getByRole('button', { name: 'Clear filters' }).parentElement?.className).toContain(
      styles.emptyContent,
    );
  });

  it('defaults EmptyMedia to the default variant and switches to icon', () => {
    const { rerender } = render(<EmptyMedia data-testid="media" />);
    expect(screen.getByTestId('media').className).toContain(styles.variantDefault);
    rerender(<EmptyMedia data-testid="media" variant="icon" />);
    expect(screen.getByTestId('media').className).toContain(styles.variantIcon);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Empty data-testid="empty" className="consumer" />);
    const empty = screen.getByTestId('empty');
    expect(empty.className).toContain(styles.empty);
    expect(empty.className).toContain('consumer');
  });

  it('does not leak the variant prop to the DOM as an attribute', () => {
    render(<EmptyMedia data-testid="media" variant="icon" />);
    expect(screen.getByTestId('media').hasAttribute('variant')).toBe(false);
  });

  it.each([
    ['EmptyHeader', EmptyHeader, styles.emptyHeader],
    ['EmptyTitle', EmptyTitle, styles.emptyTitle],
    ['EmptyDescription', EmptyDescription, styles.emptyDescription],
    ['EmptyContent', EmptyContent, styles.emptyContent],
  ] as const)('merges a consumer className on %s without dropping the kit class', (_name, Part, kitClass) => {
    render(<Part data-testid="part" className="consumer" />);
    const part = screen.getByTestId('part');
    expect(part.className).toContain(kitClass);
    expect(part.className).toContain('consumer');
  });

  it('renders EmptyDescription as a div, matching upstream despite its own p-typed props', () => {
    render(<EmptyDescription data-testid="desc">text</EmptyDescription>);
    expect(screen.getByTestId('desc')).toHaveProperty('tagName', 'DIV');
  });
});
