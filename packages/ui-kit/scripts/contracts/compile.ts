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
// like its neighbours: it derives from base.component.json - one parent, the
// only one - and NAMES the hand-written passthrough type for the HOST ELEMENT
// it renders (passthrough/dom_button.json for Button, dom_div.json for
// Accordion's root), which whoever validates props resolves and applies
// beside it. Both of those are hand-written source - they describe no
// component's code, so there is nothing to extract for either. React's DOM attributes for
// a given element are the same surface for every component that renders it,
// and a prop the primitive library declares for its own part is the
// component's API rather than forwarded surface (extract.ts's
// declaration-site classification), so what is left to generate per component
// is nothing at all.
//
// What composing the element type buys is a statement of what passes through:
// `className`, `aria-*`, `data-*` and every React event handler are declared
// once, by the element they belong to, so a reader of one contract can tell
// the kit's own API from the DOM surface underneath it without diffing two
// files. The derived type does NOT close itself: `unevaluatedProperties`
// carries an annotated open schema instead of `false`, so a prop nothing
// evaluates is admitted and marked UNCHECKED rather than rejected - see
// OPEN_UNEVALUATED below for why a schema is the wrong place to decide that a
// prop is wrong, and check-lib.ts's classifyProps for where the verdict is
// actually reported.
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
//        `.instance.json`; both files are written together.
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
  DEFAULT_CONTRACT_MAJOR,
  domPassthroughToken,
  gtsToken,
  instanceId,
  instanceIdPattern,
  METAMODEL_TYPE_ID,
  METAMODEL_VERSION,
  passthroughElementToken,
  PASSTHROUGH_REF_TARGET,
  passthroughTypeId,
  passthroughTypeRef,
  passthroughTypeRefPattern,
  propsSchemaId,
  traitTypeId,
  VENDOR_PACKAGE,
} from './ids';

export { BASE_TYPE_ID, passthroughTypeId, passthroughTypeRef, propsSchemaId, instanceId, componentTypeRef };

export interface Examples {
  good: { title: string; code: string }[];
  bad: { title: string; code: string; why: string }[];
}

export type CoverageVerdict = 'verified' | 'checked-no' | 'not-described';

// The kinds of thing an assumption can be. A closed list, because an
// assumption with no kind is a paragraph: four entries said "JSON Schema has
// no notion of a generic type parameter" in four different sentences across
// three overlays, and nothing could tell that family of claim apart from
// "this part is composed of two primitives" or "its mount point is outside
// the kit". With a kind, a reader (and the conformance suite) can ask whether
// every prop the schema cannot type has an entry, which is exactly the
// question the four repeated sentences were answering by accident.
export type CoverageAssumptionKind =
  // A prop that reaches `properties` asserting nothing - a generic, a
  // function, a live object, a ReactNode. `prop` names it, and the pairing is
  // checked both ways by the conformance suite.
  | 'untyped_prop'
  // Internal structure of the primitive underneath that the kit does not
  // expose as a component of its own - a Header glued onto a Trigger inside
  // one exported component. A prop the kit does not advertise is not this:
  // `hidden` names that prop and carries its own reason.
  | 'hidden_part'
  // A mount point outside the kit, where the typed composition field has
  // nothing to point at.
  | 'external_mount'
  // Anything the props type never carries: internal state, a runtime
  // relationship, a fact about the component rather than about its schema.
  | 'behaviour';

// A claim the code cannot make true, recorded next to why. Modeled as its own
// array under `coverage.assumptions` rather than another coverage_verdict
// key: a verdict is one word, an assumption needs a reason a reader can
// check - and a kind, so that a family of assumptions can be checked against
// the contract it is about instead of read one at a time.
export interface CoverageAssumption {
  kind: CoverageAssumptionKind;
  claim: string;
  reason: string;
  // Required for, and only legal on, `untyped_prop`: the prop the claim is
  // about, checked against the extracted prop list the way
  // `deprecations.props` keys are.
  prop?: string;
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

// One prop of the primitive underneath that the kit does not advertise, and
// why it is not. Both halves are required: the name is what the compiler
// checks against the extraction, and the reason is what tells a reader a
// deliberate omission from a forgotten one.
export interface HiddenProp {
  prop: string;
  reason: string;
}

export interface Overlay {
  component: string;
  // The contract major this component's identifiers carry. Authored, and
  // per-component: moving it is the one acknowledgement the compatibility
  // gate accepts for a narrowing, and read off a kit-wide constant that
  // acknowledgement cost a rewrite of every identifier in the kit. Absent
  // means 1, which is what every component carries today.
  major?: number;
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
    // Optional: absent means unconstrained. A layout component that accepts
    // whatever a consumer puts in it can say nothing here, instead of
    // enumerating a kit it does not know or claiming `text` it does not
    // require.
    children?: { kinds: string[]; icons_via?: string };
    // Mount points OUTSIDE the kit, in the same external form
    // `dont_use_when.instead` uses. Authored here rather than in `parent`
    // because `parent` is derived from every other contract's children (see
    // deriveParentKinds) and an overlay may not write it; the two are merged
    // into `parent` at compile time.
    mounts_in?: ExternalAlternative[];
  };
  // Props of the primitive underneath that the kit does not advertise, each
  // carrying the reason it is not advertised. They are extracted (so the
  // compiler can check the name is real) and then left out of `properties`: a
  // component whose own stylesheet contradicts a primitive prop, or whose
  // usage document routes it to another part of the family, is not offering
  // that prop, and listing it as API would be the contract's own statement
  // that it is. The reason travels with the name because the name alone
  // leaves every later reader to rediscover why the prop is gone.
  hidden?: HiddenProp[];
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

// The composition an instance carries: the authored children, plus the
// `parent` the compiler derives from every other contract in the kit. The
// overlay's own `mounts_in` is merged into `parent` rather than carried
// separately - one field answers "where may this be mounted", whether the
// answer is a kit component or something outside it.
export interface CompiledComposition {
  children?: { kinds: string[]; icons_via?: string };
  parent?: { kinds: Alternative[] };
}

// The contract instance: the overlay, typed by the metamodel and pointing at
// the props schema. Field order here is the on-disk order.
export interface ContractInstance extends Omit<Overlay, 'component' | 'composition'> {
  composition: CompiledComposition;
  id: string;
  // The type this instance is an instance of, in the field name gts-ts looks
  // for (GtsExtractor's schemaIdFields) - without it GTS.validateInstance
  // answers "No schema found for instance" instead of validating.
  gts_type: string;
  metamodel: string;
  component: string;
  // The surface of the host element this component renders, held as an id
  // rather than embedded: the same reference the contract's own
  // x-gts-traits carries, so the two halves of one artifact name one surface.
  // Absent for a component that renders no host element of its own.
  host_element?: string;
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
  // A string for a string axis, a boolean for a boolean one - the JSON
  // Schema default has to be a value of the property's own type, and a cva
  // boolean variant's default really is `false`, not the string "false" its
  // variant map is keyed by.
  default?: string | boolean;
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
  'hidden',
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
  hidden: 'x-gts-traits',
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

// Validator-read fields the COMPILER writes rather than the overlay: read off
// the extraction, so an overlay may not author them (buildOverlaySchema
// removes them for exactly that reason). `host_element` is the only one -
// which element a component renders is a fact of its source, not a claim an
// author gets to make - and it is listed here rather than in SEMANTIC_FIELDS
// because that list is what an overlay may say. Its definition still lives in
// the metamodel like every other trait field, so the trait schema and the
// metamodel reach one shape through one place.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-host
const MACHINE_TRAIT_FIELDS = ['host_element'] as const;
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-host

export interface CompiledContract {
  $id: string;
  $schema: string;
  title: string;
  type: 'object';
  // Exactly one entry, always the abstract base type: a contract derives from
  // ONE type, which is what its chained $id already says. gts-ts treats the
  // first $ref in allOf as the parent of the derived type
  // (store.findParentRef), so a single entry is also the only shape in which
  // the id and the schema body cannot disagree about who the parent is. The
  // host element's surface used to sit here as a second parent; it is now a
  // reference the contract HOLDS (x-gts-traits.host_element) - see
  // hostElementRef below.
  allOf: [SchemaRef];
  properties: Record<string, ContractProperty>;
  // Own props whose extraction reported `optional: false`. A prop the
  // passthrough type owns never reaches this list - one owner, one required
  // set - so a component with no required own props (Button, today) still
  // emits `required: []`, not an absent field.
  required: string[];
  // What a prop nothing else in this schema evaluates means. Not `false`:
  // see OPEN_UNEVALUATED for why a schema is the wrong place to decide that
  // an unrecognized prop is an error.
  unevaluatedProperties: OpenUnevaluated;
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
  // GtsStore.validateSchemaTraits) - see buildGtsTraitsSchema. `family`,
  // `extension_points` and `hidden` are genuinely absent (not merely
  // `undefined`) for a component whose overlay omits them, exactly like their
  // x-uikit-routed counterparts always have been - the trait schema's own
  // nullable+default shape is what makes that absence resolve instead of
  // failing gts-ts's completeness check. `composition` is the compiled one
  // (derived `parent`, `mounts_in` merged into it), not the authored one, and
  // `host_element` is not authored at all - see MACHINE_TRAIT_FIELDS.
  'x-gts-traits': Omit<Pick<Overlay, TraitFields>, 'composition'> & {
    composition: CompiledComposition;
    host_element?: string;
  };
}

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The hand-written normative types this compiler derives from and names. Read
// from disk rather than inlined so the artifacts, the conformance test and Ajv
// all see one copy of each.
const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));
const PASSTHROUGH_DIR = join(SCHEMA_DIR, 'passthrough');
const TYPES_DIR = join(SCHEMA_DIR, 'types');

