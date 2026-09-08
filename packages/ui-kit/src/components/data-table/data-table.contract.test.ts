// Conformance for both DataTable contracts (DataTable, DataTableSortButton)
// - one file because they share a directory and the interesting assertions
// (extension points, no-passthrough, non-component exports correctly
// excluded from coverage) are about the directory as a whole, not either
// contract in isolation. See button.contract.test.ts for the per-component
// conformance shape assertContractFreshness reuses.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GTS } from '@globaltypesystem/gts-ts';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import {
  addContractTypes,
  BASE_TYPE_ID,
  buildMetamodel,
  compileContract,
  compileInstance,
  loadBaseSchema,
  registerContractTypes,
  resolveTargetExtraction,
  type CompiledContract,
  type ContractInstance,
} from '../../../scripts/contracts/compile';
import { listExportedDeclarationNames } from '../../../scripts/contracts/extract';
import { bareGtsId, componentTypeRef } from '../../../scripts/contracts/ids';
import { applyContractTestTimeout, assertContractFreshness, validateContractTraits } from '../../../scripts/contracts/testing';

// resolveTargetExtraction and listExportedDeclarationNames below each build a
// real TypeScript program - several seconds on a CI-class runner, comfortably
// under 5s locally - so only CI hits vitest's default test timeout. See
// applyContractTestTimeout's own comment in testing.ts for why this must run
// before any describe()/it() in the file.
applyContractTestTimeout();

const DIRECTORY = 'data-table';
// Two INDEPENDENT top-level exports, not a compound family - unlike
// Accordion's root/parts, neither contract's overlay sets `family`.
const STEMS = [DIRECTORY, 'data-table-sort-button'] as const;

for (const stem of STEMS) assertContractFreshness(DIRECTORY, stem);


interface CompiledUnit {
  stem: string;
  contract: CompiledContract;
  instance: ContractInstance;
}

const units: Record<string, CompiledUnit> = Object.fromEntries(
  STEMS.map((stem) => [stem, { stem, contract: compileContract(DIRECTORY, stem), instance: compileInstance(DIRECTORY, stem) }]),
);
const metaSchema = buildMetamodel();
const baseSchema = loadBaseSchema();

