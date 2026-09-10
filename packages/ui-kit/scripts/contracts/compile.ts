// Contract compiler: merges code-extracted facts with the hand-written
// overlay into two GTS-typed artifacts.
//
//   <out>.json          - props schema, a DERIVED type whose $id chains the
//                         abstract component type:
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
// only one - and NAMES the hand-written surface for the HOST ELEMENT
// it renders (elements/dom_button.json for Button, dom_div.json for
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
// evaluates is admitted and classified as unchecked rather than rejected - see
// OPEN_UNEVALUATED below for why a schema is the wrong place to decide that a
// prop is wrong, and check-lib.ts's classifyProps for where the classification
// is actually reported.
//
// The overlay itself is validated before it is trusted: an unknown key (a
// typo, a stray JSON-schema keyword like `type`/`required`) fails the
// compile by name instead of silently vanishing on merge, and a component
// that redeclares a surface-owned prop with a conflicting type fails
// instead of the element surface quietly winning. A VariantProps heritage
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

import { extractComponent, type ComponentExtraction, type ExtractedProp } from './extract';
import {
  bareGtsId,
  BASE_TYPE_ID,
  COMPONENT_REF_TARGET,
  componentTypeRef,
  componentTypeRefPattern,
  DEFAULT_CONTRACT_MAJOR,
  domElementToken,
  gtsToken,
  instanceId,
  instanceIdPattern,
  METAMODEL_TYPE_ID,
  METAMODEL_VERSION,
  elementRefToken,
  ELEMENT_REF_TARGET,
  elementTypeId,
  elementTypeRef,
  elementTypeRefPattern,
  propsSchemaId,
  vocabularyTypeId,
  VENDOR_PACKAGE,
} from './ids';

export { BASE_TYPE_ID, elementTypeId, elementTypeRef, propsSchemaId, instanceId, componentTypeRef };

export interface Examples {
  good: { title: string; code: string }[];
  bad: { title: string; code: string; why: string }[];
}

// The answer to one claim a contract makes about itself. "failed" (looked
// at, does not hold) and "unknown" (nobody looked) are different answers and
// may not collapse into one.
export type AttestationOutcome = 'verified' | 'failed' | 'unknown';

// One claim, answered. `by` is optional and says who or what established the
// outcome - a role, a suite, a primitive's own behaviour, never a person -
// because "verified" with no idea what verified it is a claim a later reader
// cannot re-check.
export interface Attestation {
  outcome: AttestationOutcome;
  by?: string;
}

// One prop's statement: what it states and why nothing checks it, the two
// halves the retired `untyped` catch-all's `about: prop` category carried as
// `claim`/`reason`. Keyed on the prop itself now (the overlay's `props` map)
// rather than living in a flat list that named the prop as one more field -
// the same fact, one level closer to the property it is about. The compiler
// emits it into that property's own `description`, beside the `TS:` text.
export interface PropStatement {
  states: string;
  because: string;
}

// Internal structure of the primitive underneath that the kit does not
// expose as a component of its own - a Header glued onto a Trigger inside
// one exported component. A prop the kit does not advertise is not this:
// `withheld` names that prop and carries its own reason; this is the other
// half of "what the kit deliberately does not offer" - not a prop, a PART.
export interface UnexposedPart {
  // Free text: the extractor has no part list to check this against for a
  // composition this shallow (JSX in the component's own render body, not a
  // props-type heritage relationship). Checked against the primitive's own
  // part list wherever a future extractor knows one.
  part: string;
  reason: string;
}

// Where a "don't" sends the reader instead. `target` is what a human acts on
// and is always written, because a rule whose alternative only exists as an
// identifier leaves a reader resolving ids by hand; `component` is added when
// the kit ships one, so a resolver has something to follow and cannot mistake
// a stand-in for a real recommendation. `note` carries why, when `target`
// alone does not say it.
export interface Recommendation {
  target: string;
  component?: string;
  note?: string;
}

export interface DontUseWhenRule {
  situation: string;
  instead: Recommendation;
}

// What may appear inside a component. `content` is the whole answer for two
// of its three values: `unconstrained` for a component that accepts whatever
// a consumer puts in it (a layout that enumerates a kit it does not know
// would be stating a rule it does not have), `nothing` for one that renders
// its own body internally. `specified` is the case that needs detail, and
// then at least one of `components`/`text` says what the detail is.
export interface AcceptedContent {
  content: 'unconstrained' | 'nothing' | 'specified';
  // Kit components, by reference. Only with `content: specified`.
  components?: string[];
  // A non-component React node: a string, a number, a fragment, or a
  // formatted inline element (<strong>, <code>) - never a kit component,
  // which would be a reference instead. Only with `content: specified`.
  text?: boolean;
  // The prop icons arrive through, for a component that has one - the slot
  // that gets sized, spaced and marked decorative, rather than children.
  icons_via?: string;
}

// One place a component may be mounted, ONE shape whichever way it is known -
// the same move `recommendation` already made for "what to use instead":
// resolvability is an attribute of the fact, not a boundary between two
// kinds of fact. `container` is what a reader acts on either way - a kit
// component's own export name, or a container outside the kit named as
// plainly as the reader will have to act on it. `component` is FILLED by the
// compiler from every other contract's `accepts.components`, so the two
// directions of one nesting relationship cannot disagree; its absence is the
// honest statement that this mount point is not a kit component. `note` is
// authored on the outside-the-kit half, for why no kit component fits and
// what that container hands the component - a live instance, a render
// callback's arguments.
export interface MountPoint {
  container: string;
  component?: string;
  note?: string;
}

// Membership in a compound component's family (Accordion, its Item, Trigger
// and Content). Deliberately NOT a schema-level derivation chain (an item
// deriving from the root would make it inherit the root's props under a
// closed parent, which is wrong - an item is not a root): the relationship is
// recorded here, in the overlay and the instance, and checked by the
// conformance suite instead of by the type system.
//
// The family is named by a token rather than by the root's identifier, so
// membership is one statement each member makes about itself instead of a
// pointer at somebody else's contract. `members` is filled by the compiler on
// the root from every contract that names the same family as a part, so the
// two directions of one relationship cannot disagree.
export interface FamilyMembership {
  name: string;
  role: 'root' | 'part';
  members?: string[];
}

// A prop the consumer supplies whose type this schema cannot assert - the
// growth point a consumer extends the component through, declared at the
// component level instead of enumerating every prop a plugin author might
// touch (DataTable's `columns` accepts arbitrary TanStack `ColumnDef`s, whose
// own `header`/`cell` render functions are opaque to a JSON Schema extractor
// either way). `typed_by` is free text, not a reference: the type that
// governs such a prop usually lives in a third-party package this contract
// has no business re-typing, so a prose pointer is the honest claim rather
// than a broken reference.
export interface Slot {
  prop: string;
  // Optional: a slot is a prop through which the consumer supplies content,
  // regardless of whether that content happens to be typeable - `typed_by`
  // is present only when the schema cannot state the type, the case
  // `describeUnexpressedType` writes prose for. A slot the schema DOES
  // state in full is still a slot; it just needs no prose pointer.
  typed_by?: string;
  description: string;
}

// Something the component can do that a consumer turns on, with the prop that
// turns it on. Separate from a slot because the consumer supplies no value
// here - it flips a switch and the component does the rest, which is why
// `typed_by` has no place here at all: the interesting fact is the enabling
// prop, never a type to name.
export interface Capability {
  name: string;
  enabled_by: string;
  description: string;
}

// An export beside the component that a consumer builds its input with - a
// column helper, a ready-made column, the feature set the component
// registers. Not a prop and not a capability: it is another name from the
// same module, which is why it is keyed by the export rather than by a prop.
export interface Companion {
  export: string;
  typed_by: string;
  description: string;
}

// One prop of the primitive underneath that the kit does not advertise, and
// why it is not. Both halves are required: the name is what the compiler
// checks against the extraction, and the reason is what tells a reader a
// deliberate omission from a forgotten one.
export interface WithheldProp {
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
  dont_use_when: DontUseWhenRule[];
  accepts: AcceptedContent;
  // Mount points the overlay may state: a container OUTSIDE the kit, where
  // there is no contract to derive one from. A component reference in this
  // field is refused (see parseOverlay) - the compiler fills those from every
  // other contract's `accepts.components`, so an authored one would be a
  // second writable statement of one fact.
  mounted_in?: MountPoint[];
  invariants: { id: string; text: string }[];
  // `do_instead` (never `instead` - that word stays the recommendation of a
  // DIFFERENT component, in `dont_use_when`): the fix for an anti-pattern
  // stays inside this component's own API.
  anti_patterns: { dont: string; do_instead: string }[];
  deprecations: { props?: Record<string, { since: string; replacement: string; hint: string }> };
  // Open by construction: the claim names are the kit's own and grow with it.
  attestations: Record<string, Attestation>;
  // A statement about one of THIS component's own props: what it states and
  // why nothing checks it. Required for every prop the schema does not state
  // in full and forbidden for one it does - the compiler emits it into that
  // property's own description, checked both ways by the conformance suite.
  props?: Record<string, PropStatement>;
  examples: Examples;
  // Absent for every component that is not part of a compound one (Button,
  // ...): a family only exists where a directory's public surface is more
  // than one contract.
  family_membership?: FamilyMembership;
  // Three growth surfaces, each absent for a component that has none of it
  // (Button, Accordion, most of the kit): a prop the consumer fills, a
  // behaviour a prop turns on, an export beside the component.
  slots?: Slot[];
  capabilities?: Capability[];
  companions?: Companion[];
  // Props of the primitive underneath that the kit does not advertise, each
  // carrying the reason it is not advertised. They are extracted (so the
  // compiler can check the name is real) and then left out of `properties`: a
  // component whose own stylesheet contradicts a primitive prop, or whose
  // usage document routes it to another part of the family, is not offering
  // that prop, and listing it as API would be the contract's own statement
  // that it is. The reason travels with the name because the name alone
  // leaves every later reader to rediscover why the prop is gone.
  withheld?: WithheldProp[];
  // Internal structure of the primitive underneath that the kit does not
  // expose as a component of its own - the other half of "what the kit
  // deliberately does not offer" beside `withheld`.
  unexposed_parts?: UnexposedPart[];
}

// The contract instance: a thin typed record that NAMES the contract rather
// than repeating it. Every meaning field lives once, in the contract's
// x-gts-traits (see SEMANTIC_FIELD_TARGETS): the meaning is processing
// metadata of the TYPE, so a runtime that acts on it reads the type's own
// annotations, and a second copy here would be one fact in two documents with
// nothing keeping them in step.
//
// What is left is what only an instance can carry: its own identity, the type
// it is an instance of, the vocabulary version it was compiled against, and
// the two references gts-ts itself resolves against a registry - which is the
// whole reason this document still exists rather than folding into the
// contract.
export interface ContractInstance {
  id: string;
  // The type this instance is an instance of, in the field name gts-ts looks
  // for (GtsExtractor's schemaIdFields) - without it GTS.validateInstance
  // answers "No schema found for instance" instead of validating.
  gts_type: string;
  metamodel: string;
  component: string;
  props_schema: string;
  // The surface of the host element this component forwards to, held as an
  // id exactly as the contract holds it - the same reference, so the two
  // halves of one artifact name one surface. Absent for a component that
  // forwards to no host element of its own (DataTable, which renders its
  // Table internally).
  forwards_to?: string;
}

