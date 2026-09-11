/**
 * Cross-hop routing for the downward forwarding-entry and upward escalation
 * resolution tiers.
 *
 * Deliberately NOT an `ActionHandler`: a `CrossHopRoute` needs to carry the
 * caller's remaining chain-time budget across the bridge hop it crosses
 * (`inst-cross-hop-timeout`) and support forced-rejection of an in-flight
 * dispatch on retraction (`inst-reject-inflight-retracted`), neither of which
 * fits `ActionHandler.handleAction(actionTypeId, payload)`'s narrower shape.
 * Internal-only: not exported from the package's public barrel.
 *
 * A concrete class (rather than a structural interface implemented by plain
 * object literals) so the mediator's tier dispatch can identify a resolved
 * route with `instanceof` instead of duck-typing on the presence of a `send`
 * method — an ordinary `ActionHandler` subclass is free to define its own
 * unrelated `send` method without being misrouted.
 *
 * @packageDocumentation
 * @internal
 */

import type { ActionsChain } from '../types';

// @cpt-begin:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-forwarding-entry-lookup
export class CrossHopRoute {
  constructor(
    private readonly sendFn: (chain: ActionsChain) => Promise<void>,
    private readonly registerInFlightFn: (reject: (err: Error) => void) => () => void
  ) {}
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-forwarding-entry-lookup

  /**
   * Send the (re-wrapped) chain across this hop — down through a specific
   * child's bridge for a forwarding entry, or up through the registry's own
   * inbound bridge for escalation.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-cross-hop-timeout
  send(chain: ActionsChain): Promise<void> {
    return this.sendFn(chain);
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-cross-hop-timeout

  /**
   * Register a reject callback to be invoked if this route's target is
   * retracted while the dispatch is in flight. Returns an unregister
   * function to call once the dispatch settles normally.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-reject-inflight-retracted
  registerInFlight(reject: (err: Error) => void): () => void {
    return this.registerInFlightFn(reject);
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-reject-inflight-retracted
}
