/**
 * @gears-frontx/framework - Type Definitions
 *
 * Core types for FrontX framework with plugin architecture.
 * Integrates all SDK packages into a cohesive framework.
 */

// ============================================================================
// Type Imports from SDK Packages
// ============================================================================

// From @gears-frontx/state
import type {
  FrontXStore as StoreType,
  EffectInitializer,
} from '@gears-frontx/state';

import type { Reducer } from '@reduxjs/toolkit';

// From @gears-frontx/api
import type { ApiRegistry } from '@gears-frontx/api';

// From @gears-frontx/i18n
import type { I18nRegistry } from '@gears-frontx/i18n';

// From @gears-frontx/mfes
import type { MfeRegistry } from '@gears-frontx/mfes';

// Re-export FrontXStore from @gears-frontx/store for framework consumers
export type FrontXStore = StoreType;

// ============================================================================
// FrontX Configuration
// ============================================================================

/**
 * Router mode type
 */
export type RouterMode = 'browser' | 'hash' | 'memory';

/**
 * FrontX Application Configuration
 * Configuration options for creating a FrontX application.
 */
export interface FrontXConfig {
  /** Application name */
  name?: string;
  /** Enable development mode */
  devMode?: boolean;
  /** Enable strict mode (throws on errors) */
  strictMode?: boolean;
  /**
   * Auto-route to the first registered route on mount.
   * When false, stays on "/" until explicit navigation occurs.
   * @default true
   * @deprecated Legacy option, will be removed in a future version.
   */
  autoNavigate?: boolean;
  /**
   * Base path for navigation. Example: '/console' makes routes /console/*.
   * @default '/'
   */
  base?: string;
  /**
   * Router mode - browser (default), hash, or memory.
   * - browser: Uses HTML5 history API (clean URLs)
   * - hash: Uses URL hash (#/path)
   * - memory: In-memory routing without URL sync
   * @default 'browser'
   */
  routerMode?: RouterMode;
}

// ============================================================================
// Internal Slice Types
// ============================================================================

/**
 * Registerable Slice Interface
 * Minimal interface for slices that can be registered with the framework.
 * Used for heterogeneous slice collections where different state types are mixed.
 *
 * This is an internal framework type - plugins provide slices matching this structure.
 * The Reducer type uses RTK's default, avoiding explicit `any` in FrontX code.
 */
export interface RegisterableSlice {
  /** Slice name - becomes the state key */
  readonly name: string;
  /** Slice reducer function */
  readonly reducer: Reducer;
  /** Slice action creators (optional for registration) */
  readonly actions?: Record<string, unknown>;
}

// ============================================================================
// Plugin System Types
// ============================================================================

/**
 * FrontX Actions Interface
 * Central registry of all actions available in the application.
 *
 * Built-in actions are defined here. Consumers can extend this interface
 * via module augmentation to add custom actions:
 *
 * @example
 * ```typescript
 * declare module '@gears-frontx/framework' {
 *   interface FrontXActions {
 *     myCustomAction: (payload: MyPayload) => void;
 *   }
 * }
 * ```
 *
 * Design: Interface (not type) enables TypeScript declaration merging.
 */
export interface FrontXActions {
  // ==========================================================================
  // Theme actions (from themes plugin)
  // ==========================================================================
  changeTheme: (payload: ChangeThemePayload) => void;

  // ==========================================================================
  // I18n actions (from i18n plugin)
  // ==========================================================================
  setLanguage: (payload: SetLanguagePayload) => void;

  // ==========================================================================
  // Layout actions (from layout plugin)
  // ==========================================================================
  showPopup: (payload: ShowPopupPayload) => void;
  hidePopup: () => void;
  showOverlay: (payload: { id: string }) => void;
  hideOverlay: () => void;
  toggleMenuCollapsed: (payload: { collapsed: boolean }) => void;
  toggleSidebarCollapsed: (payload: { collapsed: boolean }) => void;
  setHeaderVisible: (payload: boolean) => void;
  setFooterVisible: (payload: boolean) => void;
  setMenuCollapsed: (payload: boolean) => void;
  setSidebarCollapsed: (payload: boolean) => void;

