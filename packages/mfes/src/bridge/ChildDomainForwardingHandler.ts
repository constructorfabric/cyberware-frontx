// @cpt-flow:cpt-frontx-flow-mfe-host-communication-dispatch-chain:p1
// @cpt-algo:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2
/**
 * Child Domain Forwarding Handler
 *
 * ActionHandler subclass for forwarding actions targeting child domains to the
 * child runtime via the bridge transport.
 *
 * When a child MFE registers its own domains, the parent runtime needs a way
 * to route actions to those domains. This handler is registered in the parent's
 * mediator as a catch-all for the child domain ID. When the parent's mediator
 * resolves a target that matches a child domain, it invokes this handler, which
 * wraps the action in an ActionsChain and forwards it via the private bridge transport.
 *
 * A catch-all handler is used here because the parent cannot know the full set
 * of action types the child domain supports at registration time — that information
 * lives in the child's own registry.
 *
 * Gated transitively: `handleAction` forwards through
 * `ParentMfeBridgeImpl.sendActionsChain`, which itself rejects with
 * `BridgeInactiveError`/`BridgeDisposedError` while the bridge is inactive or
 * destroyed. This handler adds no gating logic of its own.
 *
 * @packageDocumentation
 * @internal
 */

import { ActionHandler } from '../mediator/types';
import type { ActionsChain } from '../types';
import type { ParentMfeBridgeImpl } from './ParentMfeBridge';

/**
 * Forwards any action targeting a child domain through the parent bridge transport.
 *
 * @internal
 */
// @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-register-catchall
export class ChildDomainForwardingHandler extends ActionHandler {
  constructor(
    private readonly parentBridgeImpl: ParentMfeBridgeImpl,
    private readonly childDomainId: string
  ) {
    super();
  }

  /**
   * Forward an action targeting the child domain through the parent bridge transport.
   * Wraps the action in an ActionsChain so the child registry's mediator can unwrap
   * and dispatch it to the correct handler on the child side.
   *
   * @param actionTypeId - The action type ID to forward
   * @param payload - The action payload to include in the forwarded chain
   */
  async handleAction(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    // Wrap the action in an ActionsChain for bridge transport.
    // The child registry's mediator will unwrap and execute it.
    const chain: ActionsChain = {
      action: {
        type: actionTypeId,
        target: this.childDomainId,
        payload,
      },
    };

    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-catchall-forward
    await this.parentBridgeImpl.sendActionsChain(chain);
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-catchall-forward
  }
}
// @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-register-catchall
