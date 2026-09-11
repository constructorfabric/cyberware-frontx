import { describe, expect, it, vi } from 'vitest';
import {
  parseGrammar,
  resolveNavigationHistory,
  serializeGrammar,
  type DomainKey,
  type EntryAddress,
  type ExtensionToken,
} from '@gears-frontx/routing';
import { adaptComposedHistory, createComposedVirtualLocationSource } from '../composed-history-source.js';
import { adaptVirtualLocationHistory, attachAdaptedHistory } from '../history-adaptation.js';
import { resetRealm } from './helpers/index.js';

// FEATURE example 7.3, the acceptance scenario this task's implementation
// MUST reproduce (engine-provider FEATURE §1.5, §6):
//   /en?screen=dashboard;route=settings/general;orientation=left
//      &sheet=tenant-details;route=contacts;tenantId=456
const EXAMPLE_7_3_URL =
  '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=456';

const DASHBOARD_ENTRY_ADDRESS: EntryAddress = {
  domainKey: 'screen' as DomainKey,
  extension: 'dashboard' as ExtensionToken,
};

describe('example 7.3 (MUST) — the dashboard occupant', () => {
  it('projects pathname /settings/general and search orientation=left', () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    expect(history.location.pathname).toBe('/settings/general');
    expect(history.location.search).toBe('?orientation=left');
    expect(adapter.lastWrite).toBeUndefined();
  });

  it('writes back only the dashboard occupant, leaving the tenant-details entry untouched', () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    history.push('/settings/profile?orientation=left');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/profile;orientation=left&sheet=tenant-details;route=contacts;tenantId=456',
    );
  });
});

// D1 — the reviewer ledger's own lettered scenario (e), verbatim
// (`pr-585-routing-query-grammar.md` rows 10/11v-A): starting from example
// 7.3's composed URL, the dashboard occupant navigates to a virtual
// location whose search carries a *different* key than the one it replaces
// — `tab=2` in place of `orientation=left` — so this is the one case the
// rest of this file's tests do not already cover verbatim: every other
// push/replace test here keeps `orientation` across the navigation, which
// would pass even a write-back that merged the new search into the old one
// instead of replacing it outright.
describe('scenario (e) — a virtual push whose search carries a different key entirely', () => {
  it('yields /en?screen=dashboard;route=settings/billing;tab=2, orientation dropped, sibling untouched', () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    history.push('/settings/billing?tab=2');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/billing;tab=2&sheet=tenant-details;route=contacts;tenantId=456',
    );
    expect(history.location.pathname).toBe('/settings/billing');
    expect(history.location.search).toBe('?tab=2');
  });
});

describe('single-write invariant', () => {
  it('push issues exactly one write to the shared history', () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    let writes = 0;
    const originalPushState = adapter.pushState.bind(adapter);
    adapter.pushState = (path: string) => {
      writes += 1;
      originalPushState(path);
    };

    history.push('/x?a=1');
    expect(writes).toBe(1);
  });

  it('replace issues exactly one write to the shared history', () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    let writes = 0;
    const originalReplaceState = adapter.replaceState.bind(adapter);
    adapter.replaceState = (path: string) => {
      writes += 1;
      originalReplaceState(path);
    };

    history.replace('/x?a=1');
    expect(writes).toBe(1);
  });
});

describe('createHref', () => {
  it('composes the full composed-application URL via the grammar serializer, never by concatenation', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);

    const href = history.createHref('/settings/profile?orientation=left');

    const { shellSubroute, hash, entries } = parseGrammar(EXAMPLE_7_3_URL);
    const expected = serializeGrammar({
      shellSubroute,
      hash,
      entries: entries.map((e) =>
        e.domainKey === DASHBOARD_ENTRY_ADDRESS.domainKey && e.extension === DASHBOARD_ENTRY_ADDRESS.extension
          ? { ...e, params: [{ name: 'route', value: 'settings/profile' }, { name: 'orientation', value: 'left' }] }
          : e,
      ),
    });
    expect(href).toBe(expected);
  });
});

