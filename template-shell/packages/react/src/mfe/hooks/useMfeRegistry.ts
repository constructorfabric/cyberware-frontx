/**
 * useMfeRegistry Hook - Shared MfeRegistry access guard
 *
 * Resolves the MFE-enabled registry off the FrontX app instance and throws a
 * descriptive error when the `microfrontends()` plugin was not installed.
 * Extracted so every registry-consuming hook shares one guard implementation
 * instead of hand-rolling the same `if (!app.mfeRegistry)` check.
 *
 * React Layer: L3
 */

import { useFrontX } from '../../FrontXContext';
import type { FrontXApp, MfeRegistry } from '@gears-frontx/framework';

// ============================================================================
// Internal Guard
// ============================================================================

/**
 * Internal, non-hook form of the guard. Lets the registry-consuming hooks name
 * themselves in the thrown message, so a developer learns which hook failed
 * even though the guard itself is shared. Not part of the package's public
 * surface — app code uses {@link useMfeRegistry}.
 *
 * @param app - The FrontX app instance to resolve the registry from
 * @param callerName - Name of the calling hook, used in the error message
 * @returns The MFE-enabled registry
 */
export function resolveMfeRegistry(app: FrontXApp, callerName: string): MfeRegistry {
  const registry = app.mfeRegistry;

  if (!registry) {
    throw new Error(
      `${callerName} requires the microfrontends plugin. ` +
      'Add microfrontends() to your Gears FrontX app configuration.'
    );
  }

  return registry;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for accessing the MFE-enabled registry off the current FrontX app.
 *
 * Throws if the app was built without the `microfrontends()` plugin.
 *
 * @returns The MFE-enabled registry
 *
 * @example
 * ```ts
 * const registry = useMfeRegistry();
 * ```
 */
export function useMfeRegistry(): MfeRegistry {
  const app = useFrontX();

  return resolveMfeRegistry(app, 'useMfeRegistry');
}
