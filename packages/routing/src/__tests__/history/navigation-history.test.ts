import { describe, expect, it, vi } from 'vitest';
import { createNavigationHistory } from '../../history/navigation-history.js';
import { FakeHistoryAdapter } from './fake-history-adapter.js';

// FEATURE (navigation-substrate) §2, Imperative Navigation Outside The UI
// Tree; §3, Realm-Global Singleton Resolution, step 2.1 (construction reads
// the adapter's current location so a reader who never subscribes still sees
// a live value).

describe('createNavigationHistory — construction', () => {
  it('exposes the adapter current location at construction', () => {
    const adapter = new FakeHistoryAdapter('/en?screen=dashboard#top');
    const history = createNavigationHistory(adapter);

    expect(history.location).toEqual({ path: '/en', search: 'screen=dashboard', hash: 'top', position: 0 });
  });
});

// FEATURE §3, Fan-Out Subscription Dispatch, step 3: `push`/`replace` dispatch
// the fan-out directly, without depending on a `popstate` event.
describe('createNavigationHistory — push/replace', () => {
  it('push appends a history entry through the adapter and updates location', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);

    history.push('/fr?screen=settings');

    expect(history.location).toEqual({ path: '/fr', search: 'screen=settings', hash: '', position: 1 });
  });

  it('replace overwrites the current entry through the adapter', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);

    history.replace('/fr');

    expect(history.location).toEqual({ path: '/fr', search: '', hash: '', position: 0 });
  });

  it('push dispatches a "push" notification synchronously to subscribers, with location already updated', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    const subscriber = vi.fn();
    history.subscribe(subscriber);

    history.push('/fr?screen=settings');

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith({
      location: { path: '/fr', search: 'screen=settings', hash: '', position: 1 },
      kind: 'push',
    });
  });

  it('replace dispatches a "replace" notification synchronously to subscribers', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    const subscriber = vi.fn();
    history.subscribe(subscriber);

    history.replace('/fr');

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith({
      location: { path: '/fr', search: '', hash: '', position: 0 },
      kind: 'replace',
    });
  });
});

// FEATURE §3, Fan-Out Subscription Dispatch, step 2: a `go` call is observed
// asynchronously through the underlying browser subscription, never
// dispatched directly at its own call site (§1.5, Contract commitment).
describe('createNavigationHistory — go', () => {
  it('go does not dispatch synchronously', () => {
    const adapter = new FakeHistoryAdapter('/en');
    adapter.pushState('/fr');
    const history = createNavigationHistory(adapter);
    const subscriber = vi.fn();
    history.subscribe(subscriber);

    history.go(-1);

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('go is observed as a "history" notification once the underlying pop fires', async () => {
    const adapter = new FakeHistoryAdapter('/en');
    adapter.pushState('/fr');
    const history = createNavigationHistory(adapter);
    const subscriber = vi.fn();
    history.subscribe(subscriber);

    history.go(-1);
    await vi.waitFor(() => expect(subscriber).toHaveBeenCalledTimes(1));

    expect(subscriber).toHaveBeenCalledWith({
      location: { path: '/en', search: '', hash: '', position: 0 },
      kind: 'history',
    });
  });
});

describe('createNavigationHistory — subscribe release', () => {
  it('the returned release function stops further notifications', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    const subscriber = vi.fn();
    const release = history.subscribe(subscriber);

    release();
    history.push('/fr');

    expect(subscriber).not.toHaveBeenCalled();
  });
});

// FEATURE §3, Position Tracking (`cpt-frontx-algo-routing-navigation-substrate-position-tracking`,
// ruling F8/D3, review round 16-re): the substrate itself, not a
// provider-local counter, owns the current entry's own position.
describe('createNavigationHistory — position tracking', () => {
  it('starts at 0 for a cold mount (no recorded position on the current entry)', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);

    expect(history.location.position).toBe(0);
  });

  it('advances by one over the previous position on each push', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);

    history.push('/a');
    history.push('/b');
    history.push('/c');

    expect(history.location.position).toBe(3);
  });

  it('leaves the position unchanged on replace', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);

    history.push('/a');
    history.replace('/a-edited');

    expect(history.location.position).toBe(1);
  });

  it('restores the position from the browser-persisted state on an externally observed back step', async () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    history.push('/a');
    history.push('/b');
    expect(history.location.position).toBe(2);

    history.go(-1);
    await vi.waitFor(() => expect(history.location.position).toBe(1));

    expect(history.location).toEqual({ path: '/a', search: '', hash: '', position: 1 });
  });

  it('does not inflate past the real end of the stack on a forward step past it (no unbounded drift)', async () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    history.push('/a');
    history.go(-1);
    await vi.waitFor(() => expect(history.location.position).toBe(0));

    // A `go` past either end of the real stack is a silent no-op
    // (`FakeHistoryAdapter#go`, mirroring a real browser) — no `popstate`
    // fires, so position is never touched by it.
    history.go(5);

    // Give any spurious pop a microtask to (not) fire.
    await Promise.resolve();
    expect(history.location.position).toBe(0);
  });

  it('treats an entry a third party added, with no position of this substrate\'s own, as position 0', async () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    history.push('/a');
    expect(history.location.position).toBe(1);

    adapter.simulateExternalPop('/b');
    await vi.waitFor(() => expect(history.location.path).toBe('/b'));

    expect(history.location.position).toBe(0);
  });

  it('records the cold-mount default position lazily, only on this instance\'s own next write, not at construction', () => {
    const adapter = new FakeHistoryAdapter('/en');
    createNavigationHistory(adapter);

    expect(adapter.getState()).toBeUndefined();
  });

  it('push writes position into a fresh per-entry state, never carrying the previous entry\'s own state forward', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    // Something else stored data on the *previous* entry's own state — a
    // real `pushState` never carries it forward onto the new entry, and
    // neither does this substrate's own write.
    adapter.replaceState('/en', { hostOwnField: 'previous-entry-only' });

    history.push('/a');

    expect(adapter.getState()).toEqual({ '@gears-frontx/routing': { position: 1 } });
  });

  it('replace merges position into whatever state the host already carries on the current entry, preserving it', () => {
    const adapter = new FakeHistoryAdapter('/en');
    adapter.replaceState('/en', { hostOwnField: 'keep-me' });
    const history = createNavigationHistory(adapter);

    history.replace('/en-edited');

    expect(adapter.getState()).toEqual({ hostOwnField: 'keep-me', '@gears-frontx/routing': { position: 0 } });
  });

  it('two instances constructed over the same underlying entries see the identical position', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const first = createNavigationHistory(adapter);
    first.push('/a');

    const second = createNavigationHistory(adapter);

    expect(second.location.position).toBe(first.location.position);
    expect(second.location.position).toBe(1);
  });
});
