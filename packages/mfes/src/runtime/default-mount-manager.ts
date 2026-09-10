/**
 * Default Mount Manager Implementation
 *
 * Concrete mount manager that handles MFE loading, mounting, and unmounting
 * with full lifecycle support.
 * Extracted from the legacy screensets package in Phase 7 (extension-domain governance).
 *
 * @packageDocumentation
 * @internal
 */
// @cpt-algo:cpt-frontx-algo-extension-domain-governance-mount-execution:p2
// @cpt-state:cpt-frontx-state-extension-domain-governance-admission:p1
// @cpt-dod:cpt-frontx-dod-extension-domain-governance-default-deny:p1

import type { ChildMfeBridge, MfeHandler, MfeMountContext, ParentMfeBridge } from '../handler/types';
import type { TypeSystemPlugin } from '../type-substrate';
import type { RuntimeCoordinator } from './coordination/types';
import type { ActionHandler } from '../mediator/types';
import type { ActionsChain } from '../types';
import { DefaultExtensionManager } from './default-extension-manager';
import type { MfeRegistry } from '../registry/MfeRegistry';
import { MountManager } from './mount-manager';
import type { ActionChainExecutor, LifecycleTrigger } from './mount-manager';
import { RuntimeBridgeFactory } from './runtime-bridge-factory';
import { createShadowRoot } from '../shadow';
import {
  popAmbientMountingBridge,
  pushAmbientMountingBridge,
  registerInboundBridgeLink,
  type InboundBridgeLink,
  type InboundBridgeRelink,
} from './inbound-bridge-link';

export type HandlerResolver = (entryTypeId: string) => MfeHandler | undefined;

export class DefaultMountManager extends MountManager {
  private readonly extensionManager: DefaultExtensionManager;
  private readonly resolveHandler: HandlerResolver;
  private readonly coordinator: RuntimeCoordinator;
  private readonly typeSystem: TypeSystemPlugin;
  private readonly triggerLifecycle: LifecycleTrigger;
  private readonly executeActionsChain: ActionChainExecutor;
  private readonly hostRuntime: MfeRegistry;
  private readonly registerCatchAllActionHandler: (domainId: string, handler: ActionHandler) => void;
  private readonly unregisterCatchAllActionHandler: (domainId: string) => void;
  private readonly registerExtensionActionHandler: (extensionId: string, actionTypeId: string, handler: ActionHandler, domainId: string) => void;
  private readonly unregisterExtensionActionHandler: (extensionId: string) => void;
  private readonly bridgeFactory: RuntimeBridgeFactory;
  private readonly buildInboundBridgeLink: (
    extensionId: string,
    childBridge: ChildMfeBridge,
    parentBridge: ParentMfeBridge
  ) => InboundBridgeLink;
  private readonly retractInboundBridgeLink: (childBridge: ChildMfeBridge) => void;

  /**
   * The `ChildMfeBridge` whose inbound link is currently registered for each
   * extension — set the first time an extension mounts, and deleted only by
   * `releaseExtension` (the extension's permanent unregistration). Distinct
   * from an extension's retained bridge pair on `ExtensionState`, which
   * outlives every individual mount/unmount cycle for the same reason: this
   * map tracks the one bridge object a descendant registry may have
   * propagated advertisements through, so `releaseExtension` can trigger
   * parent-owned retraction (`inst-retract-advertisements`) for it.
   */
  private readonly childBridgesByExtension = new Map<string, ChildMfeBridge>();

  /**
   * The re-link callback of whichever registry adopted the inbound-bridge
   * link of the CURRENT (or most recent) mount of each extension, keyed by
   * extension id — retained across unmount/remount cycles, not cleared on
   * retraction, and deleted only by `releaseExtension`. Since the link is
   * minted once at first mount and lives for the extension's whole
   * registration lifetime, this map is populated
   * once and never re-triggered on remount: only a FRESH adoption inside a
   * later mount's own window (a registry the author rebuilds rather than
   * reuses) ever supersedes it.
   */
  private readonly inboundAdoptersByExtension = new Map<string, readonly InboundBridgeRelink[]>();

  /**
   * The in-flight `loadExtension` promise for an extension currently in
   * `loadState === 'loading'`, keyed by extension id. A second concurrent
   * `loadExtension` call for the same extension awaits this promise instead
   * of returning immediately, so it observes the same completion (or
   * failure) as the original caller rather than resolving before the load
   * has actually finished.
   */
  private readonly inFlightLoadsByExtension = new Map<string, Promise<void>>();

