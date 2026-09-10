// Unit tests for check-lib.ts's pure decision logic - every input here is
// an in-memory fixture, never a git ref or a file on disk, so these run
// without a checked-out history and stay fast. check.ts's own git/gts-ts
// wiring is exercised for real by running `npm run contracts:check` against
// origin/develop (see the T4 report), not by a unit test here.
import { describe, expect, it } from 'vitest';

import {
  buildEnrollmentReport,
  classifyProps,
  compareElementSurfaces,
  decideCompat,
  diffInvariants,
  diffOwnPropsSchema,
  diffElementSurface,
  evaluateGuard,
  extractContractMajor,
  jsonDiff,
  mapChangedFilesToComponents,
  resolveRenameSource,
  synthesizeVersionedId,
  touchesAnyOverlay,
  touchesDependencyManifest,
  touchesSharedContractTooling,
  undeclaredForwardedProps,
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

describe('diffElementSurface', () => {
  it('is compatible when a prop is only added', () => {
    const diff = diffElementSurface({ properties: { disabled: { type: 'boolean' } } }, { properties: { disabled: { type: 'boolean' }, form: { type: 'string' } } });
    expect(diff).toEqual({ added: ['form'], removed: [], addedPatterns: [], removedPatterns: [], narrowed: [], compatible: true });
  });

  it('is incompatible when a prop is removed', () => {
    const diff = diffElementSurface(
      { properties: { disabled: { type: 'boolean' }, form: { type: 'string' } } },
      { properties: { disabled: { type: 'boolean' } } },
    );
    expect(diff.removed).toEqual(['form']);
    expect(diff.compatible).toBe(false);
  });

  it('is incompatible when a shared prop changes type', () => {
    const diff = diffElementSurface({ properties: { size: { type: 'number' } } }, { properties: { size: { type: 'string' } } });
    expect(diff.narrowed).toEqual([{ prop: 'size', reason: 'type changed from "number" to "string"' }]);
    expect(diff.compatible).toBe(false);
  });

  it('is incompatible when an enum value is dropped, but not when one is only added', () => {
    const dropped = diffElementSurface(
      { properties: { variant: { type: 'string', enum: ['a', 'b'] } } },
      { properties: { variant: { type: 'string', enum: ['a'] } } },
    );
    expect(dropped.narrowed).toEqual([{ prop: 'variant', reason: 'enum value(s) removed: b' }]);

    const widened = diffElementSurface(
      { properties: { variant: { type: 'string', enum: ['a'] } } },
      { properties: { variant: { type: 'string', enum: ['a', 'b'] } } },
    );
    expect(widened.compatible).toBe(true);
  });

  it('is incompatible when an unconstrained prop gains an enum', () => {
    const diff = diffElementSurface(
      { properties: { variant: { type: 'string' } } },
      { properties: { variant: { type: 'string', enum: ['primary'] } } },
    );
    expect(diff.narrowed).toEqual([{ prop: 'variant', reason: 'enum constraint added: primary where none existed before' }]);
    expect(diff.compatible).toBe(false);
  });

  it('is incompatible when an untyped prop gains a type', () => {
    const diff = diffElementSurface({ properties: { render: {} } }, { properties: { render: { type: 'string' } } });
    expect(diff.narrowed).toEqual([{ prop: 'render', reason: 'type constraint added: "string" where none existed before' }]);
    expect(diff.compatible).toBe(false);
  });

  it('is compatible when an unconstrained prop only gains prose naming its TypeScript type', () => {
    // The pairing of this case with the one above is the whole point: the
    // difference between "this prop now only accepts a string" and "this
    // prop still accepts anything, and here is what tsc checks instead" is
    // a real difference to a consumer, and only the first rejects something
    // that used to validate.
    const described = diffElementSurface(
      { properties: { render: {} } },
      { properties: { render: { description: 'TS: ReactNode. Not expressible in JSON Schema, checked by tsc.' } } },
    );
    expect(described).toEqual({ added: [], removed: [], addedPatterns: [], removedPatterns: [], narrowed: [], compatible: true });

    const reworded = diffElementSurface(
      { properties: { render: { description: 'TS: ReactNode. Not expressible in JSON Schema, checked by tsc.' } } },
      { properties: { render: { description: 'TS: ReactElement. Not expressible in JSON Schema, checked by tsc.' } } },
    );
    expect(reworded.compatible).toBe(true);
  });

  it('is compatible when a type or enum constraint is removed entirely, not merely widened', () => {
    const typeLifted = diffElementSurface({ properties: { render: { type: 'string' } } }, { properties: { render: {} } });
    expect(typeLifted).toEqual({ added: [], removed: [], addedPatterns: [], removedPatterns: [], narrowed: [], compatible: true });

    const enumLifted = diffElementSurface(
      { properties: { variant: { type: 'string', enum: ['a', 'b'] } } },
      { properties: { variant: { type: 'string' } } },
    );
    expect(enumLifted).toEqual({ added: [], removed: [], addedPatterns: [], removedPatterns: [], narrowed: [], compatible: true });
  });

  it('is incompatible when a forwarded prop becomes required, whether it existed as optional before or arrives required', () => {
    const becameRequired = diffElementSurface(
      { properties: { autoFocus: { type: 'boolean' } } },
      { properties: { autoFocus: { type: 'boolean' } }, required: ['autoFocus'] },
    );
    expect(becameRequired.narrowed).toEqual([{ prop: 'autoFocus', reason: 'became required where it was optional (or absent) before' }]);
    expect(becameRequired.compatible).toBe(false);

    // A prop that is new AND required in the same step rejects every old
    // call site just as hard as a tightened optional one, so it must not
    // ride in on `added` (which alone never fails the check).
    const addedRequired = diffElementSurface({ properties: {}, required: [] }, { properties: { id: { type: 'string' } }, required: ['id'] });
    expect(addedRequired.added).toEqual(['id']);
    expect(addedRequired.narrowed).toEqual([{ prop: 'id', reason: 'became required where it was optional (or absent) before' }]);
    expect(addedRequired.compatible).toBe(false);

    const stayedRequired = diffElementSurface(
      { properties: { autoFocus: { type: 'boolean' } }, required: ['autoFocus'] },
      { properties: { autoFocus: { type: 'boolean' } }, required: ['autoFocus'] },
    );
    expect(stayedRequired.compatible).toBe(true);
  });

  it('is incompatible when a pattern family is removed, and compatible when one only arrives', () => {
    // Deleting `^on[A-Z]` from a <button>'s surface stops it accepting every
    // React event handler at once, while `properties` and `required` stay
    // byte-identical - the half of the surface the comparison used to skip.
    const surface = {
      properties: { disabled: { type: 'boolean' } },
      patternProperties: { '^aria-': {}, '^data-': {}, '^on[A-Z]': {} },
    };
    const dropped = diffElementSurface(surface, {
      properties: { disabled: { type: 'boolean' } },
      patternProperties: { '^aria-': {}, '^data-': {} },
    });
    expect(dropped.removed).toEqual([]);
    expect(dropped.removedPatterns).toEqual(['^on[A-Z]']);
    expect(dropped.compatible).toBe(false);

    const arrived = diffElementSurface({ properties: { disabled: { type: 'boolean' } } }, surface);
    expect(arrived.addedPatterns).toEqual(['^aria-', '^data-', '^on[A-Z]']);
    expect(arrived.compatible).toBe(true);
  });

  it('reads a narrowed pattern family as the removal it is', () => {
    // A family is its source string: rewriting `^on[A-Z]` as `^onC` accepts
    // a strict subset of what it used to, and there is no partial-match
    // reading of two regular expressions that a compatibility answer could
    // rest on - so the old source is gone and the new one is new.
    const diff = diffElementSurface({ patternProperties: { '^on[A-Z]': {} } }, { patternProperties: { '^onC': {} } });
    expect(diff.removedPatterns).toEqual(['^on[A-Z]']);
    expect(diff.addedPatterns).toEqual(['^onC']);
    expect(diff.compatible).toBe(false);
  });
});

describe('diffOwnPropsSchema', () => {
  it('is compatible when nothing was removed and nothing newly became required', () => {
    const diff = diffOwnPropsSchema({ properties: { label: {} }, required: [] }, { properties: { label: {}, icon: {} }, required: [] });
    expect(diff).toEqual({ removedProps: [], newlyRequiredProps: [], narrowedProps: [], movedToForwardedSurface: [], compatible: true });
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
    expect(diff).toEqual({ removedProps: [], newlyRequiredProps: [], narrowedProps: [], movedToForwardedSurface: [], compatible: true });
  });

  it('is unaffected by a slot prop that only gains prose naming its TypeScript type', () => {
    const diff = diffOwnPropsSchema(
      { properties: { icon: {} }, required: [] },
      { properties: { icon: { description: 'TS: ReactNode. Not expressible in JSON Schema, checked by tsc.' } }, required: [] },
    );
    expect(diff).toEqual({ removedProps: [], newlyRequiredProps: [], narrowedProps: [], movedToForwardedSurface: [], compatible: true });
  });
});

describe('decideCompat', () => {
  const base = { component: 'button', oldMajor: 1, newMajor: 1, gtsBackwardCompatible: true, gtsBackwardErrors: [] };

  it('passes when nothing is incompatible', () => {
    expect(decideCompat(base).decision).toBe('pass');
  });

  it('fails a backward-incompatible schema change at an unchanged major', () => {
    const decision = decideCompat({ ...base, gtsBackwardCompatible: false, gtsBackwardErrors: ["Required property 'foo' removed in new schema"] });
    expect(decision.decision).toBe('fail');
    expect(decision.notes[0]).toContain('unchanged');
  });

  it('passes a backward-incompatible schema change when the major moved, with a note', () => {
    const decision = decideCompat({ ...base, newMajor: 2, gtsBackwardCompatible: false, gtsBackwardErrors: ['type changed'] });
    expect(decision.decision).toBe('pass');
    expect(decision.notes[0]).toContain('v1 -> v2');
  });

  it('fails on an incompatible element-surface diff alone, even when the schema-level check is clean', () => {
    const decision = decideCompat({
      ...base,
      elementSurfaceDiff: { added: [], removed: ['form'], addedPatterns: [], removedPatterns: [], narrowed: [], compatible: false },
    });
    expect(decision.decision).toBe('fail');
    expect(decision.notes[0]).toContain('element surface: prop "form" removed');
  });

  it('fails on a removed pattern family, and says what the family stopped accepting', () => {
    const decision = decideCompat({
      ...base,
      elementSurfaceDiff: { added: [], removed: [], addedPatterns: [], removedPatterns: ['^on[A-Z]'], narrowed: [], compatible: false },
    });
    expect(decision.decision).toBe('fail');
    expect(decision.notes[0]).toContain('element surface: pattern family "^on[A-Z]" removed');
  });

  it('fails on a removed invariant id, and reports a changed-text id informationally either way', () => {
    // A removed id breaks the promise base.component.json's own description
    // states ("never reused after removal") - a lint finding or an eval
    // citing it now resolves to nothing, the same failure mode a removed
    // prop has for a caller.
    const removed = decideCompat({
      ...base,
      invariantsDiff: { removedIds: ['icon-only-needs-label'], changedTextIds: [], compatible: false },
    });
    expect(removed.decision).toBe('fail');
    expect(removed.notes[0]).toContain('invariant "icon-only-needs-label" removed');

    // Text changing under the SAME id is not a break: nothing that cites the
    // id stops resolving, so it is a note, not a reason to fail, and it
    // shows up whichever way the decision goes.
    const passingWithNote = decideCompat({
      ...base,
      invariantsDiff: { removedIds: [], changedTextIds: ['icon-only-needs-label'], compatible: true },
    });
    expect(passingWithNote.decision).toBe('pass');
    expect(passingWithNote.notes.some((note) => note.includes('invariant "icon-only-needs-label" text changed'))).toBe(true);
  });

  it('diffInvariants: an id gone at the new revision is removed, and a same-id text edit is a change, not a removal', () => {
    const oldInvariants = [
      { id: 'icon-only-needs-label', text: 'Icon-only buttons need an aria-label.' },
      { id: 'loading-disables-interaction', text: 'A loading button ignores clicks.' },
    ];
    const newInvariants = [
      { id: 'icon-only-needs-label', text: 'Icon-only buttons require an accessible label via aria-label.' },
    ];
    const diff = diffInvariants(oldInvariants, newInvariants);
    expect(diff.removedIds).toEqual(['loading-disables-interaction']);
    expect(diff.changedTextIds).toEqual(['icon-only-needs-label']);
    expect(diff.compatible).toBe(false);
  });

  it('fails on an incompatible own-props diff alone, even when gts-ts reports backward compatible', () => {
    const decision = decideCompat({
      ...base,
      ownPropsDiff: { removedProps: [], newlyRequiredProps: ['id'], narrowedProps: [], movedToForwardedSurface: [], compatible: false },
    });
    expect(decision.decision).toBe('fail');
    expect(decision.notes[0]).toContain('own prop "id" became required');
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

describe('compareElementSurfaces', () => {
  const surface = { properties: { className: { type: 'string' }, disabled: { type: 'boolean' } }, required: [] };

  it('has nothing to compare when neither revision forwards anything', () => {
    expect(compareElementSurfaces({ component: 'data-table' })).toEqual({});
  });

  it('reports nothing when only the current revision forwards - an arriving surface only widens', () => {
    expect(compareElementSurfaces({ component: 'button', newElement: 'dom_button', newSchema: surface })).toEqual({});
  });

  it('reports every forwarded prop as removed when the contract stops composing a surface', () => {
    // The defect this branch exists for: reading the element off the new
    // contract alone left nothing to look up, so the block was skipped and
    // every forwarded prop disappeared under a PASS.
    const { diff, note } = compareElementSurfaces({ component: 'button', oldElement: 'dom_button', oldSchema: surface });
    expect(diff?.removed).toEqual(['className', 'disabled']);
    expect(diff?.compatible).toBe(false);
    expect(note).toContain('no longer names the forwarded surface');
  });

  it('compares across a change of host element, naming the move', () => {
    const { diff, note } = compareElementSurfaces({
      component: 'button',
      oldElement: 'dom_button',
      newElement: 'dom_div',
      oldSchema: surface,
      newSchema: { properties: { className: { type: 'string' } }, required: [] },
    });
    expect(diff?.removed).toEqual(['disabled']);
    expect(note).toContain('host element moved "dom_button" -> "dom_div"');
  });

  it('says nothing about a move when the element is unchanged', () => {
    const { diff, note } = compareElementSurfaces({
      component: 'button',
      oldElement: 'dom_button',
      newElement: 'dom_button',
      oldSchema: surface,
      newSchema: surface,
    });
    expect(diff?.compatible).toBe(true);
    expect(note).toBeUndefined();
  });

  it('reports a skipped signal for a surface it genuinely cannot read', () => {
    const missingAtBase = compareElementSurfaces({ component: 'button', oldElement: 'dom_button', newElement: 'dom_button', newSchema: surface });
    expect(missingAtBase.diff).toBeUndefined();
    expect(missingAtBase.note).toContain('the base ref carries no committed surface for element "dom_button"');
    const missingHere = compareElementSurfaces({ component: 'button', oldElement: 'dom_button', newElement: 'dom_div', oldSchema: surface });
    expect(missingHere.note).toContain('no committed surface for element "dom_div"');
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

  it('is true for a hand-written element-surface type', () => {
    // Shared kit-wide: one edit here changes what every component rendering
    // that element forwards, in every one of their contracts.
    expect(touchesSharedContractTooling(['scripts/contracts/elements/dom_button.json'])).toBe(true);
  });

  // A vocabulary type is referenced by the base type's x-gts-traits-schema and by
  // the metamodel, so changing one reshapes what every enrolled component is
  // validated against - the same standing as the two files that reference
  // it, which this list already covers.
  it('is true for a vocabulary type', () => {
    expect(touchesSharedContractTooling(['scripts/contracts/vocabulary/dont_use_when_rule.v1.json'])).toBe(true);
  });

  // freshness.ts imports jsonDiff from check-lib.ts, so this module sits on
  // every enrolled component's comparison path: a change here can flip every
  // freshness decision without touching a single component directory. Only
  // check.ts - which nothing in that path imports - stays excluded.
  it('is true for the shared comparison logic', () => {
    expect(touchesSharedContractTooling(['scripts/contracts/check-lib.ts'])).toBe(true);
  });

  it('is false for the guard/compat entry point, any test file, fixtures, enrolled.json and pilot notes', () => {
    // The entry point is named in the exclusion set; a test file is excluded
    // by its suffix, which is why naming one in that set as well said
    // nothing and it no longer does.
    for (const file of [
      'scripts/contracts/check.ts',
      'scripts/contracts/check-lib.test.ts',
      'scripts/contracts/extract.test.ts',
      'scripts/contracts/__fixtures__/cva-aliased.fixture.tsx',
      'scripts/contracts/enrolled.json',
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
  it('is informational, not a violation, for a touched component outside enrolled.json', () => {
    const result = evaluateGuard({ component: 'accordion', enrolled: false, overlayExists: false, artifactsFresh: false });
    expect(result.status).toBe('unenrolled-info');
  });

  it('violates when a enrolled component has no overlay', () => {
    const result = evaluateGuard({ component: 'button', enrolled: true, overlayExists: false, artifactsFresh: false });
    expect(result.status).toBe('enrolled-violation');
    expect(result.message).toContain('no button.contract.yaml overlay');
  });

  it('violates when a enrolled component with an overlay has stale artifacts', () => {
    const result = evaluateGuard({ component: 'button', enrolled: true, overlayExists: true, artifactsFresh: false });
    expect(result.status).toBe('enrolled-violation');
    expect(result.message).toContain('stale');
  });

  it('passes when a enrolled component has an overlay and fresh artifacts', () => {
    const result = evaluateGuard({ component: 'button', enrolled: true, overlayExists: true, artifactsFresh: true });
    expect(result.status).toBe('enrolled-ok');
  });

  it('violates with a fix hint when a enrolled component directory was removed', () => {
    const result = evaluateGuard({ component: 'button', enrolled: true, overlayExists: false, artifactsFresh: false, componentExists: false });
    expect(result.status).toBe('component-removed');
    expect(result.message).toContain('remove it from enrolled.json');
  });

  it('is informational, not a violation, when a removed component was never enrolled', () => {
    const result = evaluateGuard({ component: 'button', enrolled: false, overlayExists: false, artifactsFresh: false, componentExists: false });
    expect(result.status).toBe('unenrolled-info');
  });
});

describe('buildEnrollmentReport', () => {
  it('counts enrolled vs total and lists the rest, sorted', () => {
    const report = buildEnrollmentReport(['button', 'accordion', 'alert'], ['button']);
    expect(report).toEqual({ total: 3, enrolledCount: 1, unenrolled: ['accordion', 'alert'], unknownEnrolled: [] });
  });

  it('does not count an allowlist entry that names no component directory', () => {
    // The number the report exists to give is how much of the kit is
    // described; an entry pointing at nothing describes nothing, and used to
    // be indistinguishable from a real one.
    const report = buildEnrollmentReport(['button', 'alert'], ['button', 'ghost-component']);
    expect(report.enrolledCount).toBe(1);
    expect(report.unknownEnrolled).toEqual(['ghost-component']);
  });
});

describe('touchesAnyOverlay', () => {
  // The widening the derived `parent` made necessary: a children list decides
  // another component's parent, so an overlay edit can move a contract in a
  // directory the change never touched.
  it('is true for an overlay under any component directory', () => {
    expect(touchesAnyOverlay(['src/components/accordion/accordion.contract.yaml'])).toBe(true);
  });

  it('is false for the artifacts an overlay compiles into, and for anything else', () => {
    // The compiled JSON is downstream of the overlay, so it never widens on
    // its own - the guard is about what a change could still make stale.
    for (const file of [
      'src/components/accordion/accordion.contract.json',
      'src/components/accordion/accordion.contract.instance.json',
      'src/components/accordion/accordion.tsx',
      'scripts/contracts/compile.ts',
    ]) {
      expect(touchesAnyOverlay([file]), file).toBe(false);
    }
  });

  it('is false for a localized overlay copy, which no compile ever reads', () => {
    expect(touchesAnyOverlay(['src/components/button/button.contract.ru.yaml'])).toBe(false);
  });
});

describe('classifyProps', () => {
  // The report that replaced `unevaluatedProperties: false`. The pure half is
  // here; button.contract.test.ts drives it against a real contract and its
  // real element surface.
  const contract = { properties: { variant: {}, size: {}, loading: {} } };
  const elementSurface = {
    properties: { className: {}, title: {} },
    patternProperties: { '^aria-': {}, '^data-': {}, '^on[A-Z]': {} },
  };

  it('counts a contract prop, an element attribute and a pattern match as known', () => {
    const report = classifyProps({ variant: 'ghost', title: 'x', 'aria-label': 'y', onClick: () => {} }, contract, elementSurface);
    expect(report.known).toEqual(['aria-label', 'onClick', 'title', 'variant']);
    expect(report.unchecked).toEqual([]);
  });

  it('reports a name nothing accounts for as unchecked, not as an error', () => {
    const report = classifyProps({ tooltip: 'x' }, contract, elementSurface);
    expect(report.unchecked).toEqual(['tooltip']);
    expect(report.nearMiss).toEqual([]);
  });

  it('upgrades a one-edit miss of a contract prop to a near miss', () => {
    // One edit each way: a substitution, an insertion and a deletion.
    for (const [typo, real] of [
      ['varient', 'variant'],
      ['variantt', 'variant'],
      ['varant', 'variant'],
    ] as const) {
      const report = classifyProps({ [typo]: 'ghost' }, contract, elementSurface);
      expect(report.nearMiss, typo).toEqual([{ prop: typo, probably: real }]);
    }
  });

  it('leaves a two-edit miss unchecked - a guess that far off is noise', () => {
    const report = classifyProps({ varant: 'ghost', vrient: 'ghost' }, contract, elementSurface);
    expect(report.nearMiss.map((entry) => entry.prop)).toEqual(['varant']);
    expect(report.unchecked).toEqual(['varant', 'vrient']);
  });

  it('decides a near miss of a contract prop before a surface pattern can claim the name', () => {
    // `^on[A-Z]` matches `onValuechange` as readily as the real
    // `onValueChange`, so a pattern consulted first answered "known" to a
    // typo in the one half of the contract this report exists to protect.
    const handlers = { properties: { onValueChange: {}, variant: {} } };
    const report = classifyProps({ onValuechange: () => {} }, handlers, elementSurface);
    expect(report.known).toEqual([]);
    expect(report.unchecked).toEqual(['onValuechange']);
    expect(report.nearMiss).toEqual([{ prop: 'onValuechange', probably: 'onValueChange' }]);
  });

  it('still counts a pattern match no contract prop is one edit from as known', () => {
    const report = classifyProps({ onFocus: () => {}, 'data-testid': 'x' }, contract, elementSurface);
    expect(report.known).toEqual(['data-testid', 'onFocus']);
    expect(report.unchecked).toEqual([]);
  });

  it('does not treat a near-miss of an element attribute as a near miss', () => {
    // A typo in a DOM attribute is React's business; reporting it here would
    // make the report noisier than the closure it replaced.
    const report = classifyProps({ titl: 'x' }, contract, elementSurface);
    expect(report.unchecked).toEqual(['titl']);
    expect(report.nearMiss).toEqual([]);
  });

  it('works with no element surface at all - a component that forwards nothing', () => {
    const report = classifyProps({ variant: 'ghost', className: 'x' }, contract);
    expect(report.known).toEqual(['variant']);
    expect(report.unchecked).toEqual(['className']);
  });
});

describe('undeclaredForwardedProps', () => {
  // The gap the enrollment report prints: a surface is hand-written, so its
  // completeness is nobody's check, and an attribute no file names reaches a
  // consumer as unknown rather than as rejected. Reported so the gap is
  // visible; no exit code is derived from it.
  const surface = {
    properties: { className: { type: 'string' }, disabled: { type: 'boolean' } },
    patternProperties: { '^aria-': {}, '^on[A-Z]': {} },
  };

  it('names a forwarded prop the surface declares by neither name nor pattern', () => {
    expect(undeclaredForwardedProps(['formAction', 'className', 'onClick', 'aria-label', 'dir'], surface)).toEqual([
      'dir',
      'formAction',
    ]);
  });

  it('names every forwarded prop when there is no surface at all', () => {
    expect(undeclaredForwardedProps(['className'])).toEqual(['className']);
  });
});

describe('diffOwnPropsSchema: narrowing and the forwarded surface', () => {
  const surface = {
    properties: { className: { type: 'string' }, style: {} },
    patternProperties: { '^aria-': {}, '^data-': {}, '^on[A-Z]': {} },
  };

  it('reports an enum appearing on a prop that already carried its type', () => {
    // The one narrowing gts-ts's own backward check calls compatible
    // (measured, see check-lib.compat-e2e.test.ts): every value outside the
    // new union stops validating, and this is the shape the compiler emits
    // the day a plain `string` prop becomes a literal union.
    const diff = diffOwnPropsSchema(
      { properties: { tone: { type: 'string' } } },
      { properties: { tone: { type: 'string', enum: ['info', 'warning'] } } },
    );
    expect(diff.compatible).toBe(false);
    expect(diff.narrowedProps).toEqual([
      { prop: 'tone', reason: 'enum constraint added: info, warning where none existed before' },
    ]);
  });

  it('reports a dropped enum value and a changed type on an own prop', () => {
    const dropped = diffOwnPropsSchema(
      { properties: { variant: { type: 'string', enum: ['a', 'b'] } } },
      { properties: { variant: { type: 'string', enum: ['a'] } } },
    );
    expect(dropped.narrowedProps).toEqual([{ prop: 'variant', reason: 'enum value(s) removed: b' }]);
    const retyped = diffOwnPropsSchema(
      { properties: { pageSize: { type: 'number' } } },
      { properties: { pageSize: { type: 'string' } } },
    );
    expect(retyped.narrowedProps).toEqual([{ prop: 'pageSize', reason: 'type changed from "number" to "string"' }]);
  });

  it('does not report a constraint lifted entirely - that accepts a superset', () => {
    const diff = diffOwnPropsSchema(
      { properties: { tone: { type: 'string', enum: ['a'] } } },
      { properties: { tone: { type: 'string' } } },
    );
    expect(diff.compatible).toBe(true);
    expect(diff.narrowedProps).toEqual([]);
  });

  it('reconciles a prop that left properties but is still accepted by the forwarded surface', () => {
    // A component dropping its own `className` declaration still forwards
    // `className` to its host element, so nothing a consumer passes stops
    // validating. Reported, because the declaration really did disappear,
    // but not a reason to move the major.
    const diff = diffOwnPropsSchema({ properties: { className: { type: 'string' } } }, { properties: {} }, surface);
    expect(diff.removedProps).toEqual([]);
    expect(diff.movedToForwardedSurface).toEqual(['className']);
    expect(diff.compatible).toBe(true);
  });

  it('reconciles a prop the surface accepts only by pattern', () => {
    const diff = diffOwnPropsSchema({ properties: { 'data-state': {} } }, { properties: {} }, surface);
    expect(diff.movedToForwardedSurface).toEqual(['data-state']);
    expect(diff.compatible).toBe(true);
  });

  it('still reports a narrowing when the surface accepts the name with a stricter shape', () => {
    // Accepted is not the same as accepted unchanged: an own `tone` typed as
    // anything, moved onto a surface entry typed `string`, rejects a number
    // the old contract took.
    const diff = diffOwnPropsSchema({ properties: { className: {} } }, { properties: {} }, surface);
    expect(diff.movedToForwardedSurface).toEqual(['className']);
    expect(diff.narrowedProps).toEqual([
      { prop: 'className', reason: 'type constraint added: "string" where none existed before' },
    ]);
    expect(diff.compatible).toBe(false);
  });

  it('still reports a removal the surface does not account for', () => {
    const diff = diffOwnPropsSchema({ properties: { loading: { type: 'boolean' } } }, { properties: {} }, surface);
    expect(diff.removedProps).toEqual(['loading']);
    expect(diff.movedToForwardedSurface).toEqual([]);
    expect(diff.compatible).toBe(false);
  });

  it('reports a removal as a removal when there is no forwarded surface at all', () => {
    const diff = diffOwnPropsSchema({ properties: { className: { type: 'string' } } }, { properties: {} });
    expect(diff.removedProps).toEqual(['className']);
  });
});

describe('touchesDependencyManifest', () => {
  // The one widening signal that is not about this repository's own code: a
  // committed contract carries the checker's printed type text for the
  // packages it depends on.
  it("is true for the package's own package.json", () => {
    expect(touchesDependencyManifest(['package.json'], [])).toBe(true);
  });

  it('is true for the repository lockfile, which the package-relative listing never shows', () => {
    expect(touchesDependencyManifest([], ['package-lock.json'])).toBe(true);
    expect(touchesDependencyManifest([], ['packages/ui-kit/package-lock.json'])).toBe(true);
  });

  it('is false for anything else, including a package.json somewhere else in the repository', () => {
    expect(touchesDependencyManifest(['src/components/button/button.tsx'], ['packages/api/package.json'])).toBe(false);
  });
});

describe('evaluateGuard: the conformance suite and a de-listing', () => {
  const enrolled = { component: 'button', enrolled: true, overlayExists: true, artifactsFresh: true };

  it('fails a enrolled component that ships no conformance suite', () => {
    const result = evaluateGuard({ ...enrolled, contractTestExists: false });
    expect(result.status).toBe('enrolled-violation');
    expect(result.message).toContain('ships no button.contract.test.ts');
  });

  it('reports a component dropped from the allowlist by this change, without failing', () => {
    const result = evaluateGuard({ ...enrolled, enrolled: false, wasEnrolled: true });
    expect(result.status).toBe('enrollment-dropped');
    expect(result.message).toContain('dropped from enrolled.json by this change');
  });

  it('reports an ordinarily unenrolled component as information, as before', () => {
    const result = evaluateGuard({ ...enrolled, enrolled: false, wasEnrolled: false });
    expect(result.status).toBe('unenrolled-info');
  });

  it('defaults both fields so a caller that states neither means what it always meant', () => {
    expect(evaluateGuard(enrolled).status).toBe('enrolled-ok');
    expect(evaluateGuard({ ...enrolled, enrolled: false }).status).toBe('unenrolled-info');
  });
});
