/**
 * demo-mfe widgets-host lifecycle.
 *
 * Constructs a nested FrontX app that owns the widgets ExtensionDomain (per
 * Phase 1.5 audit Q5 single-owner rule). The widgets domain GTS instance is
 * authored inside `demo-mfe/mfe.json`'s `domains[]` array — content-addressed
 * by its GTS instance ID and registered into the nested type system from the
 * global runtime-fetched manifest. TypeScript transports the entity, never
 * defines it.
 *
 * Discovery follows the Phase 5.6 runtime-fetch contract: this nested app
 * fetches the same `generated-mfe-manifests.json` the host bootstrap fetches.
 * For each MFE package in the global manifest, schemas / manifest / domains /
 * entries are registered opaquely on the nested type system (Phase 6.7 order:
 * schemas → manifest → domains → entries → extensions). The widgets domain
 * instance is located in the registered domains by its GTS instance ID, then
 * the nested app takes ownership via `registry.registerDomain(domain, factory)`.
 * Extensions whose `domain` matches the widgets domain are registered opaquely
 * on the nested registry. No build-time imports of foreign-package mfe.json
 * files, no hardcoded URLs, no GTS-entity decomposition in L4 code.
 */
import React, { useEffect, useState } from 'react';
import {
  createFrontX,
  effects,
  microfrontends,
  queryCacheShared,
  mock,
  gtsPlugin,
  ConcurrentMountStrategy,
  ExtensionDomainImplementation,
  ExtensionDomainImplementationFactory,
  ActionHandler,
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_ACTION_UNMOUNT_EXT,
  FRONTX_MFE_ENTRY_MF,
  MfeHandlerMF,
  ExtensionDomainSlot,
  ThemeAwareReactLifecycle,
  screenDomain,
  type ContainerHooks,
  type DomainContext,
  type ActionPayload,
  type MountStrategy,
  type ExtensionDomain,
  type Extension,
  type ChildMfeBridge,
  type MfeMountContext,
  type MfManifest,
  type MfeEntryMF,
  type JSONSchema,
} from '@gears-frontx/react';
import { themeSchema, languageSchema, extensionScreenSchema } from '@gears-frontx/frontx-template-shell';

const WIDGETS_DOMAIN_ID =
  'gts.frontx.mfes.ext.domain.v1~frontx.widgets.area.main.v1';

const WIDGET_PING_ACTION_TYPE =
  'gts.frontx.mfes.comm.action.v1~frontx.widgets.test.widget_ping.v1~';

interface MfeManifestConfig {
  manifest: MfManifest;
  domains?: ExtensionDomain[];
  entries: MfeEntryMF[];
  extensions?: Extension[];
  schemas?: JSONSchema[];
}

class WidgetsContainerHooks implements ContainerHooks {
  private readonly elements = new Map<string, HTMLElement>();

  create(extensionId: string): Element {
    const el = document.createElement('div');
    el.dataset.widgetExtensionId = extensionId;
    el.style.minHeight = '4rem';
    this.elements.set(extensionId, el);
    return el;
  }

  destroy(extensionId: string): void {
    this.elements.delete(extensionId);
  }
}

class WidgetsDomainImpl extends ExtensionDomainImplementation {
  private readonly strategy: ConcurrentMountStrategy;

  constructor(ctx: DomainContext, hooks: ContainerHooks) {
    super();
    this.strategy = new ConcurrentMountStrategy(ctx.mounter, hooks);
    ctx.registerHandler(
      FRONTX_ACTION_MOUNT_EXT,
      ActionHandler.fromFunction((_t, p) =>
        this.strategy.mount(p as ActionPayload),
      ),
    );
    ctx.registerHandler(
      FRONTX_ACTION_UNMOUNT_EXT,
      ActionHandler.fromFunction((_t, p) =>
        this.strategy.unmount!(p as ActionPayload),
      ),
    );
  }

  protected getMountStrategies(): MountStrategy[] {
    return [this.strategy];
  }
}

class WidgetsDomainFactory extends ExtensionDomainImplementationFactory {
  build(ctx: DomainContext): WidgetsDomainImpl {
    return new WidgetsDomainImpl(ctx, new WidgetsContainerHooks());
  }
}

