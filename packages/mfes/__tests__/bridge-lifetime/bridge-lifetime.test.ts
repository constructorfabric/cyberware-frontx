/**
 * Bridge lifetime: one parent-child bridge pair created per extension at its
 * first mount, handed to every subsequent mount of that same extension as
 * the SAME object, and released only at that extension's permanent
 * unregistration (`inst-bridge-lifetime`). An ordinary unmount or a failed
 * mount only DEACTIVATES the pair — every action-delivery path through it
 * rejects explicitly with a target-inactive error, distinct from a
 * missing-handler failure, while handler registrations and property
 * subscriptions made through it survive untouched and resume the moment the
 * next mount reactivates it (`inst-bridge-deactivation`,
 * `inst-registration-survives-remount`).
 *
 * Domain/action ids here are a mock notation, never the real GTS strings —
 * MFES-1 forbids `@gears-frontx/mfes` from carrying a type-format literal.
 */
import { describe, it, expect, vi } from 'vitest';
import { DefaultMfeRegistry } from '../../src/runtime/DefaultMfeRegistry';
import type { ActionsChainsMediator } from '../../src/mediator/types';
import type { TypeSystemPlugin } from '../../src/type-substrate';
import type { ActionsChain, Extension, ExtensionDomain, MfeEntry } from '../../src/types';
import {
  MfeHandler,
  ChildMfeBridge,
  type MfeEntryLifecycle,
} from '../../src/handler/types';
import { MfeBridgeFactoryDefault } from '../../src/handler/mfe-bridge-factory-default';
import { ExtensionDomainImplementation } from '../../src/runtime/ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../../src/runtime/ExtensionDomainImplementationFactory';
import type { DomainContext } from '../../src/runtime/DomainContext';
import { ConcurrentMountStrategy } from '../../src/runtime/mount-strategies';
import type { ContainerHooks, ActionPayload } from '../../src/runtime/mount-strategy';
import { ActionHandler } from '../../src/mediator/types';

// ─── Mock-notation well-known action/domain/entry ids ──────────────────────

const LOAD_EXT = 'mock.action.v1~load_ext.v1~';
const MOUNT_EXT = 'mock.action.v1~mount_ext.v1~';
const UNMOUNT_EXT = 'mock.action.v1~unmount_ext.v1~';
const ACTION_PING = 'mock.action.v1~action_ping.v1~';
const ACTION_ROOT = 'mock.action.v1~action_root.v1~';
const PROP_ID = 'mock.prop.v1~counter.v1~';

const D0 = 'domain.host.v1';
const EXT = 'ext.bridge-lifetime.v1';
const ENTRY = 'entry.bridge-lifetime.v1';

function createMockPlugin(entries: Map<string, MfeEntry>): TypeSystemPlugin {
  return {
    name: 'MockPlugin',
    version: '1.0.0',
    registerSchema(): void {},
    getSchema(typeId: string): unknown {
      return entries.get(typeId);
    },
    register(): void {},
    isTypeOf(typeId: string, baseTypeId: string): boolean {
      return typeId === baseTypeId || typeId.startsWith(baseTypeId);
    },
    validateInstance() {
      return { valid: true, errors: [] };
    },
    resolveLoadExtActionId(): string {
      return LOAD_EXT;
    },
    resolveMountExtActionId(): string {
      return MOUNT_EXT;
    },
    resolveUnmountExtActionId(): string {
      return UNMOUNT_EXT;
    },
    resolveLifecycleStageInitId(): string {
      return 'mock.stage.v1~init.v1';
    },
    resolveLifecycleStageActivatedId(): string {
      return 'mock.stage.v1~activated.v1';
    },
    resolveLifecycleStageDeactivatedId(): string {
      return 'mock.stage.v1~deactivated.v1';
    },
    resolveLifecycleStageDestroyedId(): string {
      return 'mock.stage.v1~destroyed.v1';
    },
  };
}

class NoopHooks implements ContainerHooks {
  create(_extensionId: string): Element {
    return document.createElement('div');
  }
  destroy(_extensionId: string): void {}
}

function makeDomain(id: string, extraActions: string[] = [], sharedProperties: string[] = []): ExtensionDomain {
  return {
    id,
    actions: [LOAD_EXT, MOUNT_EXT, UNMOUNT_EXT, ...extraActions],
    extensionsActions: [],
    sharedProperties,
    defaultActionTimeout: 5000,
    lifecycleStages: [],
    extensionsLifecycleStages: [],
    extensionsTypeId: '',
  } as unknown as ExtensionDomain;
}

class GenericDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext, extraHandlers: ReadonlyArray<[string, ActionHandler]> = []) {
    super();
    const hooks = new NoopHooks();
    this.strategy = new ConcurrentMountStrategy(ctx.mounter, hooks);
    ctx.registerHandler(
      MOUNT_EXT,
      ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as ActionPayload))
    );
    ctx.registerHandler(
      UNMOUNT_EXT,
      ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as ActionPayload))
    );
    for (const [actionType, handler] of extraHandlers) {
      ctx.registerHandler(actionType, handler);
    }
  }

  protected getMountStrategies() {
    return [this.strategy];
  }
}

class GenericDomainFactory extends ExtensionDomainImplementationFactory {
  constructor(private readonly extraHandlers: ReadonlyArray<[string, ActionHandler]> = []) {
    super();
  }

  build(ctx: DomainContext): GenericDomainImpl {
    return new GenericDomainImpl(ctx, this.extraHandlers);
  }
}

function makeEntry(id: string, actions: string[] = []): MfeEntry {
  return { id, requiredProperties: [], actions, domainActions: [] };
}

function makeExtension(id: string, domain: string, entry: string): Extension {
  return { id, domain, entry, lifecycle: [] } as Extension;
}

function actionChain(type: string, target: string, extra: Partial<ActionsChain> = {}): ActionsChain {
  return { action: { type, target, payload: {} }, ...extra };
}

/** An `MfeHandler` whose `mount()`/`unmount()` bodies are fully controlled by the test. */
class ControlledHandler extends MfeHandler {
  readonly bridgeFactory = new MfeBridgeFactoryDefault();
  mountCount = 0;

  constructor(
    entryBaseTypeId: string,
    private readonly onMount: (bridge: ChildMfeBridge, mountCount: number) => void | Promise<void>,
    private readonly onUnmount?: () => void
  ) {
    super(entryBaseTypeId);
  }

  async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    return {
      mount: async (_container, bridge) => {
        this.mountCount += 1;
        await this.onMount(bridge, this.mountCount);
      },
      unmount: () => {
        this.onUnmount?.();
      },
    };
  }
}

async function setupHost(config: {
  onMount: (bridge: ChildMfeBridge, mountCount: number) => void | Promise<void>;
  onUnmount?: () => void;
  entryActions?: string[];
  sharedProperties?: string[];
  rootHandler?: ActionHandler;
}) {
  const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY, config.entryActions ?? [ACTION_PING])]]);
  const plugin = createMockPlugin(entries);
  const handler = new ControlledHandler(ENTRY, config.onMount, config.onUnmount);

  const registry = new DefaultMfeRegistry({
    typeSystem: plugin,
    mfeHandlers: [handler],
  });

  registry.registerDomain(
    makeDomain(D0, config.rootHandler ? [ACTION_ROOT] : [], config.sharedProperties ?? [PROP_ID]),
    new GenericDomainFactory(
      config.rootHandler ? [[ACTION_ROOT, config.rootHandler]] : []
    )
  );

  await registry.registerExtension(makeExtension(EXT, D0, ENTRY));
  const mounter = registry.getMounter(D0);
  mounter.attach(document.createElement('div'));

  return { registry, mounter, handler };
}

