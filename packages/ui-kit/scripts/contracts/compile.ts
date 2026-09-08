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
// GENERATED passthrough type per ORIGIN of inherited props (a Base UI
// primitive part, or a plain DOM element type - passthrough.base_ui_button.json
// for Button's own Base UI primitive, one file per origin under
// scripts/contracts/generated/; see extract.ts's ComponentExtraction.passthroughOrigin
// for why origin, not DOM tag, is the key). base.component.json is hand-written source -
// it describes no component's code, so there is nothing to extract for it.
// The passthrough types are compiled output: they are built from a
// component's own INHERITED props (extract.ts's ComponentExtraction), the
// same way the component's own contract is, and are committed next to it so
// a reviewer sees the forwarded surface change in the same diff as the
// source change that caused it. What the derivation buys is closure: because
// the forwarded DOM props are declared by a schema this one $refs, the
// derived type can set `unevaluatedProperties: false` and reject a typo'd
// kit prop without also rejecting className, aria-* or data-*.
// `additionalProperties` could not do that job - it cannot see through $ref
// or allOf, so it would reject every inherited prop.
//
// The overlay itself is validated before it is trusted: an unknown key (a
// typo, a stray JSON-schema keyword like `type`/`required`) fails the
// compile by name instead of silently vanishing on merge, and a component
// that redeclares a passthrough-owned prop with a conflicting type fails
// instead of the passthrough type quietly winning. A VariantProps heritage
// entry the extractor could not trace to a real cva(...) call fails the same
// way: a component that silently lost its variant axes is a worse defect
// than a compile that stops and says which axis it could not read.
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
//        `.instance.json`; both files are written together, and the
//        component's generated passthrough.<origin>.json alongside them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ErrorObject, ValidateFunction } from 'ajv';
// Draft 2020-12 needs Ajv's 2020 build; the metamodel and overlay schemas
// both declare that $schema, and the default `ajv` export only knows
// draft-07.
import Ajv2020 from 'ajv/dist/2020';
// YAML 1.2, where a bare `no`/`off`/`yes`/`on` stays a string. Under the
// YAML 1.1 rules js-yaml implements, those spellings parse as booleans, so
// an overlay writing one unquoted (a `hint: no`, an anti-pattern `dont: on`)
// would reach the compiler as `false`/`true` and fail validation far from
// the line that caused it.
import { parse as parseYaml } from 'yaml';

import { extractComponent, normalizeTypeText, parseStringLiteralUnion, type ComponentExtraction, type ExtractedProp } from './extract';
import {
  bareGtsId,
  BASE_TYPE_ID,
  COMPONENT_REF_TARGET,
  componentTypeRef,
  componentTypeRefPattern,
  CONTRACT_MAJOR,
  instanceId,
  instanceIdPattern,
  METAMODEL_TYPE_ID,
  METAMODEL_VERSION,
  passthroughTypeId,
  propsSchemaId,
  traitTypeId,
  VENDOR_PACKAGE,
} from './ids';

export { BASE_TYPE_ID, passthroughTypeId, propsSchemaId, instanceId, componentTypeRef };

export interface Examples {
  good: { title: string; code: string }[];
  bad: { title: string; code: string; why: string }[];
}

export type CoverageVerdict = 'verified' | 'checked-no' | 'not-described';

// A claim the code cannot make true, recorded next to why - "generic over
// Value" and "wraps two Base UI parts" are facts about the TYPE SYSTEM's
// limits, not a verdict on whether the kit tested something. Modeled as its
// own array under `coverage.assumptions` rather than another
// coverage_verdict key: a verdict is one word, an assumption needs a reason
// a reader can check.
export interface CoverageAssumption {
  claim: string;
  reason: string;
}

// Free-form claim ids (a11y, rtl, ...) map to a verdict; `assumptions` is the
// one reserved key that instead holds a list of claim+reason pairs - see
// buildMetamodel's `coverage` schema for the properties/additionalProperties
// split that makes both shapes legal in the same object.
export interface Coverage {
  assumptions?: CoverageAssumption[];
  [claim: string]: CoverageVerdict | CoverageAssumption[] | undefined;
}

// Family membership of a compound component's part (T5: Accordion is the
// first component whose public surface is more than one exported component
// sharing one directory). Deliberately NOT a schema-level derivation chain
// (item deriving from root would make item inherit root's props under a
// closed base, which is wrong - an item is not a root) - the relationship is
// recorded here, in the overlay/instance, and checked by the conformance
// test instead of by the type system.
export interface Family {
  // The root's own GTS component type ref - self-referential on the root's
  // own overlay, and how a part points back to the family it belongs to.
  root: string;
  role: 'root' | 'part';
  // Every other member of the family, by ref. Root-only: a part does not
  // restate its siblings, it just points at the root.
  parts?: string[];
}

// A plugin/growth point declared once at the component level instead of
// enumerating every prop a plugin author might touch (T6: DataTable's
// `columns` accepts arbitrary TanStack `ColumnDef`s, whose own `header`/
// `cell` render functions are opaque to a JSON Schema extractor either way -
// listing each such prop individually would just restate what `typed_by`
// already says once). `typed_by` is free text, not a GTS ref: the type that
// governs an extension point usually lives in a third-party package this
// contract has no business re-typing (`@tanstack/react-table`'s `ColumnDef`),
// so a prose pointer is the honest claim, not a broken reference.
export interface ExtensionPoint {
  name: string;
  kind: 'prop' | 'helper' | 'feature';
  description: string;
  typed_by: string;
}

// The alternative a "don't" points a reader at when the kit itself ships
// nothing that fits. Modeled as its own object rather than as free text in
// the same slot a component ref occupies: a reader (and a validator
// resolving the ref) must be able to tell "use this other kit component"
// apart from "this kit has no component for that" without parsing prose,
// which is exactly what a stand-in ref hides. `note` carries why no kit
// component fits, when that is not obvious from `external` alone.
export interface ExternalAlternative {
  external: string;
  note?: string;
}

// Either a kit component this contract can point at by type id, or an
// explicit statement that the alternative lives outside the kit.
export type Alternative = string | ExternalAlternative;

// Narrows an `instead` to the external form. A reader that resolves refs
// (the per-component conformance suites, a future registry check) uses this
// to skip what was never a ref, instead of failing a grammar check on it.
export function isExternalAlternative(instead: Alternative): instead is ExternalAlternative {
  return typeof instead === 'object';
}

export interface Overlay {
  component: string;
  intent: string;
  // A handful of archetypal scenarios, not an exhaustive selection rule -
  // capped at 3 by the metamodel so the field stays a quick read rather than
  // growing into a second, competing definition of the component.
  typical_uses: string[];
  // `instead` is a GTS component type id (see the metamodel's
  // component_type_ref), not a display name - a name resolves to nothing -
  // or, where the kit ships no component for the case at all, the external
  // form above rather than the nearest kit component standing in for one.
  dont_use_when: { rule: string; instead: Alternative }[];
  composition: {
    children: { kinds: string[]; icons_via?: string };
    // Optional, and only meaningful for a compound component's part - the
    // root/item(s) it is only ever mounted under. Button and the rest of
    // the kit never set this: nothing constrains where they may appear.
    parent?: { kinds: string[] };
  };
  invariants: { id: string; text: string }[];
  anti_patterns: { dont: string; instead: string }[];
  deprecations: { props?: Record<string, { since: string; replacement: string; hint: string }> };
  coverage: Coverage;
  examples: Examples;
  // Absent for every non-compound component (Button, ...): family only
  // exists where a directory's public surface is more than one contract.
  family?: Family;
  // Absent for every component with no growth surface of its own (Button,
  // Accordion, ...); present where a consumer extends behavior through a
  // prop/helper/feature this contract cannot itself type-close (DataTable's
  // `columns`, `dataTableColumnHelper`, `dataTableFeatures`).
  extension_points?: ExtensionPoint[];
}

