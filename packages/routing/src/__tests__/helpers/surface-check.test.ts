import { describe, expect, it } from 'vitest';
import { declaresRuntimeExport, declaresType } from './surface-check.js';

// A real `tsup`/`tsc` mutation of the checked-in build output is not
// something a test in this repository can perform — these fixtures stand in
// for "one name went missing from the emitted declarations", proving the
// presence check `dist-internal.test.ts` runs against a real build would
// actually fail loudly rather than passing regardless (MEDIUM, review round
// 16-re5: the surface pin these checks feed was silently partial, and the
// concern was that no test would fail on a name the pin never covered).
describe('declaresRuntimeExport', () => {
  const dts = "export { foo, bar, baz } from './index.js';\n";

  it('finds a name present in the export list', () => {
    expect(declaresRuntimeExport(dts, 'bar')).toBe(true);
  });

  it('reports a name missing from the export list as absent', () => {
    expect(declaresRuntimeExport(dts, 'quux')).toBe(false);
  });
});

describe('declaresType', () => {
  it('finds a bare `interface X {` with no `declare` keyword', () => {
    // The exact form rollup-dts emits for every interface this package
    // publishes — the case the pre-fix regex never matched (LOW, review
    // round 16-re5).
    expect(declaresType('interface HistoryAdapter {\n  getLocation(): unknown;\n}\n', 'HistoryAdapter')).toBe(true);
  });

  it('finds a bare `type X =` alias', () => {
    expect(declaresType('type RoutingErrorCode = "invalid-domain-key" | "invalid-name";\n', 'RoutingErrorCode')).toBe(
      true,
    );
  });

  it('finds `declare function`, `declare const`, and `declare class` forms', () => {
    expect(declaresType('declare function resolveEntries(domainKey: string): unknown;\n', 'resolveEntries')).toBe(
      true,
    );
    expect(declaresType('declare const composeDomainKey: unknown;\n', 'composeDomainKey')).toBe(true);
    expect(declaresType('declare class RoutingError extends Error {\n}\n', 'RoutingError')).toBe(true);
  });

  it('finds an `export declare` form', () => {
    expect(declaresType('export declare function parseGrammar(input: string): unknown;\n', 'parseGrammar')).toBe(
      true,
    );
  });

  it('falls back to a re-export list carrying the name as a type', () => {
    expect(declaresType("export { type Transition } from './index.js';\n", 'Transition')).toBe(true);
  });

  it('reports a name absent from both a declaration and an export list as missing', () => {
    const dts = 'interface HistoryAdapter {\n}\nexport { HistoryAdapter };\n';
    expect(declaresType(dts, 'AdapterLocation')).toBe(false);
  });
});
