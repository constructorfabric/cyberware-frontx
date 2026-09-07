// Fixture for extract.test.ts (N1): two VariantProps<typeof X> heritage
// entries whose cva() configs both declare an axis named "size". The old
// loop wrote `axes[axis.name] = ...` unconditionally, so the second
// heritage entry's values silently replaced the first's with no note that
// a real conflict occurred - indistinguishable from "this component just
// has one size axis" in the compiled contract.
import { cva, type VariantProps } from 'class-variance-authority';

const sizeVariants = cva('size-base', {
  variants: {
    size: {
      sm: 'size-sm',
      lg: 'size-lg',
    },
  },
  defaultVariants: {
    size: 'sm',
  },
});

const otherSizeVariants = cva('other-base', {
  variants: {
    size: {
      compact: 'other-compact',
      roomy: 'other-roomy',
    },
  },
});

export type DuplicateAxisProps = VariantProps<typeof sizeVariants> & VariantProps<typeof otherSizeVariants>;

export function DuplicateAxis({ size }: DuplicateAxisProps) {
  return <span className={`${sizeVariants({ size })} ${otherSizeVariants({ size })}`} data-size={size} />;
}