  /**
   * The in-flight `mountExtension` promise for an extension currently in
   * `mountState === 'mounting'`, keyed by extension id. A second concurrent
   * `mountExtension` call for the same extension awaits this promise instead
   * of starting a second mount, so both callers observe the same mounted
   * bridge (or the same failure) rather than one racing past the other's
   * still-in-progress mount work.
   */
  private readonly inFlightMountsByExtension = new Map<string, Promise<ParentMfeBridge>>();

  constructor(config: {
    extensionManager: DefaultExtensionManager;
    resolveHandler: HandlerResolver;
    coordinator: RuntimeCoordinator;
    typeSystem: TypeSystemPlugin;
    triggerLifecycle: LifecycleTrigger;
    executeActionsChain: ActionChainExecutor;
    hostRuntime: MfeRegistry;
    registerCatchAllActionHandler: (domainId: string, handler: ActionHandler) => void;
    unregisterCatchAllActionHandler: (domainId: string) => void;
    registerExtensionActionHandler: (extensionId: string, actionTypeId: string, handler: ActionHandler, domainId: string) => void;
    unregisterExtensionActionHandler: (extensionId: string) => void;
    bridgeFactory: RuntimeBridgeFactory;
    buildInboundBridgeLink: (
      extensionId: string,
      childBridge: ChildMfeBridge,
      parentBridge: ParentMfeBridge
    ) => InboundBridgeLink;
    retractInboundBridgeLink: (childBridge: ChildMfeBridge) => void;
  }) {
    super();
    this.extensionManager = config.extensionManager;
    this.resolveHandler = config.resolveHandler;
    this.coordinator = config.coordinator;
    this.typeSystem = config.typeSystem;
    this.triggerLifecycle = config.triggerLifecycle;
    this.executeActionsChain = config.executeActionsChain;
    this.hostRuntime = config.hostRuntime;
    this.registerCatchAllActionHandler = config.registerCatchAllActionHandler;
    this.unregisterCatchAllActionHandler = config.unregisterCatchAllActionHandler;
    this.registerExtensionActionHandler = config.registerExtensionActionHandler;
    this.unregisterExtensionActionHandler = config.unregisterExtensionActionHandler;
    this.bridgeFactory = config.bridgeFactory;
    this.buildInboundBridgeLink = config.buildInboundBridgeLink;
    this.retractInboundBridgeLink = config.retractInboundBridgeLink;
  }

  async loadExtension(extensionId: string): Promise<void> {
    const extensionState = this.extensionManager.getExtensionState(extensionId);
    if (!extensionState) {
      throw new Error(
        `Cannot load extension '${extensionId}': extension is not registered. ` +
        `Call registerExtension() first.`
      );
    }

    if (extensionState.loadState === 'loaded') {
      return;
    }
    if (extensionState.loadState === 'loading') {
      const inFlight = this.inFlightLoadsByExtension.get(extensionId);
      if (inFlight) {
        return inFlight;
      }
      // Defensive fallback: `loadState` is 'loading' but no in-flight promise
      // is tracked (should not happen via this class's own code paths). Fall
      // through and start a fresh load rather than returning prematurely.
    }

    extensionState.loadState = 'loading';
    extensionState.error = undefined;

    // `.finally()`'s callback is always scheduled as a microtask
    // continuation of the async IIFE's own promise, which cannot run before
    // the synchronous `.set()` call below executes -- so there is no window
    // where a concurrent caller observing `loadState === 'loading'` would
    // fail to find a corresponding map entry.
    const loadPromise = (async (): Promise<void> => {
      try {
        const entry = extensionState.entry;
        const handler = this.resolveHandler(entry.id);
        if (!handler) {
          throw new Error(
            `No MFE handler registered that can handle entry type '${entry.id}'. ` +
            `Provide handlers via 'mfeHandlers' in MfeRegistryConfig.`
          );
        }

        const lifecycle = await handler.load(entry, extensionState.extension.id);
        extensionState.lifecycle = lifecycle;
        extensionState.loadState = 'loaded';
      } catch (error) {
        extensionState.loadState = 'error';
        extensionState.error = error instanceof Error ? error : new Error(String(error));
        throw error;
      }
    })().finally(() => {
      this.inFlightLoadsByExtension.delete(extensionId);
    });
    this.inFlightLoadsByExtension.set(extensionId, loadPromise);

    return loadPromise;
  }

  async preloadExtension(extensionId: string): Promise<void> {
    return this.loadExtension(extensionId);
  }

  // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t5
  async mountExtension(
    extensionId: string,
    container: Element
  ): Promise<ParentMfeBridge> {
    const extensionState = this.extensionManager.getExtensionState(extensionId);
    if (!extensionState) {
      throw new Error(
        `Cannot mount extension '${extensionId}': extension is not registered. ` +
        `Call registerExtension() first.`
      );
    }

    if (extensionState.mountState === 'mounted') {
      return extensionState.bridge!;
    }

    if (extensionState.mountState === 'mounting') {
      const inFlight = this.inFlightMountsByExtension.get(extensionId);
      if (inFlight) {
        return inFlight;
      }
      // Defensive fallback: `mountState` is 'mounting' but no in-flight
      // promise is tracked (should not happen via this class's own code
      // paths). Fall through and start a fresh mount rather than returning
      // prematurely.
    }

    extensionState.mountState = 'mounting';
    extensionState.error = undefined;

    // `.finally()`'s callback is always scheduled as a microtask
    // continuation of the async IIFE's own promise, which cannot run before
    // the synchronous `.set()` call below executes -- so there is no window
    // where a concurrent caller observing `mountState === 'mounting'` would
    // fail to find a corresponding map entry.
    const mountPromise = (async (): Promise<ParentMfeBridge> => {
      // Declared here (not inside the `try` below) so the `catch` can also
      // see whichever bridge was actually acquired before the failure, if
      // any.
      let acquiredParentBridge: ParentMfeBridge | undefined;

      try {
        if (extensionState.loadState !== 'loaded') {
          await this.loadExtension(extensionId);
        }

        const domainState = this.extensionManager.getDomainState(extensionState.extension.domain);
        if (!domainState) {
          throw new Error(
            `Cannot mount extension '${extensionId}': ` +
            `domain '${extensionState.extension.domain}' is not registered.`
          );
        }

        const entryDomainActions = extensionState.entry.domainActions;
        const existing =
          extensionState.bridge && extensionState.childBridge
            ? { parentBridge: extensionState.bridge, childBridge: extensionState.childBridge }
            : undefined;

        const { parentBridge, childBridge } = this.bridgeFactory.acquireBridge(
          domainState,
          extensionId,
          extensionState.entry.id,
          entryDomainActions,
          existing,
          (chain: ActionsChain) => this.executeActionsChain(chain),
          (domainId, handler) => this.registerCatchAllActionHandler(domainId, handler),
          (domainId) => this.unregisterCatchAllActionHandler(domainId),
          (extId, actionTypeId, handler, domainId) => this.registerExtensionActionHandler(extId, actionTypeId, handler, domainId),
          (extId) => this.unregisterExtensionActionHandler(extId)
        );
        acquiredParentBridge = parentBridge;

        extensionState.bridge = parentBridge;
        extensionState.childBridge = childBridge;

        const existingConnection = this.coordinator.get(container);
        if (existingConnection) {
          existingConnection.bridges.set(extensionId, parentBridge);
        } else {
          this.coordinator.register(container, {
            hostRuntime: this.hostRuntime,
            bridges: new Map([[extensionId, parentBridge]]),
          });
        }

        const hostElement = container as HTMLElement;
        const shadowRoot = createShadowRoot(hostElement);
        extensionState.shadowRoot = shadowRoot;

        const lifecycle = extensionState.lifecycle;
        if (!lifecycle) {
          throw new Error(
            `Cannot mount extension '${extensionId}': lifecycle not loaded. ` +
            `This should not happen - loadExtension should have cached the lifecycle.`
          );
        }
        const mountContext: MfeMountContext = {
          extensionId,
          domainId: extensionState.extension.domain,
        };

        // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-track-mounting-bridge
        // Prepare the link a nested registry constructed synchronously inside
        // this extension's own `mount()` body will automatically adopt, then
        // track `childBridge` as the ambient mounting bridge for exactly the
        // synchronous portion of the `lifecycle.mount(...)` invocation below —
        // no configuration or method call required from the microfrontend
        // author. Minted once, at first mount only: the link (and the bridge
        // it is attached to) lives for the extension's whole registration
        // lifetime.
        if (!this.childBridgesByExtension.has(extensionId)) {
          const link = this.buildInboundBridgeLink(extensionId, childBridge, parentBridge);
          registerInboundBridgeLink(childBridge, link);
          this.childBridgesByExtension.set(extensionId, childBridge);
        }

        pushAmbientMountingBridge(childBridge);
        let claimed: readonly InboundBridgeRelink[];
        let mountInvocation: void | Promise<void>;
        try {
          mountInvocation = lifecycle.mount(shadowRoot, childBridge, mountContext);
        } finally {
          claimed = popAmbientMountingBridge();
        }
        // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-track-mounting-bridge

        // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-relink-repropagate
        if (claimed.length > 0) {
          // A registry was constructed inside this window and adopted the
          // link itself (the ordinary fresh-registry-per-mount pattern, or a
          // registry rebuilt on a remount) — this supersedes whatever adopted
          // a previous mount of this same extension.
          const superseded = this.inboundAdoptersByExtension.get(extensionId);
          if (superseded) {
            for (const relink of superseded) {
              relink(null);
            }
          }
          this.inboundAdoptersByExtension.set(extensionId, claimed);
        }
        // else: no fresh adoption during this window — the previously
        // adopting registry (if any) still holds the SAME live link, since
        // the link is minted once at first mount and outlives every
        // individual mount/unmount cycle. Nothing to re-offer, nothing
        // to unlink.
        // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-relink-repropagate

        await mountInvocation;

        extensionState.container = container;
        extensionState.mountState = 'mounted';

        await this.triggerLifecycle(
          extensionId,
          this.typeSystem.resolveLifecycleStageActivatedId()
        );

        return parentBridge;
      } catch (error) {
        // @cpt-begin:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t6
        extensionState.mountState = 'error';
        extensionState.error = error instanceof Error ? error : new Error(String(error));
        // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t6

        // Mount-failure path: deactivate (not retract/destroy) the acquired
        // bridge — its advertisements, if any were propagated by a nested
        // registry constructed before the failure, stay recorded, and the
        // next mount attempt reactivates the same bridge.
        if (acquiredParentBridge) {
          this.bridgeFactory.deactivateBridge(acquiredParentBridge);
        }

        throw error;
      }
    })().finally(() => {
      this.inFlightMountsByExtension.delete(extensionId);
    });
    this.inFlightMountsByExtension.set(extensionId, mountPromise);

    return mountPromise;
  }
  // @cpt-end:cpt-frontx-state-extension-domain-governance-admission:p1:inst-adm-t5

