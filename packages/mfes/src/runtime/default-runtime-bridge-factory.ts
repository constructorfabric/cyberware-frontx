/**
 * Default Runtime Bridge Factory Implementation
 *
 * Concrete runtime bridge factory that handles all internal bridge wiring:
 * creates bridge pairs, connects property subscriptions, wires action chain
 * callbacks, and sets up child domain forwarding.
 *
 * @packageDocumentation
 * @internal
 */

import type { ParentMfeBridge, ChildMfeBridge } from '../handler/types';
import type { ActionsChain } from '../types';
import { ActionHandler } from '../mediator/types';
import type { ExtensionDomainState } from './extension-manager';
import { RuntimeBridgeFactory } from './runtime-bridge-factory';
import { ChildMfeBridgeImpl } from '../bridge/ChildMfeBridge';
import { ParentMfeBridgeImpl } from '../bridge/ParentMfeBridge';
import { ChildDomainForwardingHandler } from '../bridge/ChildDomainForwardingHandler';
import { BridgeDisposedError, BridgeInactiveError } from '../bridge/errors';

/**
 * Wraps an extension-registered `ActionHandler` so a mediator-resolved
 * invocation arriving while the bridge is inactive or destroyed is rejected
 * explicitly rather than reaching the handler. The mediator keeps the
 * registration for the extension's whole registration lifetime
 * (`unregisterExtensionActionHandler` is no longer called on unmount); this
 * wrapper is what makes an inactive bridge's registered handlers
 * unreachable without unregistering them (`inst-fwd-reg-handler`).
 *
 * @internal
 */
class ActiveGuardActionHandler extends ActionHandler {
  constructor(
    private readonly bridge: ChildMfeBridgeImpl,
    private readonly inner: ActionHandler
  ) {
    super();
  }

  async handleAction(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    if (this.bridge.isDestroyed()) {
      throw new BridgeDisposedError(this.bridge.extensionId);
    }
    if (!this.bridge.isActive()) {
      throw new BridgeInactiveError(this.bridge.extensionId);
    }
    return this.inner.handleAction(actionTypeId, payload);
  }
}

