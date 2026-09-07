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
import { buildPassthroughSchema, compileContract, compileInstance, resolveTargetExtraction } from './compile';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATED_DIR = join(kitRoot, 'scripts', 'contracts', 'generated');

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
  fresh: boolean;
}

function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

// `exportStem` defaults to `directory` for the ordinary one-overlay-per-
// directory case (Button, and every component through T4) - a compound
// component's part (accordion, 'accordion-item') passes both explicitly, see
// testing.ts's assertContractFreshness and button/accordion's own
// *.contract.test.ts.
export function checkComponentFreshness(directory: string, exportStem: string = directory): FreshnessReport {
  const dir = join(kitRoot, 'src', 'components', directory);
  const committedContract = readJsonIfExists(join(dir, `${exportStem}.contract.json`));
  const committedInstance = readJsonIfExists(join(dir, `${exportStem}.contract.instance.json`));
  const freshContract = compileContract(directory, exportStem);
  const freshInstance = compileInstance(directory, exportStem);

  const contractDiff = jsonDiff(committedContract, freshContract);
  const instanceDiff = jsonDiff(committedInstance, freshInstance);

  const extraction = resolveTargetExtraction(directory, exportStem);
  let passthroughDiff: string[] | 'not-applicable' = 'not-applicable';
  if (extraction.passthroughOrigin && extraction.passthroughKind) {
    const committedPassthrough = readJsonIfExists(join(GENERATED_DIR, `passthrough.${extraction.passthroughOrigin}.json`));
    const freshPassthrough = buildPassthroughSchema(extraction.passthroughOrigin, extraction.passthroughKind, extraction.inheritedProps);
    passthroughDiff = jsonDiff(committedPassthrough, freshPassthrough);
  }

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

  const fresh =
    contractDiff.length === 0 &&
    instanceDiff.length === 0 &&
    (passthroughDiff === 'not-applicable' || passthroughDiff.length === 0) &&
    slotSchemaMismatches.length === 0;

  return { component: exportStem, contractDiff, instanceDiff, passthroughDiff, slotSchemaMismatches, fresh };
}
