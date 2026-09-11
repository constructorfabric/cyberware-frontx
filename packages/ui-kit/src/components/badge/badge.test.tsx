import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Badge } from './badge';
import styles from './badge.module.css';

afterEach(cleanup);

describe('Badge', () => {
  it('renders a span with the base class and defaults to the default variant', () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText('New');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.className).toContain(styles.badge);
    expect(badge.className).toContain(styles.variantDefault);
  });

  it.each([
    ['default', styles.variantDefault],
    ['secondary', styles.variantSecondary],
    ['destructive', styles.variantDestructive],
    ['outline', styles.variantOutline],
    ['ghost', styles.variantGhost],
    ['link', styles.variantLink],
    ['success', styles.variantSuccess],
    ['warning', styles.variantWarning],
    ['danger', styles.variantDanger],
    ['info', styles.variantInfo],
    ['accent', styles.variantAccent],
  ] as const)('applies the %s variant class', (variant, variantClass) => {
    render(<Badge variant={variant}>Label</Badge>);
    expect(screen.getByText('Label').className).toContain(variantClass);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Badge className="consumer">Tag</Badge>);
    const badge = screen.getByText('Tag');
    expect(badge.className).toContain(styles.badge);
    expect(badge.className).toContain('consumer');
  });

  it('does not leak the variant prop to the DOM as an attribute', () => {
    render(<Badge variant="secondary">Tag</Badge>);
    expect(screen.getByText('Tag').hasAttribute('variant')).toBe(false);
  });

  it('forwards native span props such as data-testid and aria-invalid', () => {
    render(
      <Badge data-testid="status-badge" aria-invalid="true">
        Active
      </Badge>,
    );
    const badge = screen.getByTestId('status-badge');
    expect(badge.textContent).toBe('Active');
    expect(badge.getAttribute('aria-invalid')).toBe('true');
  });

  it('renders as a different element via the render prop, keeping the kit class', () => {
    render(
      <Badge render={<a href="/filters/open" />} variant="outline">
        Open
      </Badge>,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link).toHaveProperty('href', expect.stringContaining('/filters/open'));
    expect(link.className).toContain(styles.badge);
    expect(link.className).toContain(styles.variantOutline);
  });
});
