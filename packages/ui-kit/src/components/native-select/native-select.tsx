import { cx } from 'class-variance-authority';
import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import styles from './native-select.module.css';

/*
 * NativeSelect wraps a real <select> — the source-of-truth control
 * (Base UI ships no NativeSelect primitive; this is the same "pure styling
 * translation over native markup" shape as table.tsx, not a Base UI
 * wrapper). The wrapper div exists only because a <select> is a replaced
 * element with no ::before/::after to draw a chevron into — same reasoning
 * as Input's icon/end slots (input.tsx), forced here unconditionally since
 * a select without its dropdown indicator reads as broken, not as a valid
 * "no slot" state the way an unslotted Input does.
 */
export interface NativeSelectProps extends Omit<ComponentProps<'select'>, 'className' | 'size'> {
  className?: string;
  /** Matches the kit's two-step control scale used elsewhere for compact
   * chrome (Table's `density`, Select's `size`) — `lg` is not offered here,
   * mirroring upstream's own sm/default axis. */
  size?: 'sm' | 'default';
}

export function NativeSelect({ className, size = 'default', disabled, ...props }: NativeSelectProps) {
  return (
    <div
      className={cx(styles.wrapper, size === 'sm' && styles.sizeSm, className)}
      data-disabled={disabled || undefined}
    >
      <select
        className={styles.select}
        disabled={disabled}
        {...props}
      />
      <ChevronDownIcon className={styles.icon} />
    </div>
  );
}

export type NativeSelectOptionProps = ComponentProps<'option'>;

export function NativeSelectOption({ className, ...props }: NativeSelectOptionProps) {
  return <option className={cx(styles.option, className)} {...props} />;
}

export type NativeSelectOptGroupProps = ComponentProps<'optgroup'>;

export function NativeSelectOptGroup({ className, ...props }: NativeSelectOptGroupProps) {
  return <optgroup className={cx(styles.optgroup, className)} {...props} />;
}
