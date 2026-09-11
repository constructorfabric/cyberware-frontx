import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Layout } from './Layout';

vi.mock('@/app/actions/bootstrapActions', () => ({ fetchCurrentUser: vi.fn() }));

// Every slot Layout composes is stubbed, so what the assertions see is Layout's
// own JSX and nothing the slots decide for themselves.
vi.mock('./Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('./Menu', () => ({ Menu: () => <div data-testid="menu" /> }));
vi.mock('./Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('./Popup', () => ({ Popup: () => <div data-testid="popup" /> }));
vi.mock('./Overlay', () => ({ Overlay: () => <div data-testid="overlay" /> }));
vi.mock('./Screen', () => ({
  Screen: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="screen">{children}</div>
  ),
}));

// `Footer` is deliberately NOT stubbed: a footer mounted here would render for
// real, so the case below fails on the empty band itself rather than on a stub
// standing in for it. The state it reads says visible, which is the default a
// shell that never touched `setFooterVisible` gets.
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: () => ({ visible: true }),
}));

describe('Layout', () => {
  it('mounts no footer, having no content to frame in one', () => {
    render(<Layout>screen content</Layout>);

    expect(screen.queryByRole('contentinfo')).toBeNull();
  });

  it('renders the screen children it is given', () => {
    render(<Layout>screen content</Layout>);

    expect(screen.getByTestId('screen').textContent).toBe('screen content');
  });
});
