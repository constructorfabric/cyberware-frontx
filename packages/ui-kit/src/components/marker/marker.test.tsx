import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Marker, MarkerContent, MarkerIcon } from './marker';
import styles from './marker.module.css';

afterEach(cleanup);

describe('Marker', () => {
  it('renders a div with the base class and defaults to the default variant', () => {
    render(<Marker data-testid="marker">Explored 4 files</Marker>);
    const marker = screen.getByTestId('marker');
    expect(marker.tagName).toBe('DIV');
    expect(marker.className).toContain(styles.marker);
    expect(marker.className).toContain(styles.variantDefault);
    expect(marker.getAttribute('data-variant')).toBe('default');
  });

  it.each([
    ['default', styles.variantDefault],
    ['separator', styles.variantSeparator],
    ['border', styles.variantBorder],
  ] as const)('applies the %s variant class and data attribute', (variant, variantClass) => {
    render(
      <Marker data-testid="marker" variant={variant}>
        Label
      </Marker>,
    );
    const marker = screen.getByTestId('marker');
    expect(marker.className).toContain(variantClass);
    expect(marker.getAttribute('data-variant')).toBe(variant);
  });

  it('treats an explicit null variant as the default, in class and attribute alike', () => {
    render(
      <Marker data-testid="marker" variant={null}>
        Label
      </Marker>,
    );
    const marker = screen.getByTestId('marker');
    expect(marker.className).toContain(styles.variantDefault);
    expect(marker.getAttribute('data-variant')).toBe('default');
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(
      <Marker data-testid="marker" className="consumer">
        Label
      </Marker>,
    );
    const marker = screen.getByTestId('marker');
    expect(marker.className).toContain(styles.marker);
    expect(marker.className).toContain('consumer');
  });

  it('renders as a different element via the render prop, keeping the kit class', () => {
    render(
      <Marker render={<a href="/files" />} variant="border">
        View files
      </Marker>,
    );
    const link = screen.getByRole('link', { name: 'View files' });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link.className).toContain(styles.marker);
    expect(link.className).toContain(styles.variantBorder);
    expect(link.getAttribute('data-variant')).toBe('border');
  });

  it('forwards native div props such as role and aria-label', () => {
    render(
      <Marker role="status" aria-label="Syncing">
        <MarkerContent>Syncing…</MarkerContent>
      </Marker>,
    );
    const marker = screen.getByRole('status');
    expect(marker.getAttribute('aria-label')).toBe('Syncing');
  });
});

describe('Marker parts', () => {
  it('hides MarkerIcon from assistive tech and renders MarkerContent as a span', () => {
    render(
      <Marker>
        <MarkerIcon data-testid="icon">
          <svg />
        </MarkerIcon>
        <MarkerContent data-testid="content">Explored 4 files</MarkerContent>
      </Marker>,
    );
    const icon = screen.getByTestId('icon');
    expect(icon.tagName).toBe('SPAN');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.className).toContain(styles.markerIcon);
    const content = screen.getByTestId('content');
    expect(content.tagName).toBe('SPAN');
    expect(content.className).toContain(styles.markerContent);
  });
});
