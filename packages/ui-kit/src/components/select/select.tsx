import { Select as SelectPrimitive } from '@base-ui/react/select';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import styles from './select.module.css';

export const Select = SelectPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx). Generic
 * like the root itself: `Value` is the selected value's type, `Multiple`
 * widens `value`/`onValueChange` to arrays when true.
 */
export type SelectProps<
  Value,
  Multiple extends boolean | undefined = false,
> = SelectPrimitive.Root.Props<Value, Multiple>;

export interface SelectValueProps extends Omit<SelectPrimitive.Value.Props, 'className'> {
  className?: string;
}

export function SelectValue({ className, ...props }: SelectValueProps) {
  return <SelectPrimitive.Value className={cx(styles.value, className)} {...props} />;
}

const triggerVariants = cva(styles.trigger, {
  variants: {
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
    },
    /*
     * `filter` is the mockups' Field/filter type (Figma frame 193:433): the
     * same select, compacted into a toolbar filter chip — 36px, label in
     * --muted-foreground even with a value chosen, because in a filter the
     * enduring message is "this narrows the list", not the picked value.
     */
    variant: {
      default: styles.variantDefault,
      filter: styles.variantFilter,
    },
  },
  defaultVariants: {
    size: 'default',
    variant: 'default',
  },
});

export interface SelectTriggerProps
  extends Omit<SelectPrimitive.Trigger.Props, 'className'>, VariantProps<typeof triggerVariants> {
  className?: string;
}

export function SelectTrigger({ className, size, variant, children, ...props }: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger className={triggerVariants({ size, variant, className })} {...props}>
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className={cx(styles.svgIcon, styles.triggerIcon)} />}
      />
    </SelectPrimitive.Trigger>
  );
}

export interface SelectContentProps
  extends Omit<SelectPrimitive.Popup.Props, 'className'>,
    Pick<
      SelectPrimitive.Positioner.Props,
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
   * when the theme is scoped to a subtree (data-theme on a section rather
   * than <html>) so the popup inherits its tokens and font.
   */
  container?: SelectPrimitive.Portal.Props['container'];
}

export function SelectContent({
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
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        /*
         * Never the Base UI default overlay mode (selected item aligned over
         * the trigger): the popup always opens on `side`, below by default.
         * With nothing selected the list starts at the top; a selected item
         * beyond the fold is scrolled into view natively on open — Floating
         * UI's useListNavigation calls scrollIntoView({block: 'nearest'})
         * when a selectedIndex exists (verified against @base-ui/react 1.6.0
         * sources), so no scroll code of ours is needed.
         */
        alignItemWithTrigger={false}
        positionMethod={positionMethod}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className={styles.positioner}
      >
        <SelectPrimitive.Popup className={cx(styles.popup, className)} {...props}>
          <SelectScrollUpButton />
          <SelectPrimitive.List className={styles.list}>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export interface SelectGroupProps extends Omit<SelectPrimitive.Group.Props, 'className'> {
  className?: string;
}

export function SelectGroup({ className, ...props }: SelectGroupProps) {
  return <SelectPrimitive.Group className={cx(styles.group, className)} {...props} />;
}

export interface SelectLabelProps extends Omit<SelectPrimitive.GroupLabel.Props, 'className'> {
  className?: string;
}

export function SelectLabel({ className, ...props }: SelectLabelProps) {
  return <SelectPrimitive.GroupLabel className={cx(styles.groupLabel, className)} {...props} />;
}

export interface SelectItemProps extends Omit<SelectPrimitive.Item.Props, 'className'> {
  className?: string;
  children?: ReactNode;
}

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item className={cx(styles.item, className)} {...props}>
      <SelectPrimitive.ItemText className={styles.itemText}>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator render={<span className={styles.itemIndicator} />}>
        <CheckIcon className={styles.svgIcon} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export interface SelectSeparatorProps extends Omit<SelectPrimitive.Separator.Props, 'className'> {
  className?: string;
}

export function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return <SelectPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}

export interface SelectScrollUpButtonProps
  extends Omit<ComponentProps<typeof SelectPrimitive.ScrollUpArrow>, 'className'> {
  className?: string;
}

export function SelectScrollUpButton({ className, ...props }: SelectScrollUpButtonProps) {
  return (
    <SelectPrimitive.ScrollUpArrow
      className={cx(styles.scrollArrow, styles.scrollArrowUp, className)}
      {...props}
    >
      <ChevronUpIcon className={styles.svgIcon} />
    </SelectPrimitive.ScrollUpArrow>
  );
}

export interface SelectScrollDownButtonProps
  extends Omit<ComponentProps<typeof SelectPrimitive.ScrollDownArrow>, 'className'> {
  className?: string;
}

export function SelectScrollDownButton({ className, ...props }: SelectScrollDownButtonProps) {
  return (
    <SelectPrimitive.ScrollDownArrow
      className={cx(styles.scrollArrow, styles.scrollArrowDown, className)}
      {...props}
    >
      <ChevronDownIcon className={styles.svgIcon} />
    </SelectPrimitive.ScrollDownArrow>
  );
}
