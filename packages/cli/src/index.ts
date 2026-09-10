// @cpt-component:cpt-frontx-component-cli:p1
// @cpt-constraint:cpt-frontx-constraint-cli-template-independence:p1
// Zero template content is bundled in this package.
// All template resolution happens at runtime via source-spec.

export { parseSourceSpec } from './spec-parser/parse';
export type { StructuredRef, ParseError, ParseResult } from './spec-parser/types';

export { resolveToInventory } from './resolver/resolve';
export type { FetchFn, InventoryReadyRecord, ResolutionError, ResolveResult } from './resolver/types';

export { TemplateInventory } from './inventory/TemplateInventory';
export { InventoryIndex } from './inventory/InventoryIndex';
export { InventoryStore } from './inventory/InventoryStore';
export { InventoryState } from './inventory/types';
export type { InventoryEntry, InventoryError, InventoryResult } from './inventory/types';

export { installCommand } from './commands/install';
export type { InstallCommandResult } from './commands/install';

// F16 cross-package edge (F16 <- F10): install-time extension discovery hook
export type { DiscoveryHookContext, DiscoveryHookResult, ExtensionDiscoveryHook } from './discovery/types';
export { createFsBackedDiscoveryHook } from './discovery/fs-hook';
export type { FsExtensionDiscovery } from './discovery/fs-hook';

export { listCommand, buildListCatalog, listCatalogEnvelope, formatListHuman } from './commands/list';
export type {
  ListEntry,
  ListCatalog,
  DefaultTemplateEntry,
  RegisteredTemplateEntry,
  CatalogResolveDeps,
} from './commands/list';

export { updateLocalCommand } from './commands/update-local';
export type { UpdateLocalResult } from './commands/update-local';

export { validateManifestContract, readManifestFromContent } from './manifest/validate-contract';
export { validateContentSelfContainment } from './manifest/validate-content-self-containment';
export { validateCommand } from './commands/validate';
export type {
  TemplateManifest,
  ManifestViolation,
  ManifestValidationResult,
  ManifestValidationState,
  ReadFileFn,
  ListPayloadFilesFn,
  ResolveDeclaredExclusionFn,
} from './manifest/types';
export type { ReadManifestResult } from './manifest/validate-contract';
// The now-legacy ownership/reference shapes the four-field contract retired
// (cpt-frontx-adr-template-manifest-contract) are NOT re-exported here:
// every consumer of `./manifest/legacy-ownership.ts` — the composition/
// assembly/upgrade code still migrating off the five-category shape, and
// this package's own tests — imports it by its own relative path, and
// nothing outside this package depends on `@gears-frontx/cli` at all
// (the kit's `no-cli-package-edge` test enforces exactly that boundary).
// Putting a transitional, internal-only shape on the public barrel would
// invite an external dependency on something meant to be retired, not
// preserve one that already exists.
// The read-side counterpart to pre-publish validation
// (cpt-frontx-algo-template-manifest-refuse-legacy): refuses a manifest
// declaring any undeclared field outright. Wired into `manifest/validate-
// contract.ts`'s `readManifestFromContent`, which calls
// `refuseLegacyManifest` before its own contract check, so every command
// that reads a manifest through it — `register`, `validate`, the assembler,
// the upgrade engine's payload resolution — refuses a legacy-shaped
// manifest already.
export { refuseLegacyManifest } from './manifest/refuse-legacy';
export type { ManifestRefusal, RefuseLegacyResult, ParsedManifestJson } from './manifest/refuse-legacy';
export { createFsReadFileFn, createFsListPayloadFilesFn, createFsResolveDeclaredExclusionFn } from './adapters/fs-project-io';
export type { ValidateCommandResult } from './commands/validate';
export { MANIFEST_FILENAME } from './manifest/types';

// F12 kindless assembler core (cpt-frontx-algo-cli-scaffolding-uniform-apply,
// cpt-frontx-state-cli-scaffolding-assembly-op) — the ONE apply path both
// seed-a-repository and add-a-template invoke. The pre-flight conflict
// checker (P29) and the entry flows (P30) build on this surface.
export { uniformApply } from './scaffold/assembler';
export type { UniformApplyResult } from './scaffold/assembler';
// `scaffold/state.ts`'s `runAssemblyOp` driver and its input/verdict types
// are no longer re-exported: that driver has zero real callers, and the
// `uniformApply` rewrite made it impossible to wire to at all. It also
// carried this state machine's transition markers, which would make the
// machine look implemented by code nothing invokes while the live pipeline
// (`commands/apply.ts`) carries no markers for it.

// `ReadProjectFileFn` is intentionally NOT re-exported from here again: it is
// the same shape as upgrade's `ReadProjectFileFn` (already exported below),
// redeclared locally in `scaffold/types.ts` only to avoid a cross-feature
// import, not to mint a second public name for it.
export type {
  WriteFileFn,
  ConflictCheckFn,
  ContentItem,
  ReadContentItemsFn,
  ContributionEntry,
  StagedAssembly,
} from './scaffold/types.js';



