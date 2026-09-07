// Contract compiler: merges code-extracted facts with the hand-written
// overlay into two GTS-typed artifacts.
//
//   <out>.json          - props schema, a DERIVED type whose $id chains the
//                         abstract base component type:
//                         gts://gts.frontx.uikit.base.component.v1~frontx.uikit.component.<c>.v1~
//   <out>.instance.json - contract instance, typed by the metamodel
//                         gts://gts.frontx.uikit.meta.component.v1~
//
// The second artifact is what makes the contract structure itself checkable:
// the metamodel is a GTS type, so a malformed contract fails the same
// validator that checks component props, not a review comment. The two stay
// linked through the instance's props_schema field.
//
// A component's props schema is not a standalone schema that happens to look
// like its neighbours: it derives from base.component.json and composes one
// shared passthrough type per element kind (passthrough.dom-button.json for
// anything backed by a <button>). Those two are hand-written source, not
// compiled output - they describe no component's code, so there is nothing to
// extract for them; they live next to this file and are read here and by the
// conformance test. What the derivation buys is closure: because the
// forwarded DOM props are declared by a schema this one $refs, the derived
// type can set `unevaluatedProperties: false` and reject a typo'd kit prop
// without also rejecting className, aria-* or data-*. `additionalProperties`
// could not do that job - it cannot see through $ref or allOf, so it would
// reject every inherited prop.
//
// The compiled JSON is the canonical contract every consumer reads (Ajv,
// gtsPlugin.registerSchema, projections, the lint). It is written next to
// the component's own source and committed there, not generated at build
// time - a reviewer sees the compiled shape change in the same diff as the
// source change that caused it, and CI can diff a fresh compile against the
// committed copy to catch a stale contract.
//
// Usage: npm run contracts:compile -- <component> [outPath]
//        The instance path is outPath with `.json` swapped for
//        `.instance.json`; both files are written together.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// YAML 1.2, where a bare `no`/`off`/`yes`/`on` stays a string. Under the
// YAML 1.1 rules js-yaml implements, those spellings parse as booleans, so
// an overlay writing one unquoted (a `hint: no`, an anti-pattern `dont: on`)
// would reach the compiler as `false`/`true` and fail the metamodel's
// `type: string` far from the line that caused it.
import { parse as parseYaml } from 'yaml';

import { extractComponent, type Extraction } from './extract';

export interface Examples {
  good: { title: string; code: string }[];
  bad: { title: string; code: string; why: string }[];
}

export interface Overlay {
  component: string;
  intent: string;
  use_when: string[];
  // `instead` is a GTS component type id (see the metamodel's
  // component_type_ref), not a display name - a name resolves to nothing.
  dont_use_when: { rule: string; instead: string }[];
  composition: { children: { kinds: string[]; icons_via?: string } };
  invariants: { id: string; text: string }[];
  anti_patterns: { dont: string; instead: string }[];
  deprecations: { props?: Record<string, { since: string; replacement: string; hint: string }> };
  coverage: Record<string, string>;
  examples: Examples;
}

// The contract instance: the overlay, typed by the metamodel and pointing at
// the props schema. Field order here is the on-disk order.
export interface ContractInstance extends Omit<Overlay, 'component'> {
  id: string;
  metamodel: string;
  component: string;
  props_schema: string;
}

export interface ContractProperty {
  // Absent for a slot: a ReactNode or render prop has no JSON Schema type.
  // The property is still declared (with annotations only, no assertions) so
  // that `unevaluatedProperties: false` counts it as evaluated and lets it
  // through - a contract that rejected `icon` would be wrong, not strict.
  // Its real type stays in x-uikit.slots, where the lint and tsc read it.
  type?: string;
  enum?: string[];
  default?: string;
  description?: string;
}

export interface SchemaRef {
  $ref: string;
}

export interface CompiledContract {
  $id: string;
  $schema: string;
  title: string;
  type: 'object';
  // Base first: gts-ts treats the FIRST $ref in allOf as the parent of the
  // derived type (store.findParentRef), which is what makes the chained $id
  // above and the schema body agree about who the parent is.
  allOf: SchemaRef[];
  properties: Record<string, ContractProperty>;
  // Closes the kit's own surface. Must be `unevaluatedProperties`, not
  // `additionalProperties`: the latter only sees sibling `properties` and
  // would reject everything reached through the allOf refs above.
  unevaluatedProperties: false;
  'x-uikit': {
    metamodel: string;
    slots: Record<string, { typeText: string; optional: boolean }>;
    passthrough: string[];
    cannot_extract: string[];
  } & Omit<Overlay, 'component'>;
}

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Version of the overlay vocabulary, not of any component.
const METAMODEL_VERSION = '0.1.0-demo';

