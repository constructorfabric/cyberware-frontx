import type { EndpointDescriptor } from '@gears-frontx/framework';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  attachRegisteredRestMocks,
  type ApiServiceWithPlugins,
} from './attachRegisteredRestMocks';
import { createMockUserFixture } from './mockUserFixture';

type CurrentUserEndpoint = EndpointDescriptor<{
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}>;

type AccountsApiServiceContractOptions<
  TRole extends string,
  TService extends ApiServiceWithPlugins & {
    getCurrentUser: CurrentUserEndpoint;
  },
> = {
  suiteName: string;
  createService: () => TService;
  resetAccountsMockState: () => void;
  adminRole: TRole;
};

export function describeAccountsApiServiceContract<
  TRole extends string,
  TService extends ApiServiceWithPlugins & {
    getCurrentUser: CurrentUserEndpoint;
  },
>(options: AccountsApiServiceContractOptions<TRole, TService>): void {
  describe(options.suiteName, () => {
    beforeEach(() => {
      options.resetAccountsMockState();
    });

    it('exposes the current-user endpoint descriptor', async () => {
      const service = options.createService();

      attachRegisteredRestMocks(service);

      const key = service.getCurrentUser.key;
      expect(key).toHaveLength(3);
      expect(key[1]).toBe('GET');
      expect(String(key[2])).toMatch(/\/user\/current$/);
      await expect(service.getCurrentUser.fetch()).resolves.toEqual({
        user: expect.objectContaining(createMockUserFixture(options.adminRole)),
      });
    });
  });
}
