// Conformance: the compiled contract may never disagree with the code.
//
// assertContractFreshness (below) recompiles the contract from source and
// diffs it against the committed button.contract.json/.instance.json copy
// (freshness); everything else in this file compiles in-memory and checks
// the invariants that make the contract trustworthy: axes and defaults
// mirror the cva() call exactly, the overlay only references props that
// exist, and the $id obeys the GTS segment grammar.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GTS, parseGtsID } from '@globaltypesystem/gts-ts';
import type { SchemaObject } from 'ajv';
// Draft 2020-12 needs Ajv's 2020 build; the default `ajv` export only knows
// draft-07 and rejects the contract's $schema outright. No other option
// changes were needed: the metamodel sticks to standard keywords, so Ajv's
// default strict mode accepts it as is.
import Ajv2020 from 'ajv/dist/2020';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  BASE_TYPE_ID,
  buildMetamodel,
  buildPropsAndRequired,
  compileContract,
  compileInstance,
  loadBaseSchema,
  loadPassthroughSchema,
  parseOverlay,
  resolveTargetExtraction,
  type CompiledContract,
  type Overlay,
} from '../../../scripts/contracts/compile';
import type { ComponentExtraction } from '../../../scripts/contracts/extract';
import { componentTypeRefPattern, instanceIdPattern, METAMODEL_VERSION, passthroughTypeId } from '../../../scripts/contracts/ids';
import { assertContractFreshness, validateContractTraits } from '../../../scripts/contracts/testing';

// Freshness: the committed button.contract.json, button.contract.instance.json
// and generated/passthrough.base_ui_button.json must equal a fresh compile. Every
// other suite below compiles fresh in memory and never touches the committed
// copy, so this is the one check standing between "the code is right" and
// "what shipped is right" - see testing.ts.
assertContractFreshness('button');

const contract = compileContract('button');
const instance = compileInstance('button');
const baseSchema = loadBaseSchema();
const PASSTHROUGH_TYPE_ID = passthroughTypeId('base_ui_button');
const passthroughSchema = loadPassthroughSchema('base_ui_button');

// GTS ids are written here in URI form (`gts://...`), which is how a JSON
// Schema $id/$ref has to look; gts-ts strips that prefix before parsing or
// keying the store (store.normalizeSchema), so anything talking to the
// library gets the bare id.
const bareId = (id: string): string => id.replace(/^gts:\/\//, '');

// The contract is a derived type: it is only a complete schema once its
// parent and the shared passthrough type are resolvable, so every validator
// in this file is built through here. `ajv.compile` throws on an
// unresolvable $ref, which is itself part of the check - a typo in either
// ref fails the suite rather than validating against a truncated schema.
function compileValidator(): ReturnType<Ajv2020['compile']> {
  const ajv = new Ajv2020();
  // x-uikit and x-gts-traits are the kit's own annotation vocabulary (the
  // documentation half and the validator-read half - see compile.ts's
  // SEMANTIC_FIELD_TARGETS). Declaring both keeps Ajv's strict mode on for
  // every other keyword - the alternative, `strict: false`, would also
  // swallow a genuine typo like `unevaluatedProperites`, which is exactly
  // the class of mistake this schema exists to catch. Neither has a
  // `validate`/`code`, so neither asserts anything here: this Ajv instance
  // checks props, not traits - x-gts-traits is what GTS.validateEntity
  // checks against base.component.json's x-gts-traits-schema (see
  // validateContractTraits, testing.ts, and "button contract in a GTS
  // store" below).
  ajv.addKeyword({ keyword: 'x-uikit' });
  ajv.addKeyword({ keyword: 'x-gts-traits' });
  // base.component.json (added below) carries this one, not the component
  // schema itself - declared for the same reason: strict mode must not trip
  // over gts-ts's own annotation keyword while checking props.
  ajv.addKeyword({ keyword: 'x-gts-traits-schema' });
  ajv.addSchema(baseSchema);
  ajv.addSchema(passthroughSchema);
  return ajv.compile(contract);
}
const extraction = resolveTargetExtraction('button');
const metaSchema = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/contracts/ui-component.meta.json'), 'utf8'),
) as SchemaObject;

// Grammar of a GTS component type reference; the capture is the component
// token, snake_case where the kit directory is kebab-case. Built from
// ids.ts, the same module the metamodel's own patterns come from - a
// hand-copied regex here is exactly how a previous version of this pattern
// drifted from the metamodel's without either side noticing.
const COMPONENT_TYPE_REF = new RegExp(componentTypeRefPattern(true));

