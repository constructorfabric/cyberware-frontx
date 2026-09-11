/*
 * Load-bearing: none of this module's own functions call a hook — every
 * part is either a re-exported DropdownMenu building block (dropdown-menu.tsx
 * carries the 'use client' marker for its own useContext call) or a plain
 * styling wrapper around Menubar/DropdownMenuTrigger. No 'use client' marker
 * needed here; see scripts/verify-consumer.sh's SERVER_COMPONENTS list.
 */
import { Menubar as MenubarPrimitive } from '@base-ui/react/menubar';
import { cx } from 'class-variance-authority';

import {
  DropdownMenu,
  type DropdownMenuCheckboxItemProps,
  DropdownMenuCheckboxItem,
  type DropdownMenuContentProps,
  DropdownMenuContent,
  type DropdownMenuGroupProps,
  DropdownMenuGroup,
  type DropdownMenuItemProps,
  DropdownMenuItem,
  type DropdownMenuLabelProps,
  DropdownMenuLabel,
  type DropdownMenuProps,
  type DropdownMenuRadioGroupProps,
  DropdownMenuRadioGroup,
  type DropdownMenuRadioItemProps,
  DropdownMenuRadioItem,
  type DropdownMenuSeparatorProps,
  DropdownMenuSeparator,
  type DropdownMenuShortcutProps,
  DropdownMenuShortcut,
  type DropdownMenuSubContentProps,
  DropdownMenuSubContent,
  type DropdownMenuSubProps,
  DropdownMenuSub,
  type DropdownMenuSubTriggerProps,
  DropdownMenuSubTrigger,
  type DropdownMenuTriggerProps,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu';
import styles from './menubar.module.css';

export interface MenubarProps extends Omit<MenubarPrimitive.Props, 'className'> {
  className?: string;
}

export function Menubar({ className, ...props }: MenubarProps) {
  return <MenubarPrimitive className={cx(styles.menubar, className)} {...props} />;
}

/**
 * Each top-level menu is a plain Menu.Root (== DropdownMenu). Base UI
 * detects the ancestor Menubar via context automatically, coordinating
 * roving focus and hover-to-switch between sibling menus with no wiring
 * here — same idiom upstream uses (menubar.tsx literally re-exports its own
 * DropdownMenu parts for every piece except Checkbox/RadioItem).
 */
export const MenubarMenu = DropdownMenu;
export type MenubarMenuProps = DropdownMenuProps;

export interface MenubarTriggerProps extends Omit<DropdownMenuTriggerProps, 'className'> {
  className?: string;
}

export function MenubarTrigger({ className, ...props }: MenubarTriggerProps) {
  return <DropdownMenuTrigger className={cx(styles.trigger, className)} {...props} />;
}

export type MenubarContentProps = DropdownMenuContentProps;

export function MenubarContent({
  align = 'start',
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: MenubarContentProps) {
  return (
    <DropdownMenuContent
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export const MenubarGroup = DropdownMenuGroup;
export type MenubarGroupProps = DropdownMenuGroupProps;

export const MenubarLabel = DropdownMenuLabel;
export type MenubarLabelProps = DropdownMenuLabelProps;

/**
 * Re-exported verbatim, including its `variant` (default/destructive) axis —
 * upstream's own MenubarItem carries no such axis, but it costs nothing to
 * inherit and keeps this module a pure re-export rather than a partial one.
 */
export const MenubarItem = DropdownMenuItem;
export type MenubarItemProps = DropdownMenuItemProps;

/**
 * Re-exported verbatim. Upstream's own MenubarCheckboxItem/MenubarRadioItem
 * duplicate the CheckboxItem/RadioItem indicator markup by hand from
 * `@base-ui/react/menu` instead of reusing their own already-defined
 * DropdownMenuCheckboxItem/DropdownMenuRadioItem — the rendered output is
 * identical either way, so this port reuses the kit's existing parts rather
 * than re-authoring the same markup a second time.
 */
export const MenubarCheckboxItem = DropdownMenuCheckboxItem;
export type MenubarCheckboxItemProps = DropdownMenuCheckboxItemProps;

export const MenubarRadioGroup = DropdownMenuRadioGroup;
export type MenubarRadioGroupProps = DropdownMenuRadioGroupProps;

export const MenubarRadioItem = DropdownMenuRadioItem;
export type MenubarRadioItemProps = DropdownMenuRadioItemProps;

export const MenubarSeparator = DropdownMenuSeparator;
export type MenubarSeparatorProps = DropdownMenuSeparatorProps;

export const MenubarShortcut = DropdownMenuShortcut;
export type MenubarShortcutProps = DropdownMenuShortcutProps;

export const MenubarSub = DropdownMenuSub;
export type MenubarSubProps = DropdownMenuSubProps;

export const MenubarSubTrigger = DropdownMenuSubTrigger;
export type MenubarSubTriggerProps = DropdownMenuSubTriggerProps;

export const MenubarSubContent = DropdownMenuSubContent;
export type MenubarSubContentProps = DropdownMenuSubContentProps;