export interface ContractProperty {
  // Absent where the type states no JSON Schema type at all: a ReactNode or
  // a render prop. The property is still declared (with annotations only, no
  // assertions) so that `unevaluatedProperties: false` counts it as
  // evaluated and lets it through - a contract that rejected `icon` would be
  // wrong, not strict. Its real type stays in x-uikit.partially_typed_props,
  // where the lint and tsc read it. PRESENT, with a description beside it, where the type
  // states a kind but not a shape: `columns` is an array of column defs, and
  // "array" is the half of that Ajv can hold.
  type?: string;
  enum?: string[];
  // The element schema of an array whose element type the checker states in
  // full. Absent for `unknown[]` - an array of anything is entirely said by
  // `type: "array"` - and for an element JSON Schema cannot state, where a
  // partial `items` would constrain what the element does not.
  items?: ContractProperty;
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

// Which annotation block each meaning field lands in, and THE ONE PLACE that
// answer changes. Every one of them targets 'x-gts-traits' today, because the
// meaning of a component is processing metadata of its type: a runtime that
// acts on it reads the type's own annotations, and gts-ts's GTS.validateEntity
// checks that block against base.component.json's x-gts-traits-schema (see
// buildGtsTraitsSchema below) the same way it checks component props - so a
// malformed meaning block fails the build rather than a review.
//
// The map stays a map with two possible targets rather than collapsing into a
// list, because it is the reversal point: the day the answer becomes "meaning
// is documentation a validator never reads" (see the package DESIGN's open
// questions), moving a field back to 'x-uikit' is an edit here and nothing
// else - CompiledContract's own block types are derived from this map's
// literal values (FieldsFor below), so an edit that moves a field also moves
// which block TypeScript requires it to appear in.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
const SEMANTIC_FIELDS = [
  'intent',
  'typical_uses',
  'dont_use_when',
  'accepts',
  'mounted_in',
  'invariants',
  'anti_patterns',
  'deprecations',
  'attestations',
  'props',
  'unexposed_parts',
  'examples',
  'family_membership',
  'slots',
  'capabilities',
  'companions',
  'withheld',
] as const;
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route

type SemanticField = (typeof SEMANTIC_FIELDS)[number];
type SemanticTarget = 'x-uikit' | 'x-gts-traits';

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
const SEMANTIC_FIELD_TARGETS = {
  intent: 'x-gts-traits',
  typical_uses: 'x-gts-traits',
  dont_use_when: 'x-gts-traits',
  accepts: 'x-gts-traits',
  mounted_in: 'x-gts-traits',
  invariants: 'x-gts-traits',
  anti_patterns: 'x-gts-traits',
  deprecations: 'x-gts-traits',
  attestations: 'x-gts-traits',
  props: 'x-gts-traits',
  unexposed_parts: 'x-gts-traits',
  examples: 'x-gts-traits',
  family_membership: 'x-gts-traits',
  slots: 'x-gts-traits',
  capabilities: 'x-gts-traits',
  companions: 'x-gts-traits',
  withheld: 'x-gts-traits',
} as const satisfies Record<SemanticField, SemanticTarget>;
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route

// The field-name union routed at a given target, computed from
// SEMANTIC_FIELD_TARGETS's own literal values (the `as const satisfies`
// above is what keeps them literal instead of widening to `SemanticTarget`)
// rather than duplicated as a second, hand-typed list - the type-level twin
// of what fieldsTargeting computes at runtime. `UikitFields` is `never` while
// every field targets the other block, which is what makes x-uikit's own type
// carry the extraction facts and nothing else.
type FieldsFor<Target extends SemanticTarget> = {
  [Field in SemanticField]: (typeof SEMANTIC_FIELD_TARGETS)[Field] extends Target ? Field : never;
}[SemanticField];
type UikitFields = FieldsFor<'x-uikit'>;
type GtsTraitsFields = FieldsFor<'x-gts-traits'>;

// Validator-read fields the COMPILER writes rather than the overlay: read off
// the extraction, so an overlay may not author them (buildOverlaySchema
// removes them for exactly that reason). `forwards_to` is the only one -
// which element a component renders is a fact of its source, not a claim an
// author gets to make - and it is listed here rather than in SEMANTIC_FIELDS
// because that list is what an overlay may say. Its definition still lives in
// the metamodel like every other x-gts-traits field, so the
// x-gts-traits-schema and the metamodel reach one shape through one place.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-host
const COMPILER_WRITTEN_TRAITS = ['forwards_to'] as const;
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-host

export interface CompiledContract {
  $id: string;
  $schema: string;
  title: string;
  type: 'object';
  // Exactly one entry, always the abstract component type: a contract derives
  // from ONE type, which is what its chained $id already says. gts-ts treats
  // the first $ref in allOf as the parent of the derived type
  // (store.findParentRef), so a single entry is also the only shape in which
  // the id and the schema body cannot disagree about who the parent is. The
  // host element's surface used to sit here as a second parent; it is now a
  // reference the contract HOLDS (x-gts-traits.forwards_to) - see
  // forwardsToRef below.
  allOf: [SchemaRef];
  properties: Record<string, ContractProperty>;
  // Own props whose extraction reported `optional: false`. A prop the host
  // element's surface owns never reaches this list - one owner, one required
  // set - so a component with no required own props (Button, today) still
  // emits `required: []`, not an absent field.
  required: string[];
  // What a prop nothing else in this schema evaluates means. Not `false`:
  // see OPEN_UNEVALUATED for why a schema is the wrong place to decide that
  // an unrecognized prop is an error.
  unevaluatedProperties: OpenUnevaluated;
  // What the source says, none of it authored: the metamodel version this was
  // compiled against, the props whose type no JSON Schema shape can express
  // with the checker's own printed type text, where this component's cva axes
  // come from, and every fact the extraction could not read.
  'x-uikit': {
    metamodel: string;
    partially_typed_props: Record<string, { typeText: string; optional: boolean }>;
    variant_sources: string[];
    cannot_extract: string[];
  } & Pick<Overlay, UikitFields>;
  // Everything asserted about the component: what its author wrote, plus the
  // two fields the compiler fills from other authors' assertions
  // (`mounted_in`'s component references, a family root's `members`) and the
  // one it reads off the source (`forwards_to`). Checked by gts-ts against
  // base.component.json's x-gts-traits-schema (GTS.validateEntity ->
  // GtsStore.validateSchemaTraits) - see buildGtsTraitsSchema. An optional
  // field an overlay omits is genuinely absent here, not merely `undefined`:
  // the x-gts-traits-schema's own nullable+default shape is what makes that
  // absence resolve instead of failing gts-ts's completeness check.
  'x-gts-traits': Omit<Pick<Overlay, GtsTraitsFields>, 'mounted_in' | 'family_membership'> & {
    mounted_in?: MountPoint[];
    family_membership?: FamilyMembership;
    forwards_to?: string;
  };
}

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The hand-written normative types this compiler derives from and names. Read
// from disk rather than inlined so the artifacts, the conformance test and Ajv
// all see one copy of each.
const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));
const ELEMENTS_DIR = join(SCHEMA_DIR, 'elements');
const VOCABULARY_DIR = join(SCHEMA_DIR, 'vocabulary');

// What a prop nothing in the schema evaluates means. `unevaluatedProperties:
// false` made a schema the place where "the kit does not declare this" turned
// into "this is invalid", and those are different statements: a consumer
// passing a genuinely new React attribute, or a prop of a primitive part this
// harness has not classified yet, got the same answer as a consumer who typed
// `variannt`. An annotated open schema admits the value and records the
// classification instead, so the useful distinction - a near-miss of a real
// kit prop is an error, an unrecognized name is merely unchecked - is made by
// whoever
// reads the props (check-lib.ts's classifyProps) rather than by Ajv, which
// cannot tell the two apart.
// Every schema builder and loader below is pure - the builders construct
// strings, the loaders read files nothing in this process writes - and each
// was being re-run on every validation: a single enrolled component's compile
// rebuilt the metamodel several times and re-read the whole vocabulary
// directory with it, and a widened guard multiplies that by the enrolled set.
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

export const CLASSIFICATION_KEY = 'x-uikit-classification';
export type OpenUnevaluated = { readonly [CLASSIFICATION_KEY]: 'unchecked' };
export const OPEN_UNEVALUATED: OpenUnevaluated = { [CLASSIFICATION_KEY]: 'unchecked' };

// Every keyword the kit's own schemas carry that asserts nothing: GTS's
// reference annotation, the two annotation blocks and the schema-level one on
// the abstract type, the abstract marker, and the classification a contract
// records for a prop nothing evaluates. Declared on every Ajv instance rather
// than switched off with `strict: false`, which would also swallow a genuine
// typo like `unevaluatedProperites` - exactly the class of mistake these
// schemas exist to catch.
export const ANNOTATION_KEYWORDS = [
  'x-gts-ref',
  'x-gts-abstract',
  'x-gts-traits',
  'x-gts-traits-schema',
  'x-uikit',
  CLASSIFICATION_KEY,
] as const;

export const loadBaseSchema = memoizeSchema(
  (): Record<string, unknown> => JSON.parse(readFileSync(join(SCHEMA_DIR, 'base.component.json'), 'utf8')) as Record<string, unknown>,
);

// The committed copies of the vocabulary types the base type's x-gts-traits-schema
// and the metamodel both reference. Read from disk for the same reason
// loadBaseSchema does: whoever registers them in a GTS store or an Ajv
// instance must see the shipped file, not a fresh build that might differ
// from it - the freshness check is what makes those two the same thing.
export const loadVocabularyTypes = memoizeSchema((): Record<string, unknown>[] =>
  readdirSync(VOCABULARY_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(VOCABULARY_DIR, name), 'utf8')) as Record<string, unknown>),
);

// The kit's own attestation claim names - a data file rather than a
// hardcoded list so adding a claim (the kit's third, whenever it ships one)
// is a one-line edit here, not a compile.ts change. `required` are the
// claims every enrolled component states, whether the outcome is verified,
// failed or still unknown; `optional` names a claim a component may make
// without every OTHER component having to. Read once per process, the same
// as the schemas above.
export interface AttestationClaimRegistry {
  required: string[];
  optional: string[];
}
const ATTESTATION_CLAIMS_PATH = join(SCHEMA_DIR, 'attestation-claims.json');
export const loadAttestationClaims = memoizeSchema(
  (): AttestationClaimRegistry => JSON.parse(readFileSync(ATTESTATION_CLAIMS_PATH, 'utf8')) as AttestationClaimRegistry,
);

// Every attestation key an overlay writes has to be one the kit actually
// recognizes - `propertyNames`'s pattern in the trait schema only checks the
// SHAPE of a key (lowercase, snake_case), which admits a typo of a real
// claim (`ally` beside `a11y`) exactly as readily as the real thing. This is
// the other half: a claim not in the registry fails the compile by name,
// with the fix stated in the message, instead of compiling clean as an
// unrecognized-but-well-formed key.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-attestation-claims
export function assertKnownAttestationClaims(component: string, overlay: Overlay): void {
  const known = new Set([...loadAttestationClaims().required, ...loadAttestationClaims().optional]);
  for (const claim of Object.keys(overlay.attestations)) {
    if (!known.has(claim)) {
      throw new Error(
        `${component}: attestation claim "${claim}" is not in the claim list - add it to scripts/contracts/attestation-claims.json`,
      );
    }
  }
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-attestation-claims

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
  // Every annotation the kit's own schemas carry (ANNOTATION_KEYWORDS above),
  // declared rather than switched off with `strict: false`, which would also
  // swallow a genuine typo like `unevaluatedProperites` - exactly the class of
  // mistake these schemas exist to catch. None of them asserts anything: a
  // reference's grammar is checked by the `pattern` beside it, and the
  // reference itself is resolved by a GTS store.
  for (const keyword of ANNOTATION_KEYWORDS) {
    if (!ajv.getKeyword(keyword)) ajv.addKeyword({ keyword });
  }
  for (const type of loadVocabularyTypes()) ajv.addSchema(type);
}

export function registerContractTypes(register: (entity: Record<string, unknown>) => void): void {
  // No copy of its own: loadVocabularyTypes already hands back a fresh one, which
  // is exactly why it is memoized through a serialization rather than by
  // sharing the object - a GTS store normalizes what it registers in place.
  for (const type of loadVocabularyTypes()) register(type);
}

