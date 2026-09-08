// Conformance for all four Accordion contracts (root, item, trigger,
// content) - one file because the interesting assertions are about how the
// four relate (family membership, composition refs), not about any one of
// them in isolation. See button.contract.test.ts for the per-component
// conformance shape this reuses via testing.ts's assertContractFreshness;
// this file adds what a single, non-compound component has no need for.
import { GTS } from '@globaltypesystem/gts-ts';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import {
  addContractTypes,
  BASE_TYPE_ID,
  buildMetamodel,
  compileContract,
  contractMajor,
  compileInstance,
  loadBaseSchema,
  loadPassthroughSchema,
  registerContractTypes,
  resolveTargetExtraction,
  type CompiledContract,
  type ContractInstance,
} from '../../../scripts/contracts/compile';
import { bareGtsId, componentTypeRef } from '../../../scripts/contracts/ids';
import {
  applyContractTestTimeout,
  assertContractFreshness,
  resolveComponentRef,
  validateContractTraits,
} from '../../../scripts/contracts/testing';

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
  // Every export here renders a real element (all four wrap a Base UI
  // primitive), so elementKind is never undefined - a defensive message
  // beats a bare "Cannot read properties of undefined" if that ever changes.
  if (!extraction.elementKind) {
    throw new Error(`${stem}: expected a host element kind, extraction resolved none`);
  }
  return { stem, contract, instance, passthroughSchema: loadPassthroughSchema(extraction.elementKind) };
}

const units: Record<string, CompiledUnit> = Object.fromEntries(ALL_STEMS.map((stem) => [stem, compileUnit(stem)]));
const baseSchema = loadBaseSchema();
const metaSchema = buildMetamodel();

// The ref every part's own `family.root` and every dont_use_when/composition
// pointer at Accordion itself should agree on - built once so a typo in one
// overlay shows up as a mismatch against this, not just against itself.
const ROOT_REF = componentTypeRef(DIRECTORY, contractMajor(DIRECTORY, DIRECTORY));

describe('accordion family: metamodel validity', () => {
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
});

