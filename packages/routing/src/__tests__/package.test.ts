import { describe, expect, it } from 'vitest';
import * as routing from '../index';
import { ROUTING_EXCLUDED_BUILDING_BLOCKS, ROUTING_RUNTIME_SURFACE } from './helpers.js';

// This test pins the entry point's history-half runtime surface — see
// `__tests__/history/*.test.ts` for the history module's actual behaviour,
// and `__tests__/grammar/*.test.ts` for the grammar codec half.
//
// DESIGN §3.3: only `resolveNavigationHistory` is public —
// `createNavigationHistory` and `createWindowHistoryAdapter` are internal
// building blocks a test reaches by importing
// `../history/navigation-history.js` / `../history/adapter.js` directly,
// never through this package's own entry point.
describe('@gears-frontx/routing entry point', () => {
  it('re-exports the realm-shared singleton resolver', () => {
    expect(routing.resolveNavigationHistory).toBeTypeOf('function');
  });

  it('does NOT re-export the internal construction building blocks', () => {
    for (const name of ROUTING_EXCLUDED_BUILDING_BLOCKS) {
      expect((routing as Record<string, unknown>)[name]).toBeUndefined();
    }
  });

  // F1 (review scope): `createRouteSignal` is the one public construction
  // path for the route ownership signal's write/observe surfaces — the
  // free, realm-singleton-defaulting `backProjectEntries`/`createObserver`
  // exports this package used to carry are gone, with no compatibility
  // shim left in their place.
  it('re-exports createRouteSignal, and no longer re-exports the unbound backProjectEntries/createObserver', () => {
    expect(routing.createRouteSignal).toBeTypeOf('function');
    expect((routing as Record<string, unknown>).backProjectEntries).toBeUndefined();
    expect((routing as Record<string, unknown>).createObserver).toBeUndefined();
  });

  // N3 (review round 16-re4): `RoutingError`/`parseGrammar`/`serializeGrammar`
  // complete the runtime half of the DESIGN §3.3 surface pin shared with
  // `dist-internal.test.ts` (`./helpers.js`'s `ROUTING_RUNTIME_SURFACE`) —
  // added here so the two lists cover the identical names rather than this
  // file staying scoped to only the history half while the shared list grew
  // past it.
  it.each(ROUTING_RUNTIME_SURFACE)('re-exports %s', (name) => {
    expect((routing as Record<string, unknown>)[name]).toBeDefined();
  });
});

// LOW (review round 16-re5): the "dist/index.d.ts declares the same public
// surface as src/index.ts" describe block that used to live here (added LOW,
// review round 16-re4) duplicated `dist-internal.test.ts`'s own "published
// dist/index.d.ts declares the full DESIGN §3.3 public surface (N3)" block
// assertion-for-assertion — both ran an independent `tsup` build in
// `beforeAll` just to re-check names `dist-internal.test.ts` already checks
// against the identical build. Removed rather than deduplicated into a
// shared cache: with only `dist-internal.test.ts` left calling
// `buildFreshDts`, this package's test suite now runs `tsup` once per test
// run instead of twice, and every "is this name declared in dist" assertion
// lives in exactly one place.
