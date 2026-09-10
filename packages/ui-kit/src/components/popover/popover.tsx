import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cx } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './popover.module.css';

export const Popover = PopoverPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx).
 */
export type PopoverProps = PopoverPrimitive.Root.Props;

export interface PopoverTriggerProps extends Omit<PopoverPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function PopoverTrigger({ className, ...props }: PopoverTriggerProps) {
  return <PopoverPrimitive.Trigger className={className} {...props} />;
}

export interface PopoverContentProps
  extends Omit<PopoverPrimitive.Popup.Props, 'className'>,
    Pick<
      PopoverPrimitive.Positioner.Props,
      // positionMethod/collision*: see dropdown-menu.tsx — the escape hatch
      // for anchors inside a transform/filter container.
      | 'align'
      | 'alignOffset'
      | 'side'
      | 'sideOffset'
      | 'positionMethod'
      | 'collisionBoundary'
      | 'collisionPadding'
    > {
  className?: string;
  /**
   * Where to portal the popup. Defaults to <body>. Pass a themed container
   * when the theme is scoped to a subtree (data-theme on a container that
   * isn't at document root) so the popup inherits its tokens and font.
   */
  container?: PopoverPrimitive.Portal.Props['container'];
}

export function PopoverContent({
  className,
  children,
  container,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  positionMethod,
  collisionBoundary,
  collisionPadding,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        positionMethod={positionMethod}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className={styles.positioner}
      >
        <PopoverPrimitive.Popup className={cx(styles.popup, className)} {...props}>
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export type PopoverHeaderProps = ComponentProps<'div'>;

export function PopoverHeader({ className, ...props }: PopoverHeaderProps) {
  return <div className={cx(styles.header, className)} {...props} />;
}

export interface PopoverTitleProps extends Omit<PopoverPrimitive.Title.Props, 'className'> {
  className?: string;
}

export function PopoverTitle({ className, ...props }: PopoverTitleProps) {
  return <PopoverPrimitive.Title className={cx(styles.title, className)} {...props} />;
}

export interface PopoverDescriptionProps
  extends Omit<PopoverPrimitive.Description.Props, 'className'> {
  className?: string;
}

export function PopoverDescription({ className, ...props }: PopoverDescriptionProps) {
  return (
    <PopoverPrimitive.Description className={cx(styles.description, className)} {...props} />
  );
}
