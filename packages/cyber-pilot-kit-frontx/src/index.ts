export { validateKitManifest } from './validate-manifest.js';
export { loadKitSession, KitLifecycleState } from './session.js';
export { createFsResourceBodyReader } from './resource-body-reader.js';
export type {
  KitManifest,
  KitDefinition,
  KitResourceEntry,
  ValidationViolation,
  ValidationResult,
  KitRegistration,
  KitCapability,
  KitSessionResult,
  ResourceBodyReader,
} from './types.js';

// Project's single state document (`.frontx/project.json`) — read by both
// F16 (AI-extension trust gate) and F17 (upgrade orchestration).
export { selectTemplateEntry } from './project-state.js';
export type { PreviousOrigin, TemplateEntry, ProjectStateDocument } from './project-state.js';

// F16 Template AI-Extension Contract & Discovery/Activation
export { EXTENSION_CATEGORIES, AiExtensionLifecycleState } from './extensions/types.js';
export type {
  ExtensionCategory,
  AiExtensionEntry,
  AiExtensionBundle,
  StructuralError,
  TrustDenial,
  LifecycleResult,
  CapabilityContribution,
  ComposedCapabilitySet,
  ScanAndActivateResult,
} from './extensions/types.js';
export { isExtensionCategory, validateExtensionEntry } from './extensions/contract.js';
export { scanAndComposeExtensions } from './extensions/scan.js';
export type { BaseCapabilities } from './extensions/scan.js';
export {
  transitionBundledToDiscovered,
  transitionBundledToDenied,
  transitionFromDiscovered,
  transitionValidatedToActivated,
  runExtensionLifecycle,
} from './extensions/lifecycle.js';
export {
  validateBundleForPublish,
  discoverAndActivateForInstalledTemplate,
  discoverAndActivateFromInstalledTemplateFs,
} from './extensions/discover-and-activate.js';
export type { PrePublishValidationResult } from './extensions/discover-and-activate.js';
export { discoverExtensionBundlesFromFs, SLOT_DIR_NAMES } from './extensions/fs-discovery.js';
export type { BundleFsReader, DiscoveredBundle } from './extensions/fs-discovery.js';
export { createFsBundleReader } from './extensions/fs-bundle-reader.js';
export { discoverAndActivateFromScaffoldedProject } from './extensions/live-project-discovery.js';

// F17 AI-Driven Upgrade Orchestration
// PLAN CORRECTION (2026-07-14) — REOPENED: no export here names or re-exports
// anything from the CLI package; the engine is reached only through the
// injected `InvokeUpgradeCommandFn` (the `frontx upgrade` command surface).
export {
  computeChangeImpact,
  computeDownstreamEffects,
  enrichUpgradeChangeSet,
} from './upgrade-orchestration/enrich.js';
export { OrchestrationLifecycleState } from './upgrade-orchestration/state.js';
export type { OrchestrationLifecycleStateValue } from './upgrade-orchestration/state.js';
export { orchestrateAiDrivenUpgrade } from './upgrade-orchestration/orchestrate.js';
export type { OrchestrationDeps, OrchestrationResult } from './upgrade-orchestration/orchestrate.js';
export { createInvokeUpgradeCommand } from './upgrade-orchestration/invoke-upgrade-command.js';
export type { InvokeUpgradeCommandOptions, SpawnFn, SpawnOptions } from './upgrade-orchestration/invoke-upgrade-command.js';
export { resolveTargetOrigin } from './upgrade-orchestration/types.js';
export type {
  ChangeSet,
  ChangeKind,
  CleanEntry,
  ConflictEntry,
  ChangeImpactAnalysis,
  ChangeImpactEntry,
  DownstreamEffectAssessment,
  EnrichedReviewPackage,
  EnrichmentResult,
  InvokeUpgradeCommandFn,
  PresentEnrichedReviewFn,
  ReadProvenanceFn,
  ReviewDecision,
  SelectedTemplate,
  UpgradeCommandJsonResult,
} from './upgrade-orchestration/types.js';
