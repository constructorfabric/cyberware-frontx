// Fixture for extract.test.ts: cva's config lives in a sibling module
// (cva-sibling.variants.fixture.tsx), imported here under its own name - no
// alias, no member call, just a cva config that is not physically inside
// this file. The old extractor only ever read `${component}.tsx`, so this
// is the minimal case that reproduces F16 if the checker-based resolution
// regresses back to text-only.
import type { VariantProps } from 'class-variance-authority';

import { chipVariants } from './cva-sibling.variants.fixture';

export type ChipProps = VariantProps<typeof chipVariants>;

export function Chip({ tone }: ChipProps) {
  return <span data-tone={tone} />;
}
