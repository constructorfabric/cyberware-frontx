/**
 * @gears-frontx/framework - FrontX Framework Package
 *
 * This package provides:
 * - Plugin architecture for composable FrontX applications
 * - Registries for screensets, themes, routes
 * - Presets for common configurations
 * - Re-exports from SDK packages for convenience
 *
 * Framework Layer: L2 (Depends on all SDK packages)
 */

// @cpt-dod:cpt-frontx-dod-framework-composition-reexports:p1

// ============================================================================
// Core Exports
// ============================================================================

export { createFrontX } from './createFrontX';
export { createFrontXApp, type FrontXAppConfig } from './createFrontXApp';

// ============================================================================
// Plugin Exports
// ============================================================================

export {
  themes,
  layout,
  i18n,
  effects,
  auth,
  frontxApiTransport,
  type AuthPluginConfig,
  type AuthRuntime,
  type AuthTransportBinding,
  type AuthTransportBinder,
  type Hai3ApiAuthTransportConfig,
  queryCache,
  queryCacheShared,
  subscribeQueryCacheRuntimeChanged,
  mock,
  microfrontends,
  type MockPluginConfig,
  type QueryCacheConfig,
} from './plugins';

// Auth contract types (re-exported from @gears-frontx/auth)
export type {
  AuthProvider,
  AuthSession,
  AuthContext,
  AuthCheckResult,
  AuthLoginInput,
  AuthCallbackInput,
  AuthTransition,
  AuthPermissions,
  AuthIdentity,
  AccessRecord,
  AccessQuery,
  AccessDecision,
  AccessConstraint,
  AccessEvaluation,
  AccessReason,
  AuthCapabilities,
  AuthCapabilitiesResolved,
  AuthState,
  AuthStateEvent,
  AuthStateListener,
  AuthUnsubscribe,
} from '@gears-frontx/auth';

// MFE Plugin Exports
export {
  loadExtension,
  mountExtension,
  unmountExtension,
  registerExtension,
  unregisterExtension,
  selectExtensionState,
  selectRegisteredExtensions,
  selectExtensionError,
  selectMountedExtensions,
  FRONTX_POPUP_DOMAIN,
  FRONTX_SIDEBAR_DOMAIN,
  FRONTX_SCREEN_DOMAIN,
  FRONTX_OVERLAY_DOMAIN,
  // Base ExtensionDomain constants
  screenDomain,
  sidebarDomain,
  popupDomain,
  overlayDomain,
} from './plugins';

// MFE Type Constants (solution-specific GTS type ids, app-layer owned)
export {
  FRONTX_SCREEN_EXTENSION_TYPE,
  FRONTX_MFE_ENTRY_MF,
} from './mfe/constants';

// MFE Action Constants (re-exported from @gears-frontx/gts-plugin for convenience —
// these GTS-notation literals are owned by the type-system plugin, not the
// generic MFE runtime; see @gears-frontx/mfes TypeSystemPlugin.resolve*ActionId()).
export {
  FRONTX_ACTION_LOAD_EXT,
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_ACTION_UNMOUNT_EXT,
} from '@gears-frontx/gts-plugin';

// MFE Shared Property Constants (solution-specific GTS type ids, app-layer owned)
export {
  FRONTX_SHARED_PROPERTY_THEME,
  FRONTX_SHARED_PROPERTY_LANGUAGE,
} from './mfe/constants';

// MFE Types (re-exported from @gears-frontx/mfes for convenience)
export type {
  MfeMountContext,
  Extension,
  ScreenExtension,
  ExtensionPresentation,
  ExtensionDomain,
  ActionsChain,
  Action,
  SharedProperty,
  LifecycleStage,
  LifecycleHook,
  MfeEntryLifecycle,
  MfeEntry,
  MfeEntryMF,
  LoadExtPayload,
  MountExtPayload,
  UnmountExtPayload,
  MfeRegistryConfig,
  TypeSystemPlugin,
  // MF2 manifest types
  MfManifest,
  MfManifestMetaData,
  MfManifestRemoteEntry,
  MfManifestBuildInfo,
  MfManifestShared,
  MfManifestAssets,
} from '@gears-frontx/mfes';

// JSONSchema type (from the GTS type-system plugin, not core MFE runtime)
export type { JSONSchema } from '@gears-frontx/gts-plugin';

// MFE Abstract Classes (re-exported from @gears-frontx/mfes for convenience)
export {
  ChildMfeBridge,
  ParentMfeBridge,
  MfeHandler,
  MfeBridgeFactory,
  ActionHandler,
  MfeRegistry,
  MfeRegistryFactory,
  ExtensionDomainImplementationFactory,
  ExtensionDomainImplementation,
  ExtensionMounter,
  MountStrategy,
  ConcurrentMountStrategy,
  OptionalMountStrategy,
  ExclusiveMountStrategy,
} from '@gears-frontx/mfes';

