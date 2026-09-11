import { cva, cx, type VariantProps } from 'class-variance-authority';
import { useMemo, type ComponentProps, type ReactNode } from 'react';

import { Label } from '../label/label';
import { Separator } from '../separator/separator';
import styles from './field.module.css';

/*
 * A faithful port of shadcn/ui's base Field
 * (registry/bases/base/ui/field.tsx): a primitive-free 10-part form-layout
 * system, NOT a wrapper over Base UI's Field primitive. Nothing here wires
 * ids/htmlFor/aria-describedby/validation state automatically — a
 * consumer connects `FieldLabel`'s `htmlFor` to the control's `id` and
 * `FieldDescription`/`FieldError`'s `id` to the control's
 * `aria-describedby` by hand, exactly like upstream's own examples do
 * (see field-example.tsx in the shadcn registry). `data-invalid`/
 * `data-disabled` below are plain attributes a consumer sets — not
 * derived from any validation state this file tracks.
 *
 * No `data-slot` attributes, per the kit-wide convention (see card.tsx):
 * cross-part CSS below targets a sibling/descendant part's own CSS-module
 * class instead (`.field.orientationHorizontal .fieldContent`), the same
 * sanctioned same-part-family pattern Card's header/title/content classes
 * already use (see tokens.test.ts).
 */

export type FieldSetProps = ComponentProps<'fieldset'>;

export function FieldSet({ className, ...props }: FieldSetProps) {
  return <fieldset className={cx(styles.fieldSet, className)} {...props} />;
}

const fieldLegendVariants = cva(styles.fieldLegend, {
  variants: {
    variant: {
      legend: styles.variantLegend,
      label: styles.variantLabel,
    },
  },
  defaultVariants: {
    variant: 'legend',
  },
});

export interface FieldLegendProps
  extends ComponentProps<'legend'>, VariantProps<typeof fieldLegendVariants> {}

export function FieldLegend({ className, variant, ...props }: FieldLegendProps) {
  return <legend className={fieldLegendVariants({ variant, className })} {...props} />;
}

export type FieldGroupProps = ComponentProps<'div'>;

/*
 * The container-query root: `Field`'s `orientation="responsive"` queries
 * THIS element's inline size (not the viewport) via `@container
 * field-group`, so a responsive Field lays out by the space its own
 * FieldGroup actually has — e.g. narrow inside a sidebar, wide in a main
 * column — rather than the page's breakpoint.
 */
export function FieldGroup({ className, ...props }: FieldGroupProps) {
  return <div className={cx(styles.fieldGroup, className)} {...props} />;
}

const fieldVariants = cva(styles.field, {
  variants: {
    orientation: {
      vertical: styles.orientationVertical,
      horizontal: styles.orientationHorizontal,
      responsive: styles.orientationResponsive,
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

export interface FieldProps
  extends ComponentProps<'div'>, VariantProps<typeof fieldVariants> {}

export function Field({ className, orientation, ...props }: FieldProps) {
  return (
    <div
      role="group"
      data-orientation={orientation ?? 'vertical'}
      className={fieldVariants({ orientation, className })}
      {...props}
    />
  );
}

export type FieldContentProps = ComponentProps<'div'>;

/*
 * Groups a control's own title/description under `Field`'s `horizontal`/
 * `responsive` orientation (e.g. a Switch with its label beside it and a
 * description below that label) — `Field` detects an immediate
 * `FieldContent` child via `:has()` and switches its own cross-axis
 * alignment from centered to top, since the content column is now taller
 * than the bare control it sits beside (see field.module.css).
 */
export function FieldContent({ className, ...props }: FieldContentProps) {
  return <div className={cx(styles.fieldContent, className)} {...props} />;
}

export type FieldLabelProps = ComponentProps<typeof Label>;

/* Renders the kit Label; `htmlFor` is a plain forwarded prop, wired to the
 * control's `id` by the consumer — see this file's own top comment. */
export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return <Label className={cx(styles.fieldLabel, className)} {...props} />;
}

export type FieldTitleProps = ComponentProps<'div'>;

export function FieldTitle({ className, ...props }: FieldTitleProps) {
  return <div className={cx(styles.fieldTitle, className)} {...props} />;
}

export type FieldDescriptionProps = ComponentProps<'p'>;

export function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return <p className={cx(styles.fieldDescription, className)} {...props} />;
}

export interface FieldSeparatorProps extends ComponentProps<'div'> {
  children?: ReactNode;
}

/* A labelled divider inside a FieldGroup (e.g. "or continue with"),
 * composed from the kit's own Separator rather than a bespoke rule. */
export function FieldSeparator({ children, className, ...props }: FieldSeparatorProps) {
  return (
    <div className={cx(styles.fieldSeparator, className)} {...props}>
      <Separator className={styles.fieldSeparatorLine} />
      {children && <span className={styles.fieldSeparatorContent}>{children}</span>}
    </div>
  );
}

export interface FieldErrorProps extends ComponentProps<'div'> {
  errors?: Array<{ message?: string } | undefined>;
}

/*
 * `children` wins outright when passed (a consumer's own custom markup);
 * otherwise `errors` is deduped by message (the Map-via-message trick
 * keeps the first occurrence of each distinct message) and rendered as a
 * single line for one error or a bulleted list for several — matching
 * upstream's own useMemo shape. Renders nothing (not even the wrapper)
 * when there is no content, so an empty `errors={[]}` never leaves a
 * stray `role="alert"` node for a screen reader to announce.
 */
export function FieldError({ className, children, errors, ...props }: FieldErrorProps) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }
    if (!errors || errors.length === 0) {
      return null;
    }
    const uniqueErrors = Array.from(new Map(errors.map((error) => [error?.message, error])).values());
    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message;
    }
    return (
      <ul className={styles.fieldErrorList}>
        {uniqueErrors.map(
          (error, index) => error?.message && <li key={`${error.message}-${index}`}>{error.message}</li>,
        )}
      </ul>
    );
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return (
    <div role="alert" className={cx(styles.fieldError, className)} {...props}>
      {content}
    </div>
  );
}
