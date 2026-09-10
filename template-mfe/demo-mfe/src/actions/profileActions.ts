import { apiRegistry, invalidateQueryCacheForApp } from '@gears-frontx/react';
import { AccountsApiService } from '../api/AccountsApiService';
import { mfeApp } from '../init';

/** Invalidates the shared `getCurrentUser` query so ProfileScreen refetches. */
export function fetchUser(): void {
  void Promise.resolve()
    .then(() => {
      const service = apiRegistry.getService(AccountsApiService);
      return invalidateQueryCacheForApp(mfeApp, service.getCurrentUser);
    })
    .catch((error) => {
      console.error('[demo-mfe] fetchUser failed:', error);
    });
}
