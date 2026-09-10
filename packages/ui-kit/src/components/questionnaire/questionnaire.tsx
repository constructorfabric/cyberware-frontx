import { Questionnaire as QuestionnairePrimitive } from '@shadcn/react/questionnaire';
import { cx } from 'class-variance-authority';
import { CheckIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button, type ButtonProps } from '../button/button';
import { Input } from '../input/input';
import styles from './questionnaire.module.css';

/*
 * Behavior (single-item stepper flow, per-item required/skip/invalid state,
 * keyboard shortcuts, radio-vs-checkbox choice semantics) comes entirely
 * from `@shadcn/react/questionnaire` — a headless, zero-runtime-dep
 * engine, not Base UI, since Base UI ships no multi-step-form primitive.
 * This file supplies CSS Modules styling, composes the kit `Button` for
 * navigation (matching upstream's own composition,
 * apps/v4/registry/bases/base/ui/questionnaire.tsx) and the kit `Input`
 * for the freeform-answer field, and hand-rolls the choice indicator (see
 * `QuestionnaireChoice` below for why that one piece isn't a literal
 * `radio-group`/`checkbox` composition despite the visual match).
 *
 * Every part is a bare styling pass-through with no hook called in its own
 * render body, so — per this kit's SERVER_COMPONENTS/CLIENT_COMPONENTS
 * split (scripts/verify-consumer.sh) — this file needs no 'use client'
 * directive.
 */

export interface QuestionnaireProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Root>, 'className'> {
  className?: string;
}

/**
 * The stepper's root — a native `<form>`. Owns which item is current
 * (`item`/`defaultItem`/`onItemChange`), the full `items` definition list
 * (drives required/disabled/choices validation independent of what's
 * actually rendered), and the keyboard-`shortcuts` mode
 * (`'letters' | 'numbers'`, read by `QuestionnaireChoiceShortcut`).
 */
export function Questionnaire({ className, ...props }: QuestionnaireProps) {
  return <QuestionnairePrimitive.Root className={cx(styles.root, className)} {...props} />;
}

export interface QuestionnaireProgressProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Progress>, 'className'> {
  className?: string;
}

/**
 * `role="progressbar"` with a built-in "Question X of Y" text — the
 * primitive supplies that default content itself (unlike upstream's own
 * shadcn primitive, which needs the wrapper to supply it); pass `children`
 * or `render` only to replace it.
 */
export function QuestionnaireProgress({ className, ...props }: QuestionnaireProgressProps) {
  return (
    <QuestionnairePrimitive.Progress className={cx(styles.progress, className)} {...props} />
  );
}

export interface QuestionnaireItemProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Item>, 'className'> {
  className?: string;
}

/**
 * One question. Renders as a `<fieldset>` for every item named in
 * `Questionnaire`'s `items`, but only the current one is interactive — the
 * rest stay mounted with native `hidden`+`inert` (no exit animation is
 * possible across a `hidden` boundary; see questionnaire.md's "Deviations").
 * `multiple` switches every descendant `QuestionnaireChoice` to a checkbox
 * group instead of radios.
 */
export function QuestionnaireItem({ className, ...props }: QuestionnaireItemProps) {
  return <QuestionnairePrimitive.Item className={cx(styles.item, className)} {...props} />;
}

export interface QuestionnaireTitleProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Title>, 'className'> {
  className?: string;
}

/** Renders as `<legend>` — the item's accessible name. */
export function QuestionnaireTitle({ className, ...props }: QuestionnaireTitleProps) {
  return <QuestionnairePrimitive.Title className={cx(styles.title, className)} {...props} />;
}

export interface QuestionnaireDescriptionProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Description>, 'className'> {
  className?: string;
}

export function QuestionnaireDescription({
  className,
  ...props
}: QuestionnaireDescriptionProps) {
  return (
    <QuestionnairePrimitive.Description
      className={cx(styles.description, className)}
      {...props}
    />
  );
}

export interface QuestionnaireChoicesProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Choices>, 'className'> {
  className?: string;
}

/**
 * The choice list's grid container. Carries `data-shortcuts` when the
 * root's `shortcuts` mode is on, matching `QuestionnaireChoiceShortcut`'s
 * own visibility. A `QuestionnaireInput` belongs inside this container, as
 * its last cell, whenever an item offers a freeform answer alongside fixed
 * choices — that is upstream's own composition, and it is what puts the
 * field on the choice grid's rhythm instead of a row of its own.
 */
export function QuestionnaireChoices({ className, ...props }: QuestionnaireChoicesProps) {
  return (
    <QuestionnairePrimitive.Choices className={cx(styles.choices, className)} {...props} />
  );
}

export interface QuestionnaireChoiceInputProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.ChoiceInput>, 'className'> {
  className?: string;
}

/**
 * The real `<input type="radio"|"checkbox">` — visually hidden (opacity 0,
 * stretched over the whole `QuestionnaireChoice` row) but still the
 * pointer/keyboard target and the element native form submission and
 * `:checked`-based tooling reads. Exported standalone (upstream does not)
 * for a consumer building a fully custom choice layout instead of
 * `QuestionnaireChoice`'s built-in indicator.
 */
export function QuestionnaireChoiceInput({
  className,
  ...props
}: QuestionnaireChoiceInputProps) {
  return (
    <QuestionnairePrimitive.ChoiceInput
      className={cx(styles.choiceInput, className)}
      {...props}
    />
  );
}

export interface QuestionnaireChoiceLabelProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.ChoiceLabel>, 'className'> {
  className?: string;
}

export function QuestionnaireChoiceLabel({
  className,
  ...props
}: QuestionnaireChoiceLabelProps) {
  return (
    <QuestionnairePrimitive.ChoiceLabel
      className={cx(styles.choiceLabel, className)}
      {...props}
    />
  );
}

export interface QuestionnaireChoiceShortcutProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.ChoiceShortcut>, 'className'> {
  className?: string;
}

/** The single-letter/number key hint — empty and `hidden` unless the root's
 * `shortcuts` mode assigned this choice one. */
export function QuestionnaireChoiceShortcut({
  className,
  ...props
}: QuestionnaireChoiceShortcutProps) {
  return (
    <QuestionnairePrimitive.ChoiceShortcut
      className={cx(styles.shortcut, className)}
      {...props}
    />
  );
}

export interface QuestionnaireChoiceProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Choice>, 'className'> {
  className?: string;
}

/**
 * One selectable choice: label + hidden native input + a visual indicator
 * (checkbox-square or radio-circle, driven by the `data-type` the
 * primitive stamps on this element) + the label text + an optional
 * shortcut hint.
 *
 * The indicator is hand-rolled rather than composing the kit's `Checkbox`/
 * `RadioGroupItem` components, even though `QuestionnaireChoiceInput`'s
 * type signature allows a `render` override: those kit components wrap
 * Base UI's `Checkbox`/`Radio` primitives, which render as `<span
 * role="checkbox"|"radio">` (see checkbox.module.css/radio-group.module.css'
 * own comments) — never a real `<input>`. `@shadcn/react`'s questionnaire
 * engine needs `ChoiceInput` to BE a native input (constraint validation,
 * `name`-based radio grouping, the `type` it stamps as `data-type`), so
 * swapping in a `<span>`-based render target would break it. This instead
 * reuses the same visual language — box size, border, checked/dot/check
 * treatment, disabled dim, invalid border — from checkbox.module.css/
 * radio-group.module.css directly in questionnaire.module.css, keyed off
 * this element's own `data-type`/`data-checked`/`data-disabled`/
 * `data-invalid` attributes instead of Base UI's.
 */
export function QuestionnaireChoice({ className, children, ...props }: QuestionnaireChoiceProps) {
  return (
    <QuestionnairePrimitive.Choice className={cx(styles.choice, className)} {...props}>
      <QuestionnaireChoiceInput />
      <span aria-hidden="true" className={styles.indicator}>
        <span className={styles.dot} />
        <CheckIcon className={styles.check} />
      </span>
      <QuestionnaireChoiceLabel>{children}</QuestionnaireChoiceLabel>
      <QuestionnaireChoiceShortcut />
    </QuestionnairePrimitive.Choice>
  );
}

export type QuestionnaireChoiceDescriptionProps = ComponentProps<'span'>;

/**
 * A second line under a choice's label — the supporting sentence that says
 * what picking it means. Belongs among `QuestionnaireChoice`'s children,
 * where `QuestionnaireChoiceLabel` stacks it under the label text. A plain
 * styled `<span>` with no `@shadcn/react` primitive underneath, matching
 * upstream's own `QuestionnaireChoiceDescription`; it carries no `id` and
 * is not wired into `aria-describedby` because the label element already
 * wraps it, so it is part of the choice's accessible name rather than a
 * description of it.
 */
export function QuestionnaireChoiceDescription({
  className,
  ...props
}: QuestionnaireChoiceDescriptionProps) {
  return <span className={cx(styles.choiceDescription, className)} {...props} />;
}

export interface QuestionnaireInputProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Input>, 'className'> {
  className?: string;
}

/**
 * The freeform-answer field for an item with no `choices` — composes the
 * kit `Input` via `render` (same idiom as `AlertDialogCancel`/
 * `MessageScrollerButton`), so it looks like every other text field in the
 * kit rather than a hand-restyled one.
 */