describe('Bridge lifetime: one pair per extension, reactivated (not recreated) across mount cycles', () => {
  it('(1) the SAME bridge object is handed to mount() across 3 mount cycles', async () => {
    const bridges: ChildMfeBridge[] = [];
    const { mounter } = await setupHost({
      onMount: (bridge) => { bridges.push(bridge); },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    expect(bridges).toHaveLength(3);
    expect(bridges[0]).toBe(bridges[1]);
    expect(bridges[1]).toBe(bridges[2]);
  });

  it('(2) extensionId and extDomainId are identical (the extension\'s and domain\'s own GTS ids) across every mount', async () => {
    const bridges: ChildMfeBridge[] = [];
    const { mounter } = await setupHost({
      onMount: (bridge) => { bridges.push(bridge); },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    expect(bridges).toHaveLength(2);
    for (const bridge of bridges) {
      expect(bridge.extensionId).toBe(EXT);
      expect(bridge.extDomainId).toBe(D0);
    }
  });

  it('(3) the bridge is destroyed only by permanent unregistration, never by an ordinary unmount', async () => {
    let capturedBridge: ChildMfeBridge | undefined;
    const { registry, mounter } = await setupHost({
      onMount: (bridge) => { capturedBridge = bridge; },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);

    // Unmount alone does not destroy — inactive, not disposed.
    await expect(capturedBridge!.executeActionsChain(actionChain(ACTION_PING, EXT))).rejects.toMatchObject({
      code: 'BRIDGE_INACTIVE',
    });

    await registry.unregisterExtension(EXT);

    // Permanent unregistration destroys the bridge.
    await expect(capturedBridge!.executeActionsChain(actionChain(ACTION_PING, EXT))).rejects.toMatchObject({
      code: 'BRIDGE_DISPOSED',
    });
  });

  it('(4) regression lock: unmount never calls unregisterAllHandlers; unregisterExtension calls it exactly once', async () => {
    const { registry, mounter } = await setupHost({
      onMount: (bridge) => {
        bridge.registerActionHandler(ACTION_PING, ActionHandler.fromFunction(async () => {}));
      },
    });

    const mediator = (registry as unknown as { mediator: ActionsChainsMediator }).mediator;
    const unregisterAllSpy = vi.spyOn(mediator, 'unregisterAllHandlers');

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    expect(unregisterAllSpy).not.toHaveBeenCalled();

    await mounter.mount(EXT, document.createElement('div'));
    await registry.unregisterExtension(EXT);
    expect(unregisterAllSpy).toHaveBeenCalledTimes(1);
    expect(unregisterAllSpy).toHaveBeenCalledWith(EXT);
  });

  it('(5) dispatch to an unmounted extension with a fallback: the handler is never invoked, the fallback runs exactly once, and the chain completes', async () => {
    const pingCounter = { count: 0 };
    const rootCounter = { count: 0 };
    const { registry, mounter } = await setupHost({
      onMount: (bridge) => {
        bridge.registerActionHandler(
          ACTION_PING,
          ActionHandler.fromFunction(async () => { pingCounter.count += 1; })
        );
      },
      rootHandler: ActionHandler.fromFunction(async () => { rootCounter.count += 1; }),
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);

    const result = await (registry as unknown as {
      mediator: ActionsChainsMediator;
    }).mediator.executeActionsChain(
      actionChain(ACTION_PING, EXT, { fallback: actionChain(ACTION_ROOT, D0) })
    );

    expect(pingCounter.count).toBe(0);
    expect(rootCounter.count).toBe(1);
    expect(result.completed).toBe(true);
  });

  it('(6) dispatch to an unmounted extension with NO fallback: the chain does not complete and the error is BRIDGE_INACTIVE', async () => {
    const pingCounter = { count: 0 };
    const { registry, mounter } = await setupHost({
      onMount: (bridge) => {
        bridge.registerActionHandler(
          ACTION_PING,
          ActionHandler.fromFunction(async () => { pingCounter.count += 1; })
        );
      },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);

    const result = await (registry as unknown as {
      mediator: ActionsChainsMediator;
    }).mediator.executeActionsChain(actionChain(ACTION_PING, EXT));

    expect(pingCounter.count).toBe(0);
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBeFalsy();
  });

  it('(7) a forwarding entry into an unmounted host\'s nested subtree is rejected as inactive, so the fallback fires', async () => {
    const NESTED_ENTRY = 'entry.bridge-lifetime-nested.v1';
    const NESTED_EXT = 'ext.bridge-lifetime-nested.v1';
    const D_NESTED = 'domain.bridge-lifetime-nested.v1';
    const ACTION_NESTED_LEAF = 'mock.action.v1~action_nested_leaf.v1~';

    const entries = new Map<string, MfeEntry>([[NESTED_ENTRY, makeEntry(NESTED_ENTRY)]]);
    const plugin = createMockPlugin(entries);
    const rootCounter = { count: 0 };
    const leafCounter = { count: 0 };

    let nestedRegistry: DefaultMfeRegistry | undefined;
    const nestedHandler = new ControlledHandler(NESTED_ENTRY, (_bridge) => {
      nestedRegistry = new DefaultMfeRegistry({ typeSystem: plugin });
      nestedRegistry.registerDomain(
        makeDomain(D_NESTED, [ACTION_NESTED_LEAF]),
        new GenericDomainFactory([
          [ACTION_NESTED_LEAF, ActionHandler.fromFunction(async () => { leafCounter.count += 1; })],
        ])
      );
    });

    const registry0 = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [nestedHandler],
    });
    registry0.registerDomain(
      makeDomain(D0, [ACTION_ROOT]),
      new GenericDomainFactory([
        [ACTION_ROOT, ActionHandler.fromFunction(async () => { rootCounter.count += 1; })],
      ])
    );

    await registry0.registerExtension(makeExtension(NESTED_EXT, D0, NESTED_ENTRY));
    const mounter0 = registry0.getMounter(D0);
    mounter0.attach(document.createElement('div'));
    await mounter0.mount(NESTED_EXT, document.createElement('div'));
    expect(nestedRegistry).toBeDefined();

    // Ordinary unmount of the HOST extension: registry1's own advertisement
    // for D_NESTED stays recorded at the shell, but the bridge it travels
    // through is now inactive.
    await mounter0.unmount(NESTED_EXT);

    const chain: ActionsChain = {
      action: { type: ACTION_NESTED_LEAF, target: D_NESTED, payload: {} },
      fallback: actionChain(ACTION_ROOT, D0),
    };
    await registry0.executeActionsChain(chain);

    expect(leafCounter.count).toBe(0);
    expect(rootCounter.count).toBe(1);
  });

  it('(8) after remount, dispatch reaches the handler again and the fallback no longer fires', async () => {
    const pingCounter = { count: 0 };
    const rootCounter = { count: 0 };
    const { registry, mounter } = await setupHost({
      onMount: (bridge) => {
        bridge.registerActionHandler(
          ACTION_PING,
          ActionHandler.fromFunction(async () => { pingCounter.count += 1; })
        );
      },
      rootHandler: ActionHandler.fromFunction(async () => { rootCounter.count += 1; }),
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    await registry.executeActionsChain(
      actionChain(ACTION_PING, EXT, { fallback: actionChain(ACTION_ROOT, D0) })
    );

    expect(pingCounter.count).toBe(1);
    expect(rootCounter.count).toBe(0);
  });

  it('(9) a handler registered at mount 1 is invoked after unmount + remount, with no re-registration', async () => {
    const pingCounter = { count: 0 };
    const { registry, mounter } = await setupHost({
      onMount: (bridge, mountCount) => {
        if (mountCount === 1) {
          bridge.registerActionHandler(
            ACTION_PING,
            ActionHandler.fromFunction(async () => { pingCounter.count += 1; })
          );
        }
        // On mount 2+, deliberately do NOT re-register.
      },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    await registry.executeActionsChain(actionChain(ACTION_PING, EXT));

    expect(pingCounter.count).toBe(1);
  });

  it('(10) a property subscription made at mount 1 fires after remount, with no re-subscription', async () => {
    const received: unknown[] = [];
    const { registry, mounter } = await setupHost({
      onMount: (bridge, mountCount) => {
        if (mountCount === 1) {
          bridge.subscribeToProperty(PROP_ID, (value) => { received.push(value.value); });
        }
      },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    registry.updateSharedProperty(PROP_ID, 'after-remount');

    expect(received).toEqual(['after-remount']);
  });

  it('(11) property updates delivered while unmounted do not invoke subscribers, but getProperty() is correct once remounted', async () => {
    const received: unknown[] = [];
    let capturedBridge: ChildMfeBridge | undefined;
    const { registry, mounter } = await setupHost({
      onMount: (bridge, mountCount) => {
        capturedBridge = bridge;
        if (mountCount === 1) {
          bridge.subscribeToProperty(PROP_ID, (value) => { received.push(value.value); });
        }
      },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);

    registry.updateSharedProperty(PROP_ID, 'while-inactive');
    expect(received).toEqual([]);

    await mounter.mount(EXT, document.createElement('div'));

    // Recorded even while inactive, readable synchronously via getProperty()
    // once the bridge reactivates — no replay to subscribers, though.
    expect(capturedBridge!.getProperty(PROP_ID)?.value).toBe('while-inactive');
    expect(received).toEqual([]);
  });

  it('(12) NO DOUBLE-DELIVERY on remount: a single update after remount invokes each surviving subscriber exactly once', async () => {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const { registry, mounter } = await setupHost({
      onMount: (bridge, mountCount) => {
        if (mountCount === 1) {
          bridge.subscribeToProperty(PROP_ID, (value) => { receivedA.push(value.value); });
          bridge.subscribeToProperty(PROP_ID, (value) => { receivedB.push(value.value); });
        }
      },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    registry.updateSharedProperty(PROP_ID, 'once-only');

    expect(receivedA).toEqual(['once-only']);
    expect(receivedB).toEqual(['once-only']);
  });

  it('(13) an MFE that unsubscribes from its own unmount() hook stops receiving updates until it re-subscribes', async () => {
    const received: unknown[] = [];
    let capturedUnsubscribe: (() => void) | undefined;
    const { registry, mounter } = await setupHost({
      onMount: (bridge, mountCount) => {
        if (mountCount === 1) {
          capturedUnsubscribe = bridge.subscribeToProperty(PROP_ID, (value) => { received.push(value.value); });
        }
      },
      onUnmount: () => {
        capturedUnsubscribe?.();
      },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    registry.updateSharedProperty(PROP_ID, 'after-self-unsubscribe');
    expect(received).toEqual([]);
  });

  it('(14) an MFE that re-subscribes every mount WITHOUT unsubscribing receives duplicate deliveries (documented footgun)', async () => {
    const received: unknown[] = [];
    const { registry, mounter } = await setupHost({
      onMount: (bridge) => {
        // Deliberately never captures/calls the returned unsubscribe.
        bridge.subscribeToProperty(PROP_ID, (value) => { received.push(value.value); });
      },
    });

    await mounter.mount(EXT, document.createElement('div'));
    await mounter.unmount(EXT);
    await mounter.mount(EXT, document.createElement('div'));

    registry.updateSharedProperty(PROP_ID, 'duplicated');

    // Two live subscriptions to the same callback shape now both fire.
    expect(received).toEqual(['duplicated', 'duplicated']);
  });
});