// MFE Registry singleton (app-layer composition root — see ./mfe/registry)
export { mfeRegistryFactory } from './mfe/registry';

export type {
  ContainerHooks,
  DomainContext,
  ActionPayload,
} from '@gears-frontx/mfes';

// MFE Concrete Implementations (re-exported from @gears-frontx/mfes for convenience)
export { MfeHandlerMF } from '@gears-frontx/mfes';
export { gtsPlugin } from '@gears-frontx/gts-plugin';

// MFE Utilities (re-exported from @gears-frontx/mfes for convenience)
export {
  createShadowRoot,
  injectCssVariables,
  extractGtsPackage,
} from '@gears-frontx/mfes';

// MFE Plugin Types
export type {
  MfeState,
  ExtensionRegistrationState,
  RegisterExtensionPayload,
  UnregisterExtensionPayload,
  MicrofrontendsConfig,
} from './plugins';

// ============================================================================
// Preset Exports
// ============================================================================

export { presets, full, minimal, type FullPresetConfig } from './presets';

// ============================================================================
// Registry Exports
// ============================================================================

export {
  createThemeRegistry,
} from './registries';

// ============================================================================
// Type Exports
// ============================================================================

export type {
  FrontXConfig,
  FrontXPlugin,
  FrontXAppBuilder,
  FrontXApp,
  FrontXAppGuarantees,
  PluginFactory,
  PluginProvides,
  PluginLifecycle,
  ThemeRegistry,
  ThemeConfig,
  RouterMode,
  Preset,
  Presets,
  ThemesConfig,
  ShowPopupPayload,
  ChangeThemePayload,
  ThemePropagationFailedPayload,
  SetLanguagePayload,
  LanguagePropagationFailedPayload,
} from './types';

// ============================================================================
// Re-exports from SDK packages for convenience
// ============================================================================

// From @gears-frontx/state (unified Flux dataflow pattern)
export { eventBus, createStore, getStore, registerSlice, hasSlice, createSlice } from '@gears-frontx/state';
export type {
  EventBus,
  ReducerPayload,
  EventPayloadMap,
  EventHandler,
  Subscription,
  RootState,
  AppDispatch,
  SliceObject,
  EffectInitializer,
} from '@gears-frontx/state';

// Re-export FrontXStore from types (wrapped version)
export type { FrontXStore } from './types';

// Layout slices (owned by @gears-frontx/framework)
export {
  layoutReducer,
  layoutDomainReducers,
  LAYOUT_SLICE_NAME,
  // Tenant slice (app-level, not layout)
  TENANT_SLICE_NAME,
  tenantSlice,
  tenantActions,
  tenantReducer,
  setTenant,
  setTenantLoading,
  clearTenant,
  // Mock slice (app-level, not layout)
  mockSlice,
  mockActions,
  setMockEnabled,
  // Domain slices
  headerSlice,
  footerSlice,
  menuSlice,
  sidebarSlice,
  popupSlice,
  overlaySlice,
  // Domain actions
  headerActions,
  footerActions,
  menuActions,
  sidebarActions,
  popupActions,
  overlayActions,
  // Individual reducer functions - header
  setUser,
  setHeaderLoading,
  clearUser,
  // Individual reducer functions - footer
  setFooterVisible,
  setFooterConfig,
  toggleMenu,
  setMenuCollapsed,
  setMenuItems,
  setMenuVisible,
  setMenuConfig,
  toggleSidebar,
  setSidebarCollapsed,
  setSidebarPosition,
  setSidebarTitle,
  setSidebarContent,
  setSidebarVisible,
  setSidebarWidth,
  setSidebarConfig,
  openPopup,
  closePopup,
  closeTopPopup,
  closeAllPopups,
  showOverlay,
  hideOverlay,
  setOverlayVisible,
} from './slices';

// PopupSliceState type
export type { PopupSliceState } from './slices';

// Layout state types (defined locally to avoid circular deps with uicore/react)
export type {
  // App-level types
  Tenant,
  TenantState,
  // Layout domain types
  HeaderUser,
  HeaderState,
  HeaderConfig,
  FooterState,
  FooterConfig,
  MenuItem,
  MenuState,
  SidebarPosition,
  SidebarState,
  PopupState,
  PopupConfig,
  OverlayState,
  OverlayConfig,
  LayoutState,
  LayoutDomainState,
  RootStateWithLayout,
  LayoutDomainReducers,
} from './layoutTypes';

// Mock state type
export type { MockState } from './slices/mockSlice';

