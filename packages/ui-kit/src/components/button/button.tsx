import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { Children, type ReactNode } from 'react';

import styles from './button.module.css';

// Exported (upstream parity — shadcn/ui exports buttonVariants) so a
// component that renders link/anchor markup styled like a button, but isn't
// itself a Button (e.g. pagination's page links), can reuse the same class
// map instead of hand-duplicating variant→class wiring.
export const buttonVariants = cva(styles.button, {
  variants: {
    variant: {
      default: styles.variantDefault,
      destructive: styles.variantDestructive,
      outline: styles.variantOutline,
      secondary: styles.variantSecondary,
      ghost: styles.variantGhost,
      link: styles.variantLink,
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

export interface ButtonProps
  extends Omit<ButtonPrimitive.Props, 'className'>, VariantProps<typeof buttonVariants> {
  className?: string;
  /**
   * Leading icon slot — the one right way to put an icon in a Button (never
   * via children; the slot is what gets sized, spaced, hidden during
   * `loading`, and marked decorative). With no children the button turns
   * square icon-only — pass `aria-label` then, the icon carries no
   * accessible name. Same prop shape as react-kit's AcvButton; a trailing
   * slot, if ever needed, takes AcvButton's `end` name.
   */
  icon?: ReactNode;
  /**
   * Shows a centered spinner and reports `aria-busy`. Content is hidden
   * with opacity, not visibility: it keeps painting the button's size (no
   * width jump) and, unlike visibility, stays in the accessibility tree —
   * the button keeps its name while `aria-busy` reports the state, with no
   * hardcoded "Loading" label the kit would otherwise have to translate.
   * Clicks are suppressed the same way `disabled` suppresses them, but the
   * button does NOT become natively `disabled` — it forces
   * `focusableWhenDisabled` (see below) instead, so it stays in the tab
   * order and reports `aria-disabled` rather than blurring itself the
   * instant a native `disabled` attribute would land. Consumer code
   * checking the native `disabled` property or a `:disabled` CSS selector
   * will NOT see a `loading` button the way it sees a plain `disabled`
   * one — check `aria-disabled`/`aria-busy` instead.
   */
  loading?: boolean;
  /**
   * Keep the button in the tab order (and reporting `aria-disabled`
   * instead of the native `disabled` attribute) while disabled — inherited
   * from Base UI's Button, re-declared here because `loading` above forces
   * this to `true` regardless of what's passed: a native `disabled`
   * attribute blurs the button the instant it lands, which `loading` can't
   * afford (it needs `aria-busy` to still be announced to something). An
   * explicit `focusableWhenDisabled={false}` is silently overridden while
   * `loading` is `true`.
   * @default false
   */
  focusableWhenDisabled?: boolean;
}

export function Button({
  className,
  variant,
  size,
  icon,
  loading,
  disabled,
  focusableWhenDisabled,
  children,
  ...props
}: ButtonProps) {
  // One predicate for "does this button have a visible label", driving
  // BOTH the icon-only derivation below and the label-render guard at the
  // bottom: `children == null` only catches a missing prop, not a falsy
  // one — `<Button icon={x}>{cond && 'Save'}</Button>` with cond=false
  // passes `false` as children, which is neither null nor renderable, so
  // checking each spot with its own logic could (and did) disagree about
  // whether the button has a label.
  //
  // Children.toArray drops `false`/`null`/`undefined`/`[]` but KEEPS the
  // empty string (`toArray('')` has length 1), so the array being non-empty
  // is not on its own the same question as "renders something visible" —
  // hence the explicit `!== ''` filter. `<Button icon={x}>{label}</Button>`
  // with an empty `label` is the case it covers: without the filter that
  // button stays a wide pill wrapping an empty label span instead of going
  // icon-only. `0` is deliberately NOT filtered — React renders it.
  const hasLabel = Children.toArray(children).some((child) => child !== '');
  // Same predicate, applied to the icon slot: `icon != null` is true for
  // `icon={false}` — a valid ReactNode that renders nothing — which is
  // exactly what `icon={cond && <Icon/>}` passes when `cond` is false.
  // Without this, a false condition still forced the button icon-only and
  // rendered an empty square.
  const hasIcon = Children.toArray(icon).some((child) => child !== '');
  const iconOnly = hasIcon && !hasLabel;
  return (
    <ButtonPrimitive
      className={buttonVariants({ variant, size, className })}
      {...props}
      /*
       * Derived attributes are spread AFTER `...props` so a caller's own
       * conflicting `aria-busy`/`data-loading`/`data-icon-only` can never
       * shadow the state this component just computed — the button IS
       * loading/icon-only/not, regardless of what a stray prop says.
       *
       * `focusableWhenDisabled` while `loading`: a native `disabled`
       * attribute blurs the element the instant it lands, which would
       * silently steal focus off a button the user just clicked and make
       * `aria-busy` announce to no one. Base UI's `focusableWhenDisabled`
       * keeps it in the tab order and reports the state via
       * `aria-disabled` instead (see useFocusableWhenDisabled) — clicks
       * still get suppressed via `disabled` below either way. A plain
       * `disabled` with no `loading` keeps its ordinary native behavior
       * unless the caller opts into `focusableWhenDisabled` itself.
       */
      focusableWhenDisabled={loading || focusableWhenDisabled}
      disabled={disabled || loading}
      data-icon-only={iconOnly || undefined}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {hasIcon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {hasLabel && <span className={styles.label}>{children}</span>}
    </ButtonPrimitive>
  );
}
