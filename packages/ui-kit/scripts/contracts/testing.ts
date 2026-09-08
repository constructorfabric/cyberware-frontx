// Shared freshness assertion for a component's own `<name>.contract.test.ts`.
// The conformance tests in a file like button.contract.test.ts all compile
// the contract IN MEMORY and check invariants against that fresh compile -
// none of them ever read the committed <name>.contract.json off disk, so a
// stale commit (someone hand-edited the JSON, or forgot to re-run
// `contracts:compile` after touching the overlay or the component) passes
// every one of those tests silently. This is the one check that reads the
// committed copy and diffs it against a fresh compile, and it is meant to be
// called once per component's contract test file - see button.contract.test.ts.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GTS, type ValidationResult } from '@globaltypesystem/gts-ts';
import { describe, expect, it, vi } from 'vitest';

import {
  buildMetamodel,
  buildTraitTypes,
  compileInstance,
  loadBaseSchema,
  registerContractTypes,
  type CompiledContract,
  type ContractInstance,
} from './compile';
import { bareGtsId, componentTypeRefPattern, traitTypeIdPattern } from './ids';
import { checkComponentFreshness, type FreshnessReport } from './freshness';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS_DIR = join(kitRoot, 'src', 'components');

// Every contracts test file that builds a real TypeScript program - directly
// (extractComponent, listExportedDeclarationNames) or through this module's
// own checkComponentFreshness - is several seconds per build on a CI-class
// runner, comfortably under 5s locally, so only CI ever hits vitest's default
// 5000ms test timeout. `vi.setConfig` resolves at the moment `it`/`describe`
// is called (vitest bakes `options.timeout ?? runner.config.testTimeout` into
// each task when it is collected), so this must run before any it()/describe()
// in the calling file, and vitest resets the override after that file's run
// (see its own worker runner: "reset after tests, because user might call
// vi.setConfig in setupFile") - it never leaks into another test file. One
// mechanism, called once at the top of each file that needs it, rather than
// a `{ timeout }` option repeated on every slow describe/it.
export function applyContractTestTimeout(): void {
  vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
}

