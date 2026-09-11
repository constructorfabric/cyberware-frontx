// Router Creation And Mount Over A Virtual History
// `cpt-frontx-algo-routing-engine-provider-router-creation`.
//
// FEATURE (engine-provider) §3, "Router Creation And Mount Over A Virtual
// History".
import { useEffect, useMemo, type ReactElement } from 'react';
import {
  createRouter,
  RouterProvider,
  type AnyRoute,
  type AnyRouter,
  type RouterConstructorOptions,
  type RouterHistory,
} from '@tanstack/react-router';
import type { EngineProviderPort } from '@gears-frontx/routing';
import { adaptProviderHistory } from './engine-provider-history.js';
import { attachAdaptedHistory } from './history-adaptation.js';

/**
 * Calls `createRouter({ routeTree, history })` with the microfrontend's own
 * route tree and the adapted, virtual history built by history adaptation
 * (`./history-adaptation.js`, `./composed-history-source.js`,
 * `./standalone-history-source.js`). The resulting router matches only its
 * own virtual location — the pathname and search this package projected
 * from the occupant's own entry, or from the page's own address in
 * standalone mode — because `history` itself is already scoped to nothing
 * else; no separate code enforces that property. This same call is also
 * where FEATURE §3, Standalone Deployment, steps 4 and 5 land: the
 * standalone case runs through this identical function and
 * `EngineProvider` below, differing only in which `history` was adapted
 * (`./engine-provider-history.js`) — "the same construction path the
 * composed case uses" is this file, unmodified for standalone.
 *
 * FEATURE §3, Router Creation, steps 1-2, 4; Standalone Deployment, steps
 * 4-5; Swap-The-Router-Engine flow, step 5 ("construct-and-mount") for the
 * default provider's own instance of that step.
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-router-creation:p2
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-adaptation-and-creation:p1
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-redirect-and-standalone:p1
// @cpt-flow:cpt-frontx-flow-routing-engine-provider-swap-engine:p1
// @cpt-begin:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-construct-with-standalone-virtual-history
// @cpt-begin:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-construct-and-mount
export function createProviderRouter<TRouteTree extends AnyRoute>(routeTree: TRouteTree, history: RouterHistory) {
  // `RouterConstructorOptions`'s own `context` field is conditionally
  // required, keyed off `TRouteTree`'s own inferred router-context type
  // (`@tanstack/router-core`'s `RouterContextOptions`) — a conditional type
  // TypeScript cannot resolve against a still-generic `TRouteTree`, only
  // against a concrete one. The cast below is the one place that mismatch
  // is bridged; a route tree actually requiring a router context still
  // fails at `createRouter`'s own call inside here; this wrapper adds no
  // context of its own for one this package does not supply.
  //
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-scope-to-entry
  // `history` is passed straight through, unmodified — already scoped to
  // nothing but this occupant's own virtual location by history adaptation
  // (`./history-adaptation.js`), never re-scoped or filtered here — which
  // is what keeps the constructed router matching only that virtual
  // location, never a sibling occupant's own or another domain's (step 2).
  const options = { routeTree, history } as RouterConstructorOptions<TRouteTree, 'never', false, RouterHistory, Record<string, unknown>>;
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-scope-to-entry
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-call-create-router
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-return-mounted-router
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-return-standalone-router
  return createRouter(options);
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-return-standalone-router
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-return-mounted-router
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-call-create-router
}
// @cpt-end:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-construct-and-mount
// @cpt-end:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-construct-with-standalone-virtual-history

export interface EngineProviderProps<TRouteTree extends AnyRoute> {
  /** Expected stable for the lifetime of one mount, exactly like `history`
   * below — `EngineProvider`'s own `useMemo` rebuilds the router whenever
   * this identity changes (B4). The teardown effect below is keyed on
   * `history`, not on the memoized router, so replacing this prop's own
   * identity does destroy the previously adapted `history` (the effect's
   * cleanup runs against the old dependency value before the new setup
   * runs); what is *not* torn down is the previous router object itself —
   * `useMemo` simply drops it, and `RouterProvider` swaps to the new one —
   * so an identity change here without an actual engine swap still leaks
   * whatever internal state that discarded router held beyond its shared
   * `history` member. */
  readonly routeTree: TRouteTree;
  readonly history: RouterHistory;
}

