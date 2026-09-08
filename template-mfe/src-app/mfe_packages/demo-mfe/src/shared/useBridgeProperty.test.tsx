import { act, renderHook } from '@testing-library/react';
import { FRONTX_SHARED_PROPERTY_THEME } from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture';
import { describe, expect, it } from 'vitest';
import { useBridgeProperty } from './useBridgeProperty';

const TEST_DOMAIN_ID = 'test-domain';
const TEST_INSTANCE_ID = 'test-instance';

function themeBridgeFixture(initialProperties: Record<string, unknown> = {}) {
  return createMfeBridgeFixture({
    extDomainId: TEST_DOMAIN_ID,
    extensionId: TEST_INSTANCE_ID,
    initialProperties,
  });
}

describe('useBridgeProperty', () => {
  it('reads the initial value from the bridge on first render', () => {
    const { bridge } = themeBridgeFixture({
      [FRONTX_SHARED_PROPERTY_THEME]: 'initial-theme',
    });

    const { result } = renderHook(() =>
      useBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'fallback-theme')
    );

    expect(result.current).toBe('initial-theme');
  });

  it('returns the fallback when the property is not published', () => {
    // No property registered at all: getProperty returns undefined.
    const { bridge } = themeBridgeFixture();

    const { result } = renderHook(() =>
      useBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'fallback-theme')
    );

    expect(result.current).toBe('fallback-theme');
  });

  it('passes non-string values through untouched', () => {
    // Schema validation is the type-system plugin's job; the hook does not
    // filter by runtime type.
    const fixture = themeBridgeFixture({
      [FRONTX_SHARED_PROPERTY_THEME]: { mode: 'dark' },
    });

    const { result } = renderHook(() =>
      useBridgeProperty<{ mode: string }>(fixture.bridge, FRONTX_SHARED_PROPERTY_THEME, { mode: 'light' })
    );

    expect(result.current).toEqual({ mode: 'dark' });

    act(() => {
      fixture.setProperty(FRONTX_SHARED_PROPERTY_THEME, { mode: 'high-contrast' });
    });

    expect(result.current).toEqual({ mode: 'high-contrast' });
  });

  it('reacts to property updates', () => {
    const fixture = themeBridgeFixture({
      [FRONTX_SHARED_PROPERTY_THEME]: 'initial-theme',
    });

    const { result } = renderHook(() =>
      useBridgeProperty(fixture.bridge, FRONTX_SHARED_PROPERTY_THEME, 'fallback-theme')
    );

    act(() => {
      fixture.setProperty(FRONTX_SHARED_PROPERTY_THEME, 'updated-theme');
    });

    expect(result.current).toBe('updated-theme');
  });

  it('unsubscribes on unmount', () => {
    const fixture = themeBridgeFixture({
      [FRONTX_SHARED_PROPERTY_THEME]: 'initial-theme',
    });

    const { unmount } = renderHook(() =>
      useBridgeProperty(fixture.bridge, FRONTX_SHARED_PROPERTY_THEME, 'fallback-theme')
    );

    unmount();

    expect(fixture.unsubscriptions).toHaveLength(1);
    for (const { unsubscribe } of fixture.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});
