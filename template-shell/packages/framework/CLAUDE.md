# @gears-frontx/framework

Plugin-based application framework for FrontX applications. Orchestrates SDK packages into cohesive applications with MFE (Microfrontend) support.

## Framework Layer

This package is part of the **Framework Layer (L2)** - it depends on SDK packages (@gears-frontx/state, @gears-frontx/mfes, @gears-frontx/gts-plugin, @gears-frontx/api, @gears-frontx/i18n). It provides the plugin architecture and **owns the layout slices** (header, footer, menu, sidebar, screen, popup, overlay).

> **NOTE:** @gears-frontx/uicore is deprecated. Layout slices are defined in @gears-frontx/framework.

## Core Concepts

### Plugin Architecture

Build applications by composing plugins:

```typescript
import { createGears FrontX, screensets, themes, layout, microfrontends, i18n } from '@gears-frontx/framework';

const app = createGears FrontX()
  .use(screensets())
  .use(themes())
  .use(layout())
  .use(microfrontends())
  .use(i18n())
  .build();
```

### Presets

Pre-configured plugin combinations:

```typescript
import { createGears FrontXApp, presets } from '@gears-frontx/framework';

// Full preset (default) - all plugins including MFE support
const fullApp = createGears FrontXApp();

// Or explicitly use presets
const minimalApp = createGears FrontX()
  .use(presets.minimal())  // screensets + themes only
  .build();

const headlessApp = createGears FrontX()
  .use(presets.headless()) // screensets only
  .build();
```

### Available Plugins

| Plugin | Provides | Dependencies |
|--------|----------|--------------|
| `screensets()` | `screenSlice` state, `setActiveScreen`, `setScreenLoading` | - |
| `themes()` | themeRegistry, changeTheme action | - |
| `layout()` | header, footer, menu, sidebar, popup, overlay state | screensets |
| `microfrontends()` | `screensetsRegistry` (MFE-enabled), MFE actions, selectors, domain constants | screensets |
| `i18n()` | i18nRegistry, setLanguage action | - |
| `effects()` | Core effect coordination | - |
| `queryCache()` | Host-owned shared `QueryClient` lifecycle, Flux `cache/*` events, mock toggle + destroy cleanup, L1 `sharedFetchCache` retain/release and invalidation sync | - |
| `queryCacheShared()` | Joins the host `QueryClient` from `queryCache()` for MFE / child roots (no second client) | host `queryCache()` runtime must exist |
| `mock()` | mockSlice, toggleMockMode action | effects |

### Query Cache Plugin

The `queryCache()` plugin owns the shared **headless TanStack Query `QueryClient`** (`@tanstack/query-core` peer) and bridges it to L1 transport dedup: it **retains** the global `sharedFetchCache` from `@gears-frontx/api` for the app lifetime and **keeps it aligned** with Flux-driven cache events. It's included in the `full()` preset by default:

```typescript
import { createGears FrontXApp } from '@gears-frontx/framework';

// Full preset includes queryCache plugin automatically
const app = createGears FrontXApp();

// The plugin attaches the shared QueryClient to the app for React bindings
// and shared child roots via queryCacheShared().

// Cache is cleared on mock mode toggle (query cache + shared fetch layer)
// Flux effects can drive cache via eventBus, e.g.:
//   eventBus.emit('cache/invalidate', { queryKey })
//   eventBus.emit('cache/set', { queryKey, dataOrUpdater })
//   eventBus.emit('cache/remove', { queryKey })
```

For custom plugin compositions:

```typescript
import { createGears FrontX, queryCache } from '@gears-frontx/framework';

const app = createGears FrontX()
  .use(queryCache({ staleTime: 60_000, gcTime: 600_000 }))
  .build();
```

The plugin:
- Creates or joins a shared `QueryClient` with configurable defaults (`staleTime`, `gcTime`, `retry: 0`, `refetchOnWindowFocus`)
- Calls `retainSharedFetchCache()` on init and `releaseSharedFetchCache()` after teardown on destroy (balances in-flight shared fetch retention)
- On mock toggle: cancels queries, clears the shared `QueryClient`, then clears `peekSharedFetchCache()` when present
- Subscribes to `cache/invalidate`, `cache/set`, and `cache/remove` — updates the shared `QueryClient` **and** mirrors invalidation to `sharedFetchCache` for matching keys (avoiding stale transport dedup vs React observers)
- Attaches the shared `QueryClient` to each app instance so `@gears-frontx/react` can resolve it internally
- On destroy: unsubscribes listeners, cancels and clears the client when the last retainer is released, then releases shared-fetch retention

