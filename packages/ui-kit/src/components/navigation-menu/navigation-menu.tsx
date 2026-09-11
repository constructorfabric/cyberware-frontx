import { NavigationMenu as NavigationMenuPrimitive } from '@base-ui/react/navigation-menu';
import { cva, cx } from 'class-variance-authority';
import { ChevronDownIcon } from 'lucide-react';

import styles from './navigation-menu.module.css';

export interface NavigationMenuProps<Value = unknown>
  extends Omit<NavigationMenuPrimitive.Root.Props<Value>, 'className'>,
    Pick<
      NavigationMenuPrimitive.Positioner.Props,
      // positionMethod/collision*: the escape hatch for a menu anchored
      // inside a transform/filter container, same rationale as
      // dropdown-menu.tsx/select.tsx.
      | 'side'
      | 'sideOffset'
      | 'align'
      | 'alignOffset'
      | 'positionMethod'
      | 'collisionBoundary'
      | 'collisionPadding'
    > {
  className?: string;
  /**
   * Where to portal the shared popup. Defaults to <body>. Pass a themed
   * container when the theme is scoped to a subtree (data-theme on a
   * container that isn't at document root) so the popup inherits its
   * tokens and font — same contract as DropdownMenuContent/SelectContent.
   */
  container?: NavigationMenuPrimitive.Portal.Props['container'];
}

/**
 * The root. Unlike DropdownMenu/Select, the portal/positioner/popup/viewport
 * tree is NOT assembled by each item's content — it lives here, rendered
 * once as an automatic sibling of `children` (matching the upstream shadcn
 * source, apps/v4/registry/bases/base/ui/navigation-menu.tsx: its
 * `NavigationMenu` root renders `<NavigationMenuPositioner>` unconditionally
 * alongside its children). That single Viewport is what every active
 * NavigationMenuContent portals into and morphs to fit — see
 * navigation-menu.module.css's header comment and NavigationMenuContent.mjs.
 */
export function NavigationMenu<Value = unknown>({
  className,
  children,
  container,
  side = 'bottom',
  sideOffset = 8,
  align = 'start',
  alignOffset = 0,
  positionMethod,
  collisionBoundary,
  collisionPadding,
  ...props
}: NavigationMenuProps<Value>) {
  return (
    <NavigationMenuPrimitive.Root className={cx(styles.root, className)} {...props}>
      {children}
      <NavigationMenuPrimitive.Portal container={container}>
        <NavigationMenuPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          positionMethod={positionMethod}
          collisionBoundary={collisionBoundary}
          collisionPadding={collisionPadding}
          className={styles.positioner}
        >
          <NavigationMenuPrimitive.Popup className={styles.popup}>
            <NavigationMenuViewport />
          </NavigationMenuPrimitive.Popup>
        </NavigationMenuPrimitive.Positioner>
      </NavigationMenuPrimitive.Portal>
    </NavigationMenuPrimitive.Root>
  );
}

export interface NavigationMenuListProps extends Omit<NavigationMenuPrimitive.List.Props, 'className'> {
  className?: string;
}

export function NavigationMenuList({ className, ...props }: NavigationMenuListProps) {
  return <NavigationMenuPrimitive.List className={cx(styles.list, className)} {...props} />;
}

export interface NavigationMenuItemProps extends Omit<NavigationMenuPrimitive.Item.Props, 'className'> {
  className?: string;
}

export function NavigationMenuItem({ className, ...props }: NavigationMenuItemProps) {
  return <NavigationMenuPrimitive.Item className={cx(styles.item, className)} {...props} />;
}

export interface NavigationMenuIconProps extends Omit<NavigationMenuPrimitive.Icon.Props, 'className'> {
  className?: string;
}

/**
 * The trigger's chevron. A real part of Base UI's primitive (not a private
 * helper like DropdownMenu's icons): NavigationMenuIcon reads its "is this
 * item's popup open" state from context — it must be rendered inside a
 * NavigationMenuItem — and NavigationMenuTrigger below already does so by
 * default. Exported for a consumer composing a custom trigger.
 */
export function NavigationMenuIcon({ className, ...props }: NavigationMenuIconProps) {
  return (
    <NavigationMenuPrimitive.Icon
      render={<ChevronDownIcon className={cx(styles.svgIcon, styles.triggerIcon, className)} />}
      {...props}
    />
  );
}

export interface NavigationMenuTriggerProps
  extends Omit<NavigationMenuPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function NavigationMenuTrigger({ className, children, ...props }: NavigationMenuTriggerProps) {
  return (
    <NavigationMenuPrimitive.Trigger className={cx(styles.trigger, className)} {...props}>
      {children}
      <NavigationMenuIcon />
    </NavigationMenuPrimitive.Trigger>
  );
}

/**
 * className recipe for a plain NavigationMenuLink that should sit in the
 * row and look like a trigger without opening a popup (e.g. a "Pricing"
 * link beside "Products"/"Solutions" triggers) — same idiom and same name
 * as the upstream shadcn export (`navigationMenuTriggerStyle`), kept as a
 * cva() call with no variants (yet) for the same reason upstream does:
 * a stable, extensible recipe rather than a raw className re-export.
 */
export const navigationMenuTriggerStyle = cva(styles.trigger);

export interface NavigationMenuContentProps
  extends Omit<NavigationMenuPrimitive.Content.Props, 'className'> {
  className?: string;
}

export function NavigationMenuContent({ className, ...props }: NavigationMenuContentProps) {
  return <NavigationMenuPrimitive.Content className={cx(styles.content, className)} {...props} />;
}

export interface NavigationMenuLinkProps extends Omit<NavigationMenuPrimitive.Link.Props, 'className'> {
  className?: string;
}

export function NavigationMenuLink({ className, ...props }: NavigationMenuLinkProps) {
  return <NavigationMenuPrimitive.Link className={cx(styles.link, className)} {...props} />;
}

export interface NavigationMenuViewportProps
  extends Omit<NavigationMenuPrimitive.Viewport.Props, 'className'> {
  className?: string;
}

/**
 * The clipping viewport every active NavigationMenuContent portals into.
 * Rendered automatically by NavigationMenu (above) — exported as its own
 * typed part for the same reason DropdownMenuGroup/SelectGroup are, even
 * though a consumer never places it manually in the ordinary composition.
 */
export function NavigationMenuViewport({ className, ...props }: NavigationMenuViewportProps) {
  return <NavigationMenuPrimitive.Viewport className={cx(styles.viewport, className)} {...props} />;
}

export interface NavigationMenuIndicatorProps
  extends Omit<NavigationMenuPrimitive.Icon.Props, 'className'> {
  className?: string;
}

/**
 * A small arrow that tracks the active trigger — see navigation-menu.module
 * .css's `.indicator` comment for why it must be rendered as a child of the
 * same NavigationMenuItem as its NavigationMenuTrigger (Base UI's per-item
 * Icon context, not a shared list-level element with computed position).
 */
export function NavigationMenuIndicator({ className, ...props }: NavigationMenuIndicatorProps) {
  return (
    <NavigationMenuPrimitive.Icon className={cx(styles.indicator, className)} {...props}>
      <div className={styles.indicatorArrow} />
    </NavigationMenuPrimitive.Icon>
  );
}
