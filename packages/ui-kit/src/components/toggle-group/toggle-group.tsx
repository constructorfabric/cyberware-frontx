import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { cx, type VariantProps } from 'class-variance-authority';
import { createContext, useContext } from 'react';

import { toggleVariants } from '../toggle/toggle';
import styles from './toggle-group.module.css';

/*
 * Shares variant/size across every item the way upstream shadcn's
 * ToggleGroup does: set once on the group, read by each ToggleGroupItem,
 * with an item's own `variant`/`size` prop as the fallback when the group
 * doesn't set one. Base UI's own ToggleGroup context (pressed values,
 * disabled, orientation) is separate and internal — Toggle already reads
 * it automatically when rendered inside a ToggleGroup, so this context
 * only needs to carry the two CVA axes Base UI doesn't know about.
 */
const ToggleGroupContext = createContext<VariantProps<typeof toggleVariants>>({
  variant: 'default',
  size: 'default',
});

export interface ToggleGroupProps<Value extends string = string>
  extends Omit<ToggleGroupPrimitive.Props<Value>, 'className'>,
    VariantProps<typeof toggleVariants> {
  className?: string;
}

export function ToggleGroup<Value extends string = string>({
  className,
  variant,
  size,
  children,
  ...props
}: ToggleGroupProps<Value>) {
  return (
    <ToggleGroupPrimitive className={cx(styles.group, className)} {...props}>
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

export interface ToggleGroupItemProps<Value extends string = string>
  extends Omit<TogglePrimitive.Props<Value>, 'className'>,
    VariantProps<typeof toggleVariants> {
  className?: string;
}

/*
 * Renders the same Base UI Toggle as the standalone component (not a
 * distinct primitive) — Base UI detects the ToggleGroup ancestor itself
 * and wires pressed/disabled/keyboard nav from there, same as upstream's
 * ToggleGroupItem. The group's variant/size (if set) win over an item's
 * own, matching upstream's `context.variant || variant` precedence.
 * `styles.item` adds only what a group membership needs on top of the
 * standalone toggle look (shrinking instead of wrapping, and lifting
 * above neighbors on focus so the ring isn't clipped by the next item).
 */
export function ToggleGroupItem<Value extends string = string>({
  className,
  variant,
  size,
  ...props
}: ToggleGroupItemProps<Value>) {
  const context = useContext(ToggleGroupContext);
  return (
    <TogglePrimitive
      className={cx(
        styles.item,
        toggleVariants({ variant: context.variant ?? variant, size: context.size ?? size }),
        className,
      )}
      {...props}
    />
  );
}
