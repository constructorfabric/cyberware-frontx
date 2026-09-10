// Shared test scaffolding for `packages/routing-tanstack`. Not part of the
// package's own public surface — imported only by files under `__tests__/`.
import { resolveNavigationHistory, type DomainKey, type Entry, type ExtensionToken, type Param } from '@gears-frontx/routing';
import { FakeHistoryAdapter } from './fake-history-adapter.js';

// `@gears-frontx/routing`'s own realm-shared singleton is keyed by this
// well-known `Symbol.for` value (recorded as a ruling in the scope ledger —
// `Symbol.for('@gears-frontx/routing/navigation-history/v1')`, bumped only
// on a breaking `NavigationHistory` shape change). Not exported from that
// package's own public dist, so this test helper re-derives it via
// `Symbol.for`'s own global registry rather than importing a private
// constant — if the core ever changes this string, these tests fail loudly
// rather than silently leaking state across them.
const NAVIGATION_HISTORY_KEY = Symbol.for('@gears-frontx/routing/navigation-history/v1');

/** Deletes any realm-shared `NavigationHistory` instance already resolved
 * under the well-known key, then resolves a fresh one against a
 * `FakeHistoryAdapter` seeded at `initialPath` — required before every test
 * that exercises a write path through `backProjectEntries` (which resolves
 * the shared instance internally, taking no history argument of its own),
 * so the singleton never leaks state between tests. */
export function resetRealm(initialPath = '/en'): FakeHistoryAdapter {
  delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];
  const adapter = new FakeHistoryAdapter(initialPath);
  resolveNavigationHistory(() => adapter);
  return adapter;
}

/** A minimal `Entry` factory — casts the two branded string fields once,
 * here, instead of at every call site. */
export function entry(domainKey: string, extension: string, params: readonly Param[] = []): Entry {
  return { domainKey: domainKey as DomainKey, extension: extension as ExtensionToken, params };
}

export { FakeHistoryAdapter } from './fake-history-adapter.js';