describe('button contract conformance', () => {
  it('mirrors every cva axis and value, both directions', () => {
    for (const [axis, values] of Object.entries(extraction.axes)) {
      expect(contract.properties[axis]?.enum).toEqual(values);
    }
    const enumProps = Object.entries(contract.properties).filter(([, schema]) => schema.enum !== undefined);
    expect(enumProps.map(([name]) => name).sort()).toEqual(Object.keys(extraction.axes).sort());
  });

  it('mirrors defaultVariants', () => {
    for (const [axis, def] of Object.entries(extraction.defaults)) {
      expect(contract.properties[axis]?.default).toBe(def);
    }
  });

  it('required is an array mirroring own props with optional:false', () => {
    // No fixture: derived from the same extraction the contract was built
    // from. Button has no required own props today (className, icon,
    // loading, focusableWhenDisabled are all optional), so this also proves
    // `required` is `[]`, not an absent field, when nothing is required.
    expect(Array.isArray(contract.required)).toBe(true);
    const expected = extraction.ownProps
      .filter((prop) => prop.name in contract.properties && !prop.optional)
      .map((prop) => prop.name)
      .sort();
    expect([...contract.required].sort()).toEqual(expected);
  });

  it('overlay references only props that exist in code', () => {
    const known = new Set([...Object.keys(extraction.axes), ...extraction.ownProps.map((prop) => prop.name)]);
    for (const prop of Object.keys(contract['x-gts-traits'].deprecations.props ?? {})) {
      expect(known, `deprecated prop "${prop}" is not a real prop`).toContain(prop);
    }
    const iconsVia = contract['x-gts-traits'].composition.children.icons_via;
    if (iconsVia !== undefined) {
      expect(known).toContain(iconsVia);
    }
  });

  it('carries a GTS derived type id the real parser accepts', () => {
    // Asserted with gts-ts rather than a local regex: the grammar belongs to
    // gts-ts, and a hand-rolled copy is exactly how the previous id came to
    // be ungrammatical without anything noticing. `gts://` is a URI prefix
    // the store strips before parsing, so it is stripped here too.
    const parsed = parseGtsID(bareId(contract.$id));
    expect(parsed.ok, parsed.error).toBe(true);
    // Two segments: the parent type, then this component's own. Each carries
    // 5 dot-tokens (vendor.package.namespace.type.vMAJOR) - the token count
    // Gts.parseSegment enforces, and the reason the base type is
    // `...base.component.v1~` rather than the one-token-shorter
    // `...component.v1~`, which parses as "Too few tokens".
    expect(parsed.segments.map((segment) => segment.segment)).toEqual([
      'frontx.uikit.base.component.v1~',
      'frontx.uikit.component.button.v1~',
    ]);
    for (const segment of parsed.segments) {
      expect(segment.isType, `${segment.segment} is not a type segment`).toBe(true);
    }
  });

  it('derives from the base component type, with the base as the parent ref', () => {
    // Chained id and schema body must agree on the parent: gts-ts reads the
    // FIRST $ref in allOf as the parent (store.findParentRef), and the id is
    // that parent's id plus this component's segment.
    expect(contract.allOf[0]).toEqual({ $ref: BASE_TYPE_ID });
    expect(contract.$id.startsWith(BASE_TYPE_ID)).toBe(true);
    expect(contract.allOf).toContainEqual({ $ref: PASSTHROUGH_TYPE_ID });
    expect(baseSchema.$id).toBe(BASE_TYPE_ID);
    expect(passthroughSchema.$id).toBe(PASSTHROUGH_TYPE_ID);
  });

  it('closes the kit surface with unevaluatedProperties, not additionalProperties', () => {
    // Not interchangeable: `additionalProperties` only sees its sibling
    // `properties` and would reject every prop reached through allOf/$ref,
    // so a correct <Button className="x" /> would fail. Asserted rather than
    // commented because the two keywords look alike in review.
    expect(contract.unevaluatedProperties).toBe(false);
    expect(contract).not.toHaveProperty('additionalProperties');
  });

  it('extraction reported nothing it could not read', () => {
    expect(extraction.cannotExtract).toEqual([]);
  });

  it('leaves passthrough-owned props to the passthrough type', () => {
    // `disabled` is never mentioned in button.tsx's own ButtonProps body -
    // it reaches the props type only through the Omit<ButtonPrimitive.Props,
    // 'className'> heritage, so it is inherited, and the passthrough type
    // owns it; the component schema must not carry a competing copy.
    const passthroughProps = Object.keys((passthroughSchema.properties ?? {}) as Record<string, unknown>);
    expect(passthroughProps).toContain('disabled');
    for (const prop of passthroughProps) {
      expect(Object.keys(contract.properties), `"${prop}" is declared twice`).not.toContain(prop);
    }
  });

  it('classifies className as an own prop, not passthrough - the kit narrows it everywhere', () => {
    // button.tsx redeclares `className?: string`, narrower than Base UI's
    // `string | ((state) => string)` union: this is a deliberate, kit-wide
    // convention (every component does it, see accordion.tsx), not an
    // accidental duplicate, so the checker's own-vs-inherited split (by
    // declaration file) is the correct signal here, not a defect to work
    // around with a hardcoded exception.
    expect(extraction.ownProps.map((p) => p.name)).toContain('className');
    expect(passthroughSchema.properties).not.toHaveProperty('className');
    expect(contract.properties.className).toEqual({ type: 'string' });
  });
});

