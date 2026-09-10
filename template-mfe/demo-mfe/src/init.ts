/**
 * MFE Bootstrap
 *
 * Creates the MFE-local FrontX app instance, registers slices with effects,
 * and registers API services. This module is imported once (as a side effect)
 * by ThemeAwareReactLifecycle, which provides the FrontXProvider to all screens.
 *
 * The MFE bundles its own copy of @gears-frontx/react, giving it isolated singletons:
 * - eventBus (no cross-MFE event leakage)
 * - apiRegistry (isolated service instances)
 * - storeInstance (isolated Redux store)
 */
// @cpt-dod:cpt-frontx-dod-mfe-isolation-internal-dataflow:p1
// @cpt-flow:cpt-frontx-flow-mfe-isolation-mfe-bootstrap:p1

import {
  createFrontX,
  apiRegistry,
  effects,
  mock,
  queryCacheShared,
} from '@gears-frontx/react';
import { AccountsApiService } from './api/AccountsApiService';

// Register API services BEFORE build — mock plugin syncs during build(),
// so services must already be present for mock activation to find them
apiRegistry.register(AccountsApiService);
apiRegistry.initialize();

// Create the MFE-local app shell only.
// queryCacheShared() joins the host-owned QueryClient without reconfiguring it.
const mfeApp = createFrontX().use(effects()).use(queryCacheShared()).use(mock()).build();

export { mfeApp };
