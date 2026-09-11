import { cva, cx, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './alert.module.css';

/*
 * Alert has no Base UI primitive (registry/bases/base/ui/alert.tsx ships
 * plain `div`s with data-slot markers and a `role="alert"` root) — a pure
 * styling translation over native elements, same shape as Card (see
 * card.tsx). No `data-slot` attributes, per the kit-wide convention: the
 * icon/action layout below is detected structurally (`:has()`), the same
 * sanctioned pattern Card's header/action classes already use (see
 * tokens.test.ts).
 */

const alertVariants = cva(styles.alert, {
  variants: {
    variant: {
      default: styles.variantDefault,
      destructive: styles.variantDestructive,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={alertVariants({ variant, className })} {...props} />;
}

export type AlertTitleProps = ComponentProps<'div'>;

export function AlertTitle({ className, ...props }: AlertTitleProps) {
  return <div className={cx(styles.alertTitle, className)} {...props} />;
}

export type AlertDescriptionProps = ComponentProps<'div'>;

export function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  return <div className={cx(styles.alertDescription, className)} {...props} />;
}

/**
 * Positions in the alert's top-right corner (see alert.module.css) — an
 * `AlertAction` present as a direct child also reserves room in the
 * alert's own padding so body text never runs under it, detected the same
 * structural way (no prop to set).
 */
export type AlertActionProps = ComponentProps<'div'>;

export function AlertAction({ className, ...props }: AlertActionProps) {
  return <div className={cx(styles.alertAction, className)} {...props} />;
}
