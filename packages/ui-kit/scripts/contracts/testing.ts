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

import { GTS, isValidGtsID, type ValidationResult } from '@globaltypesystem/gts-ts';
import { describe, expect, it, vi } from 'vitest';

import {
  BASE_TYPE_ID,
  buildMetamodel,
  buildVocabularyTypes,
  compileContract,
  compileInstance,
  familyRoster,
  findUntypedPropMismatches,
  forwardsToRef,
  loadBaseSchema,
  loadElementSurfaces,
  registerContractTypes,
  type CompiledContract,
} from './compile';
import {
  bareGtsId,
  componentTypeRefPattern,
  METAMODEL_TYPE_ID,
  elementTypeIdPattern,
  elementTypeRefPattern,
  vocabularyTypeIdPattern,
} from './ids';
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
  // A part's stem is its directory name plus a suffix, so a directory whose
  // name is a PREFIX of the stem is a candidate. More than one can be:
  // `data-table-sort-button` is prefixed by both `data-table` and a
  // hypothetical `data`, and taking whichever the directory listing happened
  // to yield first would silently resolve the part into the wrong component.
  // The longest match is the right one - the deepest directory whose name the
  // stem still extends - and two candidates of the SAME length would be two
  // directories with one name, which cannot happen; anything else ambiguous
  // fails by name.
  const candidates = existsSync(join(COMPONENTS_DIR, stem))
    ? [stem]
    : readdirSync(COMPONENTS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && stem.startsWith(`${entry.name}-`))
        .map((entry) => entry.name)
        .sort((a, b) => b.length - a.length);
  const directory = candidates[0];
  if (candidates.length > 1 && candidates[1].length === candidates[0].length) {
    throw new Error(
      `"${ref}" (stem "${stem}") is prefixed by more than one component directory of the same length ` +
        `(${candidates.join(', ')}) - the reference does not name one component`,
    );
  }
  if (directory === undefined) throw new Error(`no component directory ships "${ref}" (stem "${stem}")`);
  const contractPath = join(COMPONENTS_DIR, directory, `${stem}.contract.json`);
  const contractId = existsSync(contractPath)
    ? bareGtsId(String((JSON.parse(readFileSync(contractPath, 'utf8')) as CompiledContract).$id))
    : undefined;
  return { ref, directory, stem, contractId };
}

