import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { fetchUser } from './profileActions';
import { DEMO_ACTION_REFRESH_PROFILE } from '../shared/extension-ids';

const {
  getService,
  invalidateQueryCacheForApp,
} = vi.hoisted(() => ({
  getService: vi.fn(),
  invalidateQueryCacheForApp: vi.fn(),
}));

vi.mock('@gears-frontx/react', () => ({
  apiRegistry: {
    getService,
  },
  invalidateQueryCacheForApp,
}));

vi.mock('../api/AccountsApiService', () => ({
  AccountsApiService: class AccountsApiService {
    static {
      void 0;
    }
  },
}));

vi.mock('../init', () => ({
  mfeApp: { id: 'demo-mfe-app' },
}));

describe('profileActions.fetchUser', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the current-user descriptor on the shared MFE app', async () => {
    const descriptor = { key: ['profile', 'current-user'] };
    getService.mockReturnValue({ getCurrentUser: descriptor });
    invalidateQueryCacheForApp.mockResolvedValue(undefined);

    fetchUser();
    await Promise.resolve();
    await Promise.resolve();

    expect(DEMO_ACTION_REFRESH_PROFILE).toContain('refresh_profile');
    expect(getService).toHaveBeenCalledTimes(1);
    expect(invalidateQueryCacheForApp).toHaveBeenCalledWith(
      { id: 'demo-mfe-app' },
      descriptor
    );
  });

  it('logs failures instead of throwing synchronously', async () => {
    const error = new Error('invalidate failed');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getService.mockReturnValue({ getCurrentUser: { key: ['profile', 'current-user'] } });
    invalidateQueryCacheForApp.mockRejectedValue(error);

    expect(() => {
      fetchUser();
    }).not.toThrow();
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('[demo-mfe] fetchUser failed:', error);
    });
  });
});
