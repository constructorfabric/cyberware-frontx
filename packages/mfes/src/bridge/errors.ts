/**
 * Bridge Error Classes
 *
 * Error classes specific to ChildMfeBridge and ParentMfeBridge.
 *
 * @packageDocumentation
 */

/**
 * Error thrown when no actions chain handler is registered on a child bridge
 */
export class NoActionsChainHandlerError extends Error {
  readonly code = 'NO_ACTIONS_CHAIN_HANDLER';

  constructor(public readonly extensionId: string) {
    super(
      `No actions chain handler registered for extension '${extensionId}'. Child MFEs must call bridge.onActionsChain() to receive parent actions chains.`
    );
    this.name = 'NoActionsChainHandlerError';
  }
}

/**
 * Error thrown when attempting to use a permanently disposed bridge.
 */
export class BridgeDisposedError extends Error {
  readonly code = 'BRIDGE_DISPOSED';

  constructor(public readonly extensionId: string) {
    super(`Bridge has been disposed for extension '${extensionId}'`);
    this.name = 'BridgeDisposedError';
  }
}

/**
 * Error thrown when an action-delivery path crosses a bridge whose extension
 * is registered but not currently mounted (inactive), distinct from a
 * missing-handler failure and from permanent disposal.
 */
export class BridgeInactiveError extends Error {
  readonly code = 'BRIDGE_INACTIVE';

  constructor(public readonly extensionId: string) {
    super(`Extension '${extensionId}' is not currently mounted; its bridge is inactive.`);
    this.name = 'BridgeInactiveError';
  }
}