// What a prop nothing in the schema evaluates means. `unevaluatedProperties:
// false` made a schema the place where "the kit does not declare this" turned
// into "this is invalid", and those are different statements: a consumer
// passing a genuinely new React attribute, or a prop of a primitive part this
// harness has not classified yet, got the same answer as a consumer who typed
// `variannt`. An annotated open schema admits the value and records the
// verdict instead, so the useful distinction - a near-miss of a real kit prop
// is an error, an unrecognized name is merely unchecked - is made by whoever
// reads the props (check-lib.ts's classifyProps) rather than by Ajv, which
// cannot tell the two apart.
// Every schema builder and loader below is pure - the builders construct
// strings, the loaders read files nothing in this process writes - and each
// was being re-run on every validation: a single covered component's compile
// rebuilt the metamodel several times and re-read the whole vocabulary
// directory with it, and a widened guard multiplies that by the covered set.
//
// Memoized through a JSON round-trip rather than by handing the same object
// back, because two of the readers MUTATE what they are given: a GTS store
// normalizes a registered schema in place, and Ajv keeps its own state
// against one. A structured copy of a small document is far cheaper than the
// construction and the file reads it replaces, and it keeps the guarantee
// every existing caller already relies on - what it gets is its own.
function memoizeSchema<T>(build: () => T): () => T {
  let cached: string | undefined;
  return () => {
    cached ??= JSON.stringify(build());
    return JSON.parse(cached) as T;
  };
}

// The same, keyed by an argument - one entry per element kind.
function memoizeSchemaBy<T>(build: (key: string) => T): (key: string) => T {
  const cache = new Map<string, string>();
  return (key) => {
    let serialized = cache.get(key);
    if (serialized === undefined) {
      serialized = JSON.stringify(build(key));
      cache.set(key, serialized);
    }
    return JSON.parse(serialized) as T;
  };
}

export const UNCHECKED_VERDICT_KEY = 'x-uikit-verdict';
export type OpenUnevaluated = { readonly [UNCHECKED_VERDICT_KEY]: 'unchecked' };
export const OPEN_UNEVALUATED: OpenUnevaluated = { [UNCHECKED_VERDICT_KEY]: 'unchecked' };

export const loadBaseSchema = memoizeSchema(
  (): Record<string, unknown> => JSON.parse(readFileSync(join(SCHEMA_DIR, 'base.component.json'), 'utf8')) as Record<string, unknown>,
);

// The committed copies of the vocabulary types the base type's trait schema
// and the metamodel both reference. Read from disk for the same reason
// loadBaseSchema does: whoever registers them in a GTS store or an Ajv
// instance must see the shipped file, not a fresh build that might differ
// from it - the freshness check is what makes those two the same thing.
export const loadTraitTypes = memoizeSchema((): Record<string, unknown>[] =>
  readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(TYPES_DIR, name), 'utf8')) as Record<string, unknown>),
);

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
  // The verdict annotation inside every contract's `unevaluatedProperties`
  // (OPEN_UNEVALUATED above). Declared for the same reason as x-gts-ref: it
  // asserts nothing, and Ajv's strict mode must not trip over it while
  // checking props.
  if (!ajv.getKeyword(UNCHECKED_VERDICT_KEY)) ajv.addKeyword({ keyword: UNCHECKED_VERDICT_KEY });
  for (const type of loadTraitTypes()) ajv.addSchema(type);
}

export function registerContractTypes(register: (entity: Record<string, unknown>) => void): void {
  // No copy of its own: loadTraitTypes already hands back a fresh one, which
  // is exactly why it is memoized through a serialization rather than by
  // sharing the object - a GTS store normalizes what it registers in place.
  for (const type of loadTraitTypes()) register(type);
}