`@tanstack/query-core` is a peer dependency of `@gears-frontx/framework` (React bindings remain in `@gears-frontx/react`).

### Mock Mode Control

The `mock()` plugin provides centralized mock mode control. It's included in the `full()` preset by default, so apps don't need manual setup:

```typescript
import { createGears FrontXApp } from '@gears-frontx/framework';

// Full preset includes mock plugin automatically
const app = createGears FrontXApp();

// Toggle mock mode via actions (used by FrontX Studio ApiModeToggle)
app.actions.toggleMockMode(true);  // Activates all registered mock plugins
app.actions.toggleMockMode(false); // Deactivates all registered mock plugins
```

For custom plugin compositions:

```typescript
import { createGears FrontX, effects, mock } from '@gears-frontx/framework';

const app = createGears FrontX()
  .use(effects())  // Required dependency
  .use(mock())     // Automatic mock mode control
  .build();
```

Services register mock plugins using `registerPlugin()` in their constructor. The framework automatically manages plugin activation based on mock mode state.

### Built Application

After calling `.build()`, access registries and actions through `app.*`. The MFE-enabled `screensetsRegistry` is available when the build includes `microfrontends()` (for example, `createGears FrontXApp()`):

```typescript
const app = createGears FrontXApp(); // Full preset includes microfrontends()

// Access MFE-enabled registry
app.screensetsRegistry.registerDomain(screenDomain, containerProvider);
await app.screensetsRegistry.registerExtension(homeExtension);
await app.screensetsRegistry.executeActionsChain({
  action: { type: Gears FrontX_ACTION_MOUNT_EXT, target: 'screen', payload: { subject: 'home' } }
});

// Access other registries
app.themeRegistry.getCurrent();
app.i18nRegistry.t('common:title');

// Access store
const state = app.store.getState();
app.store.dispatch(someAction);

// Access MFE actions
app.actions.loadExtension({ extensionId: 'home' });
app.actions.mountExtension({ extensionId: 'home', domainId: 'screen', container });
app.actions.unmountExtension({ extensionId: 'home', domainId: 'screen' });
app.actions.registerExtension(homeExtension);
app.actions.unregisterExtension({ extensionId: 'home' });

// Access theme and i18n actions
app.actions.changeTheme({ themeId: 'dark' });
app.actions.setLanguage({ language: 'es' });

// Cleanup
app.destroy();
```

## MFE Plugin

The `microfrontends()` plugin provides the MFE-enabled `screensetsRegistry` plus the MFE action surface:

### MFE Actions

```typescript
import {
  loadExtension,
  mountExtension,
  unmountExtension,
  registerExtension,
  unregisterExtension,
} from '@gears-frontx/framework';

// Load extension code
await loadExtension({ extensionId: 'home' });

// Mount extension into domain
await mountExtension({
  extensionId: 'home',
  domainId: 'screen',
  container: document.getElementById('screen-container')!,
});

// Unmount extension from domain
await unmountExtension({ extensionId: 'home', domainId: 'screen' });

// Register/unregister extensions dynamically
registerExtension(homeExtension);
unregisterExtension({ extensionId: 'home' });
```

### MFE Selectors

```typescript
import {
  selectExtensionState,
  selectRegisteredExtensions,
  selectExtensionError,
} from '@gears-frontx/framework';

// Get extension state
const extensionState = selectExtensionState(state, 'home');

// Get all registered extensions
const extensions = selectRegisteredExtensions(state);

// Get extension error
const error = selectExtensionError(state, 'home');
```

### Domain Constants

