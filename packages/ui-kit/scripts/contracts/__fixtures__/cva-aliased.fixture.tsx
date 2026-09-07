// Fixture for extract.test.ts: cva imported under a different local name
// (`makeVariants`, not `cva`) - the extractor must resolve the call by the
// symbol's real declaration (class-variance-authority's own `cva` export),
// not by matching the identifier text "cva" at the call site, or this
// config would be missed the same way F16 documents.
import { cva as makeVariants, type VariantProps } from 'class-variance-authority';

const tagVariants = makeVariants('tag', {
  variants: {
    size: {
      sm: 'tag-sm',
      lg: 'tag-lg',
    },
  },
  defaultVariants: {
    size: 'sm',
  },
});

export type TagProps = VariantProps<typeof tagVariants>;

export function Tag({ size }: TagProps) {
  return <span className={tagVariants({ size })} data-size={size} />;
}
