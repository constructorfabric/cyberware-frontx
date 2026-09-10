/**
 * MFE Bootstrap — executed once when any entry first loads.
 * Creates the minimal FrontX app, registers slices, effects, and API services.
 * Cache/runtime note:
 * - The host app owns the shared runtime via queryCache().
 * - Child apps join that shared QueryClient via queryCacheShared().
 * - Do not add queryCache(), createFrontXApp(), or QueryClientProvider here.
 */
// @cpt-dod:cpt-frontx-dod-mfe-isolation-internal-dataflow:p1
// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-blank-mfe-tests:p1
// @cpt-flow:cpt-frontx-flow-mfe-isolation-mfe-bootstrap:p1

import {
  createFrontX,
  registerSlice,
  apiRegistry,
  effects,
  mock,
  queryCacheShared,
} from '@gears-frontx/react';
import { homeSlice } from './slices/homeSlice';
import { initHomeEffects } from './effects/homeEffects';
import { _BlankApiService } from './api/_BlankApiService';

// Register API services BEFORE build — mock plugin syncs during build(),
// so services must already be present for mock activation to find them
apiRegistry.register(_BlankApiService);
apiRegistry.initialize();

// Create only the local MFE app shell.
// queryCacheShared() joins the host-owned QueryClient without reconfiguring it.
const mfeApp = createFrontX().use(effects()).use(queryCacheShared()).use(mock()).build();

// Register slices with effects (needs store from build())
registerSlice(homeSlice, initHomeEffects);

export { mfeApp };
