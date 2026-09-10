/**
 * Cross-nesting reachability across TWO independently loaded copies of this
 * package (not one shared module graph).
 *
 * Per `cpt-frontx-adr-mfe-load-isolation`, a mounted extension may evaluate
 * its own independently loaded copy of `@gears-frontx/mfes` — including the
 * realm-global rendezvous machinery this feature depends on
 * (`inst-track-mounting-bridge`, `inst-adopt-ambient-bridge`) and the
 * arrival-edge WeakMap used for loop containment (`inst-tag-arrival-edge`).
 * The single-module-graph suite (`cross-nesting-reachability.test.ts`)
 * exercises the OBSERVABLE behavior this feature promises, but it cannot
 * exercise the one thing most likely to silently regress: whether that
 * behavior actually survives the module-instance boundary, since a shared
 * import trivially "passes" even a module-scoped WeakMap/stack design that
 * is fundamentally broken across copies.
 *
 * This suite obtains two GENUINELY SEPARATE module instances of the package
 * via `vi.resetModules()` + two distinct batches of dynamic `import()` calls
 * — copy A hosts the shell registry, copy B hosts the nested registry — and
 * verifies that inbound-bridge adoption, downward forwarding, upward
 * escalation, arrival-edge loop containment, the collision guard, and
 * parent-owned retraction all hold across that boundary. No code under test
 * is changed for this suite; it exercises the same public/internal surface
 * as the single-graph suite, just wired through two copies.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TypeSystemPlugin } from '../../src/type-substrate';
import type {
  ActionsChain,
  Extension,
  ExtensionDomain,
  MfeEntry,
} from '../../src/types';
import type {
  ChildMfeBridge,
  MfeEntryLifecycle,
} from '../../src/handler/types';
import type { DomainContext } from '../../src/runtime/DomainContext';
import type { ContainerHooks, ActionPayload } from '../../src/runtime/mount-strategy';

// ─── Mock-notation well-known action ids (never real GTS strings — MFES-1) ──

const LOAD_EXT = 'mock.action.v1~load_ext.v1~';
const MOUNT_EXT = 'mock.action.v1~mount_ext.v1~';
const UNMOUNT_EXT = 'mock.action.v1~unmount_ext.v1~';
const ACTION_ROOT = 'mock.action.v1~action_root.v1~';
const ACTION_LEAF = 'mock.action.v1~action_leaf.v1~';
const ACTION_HANG = 'mock.action.v1~action_hang.v1~';
const ACTION_COLLIDE = 'mock.action.v1~action_collide.v1~';
const ACTION_UNRESOLVABLE = 'mock.action.v1~action_unresolvable.v1~';

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

function makeDomain(id: string, extraActions: string[] = []): ExtensionDomain {
  return {
    id,
    actions: [LOAD_EXT, MOUNT_EXT, UNMOUNT_EXT, ...extraActions],
    extensionsActions: [],
    sharedProperties: [],
    defaultActionTimeout: 5000,
    lifecycleStages: [],
    extensionsLifecycleStages: [],
    extensionsTypeId: '',
  } as unknown as ExtensionDomain;
}

function makeEntry(id: string): MfeEntry {
  return { id, requiredProperties: [], actions: [], domainActions: [] };
}

function makeExtension(id: string, domain: string, entry: string): Extension {
  return { id, domain, entry, lifecycle: [] } as Extension;
}

function actionChain(type: string, target: string): ActionsChain {
  return { action: { type, target, payload: {} } };
}

// ─── Loading a genuinely separate module copy ──────────────────────────────

/**
 * Imports the full set of runtime pieces this harness needs, all from the
 * SAME module-registry generation (no `vi.resetModules()` between these
 * `import()` calls) — so within one call to `loadCopy()`, every import below
 * resolves against one internally-consistent module graph, including
 * whatever `DefaultMfeRegistry.ts` itself transitively imports (e.g.
 * `ConcurrentMountStrategy` from `./mount-strategies`, the realm-global
 * rendezvous helpers from `./inbound-bridge-link`).
 *
 * Calling this twice, with `vi.resetModules()` in between, is what makes the
 * two calls' results genuinely distinct copies rather than the same cached
 * modules: `vi.resetModules()` clears vitest's module registry so the next
 * `import()` of an already-seen specifier re-evaluates the module from
 * scratch, producing new class objects with no shared identity to the first
 * copy's — while `globalThis` (unaffected by `vi.resetModules()`) is exactly
 * the one thing both copies still share, which is the entire premise the
 * realm-global rendezvous mechanism depends on.
 */
