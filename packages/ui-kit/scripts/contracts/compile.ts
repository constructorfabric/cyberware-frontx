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
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  BASE_TYPE_ID,
  componentTypeRefPattern,
  CONTRACT_MAJOR,
  instanceId,
  instanceIdPattern,
  METAMODEL_TYPE_ID,
  METAMODEL_VERSION,
  passthroughTypeId,
  propsSchemaId,
  propsSchemaIdPattern,
} from './ids';

export { BASE_TYPE_ID, passthroughTypeId, propsSchemaId, instanceId };

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
  'family',
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
  family: 'x-uikit',
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
    // What the component's own Props type literally extends, besides its
    // VariantProps heritage - readable labels (the heritage text plus the
    // declaration file the checker resolved it to), not consumed by any
    // validator. variant_sources is the complementary list: where this
    // component's own cva axes come from, not what it forwards.
    passthrough: string[];
    variant_sources: string[];
    cannot_extract: string[];
  } & Omit<Overlay, 'component'>;
}

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The hand-written normative types this compiler composes. Read from disk
// rather than inlined so the artifacts, the conformance test and Ajv all see
// one copy of each.
const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(SCHEMA_DIR, 'generated');

export function loadBaseSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, 'base.component.json'), 'utf8')) as Record<string, unknown>;
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
function passthroughPropertyTypes(passthroughSchema: Record<string, unknown>): Map<string, ContractProperty | undefined> {
  const properties = (passthroughSchema.properties ?? {}) as Record<string, ContractProperty>;
  return new Map(Object.entries(properties).map(([name, schema]) => [name, schema.type ? schema : undefined]));
}

// Machine-owned fields the overlay must not restate - one fact, one owner.
// `required`/`slots`/`type` are reserved for the same reason: they are
// either compiler output or a JSON-Schema keyword an author might type by
// habit, and either way the overlay writing one is a mistake worth naming
// specifically rather than folding into "unknown key".
const MACHINE_OWNED = ['axes', 'props', 'defaults', 'variants', 'required', 'slots', 'type'];

// A prop's normalized TypeScript text, classified into the provider-safe
// JSON Schema subset a validator can actually assert: boolean/string/number
// exactly, or a string literal union as an enum. Everything else - a
// function, ReactNode, an element, an object shape - has no JSON Schema
// representation and is annotation-only (see buildPropsAndRequired's slot
// branch and buildPassthroughSchema's else branch). One function, used by
// both a component's own props and its generated passthrough type, so the
// same TypeScript shape is always classified the same way regardless of
// which side of the own/inherited split it happens to land on.
function classifyProviderSafeType(typeText: string): ContractProperty | undefined {
  const normalized = normalizeTypeText(typeText);
  if (normalized === 'boolean' || normalized === 'string' || normalized === 'number') {
    return { type: normalized };
  }
  const enumValues = parseStringLiteralUnion(normalized);
  if (enumValues) return { type: 'string', enum: enumValues };
  return undefined;
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
// origin is a Base UI part rather than the tag itself.
export function buildPassthroughSchema(originKey: string, domTag: string, inheritedProps: ExtractedProp[]): Record<string, unknown> {
  const properties: Record<string, ContractProperty> = {};
  for (const prop of inheritedProps) {
    if (prop.name === 'key' || prop.name === 'ref') continue;
    if (prop.name.startsWith('aria-') || prop.name.startsWith('data-')) continue;
    properties[prop.name] = classifyProviderSafeType(prop.typeText) ?? {};
  }

  return {
    $id: passthroughTypeId(originKey),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${originKey} passthrough`,
    description: `The props a kit component forwards to an underlying <${domTag}> element (directly or through Base UI), generated from this component's inherited (non-own) props. A component schema $refs this from its allOf, so the props it merely forwards are EVALUATED - which is what lets the derived type close itself with unevaluatedProperties: false without rejecting className, aria-* or data-*. Keyed by the ORIGIN of the inherited props (a Base UI primitive part, or a plain DOM element type) rather than the DOM tag alone, so two components forwarding to the same tag through unrelated type surfaces never collide; two components genuinely wrapping the same origin share this file by construction. Regenerate with \`npm run contracts:compile -- <directory>\`; a stale copy fails the freshness check.`,
    type: 'object',
    properties,
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
    $comment:
      'Intentionally NOT closed (no unevaluatedProperties/additionalProperties): this is one of several in-place applicators a component composes, so it cannot know what the others contribute. Closure happens once, in the derived component type.',
  };
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
                // A component type ref (see component_type_ref) when the
                // child IS a kit component - typed the same way
                // dont_use_when.instead is, so a reader can resolve it and
                // the conformance test can check it exists - or the literal
                // "text" for the one non-component leaf content kind in use
                // today (Button's own overlay). Not an open string: a typo'd
                // ref would otherwise silently read as a content kind.
                items: { oneOf: [{ $ref: '#/$defs/component_type_ref' }, { const: 'text' }] },
                minItems: 1,
              },
              icons_via: { $ref: '#/$defs/prop_name' },
            },
            required: ['kinds'],
            additionalProperties: false,
          },
          // Only a compound component's part sets this: the root/item
          // kind(s) it is only ever mounted under. Optional and absent from
          // every other component's overlay - nothing about Button
          // constrains where it may appear.
          parent: {
            type: 'object',
            properties: {
              kinds: {
                type: 'array',
                items: { $ref: '#/$defs/component_type_ref' },
                minItems: 1,
              },
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
        properties: {
          // Reserved key: a fact the code cannot make true (a generic type
          // parameter, a part composed of two Base UI primitives) rather
          // than a verified/checked-no/not-described claim - see the
          // CoverageAssumption type this validates against in compile.ts.
          assumptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string', minLength: 1 },
                reason: { type: 'string', minLength: 1 },
              },
              required: ['claim', 'reason'],
              additionalProperties: false,
            },
          },
        },
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
      family: {
        type: 'object',
        description:
          "Membership in a compound component's family (Accordion, its Item, Trigger and Content), when this component is one. Deliberately NOT expressed as a schema-level derivation (a part's props schema does not chain from the root's - an item does not inherit the root's props, and a closed base would reject them as undeclared if it did): the relationship lives here, in the instance, and the conformance test checks that every ref resolves to a real compiled contract. Absent entirely for a component with no family - Button, most of the kit.",
        properties: {
          root: { $ref: '#/$defs/component_type_ref' },
          role: { type: 'string', enum: ['root', 'part'] },
          // Root-only: a part points at the root via `root` above and does
          // not restate its siblings.
          parts: {
            type: 'array',
            items: { $ref: '#/$defs/component_type_ref' },
            minItems: 1,
          },
        },
        required: ['root', 'role'],
        additionalProperties: false,
        if: { properties: { role: { const: 'root' } }, required: ['role'] },
        then: { required: ['root', 'role', 'parts'] },
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
  const path = join(kitRoot, 'src', 'components', directory, `${exportStem}.contract.yaml`);
  const raw: unknown = parseYaml(readFileSync(path, 'utf8'));
  return parseOverlay(exportStem, raw);
}

