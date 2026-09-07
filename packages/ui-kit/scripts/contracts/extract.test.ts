// Extractor unit tests: each fixture under __fixtures__ reproduces one shape
// the old syntax-only extractor (see git history) either missed entirely or
// merged incorrectly - F15 (type-alias props), F16 (cva resolved by text
// match, not by symbol), F17 (multiple exported components merged into one
// extraction). A fixture that regresses silently is worse than one that
// fails loudly, so several of these assert on the FAILURE path too
// (cva-unresolvable), not just the happy path.
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractComponent, normalizeTypeText, parseStringLiteralUnion } from './extract';

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