// F8/D3 (review round 16-re, ruling): `length`/`canGoBack` are derived from
// the navigation substrate's own `Location.position`
// (`cpt-frontx-algo-routing-navigation-substrate-position-tracking`), never
// a counter this adapter keeps of its own. `length` therefore matches a
// real browser's own `history.length` semantics: 1 for the cold-mount
// entry alone, growing by one per push, exactly as `position + 1` — not
// "count of pushes issued", which started at 0 under the old, removed
// provider-local counter.
describe('length and canGoBack', () => {
  it('reports length as position + 1 (real-history semantics: 1 for the cold-mount entry alone)', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
    );

    expect(history.length).toBe(1);
    history.push('/a');
    expect(history.length).toBe(2);
    history.replace('/b');
    expect(history.length).toBe(2);
    history.push('/c');
    expect(history.length).toBe(3);
  });

  it('reports canGoBack true exactly once a virtual push has been issued', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
    );

    expect(history.canGoBack()).toBe(false);
    history.push('/a');
    expect(history.canGoBack()).toBe(true);
  });

  // N3: A5 (`composed-history-source.ts`) makes `source.write` a no-op once
  // this occupant's own entry is no longer present — a push that reaches no
  // history at all never calls `navigationHistory.push`, so the
  // substrate's own position — and this adapter's own `length`/`canGoBack`,
  // derived from it — stay exactly where they already were.
  it('does not advance length when the occupant own entry is absent (N3)', () => {
    const adapter = resetRealm('/en?sheet=tenant-details;route=contacts;tenantId=456');
    const navigationHistory = resolveNavigationHistory();
    const history = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
    );

    expect(history.length).toBe(1);
    history.push('/a');

    expect(adapter.lastWrite).toBeUndefined();
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });

  // D3: a `forward()`/`go(+n)` past the real end of the stack must not
  // inflate `length` — the FakeHistoryAdapter's own `go` is a silent no-op
  // past either end (mirroring a real browser), so no `popstate` fires and
  // the substrate's own position is never touched by it.
  it('does not inflate length on a forward step past the real end of the stack (D3)', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);
    history.push('/settings/profile?orientation=left');
    expect(history.length).toBe(2);

    history.forward();
    history.forward();
    history.forward();
    await flushMicrotasks();

    expect(history.length).toBe(2);
    expect(history.canGoBack()).toBe(true);
  });

  // F8: an external `go(-1)` (a real back/forward step, or a third-party
  // `history.go`) that lands this occupant back at the root must report
  // `canGoBack: false` there, not `true` — the original symptom, caused by
  // the removed `window.history.length > 1` fallback.
  it('reports canGoBack false at the root after an external go(-1), not the removed window-length fallback', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);
    history.push('/settings/profile?orientation=left');
    expect(history.canGoBack()).toBe(true);

    navigationHistory.go(-1);
    await flushMicrotasks();

    expect(history.canGoBack()).toBe(false);
    expect(history.length).toBe(1);
  });

  // Two routers constructed over the identical shared history must agree
  // on `length`/`canGoBack` — both derive from the one substrate-owned
  // position, never a per-router counter that could drift between them.
  it('two routers over one shared history report the identical length and canGoBack', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const first = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
    );
    const second = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
    );

    first.push('/a');

    expect(second.length).toBe(first.length);
    expect(second.canGoBack()).toBe(first.canGoBack());
    expect(second.length).toBe(2);
  });
});

describe('back/forward pop propagation into subscribers', () => {
  it('reprojects the virtual location and notifies subscribers on a browser-observed back step', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);

    // Advance the real underlying stack once, through this adapter's own
    // push, so a later `go(-1)` has somewhere to land.
    history.push('/settings/profile?orientation=left');
    expect(history.location.pathname).toBe('/settings/profile');

    const received: unknown[] = [];
    history.subscribe((args) => received.push(args));

    history.back();
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    const args = received[0] as { location: { pathname: string; search: string }; action: { type: string } };
    expect(args.location.pathname).toBe('/settings/general');
    expect(args.location.search).toBe('?orientation=left');
    expect(args.action).toEqual({ type: 'GO', index: 0 });
    expect(history.location.pathname).toBe('/settings/general');
  });

  it('does not notify a subscriber once unsubscribed', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);
    history.push('/settings/profile?orientation=left');

    const received: unknown[] = [];
    const unsubscribe = history.subscribe((args) => received.push(args));
    unsubscribe();

    history.back();
    await flushMicrotasks();

    expect(received).toHaveLength(0);
  });
});

