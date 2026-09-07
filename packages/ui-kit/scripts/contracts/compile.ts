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
// The overlay itself is validated before it is trusted: an unknown key (a
// typo, a stray JSON-schema keyword like `type`/`required`) fails the
// compile by name instead of silently vanishing on merge, and a component
// that redeclares a passthrough-owned prop with a conflicting type fails
// instead of the passthrough type quietly winning. Both checks exist because
// the alternative - one field lost, one prop double-declared with two
// disagreeing types - is exactly the class of bug a generated contract exists
// to catch, and a compiler that could itself make it would be worse than no
// contract at all.
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

import { extractComponent, type Extraction } from './extract';
import {
  BASE_TYPE_ID,
  componentTypeRefPattern,
  CONTRACT_MAJOR,
  instanceId,
  instanceIdPattern,
  METAMODEL_TYPE_ID,
  METAMODEL_VERSION,
  PASSTHROUGH_TYPE_ID,
  propsSchemaId,
  propsSchemaIdPattern,
} from './ids';

export { BASE_TYPE_ID, PASSTHROUGH_TYPE_ID, propsSchemaId, instanceId };

export interface Examples {
  good: { title: string; code: string }[];
  bad: { title: string; code: string; why: string }[];
}

export interface Overlay {
  component: string;
  intent: string;
  // A handful of archetypal scenarios, not an exhaustive selection rule -
  // capped at 3 by the metamodel so the field stays a quick read rather than
  // growing into a second, competing definition of the component.
  typical_uses: string[];
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

// Which annotation block each semantic overlay field lands in. Every field
// maps to 'x-uikit' today; if the fields feeding GTS trait projections ever
// need their own keyword, moving one is an edit to this map, not a rewrite
// of how the annotation blob gets assembled (see fieldsTargeting/pickFields
// below).
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
] as const;

type SemanticField = (typeof SEMANTIC_FIELDS)[number];
type SemanticTarget = 'x-uikit' | 'x-gts-traits';

const SEMANTIC_FIELD_TARGETS: Record<SemanticField, SemanticTarget> = {
  intent: 'x-uikit',
  typical_uses: 'x-uikit',
  dont_use_when: 'x-uikit',
  composition: 'x-uikit',
  invariants: 'x-uikit',
  anti_patterns: 'x-uikit',
  deprecations: 'x-uikit',
  coverage: 'x-uikit',
  examples: 'x-uikit',
};

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
    // DOM/Base UI heritage clauses only - what the component actually
    // forwards to an element. A `VariantProps<...>` heritage clause is not
    // forwarding anything; it is where the component's own cva axes come
    // from, so it is reported separately below instead of alongside real
    // passthrough.
    passthrough: string[];
    // Heritage clauses of the shape `VariantProps<typeof ...>`: the source
    // of this component's own variant axes, not props it forwards.
    variant_sources: string[];
    cannot_extract: string[];
  } & Omit<Overlay, 'component'>;
}

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

// name -> declared JSON Schema `type`, for every prop the passthrough type
// owns. `undefined` for an annotation-only entry (onClick, children): there
// is nothing to compare a component's own declaration against, so those
// names are still treated as owned (skip the property) but never trigger the
// type-conflict check below.
function passthroughPropertyTypes(passthroughSchema: Record<string, unknown>): Map<string, string | undefined> {
  const properties = (passthroughSchema.properties ?? {}) as Record<string, { type?: string }>;
  return new Map(Object.entries(properties).map(([name, schema]) => [name, schema.type]));
}

// Machine-owned fields the overlay must not restate - one fact, one owner.
// `required`/`slots`/`type` are reserved for the same reason: they are
// either compiler output or a JSON-Schema keyword an author might type by
// habit, and either way the overlay writing one is a mistake worth naming
// specifically rather than folding into "unknown key".
const MACHINE_OWNED = ['axes', 'props', 'defaults', 'variants', 'required', 'slots', 'type'];

// Normative props stay inside the provider-safe JSON Schema subset; anything
// unrepresentable there (ReactNode slots, render props) is described in
// x-uikit instead of the schema body.
const NORMATIVE_TYPES: Record<string, ContractProperty> = {
  boolean: { type: 'boolean' },
  string: { type: 'string' },
};

// A TS union member's trailing `| undefined` (from an optional prop's
// `?:`-less but union-widened type text) does not change what the prop
// actually holds, so it is stripped before comparing against a passthrough
// property's JSON Schema `type` - otherwise every optional string prop would
// spuriously conflict with a required-looking passthrough entry.
function normalizeTypeText(typeText: string): string {
  return typeText.replace(/\s*\|\s*undefined\s*$/, '').trim();
}

