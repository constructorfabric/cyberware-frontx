// Fixture for extract.test.ts: a VariantProps<typeof X> heritage entry
// where X is NOT produced by any traceable cva(...) call - `declare const`
// has no initializer at all, so extractVariants must fail to trace it and
// report a `cva:` cannotExtract entry instead of silently emitting no axes.
// This is the negative control for every other cva-*.fixture.tsx: silent
// loss here would be indistinguishable from "this component just has no
// variants", which is exactly the defect (F16) the checker-based resolver
// exists to stop.
import type { VariantProps } from 'class-variance-authority';

declare const mysteryVariants: (props?: { tone?: 'a' | 'b' }) => string;

export type MysteryProps = VariantProps<typeof mysteryVariants>;

export function Mystery({ tone }: MysteryProps) {
  return <span className={mysteryVariants({ tone })} data-tone={tone} />;
}
