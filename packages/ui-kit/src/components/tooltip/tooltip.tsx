import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cx } from 'class-variance-authority';

import styles from './tooltip.module.css';

export const Tooltip = TooltipPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx).
 */
export type TooltipProps = TooltipPrimitive.Root.Props;

/**
 * Optional. Mount once near the app root to share open/close delay and
 * grouping across many tooltips (hover one, and adjacent ones within
 * `timeout` reopen instantly — see Base UI Tooltip.Provider). Without it,
 * each `Tooltip` behaves standalone with Base UI's own per-trigger default
 * (600ms open delay, no grouping).
 *
 * Deliberately does not default `delay` to `0` the way base-vega's own
 * wrapper does: that default is coherent in a model where the Provider is
 * mounted once, globally, at the app root, but this kit ships it as
 * optional — silently defaulting to instant-open would mean identical
 * trigger markup opens at 600ms or 0ms depending on an invisible ancestor.
 * Pass `delay` explicitly (here, or per `TooltipTrigger`) to opt into
 * faster grouped tooltips.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export type TooltipProviderProps = TooltipPrimitive.Provider.Props;

export interface TooltipTriggerProps extends Omit<TooltipPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function TooltipTrigger({ className, ...props }: TooltipTriggerProps) {
  return <TooltipPrimitive.Trigger className={className} {...props} />;
}

export interface TooltipContentProps
  extends Omit<TooltipPrimitive.Popup.Props, 'className'>,
    Pick<
      TooltipPrimitive.Positioner.Props,
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
  container?: TooltipPrimitive.Portal.Props['container'];
}

export function TooltipContent({
  className,
  children,
  container,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  positionMethod,
  collisionBoundary,
  collisionPadding,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        positionMethod={positionMethod}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className={styles.positioner}
      >
        <TooltipPrimitive.Popup className={cx(styles.popup, className)} {...props}>
          {children}
          <TooltipPrimitive.Arrow className={styles.arrow} />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
