import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AspectRatio } from './aspect-ratio';
import styles from './aspect-ratio.module.css';

afterEach(cleanup);

describe('AspectRatio', () => {
  it('renders a div with the kit class and a --ratio custom property matching the prop', () => {
    render(
      <AspectRatio ratio={16 / 9} data-testid="box">
        content
      </AspectRatio>,
    );
    const box = screen.getByTestId('box');
    expect(box).toHaveProperty('tagName', 'DIV');
    expect(box.className).toContain(styles.aspectRatio);
    expect(box.style.getPropertyValue('--ratio')).toBe(String(16 / 9));
  });

  it('updates --ratio when the ratio prop changes', () => {
    const { rerender } = render(
      <AspectRatio ratio={1} data-testid="box">
        content
      </AspectRatio>,
    );
    const box = screen.getByTestId('box');
    expect(box.style.getPropertyValue('--ratio')).toBe('1');
    rerender(
      <AspectRatio ratio={4 / 3} data-testid="box">
        content
      </AspectRatio>,
    );
    expect(box.style.getPropertyValue('--ratio')).toBe(String(4 / 3));
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(
      <AspectRatio ratio={1} className="consumer" data-testid="box">
        content
      </AspectRatio>,
    );
    const box = screen.getByTestId('box');
    expect(box.className).toContain(styles.aspectRatio);
    expect(box.className).toContain('consumer');
  });

  it('merges a consumer inline style rather than overwriting the --ratio one', () => {
    render(
      <AspectRatio ratio={1} style={{ maxWidth: '20rem' }} data-testid="box">
        content
      </AspectRatio>,
    );
    const box = screen.getByTestId('box');
    expect(box.style.maxWidth).toBe('20rem');
    expect(box.style.getPropertyValue('--ratio')).toBe('1');
  });

  it('renders its children', () => {
    render(
      <AspectRatio ratio={1}>
        <img alt="preview" src="/preview.png" />
      </AspectRatio>,
    );
    expect(screen.getByAltText('preview')).toBeTruthy();
  });
});
