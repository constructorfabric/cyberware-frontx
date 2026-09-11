import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { Separator, type SeparatorProps } from '../separator/separator';
import styles from './item.module.css';

/*
 * Item is mostly primitive-free (registry/bases/base/ui/item.tsx ships
 * plain `div`s with data-slot markers, same shape as Card — see card.tsx),
 * EXCEPT the root: upstream builds `Item` itself on Base UI's headless
 * `useRender`/`mergeProps` utilities for render-prop polymorphism (e.g.
 * rendering as an `<a>` so a whole item is a link), not a stateful/
 * positioned primitive like Button or Dialog. This port keeps that
 * capability rather than dropping it — the `render` prop is a real part of
 * Item's upstream surface, and "replicate faithfully" extends to it.
 *
 * No `data-slot`/`data-variant`/`data-size` attributes, per the kit-wide
 * convention (see card.tsx): `useRender`'s `state` option would otherwise
 * auto-reflect `variant`/`size` as `data-*` attributes (see Base UI's
 * getStateAttributesProps), so `stateAttributesMapping` below suppresses
 * that while still handing `{ variant, size }` through to a
 * function-as-`render` consumer's callback.
 */

const itemVariants = cva(styles.item, {
  variants: {
    variant: {
      default: styles.variantDefault,
      outline: styles.variantOutline,
      muted: styles.variantMuted,
    },
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
      xs: styles.sizeXs,
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

type ItemVariant = NonNullable<VariantProps<typeof itemVariants>['variant']>;
type ItemSize = NonNullable<VariantProps<typeof itemVariants>['size']>;

export type ItemProps = useRender.ComponentProps<'div', { variant: ItemVariant; size: ItemSize }> &
  VariantProps<typeof itemVariants>;

export function Item({ className, variant, size, render, ...props }: ItemProps) {
  // cva's own VariantProps types these `| null` (a consumer can pass
  // `variant={null}` to explicitly reset to the default), which a default
  // parameter value alone doesn't absorb — only `undefined` does. Resolved
  // here once so `state` below can stay a plain, non-nullable
  // `{ variant, size }` pair.
  const resolvedVariant = variant ?? 'default';
  const resolvedSize = size ?? 'default';
  return useRender({
    defaultTagName: 'div',
    render,
    state: { variant: resolvedVariant, size: resolvedSize },
    stateAttributesMapping: {
      variant: () => null,
      size: () => null,
    },
    props: mergeProps<'div'>({ className: itemVariants({ variant, size, className }) }, props),
  });
}

const itemMediaVariants = cva(styles.itemMedia, {
  variants: {
    variant: {
      default: styles.itemMediaVariantDefault,
      icon: styles.itemMediaVariantIcon,
      image: styles.itemMediaVariantImage,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface ItemMediaProps
  extends ComponentProps<'div'>, VariantProps<typeof itemMediaVariants> {}

/** `variant="image"` also shrinks to match the ancestor `Item`'s own
 * `size` (see item.module.css) — no separate prop, it reads the size class
 * already sitting on the `Item` root. */
export function ItemMedia({ className, variant, ...props }: ItemMediaProps) {
  return <div className={itemMediaVariants({ variant, className })} {...props} />;
}

export type ItemContentProps = ComponentProps<'div'>;

export function ItemContent({ className, ...props }: ItemContentProps) {
  return <div className={cx(styles.itemContent, className)} {...props} />;
}

export type ItemTitleProps = ComponentProps<'div'>;

export function ItemTitle({ className, ...props }: ItemTitleProps) {
  return <div className={cx(styles.itemTitle, className)} {...props} />;
}

/*
 * Deviation from upstream's own typing: source types this as
 * `React.ComponentProps<"p">` and does render a `<p>` (unlike KbdGroup/
 * EmptyDescription's own typing/render mismatch elsewhere in this port —
 * Item's is consistent), kept as-is.
 */
export type ItemDescriptionProps = ComponentProps<'p'>;

export function ItemDescription({ className, ...props }: ItemDescriptionProps) {
  return <p className={cx(styles.itemDescription, className)} {...props} />;
}

export type ItemActionsProps = ComponentProps<'div'>;

export function ItemActions({ className, ...props }: ItemActionsProps) {
  return <div className={cx(styles.itemActions, className)} {...props} />;
}

export type ItemHeaderProps = ComponentProps<'div'>;

export function ItemHeader({ className, ...props }: ItemHeaderProps) {
  return <div className={cx(styles.itemHeader, className)} {...props} />;
}

export type ItemFooterProps = ComponentProps<'div'>;

export function ItemFooter({ className, ...props }: ItemFooterProps) {
  return <div className={cx(styles.itemFooter, className)} {...props} />;
}

export type ItemGroupProps = ComponentProps<'div'>;

/** A `role="list"` container for a run of `Item`s, spacing them apart
 * (the gap shrinks to match the smallest `size` of Item it contains — see
 * item.module.css). */
export function ItemGroup({ className, ...props }: ItemGroupProps) {
  return <div role="list" className={cx(styles.itemGroup, className)} {...props} />;
}

/** A divider between `Item`s, built on the kit's own `Separator` — same
 * composition idiom as `field.tsx`'s `FieldSeparator`. */
export type ItemSeparatorProps = SeparatorProps;

export function ItemSeparator({ className, ...props }: ItemSeparatorProps) {
  return <Separator orientation="horizontal" className={cx(styles.itemSeparator, className)} {...props} />;
}
