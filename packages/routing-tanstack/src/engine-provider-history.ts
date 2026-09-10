// Mode selection by presence of an entry address (FEATURE §3, Standalone
// Deployment, step 1; §6 Acceptance Criteria, "Mode selection by presence
// of an entry address"). The single call site every consumer of this
// package's default provider uses, whether composed or standalone: given
// an entry address, adapts from that occupant's own entry
// (`./composed-history-source.js`); given none, adapts directly from the
// page's own address (`./standalone-history-source.js`). Every derivation
// past this dispatch — router construction, mount, `createHref`, `block` —
// runs identically in both modes, since `RouterHistory` is already the
// same shape either way.
import type { EntryAddress, NavigationHistory } from '@gears-frontx/routing';
import type { RouterHistory } from '@tanstack/react-router';
import { adaptComposedHistory } from './composed-history-source.js';
import { adaptStandaloneHistory } from './standalone-history-source.js';

/**
 * Adapts `navigationHistory` into a `RouterHistory`, projecting from
 * `entryAddress`'s own entry when supplied, or directly from the page's
 * own address when it is not — the same route tree and the same
 * adaptation logic run in both cases (FEATURE §6, "Mode selection by
 * presence of an entry address").
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-redirect-and-standalone:p1
// This function is also the default provider's own worked instance of the
// Swap-The-Router-Engine flow's step 3 ("adapt-history"): whichever
// provider a microfrontend adopts, replacing one means replacing the call
// this function represents — the default provider's own is marked here.
// @cpt-flow:cpt-frontx-flow-routing-engine-provider-swap-engine:p1
// @cpt-begin:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-adapt-history
export function adaptProviderHistory(navigationHistory: NavigationHistory, entryAddress: EntryAddress | undefined): RouterHistory {
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-if-standalone
  if (entryAddress === undefined) {
    return adaptStandaloneHistory(navigationHistory);
  }
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-standalone-deployment:p2:inst-if-standalone
  return adaptComposedHistory(navigationHistory, entryAddress);
}
// @cpt-end:cpt-frontx-flow-routing-engine-provider-swap-engine:p1:inst-adapt-history
