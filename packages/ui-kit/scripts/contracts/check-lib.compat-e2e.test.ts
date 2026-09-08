// End-to-end coverage for decideCompat's headline breaking-change scenarios
// (demo review M9). check-lib.test.ts's own `decideCompat` suite feeds
// synthetic gtsBackwardCompatible/gtsBackwardErrors booleans directly - that
// proves the DECISION rule (major bump vs fail) but never proves gts-ts's
// own checkCompatibility actually catches, or fails to catch, the class of
// change this guard exists for. This suite compiles two REAL schema
// versions per scenario, registers them in a REAL GTS instance (the same
// construction check.ts's checkCompatForUnit uses: a fresh store per run,
// old/new registered under synthetic minor-versioned ids so they never
// collide), and runs the real backward-compatibility check plus the real
// diffOwnPropsSchema - only decideCompat itself is a function under test
// here, unmocked.
//
// Probing gts-ts directly (see the module comment above diffOwnPropsSchema
// in check-lib.ts) showed its own 'backward' direction does NOT flag a
// newly required own prop, nor an own prop that simply disappears without
// having been required - both scenarios below rely on diffOwnPropsSchema to
// catch what gts-ts's checkCompatibility alone would silently pass.
import { GTS } from '@globaltypesystem/gts-ts';
import { describe, expect, it } from 'vitest';

import { decideCompat, diffOwnPropsSchema, extractContractMajor, synthesizeVersionedId } from './check-lib';
import { loadBaseSchema } from './compile';
import { bareGtsId, propsSchemaId } from './ids';
import { applyContractTestTimeout } from './testing';

// This suite builds no TypeScript program either, but registers real
// compiled schemas in a real GTS store and runs the real backward-
// compatibility check per scenario - real work, and it gets the same 120s
// margin as the rest of the contracts test surface rather than depending on
// this specific suite staying fast forever. Must run before any
// describe()/it() in the file; see applyContractTestTimeout's own comment
// in testing.ts.
applyContractTestTimeout();

const COMPONENT = 'compat-e2e-fixture';

// A minimal but real compiled-shape props schema: the same $id grammar and
// base-derivation allOf compile.ts emits for every real component, with a
// hand-picked properties/required set per scenario below.
function schema(major: number, properties: Record<string, { type?: string; enum?: string[]; description?: string }>, required: string[]) {
  return {
    $id: propsSchemaId(COMPONENT, major),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object' as const,
    allOf: [{ $ref: 'gts://gts.frontx.uikit.base.component.v1~' }],
    properties,
    required,
    unevaluatedProperties: { 'x-uikit-verdict': 'unchecked' } as const,
  };
}

// The real library's own backward verdict for two revisions, on its own -
// what this project reads as ONE of three compatibility signals, and what
// the suite below pins so a change in it is a test failure here rather than
// a silently weaker gate.
function gtsBackwardVerdict(old: ReturnType<typeof schema>, fresh: ReturnType<typeof schema>) {
  const gts = new GTS();
  gts.register(loadBaseSchema());
  const oldSynthetic = { ...old, $id: synthesizeVersionedId(old.$id, 0) };
  const newSynthetic = { ...fresh, $id: synthesizeVersionedId(fresh.$id, 1) };
  gts.register(oldSynthetic);
  gts.register(newSynthetic);
  return gts.checkCompatibility(bareGtsId(oldSynthetic.$id), bareGtsId(newSynthetic.$id), 'backward');
}

// Registers old/new under synthetic minor-versioned ids in one fresh GTS
// store (mirrors checkCompatForUnit exactly), runs the real backward check
// plus the real own-props diff, and hands both to the real decideCompat.
function checkRealCompat(old: ReturnType<typeof schema>, fresh: ReturnType<typeof schema>) {
  const result = gtsBackwardVerdict(old, fresh);

  return decideCompat({
    component: COMPONENT,
    oldMajor: extractContractMajor(old.$id),
    newMajor: extractContractMajor(fresh.$id),
    gtsBackwardCompatible: result.is_backward_compatible,
    gtsBackwardErrors: result.backward_errors,
    ownPropsDiff: diffOwnPropsSchema(old, fresh),
  });
}

