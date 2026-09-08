/**
 * useSharedProperty Hook - Shared property subscription
 *
 * Subscribes to shared property updates from the host, either through the
 * ambient MfeProvider context or through an explicitly supplied bridge.
 *
 * React Layer: L3
 */

import { useCallback, useContext, useSyncExternalStore } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/framework';
import { MfeContext } from '../MfeContext';

// ============================================================================
// Option Types
// ============================================================================

/**
 * Options for {@link useSharedProperty}.
 */
export interface UseSharedPropertyOptions<T> {
  /**
   * Bridge to read the property from, bypassing `MfeContext`.
   *
   * Pass this when the calling component never mounts `MfeProvider` (for
   * example, a component that receives its bridge directly as a prop or from
   * a non-React entry point). When omitted, the hook falls back to the
   * bridge from `MfeContext` and throws if no `MfeProvider` is mounted,
   * matching the zero-argument form.
   *
   * `bridge` and `propertyTypeId` identify the subscription: changing either
   * one unsubscribes from the old source and subscribes to the new one, and
   * the returned value reflects the new source on the same render.
   */
  bridge?: ChildMfeBridge;

  /**
   * Value returned while the host has not published the property yet
   * (`bridge.getProperty()` returns `undefined`).
   *
   * Only the `undefined` sentinel is substituted: a published `null` is a
   * real value and is returned as-is. The host validates every published
   * value against the property's schema before it reaches any MFE
   * (`TypeSystemPlugin.register()` throws on a schema mismatch and the
   * update is never stored or delivered), so no consumer-side filtering is
   * needed -- `T` is simply the caller's declaration of that schema.
   *
   * `fallback` may be passed inline on every render; it does not affect the
   * host subscription.
   */
  fallback?: T;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Subscribe to a shared property from the host.
 *
 * Two forms:
 *
 * 1. **Context form** -- `useSharedProperty(propertyTypeId)`. Reads the
 *    bridge from `MfeContext` and throws if no `MfeProvider` is mounted.
 * 2. **Options form** -- `useSharedProperty(propertyTypeId, options)`. Pass
 *    `options.bridge` for components that never mount `MfeProvider`, and/or
 *    `options.fallback` for a value to show until the host publishes one.
 *    `options.bridge` may be omitted, in which case the hook still falls
 *    back to `MfeContext`.
 *
 * Both forms read through `useSyncExternalStore`: the bridge is the store,
 * `bridge.getProperty()` is the snapshot, so the first render already shows
 * the host's current value, a publish between render and commit is picked
 * up when React re-reads the snapshot after subscribing, and the value is
 * tearing-protected under concurrent rendering.
 *
 * @param propertyTypeId - GTS type ID of the shared property to subscribe to
 * @param options - Optional bridge override and fallback
 * @returns The current property value; `T` when `options.fallback` is set,
 *   otherwise `T | undefined`
 *
 * @example Context form (inside MfeProvider)
 * ```tsx
 * function ThemedComponent() {
 *   const theme = useSharedProperty<{ primaryColor: string }>(THEME_PROPERTY_ID);
 *   return <div style={{ color: theme?.primaryColor }} />;
 * }
 * ```
 *
 * @example Explicit bridge with fallback (no MfeProvider)
 * ```tsx
 * function StandaloneComponent({ bridge }: { bridge: ChildMfeBridge }) {
 *   const label = useSharedProperty<string>(LABEL_PROPERTY_ID, {
 *     bridge,
 *     fallback: 'Untitled',
 *   });
 *   return <span>{label}</span>;
 * }
 * ```
 */
export function useSharedProperty<T = unknown>(propertyTypeId: string): T | undefined;
export function useSharedProperty<T>(
  propertyTypeId: string,
  options: UseSharedPropertyOptions<T> & { fallback: T }
): T;
export function useSharedProperty<T = unknown>(
  propertyTypeId: string,
  options?: UseSharedPropertyOptions<T>
): T | undefined;
export function useSharedProperty<T = unknown>(
  propertyTypeId: string,
  options?: UseSharedPropertyOptions<T>
): T | undefined {
  // useContext is called unconditionally (Rules of Hooks) regardless of whether
  // an explicit bridge was supplied; only the *result* is used conditionally below.
  const contextValue = useContext(MfeContext);
  const bridge = options?.bridge ?? contextValue?.bridge;
  const fallback = options?.fallback;

  if (!bridge) {
    throw new Error(
      'useSharedProperty must be used within a MfeProvider, or given an explicit ' +
      '`bridge` option, for components that never mount MfeProvider.'
    );
  }

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      bridge.subscribeToProperty(propertyTypeId, () => {
        onStoreChange();
      }),
    [bridge, propertyTypeId]
  );

  const getSnapshot = useCallback(() => {
    const raw = bridge.getProperty(propertyTypeId)?.value;
    // `undefined` is the only "not published" sentinel; `null` is a real value.
    // The caller specifies the expected `T` (as with `useState<T>`/
    // `useContext<T>`); the host has already validated the value against the
    // property's schema, so the assertion states the schema, not a hope.
    return raw === undefined ? fallback : (raw as T);
  }, [bridge, propertyTypeId, fallback]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
