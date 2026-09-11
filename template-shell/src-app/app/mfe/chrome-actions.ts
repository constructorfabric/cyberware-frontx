/**
 * The host chrome contract: the actions a microfrontend may dispatch upward to
 * change the shell around it.
 *
 * A microfrontend runs in its own module graph (per-load blob instantiation,
 * ADR-0011), so it has no handle on the host app and no shared event bus to
 * emit on. The actions chain is the one declared upward channel, and it carries
 * a payload. These two action types are what this shell chooses to expose over
 * it; the handlers live in `bootstrap.ts` and call the public `app.actions`
 * surface.
 *
 * Both are app-layer, not framework: `screenDomain` in
 * `@gears-frontx/framework` ships to every template, and a host that does not
 * want its chrome driven from a microfrontend simply does not spread these into
 * its own screen-domain declaration.
 */

import type { JSONSchema } from '@gears-frontx/react';

import setMenuCollapsedActionSchema from './gts/frontx.screensets/schemas/chrome/set_menu_collapsed.v1.json';
import setThemeActionSchema from './gts/frontx.screensets/schemas/chrome/set_theme.v1.json';

/** Applies a registered theme by id - the payload carries `themeId`. */
export const CHROME_SET_THEME =
  'gts.frontx.mfes.comm.action.v1~frontx.screensets.chrome.set_theme.v1~';

/** Collapses or expands the shell's main menu - the payload carries `collapsed`. */
export const CHROME_SET_MENU_COLLAPSED =
  'gts.frontx.mfes.comm.action.v1~frontx.screensets.chrome.set_menu_collapsed.v1~';

/**
 * The two schemas themselves are JSON, under
 * `gts/frontx.screensets/schemas/chrome/`, where the directory path spells the
 * GTS id the way `packages/gts-plugin/src/frontx.mfes/schemas/ext/` and the
 * framework's own `gts/frontx.screensets/instances/domains/` do. Each file
 * carries its own `$comment`s, including why its `target` names the screen
 * domain rather than any domain; this module only collects them.
 *
 * The cast is the same one both of those loaders make: a JSON module's inferred
 * type is the literal shape of the file, which no `JSONSchema` signature can be
 * written to accept.
 *
 * They must reach the type system before `registerDomain`, because the mediator
 * resolves an action's schema from its `type` at dispatch time and rejects an
 * action it cannot validate.
 */
export const CHROME_ACTION_SCHEMAS: JSONSchema[] = [
  setThemeActionSchema as JSONSchema,
  setMenuCollapsedActionSchema as JSONSchema,
];
