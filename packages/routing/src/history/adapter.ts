// The injectable seam between `NavigationHistory` and a concrete
// history/location implementation.
//
// FEATURE (navigation-substrate) does not name this shape normatively — the
// port it does name is `EngineProviderInput`/`EngineProviderPort` (§1.5,
// "Engine-provider port shape"), which sits on the *other* side of
// `NavigationHistory` (consumed by a router engine, never implemented by
// one). This adapter exists purely so `resolveNavigationHistory` and
// `createNavigationHistory` can be constructed against a concrete
// `window.history`/`popstate` implementation or a test double
// interchangeably, without either one depending on `window` directly.
import type { Location } from '../types/index.js';

/** @internal Test seam — not part of this package's own public surface (see
 * `../history/index.js`); a conforming consumer never constructs or reads
 * one, only `resolveNavigationHistory`'s own default builds it. */
export interface HistoryAdapter {
  /** Reads the current location fresh — never cached by the adapter itself. */
  getLocation(): Location;
  /** Appends a new history entry for `path`, exactly as composed by the caller. */
  pushState(path: string): void;
  /** Overwrites the current history entry with `path`. */
  replaceState(path: string): void;
  /** Moves through existing history entries by a signed step count. */
  go(delta: number): void;
  /** Registers a listener for a browser-observed navigation-history change
   * (back/forward, a third-party `history.go`, a fragment-only navigation).
   * Returns its own release function. */
  onPop(listener: () => void): () => void;
}

function readWindowLocation(): Location {
  return {
    path: window.location.pathname,
    search: window.location.search.startsWith('?')
      ? window.location.search.slice(1)
      : window.location.search,
    hash: window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash,
  };
}

/**
 * The default adapter, wrapping `window.history`/`window.location`/`popstate`
 * — used when the realm-global singleton is resolved with no adapter
 * override (SSR/tests inject their own instead; see `resolveNavigationHistory`
 * in `./singleton.ts`).
 *
 * FEATURE (navigation-substrate) §3, Realm-Global Singleton Resolution,
 * step 2.1: "Construct the navigation-history instance over the browser's
 * own navigation-history API" — `createNavigationHistory`
 * (`./navigation-history.ts`) carries that same step's own marker for the
 * half it performs (registering the pop subscription at construction); this
 * is the other half the step names — the construction "over the browser's
 * own navigation-history API" itself, `window.history`/`window.location`.
 */
// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2
// @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-construct-instance
export function createWindowHistoryAdapter(): HistoryAdapter {
  return {
    getLocation: readWindowLocation,
    pushState(path: string): void {
      window.history.pushState(null, '', path);
    },
    replaceState(path: string): void {
      window.history.replaceState(null, '', path);
    },
    go(delta: number): void {
      window.history.go(delta);
    },
    onPop(listener: () => void): () => void {
      // `popstate` alone (nav FEATURE §1.5, "Observed browser events"): a
      // fragment-only navigation already raises `popstate`, so also
      // listening for `hashchange` would deliver that identical navigation
      // to this listener twice — one extra, spurious dispatch round per
      // fragment navigation.
      window.addEventListener('popstate', listener);
      return () => {
        window.removeEventListener('popstate', listener);
      };
    },
  };
}
// @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-construct-instance
