// @cpt-flow:cpt-frontx-flow-mfe-host-communication-dispatch-chain:p1
/**
 * Parent MFE Bridge Implementation
 *
 * Used by the parent runtime to manage child MFE instances.
 * Connects to ChildMfeBridge for bidirectional communication.
 *
 * @packageDocumentation
 */

import { ParentMfeBridge } from '../handler/types';
import type { ActionsChain, SharedProperty } from '../types';
import type { ChildMfeBridgeImpl } from './ChildMfeBridge';
import { BridgeDisposedError, BridgeInactiveError } from './errors';

type PropertySubscriber = (propertyTypeId: string, value: unknown) => void;

/**
 * Internal implementation of ParentMfeBridge.
 * Used by the host to manage a child MFE instance.
 *
 * @internal
 */
export class ParentMfeBridgeImpl extends ParentMfeBridge {
  /**
   * Reference to the child bridge.
   */
  private readonly childBridge: ChildMfeBridgeImpl;

  /**
   * Handler for actions sent from child to parent.
   */
  private childActionHandler: ((chain: ActionsChain) => Promise<void>) | null = null;

  /**
   * Permanent-disposal state, delegated to the child bridge — the single
   * source of truth for both active/inactive and destroyed state
   * (`inst-bridge-lifetime`).
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-lifetime
  private get destroyed(): boolean {
    return this.childBridge.isDestroyed();
  }

  private get active(): boolean {
    return this.childBridge.isActive();
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-lifetime

  /**
   * Property update subscribers - tracks callbacks registered in domain.propertySubscribers.
   * Maps propertyTypeId to the subscriber callback, so we can remove them on disposal.
   * INTERNAL: Set by bridge factory during creation.
   */
  private readonly propertySubscribers = new Map<string, PropertySubscriber>();

  /**
   * The GTS id of the extension this bridge belongs to; stable across every
   * mount of that extension.
   */
  readonly instanceId: string;

  constructor(childBridge: ChildMfeBridgeImpl) {
    super();
    this.childBridge = childBridge;
    this.instanceId = childBridge.extensionId;
  }

  /**
   * INTERNAL: Access the child bridge this parent bridge wraps.
   */
  getChildBridge(): ChildMfeBridgeImpl {
    return this.childBridge;
  }

  /**
   * Send an actions chain to the child MFE.
   * Used by the host to send actions to the MFE.
   *
   * @param chain - Actions chain to send
   * @returns Promise resolving when execution is complete
   * @throws {BridgeDisposedError} If bridge has been permanently disposed
   * @throws {BridgeInactiveError} If the extension is registered but not currently mounted
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-parent-send-chain
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-deliver-to-child
  async sendActionsChain(chain: ActionsChain): Promise<void> {
    if (this.destroyed) {
      throw new BridgeDisposedError(this.instanceId);
    }
    if (!this.active) {
      throw new BridgeInactiveError(this.instanceId);
    }
    return this.childBridge.handleParentActionsChain(chain);
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-deliver-to-child
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-parent-send-chain

  /**
   * Register a handler for actions sent from the child MFE to the host.
   * This is called by MfeRegistry to connect the bridge to the mediator.
   *
   * @param callback - Handler for child actions
   * @throws {BridgeDisposedError} If bridge has been permanently disposed
   */
  onChildAction(callback: (chain: ActionsChain) => Promise<void>): void {
    if (this.destroyed) {
      throw new BridgeDisposedError(this.instanceId);
    }
    this.childActionHandler = callback;
  }

  /**
   * Called by MfeRegistry when a domain property is updated.
   * Forwards the update to the child bridge. Recorded on the child bridge
   * even while inactive, but its subscribers are only notified while active
   * (`ChildMfeBridgeImpl.receivePropertyUpdate`).
   *
   * @param propertyTypeId - Type ID of the property
   * @param value - New property value
   */
  receivePropertyUpdate(propertyTypeId: string, value: unknown): void {
    if (this.destroyed) {
      return; // Silently ignore updates after permanent disposal.
    }
    const sharedProperty: SharedProperty = { id: propertyTypeId, value };
    this.childBridge.receivePropertyUpdate(propertyTypeId, sharedProperty);
  }

  /**
   * Register a property subscriber that was added to domain.propertySubscribers.
   * INTERNAL: Called by bridge factory during setup.
   * Tracked so we can remove it from domain.propertySubscribers on disposal.
   *
   * @param propertyTypeId - Property type ID
   * @param subscriber - Subscriber callback
   */
  registerPropertySubscriber(
    propertyTypeId: string,
    subscriber: PropertySubscriber
  ): void {
    this.propertySubscribers.set(propertyTypeId, subscriber);
  }

  /**
   * Get all registered property subscribers for cleanup.
   * INTERNAL: Called by bridge factory during disposal to remove subscribers from domain.
   *
   * @returns Map of propertyTypeId to subscriber callbacks
   */
  getPropertySubscribers(): Map<string, PropertySubscriber> {
    return this.propertySubscribers;
  }

  /**
   * Permanent teardown, performed only when the extension this bridge
   * belongs to is unregistered — never on an ordinary unmount, which instead
   * goes through the runtime bridge factory's `deactivateBridge`.
   *
   * NOTE: This does NOT remove property subscribers from domain.propertySubscribers.
   * The bridge factory must handle that cleanup using getPropertySubscribers().
   */
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-parent-handle
  dispose(): void {
    if (this.destroyed) {
      return; // Idempotent
    }
    this.childActionHandler = null;
    this.propertySubscribers.clear();
    this.childBridge.destroy();
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-parent-handle

  /**
   * INTERNAL: Called by ChildMfeBridge.sendActionsChain.
   * Routes child actions to the registered handler (typically the mediator).
   *
   * @param chain - Actions chain from child
   * @returns Promise resolving when execution is complete
   */
  handleChildAction(chain: ActionsChain): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new BridgeDisposedError(this.instanceId));
    }
    if (!this.active) {
      return Promise.reject(new BridgeInactiveError(this.instanceId));
    }
    if (!this.childActionHandler) {
      return Promise.reject(new Error('No child action handler registered'));
    }
    return this.childActionHandler(chain);
  }
}