// The uniform batch model's own command surface: `assemble` (stateless
// preview), `apply` (the ONE materialization mechanism, realizing
// cpt-frontx-flow-cli-scaffolding-add-template), and `seed`
// (cpt-frontx-flow-cli-scaffolding-seed-repository, which wraps `apply`'s
// own pipeline rather than duplicating it). These three retire the OLD
// `seedRepository`/`addTemplate` command surface.
export { resolveAndCheckBatch, runApplyPipeline } from './commands/apply';
export type { ApplyBatchOutcome, ApplyBatchTargetRef, ApplyPipelineDeps, ResolveAndCheckDeps, ResolveAndCheckOutcome } from './commands/apply';
export { assembleBatch } from './commands/assemble';
export type { AssembleOutcome, AssemblePreviewEntry } from './commands/assemble';
export { seedRepository } from './commands/seed-repository';
export type { SeedRepositoryDeps, SeedRepositoryOutcome } from './commands/seed-repository';
export { OFFICIAL_DEFAULT_TEMPLATES, officialDefaultOrigin } from './commands/official-defaults';
export { createFsReadInstalledContentFn, createFsReadExistingContentFn } from './adapters/fs-existing-content';
// `TargetPathState`/`ReadTargetPathStateFn` still live in `./commands/add-
// template` — see that file's own header comment for why (`ownership.ts`'s
// own, unmoved, import of this exact path).
export type { ReadTargetPathStateFn, TargetPathState } from './commands/add-template';
export { createFsReadTargetPathStateFn } from './adapters/fs-target-path';

// F14 Upgrade Change-Set Engine (cpt-frontx-dod-upgrade-changeset-single-engine)
// There is exactly ONE engine — the whole-file, name-atomic mechanism
// `cpt-frontx-adr-project-upgrade-mechanism` establishes, replacing the
// retired region-union engine (`upgrade/compute.ts`/`apply.ts`/`rollback.ts`,
// since deleted) entirely. Direct CLI invocation uses these
// canonical modules internally, through `commands/upgrade.ts`'s own
// dispatch surface; any external orchestrator reaches this same engine only
// through the `frontx upgrade` command/invocation surface (`upgradeCommand`,
// ./commands/upgrade.js), per DESIGN §3.4 ("... through its command surface
// ... NOT by linking its engine") — never by importing these modules
// directly for its own second implementation.
export { upgradeToOrigin, restorePreceding } from './upgrade/flow';
export type { UpgradeEngineDeps, UpgradeFlowOutcome } from './upgrade/flow';
export { validateUpgrade } from './upgrade/validate';
export type { ValidateInput, ValidateOutcome } from './upgrade/validate';
export { classifyTarget } from './upgrade/classify';
export type { ClassifyInput, ClassifyResult } from './upgrade/classify';
export { commitUpgrade } from './upgrade/commit';
export type { CommitDeps, CommitOutcome } from './upgrade/commit';
export { createResolvePayloadFn, versionMatchesRecorded } from './upgrade/payload';
export type { ResolvePayloadDeps } from './upgrade/payload';
export type {
  UpgradePlan,
  UpgradeOperation,
  UpgradeOpKind,
  UpgradeSkippedPath,
  SkipReason,
  OriginVersion,
  ResolvedPayload,
  ResolvePayloadResult,
  ResolvePayloadFn,
  DiskEntry,
  ReadDiskEntryFn,
  ListDiskFilesFn,
  WriteDiskFileFn,
  RenameDiskFileFn,
  UnlinkDiskFileFn,
  PresentUpgradePlanFn,
  UpgradeRefusalCode,
  UpgradeRefusal,
  ReadProjectFileFn,
  WriteProjectFileFn,
  RemoveProjectFileFn,
} from './upgrade/types';
export {
  createFsReadDiskEntryFn,
  createFsListDiskFilesFn,
  createFsWriteDiskFileFn,
  createFsRenameDiskFileFn,
  createFsUnlinkDiskFileFn,
} from './adapters/fs-upgrade-io';

// F14 command/invocation surface — the ONLY integration path F17 (and any
// other external artifact) should use to drive the change-set engine.
export { upgradeCommand } from './commands/upgrade';
export type { UpgradeCommandFlags, UpgradeCommandOutcome, UpgradeDirection } from './commands/upgrade';

// F19 project state, registration & ownership management
// (cpt-frontx-feature-composed-provenance) — `register`/`unregister` own
// the manifest-keyed `templates[name]` entries of `.frontx/project.json`,
// and `ownership add|remove|list` own its `projectOwnedRoots` exceptions.
export { registerTemplate } from './commands/register';
export type { RegisterOutcome, RegisterInventoryPort } from './commands/register';
export { unregisterTemplate } from './commands/unregister';
export type { UnregisterOutcome } from './commands/unregister';
export { ownershipAdd, ownershipRemove, ownershipList } from './commands/ownership';
export type {
  OwnershipAddOutcome,
  OwnershipRemoveOutcome,
  OwnershipListOutcome,
  OwnershipInventoryPort,
} from './commands/ownership';

// F19 delete (cpt-frontx-flow-cli-scaffolding-delete-target) — the deletion-
// plan algorithm (cpt-frontx-algo-cli-scaffolding-delete-plan) that computes
// what would be removed/preserved for an applied target, and the command
// that gates its execution on explicit confirmation.
export { computeDeletionPlan } from './scaffold/delete-plan';
export type { DeletionPlanResult, DeletePlanInventoryPort, ListTargetFilesFn } from './scaffold/delete-plan';
export { createFsListTargetFilesFn } from './adapters/fs-project-io';
export { deleteTarget } from './commands/delete';
export type {
  DeleteOutcome,
  DeleteCommandFlags,
  ConfirmDeletionFn,
  RemoveTargetFileFn,
  RemoveAiBundleFn,
} from './commands/delete';

// F19 `validate --project` (cpt-frontx-flow-composed-provenance-validate-
// project, cpt-frontx-algo-composed-provenance-validate-project) — checks
// `.frontx/project.json` against reality (the registry, the local
// inventory, and the filesystem), not only against its own structural
// shape.
export { validateProject } from './commands/validate-project';
export type { ValidateProjectDeps, ValidateProjectOutcome, ValidateProjectErrorCode } from './commands/validate-project';
