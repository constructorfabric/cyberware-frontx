// Load-bearing: ButtonGroupText calls useRender directly, so this can't be
// dropped. Coupled to CLIENT_COMPONENTS in scripts/verify-consumer.sh — keep
// both in sync if this ever changes.
'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { Separator, type SeparatorProps } from '../separator/public.js';
import styles from './button-group.module.css';

/*
 * Upstream (registry/bases/base/ui/button-group.tsx) joins arbitrary direct
 * children — Button, Input, Select's trigger, plain text — by targeting
 * every child's own `data-slot` attribute with Tailwind arbitrary-value
 * sibling selectors (`[&>[data-slot]~[data-slot]]:rounded-l-none`). This
 * kit drops `data-slot` everywhere (see card.tsx), so there is no marker
 * attribute on an arbitrary child to hook into — the CSS below reaches the
 * same joined-strip look through pure structural selectors instead
 * (`:first-child`/`:last-child`/`:not(...)`), which works on ANY direct
 * child regardless of what component rendered it. See button-group.module.css.
 */
const buttonGroupVariants = cva(styles.group, {
  variants: {
    orientation: {
      horizontal: styles.orientationHorizontal,
      vertical: styles.orientationVertical,
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

export interface ButtonGroupProps
  extends Omit<ComponentProps<'div'>, 'className'>, VariantProps<typeof buttonGroupVariants> {
  className?: string;
}

export function ButtonGroup({ className, orientation, ...props }: ButtonGroupProps) {
  return (
    <div
      role="group"
      data-orientation={orientation ?? 'horizontal'}
      className={buttonGroupVariants({ orientation, className })}
      {...props}
    />
  );
}

/*
 * Render-prop polymorphism via useRender/mergeProps — same shape as Badge
 * (badge.tsx) and BreadcrumbLink (breadcrumb.tsx): a static label between
 * two buttons is the common case (`<div>`, the default), but a consumer
 * gluing in something more specific (e.g. a `<label>` for an adjoining
 * input) can swap the tag without losing the group's typography.
 */
export type ButtonGroupTextProps = useRender.ComponentProps<'div'>;

export function ButtonGroupText({ className, render, ...props }: ButtonGroupTextProps) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({ className: cx(styles.text, className) }, props),
  });
}

export type ButtonGroupSeparatorProps = SeparatorProps;

/*
 * `orientation` defaults to 'vertical' here — the opposite of Separator's
 * own 'horizontal' default (see separator.tsx) — because a divider INSIDE a
 * horizontal button group is a vertical stroke, and vice versa; matches
 * upstream's own default flip.
 */
export function ButtonGroupSeparator({
  className,
  orientation = 'vertical',
  ...props
}: ButtonGroupSeparatorProps) {
  return (
    <Separator
      orientation={orientation}
      className={cx(styles.separator, className)}
      {...props}
    />
  );
}
