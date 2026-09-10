// Manifest types (Phase 5)
export type {
  MfManifest,
  MfManifestAssets,
  MfManifestShared,
  MfManifestMetaData,
  MfManifestRemoteEntry,
  MfManifestBuildInfo,
} from './manifest/mf-manifest';

// Lazy-import ABI runtime registry (Phase 5)
export { LazyLoaderRegistry } from './lazy-loader/lazy-loader-registry';
export type { LazyResolver } from './lazy-loader/lazy-loader-registry';

// Type substrate port (Phase 2)
export type {
  ValidationErrorItem,
  ValidationResult,
  TypeSystemPlugin,
} from './type-substrate';
export { isInfrastructureLifecycleAction } from './type-substrate';

// Domain types (Phase 3)
export type {
  Action,
  ActionsChain,
  LifecycleStage,
  LifecycleHook,
  ExtensionDomain,
  Extension,
  ScreenExtension,
  ExtensionPresentation,
  MfeEntry,
  SharedProperty,
  LoadExtPayload,
  MountExtPayload,
  UnmountExtPayload,
} from './types';

// Mediator types (Phase 3)
export { ActionHandler, ActionsChainsMediator } from './mediator/types';
export type { ChainResult, ChainExecutionOptions } from './mediator/types';

// Handler type contracts (Phase 3)
export { ParentMfeBridge, ChildMfeBridge, MfeBridgeFactory, MfeHandler } from './handler/types';
export type { MfeEntryLifecycle, MfeMountContext } from './handler/types';

// Registry contracts (Phase 3)
export { MfeRegistry } from './registry/MfeRegistry';
export { MfeRegistryFactory } from './registry/MfeRegistryFactory';
export type { MfeRegistryConfig } from './runtime/config';

// Runtime abstractions (Phase 3)
export { MountStrategy } from './runtime/mount-strategy';
export type { ActionPayload, ContainerHooks } from './runtime/mount-strategy';
export { ConcurrentMountStrategy, OptionalMountStrategy, ExclusiveMountStrategy } from './runtime/mount-strategies';
export { ExtensionDomainImplementation } from './runtime/ExtensionDomainImplementation';
export { ExtensionDomainImplementationFactory } from './runtime/ExtensionDomainImplementationFactory';
export { ExtensionMounter } from './runtime/ExtensionMounter';
export { DomainLifecycleTrigger } from './runtime/DomainLifecycleTrigger';
export type { DomainContext } from './runtime/DomainContext';
export { InvalidatableDomainContext } from './runtime/DomainContext';

// Coordination types (Phase 3)
export { RuntimeCoordinator } from './runtime/coordination/types';
export type { RuntimeConnection } from './runtime/coordination/types';

// Mediator error surface (Phase 6) — the concrete mediator stays internal (ADR-0003)
export { NoHandlerForActionTargetError } from './mediator/actions-chains-mediator';

// Bridge concrete implementations (Phase 6)
export { ChildMfeBridgeImpl, ParentMfeBridgeImpl, ChildDomainForwardingHandler } from './bridge';

// Bridge error classes (Phase 6)
export { NoActionsChainHandlerError, BridgeDisposedError, BridgeInactiveError } from './bridge/errors';

// Error classes (Phase 7)
export {
  MfeError,
  DomainValidationError,
  MfeLoadError,
  ExtensionTypeError,
  ChainExecutionError,
  MfeTypeConformanceError,
  UnsupportedDomainActionError,
  UnsupportedLifecycleStageError,
  EntryTypeNotHandledError,
  type ContractError,
} from './errors';

// Shadow DOM utilities (Phase 7)
export { createShadowRoot, injectCssVariables, injectStylesheet } from './shadow';
export type { ShadowRootOptions } from './shadow';

// Contract matching validation (Phase 7)
export {
  validateContract,
  formatContractErrors,
  type ContractValidationResult,
  type ContractErrorType,
} from './validation/contract';

// Lifecycle validation (Phase 7)
export {
  validateDomainLifecycleHooks,
  validateExtensionLifecycleHooks,
  type LifecycleValidationResult,
} from './validation/lifecycle';

// Extension type validation (Phase 7)
export { validateExtensionType } from './validation/extension-type';

// Extension manager (Phase 7)
export { ExtensionManager } from './runtime/extension-manager';
export type {
  ExtensionDomainState,
  ExtensionState,
  LifecycleTriggerCallback,
  DomainLifecycleTriggerCallback,
} from './runtime/extension-manager';

// Mount manager (Phase 7)
export { MountManager } from './runtime/mount-manager';
export type { ActionChainExecutor, LifecycleTrigger } from './runtime/mount-manager';

// Runtime bridge factory (Phase 7)
export { RuntimeBridgeFactory } from './runtime/runtime-bridge-factory';

// MFE Isolation — handler, trust kernel, types (Phase 8)
// MfeHandlerMF is sanctioned surface — do not remove in a barrel cleanup.
// Rationale/table: packages/mfes/architecture/DESIGN.md, public-surface table.
export { MfeHandlerMF, LruCache } from './handler/MfeHandlerMF';
export { RetryHandler } from './handler/retry-handler';
export type { MfeEntryMF } from './types/mfe-entry-mf';
export {
  sourceImports,
  rewriteBareSpecifier,
  importBlobModule,
} from './handler/mf-dynamic-module-ops';

// Only the creation function crosses the barrel: the concrete registry and
// factory stay internal so no consumer can build a rival registry past the
// composition root (ADR-0003, enforced by scripts/mfes-import-boundary-check.mjs)
export { createMfeRegistryFactory } from './runtime/DefaultMfeRegistryFactory';

// Lifecycle manager — abstract contract; the default implementation stays internal (ADR-0003)
// (aliased: distinct from mount-manager's ActionChainExecutor, which also carries ChainExecutionOptions)
export { LifecycleManager } from './runtime/lifecycle-manager';
export type { ActionChainExecutor as LifecycleActionChainExecutor } from './runtime/lifecycle-manager';

// Operation serializer — concurrency control for registry operations
export { OperationSerializer } from './runtime/operation-serializer';

// Extension lifecycle action handler — load_ext handler wiring
export { LoadExtHandler } from './runtime/extension-lifecycle-action-handler';
export type { LifecycleActionPayload } from './runtime/extension-lifecycle-action-handler';

// Runtime coordination — default WeakMap-based implementation
export { WeakMapRuntimeCoordinator } from './runtime/coordination/weak-map-runtime-coordinator';

// MFE state container — abstract contract; the default implementation stays internal (ADR-0003)
export { MfeStateContainer } from './state';
export type { MfeStateContainerConfig } from './state';

// GTS package extraction utility
export { extractGtsPackage } from './gts/extract-package';