// Type id of ui-component.meta.json; prefixes every instance id.
const METAMODEL_TYPE_ID = 'gts.frontx.uikit.meta.component.v1';

// Type id of base.component.json - the parent of every component props
// schema, and the first segment of their chained ids.
//
// Namespace `base`, type `component`, NOT the shorter
// `gts.frontx.uikit.component.v1~` the review sketched: gts-ts strips the
// fixed `gts.` scheme prefix and then requires each segment to carry 5 or 6
// dot-tokens (vendor.package.namespace.type.vMAJOR[.minor], see
// Gts.parseSegment). `frontx.uikit.component.v1` is four, so that id parses
// as "Too few tokens"; `frontx.uikit.base.component.v1` is five and parses
// as vendor=frontx, package=uikit, namespace=base, type=component, v1.
export const BASE_TYPE_ID = 'gts://gts.frontx.uikit.base.component.v1~';

// Shared passthrough type per element kind. Everything the kit backs with a
// <button> composes this one; a link-like component would chain a
// dom_anchor type instead of restating the same attributes.
export const PASSTHROUGH_TYPE_ID = 'gts://gts.frontx.uikit.passthrough.dom_button.v1~';

// The hand-written normative types this compiler composes. Read from disk
// rather than inlined so the artifacts, the conformance test and Ajv all see
// one copy of each.
const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));

export function loadBaseSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, 'base.component.json'), 'utf8')) as Record<string, unknown>;
}

export function loadPassthroughSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, 'passthrough.dom-button.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

// Props the passthrough type already owns. A component that re-declares one
// of them in its own Props interface (Button re-declares `className`,
// because Base UI's Props omits it) must not get a second, competing
// declaration in its own schema: one prop, one owner. They stay allowed -
// the passthrough $ref evaluates them.
function passthroughOwnedProps(): Set<string> {
  const passthrough = loadPassthroughSchema();
  const properties = (passthrough.properties ?? {}) as Record<string, unknown>;
  return new Set(Object.keys(properties));
}

// Machine-owned fields the overlay must not restate - one fact, one owner.
const MACHINE_OWNED = ['axes', 'props', 'defaults', 'variants'];

// Normative props stay inside the provider-safe JSON Schema subset; anything
// unrepresentable there (ReactNode slots, render props) is described in
// x-uikit instead of the schema body.
const NORMATIVE_TYPES: Record<string, ContractProperty> = {
  boolean: { type: 'boolean' },
  string: { type: 'string' },
};

// GTS tokens are snake_case; kit directories are kebab-case. Every id built
// here goes through this, so `navigation-menu` never leaks an ungrammatical
// hyphen into a type id.
function gtsToken(component: string): string {
  return component.replace(/-/g, '_');
}

// The props schema's own type id - the value the instance's props_schema
// points at, so the two artifacts can never drift apart by hand.
//
// A GTS derived-type id is the parent id followed by the derived segment,
// each segment closed by `~`: the component is not a namesake of the base
// type, it is a child of it, and the id says so without a lookup.
export function propsSchemaId(component: string): string {
  return `${BASE_TYPE_ID}frontx.uikit.component.${gtsToken(component)}.v1~`;
}

function loadOverlay(component: string): Overlay {
  const path = join(kitRoot, 'src', 'components', component, `${component}.contract.yaml`);
  const overlay = parseYaml(readFileSync(path, 'utf8')) as Overlay & Record<string, unknown>;

  const shadowed = MACHINE_OWNED.filter((key) => key in overlay);
  if (shadowed.length > 0) {
    throw new Error(`overlay restates machine-owned field(s): ${shadowed.join(', ')}`);
  }
  return overlay;
}

// GTS instance id: metamodel type id, `~`, then the instance segment - which
// carries exactly 5 dot-tokens (frontx.uikit.component.<name>.v<n>).
export function instanceId(component: string): string {
  return `${METAMODEL_TYPE_ID}~frontx.uikit.component.${gtsToken(component)}.v1`;
}