// The contract instance: the overlay, typed by the metamodel and pointing at
// the props schema. Field order here is the on-disk order.
export interface ContractInstance extends Omit<Overlay, 'component'> {
  id: string;
  // The type this instance is an instance of, in the field name gts-ts looks
  // for (GtsExtractor's schemaIdFields) - without it GTS.validateInstance
  // answers "No schema found for instance" instead of validating.
  gts_type: string;
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

// Which annotation block each semantic overlay field lands in. A field a
// validator or lint actually READS (dont_use_when's typed `instead`,
// composition, deprecations, coverage, family, extension_points) targets
// 'x-gts-traits', where gts-ts's own GTS.validateEntity checks it against
// base.component.json's x-gts-traits-schema (see buildGtsTraitsSchema
// below) the same way it checks component props - a malformed trait block
// fails the build, not a review comment. A field that is prose FOR A
// READER, with no validator on the other end (intent, typical_uses,
// invariants, anti_patterns, examples), stays in 'x-uikit'. This map is the
// single switch: moving a field between the two blocks (or the day ADR
// 0005 answers whether a runtime acts on traits at all, see PILOT-NOTES.md)
// is an edit here, not a rewrite of how either annotation blob gets
// assembled (see fieldsTargeting/pickFields below) - CompiledContract's own
// 'x-uikit'/'x-gts-traits' field types are derived from this map's literal
// values (FieldsFor below), so an edit here that moves a field also moves
// which block TypeScript requires it to appear in.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
const SEMANTIC_FIELDS = [
  'intent',
  'typical_uses',
  'dont_use_when',
  'composition',
  'invariants',
  'anti_patterns',
  'deprecations',
  'coverage',
  'examples',
  'family',
  'extension_points',
] as const;
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route

type SemanticField = (typeof SEMANTIC_FIELDS)[number];
type SemanticTarget = 'x-uikit' | 'x-gts-traits';

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
const SEMANTIC_FIELD_TARGETS = {
  intent: 'x-uikit',
  typical_uses: 'x-uikit',
  dont_use_when: 'x-gts-traits',
  composition: 'x-gts-traits',
  invariants: 'x-uikit',
  anti_patterns: 'x-uikit',
  deprecations: 'x-gts-traits',
  coverage: 'x-gts-traits',
  examples: 'x-uikit',
  family: 'x-gts-traits',
  extension_points: 'x-gts-traits',
} as const satisfies Record<SemanticField, SemanticTarget>;
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route

// The field-name union routed at a given target, computed from
// SEMANTIC_FIELD_TARGETS's own literal values (the `as const satisfies`
// above is what keeps them literal instead of widening to `SemanticTarget`)
// rather than duplicated as a second, hand-typed list - the type-level twin
// of what fieldsTargeting computes at runtime.
type FieldsFor<Target extends SemanticTarget> = {
  [Field in SemanticField]: (typeof SEMANTIC_FIELD_TARGETS)[Field] extends Target ? Field : never;
}[SemanticField];
type UikitFields = FieldsFor<'x-uikit'>;
type TraitFields = FieldsFor<'x-gts-traits'>;

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
  // Own props whose extraction reported `optional: false`. A prop the
  // passthrough type owns never reaches this list - one owner, one required
  // set - so a component with no required own props (Button, today) still
  // emits `required: []`, not an absent field.
  required: string[];
  // Closes the kit's own surface. Must be `unevaluatedProperties`, not
  // `additionalProperties`: the latter only sees sibling `properties` and
  // would reject everything reached through the allOf refs above.
  unevaluatedProperties: false;
  'x-uikit': {
    metamodel: string;
    slots: Record<string, { typeText: string; optional: boolean }>;
    // What the component's own Props type literally extends, besides its
    // VariantProps heritage - readable labels (the heritage text plus the
    // declaration file the checker resolved it to), not consumed by any
    // validator. variant_sources is the complementary list: where this
    // component's own cva axes come from, not what it forwards.
    passthrough: string[];
    variant_sources: string[];
    cannot_extract: string[];
  } & Pick<Overlay, UikitFields>;
  // The validator-read half of the overlay, checked by gts-ts against
  // base.component.json's x-gts-traits-schema (GTS.validateEntity ->
  // GtsStore.validateSchemaTraits) - see buildGtsTraitsSchema. `family` and
  // `extension_points` are genuinely absent (not merely `undefined`) for a
  // component whose overlay omits them, exactly like their x-uikit-routed
  // counterparts always have been - the trait schema's own nullable+default
  // shape is what makes that absence resolve instead of failing gts-ts's
  // completeness check.
  'x-gts-traits': Pick<Overlay, TraitFields>;
}

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The hand-written normative types this compiler composes. Read from disk
// rather than inlined so the artifacts, the conformance test and Ajv all see
// one copy of each.
const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(SCHEMA_DIR, 'generated');
const TYPES_DIR = join(SCHEMA_DIR, 'types');

export function loadBaseSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, 'base.component.json'), 'utf8')) as Record<string, unknown>;
}

// The committed copies of the vocabulary types the base type's trait schema
// and the metamodel both reference. Read from disk for the same reason
// loadBaseSchema does: whoever registers them in a GTS store or an Ajv
// instance must see the shipped file, not a fresh build that might differ
// from it - the freshness check is what makes those two the same thing.
export function loadTraitTypes(): Record<string, unknown>[] {
  return readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(TYPES_DIR, name), 'utf8')) as Record<string, unknown>);
}

// A vocabulary type resolves through TWO resolvers with different rules, so
// both have to be given the types explicitly:
//   - a GTS store resolves `$ref` by looking the id up among registered
//     entities (GtsStore.resolveTraitSchemaRefs, and the store's own Ajv for
//     a ref inside a oneOf branch), failing with "Unresolvable trait schema
//     reference" when one is missing;
//   - a plain Ajv instance resolves the same `gts://...` string as an
//     absolute URI, which it can only do once the target has been added.
// Both loops used to be spelled out at every call site; these two helpers
// are what keep a new vocabulary type from having to be remembered in six
// places.
export function addContractTypes(ajv: Ajv2020): void {
  // GTS's own reference annotation. Declared rather than switched off with
  // `strict: false`, which would also swallow a genuine typo like
  // `unevaluatedProperites` - exactly the class of mistake these schemas
  // exist to catch. It asserts nothing here: Ajv checks the grammar through
  // the `pattern` beside it, and the reference itself is resolved by a GTS
  // store.
  if (!ajv.getKeyword('x-gts-ref')) ajv.addKeyword({ keyword: 'x-gts-ref' });
  for (const type of loadTraitTypes()) ajv.addSchema(type);
}

export function registerContractTypes(register: (entity: Record<string, unknown>) => void): void {
  for (const type of loadTraitTypes()) register(JSON.parse(JSON.stringify(type)) as Record<string, unknown>);
}

