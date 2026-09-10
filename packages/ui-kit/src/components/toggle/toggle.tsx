import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { cva, type VariantProps } from 'class-variance-authority';

import styles from './toggle.module.css';

export const toggleVariants = cva(styles.toggle, {
  variants: {
    variant: {
      default: styles.variantDefault,
      outline: styles.variantOutline,
    },
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
      lg: styles.sizeLg,
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ToggleProps<Value extends string = string>
  extends Omit<TogglePrimitive.Props<Value>, 'className'>, VariantProps<typeof toggleVariants> {
  className?: string;
}

/*
 * `toggleVariants` is exported (not just `Toggle`) so ToggleGroupItem can
 * apply the exact same variant/size classes to the Base UI Toggle it
 * renders inside a group — same split as upstream shadcn's toggle.tsx,
 * kept here because Toggle must exist before ToggleGroup can import it.
 */
export function Toggle<Value extends string = string>({
  className,
  variant,
  size,
  ...props
}: ToggleProps<Value>) {
  return (
    <TogglePrimitive className={toggleVariants({ variant, size, className })} {...props} />
  );
}