export function compileInstance(component: string): ContractInstance {
  const overlay = loadOverlay(component);
  return {
    id: instanceId(component),
    metamodel: METAMODEL_VERSION,
    component,
    intent: overlay.intent,
    use_when: overlay.use_when,
    dont_use_when: overlay.dont_use_when,
    composition: overlay.composition,
    invariants: overlay.invariants,
    anti_patterns: overlay.anti_patterns,
    deprecations: overlay.deprecations,
    coverage: overlay.coverage,
    examples: overlay.examples,
    props_schema: propsSchemaId(component),
  };
}

export function compileContract(component: string): CompiledContract {
  const dir = join(kitRoot, 'src', 'components', component);
  const extraction: Extraction = extractComponent(join(dir, `${component}.tsx`));
  const overlay = loadOverlay(component);

  const properties: Record<string, ContractProperty> = {};
  const slots: CompiledContract['x-uikit']['slots'] = {};
  const inherited = passthroughOwnedProps();
  for (const [axis, values] of Object.entries(extraction.axes)) {
    properties[axis] = { type: 'string', enum: values };
    if (extraction.defaults[axis] !== undefined) properties[axis].default = extraction.defaults[axis];
  }
  for (const prop of extraction.ownProps) {
    // Declared by the passthrough type already - leave it there.
    if (inherited.has(prop.name)) continue;
    const normative = NORMATIVE_TYPES[prop.typeText];
    if (normative) {
      properties[prop.name] = { ...normative };
    } else {
      // Not expressible in the provider-safe subset - recorded as a slot
      // with its source type, checked by the lint, not by Ajv. It still gets
      // an annotation-only property entry, or `unevaluatedProperties: false`
      // below would reject a correct `<Button icon={...} />`.
      slots[prop.name] = { typeText: prop.typeText, optional: prop.optional };
      properties[prop.name] = {
        description: `Slot: ${prop.typeText}. No JSON Schema type exists for it; shape checked by tsc, see x-uikit.slots.`,
      };
    }
  }

  return {
    $id: propsSchemaId(component),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${component} contract`,
    type: 'object',
    allOf: [{ $ref: BASE_TYPE_ID }, { $ref: PASSTHROUGH_TYPE_ID }],
    properties,
    unevaluatedProperties: false,
    'x-uikit': {
      metamodel: METAMODEL_VERSION,
      intent: overlay.intent,
      use_when: overlay.use_when,
      dont_use_when: overlay.dont_use_when,
      composition: overlay.composition,
      invariants: overlay.invariants,
      anti_patterns: overlay.anti_patterns,
      deprecations: overlay.deprecations,
      coverage: overlay.coverage,
      examples: overlay.examples,
      slots,
      passthrough: extraction.passthrough,
      cannot_extract: extraction.cannotExtract,
    },
  };
}

// "Was this module invoked as the entry, rather than imported?" Under tsx
// (this package's runner, `npm run contracts:compile`) argv[1] is this
// file's resolved path, so the identity comparison matches. An import (the
// conformance test, a build script) leaves argv[1] pointing at the test
// runner instead, so it never matches.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

// CLI entry - skipped when the module is imported (e.g. by the conformance test).
if (invokedDirectly()) {
  const [component, outPath] = process.argv.slice(2);
  if (!component) {
    console.error('Usage: npm run contracts:compile -- <component> [outPath]');
    process.exit(1);
  }
  const contract = compileContract(component);
  const instance = compileInstance(component);
  // Default output sits next to the component's source, alongside the
  // overlay it was compiled from - not dist/contracts, which does not exist
  // until a build runs. The committed artifact IS the compiled contract;
  // dist/ gets its own copy through the normal build/publish step.
  const out = outPath ?? join(kitRoot, 'src', 'components', component, `${component}.contract.json`);
  // Derived, not a third argument: the two artifacts describe one component
  // and there is no case for writing them to unrelated places.
  const instanceOut = `${out.replace(/\.json$/, '')}.instance.json`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`);
  writeFileSync(instanceOut, `${JSON.stringify(instance, null, 2)}\n`);
  console.log(`wrote ${out}`);
  console.log(`wrote ${instanceOut}`);
}
