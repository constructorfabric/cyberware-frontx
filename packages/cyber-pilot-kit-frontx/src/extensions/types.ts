/**
 * F16 — Template AI-Extension Contract & Discovery/Activation.
 *
 * Closed-set extension-bundle contract (cpt-frontx-adr-template-ai-extension-contract):
 * a template's AI bundle conforms to a fixed set of named, typed slots. The
 * concrete field-level shape lives here (design altitude); the ADR only fixes
 * the existence of the contract and the admitted categories.
 */

/** The closed set of extension categories a template's AI bundle may declare. */
export const EXTENSION_CATEGORIES = ['skills', 'workflows', 'guidelines', 'reference_artifacts'] as const;

export type ExtensionCategory = (typeof EXTENSION_CATEGORIES)[number];

/**
 * One declared entry in a template's AI-extension bundle, targeting a single
 * named typed slot of the closed-set contract.
 */
export interface AiExtensionEntry {
  /** Unique identifier for the entry within its bundle. */
  id: string;
  /** The named typed slot this entry targets. */
  category: ExtensionCategory;
  /** Path to the entry's content, relative to the template's bundle root. */
  path: string;
}

/** A template's declared AI-extension bundle — an array of entries, any of which may be malformed. */
export type AiExtensionBundle = unknown[];

/** A structural error recorded for a non-conforming bundle entry. */
export interface StructuralError {
  /** The slot the offending entry targeted, or 'unknown' if the category itself was unrecognized/absent. */
  slot: string;
  /** The offending entry's declared id, if determinable. */
  entryId: string;
  /** Human-readable description of the violated constraint. */
  message: string;
}

/**
 * A denial recorded when a bundle's template identity fails the trust check
 * (§1.1-1.2, §3 `inst-check-identity-trust`/`inst-return-denied-bundle`) —
 * deliberately a DISTINCT type from `StructuralError`: the bundle's shape was
 * never even examined, because the identity itself was rejected before any
 * of its slots were scanned. A caller must be able to tell a DENIED bundle
 * apart from a structurally REJECTED entry (§6's DENIED acceptance
 * criterion) without guessing from a shared shape.
 */
export interface TrustDenial {
  /** The `<template-identity>` whose bundle was excluded on trust grounds. */
  identity: string;
  /** Human-readable reason — always the untrusted-origin reason, never a structural-shape complaint. */
  reason: string;
}

/** The AiExtension lifecycle (cpt-frontx-state-template-ai-extensions-extension-lifecycle). */
export const AiExtensionLifecycleState = {
  BUNDLED: 'BUNDLED',
  DENIED: 'DENIED',
  DISCOVERED: 'DISCOVERED',
  VALIDATED: 'VALIDATED',
  ACTIVATED: 'ACTIVATED',
  REJECTED: 'REJECTED',
} as const;

export type AiExtensionLifecycleState = (typeof AiExtensionLifecycleState)[keyof typeof AiExtensionLifecycleState];

/** Outcome of running one bundle entry through the lifecycle. */
export interface LifecycleResult {
  state: typeof AiExtensionLifecycleState.ACTIVATED | typeof AiExtensionLifecycleState.REJECTED;
  entry?: AiExtensionEntry;
  error?: StructuralError;
}

/** A capability contributed to a named slot, sourced either from the base kit or an installed template. */
export interface CapabilityContribution {
  entry: AiExtensionEntry;
  /** 'base' for the framework's base kit; 'template' for an installed-template contribution. */
  source: 'base' | 'template';
  /**
   * Installation order among template contributions, used to break ties when
   * multiple installed templates contribute to the same slot (lower = installed
   * earlier). Irrelevant for 'base' contributions.
   */
  installOrder: number;
}

/** The composed, agent-visible capability set produced by the discovery scan. */
export type ComposedCapabilitySet = Map<ExtensionCategory, Map<string, CapabilityContribution>>;

/** Result of the discovery scan + precedence composition algorithm. */
export interface ScanAndActivateResult {
  composed: ComposedCapabilitySet;
  errors: StructuralError[];
  lifecycleResults: LifecycleResult[];
  /** Bundles excluded on trust grounds (§3 **Output** / `inst-return-result`) — distinct from `errors`. */
  denials: TrustDenial[];
}
