import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Progress, ProgressLabel, ProgressValue } from './progress';
import styles from './progress.module.css';

afterEach(cleanup);

describe('Progress', () => {
  it('renders a determinate progressbar with its value', () => {
    render(<Progress value={64} aria-label="Uploading" />);
    const bar = screen.getByRole('progressbar', { name: 'Uploading' });
    expect(bar.className).toContain(styles.root);
    expect(bar.getAttribute('aria-valuenow')).toBe('64');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('renders the indicator width from the value', () => {
    const { container } = render(<Progress value={64} aria-label="Uploading" />);
    const indicator = container.querySelector(`.${styles.indicator}`) as HTMLElement;
    expect(indicator.style.width).toBe('64%');
  });

  it('reports indeterminate state with no aria-valuenow', () => {
    render(<Progress value={null} aria-label="Importing" />);
    const bar = screen.getByRole('progressbar', { name: 'Importing' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.hasAttribute('data-indeterminate')).toBe(true);
  });

  it('composes with a label and a live value readout', () => {
    render(
      <Progress value={42}>
        <ProgressLabel>Uploading</ProgressLabel>
        <ProgressValue />
      </Progress>,
    );
    // getByText throws if the node is missing — its return alone proves
    // both parts rendered; no jest-dom matchers are configured here.
    expect(screen.getByText('Uploading').tagName).toBe('SPAN');
    expect(screen.getByText('42%').tagName).toBe('SPAN');
  });

  it('merges a consumer className', () => {
    render(<Progress value={10} aria-label="Loading" className="consumer" />);
    expect(screen.getByRole('progressbar', { name: 'Loading' }).className).toContain('consumer');
  });
});
