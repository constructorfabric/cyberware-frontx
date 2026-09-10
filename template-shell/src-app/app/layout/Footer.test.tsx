import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FooterState } from '@gears-frontx/react';
import { Footer } from './Footer';

let mockFooterState: FooterState | undefined;

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: () => mockFooterState,
}));

describe('Footer', () => {
  it('renders its children when the layout state says nothing about visibility', () => {
    mockFooterState = undefined;

    render(
      <Footer>
        <span>status</span>
      </Footer>,
    );

    expect(screen.getByText('status')).toBeTruthy();
  });

  it('renders its children when explicitly visible', () => {
    mockFooterState = { visible: true };

    render(
      <Footer>
        <span>status</span>
      </Footer>,
    );

    expect(screen.getByText('status')).toBeTruthy();
  });

  it('renders nothing when hidden, even with children to show', () => {
    mockFooterState = { visible: false };

    const { container } = render(
      <Footer>
        <span>status</span>
      </Footer>,
    );

    expect(container.firstChild).toBeNull();
  });
});
