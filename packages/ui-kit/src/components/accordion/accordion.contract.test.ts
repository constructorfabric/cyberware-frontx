// Conformance for all four Accordion contracts (root, item, trigger,
// content) - one file because the interesting assertions are about how the
// four relate (family membership, composition refs), not about any one of
// them in isolation. See button.contract.test.ts for the per-component
// conformance shape this reuses via testing.ts's assertContractFreshness;
// this file adds what a single, non-compound component has no need for.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { GTS } from '@globaltypesystem/gts-ts';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import {
  BASE_TYPE_ID,
  buildMetamodel,
  compileContract,
  compileInstance,
  isExternalAlternative,
  loadBaseSchema,
  loadPassthroughSchema,
  resolveTargetExtraction,
  type CompiledContract,
  type ContractInstance,
} from '../../../scripts/contracts/compile';
import { componentTypeRefPattern } from '../../../scripts/contracts/ids';
import { applyContractTestTimeout, assertContractFreshness, validateContractTraits } from '../../../scripts/contracts/testing';

// assertContractFreshness below builds a real TypeScript program - several
// seconds on a CI-class runner, comfortably under 5s locally - so only CI
// hits vitest's default test timeout. Must run before any describe()/it()
// in the file; see applyContractTestTimeout's own comment in testing.ts.
applyContractTestTimeout();

const DIRECTORY = 'accordion';
// stem === directory for the root (see compile.ts's resolveTargetExtraction
// default), so it is not listed alongside the three parts below.
const PART_STEMS = ['accordion-item', 'accordion-trigger', 'accordion-content'] as const;
const ALL_STEMS = [DIRECTORY, ...PART_STEMS] as const;

for (const stem of ALL_STEMS) assertContractFreshness(DIRECTORY, stem);

const componentsDir = join(process.cwd(), 'src/components');
const bareId = (id: string): string => id.replace(/^gts:\/\//, '');

interface CompiledUnit {
  stem: string;
  contract: CompiledContract;
  instance: ContractInstance;
  passthroughSchema: Record<string, unknown>;
}

function compileUnit(stem: string): CompiledUnit {
  const extraction = resolveTargetExtraction(DIRECTORY, stem);
  const contract = compileContract(DIRECTORY, stem);
  const instance = compileInstance(DIRECTORY, stem);
  // Every export here forwards to a real element (all four wrap a Base UI
  // primitive), so passthroughOrigin is never undefined - a defensive
  // message beats a bare "Cannot read properties of undefined" if that ever
  // changes.
  if (!extraction.passthroughOrigin) {
    throw new Error(`${stem}: expected a passthrough origin, extraction resolved none`);
  }
  return { stem, contract, instance, passthroughSchema: loadPassthroughSchema(extraction.passthroughOrigin) };
}

const units: Record<string, CompiledUnit> = Object.fromEntries(ALL_STEMS.map((stem) => [stem, compileUnit(stem)]));
const baseSchema = loadBaseSchema();
const metaSchema = buildMetamodel();
const COMPONENT_TYPE_REF = new RegExp(componentTypeRefPattern(true));

// Resolves a component_type_ref (e.g. "gts.frontx.uikit.component.
// accordion_item.v1~") to the directory that ships it, following the same
// "stem === directory, or stem starts with '<directory>-'" rule
// compile.ts's loadOverlay enforces when it loads a part's overlay - a ref
// this cannot resolve is exactly the defect (a typo, a moved directory)
// these tests exist to catch.
function resolveComponentRef(ref: string): { directory: string; stem: string } {
  const match = COMPONENT_TYPE_REF.exec(ref);
  if (!match) throw new Error(`"${ref}" is not a grammatical GTS component type id`);
  const stem = match[1].replace(/_/g, '-');
  if (existsSync(join(componentsDir, stem))) return { directory: stem, stem };
  for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && stem.startsWith(`${entry.name}-`)) {
      return { directory: entry.name, stem };
    }
  }
  throw new Error(`no directory ships component ref "${ref}" (stem "${stem}")`);
}

function hasCompiledContract(target: { directory: string; stem: string }): boolean {
  return existsSync(join(componentsDir, target.directory, `${target.stem}.contract.json`));
}

// The ref every part's own `family.root` and every dont_use_when/composition
// pointer at Accordion itself should agree on - built once so a typo in one
// overlay shows up as a mismatch against this, not just against itself.
const ROOT_REF = 'gts.frontx.uikit.component.accordion.v1~';

