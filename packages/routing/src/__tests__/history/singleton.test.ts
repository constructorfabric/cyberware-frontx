import { afterEach, describe, expect, it } from 'vitest';
import { NAVIGATION_HISTORY_KEY, resolveNavigationHistory } from '../../history/singleton.js';
import { RoutingError } from '../../errors.js';
import { FakeHistoryAdapter } from './fake-history-adapter.js';

// FEATURE (navigation-substrate) §3, Realm-Global Singleton Resolution.

describe('resolveNavigationHistory', () => {
  it('constructs an instance on first call and stores it on the realm global', () => {
    delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];

    const history = resolveNavigationHistory(() => new FakeHistoryAdapter('/en'));

    expect((globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY]).toBe(history);
  });

  it('reuses the realm-global instance on a later call, ignoring the adapter factory given then', () => {
    delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];

    const first = resolveNavigationHistory(() => new FakeHistoryAdapter('/en'));
    const second = resolveNavigationHistory(() => new FakeHistoryAdapter('/fr'));

    expect(second).toBe(first);
    expect(second.location.path).toBe('/en');
  });

  it('a push through the instance resolved by one caller is observed by a second resolving caller sharing the same realm', () => {
    delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];

    const first = resolveNavigationHistory(() => new FakeHistoryAdapter('/en'));
    first.push('/fr?screen=settings');

    const second = resolveNavigationHistory(() => new FakeHistoryAdapter('/should-not-be-used'));

    expect(second.location).toEqual({ path: '/fr', search: 'screen=settings', hash: '' });
  });

  // FEATURE §3, Realm-Global Singleton Resolution, Rationale: "a copy built
  // against an incompatible future or past contract version resolves under
  // its own key and constructs its own instance instead of silently
  // capturing and reusing one whose shape it cannot actually satisfy".
  // `resolveNavigationHistory` always keys off `v1` (the current contract
  // major); this probes that a value already sitting under a different
  // version's own well-known key is neither read as, nor clobbered by, the
  // `v1` instance this call resolves.
  it('resolution keys off its own contract version, leaving a different version\'s own key untouched', () => {
    const v2Key = Symbol.for('@gears-frontx/routing/navigation-history/v2');
    const realm = globalThis as Record<PropertyKey, unknown>;
    delete realm[NAVIGATION_HISTORY_KEY as unknown as string];

    // Stands in for an incompatible future contract's own already-resolved
    // instance — a shape this package's own `v1` code must never touch.
    const v2Sentinel = { incompatibleShape: true };
    realm[v2Key as unknown as string] = v2Sentinel;

    const v1 = resolveNavigationHistory(() => new FakeHistoryAdapter('/en'));

    expect(v1).not.toBe(v2Sentinel);
    expect(realm[NAVIGATION_HISTORY_KEY as unknown as string]).toBe(v1);
    expect(realm[v2Key as unknown as string]).toBe(v2Sentinel);

    delete realm[v2Key as unknown as string];
  });

  describe('default adapter', () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).window;
      delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];
    });

    it('builds the browser window adapter when called with no argument at all', () => {
      // `resolveNavigationHistory()` with zero arguments exercises the
      // default-parameter path (`createAdapter: () => HistoryAdapter =
      // createWindowHistoryAdapter`) that every other test in this file
      // bypasses by always passing its own fake adapter factory.
      (globalThis as Record<string, unknown>).window = {
        location: { pathname: '/en', search: '?screen=dashboard', hash: '' },
        history: { pushState: () => undefined, replaceState: () => undefined, go: () => undefined },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
      delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];

      const history = resolveNavigationHistory();

      expect(history.location).toEqual({ path: '/en', search: 'screen=dashboard', hash: '' });
    });

    // F1 (review scope): resolving with no adapter override, in a realm with
    // no `window` at all, used to fail deep inside the default adapter's own
    // construction with a raw `ReferenceError: window is not defined` — a
    // real SSR realm never defines `window`, so this is the actual failure
    // path an SSR caller that forgot to pass its own adapter would hit.
    it('throws a RoutingError, not a raw ReferenceError, when called with no argument and no window', () => {
      expect(typeof window).toBe('undefined');
      delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];

      let caught: unknown;
      try {
        resolveNavigationHistory();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(RoutingError);
      expect((caught as RoutingError).code).toBe('no-navigation-history-in-realm');
      // Nothing was stored under the well-known key for a failed resolution.
      expect((globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string]).toBeUndefined();
    });

    it('does not throw when a custom adapter override is given, even with no window', () => {
      expect(typeof window).toBe('undefined');
      delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];

      expect(() => resolveNavigationHistory(() => new FakeHistoryAdapter('/en'))).not.toThrow();
    });
  });
});
