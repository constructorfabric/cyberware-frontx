// Shared freshness assertion for a component's own `<name>.contract.test.ts`.
// The conformance tests in a file like button.contract.test.ts all compile
// the contract IN MEMORY and check invariants against that fresh compile -
// none of them ever read the committed <name>.contract.json off disk, so a
// stale commit (someone hand-edited the JSON, or forgot to re-run
// `contracts:compile` after touching the overlay or the component) passes
// every one of those tests silently. This is the one check that reads the
// committed copy and diffs it against a fresh compile, and it is meant to be
// called once per component's contract test file - see button.contract.test.ts.
import { describe, expect, it } from 'vitest';

import { checkComponentFreshness } from './freshness';

// `exportStem` defaults to `directory` for the ordinary one-overlay case
// (assertContractFreshness('button')); a compound component's part passes
// both (assertContractFreshness('accordion', 'accordion-item')) - see
// accordion.contract.test.ts.
export function assertContractFreshness(directory: string, exportStem: string = directory): void {
  describe(`${exportStem} contract freshness`, () => {
    it('committed contract.json, contract.instance.json and generated passthrough match a fresh compile', () => {
      const report = checkComponentFreshness(directory, exportStem);
      expect(report.contractDiff, `${exportStem}.contract.json is stale:\n${report.contractDiff.join('\n')}`).toEqual([]);
      expect(
        report.instanceDiff,
        `${exportStem}.contract.instance.json is stale:\n${report.instanceDiff.join('\n')}`,
      ).toEqual([]);
      if (report.passthroughDiff !== 'not-applicable') {
        expect(report.passthroughDiff, `generated passthrough is stale:\n${report.passthroughDiff.join('\n')}`).toEqual([]);
      }
    });

    it('every annotation-only slot property has a matching x-uikit.slots entry', () => {
      const report = checkComponentFreshness(directory, exportStem);
      expect(report.slotSchemaMismatches).toEqual([]);
    });
  });
}
