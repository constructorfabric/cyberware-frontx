import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CategoryMenu } from './CategoryMenu';

describe('CategoryMenu', () => {
  // The sidebar heading and the screen's own `h1` shared the `title` key, which
  // reads as the same heading twice to anyone navigating by headings. The
  // identity `t` here makes the key the rendered text.
  it('names the sidebar from its own key rather than the page title', () => {
    render(<CategoryMenu t={(key) => key} containerRef={{ current: null }} />);

    expect(screen.getByRole('heading', { level: 2, name: 'menu_title' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'title' })).toBeNull();
  });
});
