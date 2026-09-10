import { cx } from 'class-variance-authority';
import { LoaderCircleIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import styles from './spinner.module.css';

/*
 * Spinner has no Base UI primitive (registry/bases/base/ui/spinner.tsx
 * renders `Loader2Icon` styled `size-4 animate-spin` — lucide's legacy
 * alias for `loader-circle`, spelled canonically here) and no
 * variant axis — a pure styling translation, same shape as Skeleton (no
 * cva, just one class). `animate-spin` is reproduced as this module's own
 * `spin` keyframe (see spinner.module.css).
 *
 * `role="status"` + `aria-label` also suppress lucide's default
 * `aria-hidden="true"`: this icon IS the loading announcement, not decoration.
 */
export type SpinnerProps = ComponentProps<'svg'>;

export function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <LoaderCircleIcon
      role="status"
      aria-label="Loading"
      className={cx(styles.spinner, className)}
      {...props}
    />
  );
}