function createWidgetsHostApp(): ReturnType<ReturnType<typeof createFrontX>['build']> {
  return createFrontX()
    .use(effects())
    .use(microfrontends({
      typeSystem: gtsPlugin,
      mfeHandlers: [new MfeHandlerMF(FRONTX_MFE_ENTRY_MF)],
    }))
    .use(queryCacheShared())
    .use(mock())
    .build();
}

/**
 * A `microfrontends()`-FREE placeholder app, used ONLY as the `app` argument
 * `ThemeAwareReactLifecycle`'s constructor requires (for the shared
 * query-cache / theme context `FrontXProvider` resolves).
 *
 * `@gears-frontx/framework`'s `microfrontends()` plugin builds its
 * `MfeRegistry` through a module-level singleton factory
 * (`mfeRegistryFactory` in `template-shell/packages/framework/src/mfe/registry.ts`):
 * the FIRST call to build a registry within this loaded copy of the module
 * wins permanently — every later `createWidgetsHostApp()` call (regardless
 * of new plugin config) returns THAT SAME cached `MfeRegistry` instance, not
 * a fresh one. `DemoMfeWidgetsHostLifecycle`'s own constructor runs at
 * module-evaluation time (when this file's default export is constructed),
 * always strictly BEFORE any `mount()` call and therefore always outside the
 * ambient mounting-bridge rendezvous window `DefaultMountManager` opens
 * around the synchronous portion of `lifecycle.mount(...)`. If the
 * constructor called the real, `microfrontends()`-bearing `createWidgetsHostApp()`,
 * it would permanently consume that one first-build slot with a registry
 * that adopts no inbound bridge — degrading every future mount of this
 * extension to root-registry behavior for good, regardless of any fix to
 * WHERE the nested registry construction happens relative to `mount()`.
 * This placeholder never touches `microfrontends()`, so it never calls
 * `mfeRegistryFactory.build()` — leaving that one slot free for
 * `DemoMfeWidgetsHostLifecycle.mount()`'s own, later, synchronous call to
 * the real `createWidgetsHostApp()` to win it from inside the rendezvous
 * window instead.
 */
function createWidgetsHostAppShell(): ReturnType<ReturnType<typeof createFrontX>['build']> {
  return createFrontX()
    .use(effects())
    .use(queryCacheShared())
    .use(mock())
    .build();
}

/**
 * Bootstrap demo-mfe's widgets-host child runtime:
 *   1. Fetch the global manifest at runtime from the public-asset URL the
 *      generation script writes (Phase 5.6 contract).
 *   2. First pass: register every package's schemas opaquely on the child
 *      type system so derived-schema chains resolve regardless of package
 *      iteration order.
 *   3. Second pass: for each package, register manifest, domains, then
 *      entries opaquely on the child type system (Phase 6.7 order:
 *      schemas → manifest → domains → entries → extensions). While iterating
 *      domains, locate the widgets domain by its GTS instance ID so the
 *      nested app can take ownership of it via `registry.registerDomain(...)`.
 *   4. Take ownership of the widgets domain (registerDomain on the nested
 *      registry, paired with the local `WidgetsDomainFactory`).
 *   5. Third pass: for each extension whose target domain is the widgets
 *      domain, register it opaquely on the child registry.
 *
 * GTS entities flow through unchanged — no spread, no override, no
 * decomposition, no L4 reconstruction. The generation script inlines the
 * resolved `MfManifest` object into each entry's `manifest` field so entries
 * are registered opaquely without any consumer-side spread. The widgets
 * domain instance is authored once in `demo-mfe/mfe.json` (`domains[]`) and
 * arrives here through the same fetched manifest pipeline as every other GTS
 * entity.
 */
