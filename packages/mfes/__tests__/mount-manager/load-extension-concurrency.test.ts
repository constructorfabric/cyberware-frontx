/**
 * `DefaultMountManager.loadExtension` concurrency.
 *
 * Two concurrent mounts of the same never-mounted extension both observe
 * `mountState !== 'mounted'` and both call `loadExtension` before either has
 * finished loading (`default-mount-manager.ts`'s own `mountExtension`, line
 * ~200, awaits `loadExtension` unconditionally when `loadState !== 'loaded'`
 * -- it is not serialized the way the public `load_ext` action is via
 * `OperationSerializer`). Before the fix, the second concurrent caller's
 * `loadExtension` call returned immediately on seeing `loadState ===
 * 'loading'`, instead of awaiting the in-flight load -- letting the second
 * `mountExtension` proceed to mount before the handler's `load()` had
 * actually cached a lifecycle, which could throw "loadExtension should have
 * cached the lifecycle" or otherwise observe a half-loaded extension.
 *
 * All races below drive both concurrent `mounter.mount()` calls with the
 * SAME container object. `DefaultExtensionMounter.mount()` hard-throws when
 * a second concurrent call for the same extension id arrives with a
 * DIFFERENT container -- that is a caller-side bug (a real mount strategy
 * always supplies one `hooks.create()`-d container per logical mount, so two
 * different containers racing for the same never-mounted extension can only
 * mean the strategy's own bookkeeping is broken), not a scenario this layer
 * coalesces. See `DefaultExtensionMounter.ts`'s `inFlightMountsByExtension`
 * and `packages/mfes/src/runtime/__tests__/ExtensionMounter.test.ts`'s
 * "different containers: the second overlapping mount() call throws a hard
 * invariant error" for that dedicated coverage. What these tests are after
 * is the `loadExtension` load-dedup/load-race behavior underneath, which is
 * orthogonal to the container identity used to reach it.
 *
 * Domain/action ids here are a mock notation, never the real GTS strings --
 * MFES-1 forbids `@gears-frontx/mfes` from carrying a type-format literal.
 */
import { describe, it, expect } from 'vitest';
import { DefaultMfeRegistry } from '../../src/runtime/DefaultMfeRegistry';
import type { DefaultMountManager } from '../../src/runtime/default-mount-manager';
import type { TypeSystemPlugin } from '../../src/type-substrate';
import type { Extension, ExtensionDomain, MfeEntry } from '../../src/types';
import { MfeHandler, ChildMfeBridge, type MfeEntryLifecycle } from '../../src/handler/types';
import { MfeBridgeFactoryDefault } from '../../src/handler/mfe-bridge-factory-default';
import { ExtensionDomainImplementation } from '../../src/runtime/ExtensionDomainImplementation';
import { ExtensionDomainImplementationFactory } from '../../src/runtime/ExtensionDomainImplementationFactory';
import type { DomainContext } from '../../src/runtime/DomainContext';
import { ConcurrentMountStrategy } from '../../src/runtime/mount-strategies';
import type { ContainerHooks, ActionPayload } from '../../src/runtime/mount-strategy';
import { ActionHandler } from '../../src/mediator/types';

const LOAD_EXT = 'mock.action.v1~load_ext.v1~';
const MOUNT_EXT = 'mock.action.v1~mount_ext.v1~';
const UNMOUNT_EXT = 'mock.action.v1~unmount_ext.v1~';
const DOMAIN = 'domain.host.v1';
const EXT = 'ext.slow-load.v1';
const ENTRY = 'entry.slow-load.v1';

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

function makeDomain(id: string): ExtensionDomain {
  return {
    id,
    actions: [LOAD_EXT, MOUNT_EXT, UNMOUNT_EXT],
    extensionsActions: [],
    sharedProperties: [],
    defaultActionTimeout: 5000,
    lifecycleStages: [],
    extensionsLifecycleStages: [],
    extensionsTypeId: '',
  } as unknown as ExtensionDomain;
}

class GenericDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext) {
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
  }

  protected getMountStrategies() {
    return [this.strategy];
  }
}

class GenericDomainFactory extends ExtensionDomainImplementationFactory {
  build(ctx: DomainContext): GenericDomainImpl {
    return new GenericDomainImpl(ctx);
  }
}

function makeExtension(id: string, domain: string, entry: string): Extension {
  return { id, domain, entry, lifecycle: [] } as Extension;
}

function makeEntry(id: string): MfeEntry {
  return { id, requiredProperties: [], actions: [], domainActions: [] };
}

describe('DefaultMountManager.loadExtension concurrency', () => {
  it('calls the handler load() exactly once when two mounts race for the same never-mounted extension', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let loadCallCount = 0;
    let resolveLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    class SlowLoadHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        loadCallCount += 1;
        // Block here until the test explicitly releases it, so both
        // concurrent `mountExtension` calls are guaranteed to observe
        // `loadState === 'loading'` before either finishes.
        await loadGate;
        return {
          mount: () => {},
          unmount: () => {},
        };
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new SlowLoadHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    // Fire two concurrent mounts of the SAME extension, with the SAME
    // container (see the file-level note on why: a different container per
    // call is now a hard-throw invariant violation, orthogonal to what this
    // test verifies), before releasing the load gate -- both must see the
    // extension as not-yet-loaded and call into `loadExtension`.
    const container = document.createElement('div');
    const mountA = mounter.mount(EXT, container);
    const mountB = mounter.mount(EXT, container);

    // Give both calls a microtask/macrotask turn to reach `loadExtension`
    // and observe `loadState` before the handler's `load()` settles.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    resolveLoad();

    await expect(Promise.all([mountA, mountB])).resolves.toBeDefined();

    expect(loadCallCount).toBe(1);
  });

  it('resolves the second concurrent caller only after the load actually completes, with no premature resolution', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let loaded = false;
    let resolveLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    class SlowLoadHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        await loadGate;
        loaded = true;
        return {
          mount: () => {},
          unmount: () => {},
        };
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new SlowLoadHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    const container = document.createElement('div');
    const mountA = mounter.mount(EXT, container);
    await Promise.resolve();

    const secondCallerObservedLoadedBeforeSettling = { value: false };
    const mountB = mounter.mount(EXT, container).then(() => {
      secondCallerObservedLoadedBeforeSettling.value = loaded;
    });

    // Neither mount may settle while the load gate is still closed.
    let settledEarly = false;
    void Promise.all([mountA, mountB]).then(() => {
      settledEarly = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settledEarly).toBe(false);

    resolveLoad();
    await Promise.all([mountA, mountB]);

    expect(secondCallerObservedLoadedBeforeSettling.value).toBe(true);
  });

  it('leaves no stale entry in the in-flight-load map when the handler throws synchronously before its first await', async () => {
    // Promise `.finally()` callbacks are always scheduled as a microtask
    // continuation, which is strictly ordered after the synchronous code that
    // attaches them, regardless of whether the underlying promise is already
    // settled (e.g., from a synchronous throw). The code constructs the async
    // IIFE's promise and chains `.finally()` to it on one line, then calls
    // `.set()` on the very next line. Since the `.finally()` callback is
    // guaranteed to be scheduled as a microtask strictly after this
    // synchronous code completes, the `.set()` call always finishes before
    // the `.delete()` inside `.finally()` ever runs -- even if the IIFE's
    // body throws synchronously on its very first tick. This guarantees no
    // stale entry is left in the map.
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    const failure = new Error('synchronous failure before first await');

    class SyncThrowHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      // Intentionally NOT an `async` method: this throws synchronously, so
      // no `await` is ever reached by the caller of `load()`.
      load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        throw failure;
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new SyncThrowHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mountManager = (registry as unknown as { mountManager: DefaultMountManager }).mountManager;

    await expect(mountManager.loadExtension(EXT)).rejects.toBe(failure);

    const inFlight = (
      mountManager as unknown as { inFlightLoadsByExtension: Map<string, Promise<void>> }
    ).inFlightLoadsByExtension;
    expect(inFlight.has(EXT)).toBe(false);
  });

  it('rejects every concurrent loadExtension caller from the same failed attempt and leaves no stale in-flight entry behind', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let loadCallCount = 0;
    let resolveLoad!: () => void;
    let rejectLoad!: (error: unknown) => void;

    class FlakyThenSuccessfulHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        loadCallCount += 1;
        const attempt = loadCallCount;
        if (attempt === 1) {
          return new Promise<MfeEntryLifecycle<ChildMfeBridge>>((_resolve, reject) => {
            rejectLoad = reject;
          });
        }
        return new Promise<MfeEntryLifecycle<ChildMfeBridge>>((resolve) => {
          resolveLoad = () => resolve({ mount: () => {}, unmount: () => {} });
        });
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new FlakyThenSuccessfulHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    const raceContainer = document.createElement('div');
    const mountA = mounter.mount(EXT, raceContainer);
    const mountB = mounter.mount(EXT, raceContainer);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const failure = new Error('first load attempt failed');
    rejectLoad(failure);

    const [resultA, resultB] = await Promise.allSettled([mountA, mountB]);
    expect(resultA.status).toBe('rejected');
    expect(resultB.status).toBe('rejected');
    expect(loadCallCount).toBe(1);

    const raceTimeout = Symbol('timeout');
    const mountC = mounter.mount(EXT, document.createElement('div'));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadCallCount).toBe(2);

    resolveLoad();
    const outcome = await Promise.race([
      mountC.then(() => 'resolved' as const),
      new Promise((resolve) => setTimeout(() => resolve(raceTimeout), 50)),
    ]);
    expect(outcome).toBe('resolved');
  });
});

