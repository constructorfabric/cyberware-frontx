import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { cx } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { Button, type ButtonProps } from '../button/button';
import styles from './alert-dialog.module.css';

export const AlertDialog = AlertDialogPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx).
 */
export type AlertDialogProps = AlertDialogPrimitive.Root.Props;

export interface AlertDialogTriggerProps
  extends Omit<AlertDialogPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function AlertDialogTrigger({ className, ...props }: AlertDialogTriggerProps) {
  return <AlertDialogPrimitive.Trigger className={className} {...props} />;
}

export interface AlertDialogContentProps
  extends Omit<AlertDialogPrimitive.Popup.Props, 'className'> {
  className?: string;
  /**
   * Where to portal the popup. Defaults to <body>. Pass a themed container
   * when the theme is scoped to a subtree (data-theme on a container that
   * isn't at document root) so the popup inherits its tokens and font.
   */
  container?: AlertDialogPrimitive.Portal.Props['container'];
  /**
   * Renders the dimming backdrop behind the popup. An alert dialog is
   * always modal (Base UI does not offer a non-modal AlertDialog — unlike
   * Dialog's `modal={false}`, there is no escape hatch to pair this with),
   * so this only controls whether the scrim itself paints.
   * @default true
   */
  showBackdrop?: boolean;
  /**
   * `sm` narrows the max width and stacks `AlertDialogAction`/
   * `AlertDialogCancel` into two equal columns instead of a row.
   * Read by `AlertDialogFooter`'s CSS off this popup's `data-size`
   * attribute — the same "group" relationship upstream expresses with
   * Tailwind's `group-data-*` variant, expressed here as a plain CSS
   * Modules descendant selector.
   * @default 'default'
   */
  size?: 'default' | 'sm';
}

export function AlertDialogContent({
  className,
  children,
  container,
  showBackdrop = true,
  size = 'default',
  ...props
}: AlertDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal container={container}>
      {showBackdrop && <AlertDialogPrimitive.Backdrop className={styles.backdrop} />}
      <AlertDialogPrimitive.Popup
        data-size={size}
        className={cx(styles.popup, className)}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  );
}

export type AlertDialogHeaderProps = ComponentProps<'div'>;

export function AlertDialogHeader({ className, ...props }: AlertDialogHeaderProps) {
  return <div className={cx(styles.header, className)} {...props} />;
}

export type AlertDialogFooterProps = ComponentProps<'div'>;

export function AlertDialogFooter({ className, ...props }: AlertDialogFooterProps) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

/**
 * An icon or small illustration slot beside the header text (e.g. a
 * warning glyph for a destructive confirmation). Purely a styled
 * container — pass any icon/image as children.
 */
export type AlertDialogMediaProps = ComponentProps<'div'>;

export function AlertDialogMedia({ className, ...props }: AlertDialogMediaProps) {
  return <div className={cx(styles.media, className)} {...props} />;
}

export interface AlertDialogTitleProps
  extends Omit<AlertDialogPrimitive.Title.Props, 'className'> {
  className?: string;
}

export function AlertDialogTitle({ className, ...props }: AlertDialogTitleProps) {
  return <AlertDialogPrimitive.Title className={cx(styles.title, className)} {...props} />;
}

export interface AlertDialogDescriptionProps
  extends Omit<AlertDialogPrimitive.Description.Props, 'className'> {
  className?: string;
}

export function AlertDialogDescription({ className, ...props }: AlertDialogDescriptionProps) {
  return (
    <AlertDialogPrimitive.Description className={cx(styles.description, className)} {...props} />
  );
}

export interface AlertDialogActionProps
  extends Omit<AlertDialogPrimitive.Close.Props, 'className'>,
    Pick<ButtonProps, 'variant' | 'size' | 'loading' | 'icon'> {
  className?: string;
}

/**
 * The dialog's confirming action — a Base UI `AlertDialog.Close` rendered as
 * a kit `Button` (`default` variant unless overridden), the same
 * `render`-prop idiom as `AlertDialogCancel`. Confirming dismisses the
 * dialog, matching upstream, where this part is the primitive's own Action
 * (a Close in everything but name).
 *
 * An `onClick` of your own still runs, and runs FIRST: Base UI merges the
 * consumer handler ahead of its own close handler (see mergeProps'
 * right-to-left order). An async confirm that must keep the dialog open
 * while it works calls `event.preventBaseUIHandler()` in that handler and
 * drives `open` itself.
 *
 * `loading` is the other half of that flow, and the reason this part takes
 * more of `Button`'s surface than `AlertDialogCancel` does: the confirming
 * action is the one that does work. A `loading` Button is disabled (see
 * button.tsx), so the pattern completes itself — prevent the close, set
 * `loading`, and the same button cannot be pressed a second time while the
 * request is in flight. `icon` comes along for the ordinary reason any
 * confirm button might carry a glyph; NEVER as a child (button.tsx's own
 * doc says why).
 */
export function AlertDialogAction({
  className,
  variant,
  size,
  loading,
  icon,
  ...props
}: AlertDialogActionProps) {
  return (
    <AlertDialogPrimitive.Close
      className={className}
      render={<Button variant={variant} size={size} loading={loading} icon={icon} />}
      {...props}
    />
  );
}

export interface AlertDialogCancelProps
  extends Omit<AlertDialogPrimitive.Close.Props, 'className'>,
    Pick<ButtonProps, 'variant' | 'size'> {
  className?: string;
}

/**
 * The dialog's dismissing action — a Base UI `AlertDialog.Close` rendered
 * as a kit `Button` (`outline` variant by default), same `render`-prop
 * idiom as `DialogContent`'s built-in close button.
 */
export function AlertDialogCancel({
  className,
  variant = 'outline',
  size,
  ...props
}: AlertDialogCancelProps) {
  return (
    <AlertDialogPrimitive.Close
      className={className}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  );
}
