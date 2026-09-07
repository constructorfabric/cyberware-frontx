// Shared freshness assertion for a component's own `<name>.contract.test.ts`.
// The conformance tests in a file like button.contract.test.ts all compile
// the contract IN MEMORY and check invariants against that fresh compile -
// none of them ever read the committed <name>.contract.json off disk, so a
// stale commit (someone hand-edited the JSON, or forgot to re-run
// `contracts:compile` after touching the overlay or the component) passes
// every one of those tests silently. This is the one check that reads the
// committed copy and diffs it against a fresh compile, and it is meant to be
// called once per component's contract test file - see button.contract.test.ts.
import { GTS, type ValidationResult } from '@globaltypesystem/gts-ts';
import { describe, expect, it } from 'vitest';

import { loadBaseSchema, type CompiledContract } from './compile';
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

    it("committed base.component.json equals a fresh build (buildBaseSchema)", () => {
      const report = checkComponentFreshness(directory, exportStem);
      expect(report.baseSchemaDiff, `base.component.json is stale:\n${report.baseSchemaDiff.join('\n')}`).toEqual([]);
    });
  });
}

const bareId = (id: string): string => id.replace(/^gts:\/\//, '');

// Registers base.component.json plus a JSON-round-tripped copy of a compiled
// contract into a fresh GTS store and returns GTS.validateEntity's result
// for that contract's own $id.
//
// The API: GTS.validateEntity, for a schema entity, calls TWO store methods
// - GtsStore.validateSchemaAgainstParent (which, for a derived schema,
// itself calls the private validateSchemaTraits as its last step - the
// merged-values-against-effective-schema Ajv check) and
// GtsStore.validateEntityTraits (the closure check: every trait schema in
// the chain must set additionalProperties: false). Both already run through
// this one call; nothing here calls validateSchemaTraits directly, because
// GTS.validateEntity already reaches it for a derived schema like a
// component contract.
//
// Round-tripped through JSON rather than passed as the in-memory
// CompiledContract object compileContract returns: an overlay field left
// unset (family, extension_points) is genuinely ABSENT as a JSON Schema
// property once JSON.stringify drops it (the shape the committed
// <name>.contract.json - "the canonical contract every consumer reads",
// per compile.ts's own header comment - actually carries), not merely
// `undefined` the way the in-memory object still holds it as an own key.
// GtsStore.validateSchemaTraits tests trait-property presence with the `in`
// operator, which reads those two cases differently (`'family' in obj` is
// true even when `obj.family === undefined`) - registering the in-memory
// object directly would pass this check by accident, on a property shape no
// real consumer of the compiled JSON ever sees, and would stop testing
// anything the day a future refactor made pickFields omit unset keys
// instead of assigning them undefined.
//
// Only base.component.json and the contract are registered: gts-ts resolves
// a schema's trait chain from the GTS ID's OWN dot-token segments
// (GtsStore.buildSchemaChain), not by dereferencing allOf $refs, so neither
// the passthrough type nor any other component's contract is ever consulted
// for trait validation.
export function validateContractTraits(contract: CompiledContract): ValidationResult & { entity_type: string } {
  const gts = new GTS();
  gts.register(JSON.parse(JSON.stringify(loadBaseSchema())) as Record<string, unknown>);
  gts.register(JSON.parse(JSON.stringify(contract)) as Record<string, unknown>);
  return gts.validateEntity(bareId(contract.$id));
}
