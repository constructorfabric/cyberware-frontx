/**
 * MFE Handler Types
 *
 * Defines the abstract handler interface and related types for loading MFEs.
 * Handlers are responsible for loading MFE bundles and creating bridges.
 *
 * @packageDocumentation
 */
// @cpt-dod:cpt-frontx-dod-mfe-registry-handler-injection:p1
// @cpt-dod:cpt-frontx-dod-mfe-registry-type-contracts:p1
// @cpt-algo:cpt-frontx-algo-mfe-registry-handler-resolution:p1

import type { MfeEntry, ActionsChain, SharedProperty } from '../types';
import type { TypeSystemPlugin } from '../type-substrate';
import { ActionHandler } from '../mediator/types';

/**
 * Parent MFE Bridge abstract class.
 * Used by the parent runtime to manage child MFE instances.
 */
export abstract class ParentMfeBridge {
  /**
   * The GTS id of the extension this bridge belongs to; stable across every
   * mount of that extension.
   */
  abstract readonly instanceId: string;

  /**
   * Dispose the bridge and clean up resources. Permanent teardown, performed
   * only when the extension this bridge belongs to is unregistered — not on
   * an ordinary unmount.
   */
  abstract dispose(): void;
}

/**
 * Child MFE Bridge abstract class.
 * Provided to child MFEs for communication with the host.
 */
// @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-inbound-bridge-internal
export abstract class ChildMfeBridge {
  /** The GTS id of the domain the extension is mounted into. */
  abstract readonly extDomainId: string;
  /** The extension's own GTS id. */
  abstract readonly extensionId: string;

  /**
   * Execute an actions chain via the registry.
   * This is a capability pass-through -- the bridge delegates directly to
   * the registry's executeActionsChain(). This is the ONLY public API for
   * actions chain execution from child MFEs.
   *
   * Child MFEs should use this method to execute actions chains in the host
   * domain or target other domains.
   *
   * @param chain - Actions chain to execute
   * @returns Promise resolving when execution is complete
   */
  abstract executeActionsChain(chain: ActionsChain): Promise<void>;

  /**
   * Subscribe to a specific property's updates.
   *
   * @param propertyTypeId - Type ID of the property to subscribe to
   * @param callback - Callback invoked when property updates
   * @returns Unsubscribe function
   */
  abstract subscribeToProperty(propertyTypeId: string, callback: (value: SharedProperty) => void): () => void;

  /**
   * Get a property's current value synchronously.
   *
   * @param propertyTypeId - Type ID of the property to get
   * @returns Current property value, or undefined if not set
   */
  abstract getProperty(propertyTypeId: string): SharedProperty | undefined;

  /**
   * Register a handler for a specific action type on this MFE.
   * The MFE may call this once per action type it wants to handle.
   * The mediator routes extension-targeted actions by (extensionId, actionTypeId) pair.
   *
   * @param actionTypeId - The action type this handler handles
   * @param handler - The ActionHandler instance to invoke
   */
  abstract registerActionHandler(actionTypeId: string, handler: ActionHandler): void;
}
// @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-inbound-bridge-internal

/**
 * Runtime values supplied by the host at mount time.
 *
 * The runtime attaches identity metadata (`extensionId`, `domainId`) so child
 * lifecycles can understand their host context without learning runtime internals.
 */
export interface MfeMountContext {
  readonly extensionId?: string;
  readonly domainId?: string;
}

/**
 * MFE lifecycle interface.
 * All MFE entries must implement this interface.
 */
export interface MfeEntryLifecycle<TBridge = ChildMfeBridge> {
  /**
   * Mount the MFE to a DOM container.
   *
   * With the default handler (`MfeHandlerMF`), the `container` parameter will be
   * a `ShadowRoot` created by `DefaultMountManager`. With custom handlers, it may
   * be a plain `Element`. React's `createRoot()` accepts both types.
   *
   * The runtime treats this call's completion — synchronous return, or
   * resolution of a returned promise — as the extension's readiness signal:
   * `DefaultMountManager` awaits it before marking the extension mounted and
   * before a chain's `next` continuation may target it. A `mount()` that
   * returns before its own `registerActionHandler` calls have run (for
   * example a UI-framework binding that defers registration to an
   * asynchronous render/effect pass) makes those handlers unreachable to any
   * action dispatched immediately after — the mediator resolves a handler
   * once and does not retry. An implementation MUST NOT resolve until every
   * `registerActionHandler` call it intends to make synchronously as part of
   * this mount has completed.
   *
   * @param container - DOM element or shadow root to mount into
   * @param bridge - Bridge instance for communication with host
   * @param mountContext - Host-provided runtime context for this mount
   */
  mount(
    container: Element | ShadowRoot,
    bridge: TBridge,
    mountContext?: MfeMountContext
  ): void | Promise<void>;