async function bootstrapWidgetsRuntime(
  app: ReturnType<typeof createWidgetsHostApp>,
): Promise<void> {
  const registry = app.mfeRegistry;
  if (!registry) {
    throw new Error(
      'demo-mfe widgets-host: app.mfeRegistry is undefined.',
    );
  }

  console.info(
    '[demo-mfe widgets-host] Fetching MFE manifests from /generated-mfe-manifests.json',
  );
  const response = await fetch('/generated-mfe-manifests.json');
  if (!response.ok) {
    throw new Error(
      `[demo-mfe widgets-host] Failed to load MFE manifests from /generated-mfe-manifests.json: ${response.status} ${response.statusText}`,
    );
  }
  const manifests = (await response.json()) as MfeManifestConfig[];

  for (const config of manifests) {
    for (const schema of config.schemas ?? []) {
      registry.typeSystem.registerSchema(schema);
    }
  }

  let widgetsDomain: ExtensionDomain | undefined;
  for (const config of manifests) {
    registry.typeSystem.register(config.manifest);
    for (const domain of config.domains ?? []) {
      registry.typeSystem.register(domain);
      if (domain.id === WIDGETS_DOMAIN_ID) {
        widgetsDomain = domain;
      }
    }
    for (const entry of config.entries) {
      registry.typeSystem.register(entry);
    }
  }

  if (!widgetsDomain) {
    throw new Error(
      `[demo-mfe widgets-host] Widgets domain ${WIDGETS_DOMAIN_ID} not found in any registered MFE manifest's domains[].`,
    );
  }
  registry.registerDomain(widgetsDomain, new WidgetsDomainFactory());

  // This nested type system's GtsStore is wholly independent of the shell's
  // (each GtsPlugin instance owns its own store — see plugin.ts). Actions
  // dispatched into this registry may reference entities the shell owns
  // (e.g. widget-a's "mount Hello World in the shell's screen domain"
  // escalates through here on its way up), and `x-gts-ref` admission
  // validation checks referenced entities against THIS store, before the
  // action ever reaches cross-hop routing. `screenDomain` is a well-known
  // framework declaration (not authored in any package's mfe.json), so it
  // is registered directly here rather than sourced from the fetched
  // manifest — this registry never takes ownership of it (no
  // `registerDomain` call), it only needs the declaration present for
  // `x-gts-ref` resolution.
  //
  // `screenDomain` itself references three application-layer derived
  // schemas (theme, language, extension_screen) that the shell's own
  // `main.tsx` registers once, directly onto its own `gtsPlugin` singleton,
  // before any app bootstraps — outside the manifest-driven registration
  // loop entirely (see `loader.ts`'s comment: "application-specific derived
  // schemas ... registered at the application layer"). This nested runtime
  // is a separate module-federation-loaded copy of the framework with its
  // own `gtsPlugin` singleton, which never ran that shell-only `main.tsx`
  // registration, so `screenDomain`'s own admission would otherwise fail
  // the same way. Register them here, from the same framework re-export
  // `main.tsx` uses, before registering `screenDomain`.
  registry.typeSystem.registerSchema(themeSchema);
  registry.typeSystem.registerSchema(languageSchema);
  registry.typeSystem.registerSchema(extensionScreenSchema);
  registry.typeSystem.register(screenDomain);

  for (const config of manifests) {
    for (const extension of config.extensions ?? []) {
      // Register every extension declared by any fetched manifest opaquely
      // on this nested type system — not just the widgets-domain ones this
      // registry owns and mounts below — so `x-gts-ref` validation for an
      // action referencing a foreign-domain extension instance (e.g. the
      // shell's Hello World screen extension) resolves against this
      // registry's own independent GtsStore. This registration is
      // type-system-only: it does not admit the extension for mounting in
      // this registry (that stays gated by the WIDGETS_DOMAIN_ID check
      // below, via `registerExtension`).
      registry.typeSystem.register(extension);
      if (extension.domain === WIDGETS_DOMAIN_ID) {
        await registry.registerExtension(extension);
      }
    }
  }
}