describe('own entry absent from the URL (FEATURE §3, step 7)', () => {
  it('keeps the last-projected virtual location and does not notify subscribers', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);
    const lastLocation = history.location;

    const received: unknown[] = [];
    history.subscribe((args) => received.push(args));

    // A structural change that drops the dashboard occupant's own entry
    // entirely, observed as a third-party addition (e.g. a back step past
    // it, or a sibling's own structural reset).
    adapter.simulateExternalPop('/en?sheet=tenant-details;route=contacts;tenantId=456');
    await flushMicrotasks();

    expect(received).toHaveLength(0);
    expect(history.location).toBe(lastLocation);
  });
});

describe('block (recognized, degraded adaptation)', () => {
  it('registers and releases a blocker through _getBlockers', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    const blocker = { blockerFn: () => true };
    const release = history.block(blocker);
    expect(history._getBlockers()).toEqual([blocker]);

    release();
    expect(history._getBlockers()).toEqual([]);
  });

  it('does not stop a navigation performed directly through the shared NavigationHistory', () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.block({ blockerFn: () => false });

    // A block registered here is this adapter's own bookkeeping only
    // (FEATURE §3, step 5) — it has no effect on a write another unit
    // issues straight through the shared history, since only the
    // constructed router's own machinery ever consults `_getBlockers()`.
    resolveNavigationHistory().push('/en?screen=other');
    expect(adapter.lastWrite).toBe('/en?screen=other');
  });
});

describe('block actually enforced on push/replace issued through this same RouterHistory (A1)', () => {
  it('a blocker returning true stops a push: no write, length unchanged', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.block({ blockerFn: () => true });

    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(adapter.lastWrite).toBeUndefined();
    expect(history.length).toBe(1);
  });

  it('a blocker returning true stops a replace: no write issued', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.block({ blockerFn: () => true });

    history.replace('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(adapter.lastWrite).toBeUndefined();
  });

  it('a blocker returning false lets the push through', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.block({ blockerFn: () => false });

    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/profile;orientation=left&sheet=tenant-details;route=contacts;tenantId=456',
    );
    expect(history.length).toBe(2);
  });

  it('{ ignoreBlocker: true } bypasses a registered blocker', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.block({ blockerFn: () => true });

    history.push('/settings/profile?orientation=left', undefined, { ignoreBlocker: true });
    await flushMicrotasks();

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/profile;orientation=left&sheet=tenant-details;route=contacts;tenantId=456',
    );
  });

  it('the blocker receives currentLocation, nextLocation and the action', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    const received: unknown[] = [];
    history.block({
      blockerFn: (args) => {
        received.push(args);
        return false;
      },
    });

    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    const args = received[0] as {
      currentLocation: { pathname: string };
      nextLocation: { pathname: string; state: { __TSR_index: number } };
      action: string;
    };
    expect(args.currentLocation.pathname).toBe('/settings/general');
    expect(args.nextLocation.pathname).toBe('/settings/profile');
    expect(args.action).toBe('PUSH');
    // LOW (review round 16-re2): a push always lands one entry past the
    // current one — the blocker's own preview of `__TSR_index` has to
    // reflect that in advance, mirroring `@tanstack/history`'s own
    // `currentIndex + 1` for a push (history-adaptation.ts, buildHistoryLocation
    // callsite in tryNavigation).
    expect(args.nextLocation.state.__TSR_index).toBe(1);
  });

  it('a replace previews __TSR_index at the current position, not one past it', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    const received: unknown[] = [];
    history.block({
      blockerFn: (args) => {
        received.push(args);
        return false;
      },
    });

    history.replace('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(received).toHaveLength(1);
    const args = received[0] as {
      nextLocation: { state: { __TSR_index: number } };
      action: string;
    };
    expect(args.action).toBe('REPLACE');
    // A replace overwrites the current entry in place, so the preview
    // must carry the *current* position, not `position + 1`.
    expect(args.nextLocation.state.__TSR_index).toBe(0);
  });

  it('does not gate a bare go() call (no blocker check for back/forward)', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();
    expect(history.location.pathname).toBe('/settings/profile');

    let blockerCalled = false;
    history.block({
      blockerFn: () => {
        blockerCalled = true;
        return true;
      },
    });

    history.back();
    await flushMicrotasks();

    expect(blockerCalled).toBe(false);
    expect(history.location.pathname).toBe('/settings/general');
  });
});