  // ==========================================================================
  // Mock actions (from mock plugin)
  // ==========================================================================
  toggleMockMode: (enabled: boolean) => void;

  // ==========================================================================
  // MFE actions (from microfrontends plugin)
  // ==========================================================================
  loadExtension: (extensionId: string) => void;
  mountExtension: (extensionId: string) => void;
  unmountExtension: (extensionId: string) => void;
  registerExtension: (extension: import('@gears-frontx/mfes').Extension) => void;
  unregisterExtension: (extensionId: string) => void;
}

/**
 * Plugin Provides Interface
 * What a plugin contributes to the application.
 */
export interface PluginProvides {
  /** Registry contributions */
  registries?: Record<string, unknown>;
  /**
   * Runtime app surface extensions.
   * Use module augmentation to extend `FrontXAppRuntimeExtensions`.
   *
   * This is the non-special-case way for plugins to expose runtime APIs
   * on the built `app` instance (e.g. `app.auth`, `app.queryClient`).
   */
  app?: Partial<FrontXAppRuntimeExtensions>;
  /** Redux slices to register */
  slices?: RegisterableSlice[];
  /** Effect initializers to register */
  effects?: EffectInitializer[];
  /** Actions provided by the plugin (subset of FrontXActions) */
  actions?: Partial<FrontXActions>;
}

/**
 * Plugin Lifecycle Interface
 * Lifecycle hooks for plugin initialization.
 */
export interface PluginLifecycle {
  /**
   * Called when plugin is registered (before app starts).
   *
   * @param app - The app builder instance
   * @param config - Plugin configuration
   */
  onRegister?(app: FrontXAppBuilder, config: unknown): void;

  /**
   * Called after all plugins registered, before app starts.
   *
   * @param app - The built app instance
   */
  onInit?(app: FrontXApp): void | Promise<void>;

  /**
   * Called when app is destroyed.
   *
   * @param app - The app instance
   */
  onDestroy?(app: FrontXApp): void;
}

/**
 * FrontX Plugin Interface
 * All plugins implement this contract.
 * Follows Liskov Substitution Principle - any plugin can be used interchangeably.
 *
 * @template TConfig - Plugin configuration type
 *
 * @example
 * ```typescript
 * const microfrontendsPlugin: FrontXPlugin = {
 *   name: 'microfrontends',
 *   dependencies: [],
 *   provides: {
 *     slices: [mfeSlice],
 *     actions: {
 *       mountExtension: (extensionId: string) => { ... },
 *     },
 *   },
 *   onInit(app) {
 *     // Initialize MFE registry
 *     app.mfeRegistry = mfeRegistryFactory.create(...);
 *   },
 * };
 * ```
 */
export interface FrontXPlugin<TConfig = unknown> extends PluginLifecycle {
  /** Unique plugin identifier */
  name: string;

  /** Other plugins this plugin requires */
  dependencies?: string[];

  /** What this plugin provides to the app */
  provides?: PluginProvides;

  /** Plugin configuration type marker (used for type inference) */
  _configType?: TConfig;
}

/**
 * Plugin Factory Function
 * Factory function that creates a plugin with optional configuration.
 *
 * @template TConfig - Plugin configuration type
 */
export type PluginFactory<TConfig = unknown> = (config?: TConfig) => FrontXPlugin<TConfig>;

// ============================================================================
// App Builder Interface
// ============================================================================

/**
 * FrontX App Builder Interface
 * Fluent builder for composing FrontX applications with plugins.
 *
 * @example
 * ```typescript
 * const app = createFrontX()
 *   .use(themes())
 *   .use(layout())
 *   .build();
 * ```
 */
export interface FrontXAppBuilder {
  /**
   * Add a plugin to the application.
   *
   * Also accepts an array of plugins, which is how preset helpers such as
   * `presets.minimal()` are consumed.
   *
   * @param plugin - Plugin instance, plugin factory, or an array of plugins (e.g. a preset)
   * @returns Builder for chaining
   */
  use(plugin: FrontXPlugin | PluginFactory | FrontXPlugin[]): FrontXAppBuilder;

