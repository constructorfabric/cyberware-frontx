import { cx, type VariantProps } from 'class-variance-authority';
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { buttonVariants } from '../button/button.js';
import styles from './pagination.module.css';

export type PaginationProps = ComponentProps<'nav'>;

export function Pagination({ className, ...props }: PaginationProps) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className={cx(styles.pagination, className)}
      {...props}
    />
  );
}

export type PaginationContentProps = ComponentProps<'ul'>;

export function PaginationContent({ className, ...props }: PaginationContentProps) {
  return <ul className={cx(styles.content, className)} {...props} />;
}

export type PaginationItemProps = ComponentProps<'li'>;

export function PaginationItem(props: PaginationItemProps) {
  return <li {...props} />;
}

export interface PaginationLinkProps
  extends Omit<ComponentProps<'a'>, 'className'>,
    Pick<VariantProps<typeof buttonVariants>, 'size'> {
  className?: string;
  isActive?: boolean;
  /**
   * Square, icon-sized footprint (aspect-ratio 1, no horizontal padding) —
   * the common case for a bare page number, matching upstream's
   * `size="icon"` default. `PaginationPrevious`/`PaginationNext` opt out
   * (`square={false}`): they carry an icon AND a text label side by side,
   * so a fixed-width square would clip the label.
   * @default true
   */
  square?: boolean;
}

export function PaginationLink({
  className,
  isActive,
  size = 'default',
  square = true,
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      data-active={isActive || undefined}
      className={buttonVariants({
        variant: isActive ? 'outline' : 'ghost',
        size,
        className: cx(styles.link, square && styles.square, className),
      })}
      {...props}
    />
  );
}

export interface PaginationPreviousProps extends Omit<PaginationLinkProps, 'size' | 'square'> {
  /** Label text, hidden below the `sm` breakpoint (640px) — matching
   * upstream's `hidden sm:block`. @default 'Previous' */
  text?: string;
}

export function PaginationPrevious({
  className,
  text = 'Previous',
  ...props
}: PaginationPreviousProps) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      square={false}
      className={cx(styles.previous, className)}
      {...props}
    >
      <ChevronLeftIcon className={styles.icon} />
      <span className={styles.previousNextText}>{text}</span>
    </PaginationLink>
  );
}

export interface PaginationNextProps extends Omit<PaginationLinkProps, 'size' | 'square'> {
  /** @default 'Next' */
  text?: string;
}

export function PaginationNext({ className, text = 'Next', ...props }: PaginationNextProps) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      square={false}
      className={cx(styles.next, className)}
      {...props}
    >
      <span className={styles.previousNextText}>{text}</span>
      <ChevronRightIcon className={styles.icon} />
    </PaginationLink>
  );
}

export type PaginationEllipsisProps = ComponentProps<'span'>;

export function PaginationEllipsis({ className, ...props }: PaginationEllipsisProps) {
  return (
    <span aria-hidden="true" className={cx(styles.ellipsis, className)} {...props}>
      <MoreHorizontalIcon className={styles.icon} />
      <span className={styles.srOnly}>More pages</span>
    </span>
  );
}
