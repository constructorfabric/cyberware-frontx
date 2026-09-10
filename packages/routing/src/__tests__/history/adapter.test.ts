import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowHistoryAdapter } from '../../history/adapter.js';

// nav FEATURE (navigation-substrate) §1.5, "Observed browser events": the
// adapter's `onPop` listens for `popstate` only — a fragment-only
// navigation already raises `popstate`, so also listening for `hashchange`
// would deliver that identical navigation twice. This suite runs under
// vitest's `node` environment (no jsdom), so `window` is stubbed with a
// minimal fake carrying only what `createWindowHistoryAdapter` actually
// reads: `location`, `history`, and `addEventListener`/`removeEventListener`.

interface FakeWindow {
  location: { pathname: string; search: string; hash: string };
  history: {
    pushState: (data: unknown, unused: string, url?: string | null) => void;
    replaceState: (data: unknown, unused: string, url?: string | null) => void;
    go: (delta?: number) => void;
  };
  listeners: Map<string, Set<() => void>>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

function createFakeWindow(): FakeWindow {
  const listeners = new Map<string, Set<() => void>>();
  return {
    location: { pathname: '/en', search: '', hash: '' },
    history: {
      pushState: vi.fn(),
      replaceState: vi.fn(),
      go: vi.fn(),
    },
    listeners,
    addEventListener(type: string, listener: () => void): void {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      listeners.get(type)?.delete(listener);
    },
  };
}

function installFakeWindow(): FakeWindow {
  const fakeWindow = createFakeWindow();
  (globalThis as Record<string, unknown>).window = fakeWindow;
  return fakeWindow;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('createWindowHistoryAdapter — onPop', () => {
  it('registers a "popstate" listener, not "hashchange"', () => {
    const fakeWindow = installFakeWindow();
    const adapter = createWindowHistoryAdapter();

    adapter.onPop(() => undefined);

    expect(fakeWindow.listeners.get('popstate')?.size).toBe(1);
    expect(fakeWindow.listeners.has('hashchange')).toBe(false);
  });

  it('invokes the listener exactly once when "popstate" fires, even for a fragment-only navigation', () => {
    const fakeWindow = installFakeWindow();
    const adapter = createWindowHistoryAdapter();
    const listener = vi.fn();

    adapter.onPop(listener);
    for (const registered of fakeWindow.listeners.get('popstate') ?? []) {
      registered();
    }

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('the returned release function removes the "popstate" listener and nothing else', () => {
    const fakeWindow = installFakeWindow();
    const adapter = createWindowHistoryAdapter();

    const release = adapter.onPop(() => undefined);
    release();

    expect(fakeWindow.listeners.get('popstate')?.size).toBe(0);
  });
});

describe('createWindowHistoryAdapter — getLocation', () => {
  it('strips the leading "?" and "#" from search and hash', () => {
    const fakeWindow = installFakeWindow();
    fakeWindow.location = { pathname: '/en', search: '?screen=dashboard', hash: '#top' };

    const adapter = createWindowHistoryAdapter();

    expect(adapter.getLocation()).toEqual({ path: '/en', search: 'screen=dashboard', hash: 'top' });
  });

  it('reports an empty search/hash as "" when neither is present', () => {
    installFakeWindow();
    const adapter = createWindowHistoryAdapter();

    expect(adapter.getLocation()).toEqual({ path: '/en', search: '', hash: '' });
  });
});

describe('createWindowHistoryAdapter — pushState/replaceState/go', () => {
  it('pushState delegates to window.history.pushState with a null state and empty title', () => {
    const fakeWindow = installFakeWindow();
    const adapter = createWindowHistoryAdapter();

    adapter.pushState('/fr?screen=settings');

    expect(fakeWindow.history.pushState).toHaveBeenCalledWith(null, '', '/fr?screen=settings');
  });

  it('replaceState delegates to window.history.replaceState with a null state and empty title', () => {
    const fakeWindow = installFakeWindow();
    const adapter = createWindowHistoryAdapter();

    adapter.replaceState('/fr');

    expect(fakeWindow.history.replaceState).toHaveBeenCalledWith(null, '', '/fr');
  });

  it('go delegates to window.history.go with the given delta', () => {
    const fakeWindow = installFakeWindow();
    const adapter = createWindowHistoryAdapter();

    adapter.go(-1);

    expect(fakeWindow.history.go).toHaveBeenCalledWith(-1);
  });
});
