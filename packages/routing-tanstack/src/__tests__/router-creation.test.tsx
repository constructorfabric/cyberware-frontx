import { beforeAll, describe, expect, it } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useBlocker,
  useNavigate,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {
  resolveNavigationHistory,
  type DomainKey,
  type EntryAddress,
  type ExtensionToken,
} from '@gears-frontx/routing';
import { adaptComposedHistory } from '../composed-history-source.js';
import { adaptStandaloneHistory } from '../standalone-history-source.js';
import { createProviderRouter, createEngineProviderRouter, EngineProvider } from '../router-creation.js';
import { resetRealm } from './helpers/index.js';

const ENTRY_ADDRESS: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };

// Every test below that actually mounts `EngineProvider` needs both of
// these: React's own `act()` warns when this flag is unset, and jsdom does
// not implement `scrollTo` — TanStack Router's own scroll restoration calls
// it after a successful load. Set once here, for the whole file, rather
// than repeated per test — `createProviderRouter`'s own tests above never
// mount anything, so setting these globally costs them nothing.
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
});

function buildRouteTree() {
  return createRootRoute({ component: () => 'root' });
}

/** Counts every registration `navigationHistory.subscribe` makes and every
 * one of those releases — the same counting wrapper the A2 unmount test
 * below already uses, factored out so the StrictMode and port-entry
 * teardown tests can share it. */
function countSubscriptions(navigationHistory: ReturnType<typeof resolveNavigationHistory>): { active: () => number } {
  let activeSubscriptions = 0;
  const originalSubscribe = navigationHistory.subscribe.bind(navigationHistory);
  navigationHistory.subscribe = (subscriber) => {
    activeSubscriptions += 1;
    const release = originalSubscribe(subscriber);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      activeSubscriptions -= 1;
      release();
    };
  };
  return { active: () => activeSubscriptions };
}

describe('createProviderRouter', () => {
  it('builds a router bound to the given routeTree and adapted virtual history', () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);
    const routeTree = buildRouteTree();

    const router = createProviderRouter(routeTree, history);

    expect(router.history).toBe(history);
    expect(router.routeTree).toBe(routeTree);
  });

  it('matches only its own virtual location, projected from the occupant entry', () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);
    const router = createProviderRouter(buildRouteTree(), history);

    expect(router.state.location.pathname).toBe('/settings/general');
  });
});

