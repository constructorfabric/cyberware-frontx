import { AccountsApiService } from './AccountsApiService';
import { resetAccountsMockState } from './__test-utils__/mocks';
import { UserRole } from './types';
import { describeAccountsApiServiceContract } from '@gears-frontx/mfe-test-support/describeAccountsApiServiceContract';

describeAccountsApiServiceContract({
  suiteName: 'AccountsApiService',
  createService: () => new AccountsApiService(),
  resetAccountsMockState,
  adminRole: UserRole.Admin,
});