describe('decideCompat against a real GTS instance and real gts-ts compatibility check', () => {
  it('fails when an enum value is removed from an own prop, major unchanged', () => {
    const old = schema(1, { variant: { type: 'string', enum: ['default', 'destructive'] } }, []);
    const fresh = schema(1, { variant: { type: 'string', enum: ['default'] } }, []);
    expect(checkRealCompat(old, fresh).status).toBe('fail');
  });

  it('fails when an optional own prop becomes required, major unchanged', () => {
    const old = schema(1, { label: { type: 'string' } }, []);
    const fresh = schema(1, { label: { type: 'string' } }, ['label']);
    expect(checkRealCompat(old, fresh).status).toBe('fail');
  });

  it('fails when a new required own prop is added, major unchanged', () => {
    const old = schema(1, { label: { type: 'string' } }, []);
    const fresh = schema(1, { label: { type: 'string' }, id: { type: 'string' } }, ['id']);
    expect(checkRealCompat(old, fresh).status).toBe('fail');
  });

  it('fails when an own prop is renamed (old name gone, new name added)', () => {
    const old = schema(1, { iconName: { type: 'string' } }, []);
    const fresh = schema(1, { icon: { type: 'string' } }, []);
    const verdict = checkRealCompat(old, fresh);
    expect(verdict.status).toBe('fail');
    expect(verdict.notes[0]).toContain('own prop "iconName" removed');
  });

  it('passes the same enum removal when the contract major moved, with a note naming both versions', () => {
    const old = schema(1, { variant: { type: 'string', enum: ['default', 'destructive'] } }, []);
    const fresh = schema(2, { variant: { type: 'string', enum: ['default'] } }, []);
    const verdict = checkRealCompat(old, fresh);
    expect(verdict.status).toBe('pass');
    expect(verdict.notes[0]).toContain('v1 -> v2');
  });

  it('passes when nothing changed', () => {
    const old = schema(1, { label: { type: 'string' } }, []);
    const fresh = schema(1, { label: { type: 'string' } }, []);
    expect(checkRealCompat(old, fresh).status).toBe('pass');
  });

  it('passes when a property that asserts nothing only gains prose naming its TypeScript type', () => {
    // A property with no type/enum accepts anything either way; the prose
    // added to it (compile.ts's describeUntypeableProperty) tells a reader
    // what tsc checks instead. gts-ts's own backward check is asserted here
    // rather than assumed, because this project reads its verdict as one of
    // three compatibility signals - if the library ever started treating an
    // annotation as a schema change, every recompile of an existing
    // contract would start refusing itself.
    const old = schema(1, { icon: {} }, []);
    const fresh = schema(1, { icon: { description: 'TS: ReactNode. Not expressible in JSON Schema, checked by tsc.' } }, []);
    expect(checkRealCompat(old, fresh).status).toBe('pass');
  });
});

describe("what gts-ts's own backward verdict does and does not see", () => {
  // Pinned, not assumed. Every one of these was measured against the
  // installed library; each is a reason `diffOwnPropsSchema` exists, and a
  // future version of gts-ts that starts (or stops) reporting one of them
  // makes this suite fail here rather than quietly changing how much the
  // gate catches.
  it('reports a dropped enum value', () => {
    const verdict = gtsBackwardVerdict(
      schema(1, { variant: { type: 'string', enum: ['default', 'destructive'] } }, []),
      schema(1, { variant: { type: 'string', enum: ['default'] } }, []),
    );
    expect(verdict.is_backward_compatible).toBe(false);
    expect(verdict.backward_errors.join(' ')).toContain("Enum value 'destructive' removed");
  });

  it('reports a constraint appearing where the property asserted nothing, as any -> the new type', () => {
    const verdict = gtsBackwardVerdict(schema(1, { tone: {} }, []), schema(1, { tone: { type: 'string' } }, []));
    expect(verdict.is_backward_compatible).toBe(false);
    expect(verdict.backward_errors.join(' ')).toContain('from any to string');
  });

  it('does NOT report an enum appearing on a property that already carried its type', () => {
    // The gap this project closes locally: every value outside the new union
    // stops validating, and this is the shape the compiler emits the day a
    // plain `string` prop becomes a literal union.
    const verdict = gtsBackwardVerdict(
      schema(1, { tone: { type: 'string' } }, []),
      schema(1, { tone: { type: 'string', enum: ['info', 'warning'] } }, []),
    );
    expect(verdict.is_backward_compatible).toBe(true);
    expect(verdict.backward_errors).toEqual([]);
  });

  it('does NOT report an optional property vanishing, nor one that newly became required', () => {
    const vanished = gtsBackwardVerdict(schema(1, { icon: { type: 'string' } }, []), schema(1, {}, []));
    expect(vanished.is_backward_compatible).toBe(true);
    const required = gtsBackwardVerdict(
      schema(1, { label: { type: 'string' } }, []),
      schema(1, { label: { type: 'string' } }, ['label']),
    );
    expect(required.is_backward_compatible).toBe(true);
  });
});

describe('an own-props narrowing gts-ts calls compatible', () => {
  it('fails at an unchanged major on an enum appearing over an existing type', () => {
    const old = schema(1, { tone: { type: 'string' } }, []);
    const fresh = schema(1, { tone: { type: 'string', enum: ['info', 'warning'] } }, []);
    const verdict = checkRealCompat(old, fresh);
    expect(verdict.status).toBe('fail');
    expect(verdict.notes[0]).toContain('own prop "tone" enum constraint added');
  });

  it('accepts the same change with the contract major moved', () => {
    const old = schema(1, { tone: { type: 'string' } }, []);
    const fresh = schema(2, { tone: { type: 'string', enum: ['info', 'warning'] } }, []);
    expect(checkRealCompat(old, fresh).status).toBe('pass');
  });
});
