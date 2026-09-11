// Load-bearing: DropdownMenuContent calls useContext directly, so this
// can't be dropped. Coupled to CLIENT_COMPONENTS in
// scripts/verify-consumer.sh — keep both in sync if this ever changes.
'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { type ComponentProps, createContext, useContext } from 'react';

import styles from './dropdown-menu.module.css';

/*
 * Carries DropdownMenuContent's effective portal container down to nested
 * submenus, so a theme scoped to a subtree holds one level deep without the
 * consumer repeating `container` on every DropdownMenuSubContent. An
 * explicit `container` on the submenu still wins.
 */
const MenuContainerContext = createContext<MenuPrimitive.Portal.Props['container']>(undefined);

export const DropdownMenu = MenuPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx).
 */
export type DropdownMenuProps = MenuPrimitive.Root.Props;

export interface DropdownMenuTriggerProps extends Omit<MenuPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function DropdownMenuTrigger({ className, ...props }: DropdownMenuTriggerProps) {
  return <MenuPrimitive.Trigger className={className} {...props} />;
}

export interface DropdownMenuContentProps
  extends Omit<MenuPrimitive.Popup.Props, 'className'>,
    Pick<
      MenuPrimitive.Positioner.Props,
      // positionMethod/collision*: the escape hatch for popups anchored
      // inside a transform/filter container (an animated panel is the usual
      // case), where the default absolute positioning resolves against the
      // wrong containing block — positionMethod="fixed" is the standard
      // fix, and it must be reachable without bypassing the kit.
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
   * Inherited by nested DropdownMenuSubContent unless it passes its own.
   */
  container?: MenuPrimitive.Portal.Props['container'];
}

export function DropdownMenuContent({
  className,
  children,
  container,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  alignOffset = 0,
  positionMethod,
  collisionBoundary,
  collisionPadding,
  ...props
}: DropdownMenuContentProps) {
  const inheritedContainer = useContext(MenuContainerContext);
  const effectiveContainer = container ?? inheritedContainer;
  return (
    <MenuContainerContext.Provider value={effectiveContainer}>
      <MenuPrimitive.Portal container={effectiveContainer}>
        <MenuPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          positionMethod={positionMethod}
          collisionBoundary={collisionBoundary}
          collisionPadding={collisionPadding}
          className={styles.positioner}
        >
          <MenuPrimitive.Popup className={cx(styles.popup, className)} {...props}>
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuContainerContext.Provider>
  );
}

export interface DropdownMenuGroupProps extends Omit<MenuPrimitive.Group.Props, 'className'> {
  className?: string;
}

export function DropdownMenuGroup({ className, ...props }: DropdownMenuGroupProps) {
  return <MenuPrimitive.Group className={className} {...props} />;
}

export interface DropdownMenuLabelProps extends Omit<MenuPrimitive.GroupLabel.Props, 'className'> {
  className?: string;
}

export function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) {
  return <MenuPrimitive.GroupLabel className={cx(styles.label, className)} {...props} />;
}

const itemVariants = cva(styles.item, {
  variants: {
    variant: {
      default: styles.variantDefault,
      destructive: styles.variantDestructive,
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface DropdownMenuItemProps
  extends Omit<MenuPrimitive.Item.Props, 'className'>, VariantProps<typeof itemVariants> {
  className?: string;
}

export function DropdownMenuItem({ className, variant, ...props }: DropdownMenuItemProps) {
  return <MenuPrimitive.Item className={itemVariants({ variant, className })} {...props} />;
}

export interface DropdownMenuCheckboxItemProps
  extends Omit<MenuPrimitive.CheckboxItem.Props, 'className'> {
  className?: string;
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem className={cx(styles.checkboxItem, className)} {...props}>
      {children}
      <MenuPrimitive.CheckboxItemIndicator className={styles.itemIndicator}>
        <CheckIcon className={styles.svgIcon} />
      </MenuPrimitive.CheckboxItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
}

export interface DropdownMenuRadioGroupProps
  extends Omit<MenuPrimitive.RadioGroup.Props, 'className'> {
  className?: string;
}

export function DropdownMenuRadioGroup({ className, ...props }: DropdownMenuRadioGroupProps) {
  return <MenuPrimitive.RadioGroup className={className} {...props} />;
}

export interface DropdownMenuRadioItemProps
  extends Omit<MenuPrimitive.RadioItem.Props, 'className'> {
  className?: string;
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <MenuPrimitive.RadioItem className={cx(styles.radioItem, className)} {...props}>
      {children}
      <MenuPrimitive.RadioItemIndicator className={styles.itemIndicator}>
        <CheckIcon className={styles.svgIcon} />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

export interface DropdownMenuSeparatorProps
  extends Omit<MenuPrimitive.Separator.Props, 'className'> {
  className?: string;
}

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return <MenuPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}

export type DropdownMenuShortcutProps = ComponentProps<'span'>;

export function DropdownMenuShortcut({ className, ...props }: DropdownMenuShortcutProps) {
  return <span className={cx(styles.shortcut, className)} {...props} />;
}

export const DropdownMenuSub = MenuPrimitive.SubmenuRoot;
/** Pass-through props type — see DropdownMenuProps. */
export type DropdownMenuSubProps = MenuPrimitive.SubmenuRoot.Props;

export interface DropdownMenuSubTriggerProps
  extends Omit<MenuPrimitive.SubmenuTrigger.Props, 'className'> {
  className?: string;
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <MenuPrimitive.SubmenuTrigger className={cx(styles.subTrigger, className)} {...props}>
      {children}
      <ChevronRightIcon className={cx(styles.svgIcon, styles.subTriggerIcon)} />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export type DropdownMenuSubContentProps = DropdownMenuContentProps;

export function DropdownMenuSubContent({
  className,
  side = 'right',
  align = 'start',
  sideOffset = 0,
  alignOffset = -3,
  ...props
}: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuContent
      className={cx(styles.subPopup, className)}
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      {...props}
    />
  );
}
