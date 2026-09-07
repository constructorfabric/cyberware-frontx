// Unit tests for check-lib.ts's pure decision logic - every input here is
// an in-memory fixture, never a git ref or a file on disk, so these run
// without a checked-out history and stay fast. check.ts's own git/gts-ts
// wiring is exercised for real by running `npm run contracts:check` against
// origin/develop (see the T4 report), not by a unit test here.
import { describe, expect, it } from 'vitest';

import {
  buildCoverageReport,
  decideCompat,
  diffPassthroughSchema,
  evaluateGuard,
  extractContractMajor,
  jsonDiff,
  mapChangedFilesToComponents,
  synthesizeVersionedId,
} from './check-lib';

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
});

describe('buildCoverageReport', () => {
  it('counts covered vs total and lists the rest, sorted', () => {
    const report = buildCoverageReport(['button', 'accordion', 'alert'], ['button']);
    expect(report).toEqual({ total: 3, coveredCount: 1, uncovered: ['accordion', 'alert'] });
  });
});
