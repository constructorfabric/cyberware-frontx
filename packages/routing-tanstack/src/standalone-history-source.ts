// Standalone-mode virtual-location source: projects the identical
// `route`-parameter convention directly onto the page's own pathname and
// search, with no entry, no grammar codec, and no back-projection helper
// involved (FEATURE §3, "Standalone Deployment Of A Single Microfrontend",
// steps 1, 1.1, 1.2).
//
// Design decision (task 10): `readParams` reuses
// `projectVirtualLocationToParams` — the same pure function
// `createComposedVirtualLocationSource`'s own write path uses to turn a
// virtual location back into a parameter list — to build a params array
// from the page's own current pathname/search. Feeding that array back
// through `projectParamsToVirtualLocation` (the shared history-adaptation
// pipeline every `VirtualLocationSource` is read through) round-trips to
// the identical pathname/search it was built from — proven directly by
// `virtual-location.test.ts`'s own "round-trips through
// projectParamsToVirtualLocation" case. This is not the composed case's
// `route`-parameter convention reapplied to a fake entry; it is this pair
// of pure functions' own round-trip identity, reused so
// `adaptVirtualLocationHistory` (`./history-adaptation.js`) needs no
// standalone-specific branch of its own — every derivation past this
// source stays identical between the two modes, exactly as the algorithm's
// own Output requires ("the same router construction... independent of
// whether the consumer has created a route-ownership-signal observer").
import type { HistoryVerb, NavigationHistory } from '@gears-frontx/routing';
import type { RouterHistory } from '@tanstack/react-router';
import { adaptVirtualLocationHistory, type VirtualLocationSource } from './history-adaptation.js';
import { projectVirtualLocationToParams } from './virtual-location.js';

/**
 * Builds a `VirtualLocationSource` (`./history-adaptation.js`) projecting
 * directly onto the page's own current pathname and search — no entry
 * address, no grammar codec, no back-projection helper (FEATURE §3,
 * Standalone Deployment, steps 1.1-1.2).
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-redirect-and-standalone:p1
export function createStandaloneVirtualLocationSource(navigationHistory: NavigationHistory): VirtualLocationSource {
  return {
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-project-standalone-location
    // The page's own pathname is this occupant's entire virtual pathname,
    // and the page's own search is its entire virtual search — no `route`
    // parameter to extract, because there is no enclosing entry (step
    // 1.1). Never `undefined`: unlike a composed occupant's own entry, the
    // page's own address is always present.
    readParams: () => projectVirtualLocationToParams(navigationHistory.location.path, navigationHistory.location.search),
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-project-standalone-location

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-standalone-write-back
    // `push`/`replace` call the page's own history directly with the page's
    // own pathname and search built from the virtual location — the same
    // `NavigationHistory` instance the composed source reads from, but
    // through its own `push`/`replace`, never `backProjectEntries` (step
    // 1.2). `NavigationHistory`'s own `push`/`replace` already are the
    // page's own `history.pushState`/`replaceState` at the adapter layer
    // (`cpt-frontx-algo-routing-navigation-substrate-singleton-resolution`);
    // no separate `window.history` call is made here.
    //
    // The hash written is `hash` when the caller gave one (F7: a hash
    // passed to a navigation is applied to the page's own hash) — otherwise
    // the page's own current hash is carried forward verbatim (A4; matches
    // the composed source, whose write-back re-serializes the current hash
    // it never touches) — a virtual location carries no hash of its own
    // (DESIGN §3.1), so leaving it off here on an unspecified-hash call
    // would silently clear the page's own fragment on every standalone
    // navigation, a parity break the AC (composed/standalone identical
    // result) forbids.
    write: (pathname: string, search: string, verb: HistoryVerb, hash?: string): void => {
      const effectiveHash = hash ?? navigationHistory.location.hash;
      const hashSuffix = effectiveHash === '' ? '' : `#${effectiveHash}`;
      navigationHistory[verb](`${pathname}${search}${hashSuffix}`);
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-standalone-write-back

    // Composes the page's own full address directly — no composed URL and
    // no grammar serializer exist to call in this mode. `hash` follows the
    // identical given-versus-absent convention `write` documents above.
    createHref: (pathname: string, search: string, hash?: string): string => {
      const effectiveHash = hash ?? navigationHistory.location.hash;
      const hashSuffix = effectiveHash === '' ? '' : `#${effectiveHash}`;
      return `${pathname}${search}${hashSuffix}`;
    },
  };
}

/**
 * Convenience composition of `createStandaloneVirtualLocationSource` and
 * `adaptVirtualLocationHistory` (`./history-adaptation.js`) — the
 * standalone counterpart of `adaptComposedHistory`
 * (`./composed-history-source.js`).
 */
export function adaptStandaloneHistory(navigationHistory: NavigationHistory): RouterHistory {
  return adaptVirtualLocationHistory(navigationHistory, createStandaloneVirtualLocationSource(navigationHistory));
}