describe('button props validation', () => {
  it('rejects a typo in a kit prop', () => {
    // The point of the derived type. `variannt` is evaluated by nothing -
    // not the component's own properties, not the base, not the
    // passthrough's aria-/data- patterns - so the closure catches it.
    const validate = compileValidator();
    expect(validate({ variannt: 'ghost' })).toBe(false);
  });

  it('rejects an unknown prop that merely looks plausible', () => {
    // Distinct from the typo case above: this name is not a near-miss of a
    // real kit prop, own or inherited - it is evaluated by nothing in the
    // derived schema, which is exactly what closure exists to catch.
    const validate = compileValidator();
    expect(validate({ tooltip: 'Delete' })).toBe(false);
  });

  it('accepts aria-*, data-* and className alongside valid kit props', () => {
    const validate = compileValidator();
    const props = {
      variant: 'ghost',
      size: 'sm',
      className: 'my-button',
      'aria-label': 'Delete item',
      'data-testid': 'delete-button',
    };
    expect(validate(props), new Ajv2020().errorsText(validate.errors)).toBe(true);
  });

  it('accepts inherited passthrough props - the surface F8 found closed off', () => {
    // Before T3's checker-based extraction, the hand-written passthrough
    // type only declared 7 props; everything else Base UI's ButtonProps and
    // React's ButtonHTMLAttributes actually carry - `name`, `form`, `render`,
    // `nativeButton` among them - was rejected by `unevaluatedProperties:
    // false` despite being a real, forwarded prop. The generated passthrough
    // type is built from the checker's own resolution of what button.tsx's
    // props type inherits, so all of these now validate.
    const validate = compileValidator();
    const props = {
      variant: 'default',
      name: 'confirm',
      form: 'checkout',
      render: () => null,
      nativeButton: true,
      title: 'Confirm the order',
    };
    expect(validate(props), new Ajv2020().errorsText(validate.errors)).toBe(true);
  });

  it('still rejects a value outside an axis enum', () => {
    // Closure is not the only assertion the schema carries; a real prop with
    // an impossible value has to fail too.
    const validate = compileValidator();
    expect(validate({ variant: 'plunger' })).toBe(false);
  });

  it('accepts a slot prop the schema cannot type', () => {
    // `icon` is a ReactNode: annotation-only in the schema, so closure lets
    // it through instead of rejecting correct usage.
    const validate = compileValidator();
    expect(validate({ icon: 'anything', 'aria-label': 'Delete' })).toBe(true);
  });
});

// A minimal overlay satisfying every metamodel constraint, used to isolate
// one failure at a time in the tests below - not Button's real overlay, so
// a change to button.contract.yaml can never make one of these tests fail
// for an unrelated reason.
const validOverlay: Overlay = {
  component: 'button',
  intent: 'Trigger a single action in the current context.',
  typical_uses: ['A one-off action with an immediate effect'],
  dont_use_when: [{ rule: 'Navigation between routes or pages', instead: 'gts.frontx.uikit.component.navigation_menu.v1~' }],
  composition: { children: { kinds: ['text'] } },
  invariants: [],
  anti_patterns: [],
  deprecations: {},
  coverage: {},
  examples: {
    good: [{ title: 'Minimal use', code: '<Button />' }],
    bad: [{ title: 'Minimal misuse', code: '<Button />', why: 'placeholder reason' }],
  },
};

