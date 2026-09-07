// Conformance: the compiled contract may never disagree with the code.
//
// In CI this test recompiles the contract from source and diffs it against
// the shipped dist/contracts copy (freshness); the demo compiles in-memory
// and checks the invariants that make the contract trustworthy: axes and
// defaults mirror the cva() call exactly, the overlay only references props
// that exist, and the $id obeys the GTS segment grammar.
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
  PASSTHROUGH_TYPE_ID,
  compileContract,
  compileInstance,
  loadBaseSchema,
  loadPassthroughSchema,
} from '../../../scripts/contracts/compile';
import { extractComponent } from '../../../scripts/contracts/extract';

const contract = compileContract('button');
const instance = compileInstance('button');
const baseSchema = loadBaseSchema();
const passthroughSchema = loadPassthroughSchema();

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
  // x-uikit is the kit's own annotation vocabulary. Declaring it keeps Ajv's
  // strict mode on for every other keyword - the alternative, `strict:
  // false`, would also swallow a genuine typo like `unevaluatedProperites`,
  // which is exactly the class of mistake this schema exists to catch. No
  // `validate`/`code`, so it asserts nothing: an annotation, like `title`.
  ajv.addKeyword({ keyword: 'x-uikit' });
  ajv.addSchema(baseSchema);
  ajv.addSchema(passthroughSchema);
  return ajv.compile(contract);
}
// vitest rewrites import.meta.url to a root-relative path, so resolve from
// the package cwd instead.
const extraction = extractComponent(join(process.cwd(), 'src/components/button/button.tsx'));
const metaSchema = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/contracts/ui-component.meta.json'), 'utf8'),
) as SchemaObject;

// Grammar of a GTS component type reference; the capture is the component
// token, snake_case where the kit directory is kebab-case.
const COMPONENT_TYPE_REF = /^gts\.frontx\.uikit\.component\.([a-z_][a-z0-9_]*)\.v\d+~$/;

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

  it('overlay references only props that exist in code', () => {
    const known = new Set([...Object.keys(extraction.axes), ...extraction.ownProps.map((prop) => prop.name)]);
    for (const prop of Object.keys(contract['x-uikit'].deprecations.props ?? {})) {
      expect(known, `deprecated prop "${prop}" is not a real prop`).toContain(prop);
    }
    const iconsVia = contract['x-uikit'].composition.children.icons_via;
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
    // className is declared by ButtonProps (Base UI's Props omits it), but
    // it is a DOM prop every component forwards - the passthrough type owns
    // it, and the component schema must not carry a competing copy.
    const passthroughProps = Object.keys((passthroughSchema.properties ?? {}) as Record<string, unknown>);
    expect(passthroughProps).toContain('className');
    for (const prop of passthroughProps) {
      expect(Object.keys(contract.properties), `"${prop}" is declared twice`).not.toContain(prop);
    }
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

describe('button contract instance', () => {
  it('validates against the component metamodel', () => {
    const ajv = new Ajv2020();
    const validate = ajv.compile(metaSchema);
    expect(validate(instance), ajv.errorsText(validate.errors)).toBe(true);
  });

  it('carries a grammatical GTS instance id', () => {
    expect(instance.id).toMatch(
      /^gts\.frontx\.uikit\.meta\.component\.v1~frontx\.uikit\.component\.[a-z_][a-z0-9_]*\.v\d+$/,
    );
  });

  it('points at the props schema it was compiled with', () => {
    expect(instance.props_schema).toBe(contract.$id);
  });

  it('every dont_use_when alternative resolves to a component the kit ships', () => {
    // Demo stand-in for the registry existence check x-gts-ref performs:
    // grammar alone would happily accept an id nothing implements.
    expect(instance.dont_use_when.length).toBeGreaterThan(0);
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

  it('validates as a derived GTS type, and so do the types it derives from', () => {
    const gts = registeredStore();
    for (const id of [BASE_TYPE_ID, PASSTHROUGH_TYPE_ID, contract.$id]) {
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
});