// re2 review L1: a re-attach that follows a *real* gap (as opposed to
// React StrictMode's synchronous setup/cleanup/setup, where no
// substrate-level navigation can occur in between) must not leave
// `location` stale until the next fan-out — a substrate navigation while
// this history was detached is exactly the case `attachAdaptedHistory`
// exists to reconcile.
describe('attachAdaptedHistory re-projects location after a real detach gap (L1)', () => {
  it('reflects a substrate navigation that happened while detached, without waiting for the next fan-out', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);
    expect(history.location.pathname).toBe('/settings/general');

    history.destroy();
    // A navigation this occupant's own history is not subscribed to
    // observe — the gap `destroy()`/`attachAdaptedHistory` can span.
    navigationHistory.push('/en?screen=dashboard;route=settings/profile;orientation=left');

    attachAdaptedHistory(history);

    expect(history.location.pathname).toBe('/settings/profile');
  });
});

// F5: subscriber fan-out isolates each subscriber's own error, mirroring
// the core's own `FanOutDispatcher` — a throwing subscriber must not stop
// delivery to the subscribers registered after it in the same round.
describe('subscriber error isolation (F5)', () => {
  it('a throwing subscriber does not stop delivery to the next one', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const reported: unknown[] = [];
    const secondCalled = { value: false };
    const history = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
      { reportError: (error) => reported.push(error) },
    );

    history.subscribe(() => {
      throw new Error('first subscriber exploded');
    });
    history.subscribe(() => {
      secondCalled.value = true;
    });

    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(secondCalled.value).toBe(true);
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe('first subscriber exploded');
  });

  it('reports through the default reportError channel (console.error) when none is supplied', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, DASHBOARD_ENTRY_ADDRESS);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    history.subscribe(() => {
      throw new Error('boom');
    });
    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

// F6: a rejecting or throwing blocker must not become a genuine unhandled
// promise rejection — treated as blocking the navigation, and reported
// rather than silently swallowed.
describe('rejected/throwing blocker (F6)', () => {
  it('a rejected blocker blocks the navigation and is reported, not left as an unhandled rejection', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const reported: unknown[] = [];
    const history = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
      { reportError: (error) => reported.push(error) },
    );
    const failure = new Error('blocker exploded');
    history.block({ blockerFn: () => Promise.reject(failure) });

    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(adapter.lastWrite).toBeUndefined();
    expect(reported).toEqual([failure]);
  });

  it('a synchronously throwing blocker blocks the navigation and is reported', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const navigationHistory = resolveNavigationHistory();
    const reported: unknown[] = [];
    const history = adaptVirtualLocationHistory(
      navigationHistory,
      createComposedVirtualLocationSource(navigationHistory, DASHBOARD_ENTRY_ADDRESS),
      { reportError: (error) => reported.push(error) },
    );
    history.block({
      blockerFn: () => {
        throw new Error('synchronous blocker failure');
      },
    });

    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(adapter.lastWrite).toBeUndefined();
    expect(reported).toHaveLength(1);
  });

  // F6 (review round 16-re): `reportError` must reach a blocker failure
  // through the public wrapper a consumer actually calls, not only through
  // `adaptVirtualLocationHistory` directly — proving the forwarding chain
  // `adaptComposedHistory` -> `adaptVirtualLocationHistory` end to end.
  it('a wrapper entry point (adaptComposedHistory) forwards reportError to a throwing blocker', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const reported: unknown[] = [];
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS, {
      reportError: (error) => reported.push(error),
    });
    history.block({
      blockerFn: () => {
        throw new Error('wrapper-forwarded blocker failure');
      },
    });

    history.push('/settings/profile?orientation=left');
    await flushMicrotasks();

    expect(adapter.lastWrite).toBeUndefined();
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe('wrapper-forwarded blocker failure');
  });

  it('an async blocker that genuinely awaits still gates the navigation correctly', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.block({
      blockerFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return true;
      },
    });

    history.push('/settings/profile?orientation=left');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.lastWrite).toBeUndefined();
  });

  it('an async blocker that genuinely awaits and resolves false lets the navigation through', async () => {
    const adapter = resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    history.block({
      blockerFn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return false;
      },
    });

    history.push('/settings/profile?orientation=left');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/profile;orientation=left&sheet=tenant-details;route=contacts;tenantId=456',
    );
  });
});

