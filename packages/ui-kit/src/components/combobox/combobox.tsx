// Load-bearing: useComboboxAnchor calls useRef directly in its own body, so
// this can't be dropped. Coupled to CLIENT_COMPONENTS in
// scripts/verify-consumer.sh — keep both in sync if this ever changes.
'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { cx } from 'class-variance-authority';
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react';
import { type ComponentPropsWithRef, type ReactNode, useRef } from 'react';

import styles from './combobox.module.css';

export const Combobox = ComboboxPrimitive.Root;
/**
 * Base UI pass-through; props type re-exported (see dialog.tsx). Generic
 * like the root itself: `Value` is the item value's type, `Multiple` widens
 * `value`/`onValueChange` (and the input's typed selection) to arrays when
 * true — same idiom as select.tsx's `SelectProps<Value, Multiple>`.
 */
export type ComboboxProps<
  Value,
  Multiple extends boolean | undefined = false,
> = ComboboxPrimitive.Root.Props<Value, Multiple>;

/*
 * Unlike Select — which always needs a separate SelectValue to render the
 * chosen label next to its button-only trigger — a single-select Combobox's
 * own <input> already displays the current value as editable text, so
 * ComboboxValue is normally unused there. It exists for the cases upstream
 * demonstrates it for: formatting a multi-select's array of values inside
 * ComboboxChips (see the combobox.md example). It renders no element of its
 * own (verified against the Base UI source), hence no className to merge —
 * matching upstream's own wrapper exactly.
 */
export type ComboboxValueProps = ComboboxPrimitive.Value.Props;

export function ComboboxValue(props: ComboboxValueProps) {
  return <ComboboxPrimitive.Value {...props} />;
}

export interface ComboboxTriggerProps
  extends Omit<ComponentPropsWithRef<typeof ComboboxPrimitive.Trigger>, 'className'> {
  className?: string;
  children?: ReactNode;
}

/*
 * Exported standalone (upstream exports it too), but also reused below by
 * ComboboxInput's own `showTrigger` — the two are the same button, upstream
 * just composes it inline via `render={<ComboboxTrigger/>}` where this kit
 * has no InputGroup primitive to render it into (see ComboboxInput).
 */
export function ComboboxTrigger({ className, children, ...props }: ComboboxTriggerProps) {
  return (
    <ComboboxPrimitive.Trigger className={cx(styles.inputTrigger, className)} {...props}>
      {children ?? <ChevronDownIcon className={styles.svgIcon} />}
    </ComboboxPrimitive.Trigger>
  );
}

/*
 * NOT exported (upstream defines it but only exports Combobox/Combobox
 * Input/…/ComboboxTrigger/ComboboxValue/useComboboxAnchor at the bottom of
 * its file — Clear is missing from that list) — it only ever appears
 * composed into ComboboxInput via `showClear`, never as a kit-level part a
 * consumer reaches for on its own.
 */
interface ComboboxClearProps
  extends Omit<ComponentPropsWithRef<typeof ComboboxPrimitive.Clear>, 'className'> {
  className?: string;
}

function ComboboxClear({ className, ...props }: ComboboxClearProps) {
  return (
    <ComboboxPrimitive.Clear className={cx(styles.inputClear, className)} {...props}>
      <XIcon className={styles.svgIcon} />
    </ComboboxPrimitive.Clear>
  );
}

export interface ComboboxInputProps extends Omit<ComboboxPrimitive.Input.Props, 'className'> {
  className?: string;
  /**
   * Renders the chevron button that opens the popup, trailing the field.
   * @default true
   */
  showTrigger?: boolean;
  /**
   * Renders a clear button trailing the field once a value is chosen. Base
   * UI's Clear part only mounts while there's something to clear (default
   * `keepMounted={false}`), and while it's mounted it visually replaces the
   * trigger in the same inline-end slot (see combobox.module.css's
   * `:has()` rule) rather than the two ever stacking.
   * @default false
   */
  showClear?: boolean;
  /**
   * Accessible name for the chevron button `showTrigger` renders. It is an
   * icon-only control, so this string IS its name — override it to ship a
   * combobox in any language but English, the same way `Dialog`'s
   * `closeLabel` and `SidebarTrigger`'s `label` work.
   * @default 'Toggle options'
   */
  toggleLabel?: string;
  /**
   * Accessible name for the clear button `showClear` renders.
   * @default 'Clear value'
   */
  clearLabel?: string;
  children?: ReactNode;
}

