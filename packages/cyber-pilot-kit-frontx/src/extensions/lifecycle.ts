// @cpt-state:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1
import { validateExtensionEntry } from './contract.js';
import {
  AiExtensionLifecycleState,
  type AiExtensionEntry,
  type LifecycleResult,
  type StructuralError,
  type TrustDenial,
} from './types.js';

/**
 * FROM BUNDLED TO DENIED WHEN the bundle's template identity carries no
 * registered, pinned origin in the project's single state document,
 * `.frontx/project.json` — checked BEFORE any entry in the bundle is
 * scanned, so an untrusted bundle never reaches DISCOVERED (§4 transition
 * 1). The trust decision itself (whether `identity` carries such an origin)
 * is made by the caller — `fs-discovery.ts`'s `checkIdentityTrust`, which
 * carries both this state machine's markers AND the flow/algorithm markers
 * for the SAME check stated at two altitudes (§2 step 7, §3 step 3) — this
 * transition only wraps that outcome as the DENIED state change and reports
 * the denial action.
 */
// @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-bundled-to-denied
export function transitionBundledToDenied(identity: string): { state: typeof AiExtensionLifecycleState.DENIED; denial: TrustDenial } {
  // @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-action-report-denial
  const denial: TrustDenial = {
    identity,
    reason: `template identity "${identity}" carries no registered, pinned origin in the project's single state document (.frontx/project.json) — its AI-extension bundle is untrusted and excluded from activation before any of its slots are scanned`,
  };
  // @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-action-report-denial
  return { state: AiExtensionLifecycleState.DENIED, denial };
}
// @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-bundled-to-denied

/**
 * FROM BUNDLED TO DISCOVERED WHEN the installed template's AI-extension bundle
 * is scanned and an entry is located for a named typed slot in the closed-set
 * contract (cpt-frontx-state-template-ai-extensions-extension-lifecycle).
 */
// @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-bundled-to-discovered
export function transitionBundledToDiscovered(
  raw: unknown,
): { state: typeof AiExtensionLifecycleState.DISCOVERED; raw: unknown } {
  return { state: AiExtensionLifecycleState.DISCOVERED, raw };
}
// @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-bundled-to-discovered

/**
 * FROM DISCOVERED TO VALIDATED WHEN the entry's structural shape is confirmed
 * to conform, or TO REJECTED WHEN the entry is malformed / missing a required
 * element for its slot. A REJECTED transition reports a structural error.
 */
export function transitionFromDiscovered(
  raw: unknown,
): { state: typeof AiExtensionLifecycleState.VALIDATED; entry: AiExtensionEntry } | { state: typeof AiExtensionLifecycleState.REJECTED; error: StructuralError } {
  const result = validateExtensionEntry(raw);

  if (result.ok) {
    // @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-validated
    return { state: AiExtensionLifecycleState.VALIDATED, entry: result.entry };
    // @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-validated
  }

  // @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-rejected
  // @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-action-report-rejection
  return { state: AiExtensionLifecycleState.REJECTED, error: result.error };
  // @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-action-report-rejection
  // @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-discovered-to-rejected
}

/**
 * FROM VALIDATED TO ACTIVATED WHEN the composed capability set is committed
 * to the AI agent's visible surface after explicit precedence resolution.
 * Composition/commit itself is `scanAndComposeExtensions`; this transition
 * marks a VALIDATED entry as having reached ACTIVATED once composed.
 */
// @cpt-begin:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-validated-to-activated
export function transitionValidatedToActivated(entry: AiExtensionEntry): { state: typeof AiExtensionLifecycleState.ACTIVATED; entry: AiExtensionEntry } {
  return { state: AiExtensionLifecycleState.ACTIVATED, entry };
}
// @cpt-end:cpt-frontx-state-template-ai-extensions-extension-lifecycle:p1:inst-trans-validated-to-activated

/**
 * Drives one raw bundle entry through the full lifecycle: BUNDLED ->
 * DISCOVERED -> VALIDATED -> ACTIVATED, or BUNDLED -> DISCOVERED -> REJECTED.
 * A REJECTED entry never reaches ACTIVATED.
 */
export function runExtensionLifecycle(raw: unknown): LifecycleResult {
  const discovered = transitionBundledToDiscovered(raw);
  const validatedOrRejected = transitionFromDiscovered(discovered.raw);

  if (validatedOrRejected.state === AiExtensionLifecycleState.REJECTED) {
    return { state: AiExtensionLifecycleState.REJECTED, error: validatedOrRejected.error };
  }

  const activated = transitionValidatedToActivated(validatedOrRejected.entry);
  return { state: AiExtensionLifecycleState.ACTIVATED, entry: activated.entry };
}
