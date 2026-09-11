import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as routing from '../index';
import { ROUTING_EXCLUDED_BUILDING_BLOCKS, ROUTING_RUNTIME_SURFACE } from './helpers.js';
import { buildFreshDts, cleanupBuiltDts } from './helpers/build-dts.js';

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

// LOW (review round 16-re4): this suite pins the runtime surface above
// against `import * as routing` — `../index` (src), never the emitted
// `dist/index.d.ts`. That is exactly the gap N3 fell through: a JSDoc
// change that drops a declaration from the built output leaves this file's
// own assertions untouched, because they never look at the build. This
// describe block closes it by asserting the *emitted* declarations declare
// the identical `ROUTING_RUNTIME_SURFACE`/`ROUTING_TYPE_ONLY_SURFACE` names
// this file already pins at runtime — reusing `dist-internal.test.ts`'s own
// build helper (`./helpers/build-dts.js`) rather than a second `tsup`
// invocation of its own, so a real "dist equals src" comparison exists
// without either file drifting from what the other one runs.
describe('dist/index.d.ts declares the same public surface as src/index.ts (LOW)', () => {
  let dts: string;
  let outDir: string;

  beforeAll(() => {
    const built = buildFreshDts();
    dts = built.dts;
    outDir = built.outDir;
  });

  afterAll(() => {
    cleanupBuiltDts(outDir);
  });

  it.each(ROUTING_RUNTIME_SURFACE)('%s: exported at runtime and declared in dist', (name) => {
    expect((routing as Record<string, unknown>)[name]).toBeDefined();
    expect(dts, `${name} missing from dist/index.d.ts`).toMatch(new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b`, 'm'));
  });

  it.each(ROUTING_EXCLUDED_BUILDING_BLOCKS)('%s: absent at runtime and absent from dist', (name) => {
    expect((routing as Record<string, unknown>)[name]).toBeUndefined();
    expect(dts, `${name} unexpectedly declared in dist/index.d.ts`).not.toMatch(
      new RegExp(`\\bdeclare\\s+function\\s+${name}\\b`),
    );
  });
});
