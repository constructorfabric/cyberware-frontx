/**
 * Accounts Domain - Mock Data
 * Mock responses for accounts service endpoints
 *
 * Used with MockPlugin for development and testing.
 * Keys are full URL patterns (including baseURL path).
 */

import type { MockMap } from '@gears-frontx/react';
import type { GetCurrentUserResponse, UpdateProfileRequest } from './types';
import { readCurrentAccountsMockUser, replaceCurrentAccountsMockUser } from './mock-user-store';

/**
 * Accounts mock map
 * Keys are full URL patterns (including /api/accounts baseURL)
 */
export const accountsMockMap: MockMap = {
  'GET /api/accounts/user/current': (): GetCurrentUserResponse => ({
    user: readCurrentAccountsMockUser(),
  }),

  'PUT /api/accounts/user/profile': (requestData): GetCurrentUserResponse => {
    // requestData is the PUT body forwarded by RestMockPlugin as context.body.
    // Merge the patched fields onto the base mock user so the response reflects
    // what the server would return after persisting the change.
    const patch = (requestData ?? {}) as Partial<UpdateProfileRequest>;
    const mockUser = readCurrentAccountsMockUser();
    const currentDepartment =
      typeof mockUser.extra?.department === 'string' ? mockUser.extra.department : undefined;

    const updatedUser = {
      ...mockUser,
      firstName: patch.firstName ?? mockUser.firstName,
      lastName: patch.lastName ?? mockUser.lastName,
      updatedAt: new Date().toISOString(),
      extra: {
        ...mockUser.extra,
        department: patch.department ?? currentDepartment,
      },
    };

    replaceCurrentAccountsMockUser(updatedUser);

    return {
      user: updatedUser,
    };
  },
};