describe('overlay and extraction safety', () => {
  it('accepts a well-formed overlay unchanged', () => {
    expect(parseOverlay('button', validOverlay)).toEqual(validOverlay);
  });

  it('rejects an overlay with an unknown key, naming the key and the component', () => {
    const withUnknownKey = { ...validOverlay, typo_field: 'nope' };
    expect(() => parseOverlay('button', withUnknownKey)).toThrow('typo_field');
    expect(() => parseOverlay('button', withUnknownKey)).toThrow('button');
  });

  it('rejects an overlay that restates a machine-owned field, by name', () => {
    // `variants` (plural, matching the cva config the compiler extracts) is
    // the exact typo F9 caught: an overlay author reaching for the wrong
    // key silently lost the field instead of failing to compile.
    const withMachineOwnedKey = { ...validOverlay, variants: {} };
    expect(() => parseOverlay('button', withMachineOwnedKey)).toThrow(/machine-owned field\(s\): variants/);
  });

  it('rejects an overlay whose component field does not match the directory', () => {
    const wrongComponent = { ...validOverlay, component: 'not-button' };
    expect(() => parseOverlay('button', wrongComponent)).toThrow(/"not-button".*"button"/s);
  });

  // A synthetic extraction, not a fixture component under src/components:
  // the passthrough-conflict check only needs a ComponentExtraction shape,
  // and this keeps the test next to the assertion instead of in a directory
  // a reviewer has to go find. `disabled` is chosen because it is a real
  // entry in Button's generated passthrough type (boolean, inherited from
  // React's ButtonHTMLAttributes) - `declarationFile` is irrelevant to
  // buildPropsAndRequired, so a placeholder is fine.
  function syntheticExtraction(ownProps: ComponentExtraction['ownProps']): ComponentExtraction {
    return {
      name: 'Button',
      axes: {},
      defaults: {},
      ownProps,
      inheritedProps: [],
      passthroughKind: 'button',
      passthroughOrigin: 'base_ui_button',
      passthroughSources: [],
      variantSourceLabels: [],
      cannotExtract: [],
    };
  }

  it('rejects a component prop whose type conflicts with the passthrough type, naming both locations', () => {
    const conflicting = syntheticExtraction([
      { name: 'disabled', optional: true, typeText: 'string', declarationFile: 'button.tsx' },
    ]);
    expect(() => buildPropsAndRequired('button', conflicting, passthroughSchema)).toThrow(
      /"disabled".*button\.tsx.*declared type "boolean"/s,
    );
  });

  it('leaves a passthrough prop alone when the declared types agree', () => {
    const agreeing = syntheticExtraction([
      { name: 'disabled', optional: true, typeText: 'boolean | undefined', declarationFile: 'button.tsx' },
    ]);
    const { properties, required } = buildPropsAndRequired('button', agreeing, passthroughSchema);
    expect(properties).not.toHaveProperty('disabled');
    expect(required).toEqual([]);
  });
});

describe('button contract instance', () => {
  it('validates against the component metamodel', () => {
    const ajv = new Ajv2020();
    const validate = ajv.compile(metaSchema);
    expect(validate(instance), ajv.errorsText(validate.errors)).toBe(true);
  });

  it('carries a grammatical GTS instance id', () => {
    expect(instance.id).toMatch(new RegExp(instanceIdPattern()));
  });

  it("carries the compiler's METAMODEL_VERSION, not a free-form string", () => {
    expect(instance.metamodel).toBe(METAMODEL_VERSION);
  });

  it('the committed ui-component.meta.json equals a fresh build from ids.ts', () => {
    // buildMetamodel() is what actually validates instances above
    // (metaSchema); this asserts the human-readable copy committed next to
    // it has not drifted - the failure mode T2 closes is a hand-edited
    // pattern string in the JSON file disagreeing with what ids.ts builds.
    expect(metaSchema).toEqual(buildMetamodel());
  });

  it('points at the props schema it was compiled with', () => {
    expect(instance.props_schema).toBe(contract.$id);
  });

  it('every dont_use_when alternative resolves to a component the kit ships', () => {
    // Demo stand-in for the registry existence check x-gts-ref performs:
    // grammar alone would happily accept an id nothing implements.
    // Non-emptiness itself is the metamodel's job (dont_use_when has
    // minItems: 1, checked by "validates against the component metamodel"
    // above) - asserting it again here would be the same fact with two
    // owners.
    for (const { rule, instead } of instance.dont_use_when) {
      const match = COMPONENT_TYPE_REF.exec(instead);
      if (match === null) {
        throw new Error(`dont_use_when "${rule}": "${instead}" is not a GTS component type id`);
      }
      const dir = join(process.cwd(), 'src/components', match[1].replace(/_/g, '-'));
      expect(
        existsSync(dir),
        `dont_use_when "${rule}" points at "${instead}", but no such component exists (${dir})`,
      ).toBe(true);
    }
  });

  it('every good example is syntactically valid TSX', () => {
    // Syntax only. Real CI runs these through a tsc program against the kit's
    // own declarations, which also catches a prop that does not exist or has
    // the wrong type; that needs the built .d.ts, so the demo stops at parse.
    for (const { title, code } of instance.examples.good) {
      const { diagnostics } = ts.transpileModule(code, {
        fileName: 'example.tsx',
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest },
      });
      const messages = (diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
      expect(messages, `good example "${title}" does not parse`).toEqual([]);
    }
  });

  it('every bad example says why it is bad', () => {
    expect(instance.examples.bad.length).toBeGreaterThan(0);
    for (const { title, why } of instance.examples.bad) {
      expect(why.trim(), `bad example "${title}" has no reason`).not.toBe('');
    }
  });
});