```typescript
import {
  Gears FrontX_SCREEN_DOMAIN,
  Gears FrontX_SIDEBAR_DOMAIN,
  Gears FrontX_POPUP_DOMAIN,
  Gears FrontX_OVERLAY_DOMAIN,
  screenDomain,
  sidebarDomain,
  popupDomain,
  overlayDomain,
} from '@gears-frontx/framework';

// String constants (GTS instance IDs)
Gears FrontX_SCREEN_DOMAIN   // 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1'
Gears FrontX_SIDEBAR_DOMAIN  // 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.sidebar.v1'
Gears FrontX_POPUP_DOMAIN    // 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.popup.v1'
Gears FrontX_OVERLAY_DOMAIN  // 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.overlay.v1'

// Domain objects (ExtensionDomain interface: id, actions, extensionsActions,
// sharedProperties, defaultActionTimeout, lifecycleStages, extensionsLifecycleStages,
// extensionsTypeId, lifecycle)
screenDomain   // screen: swap semantics (load_ext, mount_ext only, NO unmount_ext)
sidebarDomain  // sidebar: toggle semantics (load_ext, mount_ext, unmount_ext)
popupDomain    // popup: toggle semantics (load_ext, mount_ext, unmount_ext)
overlayDomain  // overlay: toggle semantics (load_ext, mount_ext, unmount_ext)
```

### Action and Property Constants

```typescript
import {
  Gears FrontX_ACTION_LOAD_EXT,
  Gears FrontX_ACTION_MOUNT_EXT,
  Gears FrontX_ACTION_UNMOUNT_EXT,
  Gears FrontX_SHARED_PROPERTY_THEME,
  Gears FrontX_SHARED_PROPERTY_LANGUAGE,
} from '@gears-frontx/framework';

// Action IDs
Gears FrontX_ACTION_LOAD_EXT     // 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.load_ext.v1~'
Gears FrontX_ACTION_MOUNT_EXT    // 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.mount_ext.v1~'
Gears FrontX_ACTION_UNMOUNT_EXT  // 'gts.frontx.mfes.comm.action.v1~frontx.mfes.ext.unmount_ext.v1~'

// Shared property IDs
Gears FrontX_SHARED_PROPERTY_THEME    // 'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.theme.v1~'
Gears FrontX_SHARED_PROPERTY_LANGUAGE // 'gts.frontx.mfes.comm.shared_property.v1~frontx.mfes.comm.language.v1~'
```

## Creating Custom Plugins

Extend FrontX with custom functionality:

```typescript
import type { Gears FrontXPlugin } from '@gears-frontx/framework';

export function myPlugin(): Gears FrontXPlugin {
  return {
    name: 'my-plugin',
    dependencies: ['screensets'], // Optional dependencies
    provides: {
      registries: { myRegistry: createMyRegistry() },
      slices: [mySlice],
      effects: [initMyEffects],
      actions: { myAction: myActionHandler },
    },
    onInit(app) {
      // Initialize after app is built
    },
    onDestroy(app) {
      // Cleanup when app is destroyed
    },
  };
}
```

## Key Rules

1. **Use presets for common cases** - `createGears FrontXApp()` for full apps with MFE support
2. **Compose plugins for customization** - Use `createGears FrontX().use()` pattern
3. **Dependencies are auto-resolved** - Plugin order doesn't matter
4. **Access via app instance** - All registries and actions on `app.*`
5. **NO React in this package** - Framework is headless, use @gears-frontx/react for React bindings
6. **MFE is the primary architecture** - Use `screensetsRegistry` for domain/extension management when the app includes `microfrontends()`

## Re-exports

For convenience, this package re-exports from SDK packages:

- From @gears-frontx/state: `eventBus`, `createStore`, `getStore`, `registerSlice`, `hasSlice`, `createSlice`
- From @gears-frontx/mfes: `Extension`, `ScreenExtension`, `ExtensionDomain`, `MfeHandler`, `MfeBridgeFactory`, `ParentMfeBridge`, `ChildMfeBridge`, action constants, contracts/types
- From @gears-frontx/gts-plugin: `gtsPlugin`, `JSONSchema`
- From @gears-frontx/api: `apiRegistry`, `BaseApiService`, `RestProtocol`, `SseProtocol`, `MOCK_PLUGIN`, `isMockPlugin`, `StreamDescriptor`, `StreamStatus`
- From @gears-frontx/i18n: `i18nRegistry`, `Language`, `SUPPORTED_LANGUAGES`, `getLanguageMetadata`

