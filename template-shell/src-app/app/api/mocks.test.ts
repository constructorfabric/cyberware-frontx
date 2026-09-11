import { beforeEach, describe, expect, it } from 'vitest';
import { accountsMockMap } from './mocks';
import { getMockUser, resetAccountsMockState } from './__test-utils__/mocks';

describe('accountsMockMap', () => {
  beforeEach(() => {
    resetAccountsMockState();
  });

  it('returns the current mock user instance', () => {
    const getCurrentUser = accountsMockMap['GET /api/accounts/user/current'];

    expect(getCurrentUser()).toEqual({ user: getMockUser() });
  });

  it('restores the default mock user after state reset', () => {
    const initialUser = getMockUser();

    initialUser.firstName = 'Changed';

    resetAccountsMockState();

    expect(getMockUser()).toEqual(
      expect.objectContaining({
        id: 'mock-user-001',
        firstName: 'Alex',
      }),
    );
    expect(getMockUser()).not.toBe(initialUser);
  });
});
