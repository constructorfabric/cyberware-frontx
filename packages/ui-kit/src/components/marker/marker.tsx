'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './marker.module.css';

/*
 * A faithful port of shadcn/ui's base Marker
 * (registry/bases/base/ui/marker.tsx): an inline conversation marker for
 * status updates, system notes, bordered rows, and labeled separators.
 * Marker has no Base UI primitive, but gets `render`-prop polymorphism
 * from `useRender`/`mergeProps` — the same utilities Base UI's own
 * primitives are built on, and the same pattern Badge uses — for turning a
 * marker into a link or button.
 *
 * Pairs with the `shimmer` utility (src/styles/utilities.css, this
 * package's global CSS alongside theme.css — see that file's own header)
 * for a streaming-text effect: add the `shimmer` class to `MarkerContent`
 * directly, same as upstream (see marker.md's "Shimmer" section). Marker
 * does not apply it automatically — unlike Attachment's title
 * (attachment.tsx), which reacts to an upload `state` axis Marker has no
 * equivalent of.
 */
const markerVariants = cva(styles.marker, {
  variants: {
    variant: {
      default: styles.variantDefault,
      separator: styles.variantSeparator,
      border: styles.variantBorder,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface MarkerProps extends useRender.ComponentProps<'div'>, VariantProps<typeof markerVariants> {}

export function Marker({ className, variant, render, ...props }: MarkerProps) {
  // cva's own VariantProps types this `| null` (a consumer can pass
  // `variant={null}` to explicitly reset to the default), which a default
  // parameter value alone doesn't absorb — only `undefined` does. cva reads
  // that null as "emit no variant class at all" while `data-variant` would
  // still be dropped by React, so the marker would come out with neither the
  // default class nor the attribute. Resolved once here, same as item.tsx,
  // so class and attribute always agree.
  const resolvedVariant = variant ?? 'default';
  return useRender({
    defaultTagName: 'div',
    render,
    // `data-variant` is layered on AFTER mergeProps, not passed through it:
    // mergeProps types its own object literal as the closed DOM attribute
    // set for the tag, which rejects a `data-*` key — the same
    // shadow-proofing needed anywhere a `data-*` prop must survive
    // mergeProps.
    props: {
      ...mergeProps<'div'>({ className: markerVariants({ variant: resolvedVariant, className }) }, props),
      'data-variant': resolvedVariant,
    },
  });
}

export { markerVariants };

export type MarkerIconProps = ComponentProps<'span'>;

/** A decorative icon slot, hidden from assistive tech. For an icon-only
 * marker, give `Marker` itself an `aria-label` or visible text — an
 * icon alone announces as empty. */
export function MarkerIcon({ className, ...props }: MarkerIconProps) {
  return <span aria-hidden="true" className={cx(styles.markerIcon, className)} {...props} />;
}

export type MarkerContentProps = ComponentProps<'span'>;

/** The marker's text content. */
export function MarkerContent({ className, ...props }: MarkerContentProps) {
  return <span className={cx(styles.markerContent, className)} {...props} />;
}
