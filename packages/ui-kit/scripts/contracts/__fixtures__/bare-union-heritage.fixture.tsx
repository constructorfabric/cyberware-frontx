// Fixture for extract.test.ts (N2): a bare union type directly in heritage
// position (an intersection member, not wrapped in a name the walk can
// resolve). typeRefParts returns undefined for a ts.UnionTypeNode - the old
// walk treated that the same as "nothing here," continuing with no
// kind/variantSources contributed and no note that a real heritage member
// went unclassified. The same silent-loss shape as M1's aliased-import
// cases, triggered by a different node kind instead of a different symbol.
export interface RedProps {
  tone: 'red';
}

export interface BlueProps {
  tone: 'blue';
}

export type SwatchProps = (RedProps | BlueProps) & {
  label: string;
};

export function Swatch({ label }: SwatchProps) {
  return <span>{label}</span>;
}
