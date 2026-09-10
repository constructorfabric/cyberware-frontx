import { describe, expect, it } from 'vitest';
import * as routing from '../index';

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
    expect((routing as Record<string, unknown>).createNavigationHistory).toBeUndefined();
    expect((routing as Record<string, unknown>).createWindowHistoryAdapter).toBeUndefined();
  });
});
