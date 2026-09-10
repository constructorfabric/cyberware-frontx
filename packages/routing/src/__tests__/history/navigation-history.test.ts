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

    expect(history.location).toEqual({ path: '/en', search: 'screen=dashboard', hash: 'top' });
  });
});

// FEATURE §3, Fan-Out Subscription Dispatch, step 3: `push`/`replace` dispatch
// the fan-out directly, without depending on a `popstate` event.
describe('createNavigationHistory — push/replace', () => {
  it('push appends a history entry through the adapter and updates location', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);

    history.push('/fr?screen=settings');

    expect(history.location).toEqual({ path: '/fr', search: 'screen=settings', hash: '' });
  });

  it('replace overwrites the current entry through the adapter', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);

    history.replace('/fr');

    expect(history.location).toEqual({ path: '/fr', search: '', hash: '' });
  });

  it('push dispatches a "push" notification synchronously to subscribers, with location already updated', () => {
    const adapter = new FakeHistoryAdapter('/en');
    const history = createNavigationHistory(adapter);
    const subscriber = vi.fn();
    history.subscribe(subscriber);

    history.push('/fr?screen=settings');

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith({
      location: { path: '/fr', search: 'screen=settings', hash: '' },
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
      location: { path: '/fr', search: '', hash: '' },
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
      location: { path: '/en', search: '', hash: '' },
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
