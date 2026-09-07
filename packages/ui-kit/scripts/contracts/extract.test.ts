// Extractor unit tests: each fixture under __fixtures__ reproduces one shape
// the old syntax-only extractor (see git history) either missed entirely or
// merged incorrectly - F15 (type-alias props), F16 (cva resolved by text
// match, not by symbol), F17 (multiple exported components merged into one
// extraction). A fixture that regresses silently is worse than one that
// fails loudly, so several of these assert on the FAILURE path too
// (cva-unresolvable), not just the happy path.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractComponent, normalizeTypeText, parseStringLiteralUnion } from './extract';
import { passthroughTypeId, passthroughTypeIdPattern } from './ids';

const fixturesDir = join(process.cwd(), 'scripts/contracts/__fixtures__');
const fixture = (name: string) => join(fixturesDir, name);

describe('extractComponent: type alias and intersection props (F15)', () => {
  const [banner] = extractComponent(fixture('alias-intersection.fixture.tsx'));

  it('reads a `type` alias props declaration, not just `interface`', () => {
    // The old extractor matched only `ts.isInterfaceDeclaration`; BannerProps
    // is a `type` alias, so a regression here reproduces F15 exactly - 42 of
    // 63 kit components declare at least one type-alias props type.
    expect(banner).toBeDefined();
    expect(banner.name).toBe('Banner');
  });

  it("resolves the component's own prop out of an intersection member", () => {
    // `tone` lives in the inline object-literal half of
    // `ComponentProps<'div'> & { tone: ... }` - checker.getPropertiesOfType
    // on the parameter's resolved type merges both halves, so this is
    // exactly the case Omit/Pick/intersection unwrapping has to get right.
    const tone = banner.ownProps.find((p) => p.name === 'tone');
    expect(tone).toBeDefined();
    expect(tone?.optional).toBe(false);
  });

  it("own literal-union prop's normalized type text parses to an enum", () => {
    // What compile.ts's classifyProviderSafeType does with this fact -
    // exercised directly here so the extractor and the union-parsing logic
    // are each tested at the layer that owns them.
    const tone = banner.ownProps.find((p) => p.name === 'tone');
    expect(parseStringLiteralUnion(normalizeTypeText(tone!.typeText))).toEqual(['info', 'warning', 'critical']);
  });

  it('classifies the ComponentProps<\'div\'> half as inherited, not own', () => {
    const own = new Set(banner.ownProps.map((p) => p.name));
    const inherited = new Set(banner.inheritedProps.map((p) => p.name));
    expect(own.has('tone')).toBe(true);
    expect(own.has('id')).toBe(false);
    expect(inherited.has('id')).toBe(true);
    expect(inherited.has('hidden')).toBe(true);
  });

  it("resolves the passthrough element kind from ComponentProps<'div'>", () => {
    expect(banner.passthroughKind).toBe('div');
  });

  it("resolves the passthrough origin as dom_div - a plain DOM tag, no Base UI involved", () => {
    expect(banner.passthroughOrigin).toBe('dom_div');
  });
});

describe('extractComponent: passthrough origin (harness fix - keyed by origin, not DOM tag)', () => {
  const extractions = extractComponent(fixture('base-ui-origin.fixture.tsx'));
  const wrapsButton = extractions.find((e) => e.name === 'WrapsButtonPrimitive')!;
  const wrapsAccordionRoot = extractions.find((e) => e.name === 'WrapsAccordionRootPrimitive')!;

  it('resolves a Base UI primitive declared with no part subdirectory to base_ui_<component>, no trailing part', () => {
    // Button.Props lives directly in button/Button.d.mts - no root/item/...
    // part folder - so the origin has no third token, unlike Accordion below.
    expect(wrapsButton.passthroughKind).toBe('button');
    expect(wrapsButton.passthroughOrigin).toBe('base_ui_button');
  });

  it('resolves a Base UI primitive declared under a part subdirectory to base_ui_<component>_<part>', () => {
    expect(wrapsAccordionRoot.passthroughKind).toBe('div');
    expect(wrapsAccordionRoot.passthroughOrigin).toBe('base_ui_accordion_root');
  });

  it('gives two components wrapping the same DOM tag through different origins two different keys', () => {
    // The exact bug the fix closes: both resolve to a <button>-shaped
    // domTag, but one is Base UI's Button and the other (Banner, the
    // ComponentProps<'div'> fixture above) is a plain DOM element - a
    // shared plain-tag key would have let one overwrite the other.
    expect(wrapsButton.passthroughOrigin).not.toBe(wrapsAccordionRoot.passthroughOrigin);
  });
});

