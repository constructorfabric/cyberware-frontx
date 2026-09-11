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

/**
 * The location shape this adapter itself reads and reports — `Location`
 * minus `position`. Position is substrate-level bookkeeping layered on top
 * by `createNavigationHistory` (`./navigation-history.js`, `./position.js`):
 * this adapter's own job is the raw path/search/hash and the opaque
 * per-entry state that bookkeeping is stored in (`getState`/`pushState`/
 * `replaceState` below), never the position number itself.
 *
 * Exists only as `HistoryAdapter`'s own return/parameter type (below) — a
 * conforming consumer never constructs or reads one directly; it is public
 * only because `HistoryAdapter` is (N3, review round 16-re4): a caller
 * supplying `resolveNavigationHistory`'s `createAdapter` parameter (the
 * `HistoryAdapter` seam, FEATURE §3) needs this shape to satisfy it.
 */
export type AdapterLocation = Omit<Location, 'position'>;

/** The `HistoryAdapter` seam (FEATURE §3) — the shape a caller's own adapter
 * must satisfy to pass as `resolveNavigationHistory`'s `createAdapter`
 * parameter (`./singleton.js`); most conforming consumers never construct or
 * read one, since the default `createWindowHistoryAdapter` below already
 * builds one over `window`. Public (N3, review round 16-re4) because it sits
 * in that public function's own signature — see `../history/index.js`'s own
 * comment for why TypeScript's own `stripInternal` compiler option strips
 * the whole declaration either type sits on when a leading comment merely
 * mentions the tag, not just the parameter or field carrying it. */
export interface HistoryAdapter {
  /** Reads the current location fresh — never cached by the adapter itself. */
  getLocation(): AdapterLocation;
  /** Appends a new history entry for `path`, exactly as composed by the
   * caller, carrying `state` as that new entry's own opaque per-entry
   * state (`navigation-history.ts`'s own position bookkeeping, merged with
   * whatever the host already carries — never a raw caller-supplied value,
   * since `NavigationHistory#push` itself accepts no state parameter). */
  pushState(path: string, state: unknown): void;
  /** Overwrites the current history entry with `path`, carrying `state` as
   * that entry's own new opaque per-entry state, identically to `pushState`
   * above. */
  replaceState(path: string, state: unknown): void;
  /** Reads the current entry's own opaque per-entry state fresh — never
   * cached by the adapter itself, mirroring `getLocation`. `undefined`/`null`
   * when the current entry carries none (a cold mount, or an entry this
   * adapter never itself wrote to). */
  getState(): unknown;
  /** Moves through existing history entries by a signed step count. */
  go(delta: number): void;
  /** Registers a listener for a browser-observed navigation-history change
   * (back/forward, a third-party `history.go`, a fragment-only navigation).
   * Returns its own release function. */
  onPop(listener: () => void): () => void;
}

function readWindowLocation(): AdapterLocation {
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
    pushState(path: string, state: unknown): void {
      window.history.pushState(state, '', path);
    },
    replaceState(path: string, state: unknown): void {
      window.history.replaceState(state, '', path);
    },
    getState(): unknown {
      return window.history.state;
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