/**
 * N2: `createEngineProviderRouter` below returns only a constructed
 * router — a consumer mounting it directly through `RouterProvider`,
 * bypassing this component, has no lifecycle hook of its own from which to
 * call `router.history.destroy()`, reopening the exact leak §3, Teardown
 * On Unmount, describes on the one export typed against the
 * engine-provider port itself. This overload gives that consumer the same
 * mount boundary and the same symmetric attach/destroy effect below,
 * applied to the already-constructed router's own `history` member (the
 * same adapted `RouterHistory` object either overload ultimately mounts
 * and tears down) instead of a separately supplied `history` prop —
 * `router` is expected stable for the lifetime of one mount, exactly like
 * `history` above.
 *
 * The contract this overload commits to is unconditional: `EngineProvider`
 * owns the lifecycle of whatever `history` the router it is given carries,
 * whether or not that history was built by this package's own adaptation.
 * A `router` constructed elsewhere with a consumer-owned, non-adapted
 * history still has that history's own `destroy()` called on unmount
 * (`attachAdaptedHistory` is a no-op for an object it never registered, so
 * the mismatched half of the pair costs nothing) — a caller who wants to
 * keep managing that history's lifecycle itself must mount the router
 * through a raw `RouterProvider` instead of this overload.
 */
export interface EngineProviderFromRouterProps<TRouter extends AnyRouter> {
  readonly router: TRouter;
}

/**
 * Mounts a router built over an adapted virtual history into the
 * microfrontend's own component tree via `RouterProvider` (FEATURE §3,
 * Router Creation, step 3). Either builds that router itself from
 * `{routeTree, history}` (the same adapted `RouterHistory` a caller built
 * once via `adaptComposedHistory`/`adaptStandaloneHistory`,
 * `./engine-provider-history.js`) or mounts one already constructed
 * elsewhere — `createEngineProviderRouter`'s own output — via `{router}`
 * (N2). Mounting a standalone-adapted history runs through this identical
 * component (FEATURE §3, Standalone Deployment, step 5).
 *
 * FEATURE §3, Teardown On Unmount, step 1 (`inst-when-unmount`): this
 * component is the mount boundary the FEATURE names — its own effect below
 * is the actual "WHEN...unmounted" moment, symmetric with construction
 * rather than a one-way teardown (N1): setup re-establishes the adapted
 * history's own internal `NavigationHistory` registration
 * (`attachAdaptedHistory`, a no-op when it is already active), and cleanup
 * releases it (`history.destroy()`, already documented idempotent). Making
 * the two true inverses of each other is what keeps React's own StrictMode
 * — which double-invokes an effect's setup/cleanup/setup on every
 * development mount — from leaving a still-mounted router's history dead:
 * the second setup re-does exactly what the cleanup undid, so a StrictMode
 * mount still ends with exactly one live subscription, and an actual
 * unmount still ends with zero.
 */