// Tenant effects and events
export {
  initTenantEffects,
  TenantEvents,
} from './effects/tenantEffects';
export type { TenantChangedPayload, TenantClearedPayload } from './effects/tenantEffects';
export {
  changeTenant,
  clearTenantAction,
  setTenantLoadingState,
} from './effects/tenantActions';

// Mock effects and events
export {
  initMockEffects,
  toggleMockMode,
  MockEvents,
} from './effects/mockEffects';
export type { MockTogglePayload } from './effects/mockEffects';

// From @gears-frontx/api
export {
  apiRegistry,
  BaseApiService,
  RestProtocol,
  RestEndpointProtocol,
  SseProtocol,
  SseStreamProtocol,
  // Plugin base classes
  ApiPluginBase,
  ApiPlugin,
  ApiProtocol,
  RestPlugin,
  RestPluginWithConfig,
  SsePlugin,
  SsePluginWithConfig,
  resetSharedFetchCache,
  // Type guards
  isShortCircuit,
  isRestShortCircuit,
  isSseShortCircuit,
  // Mock plugin identification
  MOCK_PLUGIN,
  isMockPlugin,
} from '@gears-frontx/api';
export type {
  MockMap,
  ApiServiceConfig,
  JsonValue,
  JsonObject,
  JsonPrimitive,
  JsonCompatible,
  SseProtocolConfig,
  RestProtocolConfig,
  // Plugin context types (class-based plugin system)
  ApiRequestContext,
  ApiResponseContext,
  ShortCircuitResponse,
  PluginClass,
  ProtocolClass,
  ProtocolPluginType,
  BasePluginHooks,
  // Protocol-specific types
  RestPluginHooks,
  SsePluginHooks,
  RestRequestContext,
  RestResponseContext,
  ApiPluginErrorContext,
  SseConnectContext,
  EventSourceLike,
  RestShortCircuitResponse,
  SseShortCircuitResponse,
  // Endpoint descriptor types (consumed by useApiQuery / useApiMutation at L3)
  EndpointOptions,
  EndpointDescriptor,
  ParameterizedEndpointDescriptor,
  MutationDescriptor,
  // Stream descriptor types (consumed by useApiStream at L3)
  StreamDescriptor,
  StreamStatus,
} from '@gears-frontx/api';
// Protocol-specific mock plugins (RestMockPlugin, SseMockPlugin, MockEventSource)
// live in the application template (@gears-frontx/frontx-template-shell) since
// Phase 9's mock separation and are NOT re-exported here: the template root is a
// private package, so re-exporting it would make this entry point unresolvable
// for standalone consumers (#601). Import them from the template package directly.

// NOTE: AccountsApiService, ACCOUNTS_DOMAIN, and account types (ApiUser, UserRole, etc.)
// have been moved to CLI templates. They are now generated by `frontx scaffold layout`
// and should be imported from user code (e.g., @/layout/api or @/api).

// From @gears-frontx/i18n
export { i18nRegistry, I18nRegistryImpl, createI18nRegistry, Language, SUPPORTED_LANGUAGES, getLanguageMetadata, TextDirection, LanguageDisplayMode } from '@gears-frontx/i18n';
export type { I18nConfig, TranslationLoader, TranslationMap, TranslationDictionary, LanguageMetadata, I18nRegistry as I18nRegistryType } from '@gears-frontx/i18n';

// Formatters (locale from i18nRegistry.getLanguage())
export {
  formatDate,
  formatTime,
  formatDateTime,
  formatRelative,
  formatNumber,
  formatPercent,
  formatCompact,
  formatCurrency,
  compareStrings,
  createCollator,
  type DateFormatStyle,
  type TimeFormatStyle,
  type DateInput,
} from '@gears-frontx/i18n';
export type { Formatters } from '@gears-frontx/i18n';

// Backward compatibility aliases
// I18nRegistry type (capital I) - alias for consistency with old @gears-frontx/uicore API
export { I18nRegistryImpl as I18nRegistry } from '@gears-frontx/i18n';

// Backward compatibility constants
export {
  ACCOUNTS_DOMAIN,
} from './compat';

// ============================================================================
// Test utilities (subset re-export; full API: `@gears-frontx/framework/testing`)
// ============================================================================

export { TestContainerProvider } from './testing/TestContainerProvider';
export { resetSharedQueryClient } from './plugins/queryCache';

// ============================================================================
// Migration Helpers (for @gears-frontx/uicore backward compatibility)
// ============================================================================

export {
  createLegacySelector,
  setDeprecationWarnings,
  isDeprecationWarningsEnabled,
  getLayoutDomainState,
  hasLegacyUicoreState,
  hasNewLayoutState,
  STATE_PATH_MAPPING,
} from './migration';

export type {
  LegacyUicoreState,
  LegacyRootState,
  Selector,
} from './migration';
