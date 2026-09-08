// Freshness: whether the artifacts committed next to a component's source
// (<name>.contract.json, <name>.contract.instance.json, and its generated
// per-origin passthrough type) are exactly what compiling the component right
// now produces. Both the per-component vitest suite (see testing.ts) and
// the merge-scoped guard (check.ts's `guard` subcommand) need the identical
// comparison - one to fail a test with a diff, the other to fail a CI check
// with the same diff - so the comparison lives here once; each caller only
// decides how to report it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jsonDiff } from './check-lib';
import {
  buildBaseSchema,
  buildMetamodel,
  buildPassthroughSchema,
  buildTraitTypes,
  compileContract,
  compileInstance,
  loadBaseSchema,
  resolveTargetExtraction,
  traitTypeFileName,
} from './compile';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACTS_DIR = join(kitRoot, 'scripts', 'contracts');
const GENERATED_DIR = join(CONTRACTS_DIR, 'generated');
const TYPES_DIR = join(CONTRACTS_DIR, 'types');

export interface FreshnessReport {
  component: string;
  contractDiff: string[];
  instanceDiff: string[];
  // 'not-applicable' for a component with no DOM/Base UI passthrough origin at
  // all (nothing forwarded, so no generated file to be stale) - distinct
  // from an empty diff array, which means a passthrough file exists and
  // matches.
  passthroughDiff: string[] | 'not-applicable';
  // Every annotation-only property in `properties` (no `type`, no `enum` -
  // Ajv asserts nothing about it) exists only so unevaluatedProperties:false
  // does not reject it; x-uikit.slots is where its real TS shape is
  // recorded. The two lists are written by different code paths in
  // buildPropsAndRequired from the same loop, so they cannot drift on their
  // own - this catches the day something edits one without the other.
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
  for (const type of buildTraitTypes()) {
    const fileName = traitTypeFileName(type);
    sharedSchemaDiffs[`types/${fileName}`] = jsonDiff(readJsonIfExists(join(TYPES_DIR, fileName)), type);
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-base

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-passthrough
  const extraction = resolveTargetExtraction(directory, exportStem);
  let passthroughDiff: string[] | 'not-applicable' = 'not-applicable';
  if (extraction.passthroughOrigin && extraction.passthroughKind) {
    const committedPassthrough = readJsonIfExists(join(GENERATED_DIR, `passthrough.${extraction.passthroughOrigin}.json`)) as
      | Record<string, unknown>
      | undefined;
    // Freshness compares THIS component's own compiled output against what
    // is committed - multi-owner correctness of generated_from is the write
    // path's job (compile.ts's compileOne, M4), not this check's; carrying
    // the committed list forward (falling back to just this component when
    // nothing is committed yet) keeps a per-component freshness run from
    // flagging a diff over a fact it has no way to recompute on its own.
    // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-passthrough-compare
    const generatedFrom = Array.isArray(committedPassthrough?.generated_from)
      ? (committedPassthrough.generated_from as string[])
      : [exportStem];
    const freshPassthrough = buildPassthroughSchema(
      extraction.passthroughOrigin,
      extraction.passthroughKind,
      extraction.inheritedProps,
      generatedFrom,
    );
    passthroughDiff = jsonDiff(committedPassthrough, freshPassthrough);
    // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-passthrough-compare
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-passthrough

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-slots
  const slotSchemaMismatches: string[] = [];
  for (const [name, prop] of Object.entries(freshContract.properties)) {
    const isSlotShaped = prop.type === undefined && prop.enum === undefined;
    const hasSlotEntry = name in freshContract['x-uikit'].slots;
    if (isSlotShaped && !hasSlotEntry) {
      slotSchemaMismatches.push(`"${name}" is an annotation-only property but has no x-uikit.slots entry`);
    } else if (hasSlotEntry && !isSlotShaped) {
      slotSchemaMismatches.push(`"${name}" has an x-uikit.slots entry but is typed or enumerated in properties`);
    }
  }
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-slots

  // @cpt-begin:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-return
  const fresh =
    contractDiff.length === 0 &&
    instanceDiff.length === 0 &&
    (passthroughDiff === 'not-applicable' || passthroughDiff.length === 0) &&
    slotSchemaMismatches.length === 0 &&
    Object.values(sharedSchemaDiffs).every((diff) => diff.length === 0);

  return { component: exportStem, contractDiff, instanceDiff, passthroughDiff, slotSchemaMismatches, sharedSchemaDiffs, fresh };
  // @cpt-end:cpt-frontx-ui-kit-algo-component-contracts-freshness:p1:inst-fr-return
}
