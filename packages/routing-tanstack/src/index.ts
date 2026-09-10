// @gears-frontx/routing-tanstack — package entry point.
//
// This package is the default implementation of the engine-provider port the
// navigation substrate declares (`cpt-frontx-routing-fr-engine-provider-port`,
// owned by the routing package's own DESIGN). The Engine Provider component
// itself is specified by this package's own `engine-provider` FEATURE
// (packages/routing-tanstack/architecture/features/engine-provider/FEATURE.md).
//
// This entry point re-exports the full engine-provider surface: history
// adaptation and router creation (§3, "History Adaptation To The
// RouterHistory Contract" and "Router Creation And Mount Over A Virtual
// History"), the composed and standalone virtual-location sources, the
// mode-selecting dispatch between them, the location-preserving navigation
// helper, and teardown (`RouterHistory#destroy`, already part of the
// history-adaptation surface below — no separate export, since the
// teardown algorithm's own output is that same member), plus the port's
// own type contract.
export type { EngineProviderInput, EngineProviderPort, EntryAddress } from '@gears-frontx/routing';

export { projectParamsToVirtualLocation, projectVirtualLocationToParams, ROUTE_PARAM_NAME } from './virtual-location.js';
export type { VirtualLocationParts } from './virtual-location.js';

export type { VirtualLocationSource } from './history-adaptation.js';
export { adaptVirtualLocationHistory } from './history-adaptation.js';

export { createComposedVirtualLocationSource, adaptComposedHistory } from './composed-history-source.js';
export { createStandaloneVirtualLocationSource, adaptStandaloneHistory } from './standalone-history-source.js';
export { adaptProviderHistory } from './engine-provider-history.js';
export { locationPreservingRedirect } from './location-preserving-redirect.js';

export { createProviderRouter, createEngineProviderRouter, EngineProvider } from './router-creation.js';
export type { EngineProviderProps, EngineProviderFromRouterProps } from './router-creation.js';

// DESIGN §3.3, "API Contracts" — the concrete engine's own component-tree
// hooks and components this package's public surface lists alongside its
// own adapter, so a microfrontend using this package's default provider
// never needs its own direct `@tanstack/react-router` import for these
// (`cpt-frontx-constraint-routing-tanstack-sole-engine-import`, A3): a
// direct import would move the sole permitted ecosystem edge into the
// consumer, which the ecosystem-wide `no-restricted-imports` guard exists
// to prevent.
export {
  createRouter,
  RouterProvider,
  useNavigate,
  useParams,
  useSearch,
  useRouterState,
  Link,
  Outlet,
  redirect,
  notFound,
} from '@tanstack/react-router';