export function EngineProvider<TRouteTree extends AnyRoute>(props: EngineProviderProps<TRouteTree>): ReactElement;
export function EngineProvider<TRouter extends AnyRouter>(props: EngineProviderFromRouterProps<TRouter>): ReactElement;
export function EngineProvider(
  props: EngineProviderProps<AnyRoute> | EngineProviderFromRouterProps<AnyRouter>,
): ReactElement {
  // Normalized to plain, individually stable locals — rather than reading
  // `props.*` inside the `useMemo` callback below — so `react-hooks`'s own
  // exhaustive-deps check can see every dependency the memo actually reads
  // as a simple identifier; reading a discriminated union's members inline
  // inside the callback is a pattern that rule cannot statically follow.
  const fromRouter = 'router' in props;
  const providedRouter = fromRouter ? props.router : undefined;
  const routeTree = fromRouter ? undefined : props.routeTree;
  const providedHistory = fromRouter ? undefined : props.history;
  const history = fromRouter ? props.router.history : props.history;

  // The two overloads above reject a call site missing both prop shapes at
  // compile time; this runtime check only matters for a caller that
  // bypasses them — a plain JavaScript consumer, or an `as`-cast past the
  // union — where `props` can otherwise reach `createProviderRouter` (or
  // `props.router.history` above) as `undefined`, surfacing as an opaque
  // TanStack internal error (reading a property off `undefined`) with no
  // indication that the missing prop, not this package, is the cause.
  if (fromRouter ? providedRouter === undefined : routeTree === undefined || providedHistory === undefined) {
    throw new Error(
      'EngineProvider requires either a {routeTree, history} pair or a {router} — received neither. ' +
        'This is only reachable when a caller bypasses this function\'s own TypeScript overloads.',
    );
  }

  const router = useMemo(() => {
    if (providedRouter !== undefined) {
      return providedRouter;
    }
    // `fromRouter` false is exactly the case `routeTree`/`providedHistory`
    // are both set (the two branches above are exhaustive over the same
    // union, so this pairing always holds); TypeScript has no way to see
    // that invariant across the two independently-computed locals, so it
    // is bridged here rather than left as an unreachable `undefined` case
    // `createProviderRouter` would reject at its own call boundary.
    return createProviderRouter(routeTree as AnyRoute, providedHistory as RouterHistory);
  }, [providedRouter, routeTree, providedHistory]);

  // @cpt-algo:cpt-frontx-algo-routing-engine-provider-teardown:p2
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-when-unmount
  useEffect(() => {
    attachAdaptedHistory(history);
    return () => history.destroy();
  }, [history]);
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-when-unmount

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-mount-router-provider
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-mount-standalone-router
  return <RouterProvider router={router} />;
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-mount-standalone-router
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-router-creation:p2:inst-mount-router-provider
}

/**
 * This package's own conforming instance of the navigation substrate's
 * `EngineProviderPort` (`@gears-frontx/routing`, FEATURE
 * (navigation-substrate) §1.5, "Engine-provider port shape"): a function
 * from `EngineProviderInput` (`history`, `entryAddress`, `routeTree`) to a
 * constructed router, typed against the port so a mismatch between this
 * package's own construction path and the port's normative contract is a
 * compile-time diagnostic, not a hoped-for convention (A3; DESIGN §3.3
 * table row "`createRouter({ routeTree, history })`" reframed against the
 * port's own input shape). Composes `adaptProviderHistory`'s own mode
 * dispatch (`./engine-provider-history.js`) with `createProviderRouter`
 * above — the identical two-step construction path
 * `cpt-frontx-flow-routing-engine-provider-swap-engine`'s own worked
 * instance already names, exposed here as one callable a consumer can pass
 * anywhere the port itself is expected.
 *
 * Teardown (N2): the port's own signature returns a router, not a
 * `{router, destroy}` pair — widening it would break the port typing this
 * function exists to satisfy. The returned router's own `history` member
 * (TanStack's `Router#history` field) is the same adapted `RouterHistory`
 * object `EngineProvider` mounts and tears down elsewhere in this file;
 * mount the result through `<EngineProvider router={router} />` (the
 * `EngineProviderFromRouterProps` overload above), rather than a raw
 * `<RouterProvider router={router} />`, to get that same symmetric
 * teardown on unmount. A consumer that mounts the raw `RouterProvider`
 * instead owns calling `router.history.destroy()` itself.
 */
export const createEngineProviderRouter: EngineProviderPort<AnyRoute, ReturnType<typeof createProviderRouter>> = ({
  history,
  entryAddress,
  routeTree,
}) => createProviderRouter(routeTree, adaptProviderHistory(history, entryAddress));