// The generated per-origin passthrough type this component's inherited
// props were compiled into (see buildPassthroughSchema). Reads the
// COMMITTED copy - the same file the freshness check in T4 diffs a fresh
// compile against - not a value kept only in memory, so a stale copy is
// something CI can catch instead of something only the compiler ever sees.
export function loadPassthroughSchema(originKey: string): Record<string, unknown> {
  const path = join(GENERATED_DIR, `passthrough.${originKey}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

// name -> declared JSON Schema `type`, for every prop the passthrough type
// owns. `undefined` for an annotation-only entry (onClick, children, style):
// there is nothing to compare a component's own declaration against, so
// those names are still treated as owned (skip the property) but never
// trigger the type-conflict check below.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
function passthroughPropertyTypes(passthroughSchema: Record<string, unknown>): Map<string, ContractProperty | undefined> {
  const properties = (passthroughSchema.properties ?? {}) as Record<string, ContractProperty>;
  return new Map(Object.entries(properties).map(([name, schema]) => [name, schema.type ? schema : undefined]));
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
}

// Machine-owned fields the overlay must not restate - one fact, one owner.
// `required`/`slots`/`type` are reserved for the same reason: they are
// either compiler output or a JSON-Schema keyword an author might type by
// habit, and either way the overlay writing one is a mistake worth naming
// specifically rather than folding into "unknown key".
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned
const MACHINE_OWNED = ['axes', 'props', 'defaults', 'variants', 'required', 'slots', 'type'];
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned

// A prop's normalized TypeScript text, classified into the provider-safe
// JSON Schema subset a validator can actually assert: boolean/string/number
// exactly, or a string literal union as an enum. Everything else - a
// function, ReactNode, an element, an object shape - has no JSON Schema
// representation and is annotation-only (see buildPropsAndRequired's slot
// branch and buildPassthroughSchema's else branch). One function, used by
// both a component's own props and its generated passthrough type, so the
// same TypeScript shape is always classified the same way regardless of
// which side of the own/inherited split it happens to land on.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
function classifyProviderSafeType(typeText: string): ContractProperty | undefined {
  const normalized = normalizeTypeText(typeText);
  if (normalized === 'boolean' || normalized === 'string' || normalized === 'number') {
    return { type: normalized };
  }
  const enumValues = parseStringLiteralUnion(normalized);
  if (enumValues) return { type: 'string', enum: enumValues };
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
}

// The JSON Schema keywords that make a property schema assert something
// about a value. A schema carrying none of them - and no prose either - is
// the bare `{}` this compiler used to emit for every inherited prop the
// provider-safe subset could not express.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
const ASSERTING_KEYWORDS = ['type', 'enum', 'const', '$ref', 'anyOf', 'oneOf'] as const;

// A property schema this compiler may emit, plus the assertion keywords the
// emptiness check below consults. `const`/`$ref`/`anyOf`/`oneOf` are not
// emitted today; naming them here is what makes the check keep holding the
// day a branch starts emitting one, instead of silently annotating a
// property that already constrains something.
type PropertySchema = ContractProperty & Partial<Record<(typeof ASSERTING_KEYWORDS)[number], unknown>>;

// An empty property schema is not neutral to a reader: `{}` in a props
// contract reads as "anything goes", and an agent that read the accordion
// root's `value`/`defaultValue` that way concluded they were plain strings
// when their real type is `AccordionValue<Value>`. A prop whose TypeScript
// type has no JSON Schema representation - a generic type parameter, a
// function, a union with non-literal members - therefore says so in prose:
// the checker's own printed type text, and the reason nothing asserts it.
// The type text is the extractor's, already normalized to node_modules- or
// kit-relative import paths, so this stays machine-independent.
//
// A schema that already asserts something, or that already carries its own
// description (the own-prop slot branch writes a more specific one), is
// returned untouched - one property, one description.
export function describeUntypeableProperty(schema: PropertySchema, typeText: string): ContractProperty {
  if (schema.description !== undefined) return schema;
  if (ASSERTING_KEYWORDS.some((keyword) => schema[keyword] !== undefined)) return schema;
  return { ...schema, description: `TS: ${typeText}. Not expressible in JSON Schema, checked by tsc.` };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
}

// Generates a passthrough type from a component's inherited (non-own) props.
// `key`/`ref` are React/JSX machinery, not props a consumer sets, so neither
// belongs in a props contract. Individual `aria-*` names are excluded the
// same way the OLD hand-written file handled them: React's AriaAttributes
// type declares ~50 of them by literal name, and enumerating each one here
// would bury the file in exactly the boilerplate the shared `^aria-` pattern
// property already covers for free; `data-*` attributes are not typed as
// literal properties at all (JSX accepts them structurally), so there is
// nothing to exclude there beyond keeping the same `^data-` pattern property
// as before.
//
// `originKey` (see extract.ts's ComponentExtraction.passthroughOrigin) is
// the storage/id identity - what the $id and the generated filename use;
// `domTag` is the real HTML tag this describes, kept separate so the
// human-readable title/description always name a real element even when the
// origin is a Base UI part rather than the tag itself. `generatedFrom` is
// every component stem currently known to compile this origin - M4: a
// shared origin key with no record of who put what into it is how two
// components silently overwrote each other's file; committing the list next
// to the properties it backs makes the write path (compileOne below) able
// to compare "what's here now" against "who put it here" instead of
// guessing, and gives a reviewer reading the diff the same answer.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1
export function buildPassthroughSchema(
  originKey: string,
  domTag: string,
  inheritedProps: ExtractedProp[],
  generatedFrom: string[],
): Record<string, unknown> {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
  const properties: Record<string, ContractProperty> = {};
  // Mirrors buildPropsAndRequired's own-prop rule (`!prop.optional` ->
  // required): a primitive that turns an inherited prop required is a real
  // narrowing of what a consumer may omit, and was invisible to freshness
  // and compatibility before this list existed - every inherited prop read
  // as optional regardless of what the checker actually reported. Sorted,
  // and emitted even when empty (compileContract's own `required` does the
  // same for own props - "a component with no required own props still
  // emits `required: []`, not an absent field"), so a fresh compile is
  // never ambiguous between "nothing required" and "not computed".
  const required: string[] = [];
  for (const prop of inheritedProps) {
    if (prop.name === 'key' || prop.name === 'ref') continue;
    if (prop.name.startsWith('aria-') || prop.name.startsWith('data-')) continue;
    properties[prop.name] = describeUntypeableProperty(classifyProviderSafeType(prop.typeText) ?? {}, prop.typeText);
    if (!prop.optional) required.push(prop.name);
  }
  required.sort();
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
  return {
    $id: passthroughTypeId(originKey),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${originKey} passthrough`,
    description: `The props a kit component forwards to an underlying <${domTag}> element (directly or through Base UI), generated from this component's inherited (non-own) props. A component schema $refs this from its allOf, so the props it merely forwards are EVALUATED - which is what lets the derived type close itself with unevaluatedProperties: false without rejecting className, aria-* or data-*. Keyed by the ORIGIN of the inherited props (a Base UI primitive part, or a plain DOM element type) rather than the DOM tag alone, so two components forwarding to the same tag through unrelated type surfaces never collide; two components genuinely wrapping the same origin share this file by construction. Regenerate with \`npm run contracts:compile -- <directory>\`; a stale copy fails the freshness check.`,
    type: 'object',
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-open
    // Every component stem that has ever compiled into this shared file, so
    // a mismatched recompile can name who else is on the hook before
    // silently overwriting their facts (see compileOne's write path).
    // Not consumed by Ajv/GTS - annotation only, same standing as $comment.
    generated_from: [...generatedFrom].sort(),
    properties,
    required,
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-open
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-patterns
    patternProperties: {
      '^aria-': {
        description:
          'Any ARIA attribute passes. Enumerating the WAI-ARIA set here would go stale against the spec and buy nothing: a contract\'s job is to stop typos in KIT props, and the a11y rules that actually matter (icon-only needs aria-label) are invariants, not a property list.',
      },
      '^data-': {
        description:
          'Any data attribute passes: they are open by construction, and consumers add their own (data-testid being the common one).',
      },
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-patterns
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-open
    $comment:
      'Intentionally NOT closed (no unevaluatedProperties/additionalProperties): this is one of several in-place applicators a component composes, so it cannot know what the others contribute. Closure happens once, in the derived component type.',
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-open
  };
}

// How a reference to another kit component is spelled, everywhere one
// appears: a `don't` alternative, a composition kind, a family member, the
// instance's own props_schema.
//
// THREE keywords, and all three are load-bearing:
//   - `x-gts-ref` is the reference itself - it names what the value must
//     resolve to in a type registry (any type derived from the abstract
//     base component type), which is what makes this a reference rather
//     than a string that happens to look like an id;
//   - `type` and `pattern` stay beside it because gts-ts STRIPS x-gts-ref
//     before any validator sees the schema (GtsStore.normalizeSchema), and
//     then deletes any oneOf/anyOf branch that was left with nothing else
//     in it. A branch written as x-gts-ref alone therefore disappears, and
//     `instead` would silently stop accepting component ids at all. With
//     the pattern kept, a malformed id still fails by name.
// Enforcement of the reference itself (does this id resolve?) happens where
// gts-ts actually runs its ref validator: on the INSTANCE path, for a
// property carrying x-gts-ref directly - see the instance's props_schema
// below. A reference nested inside a referenced vocabulary type is not
// reached by that walker, so those stay resolved by the conformance suite.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-id-value
function componentRefSchema(): Record<string, unknown> {
  return {
    type: 'string',
    pattern: componentTypeRefPattern(),
    'x-gts-ref': COMPONENT_REF_TARGET,
    description:
      "GTS id of another kit component: the props schema derived from the abstract base component type. `x-gts-ref` declares what it must resolve to; `type` and `pattern` are what enforce it, because gts-ts strips x-gts-ref before validating.",
    $comment: 'GTS tokens are snake_case; kit directories are kebab-case (navigation_menu -> navigation-menu).',
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-id-value

function propNameSchema(): Record<string, unknown> {
  return {
    type: 'string',
    pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
    description: 'Name of a prop declared by the component, not a type id. Checked against the extracted prop list by the conformance test.',
  };
}

function traitType(token: string, title: string, description: string, body: Record<string, unknown>): Record<string, unknown> {
  return {
    $id: traitTypeId(token),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description,
    ...body,
  };
}

// The overlay vocabulary as GTS types, one concept per type, referenced by
// both the metamodel (what an instance must look like) and the base type's
// trait schema (what a validator checks x-gts-traits against) instead of
// being written out twice or copied through an inliner. Six of them are a
// field of the validator-read overlay block; six are the value objects
// those six embed - `composition` says what may nest inside a component and
// what it may be mounted under, and each of those two is a fact with its
// own shape, not an anonymous object inside a bigger schema.
//
// Referenced, not inlined: gts-ts resolves a `$ref` in a trait schema by
// looking the id up among registered entities, so a type that is not
// registered fails loudly ("Unresolvable trait schema reference") instead
// of a component's `composition` quietly validating against nothing.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-vocabulary
export function buildTraitTypes(): Record<string, unknown>[] {
  return [
    traitType(
      'external_alternative',
      'UiKit external alternative',
      'The alternative to a "don\'t" when it is outside this kit. Without this form the only way to satisfy a required component ref is to name the nearest kit component as a stand-in, which reads to a resolver as a real recommendation and to an agent as an instruction to reach for a component the rule was written to steer it away from.',
      {
        type: 'object',
        properties: {
          external: {
            type: 'string',
            minLength: 1,
            description: 'What to use instead, named as plainly as the reader will have to act on it - the kit ships nothing for this case, so there is no id to resolve.',
          },
          note: {
            type: 'string',
            minLength: 1,
            description: 'Why no kit component fits, and what the kit does offer for the neighbouring case. Optional: some rules need no more than the pointer itself.',
          },
        },
        required: ['external'],
        additionalProperties: false,
      },
    ),
    traitType(
      'dont_use_when_rule',
      'UiKit dont-use-when rule',
      'One use this component is the wrong answer for, with the alternative that IS the answer. Two shapes for `instead`, one of which must match: a kit component by reference, or the external form for a case the kit ships nothing for. Not a plain string union with the reference: an unmatched string would then read as an alternative nothing can resolve, which is the failure the typed reference exists to prevent.',
      {
        type: 'object',
        properties: {
          rule: { type: 'string', minLength: 1 },
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-alternative
          instead: { oneOf: [componentRefSchema(), { $ref: traitTypeId('external_alternative') }] },
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-alternative
        },
        required: ['rule', 'instead'],
        additionalProperties: false,
      },
    ),
    traitType(
      'child_composition',
      'UiKit child composition',
      'What may appear inside this component. A component reference when the child IS a kit component - typed so a reader can resolve it and the conformance suite can check it exists - or the literal "text" for plain textual content, or "none" for a component that takes no children at all (DataTable renders its Table internally: "text" would claim a slot that does not exist, "none" says so honestly). "none" stands alone - a list that pairs it with anything else says both that nothing may appear inside and that something may. Not an open string: a typo\'d reference would otherwise silently read as a content kind.',
      {
        type: 'object',
        properties: {
          // "none" is the one kind that excludes every other: it says this
          // component accepts no children at all, so a list pairing it with
          // a component reference or with "text" states both that nothing
          // may appear inside and that something may. Left as one open item
          // union, `["none", <Button>]` validated - a contradiction the
          // reader the contract exists for has no way to resolve, and the
          // reason it is two branches rather than a comment.
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-children-exclusive
          kinds: {
            oneOf: [
              { type: 'array', items: { const: 'none' }, minItems: 1, maxItems: 1 },
              { type: 'array', items: { oneOf: [componentRefSchema(), { const: 'text' }] }, minItems: 1 },
            ],
          },
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-children-exclusive
          icons_via: propNameSchema(),
        },
        required: ['kinds'],
        additionalProperties: false,
      },
    ),
    traitType(
      'parent_composition',
      'UiKit parent composition',
      "Where this component may be mounted. Only a compound component's part states one: the root or item kind(s) it is only ever used under. Nothing about Button constrains where it may appear, so most components have no parent at all.",
      {
        type: 'object',
        properties: {
          kinds: { type: 'array', items: componentRefSchema(), minItems: 1 },
        },
        required: ['kinds'],
        additionalProperties: false,
      },
    ),
    traitType(
      'composition',
      'UiKit composition',
      'How this component nests: what may go inside it, and - for a part of a compound component - what it may be mounted under. The two are separate facts and separate types; only the first is required, because every component has an answer for what it contains and most have none for where they belong.',
      {
        type: 'object',
        properties: {
          children: { $ref: traitTypeId('child_composition') },
          parent: { $ref: traitTypeId('parent_composition') },
        },
        required: ['children'],
        additionalProperties: false,
      },
    ),
    traitType(
      'prop_deprecation',
      'UiKit prop deprecation',
      'One deprecated prop: when it was deprecated, the prop that replaces it, and what a caller has to do differently. All three are required - a deprecation without a replacement leaves the caller with no next move, which is the same failure a "don\'t" without an alternative has.',
      {
        type: 'object',
        properties: {
          since: { type: 'string', minLength: 1 },
          replacement: propNameSchema(),
          hint: { type: 'string', minLength: 1 },
        },
        required: ['since', 'replacement', 'hint'],
        additionalProperties: false,
      },
    ),
    traitType('deprecations', 'UiKit deprecations', "Everything about this component that is on its way out, keyed by the prop's own name.", {
      type: 'object',
      properties: {
        props: { type: 'object', additionalProperties: { $ref: traitTypeId('prop_deprecation') } },
      },
      additionalProperties: false,
    }),
    traitType(
      'coverage_verdict',
      'UiKit coverage verdict',
      'The answer to one coverage claim. "checked-no" (looked at, does not hold) and "not-described" (nobody looked) are different answers and may not collapse into one.',
      { type: 'string', enum: ['verified', 'checked-no', 'not-described'] },
    ),
    traitType(
      'coverage_assumption',
      'UiKit coverage assumption',
      'A fact the code cannot make true - a generic type parameter, a part composed of two primitives - rather than a verified/checked-no/not-described claim.',
      {
        type: 'object',
        properties: {
          claim: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1 },
        },
        required: ['claim', 'reason'],
        additionalProperties: false,
      },
    ),
    traitType(
      'coverage',
      'UiKit coverage',
      "What this contract claims about itself: a verdict per claim, plus the claims nothing could verify. Open by construction - the claim names are the kit's own and grow with it - which is why the verdict type is referenced from additionalProperties rather than from a fixed property list.",
      {
        type: 'object',
        properties: {
          assumptions: { type: 'array', items: { $ref: traitTypeId('coverage_assumption') } },
        },
        additionalProperties: { $ref: traitTypeId('coverage_verdict') },
      },
    ),
    traitType(
      'family',
      'UiKit family',
      "Membership in a compound component's family (Accordion, its Item, Trigger and Content), when this component is one. Deliberately NOT expressed as a schema-level derivation (a part's props schema does not chain from the root's - an item does not inherit the root's props, and a closed base would reject them as undeclared if it did): the relationship lives here, in the instance, and the conformance test checks that every reference resolves to a real compiled contract.",
      {
        type: 'object',
        properties: {
          root: componentRefSchema(),
          role: { type: 'string', enum: ['root', 'part'] },
          // Root-only: a part points at the root via `root` above and does
          // not restate its siblings.
          parts: { type: 'array', items: componentRefSchema(), minItems: 1 },
        },
        required: ['root', 'role'],
        additionalProperties: false,
        if: { properties: { role: { const: 'root' } }, required: ['role'] },
        then: { required: ['root', 'role', 'parts'] },
      },
    ),
    traitType(
      'extension_point',
      'UiKit extension point',
      "One growth point a consumer extends this component through, declared at the component level instead of enumerating every plugin-shaped prop individually (DataTable's `columns` accepts arbitrary third-party ColumnDefs, whose own render functions are opaque to a JSON Schema extractor regardless of how many are listed).",
      {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          kind: { type: 'string', enum: ['prop', 'helper', 'feature'] },
          description: { type: 'string', minLength: 1 },
          // Free text, not a reference: the governing type usually lives in
          // a third-party package this contract has no business re-typing.
          typed_by: { type: 'string', minLength: 1 },
        },
        required: ['name', 'kind', 'description', 'typed_by'],
        additionalProperties: false,
      },
    ),
  ];
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-vocabulary

// The file name a vocabulary type is committed under: its own id token, so
// the directory listing reads as the type list.
export function traitTypeFileName(type: Record<string, unknown>): string {
  const bare = bareGtsId(String(type.$id));
  return `${bare.replace(`gts.${VENDOR_PACKAGE}.`, '').replace(/~$/, '')}.json`;
}

// The metamodel schema, built from ids.ts rather than typed twice: the
// committed ui-component.meta.json is a generated copy of this object's
// JSON.stringify output, and the freshness check asserts the two never
// drift. Building it here, not reading it from disk, is what makes
// buildOverlaySchema below able to derive the overlay's vocabulary from the
// metamodel's authored fields instead of keeping a second, hand-maintained
// list.
export function buildMetamodel(): Record<string, unknown> {
  return {
    $id: `gts://${METAMODEL_TYPE_ID}~`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit component contract metamodel',
    description:
      'Shape of a component contract INSTANCE. The contract is itself a GTS-typed value: every <component>.contract.instance.json validates against this type, so the metamodel is enforced by the same validator that enforces component props instead of by prose. The props schema the instance points at (props_schema) is a separate GTS type and is not described here.',
    type: 'object',
    // One local definition left: a string grammar, used by a field no
    // validator reads. Everything the validator-read half of the overlay is
    // made of is a referenced type (buildTraitTypes above) rather than a
    // definition local to this document, so the metamodel and the base
    // type's trait schema reach the same shape through the same id instead
    // of each carrying a copy of it.
    $defs: {
      invariant_id: {
        type: 'string',
        pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
        description: 'Stable kebab-case handle. Lint findings and evals cite it; never reused after removal.',
      },
    },
    properties: {
      id: {
        type: 'string',
        pattern: instanceIdPattern(),
        description:
          "GTS instance id: this metamodel's type id, then the instance segment. The instance segment carries exactly 5 dot-tokens (frontx.uikit.component.<name>.v<n>).",
      },
      // How gts-ts finds the type an instance is an instance OF: it reads a
      // schema-id field off the entity itself (GtsExtractor's schemaIdFields
      // list), and without one GTS.validateInstance answers "No schema found
      // for instance" instead of validating. `$schema` is not usable here -
      // a document carrying one that starts with `gts` is treated as a
      // SCHEMA, not an instance - so this is the snake_case member of that
      // list. `x-gts-ref` is the pointer form: it resolves against this
      // metamodel's own $id, so an instance claiming a different type fails.
      gts_type: {
        type: 'string',
        'x-gts-ref': '/$id',
        description: "GTS type id of this metamodel - what makes the contract instance a typed value rather than a bare JSON document.",
      },
      metamodel: {
        const: METAMODEL_VERSION,
        description:
          "Version of the overlay vocabulary the compiler emitted. Checked as a const, not a free string with minLength: a contract compiled against a different metamodel version must fail loudly, not pass silently with a stale value.",
      },
      component: {
        type: 'string',
        pattern: '^[a-z][a-z0-9-]*$',
        description:
          'Kit directory name under src/components/, or - for one export of a compound component (see `family`) - that export\'s own kebab-case stem, which shares the directory\'s name as a prefix (accordion-item lives in src/components/accordion/).',
      },
      intent: {
        type: 'string',
        minLength: 1,
        description: 'One sentence, the selection-card headline: why the component exists.',
      },
      typical_uses: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        maxItems: 3,
        description:
          "A handful of archetypal scenarios this component fits - not an exhaustive selection rule, and not claimed to be one. Capped at 3 so the field stays a fast read; the component's full API is the actual source of truth for what it can do.",
      },
      dont_use_when: {
        type: 'array',
        items: { $ref: traitTypeId('dont_use_when_rule') },
        minItems: 1,
        description:
          'A "don\'t" without an alternative leaves the agent with no next move, so `instead` is required, and it is either a reference to a kit component (not a display name - a name resolves to nothing) or the external form for a case the kit ships no component for. At least one entry is required for the same reason: a component with nothing it should not be used for would be a modeling gap, not a fact worth leaving unstated.',
      },
      composition: { $ref: traitTypeId('composition') },
      invariants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { $ref: '#/$defs/invariant_id' },
            text: { type: 'string', minLength: 1 },
          },
          required: ['id', 'text'],
          additionalProperties: false,
        },
      },
      anti_patterns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dont: { type: 'string', minLength: 1 },
            instead: { type: 'string', minLength: 1 },
          },
          required: ['dont', 'instead'],
          additionalProperties: false,
        },
        $comment: "`instead` here is prose about this component's own API, not a component type ref - the fix stays inside the component.",
      },
      deprecations: { $ref: traitTypeId('deprecations') },
      coverage: { $ref: traitTypeId('coverage') },
      examples: {
        type: 'object',
        properties: {
          good: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', minLength: 1 },
                code: { type: 'string', minLength: 1 },
              },
              required: ['title', 'code'],
              additionalProperties: false,
            },
            minItems: 1,
          },
          bad: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', minLength: 1 },
                code: { type: 'string', minLength: 1 },
                why: { type: 'string', minLength: 1 },
              },
              required: ['title', 'code', 'why'],
              additionalProperties: false,
              $comment: '`why` is required: a counter-example without its reason teaches pattern-matching, not the rule.',
            },
            minItems: 1,
          },
        },
        required: ['good', 'bad'],
        additionalProperties: false,
      },
      // `$ref` first, siblings after: the trait-schema copy of this property
      // wraps it nullable (nullableTraitProperty below), and gts-ts merges a
      // resolved reference in at the position of the `$ref` key - a `type`
      // written before it would be overwritten by the referenced type's own.
      family: {
        $ref: traitTypeId('family'),
        description: 'Absent entirely for a component with no family - Button, most of the kit.',
      },
      extension_points: {
        type: 'array',
        description:
          "Growth points a consumer extends this component through, declared once at the component level instead of enumerating every plugin-shaped prop individually (DataTable's `columns` accepts arbitrary third-party ColumnDefs, whose own render functions are opaque to a JSON Schema extractor regardless of how many are listed). Absent entirely for a component with no such surface - Button, Accordion, most of the kit.",
        items: { $ref: traitTypeId('extension_point') },
        minItems: 1,
      },
      // The one reference gts-ts itself resolves against the registry: it
      // sits directly on an instance property, which is as deep as
      // XGtsRefValidator's own walk goes, so GTS.validateInstance fails an
      // instance whose props schema is not a registered type (see the
      // component contract suites). A reference nested inside a referenced
      // vocabulary type - a `don't` alternative, a composition kind - is not
      // reached by that walk and is resolved by the conformance suite
      // instead.
      props_schema: {
        type: 'string',
        pattern: componentTypeRefPattern(),
        'x-gts-ref': COMPONENT_REF_TARGET,
        description:
          "GTS id of the machine-owned half: the compiled JSON Schema carrying axes, defaults and normative props. Split so the semantic half stays readable and the props half stays a plain provider-safe schema. A derived-type id: the abstract base component type, then the component's own segment, so the reference also asserts that the props schema really is a child of the base and not a lookalike.",
        $comment: "Two segments of 5 dot-tokens each after the fixed `gts.` scheme prefix - the shape gts-ts's Gts.parseSegment accepts (vendor.package.namespace.type.vMAJOR).",
      },
    },
    required: [
      'id',
      'gts_type',
      'metamodel',
      'component',
      'intent',
      'typical_uses',
      'dont_use_when',
      'composition',
      'invariants',
      'anti_patterns',
      'deprecations',
      'coverage',
      'examples',
      'props_schema',
    ],
    additionalProperties: false,
  };
}