  async unmountExtension(extensionId: string): Promise<void> {
    const extensionState = this.extensionManager.getExtensionState(extensionId);
    if (!extensionState) {
      return;
    }

    if (extensionState.mountState !== 'mounted') {
      return;
    }

    await this.triggerLifecycle(
      extensionId,
      this.typeSystem.resolveLifecycleStageDeactivatedId()
    );

    try {
      const lifecycle = extensionState.lifecycle;
      const container = extensionState.container;
      if (lifecycle && container) {
        const unmountTarget = extensionState.shadowRoot ?? container;
        await lifecycle.unmount(unmountTarget);
      }

      // Deactivate (not destroy) the bridge: every advertisement propagated
      // through it stays recorded, and every action-delivery path through it
      // now rejects explicitly until the next mount reactivates it
      // (`inst-bridge-deactivation`). Handler registrations and property
      // subscriptions made through the bridge are untouched.
      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-deactivation
      if (extensionState.bridge) {
        this.bridgeFactory.deactivateBridge(extensionState.bridge);
      }
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-bridge-delegation:p1:inst-bridge-deactivation

      if (container) {
        const connection = this.coordinator.get(container);
        if (connection) {
          connection.bridges.delete(extensionId);
          if (connection.bridges.size === 0) {
            this.coordinator.unregister(container);
          }
        }
      }

      extensionState.container = null;
      extensionState.mountState = 'unmounted';
      extensionState.error = undefined;
      extensionState.shadowRoot = undefined;
    } catch (error) {
      extensionState.mountState = 'error';
      extensionState.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements
  releaseExtension(extensionId: string): void {
    const childBridge = this.childBridgesByExtension.get(extensionId);
    if (childBridge) {
      this.retractInboundBridgeLink(childBridge);
      // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-unlink-on-retraction
      const adopters = this.inboundAdoptersByExtension.get(extensionId);
      if (adopters) {
        for (const relink of adopters) {
          relink(null);
        }
      }
      // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-unlink-on-retraction
    }

    const extensionState = this.extensionManager.getExtensionState(extensionId);
    if (extensionState?.bridge) {
      const domainState = this.extensionManager.getDomainState(extensionState.extension.domain);
      if (domainState) {
        this.bridgeFactory.destroyBridge(domainState, extensionState.bridge);
      }
    }

    try {
      this.unregisterExtensionActionHandler(extensionId);
    } catch (unregisterError) {
      console.error(
        `[MountManager] Failed to unregister extension action handler for '${extensionId}':`,
        unregisterError
      );
    }

    this.childBridgesByExtension.delete(extensionId);
    this.inboundAdoptersByExtension.delete(extensionId);

    if (extensionState) {
      extensionState.bridge = null;
      extensionState.childBridge = null;
    }
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements

  setTheme(_cssVars: Record<string, string>): void {
    // No-op: CSS custom properties inherit across Shadow DOM boundaries
  }
}