async function loadCopy() {
  const [
    registryModule,
    handlerTypesModule,
    bridgeFactoryModule,
    domainImplModule,
    domainImplFactoryModule,
    mountStrategiesModule,
    mediatorTypesModule,
    parentBridgeModule,
    bridgeErrorsModule,
  ] = await Promise.all([
    import('../../src/runtime/DefaultMfeRegistry'),
    import('../../src/handler/types'),
    import('../../src/handler/mfe-bridge-factory-default'),
    import('../../src/runtime/ExtensionDomainImplementation'),
    import('../../src/runtime/ExtensionDomainImplementationFactory'),
    import('../../src/runtime/mount-strategies'),
    import('../../src/mediator/types'),
    import('../../src/bridge/ParentMfeBridge'),
    import('../../src/bridge/errors'),
  ]);

  return {
    DefaultMfeRegistry: registryModule.DefaultMfeRegistry,
    MfeHandler: handlerTypesModule.MfeHandler,
    MfeBridgeFactoryDefault: bridgeFactoryModule.MfeBridgeFactoryDefault,
    ExtensionDomainImplementation: domainImplModule.ExtensionDomainImplementation,
    ExtensionDomainImplementationFactory: domainImplFactoryModule.ExtensionDomainImplementationFactory,
    ConcurrentMountStrategy: mountStrategiesModule.ConcurrentMountStrategy,
    ActionHandler: mediatorTypesModule.ActionHandler,
    // Same-generation imports (see the doc comment above): resolves to the
    // exact `ParentMfeBridgeImpl`/`BridgeInactiveError` this copy's own
    // `DefaultMfeRegistry` uses internally, so tests can spy on/assert
    // against the actual mechanism instead of the (deliberately
    // failure-reason-scrubbed, per D) console.error diagnostic text.
    ParentMfeBridgeImpl: parentBridgeModule.ParentMfeBridgeImpl,
    BridgeInactiveError: bridgeErrorsModule.BridgeInactiveError,
  };
}

type Copy = Awaited<ReturnType<typeof loadCopy>>;

/** Builds a `ConcurrentMountStrategy`-backed domain implementation bound to one specific copy's classes. */
function makeDomainFactory(
  copy: Copy,
  extraHandlers: ReadonlyArray<[string, InstanceType<Copy['ActionHandler']>]> = []
) {
  class NoopHooks implements ContainerHooks {
    create(_extensionId: string): Element {
      return document.createElement('div');
    }
    destroy(_extensionId: string): void { /* no-op */ }
  }

  class GenericDomainImpl extends copy.ExtensionDomainImplementation {
    private readonly strategy: InstanceType<Copy['ConcurrentMountStrategy']>;

    constructor(ctx: DomainContext) {
      super();
      const hooks = new NoopHooks();
      this.strategy = new copy.ConcurrentMountStrategy(ctx.mounter, hooks);
      ctx.registerHandler(
        MOUNT_EXT,
        copy.ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as ActionPayload))
      );
      ctx.registerHandler(
        UNMOUNT_EXT,
        copy.ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as ActionPayload))
      );
      for (const [actionType, handler] of extraHandlers) {
        ctx.registerHandler(actionType, handler);
      }
    }

    protected getMountStrategies() {
      return [this.strategy];
    }
  }

  class GenericDomainFactory extends copy.ExtensionDomainImplementationFactory {
    build(ctx: DomainContext): GenericDomainImpl {
      return new GenericDomainImpl(ctx);
    }
  }

  return new GenericDomainFactory();
}

