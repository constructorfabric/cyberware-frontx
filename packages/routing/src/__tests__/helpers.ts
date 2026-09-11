// Shared test scaffolding for `packages/routing`. Not part of the package's
// own public surface — imported only by files under `__tests__/`.

// DESIGN §3.3 public surface (N3, review round 16-re4; MEDIUM, review round
// 16-re5): the runtime values and the type-only names `src/index.ts`
// exports, pinned once here so `package.test.ts` (the runtime
// `import * as routing` pin) and `dist-internal.test.ts` (the built
// `dist/index.d.ts` presence/consumer checks) assert against the identical
// name list rather than two lists that could silently drift apart.
//
// MEDIUM (review round 16-re5): the runtime half used to be a hand-listed
// subset (5 of the 10 actual runtime exports) — a literal `@internal` in a
// `//` comment above `export { deriveExtensionToken, namesEqual,
// validateName }` (`../index.ts`) would have dropped all three from
// `dist/index.d.ts` with no test failing, exactly N3's own class of defect,
// because the hand list never claimed to cover them. It is now derived from
// `../index.js`'s own actual runtime exports (`Object.keys`, sorted) rather
// than maintained by hand, so a future export this package's own entry point
// adds or removes changes this list automatically instead of silently
// falling out of sync with it.
export const ROUTING_RUNTIME_SURFACE = Object.keys(routingIndex).sort();

// Type-only exports cannot be derived the same way — `export type *`/
// `export type { ... }` erase entirely at compile time, so there is no
// runtime object to call `Object.keys` on. This list is instead
// cross-checked by hand against every DESIGN §3.3 public-surface row that
// names a type rather than a function: the `NavigationHistory` contract
// (`NavigationHistory`, `Location`); the `resolveNavigationHistory`/
// `HistoryAdapter` seam (`HistoryAdapter`, `AdapterLocation`); the
// engine-provider port (`EngineProviderInput`, `EngineProviderPort`,
// `EntryAddress`); the registered-extensions source
// (`RegisteredExtensionsSource`); `createRouteSignal`'s own return shape
// (`RouteSignal`); the transition notification (`Transition`); and
// `RoutingError`'s own discriminant (`RoutingErrorCode`). Missing one of
// these here would silently reopen the same class of gap the runtime half
// above just closed — `helpers/surface-check.test.ts` proves the presence
// check this list feeds (`dist-internal.test.ts`) actually fails on a
// fixture missing a declared name, so an incomplete list is the only way
// left for a name to go unverified.
export const ROUTING_TYPE_ONLY_SURFACE = [
  'AdapterLocation',
  'EngineProviderInput',
  'EngineProviderPort',
  'EntryAddress',
  'HistoryAdapter',
  'Location',
  'NavigationHistory',
  'RegisteredExtensionsSource',
  'RouteSignal',
  'RoutingErrorCode',
  'Transition',
] as const;

// Internal building blocks DESIGN §3.3 explicitly excludes from the public
// surface (`./history/index.ts`'s own module comment) — asserted absent
// alongside `ROUTING_RUNTIME_SURFACE`'s presence, so a future re-export
// slipping one of these back in fails the same pin that catches a missing
// public name.
export const ROUTING_EXCLUDED_BUILDING_BLOCKS = ['createNavigationHistory', 'createWindowHistoryAdapter'] as const;
import * as routingIndex from '../index.js';
import { NAVIGATION_HISTORY_KEY, resolveNavigationHistory } from '../history/singleton.js';
import { RoutingError } from '../errors.js';
import { createRouteSignal } from '../signal/route-signal.js';
import { FakeHistoryAdapter } from './history/fake-history-adapter.js';
import type {
  BackProjectEntries,
  CreateObserver,
  DomainKey,
  Entry,
  ExtensionToken,
  Param,
  ReleaseFunction,
  RegisteredExtensionsSource,
} from '../types/index.js';

