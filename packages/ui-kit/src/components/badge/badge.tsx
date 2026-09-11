'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import styles from './badge.module.css';

/*
 * A port of shadcn/ui's base Badge (registry/bases/base/ui/badge.tsx),
 * carrying upstream's paint variants (default/secondary/destructive/
 * outline/ghost/link — same six values as Button, see button.tsx)
 * unchanged, plus the tone values the Studio mockup's Badge row draws
 * (success/warning/danger/info/accent — see badge.module.css for how each
 * maps onto a theme.css status pair, and why the mockup's sixth specimen,
 * Neutral, is `secondary` rather than a name of its own).
 *
 * Both sets sit on the one `variant` axis because Badge is paint-only:
 * upstream already mixes filled (default/secondary/destructive) with
 * unfilled (outline/ghost/link) values there, so the axis names a LOOK,
 * not an emphasis ladder, and a tone is one more look. Appending to it
 * keeps every upstream value's name and meaning intact — porting shadcn
 * markup here still renders what it renders upstream.
 *
 * Still deliberately absent: the dot/icon slots. The mockup's specimens
 * carry a 6px status dot, but that is anatomy, not paint, and this port
 * only carries what shadcn's own Badge carries — no bespoke additions.
 *
 * Badge has no Base UI primitive, but still gets `render`-prop
 * polymorphism from `useRender`/`mergeProps` — the same utilities Base
 * UI's own primitives are built on — for the one case that needs it:
 * rendering as a link.
 */
const badgeVariants = cva(styles.badge, {
  variants: {
    variant: {
      default: styles.variantDefault,
      secondary: styles.variantSecondary,
      destructive: styles.variantDestructive,
      outline: styles.variantOutline,
      ghost: styles.variantGhost,
      link: styles.variantLink,
      success: styles.variantSuccess,
      warning: styles.variantWarning,
      danger: styles.variantDanger,
      info: styles.variantInfo,
      accent: styles.variantAccent,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface BadgeProps
  extends useRender.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>({ className: badgeVariants({ variant, className }) }, props),
  });
}

export { badgeVariants };
