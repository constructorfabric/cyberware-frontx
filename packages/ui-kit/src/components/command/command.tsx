import { Command as CommandPrimitive } from 'cmdk';
import { cx } from 'class-variance-authority';
import { SearchIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  type DialogProps,
} from '../dialog/public.js';
import styles from './command.module.css';

export type CommandProps = ComponentProps<typeof CommandPrimitive>;

export function Command({ className, ...props }: CommandProps) {
  return <CommandPrimitive className={cx(styles.command, className)} {...props} />;
}

export interface CommandDialogProps extends Omit<DialogProps, 'children'> {
  /**
   * Accessible name for the palette — visually hidden, only reaches
   * screen readers via the dialog's title association. @default 'Command Palette'
   */
  title?: ReactNode;
  /** Accessible description, same visually-hidden treatment as `title`. @default 'Search for a command to run...' */
  description?: ReactNode;
  className?: string;
  /**
   * Renders DialogContent's built-in top-right close (X) button.
   * @default false — the palette already dismisses on Escape/outside-press
   * (Dialog's own behavior) and a close button competes with the search
   * input for the popup's one-line header, unlike a regular Dialog where
   * that header has room to spare.
   */
  showCloseButton?: boolean;
  children: ReactNode;
}

export function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogHeader className={styles.srOnly}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent className={cx(styles.dialogPopup, className)} showCloseButton={showCloseButton}>
        {/*
         * CommandInput/CommandList/CommandItem/CommandGroup all read their
         * shared state off the nearest ancestor <Command> root's React
         * context (cmdk's internal Provider pair) — without this wrapper
         * they don't just lose styling, `Command.Item`'s registration
         * effect throws trying to call a context value that doesn't exist.
         * cmdk's own bundled `Command.Dialog` (which this kit does NOT use,
         * composing its own Dialog instead — see command.md) wraps its
         * children in exactly this same root internally, for the same
         * reason.
         */}
        <Command className={styles.command}>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export interface CommandInputProps
  extends Omit<ComponentProps<typeof CommandPrimitive.Input>, 'className'> {
  className?: string;
  /** className for the wrapper div around the icon + input. */
  wrapperClassName?: string;
}

export function CommandInput({ className, wrapperClassName, ...props }: CommandInputProps) {
  return (
    <div className={cx(styles.inputWrapper, wrapperClassName)}>
      <SearchIcon className={cx(styles.svgIcon, styles.inputIcon)} />
      <CommandPrimitive.Input className={cx(styles.input, className)} {...props} />
    </div>
  );
}

export type CommandListProps = ComponentProps<typeof CommandPrimitive.List>;

export function CommandList({ className, ...props }: CommandListProps) {
  return <CommandPrimitive.List className={cx(styles.list, className)} {...props} />;
}

export type CommandEmptyProps = ComponentProps<typeof CommandPrimitive.Empty>;

export function CommandEmpty({ className, ...props }: CommandEmptyProps) {
  return <CommandPrimitive.Empty className={cx(styles.empty, className)} {...props} />;
}

export type CommandGroupProps = ComponentProps<typeof CommandPrimitive.Group>;

export function CommandGroup({ className, ...props }: CommandGroupProps) {
  return <CommandPrimitive.Group className={cx(styles.group, className)} {...props} />;
}

export type CommandItemProps = ComponentProps<typeof CommandPrimitive.Item>;

export function CommandItem({ className, ...props }: CommandItemProps) {
  return <CommandPrimitive.Item className={cx(styles.item, className)} {...props} />;
}

export type CommandShortcutProps = ComponentProps<'span'>;

export function CommandShortcut({ className, ...props }: CommandShortcutProps) {
  return <span className={cx(styles.shortcut, className)} {...props} />;
}

export type CommandSeparatorProps = ComponentProps<typeof CommandPrimitive.Separator>;

export function CommandSeparator({ className, ...props }: CommandSeparatorProps) {
  return <CommandPrimitive.Separator className={cx(styles.separator, className)} {...props} />;
}