export function compileInstance(directory: string, exportStem: string = directory): ContractInstance {
  const overlay = loadOverlay(directory, exportStem);
  return {
    id: instanceId(exportStem, CONTRACT_MAJOR),
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
    props_schema: propsSchemaId(exportStem, CONTRACT_MAJOR),
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
  const passthroughTypes = passthroughPropertyTypes(passthroughSchema);

  for (const [axis, values] of Object.entries(extraction.axes)) {
    properties[axis] = { type: 'string', enum: values };
    if (extraction.defaults[axis] !== undefined) properties[axis].default = extraction.defaults[axis];
  }

  for (const prop of extraction.ownProps) {
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
    const normative = classifyProviderSafeType(prop.typeText);
    if (normative) {
      properties[prop.name] = normative;
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

// A component's directory is kebab-case; its exported name is PascalCase
// (navigation-menu -> NavigationMenu). This is the one place that mapping
// happens, so a file exporting several components picks the right one by
// the same rule compileContract's error message describes.
export function pascalCase(component: string): string {
  return component
    .split('-')
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join('');
}

// Finds the extraction for the export named by `exportStem` (button ->
// Button, accordion-item -> AccordionItem). `exportStem` defaults to
// `directory`: the ordinary case (one component per directory, named after
// it) resolves exactly as before T5. A compound directory's part passes its
// own stem - the .tsx file is still the directory's single source file
// (extractComponent already returns one ComponentExtraction per exported
// component in it, see extract.ts), only the SELECTION changes.
export function resolveTargetExtraction(directory: string, exportStem: string = directory): ComponentExtraction {
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
  return extraction;
}

export function compileContract(directory: string, exportStem: string = directory): CompiledContract {
  const extraction = resolveTargetExtraction(directory, exportStem);

  const unresolvedVariants = extraction.cannotExtract.filter((msg) => msg.startsWith('cva:'));
  if (unresolvedVariants.length > 0) {
    // A VariantProps heritage entry the extractor could not trace to a real
    // cva(...) call would otherwise compile silently with its axes simply
    // missing - the exact defect (F16) this compiler exists to catch, so it
    // fails the build instead of shipping a contract that lost information.
    throw new Error(`${exportStem}: ${unresolvedVariants.join('; ')}`);
  }

  const overlay = loadOverlay(directory, exportStem);

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
    passthroughSchema = buildPassthroughSchema(extraction.passthroughOrigin, extraction.passthroughKind, extraction.inheritedProps);
    passthroughRef = { $ref: passthroughTypeId(extraction.passthroughOrigin) };
  } else if (extraction.inheritedProps.length > 0) {
    // Inherited props exist but no origin could be resolved for them -
    // exactly the case a silent extractor would have dropped them in.
    throw new Error(
      `${exportStem}: ${extraction.inheritedProps.length} inherited prop(s) found (e.g. "${extraction.inheritedProps[0].name}") ` +
        `but no passthrough origin could be resolved from ${directory}.tsx's props type - cannot generate a ` +
        `passthrough type to declare them in`,
    );
  }

  const { properties, required, slots } = buildPropsAndRequired(
    exportStem,
    extraction,
    passthroughSchema ?? { properties: {} },
  );

  const uikitFields = fieldsTargeting('x-uikit');
  const gtsTraitsFields = fieldsTargeting('x-gts-traits');
  if (uikitFields.length + gtsTraitsFields.length !== SEMANTIC_FIELDS.length) {
    // Every semantic field must be routed exactly once. This only fires if
    // SEMANTIC_FIELD_TARGETS is edited to drop a field on the floor - a
    // config mistake worth failing loudly on rather than shipping a
    // contract silently missing part of its overlay.
    throw new Error(`${exportStem}: SEMANTIC_FIELD_TARGETS does not route every semantic overlay field exactly once`);
  }
  if (gtsTraitsFields.length > 0) {
    // No field maps here yet (see the map above); the day one does, this
    // needs an 'x-gts-traits' block emitted alongside 'x-uikit' below.
    throw new Error(`${exportStem}: x-gts-traits routing is not implemented yet, but is configured for: ${gtsTraitsFields.join(', ')}`);
  }

  return {
    $id: propsSchemaId(exportStem, CONTRACT_MAJOR),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${exportStem} contract`,
    type: 'object',
    allOf: passthroughRef ? [{ $ref: BASE_TYPE_ID }, passthroughRef] : [{ $ref: BASE_TYPE_ID }],
    properties,
    required,
    unevaluatedProperties: false,
    'x-uikit': {
      metamodel: METAMODEL_VERSION,
      ...pickFields(overlay, uikitFields),
      slots,
      passthrough: extraction.passthroughSources,
      variant_sources: extraction.variantSourceLabels,
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

// Every `*.contract.yaml` overlay directly in a directory - one for the
// ordinary case (button.contract.yaml), one per export for a compound
// component (accordion.contract.yaml, accordion-item.contract.yaml, ...).
// `.contract.ru.yaml` never matches this suffix (it ends in `.ru.yaml`, not
// `.contract.yaml`) - it is excluded on disk locally and must never be
// picked up as a normal overlay if it exists.
export function overlayStems(directory: string): string[] {
  const dir = join(kitRoot, 'src', 'components', directory);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.contract.yaml'))
    .map((name) => name.slice(0, -'.contract.yaml'.length))
    .sort();
}

function compileOne(directory: string, exportStem: string): void {
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
  console.log(`wrote ${out}`);
  console.log(`wrote ${instanceOut}`);
  if (extraction.passthroughOrigin && extraction.passthroughKind) {
    const passthroughSchema = buildPassthroughSchema(extraction.passthroughOrigin, extraction.passthroughKind, extraction.inheritedProps);
    mkdirSync(GENERATED_DIR, { recursive: true });
    const passthroughOut = join(GENERATED_DIR, `passthrough.${extraction.passthroughOrigin}.json`);
    writeFileSync(passthroughOut, `${JSON.stringify(passthroughSchema, null, 2)}\n`);
    console.log(`wrote ${passthroughOut}`);
  }
}

// CLI entry - skipped when the module is imported (e.g. by the conformance
// test). Takes a DIRECTORY, not one component: `npm run contracts:compile
// -- accordion` compiles every `*.contract.yaml` overlay directly under
// src/components/accordion/ (one for the ordinary single-overlay directory,
// several for a compound one) - there is no per-export CLI invocation,
// because a reviewer regenerating a compound component's contracts wants all
// of its parts refreshed together, not one at a time.
if (invokedDirectly()) {
  const [directory] = process.argv.slice(2);
  if (!directory) {
    console.error('Usage: npm run contracts:compile -- <directory>');
    process.exit(1);
  }
  const stems = overlayStems(directory);
  if (stems.length === 0) {
    console.error(`${directory}: no *.contract.yaml overlay found directly under src/components/${directory}/`);
    process.exit(1);
  }
  for (const stem of stems) compileOne(directory, stem);
}