// `family` and `extension_points` are optional in the overlay - most
// components set neither. A trait property still has to resolve when
// nothing in the chain provides it: GtsStore.validateSchemaTraits demands
// EVERY property x-gts-traits-schema declares have either a value or a
// schema `default`, regardless of this JSON Schema's own `required` list
// (that check runs before Ajv ever sees the data - see the "unresolved
// trait property" step in validateSchemaTraits). There is no honest
// non-null default for "this component's family membership" or "this
// component's extension points", so the property's type gains `null` as an
// alternative and defaults to it. This does not weaken the real shape for a
// component that DOES set the field: `properties`, `required` and
// `minItems` are all instance-type-scoped keywords (JSON Schema applies
// them only to data of the matching type) and are vacuously satisfied by a
// `null` instance, so `family`'s `if`/`then` and `extension_points`'
// `minItems: 1` still apply exactly as authored to real object/array data.
//
// A property that is nothing but a reference (`family`) has no `type` of its
// own to widen, and it must not gain one BEFORE the reference: gts-ts merges
// a resolved reference in at the position of the `$ref` key, so a `type`
// written first is overwritten by the referenced type's own `object` and the
// null alternative silently disappears. Spreading the source first and
// assigning `type`/`default` after is what keeps `$ref` in front of them.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-nullable
function nullableTraitProperty(schema: Record<string, unknown>): Record<string, unknown> {
  const type = schema.type;
  const widened = Array.isArray(type) ? [...type, 'null'] : type === undefined ? ['object', 'null'] : [type, 'null'];
  return { ...schema, type: widened, default: null };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-nullable
}

