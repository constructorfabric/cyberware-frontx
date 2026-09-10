import type { ComponentProps, CSSProperties } from 'react';
import { cx } from 'class-variance-authority';

import styles from './aspect-ratio.module.css';

/*
 * Upstream (apps/v4/registry/bases/base/ui/aspect-ratio.tsx) is plain CSS
 * `aspect-ratio` markup: no primitive, no variant axis, just a `<div>` whose
 * ratio is threaded through as a `--ratio` custom property so `className`
 * can read it via `aspect-(--ratio)` (a Tailwind v4 arbitrary-value
 * utility). This kit has no Tailwind layer, so the CSS Modules translation
 * reads the same custom property directly: `aspect-ratio: var(--ratio)` in
 * aspect-ratio.module.css.
 */
export interface AspectRatioProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
  /** Width-to-height ratio, e.g. `16 / 9` or `1`. */
  ratio: number;
}

export function AspectRatio({ ratio, className, style, ...props }: AspectRatioProps) {
  return (
    <div
      // `--ratio` is consumer-facing per-instance geometry, not a theme
      // color/metric — it has no home in theme.css, the same reasoning as
      // Toast's `--peek`/Table's `--table-row-ring-inset` (see
      // tokens.test.ts's "SAME part, own private use" exemption).
      style={{ '--ratio': ratio, ...style } as CSSProperties}
      className={cx(styles.aspectRatio, className)}
      {...props}
    />
  );
}