describe('accordion family: metamodel validity', () => {
  it('every instance validates against the component metamodel', () => {
    const ajv = new Ajv2020();
    const validate = ajv.compile(metaSchema);
    for (const { stem, instance } of Object.values(units)) {
      expect(validate(instance), `${stem}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it("each instance's props_schema points at its own compiled contract", () => {
    for (const { stem, instance, contract } of Object.values(units)) {
      expect(instance.props_schema, stem).toBe(contract.$id);
    }
  });
});

describe('accordion family: family references resolve', () => {
  it('the root names itself root and lists every part', () => {
    const root = units[DIRECTORY].instance;
    expect(root.family?.role).toBe('root');
    expect(root.family?.root).toBe(ROOT_REF);
    expect(root.family?.parts?.sort()).toEqual(
      PART_STEMS.map((stem) => `gts.frontx.uikit.component.${stem.replace(/-/g, '_')}.v1~`).sort(),
    );
  });

  it('every part points back at the root and declares no parts of its own', () => {
    for (const stem of PART_STEMS) {
      const family = units[stem].instance.family;
      expect(family?.role, stem).toBe('part');
      expect(family?.root, stem).toBe(ROOT_REF);
      expect(family?.parts, stem).toBeUndefined();
    }
  });

  it('every ref the root lists as a part resolves to a real, compiled contract', () => {
    const root = units[DIRECTORY].instance;
    for (const ref of root.family?.parts ?? []) {
      const target = resolveComponentRef(ref);
      expect(existsSync(join(componentsDir, target.directory)), ref).toBe(true);
      expect(hasCompiledContract(target), `${ref}: no compiled contract at ${target.directory}/${target.stem}.contract.json`).toBe(
        true,
      );
    }
  });
});

describe('accordion family: composition references resolve', () => {
  // Every children.kinds/parent.kinds entry across the family that is
  // actually a component ref (not the "text" leaf kind Button also uses) -
  // gathered once so the resolution check does not repeat itself per unit.
  function typedCompositionRefs(contract: CompiledContract): string[] {
    const composition = contract['x-gts-traits'].composition;
    const refs = [...composition.children.kinds, ...(composition.parent?.kinds ?? [])];
    return refs.filter((ref) => ref !== 'text');
  }

  it("the root's only allowed child is AccordionItem", () => {
    expect(units[DIRECTORY].contract['x-gts-traits'].composition.children.kinds).toEqual([
      'gts.frontx.uikit.component.accordion_item.v1~',
    ]);
  });

  it("every part's parent.kinds names a directory that exists", () => {
    for (const stem of PART_STEMS) {
      const kinds = units[stem].contract['x-gts-traits'].composition.parent?.kinds ?? [];
      expect(kinds.length, stem).toBeGreaterThan(0);
    }
  });

  it('every typed composition ref, across every unit, resolves to a real directory', () => {
    for (const { stem, contract } of Object.values(units)) {
      for (const ref of typedCompositionRefs(contract)) {
        const target = resolveComponentRef(ref);
        expect(existsSync(join(componentsDir, target.directory)), `${stem}: ${ref}`).toBe(true);
      }
    }
  });
});

describe('accordion family: dont_use_when resolves', () => {
  it('every alternative names a directory the kit ships', () => {
    for (const { stem, instance } of Object.values(units)) {
      for (const { rule, instead } of instance.dont_use_when) {
        // An external alternative names something outside the kit, so there
        // is no directory to resolve; the metamodel has already checked its
        // shape. Every accordion rule points at a kit component today - this
        // guard is what keeps that from being an assumption of the loop.
        if (isExternalAlternative(instead)) continue;
        const target = resolveComponentRef(instead);
        expect(existsSync(join(componentsDir, target.directory)), `${stem} dont_use_when "${rule}" -> "${instead}"`).toBe(true);
      }
    }
  });
});

describe('accordion family: generic assumptions present', () => {
  it("the root's coverage.assumptions documents the Value generic", () => {
    const assumptions = units[DIRECTORY].instance.coverage.assumptions ?? [];
    expect(assumptions.length).toBeGreaterThan(0);
    expect(assumptions.some((a) => /Value/.test(a.claim))).toBe(true);
  });

  it("the trigger's coverage.assumptions documents the Header+Trigger composition", () => {
    const assumptions = units['accordion-trigger'].instance.coverage.assumptions ?? [];
    expect(assumptions.length).toBeGreaterThan(0);
    expect(assumptions.some((a) => /Header/.test(a.claim) || /Header/.test(a.reason))).toBe(true);
  });
});

describe('accordion family in a GTS store', () => {
  function registeredStore(): GTS {
    const gts = new GTS();
    gts.register(baseSchema);
    // Every passthrough schema this family's four contracts $ref, once each
    // - root, item, trigger and panel are four different Base UI primitive
    // parts, so each resolves to its own passthrough origin (see
    // ComponentExtraction.passthroughOrigin) and all four are already
    // distinct; registering the same $id twice would mask a real collision
    // instead of catching one.
    for (const { passthroughSchema } of Object.values(units)) gts.register(passthroughSchema);
    for (const { contract } of Object.values(units)) gts.register(contract);
    return gts;
  }

  it('every contract in the family validates as a derived GTS type', () => {
    const gts = registeredStore();
    for (const { stem, contract } of Object.values(units)) {
      const result = gts.validateEntity(bareId(contract.$id));
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
    for (const { passthroughSchema } of Object.values(units)) gts.register(passthroughSchema);
    for (const { contract } of Object.values(units)) gts.register(contract);
    const result = gts.validateEntity(bareId(units[DIRECTORY].contract.$id));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Parent schema not found');
  });

  it("every contract's x-gts-traits validates against base.component.json's x-gts-traits-schema", () => {
    // See button.contract.test.ts for which gts-ts API this goes through
    // (GTS.validateEntity) and why the registration round-trips through
    // JSON first (validateContractTraits, testing.ts) - real here because
    // three of these four contracts (item, trigger, content) omit `family`
    // and all four omit `extension_points`, which is exactly the "genuinely
    // absent, not merely undefined" case that round-trip matters for.
    for (const { stem, contract } of Object.values(units)) {
      const result = validateContractTraits(contract);
      expect(result.ok, `${stem}: ${result.error}`).toBe(true);
    }
  });

  it("rejects the root's contract when x-gts-traits carries an unknown trait key - negative control", () => {
    const root = units[DIRECTORY].contract;
    const corrupted = { ...root, 'x-gts-traits': { ...root['x-gts-traits'], bogus_field: true } } as typeof root;
    const result = validateContractTraits(corrupted);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/trait/i);
  });
});