// The host-element surface an extraction implies, bare: the surface for the
// element the component renders, and only when it actually forwards something
// to it. A component that resolves an element but forwards nothing to it names
// no surface - there would be nothing for the surface to account for - so the
// contract and the instance decide it here, once, rather than each applying
// its own version of the rule and disagreeing the day one of them changes.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
export function forwardsTo(extraction: ComponentExtraction): string | undefined {
  if (extraction.forwardedProps.length === 0 || extraction.elementKind === undefined) return undefined;
  return elementTypeRef(domElementToken(extraction.elementKind));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close

// The hand-written surface for one host element - what a component
// rendering that element forwards to it. One file per element kind under
// scripts/contracts/elements/, never generated: React's DOM attributes for
// a `<button>` are the same for every component that renders one, so a
// per-component derivation produced files of 224 to 233 properties each that
// differed only in which component's compilation happened to print a union's
// members first.
//
// A kind with no committed file fails here by name rather than compiling a
// contract that silently forwards an undeclared surface: adding an element
// kind means writing its twenty lines, which is the point at which somebody
// decides what that element actually accepts.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-load
// Keyed by the TOKEN rather than the tag, because a contract holds the token:
// the reference it carries names the surface, and the token inside that
// reference is the file's own name. The tag-keyed wrapper below is what the
// compile path uses, where the tag is what the extractor resolved.
export const loadElementSurfaceByToken = memoizeSchemaBy((token: string): Record<string, unknown> => {
  assertSharedAttributesAgree();
  const path = join(ELEMENTS_DIR, `${token}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `no hand-written surface "${token}" - expected ` +
        `scripts/contracts/elements/${token}.json. Write it (see dom_button.json for the shape: the common ` +
        `attributes, the element's own, and the aria-/data-/on* patterns) rather than deriving one per component`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
});

export function loadElementSurface(elementKind: string): Record<string, unknown> {
  return loadElementSurfaceByToken(domElementToken(elementKind));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-load

// Every committed element-kind type, for a reader that needs the whole set: a
// GTS store registering what contracts name, and the conformance suite's
// identifier-grammar check.
export const loadElementSurfaces = memoizeSchema((): Record<string, unknown>[] =>
  readdirSync(ELEMENTS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(ELEMENTS_DIR, name), 'utf8')) as Record<string, unknown>),
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
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-compose
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function forwardsToRef(contract: unknown): string | undefined {
  if (!isRecord(contract)) return undefined;
  const traits = contract['x-gts-traits'];
  if (!isRecord(traits)) return undefined;
  const ref = traits.forwards_to;
  return typeof ref === 'string' ? ref : undefined;
}

// The element token that reference carries - `dom_button`, which is also the
// name of the committed file under scripts/contracts/elements/, so the
// reference and the file are one identity.
export function forwardsToToken(contract: unknown): string | undefined {
  const ref = forwardsToRef(contract);
  return ref === undefined ? undefined : elementRefToken(ref);
}

// The committed surface that reference resolves to, or undefined when the
// contract names none. A reference naming a file that does not exist is NOT
// swallowed here - loadElementSurface refuses by name, which is the same
// refusal a compile gets.
export function loadHostSurface(contract: unknown): Record<string, unknown> | undefined {
  const token = forwardsToToken(contract);
  return token === undefined ? undefined : loadElementSurfaceByToken(token);
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-compose

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
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-agree
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
  const conflicts = sharedAttributeConflicts(loadElementSurfaces());
  if (conflicts.length > 0) {
    throw new Error(
      `host-element surfaces disagree about an attribute more than one of them declares:\n  ${conflicts.join('\n  ')}\n` +
        `an attribute two element kinds share must be declared identically in both, because the compatibility ` +
        `check reads a difference between two surfaces as a narrowing a consumer feels`,
    );
  }
  sharedAttributesAgree = true;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-agree

// name -> declared JSON Schema `type`, for every prop the element surface
// owns. `undefined` for an annotation-only entry (onClick, children, style):
// there is nothing to compare a component's own declaration against, so
// those names are still treated as owned (skip the property) but never
// trigger the type-conflict check below.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
function elementSurfacePropertyTypes(elementSurface: Record<string, unknown>): Map<string, ContractProperty | undefined> {
  const properties = (elementSurface.properties ?? {}) as Record<string, ContractProperty>;
  return new Map(Object.entries(properties).map(([name, schema]) => [name, schema.type ? schema : undefined]));
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
}

// Machine-owned fields the overlay must not restate - one fact, one owner.
// `required` and `type` are reserved for the same reason: they are either
// compiler output or a JSON-Schema keyword an author might type by habit, and
// either way the overlay writing one is a mistake worth naming specifically
// rather than folding into "unknown key". `axes`, `defaults` and `variants`
// guard the same mistake in the other direction - the raw extraction shape an
// author might paste in by habit while debugging, rather than the vocabulary
// this file actually defines.
//
// `props` is deliberately NOT here, and `slots` never needed to be: the
// machine's own per-property record used to share the word `slots` with the
// authored extension-surface field of the same name, which is why the two
// were told apart by which BLOCK they live in rather than by name; renaming
// the machine's record to `x-uikit.partially_typed_props` retired that
// collision outright (see fieldsTargeting's own comment). `props` is the
// SAME kind of field: an author writes `props: { <name>: {...} }` to state
// what one of the component's own properties means, and nothing machine-
// owned answers to that name any more either. A pasted debug dump under
// either key now fails the shape check below instead of a blanket ban.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned
const MACHINE_OWNED = ['axes', 'defaults', 'variants', 'required', 'type'];
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-machine-owned

// An empty property schema is not neutral to a reader: `{}` in a props
// contract reads as "anything goes", and an agent that read the accordion
// root's `value`/`defaultValue` that way concluded they were plain strings
// when their real type is `AccordionValue<Value>`.
//
// The rule is UNWRAP FIRST, describe only what is left. The extractor
// resolves the type through its aliases and its type parameters' defaults
// and constraints and states as much of it as JSON Schema carries
// (extract.ts's expressType); this adds the prose for the rest. A prop the
// schema states in full gets no prose - there is nothing left to say - and a
// prop it states nothing about gets prose alone. In between sits a prop
// whose kind is checkable and whose shape is not (`ColumnDef<...>[]` is an
// array of something Ajv cannot check), which gets both.
//
// The wording is about what is left, not about the prop: saying "not
// expressible" of a type that IS partly expressible is the false claim this
// rule came from.
//
// A property that already carries its own description (the own-prop slot
// branch writes a more specific one) is returned untouched - one property,
// one description.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-describe
export function describeUnexpressedType(schema: ContractProperty, typeText: string, complete: boolean): ContractProperty {
  if (complete || schema.description !== undefined) return schema;
  return { ...schema, description: `TS: ${typeText}. ${unexpressedClause(schema)}` };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-describe
}

// How much of the type the schema beside this prose failed to state - the
// one sentence that has to stay true of the schema it sits next to. A
// property carrying `type: "array"` is not "not expressible"; that claim,
// made of a type that partly is, is what this rule was written to stop.
function unexpressedClause(schema: ContractProperty): string {
  return schema.type === undefined
    ? 'Not expressible in JSON Schema, checked by tsc.'
    : 'Not fully expressible in JSON Schema; what the type states beyond the kind above is checked by tsc.';
}

// The property schema for one extracted prop, before any branch-specific
// prose: whatever the checker could state, or nothing.
function expressedSchemaOf(prop: ExtractedProp): ContractProperty {
  return prop.expressed === undefined ? {} : { ...prop.expressed.schema };
}

// How a reference to another kit component is spelled, everywhere one
// appears: a recommendation's component, an accepted component, a family
// member, the instance's own props_schema.
//
// THREE keywords, and all three are load-bearing:
//   - `x-gts-ref` is the reference itself - it names what the value must
//     resolve to in a type registry (any type derived from the abstract
//     abstract component type), which is what makes this a reference rather
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
//
// This is also the shape vocabulary/component_reference.v1.json carries -
// every OTHER place a component reference appears (a recommendation's
// component, an accepted component, a family member) is inside x-gts-traits,
// not on an instance property directly, so it is free to `$ref` that type
// instead of repeating the triple. Only the instance's own props_schema
// keeps this exact literal (see buildMetamodel below and the comment there):
// x-gts-ref has to sit directly on the instance property for gts-ts's walker
// to resolve it, and a `$ref` in between would hide it the same way an
// x-gts-ref-only oneOf branch does once gts-ts strips the keyword.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-id-value
function componentRefSchema(): Record<string, unknown> {
  return {
    type: 'string',
    pattern: componentTypeRefPattern(),
    'x-gts-ref': COMPONENT_REF_TARGET,
    description:
      "GTS id of another kit component: the props schema derived from the abstract component type. `x-gts-ref` declares what it must resolve to; `type` and `pattern` are what enforce it, because gts-ts strips x-gts-ref before validating.",
    $comment: 'GTS tokens are snake_case; kit directories are kebab-case (navigation_menu -> navigation-menu).',
  };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-id-value

// A reference to another kit component, as it appears NESTED inside
// x-gts-traits data (a recommendation's `component`, an accepted component,
// a family member) rather than directly on an instance property. `$ref`
// rather than componentRefSchema()'s literal: gts-ts's own ref-resolving
// walk never reaches this deep (see the comment above), so nothing is lost
// by defining the grammar once, in vocabulary/component_reference.v1.json,
// and pointing at it - which is also what turns five near-identical JSON
// blocks on disk into one type and four references.
function componentReferenceRef(): Record<string, unknown> {
  return { $ref: vocabularyTypeId('component_reference') };
}

function propNameSchema(): Record<string, unknown> {
  return {
    type: 'string',
    pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
    description: 'Name of a prop declared by the component, not a type id. Checked against the extracted prop list by the compiler (assertOverlayReferencesRealProps).',
  };
}

// A prop-name reference nested inside x-gts-traits data, the same relation
// componentReferenceRef has to componentRefSchema: propNameSchema's shape is
// what vocabulary/prop_name.v1.json carries, and every field that names a
// prop (an icon slot, a deprecation's replacement, a withheld prop, an
// untyped statement, a declared slot, a capability's switch) points at it
// instead of repeating the pattern.
function propNameRef(): Record<string, unknown> {
  return { $ref: vocabularyTypeId('prop_name') };
}

// A JS export name, as `companion.export` carries it. Syntactically the same
// grammar as a prop name - both are plain JS identifiers - but a different
// CONCEPT (an export is not a prop of the component), so it is its own
// function rather than a second caller of propNameSchema/propNameRef: the
// two grammars happening to coincide today is not a reason to let a future
// change to one silently narrow the other.
function exportNameSchema(): Record<string, unknown> {
  return {
    type: 'string',
    pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
    description: 'The exported name, as a consumer imports it - a JS identifier, not a prop.',
  };
}

function vocabularyType(token: string, title: string, description: string, body: Record<string, unknown>): Record<string, unknown> {
  return {
    $id: vocabularyTypeId(token),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    description,
    ...body,
  };
}

// The overlay vocabulary as GTS types, one concept per type, referenced by
// both the metamodel (what an instance must look like) and the abstract
// type's x-gts-traits-schema (what a validator checks x-gts-traits against)
// instead of being written out twice or copied through an inliner. Most are
// a field of the x-gts-traits block or a value object one of those fields
// embeds - a recommendation is a fact with its own shape, not an anonymous
// object inside a bigger schema. Two, `component_reference` and `prop_name`,
// are pure grammar rather than a domain concept: the reference triple and
// the name pattern that several of the others repeat, factored out so the
// grammar is defined once and every repetition is a `$ref` to it.
//
// Referenced, not inlined: gts-ts resolves a `$ref` in an x-gts-traits-schema
// by looking the id up among registered entities, so a type that is not
// registered fails loudly ("Unresolvable trait schema reference") instead
// of a component's `accepts` quietly validating against nothing.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-vocabulary
export const buildVocabularyTypes = memoizeSchema((): Record<string, unknown>[] => [
    vocabularyType(
      'component_reference',
      'UiKit component reference',
      componentRefSchema().description as string,
      componentRefSchema(),
    ),
    vocabularyType(
      'prop_name',
      'UiKit prop name',
      propNameSchema().description as string,
      propNameSchema(),
    ),
    vocabularyType(
      'recommendation',
      'UiKit recommendation',
      'Where a "don\'t" sends the reader instead. `target` is required and is what a person acts on, named as plainly as they will have to act on it. `component` is added when the kit ships one, so a resolver has an identifier to follow - and its absence is the honest statement that the kit ships nothing for this case, which naming the nearest kit component as a stand-in hid: that read to a resolver as a real recommendation and to an agent as an instruction to reach for the component the rule was written to steer it away from.',
      {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            minLength: 1,
            description: 'What to use instead, in the words a reader will act on - a component name, a primitive, the consuming application\'s own thing.',
          },
          // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-alternative
          component: componentReferenceRef(),
          // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-alternative
          note: {
            type: 'string',
            minLength: 1,
            description: 'Why this is the answer, when `target` alone does not say it - typically why no kit component fits, and what the kit does offer for the neighbouring case.',
          },
        },
        required: ['target'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'dont_use_when_rule',
      'UiKit dont-use-when rule',
      'One use this component is the wrong answer for, with the alternative that IS the answer. A "don\'t" without an alternative leaves the reader with no next move, so `instead` is required; it is one type rather than a union, because "what to use" and "is there a kit component for it" are two facts about one recommendation and not two kinds of recommendation.',
      {
        type: 'object',
        properties: {
          situation: {
            type: 'string',
            minLength: 1,
            description: 'The situation this component is the wrong answer for, stated as the situation rather than as a rule about the component.',
          },
          instead: { $ref: vocabularyTypeId('recommendation') },
        },
        required: ['situation', 'instead'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'accepted_content',
      'UiKit accepted content',
      'What may appear inside this component. `content` answers it outright for two of its three values: "unconstrained" for a layout component that accepts whatever a consumer puts in it - which it cannot state by enumerating a kit it does not know or by claiming a content kind it does not require - and "nothing" for a component that renders its own body internally (DataTable renders its Table from columns/data, so "text" would claim a slot that does not exist). "specified" is the case with detail, and then at least one of `components`/`text` carries it. Neither may appear with any other `content`, so a contract cannot say both that nothing may appear inside and that something may.',
      {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            enum: ['unconstrained', 'nothing', 'specified'],
          },
          components: {
            type: 'array',
            items: componentReferenceRef(),
            minItems: 1,
            description: 'Kit components that may appear inside, by reference - typed so a reader can resolve one and the conformance suite can check it exists. This is also the ONE authored statement of a nesting relationship: every other contract\'s `mounted_in` is filled from these lists.',
          },
          text: {
            type: 'boolean',
            description: 'A non-component React node may appear inside: a string, a number, a fragment, or a formatted inline element (<strong>, <code>) - never a kit component, which would be a reference in `components` instead.',
          },
          icons_via: propNameRef(),
        },
        required: ['content'],
        additionalProperties: false,
        // Instance-type-scoped keywords, so this applies to a real accepts
        // object and is vacuously true of anything else. `icons_via` is
        // governed by the same if/then/else as `components`/`text`: a prop
        // that supplies icons is a fact about WHAT is specified to appear
        // inside, so it makes no sense beside "nothing may appear inside"
        // or "whatever the consumer puts in it, unexamined" - carrying it
        // there would be a claim about content this type has already said
        // it is not making.
        // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-content-exclusive
        if: { properties: { content: { const: 'specified' } }, required: ['content'] },
        then: { anyOf: [{ required: ['components'] }, { required: ['text'] }] },
        else: { not: { anyOf: [{ required: ['components'] }, { required: ['text'] }, { required: ['icons_via'] }] } },
        // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-content-exclusive
      },
    ),
    vocabularyType(
      'mount_point',
      'UiKit mount point',
      'One place this component may be mounted, ONE shape whichever way it is known - resolvability is an attribute of the fact, not a boundary between two kinds of fact (the same move `recommendation` already made for "what to use instead"). `container` is required and is what a reader acts on either way: a kit component\'s own export name when `component` is filled, or a container outside the kit named as plainly as the reader will have to act on it when it is not. `component` is FILLED by the compiler from every other contract\'s accepted components, so the two directions of one nesting relationship cannot disagree - an overlay may not author it, and one that tries still fails the compile. `note` is authored for the outside-the-kit case: why no kit component fits, and what that container hands the component - a live instance, a render callback\'s arguments.',
      {
        type: 'object',
        properties: {
          container: {
            type: 'string',
            minLength: 1,
            description: 'What a reader acts on: a kit component\'s own export name (filled by the compiler alongside `component`), or a container outside the kit, named as plainly as the reader will have to act on it.',
          },
          component: componentReferenceRef(),
          note: {
            type: 'string',
            minLength: 1,
            description: 'Why the mount point is outside the kit, and what that container hands the component - a live instance, a render callback\'s arguments. Absent on a filled mount point: the container IS the explanation.',
          },
        },
        required: ['container'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'prop_deprecation',
      'UiKit prop deprecation',
      'One deprecated prop: when it was deprecated, the prop that replaces it, and what a caller has to do differently. All three are required - a deprecation without a replacement leaves the caller with no next move, which is the same failure a "don\'t" without an alternative has.',
      {
        type: 'object',
        properties: {
          since: { type: 'string', minLength: 1 },
          replacement: propNameRef(),
          hint: { type: 'string', minLength: 1 },
        },
        required: ['since', 'replacement', 'hint'],
        additionalProperties: false,
      },
    ),
    vocabularyType('deprecations', 'UiKit deprecations', "Everything about this component that is on its way out, keyed by the prop's own name.", {
      type: 'object',
      properties: {
        props: { type: 'object', additionalProperties: { $ref: vocabularyTypeId('prop_deprecation') } },
      },
      additionalProperties: false,
    }),
    vocabularyType(
      'attestation',
      'UiKit attestation',
      'The answer to one claim a contract makes about itself, plus who or what established it. "failed" (looked at, does not hold) and "unknown" (nobody looked) are different answers and may not collapse into one. `by` is optional and names a role, a suite or a primitive\'s own behaviour - never a person: a "verified" nothing attributes is a claim a later reader cannot re-check.',
      {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: ['verified', 'failed', 'unknown'] },
          by: {
            type: 'string',
            minLength: 1,
            description: 'What established the outcome: a test suite, a review, the behaviour the primitive underneath already guarantees. A role or an artifact, not a person.',
          },
        },
        required: ['outcome'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'prop_statement',
      'UiKit prop statement',
      'What one of this component\'s own properties states and why nothing checks it further - the retired `untyped` catch-all\'s `about: prop` category, keyed on the property itself instead of naming it inside a flat list. Required for every prop the schema does not state in full (partly typed, or description-only) and forbidden for one it states completely: a claim about a fully typed prop would be a claim about a different contract, the same pairing the old list was checked against, now over the overlay\'s `props` map and the property it is a key of.',
      {
        type: 'object',
        properties: {
          states: {
            type: 'string',
            minLength: 1,
            description: 'What the property actually holds, in the words a reader needs before the schema\'s own partial shape misleads them - an array of the caller\'s own generic parameter, a live object, a function.',
          },
          because: {
            type: 'string',
            minLength: 1,
            description: 'Why nothing checks it further: no JSON Schema shape for a generic, a live object, a function, or a type this contract has no business re-typing.',
          },
        },
        required: ['states', 'because'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'unexposed_part',
      'UiKit unexposed part',
      'Internal structure of the primitive underneath that the kit does not expose as a component of its own - a Header glued onto a Trigger inside one exported component. The other half of "what the kit deliberately does not offer" beside `withheld`: that field names a PROP the kit does not advertise, this names a PART.',
      {
        type: 'object',
        properties: {
          part: {
            type: 'string',
            minLength: 1,
            description: 'The internal part, named as plainly as the primitive underneath names it. Free text: checked against the primitive\'s own part list wherever a future extractor knows one, and nothing here yet does.',
          },
          reason: { type: 'string', minLength: 1 },
        },
        required: ['part', 'reason'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'invariant',
      'UiKit invariant',
      'One fact about the component that its props type never carries - internal state, a runtime relationship - stated with a stable id a lint finding or an eval can cite.',
      {
        type: 'object',
        properties: {
          id: invariantIdSchema(),
          text: { type: 'string', minLength: 1 },
        },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'anti_pattern',
      'UiKit anti-pattern',
      'One way this component gets misused, with the fix. `do_instead` (never `instead` - that word stays the recommendation of a DIFFERENT component in `dont_use_when`): the fix here stays inside this component\'s own API, which is the one-word-one-concept distinction the two fields draw.',
      {
        type: 'object',
        properties: {
          dont: { type: 'string', minLength: 1 },
          do_instead: { type: 'string', minLength: 1 },
        },
        required: ['dont', 'do_instead'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'example_pair',
      'UiKit example pair',
      'One canonical snippet: a title and the code. `why` is present on a counter-example (an `examples.bad` entry) and absent on one to copy (`examples.good`) - a counter-example without its reason teaches the shape, not the rule, so the container enforces `why` on the bad half on top of what this type states.',
      {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          code: { type: 'string', minLength: 1 },
          why: { type: 'string', minLength: 1 },
        },
        required: ['title', 'code'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'withheld_prop',
      'UiKit withheld prop',
      'One prop of the primitive underneath that the kit does not advertise, and why it is not. Both halves are required: the name is what the compiler checks against the extraction, and the reason is what tells a reader a deliberate omission from a forgotten one.',
      {
        type: 'object',
        properties: {
          prop: propNameRef(),
          reason: {
            type: 'string',
            minLength: 1,
            description: 'Why the kit does not advertise this prop: the component fact that makes offering it wrong, not a restatement of the name.',
          },
        },
        required: ['prop', 'reason'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'family_membership',
      'UiKit family membership',
      "Membership in a compound component's family (Accordion, its Item, Trigger and Content), when this component is one. Deliberately NOT expressed as a schema-level derivation (a part's props schema does not chain from the root's - an item does not inherit the root's props, and a closed parent would reject them as undeclared if it did): the relationship lives here, in the instance. The family is named by a TOKEN rather than by the root's identifier, so every member states its own membership instead of pointing at somebody else's contract, and `members` is filled by the compiler on the root from every contract naming the same family as a part - one root per family name, checked at compile time.",
      {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_]*$',
            description: 'The family\'s own token, shared by every member - `accordion` for Accordion and its three parts. Not an identifier: it names the family, which is not a type.',
          },
          role: { type: 'string', enum: ['root', 'part'] },
          members: {
            type: 'array',
            items: componentReferenceRef(),
            minItems: 1,
            description: 'Every part of this family, by reference. FILLED by the compiler on the root from every contract naming the same family as a part; an authored one is refused, and a part carries none.',
          },
        },
        required: ['name', 'role'],
        additionalProperties: false,
        if: { properties: { role: { const: 'root' } }, required: ['role'] },
        then: { required: ['name', 'role', 'members'] },
        else: { not: { required: ['members'] } },
      },
    ),
    vocabularyType(
      'slot',
      'UiKit slot',
      "A prop through which the consumer supplies content, declared at the component level as extension surface - a growth point named once instead of enumerating every prop a plugin author might touch (DataTable's `columns` accepts arbitrary third-party ColumnDefs, whose own render functions are opaque to a JSON Schema extractor regardless of how many are listed). Regardless of typeability: a slot is defined by what it IS (a prop the consumer supplies), not by whether the schema happens to be able to state its type.",
      {
        type: 'object',
        properties: {
          prop: propNameRef(),
          // Free text, not a reference: the governing type usually lives in
          // a third-party package this contract has no business re-typing.
          // Optional: present only when the schema cannot state the type in
          // full - a slot the schema DOES state completely still IS one, it
          // simply needs no prose pointer beside it.
          typed_by: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
        },
        required: ['prop', 'description'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'capability',
      'UiKit capability',
      'Something this component can do that a consumer turns on, with the prop that turns it on. Not a slot: the consumer supplies no value here, it flips a switch and the component does the rest - which is why the interesting fact is the enabling prop and `typed_by` has no place here at all, not even an optional one.',
      {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_]*$',
            description: 'The capability\'s own token - `row_selection`, not a sentence.',
          },
          enabled_by: propNameRef(),
          description: { type: 'string', minLength: 1 },
        },
        required: ['name', 'enabled_by', 'description'],
        additionalProperties: false,
      },
    ),
    vocabularyType(
      'companion',
      'UiKit companion',
      "An export beside the component that a consumer builds this component's input with - a column helper, a ready-made column, the feature set the component registers. Keyed by the export rather than by a prop, because that is what a consumer imports; the extractor generates no contract for it, since it is not a React component.",
      {
        type: 'object',
        properties: {
          export: exportNameSchema(),
          typed_by: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
        },
        required: ['export', 'typed_by', 'description'],
        additionalProperties: false,
      },
    ),
]);
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-vocabulary

// One built vocabulary type, by its concept token. The overlay schema needs
// two of them narrowed to the half an author may write, and taking the halves
// out of the built type is what keeps `name`, `role` and a container outside
// the kit defined exactly once.
function builtVocabularyType(token: string): Record<string, unknown> {
  const id = vocabularyTypeId(token);
  const type = buildVocabularyTypes().find((candidate) => candidate.$id === id);
  if (type === undefined) throw new Error(`no vocabulary type "${token}" - buildVocabularyTypes does not produce ${id}`);
  return type;
}

// The file name a vocabulary type is committed under: its own concept token
// and version, so the directory listing reads as the concept list. The
// namespace is dropped from the name rather than repeated in it - the
// directory the file sits in is already `vocabulary/`.
export function vocabularyTypeFileName(type: Record<string, unknown>): string {
  const bare = bareGtsId(String(type.$id));
  return `${bare.replace(`gts.${VENDOR_PACKAGE}.vocabulary.`, '').replace(/~$/, '')}.json`;
}

// The overlay vocabulary field by field: what each meaning field looks like,
// and which of them an author must write. ONE definition per field, taken by
// both readers - the x-gts-traits-schema the abstract type carries (what a
// validator checks a contract's meaning block against) and the overlay schema
// an author is held to - so the two can never silently disagree about what a
// field looks like. Most of them are a reference to the vocabulary type that
// owns the concept (buildVocabularyTypes above), so taking one is a copy of
// the reference rather than of the shape.
//
// `forwards_to` is here too, and is the one field an overlay may not write:
// which element a component forwards to is a fact of its source. It is listed
// outside `required` because a component that forwards to none has nothing to say.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-fields
export const buildTraitFields = memoizeSchema((): { properties: Record<string, Record<string, unknown>>; required: string[] } => ({
  properties: {
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
        items: { $ref: vocabularyTypeId('dont_use_when_rule') },
        minItems: 1,
        description:
          'A "don\'t" without an alternative leaves the agent with no next move, so every entry carries a recommendation: what to use instead in the words a reader acts on, plus the kit component to resolve when the kit ships one. At least one entry is required for the same reason: a component with nothing it should not be used for would be a modeling gap, not a fact worth leaving unstated.',
      },
      accepts: { $ref: vocabularyTypeId('accepted_content') },
      mounted_in: {
        type: 'array',
        items: { $ref: vocabularyTypeId('mount_point') },
        minItems: 1,
        description:
          'Where this component may be mounted. The component references here are FILLED by the compiler from every other contract\'s `accepts.components`, so the two directions of one nesting relationship cannot disagree; a container outside the kit is authored, because nothing in the kit knows about it. Absent entirely when there is neither - nothing in the kit mounts an Accordion, and an empty list would read as "may be mounted nowhere".',
      },
      invariants: {
        type: 'array',
        items: { $ref: vocabularyTypeId('invariant') },
      },
      anti_patterns: {
        type: 'array',
        items: { $ref: vocabularyTypeId('anti_pattern') },
        $comment: "`do_instead` here is prose about this component's own API, not a component type ref - the fix stays inside the component. `instead` stays the word for a DIFFERENT component (dont_use_when's recommendation).",
      },
      deprecations: { $ref: vocabularyTypeId('deprecations') },
      attestations: {
        type: 'object',
        additionalProperties: { $ref: vocabularyTypeId('attestation') },
        // Any key SHAPE passes here - a claim name is `^[a-z][a-z0-9_]*$`
        // like every other kit token - but whether the key is one of the
        // kit's OWN claim names is not something JSON Schema can check
        // against a registry, so that half of the rule is
        // assertKnownAttestationClaims below, at compile time: an unknown
        // claim fails the compile by name instead of compiling clean beside
        // a typo of a real one (`ally` next to `a11y`).
        propertyNames: { pattern: '^[a-z][a-z0-9_]*$' },
        required: [...loadAttestationClaims().required],
        description:
          "What this contract claims about itself, one entry per claim. `a11y` and `rtl` are the kit's own core claims and every component states both; a claim beyond those is present only when the component actually makes it - its absence means \"not claimed\", which is a different fact from an attestation whose outcome is `unknown` (\"considered, not established\"). Open beyond the two required keys by construction - the claim names are the kit's own and grow with it - which is why the attestation type is referenced from additionalProperties rather than from a fixed property list, and why no key inside it is reserved for anything else.",
      },
      // What each of THIS component's own properties states and why nothing
      // checks it further, keyed by the property itself - the dissolved
      // `untyped` catch-all's `about: prop` category, one level closer to
      // what it is about. A statement is required for every property the
      // schema does not state in full (partly typed or description-only) and
      // forbidden for one it states completely - checked by the conformance
      // suite (findUntypedPropMismatches), the same pairing the old list was
      // held to. `propertyNames` reuses the prop-name grammar because a key
      // here IS a prop name.
      props: {
        type: 'object',
        additionalProperties: { $ref: vocabularyTypeId('prop_statement') },
        propertyNames: { $ref: vocabularyTypeId('prop_name') },
        description:
          "What each property that reaches this contract asserting nothing (or only part of its shape) actually states, and why nothing checks it further - a generic, a function, a live object, a React node. Absent for a component whose whole surface the provider-safe subset can express, which no described component is today.",
      },
      // Internal structure of the primitive underneath that the kit does not
      // expose as a component of its own - the dissolved `untyped`
      // catch-all's `about: unexposed_part` category. The other half of
      // "what the kit deliberately does not offer" beside `withheld`: that
      // field names a PROP the kit does not advertise, this names a PART.
      unexposed_parts: {
        type: 'array',
        items: { $ref: vocabularyTypeId('unexposed_part') },
        minItems: 1,
        description:
          'Internal structure of the primitive underneath that this kit does not expose as a component of its own, each with why. Absent for a component that composes nothing hidden, which is most of the kit.',
      },
      examples: {
        type: 'object',
        properties: {
          good: {
            type: 'array',
            items: { $ref: vocabularyTypeId('example_pair') },
            minItems: 1,
          },
          bad: {
            type: 'array',
            items: {
              // `why` on top of what example_pair states: a counter-example
              // without its reason teaches pattern-matching, not the rule.
              allOf: [{ $ref: vocabularyTypeId('example_pair') }, { type: 'object', required: ['why'] }],
            },
            minItems: 1,
          },
        },
        required: ['good', 'bad'],
        additionalProperties: false,
      },
      family_membership: {
        $ref: vocabularyTypeId('family_membership'),
        description: 'Absent entirely for a component that is part of no family - Button, most of the kit.',
      },
      slots: {
        type: 'array',
        items: { $ref: vocabularyTypeId('slot') },
        minItems: 1,
        description:
          "Props through which the consumer supplies content, declared at the component level as the kit's own authored extension surface - regardless of whether the schema happens to be able to type them. Absent for a component with no such surface - Button, Accordion, most of the kit. The complement in x-uikit.partially_typed_props is the machine's own list of every property that asserts nothing (or only part of its shape), with the checker's printed type; this is the subset the kit deliberately declares as extension surface, which a consumer acts on.",
      },
      capabilities: {
        type: 'array',
        items: { $ref: vocabularyTypeId('capability') },
        minItems: 1,
        description: 'Behaviours a consumer turns on, each with the prop that turns it on. Absent for a component with nothing to turn on.',
      },
      companions: {
        type: 'array',
        items: { $ref: vocabularyTypeId('companion') },
        minItems: 1,
        description:
          "Exports beside the component that a consumer builds its input with. Absent for a component whose module exports nothing but the component itself, which is most of the kit.",
      },
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-withheld
      withheld: {
        type: 'array',
        description:
          "Props of the primitive underneath that this kit does not advertise, so they are left out of the contract's own properties - each with the reason it is not advertised, because a bare name leaves every later reader to rediscover why the prop is gone. Every `prop` is checked against the extracted prop list - a name the primitive no longer declares fails the compile rather than withholding nothing - and may not name a prop the component declares itself, which would be the overlay asking the compiler to drop what the source states. Absent for a component that advertises everything it forwards, which is most of them.",
        items: { $ref: vocabularyTypeId('withheld_prop') },
        minItems: 1,
      },
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-withheld
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-host
      forwards_to: {
        type: 'string',
        pattern: elementTypeRefPattern(),
        'x-gts-ref': ELEMENT_REF_TARGET,
        description:
          "GTS id of the hand-written surface for the host element this component forwards to. HELD as an id, not composed into the schema as a second parent: a contract derives from ONE type, the abstract component type, and a surface shared kit-wide by every component that forwards to the same element is not a second thing this component IS. Whoever needs the surface resolves it through this reference and applies it beside the contract; nothing in the props schema merges it in. `x-gts-ref` declares what the value must resolve to; `type` and `pattern` are what enforce it, because gts-ts strips x-gts-ref before validating. Absent entirely for a component that forwards to no host element of its own - DataTable, which renders its Table internally and correctly declares none.",
        $comment: "The element token, not the tag: `dom_button` for a <button>, normalized by domElementToken - the same token the committed file under scripts/contracts/elements/ is named by, so the reference and the file name are one identity. Named `forwards_to` rather than `host_element`: the value is the element surface the component FORWARDS TO, and a field named for the element read as a bug on a component (DataTable) that has one and declares none.",
      },
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-host
  },
  // Everything else is optional at every level: a component with no family, no
  // growth surface, no withheld prop and no mount point outside the kit
  // writes none of it.
  required: ['intent', 'typical_uses', 'dont_use_when', 'accepts', 'invariants', 'anti_patterns', 'deprecations', 'attestations', 'examples'],
}));
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-fields

// Stable kebab-case handle for an invariant. Inline rather than a local
// `$defs` entry: these definitions are lifted into base.component.json's
// x-gts-traits-schema, and a `#/$defs/...` pointer there would resolve
// against that document's root instead of the metamodel's.
function invariantIdSchema(): Record<string, unknown> {
  return {
    type: 'string',
    pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
    description: 'Stable kebab-case handle. Lint findings and evals cite it; never reused after removal.',
  };
}

// The metamodel schema, built from ids.ts rather than typed twice: the
// committed ui-component.meta.json is a generated copy of this object's
// JSON.stringify output, and the freshness check asserts the two never drift.
//
// A THIN record. The instance names the contract and carries nothing the
// contract already says: the meaning of a component is processing metadata of
// its type and lives in the type's own x-gts-traits, so an instance repeating
// it would be one fact in two documents. What is left is the identity, the
// vocabulary version, and the two references gts-ts resolves against a
// registry - which is what an instance is for.
export const buildMetamodel = memoizeSchema((): Record<string, unknown> => ({
    $id: `gts://${METAMODEL_TYPE_ID}~`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit component metamodel',
    description:
      "Shape of a component contract INSTANCE: a typed record naming the component's props schema and the surface of the host element it renders. Every <component>.contract.instance.json validates against this type, so the record's structure is enforced by the same validator that enforces component props instead of by prose. What the component MEANS is not here: it lives once, in the props schema's own x-gts-traits, and this document points at it rather than copying it. The props schema is a separate GTS type and is not described here either.",
    type: 'object',
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
          'Kit directory name under src/components/, or - for one export of a compound component - that export\'s own kebab-case stem, which shares the directory\'s name as a prefix (accordion-item lives in src/components/accordion/).',
      },
      // The two references gts-ts itself resolves against the registry: both
      // sit directly on an instance property, which is as deep as
      // XGtsRefValidator's own walk goes, so GTS.validateInstance fails an
      // instance whose props schema - or whose host-element surface - is not a
      // registered type (see the component contract suites). A reference held
      // inside the contract's own x-gts-traits is not reached by that walk and
      // is resolved by the conformance suite instead - which is why these two
      // are the only places in the whole schema set that keep the reference
      // triple inline rather than pointing at vocabulary/component_reference.v1.json
      // or vocabulary/prop_name.v1.json the way every nested one does: a `$ref`
      // here would hide `x-gts-ref` from the walk exactly as an x-gts-ref-only
      // oneOf branch does once gts-ts strips the keyword (componentRefSchema's
      // own comment above).
      props_schema: {
        type: 'string',
        pattern: componentTypeRefPattern(),
        'x-gts-ref': COMPONENT_REF_TARGET,
        description:
          "GTS id of the props schema this instance is about: the compiled JSON Schema carrying axes, defaults, normative props and, in its x-gts-traits, everything the component means. A derived-type id - the abstract base component type, then the component's own segment - so the reference also asserts that the props schema really is a child of the base and not a lookalike.",
        $comment: "Two segments of 5 dot-tokens each after the fixed `gts.` scheme prefix - the shape gts-ts's Gts.parseSegment accepts (vendor.package.namespace.type.vMAJOR).",
      },
      forwards_to: buildTraitFields().properties.forwards_to,
    },
    required: ['id', 'gts_type', 'metamodel', 'component', 'props_schema'],
    additionalProperties: false,
  }));

// Most x-gts-traits fields are optional in the overlay - a component with no
// family, no growth surface, no withheld prop and no mount point sets none of
// them. An x-gts-traits property still has to resolve when nothing in the
// chain provides it: GtsStore.validateSchemaTraits demands EVERY property
// x-gts-traits-schema declares have either a value or a schema `default`,
// regardless of this JSON Schema's own `required` list (that check runs
// before Ajv ever sees the data - see the "unresolved trait property" step in
// validateSchemaTraits). There is no honest non-null default for "this
// component's family membership" or "this component's slots", so the
// property's type gains `null` as an alternative and defaults to it. This
// does not weaken the real shape for a component that DOES set the field:
// `properties`, `required` and `minItems` are all instance-type-scoped
// keywords (JSON Schema applies them only to data of the matching type) and
// are vacuously satisfied by a `null` instance, so `family_membership`'s
// `if`/`then` and every `minItems: 1` still apply exactly as authored to real
// object/array data.
//
// A property that is nothing but a reference (`family_membership`) has no
// `type` of its own to widen: gts-ts merges a resolved reference in at the
// position of the `$ref` key, so a `type` added beside it depends on where in
// the object that assignment lands relative to `$ref` - key order load-bearing
// for a value gts-ts treats as unordered JSON. `anyOf: [{ $ref }, { type:
// "null" }]` says the same thing without relying on it: the value is either
// what the reference asserts or null, and which branch matched is not a
// question of what got written to the object first.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-nullable
function nullableGtsTraitsProperty(schema: Record<string, unknown>): Record<string, unknown> {
  const { $ref, ...siblings } = schema as { $ref?: string; [key: string]: unknown };
  if ($ref !== undefined) {
    return { ...siblings, anyOf: [{ $ref }, { type: 'null' }], default: null };
  }
  const type = schema.type;
  const widened = Array.isArray(type) ? [...type, 'null'] : type === undefined ? ['object', 'null'] : [type, 'null'];
  return { ...schema, type: widened, default: null };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-nullable
}

// The fields routed at one block, at runtime - the twin of FieldsFor above,
// and typed through it: the predicate is what lets a caller spread the result
// into that block's own object type, so a field moved to the WRONG block is a
// type error at the reversal point rather than one value silently winning
// over another. `x-uikit`'s own compiler-written keys (`partially_typed_props`,
// `variant_sources`, `cannot_extract`) used to collide by name with an
// authored SEMANTIC_FIELD (`slots` named both the machine's per-property
// record and the kit's own extension surface); the rename retired that
// specific collision, and this guard is what would catch the next one.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
function fieldsTargeting<Target extends SemanticTarget>(target: Target): FieldsFor<Target>[] {
  return SEMANTIC_FIELDS.filter((field): field is FieldsFor<Target> => SEMANTIC_FIELD_TARGETS[field] === target);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
}

// The x-gts-traits half of the metamodel: the SAME field definitions
// buildTraitFields defines for every field routed here (fieldsTargeting)
// plus the one the compiler writes, taken rather than re-typed by hand so
// the x-gts-traits-schema and the overlay-authoring schema can never silently
// disagree about what one of these fields looks like. Since most of those
// definitions are a reference to a vocabulary type (buildVocabularyTypes
// above), taking one is a copy of the reference, not of the shape - the two
// schemas resolve the same type through the same id. One mechanical
// adjustment on top, forced by gts-ts's trait machinery rather than chosen
// here: a field the metamodel does not require is wrapped nullable
// (nullableGtsTraitsProperty) so a component that has nothing to say there
// still resolves. base.component.json's x-gts-traits-schema is a generated copy
// of this function's output, checked against a fresh build by the freshness
// comparison, the same way ui-component.meta.json and the vocabulary types
// themselves are.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-gts-traits-schema:p1
export const buildGtsTraitsSchema = memoizeSchema((): Record<string, unknown> => {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-fields
  const fields = buildTraitFields();
  const definitions = fields.properties;
  const alwaysRequired = new Set(fields.required);
  const gtsTraitsFields = fieldsTargeting('x-gts-traits');
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-fields

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-fields
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of gtsTraitsFields) {
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-fields
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-ref
    const definition = definitions[field];
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-ref
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-nullable
    if (alwaysRequired.has(field)) {
      properties[field] = definition;
      required.push(field);
    } else {
      properties[field] = nullableGtsTraitsProperty(definition);
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-nullable
  }

  // The compiler-written x-gts-traits fields, taken from the same metamodel
  // definitions and always nullable: a component that renders no host element
  // of its own has nothing to say here, and validateSchemaTraits demands a
  // value or a default for every declared property.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-host
  for (const field of COMPILER_WRITTEN_TRAITS) {
    properties[field] = nullableGtsTraitsProperty(definitions[field]);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-host

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-return
  return {
    type: 'object',
    description:
      "Everything asserted about a component: what GTS.validateEntity checks a contract's x-gts-traits against (GtsStore.validateSchemaTraits, resolving this schema across the derivation chain from the abstract component type down to the component's own contract). Every field here is a claim somebody made - the overlay author for all but three, the compiler for the component references in `mounted_in`, a family root's `members` and `forwards_to`, each of which it fills from another author's assertion or from the source itself. What the SOURCE says lives in x-uikit instead, which no validator reads. A field whose shape another type owns is a REFERENCE to that vocabulary type (gts.frontx.uikit.vocabulary.*), so the concept is defined once, in one place, for both this schema and the metamodel; only a scalar, an array of strings, or a reference's own id/pattern stays inline (intent, typical_uses, and forwards_to itself - see componentRefSchema's comment for why that one keeps the reference triple rather than pointing at a vocabulary type). `forwards_to` is the one field an overlay may not write: which element a component forwards to is a fact of its source. additionalProperties: false so an unknown key fails GTS.validateEntity by name instead of vanishing silently.",
    properties,
    // Only the fields the overlay itself always requires (buildMetamodel's
    // own `required` list) are required here too - everything else is
    // optional at BOTH levels, resolved instead by
    // nullableGtsTraitsProperty's default above.
    required,
    additionalProperties: false,
  };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema:p2:inst-ts-return
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
    title: 'UiKit component',
    description:
      "The ONE type every kit component's props schema derives from, and the only one: a contract has a single parent, which is what its chained $id says, and the surface of the host element it forwards to is a reference it holds rather than a second parent. Deliberately a near-empty structural anchor: it fixes the entity kind (an object of props) and gives the derivation chain a root, and it declares NO properties - not even className, which the hand-written surface for each host element declares, because a type shared by Button and, say, a headless provider cannot assume a DOM element underneath. Its job is to be the thing a derived id chains from, so a component schema is a GTS derived type rather than a standalone schema that happens to look similar. `x-gts-abstract` says outright that it is never instantiated: no props object is ever validated against this type, only against a component's own derived one. It also carries the ONE thing every derived component contract must supply to be a complete GTS entity: x-gts-traits-schema, everything asserted about a component, which GTS.validateEntity checks the component's own x-gts-traits against. A field whose shape another type owns is a reference to that type (gts.frontx.uikit.vocabulary.*) rather than an inline definition; only intent, typical_uses and forwards_to stay inline - a sentence, a capped list of strings, and the one reference gts-ts's own walk must find directly on an instance property rather than behind a `$ref`. See the domain model in the package DESIGN for how they relate.",
    type: 'object',
    // Never instantiated: a props object is validated against a COMPONENT's
    // derived type, never against this one, which declares no properties at
    // all and would therefore accept anything. gts-ts 0.3.0 does not read the
    // key, so this is a statement to a reader and to whatever reads contracts
    // next rather than an enforcement - and the conformance suite is what
    // asserts that no derived contract carries it.
    'x-gts-abstract': true,
    $comment:
      "No additionalProperties/unevaluatedProperties here on purpose. gts-ts's validateSchemaAgainstParent rejects a derived schema that adds properties when the parent sets additionalProperties: false, and closing this type would mean every component had to restate it. A derived component type does not close itself either: its unevaluatedProperties carries an annotated open schema ({ \"x-uikit-classification\": \"unchecked\" }), so a prop nothing evaluates is admitted and classified as unchecked by whoever reads the props rather than rejected by Ajv, which cannot tell a typo'd kit prop from an attribute this harness has not classified yet.",
    'x-gts-traits-schema': buildGtsTraitsSchema(),
  }));

// The overlay's own schema: every meaning field the vocabulary defines
// (buildTraitFields above - the same definitions the abstract type's
// x-gts-traits-schema is built from, so an author and a validator are held to
// one shape), minus the one field the compiler writes, plus the contract major
// an author states. `additionalProperties: false` at every level is inherited
// from the vocabulary types' own closures rather than restated. An overlay
// that misspells a field, adds a machine-owned one under a different name, or
// tries to write JSON-Schema vocabulary (`type`, `required`) fails here by
// name instead of the field silently not making it into the compiled artifact.
export function buildOverlaySchema(): Record<string, unknown> {
  const fields = buildTraitFields();
  const properties: Record<string, unknown> = {};
  for (const field of SEMANTIC_FIELDS) properties[field] = fields.properties[field];
  // The two fields whose compiled shape carries entries the compiler fills:
  // an author writes only the other half, and the schema says so rather than
  // admitting the filled shape and leaving parseOverlay's refusal as the only
  // rule. Both halves are taken from the vocabulary types themselves, so a
  // container outside the kit and a family's name and role stay defined once.
  // `mount_point` now has one shape rather than two, so the authored half is
  // that same shape with `component` structurally excluded (additionalProperties
  // stays false, and `component` is simply not in `properties`) rather than a
  // separate type - parseOverlay's own early refusal still gives a friendlier
  // message than the resulting "unknown overlay key" would.
  const mountPointProperties = (builtVocabularyType('mount_point').properties ?? {}) as Record<string, unknown>;
  properties.mounted_in = {
    type: 'array',
    items: {
      type: 'object',
      properties: { container: mountPointProperties.container, note: mountPointProperties.note },
      required: ['container', 'note'],
      additionalProperties: false,
    },
    minItems: 1,
    description:
      "Containers outside the kit this component is mounted in. The component references in the compiled `mounted_in` are FILLED from every other contract's `accepts.components` and may not be authored - state the nesting in the container's own `accepts.components` instead.",
  };
  const familyProperties = (builtVocabularyType('family_membership').properties ?? {}) as Record<string, unknown>;
  properties.family_membership = {
    type: 'object',
    properties: { name: familyProperties.name, role: familyProperties.role },
    required: ['name', 'role'],
    additionalProperties: false,
    description:
      "Which family this component belongs to and its role in it. `members` is not authorable: the compiler fills it on the root from every contract naming the same family as a part.",
  };
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
    title: 'UiKit component overlay',
    description:
      "Shape of the hand-written overlay a contract compiles from: every field an author may state about a component, plus the contract major its identifiers carry. `forwards_to` is not among them, because which element a component forwards to is a fact of its source rather than a claim an author gets to make - and neither are the compiler-filled entries inside `mounted_in` and `family_membership`, which the field admits for the compiled artifact's sake and parseOverlay refuses on the authoring side.",
    type: 'object',
    properties: {
      component: {
        type: 'string',
        pattern: '^[a-z][a-z0-9-]*$',
        description:
          "Kit directory name under src/components/, or - for one export of a compound component - that export's own kebab-case stem, which shares the directory's name as a prefix (accordion-item lives in src/components/accordion/).",
      },
      ...properties,
    },
    required: ['component', ...fields.required],
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
// field the overlay left unset (family_membership, slots) is an own key
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
// not the x-gts-traits block.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-compose
export function compilePropsValidator(contract: CompiledContract): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true });
  addContractTypes(ajv);
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
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-element-surface:p1:inst-es-compose

// The validation half, over an already-compiled validator. Split out so the
// two schemas EVERY compile validates against - the metamodel for an
// instance, the x-gts-traits-schema for a contract's validator-read block - can be
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
const gtsTraitsValidator = memoizeValidator(() => buildGtsTraitsSchema());

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

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field
  // Two fields carry compiler-filled entries beside authored ones. The overlay
  // schema below already narrows both to the authored half, so these run
  // FIRST and for one reason: to answer with what fills the field and where
  // the fact belongs instead, rather than with "unknown key".
  //
  // A component reference in `mounted_in` is filled from every other
  // contract's `accepts.components`, so an authored one is a second writable
  // statement of one fact - the shape that let a part name a parent whose
  // accepted components did not name it back.
  const authoredMounts = isRecord(raw) && Array.isArray(raw.mounted_in) ? raw.mounted_in : [];
  for (const entry of authoredMounts) {
    if (!isRecord(entry) || !('component' in entry)) continue;
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field-refuse
    throw new Error(
      `${component}: overlay writes a component reference in mounted_in.component ("${String(entry.component)}"), which the ` +
        `compiler FILLS from every other contract's accepts.components - state the nesting in the parent's ` +
        `accepts.components instead, and keep an authored mounted_in entry to container + note, for a container ` +
        `outside the kit`,
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field-refuse
  }
  // A family root's `members` is filled from every contract naming the same
  // family as a part, for the same reason: membership is one statement each
  // member makes about itself.
  const authoredFamily = isRecord(raw) ? raw.family_membership : undefined;
  if (isRecord(authoredFamily) && 'members' in authoredFamily) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field-refuse
    throw new Error(
      `${component}: overlay writes family_membership.members, which the compiler FILLS on the root from every ` +
        `contract naming family "${String(authoredFamily.name)}" as a part - a part states its own membership, and ` +
        `the root reads the list back`,
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field-refuse
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-derived-field

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
// The stem's own directory-prefix check T5 adds: `component` on the overlay
// is validated against the stem by parseOverlay, but nothing there knows
// which directory the file was loaded FROM. A part overlay filed under the
// wrong directory (or a directory typo in the filename) would otherwise
// compile as if it were a top-level component. One function, applied both by
// the single-overlay load below and by the kit-wide walk, so the two cannot
// admit different files.
function assertStemBelongsToDirectory(directory: string, exportStem: string): void {
  if (exportStem === directory || exportStem.startsWith(`${directory}-`)) return;
  throw new Error(
    `${exportStem}: overlay stem does not belong to directory "${directory}" - a part's stem must equal ` +
      `the directory or start with "${directory}-"`,
  );
}

function loadOverlay(directory: string, exportStem: string = directory): Overlay {
  assertStemBelongsToDirectory(directory, exportStem);
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
// A missing overlay IS an error here, and by design: this reads the
// component's own overlay through loadOverlay, whose readFileSync throws
// ENOENT when the file is absent, so a caller asking for the major of a
// component that has no overlay is told so at that point rather than handed
// the default. The kit-wide walk is the reader that must not throw on one
// unreadable file, and it collects its own failures (collectOverlays) rather
// than coming through here.
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
    // The bare id, not the `gts://` URI form the contract's own $id carries:
    // an id-VALUED field holds an id, and gts-ts's reference validator
    // rejects the URI form outright (Gts.isValidGtsID).
    props_schema: componentTypeRef(exportStem, major),
    // The surface of the host element, held as an id exactly as the contract
    // holds it - the same reference, so the two halves of one artifact name
    // one surface. Undefined for a component that renders none.
    forwards_to: forwardsTo(extraction),
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
  partiallyTypedProps: CompiledContract['x-uikit']['partially_typed_props'];
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
// `withheld` names API props the kit does not advertise. They are still
// extracted - which is what lets the compiler reject a `withheld` entry naming
// nothing - and then left out: a component whose own stylesheet or usage
// document contradicts a primitive prop is not offering it, and a contract
// listing it would say the opposite.
export function buildPropsAndRequired(
  component: string,
  extraction: ComponentExtraction,
  elementSurface: Record<string, unknown>,
  withheld: readonly string[] = [],
): PropsAndRequired {
  const properties: Record<string, ContractProperty> = {};
  const partiallyTypedProps: PropsAndRequired['partiallyTypedProps'] = {};
  const required: string[] = [];
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
  const elementSurfaceTypes = elementSurfacePropertyTypes(elementSurface);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
  const withheldNames = new Set(withheld);

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axes
  const booleanAxes = new Set(extraction.booleanAxes);
  for (const [axis, values] of Object.entries(extraction.axes)) {
    // A cva axis keyed by `true`/`false` is a boolean prop - that is what
    // VariantProps types it as - so it is emitted as one. Compiled as the
    // string enum its keys look like, the contract stated a prop accepting
    // only the strings "true" and "false", which no caller can satisfy.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-boolean-axis
    const schema: ContractProperty = booleanAxes.has(axis) ? { type: 'boolean' } : { type: 'string', enum: values };
    const declaredDefault = extraction.defaults[axis];
    if (declaredDefault !== undefined) {
      schema.default = booleanAxes.has(axis) ? declaredDefault === 'true' : declaredDefault;
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-boolean-axis
    // An axis is a property of the same props object every other property
    // belongs to, so it is held to the same "one prop, one shape" rule: a
    // cva axis named `type` on a component rendering a <button> writes
    // `enum: [<its variants>]` beside the surface's own
    // `enum: ["submit","reset","button"]`, and a validator that resolves the
    // surface reference accepts only the intersection, normally empty.
    // Checked here rather than in the two prop loops alone, which is where
    // the axes used to slip past it.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    assertAgreesWithElementSurface(
      component,
      { name: axis, typeText: describeAxis(values, booleanAxes.has(axis)), expressed: schema },
      `${component}.tsx (cva axis)`,
      elementSurfaceTypes,
    );
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    properties[axis] = schema;
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-axes

  // PRECEDENCE, stated once for all three sources of a property: DECLARED >
  // AXIS > API. The three share one `properties` map and one `required`
  // list, so a name that reaches more than one of them has exactly one
  // answer, and each collision has its own reason:
  //  - declared over axis: the component's own props type is what a caller
  //    is compiled against, and a component that both derives an axis and
  //    re-declares its name is narrowing that axis deliberately (the
  //    declaration below simply overwrites the axis entry);
  //  - declared over API: the component's own declaration is the narrower
  //    one (`className?: string` over the primitive's
  //    `string | ((state) => string)`);
  //  - axis over API: an axis is the kit's own variant surface for that name
  //    and every axis is optional, because that is how VariantProps types
  //    one - so the API prop's shape and its requiredness both give way,
  //    which is the answer the API loop's guard below encodes.
  for (const prop of extraction.ownProps) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    assertAgreesWithElementSurface(component, underCheck(prop), `${component}.tsx`, elementSurfaceTypes);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    if (prop.expressed?.complete === true) {
      properties[prop.name] = { ...prop.expressed.schema };
    } else {
      // The schema does not state this prop's whole shape, so the shape is
      // checked by the lint and by tsc, not by Ajv - which is what a slot
      // record is. The property entry carries whatever the schema DID state
      // (`columns` is checkably an array) alongside the source type, so a
      // reader of `properties` gets both the part Ajv enforces and the part
      // it does not.
      partiallyTypedProps[prop.name] = { typeText: prop.typeText, optional: prop.optional };
      properties[prop.name] = {
        ...expressedSchemaOf(prop),
        description: `Slot: ${prop.typeText}. ${
          prop.expressed === undefined ? 'No JSON Schema type exists for it' : 'No JSON Schema type covers it beyond the kind above'
        }; shape checked by tsc, see x-uikit.partially_typed_props.`,
      };
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
    if (!prop.optional) required.push(prop.name);
  }

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-api
  for (const prop of extraction.apiProps) {
    if (withheldNames.has(prop.name)) continue;
    if (prop.name in properties) {
      // Either the component declares this name itself, or one of its cva
      // axes carries it, and the precedence rule above settles both: the
      // declaration is the narrower shape (`className?: string` over the
      // primitive's `string | ((state) => string)`), and an axis is the
      // kit's own variant surface for that name. Nothing to add either way,
      // and nothing left to reconcile in `required` - a declared prop
      // already pushed its own answer, and an axis is optional by
      // construction, so an API prop shadowed by one becomes optional here.
      // That is the answer, not an oversight: the props type a caller is
      // compiled against types the axis as optional too.
      continue;
    }
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    assertAgreesWithElementSurface(component, underCheck(prop), prop.declarationFile, elementSurfaceTypes);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // No partially_typed_props record: that map is scoped to props the
    // component DECLARES itself (freshness.ts's slotSchemaMismatches checks
    // exactly that scope), and a forwarded API prop the schema cannot type is
    // not one of those - its TypeScript type goes in the description, and
    // the overlay's `props` statement naming it is what a reader gets
    // instead of a second machine-readable copy.
    properties[prop.name] = describeUnexpressedType(expressedSchemaOf(prop), prop.typeText, prop.expressed?.complete === true);
    if (!prop.optional) required.push(prop.name);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-api

  required.sort();
  return { properties, required, partiallyTypedProps };
}

// How a cva axis reads when the conflict message has to name it: the shape
// VariantProps gives the prop, in the words a reader of the component's
// source will recognize.
function describeAxis(values: readonly string[], boolean: boolean): string {
  return boolean ? 'boolean' : values.map((value) => `"${value}"`).join(' | ');
}

// What the surface agreement is checked over, whichever side the name came
// from: a cva axis, a prop the component declares, or a prop of the
// primitive underneath. Only the name, the shape being written and the text
// for the message matter, so the check does not have to know which of the
// three it is looking at - which is how the axes came to be the one source
// it never saw.
interface PropertyUnderCheck {
  name: string;
  typeText: string;
  expressed?: ContractProperty;
}

// One prop, one shape. Where a property's name is also declared by the
// host element surface this contract names, a validator that resolves
// that reference applies both to the same value, so a disagreement is not a
// precedence question - it is a props object that can satisfy neither. Only an
// ASSERTING entry on the element side can disagree: an annotation-only one
// (`style`, `children`) states nothing to contradict, which is exactly why a
// Base UI component's state-function `style` composes cleanly over React's
// plain object.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
function assertAgreesWithElementSurface(
  component: string,
  prop: PropertyUnderCheck,
  declaredIn: string,
  elementSurfaceTypes: Map<string, ContractProperty | undefined>,
): void {
  const declared = elementSurfaceTypes.get(prop.name);
  if (declared === undefined) return;
  // Compared on what each side ASSERTS, not on whether the component's type
  // is stated in full: a prop the surface declares `array` and the component
  // types as an array of something Ajv cannot check agrees about the only
  // thing either of them enforces.
  const expressed = prop.expressed;
  const agrees =
    expressed !== undefined &&
    expressed.type === declared.type &&
    JSON.stringify(expressed.enum) === JSON.stringify(declared.enum);
  if (agrees) return;
  // Both shapes, spelled out: the message a reader acts on has to say what
  // the two sides each assert, not only that they differ.
  const mine = expressed === undefined ? 'nothing' : JSON.stringify({ type: expressed.type, enum: expressed.enum });
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict-refuse
  throw new Error(
    `${component}: prop "${prop.name}" declared "${prop.typeText}" in ${declaredIn} asserts ${mine} and conflicts ` +
      `with the element surface's ${JSON.stringify({ type: declared.type, enum: declared.enum })} - one prop, one ` +
      `shape, and the two disagree`,
  );
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict-refuse
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict

// The extracted-prop adapter: the two prop loops hold an ExtractedProp, and
// what the check needs off it is its name, its printed type and whatever the
// schema states about it.
function underCheck(prop: ExtractedProp): PropertyUnderCheck {
  return { name: prop.name, typeText: prop.typeText, expressed: prop.expressed?.schema };
}

// Every property of a compiled contract whose value Ajv will not fully
// check - a slot the kit declares, or an API prop of the primitive
// underneath whose type JSON Schema states only in part or not at all. What
// they have in common is the only thing that matters to a reader: passing
// validation here is not the same as being right, so the prop's real type
// has to be stated in prose and its existence acknowledged.
//
// Read off the prose rather than off the assertion keywords, because prose
// is exactly the compiler's record of that gap: describeUnexpressedType and
// the slot branch write a description when, and only when, JSON Schema did
// not state the whole type. A prop typed in full carries none.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-list
export function partlyCheckedPropertyNames(contract: CompiledContract): string[] {
  return Object.entries(contract.properties)
    .filter(([, schema]) => schema.description !== undefined)
    .map(([name]) => name)
    .sort();
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-list

// The pairing between those properties and the contract's own `props`
// statements, both ways. A property nothing asserts and nothing explains is
// the defect this pairing came from: an evaluation read three such
// properties out of a generated file and decided they took plain strings. A
// statement naming a property the schema states IN FULL is the mirror error
// - a reader told that `multiple` cannot be typed while the contract types
// it as a boolean has been told something false about the contract in front
// of them. A property the schema states only in part (`columns` is an
// array; what is in it, Ajv cannot say) belongs on the acknowledged side:
// the part nothing checks is the part a statement is owed for.
//
// Keyed on the property itself now (the dissolved `untyped` catch-all's
// `about: prop` category moved into the overlay's `props` map), which is
// what makes this checkable without reading a `about` discriminant first: a
// statement in `props` is BY CONSTRUCTION about a prop, since that is the
// only thing the map can be keyed on.
//
// Reported rather than thrown: this is a documentation gap, and a compile
// that refuses it would make a component uncompilable until its prose caught
// up, which is the wrong order. The conformance suite fails on it instead,
// in the run the author already executes.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-pair
export function findUntypedPropMismatches(contract: CompiledContract): string[] {
  const partlyChecked = new Set(partlyCheckedPropertyNames(contract));
  const named = new Set(Object.keys(contract['x-gts-traits'].props ?? {}));
  const problems: string[] = [];
  for (const name of [...partlyChecked].sort()) {
    if (!named.has(name)) {
      problems.push(`"${name}" is not fully checked by its schema but no props statement about it exists`);
    }
  }
  for (const name of [...named].sort()) {
    if (!partlyChecked.has(name)) {
      problems.push(`a props statement names "${name}", which the contract's properties state in full`);
    }
  }
  return problems;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-pair

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

// The overlay must only ever point at a prop the extractor actually found.
// Every prop-name-bearing field an overlay may write - `deprecations.props`
// keys, EVERY deprecation's own `replacement`, `accepts.icons_via`, every
// `withheld` entry, every key of `props`, every `slots` entry and every
// `capabilities` entry's `enabled_by` - checked here so every component gets
// the cross-check unconditionally rather than only the one whose test author
// remembered to write it. Every prop-name field's own description says the
// check happens here, in the compiler, not in a conformance test somewhere
// downstream - extend both this list and that description the next time the
// metamodel adds one.
//
// Which props count as real differs by field, and deliberately: the kit's own
// declared props and its variant axes are what a deprecation, an icon slot, a
// declared slot or a capability's switch can name, while `withheld` and a
// `props` key are about the primitive's API too, so they may name an API prop
// as well. A `withheld` entry naming a prop the kit itself declares would be
// the overlay asking the compiler to drop a prop the component's own source
// states, which is a different mistake and gets its own refusal.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop
export function assertOverlayReferencesRealProps(component: string, overlay: Overlay, extraction: ComponentExtraction): void {
  const declared = new Set([...Object.keys(extraction.axes), ...extraction.ownProps.map((prop) => prop.name)]);
  const api = new Set(extraction.apiProps.map((prop) => prop.name));
  const refuse = (message: string): never => {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
    throw new Error(`${component}: ${message}`);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop-refuse
  };

  for (const [prop, deprecation] of Object.entries(overlay.deprecations.props ?? {})) {
    if (!declared.has(prop)) refuse(`overlay deprecations.props references "${prop}", which is not a real prop`);
    if (!declared.has(deprecation.replacement)) {
      refuse(
        `overlay deprecations.props."${prop}".replacement references "${deprecation.replacement}", which is not a real prop - ` +
          `a deprecation whose replacement does not exist leaves the caller with no next move, which is the failure this field exists to prevent`,
      );
    }
  }
  const iconsVia = overlay.accepts.icons_via;
  if (iconsVia !== undefined && !declared.has(iconsVia)) {
    refuse(`overlay accepts.icons_via references "${iconsVia}", which is not a real prop`);
  }
  for (const slot of overlay.slots ?? []) {
    if (!declared.has(slot.prop)) refuse(`overlay slots references "${slot.prop}", which is not a real prop`);
  }
  for (const capability of overlay.capabilities ?? []) {
    if (!declared.has(capability.enabled_by)) {
      refuse(`overlay capabilities."${capability.name}".enabled_by references "${capability.enabled_by}", which is not a real prop`);
    }
  }
  for (const { prop } of overlay.withheld ?? []) {
    if (declared.has(prop)) {
      refuse(
        `overlay withholds "${prop}", which ${component}.tsx declares itself - withholding is for a prop of the primitive ` +
          `underneath that the kit does not advertise, not for the kit's own API`,
      );
    }
    if (!api.has(prop)) {
      refuse(
        `overlay withholds "${prop}", which the primitive underneath does not declare - withheld names are checked ` +
          `against the extracted prop list so a renamed or removed primitive prop fails here rather than silently ` +
          `withholding nothing`,
      );
    }
  }
  for (const prop of Object.keys(overlay.props ?? {})) {
    if (!declared.has(prop) && !api.has(prop)) {
      refuse(`overlay props references "${prop}", which is not a real prop`);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-absent-prop
}

// Where a component may be mounted, derived rather than authored. Every
// overlay in the kit is read and asked which components it accepts inside it;
// the ones accepting THIS component are its mount points.
//
// This is the direction the fact actually runs. An authored mount point was a
// claim about somebody else's contract - AccordionTrigger saying "I go inside
// AccordionItem" while AccordionItem's own accepted components were free to
// not mention triggers at all - so the pair could disagree and only a
// conformance test comparing them would notice. Filled, the two cannot
// disagree: there is one statement, `accepts.components`, and `mounted_in` is
// a view of it.
//
// Overlays, not compiled contracts: an overlay is the authored source, so a
// derivation taken from it is right even while a committed contract is stale,
// which is the state every recompile passes through. No TypeScript program is
// built - this is a directory listing and a YAML parse per described
// component.
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-structure-derivation:p1
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-structure-derivation:p1:inst-co-derive
export function deriveMountPoints(directory: string, exportStem: string): MountPoint[] {
  const self = componentTypeRef(exportStem, contractMajor(directory, exportStem));
  const selfToken = gtsToken(exportStem);
  const refPattern = new RegExp(componentTypeRefPattern(true));
  const mountPoints: MountPoint[] = [];
  // What an unreadable overlay would have to say to be one of this
  // component's containers: the reference segment every `accepts.components`
  // entry naming it carries, at any major - the stale-major refusal below
  // matches by name too, so a wrong major must still be seen.
  const namesSelf = `${VENDOR_PACKAGE}.component.${selfToken}.v`;
  for (const { directory: otherDirectory, stem, overlay } of usableOverlays([namesSelf], `${exportStem}: mount points`)) {
    if (stem === exportStem) continue;
    for (const accepted of overlay.accepts.components ?? []) {
      if (accepted === self) {
        // The CONTAINER's own export name and its own major, from the
        // container's own overlay: `container` is filled with the same text
        // a reader would already act on (the PascalCase export a reference
        // resolves to), and the reference carries the major the target
        // ships, so a component that moves its major moves every reference
        // to it - including the filled ones.
        mountPoints.push({ container: pascalCase(stem), component: componentTypeRef(stem, overlay.major ?? DEFAULT_CONTRACT_MAJOR) });
        continue;
      }
      // An accepted-components list naming this component at a major it no
      // longer ships is a stale reference, not a mount point that has gone
      // away. Matched by name and refused: moving a major is an edit to every
      // overlay naming the component, and dropping the filled mount point for
      // the ones left behind would hide exactly the edit the move demands.
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-structure-derivation:p1:inst-co-stale-major
      const named = refPattern.exec(accepted);
      if (named !== null && named[1] === selfToken) {
        throw new Error(
          `${exportStem}: ${otherDirectory}/${stem}.contract.yaml accepts "${accepted}" inside it, but ${exportStem} ` +
            `ships "${self}" - a reference carries the target's major, so moving a major means updating every ` +
            `overlay that names the component`,
        );
      }
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-structure-derivation:p1:inst-co-stale-major
    }
  }
  return mountPoints.sort((a, b) => (a.component ?? '').localeCompare(b.component ?? ''));
}

// The mount points an artifact carries: the filled component references plus
// whatever containers outside the kit the overlay stated. Absent entirely when
// there is neither - most of the kit is mounted anywhere, and an empty list
// would read as a constraint rather than as its absence. No filter needed on
// the authored half: parseOverlay already refuses an authored entry that
// carries `component`, so every entry `overlay.mounted_in` holds by the time
// this runs IS the outside-the-kit half.
export function compileMountedIn(directory: string, exportStem: string, overlay: Overlay): MountPoint[] | undefined {
  const points: MountPoint[] = [...deriveMountPoints(directory, exportStem), ...(overlay.mounted_in ?? [])];
  return points.length > 0 ? points : undefined;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-structure-derivation:p1:inst-co-derive

// One overlay file as it sits on disk, before anything has read it as YAML.
// The text travels with it because a file that fails to parse can still be
// asked, textually, whether it mentions a component - which is the only
// question left once it cannot be asked structurally.
export interface OverlaySource {
  directory: string;
  stem: string;
  path: string;
  text: string;
}

export interface OverlayFailure {
  directory: string;
  stem: string;
  path: string;
  message: string;
  text: string;
}

export interface OverlayWalk {
  overlays: { directory: string; stem: string; overlay: Overlay }[];
  failures: OverlayFailure[];
}

// Every overlay the kit ships, parsed, with the ones that would not parse
// collected instead of thrown. Both derivations that walk the kit - a
// component's mount points and a family's membership - sit on the compile
// path of every contract, so a throw from inside the walk made one
// half-written overlay for an unenrolled component fail every compile, every
// guard and every conformance suite in the package. A failure is raised by
// the caller, and only where it can actually change that caller's answer.
//
// Pure over the sources it is handed, so the collection and the scoping can
// be exercised without writing a file into src/components.
export function collectOverlays(sources: readonly OverlaySource[]): OverlayWalk {
  const overlays: OverlayWalk['overlays'] = [];
  const failures: OverlayFailure[] = [];
  for (const source of sources) {
    try {
      assertStemBelongsToDirectory(source.directory, source.stem);
      overlays.push({
        directory: source.directory,
        stem: source.stem,
        overlay: parseOverlay(source.stem, parseYaml(source.text) as unknown),
      });
    } catch (error) {
      failures.push({
        directory: source.directory,
        stem: source.stem,
        path: source.path,
        message: error instanceof Error ? error.message : String(error),
        text: source.text,
      });
    }
  }
  return { overlays, failures };
}

// Which unreadable overlays could have changed the answer a caller is
// computing. The test is textual on purpose: a file that does not parse
// cannot be asked what it declares, so the only honest question left is
// whether the text mentions the thing being derived - the component
// reference an `accepts.components` entry would carry, or the family token
// every member of a family names. Generous by construction, and that is the
// safe direction: a mention that turns out to be prose fails a compile whose
// author has to open the offending file either way, while a missed mention
// would be a derivation quietly computed over a file nobody could read.
export function overlayFailuresMentioning(failures: readonly OverlayFailure[], needles: readonly string[]): OverlayFailure[] {
  return failures.filter((failure) => needles.some((needle) => failure.text.includes(needle)));
}

function readOverlaySources(): OverlaySource[] {
  const componentsDir = join(kitRoot, 'src', 'components');
  const sources: OverlaySource[] = [];
  for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const stem of overlayStems(entry.name)) {
      const path = join(componentsDir, entry.name, `${stem}.contract.yaml`);
      sources.push({ directory: entry.name, stem, path, text: readFileSync(path, 'utf8') });
    }
  }
  return sources;
}

// Read once per process, not once per caller. Both derivations are called
// per compiled contract and one of them again per family member, so the
// directory listing, the YAML parse and the Ajv overlay validation were
// quadratic in the enrolled set; the walk is pure for the life of the
// process, exactly like the schema builders memoized the same way.
const eachOverlay = memoizeSchema((): OverlayWalk => collectOverlays(readOverlaySources()));

// Already-warned paths, so a kit-wide run reports an unreadable overlay once
// rather than once per component it did not affect.
const warnedOverlayFailures = new Set<string>();

// The overlays a derivation may use, with the failures that bear on it
// raised and the rest reported. `needles` is what "bears on it" means for
// this caller: the text an unreadable overlay would have to carry to have
// fed this component's output.
function usableOverlays(needles: readonly string[], derivation: string): OverlayWalk['overlays'] {
  const { overlays, failures } = eachOverlay();
  const blocking = overlayFailuresMentioning(failures, needles);
  if (blocking.length > 0) {
    throw new Error(
      `${derivation}: ${blocking.length} overlay(s) this derivation reads would not parse, and each of them names ` +
        `it:\n  ${blocking.map((failure) => `${failure.path}: ${failure.message}`).join('\n  ')}`,
    );
  }
  for (const failure of failures) {
    if (warnedOverlayFailures.has(failure.path)) continue;
    warnedOverlayFailures.add(failure.path);
    console.warn(`warning: ${failure.path} would not parse and was skipped - ${failure.message}`);
  }
  return overlays;
}

// Who belongs to one family, by the token every member names. The root and
// the parts come out separately because they are answered differently: a root
// carries the filled `members` list, and a part carries nothing but its own
// membership.
//
// Pure over the entries it is handed, so the one rule it enforces - a family
// name has at most one root - can be exercised without writing an overlay;
// familyRoster below applies it to what the kit ships. The other half of the
// rule, that a family declared by any member HAS a root, is a question about
// a component rather than about the roster and lives in
// compileFamilyMembership, which is where a root-less family is refused.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-structure-derivation:p1:inst-co-family
export interface FamilyRoster {
  name: string;
  root?: string;
  parts: string[];
}

export function buildFamilyRoster(
  name: string,
  entries: readonly { ref: string; stem: string; membership?: FamilyMembership }[],
): FamilyRoster {
  let root: { ref: string; stem: string } | undefined;
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.membership?.name !== name) continue;
    if (entry.membership.role === 'part') {
      parts.push(entry.ref);
      continue;
    }
    if (root !== undefined) {
      throw new Error(
        `family "${name}" has two roots, ${root.stem} and ${entry.stem} - a family is one root and its parts, so ` +
          `one of the two is a part, or the two are separate families and one of them needs its own name`,
      );
    }
    root = { ref: entry.ref, stem: entry.stem };
  }
  return { name, root: root?.ref, parts: parts.sort() };
}

// The same, over the overlays the kit ships. An unreadable overlay bears on
// this roster when its text carries the family's own token, because that is
// what a member states - and only then, so a half-written overlay for an
// unrelated component leaves the roster alone.
export function familyRoster(name: string): FamilyRoster {
  return buildFamilyRoster(
    name,
    usableOverlays([name], `family "${name}"`).map(({ stem, overlay }) => ({
      ref: componentTypeRef(stem, overlay.major ?? DEFAULT_CONTRACT_MAJOR),
      stem,
      membership: overlay.family_membership,
    })),
  );
}

// The family membership an artifact carries: the authored name and role, plus
// the members filled in on the root. A part carries no member list at all -
// it points at no sibling, and reading the family's whole shape is what the
// root is for.
export function compileFamilyMembership(exportStem: string, overlay: Overlay): FamilyMembership | undefined {
  const membership = overlay.family_membership;
  if (membership === undefined) return undefined;
  const roster = familyRoster(membership.name);
  if (roster.root === undefined) {
    throw new Error(
      `${exportStem}: family "${membership.name}" has no root - every member of a family names the same family, and ` +
        `exactly one of them is its root`,
    );
  }
  if (membership.role === 'part') return { name: membership.name, role: 'part' };
  if (roster.parts.length === 0) {
    throw new Error(
      `${exportStem}: family "${membership.name}" is a root with no parts - a compound component is a root and the ` +
        `parts that name it, so either the parts are missing their own family_membership or this component has no family`,
    );
  }
  return { name: membership.name, role: 'root', members: roster.parts };
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-structure-derivation:p1:inst-co-family

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
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-attestation-claims
  assertKnownAttestationClaims(exportStem, overlay);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-overlay-admission:p1:inst-oa-attestation-claims

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

  let elementSurface: Record<string, unknown> | undefined;
  // The id of that surface, bare: an id-VALUED field holds an id, and gts-ts's
  // reference validator rejects the URI form outright (Gts.isValidGtsID).
  let forwardsToId: string | undefined;
  if (extraction.forwardedProps.length > 0) {
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited
    if (!extraction.elementKind) {
      // Props forwarded to a host element, and no host element resolved for
      // them: the heritage walk gave up somewhere (its own `cannot_extract`
      // notes say where), and there is no honest schema to declare the
      // forwarded surface in. Refused rather than compiled without it - the
      // contract would then claim the component forwards nothing.
      throw new Error(
        `${exportStem}: ${extraction.forwardedProps.length} forwarded DOM prop(s) found (e.g. ` +
          `"${extraction.forwardedProps[0].name}") but no host element kind could be resolved from ` +
          `${directory}.tsx's props type - cannot say which element surface they belong to`,
      );
    }
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-orphan-inherited
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    elementSurface = loadElementSurface(extraction.elementKind);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-owner-conflict
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    forwardsToId = forwardsTo(extraction);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
  }

  const { properties, required, partiallyTypedProps } = buildPropsAndRequired(
    exportStem,
    extraction,
    elementSurface ?? { properties: {} },
    // Names only: what the props half needs is which props to leave out, and
    // each entry's reason travels to the reader in the validator-read block.
    (overlay.withheld ?? []).map((entry) => entry.prop),
  );

  // The overlay's own per-prop statements, emitted into that property's
  // description beside the TS:/Slot: text buildPropsAndRequired already
  // wrote - the dissolved `untyped` catch-all's `about: prop` category no
  // longer lives in a flat list read separately from the property it is
  // about; it is now IN the property's own description, where a reader of
  // `properties` finds it without a second lookup.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-emit
  for (const [name, statement] of Object.entries(overlay.props ?? {})) {
    const existing = properties[name];
    // No description to append to means one of two things: the name is not
    // a real prop (assertOverlayReferencesRealProps already refused that),
    // or it names a prop the schema states IN FULL - a statement about a
    // fully typed prop is forbidden, and findUntypedPropMismatches is what
    // reports that pairing failure. Either way, injecting prose here would
    // hide the mistake instead of surfacing it.
    if (existing?.description === undefined) continue;
    properties[name] = { ...existing, description: `${existing.description} ${statement.states} ${statement.because}` };
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-untyped-props:p1:inst-up-emit

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
  const uikitFields = fieldsTargeting('x-uikit');
  const gtsTraitsFields = fieldsTargeting('x-gts-traits');
  if (uikitFields.length + gtsTraitsFields.length !== SEMANTIC_FIELDS.length) {
    // Every meaning field must be routed exactly once. This only fires if
    // SEMANTIC_FIELD_TARGETS is edited to drop a field on the floor - a
    // config mistake worth failing loudly on rather than shipping a contract
    // silently missing part of its overlay.
    throw new Error(`${exportStem}: SEMANTIC_FIELD_TARGETS does not route every meaning field exactly once`);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
  const contract: CompiledContract = {
    $id: propsSchemaId(exportStem, overlay.major ?? DEFAULT_CONTRACT_MAJOR),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${pascalCase(exportStem)}`,
    type: 'object',
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    // One parent, always the base type. The host element's surface is named
    // as a value below (x-gts-traits.forwards_to), not composed in here.
    allOf: [{ $ref: BASE_TYPE_ID }],
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    properties,
    required,
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    unevaluatedProperties: OPEN_UNEVALUATED,
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
    // What the source says. Nothing here is authored, which is the whole of
    // the split between the two blocks.
    'x-uikit': {
      metamodel: METAMODEL_VERSION,
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
      partially_typed_props: partiallyTypedProps,
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-slots
      variant_sources: extraction.variantSourceLabels,
      cannot_extract: extraction.cannotExtract,
      ...pickFields(overlay, uikitFields),
    },
    // Everything asserted about the component: every authored field, with the
    // two the compiler fills from other authors' assertions overwriting what
    // the overlay may say about them, and the one it reads off the source.
    'x-gts-traits': {
      ...pickFields(overlay, gtsTraitsFields),
      mounted_in: compileMountedIn(directory, exportStem, overlay),
      family_membership: compileFamilyMembership(exportStem, overlay),
      // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
      forwards_to: forwardsToId,
      // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-close
    },
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-route
  };
  // M3: validated against buildGtsTraitsSchema() here, not only inside
  // whichever component's own test file happens to register it with a GTS
  // store - a future mismatch between this assembly and
  // buildGtsTraitsSchema()'s own field routing now fails every compile.
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-compilation:p1:inst-cc-return
  assertAgainstValidator(exportStem, 'x-gts-traits', gtsTraitsValidator(), contract['x-gts-traits']);
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
  mkdirSync(VOCABULARY_DIR, { recursive: true });
  for (const type of buildVocabularyTypes()) write(join(VOCABULARY_DIR, vocabularyTypeFileName(type)), type);
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
