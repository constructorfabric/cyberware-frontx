import { beforeEach, describe, expect, it } from 'vitest';
import type { GetCurrentUserResponse } from './types';
import { accountsMockMap } from './mocks';
import { resetAccountsMockState } from './__test-utils__/mocks';

describe('accountsMockMap', () => {
  beforeEach(() => {
    resetAccountsMockState();
  });

  it('returns the current user and persists profile updates', () => {
    const getCurrentUser = accountsMockMap['GET /api/accounts/user/current'];
    const updateProfile = accountsMockMap['PUT /api/accounts/user/profile'];

    expect(typeof getCurrentUser).toBe('function');
    expect(typeof updateProfile).toBe('function');

    const initialResponse = getCurrentUser() as GetCurrentUserResponse;
    const updatedResponse = updateProfile({
      firstName: 'Ada',
      lastName: 'Lovelace',
      department: 'Platform',
    }) as GetCurrentUserResponse;

    expect(initialResponse.user.firstName).toBe('Alex');
    expect(updatedResponse.user.firstName).toBe('Ada');
    expect(updatedResponse.user.lastName).toBe('Lovelace');
    expect(updatedResponse.user.extra).toEqual({ department: 'Platform' });
    expect(updatedResponse.user.updatedAt).not.toBe(initialResponse.user.updatedAt);

    const refreshedResponse = getCurrentUser() as GetCurrentUserResponse;
    expect(refreshedResponse.user.firstName).toBe('Ada');
    expect(refreshedResponse.user.lastName).toBe('Lovelace');
  });
});
