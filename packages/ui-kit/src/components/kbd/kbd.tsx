import { cx } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import styles from './kbd.module.css';

/*
 * Kbd has no Base UI primitive (registry/bases/base/ui/kbd.tsx ships a
 * plain `kbd`/data-slot pair, no variant axis) — a pure styling
 * translation over native elements, same shape as Skeleton/Separator: no
 * cva here, just one class.
 *
 * Deviation from upstream's own typing: source types `KbdGroup`'s props as
 * `React.ComponentProps<"div">` but renders a `<kbd>` element regardless
 * (upstream's own inconsistency — grouping several `Kbd`s inside one more
 * `<kbd>` tag is a deliberate semantic choice, not a bug). This port types
 * it as `ComponentProps<'kbd'>` instead, matching the element it actually
 * renders — the kit's "type-safe by default" rule prefers a prop type that
 * describes the real output over faithfully reproducing a source typo.
 *
 * Upstream also carries a Tooltip-context recolor
 * (`in-data-[slot=tooltip-content]:bg-background/20 ...`) that repaints a
 * Kbd sitting inside a TooltipContent. Not reproduced: it keys off a
 * `data-slot="tooltip-content"` attribute, and this kit drops `data-slot`
 * everywhere (see card.tsx) — Tooltip has nothing for a same-file `:has()`/
 * attribute selector here to detect. A consumer nesting Kbd inside
 * TooltipContent gets the plain `--muted`/`--muted-foreground` pair
 * instead of the recolored one; wiring that back in would mean Kbd
 * reaching into Tooltip's own module, which the kit doesn't do anywhere
 * else either.
 */
export type KbdProps = ComponentProps<'kbd'>;

export function Kbd({ className, ...props }: KbdProps) {
  return <kbd className={cx(styles.kbd, className)} {...props} />;
}

export type KbdGroupProps = ComponentProps<'kbd'>;

/** Groups several `Kbd`s (e.g. `Cmd` + `K`) — renders as a `<kbd>` itself,
 * matching upstream (see this file's top comment). */
export function KbdGroup({ className, ...props }: KbdGroupProps) {
  return <kbd className={cx(styles.kbdGroup, className)} {...props} />;
}
