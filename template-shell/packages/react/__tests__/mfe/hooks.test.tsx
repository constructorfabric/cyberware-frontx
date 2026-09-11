/**
 * MFE Hooks Tests
 *
 * Tests for MFE context and hooks in @gears-frontx/react.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { Provider as ReduxProvider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  MfeProvider,
  useMfeContext,
  useMfeBridge,
  useSharedProperty,
  useHostAction,
  type MfeContextValue,
} from '../../src/mfe';
import type { ChildMfeBridge, SharedProperty } from '@gears-frontx/framework';

// ============================================================================
// Mock Data
// ============================================================================

const TEST_DOMAIN_ID =
  'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.sidebar.v1';

/**
 * Build a ChildMfeBridge test double. Override only what the test cares
 * about; everything else is an inert mock.
 */
function makeBridge(overrides: Partial<ChildMfeBridge> = {}): ChildMfeBridge {
  return {
    extDomainId: TEST_DOMAIN_ID,
    extensionId: 'test-instance',
    executeActionsChain: vi.fn().mockResolvedValue(undefined),
    subscribeToProperty: vi.fn().mockReturnValue(() => {}),
    getProperty: vi.fn().mockReturnValue(undefined),
    registerActionHandler: vi.fn(),
    ...overrides,
  };
}

const mockBridge = makeBridge({ extensionId: 'test-instance-123' });

const mockMfeContextValue: MfeContextValue = {
  bridge: mockBridge,
  extensionId: 'test-extension-1',
  domainId: mockBridge.extDomainId,
};

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock Redux store.
 */
function createMockStore() {
  return configureStore({
    reducer: {
      mfe: () => ({
        registrationStates: {},
        errors: {},
      }),
    },
  });
}

/**
 * Wrapper component with MFE and Redux providers.
 */