**Layout Slices (owned by @gears-frontx/framework):**
- `layoutReducer`, `layoutDomainReducers`, `LAYOUT_SLICE_NAME`
- Domain slices: `headerSlice`, `footerSlice`, `menuSlice`, `sidebarSlice`, `screenSlice`, `popupSlice`, `overlaySlice`
- Domain actions: `headerActions`, `footerActions`, `menuActions`, `sidebarActions`, `screenActions`, `popupActions`, `overlayActions`
- Individual reducer functions: `setMenuCollapsed`, `toggleSidebar`, `setActiveScreen`, etc.

**MFE Exports:**
- `MfeHandlerMF` - Concrete MFE handler for Module Federation
- `gtsPlugin` - GTS (Global Type System) plugin for type validation
- `createShadowRoot`, `injectCssVariables` - Shadow DOM utilities

**NOTE:** `createAction` is NOT exported to consumers. Actions should be handwritten functions in extensions that contain business logic and emit events via `eventBus.emit()`.

**NOTE:** "Selector" is Redux terminology and is not used in FrontX. Access state via `useAppSelector` hook from @gears-frontx/react:
```typescript
const menu = useAppSelector((state: RootStateWithLayout) => state.layout.menu);
```

## Exports

### Core
- `createGears FrontX` - App builder factory
- `createGears FrontXApp` - Convenience function (full preset)
- `presets` - Available presets (full, minimal, headless)

### Plugins
- `screensets`, `themes`, `layout`, `microfrontends`, `i18n`, `effects`, `queryCache`, `queryCacheShared`, `mock`

### Registries
- `createThemeRegistry` - Theme registry factory

### Types
- `Gears FrontXConfig`, `Gears FrontXPlugin`, `Gears FrontXApp`, `Gears FrontXAppBuilder`
- `PluginFactory`, `PluginProvides`, `PluginLifecycle`
- `Preset`, `Presets`, `ScreensetsConfig`
- All re-exported types from SDK packages

## Testing Subpath (`@gears-frontx/framework/testing`)

The `./testing` subpath exposes Vitest-based helpers — `TestContainerProvider` (factory adapter for MFE domain registration in tests), shared `QueryClient` peek hooks, and `resetSharedQueryClient` for inter-test teardown.

- `vitest` is an **optional** peer dependency. Production apps that never import `@gears-frontx/framework/testing` do **not** need to install or pin `vitest`.
- Projects that import from `@gears-frontx/framework/testing` **must** install `vitest` at a version compatible with the range declared in this package's `peerDependencies` (currently pinned to `4.1.4`).
- The `./testing` entry is runtime-isolated from the main entry; importing the default entry does not pull `vitest` into the production bundle.

## Migration from Legacy API

The legacy screenset navigation API has been removed. FrontX now uses the MFE architecture exclusively:

### Removed APIs
- `screensetRegistry` (replaced by `screensetsRegistry`)
- `createScreensetRegistry()` (replaced by `ScreensetsRegistry` class)
- `navigation()` plugin (replaced by MFE actions)
- `routing()` plugin (replaced by extension route presentation)
- `routeRegistry` (replaced by extension route management)
- `navigateToScreen()` / `navigateToScreenset()` actions (replaced by `mountExtension()`)

### Migration Examples

**OLD**: Navigate to screen
```typescript
app.actions.navigateToScreen({ screensetId: 'demo', screenId: 'home' });
```

**NEW**: Mount extension
```typescript
await app.actions.mountExtension({
  extensionId: 'home',
  domainId: 'screen',
  container: document.getElementById('screen-container')!,
});
```

**OLD**: Register screenset
```typescript
import { screensetRegistry, ScreensetDefinition } from '@gears-frontx/framework';

const screenset: ScreensetDefinition = {
  id: 'demo',
  name: 'Demo',
  category: ScreensetCategory.Production,
  defaultScreen: 'home',
  menu: [/* ... */],
};

screensetRegistry.register(screenset);
```

**NEW**: Register domain and extensions
```typescript
import { screensetsRegistry, ExtensionDomain, Extension } from '@gears-frontx/framework';

// Register domain
app.screensetsRegistry.registerDomain(screenDomain, containerProvider);

// Register extensions
await app.screensetsRegistry.registerExtension(homeExtension);
await app.screensetsRegistry.registerExtension(profileExtension);
```

See the MFE migration guide in the project documentation for detailed migration steps.