/**
 * Default runtime bridge factory implementation.
 *
 * Handles all internal bridge wiring: creates bridge pairs, connects
 * property subscriptions, wires action chain callbacks, and sets up
 * child domain forwarding.
 *
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2
export class DefaultRuntimeBridgeFactory extends RuntimeBridgeFactory {
  /**
   * Acquire the bridge pair for an extension's mount.
   *
   * INTERNAL: Called by mountExtension.
   *
   * @param domainState - Domain state containing properties and subscribers
   * @param extensionId - ID of the extension
   * @param entryTypeId - Type ID of the MFE entry
   * @param domainActions - Action type IDs the entry declares it can receive (unused — kept for API compat)
   * @param existing - The extension's already-minted bridge pair, if this is a remount
   * @param executeActionsChain - Callback for executing actions chains from child to parent
   * @param registerCatchAllActionHandler - Callback for registering catch-all child domain handlers in parent mediator
   * @param unregisterCatchAllActionHandler - Callback for unregistering catch-all child domain handlers from parent mediator
   * @param registerExtensionActionHandler - Callback for registering per-(extensionId, actionTypeId) handlers
   * @param _unregisterExtensionActionHandler - Callback for unregistering all extension handlers (unused — released only at permanent unregistration)
   * @returns Object containing parent and child bridge instances
   */
  acquireBridge(
    domainState: ExtensionDomainState,
    extensionId: string,
    _entryTypeId: string,
    _domainActions: readonly string[],
    existing: { parentBridge: ParentMfeBridge; childBridge: ChildMfeBridge } | undefined,
    executeActionsChain: (chain: ActionsChain) => Promise<void>,
    registerCatchAllActionHandler: (domainId: string, handler: ActionHandler) => void,
    unregisterCatchAllActionHandler: (domainId: string) => void,
    registerExtensionActionHandler: (extensionId: string, actionTypeId: string, handler: ActionHandler, domainId: string) => void,
    _unregisterExtensionActionHandler: (extensionId: string) => void
  ): { parentBridge: ParentMfeBridge; childBridge: ChildMfeBridge } {
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-lifetime
    if (existing) {
      const { parentBridge, childBridge } = existing;
      if (!(parentBridge instanceof ParentMfeBridgeImpl) || !(childBridge instanceof ChildMfeBridgeImpl)) {
        throw new Error(`acquireBridge: expected concrete bridge impls for extension '${extensionId}'`);
      }

      // Re-wire child-to-parent action chain transport.
      parentBridge.onChildAction(executeActionsChain);
      childBridge.setExecuteActionsChainCallback(executeActionsChain);

      // Re-wire child domain forwarding callbacks.
      const registerChildDomainCallback = (domainId: string) => {
        const handler = new ChildDomainForwardingHandler(parentBridge, domainId);
        registerCatchAllActionHandler(domainId, handler);
      };
      const unregisterChildDomainCallback = (domainId: string) => {
        unregisterCatchAllActionHandler(domainId);
      };
      childBridge.setChildDomainCallbacks(registerChildDomainCallback, unregisterChildDomainCallback);

      // Re-wire per-(extensionId, actionTypeId) handler registration.
      childBridge.setRegisterActionHandlerCallback((actionTypeId, handler) => {
        registerExtensionActionHandler(
          extensionId,
          actionTypeId,
          new ActiveGuardActionHandler(childBridge, handler),
          domainState.domain.id
        );
      });

      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-registration-survives-remount
      // Do NOT re-subscribe to domainState.propertySubscribers, do NOT
      // replay domainState.properties, and do NOT touch
      // properties/propertySubscribers/actionsChainHandler/childDomainIds —
      // all survive deactivation untouched (`inst-registration-survives-remount`).
      childBridge.activate();
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-registration-survives-remount

      return existing;
    }
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-lifetime

    // Create child bridge
    const childBridge = new ChildMfeBridgeImpl(domainState.domain.id, extensionId);

    // Create parent bridge (concrete type for access to internal methods)
    const parentBridgeImpl = new ParentMfeBridgeImpl(childBridge);

    // Connect child to parent
    childBridge.setParentBridge(parentBridgeImpl);

    // Wire child action handler (internal wiring, not on public interface)
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-exec-chain
    parentBridgeImpl.onChildAction(executeActionsChain);

    // Wire registry's executeActionsChain to child bridge as capability pass-through
    childBridge.setExecuteActionsChainCallback(executeActionsChain);
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-exec-chain

    // Wire child domain forwarding callbacks.
    // The forwarding handler is registered as a catch-all because the parent
    // cannot enumerate the child domain's action types at registration time.
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-domain
    const registerChildDomainCallback = (domainId: string) => {
      const handler = new ChildDomainForwardingHandler(parentBridgeImpl, domainId);
      registerCatchAllActionHandler(domainId, handler);
    };

    const unregisterChildDomainCallback = (domainId: string) => {
      unregisterCatchAllActionHandler(domainId);
    };

    childBridge.setChildDomainCallbacks(registerChildDomainCallback, unregisterChildDomainCallback);
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-domain

    // Wire per-(extensionId, actionTypeId) handler registration.
    // The bridge captures extensionId and domainId from createBridge params.
    // domainId is required so the mediator can populate targetDomainMap, which
    // allows resolveTimeout() to find the domain's defaultActionTimeout for
    // extension-targeted actions. Wrapped in ActiveGuardActionHandler so an
    // invocation arriving while the bridge is inactive never reaches the
    // handler (`inst-fwd-reg-handler`).
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-handler
    childBridge.setRegisterActionHandlerCallback((actionTypeId, handler) => {
      registerExtensionActionHandler(
        extensionId,
        actionTypeId,
        new ActiveGuardActionHandler(childBridge, handler),
        domainState.domain.id
      );
    });
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p2:inst-fwd-reg-handler

    // Populate initial properties from domain state (raw values)
    for (const [propertyTypeId, rawValue] of domainState.properties) {
      parentBridgeImpl.receivePropertyUpdate(propertyTypeId, rawValue);
    }

    // Subscribe to domain property updates and track subscribers for cleanup
    for (const propertyTypeId of domainState.domain.sharedProperties) {
      if (!domainState.propertySubscribers.has(propertyTypeId)) {
        domainState.propertySubscribers.set(propertyTypeId, new Set());
      }
      const subscriber = (receivedPropertyTypeId: string, value: unknown) => {
        parentBridgeImpl.receivePropertyUpdate(receivedPropertyTypeId, value);
      };
      domainState.propertySubscribers.get(propertyTypeId)!.add(subscriber);

      // Track subscriber in parent bridge for cleanup on disposal
      parentBridgeImpl.registerPropertySubscriber(propertyTypeId, subscriber);
    }

    childBridge.activate();

    return { parentBridge: parentBridgeImpl, childBridge };
  }

  /**
   * Deactivate a bridge on unmount or mount failure. The pair is retained.
   *
   * @param parentBridge - Parent bridge to deactivate
   */
  deactivateBridge(parentBridge: ParentMfeBridge): void {
    // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-deactivation
    if (!(parentBridge instanceof ParentMfeBridgeImpl)) {
      throw new Error('deactivateBridge requires a ParentMfeBridgeImpl instance');
    }
    parentBridge.getChildBridge().deactivate();
    // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-deactivation
  }

  /**
   * Permanently tear down a bridge pair and clean up domain subscribers.
   * INTERNAL: Called only by `releaseExtension`, on the extension's
   * permanent unregistration.
   *
   * @param domainState - Domain state containing property subscribers
   * @param parentBridge - Parent bridge to dispose
   */
  destroyBridge(
    domainState: ExtensionDomainState,
    parentBridge: ParentMfeBridge
  ): void {
    // Access concrete type for internal methods
    if (!(parentBridge instanceof ParentMfeBridgeImpl)) {
      throw new Error('destroyBridge requires a ParentMfeBridgeImpl instance');
    }
    const impl = parentBridge;

    // Remove property subscribers from domain before disposing bridge
    const subscribers = impl.getPropertySubscribers();
    for (const [propertyTypeId, subscriber] of subscribers) {
      const domainSubscribers = domainState.propertySubscribers.get(propertyTypeId);
      if (domainSubscribers) {
        domainSubscribers.delete(subscriber);
      }
    }

    // Now dispose the bridge
    parentBridge.dispose();
  }
}
