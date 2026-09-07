// Fixture for extract.test.ts: a `type` alias (not `interface`) props type
// built as an intersection of a native element's ComponentProps and an
// inline object literal - covers F15 (type-alias props were invisible to
// the old interface-only walk) and F17's opposite (a SINGLE exported
// component here, contrasted with two-components.fixture.tsx). `tone` is a
// plain string literal union with no cva involved, so its own-prop
// classification (enum) is independent of the axis-extraction path covered
// by the cva-*.fixture.tsx files.
import type { ComponentProps } from 'react';

export type BannerProps = ComponentProps<'div'> & {
  tone: 'info' | 'warning' | 'critical';
};

export function Banner({ tone, ...props }: BannerProps) {
  return <div data-tone={tone} {...props} />;
}
