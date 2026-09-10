import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toggle } from './toggle';
import styles from './toggle.module.css';

afterEach(cleanup);

describe('Toggle', () => {
  it('renders an unpressed toggle with base and default variant/size classes', () => {
    render(<Toggle aria-label="Bold" />);
    const toggle = screen.getByRole('button', { name: 'Bold' });
    expect(toggle.className).toContain(styles.toggle);
    expect(toggle.className).toContain(styles.variantDefault);
    expect(toggle.className).toContain(styles.sizeDefault);
    expect(toggle.hasAttribute('data-pressed')).toBe(false);
  });

  it('toggles on click and reports through onPressedChange', () => {
    const onPressedChange = vi.fn();
    render(<Toggle aria-label="Bold" onPressedChange={onPressedChange} />);
    const toggle = screen.getByRole('button', { name: 'Bold' });
    fireEvent.click(toggle);
    expect(onPressedChange).toHaveBeenCalledTimes(1);
    expect(onPressedChange.mock.calls[0]?.[0]).toBe(true);
    expect(toggle.hasAttribute('data-pressed')).toBe(true);
  });

  it('applies the outline variant and lg size, and merges a consumer className', () => {
    render(
      <Toggle aria-label="Italic" variant="outline" size="lg" className="consumer" />,
    );
    const toggle = screen.getByRole('button', { name: 'Italic' });
    expect(toggle.className).toContain(styles.variantOutline);
    expect(toggle.className).toContain(styles.sizeLg);
    expect(toggle.className).toContain('consumer');
  });

  it('supports an uncontrolled defaultPressed', () => {
    render(<Toggle aria-label="Starred" defaultPressed />);
    expect(screen.getByRole('button', { name: 'Starred' }).hasAttribute('data-pressed')).toBe(
      true,
    );
  });

  it('does not toggle when disabled', () => {
    const onPressedChange = vi.fn();
    render(<Toggle aria-label="Locked" disabled onPressedChange={onPressedChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
    expect(onPressedChange).not.toHaveBeenCalled();
  });
});