  /**
   * Add multiple plugins at once.
   *
   * @param plugins - Array of plugins or factories
   * @returns Builder for chaining
   */
  useAll(plugins: Array<FrontXPlugin | PluginFactory>): FrontXAppBuilder;

  /**
   * Build the application.
   * Resolves dependencies, initializes plugins, and returns the app.
   *
   * @returns The built FrontX application
   */
  build(): FrontXApp;
}

// ============================================================================
// Built App Interface
// ============================================================================

/**
 * Theme Configuration
 * Configuration for a theme.
 */
export interface ThemeConfig {
  /** Theme ID */
  id: string;
  /** Theme name */
  name: string;
  /** CSS custom properties */
  variables: Record<string, string>;
  /** Whether this is the default theme */
  default?: boolean;
  /**
   * Base appearance of the theme. apply() stamps it as `data-theme` on the
   * document root so design-system stylesheets that switch token sets on
   * [data-theme='light'|'dark'] (e.g. the installed UI kit's theme.css)
   * follow this theme's light/dark nature. Defaults to 'light' when omitted,
   * so a theme that defines only some token names never mixes with the
   * kit's OS-driven dark defaults for the rest.
   */
  appearance?: 'light' | 'dark';
}

/**
 * Theme Registry Interface
 * Registry for managing themes.
 */
export interface ThemeRegistry {
  /**
   * Register a theme.
   *
   * @param config - Theme configuration with CSS variable map
   */
  register(config: ThemeConfig): void;

  /** Get theme by ID */
  get(id: string): ThemeConfig | undefined;
  /** Get all themes */
  getAll(): ThemeConfig[];
  /** Apply a theme */
  apply(id: string): void;
  /** Get current theme */
  getCurrent(): ThemeConfig | undefined;

  /**
   * Subscribe to theme changes.
   * @param callback - Called when theme changes
   * @returns Unsubscribe function
   */
  subscribe(callback: () => void): () => void;

  /**
   * Get current version number.
   * Used by React for re-rendering on theme changes.
   */
  getVersion(): number;
}

/**

/**
 * FrontX App Runtime Extensions
 * Plugins may augment this interface to add typed runtime APIs onto `app`.
 *
 * Serves as a declaration-merging target for plugins
 * (e.g. `auth.ts` adds `auth?: AuthRuntime` via `declare module`).
 *
 * The private `__frontxPluginExtensible` marker keeps the interface
 * non-empty (satisfies `no-empty-interface` / `no-empty-object-type`)
 * without affecting consumers — it is optional and typed as `never`.
 */
export interface FrontXAppRuntimeExtensions {
  readonly __frontxPluginExtensible?: never;
}

/**
 * FrontX App Guarantees
 *
 * Empty by default. An application that always builds with the `microfrontends()`
 * plugin can declare `mfeRegistry: true` to state that the registry is guaranteed
 * present, dropping the optional modifier for every consumer of `FrontXApp`
 * (including through `useFrontX()`) without changing anything for applications that
 * don't opt in. Declaring `mfeRegistry: false` keeps the slot optional, exactly as
 * if the interface had not been augmented at all.
 *
 * Augment it via declaration merging in an app-level `frontx.d.ts`:
 *
 * ```typescript
 * // frontx.d.ts
 * declare module '@gears-frontx/framework' {
 *   interface FrontXAppGuarantees {
 *     mfeRegistry: true;
 *   }
 * }
 * ```
 *
 * With that declaration in scope, `app.mfeRegistry` is typed as `MfeRegistry`
 * (no longer `MfeRegistry | undefined`), so call sites no longer need an
 * `if (!app.mfeRegistry)` guard or a `app.mfeRegistry!` assertion:
 *
 * ```typescript
 * app.mfeRegistry.registerDomain(myDomain, containerProvider);
 * ```
 *
 * The cost: nothing verifies the declaration against the plugins an app
 * actually composes, so an app that declares `mfeRegistry: true` but builds
 * without the `microfrontends()` plugin gets a type that lies — and the
 * framework's own composition is the first place that becomes unsound, since
 * `createFrontX` casts the aggregated registry to `FrontXApp['mfeRegistry']`
 * whether or not the plugin contributed one. This is an opt-in assertion by
 * design; it is checked by nothing at runtime.
 */