// The metamodel schema, built from ids.ts rather than typed twice: the
// committed ui-component.meta.json is a generated copy of this object's
// JSON.stringify output, and a test asserts the two never drift (see
// button.contract.test.ts). Building it here, not reading it from disk,
// is what makes buildOverlaySchema below able to derive the overlay's
// vocabulary from the metamodel's authored fields instead of keeping a
// second, hand-maintained list.
export function buildMetamodel(): Record<string, unknown> {
  return {
    $id: `gts://${METAMODEL_TYPE_ID}~`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit component contract metamodel',
    description:
      'Shape of a component contract INSTANCE. The contract is itself a GTS-typed value: every <component>.contract.instance.json validates against this type, so the metamodel is enforced by the same validator that enforces component props instead of by prose. The props schema the instance points at (props_schema) is a separate GTS type and is not described here.',
    type: 'object',
    $defs: {
      component_type_ref: {
        type: 'string',
        pattern: componentTypeRefPattern(),
        description:
          'GTS type id of another kit component. Demo stand-in for x-gts-ref: production writes "x-gts-ref": "gts.frontx.uikit.component.*~" here, which resolves the target in the type registry and fails when no such type is registered. The pattern alone only checks grammar, so a grammatical id for a component that does not exist still needs the registry (in the demo: the directory-existence test).',
        $comment: 'GTS tokens are snake_case; kit directories are kebab-case (navigation_menu -> navigation-menu).',
      },
      prop_name: {
        type: 'string',
        pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
        description: 'Name of a prop declared by the component, not a type id. Checked against the extracted prop list by the conformance test.',
      },
      invariant_id: {
        type: 'string',
        pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
        description: 'Stable kebab-case handle. Lint findings and evals cite it; never reused after removal.',
      },
      coverage_verdict: {
        type: 'string',
        enum: ['verified', 'checked-no', 'not-described'],
        description: '"checked-no" (looked at, does not hold) and "not-described" (nobody looked) are different answers and may not collapse into one.',
      },
    },
    properties: {
      id: {
        type: 'string',
        pattern: instanceIdPattern(),
        description:
          "GTS instance id: this metamodel's type id, then the instance segment. The instance segment carries exactly 5 dot-tokens (frontx.uikit.component.<name>.v<n>).",
      },
      metamodel: {
        const: METAMODEL_VERSION,
        description:
          "Version of the overlay vocabulary the compiler emitted. Checked as a const, not a free string with minLength: a contract compiled against a different metamodel version must fail loudly, not pass silently with a stale value.",
      },
      component: {
        type: 'string',
        pattern: '^[a-z][a-z0-9-]*$',
        description: 'Kit directory name under src/components/.',
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
        items: {
          type: 'object',
          properties: {
            rule: { type: 'string', minLength: 1 },
            instead: { $ref: '#/$defs/component_type_ref' },
          },
          required: ['rule', 'instead'],
          additionalProperties: false,
        },
        minItems: 1,
        description:
          'A "don\'t" without a typed alternative leaves the agent with no next move, so `instead` is required and is a type id, not a display name. At least one entry is required for the same reason: a component with nothing it should not be used for would be a modeling gap, not a fact worth leaving unstated.',
      },
      composition: {
        type: 'object',
        properties: {
          children: {
            type: 'object',
            properties: {
              kinds: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                minItems: 1,
              },
              icons_via: { $ref: '#/$defs/prop_name' },
            },
            required: ['kinds'],
            additionalProperties: false,
          },
        },
        required: ['children'],
        additionalProperties: false,
      },
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
      deprecations: {
        type: 'object',
        properties: {
          props: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                since: { type: 'string', minLength: 1 },
                replacement: { $ref: '#/$defs/prop_name' },
                hint: { type: 'string', minLength: 1 },
              },
              required: ['since', 'replacement', 'hint'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      coverage: {
        type: 'object',
        additionalProperties: { $ref: '#/$defs/coverage_verdict' },
      },
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
      props_schema: {
        type: 'string',
        pattern: propsSchemaIdPattern(),
        description:
          'URI of the machine-owned half: the compiled JSON Schema carrying axes, defaults and normative props. Split so the semantic half stays readable and the props half stays a plain provider-safe schema. A derived-type id: the abstract base component type, then the component\'s own segment, so the pattern also asserts that the props schema really is a child of the base and not a lookalike.',
        $comment: "Two segments of 5 dot-tokens each after the fixed `gts.` scheme prefix - the shape gts-ts's Gts.parseSegment accepts (vendor.package.namespace.type.vMAJOR).",
      },
    },
    required: [
      'id',
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

// The overlay's own schema: the metamodel's authored fields (everything
// except id/metamodel/props_schema, which the compiler writes) with
// additionalProperties: false at every level - inherited from the
// metamodel's own nested closures, not restated. An overlay that misspells
// a field, adds a machine-owned one under a different name, or tries to
// write JSON-Schema vocabulary (`type`, `required`) fails here by name
// instead of the field silently not making it into the compiled artifact.
export function buildOverlaySchema(): Record<string, unknown> {
  const metamodel = buildMetamodel();
  const machineOwned = ['id', 'metamodel', 'props_schema'];
  const properties = { ...(metamodel.properties as Record<string, unknown>) };
  for (const key of machineOwned) delete properties[key];
  const required = (metamodel.required as string[]).filter((key) => !machineOwned.includes(key));

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'UiKit component contract overlay',
    description:
      "Shape of the hand-written overlay a contract compiles from - the metamodel's authored fields only. `id`, `metamodel` and `props_schema` are the compiler's own; an overlay may not write them.",
    type: 'object',
    $defs: metamodel.$defs,
    properties,
    required,
    additionalProperties: false,
  };
}

function compileOverlayValidator(): ValidateFunction<Overlay> {
  const ajv = new Ajv2020({ allErrors: true });
  return ajv.compile<Overlay>(buildOverlaySchema());
}

function formatOverlayErrors(component: string, errors: ErrorObject[] | null | undefined): string {
  const lines = (errors ?? []).map((err) => {
    if (err.keyword === 'additionalProperties') {
      const key = (err.params as { additionalProperty?: string }).additionalProperty ?? '(unknown)';
      return `unknown overlay key "${key}" at "${err.instancePath || '/'}"`;
    }
    return `"${err.instancePath || '/'}" ${err.message ?? 'is invalid'}`;
  });
  return `${component}: overlay failed validation:\n  ${lines.join('\n  ')}`;
}

// The overlay-validation half, split out from loadOverlay's file read so it
// can be exercised directly with an in-memory object: a malformed overlay is
// a compile error whether it came from disk or a test fixture, and testing
// it this way keeps the fixture next to the assertion instead of in a
// directory a reviewer has to go find.
export function parseOverlay(component: string, raw: unknown): Overlay {
  if (raw !== null && typeof raw === 'object') {
    const shadowed = MACHINE_OWNED.filter((key) => key in raw);
    if (shadowed.length > 0) {
      throw new Error(`${component}: overlay restates machine-owned field(s): ${shadowed.join(', ')}`);
    }
  }

  const validate = compileOverlayValidator();
  if (!validate(raw)) {
    throw new Error(formatOverlayErrors(component, validate.errors));
  }

  if (raw.component !== component) {
    throw new Error(
      `${component}: overlay "component" field is "${raw.component}", but the directory is "${component}" - the two must match`,
    );
  }

  return raw;
}

function loadOverlay(component: string): Overlay {
  const path = join(kitRoot, 'src', 'components', component, `${component}.contract.yaml`);
  const raw: unknown = parseYaml(readFileSync(path, 'utf8'));
  return parseOverlay(component, raw);
}

export function compileInstance(component: string): ContractInstance {
  const overlay = loadOverlay(component);
  return {
    id: instanceId(component, CONTRACT_MAJOR),
    metamodel: METAMODEL_VERSION,
    component,
    intent: overlay.intent,
    typical_uses: overlay.typical_uses,
    dont_use_when: overlay.dont_use_when,
    composition: overlay.composition,
    invariants: overlay.invariants,
    anti_patterns: overlay.anti_patterns,
    deprecations: overlay.deprecations,
    coverage: overlay.coverage,
    examples: overlay.examples,
    props_schema: propsSchemaId(component, CONTRACT_MAJOR),
  };
}

export interface PropsAndRequired {
  properties: Record<string, ContractProperty>;
  required: string[];
  slots: CompiledContract['x-uikit']['slots'];
}

// The machine-owned half of a component's props schema: cva axes, own
// props (typed where the provider-safe subset can express them, slots
// where it cannot) and which own props are required. Split out from
// compileContract so it can be unit-tested with a synthetic Extraction -
// in particular the passthrough type-conflict check, which needs no real
// component file to exercise.
export function buildPropsAndRequired(
  component: string,
  extraction: Extraction,
  passthroughSchema: Record<string, unknown>,
): PropsAndRequired {
  const properties: Record<string, ContractProperty> = {};
  const slots: PropsAndRequired['slots'] = {};
  const required: string[] = [];
  const passthroughTypes = passthroughPropertyTypes(passthroughSchema);

  for (const [axis, values] of Object.entries(extraction.axes)) {
    properties[axis] = { type: 'string', enum: values };
    if (extraction.defaults[axis] !== undefined) properties[axis].default = extraction.defaults[axis];
  }

  for (const prop of extraction.ownProps) {
    if (passthroughTypes.has(prop.name)) {
      const declaredType = passthroughTypes.get(prop.name);
      // `declaredType === undefined` means the passthrough entry is
      // annotation-only (onClick, children): nothing to compare against,
      // so the name still counts as owned but the type check is skipped.
      if (declaredType !== undefined && normalizeTypeText(prop.typeText) !== declaredType) {
        throw new Error(
          `${component}: prop "${prop.name}" declared "${prop.typeText}" in ${component}.tsx conflicts with the ` +
            `passthrough type's declared type "${declaredType}" (${PASSTHROUGH_TYPE_ID}) - one prop, one owner, ` +
            `and the two disagree`,
        );
      }
      // Declared by the passthrough type already - leave it there.
      continue;
    }
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
    if (!prop.optional) required.push(prop.name);
  }

  return { properties, required, slots };
}

function fieldsTargeting(target: SemanticTarget): SemanticField[] {
  return SEMANTIC_FIELDS.filter((field) => SEMANTIC_FIELD_TARGETS[field] === target);
}

// Builds an object from exactly the given keys of `source` - the routing
// primitive fieldsTargeting's map result feeds into. The single cast below
// is the standard "accumulator starts empty, ends up the right shape" cast:
// every assignment inside the loop is provably `T[K]` into `Pick<T, K>[K]`,
// there is just no way to spell "empty object that will become Pick<T, K>"
// without it.
function pickFields<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}

// A `VariantProps<typeof ...>` heritage clause is the source of this
// component's own cva axes, not a prop it forwards to an element - grouping
// it with real passthrough would tell a reader that `variant`/`size` are
// forwarded DOM attributes, which they are not.
function isVariantSource(heritageClause: string): boolean {
  return /^VariantProps</.test(heritageClause.trim());
}

export function compileContract(component: string): CompiledContract {
  const dir = join(kitRoot, 'src', 'components', component);
  const extraction: Extraction = extractComponent(join(dir, `${component}.tsx`));
  const overlay = loadOverlay(component);
  const passthroughSchema = loadPassthroughSchema();
  const { properties, required, slots } = buildPropsAndRequired(component, extraction, passthroughSchema);

  const uikitFields = fieldsTargeting('x-uikit');
  const gtsTraitsFields = fieldsTargeting('x-gts-traits');
  if (uikitFields.length + gtsTraitsFields.length !== SEMANTIC_FIELDS.length) {
    // Every semantic field must be routed exactly once. This only fires if
    // SEMANTIC_FIELD_TARGETS is edited to drop a field on the floor - a
    // config mistake worth failing loudly on rather than shipping a
    // contract silently missing part of its overlay.
    throw new Error(`${component}: SEMANTIC_FIELD_TARGETS does not route every semantic overlay field exactly once`);
  }
  if (gtsTraitsFields.length > 0) {
    // No field maps here yet (see the map above); the day one does, this
    // needs an 'x-gts-traits' block emitted alongside 'x-uikit' below.
    throw new Error(`${component}: x-gts-traits routing is not implemented yet, but is configured for: ${gtsTraitsFields.join(', ')}`);
  }

  return {
    $id: propsSchemaId(component, CONTRACT_MAJOR),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${component} contract`,
    type: 'object',
    allOf: [{ $ref: BASE_TYPE_ID }, { $ref: PASSTHROUGH_TYPE_ID }],
    properties,
    required,
    unevaluatedProperties: false,
    'x-uikit': {
      metamodel: METAMODEL_VERSION,
      ...pickFields(overlay, uikitFields),
      slots,
      passthrough: extraction.passthrough.filter((clause) => !isVariantSource(clause)),
      variant_sources: extraction.passthrough.filter(isVariantSource),
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