// The trait half of the metamodel: the SAME field definitions buildMetamodel
// authors for `dont_use_when`/`composition`/`deprecations`/`coverage`/
// `family`/`extension_points` (fieldsTargeting('x-gts-traits'), the single
// switch SEMANTIC_FIELD_TARGETS controls), taken rather than re-typed by
// hand so the trait schema and the overlay-authoring schema can never
// silently disagree about what one of these fields looks like. Since each of
// those definitions is now a reference to a vocabulary type (buildTraitTypes
// above), taking it is a copy of the reference, not of the shape - the two
// schemas resolve the same type through the same id. One mechanical
// adjustment on top, forced by gts-ts's trait machinery rather than chosen
// here: the two fields the overlay does not require are wrapped nullable
// (nullableTraitProperty) so a component that has nothing to say there still
// resolves. base.component.json's x-gts-traits-schema is a generated copy of
// this function's output, checked against a fresh build by the freshness
// comparison, the same way ui-component.meta.json and the vocabulary types
// themselves are.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-trait-schema:p1
export function buildGtsTraitsSchema(): Record<string, unknown> {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-fields
  const metamodel = buildMetamodel();
  const metamodelProperties = metamodel.properties as Record<string, Record<string, unknown>>;
  const metamodelRequired = new Set(metamodel.required as string[]);
  const traitFields = fieldsTargeting('x-gts-traits');
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-fields

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-fields
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of traitFields) {
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-fields
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-ref
    const definition = metamodelProperties[field];
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-ref
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-nullable
    if (metamodelRequired.has(field)) {
      properties[field] = definition;
      required.push(field);
    } else {
      properties[field] = nullableTraitProperty(definition);
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-nullable
  }

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-return
  return {
    type: 'object',
    description:
      "Validator-read half of the overlay: what GTS.validateEntity checks a component contract's x-gts-traits against (GtsStore.validateSchemaTraits, resolving this schema across the derivation chain from base.component down to the component's own contract). Everything here is a fact a validator or lint actually reads - dont_use_when's typed alternative, composition, deprecations, coverage (including its assumptions), family and extension_points; a purely documentary field (intent, typical_uses, invariants, anti_patterns, examples) lives in x-uikit instead, which no validator reads. Each field is a REFERENCE to the vocabulary type that owns its shape (gts.frontx.uikit.trait.*), so this schema states which concepts a contract carries and each concept is defined once, in one place, for both this schema and the metamodel. additionalProperties: false so an unknown trait key fails GTS.validateEntity by name instead of vanishing silently.",
    properties,
    // Only the fields the overlay itself always requires (buildMetamodel's
    // own `required` list) are required here too - `family`/`extension_points`
    // are optional at BOTH levels, resolved instead by nullableTraitProperty's
    // default above.
    required,
    additionalProperties: false,
  };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-return
}

// base.component.json's full content: the abstract structural anchor
// (unchanged since T1) plus x-gts-traits-schema, generated rather than
// hand-typed for the reason buildGtsTraitsSchema documents. Read from disk
// as loadBaseSchema does for every other purpose (compiling a component,
// registering it in a GTS store) - this function exists so the committed
// file can be checked against a fresh build the same way ui-component.meta.json
// is checked against buildMetamodel().
export function buildBaseSchema(): Record<string, unknown> {
  return {
    $id: BASE_TYPE_ID,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit base component',
    description:
      "Abstract base type every kit component's props schema derives from. Deliberately a near-empty structural anchor: it fixes the entity kind (an object of props) and gives the derivation chain a root, and it declares NO properties - not even className, which belongs to the per-origin passthrough type, because a base shared by Button and, say, a headless provider cannot assume a DOM element underneath. Its job is to be the thing a derived id chains from, so a component schema is a GTS derived type rather than a standalone schema that happens to look similar. It also carries the ONE thing every derived component contract must supply to be a complete GTS entity: x-gts-traits-schema, the validator-read half of the overlay vocabulary that GTS.validateEntity checks a component's own x-gts-traits against. That vocabulary is six references to the types that own each concept (gts.frontx.uikit.trait.*), not six inline definitions - see the domain model in the package DESIGN for how they relate.",
    type: 'object',
    $comment:
      "No additionalProperties/unevaluatedProperties here on purpose. gts-ts's validateSchemaAgainstParent rejects a derived schema that adds properties when the base sets additionalProperties: false, and closing the base would mean every component had to restate it. Closure is the DERIVED type's job (unevaluatedProperties: false), where the full property set is finally known.",
    'x-gts-traits-schema': buildGtsTraitsSchema(),
  };
}