describe('EngineProvider', () => {
  it('mounts the constructed router into the component tree via RouterProvider', async () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);
    const routeTree = buildRouteTree();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<EngineProvider routeTree={routeTree} history={history} />);
    });

    expect(container.textContent).toBe('root');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('releases the internal NavigationHistory subscription exactly once on unmount (A2)', async () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const navigationHistory = resolveNavigationHistory();

    let activeSubscriptions = 0;
    const originalSubscribe = navigationHistory.subscribe.bind(navigationHistory);
    navigationHistory.subscribe = (subscriber) => {
      activeSubscriptions += 1;
      const release = originalSubscribe(subscriber);
      let released = false;
      return () => {
        // `release` is itself idempotent (`NavigationHistory`'s own
        // `ReleaseFunction` contract); this counting wrapper mirrors that,
        // so a second `destroy()` call — a case this same test exercises
        // below — does not double-decrement.
        if (released) {
          return;
        }
        released = true;
        activeSubscriptions -= 1;
        release();
      };
    };

    const history = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);
    expect(activeSubscriptions).toBe(1);

    const routeTree = buildRouteTree();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<EngineProvider routeTree={routeTree} history={history} />);
    });
    expect(activeSubscriptions).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();

    expect(activeSubscriptions).toBe(0);

    // A second teardown (the adapter's own `destroy` idempotence) must stay
    // safe even after the component's own unmount already called it once.
    expect(() => history.destroy()).not.toThrow();
    expect(activeSubscriptions).toBe(0);
  });

  // N1 — regression found by the 12-re review: React (18+) dev StrictMode
  // double-invokes an effect's setup/cleanup/setup on every mount. The
  // previous teardown effect only ever tore down (`() => history.destroy()`
  // in cleanup, nothing in setup), so the sequence left the mounted
  // router's own history with zero active substrate subscriptions —
  // navigation from outside this occupant (a sibling, back/forward, a deep
  // link) stopped reaching it for the rest of that mount, silently, in
  // every StrictMode-wrapped dev environment (Vite/CRA/Next default).
  // `attachAdaptedHistory` (`../history-adaptation.js`) re-establishes the
  // same registration `destroy()` released, making the two effect halves
  // true inverses regardless of how many times React runs them.
  it('ends a StrictMode mount with exactly one live subscription, and unmount with zero — composed mode (N1)', async () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const navigationHistory = resolveNavigationHistory();
    const subscriptions = countSubscriptions(navigationHistory);

    const history = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);
    expect(subscriptions.active()).toBe(1);

    const routeTree = buildRouteTree();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <EngineProvider routeTree={routeTree} history={history} />
        </StrictMode>,
      );
    });
    expect(subscriptions.active()).toBe(1);
    expect(container.textContent).toBe('root');

    await act(async () => {
      root.unmount();
    });
    container.remove();

    expect(subscriptions.active()).toBe(0);
  });

  it('ends a StrictMode mount with exactly one live subscription, and unmount with zero — standalone mode (N1)', async () => {
    resetRealm('/');
    const navigationHistory = resolveNavigationHistory();
    const subscriptions = countSubscriptions(navigationHistory);

    const history = adaptStandaloneHistory(navigationHistory);
    expect(subscriptions.active()).toBe(1);

    const routeTree = buildRouteTree();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <EngineProvider routeTree={routeTree} history={history} />
        </StrictMode>,
      );
    });
    expect(subscriptions.active()).toBe(1);
    expect(container.textContent).toBe('root');

    await act(async () => {
      root.unmount();
    });
    container.remove();

    expect(subscriptions.active()).toBe(0);
  });
});

// N2 — the 12-re review's own probe: `createEngineProviderRouter` (the
// engine-provider port's own conforming instance) builds and internally
// owns an adapted history that no plain `<RouterProvider router={router}/>`
// mount can ever tear down, reopening the A2 leak on the one export typed
// against the port. `EngineProvider`'s `{router}` overload (N1/N2 design:
// whoever the effect belongs to owns teardown) gives it the same lifecycle
// hook the `{routeTree, history}` overload already has.
describe('createEngineProviderRouter teardown (N2)', () => {
  it('reaches zero active subscriptions after unmount when mounted through EngineProvider({router})', async () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const navigationHistory = resolveNavigationHistory();
    const subscriptions = countSubscriptions(navigationHistory);
    const routeTree = buildRouteTree();

    const router = createEngineProviderRouter({ history: navigationHistory, entryAddress: ENTRY_ADDRESS, routeTree });
    expect(subscriptions.active()).toBe(1);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<EngineProvider router={router} />);
    });
    expect(subscriptions.active()).toBe(1);
    expect(container.textContent).toBe('root');

    await act(async () => {
      root.unmount();
    });
    container.remove();

    expect(subscriptions.active()).toBe(0);
  });
});

// re2 review L5: `EngineProvider`'s `{router}` overload commits to an
// unconditional contract — it owns the lifecycle of whatever `history` the
// given router carries, adapted by this package or not — documented at
// `createEngineProviderRouter`'s own "Teardown (N2)" comment and this
// overload's own doc comment above `EngineProviderFromRouterProps`.
describe('EngineProvider({router}) destroys a consumer-owned, non-adapted history too (L5)', () => {
  it('calls destroy() on unmount even for a router built outside this package, over a plain memory history', async () => {
    const consumerHistory = createMemoryHistory({ initialEntries: ['/'] });
    let destroyed = false;
    const originalDestroy = consumerHistory.destroy.bind(consumerHistory);
    consumerHistory.destroy = () => {
      destroyed = true;
      originalDestroy();
    };
    const router = createRouter({ routeTree: buildRouteTree(), history: consumerHistory });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<EngineProvider router={router} />);
    });
    expect(destroyed).toBe(false);

    await act(async () => {
      root.unmount();
    });
    container.remove();

    expect(destroyed).toBe(true);
  });
});