/*
 * Upstream composes this from a separate InputGroup/InputGroupAddon
 * registry component (its own generic field-plus-adornments primitive,
 * shared with other shadcn components) — this kit has no such primitive, so
 * the trailing trigger/clear are laid out here directly as an absolutely
 * positioned overlay instead, the same idiom input.tsx already uses for its
 * own icon/end slots.
 */
export function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  toggleLabel = 'Toggle options',
  clearLabel = 'Clear value',
  ...props
}: ComboboxInputProps) {
  return (
    <span className={styles.inputWrap}>
      <ComboboxPrimitive.Input
        className={cx(
          styles.input,
          (showTrigger || showClear) && styles.hasTrailingControl,
          className,
        )}
        disabled={disabled}
        {...props}
      />
      {showTrigger && <ComboboxTrigger disabled={disabled} aria-label={toggleLabel} />}
      {showClear && <ComboboxClear disabled={disabled} aria-label={clearLabel} />}
      {children}
    </span>
  );
}

export interface ComboboxContentProps
  extends Omit<ComboboxPrimitive.Popup.Props, 'className'>,
    Pick<
      ComboboxPrimitive.Positioner.Props,
      // positionMethod/collision*: see dropdown-menu.tsx — the escape hatch
      // for anchors inside a transform/filter container. `anchor`: lets a
      // multi-select point the popup at ComboboxChips instead of the
      // (nonexistent, in that mode) single-line input — see
      // useComboboxAnchor below.
      | 'anchor'
      | 'align'
      | 'alignOffset'
      | 'side'
      | 'sideOffset'
      | 'positionMethod'
      | 'collisionBoundary'
      | 'collisionPadding'
    > {
  className?: string;
  /**
   * Where to portal the popup. Defaults to <body>. Pass a themed container
   * when the theme is scoped to a subtree (data-theme on a section rather
   * than <html>) so the popup inherits its tokens and font.
   */
  container?: ComboboxPrimitive.Portal.Props['container'];
}

/*
 * Deliberately thinner than SelectContent: Select always fuses its content
 * with a List (plus scroll arrows) because every Select popup shows the
 * same shape. Combobox's own popup can hold a List, an Empty message, or
 * both side by side (see combobox.md) — upstream places List/Empty as
 * ComboboxContent's own children rather than having Content wrap them, and
 * there is no scroll-arrow pair to port (Base UI's Combobox has no
 * ScrollUp/DownArrow parts — the List just scrolls itself, see .list below).
 */