export function QuestionnaireInput({ className, render, ...props }: QuestionnaireInputProps) {
  return (
    <QuestionnairePrimitive.Input
      className={className}
      render={render ?? <Input />}
      {...props}
    />
  );
}

export interface QuestionnaireErrorProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Error>, 'className'> {
  className?: string;
}

/**
 * The item's validation message — hidden unless the item is invalid, and
 * announced (`role="alert"`) when it appears. The primitive supplies
 * default copy that already differs between a required and an optional
 * item, same defaulting as `QuestionnaireProgress`; pass `children` to
 * replace it. Belongs on every item, not just the required ones — see
 * `QuestionnaireNext` for why a missing one reads as a dead button.
 */
export function QuestionnaireError({ className, ...props }: QuestionnaireErrorProps) {
  return <QuestionnairePrimitive.Error className={cx(styles.error, className)} {...props} />;
}

export type QuestionnaireActionsProps = ComponentProps<'div'>;

/**
 * Lays out `QuestionnairePrevious`/`QuestionnaireSkip`/
 * `QuestionnaireNext`/`QuestionnaireSubmit` in a three-column row (Previous
 * start-aligned, Skip and Next/Submit end-aligned) — a plain styled `<div>`
 * with no `@shadcn/react` primitive underneath, matching upstream's own
 * `QuestionnaireActions`.
 */
export function QuestionnaireActions({ className, ...props }: QuestionnaireActionsProps) {
  return <div className={cx(styles.actions, className)} {...props} />;
}

interface QuestionnaireNavButtonOwnProps extends Pick<ButtonProps, 'variant' | 'size'> {
  className?: string;
}

export interface QuestionnairePreviousProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Previous>, 'className'>,
    QuestionnaireNavButtonOwnProps {}

/** Goes back one item. Hidden (native `hidden`+`inert`) on the first item —
 * there is nowhere to go back to. */
export function QuestionnairePrevious({
  className,
  render,
  variant = 'outline',
  size = 'default',
  ...props
}: QuestionnairePreviousProps) {
  return (
    <QuestionnairePrimitive.Previous
      className={cx(styles.previous, className)}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export interface QuestionnaireSkipProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Skip>, 'className'>,
    QuestionnaireNavButtonOwnProps {}

/**
 * Records that an optional item was deliberately left unanswered, then
 * advances (or submits, on the last item). Hidden whenever the current item
 * is `required` — a required item has no skip path. A skipped item is
 * absent from the submitted `FormData`, which is what separates it from an
 * item that merely has no answer yet; `QuestionnaireItem`'s
 * `onStatusChange` is where that distinction is observable.
 */
export function QuestionnaireSkip({
  className,
  render,
  variant = 'outline',
  size = 'default',
  ...props
}: QuestionnaireSkipProps) {
  return (
    <QuestionnairePrimitive.Skip
      className={cx(styles.skip, className)}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export interface QuestionnaireNextProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Next>, 'className'>,
    QuestionnaireNavButtonOwnProps {}

/**
 * Advances to the next item. Hidden on the last item —
 * `QuestionnaireSubmit` takes over there. Carries the `Enter` shortcut.
 *
 * Deliberately never disables itself: activating it is what runs the
 * current item's validation and surfaces the failure, so a disabled Next
 * would leave the reader with no way to find out why they are stuck. An
 * item passes only once it is answered — or, when it is optional, answered
 * *or* explicitly skipped; an untouched optional item fails validation the
 * same way a required one does, and `QuestionnaireSkip` is its way past.
 * That makes `QuestionnaireError` effectively mandatory on every item:
 * without it a failed Next is completely silent. Consumers that want the
 * button dimmed instead can read `data-status` off it, or gate `disabled`
 * themselves through `render`.
 */
export function QuestionnaireNext({
  className,
  render,
  variant = 'default',
  size = 'default',
  ...props
}: QuestionnaireNextProps) {
  return (
    <QuestionnairePrimitive.Next
      className={cx(styles.next, className)}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    />
  );
}

export interface QuestionnaireSubmitProps
  extends Omit<ComponentProps<typeof QuestionnairePrimitive.Submit>, 'className'>,
    QuestionnaireNavButtonOwnProps {}

/** Submits the form. Visible only on the last item, sharing
 * `QuestionnaireNext`'s grid cell (mutually exclusive via each one's own
 * `hidden` state). */
export function QuestionnaireSubmit({
  className,
  render,
  variant = 'default',
  size = 'default',
  ...props
}: QuestionnaireSubmitProps) {
  return (
    <QuestionnairePrimitive.Submit
      className={cx(styles.submit, className)}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    />
  );
}