// The overlay's own schema: the metamodel's authored fields (everything
// except id/metamodel/props_schema, which the compiler writes) with
// additionalProperties: false at every level - inherited from the
// metamodel's own nested closures, not restated. An overlay that misspells
// a field, adds a machine-owned one under a different name, or tries to
// write JSON-Schema vocabulary (`type`, `required`) fails here by name
// instead of the field silently not making it into the compiled artifact.
export function buildOverlaySchema(): Record<string, unknown> {
  const metamodel = buildMetamodel();
  const machineOwned = ['id', 'gts_type', 'metamodel', 'props_schema'];
  const properties = { ...(metamodel.properties as Record<string, unknown>) };
  for (const key of machineOwned) delete properties[key];
  const required = (metamodel.required as string[]).filter((key) => !machineOwned.includes(key));

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit component contract overlay',
    description:
      "Shape of the hand-written overlay a contract compiles from - the metamodel's authored fields only. `id`, `gts_type`, `metamodel` and `props_schema` are the compiler's own; an overlay may not write them.",
    type: 'object',
    $defs: metamodel.$defs,
    properties,
    required,
    additionalProperties: false,
  };
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field
function compileOverlayValidator(): ValidateFunction<Overlay> {
  const ajv = new Ajv2020({ allErrors: true });
  // The overlay schema reaches most of its shape through references to the
  // vocabulary types, which Ajv can only follow once they are added.
  addContractTypes(ajv);
  return ajv.compile<Overlay>(buildOverlaySchema());
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field-refuse
function formatOverlayErrors(component: string, errors: ErrorObject[] | null | undefined): string {
  const lines = (errors ?? []).map((err) => {
    if (err.keyword === 'additionalProperties') {
      const key = (err.params as { additionalProperty?: string }).additionalProperty ?? '(unknown)';
      return `unknown overlay key "${key}" at "${err.instancePath || '/'}"`;
    }
    return `"${err.instancePath || '/'}" ${err.message ?? 'is invalid'}`;
  });
  return `${component}: overlay failed validation:\n  ${lines.join('\n  ')}`;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field-refuse
}

// M3: the compiler's own assembled output validated against the same
// schemas a component's hand-written test file already checks it against
// (buildMetamodel/buildGtsTraitsSchema) - moved here so a future component
// with no such test still gets the check, rather than the module header's
// claim ("the metamodel is enforced by the same validator that enforces
// component props") being true only where a test file happens to assert it.
// A fresh Ajv instance per call, matching compileOverlayValidator's own
// style - these run once per compile, not in a hot loop, so there is
// nothing to cache.
function formatSchemaErrors(component: string, what: string, errors: ErrorObject[] | null | undefined): string {
  const lines = (errors ?? []).map((err) => `"${err.instancePath || '/'}" ${err.message ?? 'is invalid'}`);
  return `${component}: assembled ${what} failed schema validation:\n  ${lines.join('\n  ')}`;
}

// Round-tripped through JSON before validating, the same way
// testing.ts's validateContractTraits does and for the same reason: a
// field the overlay left unset (family, extension_points) is an own key
// set to `undefined` on the in-memory object, which Ajv's `type` check
// would reject against a schema that only allows `object` - JSON.stringify
// dropping the key is what makes "genuinely absent" resolve the way the
// schema (and every real consumer of the committed JSON) expects.
export function assertValidatesAgainst(component: string, what: string, schema: Record<string, unknown>, value: unknown): void {
  const ajv = new Ajv2020({ allErrors: true });
  addContractTypes(ajv);
  const validate = ajv.compile(schema);
  const roundTripped = JSON.parse(JSON.stringify(value)) as unknown;
  if (!validate(roundTripped)) {
    throw new Error(formatSchemaErrors(component, what, validate.errors));
  }
}

// The overlay-validation half, split out from loadOverlay's file read so it
// can be exercised directly with an in-memory object: a malformed overlay is
// a compile error whether it came from disk or a test fixture, and testing
// it this way keeps the fixture next to the assertion instead of in a
// directory a reviewer has to go find.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-overlay-admission:p1
export function parseOverlay(component: string, raw: unknown): Overlay {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned
  if (raw !== null && typeof raw === 'object') {
    const shadowed = MACHINE_OWNED.filter((key) => key in raw);
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned-refuse
    if (shadowed.length > 0) {
      throw new Error(`${component}: overlay restates machine-owned field(s): ${shadowed.join(', ')}`);
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned-refuse
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field
  const validate = compileOverlayValidator();
  if (!validate(raw)) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field-refuse
    throw new Error(formatOverlayErrors(component, validate.errors));
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field-refuse
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-name-mismatch
  if (raw.component !== component) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-name-mismatch-refuse
    throw new Error(
      `${component}: overlay "component" field is "${raw.component}", but the directory is "${component}" - the two must match`,
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-name-mismatch-refuse
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-name-mismatch

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-return
  return raw;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-return
}

// `exportStem` defaults to `directory`: every component through T4 (Button
// included) has exactly one overlay per directory, named after the
// directory itself, so every existing call site (`loadOverlay('button')`)
// keeps resolving the same file. A compound directory's part
// (`loadOverlay('accordion', 'accordion-item')`) reads
// accordion/accordion-item.contract.yaml instead - a second overlay file in
// the same directory, not a second directory.
function loadOverlay(directory: string, exportStem: string = directory): Overlay {
  if (exportStem !== directory && !exportStem.startsWith(`${directory}-`)) {
    // The stem's own directory-prefix check T5 adds: `component` on the
    // overlay is validated against `exportStem` by parseOverlay below (an
    // unchanged, two-argument call - see button.contract.test.ts), but
    // nothing there knows which directory the file was loaded FROM. A part
    // overlay filed under the wrong directory (or a directory typo in the
    // filename) would otherwise compile as if it were a top-level component.
    throw new Error(
      `${exportStem}: overlay stem does not belong to directory "${directory}" - a part's stem must equal ` +
        `the directory or start with "${directory}-"`,
    );
  }
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-author-overlay
  const path = join(kitRoot, 'src', 'components', directory, `${exportStem}.contract.yaml`);
  const raw: unknown = parseYaml(readFileSync(path, 'utf8'));
  return parseOverlay(exportStem, raw);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-author-overlay
}

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-instance:p2
export function compileInstance(directory: string, exportStem: string = directory): ContractInstance {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-assemble
  const overlay = loadOverlay(directory, exportStem);
  const instance: ContractInstance = {
    id: instanceId(exportStem, CONTRACT_MAJOR),
    gts_type: `${METAMODEL_TYPE_ID}~`,
    metamodel: METAMODEL_VERSION,
    component: exportStem,
    intent: overlay.intent,
    typical_uses: overlay.typical_uses,
    dont_use_when: overlay.dont_use_when,
    composition: overlay.composition,
    invariants: overlay.invariants,
    anti_patterns: overlay.anti_patterns,
    deprecations: overlay.deprecations,
    coverage: overlay.coverage,
    examples: overlay.examples,
    family: overlay.family,
    extension_points: overlay.extension_points,
    // The bare id, not the `gts://` URI form the contract's own $id carries:
    // an id-VALUED field holds an id, and gts-ts's reference validator
    // rejects the URI form outright (Gts.isValidGtsID).
    props_schema: componentTypeRef(exportStem, CONTRACT_MAJOR),
  };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-assemble
  // M3: validated against the metamodel here, not only inside whichever
  // component's own test file happens to assert it - a future mismatch
  // between this assembly and buildMetamodel()'s own required-field list
  // now fails every compile, not just the ones with test coverage for it.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-validate
  assertValidatesAgainst(exportStem, 'instance', buildMetamodel(), instance);
  return instance;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-validate
}

export interface PropsAndRequired {
  properties: Record<string, ContractProperty>;
  required: string[];
  slots: CompiledContract['x-uikit']['slots'];
}

// The machine-owned half of a component's props schema: cva axes, own
// props (typed where the provider-safe subset can express them, slots
// where it cannot) and which own props are required. Split out from
// compileContract so it can be unit-tested with a synthetic
// ComponentExtraction - in particular the passthrough type-conflict check,
// which needs no real component file to exercise.
export function buildPropsAndRequired(
  component: string,
  extraction: ComponentExtraction,
  passthroughSchema: Record<string, unknown>,
): PropsAndRequired {
  const properties: Record<string, ContractProperty> = {};
  const slots: PropsAndRequired['slots'] = {};
  const required: string[] = [];
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
  const passthroughTypes = passthroughPropertyTypes(passthroughSchema);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axes
  for (const [axis, values] of Object.entries(extraction.axes)) {
    properties[axis] = { type: 'string', enum: values };
    if (extraction.defaults[axis] !== undefined) properties[axis].default = extraction.defaults[axis];
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axes

  for (const prop of extraction.ownProps) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    if (passthroughTypes.has(prop.name)) {
      const declared = passthroughTypes.get(prop.name);
      // `declared === undefined` means the passthrough entry is
      // annotation-only (onClick, children, style): nothing to compare
      // against, so the name still counts as owned but the type check is
      // skipped.
      if (declared !== undefined) {
        const ownClassified = classifyProviderSafeType(prop.typeText);
        const agrees =
          ownClassified !== undefined &&
          ownClassified.type === declared.type &&
          JSON.stringify(ownClassified.enum) === JSON.stringify(declared.enum);
        if (!agrees) {
          throw new Error(
            `${component}: prop "${prop.name}" declared "${prop.typeText}" in ${component}.tsx conflicts with the ` +
              `passthrough type's declared type "${declared.type}" - one prop, one owner, and the two disagree`,
          );
        }
      }
      // Declared by the passthrough type already - leave it there.
      continue;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    const normative = classifyProviderSafeType(prop.typeText);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    if (normative) {
      properties[prop.name] = normative;
    } else {
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
      // Not expressible in the provider-safe subset - recorded as a slot
      // with its source type, checked by the lint, not by Ajv. It still gets
      // an annotation-only property entry, or `unevaluatedProperties: false`
      // below would reject a correct `<Button icon={...} />`.
      slots[prop.name] = { typeText: prop.typeText, optional: prop.optional };
      properties[prop.name] = {
        description: `Slot: ${prop.typeText}. No JSON Schema type exists for it; shape checked by tsc, see x-uikit.slots.`,
      };
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    }
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    // The same "never emit a property that asserts nothing and says
    // nothing" rule the passthrough type applies, held here as a
    // post-condition rather than duplicated per branch: the slot branch
    // above already writes its own, more specific description and a typed
    // property already asserts something, so this changes nothing today -
    // it is what keeps the rule true for whatever branch is added next.
    properties[prop.name] = describeUntypeableProperty(properties[prop.name], prop.typeText);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    if (!prop.optional) required.push(prop.name);
  }

  return { properties, required, slots };
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
function fieldsTargeting(target: SemanticTarget): SemanticField[] {
  return SEMANTIC_FIELDS.filter((field) => SEMANTIC_FIELD_TARGETS[field] === target);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
}

// Builds an object from exactly the given keys of `source` - the routing
// primitive fieldsTargeting's map result feeds into. The single cast below
// is the standard "accumulator starts empty, ends up the right shape" cast:
// every assignment inside the loop is provably `T[K]` into `Pick<T, K>[K]`,
// there is just no way to spell "empty object that will become Pick<T, K>"
// without it.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
function pickFields<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
}

// A component's directory is kebab-case; its exported name is PascalCase
// (navigation-menu -> NavigationMenu). This is the one place that mapping
// happens, so a file exporting several components picks the right one by
// the same rule compileContract's error message describes.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-select
export function pascalCase(component: string): string {
  return component
    .split('-')
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join('');
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-select
}

// Finds the extraction for the export named by `exportStem` (button ->
// Button, accordion-item -> AccordionItem). `exportStem` defaults to
// `directory`: the ordinary case (one component per directory, named after
// it) resolves exactly as before T5. A compound directory's part passes its
// own stem - the .tsx file is still the directory's single source file
// (extractComponent already returns one ComponentExtraction per exported
// component in it, see extract.ts), only the SELECTION changes.
export function resolveTargetExtraction(directory: string, exportStem: string = directory): ComponentExtraction {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-select
  const dir = join(kitRoot, 'src', 'components', directory);
  const extractions = extractComponent(join(dir, `${directory}.tsx`));
  const wantedName = pascalCase(exportStem);
  const extraction = extractions.find((e) => e.name === wantedName);
  if (!extraction) {
    const available = extractions.map((e) => e.name).join(', ') || '(none)';
    throw new Error(
      `${exportStem}: no exported component named "${wantedName}" (overlay stem "${exportStem}" in PascalCase) - ` +
        `${directory}.tsx exports: ${available}`,
    );
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-select
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-select
  return extraction;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-select
}

// M11: the overlay must only ever point at a prop the extractor actually
// found. `deprecations.props` keys and `composition.children.icons_via` are
// the two prop-name-bearing overlay fields today - moved here from Button's
// own test file so every component gets this cross-check unconditionally,
// not just the one whose test author remembered to write it (Accordion and
// DataTable had no equivalent protection before this). Extend this list if
// the metamodel ever adds a third prop-name-bearing overlay field.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop
export function assertOverlayReferencesRealProps(component: string, overlay: Overlay, extraction: ComponentExtraction): void {
  const known = new Set([...Object.keys(extraction.axes), ...extraction.ownProps.map((prop) => prop.name)]);
  for (const prop of Object.keys(overlay.deprecations.props ?? {})) {
    if (!known.has(prop)) {
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
      throw new Error(`${component}: overlay deprecations.props references "${prop}", which is not a real prop`);
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
    }
  }
  const iconsVia = overlay.composition.children.icons_via;
  if (iconsVia !== undefined && !known.has(iconsVia)) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
    throw new Error(`${component}: overlay composition.children.icons_via references "${iconsVia}", which is not a real prop`);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop
}

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-compilation:p1
export function compileContract(directory: string, exportStem: string = directory): CompiledContract {
  const extraction = resolveTargetExtraction(directory, exportStem);

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axis-failure
  const unresolvedVariants = extraction.cannotExtract.filter((msg) => msg.startsWith('cva:'));
  if (unresolvedVariants.length > 0) {
    // A VariantProps heritage entry the extractor could not trace to a real
    // cva(...) call would otherwise compile silently with its axes simply
    // missing - the exact defect (F16) this compiler exists to catch, so it
    // fails the build instead of shipping a contract that lost information.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axis-failure-refuse
    throw new Error(`${exportStem}: ${unresolvedVariants.join('; ')}`);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axis-failure-refuse
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axis-failure

  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-author-overlay
  const overlay = loadOverlay(directory, exportStem);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-author-overlay
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop
  assertOverlayReferencesRealProps(exportStem, overlay, extraction);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop

  let passthroughSchema: Record<string, unknown> | undefined;
  let passthroughRef: SchemaRef | undefined;
  if (extraction.passthroughOrigin) {
    if (!extraction.passthroughKind) {
      // The origin walk and the domTag walk read the same heritage graph and
      // must agree on whether one exists at all; disagreeing here means one
      // of the two walks changed without the other, which is a harness bug,
      // not a fact about the component's own source.
      throw new Error(
        `${exportStem}: resolved passthrough origin "${extraction.passthroughOrigin}" but no DOM element kind - the ` +
          `origin and kind walks disagreed, which should never happen`,
      );
    }
    // The generated_from list is only meaningful at write time (M4's
    // collision check, in compileOne below) - compileContract only reads
    // `.properties` off this schema (buildPropsAndRequired's own-vs-
    // passthrough type-conflict check), so a single-element placeholder is
    // enough here and never gets written to disk.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    passthroughSchema = buildPassthroughSchema(extraction.passthroughOrigin, extraction.passthroughKind, extraction.inheritedProps, [
      exportStem,
    ]);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    passthroughRef = { $ref: passthroughTypeId(extraction.passthroughOrigin) };
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
  } else if (extraction.inheritedProps.length > 0) {
    // Inherited props exist but no origin could be resolved for them -
    // exactly the case a silent extractor would have dropped them in.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited
    throw new Error(
      `${exportStem}: ${extraction.inheritedProps.length} inherited prop(s) found (e.g. "${extraction.inheritedProps[0].name}") ` +
        `but no passthrough origin could be resolved from ${directory}.tsx's props type - cannot generate a ` +
        `passthrough type to declare them in`,
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited
  }

  const { properties, required, slots } = buildPropsAndRequired(
    exportStem,
    extraction,
    passthroughSchema ?? { properties: {} },
  );

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
  const uikitFields = fieldsTargeting('x-uikit');
  const gtsTraitsFields = fieldsTargeting('x-gts-traits');
  if (uikitFields.length + gtsTraitsFields.length !== SEMANTIC_FIELDS.length) {
    // Every semantic field must be routed exactly once. This only fires if
    // SEMANTIC_FIELD_TARGETS is edited to drop a field on the floor - a
    // config mistake worth failing loudly on rather than shipping a
    // contract silently missing part of its overlay.
    throw new Error(`${exportStem}: SEMANTIC_FIELD_TARGETS does not route every semantic overlay field exactly once`);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
  const contract: CompiledContract = {
    $id: propsSchemaId(exportStem, CONTRACT_MAJOR),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${exportStem} contract`,
    type: 'object',
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    allOf: passthroughRef ? [{ $ref: BASE_TYPE_ID }, passthroughRef] : [{ $ref: BASE_TYPE_ID }],
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    properties,
    required,
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    unevaluatedProperties: false,
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    'x-uikit': {
      metamodel: METAMODEL_VERSION,
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
      ...pickFields(overlay, uikitFields),
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
      slots,
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
      passthrough: extraction.passthroughSources,
      variant_sources: extraction.variantSourceLabels,
      cannot_extract: extraction.cannotExtract,
    },
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
    'x-gts-traits': pickFields(overlay, gtsTraitsFields),
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
  };
  // M3: validated against buildGtsTraitsSchema() here, not only inside
  // whichever component's own test file happens to register it with a GTS
  // store - a future mismatch between this assembly and
  // buildGtsTraitsSchema()'s own field routing now fails every compile.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-return
  assertValidatesAgainst(exportStem, 'x-gts-traits', buildGtsTraitsSchema(), contract['x-gts-traits']);
  return contract;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-return
}

// "Was this module invoked as the entry, rather than imported?" Under tsx
// (this package's runner, `npm run contracts:compile`) argv[1] is this
// file's resolved path, so the identity comparison matches. An import (the
// conformance test, a build script) leaves argv[1] pointing at the test
// runner instead, so it never matches.
// @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-invoke-compile
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-invoke-compile
}

// Every `*.contract.yaml` overlay directly in a directory - one for the
// ordinary case (button.contract.yaml), one per export for a compound
// component (accordion.contract.yaml, accordion-item.contract.yaml, ...).
// `.contract.ru.yaml` never matches this suffix (it ends in `.ru.yaml`, not
// `.contract.yaml`) - it is excluded on disk locally and must never be
// picked up as a normal overlay if it exists.
// @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-no-overlay
export function overlayStems(directory: string): string[] {
  const dir = join(kitRoot, 'src', 'components', directory);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.contract.yaml'))
    .map((name) => name.slice(0, -'.contract.yaml'.length))
    .sort();
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-no-overlay
}

function compileOne(directory: string, exportStem: string): void {
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-compile-each
  const extraction = resolveTargetExtraction(directory, exportStem);
  const contract = compileContract(directory, exportStem);
  const instance = compileInstance(directory, exportStem);
  // Output sits next to the component's source, alongside the overlay it was
  // compiled from - not dist/contracts, which does not exist until a build
  // runs. The committed artifact IS the compiled contract; dist/ gets its
  // own copy through the normal build/publish step.
  const out = join(kitRoot, 'src', 'components', directory, `${exportStem}.contract.json`);
  // Derived, not a separate argument: the two artifacts describe one
  // component and there is no case for writing them to unrelated places.
  const instanceOut = `${out.replace(/\.json$/, '')}.instance.json`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`);
  writeFileSync(instanceOut, `${JSON.stringify(instance, null, 2)}\n`);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-compile-each
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-report-paths
  console.log(`wrote ${out}`);
  console.log(`wrote ${instanceOut}`);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-report-paths
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-write-passthrough
  if (extraction.passthroughOrigin && extraction.passthroughKind) {
    const passthroughOut = join(GENERATED_DIR, `passthrough.${extraction.passthroughOrigin}.json`);
    const existing = existsSync(passthroughOut) ? (JSON.parse(readFileSync(passthroughOut, 'utf8')) as Record<string, unknown>) : undefined;
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-open
    const existingGeneratedFrom = Array.isArray(existing?.generated_from) ? (existing.generated_from as string[]) : [];
    const generatedFrom = Array.from(new Set([...existingGeneratedFrom, exportStem]));
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-open
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
    const passthroughSchema = buildPassthroughSchema(
      extraction.passthroughOrigin,
      extraction.passthroughKind,
      extraction.inheritedProps,
      generatedFrom,
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-props
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-collision
    assertNoPassthroughCollision(
      exportStem,
      extraction.passthroughOrigin,
      passthroughOut,
      existing && { generatedFrom: existingGeneratedFrom, surface: { properties: existing.properties, required: existing.required } },
      { properties: passthroughSchema.properties, required: passthroughSchema.required },
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-collision
    mkdirSync(GENERATED_DIR, { recursive: true });
    writeFileSync(passthroughOut, `${JSON.stringify(passthroughSchema, null, 2)}\n`);
    console.log(`wrote ${passthroughOut}`);
  }
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-write-passthrough
}

// M4: a shared origin key is exactly that - shared. Two components can
// resolve the SAME origin key (Omit's own excluded-keys argument is not
// part of the key - see extract.ts's resolvePassthroughOrigin) while
// genuinely inheriting DIFFERENT prop sets from it. Whichever compiled last
// used to win silently; this compares the incoming surface against whatever
// is already committed, and a real mismatch - as opposed to this same
// component simply recompiling after a source change - fails the build
// naming every component on record for this file instead of overwriting
// them. Pure (no I/O) so it is unit-testable without touching the real
// generated/ directory - compileOne above is the only real caller.
//
// The compared surface is everything buildPassthroughSchema derives from the
// component's inherited props: `properties` AND `required`. Everything else
// in the file is fixed by the origin (title, description, patternProperties,
// $id) or is the ownership list itself. Comparing properties alone would let
// two components disagree about which forwarded props are MANDATORY - one
// primitive turning `value` required where the other has it optional - and
// the later compile would overwrite the earlier component's answer in
// silence, which is the exact failure this refusal exists to prevent.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-collision
export interface PassthroughOwnedSurface {
  properties: unknown;
  required: unknown;
}

function sameOwnedSurface(committed: PassthroughOwnedSurface, fresh: PassthroughOwnedSurface): boolean {
  const normalize = (surface: PassthroughOwnedSurface): string =>
    JSON.stringify({ properties: surface.properties ?? {}, required: surface.required ?? [] });
  return normalize(committed) === normalize(fresh);
}

export function assertNoPassthroughCollision(
  exportStem: string,
  originKey: string,
  passthroughPath: string,
  existing: { generatedFrom: string[]; surface: PassthroughOwnedSurface } | undefined,
  freshSurface: PassthroughOwnedSurface,
): void {
  if (!existing) return;
  const otherOwners = existing.generatedFrom.filter((stem) => stem !== exportStem);
  if (otherOwners.length === 0) return;
  if (sameOwnedSurface(existing.surface, freshSurface)) return;
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-collision-refuse
  throw new Error(
    `${exportStem}: shared passthrough origin "${originKey}" is already committed by ${otherOwners.join(', ')} ` +
      `with a different inherited-props set - compiling ${exportStem} would silently overwrite ${passthroughPath} ` +
      `for ${otherOwners.length === 1 ? 'that component' : 'those components'}. If these components genuinely ` +
      `inherit different props from the same origin, the origin key itself needs to change (see ` +
      `resolvePassthroughOrigin in extract.ts); if they should match, recompile ${otherOwners.join(', ')} too so ` +
      `both sides agree`,
  );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-collision-refuse
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-collision
}

// The three schemas that belong to no single component - the abstract base
// type, the metamodel, and the vocabulary types the two of them reference.
// Written from their builders rather than hand-maintained: the grammar of a
// component reference lives in ids.ts, and a hand-typed copy of it in JSON
// is exactly the drift ids.ts exists to prevent. A stale committed copy is
// caught by the freshness comparison, which diffs every one of these files
// against a fresh build on every component's own test run.
// @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-write-shared
function writeSharedSchemas(): void {
  const write = (path: string, content: unknown): void => {
    writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
    console.log(`wrote ${path}`);
  };
  mkdirSync(TYPES_DIR, { recursive: true });
  for (const type of buildTraitTypes()) write(join(TYPES_DIR, traitTypeFileName(type)), type);
  // After the vocabulary types, never before: both of these reference them,
  // and the Ajv validation each build runs can only resolve a type that is
  // already on disk.
  write(join(SCHEMA_DIR, 'base.component.json'), buildBaseSchema());
  write(join(SCHEMA_DIR, 'ui-component.meta.json'), buildMetamodel());
}
// @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-write-shared

// CLI entry - skipped when the module is imported (e.g. by the conformance
// test). Takes a DIRECTORY, not one component: `npm run contracts:compile
// -- accordion` compiles every `*.contract.yaml` overlay directly under
// src/components/accordion/ (one for the ordinary single-overlay directory,
// several for a compound one) - there is no per-export CLI invocation,
// because a reviewer regenerating a compound component's contracts wants all
// of its parts refreshed together, not one at a time.
// @cpt-flow:cpt-frontx-ui-kit-flow-component-contracts-compile:p1
if (invokedDirectly()) {
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-invoke-compile
  const [directory] = process.argv.slice(2);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-invoke-compile
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-write-shared
  if (directory === '--schemas') {
    writeSharedSchemas();
    process.exit(0);
  }
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-write-shared
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-missing-argument
  if (!directory) {
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-usage-exit
    console.error('Usage: npm run contracts:compile -- <directory> | --schemas');
    process.exit(1);
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-usage-exit
  }
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-missing-argument
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-no-overlay
  const stems = overlayStems(directory);
  if (stems.length === 0) {
    // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-no-overlay-exit
    console.error(`${directory}: no *.contract.yaml overlay found directly under src/components/${directory}/`);
    process.exit(1);
    // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-no-overlay-exit
  }
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-no-overlay
  // @cpt-begin:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-compile-each
  for (const stem of stems) compileOne(directory, stem);
  // @cpt-end:cpt-frontx-ui-kit-flow-component-contracts-compile:p1:inst-compile-each
}
