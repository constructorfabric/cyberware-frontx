/**
 * Actions Chains Mediator Types
 *
 * Defines the abstract mediator interface for action chain execution.
 * This follows FrontX's SOLID OOP pattern: abstract class (exportable contract)
 * + concrete implementation (private).
 *
 * @packageDocumentation
 */

import type { TypeSystemPlugin } from '../type-substrate';
import type { ActionsChain } from '../types';

/**
 * Result of action chain execution.
 */
export interface ChainResult {
  /** Whether the chain completed successfully */
  completed: boolean;
  /** Array of action type IDs that were executed */
  path: string[];
  /** Whether the chain timed out */
  timedOut?: boolean;
  /** Total execution time in milliseconds */
  executionTime?: number;
}

/**
 * Per-request execution options (chain-level only)
 *
 * NOTE: Action-level timeouts are defined in:
 * - ExtensionDomain.defaultActionTimeout (required)
 * - Action.timeout (optional override)
 *
 * Timeout is treated as a failure - the ActionsChain.fallback handles all failures uniformly.
 */
export interface ChainExecutionOptions {
  /**
   * Override chain timeout for this execution (ms)
   * This limits the total time for the entire chain execution.
   */
  chainTimeout?: number;
}

/**
 * Abstract base class for receiving a single action.
 *
 * Both domain-side lifecycle handlers and extension-side custom handlers extend this class.
 * Registered per (targetId, actionTypeId) pair via ActionsChainsMediator.registerHandler().
 *
 * Each handler is a small class that encapsulates one action type's behavior,
 * consistent with the project's class-based OOP contract.
 */
export abstract class ActionHandler {
  /**
   * Handle an action invocation.
   *
   * @param actionTypeId - The type ID of the action
   * @param payload - The action payload
   * @returns Promise that resolves when action is handled
   */
  abstract handleAction(

    actionTypeId: string,

    payload: Record<string, unknown> | undefined

  ): Promise<void>;

  /**
   * Create an `ActionHandler` instance from a plain async function.
   *
   * Convenience wrapper for one-off handlers — strategies use this inside
   * `ExtensionDomainImplementationFactory.build(ctx)` to push mount/unmount
   * handlers via `ctx.registerHandler` without writing a full subclass.
   *
   * @param fn - Async function `(actionTypeId, payload) => Promise<void>`.
   * @returns An `ActionHandler` instance that delegates to `fn`.
   *
   * @example
   * ```typescript
   * ctx.registerHandler(ctx.typeSystem.resolveMountExtActionId(),
   *   ActionHandler.fromFunction((_t, p) => strategy.mount(p as ActionPayload)));
   * ```
   */
  static fromFunction(
    fn: (actionTypeId: string, payload: Record<string, unknown> | undefined) => Promise<void>
  ): ActionHandler {
    return new FunctionActionHandler(fn);
  }
}

/**
 * Private concrete handler created by `ActionHandler.fromFunction`.
 * Not exported — consumers use the static helper method.
 *
 * @internal
 */
class FunctionActionHandler extends ActionHandler {
  constructor(
    private readonly fn: (
      actionTypeId: string,
      payload: Record<string, unknown> | undefined
    ) => Promise<void>
  ) {
    super();
  }

  handleAction(
    actionTypeId: string,
    payload: Record<string, unknown> | undefined
  ): Promise<void> {
    return this.fn(actionTypeId, payload);
  }
}

/**
 * Abstract mediator for action chain execution.
 *
 * This is the exportable abstraction that defines the contract for
 * action chain mediation. Concrete implementations encapsulate the
 * actual execution logic, handler registration, and timeout handling.
 *
 * Handlers are registered per (targetId, actionTypeId) pair using registerHandler().
 * Both domain-side lifecycle handlers and extension-side custom handlers use the
 * same registration path.
 *
 * Key Responsibilities:
 * - Execute action chains with success/failure branching
 * - Validate actions against target contracts
 * - Manage action handlers (unified per-action-type registration)
 * - Handle timeouts with fallback execution
 *
 * Key Benefits:
 * - Dependency Inversion: MfeRegistry depends on abstraction, not concrete implementation
 * - Testability: Can inject mock mediators for testing
 * - Encapsulation: Execution logic is hidden in concrete class
 */
export abstract class ActionsChainsMediator {
  /**
   * The Type System plugin used by this mediator.
   */
  abstract readonly typeSystem: TypeSystemPlugin;

  /**
   * Execute an action chain, routing to targets and handling success/failure branching.
   *
   * @param chain - The actions chain to execute
   * @param options - Optional per-request execution options (override defaults)
   * @returns Promise resolving to chain result
   */
  abstract executeActionsChain(
    chain: ActionsChain,
    options?: ChainExecutionOptions
  ): Promise<ChainResult>;

  /**
   * Register a handler for a specific (targetId, actionTypeId) pair.
   *
   * Both domain-side and extension-side handlers use this method.
   * For extension targets, pass domainId so the mediator can resolve
   * the domain's defaultActionTimeout when the action has no explicit timeout.
   *
   * @param targetId - ID of the target (domain or extension)
   * @param actionTypeId - The action type this handler handles
   * @param handler - ActionHandler instance to invoke
   * @param domainId - Optional domain ID (required for extension targets)
   */
  abstract registerHandler(
    targetId: string,
    actionTypeId: string,
    handler: ActionHandler,
    domainId?: string
  ): void;

  /**
   * Unregister a handler for a specific (targetId, actionTypeId) pair.
   *
   * @param targetId - ID of the target
   * @param actionTypeId - The action type to unregister
   */
  abstract unregisterHandler(targetId: string, actionTypeId: string): void;

  /**
   * Unregister all handlers for a target.
   * Used during dispose (e.g., when an extension is unmounted).
   *
   * @param targetId - ID of the target
   */
  abstract unregisterAllHandlers(targetId: string): void;

  /**
   * Register a catch-all handler for a target.
   * The catch-all handler is invoked for any action type when no specific handler
   * is registered for the (targetId, actionTypeId) pair.
   *
   * Used exclusively for child domain forwarding via bridge transport — the parent
   * mediator cannot know the child's action types at registration time.
   *
   * @param targetId - ID of the target
   * @param handler - Handler to invoke for any unmatched action type
   */
  abstract registerCatchAllHandler(targetId: string, handler: ActionHandler): void;

  /**
   * Unregister a catch-all handler for a target.
   *
   * @param targetId - ID of the target
   */
  abstract unregisterCatchAllHandler(targetId: string): void;
}