export function ComboboxContent({
  className,
  children,
  container,
  anchor,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  positionMethod,
  collisionBoundary,
  collisionPadding,
  ...props
}: ComboboxContentProps) {
  return (
    <ComboboxPrimitive.Portal container={container}>
      <ComboboxPrimitive.Positioner
        anchor={anchor}
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        positionMethod={positionMethod}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        className={styles.positioner}
      >
        <ComboboxPrimitive.Popup className={cx(styles.popup, className)} {...props}>
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

export interface ComboboxListProps extends Omit<ComboboxPrimitive.List.Props, 'className'> {
  className?: string;
}

export function ComboboxList({ className, ...props }: ComboboxListProps) {
  return <ComboboxPrimitive.List className={cx(styles.list, className)} {...props} />;
}

export interface ComboboxEmptyProps extends Omit<ComboboxPrimitive.Empty.Props, 'className'> {
  className?: string;
}

export function ComboboxEmpty({ className, ...props }: ComboboxEmptyProps) {
  return <ComboboxPrimitive.Empty className={cx(styles.empty, className)} {...props} />;
}

export interface ComboboxGroupProps extends Omit<ComboboxPrimitive.Group.Props, 'className'> {
  className?: string;
}

export function ComboboxGroup({ className, ...props }: ComboboxGroupProps) {
  return <ComboboxPrimitive.Group className={cx(styles.group, className)} {...props} />;
}

export interface ComboboxLabelProps extends Omit<ComboboxPrimitive.GroupLabel.Props, 'className'> {
  className?: string;
}

/* Kit name follows Select's own convention (SelectLabel wraps
 * SelectPrimitive.GroupLabel, not the unrelated standalone Label part) —
 * and matches what upstream itself calls this same wrapper. */
export function ComboboxLabel({ className, ...props }: ComboboxLabelProps) {
  return <ComboboxPrimitive.GroupLabel className={cx(styles.groupLabel, className)} {...props} />;
}

export type ComboboxCollectionProps = ComboboxPrimitive.Collection.Props;

/** Renders no element of its own — a render-prop pass-through for grouped
 * or virtualized lists, same as the Base UI part it wraps. */
export function ComboboxCollection(props: ComboboxCollectionProps) {
  return <ComboboxPrimitive.Collection {...props} />;
}

export interface ComboboxItemProps extends Omit<ComboboxPrimitive.Item.Props, 'className'> {
  className?: string;
  children?: ReactNode;
}

export function ComboboxItem({ className, children, ...props }: ComboboxItemProps) {
  return (
    <ComboboxPrimitive.Item className={cx(styles.item, className)} {...props}>
      {children}
      <ComboboxPrimitive.ItemIndicator render={<span className={styles.itemIndicator} />}>
        <CheckIcon className={styles.svgIcon} />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

export interface ComboboxSeparatorProps
  extends Omit<ComboboxPrimitive.Separator.Props, 'className'> {
  className?: string;
}

export function ComboboxSeparator({ className, ...props }: ComboboxSeparatorProps) {
  return <ComboboxPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}

export interface ComboboxChipsProps
  extends Omit<ComponentPropsWithRef<typeof ComboboxPrimitive.Chips>, 'className'> {
  className?: string;
}

/*
 * `ComponentPropsWithRef`, not `Omit<Chips.Props, 'className'>` like every
 * other part above: this is the one part a consumer forwards a ref INTO
 * (see useComboboxAnchor below), so its props type has to carry `ref`
 * itself — matching upstream's own identical typing for this one export.
 */
export function ComboboxChips({ className, ...props }: ComboboxChipsProps) {
  return <ComboboxPrimitive.Chips className={cx(styles.chips, className)} {...props} />;
}

export interface ComboboxChipProps extends Omit<ComboboxPrimitive.Chip.Props, 'className'> {
  className?: string;
  children?: ReactNode;
  /**
   * Renders a remove button trailing the chip's label.
   * @default true
   */
  showRemove?: boolean;
  /**
   * Accessible name for that remove button. Reads better naming the chip
   * it removes (`removeLabel={`Remove ${label}`}`) once a form has several
   * of them.
   * @default 'Remove'
   */
  removeLabel?: string;
}

export function ComboboxChip({
  className,
  children,
  showRemove = true,
  removeLabel = 'Remove',
  ...props
}: ComboboxChipProps) {
  return (
    <ComboboxPrimitive.Chip className={cx(styles.chip, className)} {...props}>
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove className={styles.chipRemove} aria-label={removeLabel}>
          <XIcon className={cx(styles.svgIcon, styles.chipRemoveIcon)} />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  );
}

export interface ComboboxChipsInputProps extends Omit<ComboboxPrimitive.Input.Props, 'className'> {
  className?: string;
}

/** The same Combobox.Input part as ComboboxInput above, styled bare instead
 * of field-bordered — it sits inline among the chips, which already carry
 * the field's own border. */
export function ComboboxChipsInput({ className, ...props }: ComboboxChipsInputProps) {
  return <ComboboxPrimitive.Input className={cx(styles.chipsInput, className)} {...props} />;
}

/**
 * A ref to anchor ComboboxContent's popup to ComboboxChips instead of the
 * single-line input a multi-select combobox no longer has room for — pass
 * the same ref to both `<ComboboxChips ref={...}>` and
 * `<ComboboxContent anchor={...}>` (see combobox.md's multi-select
 * example). Exported by upstream as a small convenience over
 * `useRef<HTMLDivElement>(null)`; this is the one call in this module that
 * invokes a hook directly in its own body, which is why the module carries
 * 'use client' — see the top-of-file comment.
 */
export function useComboboxAnchor() {
  return useRef<HTMLDivElement | null>(null);
}
