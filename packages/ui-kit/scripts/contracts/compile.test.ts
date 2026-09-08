// Compiler unit tests for the one rule that decides how a prop the
// provider-safe subset cannot express reaches a reader: it is described, not
// left blank.
//
// The defect this suite pins down was found by reading the compiled
// artifacts as an agent would. The accordion root's `value`, `defaultValue`
// and `onValueChange` were each the literal `{}` - and an empty schema in a
// props contract reads as "anything goes", so the reader concluded `value`
// and `defaultValue` were plain strings when their real type is
// `AccordionValue<Value>`. Nothing in the harness was wrong about the TYPE;
// the compiler simply had nowhere to put it once classifyProviderSafeType
// returned undefined.
//
// Compiled from a real extraction rather than a synthetic
// ComponentExtraction: the whole point is that the type text a reader ends
// up with is the checker's own printed type, so a hand-written typeText
// would test the string formatting and nothing else.
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBaseSchema,
  buildGtsTraitsSchema,
  buildMetamodel,
  buildPropsAndRequired,
  buildTraitTypes,
  describeUntypeableProperty,
  loadPassthroughSchema,
} from './compile';
import { extractComponent } from './extract';
import { applyContractTestTimeout } from './testing';

// This suite builds a real TypeScript program through extractComponent -
// several seconds on a CI-class runner. Must run before any
// describe()/it() in the file; see applyContractTestTimeout's own comment in
// testing.ts.
applyContractTestTimeout();

const fixture = (name: string) => join(process.cwd(), 'scripts/contracts/__fixtures__', name);

const [picker] = extractComponent(fixture('untypeable-props.fixture.tsx'));
const passthrough = loadPassthroughSchema('div');

describe('the hand-written element surface', () => {
  const properties = passthrough.properties as Record<string, { type?: string; description?: string }>;

  it('states the TypeScript type of every attribute it cannot assert', () => {
    // `style` and `children` are the two React attributes no JSON Schema
    // type covers - and the case that used to emit `{}` per component, 233
    // times over, for props nobody had written down.
    expect(properties.style.type).toBeUndefined();
    expect(properties.style.description).toContain('TS: CSSProperties');
    expect(properties.children.description).toContain('TS: ReactNode');
  });

  it('types the attributes it can, rather than describing everything', () => {
    expect(properties.className).toEqual({ type: 'string' });
    expect(properties.tabIndex).toEqual({ type: 'number' });
  });

  it('leaves no property schema empty', () => {
    const empty = Object.entries(properties)
      .filter(([, schema]) => Object.keys(schema).length === 0)
      .map(([name]) => name);
    expect(empty).toEqual([]);
  });

  it('admits the aria-, data- and event-handler families by pattern rather than by name', () => {
    expect(Object.keys(passthrough.patternProperties as Record<string, unknown>).sort()).toEqual(['^aria-', '^data-', '^on[A-Z]']);
  });
});

describe('a declared prop with no JSON Schema representation', () => {
  const { properties, slots } = buildPropsAndRequired('picker', picker, passthrough);

  it('states its type text next to the slot record that holds it', () => {
    // `selection: Value[]` depends on the component's own type parameter -
    // the same shape as the accordion root's `AccordionValue<Value>`, just
    // arriving through an own prop. The slot branch's own wording is the
    // description here; what matters to a reader is that the type text is
    // in it.
    expect(properties.selection.type).toBeUndefined();
    expect(properties.selection.description).toContain('Value[]');
    expect(slots.selection.typeText).toBe('Value[]');
  });

  it('describes a function prop the same way', () => {
    expect(properties.onSelectionChange.description).toContain('(next: Value[]) => void');
  });

  it('leaves a typed own prop typed and undescribed', () => {
    expect(properties.label).toEqual({ type: 'string' });
  });
});

describe('describeUntypeableProperty', () => {
  it('describes a schema that asserts nothing', () => {
    expect(describeUntypeableProperty({}, 'Value[]')).toEqual({
      description: 'TS: Value[]. Not expressible in JSON Schema, checked by tsc.',
    });
  });

  it('leaves a schema that already asserts something alone', () => {
    // One entry per keyword that constrains a value: a property carrying any
    // of them already tells a reader what it accepts, and the day the
    // compiler starts emitting $ref or oneOf this is what stops the rule
    // from annotating over it.
    for (const asserting of [{ type: 'string' }, { enum: ['a'] }, { const: 'a' }, { $ref: 'gts://x~' }, { anyOf: [] }, { oneOf: [] }]) {
      expect(describeUntypeableProperty(asserting, 'Value[]')).toEqual(asserting);
    }
  });

  it('leaves an existing description alone', () => {
    const slot = { description: 'Slot: ReactNode. No JSON Schema type exists for it; shape checked by tsc, see x-uikit.slots.' };
    expect(describeUntypeableProperty(slot, 'ReactNode')).toEqual(slot);
  });
});


describe('the vocabulary the base type and the metamodel reference', () => {
  const builtIds = new Set(buildTraitTypes().map((type) => String(type.$id)));

  function gtsRefs(node: unknown, found: string[] = []): string[] {
    if (Array.isArray(node)) {
      for (const item of node) gtsRefs(item, found);
      return found;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '$ref' && typeof value === 'string' && value.startsWith('gts://')) found.push(value);
        else gtsRefs(value, found);
      }
    }
    return found;
  }

  it('is complete: every reference resolves to a type the builder writes', () => {
    // A field added to the trait schema or the metamodel naming a type
    // nobody builds would fail at validation time with "Unresolvable trait
    // schema reference", far from the edit that caused it. This is that
    // failure moved to the build.
    const referenced = new Set([...gtsRefs(buildBaseSchema()), ...gtsRefs(buildMetamodel()), ...gtsRefs(buildTraitTypes())]);
    expect([...referenced].filter((ref) => !builtIds.has(ref))).toEqual([]);
  });

  it('keeps the reference ahead of the null alternative on an optional trait field', () => {
    // Key ORDER is load-bearing here, which is why it is asserted:
    // GtsStore.resolveTraitSchemaRefs merges a resolved reference in at the
    // position of the `$ref` key, so a `type` written before it is
    // overwritten by the referenced type's own `object` and `family: null`
    // silently stops validating for every component that omits the field.
    const family = (buildGtsTraitsSchema().properties as Record<string, Record<string, unknown>>).family;
    expect(Object.keys(family)[0]).toBe('$ref');
    expect(family.type).toEqual(['object', 'null']);
    expect(family.default).toBeNull();
  });
});

describe('a boolean cva axis', () => {
  const [panel] = extractComponent(fixture('boolean-axis.fixture.tsx'));
  const { properties } = buildPropsAndRequired('panel', panel, { properties: {} });

  it('compiles to a boolean property, not to the string enum its keys look like', () => {
    // What VariantProps types the prop as, and therefore the only shape a
    // caller can satisfy: `<Panel fullWidth />` passes a boolean, and a
    // contract stating `enum: ['true','false']` on a string rejected it.
    expect(properties.fullWidth).toEqual({ type: 'boolean', default: false });
    expect(properties.raised).toEqual({ type: 'boolean' });
  });

  it('leaves a string axis a string enum with its own default', () => {
    expect(properties.emphasis).toEqual({ type: 'string', enum: ['low', 'high'], default: 'low' });
  });
});
