/**
 * Covers the admission half of the chrome contract: which domain a
 * microfrontend may aim a chrome action at. Exercised against the real type
 * system rather than a double, because the behaviour under test is `x-gts-ref`
 * resolution inside gts-ts — the same call the mediator makes on every action
 * of a chain before any handler is looked up.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  FRONTX_SCREEN_DOMAIN,
  gtsPlugin,
  screenDomain,
  sidebarDomain,
  type JSONSchema,
} from '@gears-frontx/react';
// The GTS solution schemas are application-layer and owned by the template
// package; `@gears-frontx/react` stopped re-exporting them so that framework and
// react resolve for a consumer outside this workspace (#601). `main.tsx` reaches
// for them the same way.
import {
  extensionScreenSchema,
  languageSchema,
  themeSchema,
} from '@gears-frontx/frontx-template-shell';

import {
  CHROME_ACTION_SCHEMAS,
  CHROME_SET_MENU_COLLAPSED,
  CHROME_SET_THEME,
} from './chrome-actions';

/** Both chrome action types with a payload their schema accepts, so a case
 * that fails does so over the target and nothing else. */
const CHROME_ACTIONS = [
  { type: CHROME_SET_THEME, payload: { themeId: 'dark' } },
  { type: CHROME_SET_MENU_COLLAPSED, payload: { collapsed: true } },
] as const;

/** The schema carrying `actionTypeId`, found by its `$id` rather than by
 * position, so the pairing is asserted instead of assumed. */
function schemaFor(actionTypeId: string): JSONSchema {
  const schema = CHROME_ACTION_SCHEMAS.find(
    (candidate) => candidate.$id === `gts://${actionTypeId}`,
  );
  if (!schema) {
    throw new Error(`no chrome action schema carries the id 'gts://${actionTypeId}'`);
  }
  return schema;
}

/** The `target` ref a schema declares, narrowed off the index signature
 * `JSONSchema` ends in rather than cast through it. */
function targetRefOf(schema: JSONSchema): string {
  const ref = schema.properties?.target?.['x-gts-ref'];
  if (typeof ref !== 'string') {
    throw new Error(`the schema '${schema.$id ?? '(no id)'}' declares no string target x-gts-ref`);
  }
  return ref;
}

beforeAll(() => {
  // The process-wide `gtsPlugin` singleton, as the app itself uses it. Nothing
  // registered here is case-specific: the schemas and the two domain instances
  // are static, registration is idempotent, and the actions the cases below
  // register are anonymous, so no case can leave state another one reads.
  //
  // The shared-property and screen-extension schemas come first because both
  // layout domain instances reference them; without them the domains fail their
  // own admission and every case would refuse over a missing domain rather than
  // over the target pattern.
  gtsPlugin.registerSchema(themeSchema);
  gtsPlugin.registerSchema(languageSchema);
  gtsPlugin.registerSchema(extensionScreenSchema);
  for (const schema of CHROME_ACTION_SCHEMAS) {
    gtsPlugin.registerSchema(schema);
  }
  gtsPlugin.register(screenDomain);
  gtsPlugin.register(sidebarDomain);
});

describe('CHROME_ACTION_SCHEMAS', () => {
  it.each(CHROME_ACTIONS)('admits $type aimed at the screen domain', ({ type, payload }) => {
    expect(() => gtsPlugin.register({ type, target: screenDomain.id, payload })).not.toThrow();
  });

  it.each(CHROME_ACTIONS)(
    'refuses $type aimed at a domain that opts into no chrome handler, naming the domain it needed',
    ({ type, payload }) => {
      // The sidebar domain is registered and valid — it simply is not the
      // domain these actions are declared against. The refusal has to come from
      // the target ref here, at admission, rather than from the mediator finding
      // no handler two layers further in, which would name a missing handler
      // instead of the domain the caller should have targeted.
      expect(() => gtsPlugin.register({ type, target: sidebarDomain.id, payload })).toThrow(
        new RegExp(`does not match pattern '${screenDomain.id}'`),
      );
    },
  );
});

/**
 * The `$id` and `target` inside the JSON schema files are literal strings, while
 * the rest of the shell dispatches on the constants this module exports and
 * registers the domain named by `FRONTX_SCREEN_DOMAIN`. Nothing in the type
 * system ties a literal to a constant, and drift between them is silent: a
 * schema whose `$id` no longer matches an action type is simply never the one
 * the mediator resolves.
 */
describe('the chrome action JSON schemas against the constants they are addressed by', () => {
  it('covers every exported action type, and declares no schema beyond them', () => {
    const declaredIds = CHROME_ACTION_SCHEMAS.map((schema) => schema.$id).sort();

    expect(declaredIds).toEqual(
      [CHROME_SET_THEME, CHROME_SET_MENU_COLLAPSED].map((type) => `gts://${type}`).sort(),
    );
  });

  it.each([
    ['set_theme', CHROME_SET_THEME],
    ['set_menu_collapsed', CHROME_SET_MENU_COLLAPSED],
  ])('points %s at the screen domain the shell actually registers', (_name, actionTypeId) => {
    expect(targetRefOf(schemaFor(actionTypeId))).toBe(FRONTX_SCREEN_DOMAIN);
  });
});
