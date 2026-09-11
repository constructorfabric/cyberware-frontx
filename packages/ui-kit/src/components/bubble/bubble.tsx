'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './bubble.module.css';

/*
 * A faithful port of shadcn/ui's base Bubble
 * (registry/bases/base/ui/bubble.tsx): framed conversational content —
 * chat text, short structured output, quoted replies, suggestions, and
 * reactions. Bubble is intentionally scoped to the bubble surface; avatars,
 * names, timestamps, and message-level actions belong on
 * [`Message`](message.tsx), not here. Bubble has no Base UI primitive, but
 * `BubbleContent` gets `render`-prop polymorphism from
 * `useRender`/`mergeProps` — the same utilities Base UI's own primitives
 * are built on, and the same pattern Badge uses — for a bubble that is
 * actually a link or button.
 *
 * `align` (like Message's own) is layout-only — a plain `data-align`
 * attribute, not a `cva` variant — since it only ever repositions the
 * bubble, with no color/geometry of its own per value. `variant` IS the
 * paint axis and drives real `cva` classes. BubbleReactions' `side`/`align`
 * are genuinely visual (they pick which edge/corner the pill anchors to),
 * so both are `cva` axes of their own, named after the prop the same way
 * `variant`/`size` are elsewhere in the kit.
 */
const bubbleVariants = cva(styles.bubble, {
  variants: {
    variant: {
      default: styles.variantDefault,
      secondary: styles.variantSecondary,
      muted: styles.variantMuted,
      tinted: styles.variantTinted,
      outline: styles.variantOutline,
      ghost: styles.variantGhost,
      destructive: styles.variantDestructive,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type BubbleGroupProps = ComponentProps<'div'>;

/** Stacks consecutive `Bubble`s from the same sender. Set `align` on each
 * `Bubble` itself — it does not belong on the group. */
export function BubbleGroup({ className, ...props }: BubbleGroupProps) {
  return <div className={cx(styles.bubbleGroup, className)} {...props} />;
}

export interface BubbleProps extends ComponentProps<'div'>, VariantProps<typeof bubbleVariants> {
  /**
   * The inline alignment of the bubble within its row.
   * @default 'start'
   */
  align?: 'start' | 'end';
}

/** The root bubble wrapper. */
export function Bubble({ className, variant, align = 'start', ...props }: BubbleProps) {
  // cva's own VariantProps types this `| null` (a consumer can pass
  // `variant={null}` to explicitly reset to the default), which a default
  // parameter value alone doesn't absorb — only `undefined` does. cva reads
  // that null as "emit no variant class at all" while `data-variant` would
  // still be dropped by React, so the bubble would come out with neither the
  // default class nor the attribute. Resolved once here, same as marker.tsx,
  // so class and attribute always agree.
  const resolvedVariant = variant ?? 'default';
  return (
    <div
      data-variant={resolvedVariant}
      data-align={align}
      className={bubbleVariants({ variant: resolvedVariant, className })}
      {...props}
    />
  );
}

export type BubbleContentProps = useRender.ComponentProps<'div'>;

/** The bubble content wrapper — the visible framed surface. Render as a
 * link or button via `render` for a clickable bubble; the visible focus
 * ring and hover feedback only apply once actually rendered that way. */
export function BubbleContent({ className, render, ...props }: BubbleContentProps) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({ className: cx(styles.bubbleContent, className) }, props),
  });
}

const bubbleReactionsVariants = cva(styles.bubbleReactions, {
  variants: {
    side: {
      top: styles.sideTop,
      bottom: styles.sideBottom,
    },
    align: {
      start: styles.alignStart,
      end: styles.alignEnd,
    },
  },
  defaultVariants: {
    side: 'bottom',
    align: 'end',
  },
});

export interface BubbleReactionsProps
  extends ComponentProps<'div'>, VariantProps<typeof bubbleReactionsVariants> {}

/** Displays overlapped reactions anchored to a bubble edge. Reactions
 * overlap the bubble edge, so leave vertical space between bubble rows. */
export function BubbleReactions({ className, side = 'bottom', align = 'end', ...props }: BubbleReactionsProps) {
  return (
    <div
      data-side={side}
      data-align={align}
      className={bubbleReactionsVariants({ side, align, className })}
      {...props}
    />
  );
}

export { bubbleReactionsVariants, bubbleVariants };
