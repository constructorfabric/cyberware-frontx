// Fixture for extract.test.ts: cva's second argument (the { variants,
// defaultVariants } config) is a separately declared variable, not an
// inline object literal at the call site - the extractor has to follow the
// identifier to its initializer the same way it follows `typeof X` to X's
// own cva(...) call.
import { cva, type VariantProps } from 'class-variance-authority';

const config = {
  variants: {
    weight: {
      light: 'w-light',
      bold: 'w-bold',
    },
  },
  defaultVariants: {
    weight: 'light',
  },
};

const badgeVariants = cva('badge', config);

export type BadgeProps = VariantProps<typeof badgeVariants>;

export function Badge({ weight }: BadgeProps) {
  return <span className={badgeVariants({ weight })} data-weight={weight} />;
}
