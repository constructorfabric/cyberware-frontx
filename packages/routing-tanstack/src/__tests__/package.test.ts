import { describe, expect, it } from 'vitest';
import * as routingTanstack from '../index.js';

// This package's entry point carries the full engine-provider runtime
// surface: history adaptation and router creation (`../virtual-location.ts`,
// `../composed-history-source.ts`, `../history-adaptation.ts`,
// `../router-creation.tsx`), the standalone source and mode dispatch
// (`../standalone-history-source.ts`, `../engine-provider-history.ts`), the
// location-preserving redirect helper (`../location-preserving-redirect.ts`),
// and — per DESIGN §3.3's public-surface table — the concrete engine's own
// component-tree hooks and components, re-exported so a microfrontend never
// has to import `@tanstack/react-router` itself
// (`cpt-frontx-constraint-routing-tanstack-sole-engine-import`; A3). Teardown
// has no separate export — it is `RouterHistory#destroy`, already reachable
// through every function below that returns a `RouterHistory`.
describe('@gears-frontx/routing-tanstack entry point', () => {
  it('loads without throwing', () => {
    expect(routingTanstack).toBeDefined();
  });

  it('exposes the full engine-provider runtime surface', () => {
    expect(Object.keys(routingTanstack).sort()).toEqual(
      [
        'ROUTE_PARAM_NAME',
        'projectParamsToVirtualLocation',
        'projectVirtualLocationToParams',
        'adaptVirtualLocationHistory',
        'createComposedVirtualLocationSource',
        'adaptComposedHistory',
        'createStandaloneVirtualLocationSource',
        'adaptStandaloneHistory',
        'adaptProviderHistory',
        'locationPreservingRedirect',
        'createProviderRouter',
        'createEngineProviderRouter',
        'EngineProvider',
        // DESIGN §3.3 public surface — the concrete engine's own re-exports.
        'createRouter',
        'RouterProvider',
        'useNavigate',
        'useParams',
        'useSearch',
        'useRouterState',
        'Link',
        'Outlet',
        'redirect',
        'notFound',
      ].sort(),
    );
  });
});
