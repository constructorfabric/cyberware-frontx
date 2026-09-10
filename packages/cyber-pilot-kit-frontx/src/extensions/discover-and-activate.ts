// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
import { validateExtensionEntry } from './contract.js';
import { scanAndComposeExtensions, composeBaseOnly, resolveCapabilityPrecedence, type BaseCapabilities } from './scan.js';
import { discoverExtensionBundlesFromFs, readProjectStateDocument, type BundleFsReader } from './fs-discovery.js';
import { AiExtensionLifecycleState, EXTENSION_CATEGORIES } from './types.js';
import type {
  AiExtensionBundle,
  ComposedCapabilitySet,
  LifecycleResult,
  ScanAndActivateResult,
  StructuralError,
  TrustDenial,
} from './types.js';
import type { ProjectStateDocument } from '../project-state.js';

export interface PrePublishValidationResult {
  ok: boolean;
  errors: StructuralError[];
}

/**
 * Bundle-and-publish leg (Template Developer): validates every declared
 * extension entry against the closed-set contract before the template may be
 * published. A non-conforming entry blocks publication with a reported
 * structural error.
 */
export function validateBundleForPublish(bundle: AiExtensionBundle): PrePublishValidationResult {
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-declare-extensions
  const declaredEntries = bundle;
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-declare-extensions

  const errors: StructuralError[] = [];

  for (const raw of declaredEntries) {
    // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-contract-shape
    const result = validateExtensionEntry(raw);
    if (!result.ok) {
      // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-prepublish-error
      errors.push(result.error);
      // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-prepublish-error
    }
    // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-contract-shape
  }

  if (errors.length > 0) {
    // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-prepublish-fail
    return { ok: false, errors };
    // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-prepublish-fail
  }

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-confirm-contract-conformance
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-publish-template
  return { ok: true, errors: [] };
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-publish-template
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-confirm-contract-conformance
}

/**
 * Install-discover-activate leg (Project Developer): invoked on the kit's own
 * next run once an installed template's bundle is present on disk — a
 * filesystem handoff, no CLI-to-Kit signal (cross-package edge F16 <- F10).
 * Runs the contract scan and composes the discovered conforming extensions
 * with the base kit's capability set into the agent-visible activation
 * result.
 *
 * `identity` and `projectState` are REQUIRED — this function does no trust
 * checking of its own; it inherits the gate through
 * `scanAndComposeExtensions`, which refuses to compose ANY bundle without
 * them (§1.1-1.2). There is deliberately no second, independently-written
 * check here: the algorithm is the ONE place that check runs for this leg.
 */
export function discoverAndActivateForInstalledTemplate(
  bundle: AiExtensionBundle,
  baseCapabilities: BaseCapabilities,
  installOrder: number,
  identity: string,
  projectState: ProjectStateDocument | null,
): ScanAndActivateResult {
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-install-template
  // Installation itself is performed by the CLI's template-resolution path
  // (cpt-frontx-feature-template-resolution); this function runs when the kit
  // finds the installed template's bundle on disk — a filesystem handoff, with
  // no CLI-to-Kit signal.
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-install-template

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-each-slot
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-slot-entries
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-slot-conformance
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-record-structural-error
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-add-to-discovered
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-compose-under-precedence
  const result = scanAndComposeExtensions(bundle, baseCapabilities, installOrder, identity, projectState);
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-compose-under-precedence
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-add-to-discovered
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-record-structural-error
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-slot-conformance
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-slot-entries
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-each-slot
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-errors
  if (result.errors.length > 0) {
    // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-errors
    // Structural errors are surfaced to the Project Developer via `result.errors`;
    // no errored entry is present in `result.composed` (excluded in the scan).
    // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-report-errors
  }
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-check-errors

  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-activate-capabilities
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-activated
  return result;
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-return-activated
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-activate-capabilities
}

/**
 * Merges one identity's already-composed `ComposedCapabilitySet` INTO an
 * accumulator, per slot+id, through the SAME precedence decision
 * `scanAndComposeExtensions` itself uses (`resolveCapabilityPrecedence`) —
 * never a second, independently-written comparison. Each incoming
 * contribution carries its OWN true `source`/`installOrder` (computed by
 * `scanAndComposeExtensions` against the REAL base, never against another
 * template's output), so merging preserves provenance instead of relabeling
 * an earlier template's entries as base-kit ones.
 */
function mergeComposedInto(accumulator: ComposedCapabilitySet, incoming: ComposedCapabilitySet): void {
  for (const slot of EXTENSION_CATEGORIES) {
    const accumulatorSlot = accumulator.get(slot)!;
    for (const [id, candidate] of incoming.get(slot) ?? []) {
      accumulatorSlot.set(id, resolveCapabilityPrecedence(accumulatorSlot.get(id), candidate));
    }
  }
}