describe('button contract in a GTS store', () => {
  // Ajv above checks the schema as a schema. This checks it as a GTS type:
  // registering a schema is silent about whether its parent exists, so the
  // derivation chain would stay broken until something happened to
  // dereference it at runtime. GTS.validateEntity resolves the chain and
  // compares the derived overlay against the parent, which turns that into a
  // build-time failure.
  function registeredStore(): GTS {
    const gts = new GTS();
    gts.register(baseSchema);
    gts.register(passthroughSchema);
    gts.register(contract);
    return gts;
  }

  it('validates as a derived GTS type, and so does the passthrough type it composes', () => {
    // BASE_TYPE_ID is deliberately not checked here - see "the abstract base
    // type alone never resolves its own trait schema" below for why it
    // cannot pass this same call.
    const gts = registeredStore();
    for (const id of [PASSTHROUGH_TYPE_ID, contract.$id]) {
      const result = gts.validateEntity(bareId(id));
      expect(result.ok, `${id}: ${result.error}`).toBe(true);
      expect(result.entity_type).toBe('schema');
    }
  });

  it('fails when the parent type is not registered', () => {
    // Negative control for the check above: without it, a passing
    // validateEntity would prove nothing about whether the chain resolves.
    const gts = new GTS();
    gts.register(passthroughSchema);
    gts.register(contract);
    const result = gts.validateEntity(bareId(contract.$id));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Parent schema not found');
  });

  it('the abstract base type alone never resolves its own trait schema - a leaf must supply the values', () => {
    // base.component.json declares x-gts-traits-schema but carries no
    // x-gts-traits of its own: it is the abstract parent, not a component.
    // Validated by itself (no derived contract in the chain to supply real
    // values), GtsStore.validateSchemaTraits' "unresolved trait property"
    // check finds every required trait field (dont_use_when, composition,
    // deprecations, coverage) with neither a value nor a default, and fails.
    // Asserted here on purpose, not silently dropped from the loop above: a
    // component's OWN contract is the only place those values can come
    // from, which "validates x-gts-traits against base.component.json's
    // x-gts-traits-schema" below proves for the case that matters.
    const gts = new GTS();
    gts.register(baseSchema);
    const result = gts.validateEntity(bareId(BASE_TYPE_ID));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('required property');
  });

  it("validates x-gts-traits against base.component.json's x-gts-traits-schema", () => {
    // validateContractTraits (testing.ts) documents which gts-ts API this
    // goes through: GTS.validateEntity, which for a derived schema like this
    // one calls both GtsStore.validateSchemaAgainstParent (whose last step
    // is the private validateSchemaTraits - the merged-values-against-
    // effective-schema Ajv check) and GtsStore.validateEntityTraits (the
    // additionalProperties: false closure check).
    const result = validateContractTraits(contract);
    expect(result.ok, result.error).toBe(true);
  });

  it('rejects a contract whose x-gts-traits carries a malformed dont_use_when.instead', () => {
    // Negative control: PR #611 (item 6b) flagged that a broken trait block
    // registered silently under the old, undifferentiated x-uikit annotation
    // - nothing validated it. An `instead` that is not a grammatical GTS
    // component type id must now fail GTS.validateEntity with a traits
    // error instead of passing as an untyped string.
    const corrupted: CompiledContract = {
      ...contract,
      'x-gts-traits': {
        ...contract['x-gts-traits'],
        dont_use_when: [{ rule: 'placeholder', instead: 'not-a-gts-id' }],
      },
    };
    const result = validateContractTraits(corrupted);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/trait/i);
  });

  it('rejects a contract whose x-gts-traits carries an unknown trait key', () => {
    const corrupted = {
      ...contract,
      'x-gts-traits': { ...contract['x-gts-traits'], bogus_field: true },
    } as CompiledContract;
    const result = validateContractTraits(corrupted);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/trait/i);
  });
});