export interface FrontXAppGuarantees {}

type MfeRegistrySlot = FrontXAppGuarantees extends { mfeRegistry: true }
  ? { mfeRegistry: MfeRegistry }
  : { mfeRegistry?: MfeRegistry };

/**
 * FrontX App Interface
 * The built application with all features available.
 *
 * @example
 * ```typescript
 * const app = createFrontXApp();
 *
 * // Access store
 * const state = app.store.getState();
 *
 * // Access actions
 * app.actions.mountExtension(extensionId);
 *
 * // Access MFE registry (if microfrontends plugin is used)
 * if (app.mfeRegistry) {
 *   app.mfeRegistry.registerDomain(myDomain, containerProvider);
 * }
 * ```
 */
export interface FrontXApp extends FrontXAppRuntimeExtensions, MfeRegistrySlot {
  /** Application configuration */
  config: FrontXConfig;

  /** Redux store */
  store: FrontXStore;

  /** Theme registry */
  themeRegistry: ThemeRegistry;

  /** API registry */
  apiRegistry: ApiRegistry;

  /** I18n registry */
  i18nRegistry: I18nRegistry;

  /** All registered actions (type-safe via FrontXActions interface) */
  actions: FrontXActions;

  /** Destroy the application and cleanup resources */
  destroy(): void;
}

// ============================================================================
// Create FrontX App Function Signature
// ============================================================================

/**
 * Create FrontX App Function Signature
 * Creates a fully configured FrontX application using the full preset.
 *
 * @param config - Optional configuration
 * @returns The built FrontX application
 *
 * @example
 * ```typescript
 * // Default - uses full() preset
 * const app = createFrontXApp();
 *
 * // With configuration
 * const app = createFrontXApp({ devMode: true });
 * ```
 */
export type CreateFrontXApp = (config?: FrontXConfig) => FrontXApp;

/**
 * Create FrontX Function Signature
 * Creates a FrontX app builder for custom plugin composition.
 *
 * @returns App builder for plugin composition
 *
 * @example
 * ```typescript
 * const app = createFrontX()
 *   .use(themes())
 *   .build();
 * ```
 */
export type CreateFrontX = () => FrontXAppBuilder;

// ============================================================================
// Preset Types
// ============================================================================

/**
 * Preset Type
 * A preset is a function that returns an array of plugins.
 *
 * @example
 * ```typescript
 * const minimal: Preset = () => [
 *   themes(),
 * ];
 * ```
 */
export type Preset = () => FrontXPlugin[];

/**
 * Presets Collection
 * Available presets for different use cases.
 */
export interface Presets {
  /** All plugins - default for frontx create */
  full: Preset;
  /** Themes only */
  minimal: Preset;
}

// ============================================================================
// Plugin Configurations
// ============================================================================

/**
 * Themes Plugin Configuration
 * Configuration options for the themes plugin.
 */
export type ThemesConfig = Record<string, never>;

// ============================================================================
// Action Payloads
// ============================================================================

/**
 * Show Popup Payload
 */
export interface ShowPopupPayload {
  id: string;
  title?: string;
  content?: () => Promise<{ default: React.ComponentType }>;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

/**
 * Change Theme Payload
 */
export interface ChangeThemePayload {
  themeId: string;
}

/**
 * Theme Propagation Failed Payload
 * Emitted when parent theme applies but MFE propagation fails.
 */
export interface ThemePropagationFailedPayload {
  themeId: string;
  error: unknown;
}

/**
 * Set Language Payload
 */
export interface SetLanguagePayload {
  language: string;
}

/**
 * Language Propagation Failed Payload
 * Emitted when parent language applies but MFE propagation fails.
 */
export interface LanguagePropagationFailedPayload {
  language: string;
  error: unknown;
}