describe('accordion family: family references resolve', () => {
  it('the root names itself root and lists every part', () => {
    const root = units[DIRECTORY].instance;
    expect(root.family?.role).toBe('root');
    expect(root.family?.root).toBe(ROOT_REF);
    expect(root.family?.parts?.sort()).toEqual(
      PART_STEMS.map((stem) => componentTypeRef(stem, contractMajor(DIRECTORY, stem))).sort(),
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

  it('every part the root lists ships a compiled contract of its own', () => {
    // That each of these references resolves at all - to a component the kit
    // ships, at the major that component ships - is the shared suite's check
    // (assertContractFreshness, testing.ts), which every described component
    // runs. What is specific to a family is stronger: a part named by the
    // root must itself be described, or the family is a set of pointers into
    // components nobody has contracted.
    const root = units[DIRECTORY].instance;
    for (const ref of root.family?.parts ?? []) {
      const target = resolveComponentRef(ref);
      expect(target.contractId, `${ref}: ${target.stem} ships no compiled contract`).toBe(ref);
    }
  });
});

describe('accordion family: composition references resolve', () => {
  // Every children.kinds/parent.kinds entry across the family that is
  // actually a component ref (not the "text" leaf kind Button also uses, and
  // not the external form a mount point outside the kit takes) - gathered
  // once so the resolution check does not repeat itself per unit.
  function typedCompositionRefs(contract: CompiledContract): string[] {
    const composition = contract['x-gts-traits'].composition;
    const refs = [...(composition.children?.kinds ?? []), ...(composition.parent?.kinds ?? [])];
    return refs.filter((ref): ref is string => typeof ref === 'string' && ref !== 'text');
  }

  it("the root's only allowed child is AccordionItem", () => {
    expect(units[DIRECTORY].contract['x-gts-traits'].composition.children?.kinds).toEqual([
      componentTypeRef('accordion-item', contractMajor(DIRECTORY, 'accordion-item')),
    ]);
  });

  it("every part's parent is DERIVED from the contract whose children name it", () => {
    // The family's shape read back out of the derivation rather than
    // authored: the root names the item as its only child, the item names
    // the trigger and the panel, and each part's `parent` is exactly the
    // contract that named it. Nothing in the four overlays writes `parent`,
    // so the two directions cannot disagree - what is asserted here is that
    // the derivation produces the family the overlays describe.
    expect(units['accordion-item'].contract['x-gts-traits'].composition.parent?.kinds).toEqual([
      componentTypeRef(DIRECTORY, contractMajor(DIRECTORY, DIRECTORY)),
    ]);
    for (const stem of ['accordion-trigger', 'accordion-content'] as const) {
      expect(units[stem].contract['x-gts-traits'].composition.parent?.kinds, stem).toEqual([
        componentTypeRef('accordion-item', contractMajor(DIRECTORY, 'accordion-item')),
      ]);
    }
  });

  it('gives the root no parent at all - nothing in the kit mounts an Accordion', () => {
    // Absent, not an empty list: no contract names the root as a child, and
    // an empty `kinds` would read as "may be mounted nowhere".
    expect(units[DIRECTORY].contract['x-gts-traits'].composition.parent).toBeUndefined();
  });

  it('every composition reference in the family points inside the family', () => {
    // Resolution itself is the shared suite's check. What this asserts is
    // the family's own shape: a part may only nest under, or contain,
    // another member of the same family - a composition reference leaving
    // the family would make the parts independently mountable, which is
    // exactly what a compound component is not.
    const familyRefs = new Set(Object.values(units).map(({ contract }) => bareGtsId(contract.$id)));
    for (const { stem, contract } of Object.values(units)) {
      for (const ref of typedCompositionRefs(contract)) {
        expect(familyRefs.has(ref), `${stem}: composition names "${ref}", which is not a member of this family`).toBe(true);
      }
    }
  });
});

describe('accordion family: assumptions carry a kind', () => {
  it("the root's untyped_prop assumptions name the three generic-typed props by prop", () => {
    // The measured defect this closes: an agent shown the root's `value` and
    // `defaultValue` as unconstrained properties concluded they took plain
    // strings. They are now properties of this contract carrying the
    // checker's own type text, and each is named by an assumption whose kind
    // says why nothing asserts it.
    const assumptions = units[DIRECTORY].instance.coverage.assumptions ?? [];
    const untyped = assumptions.filter((a) => a.kind === 'untyped_prop').map((a) => a.prop);
    for (const prop of ['value', 'defaultValue', 'onValueChange']) {
      expect(untyped, prop).toContain(prop);
    }
    const properties = units[DIRECTORY].contract.properties;
    for (const prop of ['value', 'defaultValue']) {
      expect(properties[prop].type, prop).toBeUndefined();
      expect(properties[prop].description, prop).toContain('AccordionValue<Value>');
    }
  });

  it("the root hides orientation and says so as a hidden_part assumption", () => {
    // The kit's own root stylesheet fixes a column layout, so Base UI's
    // horizontal orientation is not something this kit offers. Left out of
    // `properties` and stated once, rather than listed as API the kit does
    // not support.
    expect(units[DIRECTORY].instance.hidden).toEqual(['orientation']);
    expect(units[DIRECTORY].contract.properties).not.toHaveProperty('orientation');
    const assumptions = units[DIRECTORY].instance.coverage.assumptions ?? [];
    expect(assumptions.some((a) => a.kind === 'hidden_part' && /orientation/.test(a.claim))).toBe(true);
  });

  it("the trigger's hidden_part assumption documents the Header+Trigger composition", () => {
    const assumptions = units['accordion-trigger'].instance.coverage.assumptions ?? [];
    expect(assumptions.some((a) => a.kind === 'hidden_part' && (/Header/.test(a.claim) || /Header/.test(a.reason)))).toBe(true);
  });

  it('files a Base UI part prop as API and a React attribute as forwarded surface', () => {
    // The filing rule on the family: `multiple` is Base UI's own
    // AccordionRootProps and reaches the contract typed, while `children`
    // and `role` are React's div attributes and stay on the element surface.
    expect(units[DIRECTORY].contract.properties.multiple).toEqual({ type: 'boolean' });
    for (const prop of ['children', 'role', 'onClick']) {
      expect(units[DIRECTORY].contract.properties, prop).not.toHaveProperty(prop);
    }
  });
});

describe('accordion family in a GTS store', () => {
  function registeredStore(): GTS {
    const gts = new GTS();
    gts.register(baseSchema);
    // The vocabulary the base type's trait schema references: a store
    // missing one fails every entity in it, not just the trait block.
    registerContractTypes((entity) => gts.register(entity));
    // The element surfaces this family's four contracts $ref. Three of the
    // four render a <div> and the trigger renders a <button>, so there are
    // two distinct schemas across four contracts - de-duplicated by $id,
    // because registering the same one twice is not a fact about the family.
    const byId = new Map(Object.values(units).map(({ passthroughSchema }) => [String(passthroughSchema.$id), passthroughSchema]));
    for (const passthroughSchema of byId.values()) gts.register(passthroughSchema);
    for (const { contract } of Object.values(units)) gts.register(contract);
    return gts;
  }

  it('every contract in the family validates as a derived GTS type', () => {
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
    const byId = new Map(Object.values(units).map(({ passthroughSchema }) => [String(passthroughSchema.$id), passthroughSchema]));
    for (const passthroughSchema of byId.values()) gts.register(passthroughSchema);
    for (const { contract } of Object.values(units)) gts.register(contract);
    const result = gts.validateEntity(bareGtsId(units[DIRECTORY].contract.$id));
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