function createWrapper(
  mfeValue: MfeContextValue,
  store: ReturnType<typeof createMockStore>
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ReduxProvider store={store}>
        <MfeProvider value={mfeValue}>{children}</MfeProvider>
      </ReduxProvider>
    );
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('MfeContext', () => {
  describe('14.5.1 MfeProvider context provision', () => {
    it('should provide MFE context to children', () => {
      const store = createMockStore();
      const wrapper = createWrapper(mockMfeContextValue, store);

      const { result } = renderHook(() => useMfeContext(), { wrapper });

      expect(result.current).toEqual(mockMfeContextValue);
      expect(result.current.bridge).toBe(mockBridge);
      expect(result.current.extensionId).toBe('test-extension-1');
    });

    it('should throw error when used outside MfeProvider', () => {
      expect(() => {
        renderHook(() => useMfeContext());
      }).toThrow('useMfeContext must be used within a MfeProvider');
    });
  });

  describe('14.5.2 useMfeBridge hook', () => {
    it('should return bridge from context', () => {
      const store = createMockStore();
      const wrapper = createWrapper(mockMfeContextValue, store);

      const { result } = renderHook(() => useMfeBridge(), { wrapper });

      expect(result.current).toBe(mockBridge);
      expect(result.current.extDomainId).toBe(mockBridge.extDomainId);
      expect(result.current.extensionId).toBe(mockBridge.extensionId);
    });

    it('should throw error when used outside MFE context', () => {
      expect(() => {
        renderHook(() => useMfeBridge());
      }).toThrow('useMfeContext must be used within a MfeProvider');
    });
  });

  describe('14.5.3 useSharedProperty subscription', () => {
    it('should return undefined when property is not set', () => {
      const store = createMockStore();
      const wrapper = createWrapper(mockMfeContextValue, store);
      const unsubscribe = vi.fn();
      vi.mocked(mockBridge.subscribeToProperty).mockReturnValueOnce(unsubscribe);

      const { result, unmount } = renderHook(
        () => useSharedProperty('gts.frontx.mfes.comm.shared_property.v1~test.user_data.v1'),
        { wrapper }
      );

      // Returns undefined when bridge.getProperty() returns undefined
      expect(result.current).toBeUndefined();
      expect(mockBridge.getProperty).toHaveBeenCalledWith('gts.frontx.mfes.comm.shared_property.v1~test.user_data.v1');
      expect(mockBridge.subscribeToProperty).toHaveBeenCalledWith(
        'gts.frontx.mfes.comm.shared_property.v1~test.user_data.v1',
        expect.any(Function)
      );

      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('should throw when used outside MfeProvider and no explicit bridge is given', () => {
      expect(() => {
        renderHook(() =>
          useSharedProperty('gts.frontx.mfes.comm.shared_property.v1~test.user_data.v1')
        );
      }).toThrow(/MfeProvider/);
    });

    it('should read from an explicit bridge without requiring MfeProvider', () => {
      const propertyId = 'gts.frontx.mfes.comm.shared_property.v1~test.explicit_bridge.v1';
      const explicitBridge = makeBridge({
        extensionId: 'explicit-bridge-instance',
        getProperty: vi.fn().mockReturnValue({ id: propertyId, value: 'hello' }),
      });

      // No MfeProvider in the tree -- only the option-supplied bridge is used.
      const { result } = renderHook(() =>
        useSharedProperty(propertyId, { bridge: explicitBridge })
      );

      expect(result.current).toBe('hello');
      expect(explicitBridge.getProperty).toHaveBeenCalledWith(propertyId);
    });

    it('should return fallback while the property is unpublished, then the published value', () => {
      const propertyId = 'gts.frontx.mfes.comm.shared_property.v1~test.fallback_unset.v1';
      let subscribedCallback: ((property: SharedProperty) => void) | undefined;
      let currentValue: unknown = undefined;

      const explicitBridge = makeBridge({
        subscribeToProperty: vi.fn((_id, callback) => {
          subscribedCallback = callback;
          return () => {};
        }),
        getProperty: vi.fn(() =>
          currentValue === undefined ? undefined : { id: propertyId, value: currentValue }
        ),
      });

      const { result } = renderHook(() =>
        useSharedProperty<string>(propertyId, { bridge: explicitBridge, fallback: 'Untitled' })
      );

      expect(result.current).toBe('Untitled');

      currentValue = 'Published';
      act(() => subscribedCallback?.({ id: propertyId, value: 'Published' }));

      expect(result.current).toBe('Published');
    });

    it('should resubscribe and reflect the new value when the bridge instance is swapped', () => {
      const propertyId = 'gts.frontx.mfes.comm.shared_property.v1~test.bridge_swap.v1';
      const unsubscribeA = vi.fn();
      const unsubscribeB = vi.fn();

      const bridgeA = makeBridge({
        extensionId: 'instance-a',
        subscribeToProperty: vi.fn().mockReturnValue(unsubscribeA),
        getProperty: vi.fn().mockReturnValue({ id: propertyId, value: 'value-a' }),
      });
      const bridgeB = makeBridge({
        extensionId: 'instance-b',
        subscribeToProperty: vi.fn().mockReturnValue(unsubscribeB),
        getProperty: vi.fn().mockReturnValue({ id: propertyId, value: 'value-b' }),
      });

      const { result, rerender } = renderHook(
        ({ bridge }: { bridge: ChildMfeBridge }) =>
          useSharedProperty(propertyId, { bridge, fallback: 'Untitled' }),
        { initialProps: { bridge: bridgeA } }
      );

      expect(result.current).toBe('value-a');
      expect(bridgeA.subscribeToProperty).toHaveBeenCalledTimes(1);

      rerender({ bridge: bridgeB });

      expect(unsubscribeA).toHaveBeenCalled();
      expect(bridgeB.subscribeToProperty).toHaveBeenCalledTimes(1);
      expect(result.current).toBe('value-b');
    });

    it('should resubscribe and reflect the new value when propertyTypeId changes on the same bridge', () => {
      const propertyIdA = 'gts.frontx.mfes.comm.shared_property.v1~test.resync_prop_a.v1';
      const propertyIdB = 'gts.frontx.mfes.comm.shared_property.v1~test.resync_prop_b.v1';
      const unsubscribe = vi.fn();

      const bridge = makeBridge({
        subscribeToProperty: vi.fn().mockReturnValue(unsubscribe),
        getProperty: vi.fn((id: string) => ({
          id,
          value: id === propertyIdA ? 'value-a' : 'value-b',
        })),
      });

      const { result, rerender } = renderHook(
        ({ propertyTypeId }: { propertyTypeId: string }) =>
          useSharedProperty(propertyTypeId, { bridge }),
        { initialProps: { propertyTypeId: propertyIdA } }
      );

      expect(result.current).toBe('value-a');

      rerender({ propertyTypeId: propertyIdB });

      expect(unsubscribe).toHaveBeenCalled();
      expect(bridge.subscribeToProperty).toHaveBeenLastCalledWith(
        propertyIdB,
        expect.any(Function)
      );
      expect(result.current).toBe('value-b');
    });

    it('should pick up a publish landing between render and subscription', () => {
      const propertyId = 'gts.frontx.mfes.comm.shared_property.v1~test.commit_window.v1';
      let currentValue = 'published-before-render';

      // The value changes at the moment the hook subscribes, simulating a
      // publish that landed inside the render->commit window. Nothing ever
      // fires the subscription callback, so the only way to observe the new
      // value is useSyncExternalStore's post-subscribe snapshot re-read.
      const bridge = makeBridge({
        subscribeToProperty: vi.fn(() => {
          currentValue = 'published-before-subscribe';
          return () => {};
        }),
        getProperty: vi.fn(() => ({ id: propertyId, value: currentValue })),
      });

      const { result } = renderHook(() =>
        useSharedProperty(propertyId, { bridge })
      );

      expect(result.current).toBe('published-before-subscribe');
    });

    it('should treat a published null as a value, not as unpublished', () => {
      const propertyId = 'gts.frontx.mfes.comm.shared_property.v1~test.null_value.v1';
      const explicitBridge = makeBridge({
        getProperty: vi.fn().mockReturnValue({ id: propertyId, value: null }),
      });

      // `null` is a real value, distinct from "unpublished" (getProperty
      // returning undefined), so it must NOT collapse to `fallback`.
      const { result } = renderHook(() =>
        useSharedProperty<string | null>(propertyId, { bridge: explicitBridge, fallback: 'Untitled' })
      );

      expect(result.current).toBeNull();
    });

    it('should not resubscribe when an inline fallback changes identity across renders', () => {
      const propertyId = 'gts.frontx.mfes.comm.shared_property.v1~test.no_churn.v1';
      const unsubscribe = vi.fn();
      const explicitBridge = makeBridge({
        subscribeToProperty: vi.fn().mockReturnValue(unsubscribe),
        getProperty: vi.fn().mockReturnValue({ id: propertyId, value: 'value' }),
      });

      // A fresh fallback object each render must not tear down and recreate
      // the host subscription.
      const { rerender } = renderHook(() =>
        useSharedProperty(propertyId, { bridge: explicitBridge, fallback: { label: 'Untitled' } })
      );

      expect(explicitBridge.subscribeToProperty).toHaveBeenCalledTimes(1);

      rerender();
      rerender();

      expect(explicitBridge.subscribeToProperty).toHaveBeenCalledTimes(1);
      expect(unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('14.5.5 useHostAction callback', () => {
    it('should return callback function', () => {
      const store = createMockStore();
      const wrapper = createWrapper(mockMfeContextValue, store);

      const { result } = renderHook(
        () => useHostAction('gts.frontx.mfes.comm.action.v1~test.navigate.v1'),
        { wrapper }
      );

      expect(typeof result.current).toBe('function');
    });

    it('should send actions chain when callback is invoked', () => {
      const store = createMockStore();
      const wrapper = createWrapper(mockMfeContextValue, store);

      const { result } = renderHook(
        () => useHostAction('gts.frontx.mfes.comm.action.v1~test.navigate.v1'),
        { wrapper }
      );

      // Invoke the callback
      result.current({ path: '/dashboard' });

      // Should call bridge.executeActionsChain with proper structure
      expect(mockBridge.executeActionsChain).toHaveBeenCalledWith({
        action: {
          type: 'gts.frontx.mfes.comm.action.v1~test.navigate.v1',
          target: mockBridge.extDomainId,
          payload: { path: '/dashboard' },
        },
      });
    });
  });

  // FrontXProvider MFE detection testing is deferred to integration tests.
  // The feature (when mfeBridge prop is provided, wrap children with MfeProvider)
  // requires full FrontX app instance with store, registries, and plugin initialization.
  // It will be properly tested when:
  // - Bridge communication layer is complete
  // - Integration tests with Chrome DevTools MCP Runtime are available
  // - Full MFE lifecycle scenarios can be tested end-to-end
});
