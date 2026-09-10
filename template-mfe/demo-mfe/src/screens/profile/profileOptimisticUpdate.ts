import type { UpdateProfileVariables } from '../../api/AccountsApiService';
import type { GetCurrentUserResponse } from '../../api/types';

export function applyOptimisticProfileUpdate(
  current: GetCurrentUserResponse | undefined,
  variables: UpdateProfileVariables,
  updatedAt: string = new Date().toISOString()
): GetCurrentUserResponse | undefined {
  if (!current) {
    return current;
  }

  return {
    user: {
      ...current.user,
      firstName: variables.firstName,
      lastName: variables.lastName,
      updatedAt,
      extra: {
        ...current.user.extra,
        department: variables.department,
      },
    },
  };
}