// The host-element surface an extraction implies, bare: the surface for the
// element the component renders, and only when it actually forwards something
// to it. A component that resolves an element but forwards nothing to it names
// no surface - there would be nothing for the surface to account for - so the
// contract and the instance decide it here, once, rather than each applying
// its own version of the rule and disagreeing the day one of them changes.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
export function hostElementFor(extraction: ComponentExtraction): string | undefined {
  if (extraction.passthroughProps.length === 0 || extraction.elementKind === undefined) return undefined;
  return passthroughTypeRef(domPassthroughToken(extraction.elementKind));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close

// The hand-written passthrough type for one host element - what a component
// rendering that element forwards to it. One file per element kind under
// scripts/contracts/passthrough/, never generated: React's DOM attributes for
// a `<button>` are the same for every component that renders one, so a
// per-component derivation produced files of 224 to 233 properties each that
// differed only in which component's compilation happened to print a union's
// members first.
//
// A kind with no committed file fails here by name rather than compiling a
// contract that silently forwards an undeclared surface: adding an element
// kind means writing its twenty lines, which is the point at which somebody
// decides what that element actually accepts.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-load
// Keyed by the TOKEN rather than the tag, because a contract holds the token:
// the reference it carries names the surface, and the token inside that
// reference is the file's own name. The tag-keyed wrapper below is what the
// compile path uses, where the tag is what the extractor resolved.
export const loadPassthroughSchemaByToken = memoizeSchemaBy((token: string): Record<string, unknown> => {
  assertSharedAttributesAgree();
  const path = join(PASSTHROUGH_DIR, `${token}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `no hand-written passthrough type "${token}" - expected ` +
        `scripts/contracts/passthrough/${token}.json. Write it (see dom_button.json for the shape: the common ` +
        `attributes, the element's own, and the aria-/data-/on* patterns) rather than deriving one per component`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
});

export function loadPassthroughSchema(elementKind: string): Record<string, unknown> {
  return loadPassthroughSchemaByToken(domPassthroughToken(elementKind));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-load

// Every committed element-kind type, for a reader that needs the whole set: a
// GTS store registering what contracts name, and the conformance suite's
// identifier-grammar check.
export const loadPassthroughSchemas = memoizeSchema((): Record<string, unknown>[] =>
  readdirSync(PASSTHROUGH_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(PASSTHROUGH_DIR, name), 'utf8')) as Record<string, unknown>),
);

// The host-element surface a contract NAMES, read off the reference it holds
// rather than re-derived through extraction. Two readers, because the two
// callers hold different things: a compiled contract in memory, or a document
// read as plain JSON out of some git revision - which is data until something
// checks it, so it is narrowed rather than cast.
//
// This is the one place the composed reference is turned back into a surface.
// Every surface-aware check goes through it, so a contract that names no
// surface answers "none" once, here, instead of each check inventing its own
// walk over the schema body.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-compose
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hostElementRef(contract: unknown): string | undefined {
  if (!isRecord(contract)) return undefined;
  const traits = contract['x-gts-traits'];
  if (!isRecord(traits)) return undefined;
  const ref = traits.host_element;
  return typeof ref === 'string' ? ref : undefined;
}

// The element token that reference carries - `dom_button`, which is also the
// name of the committed file under scripts/contracts/passthrough/, so the
// reference and the file are one identity.
export function hostElementToken(contract: unknown): string | undefined {
  const ref = hostElementRef(contract);
  return ref === undefined ? undefined : passthroughElementToken(ref);
}

// The committed surface that reference resolves to, or undefined when the
// contract names none. A reference naming a file that does not exist is NOT
// swallowed here - loadPassthroughSchema refuses by name, which is the same
// refusal a compile gets.
export function loadHostSurface(contract: unknown): Record<string, unknown> | undefined {
  const token = hostElementToken(contract);
  return token === undefined ? undefined : loadPassthroughSchemaByToken(token);
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-compose

// One attribute, one shape - across element kinds as well as inside one.
// The surfaces are hand-written, so what two of them state in common they
// state by hand: `children`, `className`, `id`, `role`, `style`, `tabIndex`,
// `title` and the three families are in every file, and only this comparison
// keeps the copies in step. The compatibility check depends on it - it reads
// a change of host element as a real difference between two surfaces, which
// is only a real difference while the attributes both kinds declare are
// declared identically.
//
// Pure over the surfaces it is handed, so a disagreement can be exercised
// without writing a file; the loader above applies it to what is committed.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-agree
export function sharedAttributeConflicts(surfaces: readonly Record<string, unknown>[]): string[] {
  const first = new Map<string, { id: string; schema: string }>();
  const conflicts: string[] = [];
  for (const surface of surfaces) {
    const id = String(surface.$id ?? '(surface with no id)');
    const declarations = {
      ...((surface.properties ?? {}) as Record<string, unknown>),
      ...((surface.patternProperties ?? {}) as Record<string, unknown>),
    };
    for (const [name, schema] of Object.entries(declarations)) {
      const serialized = JSON.stringify(schema);
      const earlier = first.get(name);
      if (earlier === undefined) {
        first.set(name, { id, schema: serialized });
        continue;
      }
      if (earlier.schema !== serialized) {
        conflicts.push(`"${name}": ${earlier.id} declares ${earlier.schema}, ${id} declares ${serialized}`);
      }
    }
  }
  return conflicts.sort();
}

// Applied once per process, on the path every compile takes: a contract names
// one element's surface, so nothing on the compile path would ever look at two
// of them otherwise.
let sharedAttributesAgree = false;
function assertSharedAttributesAgree(): void {
  if (sharedAttributesAgree) return;
  const conflicts = sharedAttributeConflicts(loadPassthroughSchemas());
  if (conflicts.length > 0) {
    throw new Error(
      `host-element surfaces disagree about an attribute more than one of them declares:\n  ${conflicts.join('\n  ')}\n` +
        `an attribute two element kinds share must be declared identically in both, because the compatibility ` +
        `check reads a difference between two surfaces as a narrowing a consumer feels`,
    );
  }
  sharedAttributesAgree = true;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-agree

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
// branch and the API-prop branch beside it). One function, used by
// both a component's own props and its generated passthrough type, so the
// same TypeScript shape is always classified the same way regardless of
// which side of the own/inherited split it happens to land on.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-describe
function classifyProviderSafeType(typeText: string): ContractProperty | undefined {
  const normalized = normalizeTypeText(typeText);
  if (normalized === 'boolean' || normalized === 'string' || normalized === 'number') {
    return { type: normalized };
  }
  const enumValues = parseStringLiteralUnion(normalized);
  if (enumValues) return { type: 'string', enum: enumValues };
  return undefined;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-describe
}

// The JSON Schema keywords that make a property schema assert something
// about a value. A schema carrying none of them - and no prose either - is
// the bare `{}` this compiler used to emit for every inherited prop the
// provider-safe subset could not express.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-describe
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
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-describe
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
export const buildTraitTypes = memoizeSchema((): Record<string, unknown>[] => [
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
      'What may appear inside this component. A component reference when the child IS a kit component - typed so a reader can resolve it and the conformance suite can check it exists - or one of two content kinds. "text" means a non-component React node: a string, a number, a fragment, or a formatted inline element (<strong>, <code>) - never a kit component, which would be a reference instead. "none" means the component takes no children at all (DataTable renders its Table internally: "text" would claim a slot that does not exist, "none" says so honestly), and stands alone - a list that pairs it with anything else says both that nothing may appear inside and that something may. Not an open string: a typo\'d reference would otherwise silently read as a content kind.',
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
      "Where this component may be mounted. DERIVED, never authored: a kit parent is any component whose own child composition names this one, computed across every contract at compile time, so the two directions of one relationship cannot disagree. A mount point OUTSIDE the kit takes the external form, authored in the overlay as `composition.mounts_in` and merged in here - the typed reference covers kit-to-kit nesting only, and a part whose real mount point is a third-party render function has nothing to point at. Nothing about Button constrains where it may appear, so most components have no parent at all.",
      {
        type: 'object',
        properties: {
          kinds: {
            type: 'array',
            items: { oneOf: [componentRefSchema(), { $ref: traitTypeId('external_alternative') }] },
            minItems: 1,
          },
        },
        required: ['kinds'],
        additionalProperties: false,
      },
    ),
    traitType(
      'composition',
      'UiKit composition',
      'How this component nests: what may go inside it, and what it may be mounted under. Separate facts, separate types, and both optional. `children` absent means UNCONSTRAINED - a layout component that accepts whatever a consumer puts in it neither enumerates a kit it does not know nor claims "text" it does not require, and an empty or invented list would read as a rule rather than as its absence. `parent` is derived from every other contract\'s `children` and merged with the overlay\'s own `mounts_in`; an overlay may not write it (the compiler refuses one that does).',
      {
        type: 'object',
        properties: {
          children: { $ref: traitTypeId('child_composition') },
          mounts_in: { type: 'array', items: { $ref: traitTypeId('external_alternative') }, minItems: 1 },
          parent: { $ref: traitTypeId('parent_composition') },
        },
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
      'A fact the code cannot make true, rather than a verified/checked-no/not-described claim. `kind` is required and drawn from a closed list, so a family of assumptions can be checked against the contract it is about instead of read one at a time: the conformance suite asks whether every prop the schema cannot type has an entry. `untyped_prop` additionally names the prop, checked against the extracted prop list the way a deprecation\'s key is.',
      {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['untyped_prop', 'hidden_part', 'external_mount', 'behaviour'],
            description:
              'untyped_prop: a property that reaches the contract asserting nothing - a generic, a function, a live object, a React node. hidden_part: internal structure of the primitive underneath that the kit does not expose as a component of its own; a prop the kit does not advertise is named in `hidden`, with its own reason, instead. external_mount: a mount point outside the kit, where the typed composition field has nothing to point at. behaviour: anything the props type never carries - internal state, a runtime relationship, a fact about the component rather than about its schema.',
          },
          claim: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1 },
          prop: propNameSchema(),
        },
        required: ['kind', 'claim', 'reason'],
        additionalProperties: false,
        // Instance-type-scoped keywords throughout, so this applies to a real
        // assumption object and is vacuously true of anything else - the same
        // property nullableTraitProperty relies on for `family`.
        if: { properties: { kind: { const: 'untyped_prop' } }, required: ['kind'] },
        then: { required: ['kind', 'claim', 'reason', 'prop'] },
        else: { not: { required: ['prop'] } },
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
]);
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
export const buildMetamodel = memoizeSchema((): Record<string, unknown> => ({
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
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-hidden
      hidden: {
        type: 'array',
        description:
          "Props of the primitive underneath that this kit does not advertise, so they are left out of the contract's own properties - each with the reason it is not advertised, because a bare name leaves every later reader to rediscover why the prop is gone. Every `prop` is checked against the extracted prop list - a name the primitive no longer declares fails the compile rather than hiding nothing - and may not name a prop the component declares itself, which would be the overlay asking the compiler to drop what the source states. Absent for a component that advertises everything it forwards, which is most of them.",
        items: {
          type: 'object',
          properties: {
            prop: propNameSchema(),
            reason: {
              type: 'string',
              minLength: 1,
              description: 'Why the kit does not advertise this prop: the component fact that makes offering it wrong, not a restatement of the name.',
            },
          },
          required: ['prop', 'reason'],
          additionalProperties: false,
        },
        minItems: 1,
      },
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-hidden
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-host
      host_element: {
        type: 'string',
        pattern: passthroughTypeRefPattern(),
        'x-gts-ref': PASSTHROUGH_REF_TARGET,
        description:
          "GTS id of the hand-written surface for the host element this component renders - what it forwards to that element. HELD as an id, not composed into the schema as a second parent: a contract derives from ONE type, the abstract base component type, and a surface shared kit-wide by every component that renders the same element is not a second thing this component IS. Whoever needs the surface resolves it through this reference and applies it beside the contract; nothing in the props schema merges it in. `x-gts-ref` declares what the value must resolve to; `type` and `pattern` are what enforce it, because gts-ts strips x-gts-ref before validating. Absent entirely for a component that renders no host element of its own - DataTable, which renders its Table internally.",
        $comment: "The element token, not the tag: `dom_button` for a <button>, normalized by domPassthroughToken - the same token the committed file under scripts/contracts/passthrough/ is named by, so the reference and the file name are one identity.",
      },
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-host
      // The two references gts-ts itself resolves against the registry: both
      // sit directly on an instance property, which is as deep as
      // XGtsRefValidator's own walk goes, so GTS.validateInstance fails an
      // instance whose props schema - or whose host-element surface - is not a
      // registered type (see the component contract suites). A reference
      // nested inside a referenced vocabulary type - a `don't` alternative, a
      // composition kind - is not reached by that walk and is resolved by the
      // conformance suite instead.
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
  }));

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
export const buildGtsTraitsSchema = memoizeSchema((): Record<string, unknown> => {
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

  // The compiler-written trait fields, taken from the same metamodel
  // definitions and always nullable: a component that renders no host element
  // of its own has nothing to say here, and validateSchemaTraits demands a
  // value or a default for every declared property.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-host
  for (const field of MACHINE_TRAIT_FIELDS) {
    properties[field] = nullableTraitProperty(metamodelProperties[field]);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-host

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-return
  return {
    type: 'object',
    description:
      "Validator-read half of the overlay: what GTS.validateEntity checks a component contract's x-gts-traits against (GtsStore.validateSchemaTraits, resolving this schema across the derivation chain from base.component down to the component's own contract). Everything here is a fact a validator or lint actually reads - dont_use_when's typed alternative, composition, deprecations, coverage (including its assumptions), family, extension_points, hidden and host_element; a purely documentary field (intent, typical_uses, invariants, anti_patterns, examples) lives in x-uikit instead, which no validator reads. Six of the fields are a REFERENCE to the vocabulary type that owns its shape (gts.frontx.uikit.trait.*), so that concept is defined once, in one place, for both this schema and the metamodel; hidden and host_element stay inline, because nothing else references either. host_element is the one field here the overlay does not author: which element a component renders is a fact of its source, and the compiler writes it. additionalProperties: false so an unknown trait key fails GTS.validateEntity by name instead of vanishing silently.",
    properties,
    // Only the fields the overlay itself always requires (buildMetamodel's
    // own `required` list) are required here too - `family`/`extension_points`
    // are optional at BOTH levels, resolved instead by nullableTraitProperty's
    // default above.
    required,
    additionalProperties: false,
  };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-trait-schema:p2:inst-ts-return
});

// base.component.json's full content: the abstract structural anchor
// (unchanged since T1) plus x-gts-traits-schema, generated rather than
// hand-typed for the reason buildGtsTraitsSchema documents. Read from disk
// as loadBaseSchema does for every other purpose (compiling a component,
// registering it in a GTS store) - this function exists so the committed
// file can be checked against a fresh build the same way ui-component.meta.json
// is checked against buildMetamodel().
export const buildBaseSchema = memoizeSchema((): Record<string, unknown> => ({
    $id: BASE_TYPE_ID,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit base component',
    description:
      "The ONE type every kit component's props schema derives from, and the only one: a contract has a single parent, which is what its chained $id says, and the surface of the host element it renders is a reference it holds rather than a second parent. Deliberately a near-empty structural anchor: it fixes the entity kind (an object of props) and gives the derivation chain a root, and it declares NO properties - not even className, which the hand-written surface for each host element declares, because a base shared by Button and, say, a headless provider cannot assume a DOM element underneath. Its job is to be the thing a derived id chains from, so a component schema is a GTS derived type rather than a standalone schema that happens to look similar. It also carries the ONE thing every derived component contract must supply to be a complete GTS entity: x-gts-traits-schema, the validator-read half of the overlay vocabulary that GTS.validateEntity checks a component's own x-gts-traits against. Six of its fields are references to the types that own each concept (gts.frontx.uikit.trait.*) rather than inline definitions; two, hidden and host_element, the validator reads but nothing else references, so they stay inline - see the domain model in the package DESIGN for how they relate.",
    type: 'object',
    $comment:
      "No additionalProperties/unevaluatedProperties here on purpose. gts-ts's validateSchemaAgainstParent rejects a derived schema that adds properties when the base sets additionalProperties: false, and closing the base would mean every component had to restate it. A derived component type does not close itself either: its unevaluatedProperties carries an annotated open schema ({ \"x-uikit-verdict\": \"unchecked\" }), so a prop nothing evaluates is admitted and reported as UNCHECKED by whoever reads the props rather than rejected by Ajv, which cannot tell a typo'd kit prop from an attribute this harness has not classified yet.",
    'x-gts-traits-schema': buildGtsTraitsSchema(),
  }));

// The overlay's own schema: the metamodel's authored fields (everything
// except id/metamodel/props_schema, which the compiler writes) with
// additionalProperties: false at every level - inherited from the
// metamodel's own nested closures, not restated. An overlay that misspells
// a field, adds a machine-owned one under a different name, or tries to
// write JSON-Schema vocabulary (`type`, `required`) fails here by name
// instead of the field silently not making it into the compiled artifact.
export function buildOverlaySchema(): Record<string, unknown> {
  const metamodel = buildMetamodel();
  const machineOwned = ['id', 'gts_type', 'metamodel', 'host_element', 'props_schema'];
  const properties = { ...(metamodel.properties as Record<string, unknown>) };
  for (const key of machineOwned) delete properties[key];
  const required = (metamodel.required as string[]).filter((key) => !machineOwned.includes(key));
  // Authored here and nowhere else in the compiled output: the major is not a
  // FIELD of a contract instance, it is part of every identifier the instance
  // carries (`id`, `props_schema`, and the contract's own `$id`), so
  // declaring it on the metamodel as well would be the same fact written
  // twice with nothing keeping the two in step.
  properties.major = {
    type: 'integer',
    minimum: 1,
    description:
      "Contract major of this component's identifiers. Per-component and authored, because moving it is the one acknowledgement the compatibility check accepts for a narrowing - read off a kit-wide constant, that acknowledgement cost a rewrite of every identifier in the kit at once. Absent means 1. A reference to this component from another contract carries the same number, so moving it moves every reference to it.",
  };

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit component contract overlay',
    description:
      "Shape of the hand-written overlay a contract compiles from - the metamodel's authored fields, plus the contract major its identifiers carry. `id`, `gts_type`, `metamodel`, `host_element` and `props_schema` are the compiler's own; an overlay may not write them. `host_element` is among them because which element a component renders is a fact of its source, read off the extraction, not a claim an author gets to make.",
    type: 'object',
    $defs: metamodel.$defs,
    properties,
    required,
    additionalProperties: false,
  };
}

// Compiled once for the life of the process: the schema is built from pure
// construction, and compiling it means an Ajv instance plus every vocabulary
// type added to it - real work that was being repeated per overlay, which on
// a widened guard is once per described component. A ValidateFunction holds
// no state between calls except `.errors`, which every caller reads
// immediately after its own synchronous call.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-unknown-field
let cachedOverlayValidator: ValidateFunction<Overlay> | undefined;
function compileOverlayValidator(): ValidateFunction<Overlay> {
  if (cachedOverlayValidator) return cachedOverlayValidator;
  const ajv = new Ajv2020({ allErrors: true });
  // The overlay schema reaches most of its shape through references to the
  // vocabulary types, which Ajv can only follow once they are added.
  addContractTypes(ajv);
  cachedOverlayValidator = ajv.compile<Overlay>(buildOverlaySchema());
  return cachedOverlayValidator;
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
  assertAgainstValidator(component, what, ajv.compile(schema), value);
}

// A validator for one contract's PROPS: the contract, plus the surface of the
// host element it NAMES. The two are composed here, at the point of
// validation, because that is what holding a reference means - the contract
// carries the surface's id and whoever checks props resolves it and applies
// the surface beside the contract. Nothing merges the surface into the
// contract's own body, so this is the only place the two meet, and a contract
// naming no surface (DataTable) is checked against itself alone.
//
// The kit's three annotation blocks are declared rather than switched off with
// `strict: false`, which would also swallow a genuine typo like
// `unevaluatedProperites` - exactly the class of mistake these schemas exist
// to catch. None of them asserts anything here: this instance checks props,
// not traits.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-compose
export function compilePropsValidator(contract: CompiledContract): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true });
  addContractTypes(ajv);
  for (const keyword of ['x-uikit', 'x-gts-traits', 'x-gts-traits-schema']) {
    if (!ajv.getKeyword(keyword)) ajv.addKeyword({ keyword });
  }
  ajv.addSchema(loadBaseSchema());
  const surface = loadHostSurface(contract);
  if (surface === undefined) return ajv.compile(contract);
  ajv.addSchema(surface);
  ajv.addSchema(contract);
  // A wrapper applying both at the same instance location. `ajv.compile`
  // throws on an unresolvable $ref, which is itself part of the check - a
  // reference naming a type nothing registered fails here rather than
  // validating against half a schema.
  return ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    allOf: [{ $ref: contract.$id }, { $ref: String(surface.$id) }],
  });
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-passthrough:p1:inst-ps-compose

