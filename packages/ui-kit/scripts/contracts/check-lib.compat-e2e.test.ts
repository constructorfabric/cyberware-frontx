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
import { propsSchemaId } from './ids';

// gts-ts's own id parser (Gts.parseGtsID) requires the bare `gts.` prefix
// and rejects the `gts://` URI form outright - same fact, same helper, as
// check.ts's own bareId and button.contract.test.ts's copy.
function bareId(id: string): string {
  return id.replace(/^gts:\/\//, '');
}

const COMPONENT = 'compat-e2e-fixture';

// A minimal but real compiled-shape props schema: the same $id grammar and
// base-derivation allOf compile.ts emits for every real component, with a
// hand-picked properties/required set per scenario below.
function schema(major: number, properties: Record<string, unknown>, required: string[]) {
  return {
    $id: propsSchemaId(COMPONENT, major),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object' as const,
    allOf: [{ $ref: 'gts://gts.frontx.uikit.base.component.v1~' }],
    properties,
    required,
    unevaluatedProperties: false as const,
  };
}

// Registers old/new under synthetic minor-versioned ids in one fresh GTS
// store (mirrors checkCompatForUnit exactly), runs the real backward check
// plus the real own-props diff, and hands both to the real decideCompat.
function checkRealCompat(old: ReturnType<typeof schema>, fresh: ReturnType<typeof schema>) {
  const gts = new GTS();
  gts.register(loadBaseSchema());
  const oldSynthetic = { ...old, $id: synthesizeVersionedId(old.$id, 0) };
  const newSynthetic = { ...fresh, $id: synthesizeVersionedId(fresh.$id, 1) };
  gts.register(oldSynthetic);
  gts.register(newSynthetic);
  const result = gts.checkCompatibility(bareId(oldSynthetic.$id), bareId(newSynthetic.$id), 'backward');

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
});