// Every component identifier one contract holds, with the field that holds
// it, so a failure names which statement is wrong rather than only which id.
// A family's own name is a token rather than a reference and is not one; nor
// is a container outside the kit, which is an object precisely because there
// is nothing to resolve.
export function componentRefsIn(contract: CompiledContract): { field: string; ref: string }[] {
  const meaning = contract['x-gts-traits'];
  const refs: { field: string; ref: string }[] = [];
  for (const [index, entry] of meaning.dont_use_when.entries()) {
    const component = entry.instead.component;
    if (component !== undefined) refs.push({ field: `dont_use_when[${index}].instead.component`, ref: component });
  }
  for (const accepted of meaning.accepts.components ?? []) {
    refs.push({ field: 'accepts.components', ref: accepted });
  }
  // A filled mount point carries a component reference; a container outside
  // the kit does not - skipped here the same way a recommendation with no
  // component is.
  for (const entry of meaning.mounted_in ?? []) {
    if (entry.component !== undefined) refs.push({ field: 'mounted_in', ref: entry.component });
  }
  for (const member of meaning.family_membership?.members ?? []) {
    refs.push({ field: 'family_membership.members', ref: member });
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

// The surfaces the kit's committed contracts name, bare: one entry per
// contract that holds a forwards-to reference, read through the same reader
// every other surface-aware check uses (compile.ts's forwardsToRef) rather
// than through a second walk over the schema body.
function composedSurfaceRefs(): Set<string> {
  const refs = new Set<string>();
  for (const contract of loadCommittedContracts()) {
    const ref = forwardsToRef(contract);
    if (ref !== undefined) refs.add(ref);
  }
  return refs;
}

// The registry a contract instance is validated in: the base type, the
// vocabulary its x-gts-traits-schema references, every host element surface
// a contract may name, the metamodel the instance is typed by, and every
// contract the kit ships - which is what the instance's own props_schema and
// forwards_to references have to resolve against.
export function registeredKitStore(): GTS {
  const gts = new GTS();
  gts.register(JSON.parse(JSON.stringify(loadBaseSchema())) as Record<string, unknown>);
  registerContractTypes((entity) => gts.register(entity));
  for (const surface of loadElementSurfaces()) gts.register(surface);
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
    it('committed contract.json and contract.instance.json match a fresh compile', () => {
      const report = memoizedFreshnessReport(directory, exportStem);
      expect(report.contractDiff, `${exportStem}.contract.json is stale:\n${report.contractDiff.join('\n')}`).toEqual([]);
      expect(
        report.instanceDiff,
        `${exportStem}.contract.instance.json is stale:\n${report.instanceDiff.join('\n')}`,
      ).toEqual([]);
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-freshness

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-slots
    it('every annotation-only slot property has a matching x-uikit.partially_typed_props entry', () => {
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
      const pattern = new RegExp(vocabularyTypeIdPattern());
      for (const type of buildVocabularyTypes()) {
        expect(String(type.$id), `${String(type.$id)} is not a grammatical vocabulary type id`).toMatch(pattern);
      }
    });

    it('carries only identifiers the type system itself accepts', () => {
      // The kit's own patterns say what an identifier looks like to THIS
      // harness; this asks gts-ts. A segment needs five dot-tokens
      // (vendor.package.namespace.type.vMAJOR), which is a rule no local
      // pattern restates - and the one an id that dropped a token would break
      // without any pattern here noticing.
      const contract = compileContract(directory, exportStem);
      const instance = compileInstance(directory, exportStem);
      const ids = [
        BASE_TYPE_ID,
        `${METAMODEL_TYPE_ID}~`,
        contract.$id,
        instance.id,
        instance.props_schema,
        ...(instance.forwards_to === undefined ? [] : [instance.forwards_to]),
        ...buildVocabularyTypes().map((type) => String(type.$id)),
        ...loadElementSurfaces().map((surface) => String(surface.$id)),
      ];
      for (const id of ids) {
        expect(isValidGtsID(bareGtsId(id)), `${id} is not a valid GTS identifier`).toBe(true);
      }
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-base

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-refs
    it('every component reference resolves to a component the kit ships, at the major that component ships', () => {
      for (const { field, ref } of componentRefsIn(compileContract(directory, exportStem))) {
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

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-no-specifier
    it('names every type without the module it was resolved from', () => {
      // A printed `import("<path>")` qualifier puts two things a consumer
      // has no use for into a committed artifact: the machine's own
      // filesystem layout, and a foreign package's internal file names
      // (`@base-ui/react/accordion/index` is not how anything imports
      // AccordionValue). Asserted over the whole compiled artifact rather
      // than over the descriptions alone, because x-uikit.partially_typed_props carries the
      // same printed text one field away.
      const leaking = JSON.stringify(compileContract(directory, exportStem)).includes('import(');
      expect(leaking, `${exportStem}: a compiled type text still names the module it was resolved from`).toBe(false);
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-no-specifier

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-untyped
    it('pairs every property that asserts nothing with a props statement about it, both ways', () => {
      // The gap this closes was measured, not imagined: an evaluation pointed
      // an agent at three properties that asserted nothing and it reported
      // they took plain strings. A property Ajv will not check has to say
      // what its TypeScript type is AND be acknowledged as unverifiable, and
      // a statement naming a property the contract does constrain tells a
      // reader something false about the contract in front of them.
      const problems = findUntypedPropMismatches(compileContract(directory, exportStem));
      expect(problems, `${exportStem}: props statements and unasserted properties disagree:\n${problems.join('\n')}`).toEqual(
        [],
      );
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-untyped

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-parent
    it('fills every mount point from a contract whose own accepts.components name this component back', () => {
      // With the component references FILLED there is no pair to disagree,
      // which is the point - so what is asserted is the derivation itself:
      // each kit mount point must be a component that really does accept this
      // one inside it, and a part of a family may only be mounted inside its
      // own family, or the parts are independently mountable and the family
      // is not one.
      const contract = compileContract(directory, exportStem);
      const meaning = contract['x-gts-traits'];
      const self = bareGtsId(String(contract.$id));
      // The family's WHOLE membership, read off the roster rather than off
      // this component's own record: a part states its membership and nothing
      // else, so the set it may be mounted inside is the root plus every
      // other part naming the same family.
      let familyMembers: Set<string> | undefined;
      const membership = meaning.family_membership;
      if (membership !== undefined) {
        const roster = familyRoster(membership.name);
        familyMembers = new Set([...(roster.root === undefined ? [] : [roster.root]), ...roster.parts]);
      }
      for (const entry of meaning.mounted_in ?? []) {
        if (entry.component === undefined) continue;
        const container = resolveComponentRef(entry.component);
        const containerMeaning = compileContract(container.directory, container.stem)['x-gts-traits'];
        expect(
          containerMeaning.accepts.components ?? [],
          `${exportStem}: filled mount point "${entry.component}" does not accept it inside`,
        ).toContain(self);
        if (familyMembers !== undefined) {
          expect(familyMembers.has(entry.component), `${exportStem}: filled mount point "${entry.component}" is not a member of its family`).toBe(true);
        }
      }
    });

    it('states its own family membership, and only a root carries the member list', () => {
      // The two halves of the membership rule, on the component in front of
      // us: a part names the family and nothing else, and a root's `members`
      // is exactly the roster every other member produces - which is what
      // makes "one root per family" a fact about the kit rather than about
      // whichever overlay was read first.
      const contract = compileContract(directory, exportStem);
      const membership = contract['x-gts-traits'].family_membership;
      if (membership === undefined) return;
      const roster = familyRoster(membership.name);
      const self = bareGtsId(String(contract.$id));
      if (membership.role === 'part') {
        expect(membership.members, `${exportStem}: a part carries no member list`).toBeUndefined();
        expect(roster.parts, `${exportStem}: the family roster does not list it as a part`).toContain(self);
        expect(roster.root, `${exportStem}: family "${membership.name}" has no root`).toBeDefined();
        return;
      }
      expect(roster.root, `${exportStem}: the family roster names a different root`).toBe(self);
      expect(membership.members, `${exportStem}: a root's members are the roster's parts`).toEqual(roster.parts);
    });

    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-parent

    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-element
    it('derives from exactly one type, the abstract component type', () => {
      // The single-parent rule, asserted on the schema body rather than left
      // to the id: the chained $id says one parent, and an allOf carrying a
      // second $ref would say two. The host element's surface is a reference
      // the contract HOLDS - checked below - not a parent it derives from.
      const contract = compileContract(directory, exportStem);
      expect(contract.allOf, `${exportStem}: a contract derives from one type`).toEqual([{ $ref: BASE_TYPE_ID }]);
    });

    it('leaves the abstract marker on the type nothing instantiates, and only there', () => {
      // The abstract type declares no properties, so a props object validated
      // against it would pass whatever it carried - which is exactly why
      // nothing ever validates against it, and why it says so. A derived
      // contract IS instantiated, by every props object a consumer passes, so
      // the marker on one would be false.
      expect(loadBaseSchema()['x-gts-abstract'], 'the abstract component type states that it is abstract').toBe(true);
      const contract = compileContract(directory, exportStem);
      expect(contract, `${exportStem}: a component's own contract is instantiated by every props object`).not.toHaveProperty(
        'x-gts-abstract',
      );
    });

    it('resolves the host-element surface it names to a committed file in the grammar', () => {
      // The surfaces are hand-written, so nothing recompiles them into place:
      // what has to hold is that the reference a contract HOLDS resolves to a
      // committed file, and that the file's own identifier obeys the
      // element-surface grammar rather than merely matching the string the
      // contract happens to carry. Both spellings appear here on purpose - a
      // reference value is bare, a file's own `$id` carries `gts://` - so the
      // committed set is keyed by the bare form the reference is compared
      // against. A contract that names no surface has nothing to resolve,
      // which is the honest answer for DataTable and not a skipped check.
      const idPattern = new RegExp(elementTypeIdPattern());
      const refPattern = new RegExp(elementTypeRefPattern());
      const committed = new Set<string>();
      for (const schema of loadElementSurfaces()) {
        const id = String(schema.$id);
        expect(id, `${id} is not a grammatical element surface id`).toMatch(idPattern);
        committed.add(bareGtsId(id));
      }
      const ref = forwardsToRef(compileContract(directory, exportStem));
      if (ref === undefined) return;
      expect(ref, `${exportStem}: forwards_to "${ref}" is not a grammatical element-surface reference`).toMatch(refPattern);
      expect(committed.has(ref), `${exportStem}: names "${ref}", which no committed file declares`).toBe(true);
    });

    it('leaves no committed element surface that no contract names', () => {
      // The union rule the vocabulary comparison already applies, over the
      // one directory it could not reach: a surface the builder does not
      // produce (nothing produces these - they are written by hand) and no
      // contract names is registered in every store and read by nobody. The
      // references are read off the committed contracts, which this same
      // suite holds to a fresh compile, so a stale file cannot hide an orphan
      // here.
      const named = composedSurfaceRefs();
      const orphans = loadElementSurfaces()
        .map((schema) => bareGtsId(String(schema.$id)))
        .filter((ref) => !named.has(ref))
        .sort();
      expect(orphans, `committed element surfaces no contract names:\n${orphans.join('\n')}`).toEqual([]);
    });
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-element

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
// GtsStore.validateEntityTraits (the closure check: every x-gts-traits-schema in
// the chain must set additionalProperties: false). Both already run through
// this one call; nothing here calls validateSchemaTraits directly, because
// GTS.validateEntity already reaches it for a derived schema like a
// component contract.
//
// Round-tripped through JSON rather than passed as the in-memory
// CompiledContract object compileContract returns: an overlay field left
// unset (family_membership, slots) is genuinely ABSENT as a JSON Schema
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
// a schema's x-gts-traits chain from the GTS ID's OWN dot-token segments
// (GtsStore.buildSchemaChain), not by dereferencing any $ref, so neither the
// host element's surface nor any other component's contract is ever consulted
// for x-gts-traits validation - and forwards_to is a plain string value in the block
// being checked, not a type this store has to resolve.
// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-traits
export function validateContractTraits(contract: CompiledContract): ValidationResult & { entity_type: string } {
  const gts = new GTS();
  gts.register(JSON.parse(JSON.stringify(loadBaseSchema())) as Record<string, unknown>);
  // The vocabulary the base type's x-gts-traits-schema references. Without them
  // gts-ts fails the whole check with "Unresolvable trait schema reference"
  // rather than a validation error, which is the right failure - an
  // x-gts-traits-schema whose types are missing has not been checked against
  // anything.
  registerContractTypes((entity) => gts.register(entity));
  gts.register(JSON.parse(JSON.stringify(contract)) as Record<string, unknown>);
  return gts.validateEntity(bareGtsId(contract.$id));
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-conformance:p1:inst-cf-traits
