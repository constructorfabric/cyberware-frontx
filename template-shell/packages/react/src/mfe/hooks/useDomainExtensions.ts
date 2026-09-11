/**
 * useDomainExtensions Hook - Domain extension list subscription
 *
 * Subscribes to store changes to detect when extensions are registered or unregistered,
 * and returns the current list of extensions for a domain.
 *
 * React Layer: L3
 */

import { useSyncExternalStore, useCallback, useRef } from 'react';
import { useFrontX } from '../../FrontXContext';
import { resolveMfeRegistry } from './useMfeRegistry';
import type { Extension } from '@gears-frontx/framework';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for observing extensions registered for a domain.
 *
 * Subscribes to the FrontX store to detect registration state changes,
 * and returns the current list of extensions for the specified domain.
 *
 * @param domainId - Domain ID to query extensions for
 * @returns Array of extensions currently registered for the domain
 *
 * @example
 * ```tsx
 * function SidebarExtensions() {
 *   const extensions = useDomainExtensions('gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.sidebar.v1');
 *
 *   return (
 *     <div>
 *       {extensions.map(ext => (
 *         <div key={ext.id}>{ext.id}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDomainExtensions(domainId: string): Extension[] {
  const app = useFrontX();
  const registry = resolveMfeRegistry(app, 'useDomainExtensions');

  // Subscribe to store changes.
  // Any dispatch (including registration state updates) triggers a snapshot check.
  // The snapshot comparison ensures only actual extension list changes cause re-renders.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return app.store.subscribe(onStoreChange);
    },
    [app.store]
  );

  // Cache the snapshot to maintain referential stability for useSyncExternalStore.
  // Only update when the extension IDs actually change.
  const cacheRef = useRef<{ ids: string; extensions: Extension[] }>({ ids: '', extensions: [] });

  const getSnapshot = useCallback(() => {
    const extensions = registry.getExtensionsForDomain(domainId);
    const ids = extensions.map(e => e.id).join(',');
    if (ids !== cacheRef.current.ids) {
      cacheRef.current = { ids, extensions };
    }
    return cacheRef.current.extensions;
  }, [registry, domainId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
