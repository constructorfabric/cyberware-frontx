// Fixture for extract.test.ts: two exported React components in one file -
// the norm across the kit (research section 4: roughly half the kit's
// component files export more than one), and the exact shape F17 documents
// as silently merged by the old extractor into one `ownProps`/`forwardedProps`
// pair. extractComponent must return one ComponentExtraction per export,
// each bound to its own props type - Alpha and Beta deliberately declare
// different own props so a merge bug (either extraction leaking the other's
// props) is visible in the test, not just a missing entry.
export interface AlphaProps {
  tone: 'neutral' | 'accent';
}

export function Alpha({ tone }: AlphaProps) {
  return <div data-tone={tone}>Alpha</div>;
}

export interface BetaProps {
  emphasis: boolean;
}

export function Beta({ emphasis }: BetaProps) {
  return <span data-emphasis={emphasis}>Beta</span>;
}