interface WidgetsHostScreenProps {
  /**
   * The nested `FrontXApp` this screen renders against, constructed
   * synchronously by `DemoMfeWidgetsHostLifecycle.mount()` — BEFORE
   * `createRoot(...).render(...)` is called — rather than lazily inside a
   * React hook.
   *
   * React's `createRoot().render()` does not guarantee the initial render of
   * the rendered tree (including a `useState` lazy initializer) executes
   * synchronously within the call to `render()` itself; it may be deferred to
   * a later microtask/scheduler turn. The cross-nesting inbound-bridge
   * rendezvous (`inbound-bridge-link.ts`) is only open for the exact
   * synchronous duration of `lifecycle.mount(...)` — `DefaultMountManager`
   * pushes the ambient bridge immediately before calling `mount()` and pops
   * it in a `finally` immediately after that call *returns* (not after any
   * promise it returns settles). Constructing the nested `DefaultMfeRegistry`
   * inside a `useState(() => createWidgetsHostApp())` initializer therefore
   * risks running that construction after the rendezvous window has already
   * closed, silently degrading the registry to root-registry behavior (no
   * inbound bridge ever adopted, so upward escalation/propagation never
   * engages). Constructing the app in the lifecycle's own `mount()` body,
   * synchronously before `render()`, and passing it down as a prop guarantees
   * construction happens inside the rendezvous window regardless of how React
   * schedules this component's render.
   */
  readonly app: ReturnType<typeof createWidgetsHostApp>;
  /**
   * The SAME in-flight `bootstrapWidgetsRuntime(...)` promise
   * `DemoMfeWidgetsHostLifecycle.mount()` started synchronously (before any
   * `await`) and is itself awaiting before its own returned promise
   * resolves. This component never re-invokes `bootstrapWidgetsRuntime` —
   * it only subscribes to this already-started promise to drive its own
   * loading/error UI. The registry-level `registerDomain` call this promise
   * guards completes independently of (and strictly no later than) whatever
   * turn React schedules this effect on, so an action chain's `next`
   * continuation targeting the widgets domain is always routable by the
   * time `mount()` resolves — regardless of this component's own render
   * timing.
   */
  readonly bootstrap: Promise<void>;
  /**
   * Signals `DemoMfeWidgetsHostLifecycle.mount()` that `ExtensionDomainSlot`'s
   * own `mounter.attach(root)` has completed for the widgets domain — i.e.
   * that `DefaultExtensionMounter` now has a DOM root to mount into, so a
   * `mount_ext` dispatched into this domain will not throw "no root attached
   * for domain ...". `registerDomain` completing (the `bootstrap` promise
   * above) is necessary for a chain's `next` continuation targeting this
   * domain to be ROUTABLE at all, but it is not sufficient for that
   * continuation to actually MOUNT anything: `ExtensionDomainSlot` only
   * renders once this component's own `ready` state flips true (which
   * itself only happens after `bootstrap` resolves), and its root-attach
   * effect runs on a LATER React commit than the microtask that resolves
   * `mount()`'s own promise and immediately drives the chain's `next` node.
   * Awaiting this signal too — not just `bootstrap` — is what closes that
   * second race.
   *
   * This component deliberately delays calling it until AFTER its own
   * auto-mount-on-attach pass (below) has settled for every extension
   * currently registered on this domain — not the instant `attach()`
   * returns. `ExtensionDomainSlot` only renders once this component's own
   * `ready` state flips true, and its root-attach effect runs on a LATER
   * React commit than the microtask that resolves `mount()`'s own promise
   * and immediately drives a chain's `next` continuation. If that
   * continuation dispatched a `mount_ext` for this domain before
   * `DefaultExtensionMounter` had a root attached, it would throw "no root
   * attached for domain ...". Deferring this signal until after the
   * auto-mount pass settles means any later `mount_ext` for an extension
   * this pass already mounted lands on the cheap, safe
   * `mountState === 'mounted'` early-return in `mountExtension` instead of
   * racing the root-attach timing a second time.
   */
  readonly onDomainAttached: () => void;
}

