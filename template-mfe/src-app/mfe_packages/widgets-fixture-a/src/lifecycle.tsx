/**
 * widgets-fixture-a — leaf widget MFE lifecycle.
 *
 * Each mount produces an isolated module instance under the per-load blob URL
 * chain (ADR-0004), so when this entry is registered as two distinct extension
 * instances (alpha and beta) sharing the same `entry.path`, the parent runtime
 * loads the bundle twice and evaluates this module twice — module-level state
 * (the random hex generated below) is therefore per-mount.
 *
 * The mount routine generates a per-mount random hex value, renders it visibly
 * under `data-testid="widget-a-instance"`, logs it to the console, and
 * registers a `ping` action handler on the bridge so the mediator routes
 * per-instance pings back to the correct handler.
 */
import React from 'react';
import {
  createFrontX,
  effects,
  queryCacheShared,
  mock,
  ActionHandler,
  ThemeAwareReactLifecycle,
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_SCREEN_DOMAIN,
  type ChildMfeBridge,
  type JsonObject,
} from '@gears-frontx/react';

const PING_ACTION_TYPE =
  'gts.frontx.mfes.comm.action.v1~frontx.widgets.test.widget_ping.v1~';

// Hello World's extension ID (demo-mfe), targeted via the shell's screen
// domain — mounting it from here exercises the upward-escalation tier: this
// widget's own registry doesn't know the screen domain locally, so the
// escalation must travel through Widgets Host's inbound bridge to the shell.
const HELLOWORLD_EXTENSION_ID =
  'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1';

const fixtureApp = createFrontX()
  .use(effects())
  .use(queryCacheShared())
  .use(mock())
  .build();

function generateRandomHex(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Per-mount random hex. Each blob-URL-isolated load of this module produces a
// fresh value, which is the empirical witness that distinct extension
// instances backed by the same entry path get distinct module evaluations.
const randomHex = generateRandomHex();

// Last-ping value and subscriber, keyed by `bridge.extensionId` rather than a
// single module-scoped value. The handler always writes here, independent of
// whether a subscriber is wired yet, so registering the handler synchronously
// in `mount()` (required so a chained `next` step can reach it as soon as
// `mount()` resolves) can never race the DOM's observation of a ping: a ping
// that lands before `WidgetA` subscribes is still visible the moment it does,
// via the initial-state read below, instead of depending on ordering.
//
// Keying by the extension's own (stable, per-extension) id, rather than one
// shared module-level value, matters for two reasons: a remount of an
// extension `DefaultMountManager` has already loaded once reuses the SAME
// module evaluation (`loadState === 'loaded'` skips re-loading) -- so a
// single shared value would leak a DIFFERENT extension's last ping into this
// one's first render, and one extension's cleanup could clear a still-live
// sibling's subscriber. Since `bridge.extensionId` is now the SAME value
// across every mount of a given extension (the bridge pair is minted once and
// reactivated, not recreated, per mount), the last-ping value keyed on it
// actually SURVIVES an unmount/remount cycle of this widget, unless the
// widget's own `unmount()` clears its map entry.
const lastPingValues = new Map<string, string>();
const lastPingSubscribers = new Map<string, () => void>();

class PingHandler extends ActionHandler {
  constructor(private readonly instanceId: string) {
    super();
  }

  handleAction(
    actionTypeId: string,
    _payload: JsonObject | undefined,
  ): Promise<void> {
    console.log(
      `[widget-a ${this.instanceId}] ping ${actionTypeId} randomHex=${randomHex}`,
    );
    lastPingValues.set(this.instanceId, randomHex);
    lastPingSubscribers.get(this.instanceId)?.();
    return Promise.resolve();
  }
}

interface WidgetAProps {
  readonly bridge: ChildMfeBridge;
}

function WidgetA({ bridge }: Readonly<WidgetAProps>): React.ReactElement {
  const instanceId = bridge.extensionId;

  const subscribeToLastPing = React.useCallback(
    (onStoreChange: () => void) => {
      lastPingSubscribers.set(instanceId, onStoreChange);
      return () => {
        // Only remove this instance's own subscriber and snapshot -- guard
        // against a stale closure clearing a different, still-live mount's
        // subscriber (and its already-current snapshot) for the same
        // instanceId (e.g. React re-invoking effects in development, or a
        // new subscriber having already replaced this one before this
        // cleanup runs).
        if (lastPingSubscribers.get(instanceId) === onStoreChange) {
          lastPingSubscribers.delete(instanceId);
          lastPingValues.delete(instanceId);
        }
      };
    },
    [instanceId],
  );

  // `useSyncExternalStore` reads the snapshot both at first render and again
  // when it subscribes, so a ping that already landed -- e.g. one dispatched
  // by a chain step immediately after `mount()` resolved, before this
  // component subscribed -- is reflected instead of silently missed. The
  // handler itself is registered synchronously in `mount()` (below),
  // independent of this subscription, so it is never what races here -- only
  // the view's observation of a value that was already delivered correctly.
  const lastPing = React.useSyncExternalStore(
    subscribeToLastPing,
    () => lastPingValues.get(instanceId) ?? null,
  );

  const handleMountHelloWorld = React.useCallback(async () => {
    await bridge.executeActionsChain({
      action: {
        type: FRONTX_ACTION_MOUNT_EXT,
        target: FRONTX_SCREEN_DOMAIN,
        payload: { subject: HELLOWORLD_EXTENSION_ID },
      },
    });
  }, [bridge]);

  return (
    <div
      data-testid="widget-a-instance"
      data-instance-id={instanceId}
      data-instance-text={randomHex}
      className="m-2 rounded-lg border-2 border-blue-400 bg-blue-50 p-4 text-blue-900"
    >
      <strong>Widget A instance:</strong>{' '}
      <span data-testid="widget-a-random">{randomHex}</span>
      <p className="mt-1 text-xs opacity-75">instance-id: {instanceId}</p>
      <p
        className="mt-1 text-xs"
        data-testid="widget-a-last-ping"
        data-last-ping={lastPing ?? ''}
      >
        last ping: {lastPing ?? '—'}
      </p>
      <button
        type="button"
        data-testid="widget-a-mount-helloworld"
        className="mt-2 rounded border border-blue-400 bg-white px-3 py-1 text-sm font-medium text-blue-900 hover:bg-blue-100"
        onClick={handleMountHelloWorld}
      >
        Mount Hello World (shell, 2 hops up)
      </button>
    </div>
  );
}

class WidgetsFixtureALifecycle extends ThemeAwareReactLifecycle {
  constructor() {
    super(fixtureApp);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <WidgetA bridge={bridge} />;
  }

  override mount(container: Element | ShadowRoot, bridge: ChildMfeBridge): void {
    console.log(
      `[widget-a ${bridge.extensionId}] mount randomHex=${randomHex}`,
    );
    super.mount(container, bridge);
    // Register synchronously, before `mount()` returns: `DefaultMountManager`
    // treats a lifecycle's `mount()` completion as the signal that the
    // extension is reachable, and lets a chain's `next` continuation dispatch
    // as soon as it does. A React `useEffect` runs strictly after that point
    // (`createRoot().render()` only schedules work), so registering there,
    // as this fixture previously did, is reachable-too-late for a chained
    // ping step. See `lifecycle-profile.tsx` for the same pattern.
    bridge.registerActionHandler(
      PING_ACTION_TYPE,
      new PingHandler(bridge.extensionId),
    );
  }
}

export default new WidgetsFixtureALifecycle();
