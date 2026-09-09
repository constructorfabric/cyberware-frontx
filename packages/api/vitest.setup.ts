// Shared Vitest test setup for @gears-frontx/api.
//
// A deliberate small LOCAL copy of the relevant slice of the ecosystem's
// shared test-cleanup hook (see the discussion in
// `packages/api/vitest.config.ts`), not an import from the templates
// repository: this package must stay self-contained and cannot resolve a
// path outside its own workspace.
//
// This package's tests run under `environment: 'node'` and mock timers and
// mocks directly (no DOM, no fetch stubbing needing restoration here), so the
// only shared leak surface that has actually bitten a test is fake timers:
// `sharedFetchCache.test.ts` calls `vi.useFakeTimers()` and relies on this
// hook to restore real timers before the next test runs, same as
// `endpointDescriptors.test.ts`'s SseStreamProtocol suite.
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
