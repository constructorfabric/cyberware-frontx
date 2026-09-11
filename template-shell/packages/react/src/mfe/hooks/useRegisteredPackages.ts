/**
 * useRegisteredPackages Hook - Registered GTS packages subscription
 *
 * Subscribes to store changes to detect when extensions are registered or unregistered,
 * and returns the current list of registered GTS packages.
 *
 * React Layer: L3
 */

import { useSyncExternalStore, useCallback, useRef } from 'react';
import { useFrontX } from '../../FrontXContext';
import { resolveMfeRegistry } from './useMfeRegistry';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for observing registered GTS packages.
 *
 * Subscribes to the FrontX store to detect registration state changes,
 * and returns the current list of GTS packages extracted from registered
 * extensions.
 *
 * ARCHITECTURAL NOTE ON STORE SUBSCRIPTION COUPLING:
 * This hook uses `useSyncExternalStore` with `app.store.subscribe`, which
 * fires on any Redux dispatch. Since `registerExtension()` dispatches to
 * the mfe store slice, the subscription WILL trigger when packages change.
 * The `getSnapshot` function calls `mfeRegistry.getRegisteredPackages()`
 * which reads the private `packages` Map. This works because every package
 * map mutation (in registerExtension/unregisterExtension) is always
 * accompanied by a store dispatch in the same serializer callback.
 *
 * IMPORTANT: If a future change mutates the packages map WITHOUT a store
 * dispatch, this hook would fail to re-render. Keep this coupling documented.
 *
 * @returns Array of GTS package strings currently registered
 *
 * @example
 * ```tsx
 * function PackageList() {
 *   const packages = useRegisteredPackages();
 *
 *   return (
 *     <div>
 *       {packages.map(pkg => (
 *         <div key={pkg}>{pkg}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useRegisteredPackages(): string[] {
  const app = useFrontX();
  const registry = resolveMfeRegistry(app, 'useRegisteredPackages');

  // Subscribe to store changes.
  // Any dispatch (including registration state updates) triggers a snapshot check.
  // The snapshot comparison ensures only actual package list changes cause re-renders.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return app.store.subscribe(onStoreChange);
    },
    [app.store]
  );

  // Cache the snapshot to maintain referential stability for useSyncExternalStore.
  // Only update when the package list actually changes.
  const cacheRef = useRef<{ packages: string; list: string[] }>({ packages: '', list: [] });

  const getSnapshot = useCallback(() => {
    const list = registry.getRegisteredPackages();
    const packages = list.join(',');
    if (packages !== cacheRef.current.packages) {
      cacheRef.current = { packages, list };
    }
    return cacheRef.current.list;
  }, [registry]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
