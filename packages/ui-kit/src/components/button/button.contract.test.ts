// Conformance: the compiled contract may never disagree with the code.
//
// assertContractFreshness (below) recompiles the contract from source and
// diffs it against the committed button.contract.json/.instance.json copy
// (freshness); everything else in this file compiles in-memory and checks
// the invariants that make the contract trustworthy: axes and defaults
// mirror the cva() call exactly, the overlay only references props that
// exist, and the $id obeys the GTS segment grammar.
import { readFileSync } from 'node:fs';
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
  addContractTypes,
  ANNOTATION_KEYWORDS,
  assertOverlayReferencesRealProps,
  assertValidatesAgainst,
  BASE_TYPE_ID,
  buildMetamodel,
  buildOverlaySchema,
  buildPropsAndRequired,
  compileContract,
  compileInstance,
  compilePropsValidator,
  loadBaseSchema,
  loadElementSurface,
  OPEN_UNEVALUATED,
  parseOverlay,
  registerContractTypes,
  resolveTargetExtraction,
  CLASSIFICATION_KEY,
  partlyCheckedPropertyNames,
  type CompiledContract,
  type Overlay,
} from '../../../scripts/contracts/compile';
import type { ComponentExtraction } from '../../../scripts/contracts/extract';
import { classifyProps } from '../../../scripts/contracts/check-lib';
import { contractMajor } from '../../../scripts/contracts/compile';
import {
  bareGtsId,
  componentTypeRef,
  domElementToken,
  instanceIdPattern,
  METAMODEL_VERSION,
  elementTypeId,
  elementTypeRef,
} from '../../../scripts/contracts/ids';
import {
  applyContractTestTimeout,
  assertContractFreshness,
  registeredKitStore,
  resolveComponentRef,
  validateContractTraits,
} from '../../../scripts/contracts/testing';

// assertContractFreshness below builds a real TypeScript program - several
// seconds on a CI-class runner, comfortably under 5s locally - so only CI
// hits vitest's default test timeout. Must run before any describe()/it()
// in the file; see applyContractTestTimeout's own comment in testing.ts.
applyContractTestTimeout();

// Freshness: the committed button.contract.json and
// button.contract.instance.json must equal a fresh compile. Every other suite
// below compiles fresh in memory and never touches the committed copy, so
// this is the one check standing between "the code is right" and "what
// shipped is right" - see testing.ts.
assertContractFreshness('button');

const contract = compileContract('button');
// Everything Button MEANS, read where it is emitted: once, in the contract's
// own x-gts-traits. The instance names this contract and repeats none of it.
const meaning = contract['x-gts-traits'];
const instance = compileInstance('button');
const baseSchema = loadBaseSchema();
// The element Button renders, and the hand-written type for it - shared with
// AccordionTrigger and with every future component that renders a <button>,
// which is why it is committed once under scripts/contracts/elements/
// rather than derived per component.
const ELEMENT_TYPE_ID = elementTypeId(domElementToken('button'));
const elementSurface = loadElementSurface('button');

// A schema keyword ($id, $ref) carries the URI form `gts://...`; gts-ts
// strips it before parsing or keying the store (store.normalizeSchema), so
// anything talking to the library gets the bare id - bareGtsId (ids.ts) is
// the one place that conversion lives.

