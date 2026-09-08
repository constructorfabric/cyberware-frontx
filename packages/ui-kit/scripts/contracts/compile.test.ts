// Compiler unit tests for the one rule that decides how a prop the
// provider-safe subset cannot express reaches a reader: it is described, not
// left blank.
//
// The defect this suite pins down was found by reading the generated
// artifacts as an agent would. `passthrough.base_ui_accordion_root.json`
// carried `"value": {}`, `"defaultValue": {}` and `"onValueChange": {}` -
// and an empty schema in a props contract reads as "anything goes", so the
// reader concluded `value` and `defaultValue` were plain strings when their
// real type is `AccordionValue<Value>`. Nothing in the harness was wrong
// about the TYPE; the compiler simply had nowhere to put it once
// classifyProviderSafeType returned undefined.
//
// Compiled from a real extraction rather than a synthetic
// ComponentExtraction: the whole point is that the type text a reader ends
// up with is the checker's own printed type, so a hand-written typeText
// would test the string formatting and nothing else.
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPassthroughSchema, buildPropsAndRequired, describeUntypeableProperty } from './compile';
import { extractComponent } from './extract';
import { applyContractTestTimeout } from './testing';

// This suite builds a real TypeScript program through extractComponent -
// several seconds on a CI-class runner. Must run before any
// describe()/it() in the file; see applyContractTestTimeout's own comment in
// testing.ts.
applyContractTestTimeout();

const fixture = (name: string) => join(process.cwd(), 'scripts/contracts/__fixtures__', name);

const [picker] = extractComponent(fixture('untypeable-props.fixture.tsx'));
const passthrough = buildPassthroughSchema('dom_div', 'div', picker.inheritedProps, ['picker']);
const passthroughProperties = passthrough.properties as Record<string, { type?: string; description?: string }>;

describe('an inherited prop with no JSON Schema representation', () => {
  it('carries the checker type text and the reason nothing asserts it', () => {
    // `defaultValue` is the accordion root's own misread prop name, here on
    // a plain <div>: a union with non-literal members, so no type and no
    // enum, exactly the case that used to emit `{}`.
    const defaultValue = passthroughProperties.defaultValue;
    expect(defaultValue.type).toBeUndefined();
    expect(defaultValue.description).toBe(
      'TS: string | number | readonly string[] | undefined. Not expressible in JSON Schema, checked by tsc.',
    );
  });

  it('leaves a prop the subset CAN express untouched', () => {
    // The rule is "describe what cannot be asserted", not "describe
    // everything" - a typed prop gaining prose would be a second, drifting
    // statement of the same fact.
    expect(passthroughProperties.className).toEqual({ type: 'string' });
  });

  it('leaves no property schema empty', () => {
    const empty = Object.entries(passthroughProperties)
      .filter(([, schema]) => Object.keys(schema).length === 0)
      .map(([name]) => name);
    expect(empty).toEqual([]);
  });
});

describe('an own prop with no JSON Schema representation', () => {
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