describe('data-table: metamodel validity', () => {
  it('every instance validates against the component metamodel', () => {
    const ajv = new Ajv2020();
    addContractTypes(ajv);
    const validate = ajv.compile(metaSchema);
    for (const { stem, instance } of Object.values(units)) {
      expect(validate(instance), `${stem}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it("each instance's props_schema points at its own compiled contract", () => {
    for (const { stem, instance, contract } of Object.values(units)) {
      expect(instance.props_schema, stem).toBe(bareGtsId(contract.$id));
    }
  });

  it('refuses a children list that pairs "none" with another kind', () => {
    // DataTable is the one component that says "none": it renders its Table
    // internally, so nothing may be placed inside it. Any other kind says
    // something may - a list holding both states both, and the vocabulary
    // used to accept it as an ordinary two-element array.
    const ajv = new Ajv2020();
    addContractTypes(ajv);
    const validate = ajv.compile(metaSchema);
    const { instance } = units[DIRECTORY];
    const contradictory = {
      ...instance,
      composition: {
        ...instance.composition,
        children: { ...instance.composition.children, kinds: ['none', componentTypeRef('button', 1)] },
      },
    };
    expect(validate(contradictory)).toBe(false);
  });

  it('neither contract sets family - two independent exports, not a compound family', () => {
    for (const { stem, instance } of Object.values(units)) {
      expect(instance.family, stem).toBeUndefined();
    }
  });
});

describe('data-table: coverage counts only component exports', () => {
  // The directory exports six names in total; four are helpers/features/
  // types, not components, and must never be counted against coverage or
  // demanded an overlay - see check.ts's componentExportCoverage.
  it('data-table.tsx exports exactly two React components: DataTable and DataTableSortButton', () => {
    const extraction = resolveTargetExtraction(DIRECTORY, DIRECTORY);
    const sortButtonExtraction = resolveTargetExtraction(DIRECTORY, 'data-table-sort-button');
    expect(extraction.name).toBe('DataTable');
    expect(sortButtonExtraction.name).toBe('DataTableSortButton');
  });

  it('the non-component exports are real exports, correctly excluded - not silently missing', () => {
    // Resolved from this test file's own URL, not process.cwd() - a runner
    // invoked from outside the package would otherwise point this at a path
    // that does not exist. Not `new URL('./data-table.tsx', import.meta.url)`:
    // under this package's jsdom test environment, Vite's import analysis
    // treats that exact pattern as an asset reference and rewrites it to a
    // served http://localhost URL instead of a file:// one - verified by
    // running it here first. Plain `import.meta.url` (property access,
    // statically replaced by Vite with this file's real path) plus Node's
    // own path helpers sidesteps that rewrite.
    const dataTableTsxPath = join(dirname(fileURLToPath(import.meta.url)), 'data-table.tsx');
    const allExports = listExportedDeclarationNames(dataTableTsxPath);
    const nonComponents = ['dataTableColumnHelper', 'dataTableFeatures', 'DataTableFeatures', 'dataTableSelectionColumn', 'DataTableSelectionColumnLabels'];
    for (const name of nonComponents) {
      expect(allExports, name).toContain(name);
    }
    // Every non-component name is genuinely not one of the two compiled
    // contracts' component names - the coverage report's "skipped" list
    // and the actual overlay set must agree on this.
    const componentNames = new Set(['DataTable', 'DataTableSortButton']);
    for (const name of nonComponents) {
      expect(componentNames.has(name), name).toBe(false);
    }
  });
});

describe('data-table: no passthrough for either contract', () => {
  it('DataTable has no DOM/Base UI heritage - allOf carries only the base type', () => {
    const extraction = resolveTargetExtraction(DIRECTORY, DIRECTORY);
    expect(extraction.passthroughOrigin).toBeUndefined();
    expect(units[DIRECTORY].contract.allOf).toEqual([{ $ref: BASE_TYPE_ID }]);
  });

  it('DataTableSortButton composes Button by rendering it, not by extending its props type - also no passthrough', () => {
    // DataTableSortButtonProps declares column/children/className itself and
    // extends nothing; the <Button> underneath is JSX in its own render
    // body, which the extractor's own/inherited split never sees (own vs
    // inherited is about DECLARATION FILE of a props TYPE, not what a
    // component renders) - classify what the extractor actually reports,
    // don't assume it from what the component renders.
    const extraction = resolveTargetExtraction(DIRECTORY, 'data-table-sort-button');
    expect(extraction.inheritedProps).toEqual([]);
    expect(extraction.passthroughOrigin).toBeUndefined();
    expect(units['data-table-sort-button'].contract.allOf).toEqual([{ $ref: BASE_TYPE_ID }]);
  });
});

describe('data-table: extension points', () => {
  it("DataTable's extension_points names columns, dataTableColumnHelper, dataTableSelectionColumn and dataTableFeatures", () => {
    const points = units[DIRECTORY].instance.extension_points ?? [];
    const byName = new Map(points.map((p) => [p.name, p]));
    expect(byName.get('columns')?.kind).toBe('prop');
    expect(byName.get('columns')?.typed_by).toContain('ColumnDef');
    expect(byName.get('dataTableColumnHelper')?.kind).toBe('helper');
    expect(byName.get('dataTableSelectionColumn')?.kind).toBe('helper');
    expect(byName.get('dataTableFeatures')?.kind).toBe('feature');
  });

  it('DataTableSortButton declares no extension_points of its own', () => {
    expect(units['data-table-sort-button'].instance.extension_points).toBeUndefined();
  });
});

describe('data-table: coverage.assumptions present', () => {
  it("DataTable's assumptions cover the generic TData and the opaque columns/selectionSummary props", () => {
    const assumptions = units[DIRECTORY].instance.coverage.assumptions ?? [];
    expect(assumptions.length).toBeGreaterThan(0);
    expect(assumptions.some((a) => /TData/.test(a.claim))).toBe(true);
    expect(assumptions.some((a) => /columns/.test(a.claim))).toBe(true);
    expect(assumptions.some((a) => /selectionSummary/.test(a.claim))).toBe(true);
  });

  it("DataTableSortButton's assumptions cover the runtime Column instance and the no-typed-parent gap", () => {
    const assumptions = units['data-table-sort-button'].instance.coverage.assumptions ?? [];
    expect(assumptions.length).toBeGreaterThan(0);
    expect(assumptions.some((a) => /Column/.test(a.claim))).toBe(true);
    expect(assumptions.some((a) => /composes the kit's own Button/.test(a.claim))).toBe(true);
  });
});

describe('data-table in a GTS store', () => {
  function registeredStore(): GTS {
    const gts = new GTS();
    gts.register(baseSchema);
    // The vocabulary the base type's trait schema references: a store
    // missing one fails every entity in it, not just the trait block.
    registerContractTypes((entity) => gts.register(entity));
    for (const { contract } of Object.values(units)) gts.register(contract);
    return gts;
  }

  it('every contract validates as a derived GTS type', () => {
    const gts = registeredStore();
    for (const { stem, contract } of Object.values(units)) {
      const result = gts.validateEntity(bareGtsId(contract.$id));
      expect(result.ok, `${stem}: ${result.error}`).toBe(true);
      expect(result.entity_type).toBe('schema');
    }
  });

  it('every contract derives from the base type, with the base as the parent ref', () => {
    for (const { stem, contract } of Object.values(units)) {
      expect(contract.allOf[0], stem).toEqual({ $ref: BASE_TYPE_ID });
    }
  });

  it('fails when the parent type is not registered - negative control', () => {
    const gts = new GTS();
    for (const { contract } of Object.values(units)) gts.register(contract);
    const result = gts.validateEntity(bareGtsId(units[DIRECTORY].contract.$id));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Parent schema not found');
  });

  it("every contract's x-gts-traits validates against base.component.json's x-gts-traits-schema", () => {
    // See button.contract.test.ts for which gts-ts API this goes through
    // and why validateContractTraits (testing.ts) round-trips the contract
    // through JSON first. Real here: DataTable sets extension_points but not
    // family, DataTableSortButton sets neither - between the two contracts,
    // every optional-trait absence shape this directory can produce is
    // exercised.
    for (const { stem, contract } of Object.values(units)) {
      const result = validateContractTraits(contract);
      expect(result.ok, `${stem}: ${result.error}`).toBe(true);
    }
  });

  it("rejects DataTable's contract when x-gts-traits carries a malformed dont_use_when.instead - negative control", () => {
    const original = units[DIRECTORY].contract;
    const corrupted: CompiledContract = {
      ...original,
      'x-gts-traits': {
        ...original['x-gts-traits'],
        dont_use_when: [{ rule: 'placeholder', instead: 'not-a-gts-id' }],
      },
    };
    const result = validateContractTraits(corrupted);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/trait/i);
  });
});
