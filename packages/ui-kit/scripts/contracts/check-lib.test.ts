// Unit tests for check-lib.ts's pure decision logic - every input here is
// an in-memory fixture, never a git ref or a file on disk, so these run
// without a checked-out history and stay fast. check.ts's own git/gts-ts
// wiring is exercised for real by running `npm run contracts:check` against
// origin/develop (see the T4 report), not by a unit test here.
import { describe, expect, it } from 'vitest';

import {
  buildCoverageReport,
  decideCompat,
  diffOwnPropsSchema,
  diffPassthroughSchema,
  evaluateGuard,
  extractContractMajor,
  jsonDiff,
  mapChangedFilesToComponents,
  resolveRenameSource,
  synthesizeVersionedId,
  skippedPassthroughNote,
  touchesSharedContractTooling,
} from './check-lib';
import { applyContractTestTimeout } from './testing';

// This suite itself builds no TypeScript program (see the file comment
// above), but gets the same 120s margin as the rest of the contracts test
// surface so a future addition here that does start using compile.ts/
// extract.ts inherits the safety margin instead of silently reintroducing
// the CI-only timeout. Must run before any describe()/it() in the file;
// see applyContractTestTimeout's own comment in testing.ts.
applyContractTestTimeout();

describe('jsonDiff', () => {
  it('reports no diff for two structurally equal objects, regardless of key order', () => {
    const committed = { a: 1, b: { c: 2, d: [1, 2] } };
    const fresh = { b: { d: [1, 2], c: 2 }, a: 1 };
    expect(jsonDiff(committed, fresh)).toEqual([]);
  });

  it('reports a path for a changed leaf value', () => {
    expect(jsonDiff({ a: { b: 1 } }, { a: { b: 2 } })).toEqual(['$.a.b: 1 !== 2']);
  });

  it('reports a missing-from-fresh diff without throwing when committed carries an extra key', () => {
    const diffs = jsonDiff({ a: 1, extra: true }, { a: 1 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('extra');
  });

  it('reports an array length mismatch instead of diffing past the shorter array', () => {
    expect(jsonDiff({ a: [1, 2] }, { a: [1] })).toEqual(['$.a: length 2 (committed) vs 1 (fresh)']);
  });

  it('treats a wholly undefined committed artifact as one diff naming the whole document', () => {
    expect(jsonDiff(undefined, { a: 1 })).toEqual(['$: missing from the committed artifact']);
  });
});

describe('diffPassthroughSchema', () => {
  it('is compatible when a prop is only added', () => {
    const diff = diffPassthroughSchema({ properties: { disabled: { type: 'boolean' } } }, { properties: { disabled: { type: 'boolean' }, form: { type: 'string' } } });
    expect(diff).toEqual({ added: ['form'], removed: [], narrowed: [], compatible: true });
  });

  it('is incompatible when a prop is removed', () => {
    const diff = diffPassthroughSchema(
      { properties: { disabled: { type: 'boolean' }, form: { type: 'string' } } },
      { properties: { disabled: { type: 'boolean' } } },
    );
    expect(diff.removed).toEqual(['form']);
    expect(diff.compatible).toBe(false);
  });

  it('is incompatible when a shared prop changes type', () => {
    const diff = diffPassthroughSchema({ properties: { size: { type: 'number' } } }, { properties: { size: { type: 'string' } } });
    expect(diff.narrowed).toEqual([{ prop: 'size', reason: 'type changed from "number" to "string"' }]);
    expect(diff.compatible).toBe(false);
  });

  it('is incompatible when an enum value is dropped, but not when one is only added', () => {
    const dropped = diffPassthroughSchema(
      { properties: { variant: { type: 'string', enum: ['a', 'b'] } } },
      { properties: { variant: { type: 'string', enum: ['a'] } } },
    );
    expect(dropped.narrowed).toEqual([{ prop: 'variant', reason: 'enum value(s) removed: b' }]);

    const widened = diffPassthroughSchema(
      { properties: { variant: { type: 'string', enum: ['a'] } } },
      { properties: { variant: { type: 'string', enum: ['a', 'b'] } } },
    );
    expect(widened.compatible).toBe(true);
  });

  it('is incompatible when an unconstrained prop gains an enum', () => {
    const diff = diffPassthroughSchema(
      { properties: { variant: { type: 'string' } } },
      { properties: { variant: { type: 'string', enum: ['primary'] } } },
    );
    expect(diff.narrowed).toEqual([{ prop: 'variant', reason: 'enum constraint added: primary where none existed before' }]);
    expect(diff.compatible).toBe(false);
  });

  it('is incompatible when an untyped prop gains a type', () => {
    const diff = diffPassthroughSchema({ properties: { render: {} } }, { properties: { render: { type: 'string' } } });
    expect(diff.narrowed).toEqual([{ prop: 'render', reason: 'type constraint added: "string" where none existed before' }]);
    expect(diff.compatible).toBe(false);
  });

  it('is compatible when an unconstrained prop only gains prose naming its TypeScript type', () => {
    // The pairing of this case with the one above is the whole point: the
    // difference between "this prop now only accepts a string" and "this
    // prop still accepts anything, and here is what tsc checks instead" is
    // a real difference to a consumer, and only the first rejects something
    // that used to validate.
    const described = diffPassthroughSchema(
      { properties: { render: {} } },
      { properties: { render: { description: 'TS: ReactNode. Not expressible in JSON Schema, checked by tsc.' } } },
    );
    expect(described).toEqual({ added: [], removed: [], narrowed: [], compatible: true });

    const reworded = diffPassthroughSchema(
      { properties: { render: { description: 'TS: ReactNode. Not expressible in JSON Schema, checked by tsc.' } } },
      { properties: { render: { description: 'TS: ReactElement. Not expressible in JSON Schema, checked by tsc.' } } },
    );
    expect(reworded.compatible).toBe(true);
  });

  it('is compatible when a type or enum constraint is removed entirely, not merely widened', () => {
    const typeLifted = diffPassthroughSchema({ properties: { render: { type: 'string' } } }, { properties: { render: {} } });
    expect(typeLifted).toEqual({ added: [], removed: [], narrowed: [], compatible: true });

    const enumLifted = diffPassthroughSchema(
      { properties: { variant: { type: 'string', enum: ['a', 'b'] } } },
      { properties: { variant: { type: 'string' } } },
    );
    expect(enumLifted).toEqual({ added: [], removed: [], narrowed: [], compatible: true });
  });

  it('is incompatible when a forwarded prop becomes required, whether it existed as optional before or arrives required', () => {
    const becameRequired = diffPassthroughSchema(
      { properties: { autoFocus: { type: 'boolean' } } },
      { properties: { autoFocus: { type: 'boolean' } }, required: ['autoFocus'] },
    );
    expect(becameRequired.narrowed).toEqual([{ prop: 'autoFocus', reason: 'became required where it was optional (or absent) before' }]);
    expect(becameRequired.compatible).toBe(false);

    // A prop that is new AND required in the same step rejects every old
    // call site just as hard as a tightened optional one, so it must not
    // ride in on `added` (which alone never fails the check).
    const addedRequired = diffPassthroughSchema({ properties: {}, required: [] }, { properties: { id: { type: 'string' } }, required: ['id'] });
    expect(addedRequired.added).toEqual(['id']);
    expect(addedRequired.narrowed).toEqual([{ prop: 'id', reason: 'became required where it was optional (or absent) before' }]);
    expect(addedRequired.compatible).toBe(false);

    const stayedRequired = diffPassthroughSchema(
      { properties: { autoFocus: { type: 'boolean' } }, required: ['autoFocus'] },
      { properties: { autoFocus: { type: 'boolean' } }, required: ['autoFocus'] },
    );
    expect(stayedRequired.compatible).toBe(true);
  });
});

describe('diffOwnPropsSchema', () => {
  it('is compatible when nothing was removed and nothing newly became required', () => {
    const diff = diffOwnPropsSchema({ properties: { label: {} }, required: [] }, { properties: { label: {}, icon: {} }, required: [] });
    expect(diff).toEqual({ removedProps: [], newlyRequiredProps: [], compatible: true });
  });

  it('reports a removed own prop regardless of whether it was required', () => {
    const diff = diffOwnPropsSchema({ properties: { label: {}, icon: {} }, required: [] }, { properties: { label: {} }, required: [] });
    expect(diff.removedProps).toEqual(['icon']);
    expect(diff.compatible).toBe(false);
  });

  it('reports a prop that newly became required, whether it is new or pre-existing', () => {
    const diff = diffOwnPropsSchema(
      { properties: { label: {} }, required: [] },
      { properties: { label: {}, id: {} }, required: ['label', 'id'] },
    );
    expect(diff.newlyRequiredProps.sort()).toEqual(['id', 'label']);
    expect(diff.compatible).toBe(false);
  });

  it('is unaffected by a prop that was already required and stays required', () => {
    const diff = diffOwnPropsSchema({ properties: { label: {} }, required: ['label'] }, { properties: { label: {} }, required: ['label'] });
    expect(diff).toEqual({ removedProps: [], newlyRequiredProps: [], compatible: true });
  });

  it('is unaffected by a slot prop that only gains prose naming its TypeScript type', () => {
    const diff = diffOwnPropsSchema(
      { properties: { icon: {} }, required: [] },
      { properties: { icon: { description: 'TS: ReactNode. Not expressible in JSON Schema, checked by tsc.' } }, required: [] },
    );
    expect(diff).toEqual({ removedProps: [], newlyRequiredProps: [], compatible: true });
  });
});

describe('decideCompat', () => {
  const base = { component: 'button', oldMajor: 1, newMajor: 1, gtsBackwardCompatible: true, gtsBackwardErrors: [] };

  it('passes when nothing is incompatible', () => {
    expect(decideCompat(base).status).toBe('pass');
  });

  it('fails a backward-incompatible schema change at an unchanged major', () => {
    const verdict = decideCompat({ ...base, gtsBackwardCompatible: false, gtsBackwardErrors: ["Required property 'foo' removed in new schema"] });
    expect(verdict.status).toBe('fail');
    expect(verdict.notes[0]).toContain('unchanged');
  });

  it('passes a backward-incompatible schema change when the major moved, with a note', () => {
    const verdict = decideCompat({ ...base, newMajor: 2, gtsBackwardCompatible: false, gtsBackwardErrors: ['type changed'] });
    expect(verdict.status).toBe('pass');
    expect(verdict.notes[0]).toContain('v1 -> v2');
  });

  it('fails on an incompatible passthrough diff alone, even when the schema-level check is clean', () => {
    const verdict = decideCompat({
      ...base,
      passthroughDiff: { added: [], removed: ['form'], narrowed: [], compatible: false },
    });
    expect(verdict.status).toBe('fail');
    expect(verdict.notes[0]).toContain('passthrough: prop "form" removed');
  });

  it('fails on an incompatible own-props diff alone, even when gts-ts reports backward compatible', () => {
    const verdict = decideCompat({
      ...base,
      ownPropsDiff: { removedProps: [], newlyRequiredProps: ['id'], compatible: false },
    });
    expect(verdict.status).toBe('fail');
    expect(verdict.notes[0]).toContain('own prop "id" became required');
  });
});

describe('extractContractMajor / synthesizeVersionedId', () => {
  const id = 'gts.frontx.uikit.base.component.v1~frontx.uikit.component.button.v1~';

  it('reads the major off the trailing version segment', () => {
    expect(extractContractMajor(id)).toBe(1);
  });

  it('synthesizes a distinct, still-major-1 id by inserting a minor before the trailing tilde', () => {
    const synthetic = synthesizeVersionedId(id, 0);
    expect(synthetic).toBe('gts.frontx.uikit.base.component.v1~frontx.uikit.component.button.v1.0~');
    expect(extractContractMajor(synthetic)).toBe(1);
  });

  it('produces distinct ids for distinct minors, so old and new never collide in one store', () => {
    expect(synthesizeVersionedId(id, 0)).not.toBe(synthesizeVersionedId(id, 1));
  });
});

describe('mapChangedFilesToComponents', () => {
  it('maps a component file to its directory name', () => {
    expect(mapChangedFilesToComponents(['src/components/button/button.tsx'])).toEqual(new Set(['button']));
  });

  it('ignores files outside src/components', () => {
    expect(mapChangedFilesToComponents(['package.json', 'scripts/contracts/compile.ts'])).toEqual(new Set());
  });

  it('collects every distinct component touched, de-duplicated', () => {
    const files = ['src/components/button/button.tsx', 'src/components/button/button.contract.yaml', 'src/components/accordion/accordion.tsx'];
    expect(mapChangedFilesToComponents(files)).toEqual(new Set(['button', 'accordion']));
  });
});

describe('skippedPassthroughNote', () => {
  it('reports a skipped signal when the base has passthrough types but none for this origin', () => {
    expect(skippedPassthroughNote('button', 'base_ui_button', false, true)).toBe(
      'button: inherited-surface signal skipped - the base ref carries no passthrough type for origin "base_ui_button"',
    );
  });

  it('is silent when the base carries the origin\'s own file', () => {
    expect(skippedPassthroughNote('button', 'base_ui_button', true, true)).toBeUndefined();
  });

  it('is silent when the base carries no passthrough type at all', () => {
    expect(skippedPassthroughNote('button', 'base_ui_button', false, false)).toBeUndefined();
  });
});

describe('touchesSharedContractTooling', () => {
  it('is false when nothing under scripts/contracts changed', () => {
    expect(touchesSharedContractTooling(['src/components/button/button.tsx', 'package.json'])).toBe(false);
  });

  it('is true for the compiler, the extractor, ids, the metamodel and the base schema', () => {
    for (const file of [
      'scripts/contracts/compile.ts',
      'scripts/contracts/extract.ts',
      'scripts/contracts/ids.ts',
      'scripts/contracts/ui-component.meta.json',
      'scripts/contracts/base.component.json',
    ]) {
      expect(touchesSharedContractTooling([file])).toBe(true);
    }
  });

  it('is true for a generated passthrough file', () => {
    expect(touchesSharedContractTooling(['scripts/contracts/generated/passthrough.base_ui_button.json'])).toBe(true);
  });

  // A vocabulary type is referenced by the base type's trait schema and by
  // the metamodel, so changing one reshapes what every covered component is
  // validated against - the same standing as the two files that reference
  // it, which this list already covers.
  it('is true for a vocabulary type', () => {
    expect(touchesSharedContractTooling(['scripts/contracts/types/trait.dont_use_when_rule.v1.json'])).toBe(true);
  });

  // freshness.ts imports jsonDiff from check-lib.ts, so this module sits on
  // every covered component's comparison path: a change here can flip every
  // freshness verdict without touching a single component directory. Only
  // check.ts - which nothing in that path imports - stays excluded.
  it('is true for the shared comparison logic', () => {
    expect(touchesSharedContractTooling(['scripts/contracts/check-lib.ts'])).toBe(true);
  });

  it('is false for the guard/compat entry point, its own tests, fixtures, covered.json and pilot notes', () => {
    for (const file of [
      'scripts/contracts/check.ts',
      'scripts/contracts/check-lib.test.ts',
      'scripts/contracts/extract.test.ts',
      'scripts/contracts/__fixtures__/cva-aliased.fixture.tsx',
      'scripts/contracts/covered.json',
      'scripts/contracts/PILOT-NOTES.md',
    ]) {
      expect(touchesSharedContractTooling([file])).toBe(false);
    }
  });
});

describe('resolveRenameSource', () => {
  const baseContracts = [
    { path: 'src/components/accordion/accordion-item.contract.json', id: 'gts://gts.frontx.uikit.base.component.v1~frontx.uikit.component.accordion_item.v1~', stem: 'accordion-item' },
  ];

  it('prefers gits own rename detection when it named a source path', () => {
    const source = resolveRenameSource({
      currentPath: 'src/components/accordion/accordion-part.contract.json',
      currentId: 'gts://gts.frontx.uikit.base.component.v1~frontx.uikit.component.accordion_part.v1~',
      currentStem: 'accordion-part',
      renamedFrom: 'src/components/accordion/accordion-item.contract.json',
      baseContracts,
    });
    expect(source).toBe('src/components/accordion/accordion-item.contract.json');
  });

  it('falls back to matching by $id when git named no rename source', () => {
    const source = resolveRenameSource({
      currentPath: 'src/components/accordion-part/accordion-item.contract.json',
      currentId: 'gts://gts.frontx.uikit.base.component.v1~frontx.uikit.component.accordion_item.v1~',
      currentStem: 'accordion-item',
      baseContracts,
    });
    expect(source).toBe('src/components/accordion/accordion-item.contract.json');
  });

  it('falls back to matching by stem when neither rename detection nor $id matched', () => {
    const source = resolveRenameSource({
      currentPath: 'src/components/accordion-v2/accordion-item.contract.json',
      currentId: 'gts://gts.frontx.uikit.base.component.v1~frontx.uikit.component.accordion_item.v2~',
      currentStem: 'accordion-item',
      baseContracts,
    });
    expect(source).toBe('src/components/accordion/accordion-item.contract.json');
  });

  it('is undefined when nothing at the base ref matches by any signal - genuinely new', () => {
    const source = resolveRenameSource({
      currentPath: 'src/components/data-table/data-table.contract.json',
      currentId: 'gts://gts.frontx.uikit.base.component.v1~frontx.uikit.component.data_table.v1~',
      currentStem: 'data-table',
      baseContracts,
    });
    expect(source).toBeUndefined();
  });
});

describe('evaluateGuard', () => {
  it('is informational, not a violation, for a touched component outside covered.json', () => {
    const result = evaluateGuard({ component: 'accordion', covered: false, overlayExists: false, artifactsFresh: false });
    expect(result.status).toBe('uncovered-info');
  });

  it('violates when a covered component has no overlay', () => {
    const result = evaluateGuard({ component: 'button', covered: true, overlayExists: false, artifactsFresh: false });
    expect(result.status).toBe('covered-violation');
    expect(result.message).toContain('no button.contract.yaml overlay');
  });

  it('violates when a covered component with an overlay has stale artifacts', () => {
    const result = evaluateGuard({ component: 'button', covered: true, overlayExists: true, artifactsFresh: false });
    expect(result.status).toBe('covered-violation');
    expect(result.message).toContain('stale');
  });

  it('passes when a covered component has an overlay and fresh artifacts', () => {
    const result = evaluateGuard({ component: 'button', covered: true, overlayExists: true, artifactsFresh: true });
    expect(result.status).toBe('covered-ok');
  });

  it('violates with a fix hint when a covered component directory was removed', () => {
    const result = evaluateGuard({ component: 'button', covered: true, overlayExists: false, artifactsFresh: false, componentExists: false });
    expect(result.status).toBe('component-removed');
    expect(result.message).toContain('remove it from covered.json');
  });

  it('is informational, not a violation, when a removed component was never covered', () => {
    const result = evaluateGuard({ component: 'button', covered: false, overlayExists: false, artifactsFresh: false, componentExists: false });
    expect(result.status).toBe('uncovered-info');
  });
});

describe('buildCoverageReport', () => {
  it('counts covered vs total and lists the rest, sorted', () => {
    const report = buildCoverageReport(['button', 'accordion', 'alert'], ['button']);
    expect(report).toEqual({ total: 3, coveredCount: 1, uncovered: ['accordion', 'alert'], unknownCovered: [] });
  });

  it('does not count an allowlist entry that names no component directory', () => {
    // The number the report exists to give is how much of the kit is
    // described; an entry pointing at nothing describes nothing, and used to
    // be indistinguishable from a real one.
    const report = buildCoverageReport(['button', 'alert'], ['button', 'ghost-component']);
    expect(report.coveredCount).toBe(1);
    expect(report.unknownCovered).toEqual(['ghost-component']);
  });
});
