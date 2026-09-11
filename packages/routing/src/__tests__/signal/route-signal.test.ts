import { beforeEach, describe, expect, it } from 'vitest';
import { createRouteSignal } from '../../signal/route-signal.js';
import { createNavigationHistory } from '../../history/navigation-history.js';
import { resetRealm } from '../helpers.js';
import { FakeHistoryAdapter } from '../history/fake-history-adapter.js';
import type { DomainKey, ExtensionToken } from '../../types/index.js';

let singletonAdapter: FakeHistoryAdapter;

// F1 (review scope, `cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`
// / `cpt-frontx-algo-routing-route-ownership-signal-observe-change`): a
// `RouteSignal` built by `createRouteSignal(history)` reads AND writes
// through that exact `history` instance, never the realm-shared singleton —
// the seam the previous unbound `backProjectEntries`/`createObserver`
// exports did not have (their writes always reached the real singleton,
// regardless of what a caller injected for reads).

beforeEach(() => {
  // A singleton left resolved from an earlier test would make "never the
  // singleton" unverifiable — starting each test with a distinct, private
  // instance the singleton has never seen is what makes the isolation this
  // suite checks observable at all.
  singletonAdapter = resetRealm('/should-not-be-touched');
});

describe('createRouteSignal', () => {
  it('backProjectEntries writes through the given history, leaving the realm-shared singleton untouched', () => {
    const injectedAdapter = new FakeHistoryAdapter('/en?screen=dashboard');
    const injectedHistory = createNavigationHistory(injectedAdapter);

    const { backProjectEntries } = createRouteSignal(injectedHistory);
    backProjectEntries('screen' as DomainKey, { payloadChanged: [{ extension: 'dashboard' as ExtensionToken, params: [] }] }, 'push');

    expect(injectedAdapter.lastWrite).toBeDefined();
    expect(singletonAdapter.lastWrite).toBeUndefined();
  });

  it('createObserver resolves entries from the given history, not the realm-shared singleton', () => {
    const injectedAdapter = new FakeHistoryAdapter('/en?screen=dashboard');
    const injectedHistory = createNavigationHistory(injectedAdapter);

    const { createObserver } = createRouteSignal(injectedHistory);
    const transitions: unknown[] = [];
    createObserver('screen' as DomainKey, { getRegistrations: () => [] }, (transition) => transitions.push(transition));

    expect(transitions).toHaveLength(1);
    expect((transitions[0] as { entries: unknown[] }).entries).toEqual([
      { extension: 'dashboard', params: [], resolution: { resolved: false } },
    ]);
  });

  it('two RouteSignal instances built over two different NavigationHistory instances stay fully independent', () => {
    const historyA = createNavigationHistory(new FakeHistoryAdapter('/en?screen=a'));
    const historyB = createNavigationHistory(new FakeHistoryAdapter('/en?screen=b'));
    const signalA = createRouteSignal(historyA);

    signalA.backProjectEntries('screen' as DomainKey, { added: [{ extension: 'extra' as ExtensionToken, params: [] }] }, 'push');

    expect(historyA.location.search).toContain('extra');
    expect(historyB.location.search).not.toContain('extra');
  });
});
