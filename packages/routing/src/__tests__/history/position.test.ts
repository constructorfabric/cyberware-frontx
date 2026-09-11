import { describe, expect, it } from 'vitest';
import { POSITION_STATE_KEY, readPosition } from '../../history/position.js';

// FEATURE (navigation-substrate) §3, Position Tracking
// (`cpt-frontx-algo-routing-navigation-substrate-position-tracking`) —
// `readPosition` reads state a host, or another library sharing the same
// entry, controls; anything that is not a position this substrate itself
// could have written (a non-negative safe integer) must be treated exactly
// like the key being absent (LOW, review round 16-re2), never propagated
// into `NavigationHistory#length`/`canGoBack` as `NaN` or a negative depth.
describe('readPosition — malformed or absent state', () => {
  it('returns undefined when the raw state is not an object', () => {
    expect(readPosition(undefined)).toBeUndefined();
    expect(readPosition(null)).toBeUndefined();
    expect(readPosition('not an object')).toBeUndefined();
    expect(readPosition(42)).toBeUndefined();
  });

  it('returns undefined when the namespaced key is absent (cold mount / foreign entry)', () => {
    expect(readPosition({})).toBeUndefined();
    expect(readPosition({ someOtherKey: { position: 3 } })).toBeUndefined();
  });

  it('returns undefined for a negative recorded position', () => {
    expect(readPosition({ [POSITION_STATE_KEY]: { position: -1 } })).toBeUndefined();
  });

  it('returns undefined for a NaN recorded position', () => {
    expect(readPosition({ [POSITION_STATE_KEY]: { position: Number.NaN } })).toBeUndefined();
  });

  it('returns undefined for a non-integer recorded position', () => {
    expect(readPosition({ [POSITION_STATE_KEY]: { position: 1.5 } })).toBeUndefined();
  });

  it('returns undefined for a non-number recorded position', () => {
    expect(readPosition({ [POSITION_STATE_KEY]: { position: '2' } })).toBeUndefined();
    expect(readPosition({ [POSITION_STATE_KEY]: { position: null } })).toBeUndefined();
  });

  it('returns the recorded position for a well-formed non-negative safe integer', () => {
    expect(readPosition({ [POSITION_STATE_KEY]: { position: 0 } })).toBe(0);
    expect(readPosition({ [POSITION_STATE_KEY]: { position: 7 } })).toBe(7);
  });

  it('returns undefined for a magnitude beyond exact integer representation', () => {
    // `1e300` has no fractional part (`Number.isInteger` would accept it),
    // but IEEE 754 cannot represent it exactly as a count of entries —
    // `Number.isSafeInteger` is what actually guards this, not
    // `Number.isInteger`.
    expect(readPosition({ [POSITION_STATE_KEY]: { position: 1e300 } })).toBeUndefined();
  });
});