describe('DefaultMountManager.mountExtension concurrency', () => {
  it('calls the extension lifecycle mount() exactly once when two mounts race for the same never-mounted extension', async () => {
    const entries = new Map<string, MfeEntry>([[ENTRY, makeEntry(ENTRY)]]);
    const plugin = createMockPlugin(entries);

    let mountCallCount = 0;

    class CountingMountHandler extends MfeHandler {
      readonly bridgeFactory = new MfeBridgeFactoryDefault();

      constructor() {
        super(ENTRY);
      }

      async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
        return {
          mount: () => {
            mountCallCount += 1;
          },
          unmount: () => {},
        };
      }
    }

    const registry = new DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [new CountingMountHandler()],
    });

    registry.registerDomain(makeDomain(DOMAIN), new GenericDomainFactory());
    await registry.registerExtension(makeExtension(EXT, DOMAIN, ENTRY));

    const mounter = registry.getMounter(DOMAIN);
    mounter.attach(document.createElement('div'));

    const container = document.createElement('div');
    const mountA = mounter.mount(EXT, container);
    const mountB = mounter.mount(EXT, container);

    await Promise.all([mountA, mountB]);

    expect(mountCallCount).toBe(1);
  });
});

// The former "appends exactly one container ... when two mounts race" test
// here modeled two DIFFERENT containers racing for the same never-mounted
// extension and asserted the second was silently discarded in favor of the
// first. That premise is now itself the bug B fixes: a second concurrent
// `mount()` call for the same extension id with a different container is a
// hard invariant violation (see `DefaultExtensionMounter.mount`), not a
// coalescing race. The equivalent throw-behavior coverage lives in
// `packages/mfes/src/runtime/__tests__/ExtensionMounter.test.ts` under
// "different containers: the second overlapping mount() call throws a hard
// invariant error" -- no replacement test is added here to avoid duplicating
// it.
