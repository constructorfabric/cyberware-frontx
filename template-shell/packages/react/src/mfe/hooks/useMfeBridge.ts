/**
 * useMfeBridge Hook - MFE bridge access
 *
 * Returns the ChildMfeBridge from context for communication with host.
 *
 * React Layer: L3
 */
// @cpt-flow:cpt-frontx-flow-react-bindings-mfe-provider:p1
// @cpt-algo:cpt-frontx-algo-react-bindings-mfe-context-guard:p1
// @cpt-dod:cpt-frontx-dod-react-bindings-mfe-hooks:p1

import { useMfeContext } from '../MfeContext';
import type { ChildMfeBridge } from '@gears-frontx/framework';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for accessing the MFE bridge.
 *
 * Returns the ChildMfeBridge instance for communication with the host.
 * Must be used within a MfeProvider (i.e., inside an MFE component).
 *
 * @returns Child MFE bridge
 *
 * @example
 * ```tsx
 * function MyMfeComponent() {
 *   const bridge = useMfeBridge();
 *
 *   // Bridge methods:
 *   // bridge.executeActionsChain(chain);
 *   // bridge.subscribeToProperty(propertyTypeId, callback);
 *
 *   return <div>Domain: {bridge.extDomainId}</div>;
 * }
 * ```
 */
// @cpt-begin:cpt-frontx-flow-react-bindings-mfe-provider:p1:inst-use-bridge
// @cpt-begin:cpt-frontx-algo-react-bindings-mfe-context-guard:p1:inst-throw-no-mfe-context
// @cpt-begin:cpt-frontx-dod-react-bindings-mfe-hooks:p1:inst-use-bridge
export function useMfeBridge(): ChildMfeBridge {
  const { bridge } = useMfeContext();
  return bridge;
}
// @cpt-end:cpt-frontx-flow-react-bindings-mfe-provider:p1:inst-use-bridge
// @cpt-end:cpt-frontx-algo-react-bindings-mfe-context-guard:p1:inst-throw-no-mfe-context
// @cpt-end:cpt-frontx-dod-react-bindings-mfe-hooks:p1:inst-use-bridge
