// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
import { EXTENSION_CATEGORIES } from './types.js';
import type {
  AiExtensionBundle,
  AiExtensionEntry,
  CapabilityContribution,
  ComposedCapabilitySet,
  ExtensionCategory,
  LifecycleResult,
  ScanAndActivateResult,
  StructuralError,
} from './types.js';
import { AiExtensionLifecycleState } from './types.js';
import { isExtensionCategory, validateExtensionEntry } from './contract.js';
import { checkIdentityTrust } from './trust.js';
import type { ProjectStateDocument } from '../project-state.js';

/** Base kit capabilities, keyed by the named typed slot they contribute to. */
export type BaseCapabilities = Map<ExtensionCategory, AiExtensionEntry[]>;

function declaredCategoryOf(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return undefined;
  return (raw as Record<string, unknown>).category;
}

/**
 * Composes ONLY the base capabilities into a `ComposedCapabilitySet`, with
 * no template contribution at all. Used to seed the normal per-slot compose
 * loop below AND, unchanged, as the trust gate's denial-path result — §3
 * step 3.1.1 requires the algorithm return "the composed capability set
 * unchanged by this bundle" when the identity is untrusted, which is
 * exactly what this produces.
 */
export function composeBaseOnly(baseCapabilities: BaseCapabilities): ComposedCapabilitySet {
  const composed: ComposedCapabilitySet = new Map();
  for (const slot of EXTENSION_CATEGORIES) {
    const bySlotId = new Map<string, CapabilityContribution>();
    for (const baseEntry of baseCapabilities.get(slot) ?? []) {
      bySlotId.set(baseEntry.id, { entry: baseEntry, source: 'base', installOrder: -1 });
    }
    composed.set(slot, bySlotId);
  }
  return composed;
}

/**
 * The explicit precedence rule (§3 step 8 / `inst-compose-precedence`), as
 * ONE decision: does `candidate` displace `existing` for the same slot+id?
 * A template-contributed entry always supersedes a base-kit entry; among
 * two template contributions, the one with the higher-or-equal
 * `installOrder` wins (equal installOrder means "processed later wins",
 * which is what lets peer templates discovered in the SAME scan be ordered
 * by iteration order — `discoverAndActivateFromInstalledTemplateFs`, below,
 * relies on exactly this).
 *
 * This is the ONE place the precedence decision is made. It is used both
 * here — where a single bundle's entries are composed against the base —
 * and by the flow layer (`discoverAndActivateFromInstalledTemplateFs`) when
 * merging MULTIPLE identities' already-composed results together. Writing
 * the comparison a second time at the flow layer, even if it happened to
 * agree, is exactly the duplication this repo treats as a defect source.
 */
export function resolveCapabilityPrecedence(
  existing: CapabilityContribution | undefined,
  candidate: CapabilityContribution,
): CapabilityContribution {
  if (!existing) return candidate;
  if (existing.source === 'base' && candidate.source === 'template') return candidate;
  if (existing.source === 'template' && candidate.source === 'base') return existing;
  if (candidate.source === 'template' && candidate.installOrder >= existing.installOrder) return candidate;
  return existing;
}