// re2 review L6: neither prop shape given is rejected at compile time by
// `EngineProvider`'s own overloads; this exercises the runtime guard that
// exists for a caller who bypasses them (a plain JavaScript consumer, or an
// `as`-cast past the union), so that case fails with a clear message
// instead of an opaque TanStack internal error.
describe('EngineProvider guards against neither prop shape being given (L6)', () => {
  it('throws a clear error instead of letting TanStack fail on a missing router/history', () => {
    const bypassed = EngineProvider as unknown as (props: Record<string, never>) => unknown;
    expect(() => bypassed({})).toThrow(/EngineProvider requires/);
  });
});

// Residual noted by the 12-re review: the only place `useBlocker` (a
// consumer's own blocking route guard) was exercised end to end through
// this adapted history was an out-of-tree probe
// (`review12/re/probe/probe.test.tsx`), not this package's own suite.
// Ported here verbatim in substance — same route tree shape, same
// blocked/unblocked assertions — so the guarantee A1 documents (`block`
// stops only a navigation issued through this same constructed router's
// own `RouterHistory`) stays covered by this package's own tests.
describe('useBlocker end to end through the adapted history', () => {
  function buildBlockableRouteTree(blockerCalls: unknown[], shouldBlock: () => boolean) {
    // Named (capitalized) rather than an inline arrow assigned to
    // `component:` — `react-hooks/rules-of-hooks` requires a function
    // calling a Hook to read as a component (capitalized) or a custom Hook
    // (`use`-prefixed) by its own name, which an anonymous arrow is not.
    function GeneralRoute(): string {
      useBlocker({
        shouldBlockFn: (args) => {
          blockerCalls.push(args);
          return shouldBlock();
        },
        enableBeforeUnload: false,
      });
      const navigate = useNavigate();
      (globalThis as Record<string, unknown>).__engineProviderProbeNavigate = navigate;
      return 'general';
    }
    const root = createRootRoute({ component: () => <Outlet /> });
    const general = createRoute({ getParentRoute: () => root, path: '/settings/general', component: GeneralRoute });
    const profile = createRoute({ getParentRoute: () => root, path: '/settings/profile', component: () => 'profile' });
    return root.addChildren([general, profile]);
  }

  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  it('blocks a navigate() when shouldBlockFn returns true: no write, view unchanged', async () => {
    const adapter = resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);
    const calls: unknown[] = [];
    const router = createProviderRouter(buildBlockableRouteTree(calls, () => true), history);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    expect(container.textContent).toBe('general');

    await act(async () => {
      (globalThis as unknown as { __engineProviderProbeNavigate: (opts: { to: string }) => void }).__engineProviderProbeNavigate({
        to: '/settings/profile',
      });
      await settle();
    });

    expect(calls).toHaveLength(1);
    expect((calls[0] as { action: string }).action).toBe('PUSH');
    expect(adapter.lastWrite).toBeUndefined();
    expect(container.textContent).toBe('general');
    expect(router.state.location.pathname).toBe('/settings/general');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    history.destroy();
  });

  it('lets a navigate() through when shouldBlockFn returns false: the write reaches the shared history', async () => {
    const adapter = resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);
    const calls: unknown[] = [];
    const router = createProviderRouter(buildBlockableRouteTree(calls, () => false), history);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    await act(async () => {
      (globalThis as unknown as { __engineProviderProbeNavigate: (opts: { to: string }) => void }).__engineProviderProbeNavigate({
        to: '/settings/profile',
      });
      await settle();
    });

    expect(calls).toHaveLength(1);
    expect(adapter.lastWrite).toBe('/en?screen=dashboard;route=settings/profile');
    expect(container.textContent).toBe('profile');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    history.destroy();
  });
});
