import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Spinner } from './spinner';
import styles from './spinner.module.css';

afterEach(cleanup);

describe('Spinner', () => {
  it('renders an svg with the base class and the loading icon path', () => {
    const { container } = render(<Spinner data-testid="spinner" />);
    // `querySelector('svg')` (not `screen.getByTestId`, typed as a plain
    // HTMLElement) so `className` is statically an `SVGAnimatedString` —
    // matching what it actually is at runtime on an SVG element — instead
    // of the `string` testing-library's HTMLElement-typed getters would
    // give it, which has no `.baseVal` at all.
    const spinner = container.querySelector('svg');
    expect(spinner).not.toBeNull();
    expect(spinner?.className.baseVal).toContain(styles.spinner);
    expect(spinner?.querySelector('path')).not.toBeNull();
  });

  it('announces itself as a status with a default loading label', () => {
    render(<Spinner />);
    const spinner = screen.getByRole('status');
    expect(spinner.getAttribute('aria-label')).toBe('Loading');
  });

  it('lets a consumer override the default label and role', () => {
    render(<Spinner aria-label="Saving" role="alert" data-testid="spinner" />);
    const spinner = screen.getByTestId('spinner');
    expect(spinner.getAttribute('aria-label')).toBe('Saving');
    expect(spinner.getAttribute('role')).toBe('alert');
  });

  it('merges a consumer className without dropping the kit class', () => {
    const { container } = render(<Spinner className="consumer" data-testid="spinner" />);
    const spinner = container.querySelector('svg');
    expect(spinner).not.toBeNull();
    expect(spinner?.className.baseVal).toContain(styles.spinner);
    expect(spinner?.className.baseVal).toContain('consumer');
  });

  it('forwards native svg props such as id', () => {
    render(<Spinner id="save-spinner" data-testid="spinner" />);
    expect(screen.getByTestId('spinner')).toHaveProperty('id', 'save-spinner');
  });
});