// @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-each-entry
function runEntryThroughScan(
  raw: unknown,
  discovered: Map<ExtensionCategory, AiExtensionEntry[]>,
  errors: StructuralError[],
  lifecycleResults: LifecycleResult[],
): void {
  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-entry-shape
  const result = validateExtensionEntry(raw);
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-entry-shape

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-malformed
  if (!result.ok) {
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-append-error
    errors.push(result.error);
    lifecycleResults.push({ state: AiExtensionLifecycleState.REJECTED, error: result.error });
    // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-append-error
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-skip-malformed
    return;
    // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-skip-malformed
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-malformed

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-add-conforming
  const slotBucket = discovered.get(result.entry.category);
  if (slotBucket) slotBucket.push(result.entry);
  lifecycleResults.push({ state: AiExtensionLifecycleState.ACTIVATED, entry: result.entry });
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-add-conforming
}
// @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-validate-each-entry

/**
 * Discovery scan + precedence composition (cpt-frontx-algo-template-ai-extensions-contract-scan-activate).
 *
 * `identity` and `projectState` are REQUIRED, not optional: the identity's
 * trust check (§3 step 3) runs at the HEAD of this function, before any
 * entry is scanned, so this algorithm can never be reached by ANY caller —
 * fs-based or in-memory — without going through the trust gate. An
 * untrusted identity short-circuits to "the composed capability set
 * unchanged by this bundle" (`composeBaseOnly`), an empty error list, and a
 * denial (§3 step 3.1.1) — no entry of `bundle` is scanned at all.
 *
 * Once past the gate, scans `bundle` for entries conforming to the
 * closed-set extension contract, records a structural error for any
 * non-conforming entry (including entries naming a category outside the
 * closed set), and composes the conforming entries with `baseCapabilities`
 * under the explicit precedence rule: template-contributed entries
 * supersede base-kit entries for the same named slot; `installOrder` breaks
 * ties across multiple installed templates (higher installOrder wins for
 * the same slot+id).
 */
export function scanAndComposeExtensions(
  bundle: AiExtensionBundle,
  baseCapabilities: BaseCapabilities,
  installOrder: number,
  identity: string,
  projectState: ProjectStateDocument | null,
): ScanAndActivateResult {
  const trust = checkIdentityTrust(identity, projectState);
  if (!trust.trusted) {
    return { composed: composeBaseOnly(baseCapabilities), errors: [], lifecycleResults: [], denials: [trust.denial] };
  }

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-contract
  const slots = EXTENSION_CATEGORIES;
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-contract

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle
  const declaredEntries = bundle;
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-load-bundle

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-discovered-map
  const discovered = new Map<ExtensionCategory, AiExtensionEntry[]>();
  for (const slot of slots) discovered.set(slot, []);
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-discovered-map

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-error-list
  const errors: StructuralError[] = [];
  const lifecycleResults: LifecycleResult[] = [];
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-init-error-list

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-iterate-slots
  for (const slot of slots) {
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-identify-slot-entries
    const slotEntries = declaredEntries.filter((raw) => declaredCategoryOf(raw) === slot);
    // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-identify-slot-entries

    for (const raw of slotEntries) {
      runEntryThroughScan(raw, discovered, errors, lifecycleResults);
    }
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-iterate-slots

  // Entries whose declared category is outside the closed set entirely are
  // not identified by any slot's loop above and would otherwise be silently
  // dropped; they are still non-conforming entries and must be reported.
  for (const raw of declaredEntries) {
    const declared = declaredCategoryOf(raw);
    if (declared !== undefined && !isExtensionCategory(declared)) {
      runEntryThroughScan(raw, discovered, errors, lifecycleResults);
    }
  }

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-error-list
  if (errors.length > 0) {
    // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-surface-errors
    // Errors are surfaced via the returned `errors` list; callers report them
    // to the Project Developer. Errored entries are excluded from `discovered`
    // above (inst-skip-malformed) and therefore never reach composition.
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-surface-errors
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-check-error-list

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-compose-precedence
  const composed: ComposedCapabilitySet = composeBaseOnly(baseCapabilities);
  for (const slot of slots) {
    const bySlotId = composed.get(slot)!;
    for (const templateEntry of discovered.get(slot) ?? []) {
      const candidate: CapabilityContribution = { entry: templateEntry, source: 'template', installOrder };
      bySlotId.set(templateEntry.id, resolveCapabilityPrecedence(bySlotId.get(templateEntry.id), candidate));
    }
  }
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-compose-precedence

  // @cpt-begin:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-return-result
  return { composed, errors, lifecycleResults, denials: [] };
  // @cpt-end:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1:inst-return-result
}