/** An `MfeHandler`, bound to one specific copy's classes, whose `load()` resolves to an injectable synchronous `mount()`. */
function makeInjectableMountHandler(
  copy: Copy,
  entryBaseTypeId: string,
  onMount: (bridge: ChildMfeBridge) => void
) {
  class InjectableMountHandler extends copy.MfeHandler {
    readonly bridgeFactory = new copy.MfeBridgeFactoryDefault();

    async load(): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
      return {
        mount: (_container, bridge) => {
          // Synchronous body: anything constructed here — in particular a
          // further `DefaultMfeRegistry`, from EITHER copy — falls inside
          // the realm-global rendezvous window (`inst-track-mounting-bridge`).
          onMount(bridge);
        },
        unmount: () => { /* no-op */ },
      };
    }
  }

  return new InjectableMountHandler(entryBaseTypeId);
}

// ─── Topology: shell (copy A) -> child-ext -> nested registry (copy B) ────

const D0 = 'domain.shell.v1';
const D1 = 'domain.nested.v1';
const CHILD_EXT = 'ext.child.v1';
const CHILD_ENTRY = 'entry.child.v1';
const SIBLING_EXT = 'ext.sibling.v1';
const SIBLING_ENTRY = 'entry.sibling.v1';

interface Topology {
  copyA: Copy;
  copyB: Copy;
  shell: InstanceType<Copy['DefaultMfeRegistry']>;
  nested: InstanceType<Copy['DefaultMfeRegistry']>;
  siblingNested: InstanceType<Copy['DefaultMfeRegistry']> | undefined;
  rootCounter: { count: number };
  leafCounter: { count: number };
  collideCounterFirst: { count: number };
  collideCounterSecond: { count: number };
  errorSpy: ReturnType<typeof vi.spyOn>;
}

/**
 * Builds shell (copy A) -> child-ext -> nested (copy B, domain D1), across
 * the real mount path (`registerExtension` / `ExtensionMounter.mount`) —
 * the same route the React slot takes, and the same one the single-graph
 * suite uses, just spanning two independently loaded copies.
 */
async function buildCrossCopyTopology(includeCollidingSibling = false): Promise<Topology> {
  vi.resetModules();
  const copyA = await loadCopy();
  vi.resetModules();
  const copyB = await loadCopy();

  const entries = new Map<string, MfeEntry>([
    [CHILD_ENTRY, makeEntry(CHILD_ENTRY)],
    [SIBLING_ENTRY, makeEntry(SIBLING_ENTRY)],
  ]);
  // Structural interface, not a class — safe to share the identical plugin
  // object across both copies; a `TypeSystemPlugin` is duck-typed by every
  // caller, on either side of the boundary.
  const plugin = createMockPlugin(entries);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence expected diagnostics */ });

  const rootCounter = { count: 0 };
  const leafCounter = { count: 0 };
  const collideCounterFirst = { count: 0 };
  const collideCounterSecond = { count: 0 };

  let nested!: InstanceType<Copy['DefaultMfeRegistry']>;
  let siblingNested: InstanceType<Copy['DefaultMfeRegistry']> | undefined;

  const childHandler = makeInjectableMountHandler(copyA, CHILD_ENTRY, () => {
    // Synchronously construct a registry from COPY B inside child-ext's own
    // mount() body, which is running as part of COPY A's mount manager —
    // this is the entire cross-copy "adopt the ambient bridge" contract.
    nested = new copyB.DefaultMfeRegistry({ typeSystem: plugin });
    nested.registerDomain(
      makeDomain(D1, [ACTION_LEAF, ACTION_HANG]),
      makeDomainFactory(copyB, [
        [ACTION_LEAF, copyB.ActionHandler.fromFunction(async () => { leafCounter.count += 1; })],
        // Never settles on its own — exercises forced rejection of an
        // in-flight forwarded action on retraction.
        [ACTION_HANG, copyB.ActionHandler.fromFunction(() => new Promise<void>(() => { /* hangs */ }))],
      ])
    );
    if (includeCollidingSibling) {
      nested.registerDomain(
        makeDomain('domain.collide.v1', [ACTION_COLLIDE]),
        makeDomainFactory(copyB, [
          [ACTION_COLLIDE, copyB.ActionHandler.fromFunction(async () => { collideCounterFirst.count += 1; })],
        ])
      );
    }
  });

  const siblingHandler = makeInjectableMountHandler(copyA, SIBLING_ENTRY, () => {
    // A SECOND independently loaded copy-B registry — an independent
    // subtree that collides with the first on 'domain.collide.v1'.
    siblingNested = new copyB.DefaultMfeRegistry({ typeSystem: plugin });
    siblingNested.registerDomain(
      makeDomain('domain.collide.v1', [ACTION_COLLIDE]),
      makeDomainFactory(copyB, [
        [ACTION_COLLIDE, copyB.ActionHandler.fromFunction(async () => { collideCounterSecond.count += 1; })],
      ])
    );
  });

  const shell = new copyA.DefaultMfeRegistry({
    typeSystem: plugin,
    mfeHandlers: includeCollidingSibling ? [childHandler, siblingHandler] : [childHandler],
  });

  shell.registerDomain(
    makeDomain(D0, [ACTION_ROOT]),
    makeDomainFactory(copyA, [
      [ACTION_ROOT, copyA.ActionHandler.fromFunction(async () => { rootCounter.count += 1; })],
    ])
  );

  await shell.registerExtension(makeExtension(CHILD_EXT, D0, CHILD_ENTRY));
  const mounter0 = shell.getMounter(D0);
  mounter0.attach(document.createElement('div'));
  await mounter0.mount(CHILD_EXT, document.createElement('div'));

  if (includeCollidingSibling) {
    await shell.registerExtension(makeExtension(SIBLING_EXT, D0, SIBLING_ENTRY));
    await mounter0.mount(SIBLING_EXT, document.createElement('div'));
  }

  return {
    copyA,
    copyB,
    shell,
    nested,
    siblingNested,
    rootCounter,
    leafCounter,
    collideCounterFirst,
    collideCounterSecond,
    errorSpy,
  };
}