// The props validator every "props validation" test below uses: the harness's
// own (compile.ts's compilePropsValidator), which resolves the surface this
// contract NAMES and applies it beside the contract. The composition is the
// harness's job rather than this file's, so the one place a contract and its
// host element's surface meet is the same one every other reader goes
// through.
function compileValidator(): ReturnType<Ajv2020['compile']> {
  return compilePropsValidator(contract);
}
const extraction = resolveTargetExtraction('button');
const metaSchema = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/contracts/ui-component.meta.json'), 'utf8'),
) as SchemaObject;

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

  it('required mirrors every declared and API prop the extraction reported as non-optional', () => {
    // No fixture: derived from the same extraction the contract was built
    // from, and over BOTH prop sets - an API prop of the primitive underneath
    // reaches `properties` on the same footing as a declared one, so it
    // reaches `required` the same way. Button has none today (className,
    // icon, loading, focusableWhenDisabled, nativeButton, render and style
    // are all optional), so this also proves `required` is `[]`, not an
    // absent field, when nothing is required.
    expect(Array.isArray(contract.required)).toBe(true);
    const expected = [...extraction.ownProps, ...extraction.apiProps]
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
    const iconsVia = contract['x-gts-traits'].accepts.icons_via;
    if (iconsVia !== undefined) {
      expect(known).toContain(iconsVia);
    }
  });

  it('carries a GTS derived type id the real parser accepts', () => {
    // Asserted with gts-ts rather than a local regex: the grammar belongs to
    // gts-ts, and a hand-rolled copy is exactly how the previous id came to
    // be ungrammatical without anything noticing. `gts://` is a URI prefix
    // the store strips before parsing, so it is stripped here too.
    const parsed = parseGtsID(bareGtsId(contract.$id));
    expect(parsed.ok, parsed.error).toBe(true);
    // Two segments: the parent type, then this component's own. Each carries
    // 5 dot-tokens (vendor.package.namespace.type.vMAJOR) - the token count
    // Gts.parseSegment enforces, and the reason the base type is
    // `...base.component.v1~` rather than the one-token-shorter
    // `...component.v1~`, which parses as "Too few tokens". `ui` is the
    // namespace both segments share; the type token is `component` for the
    // abstract parent and the component's own name for the derived type, so
    // neither repeats the word `component` nor carries a hierarchy word.
    expect(parsed.segments.map((segment) => segment.segment)).toEqual([
      'frontx.uikit.base.component.v1~',
      'frontx.uikit.component.button.v1~',
    ]);
    for (const segment of parsed.segments) {
      expect(segment.isType, `${segment.segment} is not a type segment`).toBe(true);
    }
  });

  it('derives from the abstract component type alone, and NAMES its host element surface', () => {
    // Chained id and schema body must agree on the parent: gts-ts reads the
    // FIRST $ref in allOf as the parent (store.findParentRef), and the id is
    // that parent's id plus this component's segment. Whether the COMMITTED
    // base.component.json's own $id equals BASE_TYPE_ID is N5's concern, not
    // this test's: assertContractFreshness's baseSchemaDiff (testing.ts)
    // already checks that centrally, byte-for-byte against buildBaseSchema(),
    // for every component that calls it - a second, narrower literal check
    // here would just be the same fact with two owners.
    //
    // One entry, not two: the surface of the <button> Button renders used to
    // sit here as a second parent, which said Button IS two things. It is a
    // reference the contract holds instead - the same id, bare, because an
    // id-valued field holds an id - and the surface it resolves to is what
    // the file itself declares.
    expect(contract.allOf).toEqual([{ $ref: BASE_TYPE_ID }]);
    expect(contract.$id.startsWith(BASE_TYPE_ID)).toBe(true);
    expect(contract['x-gts-traits'].host_element).toBe(bareGtsId(ELEMENT_TYPE_ID));
    expect(instance.host_element).toBe(bareGtsId(ELEMENT_TYPE_ID));
    expect(elementSurface.$id).toBe(ELEMENT_TYPE_ID);
  });

  it('leaves the surface open with an annotated classification rather than closing it', () => {
    // `unevaluatedProperties: false` answered "invalid" to two different
    // things - a typo'd kit prop and a name this harness has not classified
    // yet - and only the first is a mistake. The schema admits both and
    // annotates the classification; classifyProps is what tells them apart (see
    // "the props-classification report" below). `additionalProperties` was never
    // an option here for a different reason: it only sees its sibling
    // `properties`, so it would reject every forwarded attribute the moment a
    // validator composed the host element's surface in beside the contract.
    expect(contract.unevaluatedProperties).toEqual(OPEN_UNEVALUATED);
    expect(contract.unevaluatedProperties[CLASSIFICATION_KEY]).toBe('unchecked');
    expect(contract).not.toHaveProperty('additionalProperties');
  });

  it('extraction reported nothing it could not read', () => {
    expect(extraction.cannotExtract).toEqual([]);
  });

  it('files a React DOM attribute as forwarded surface and a Base UI part prop as this component\'s API', () => {
    // The filing rule, on the two props that make it visible. `disabled` is
    // declared by React's ButtonHTMLAttributes: it is the same attribute for
    // every component that renders a <button>, so it belongs to the element
    // surface and not to this contract. `nativeButton` is declared by Base
    // UI's own props for its Button part: it is Button's API, wearing Base
    // UI's declaration site as an accident of how the kit wraps it, so it
    // belongs in `properties` - filed as forwarded surface it was one of 233
    // entries in a generated file nobody read.
    expect(extraction.forwardedProps.map((p) => p.name)).toContain('disabled');
    expect(elementSurface.properties).toHaveProperty('disabled');
    expect(contract.properties).not.toHaveProperty('disabled');

    expect(extraction.apiProps.map((p) => p.name)).toContain('nativeButton');
    expect(contract.properties.nativeButton).toEqual({ type: 'boolean' });
  });

  it('gives an API prop the schema cannot type its TypeScript type, not an empty schema', () => {
    // The measured defect: an agent shown three unconstrained properties
    // concluded they took plain strings. `render` is a union of a React
    // element and a callback, so nothing can be asserted about it - what a
    // reader gets instead is the checker's own printed type.
    expect(contract.properties.render.type).toBeUndefined();
    expect(contract.properties.render.description).toMatch(/^TS: .*Not expressible in JSON Schema, checked by tsc\.$/s);
    expect(contract.properties.render.description).toContain('ComponentRenderFn');
  });

  it('records only the kit\'s own slotted props in x-uikit.slots, not every partly checked property', () => {
    // Two kinds of property go unchecked by the schema, and they are
    // documented in different places: `icon` is the kit's own slot and its
    // type lives in x-uikit.slots, while `render`/`style` are the
    // primitive's API and their types live in their own descriptions plus an
    // untyped_prop assumption. Both are named by the assumption pairing (see
    // testing.ts); only the first is a slot.
    expect(partlyCheckedPropertyNames(contract)).toEqual(['icon', 'render', 'style']);
    expect(Object.keys(contract['x-uikit'].slots)).toEqual(['icon']);
  });

  it('classifies className as a declared prop, and keeps the narrower declaration', () => {
    // button.tsx redeclares `className?: string`, narrower than Base UI's
    // `string | ((state) => string)` union: this is a deliberate, kit-wide
    // convention (every component does it, see accordion.tsx), not an
    // accidental duplicate. The element surface declares `className` too, as
    // a plain string - the two agree, and the component's own declaration is
    // what the contract carries.
    expect(extraction.ownProps.map((p) => p.name)).toContain('className');
    expect(elementSurface.properties).toHaveProperty('className');
    expect(contract.properties.className).toEqual({ type: 'string' });
  });
});

