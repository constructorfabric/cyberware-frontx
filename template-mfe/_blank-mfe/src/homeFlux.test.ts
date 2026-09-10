import { describe, expect, it, vi } from 'vitest';
import { initHomeEffects } from './effects/homeEffects';
import { homeSlice } from './slices/homeSlice';

describe('blank-mfe home flux modules', () => {
  it('exports the expected slice contract', () => {
    expect(homeSlice.name).toBe('_blank/home');
    expect(homeSlice.reducer(undefined, { type: 'unknown' })).toEqual({});
  });

  it('accepts dispatch initialization even when no effects are registered yet', () => {
    const dispatch = vi.fn();

    expect(() => {
      initHomeEffects(dispatch);
    }).not.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
