import type { NavigationHistory } from '../types/index.js';
import { createWindowHistoryAdapter, type HistoryAdapter } from './adapter.js';
import { createNavigationHistory } from './navigation-history.js';

// FEATURE (navigation-substrate) §3, Realm-Global Singleton Resolution,
// Rationale: "The key carries the `NavigationHistory` contract's own
// version rather than naming the package alone, so a copy built against an
// incompatible future or past contract version resolves under its own key
// and constructs its own instance instead of silently capturing and
// reusing one whose shape it cannot actually satisfy." `v1` is this
// contract's current major — bumped only alongside a breaking change to the
// `NavigationHistory` shape itself, never for an additive change.
/** @internal Test seam — a conforming consumer never reads this key
 * directly; it is exported only so tests can reset the realm-global state
 * between cases without retyping the literal string in every suite. */
export const NAVIGATION_HISTORY_KEY = Symbol.for('@gears-frontx/routing/navigation-history/v1');

interface RealmGlobal {
  [NAVIGATION_HISTORY_KEY]?: NavigationHistory;
}

/**
 * Resolves the single `NavigationHistory` instance for the calling realm
 * and this contract version — freshly constructed on the first call,
 * reused on every later call from any independently bundled copy of this
 * package built against the same contract version (FEATURE §3,
 * Realm-Global Singleton Resolution).
 *
 * `createAdapter` is consulted only when no instance exists yet under this
 * realm's well-known key; a later caller's own `createAdapter` is ignored
 * once an instance is already stored, exactly as a second copy of this
 * package finds the first copy's instance already there. Defaults to the
 * browser `window` adapter; a test or an SSR entry point passes its own to
 * avoid touching `window` at all.
 *
 * @param createAdapter @internal Test/SSR seam — a conforming consumer never
 * passes this; it exists so a test can resolve the singleton against a
 * `HistoryAdapter` double instead of `window`.
 */
// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2
// @cpt-flow:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1
export function resolveNavigationHistory(
  createAdapter: () => HistoryAdapter = createWindowHistoryAdapter,
): NavigationHistory {
  // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-resolve-instance
  const realm = globalThis as RealmGlobal;

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-peek-global
  const existing = realm[NAVIGATION_HISTORY_KEY];
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-peek-global

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-if-absent
  if (existing === undefined) {
    const instance = createNavigationHistory(createAdapter());
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-store-global
    realm[NAVIGATION_HISTORY_KEY] = instance;
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-store-global
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-return-instance
    return instance;
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-return-instance
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-if-absent

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-else-present
  return existing;
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-else-present
  // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-resolve-instance
}
