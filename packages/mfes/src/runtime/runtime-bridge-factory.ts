/**
 * Runtime Bridge Factory
 *
 * Abstract runtime bridge factory — contract for internal bridge wiring.
 * Extracted from the legacy screensets package in Phase 7 (extension-domain governance).
 *
 * This is NOT the same as MfeBridgeFactory in handler/types.ts, which is
 * a public abstraction for custom handler bridge implementations.
 *
 * @packageDocumentation
 * @internal
 */

import type { ParentMfeBridge, ChildMfeBridge } from '../handler/types';
import type { ExtensionDomainState } from './extension-manager';
import type { ActionsChain } from '../types';
import type { ActionHandler } from '../mediator/types';

export abstract class RuntimeBridgeFactory {
  /**
   * Acquire the bridge pair for an extension's mount. When `existing` is
   * `undefined`, mints a brand-new pair (the extension's first mount). When
   * `existing` is provided (a remount of an already-mounted-before
   * extension), re-wires the transport callbacks onto the SAME bridge pair
   * and reactivates it — never re-subscribing to domain property updates,
   * never replaying property values, never touching handler registrations
   * or child-domain state, which all survive deactivation untouched.
   */
  abstract acquireBridge(
    domainState: ExtensionDomainState,
    extensionId: string,
    entryTypeId: string,
    domainActions: readonly string[],
    existing: { parentBridge: ParentMfeBridge; childBridge: ChildMfeBridge } | undefined,
    executeActionsChain: (chain: ActionsChain) => Promise<void>,
    registerCatchAllActionHandler: (domainId: string, handler: ActionHandler) => void,
    unregisterCatchAllActionHandler: (domainId: string) => void,
    registerExtensionActionHandler: (extensionId: string, actionTypeId: string, handler: ActionHandler, domainId: string) => void,
    unregisterExtensionActionHandler: (extensionId: string) => void
  ): { parentBridge: ParentMfeBridge; childBridge: ChildMfeBridge };

  /**
   * Deactivate a bridge on unmount or mount failure. The pair is retained —
   * handler registrations and property subscriptions survive — but every
   * action-delivery path through it is explicitly rejected until the next
   * `acquireBridge` reactivates it.
   */
  abstract deactivateBridge(parentBridge: ParentMfeBridge): void;

  /**
   * Permanently tear down a bridge pair. Called only when the extension the
   * bridge belongs to is unregistered.
   */
  abstract destroyBridge(
    domainState: ExtensionDomainState,
    parentBridge: ParentMfeBridge
  ): void;
}
