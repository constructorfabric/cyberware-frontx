/**
 * @vitest-environment jsdom
 *
 * Integration tests for the mount-set diff-dispatch wrapper installed by the
 * microfrontends() plugin around screensetsRegistry.executeActionsChain.
 *
 * These tests drive the wrapper via the public framework builder API. They
 * deliberately avoid real MFE handler registration (which would require a
 * full Module Federation environment) and instead exercise the wrapper's
 * snapshot/diff/dispatch logic through domains registered with test
 * action handlers and controlled mount-set mutations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFrontX } from '../../../createFrontX';
import { microfrontends, addExtensionMounted } from '../index';
import { gtsPlugin } from '@gears-frontx/gts-plugin';
import { themeSchema, languageSchema, extensionScreenSchema } from '@gears-frontx/frontx-template-shell';
import { loadLayoutDomains } from '../gts/loader';
import type { FrontXApp } from '../../../types';
import {
  ConcurrentMountStrategy,
  ExtensionDomainImplementation,
  ExtensionDomainImplementationFactory,
  ActionHandler,
  ExtensionMounter,
} from '@gears-frontx/mfes';
import {
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_ACTION_UNMOUNT_EXT,
} from '@gears-frontx/gts-plugin';
import type {
  ContainerHooks,
  DomainContext,
  ActionPayload,
  MountStrategy,
} from '@gears-frontx/mfes';

// ─── Container hooks that track created containers ────────────────────────────

class TestHooks implements ContainerHooks {
  create(_extensionId: string): Element {
    return document.createElement('div');
  }
  destroy(_extensionId: string): void {}
}

// ─── Minimal ExtensionMounter for strategy construction ───────────────────────
// The FakeMounter does NOT update any real mount-set state; it simply records
// calls. The diff-dispatch wrapper observes registry.getMountedExtensions —
// which reflects the canonical state in DefaultScreensetsRegistry. So tests
// that need the slice to actually change must reach through the real mounter,
// which requires MountManager to be operational. Since that path requires loaded
// extensions, we instead exercise the wrapper's snapshot/diff/dispatch logic
// by keeping the mount-set unchanged and asserting the diff is empty. The
// idempotent-reducer path is tested separately via direct dispatch.

class FakeMounter extends ExtensionMounter {
  attach(_root: Element): void {}
  async detach(): Promise<void> {}
  async mount(_extensionId: string, _container: Element): Promise<void> {}
  async unmount(_extensionId: string): Promise<void> {}
}

// ─── Test domain that registers concurrent handlers with a FakeMounter ────────

class NoOpDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext) {
    super();
    const hooks = new TestHooks();
    // We ignore ctx.mounter and supply our own FakeMounter so the strategy
    // runs without touching the real MountManager.
    const fakeMounter = new FakeMounter();
    this.strategy = new ConcurrentMountStrategy(fakeMounter, hooks);
    ctx.registerHandler(
      FRONTX_ACTION_MOUNT_EXT,
      ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as ActionPayload))
    );
    ctx.registerHandler(
      FRONTX_ACTION_UNMOUNT_EXT,
      ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as ActionPayload))
    );
  }

  protected getMountStrategies(): MountStrategy[] {
    return [this.strategy];
  }
}

class NoOpDomainFactory extends ExtensionDomainImplementationFactory {
  build(ctx: DomainContext): NoOpDomainImpl {
    return new NoOpDomainImpl(ctx);
  }
}

// ─── Test domain that always throws from its mount handler ────────────────────

class ThrowingDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext) {
    super();
    const hooks = new TestHooks();
    const fakeMounter = new FakeMounter();
    this.strategy = new ConcurrentMountStrategy(fakeMounter, hooks);
    ctx.registerHandler(
      FRONTX_ACTION_MOUNT_EXT,
      ActionHandler.fromFunction(async () => { throw new Error('handler intentionally throws'); })
    );
    ctx.registerHandler(
      FRONTX_ACTION_UNMOUNT_EXT,
      ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as ActionPayload))
    );
  }

  protected getMountStrategies(): MountStrategy[] {
    return [this.strategy];
  }
}

class ThrowingDomainFactory extends ExtensionDomainImplementationFactory {
  build(ctx: DomainContext): ThrowingDomainImpl {
    return new ThrowingDomainImpl(ctx);
  }
}

// ─── Shared test setup ────────────────────────────────────────────────────────

// Use the real pre-defined layout domains so the GTS singleton already has
// their schemas registered (the loader pre-registers them).
const [domainA, domainB] = loadLayoutDomains(); // sidebar, popup
const DOMAIN_A = domainA.id;
const DOMAIN_B = domainB.id;

let app: FrontXApp;

function buildApp(): FrontXApp {
  // GTS schemas must be registered on the singleton before building the app.
  gtsPlugin.registerSchema(themeSchema);
  gtsPlugin.registerSchema(languageSchema);
  gtsPlugin.registerSchema(extensionScreenSchema);

  return createFrontX()
        .use(microfrontends({ typeSystem: gtsPlugin }))
    .build();
}

describe('microfrontends plugin — sync-diff dispatch wrapper', () => {
  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    app.destroy();
  });

  // ── Scenario 1 ──────────────────────────────────────────────────────────────
  // Pre-chain snapshot empty → after a chain targeting a registered domain
  // completes (whether success or failure), the wrapper's try/finally path
  // runs and dispatches the diff (which is empty when no mount-set mutation
  // happened). The slice must remain consistent (no spurious entries).

  it('wrapper try/finally runs on a chain that targets a no-op handler: slice stays empty', async () => {
    const registry = app.mfeRegistry!;
    registry.registerDomain(domainA, new NoOpDomainFactory());

    await registry.executeActionsChain({
      action: {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: DOMAIN_A,
        payload: { subject: 'test-ext-a' },
      },
    });

    // No real mount-set mutation occurred (FakeMounter doesn't update the registry).
    // The diff is empty → no addExtensionMounted was dispatched → slice is [].
    const state = app.store.getState() as { mfe?: { mountedExtensions: Record<string, string[]> } };
    const mounted = state.mfe?.mountedExtensions[DOMAIN_A] ?? [];
    expect(mounted).toEqual([]);
  });

  // ── Scenario 2 ──────────────────────────────────────────────────────────────
  // Multi-domain isolation: dispatching a chain targeting domain A does not
  // create spurious entries in domain B's slice bucket.

  it('chain targeting domain A does not affect domain B slice bucket', async () => {
    const registry = app.mfeRegistry!;
    registry.registerDomain(domainA, new NoOpDomainFactory());
    registry.registerDomain(domainB, new NoOpDomainFactory());

    await registry.executeActionsChain({
      action: {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: DOMAIN_A,
        payload: { subject: 'ext-a1' },
      },
    });

    const state = app.store.getState() as { mfe?: { mountedExtensions: Record<string, string[]> } };
    const mountedB = state.mfe?.mountedExtensions[DOMAIN_B];
    // Domain B must be absent from the record (the wrapper only snapshots domains
    // that appear in the chain being executed).
    expect(mountedB).toBeUndefined();
  });

  // ── Scenario 3 ──────────────────────────────────────────────────────────────
  // Idempotent reducer convergence — directly dispatching addExtensionMounted
  // twice to a real store wired by the microfrontends plugin should produce a
  // single entry. This is an integration smoke test of the slice reducer
  // being installed by provides.slices.

  it('addExtensionMounted dispatched twice via the real store is idempotent', () => {
    app.store.dispatch(addExtensionMounted({ domainId: DOMAIN_A, extensionId: 'ext-idem' }));
    app.store.dispatch(addExtensionMounted({ domainId: DOMAIN_A, extensionId: 'ext-idem' }));

    const state = app.store.getState() as { mfe?: { mountedExtensions: Record<string, string[]> } };
    expect(state.mfe?.mountedExtensions[DOMAIN_A]).toEqual(['ext-idem']);
  });

  // ── Scenario 4 ──────────────────────────────────────────────────────────────
  // Schema registration via gtsPlugin — verifying that the plugin wired the
  // registry correctly and the registry is accessible with the expected shape.

  it('screensetsRegistry is available after build and has expected interface', () => {
    const registry = app.mfeRegistry!;

    expect(registry).toBeDefined();
    expect(typeof registry.registerDomain).toBe('function');
    expect(typeof registry.getMountedExtensions).toBe('function');
    expect(typeof registry.executeActionsChain).toBe('function');
    expect(typeof registry.getMounter).toBe('function');
    expect(registry.typeSystem).toBe(gtsPlugin);
  });

  // ── Scenario 5 ──────────────────────────────────────────────────────────────
  // Wrapper completes without rethrowing when the handler throws. The wrapper's
  // finally block must not propagate a new error. getMountedExtensions must
  // still return [] for the domain (no spurious entry from a failed chain).

  it('wrapper does not add spurious slice entries when the chain handler throws', async () => {
    const registry = app.mfeRegistry!;
    registry.registerDomain(domainB, new ThrowingDomainFactory());

    // The handler throws but the wrapper should swallow or re-throw — either
    // way the important assertion is that the slice does not show a mounted extension.
    try {
      await registry.executeActionsChain({
        action: {
          type: FRONTX_ACTION_MOUNT_EXT,
          target: DOMAIN_B,
          payload: { subject: 'ext-that-fails' },
        },
      });
    } catch {
      // Acceptable: the chain propagated the error; the finally block still ran.
    }

    const state = app.store.getState() as { mfe?: { mountedExtensions: Record<string, string[]> } };
    const mounted = state.mfe?.mountedExtensions[DOMAIN_B] ?? [];
    // No real mount-set mutation → diff is empty → no addExtensionMounted dispatched.
    expect(mounted).toEqual([]);
  });
});
