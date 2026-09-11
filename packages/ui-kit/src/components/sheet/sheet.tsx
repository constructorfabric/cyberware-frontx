import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../button/button';
import styles from './sheet.module.css';

export const Sheet = DialogPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx).
 */
export type SheetProps = DialogPrimitive.Root.Props;

export interface SheetTriggerProps extends Omit<DialogPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function SheetTrigger({ className, ...props }: SheetTriggerProps) {
  return <DialogPrimitive.Trigger className={className} {...props} />;
}

export interface SheetCloseProps extends Omit<DialogPrimitive.Close.Props, 'className'> {
  className?: string;
}

export function SheetClose({ className, ...props }: SheetCloseProps) {
  return <DialogPrimitive.Close className={className} {...props} />;
}

const sheetContentVariants = cva(styles.popup, {
  variants: {
    side: {
      top: styles.sideTop,
      right: styles.sideRight,
      bottom: styles.sideBottom,
      left: styles.sideLeft,
    },
  },
  defaultVariants: {
    side: 'right',
  },
});

export interface SheetContentProps
  extends Omit<DialogPrimitive.Popup.Props, 'className'>,
    VariantProps<typeof sheetContentVariants> {
  className?: string;
  /**
   * Where to portal the panel. Defaults to <body>. Pass a themed container
   * when the theme is scoped to a subtree — same contract as DialogContent.
   */
  container?: DialogPrimitive.Portal.Props['container'];
  /** Renders a top-right close (X) button inside the panel. @default true */
  showCloseButton?: boolean;
  /**
   * Accessible name for the built-in close (X) button — same contract as
   * DialogContent's closeLabel. @default 'Close'
   */
  closeLabel?: string;
  /**
   * Renders the dimming backdrop behind the panel. Pair with
   * `modal={false}` on the root for a genuinely non-modal sheet — same
   * `modal`+`showBackdrop` pairing contract as DialogContent.
   * @default true
   */
  showBackdrop?: boolean;
}

export function SheetContent({
  className,
  children,
  container,
  side = 'right',
  showCloseButton = true,
  showBackdrop = true,
  closeLabel = 'Close',
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal container={container}>
      {showBackdrop && <DialogPrimitive.Backdrop className={styles.backdrop} />}
      <DialogPrimitive.Popup
        className={sheetContentVariants({ side, className })}
        data-side={side}
        {...props}
      >
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

export type SheetHeaderProps = ComponentProps<'div'>;

export function SheetHeader({ className, ...props }: SheetHeaderProps) {
  return <div className={cx(styles.header, className)} {...props} />;
}

export type SheetFooterProps = ComponentProps<'div'>;

export function SheetFooter({ className, ...props }: SheetFooterProps) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

export interface SheetTitleProps extends Omit<DialogPrimitive.Title.Props, 'className'> {
  className?: string;
}

export function SheetTitle({ className, ...props }: SheetTitleProps) {
  return <DialogPrimitive.Title className={cx(styles.title, className)} {...props} />;
}

export interface SheetDescriptionProps
  extends Omit<DialogPrimitive.Description.Props, 'className'> {
  className?: string;
}

export function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return <DialogPrimitive.Description className={cx(styles.description, className)} {...props} />;
}
