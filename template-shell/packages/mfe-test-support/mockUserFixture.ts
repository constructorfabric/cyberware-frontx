type MockUserFixture<TRole extends string> = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: TRole;
  language: string;
  avatarUrl: string;
  createdAt: string;
  updatedAt: string;
  extra: {
    department: string;
  };
};

export const createMockUserFixture = <TRole extends string>(
  adminRole: TRole,
): MockUserFixture<TRole> => ({
  id: 'mock-user-001',
  email: 'alex.rivera@frontx.dev',
  firstName: 'Alex',
  lastName: 'Rivera',
  role: adminRole,
  language: 'en',
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AlexRivera',
  createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2024-12-01T00:00:00Z').toISOString(),
  extra: {
    department: 'Engineering',
  },
});