// checkComponentFreshness builds a TypeScript program (via extractComponent -
// see extract.ts) several seconds per call on a CI-class runner; the three
// `it`s below each called it independently, so one describe block paid for
// that build three times over and blew past vitest's default 5s test
// timeout. Memoized per (directory, exportStem) so the three `it`s share the
// one report - safe because nothing in this process edits the component
// source between them. The timeout itself comes from the calling test
// file's own applyContractTestTimeout() call, not from this describe.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-freshness
const freshnessReportCache = new Map<string, FreshnessReport>();
function memoizedFreshnessReport(directory: string, exportStem: string): FreshnessReport {
  const key = `${directory}::${exportStem}`;
  const cached = freshnessReportCache.get(key);
  if (cached) return cached;
  const report = checkComponentFreshness(directory, exportStem);
  freshnessReportCache.set(key, report);
  return report;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-freshness

// Where a component identifier points, and what the kit ships there. A
// reference names a SPECIFIC contract major: a component that ships a
// contract must be referenced by that contract's own current props-schema
// identifier, so moving a component's major moves every reference to it,
// and a component that ships none may only be referenced at major 1.
//
// Resolution happens here rather than through the type registry for two
// reasons, both about what the registry can answer: gts-ts's own reference
// validator (XGtsRefValidator) walks a schema and does not follow a `$ref`
// into another type, so a reference held inside a vocabulary type is never
// reached by it; and most components a `don't` rule points at ship no
// contract at all, so "the kit ships this component" is a question about
// the component directory, which no registry knows about.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-refs
export interface ResolvedComponentRef {
  ref: string;
  directory: string;
  stem: string;
  // The `$id` of the contract that component ships, bare, or undefined when
  // it ships none yet.
  contractId?: string;
}

export function resolveComponentRef(ref: string): ResolvedComponentRef {
  const match = new RegExp(componentTypeRefPattern(true)).exec(ref);
  if (!match) throw new Error(`"${ref}" is not a grammatical component reference`);
  const stem = match[1].replace(/_/g, '-');
  const directory = existsSync(join(COMPONENTS_DIR, stem))
    ? stem
    : readdirSync(COMPONENTS_DIR, { withFileTypes: true }).find(
        (entry) => entry.isDirectory() && stem.startsWith(`${entry.name}-`),
      )?.name;
  if (directory === undefined) throw new Error(`no component directory ships "${ref}" (stem "${stem}")`);
  const contractPath = join(COMPONENTS_DIR, directory, `${stem}.contract.json`);
  const contractId = existsSync(contractPath)
    ? bareGtsId(String((JSON.parse(readFileSync(contractPath, 'utf8')) as CompiledContract).$id))
    : undefined;
  return { ref, directory, stem, contractId };
}

// Every component identifier one contract holds, with the field that holds
// it, so a failure names which statement is wrong rather than only which id.
// The content kinds `text` and `none` are values of the same field, not
// references, and are skipped; so is an external alternative, which is an
// object precisely because there is nothing to resolve.
export function componentRefsIn(instance: ContractInstance): { field: string; ref: string }[] {
  const refs: { field: string; ref: string }[] = [];
  for (const [index, entry] of instance.dont_use_when.entries()) {
    if (typeof entry.instead === 'string') refs.push({ field: `dont_use_when[${index}].instead`, ref: entry.instead });
  }
  for (const kind of instance.composition.children.kinds) {
    if (kind !== 'text' && kind !== 'none') refs.push({ field: 'composition.children.kinds', ref: kind });
  }
  for (const kind of instance.composition.parent?.kinds ?? []) refs.push({ field: 'composition.parent.kinds', ref: kind });
  if (instance.family) {
    refs.push({ field: 'family.root', ref: instance.family.root });
    for (const part of instance.family.parts ?? []) refs.push({ field: 'family.parts', ref: part });
  }
  return refs;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-refs

// Every contract the kit ships today, as the registry a reference resolves
// against. Read off disk rather than compiled: compiling all of them would
// build a TypeScript program per component, and the freshness assertion in
// this same suite is what guarantees the committed copies are the compiled
// ones.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-instance-ref
function loadCommittedContracts(): Record<string, unknown>[] {
  const contracts: Record<string, unknown>[] = [];
  for (const entry of readdirSync(COMPONENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(COMPONENTS_DIR, entry.name);
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.contract.json')) contracts.push(JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>);
    }
  }
  return contracts;
}

// The registry a contract instance is validated in: the base type, the
// vocabulary its trait schema references, the metamodel the instance is
// typed by, and every contract the kit ships - which is what the instance's
// own props_schema reference has to resolve against.
export function registeredKitStore(): GTS {
  const gts = new GTS();
  gts.register(JSON.parse(JSON.stringify(loadBaseSchema())) as Record<string, unknown>);
  registerContractTypes((entity) => gts.register(entity));
  gts.register(buildMetamodel());
  for (const contract of loadCommittedContracts()) gts.register(contract);
  return gts;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-instance-ref

// `exportStem` defaults to `directory` for the ordinary one-overlay case
// (assertContractFreshness('button')); a compound component's part passes
// both (assertContractFreshness('accordion', 'accordion-item')) - see
// accordion.contract.test.ts.
//
// Callers are component contract test files, each of which calls
// applyContractTestTimeout() at file scope for exactly this reason - the TS
// program build this suite exercises is genuinely slow on CI, but that is
// not true of the rest of the test run, and a global testTimeout bump would
// hide a real hang anywhere else in the package.
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-conformance:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1
export function assertContractFreshness(directory: string, exportStem: string = directory): void {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-freshness
  describe(`${exportStem} contract freshness`, () => {
    it('committed contract.json, contract.instance.json and generated passthrough match a fresh compile', () => {
      const report = memoizedFreshnessReport(directory, exportStem);
      expect(report.contractDiff, `${exportStem}.contract.json is stale:\n${report.contractDiff.join('\n')}`).toEqual([]);
      expect(
        report.instanceDiff,
        `${exportStem}.contract.instance.json is stale:\n${report.instanceDiff.join('\n')}`,
      ).toEqual([]);
      if (report.passthroughDiff !== 'not-applicable') {
        expect(report.passthroughDiff, `generated passthrough is stale:\n${report.passthroughDiff.join('\n')}`).toEqual([]);
      }
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-freshness

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-slots
    it('every annotation-only slot property has a matching x-uikit.slots entry', () => {
      const report = memoizedFreshnessReport(directory, exportStem);
      expect(report.slotSchemaMismatches).toEqual([]);
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-slots

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-base
    it('every committed shared schema equals a fresh build', () => {
      // The abstract base type, the metamodel and each vocabulary type they
      // reference: written by `contracts:compile -- --schemas`, and stale
      // the moment a builder changes without that being re-run.
      const report = memoizedFreshnessReport(directory, exportStem);
      for (const [file, diff] of Object.entries(report.sharedSchemaDiffs)) {
        expect(diff, `${file} is stale:\n${diff.join('\n')}`).toEqual([]);
      }
    });

    it("every vocabulary type's identifier obeys the vocabulary grammar", () => {
      // The identifiers are built (ids.ts), so this cannot catch a typo -
      // it catches a change to the grammar itself, or to how an identifier
      // is assembled, that leaves the two disagreeing while every schema
      // still validates.
      const pattern = new RegExp(traitTypeIdPattern());
      for (const type of buildTraitTypes()) {
        expect(String(type.$id), `${String(type.$id)} is not a grammatical vocabulary type id`).toMatch(pattern);
      }
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-base

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-refs
    it('every component reference resolves to a component the kit ships, at the major that component ships', () => {
      const instance = compileInstance(directory, exportStem);
      for (const { field, ref } of componentRefsIn(instance)) {
        const target = resolveComponentRef(ref);
        if (target.contractId !== undefined) {
          // Full identifier, not just the name: a component that moved its
          // contract major is a different type, and a reference left at the
          // old major points at a type nothing ships any more.
          expect(target.contractId, `${field}: "${ref}" does not name ${target.stem}'s current contract`).toBe(ref);
        } else {
          expect(ref, `${field}: "${ref}" names ${target.stem}, which ships no contract, so it may only be referenced at major 1`).toMatch(
            /\.v1~$/,
          );
        }
      }
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-refs

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-instance-ref
    it("resolves the instance's own props-schema reference through the type registry", () => {
      // The one reference gts-ts resolves for us: it sits directly on an
      // instance property, which is as deep as its own reference validator
      // walks. A contract absent from the registry fails by name here.
      const gts = registeredKitStore();
      const instance = compileInstance(directory, exportStem);
      gts.register(JSON.parse(JSON.stringify(instance)) as Record<string, unknown>);
      const result = gts.validateInstance(instance.id);
      expect(result.ok, result.error).toBe(true);
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-instance-ref
  });
}

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
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-traits
export function validateContractTraits(contract: CompiledContract): ValidationResult & { entity_type: string } {
  const gts = new GTS();
  gts.register(JSON.parse(JSON.stringify(loadBaseSchema())) as Record<string, unknown>);
  // The vocabulary the base type's trait schema references. Without them
  // gts-ts fails the whole check with "Unresolvable trait schema reference"
  // rather than a validation error, which is the right failure - a trait
  // schema whose types are missing has not been checked against anything.
  registerContractTypes((entity) => gts.register(entity));
  gts.register(JSON.parse(JSON.stringify(contract)) as Record<string, unknown>);
  return gts.validateEntity(bareGtsId(contract.$id));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-traits
