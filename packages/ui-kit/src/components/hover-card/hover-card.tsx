import { PreviewCard as PreviewCardPrimitive } from '@base-ui/react/preview-card';
import { cx } from 'class-variance-authority';

import styles from './hover-card.module.css';

/**
 * Ported under its upstream name (`hover-card`), not the design-notes'
 * originally planned `preview-card` — an owner decision that supersedes
 * that plan. The Base UI primitive it wraps is still named `PreviewCard`
 * (see below); only the kit's own component/file name follows upstream.
 */
export const HoverCard = PreviewCardPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx).
 */
export type HoverCardProps = PreviewCardPrimitive.Root.Props;

export interface HoverCardTriggerProps
  extends Omit<PreviewCardPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

/**
 * Renders a native `<a>` element (not a `<button>`) — a hover card previews
 * something the trigger already links to (a user's profile, a referenced
 * doc), matching Base UI's PreviewCard.Trigger. Pass `href` directly, or
 * `render` to compose your own link/router component.
 */
export function HoverCardTrigger({ className, ...props }: HoverCardTriggerProps) {
  return <PreviewCardPrimitive.Trigger className={className} {...props} />;
}

export interface HoverCardContentProps
  extends Omit<PreviewCardPrimitive.Popup.Props, 'className'>,
    Pick<
      PreviewCardPrimitive.Positioner.Props,
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
  container?: PreviewCardPrimitive.Portal.Props['container'];
}

export function HoverCardContent({
  className,
  children,
  container,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 4,
  positionMethod,
  collisionBoundary,
  collisionPadding,
  ...props
}: HoverCardContentProps) {
  return (
    <PreviewCardPrimitive.Portal container={container}>
      <PreviewCardPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        positionMethod={positionMethod}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className={styles.positioner}
      >
        <PreviewCardPrimitive.Popup className={cx(styles.popup, className)} {...props}>
          {children}
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}
