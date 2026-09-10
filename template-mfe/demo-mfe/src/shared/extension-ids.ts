/**
 * Extension IDs from mfe.json
 * Centralized constants for cross-screen navigation references
 */

export const HELLOWORLD_EXTENSION_ID = 'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.helloworld.v1';
export const PROFILE_EXTENSION_ID = 'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.profile.v1';
export const THEME_EXTENSION_ID = 'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.theme.v1';
export const UIKIT_EXTENSION_ID = 'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.demo.screens.uikit.v1';

/**
 * Custom action type for requesting a profile data refresh.
 * Targeted at the Profile extension ID — routed by the mediator to its registered ActionHandler.
 */
// @cpt-FEATURE:child-bridge-action-handler:p3
export const DEMO_ACTION_REFRESH_PROFILE = 'gts.frontx.mfes.comm.action.v1~frontx.demo.action.refresh_profile.v1~';

/**
 * Extension ID of the Widgets Host screen extension, owned by the shell's screen
 * domain. Mounting it evicts whatever else occupies that domain (e.g. Hello World
 * itself) per the shell's `ExclusiveMountStrategy`.
 */
export const WIDGETS_HOST_EXTENSION_ID = 'gts.frontx.mfes.ext.extension.v1~frontx.screensets.layout.screen.v1~frontx.widgets.host.screen.v1';

/**
 * GTS instance ID of the widgets `ExtensionDomain` that Widgets Host takes
 * ownership of once mounted (`demo-mfe/mfe.json`'s `domains[]`, adopted in
 * `lifecycle-widgets-host.tsx` via `registry.registerDomain(...)`).
 */
export const WIDGETS_DOMAIN_ID = 'gts.frontx.mfes.ext.domain.v1~frontx.widgets.area.main.v1';

/**
 * Extension ID of widget-a's Widget Alpha instance (widgets-fixture-a), owned by the
 * nested Widgets Host and two hops away from the shell (shell -> Widgets Host ->
 * widgets domain -> widget-a). Pinging it from Hello World (one hop from shell)
 * exercises the downward forwarding-entry tier of cross-nesting action delivery.
 */
export const WIDGET_ALPHA_EXTENSION_ID = 'gts.frontx.mfes.ext.extension.v1~frontx.widgets.fixture_a.widget_alpha.v1';

/**
 * Custom action type used by widgets-fixture-a to demonstrate per-instance ping routing.
 * Targeted at the Widget Alpha extension ID — routed by the mediator to its registered ActionHandler.
 */
export const WIDGET_PING_ACTION_TYPE = 'gts.frontx.mfes.comm.action.v1~frontx.widgets.test.widget_ping.v1~';
