/**
 * Runtime mock state consumed by `mocks.ts` and shipped with the service bundle.
 * Keep reusable test fixtures and reset helpers in `__test-utils__/`.
 */
import { Language } from '@gears-frontx/react';
import { UserRole, type ApiUser } from './types';

export const createDefaultAccountsMockUser = (): ApiUser => ({
  id: 'mock-user-001',
  email: 'alex.rivera@frontx.dev',
  firstName: 'Alex',
  lastName: 'Rivera',
  role: UserRole.Admin,
  language: Language.English,
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AlexRivera',
  createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2024-12-01T00:00:00Z').toISOString(),
  extra: {
    department: 'Engineering',
  },
});

let currentMockUser = createDefaultAccountsMockUser();

export const readCurrentAccountsMockUser = (): ApiUser => currentMockUser;

export const replaceCurrentAccountsMockUser = (nextUser: ApiUser): void => {
  currentMockUser = nextUser;
};