// F7: a hash given to `navigate`/`Link`/`createHref` is applied to the
// page's own hash, never to this entry.
describe('hash on push/createHref (F7)', () => {
  it('applies a given hash to the page hash on push', () => {
    const adapter = resetRealm(`${EXAMPLE_7_3_URL}#old`);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    history.push('/settings/profile?orientation=left#new');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/profile;orientation=left&sheet=tenant-details;route=contacts;tenantId=456#new',
    );
  });

  it('preserves the current page hash when none is given', () => {
    const adapter = resetRealm(`${EXAMPLE_7_3_URL}#current`);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    history.push('/settings/profile?orientation=left');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/profile;orientation=left&sheet=tenant-details;route=contacts;tenantId=456#current',
    );
  });

  it('createHref includes a given hash', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    expect(history.createHref('/settings/profile?orientation=left#new')).toBe(
      '/en?screen=dashboard;route=settings/profile;orientation=left&sheet=tenant-details;route=contacts;tenantId=456#new',
    );
  });
});

// F8/D3 (review round 16-re, ruling): `length`/`canGoBack` track the
// navigation substrate's own `Location.position` across push/back/
// forward/go sequences — restored from the browser's own persisted
// per-entry state on each `popstate` (`./navigation-history.js`'s own
// Position Tracking), asynchronously, exactly as any other externally
// observed navigation is (§1.5, Contract commitment) — never a
// synchronously self-adjusted local counter the way the removed
// `virtualIndex` was.
describe('substrate-owned position across push/back/forward/go (F8/D3)', () => {
  it('advances on push, retreats on back, advances on forward, follows go — all confirmed asynchronously', async () => {
    resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);

    history.push('/settings/a?orientation=left');
    expect(history.length).toBe(2);
    expect(history.canGoBack()).toBe(true);

    history.push('/settings/b?orientation=left');
    expect(history.length).toBe(3);

    history.back();
    await flushMicrotasks();
    expect(history.length).toBe(2);
    expect(history.canGoBack()).toBe(true);

    history.back();
    await flushMicrotasks();
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);

    // Past the start: the underlying adapter's own `go` is a silent no-op
    // past either end of the real stack (mirroring a real browser) — no
    // `popstate` fires, so position stays exactly where it already was.
    history.back();
    await flushMicrotasks();
    expect(history.length).toBe(1);

    history.forward();
    await flushMicrotasks();
    expect(history.length).toBe(2);

    history.go(1);
    await flushMicrotasks();
    expect(history.length).toBe(3);
  });

  it('replace does not move the position', () => {
    resetRealm(EXAMPLE_7_3_URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);

    history.push('/settings/a?orientation=left');
    expect(history.length).toBe(2);

    history.replace('/settings/b?orientation=left');
    expect(history.length).toBe(2);
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}
