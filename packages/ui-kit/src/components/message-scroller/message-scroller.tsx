import { MessageScroller as MessageScrollerPrimitive } from '@shadcn/react/message-scroller';
import { cx } from 'class-variance-authority';
import { ArrowDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button, type ButtonProps } from '../button/button';
import styles from './message-scroller.module.css';

/*
 * Behavior (auto-follow tracking, scroll-anchor bookkeeping, imperative
 * scrollToEnd/scrollToStart/scrollToMessage) comes entirely from
 * `@shadcn/react/message-scroller` — a headless, zero-runtime-dep engine,
 * not Base UI, since Base UI ships no chat-scroller primitive. This
 * file only supplies CSS Modules styling and composes the kit `Button` for
 * the jump-to-end/start affordance, matching upstream's own composition
 * (apps/v4/registry/bases/base/ui/message-scroller.tsx).
 *
 * Every part below is a bare styling pass-through — none of them call a
 * hook in their own render body (the stateful work lives inside the
 * imported primitives) — so, per this kit's SERVER_COMPONENTS/
 * CLIENT_COMPONENTS split (scripts/verify-consumer.sh), this file needs no
 * 'use client' directive.
 */

export type MessageScrollerProviderProps = ComponentProps<
  typeof MessageScrollerPrimitive.Provider
>;

/**
 * Holds the scroller's auto-follow state (anchor tracking, autoScroll
 * config) via context — renders no DOM of its own. Wrap the whole chat
 * surface (`MessageScroller` and anything reading `useMessageScroller*`)
 * in exactly one `MessageScrollerProvider`.
 */
export function MessageScrollerProvider(props: MessageScrollerProviderProps) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

export interface MessageScrollerProps
  extends Omit<ComponentProps<typeof MessageScrollerPrimitive.Root>, 'className'> {
  className?: string;
}

/**
 * The scroller's outer frame — a relatively-positioned flex column that
 * clips overflow, so `MessageScrollerButton` (absolutely positioned) has
 * something to anchor against. Give it a bounded height (flex child,
 * fixed height, etc.); `MessageScrollerViewport` fills whatever height
 * this resolves to.
 */
export function MessageScroller({ className, ...props }: MessageScrollerProps) {
  return <MessageScrollerPrimitive.Root className={cx(styles.root, className)} {...props} />;
}

export interface MessageScrollerViewportProps
  extends Omit<ComponentProps<typeof MessageScrollerPrimitive.Viewport>, 'className'> {
  className?: string;
}

/**
 * The scrolling element. Reads/writes native scroll position; the
 * primitive attaches the scroll listener that drives auto-follow and the
 * jump-button's visibility from here.
 */
export function MessageScrollerViewport({ className, ...props }: MessageScrollerViewportProps) {
  return (
    <MessageScrollerPrimitive.Viewport className={cx(styles.viewport, className)} {...props} />
  );
}

export interface MessageScrollerContentProps
  extends Omit<ComponentProps<typeof MessageScrollerPrimitive.Content>, 'className'> {
  className?: string;
}

/** The message list itself — a flex column sized to its content's max height. */
export function MessageScrollerContent({ className, ...props }: MessageScrollerContentProps) {
  return (
    <MessageScrollerPrimitive.Content className={cx(styles.content, className)} {...props} />
  );
}

export interface MessageScrollerItemProps
  extends Omit<ComponentProps<typeof MessageScrollerPrimitive.Item>, 'className'> {
  className?: string;
}

/**
 * One message. `messageId` is what `scrollToMessage` targets;
 * `scrollAnchor` marks the item the auto-follow/anchor bookkeeping should
 * treat as the current read position (typically the newest message).
 * `content-visibility: auto` (see the CSS) keeps a long transcript cheap to
 * render off-screen — jsdom does not implement it, so this optimization is
 * untestable there (see message-scroller.test.tsx).
 */
export function MessageScrollerItem({ className, ...props }: MessageScrollerItemProps) {
  return <MessageScrollerPrimitive.Item className={cx(styles.item, className)} {...props} />;
}

export interface MessageScrollerButtonProps
  extends Omit<ComponentProps<typeof MessageScrollerPrimitive.Button>, 'className'>,
    Pick<ButtonProps, 'variant' | 'size'> {
  className?: string;
}

/**
 * Floating jump-to-end/jump-to-start affordance. Renders as a kit `Button`
 * via the `render` prop (default `secondary`/`sm`, overridable by
 * `variant`/`size`, or replace `render` entirely) — same composition
 * idiom as `AlertDialogCancel`. The primitive supplies `data-active`
 * (visible/hidden), `inert`, and `tabindex` on its own; this file only
 * styles the crossfade those states drive.
 *
 * Deliberately icon-only by default (no visible label) so the kit
 * `Button`'s own icon-only square sizing kicks in — pass `aria-label` to
 * override the default accessible name, or pass `children` for a labeled
 * button instead. The primitive itself falls back to a visible "Scroll to
 * end"/"Scroll to start" text node whenever `children` is nullish (not
 * merely omitted — an explicit `''` is honored as real content), so `''`
 * is passed by default to suppress that fallback: `Button`'s own
 * `hasLabel` derivation already treats an empty string as "no label" (see
 * button.tsx), producing the icon-only square. Upstream instead renders a
 * permanent visually-hidden `sr-only` label span, which would defeat the
 * icon-only auto-sizing here — `aria-label` is the kit's own convention
 * for a bare icon button (see button.md) and needs no extra DOM node.
 */
export function MessageScrollerButton({
  className,
  children,
  render,
  direction = 'end',
  variant = 'secondary',
  size = 'sm',
  'aria-label': ariaLabel,
  ...props
}: MessageScrollerButtonProps) {
  return (
    <MessageScrollerPrimitive.Button
      direction={direction}
      aria-label={ariaLabel ?? (direction === 'end' ? 'Scroll to end' : 'Scroll to start')}
      className={cx(styles.button, className)}
      render={render ?? <Button variant={variant} size={size} /* Rotated 180deg via CSS for the `start` direction. */
      icon={<ArrowDownIcon />} />}
      {...props}
    >
      {children ?? ''}
    </MessageScrollerPrimitive.Button>
  );
}

export {
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller';