describe('extractComponent: no passthrough origin for a from-scratch props type', () => {
  // Alpha/Beta (two-components.fixture.tsx) extend nothing - no DOM element,
  // no Base UI primitive - the exact shape DataTableProps has (T6): every
  // own prop is declared in the component's own file, so there is nothing
  // to generate a passthrough type FOR, and the origin walk must say so
  // rather than guessing.
  const extractions = extractComponent(fixture('two-components.fixture.tsx'));

  it('leaves passthroughKind and passthroughOrigin both undefined', () => {
    for (const extraction of extractions) {
      expect(extraction.passthroughKind).toBeUndefined();
      expect(extraction.passthroughOrigin).toBeUndefined();
    }
  });
});

describe('extractComponent: multiple exported components in one file (F17)', () => {
  const extractions = extractComponent(fixture('two-components.fixture.tsx'));

  it('returns one extraction per exported component, not one merged extraction', () => {
    expect(extractions.map((e) => e.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it("binds each extraction to its OWN props type - neither leaks the other's props", () => {
    const alpha = extractions.find((e) => e.name === 'Alpha')!;
    const beta = extractions.find((e) => e.name === 'Beta')!;
    expect(alpha.ownProps.map((p) => p.name)).toEqual(['tone']);
    expect(beta.ownProps.map((p) => p.name)).toEqual(['emphasis']);
  });
});

describe('extractComponent: cva resolution through the checker (F16)', () => {
  it("resolves a cva config declared in a SIBLING file, not the component's own .tsx", () => {
    const [chip] = extractComponent(fixture('cva-sibling.fixture.tsx'));
    expect(chip.axes).toEqual({ tone: ['neutral', 'accent'] });
    expect(chip.defaults).toEqual({ tone: 'neutral' });
    expect(chip.cannotExtract).toEqual([]);
  });

  it('resolves a cva call imported under an aliased local name', () => {
    const [tag] = extractComponent(fixture('cva-aliased.fixture.tsx'));
    expect(tag.axes).toEqual({ size: ['sm', 'lg'] });
    expect(tag.defaults).toEqual({ size: 'sm' });
    expect(tag.cannotExtract).toEqual([]);
  });

  it("follows cva's second argument to a variable's initializer when it is not an inline object literal", () => {
    const [badge] = extractComponent(fixture('cva-config-variable.fixture.tsx'));
    expect(badge.axes).toEqual({ weight: ['light', 'bold'] });
    expect(badge.defaults).toEqual({ weight: 'light' });
    expect(badge.cannotExtract).toEqual([]);
  });

  it('reports a `cva:` cannotExtract entry, not silence, when VariantProps names an unresolvable config', () => {
    // The negative control: a component whose VariantProps heritage cannot
    // be traced to a real cva(...) call must say so, loudly, rather than
    // compiling with an empty `variants` object indistinguishable from "no
    // variants at all" - the exact silent-loss defect F16 documents.
    const [mystery] = extractComponent(fixture('cva-unresolvable.fixture.tsx'));
    expect(mystery.axes).toEqual({});
    expect(mystery.cannotExtract.some((msg) => msg.startsWith('cva:'))).toBe(true);
    expect(mystery.cannotExtract.some((msg) => msg.includes('mysteryVariants'))).toBe(true);
  });
});

describe('extractComponent: JSDoc @default, on a real component', () => {
  // Button, not a fixture: Base UI's own nativeButton?: boolean carries a
  // real @default true tag (internals/types.d.mts), and button.tsx's own
  // focusableWhenDisabled documents @default false the same way - one
  // inherited, one own, both worth keeping next to the fact they document
  // rather than discarding at extraction time.
  const [button] = extractComponent(join(process.cwd(), 'src/components/button/button.tsx'));

  it("reads an inherited prop's @default tag from its Base UI declaration", () => {
    const nativeButton = button.inheritedProps.find((p) => p.name === 'nativeButton');
    expect(nativeButton?.jsDocDefault).toBe('true');
  });

  it("reads an own prop's @default tag from the component's own declaration", () => {
    const focusableWhenDisabled = button.ownProps.find((p) => p.name === 'focusableWhenDisabled');
    expect(focusableWhenDisabled?.jsDocDefault).toBe('false');
  });
});

describe('normalizeTypeText', () => {
  it('strips a trailing `| undefined` from an optional prop\'s widened type', () => {
    expect(normalizeTypeText('string | undefined')).toBe('string');
  });

  it('treats React.ReactNode and the bare ReactNode as the same spelling', () => {
    expect(normalizeTypeText('React.ReactNode')).toBe('ReactNode');
    expect(normalizeTypeText('React.ReactNode | undefined')).toBe('ReactNode');
  });
});

describe('parseStringLiteralUnion', () => {
  it('parses a plain string literal union into its member values', () => {
    expect(parseStringLiteralUnion('"a" | "b" | "c"')).toEqual(['a', 'b', 'c']);
  });

  it('drops a `null` member but keeps the string values', () => {
    expect(parseStringLiteralUnion('"a" | "b" | null')).toEqual(['a', 'b']);
  });

  it('returns undefined for a type that is not a string literal union', () => {
    expect(parseStringLiteralUnion('string')).toBeUndefined();
    expect(parseStringLiteralUnion('"a" | number')).toBeUndefined();
  });
});

describe('extractComponent: heritage shapes recognized by resolved symbol, not identifier text (M1)', () => {
  it('classifies an aliased ComponentProps import the same as the unaliased form', () => {
    // `import { ComponentProps as ReactComponentProps }` - a text match on
    // the identifier "ComponentProps" would have missed this entirely.
    const [card] = extractComponent(fixture('aliased-component-props.fixture.tsx'));
    expect(card.cannotExtract).toEqual([]);
    expect(card.passthroughKind).toBe('section');
    expect(card.passthroughOrigin).toBe('dom_section');
    expect(card.ownProps.map((p) => p.name)).toContain('heading');
    expect(card.inheritedProps.map((p) => p.name)).toContain('id');
  });

  it('does not mistake a locally shadowed "Omit" for the real global utility type', () => {
    // Omit has no module export to alias via `import ... as ...` - the
    // failure mode that matters for it is the opposite of ComponentProps's:
    // a local name collision. The old text match would have unwrapped this
    // shadow's first "type argument" (ComponentProps<'span'>) and silently
    // resolved a `span` passthrough kind/origin through a utility type that
    // is not really Omit<T, K> at all. The real inherited props ARE present
    // on the checker-resolved type (this shadow really does forward them)
    // - proving this is a case of "found real props, refused to guess their
    // origin," not "there was nothing here to find."
    const [gadget] = extractComponent(fixture('aliased-omit.fixture.tsx'));
    expect(gadget.passthroughKind).toBeUndefined();
    expect(gadget.passthroughOrigin).toBeUndefined();
    expect(gadget.inheritedProps.length).toBeGreaterThan(0);
    expect(gadget.cannotExtract.length).toBeGreaterThan(0);
  });

  it('reports a cannotExtract entry for a heritage member wrapped in an unrecognized generic type helper', () => {
    // `Readonly<ComponentProps<'div'>>` - Readonly IS a real, resolvable
    // type alias, so the walk unwraps into it, but its underlying shape (a
    // mapped type) is a node kind neither walk understands. The old code's
    // catch-all `if (!parts) return;` silently gave up here.
    const [widget] = extractComponent(fixture('unknown-wrapper.fixture.tsx'));
    expect(widget.cannotExtract.some((msg) => msg.includes('MappedType'))).toBe(true);
  });
});

describe('extractComponent: bare union type in heritage position (N2)', () => {
  it('reports a cannotExtract entry instead of silently resolving nothing', () => {
    const [swatch] = extractComponent(fixture('bare-union-heritage.fixture.tsx'));
    expect(swatch.cannotExtract.some((msg) => msg.includes('UnionType'))).toBe(true);
  });
});

describe('extractComponent: dom_ origin token normalized to snake_case (M2)', () => {
  const PASSTHROUGH_ID_PATTERN = new RegExp(passthroughTypeIdPattern());

  it('replaces a hyphenated custom element tag with underscores in the origin key', () => {
    const [widget] = extractComponent(fixture('custom-element-origin.fixture.tsx'));
    expect(widget.passthroughOrigin).toBe('dom_my_custom_element');
    expect(passthroughTypeId(widget.passthroughOrigin!)).toMatch(PASSTHROUGH_ID_PATTERN);
  });

  it('every committed generated passthrough file carries an $id matching the grammar', () => {
    const generatedDir = join(process.cwd(), 'scripts/contracts/generated');
    const files = readdirSync(generatedDir).filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const schema = JSON.parse(readFileSync(join(generatedDir, name), 'utf8')) as { $id: string };
      expect(schema.$id, name).toMatch(PASSTHROUGH_ID_PATTERN);
    }
  });
});

describe('extractComponent: duplicate VariantProps axis names (N1)', () => {
  it('reports a cannotExtract entry naming both sources instead of silently overwriting the axis', () => {
    const [duplicate] = extractComponent(fixture('duplicate-axis.fixture.tsx'));
    const conflict = duplicate.cannotExtract.find((msg) => msg.includes('axis "size"'));
    expect(conflict).toBeDefined();
    expect(conflict).toContain('sizeVariants');
    expect(conflict).toContain('otherSizeVariants');
    // The first-seen heritage entry's values are kept, not overwritten.
    expect(duplicate.axes.size).toEqual(['sm', 'lg']);
  });
});

describe('extractComponent: synthetic property symbol with no declaration (N4)', () => {
  const [widget] = extractComponent(fixture('synthetic-property.fixture.tsx'));

  it('reports a cannotExtract entry for each undeclared synthetic prop', () => {
    expect(widget.cannotExtract.some((msg) => msg.includes('"a"'))).toBe(true);
    expect(widget.cannotExtract.some((msg) => msg.includes('"b"'))).toBe(true);
  });

  it('never emits declarationFile: "unknown" as ordinary prop data', () => {
    const allProps = [...widget.ownProps, ...widget.inheritedProps];
    expect(allProps.some((p) => p.declarationFile === 'unknown')).toBe(false);
  });

  it('still classifies the real own prop correctly', () => {
    expect(widget.ownProps.map((p) => p.name)).toContain('own');
  });
});

describe('extractComponent: forwardRef/memo-wrapped components (M8)', () => {
  it('recognizes a memo(...)-wrapped export as component-shaped', () => {
    const extractions = extractComponent(fixture('memo-component.fixture.tsx'));
    const ping = extractions.find((e) => e.name === 'Ping');
    expect(ping).toBeDefined();
    expect(ping?.ownProps.map((p) => p.name)).toEqual(['label']);
  });
});

describe('extractComponent: own/inherited props sorted by name (N3)', () => {
  it('returns ownProps and inheritedProps in ascending name order', () => {
    const [button] = extractComponent(join(process.cwd(), 'src/components/button/button.tsx'));
    const ownNames = button.ownProps.map((p) => p.name);
    const inheritedNames = button.inheritedProps.map((p) => p.name);
    expect(ownNames).toEqual([...ownNames].sort());
    expect(inheritedNames).toEqual([...inheritedNames].sort());
  });
});