// F1 (review scope): `backProjectEntries`/`createObserver` are no longer
// free, realm-singleton-defaulting exports of the package itself — a
// conforming consumer now calls `createRouteSignal(history)` once and reuses
// the pair it returns. These two module-level bindings are this test
// suite's own equivalent of that call site, rebound by `resetRealm` on every
// reset so the many existing call sites across this package's test files
// (`backProjectEntries(...)`, `createObserver(...)`) keep working unchanged,
// always bound to whichever `NavigationHistory` the current test's
// `resetRealm` most recently constructed.
export let backProjectEntries: BackProjectEntries;
export let createObserver: CreateObserver;

/**
 * Deletes any instance already resolved under this realm's well-known key,
 * then resolves a fresh one against a `FakeHistoryAdapter` seeded at
 * `initialPath` — the setup every suite exercising `resolveNavigationHistory`
 * needs before each test, so the realm-global singleton never leaks state
 * between them. Also rebinds this file's own `backProjectEntries`/
 * `createObserver` (above) to the freshly resolved instance.
 */
export function resetRealm(initialPath = '/en'): FakeHistoryAdapter {
  delete (globalThis as Record<PropertyKey, unknown>)[NAVIGATION_HISTORY_KEY as unknown as string];
  const adapter = new FakeHistoryAdapter(initialPath);
  const history = resolveNavigationHistory(() => adapter);
  const routeSignal = createRouteSignal(history);
  backProjectEntries = routeSignal.backProjectEntries;
  createObserver = routeSignal.createObserver;
  return adapter;
}

/** A minimal `Entry` factory — casts the two branded string fields once,
 * here, instead of at every call site. */
export function entry(domainKey: string, extension: string, params: readonly Param[] = []): Entry {
  return { domainKey: domainKey as DomainKey, extension: extension as ExtensionToken, params };
}

/**
 * Calls `fn`, asserts it threw a `RoutingError`, and returns it — the one
 * assertion idiom for every "throws RoutingError" test in this package,
 * replacing three different hand-rolled patterns that had accumulated
 * across suites (`expect.assertions` + try/catch; try/catch +
 * `expect.unreachable()`; try/catch + a manually thrown "expected a throw"
 * error).
 */
export function expectRoutingError(fn: () => void): RoutingError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RoutingError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a RoutingError to be thrown');
}

/** A registered-extensions source that never changes after creation — no
 * `onChange`, per FEATURE §1.5: "a consumer whose set never changes ... may
 * supply a static snapshot with no change notification". */
export function staticSource(
  registrations: { extension: string; routeOwner: string }[] = [],
): RegisteredExtensionsSource<string> {
  return {
    getRegistrations: () =>
      registrations.map((r) => ({ extension: r.extension as ExtensionToken, routeOwner: r.routeOwner })),
  };
}

/** A registered-extensions source whose own set can be replaced after
 * creation via `set`, firing the one `onChange` callback a consumer
 * registered — the shape FEATURE §3, Observable Transition Signal, step 3
 * describes.
 *
 * `fireChange()` and `sourceReleaseCallCount` exist for the release-path
 * suite (FEATURE §3, Observer Release): `fireChange` replays the registered
 * callback without touching `current`, so a test can assert that a released
 * observer no longer reacts even though the source's own set is untouched;
 * `sourceReleaseCallCount` counts how many times the source's own release
 * function ran, so a test can assert it fires exactly once even across
 * repeated `release()` calls. */
export function mutableSource(
  registrations: { extension: string; routeOwner: string }[] = [],
): RegisteredExtensionsSource<string> & {
  set(next: typeof registrations): void;
  fireChange(): void;
  readonly sourceReleaseCallCount: number;
} {
  let current = registrations;
  let onChangeCallback: (() => void) | undefined;
  let sourceReleaseCallCount = 0;
  return {
    getRegistrations: () =>
      current.map((r) => ({ extension: r.extension as ExtensionToken, routeOwner: r.routeOwner })),
    onChange(callback: () => void): ReleaseFunction {
      onChangeCallback = callback;
      return () => {
        sourceReleaseCallCount += 1;
        onChangeCallback = undefined;
      };
    },
    set(next: typeof registrations): void {
      current = next;
      onChangeCallback?.();
    },
    fireChange(): void {
      onChangeCallback?.();
    },
    get sourceReleaseCallCount() {
      return sourceReleaseCallCount;
    },
  };
}
