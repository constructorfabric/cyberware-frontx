import { cva, cx, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './empty.module.css';

/*
 * Empty has no Base UI primitive (registry/bases/base/ui/empty.tsx ships
 * plain `div`s with data-slot markers) — a pure styling translation over
 * native elements, same shape as Card (see card.tsx). No `data-slot`
 * attributes, per the kit-wide convention.
 */

export type EmptyProps = ComponentProps<'div'>;

export function Empty({ className, ...props }: EmptyProps) {
  return <div className={cx(styles.empty, className)} {...props} />;
}

export type EmptyHeaderProps = ComponentProps<'div'>;

export function EmptyHeader({ className, ...props }: EmptyHeaderProps) {
  return <div className={cx(styles.emptyHeader, className)} {...props} />;
}

const emptyMediaVariants = cva(styles.emptyMedia, {
  variants: {
    variant: {
      default: styles.variantDefault,
      icon: styles.variantIcon,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface EmptyMediaProps
  extends ComponentProps<'div'>, VariantProps<typeof emptyMediaVariants> {}

/** `variant="icon"` draws the muted rounded square upstream's icon
 * treatment uses; `variant="default"` (the default) stays transparent —
 * for an illustration or image that already carries its own chrome. */
export function EmptyMedia({ className, variant, ...props }: EmptyMediaProps) {
  return <div className={emptyMediaVariants({ variant, className })} {...props} />;
}

export type EmptyTitleProps = ComponentProps<'div'>;

export function EmptyTitle({ className, ...props }: EmptyTitleProps) {
  return <div className={cx(styles.emptyTitle, className)} {...props} />;
}

/*
 * Deviation from upstream's own typing: source types this as
 * `React.ComponentProps<"p">` but renders a plain `<div>` regardless (the
 * same source/render mismatch as KbdGroup — see kbd.tsx). This port types
 * it `ComponentProps<'div'>`, matching the element actually rendered.
 */
export type EmptyDescriptionProps = ComponentProps<'div'>;

export function EmptyDescription({ className, ...props }: EmptyDescriptionProps) {
  return <div className={cx(styles.emptyDescription, className)} {...props} />;
}

export type EmptyContentProps = ComponentProps<'div'>;

export function EmptyContent({ className, ...props }: EmptyContentProps) {
  return <div className={cx(styles.emptyContent, className)} {...props} />;
}