describe('button props validation', () => {
  it('admits a typo in a kit prop rather than rejecting it', () => {
    // Deliberate, and the reason `unevaluatedProperties` is open: Ajv cannot
    // tell `variannt` from a React attribute this harness has not classified,
    // and answering "invalid" to both made the second unusable. The
    // classification of `variannt` is made by classifyProps below, which can see that
    // `variant` exists.
    const validate = compileValidator();
    expect(validate({ variannt: 'ghost' })).toBe(true);
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

  it('accepts the element surface and the primitive API side by side', () => {
    // `name`/`form`/`title` come from the hand-written <button> surface,
    // `render`/`nativeButton` from Base UI's own props for its Button part
    // and so from this contract's own properties. A consumer passing both at
    // once is the ordinary case, and the two halves have to compose.
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

  it('rejects a value the element surface does type, once the surface is composed in', () => {
    // The element surface is not decoration: `type` on a <button> is one of
    // three values, and a fourth fails even though the prop itself is
    // forwarded rather than declared by the kit. It fails through the
    // COMPOSITION - the validator resolved the reference the contract holds
    // and applied the surface beside it - not through the schema body, which
    // no longer merges the surface in. A validator that ignores the reference
    // gets the open classification instead, which is the honest answer for a reader
    // that never looked the surface up.
    const validate = compileValidator();
    expect(validate({ type: 'sumbit' })).toBe(false);
    const contractAlone = new Ajv2020();
    // The kit's own annotations, declared the one way every other Ajv
    // instance here declares them (compile.ts's ANNOTATION_KEYWORDS), so a
    // keyword added to that list does not have to be remembered again here.
    for (const keyword of ANNOTATION_KEYWORDS) contractAlone.addKeyword({ keyword });
    contractAlone.addSchema(baseSchema);
    expect(contractAlone.compile(contract)({ type: 'sumbit' })).toBe(true);
  });

  it('still rejects a value outside an axis enum', () => {
    // Closure is not the only assertion the schema carries; a real prop with
    // an impossible value has to fail too.
    const validate = compileValidator();
    expect(validate({ variant: 'plunger' })).toBe(false);
  });

  it('accepts a slot prop the schema cannot type', () => {
    // `icon` is a ReactNode: annotation-only in the schema, so it passes
    // instead of rejecting correct usage.
    const validate = compileValidator();
    expect(validate({ icon: 'anything', 'aria-label': 'Delete' })).toBe(true);
  });
});

describe('the props-classification report', () => {
  // What replaced closure. The schema admits every name; this is where a name
  // gets a classification, and it is the one that can make the distinction Ajv
  // cannot: a near-miss of a kit prop is an error, an unrecognized name is
  // merely unchecked.
  const surface = elementSurface as { properties?: Record<string, unknown>; patternProperties?: Record<string, unknown> };

  it('counts a kit prop, a forwarded attribute and a pattern match as known', () => {
    const report = classifyProps(
      { variant: 'ghost', nativeButton: true, disabled: true, 'aria-label': 'Delete', 'data-testid': 'x', onClick: () => {} },
      contract,
      surface,
    );
    expect(report.known).toEqual(['aria-label', 'data-testid', 'disabled', 'nativeButton', 'onClick', 'variant']);
    expect(report.unchecked).toEqual([]);
    expect(report.nearMiss).toEqual([]);
  });

  it('upgrades a one-edit miss of a kit prop to a near miss, naming what it is probably meant to be', () => {
    const report = classifyProps({ variannt: 'ghost' }, contract, surface);
    expect(report.unchecked).toEqual(['variannt']);
    expect(report.nearMiss).toEqual([{ prop: 'variannt', probably: 'variant' }]);
  });

  it('leaves an unrecognized name unchecked rather than calling it an error', () => {
    // `tooltip` is not one edit from any prop Button declares. The honest
    // answer is that nothing here checks it - which is a report, not a
    // refusal, and the distinction the open schema exists to preserve.
    const report = classifyProps({ tooltip: 'Delete' }, contract, surface);
    expect(report.unchecked).toEqual(['tooltip']);
    expect(report.nearMiss).toEqual([]);
  });

  it('does not call a near-miss of a forwarded DOM attribute an error', () => {
    // `classNam` is one edit from `className`, which the kit DOES declare, so
    // it is a near miss; `titl` is one edit from `title`, which only the
    // element surface declares - a typo in a DOM attribute is React's
    // business, not this contract's, and reporting it here would make the
    // report noisier than the thing it replaced.
    const nearOwn = classifyProps({ classNam: 'x' }, contract, surface);
    expect(nearOwn.nearMiss).toEqual([{ prop: 'classNam', probably: 'className' }]);
    const nearElement = classifyProps({ titl: 'x' }, contract, surface);
    expect(nearElement.unchecked).toEqual(['titl']);
    expect(nearElement.nearMiss).toEqual([]);
  });

  it('treats a withheld prop as unchecked, because the kit does not offer it', () => {
    // Accordion's root withholds `orientation`; Button withholds nothing, so this
    // checks the mechanism on the contract that has one - a withheld prop is
    // not in `properties`, so it lands in `unchecked` exactly like any other
    // name the contract does not account for.
    const accordion = compileContract('accordion');
    const report = classifyProps({ orientation: 'horizontal' }, accordion, undefined);
    expect(report.unchecked).toEqual(['orientation']);
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
  dont_use_when: [
    {
      situation: 'Navigation between routes or pages',
      instead: { target: 'NavigationMenu', component: 'gts.frontx.uikit.base.component.v1~frontx.uikit.component.navigation_menu.v1~' },
    },
  ],
  accepts: { content: 'specified', text: true },
  invariants: [],
  anti_patterns: [],
  deprecations: {},
  attestations: {},
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

  it('accepts a recommendation the kit ships no component for', () => {
    // `component` is optional and its ABSENCE is the statement: a rule whose
    // honest answer is "not a component of this kit" no longer has to name the
    // nearest kit component to satisfy a required reference.
    const outside = {
      ...validOverlay,
      dont_use_when: [{ situation: 'Navigation between routes or pages', instead: { target: "the consuming app's link component" } }],
    };
    expect(parseOverlay('button', outside)).toEqual(outside);
  });

  it('rejects a recommendation that does not say what to use', () => {
    // A `note` alone is a reason with no next move - the same gap a "don't"
    // without an "instead" leaves, one level down.
    const reasonOnly = {
      ...validOverlay,
      dont_use_when: [{ situation: 'Navigation between routes or pages', instead: { note: 'the kit ships no Link component' } }],
    };
    expect(() => parseOverlay('button', reasonOnly)).toThrow(/target/);
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
  // the element-surface conflict check only needs a ComponentExtraction
  // shape, and this keeps the test next to the assertion instead of in a
  // directory a reviewer has to go find. `disabled` is chosen because the
  // hand-written <button> surface really does declare it as a boolean.
  function syntheticExtraction(
    ownProps: ComponentExtraction['ownProps'],
    apiProps: ComponentExtraction['apiProps'] = [],
  ): ComponentExtraction {
    return {
      name: 'Button',
      axes: {},
      booleanAxes: [],
      defaults: {},
      ownProps,
      apiProps,
      forwardedProps: [],
      unclassifiedProps: [],
      elementKind: 'button',
      variantSourceLabels: [],
      cannotExtract: [],
    };
  }

  it('rejects a declared prop whose type conflicts with the element surface, naming both locations', () => {
    const conflicting = syntheticExtraction([
      { name: 'disabled', optional: true, typeText: 'string', declarationFile: 'button.tsx', expressed: { schema: { type: 'string' }, complete: true } },
    ]);
    expect(() => buildPropsAndRequired('button', conflicting, elementSurface)).toThrow(
      /"disabled".*button\.tsx.*declared type "boolean"/s,
    );
  });

  it('keeps a declared prop that agrees with the element surface, rather than deferring to it', () => {
    // The declaration is the more specific one and the contract carries it:
    // a validator that composes the host element's surface in applies both to
    // the same value, so agreement is all that is required, and a reader of
    // `properties` sees every prop the component declares.
    const agreeing = syntheticExtraction([
      { name: 'disabled', optional: true, typeText: 'boolean | undefined', declarationFile: 'button.tsx', expressed: { schema: { type: 'boolean' }, complete: true } },
    ]);
    const { properties, required } = buildPropsAndRequired('button', agreeing, elementSurface);
    expect(properties.disabled).toEqual({ type: 'boolean' });
    expect(required).toEqual([]);
  });

  it('rejects an API prop whose type conflicts with the element surface, naming its declaration file', () => {
    const conflicting = syntheticExtraction([], [
      { name: 'type', optional: true, typeText: 'boolean', declarationFile: '@base-ui/react/internals/types.d.mts', expressed: { schema: { type: 'boolean' }, complete: true } },
    ]);
    expect(() => buildPropsAndRequired('button', conflicting, elementSurface)).toThrow(
      /"type".*@base-ui\/react\/internals\/types\.d\.mts.*element surface/s,
    );
  });

  it('leaves a withheld API prop out of properties without touching the declared ones', () => {
    const extraction = syntheticExtraction(
      [{ name: 'loading', optional: true, typeText: 'boolean | undefined', declarationFile: 'button.tsx', expressed: { schema: { type: 'boolean' }, complete: true } }],
      [
        { name: 'nativeButton', optional: true, typeText: 'boolean | undefined', declarationFile: '@base-ui/react/internals/types.d.mts', expressed: { schema: { type: 'boolean' }, complete: true } },
        { name: 'render', optional: true, typeText: 'ReactElement', declarationFile: '@base-ui/react/internals/types.d.mts', expressed: undefined },
      ],
    );
    const { properties } = buildPropsAndRequired('button', extraction, elementSurface, ['render']);
    expect(Object.keys(properties).sort()).toEqual(['loading', 'nativeButton']);
  });

  // M11: this cross-check used to live only in the "overlay references only
  // props that exist in code" test above, exercised against Button's own
  // real compile - it now runs inside compile.ts's own compileContract for
  // every component (see "overlay references only props that exist in
  // code" above still passing, unchanged, as the positive control). These
  // two are the negative controls, proving the check actually rejects a
  // stale reference rather than merely never having been triggered yet -
  // Accordion and DataTable get this for free from the same compileContract
  // call, with no per-component test of their own required.
  it('rejects an overlay whose deprecations.props references a prop that does not exist', () => {
    const staleOverlay: Overlay = {
      ...validOverlay,
      deprecations: { props: { ghost: { since: '1.0.0', replacement: 'variant', hint: 'use variant instead' } } },
    };
    const extraction = syntheticExtraction([]);
    expect(() => assertOverlayReferencesRealProps('button', staleOverlay, extraction)).toThrow(
      /deprecations\.props references "ghost"/,
    );
  });

  it('rejects an overlay whose accepts.icons_via references a prop that does not exist', () => {
    const staleOverlay: Overlay = {
      ...validOverlay,
      accepts: { content: 'specified', text: true, icons_via: 'ghostIcon' },
    };
    const extraction = syntheticExtraction([]);
    expect(() => assertOverlayReferencesRealProps('button', staleOverlay, extraction)).toThrow(
      /accepts\.icons_via references "ghostIcon"/,
    );
  });

  it('accepts an authored contract major, and rejects one that is not a version', () => {
    // Per-component, because moving it is the one acknowledgement the
    // compatibility check accepts for a narrowing: read off a kit-wide
    // constant, taking that escape hatch meant rewriting every identifier in
    // the kit at once. Absent means 1, which is what every described
    // component carries today.
    expect(parseOverlay('button', { ...validOverlay, major: 2 })).toEqual({ ...validOverlay, major: 2 });
    expect(parseOverlay('button', validOverlay).major).toBeUndefined();
    for (const major of [0, -1, 1.5, '2']) {
      expect(() => parseOverlay('button', { ...validOverlay, major }), String(major)).toThrow(/major/);
    }
  });

  it('declares the major on the overlay schema and not on the metamodel', () => {
    // The major is not a FIELD of a contract instance - it is part of every
    // identifier the instance carries - so declaring it in both places would
    // be one fact written twice with nothing keeping the two in step.
    expect(buildOverlaySchema().properties).toHaveProperty('major');
    expect(buildMetamodel().properties).not.toHaveProperty('major');
  });

  it('rejects an overlay that writes a component reference in mounted_in, pointing at what fills it', () => {
    // Filled from every other contract's accepted components, so an authored
    // copy is a second writable statement of one fact - the shape that let a
    // part name a parent whose own accepted list did not name it back.
    const authoredMount = {
      ...validOverlay,
      mounted_in: ['gts.frontx.uikit.base.component.v1~frontx.uikit.component.card.v1~'],
    };
    expect(() => parseOverlay('button', authoredMount)).toThrow(/mounted_in.*FILLS.*accepts\.components/s);
  });

  it('rejects an overlay that writes a container outside the kit with no reason', () => {
    // Both halves of an outside mount are required: the container is what a
    // reader acts on, and the note is why no kit component fits - which is the
    // whole reason the shape exists rather than the nearest component standing
    // in for one.
    const containerOnly = { ...validOverlay, mounted_in: [{ container: "a column's header render function" }] };
    expect(() => parseOverlay('button', containerOnly)).toThrow(/note/);
  });

  it('rejects an overlay that writes a family root\'s member list', () => {
    // Filled on the root from every contract naming the same family as a
    // part: membership is one statement each member makes about itself.
    const authoredMembers = {
      ...validOverlay,
      family_membership: {
        name: 'button',
        role: 'root',
        members: ['gts.frontx.uikit.base.component.v1~frontx.uikit.component.card.v1~'],
      },
    };
    expect(() => parseOverlay('button', authoredMembers)).toThrow(/family_membership\.members.*FILLS/s);
  });

  it('rejects accepted components or text without content: specified', () => {
    // The one contradiction the vocabulary refuses outright: `content` already
    // answered the question for `unconstrained` and `nothing`, so detail
    // beside either says both that nothing may appear inside and that
    // something may.
    for (const accepts of [
      { content: 'nothing', text: true },
      { content: 'unconstrained', components: ['gts.frontx.uikit.base.component.v1~frontx.uikit.component.card.v1~'] },
    ]) {
      expect(() => parseOverlay('button', { ...validOverlay, accepts }), JSON.stringify(accepts)).toThrow(/accepts/);
    }
    // And the mirror: `specified` with no detail says nothing at all.
    expect(() => parseOverlay('button', { ...validOverlay, accepts: { content: 'specified' } })).toThrow(/accepts/);
  });

  it('rejects a withheld name the primitive underneath does not declare', () => {
    const stale: Overlay = { ...validOverlay, withheld: [{ prop: 'orientaton', reason: 'placeholder' }] };
    const extraction = syntheticExtraction([], [
      { name: 'orientation', optional: true, typeText: 'string', declarationFile: '@base-ui/react/internals/types.d.mts', expressed: { schema: { type: 'string' }, complete: true } },
    ]);
    expect(() => assertOverlayReferencesRealProps('button', stale, extraction)).toThrow(/withholds "orientaton"/);
  });

  it("rejects withholding a prop the component declares itself", () => {
    // A different mistake from the one above, and it gets a different
    // refusal: withholding is for a prop of the primitive the kit does not
    // advertise, never for what the component's own source states.
    const stale: Overlay = { ...validOverlay, withheld: [{ prop: 'loading', reason: 'placeholder' }] };
    const extraction = syntheticExtraction([
      { name: 'loading', optional: true, typeText: 'boolean', declarationFile: 'button.tsx', expressed: { schema: { type: 'boolean' }, complete: true } },
    ]);
    expect(() => assertOverlayReferencesRealProps('button', stale, extraction)).toThrow(/declares itself/);
  });

  it('rejects an untyped statement naming a prop that does not exist', () => {
    const stale: Overlay = {
      ...validOverlay,
      untyped: [{ about: 'prop', prop: 'ghostIcon', claim: 'placeholder', reason: 'placeholder' }],
    };
    const extraction = syntheticExtraction([]);
    expect(() => assertOverlayReferencesRealProps('button', stale, extraction)).toThrow(
      /untyped statement references the prop "ghostIcon"/,
    );
  });

  it('rejects an untyped statement about a prop that names no prop at all', () => {
    // The vocabulary's own if/then makes `prop` required for this subject, so
    // this is the belt to that braces: an overlay bypassing the schema (a
    // test fixture, a future caller building an Overlay by hand) still fails
    // rather than producing a statement nothing can be paired with.
    const stale: Overlay = {
      ...validOverlay,
      untyped: [{ about: 'prop', claim: 'placeholder', reason: 'placeholder' }],
    };
    const extraction = syntheticExtraction([]);
    expect(() => assertOverlayReferencesRealProps('button', stale, extraction)).toThrow(/names no prop/);
  });

  it('rejects an untyped statement about anything else that names a prop', () => {
    // The mirror of the rule above, enforced by the vocabulary: a claim about
    // internal state or an unexposed part is not about a property, so naming
    // one would make it pair-checkable against a property that has nothing to
    // do with it.
    const stale = { ...validOverlay, untyped: [{ about: 'behaviour', prop: 'icon', claim: 'placeholder', reason: 'placeholder' }] };
    expect(() => parseOverlay('button', stale)).toThrow(/untyped/);
  });
});

describe('M3: assembled output validated against its own schema before writing', () => {
  it('accepts a value that satisfies the given schema', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    expect(() => assertValidatesAgainst('button', 'test-value', schema, { ok: true })).not.toThrow();
  });

  it('rejects a value that does not satisfy the given schema, naming the component and what was validated', () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    expect(() => assertValidatesAgainst('button', 'test-value', schema, { ok: 'nope' })).toThrow(
      /button: assembled test-value failed schema validation/,
    );
  });

  it('drops a genuinely-unset field (JSON round-trip) rather than validating it as `undefined`', () => {
    // The exact reason compileInstance/compileContract round-trip through
    // JSON before validating (see testing.ts's validateContractTraits for
    // the same rule applied to x-gts-traits): an own key set to `undefined`
    // must read as absent, not as a value to type-check.
    const schema = { type: 'object', properties: { maybe: { type: ['string', 'null'] } }, additionalProperties: false };
    expect(() => assertValidatesAgainst('button', 'test-value', schema, { maybe: undefined })).not.toThrow();
  });
});

describe('button contract instance', () => {
  it('validates against the component metamodel', () => {
    const ajv = new Ajv2020();
    // The metamodel reaches most of its shape through references to the
    // vocabulary types, and declares GTS's own reference annotation on the
    // fields that hold an id.
    addContractTypes(ajv);
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
    // The bare id: `$id` carries the `gts://` URI form a JSON Schema keyword
    // needs, an id-valued field carries the id gts-ts can parse.
    expect(instance.props_schema).toBe(bareGtsId(contract.$id));
  });

  it("recommends something outside the kit for the navigation rule, and names no component for it", () => {
    // The kit ships no Link component. While `instead` could only be a
    // component reference, this rule pointed at NavigationMenu as a stand-in,
    // and agents reading the contract opened NavigationMenu for a single link
    // - a resolver had no way to tell a real recommendation from a
    // placeholder. The absence of `component` is now that statement.
    const navigation = meaning.dont_use_when.find((entry) => entry.situation === 'Navigation between routes or pages');
    if (navigation === undefined) throw new Error("Button's navigation rule is gone");
    expect(navigation.instead.target).toMatch(/link component/);
    expect(navigation.instead.component).toBeUndefined();
  });

  it('every good example is syntactically valid TSX', () => {
    // Syntax only. Real CI runs these through a tsc program against the kit's
    // own declarations, which also catches a prop that does not exist or has
    // the wrong type; that needs the built .d.ts, so the demo stops at parse.
    for (const { title, code } of meaning.examples.good) {
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
    expect(meaning.examples.bad.length).toBeGreaterThan(0);
    for (const { title, why } of meaning.examples.bad) {
      expect(why.trim(), `bad example "${title}" has no reason`).not.toBe('');
    }
  });
});

describe('a component reference names one contract major', () => {
  // Negative control for the shared suite's reference check
  // (assertContractFreshness, testing.ts), which every described component
  // runs against its own references. A reference carries the major it was
  // written against; when a component moves its major, a referrer left
  // behind names a type the kit no longer ships, and the resolver is what
  // makes that visible rather than the name alone matching.
  it('resolves a reference to the contract that ships at exactly that id', () => {
    const target = resolveComponentRef(componentTypeRef('button', contractMajor('button')));
    expect(target.directory).toBe('button');
    expect(target.contractId).toBe(bareGtsId(contract.$id));
  });

  it('does not accept a reference at a major the component does not ship', () => {
    const stale = componentTypeRef('button', contractMajor('button') + 1);
    const target = resolveComponentRef(stale);
    expect(target.contractId).not.toBe(stale);
  });

  it('resolves a component that ships no contract to its directory alone', () => {
    // Most components a `don't` rule points at are undescribed; the kit
    // shipping the component is a directory, not a registration.
    // A component that ships no contract has no overlay to state a major, so
    // a reference to one may only name major 1 - see testing.ts's own check.
    const target = resolveComponentRef(componentTypeRef('switch', 1));
    expect(target.directory).toBe('switch');
    expect(target.contractId).toBeUndefined();
  });
});

// The x-gts-traits fields base.component.json requires of every contract,
// read out of the committed schema: a test that restated the list would go
// on asserting a field the schema no longer names.
function requiredTraitFields(schema: Record<string, unknown>): string[] {
  const traitsSchema = schema['x-gts-traits-schema'];
  if (!isRecord(traitsSchema)) return [];
  const required = traitsSchema.required;
  return isStringArray(required) ? required : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

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
    // The vocabulary the base type's x-gts-traits-schema references. A store
    // missing one of them fails every entity in it with "Unresolvable trait
    // schema reference" - see "fails when a vocabulary type is not
    // registered" below, which is that failure asserted deliberately.
    registerContractTypes((entity) => gts.register(entity));
    gts.register(elementSurface);
    gts.register(contract);
    return gts;
  }

  it('validates as a derived GTS type, and so does the element surface it names', () => {
    // BASE_TYPE_ID is deliberately not checked here - see "the abstract base
    // type alone never resolves its own x-gts-traits-schema" below for why it
    // cannot pass this same call.
    const gts = registeredStore();
    for (const id of [ELEMENT_TYPE_ID, contract.$id]) {
      const result = gts.validateEntity(bareGtsId(id));
      expect(result.ok, `${id}: ${result.error}`).toBe(true);
      expect(result.entity_type).toBe('schema');
    }
  });

  it('fails when the parent type is not registered', () => {
    // Negative control for the check above: without it, a passing
    // validateEntity would prove nothing about whether the chain resolves.
    const gts = new GTS();
    gts.register(elementSurface);
    gts.register(contract);
    const result = gts.validateEntity(bareGtsId(contract.$id));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Parent schema not found');
  });

  it('the abstract component type alone never resolves its own x-gts-traits-schema - a leaf must supply the values', () => {
    // base.component.json declares x-gts-traits-schema but carries no
    // x-gts-traits of its own: it is the abstract parent, not a component.
    // Validated by itself (no derived contract in the chain to supply real
    // values), GtsStore.validateSchemaTraits' "unresolved trait property"
    // check finds the required x-gts-traits fields with neither a value nor a
    // default, and fails. Which fields those are is read out of the schema
    // rather than listed here, so adding or dropping a required field cannot
    // leave this test asserting a field the schema stopped naming.
    // Asserted here on purpose, not silently dropped from the loop above: a
    // component's OWN contract is the only place those values can come
    // from, which "validates x-gts-traits against base.component.json's
    // x-gts-traits-schema" below proves for the case that matters.
    const required = requiredTraitFields(baseSchema);
    expect(required.length).toBeGreaterThan(0);
    const gts = new GTS();
    gts.register(baseSchema);
    registerContractTypes((entity) => gts.register(entity));
    const result = gts.validateEntity(bareGtsId(BASE_TYPE_ID));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('required property');
    expect(required.some((field) => result.error?.includes(field))).toBe(true);
  });

  it("fails when the contract the instance's props_schema names is absent from the registry", () => {
    // Negative control for the shared suite's own props-schema resolution
    // (assertContractFreshness, testing.ts), which every described component
    // runs: without a failing case, a passing resolution would prove only
    // that the id is grammatical.
    const gts = new GTS();
    gts.register(baseSchema);
    registerContractTypes((entity) => gts.register(entity));
    gts.register(buildMetamodel());
    gts.register(JSON.parse(JSON.stringify(instance)) as Record<string, unknown>);
    const result = gts.validateInstance(instance.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found in registry');
  });

  it("fails when the surface the instance's host_element names is absent from the registry", () => {
    // Negative control for the OTHER reference gts-ts resolves itself. It sits
    // directly on an instance property, which is as deep as
    // XGtsRefValidator's walk goes, so the surface a contract names is
    // resolved by the registry and not only by the conformance suite - a claim
    // worth a failing case, because the same reference inside x-gts-traits is
    // stripped before any validator sees it.
    const gts = registeredKitStore();
    const orphaned = { ...(JSON.parse(JSON.stringify(instance)) as Record<string, unknown>) };
    orphaned.host_element = elementTypeRef('dom_nope');
    gts.register(orphaned);
    const result = gts.validateInstance(instance.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found in registry');
  });

  it('fails when a vocabulary type the x-gts-traits-schema references is not registered', () => {
    // Negative control for registeredStore's own registration: the
    // x-gts-traits-schema names its concepts by reference, so a registry missing one has
    // not checked a contract against a smaller schema - it has not checked
    // it at all, and says so.
    const gts = new GTS();
    gts.register(baseSchema);
    gts.register(elementSurface);
    gts.register(contract);
    const result = gts.validateEntity(bareGtsId(contract.$id));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unresolvable trait schema reference');
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
    // Negative control: an earlier review round flagged that a broken x-gts-traits block
    // registered silently under the old, undifferentiated x-uikit annotation
    // - nothing validated it. An `instead` that is not a grammatical GTS
    // component type id must now fail GTS.validateEntity with an x-gts-traits
    // error instead of passing as an untyped string.
    const corrupted: CompiledContract = {
      ...contract,
      'x-gts-traits': {
        ...contract['x-gts-traits'],
        dont_use_when: [{ situation: 'placeholder', instead: { target: 'anything', component: 'not-a-gts-id' } }],
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