function WidgetsHostScreen({
  app: appRef,
  bootstrap,
  onDomainAttached,
}: WidgetsHostScreenProps): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registry = appRef.mfeRegistry;

  useEffect(() => {
    let cancelled = false;
    bootstrap
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[demo-mfe widgets-host] runtime bootstrap failed:', err);
        if (!cancelled) setError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  const handleAttached = (): void => {
    if (!registry) {
      // No registry — nothing this pass could mount anyway. Unblock
      // `mount()` immediately rather than hanging forever.
      onDomainAttached();
      return;
    }
    const extensions = registry.getExtensionsForDomain(WIDGETS_DOMAIN_ID);
    // Awaited (via `allSettled`, not `all`) so one extension's mount
    // failure never blocks `onDomainAttached()` from eventually firing for
    // the rest — see `onDomainAttached`'s doc comment for why this pass
    // must fully settle BEFORE unblocking `mount()`, rather than firing
    // these dispatches and calling `onDomainAttached()` immediately.
    Promise.allSettled(
      extensions.map((ext) =>
        registry
          .executeActionsChain({
            action: {
              type: FRONTX_ACTION_MOUNT_EXT,
              target: WIDGETS_DOMAIN_ID,
              payload: { subject: ext.id },
            },
          })
          .catch((err) => {
            console.error(
              `[demo-mfe widgets-host] mount_ext for ${ext.id} failed:`,
              err,
            );
          }),
      ),
    ).then(() => {
      onDomainAttached();
    });
  };

  if (error) {
    return (
      <div
        className="p-4 text-red-700"
        data-demo-mfe-widgets-host="error"
      >
        Widgets host runtime failed: {error}
      </div>
    );
  }

  if (!ready || !registry) {
    return (
      <div className="p-4" data-demo-mfe-widgets-host="loading">
        Loading widgets host runtime…
      </div>
    );
  }

  const pingTargets = registry
    .getExtensionsForDomain(WIDGETS_DOMAIN_ID)
    .filter((ext) => {
      const entry = registry.typeSystem.getSchema(ext.entry) as
        | { actions?: readonly string[] }
        | undefined;
      return entry?.actions?.includes(WIDGET_PING_ACTION_TYPE) ?? false;
    });

  const handlePing = (extensionId: string): void => {
    registry
      .executeActionsChain({
        action: {
          type: WIDGET_PING_ACTION_TYPE,
          target: extensionId,
          payload: {},
        },
      })
      .catch((err) => {
        console.error(
          `[demo-mfe widgets-host] ping ${extensionId} failed:`,
          err,
        );
      });
  };

  return (
    <div
      data-demo-mfe-widgets-host="true"
      className="flex h-full flex-col gap-2 p-4"
    >
      <header>
        <h2 className="text-xl font-semibold">Widgets Host</h2>
        <p className="text-sm opacity-75">
          Multi-mount fixture: widgets-fixture-a's entry is wired here as
          two distinct extension instances (alpha and beta) sharing the same
          entry path; widgets-fixture-b's entry is wired as a third
          instance. All three render concurrently in the widgets domain
          slot below.
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        {pingTargets.map((ext) => {
          const role = ext.id.includes('widget_alpha') ? 'alpha' : 'beta';
          return (
            <button
              key={ext.id}
              type="button"
              data-testid={`ping-${role}`}
              data-target-extension-id={ext.id}
              onClick={() => handlePing(ext.id)}
              className="rounded border border-blue-400 bg-blue-100 px-3 py-1 text-sm text-blue-900 hover:bg-blue-200"
            >
              Ping {role}
            </button>
          );
        })}
      </div>
      <ExtensionDomainSlot
        registry={registry}
        domainId={WIDGETS_DOMAIN_ID}
        className="demo-mfe-widgets-host-slot"
        onAttached={handleAttached}
      />
    </div>
  );
}

class DemoMfeWidgetsHostLifecycle extends ThemeAwareReactLifecycle {
  /**
   * The nested app/registry the currently-mounted `WidgetsHostScreen`
   * renders against, constructed synchronously in `mount()` below — see
   * `WidgetsHostScreenProps.app`'s doc comment for why this must not be
   * built lazily inside the React tree.
   */
  private widgetsApp: ReturnType<typeof createWidgetsHostApp> | undefined;

  /**
   * The `bootstrapWidgetsRuntime(...)` promise started synchronously (before
   * any `await`) inside `mount()`, and awaited by `mount()` itself before
   * `mount()`'s own returned promise settles. This is what closes the async
   * race: `registry.registerDomain(widgetsDomain, ...)` — the call that
   * makes the widgets domain routable/forward-able from the shell's
   * mediator — happens inside this promise's chain, and `mount()` does not
   * resolve until it has completed. `WidgetsHostScreen` also subscribes to
   * this SAME promise (passed down as a prop) purely to drive its own
   * loading/error UI; it never re-invokes `bootstrapWidgetsRuntime`.
   */
  private bootstrapPromise: Promise<void> | undefined;

  /**
   * Resolves once `ExtensionDomainSlot`'s `onAttached` callback has fired for
   * the widgets domain — i.e. `DefaultExtensionMounter.attach(root)` has
   * actually run, so the domain has a DOM root to mount into. `mount()`
   * awaits this ALONGSIDE `bootstrapPromise` (see that field's doc comment
   * for why `registerDomain` completing is necessary but not sufficient):
   * `ExtensionDomainSlot` only renders — and only then, on a LATER React
   * commit, attaches — once `WidgetsHostScreen`'s own `ready` state flips
   * true, which itself only happens after `bootstrapPromise` resolves.
   * Without also awaiting this signal, a chain's `next` continuation
   * targeting this domain (routable as soon as `bootstrapPromise` resolves)
   * can reach `ConcurrentMountStrategy.mount()` before the mounter has a
   * root, and `DefaultExtensionMounter.mount()` throws "no root attached for
   * domain ...".
   */
  private domainAttachedPromise: Promise<void> | undefined;

  /**
   * Resolve function for `domainAttachedPromise`, wired to `WidgetsHostScreen`'s
   * `onDomainAttached` prop each `mount()`. Set synchronously inside `mount()`
   * before `WidgetsHostScreen` is rendered, so the prop is always defined by
   * the time the component's `handleAttached` callback could possibly fire.
   */
  private onDomainAttached: () => void = () => {};

  constructor() {
    // A `microfrontends()`-free placeholder — see `createWidgetsHostAppShell`'s
    // doc comment for why the REAL app must not be built here.
    super(createWidgetsHostAppShell());
  }

  async mount(container: Element | ShadowRoot, bridge: ChildMfeBridge, mountContext?: MfeMountContext): Promise<void> {
    // Constructed here — synchronously inside this override, before any
    // `await` and before delegating to `ThemeAwareReactLifecycle.mount()`
    // (which is what actually calls `createRoot(...).render(...)`) — so
    // this registry's construction happens strictly within the ambient
    // mounting-bridge rendezvous window `DefaultMountManager.mountExtension`
    // opens around the synchronous portion of this very call. Building it
    // lazily inside a React hook instead risks the rendezvous window having
    // already closed by the time React actually runs the component's
    // initial render. This is also the FIRST call anywhere in this module
    // to build a real `microfrontends()`-bearing app (the constructor above
    // deliberately avoided that), so it is the call that wins the
    // `mfeRegistryFactory` singleton's one-time build slot — see
    // `createWidgetsHostAppShell`.
    this.widgetsApp = createWidgetsHostApp();

    // Kick off the manifest fetch + domain-registration bootstrap
    // synchronously (still within the same synchronous prefix as the
    // registry construction above — invoking an async function runs its
    // body up to its first `await` synchronously). `super.mount()` then
    // renders `WidgetsHostScreen`, which receives this same promise to
    // drive its own loading/error UI without re-triggering bootstrap.
    this.bootstrapPromise = bootstrapWidgetsRuntime(this.widgetsApp);

    let resolveDomainAttached!: () => void;
    this.domainAttachedPromise = new Promise<void>((resolve) => {
      resolveDomainAttached = resolve;
    });
    this.onDomainAttached = resolveDomainAttached;

    super.mount(container, bridge, mountContext);

    // `DefaultMountManager` awaits whatever this override returns (its
    // `void | Promise<void>` mount() contract) and only marks the extension
    // `mounted` — and only lets a chain's `next` continuation dispatch —
    // after that await settles. Awaiting both promises here, rather than
    // leaving either to fire-and-forget inside a React effect, is what
    // closes BOTH races: `registerDomain` making the domain routable
    // (`bootstrapPromise`), and `DefaultExtensionMounter.attach(root)` giving
    // it somewhere to actually mount into (`domainAttachedPromise`) — see
    // each field's doc comment. If `bootstrapPromise` rejects,
    // `Promise.all` rejects immediately without waiting on
    // `domainAttachedPromise` (which would otherwise never resolve, since
    // `WidgetsHostScreen` never renders `ExtensionDomainSlot` on the error
    // path).
    await Promise.all([this.bootstrapPromise, this.domainAttachedPromise]);
  }

  protected renderContent(_bridge: ChildMfeBridge): React.ReactNode {
    if (!this.widgetsApp || !this.bootstrapPromise || !this.domainAttachedPromise) {
      throw new Error(
        'demo-mfe widgets-host: renderContent() called before mount() constructed the nested app.',
      );
    }
    return (
      <WidgetsHostScreen
        app={this.widgetsApp}
        bootstrap={this.bootstrapPromise}
        onDomainAttached={this.onDomainAttached}
      />
    );
  }
}

export default new DemoMfeWidgetsHostLifecycle();
