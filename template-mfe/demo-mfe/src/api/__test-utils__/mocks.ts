import {
  createDefaultAccountsMockUser,
  replaceCurrentAccountsMockUser,
} from '../mock-user-store';
import { createResetAccountsMockState } from '@gears-frontx/mfe-test-support/createResetAccountsMockState';

// @cpt-dod:cpt-frontx-dod-api-communication-base-service:p1

// @cpt-begin:cpt-frontx-dod-api-communication-base-service:p1:inst-demo-mfe-api-test-mocks
export const resetAccountsMockState = createResetAccountsMockState(
  createDefaultAccountsMockUser,
  replaceCurrentAccountsMockUser,
);
// @cpt-end:cpt-frontx-dod-api-communication-base-service:p1:inst-demo-mfe-api-test-mocks