  /**
   * Unmount the MFE from its container.
   *
   * With the default handler (`MfeHandlerMF`), the `container` parameter will be
   * a `ShadowRoot`. With custom handlers, it may be a plain `Element`.
   *
   * @param container - DOM element or shadow root to unmount from
   *
   * Action-handler registrations and property subscriptions made through the
   * bridge survive this call and are re-presented to the next `mount()` on
   * the same bridge instance; the runtime never clears them. An
   * implementation that binds subscribers or handlers to a UI-framework tree
   * torn down here MUST invoke the unsubscribe/unregister functions it
   * captured before returning. Failing to do so does not drop delivery — it
   * produces duplicate delivery, one copy into each detached tree, once the
   * next `mount()` subscribes again.
   */
  unmount(container: Element | ShadowRoot): void | Promise<void>;
}

/**
 * Abstract factory for creating bridge instances.
 * Different handlers can provide different bridge implementations.
 */
export abstract class MfeBridgeFactory<TBridge extends ChildMfeBridge = ChildMfeBridge> {
  /**
   * Create a bridge instance for an MFE.
   *
   * @param domainId - ID of the domain the MFE is mounted in
   * @param entryTypeId - Type ID of the MFE entry
   * @param instanceId - The extension's own GTS identifier (per
   *   `ChildMfeBridgeImpl`'s `(extDomainId, extensionId)` constructor), not a
   *   separately-minted instance id
   * @returns Bridge instance
   */
  abstract create(
    domainId: string,
    entryTypeId: string,
    instanceId: string
  ): TBridge;

  /**
   * Dispose a bridge and clean up resources.
   *
   * @param bridge - Bridge instance to dispose
   */
  abstract dispose(bridge: TBridge): void;
}

/**
 * Abstract MFE handler class.
 *
 * Handlers are responsible for:
 * - Loading MFE bundles
 * - Creating bridge instances
 *
 * Handler resolution (type hierarchy matching) stays with the registry, which
 * matches entries against `handledBaseTypeId` through its own TypeSystemPlugin.
 * The handler receives that same plugin at registration
 * ({@link MfeHandler.attachTypeSystem}) for a different job: resolving the
 * references its own load path owns — a manifest named by id rather than
 * carried inline — against what the type system holds.
 */
export abstract class MfeHandler<TEntry extends MfeEntry = MfeEntry, TBridge extends ChildMfeBridge = ChildMfeBridge> {
  /**
   * Bridge factory for creating bridge instances.
   */
  abstract readonly bridgeFactory: MfeBridgeFactory<TBridge>;

  /**
   * Base type ID that this handler can handle.
   * The registry matches entries using typeSystem.isTypeOf(entryTypeId, handledBaseTypeId).
   */
  readonly handledBaseTypeId: string;

  /**
   * Priority for handler selection.
   * Higher priority handlers are tried first.
   * Default: 0
   */
  readonly priority: number;

  /**
   * The registering registry's type system, or absent while the handler
   * belongs to no registry.
   *
   * Registration is the only channel: a handler is constructed by the host
   * application (`new MfeHandlerMF(entryBaseTypeId)`) long before any registry
   * exists, so it cannot be a constructor argument. A handler that is never
   * registered resolves references from its own state alone and refuses the
   * ones it cannot.
   */
  protected typeSystem?: TypeSystemPlugin;

  constructor(
    handledBaseTypeId: string,
    priority: number = 0
  ) {
    this.handledBaseTypeId = handledBaseTypeId;
    this.priority = priority;
  }

  /**
   * Receive the type system of the registry this handler is being registered
   * into. Called by the registry once per handler at registration.
   *
   * Implemented on the base class so every handler gains the plugin without
   * restating the wiring. A handler binds to one plugin for its lifetime:
   * re-attaching the same instance is a no-op, and a different one is refused
   * rather than swapped in. Subclass caches are keyed by extension or manifest
   * id alone, so a silent swap would let a load started under the first
   * registry be answered from a document the second plugin resolved.
   *
   * @param typeSystem - The registering registry's injected plugin
   * @throws Error if a different plugin is already attached
   */
  attachTypeSystem(typeSystem: TypeSystemPlugin): void {
    if (this.typeSystem && this.typeSystem !== typeSystem) {
      throw new Error(
        `MFE handler for base type '${this.handledBaseTypeId}' is already bound ` +
        'to a type system. One handler instance cannot be shared across ' +
        'registries - construct a separate handler for each registry.'
      );
    }
    this.typeSystem = typeSystem;
  }

  /**
   * Load an MFE bundle for a specific extension instance.
   *
   * `extensionId` is the cache key. Two extensions registered against the
   * same `entry` definition (sibling extensions sharing an `entry.id`) MUST
   * receive distinct loads — distinct blob URL chains and distinct module
   * evaluations — per ADR-0004 + ADR-0020 isolation invariant. Re-mount of
   * the same extension instance (same `extensionId`) MUST reuse the cached
   * load. Sibling isolation is the handler's responsibility, not the MFE
   * author's.
   *
   * @param entry - The entry to load
   * @param extensionId - The extension instance ID; cache key for the load
   * @returns Promise resolving to MFE lifecycle interface with ChildMfeBridge
   */
  abstract load(
    entry: TEntry,
    extensionId: string
  ): Promise<MfeEntryLifecycle<ChildMfeBridge>>;
}