describe('Cross-copy boundary: registration propagation, escalation, retraction across two independently loaded module instances', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the two copies are genuinely distinct module instances, not one shared import', async () => {
    const copyA = await loadCopy();
    vi.resetModules();
    const copyB = await loadCopy();

    expect(copyA.DefaultMfeRegistry).not.toBe(copyB.DefaultMfeRegistry);
    expect(copyA.MfeHandler).not.toBe(copyB.MfeHandler);
    expect(copyA.ActionHandler).not.toBe(copyB.ActionHandler);

    const instanceFromA = new copyA.DefaultMfeRegistry({ typeSystem: createMockPlugin(new Map()) });
    // The nested registry from copy B is never an `instanceof` copy A's own
    // class, and vice versa — proving the two are unrelated class
    // hierarchies, exactly the situation `cpt-frontx-adr-mfe-load-isolation`
    // says a real nested MFE composition produces.
    expect(instanceFromA instanceof copyB.DefaultMfeRegistry).toBe(false);
  });

  it('(1) inbound-bridge adoption and downward forwarding work across the copy boundary: shell (copy A) reaches the nested registry (copy B)', async () => {
    const { shell, leafCounter } = await buildCrossCopyTopology();

    await shell.executeActionsChain(actionChain(ACTION_LEAF, D1));

    expect(leafCounter.count).toBe(1);
  });

  it('(2) upward escalation works across the copy boundary: the nested registry (copy B) reaches the shell (copy A)', async () => {
    const { nested, rootCounter } = await buildCrossCopyTopology();

    await nested.executeActionsChain(actionChain(ACTION_ROOT, D0));

    expect(rootCounter.count).toBe(1);
  });

  it('(3) arrival-edge loop containment holds across the copy boundary: the shell never ping-pongs an escalated-from-nested dispatch back down through the same bridge', async () => {
    const { nested, errorSpy } = await buildCrossCopyTopology();

    // The nested registry (copy B) does not declare ACTION_UNRESOLVABLE, so
    // it must escalate to the shell (copy A). The shell legitimately holds
    // a forwarding entry for D1 pointing right back down through the exact
    // bridge this chain just arrived on (recorded when the nested registry
    // advertised D1 upward during topology construction). Without
    // cross-copy-correct arrival-edge tagging (`inst-tag-arrival-edge`) —
    // the single spot most likely to break, since the tag is written by
    // copy A's `buildInboundBridgeLinkFor` closure and must be read back by
    // copy A's own `resolveHandler`, never by copy B's WeakMap — the shell
    // would resolve that forwarding entry and ping-pong the chain straight
    // back down to the nested registry via `sendDown`.
    const nestedExecuteSpy = vi.spyOn(nested, 'executeActionsChain');
    errorSpy.mockClear();

    await nested.executeActionsChain(actionChain(ACTION_UNRESOLVABLE, D1));

    // Asserted on OUTCOME (the chain failed at all), not on the specific
    // missing-handler wording: the `[MfeRegistry] Actions chain failed`
    // diagnostic deliberately no longer carries failure-reason text (see D:
    // `ChainResult.error` was removed as a matter of policy, uniformly
    // across every failure path).
    expect(errorSpy).toHaveBeenCalled();

    // Exactly one invocation — this test's own call. A ping-pong back down
    // through the excluded forwarding entry would have re-invoked it a
    // second time via `sendDown`.
    expect(nestedExecuteSpy).toHaveBeenCalledTimes(1);
  });

  it('(4) the collision guard rejects a cross-copy advertisement collision between two independent copy-B subtrees mounted under the same copy-A shell', async () => {
    const { shell, siblingNested, collideCounterFirst, collideCounterSecond, errorSpy } =
      await buildCrossCopyTopology(true);

    expect(siblingNested).toBeDefined();
    const collisionLog = errorSpy.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('Advertisement collision')
    );
    expect(collisionLog).toBeDefined();

    // The shell keeps routing to the FIRST-registered target; the second
    // copy-B subtree's own local domain of the same id is never reachable
    // through the shell.
    await shell.executeActionsChain(actionChain(ACTION_COLLIDE, 'domain.collide.v1'));
    expect(collideCounterFirst.count).toBe(1);
    expect(collideCounterSecond.count).toBe(0);
  });

  it('(5) disposing the nested (copy B) registry retracts its advertisements from the shell (copy A) and rejects an in-flight forwarded action, across the boundary', async () => {
    const { shell, nested, errorSpy } = await buildCrossCopyTopology();

    // Dispatch a forwarded action to a handler that never settles on its
    // own, then dispose the copy-B registry WITHOUT awaiting the dispatch
    // first — forced rejection on retraction is what lets this resolve at
    // all, and it must cross the boundary: the shell (copy A) is the one
    // holding the forwarding entry and the one performing the rejection.
    const dispatchPromise = shell.executeActionsChain(actionChain(ACTION_HANG, D1));
    nested.dispose();

    // The fact this `await` settles at all (rather than timing out the
    // test) is the proof the forced rejection fired — `ACTION_HANG`'s
    // handler never resolves on its own.
    await dispatchPromise;

    // Asserted on OUTCOME, not on the specific "was retracted while an
    // action was in flight" wording: the `[MfeRegistry] Actions chain
    // failed` diagnostic no longer carries the rejection's message (see D).
    expect(errorSpy).toHaveBeenCalled();

    // The shell's forwarding entry for D1 is gone entirely — a further
    // dispatch now fails with a missing-handler error.
    errorSpy.mockClear();
    await shell.executeActionsChain(actionChain(ACTION_LEAF, D1));
    expect(errorSpy).toHaveBeenCalled();
  });

  it('(6) unmounting the child extension deactivates the copy-B nested registry\'s bridge across the copy boundary: dispatch rejects as inactive, not as missing a handler', async () => {
    const { shell, errorSpy, copyA } = await buildCrossCopyTopology();

    // Unmount child-ext directly through the shell's own mount manager,
    // WITHOUT ever calling `nested.dispose()` — an ordinary unmount only
    // deactivates the bridge (`inst-bridge-deactivation`), across the copy
    // boundary the same as within one module graph; the forwarding entry
    // for D1 stays recorded at the shell.
    const mounter0 = shell.getMounter(D0);
    await mounter0.unmount(CHILD_EXT);

    // The `[MfeRegistry] Actions chain failed` diagnostic no longer carries
    // failure-reason text by design (see D), so the inactive-vs-missing-
    // handler distinction is verified at the mechanism instead of the log —
    // spying on copy A's own `ParentMfeBridgeImpl.sendActionsChain` (the
    // exact class `shell`'s internal `sendDown` closure calls), same-copy
    // generation as `shell` itself so `instanceof` holds.
    const sendSpy = vi.spyOn(copyA.ParentMfeBridgeImpl.prototype, 'sendActionsChain');
    errorSpy.mockClear();
    await shell.executeActionsChain(actionChain(ACTION_LEAF, D1));

    // Outcome-level check: the dispatch failed at all.
    expect(errorSpy).toHaveBeenCalled();

    // Mechanism-level check: the forwarding entry for D1 WAS resolved and
    // reached the bridge (not a missing-handler/no-route failure), and the
    // bridge rejected specifically because it is inactive.
    expect(sendSpy).toHaveBeenCalled();
    const lastCall = sendSpy.mock.results[sendSpy.mock.results.length - 1];
    await expect(lastCall.value).rejects.toBeInstanceOf(copyA.BridgeInactiveError);

    sendSpy.mockRestore();
  });

  it('(7) a copy-B registry reused (not rebuilt) across a remount of its copy-A host extension keeps its already-adopted live link across the copy boundary and continues to advertise successfully', async () => {
    vi.resetModules();
    const copyA = await loadCopy();
    vi.resetModules();
    const copyB = await loadCopy();

    const REUSE_ENTRY = 'entry.reuse-cross-copy.v1';
    const REUSE_EXT = 'ext.reuse-cross-copy.v1';
    const D_REUSE = 'domain.reuse-cross-copy.v1';
    const ACTION_REUSE = 'mock.action.v1~action_reuse_cross_copy.v1~';

    const entries = new Map<string, MfeEntry>([[REUSE_ENTRY, makeEntry(REUSE_ENTRY)]]);
    const plugin = createMockPlugin(entries);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* silence expected diagnostics */ });
    const reuseCounter = { count: 0 };

    // Constructed exactly once, from copy B, the very first time `mount()`
    // runs — never rebuilt on a later remount of its copy-A host extension.
    let reusedNested: InstanceType<Copy['DefaultMfeRegistry']> | undefined;

    const reuseHandler = makeInjectableMountHandler(copyA, REUSE_ENTRY, () => {
      if (!reusedNested) {
        reusedNested = new copyB.DefaultMfeRegistry({ typeSystem: plugin });
        reusedNested.registerDomain(
          makeDomain(D_REUSE, [ACTION_REUSE]),
          makeDomainFactory(copyB, [
            [ACTION_REUSE, copyB.ActionHandler.fromFunction(async () => { reuseCounter.count += 1; })],
          ])
        );
      }
      // Remount: reused as-is — no new copy-B `DefaultMfeRegistry` is
      // constructed here, so reachability depends entirely on copy A's
      // mount manager re-offering the fresh link across the copy boundary.
    });

    const shell = new copyA.DefaultMfeRegistry({
      typeSystem: plugin,
      mfeHandlers: [reuseHandler],
    });
    shell.registerDomain(makeDomain(D0), makeDomainFactory(copyA));

    await shell.registerExtension(makeExtension(REUSE_EXT, D0, REUSE_ENTRY));
    const mounter0 = shell.getMounter(D0);
    mounter0.attach(document.createElement('div'));

    await mounter0.mount(REUSE_EXT, document.createElement('div'));
    await shell.executeActionsChain(actionChain(ACTION_REUSE, D_REUSE));
    expect(reuseCounter.count).toBe(1);

    await mounter0.unmount(REUSE_EXT);
    await mounter0.mount(REUSE_EXT, document.createElement('div'));

    errorSpy.mockClear();
    await shell.executeActionsChain(actionChain(ACTION_REUSE, D_REUSE));
    const failureLogged = errorSpy.mock.calls.some((call: unknown[]) =>
      call.some((arg: unknown) => String(arg).includes('Actions chain failed') || String(arg).includes('No handler found'))
    );
    expect(failureLogged).toBe(false);
    expect(reuseCounter.count).toBe(2);

    vi.restoreAllMocks();
  });
});
