import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from './types';
import { StudioProvider, useStudioContext } from './StudioProvider';

// StudioProvider registers its translation loader at module scope, keyed by
// every member of the Language enum. The proxy answers any member name so the
// keyed object literal builds without pulling the real i18n package in.
vi.mock('@gears-frontx/react', () => ({
  Language: new Proxy({}, { get: (_target, key) => String(key) }),
  I18nRegistry: { createLoader: vi.fn(() => ({})) },
  i18nRegistry: { registerLoader: vi.fn() },
}));

vi.mock('./effects/persistenceEffects', () => ({
  initPersistenceEffects: vi.fn(() => vi.fn()),
}));

vi.mock('./hooks/useRestoreStudioSettings', () => ({
  useRestoreStudioSettings: vi.fn(),
}));

const CollapsedProbe = () => {
  const { collapsed } = useStudioContext();
  return <span>{collapsed ? 'collapsed' : 'expanded'}</span>;
};

const renderProvider = () =>
  render(
    <StudioProvider>
      <CollapsedProbe />
    </StudioProvider>
  );

describe('StudioProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('starts collapsed when the developer has no stored preference', () => {
    renderProvider();

    expect(screen.getByText('collapsed')).toBeTruthy();
  });

  it('starts expanded when the developer previously left the panel open', () => {
    localStorage.setItem(STORAGE_KEYS.COLLAPSED, JSON.stringify(false));

    renderProvider();

    expect(screen.getByText('expanded')).toBeTruthy();
  });
});
