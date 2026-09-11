import { cva, cx, type VariantProps } from 'class-variance-authority';
import { type ComponentProps, type MouseEvent } from 'react';

import { Button, type ButtonProps } from '../button/public.js';
import { Input, type InputProps } from '../input/public.js';
import { Textarea, type TextareaProps } from '../textarea/public.js';
import styles from './input-group.module.css';

/*
 * InputGroup composes Input/Textarea with addons into ONE visually unified
 * field: the outer group draws the field chrome (border/background/focus
 * ring/error border), the inner control (InputGroupInput/
 * InputGroupTextarea) draws none of its own — see input-group.module.css's
 * `.control` for how that override reaches inside Input/Textarea's OWN
 * class without editing either directory (both are owned elsewhere in this
 * port batch). Same division of labour as upstream's registry item; the
 * markup differs only where this kit's conventions do — no `data-slot`
 * attributes (the kit drops them, see kbd.tsx) and one fewer wrapper,
 * since Input already renders the control directly.
 */
export interface InputGroupProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
}

export function InputGroup({ className, ...props }: InputGroupProps) {
  return <div role="group" className={cx(styles.group, className)} {...props} />;
}

const addonVariants = cva(styles.addon, {
  variants: {
    align: {
      'inline-start': styles.alignInlineStart,
      'inline-end': styles.alignInlineEnd,
      'block-start': styles.alignBlockStart,
      'block-end': styles.alignBlockEnd,
    },
  },
  defaultVariants: {
    align: 'inline-start',
  },
});

export interface InputGroupAddonProps
  extends Omit<ComponentProps<'div'>, 'className'>, VariantProps<typeof addonVariants> {
  className?: string;
}

export function InputGroupAddon({
  className,
  align = 'inline-start',
  onClick,
  ...props
}: InputGroupAddonProps) {
  return (
    <div
      role="group"
      data-align={align}
      className={addonVariants({ align, className })}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        // Clicking the addon's own padding (around a leading icon, say)
        // focuses the group's field — a bigger, friendlier hit target than
        // the field's own edge. A click that actually lands on a button
        // inside the addon (a clear/reveal action) must NOT be hijacked
        // into a focus-steal that fires ahead of — or instead of — that
        // button's own click handling.
        //
        // `textarea` is in the selector where upstream queries `input`
        // alone: a block-start addon ("To:", a toolbar row) sits above a
        // TEXTAREA in every one of its own examples, and upstream's
        // narrower query silently does nothing there.
        if (!(event.target as HTMLElement).closest('button')) {
          event.currentTarget.parentElement
            ?.querySelector<HTMLElement>('input, textarea')
            ?.focus();
        }
        onClick?.(event);
      }}
      {...props}
    />
  );
}

export interface InputGroupButtonProps extends Omit<ButtonProps, 'size' | 'type'> {
  type?: 'button' | 'submit' | 'reset';
  /**
   * Upstream's in-group button scale, minus its icon-only twins: `icon-xs`/
   * `icon-sm` are not sizes in this kit — Button derives icon-only from its
   * own `icon` prop with no children and squares up whatever size is
   * active (see button.tsx), so `<InputGroupButton icon={<XIcon />} />` is
   * the `icon-xs` of this port. `xs` is a compact step below the kit's
   * smallest control height, composed from it in input-group.module.css.
   * @default 'xs'
   */
  size?: 'xs' | 'sm';
}

export function InputGroupButton({
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  className,
  ...props
}: InputGroupButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      // Button's own smallest step is the geometry both in-group sizes
      // start from; `xs` then compresses it (height/padding/radius) via
      // the class below. Passing `sm` here rather than letting Button fall
      // through to its `default` size keeps the label metrics and the
      // icon-only aspect ratio right for both.
      size="sm"
      data-size={size}
      className={cx(styles.button, size === 'xs' && styles.sizeXs, className)}
      {...props}
    />
  );
}

export type InputGroupTextProps = ComponentProps<'span'>;

export function InputGroupText({ className, ...props }: InputGroupTextProps) {
  return <span className={cx(styles.text, className)} {...props} />;
}

export type InputGroupInputProps = InputProps;

export function InputGroupInput({ className, ...props }: InputGroupInputProps) {
  return <Input className={cx(styles.control, className)} {...props} />;
}

export type InputGroupTextareaProps = TextareaProps;

export function InputGroupTextarea({ className, ...props }: InputGroupTextareaProps) {
  return <Textarea className={cx(styles.control, styles.textareaControl, className)} {...props} />;
}