// The validation half, over an already-compiled validator. Split out so the
// two schemas EVERY compile validates against - the metamodel for an
// instance, the trait schema for a contract's validator-read block - can be
// compiled once per process instead of once per artifact. Both are built by
// pure construction, so a cached validator can never be checking against a
// stale schema.
function assertAgainstValidator(component: string, what: string, validate: ValidateFunction, value: unknown): void {
  const roundTripped = JSON.parse(JSON.stringify(value)) as unknown;
  if (!validate(roundTripped)) {
    throw new Error(formatSchemaErrors(component, what, validate.errors));
  }
}

function memoizeValidator(schema: () => Record<string, unknown>): () => ValidateFunction {
  let cached: ValidateFunction | undefined;
  return () => {
    if (!cached) {
      const ajv = new Ajv2020({ allErrors: true });
      addContractTypes(ajv);
      cached = ajv.compile(schema());
    }
    return cached;
  };
}

const metamodelValidator = memoizeValidator(() => buildMetamodel());
const traitsValidator = memoizeValidator(() => buildGtsTraitsSchema());

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

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field
  // `composition.parent` is derived from every other contract's children
  // (deriveParentKinds), so an authored copy is a second writable statement
  // of one fact - the shape that let a part name a parent whose children did
  // not name it back. Refused here rather than removed from the vocabulary:
  // the field has to stay in the `composition` type for the compiled
  // instance to validate, so the check is on the AUTHORING side, which is
  // the side that must not write it.
  if (raw.composition !== null && typeof raw.composition === 'object' && 'parent' in raw.composition) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field-refuse
    throw new Error(
      `${component}: overlay writes composition.parent, which the compiler derives from every other contract's ` +
        `composition.children - for a mount point outside the kit, use composition.mounts_in instead`,
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field-refuse
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field

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

// The contract major one artifact carries: its overlay's own `major`, or the
// default. Read from the overlay rather than from a constant, and read for
// the TARGET wherever an identifier names one - a reference to another
// component has to carry that component's major, which is a fact about that
// component's overlay and not about the referrer's.
//
// A missing overlay is not an error here: `deriveParentKinds` asks about
// every described component in the kit, and a directory whose overlay cannot
// be read is answered by loadOverlay's own failure at the point it is
// actually compiled.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-major
export function contractMajor(directory: string, exportStem: string = directory): number {
  return loadOverlay(directory, exportStem).major ?? DEFAULT_CONTRACT_MAJOR;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-identifiers:p2:inst-id-major

// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-instance:p2
export function compileInstance(directory: string, exportStem: string = directory): ContractInstance {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-assemble
  const overlay = loadOverlay(directory, exportStem);
  const major = overlay.major ?? DEFAULT_CONTRACT_MAJOR;
  // The host element comes from the source, not the overlay - so the instance
  // needs the extraction the contract is built from. Cached per source file
  // (extract.ts's extractionCache), so asking here costs nothing once the
  // contract for the same component has been compiled in this process.
  const extraction = resolveTargetExtraction(directory, exportStem);
  const instance: ContractInstance = {
    id: instanceId(exportStem, major),
    gts_type: `${METAMODEL_TYPE_ID}~`,
    metamodel: METAMODEL_VERSION,
    component: exportStem,
    intent: overlay.intent,
    typical_uses: overlay.typical_uses,
    dont_use_when: overlay.dont_use_when,
    composition: compileComposition(directory, exportStem, overlay),
    invariants: overlay.invariants,
    anti_patterns: overlay.anti_patterns,
    deprecations: overlay.deprecations,
    coverage: overlay.coverage,
    examples: overlay.examples,
    family: overlay.family,
    extension_points: overlay.extension_points,
    hidden: overlay.hidden,
    // The surface of the host element, held as an id exactly as the contract
    // holds it - the same reference, so the two halves of one artifact name
    // one surface. Undefined for a component that renders none.
    host_element: hostElementFor(extraction),
    // The bare id, not the `gts://` URI form the contract's own $id carries:
    // an id-VALUED field holds an id, and gts-ts's reference validator
    // rejects the URI form outright (Gts.isValidGtsID).
    props_schema: componentTypeRef(exportStem, major),
  };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-assemble
  // M3: validated against the metamodel here, not only inside whichever
  // component's own test file happens to assert it - a future mismatch
  // between this assembly and buildMetamodel()'s own required-field list
  // now fails every compile, not just the ones with test coverage for it.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-validate
  assertAgainstValidator(exportStem, 'instance', metamodelValidator(), instance);
  return instance;
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-instance:p2:inst-mi-validate
}

export interface PropsAndRequired {
  properties: Record<string, ContractProperty>;
  required: string[];
  slots: CompiledContract['x-uikit']['slots'];
}

// The machine-owned half of a component's props schema: cva axes, the props
// the component declares itself, and the props the primitive library declares
// for the part it wraps - typed where the provider-safe subset can express
// them, annotated with their TypeScript type where it cannot. Split out from
// compileContract so it can be unit-tested with a synthetic
// ComponentExtraction - in particular the element-surface conflict check,
// which needs no real component file to exercise.
//
// An API prop reaches `properties` on the same footing as a declared one, and
// that is the whole point of the change it came with: `multiple`,
// `defaultValue` and `onValueChange` are Accordion's API whether the kit
// types them out again or inherits them from Base UI's own AccordionRootProps,
// and an evaluation that read them out of a generated file of 233 properties
// concluded `defaultValue` took a plain string.
//
// `hidden` names API props the kit does not advertise. They are still
// extracted - which is what lets the compiler reject a `hidden` entry naming
// nothing - and then left out: a component whose own stylesheet or usage
// document contradicts a primitive prop is not offering it, and a contract
// listing it would say the opposite.
export function buildPropsAndRequired(
  component: string,
  extraction: ComponentExtraction,
  passthroughSchema: Record<string, unknown>,
  hidden: readonly string[] = [],
): PropsAndRequired {
  const properties: Record<string, ContractProperty> = {};
  const slots: PropsAndRequired['slots'] = {};
  const required: string[] = [];
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
  const passthroughTypes = passthroughPropertyTypes(passthroughSchema);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
  const hiddenNames = new Set(hidden);

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axes
  const booleanAxes = new Set(extraction.booleanAxes);
  for (const [axis, values] of Object.entries(extraction.axes)) {
    // A cva axis keyed by `true`/`false` is a boolean prop - that is what
    // VariantProps types it as - so it is emitted as one. Compiled as the
    // string enum its keys look like, the contract stated a prop accepting
    // only the strings "true" and "false", which no caller can satisfy.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-boolean-axis
    properties[axis] = booleanAxes.has(axis) ? { type: 'boolean' } : { type: 'string', enum: values };
    const declaredDefault = extraction.defaults[axis];
    if (declaredDefault !== undefined) {
      properties[axis].default = booleanAxes.has(axis) ? declaredDefault === 'true' : declaredDefault;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-boolean-axis
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axes

  // Declared props first, then API props: the two share one `properties` map
  // and one `required` list, so a name can only belong to one of them, and
  // the declared side wins by arriving first - a kit component that
  // re-declares a primitive prop (every one of them narrows `className`) is
  // stating the narrower fact deliberately.
  for (const prop of extraction.ownProps) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    assertAgreesWithElementSurface(component, prop, `${component}.tsx`, passthroughTypes);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    const normative = classifyProviderSafeType(prop.typeText);
    if (normative) {
      properties[prop.name] = normative;
    } else {
      // Not expressible in the provider-safe subset - recorded as a slot with
      // its source type, checked by the lint and by tsc, not by Ajv. It still
      // gets an annotation-only property entry so a reader of `properties`
      // sees every prop the component declares, not only the typeable ones.
      slots[prop.name] = { typeText: prop.typeText, optional: prop.optional };
      properties[prop.name] = {
        description: `Slot: ${prop.typeText}. No JSON Schema type exists for it; shape checked by tsc, see x-uikit.slots.`,
      };
    }
    // The same "never emit a property that asserts nothing and says nothing"
    // rule the API branch below applies, held here as a post-condition rather
    // than duplicated per branch: the slot branch above already writes its
    // own, more specific description and a typed property already asserts
    // something, so this changes nothing today - it is what keeps the rule
    // true for whatever branch is added next.
    properties[prop.name] = describeUntypeableProperty(properties[prop.name], prop.typeText);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    if (!prop.optional) required.push(prop.name);
  }

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-api
  for (const prop of extraction.apiProps) {
    if (hiddenNames.has(prop.name)) continue;
    if (prop.name in properties) {
      // The component declares this name itself, and its own declaration is
      // the narrower one (`className?: string` over Base UI's
      // `string | ((state) => string)`). Nothing to add, and nothing to
      // reconcile: `required` already carries the declared side's answer.
      continue;
    }
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    assertAgreesWithElementSurface(component, prop, prop.declarationFile, passthroughTypes);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // No slot record: `x-uikit.slots` is the kit's own slotted props, and a
    // forwarded API prop the schema cannot type is not one - its TypeScript
    // type goes in the description, and the `untyped_prop` assumption naming
    // it is what a reader gets instead of a second machine-readable copy.
    properties[prop.name] = describeUntypeableProperty(classifyProviderSafeType(prop.typeText) ?? {}, prop.typeText);
    if (!prop.optional) required.push(prop.name);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-api

  required.sort();
  return { properties, required, slots };
}

// One prop, one shape. Where a prop's name is also declared by the
// element-kind passthrough type this contract names, a validator that resolves
// that reference applies both to the same value, so a disagreement is not a
// precedence question - it is a props object that can satisfy neither. Only an
// ASSERTING entry on the element side can disagree: an annotation-only one
// (`style`, `children`) states nothing to contradict, which is exactly why a
// Base UI component's state-function `style` composes cleanly over React's
// plain object.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
function assertAgreesWithElementSurface(
  component: string,
  prop: ExtractedProp,
  declaredIn: string,
  passthroughTypes: Map<string, ContractProperty | undefined>,
): void {
  const declared = passthroughTypes.get(prop.name);
  if (declared === undefined) return;
  const classified = classifyProviderSafeType(prop.typeText);
  const agrees =
    classified !== undefined &&
    classified.type === declared.type &&
    JSON.stringify(classified.enum) === JSON.stringify(declared.enum);
  if (agrees) return;
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict-refuse
  throw new Error(
    `${component}: prop "${prop.name}" declared "${prop.typeText}" in ${declaredIn} conflicts with the ` +
      `element surface's declared type "${declared.type}" - one prop, one shape, and the two disagree`,
  );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict-refuse
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict

// Every property of a compiled contract that asserts nothing about its value
// - a slot the kit declares, or an API prop of the primitive underneath whose
// type JSON Schema cannot express. What they have in common is the only thing
// that matters to a reader: Ajv will not catch a wrong value here, so the
// prop's real type has to be stated in prose and its existence acknowledged.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-list
export function unassertedPropertyNames(contract: CompiledContract): string[] {
  return Object.entries(contract.properties)
    .filter(([, schema]) => !ASSERTING_KEYWORDS.some((keyword) => (schema as PropertySchema)[keyword] !== undefined))
    .map(([name]) => name)
    .sort();
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-list

// The pairing between those properties and the overlay's `untyped_prop`
// assumptions, both ways. A property nothing asserts and nothing explains is
// the defect the whole assumption-kind change came from: an evaluation read
// three such properties out of a generated file and decided they took plain
// strings. An assumption naming a property the schema DOES constrain is the
// mirror error - a reader told that `multiple` cannot be typed while the
// contract types it as a boolean has been told something false about the
// contract in front of them.
//
// Reported rather than thrown: this is a documentation gap, and a compile
// that refuses it would make a component uncompilable until its prose caught
// up, which is the wrong order. The conformance suite fails on it instead,
// in the run the author already executes.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-pair
export function findUntypedPropMismatches(contract: CompiledContract): string[] {
  const unasserted = new Set(unassertedPropertyNames(contract));
  const named = new Set(
    (contract['x-gts-traits'].coverage.assumptions ?? [])
      .filter((assumption) => assumption.kind === 'untyped_prop')
      .map((assumption) => assumption.prop)
      .filter((prop): prop is string => prop !== undefined),
  );
  const problems: string[] = [];
  for (const name of [...unasserted].sort()) {
    if (!named.has(name)) {
      problems.push(`"${name}" asserts nothing in properties but no untyped_prop assumption names it`);
    }
  }
  for (const name of [...named].sort()) {
    if (!unasserted.has(name)) {
      problems.push(`an untyped_prop assumption names "${name}", which the contract's properties do constrain`);
    }
  }
  return problems;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-pair

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
// found. Four prop-name-bearing overlay fields today - `deprecations.props`
// keys, `composition.children.icons_via`, every `hidden` entry, and an
// `untyped_prop` assumption's `prop` - checked here so every component gets
// the cross-check unconditionally rather than only the one whose test author
// remembered to write it. Extend the list if the metamodel ever adds a fifth.
//
// Which props count as real differs by field, and deliberately: the kit's own
// declared props and its variant axes are what a deprecation or an icon slot
// can name, while `hidden` and an `untyped_prop` assumption are about the
// primitive's API too, so they may name an API prop as well. A `hidden` entry
// naming a prop the kit itself declares would be the overlay asking the
// compiler to drop a prop the component's own source states, which is a
// different mistake and gets its own refusal.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop
export function assertOverlayReferencesRealProps(component: string, overlay: Overlay, extraction: ComponentExtraction): void {
  const declared = new Set([...Object.keys(extraction.axes), ...extraction.ownProps.map((prop) => prop.name)]);
  const api = new Set(extraction.apiProps.map((prop) => prop.name));
  const refuse = (message: string): never => {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
    throw new Error(`${component}: ${message}`);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
  };

  for (const prop of Object.keys(overlay.deprecations.props ?? {})) {
    if (!declared.has(prop)) refuse(`overlay deprecations.props references "${prop}", which is not a real prop`);
  }
  const iconsVia = overlay.composition.children?.icons_via;
  if (iconsVia !== undefined && !declared.has(iconsVia)) {
    refuse(`overlay composition.children.icons_via references "${iconsVia}", which is not a real prop`);
  }
  for (const { prop } of overlay.hidden ?? []) {
    if (declared.has(prop)) {
      refuse(
        `overlay hides "${prop}", which ${component}.tsx declares itself - hiding is for a prop of the primitive ` +
          `underneath that the kit does not advertise, not for the kit's own API`,
      );
    }
    if (!api.has(prop)) {
      refuse(
        `overlay hides "${prop}", which the primitive underneath does not declare - hidden names are checked ` +
          `against the extracted prop list so a renamed or removed primitive prop fails here rather than silently ` +
          `hiding nothing`,
      );
    }
  }
  for (const assumption of overlay.coverage.assumptions ?? []) {
    if (assumption.kind !== 'untyped_prop') continue;
    const prop = assumption.prop;
    if (prop === undefined) refuse(`an untyped_prop assumption ("${assumption.claim}") names no prop`);
    else if (!declared.has(prop) && !api.has(prop)) {
      refuse(`untyped_prop assumption references "${prop}", which is not a real prop`);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop
}

// Where a part may be mounted, derived rather than authored. Every overlay in
// the kit is read and asked which components it allows as children; the ones
// naming THIS component are its parents.
//
// This is the direction the fact actually runs. An authored `parent` was a
// claim about somebody else's contract - AccordionTrigger saying "I go inside
// AccordionItem" while AccordionItem's own children list was free to not
// mention triggers at all - so the pair could disagree and only a conformance
// test comparing them would notice. Derived, the two cannot disagree: there
// is one statement, `children`, and `parent` is a view of it.
//
// Overlays, not compiled contracts: an overlay is the authored source, so a
// derivation taken from it is right even while a committed contract is stale,
// which is the state every recompile passes through. No TypeScript program is
// built - this is a directory listing and a YAML parse per described
// component.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-composition:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-composition:p1:inst-co-derive
export function deriveParentKinds(directory: string, exportStem: string): string[] {
  const self = componentTypeRef(exportStem, contractMajor(directory, exportStem));
  const selfToken = gtsToken(exportStem);
  const refPattern = new RegExp(componentTypeRefPattern(true));
  const parents: string[] = [];
  const componentsDir = join(kitRoot, 'src', 'components');
  for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const stem of overlayStems(entry.name)) {
      if (stem === exportStem) continue;
      const overlay = loadOverlay(entry.name, stem);
      for (const kind of overlay.composition.children?.kinds ?? []) {
        if (kind === self) {
          // The PARENT's own major, from the parent's own overlay: a reference
          // names the major the target ships, so a component that moves its
          // major moves every reference to it - including the derived ones.
          parents.push(componentTypeRef(stem, overlay.major ?? DEFAULT_CONTRACT_MAJOR));
          continue;
        }
        // A children list naming this component at a major it no longer ships
        // is a stale reference, not a mount point that has gone away. Matched
        // by name and refused: moving a major is an edit to every overlay
        // naming the component, and dropping the derived parent for the ones
        // left behind would hide exactly the edit the move demands.
        // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-composition:p1:inst-co-stale-major
        const named = refPattern.exec(kind);
        if (named !== null && named[1] === selfToken) {
          throw new Error(
            `${exportStem}: ${entry.name}/${stem}.contract.yaml allows "${kind}" as a child, but ${exportStem} ` +
              `ships "${self}" - a reference carries the target's major, so moving a major means updating every ` +
              `overlay that names the component`,
          );
        }
        // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-composition:p1:inst-co-stale-major
      }
    }
  }
  return parents.sort();
}

// The composition an instance carries: the authored children unchanged, and a
// `parent` assembled from the derivation above plus whatever mount points
// outside the kit the overlay stated. Absent entirely when there is neither -
// most of the kit is mounted anywhere, and an empty list would read as a
// constraint rather than as its absence.
export function compileComposition(directory: string, exportStem: string, overlay: Overlay): CompiledComposition {
  const kinds: Alternative[] = [...deriveParentKinds(directory, exportStem), ...(overlay.composition.mounts_in ?? [])];
  const composition: CompiledComposition = {};
  if (overlay.composition.children !== undefined) composition.children = overlay.composition.children;
  if (kinds.length > 0) composition.parent = { kinds };
  return composition;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-composition:p1:inst-co-derive

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

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited
  if (extraction.unclassifiedProps.length > 0) {
    // A prop declared outside the component, the primitive library and
    // React's DOM types: the compiler cannot tell whether it is part of this
    // component's API or forwarded surface, and either guess would be a fact
    // the contract states without knowing it.
    const names = extraction.unclassifiedProps.map((prop) => `"${prop.name}" (${prop.declarationFile})`).join(', ');
    throw new Error(
      `${exportStem}: ${extraction.unclassifiedProps.length} prop(s) declared where the extractor cannot place ` +
        `them - ${names}. Neither this component's own source, the primitive library it wraps, nor React's DOM ` +
        `attribute types declare them, so the compiler cannot tell this component's API from what it forwards ` +
        `(see extract.ts's declaration-site classification)`,
    );
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited

  let passthroughSchema: Record<string, unknown> | undefined;
  // The id of that surface, bare: an id-VALUED field holds an id, and gts-ts's
  // reference validator rejects the URI form outright (Gts.isValidGtsID).
  let hostElement: string | undefined;
  if (extraction.passthroughProps.length > 0) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited
    if (!extraction.elementKind) {
      // Props forwarded to a host element, and no host element resolved for
      // them: the heritage walk gave up somewhere (its own `cannot_extract`
      // notes say where), and there is no honest schema to declare the
      // forwarded surface in. Refused rather than compiled without it - the
      // contract would then claim the component forwards nothing.
      throw new Error(
        `${exportStem}: ${extraction.passthroughProps.length} forwarded DOM prop(s) found (e.g. ` +
          `"${extraction.passthroughProps[0].name}") but no host element kind could be resolved from ` +
          `${directory}.tsx's props type - cannot say which element surface they belong to`,
      );
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    passthroughSchema = loadPassthroughSchema(extraction.elementKind);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    hostElement = hostElementFor(extraction);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
  }

  const { properties, required, slots } = buildPropsAndRequired(
    exportStem,
    extraction,
    passthroughSchema ?? { properties: {} },
    // Names only: what the props half needs is which props to leave out, and
    // each entry's reason travels to the reader in the validator-read block.
    (overlay.hidden ?? []).map((entry) => entry.prop),
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
    $id: propsSchemaId(exportStem, overlay.major ?? DEFAULT_CONTRACT_MAJOR),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${exportStem} contract`,
    type: 'object',
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    // One parent, always the base type. The host element's surface is named
    // as a value below (x-gts-traits.host_element), not composed in here.
    allOf: [{ $ref: BASE_TYPE_ID }],
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    properties,
    required,
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    unevaluatedProperties: OPEN_UNEVALUATED,
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
    'x-gts-traits': {
      ...pickFields(overlay, gtsTraitsFields),
      composition: compileComposition(directory, exportStem, overlay),
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
      host_element: hostElement,
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
  };
  // M3: validated against buildGtsTraitsSchema() here, not only inside
  // whichever component's own test file happens to register it with a GTS
  // store - a future mismatch between this assembly and
  // buildGtsTraitsSchema()'s own field routing now fails every compile.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-return
  assertAgainstValidator(exportStem, 'x-gts-traits', traitsValidator(), contract['x-gts-traits']);
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
