// Freshness: whether the artifacts committed next to a component's source
// (<name>.contract.json and <name>.contract.instance.json) are exactly what
// compiling the component right now produces. The element-kind passthrough
// types are hand-written source, not compiler output, so there is nothing to
// compare them against - what the conformance suite checks about them instead
// is that their identifiers obey the grammar and that a contract composing
// one names a file that exists. Both the per-component vitest suite (see testing.ts) and
// the merge-scoped guard (check.ts's `guard` subcommand) need the identical
// comparison - one to fail a test with a diff, the other to fail a CI check
// with the same diff - so the comparison lives here once; each caller only
// decides how to report it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jsonDiff } from './check-lib';
import {
  buildBaseSchema,
  buildMetamodel,
  buildTraitTypes,
  compileContract,
  compileInstance,
  loadBaseSchema,
  resolveTargetExtraction,
  traitTypeFileName,
} from './compile';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACTS_DIR = join(kitRoot, 'scripts', 'contracts');
const TYPES_DIR = join(CONTRACTS_DIR, 'types');

export interface FreshnessReport {
  component: string;
  contractDiff: string[];
  instanceDiff: string[];
  // Every property of a prop the component DECLARES that asserts nothing (no
  // `type`, no `enum` - Ajv asserts nothing about it) is a slot, and
  // x-uikit.slots is where its real TS shape is recorded. The two are written
  // by the same loop in buildPropsAndRequired, so they cannot drift on their
  // own - this catches the day something edits one without the other. Scoped
  // to declared props on purpose: an API prop of the primitive underneath can
  // also assert nothing, and its type lives in its own description plus an
  // untyped_prop assumption rather than in x-uikit.slots, which is the kit's
  // own slotted props and nothing else.
  slotSchemaMismatches: string[];
  // The schemas that belong to no single component - the abstract base type,
  // the metamodel, and each vocabulary type the two of them reference -
  // keyed by file name. Computed on every call regardless of which component
  // is being checked (cheap: the builders are pure construction, and the
  // committed copies are small JSON reads) so that a stale shared schema is
  // caught by whichever component's contract test happens to run
  // assertContractFreshness first, rather than depending on one file
  // remembering to check it.
  sharedSchemaDiffs: Record<string, string[]>;
  fresh: boolean;
}

// @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-artifacts
function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
// @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-artifacts

// `exportStem` defaults to `directory` for the ordinary one-overlay-per-
// directory case (Button, and every component through T4) - a compound
// component's part (accordion, 'accordion-item') passes both explicitly, see
// testing.ts's assertContractFreshness and button/accordion's own
// *.contract.test.ts.
// @cpt-dod:cpt-frontx-ui-kit-dod-component-contracts-freshness:p1
// @cpt-algo:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1
export function checkComponentFreshness(directory: string, exportStem: string = directory): FreshnessReport {
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-artifacts
  const dir = join(kitRoot, 'src', 'components', directory);
  const committedContract = readJsonIfExists(join(dir, `${exportStem}.contract.json`));
  const committedInstance = readJsonIfExists(join(dir, `${exportStem}.contract.instance.json`));
  const freshContract = compileContract(directory, exportStem);
  const freshInstance = compileInstance(directory, exportStem);

  const contractDiff = jsonDiff(committedContract, freshContract);
  const instanceDiff = jsonDiff(committedInstance, freshInstance);
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-artifacts
  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-base
  const sharedSchemaDiffs: Record<string, string[]> = {
    'base.component.json': jsonDiff(loadBaseSchema(), buildBaseSchema()),
    'ui-component.meta.json': jsonDiff(readJsonIfExists(join(CONTRACTS_DIR, 'ui-component.meta.json')), buildMetamodel()),
  };
  // The union of what the builder produces and what the directory holds, not
  // just the builder's own list: a type file the builder no longer produces
  // was diffed by nobody while `loadTraitTypes` went on registering it in
  // every GTS store and every Ajv instance - a definition the harness applies
  // and no comparison covers. An orphan reads as "missing from the fresh
  // compile", which is exactly what it is.
  const freshTypes = new Map(buildTraitTypes().map((type) => [traitTypeFileName(type), type]));
  const committedTypeFiles = existsSync(TYPES_DIR)
    ? readdirSync(TYPES_DIR).filter((name) => name.endsWith('.json'))
    : [];
  for (const fileName of [...new Set([...freshTypes.keys(), ...committedTypeFiles])].sort()) {
    sharedSchemaDiffs[`types/${fileName}`] = jsonDiff(readJsonIfExists(join(TYPES_DIR, fileName)), freshTypes.get(fileName));
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-base

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-slots
  const extraction = resolveTargetExtraction(directory, exportStem);
  const declaredProps = new Set(extraction.ownProps.map((prop) => prop.name));
  const slotSchemaMismatches: string[] = [];
  for (const [name, prop] of Object.entries(freshContract.properties)) {
    const isSlotShaped = prop.type === undefined && prop.enum === undefined;
    const hasSlotEntry = name in freshContract['x-uikit'].slots;
    if (isSlotShaped && declaredProps.has(name) && !hasSlotEntry) {
      slotSchemaMismatches.push(`"${name}" is an annotation-only declared prop but has no x-uikit.slots entry`);
    } else if (hasSlotEntry && !isSlotShaped) {
      slotSchemaMismatches.push(`"${name}" has an x-uikit.slots entry but is typed or enumerated in properties`);
    } else if (hasSlotEntry && !declaredProps.has(name)) {
      slotSchemaMismatches.push(`"${name}" has an x-uikit.slots entry but is not a prop ${exportStem} declares itself`);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-slots

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-return
  const fresh =
    contractDiff.length === 0 &&
    instanceDiff.length === 0 &&
    slotSchemaMismatches.length === 0 &&
    Object.values(sharedSchemaDiffs).every((diff) => diff.length === 0);

  return { component: exportStem, contractDiff, instanceDiff, slotSchemaMismatches, sharedSchemaDiffs, fresh };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-return
}