/**
 * Install-discover-activate leg (Project Developer), FILESYSTEM realization:
 * scans the scaffolded project's `.frontx/ai/` for EACH per-template
 * id-scoped bundle root `.frontx/ai/<template-identity>/` per the FEATURE's
 * §1.5 AI-Extension Bundle Convention (via `discoverExtensionBundlesFromFs`),
 * and feeds each discovered bundle's conforming entries into the EXISTING
 * `scanAndComposeExtensions` algorithm — preserving its deterministic
 * precedence + lifecycle behavior. A malformed anchor in one bundle does not
 * prevent discovery of the others: fs-level structural errors (missing/
 * unparseable/identity-less anchor, out-of-set bundle-root subdir, malformed
 * on-disk slot shape) are scoped to their own bundle, merged with the scan's
 * own errors, and surfaced as REJECTED lifecycle results; a fs-level error
 * for one bundle's anchor means only that bundle contributes nothing.
 *
 * Every co-applied identity discovered in THIS scan is a PEER of every
 * other — none of them is another's "base". Each identity's bundle is
 * therefore scanned against the SAME, real `baseCapabilities` (never a
 * previous identity's output — that mislabeling is exactly the bug this
 * comment replaces), and the resulting per-identity `ComposedCapabilitySet`s
 * are merged afterward at THIS flow layer (`mergeComposedInto`), in the SAME
 * deterministic (sorted-identity) order `discoverExtensionBundlesFromFs`
 * already returns them in — so two peer templates contributing the SAME
 * slot+id resolve by iteration order exactly as `installOrder` ties do
 * inside the algorithm, because every fold step here shares that SAME
 * `installOrder` value.
 *
 * `scanAndComposeExtensions` gates on exactly ONE identity per call
 * (§1.1-1.2): the algorithm itself re-checks trust for every identity here,
 * in addition to `discoverExtensionBundlesFromFs`'s own fs-level check
 * (`checkIdentityTrust`, shared from `./trust.js`) that already excluded a
 * denied identity's bundle from ever having its slots read — two
 * independent call sites of the SAME predicate, not two independently
 * written checks. A denial recorded at the fs level is never ALSO run
 * through the algorithm (there is nothing to scan — its bundle is empty),
 * so it contributes exactly one denial, not two.
 */
export function discoverAndActivateFromInstalledTemplateFs(
  contentRoot: string,
  reader: BundleFsReader,
  baseCapabilities: BaseCapabilities,
  installOrder: number,
): ScanAndActivateResult {
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-each-slot
  // @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-slot-entries
  const discoveredBundles = discoverExtensionBundlesFromFs(contentRoot, reader);
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-slot-entries
  // @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-scan-each-slot

  // The algorithm's OWN gate (`scanAndComposeExtensions`) needs the same
  // parsed project state `discoverExtensionBundlesFromFs` already read
  // internally for ITS OWN gate — read again here rather than threading it
  // out of that call, since the two checks are deliberately independent
  // enforcement points, not one computation shared to save a read.
  const projectState = readProjectStateDocument(contentRoot, reader);

  const fsStructuralErrors: StructuralError[] = [];
  const fsRejectedResults: LifecycleResult[] = [];
  const scanErrors: StructuralError[] = [];
  const scanLifecycleResults: LifecycleResult[] = [];
  const denials: TrustDenial[] = [];

  // Seeded with the REAL base only — every identity's own call below scans
  // against this SAME base, and every identity's result is merged into this
  // SAME accumulator afterward, so no identity's contribution is ever
  // mistaken for another's base.
  const composed: ComposedCapabilitySet = composeBaseOnly(baseCapabilities);

  for (const discovered of discoveredBundles) {
    if (discovered.denial) {
      // Already excluded at the fs level, before any slot was read — nothing
      // to feed into the algorithm; `composed` is unaffected.
      denials.push(discovered.denial);
      continue;
    }

    fsStructuralErrors.push(...discovered.structuralErrors);
    fsRejectedResults.push(...discovered.structuralErrors.map((error): LifecycleResult => ({ state: AiExtensionLifecycleState.REJECTED, error })));

    const result = scanAndComposeExtensions(discovered.bundle, baseCapabilities, installOrder, discovered.identity, projectState);
    scanErrors.push(...result.errors);
    scanLifecycleResults.push(...result.lifecycleResults);
    denials.push(...result.denials);

    mergeComposedInto(composed, result.composed);
  }

  return {
    composed,
    errors: [...fsStructuralErrors, ...scanErrors],
    lifecycleResults: [...fsRejectedResults, ...scanLifecycleResults],
    denials,
  };
}
