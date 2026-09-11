import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cx } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../button/button';
import styles from './dialog.module.css';

export const Dialog = DialogPrimitive.Root;
/**
 * The root is a Base UI pass-through, but its props type is still exported:
 * a consumer writing a typed wrapper imports it from this kit — Base UI is
 * this package's dependency, not necessarily theirs. Every root-level
 * pass-through in the kit re-exports its props type for the same reason.
 */
export type DialogProps = DialogPrimitive.Root.Props;

export interface DialogTriggerProps extends Omit<DialogPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function DialogTrigger({ className, ...props }: DialogTriggerProps) {
  return <DialogPrimitive.Trigger className={className} {...props} />;
}

export interface DialogCloseProps extends Omit<DialogPrimitive.Close.Props, 'className'> {
  className?: string;
}

export function DialogClose({ className, ...props }: DialogCloseProps) {
  return <DialogPrimitive.Close className={className} {...props} />;
}

export interface DialogContentProps extends Omit<DialogPrimitive.Popup.Props, 'className'> {
  className?: string;
  /**
   * Where to portal the popup. Defaults to <body>. Pass a themed container
   * when the theme is scoped to a subtree (data-theme on a container that
   * isn't at document root) so the popup inherits its tokens and font.
   */
  container?: DialogPrimitive.Portal.Props['container'];
  /** Renders a top-right close (X) button inside the popup. @default true */
  showCloseButton?: boolean;
  /**
   * Accessible name for the built-in close (X) button — the popup's only
   * kit-authored text, so the one string a non-English app needs to
   * replace. Same contract as Toaster's closeLabel. @default 'Close'
   */
  closeLabel?: string;
  /**
   * Renders the dimming backdrop behind the popup. Pair with
   * `modal={false}` on the root for a genuinely non-modal dialog: without
   * this opt-out the backdrop still covers (and click-closes over) the
   * page even when the root no longer traps focus or locks scroll, so
   * `modal={false}` alone never yields a usable non-modal surface.
   * @default true
   */
  showBackdrop?: boolean;
  /**
   * `lg` widens the popup's sm+ breakpoint cap from 28rem to 36rem, for
   * content that needs more room (a multi-field form, a taller textarea)
   * than the default width comfortably fits. Read by CSS off this popup's
   * `data-size` attribute — same `data-size` idiom as AlertDialogContent's
   * `size`.
   * @default 'default'
   */
  size?: 'default' | 'lg';
}

export function DialogContent({
  className,
  children,
  container,
  showCloseButton = true,
  showBackdrop = true,
  closeLabel = 'Close',
  size = 'default',
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal container={container}>
      {showBackdrop && <DialogPrimitive.Backdrop className={styles.backdrop} />}
      <DialogPrimitive.Popup data-size={size} className={cx(styles.popup, className)} {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className={styles.closeButton}
            render={<Button variant="ghost" icon={<XIcon className={styles.svgIcon} />} />}
          />
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export type DialogHeaderProps = ComponentProps<'div'>;

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div className={cx(styles.header, className)} {...props} />;
}

export type DialogFooterProps = ComponentProps<'div'>;

export function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

export interface DialogTitleProps extends Omit<DialogPrimitive.Title.Props, 'className'> {
  className?: string;
}

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return <DialogPrimitive.Title className={cx(styles.title, className)} {...props} />;
}

export interface DialogDescriptionProps
  extends Omit<DialogPrimitive.Description.Props, 'className'> {
  className?: string;
}

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cx(styles.description, className)} {...props} />;
}
