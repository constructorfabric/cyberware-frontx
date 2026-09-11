import { cx } from 'class-variance-authority';
import type { ComponentProps, CSSProperties } from 'react';

import styles from './textarea.module.css';

export type TextareaProps = ComponentProps<'textarea'>;

/*
 * A plain styled native <textarea> — matching upstream shadcn/ui's base
 * Textarea, which is a passthrough with no primitive of its own (see
 * registry/bases/base/ui/textarea.tsx). No Base UI Field.Control wrapper:
 * the canonical `Field` (field.tsx) is itself primitive-free and wires
 * nothing automatically — wire `id`/`aria-describedby` by hand, the same
 * way every other control inside `Field` does (see field.md).
 */
export function Textarea({ className, style, rows, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cx(styles.textarea, className)}
      // `field-sizing: content` (textarea.module.css) makes the box grow
      // with its own content — but per the CSS Sizing spec that mode
      // *ignores* the `rows`/`cols` attribute outright, it is not merely
      // a starting point that content-driven growth then overrides. So a
      // caller passing `rows` still gets `rows` forwarded onto the DOM
      // node (a real, verifiable attribute - see textarea.test.tsx) but
      // it has zero effect on rendered geometry: measured empty at
      // `rows={8}`, the box stayed the same 56px `min-height` as
      // `rows={2}`. `--rows` re-derives the floor field-sizing dropped,
      // same private-custom-property idiom as AspectRatio's `--ratio`;
      // left unset for the common no-`rows` case, `var(--rows, 1)` in CSS
      // resolves to the existing 56px floor unchanged.
      style={rows == null ? style : ({ '--rows': rows, ...style } as CSSProperties)}
      {...props}
    />
  );
}
