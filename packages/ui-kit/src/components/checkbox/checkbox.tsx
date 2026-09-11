import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { cx } from 'class-variance-authority';
import { CheckIcon, MinusIcon } from 'lucide-react';

import styles from './checkbox.module.css';

export interface CheckboxProps extends Omit<CheckboxPrimitive.Root.Props, 'className'> {
  className?: string;
}

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root className={cx(styles.checkbox, className)} {...props}>
      <CheckboxPrimitive.Indicator className={styles.indicator}>
        {/* Both marks are always in the DOM; CSS swaps which one shows on the
         * indicator's data-indeterminate state. */}
        <CheckIcon className={cx(styles.icon, styles.iconCheck)} />
        <MinusIcon className={cx(styles.icon, styles.iconIndeterminate)} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
