import { cx } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './message.module.css';

/*
 * A faithful port of shadcn/ui's base Message
 * (registry/bases/base/ui/message.tsx): a six-part, primitive-free layout —
 * Message has no Base UI primitive, it is plain `<div>`s wired together
 * through a `data-align` state attribute rather than props threaded to
 * every part. Message owns the ROW layout (avatar, alignment, header,
 * footer) around a message; the visible surface goes inside it via Bubble
 * (see bubble.tsx) — Message never renders one itself.
 *
 * No CVA variant axis: `align` is layout-only (flip the row direction,
 * shift descendant alignment) with no separate color/geometry per value,
 * so it travels as a plain `data-align` attribute the CSS reacts to — the
 * same idiom as Button's `data-icon-only`/`data-loading` — rather than a
 * `cva` variant, which would buy nothing over the attribute selector here.
 */

export type MessageGroupProps = ComponentProps<'div'>;

/** Stacks consecutive `Message`s from the same sender. Purely a layout
 * wrapper — see message.md's "Group" section for the accompanying pattern
 * (an empty `MessageAvatar` on every message but the last). */
export function MessageGroup({ className, ...props }: MessageGroupProps) {
  return <div className={cx(styles.messageGroup, className)} {...props} />;
}

export interface MessageProps extends ComponentProps<'div'> {
  /**
   * Which side of the conversation this row belongs to. Reverses the row
   * (avatar/content order) and, via `data-align`, shifts `MessageContent`'s
   * children and `MessageFooter`'s own content to the same edge.
   * @default 'start'
   */
  align?: 'start' | 'end';
}

/** The message row wrapper — avatar, alignment, header, and footer. Render
 * the visible surface inside `MessageContent` via `Bubble`. */
export function Message({ className, align = 'start', ...props }: MessageProps) {
  return <div data-align={align} className={cx(styles.message, className)} {...props} />;
}

export type MessageAvatarProps = ComponentProps<'div'>;

/** The avatar slot, anchored to the bottom of the message. When the message
 * has a `MessageFooter`, the avatar shifts up to stay aligned with the
 * message surface instead of the footer below it. */
export function MessageAvatar({ className, ...props }: MessageAvatarProps) {
  return <div className={cx(styles.messageAvatar, className)} {...props} />;
}

export type MessageContentProps = ComponentProps<'div'>;

/** Wraps the header, message surface, and footer. */
export function MessageContent({ className, ...props }: MessageContentProps) {
  return <div className={cx(styles.messageContent, className)} {...props} />;
}

export type MessageHeaderProps = ComponentProps<'div'>;

/** Content above the message, such as a sender name. Stays aligned to the
 * start regardless of `align`. */
export function MessageHeader({ className, ...props }: MessageHeaderProps) {
  return <div className={cx(styles.messageHeader, className)} {...props} />;
}

export type MessageFooterProps = ComponentProps<'div'>;

/** Content below the message, such as status or actions. Aligns to the
 * message side. */
export function MessageFooter({ className, ...props }: MessageFooterProps) {
  return <div className={cx(styles.messageFooter, className)} {...props} />;
}
