// Load-bearing: BreadcrumbLink calls useRender directly, so this can't be
// dropped. Coupled to CLIENT_COMPONENTS in scripts/verify-consumer.sh — keep
// both in sync if this ever changes.
'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cx } from 'class-variance-authority';
import { ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import styles from './breadcrumb.module.css';

export type BreadcrumbProps = ComponentProps<'nav'>;

export function Breadcrumb({ className, ...props }: BreadcrumbProps) {
  return <nav aria-label="breadcrumb" className={cx(styles.breadcrumb, className)} {...props} />;
}

export type BreadcrumbListProps = ComponentProps<'ol'>;

export function BreadcrumbList({ className, ...props }: BreadcrumbListProps) {
  return <ol className={cx(styles.list, className)} {...props} />;
}

export type BreadcrumbItemProps = ComponentProps<'li'>;

export function BreadcrumbItem({ className, ...props }: BreadcrumbItemProps) {
  return <li className={cx(styles.item, className)} {...props} />;
}

/*
 * Render-prop polymorphism via useRender/mergeProps — the same utilities
 * Base UI's own primitives are built on, and the same shape Badge already
 * uses (badge.tsx) for its one case that needs `render`: a crumb that
 * navigates through the consumer app's own link component, not a raw <a>.
 */
export type BreadcrumbLinkProps = useRender.ComponentProps<'a'>;

export function BreadcrumbLink({ className, render, ...props }: BreadcrumbLinkProps) {
  return useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>({ className: cx(styles.link, className) }, props),
  });
}

export type BreadcrumbPageProps = ComponentProps<'span'>;

/*
 * The current crumb reads as a link-shaped label the user can't activate:
 * `role="link"` + `aria-disabled="true"` announces "this looks like a link
 * but isn't clickable", while `aria-current="page"` is the actual
 * assistive-tech cue for "you are here" — matching upstream exactly (see
 * registry/bases/base/ui/breadcrumb.tsx).
 */
export function BreadcrumbPage({ className, ...props }: BreadcrumbPageProps) {
  return (
    <span
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cx(styles.page, className)}
      {...props}
    />
  );
}

export interface BreadcrumbSeparatorProps extends ComponentProps<'li'> {
  children?: ReactNode;
}

export function BreadcrumbSeparator({ children, className, ...props }: BreadcrumbSeparatorProps) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cx(styles.separator, className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  );
}

export type BreadcrumbEllipsisProps = ComponentProps<'span'>;

export function BreadcrumbEllipsis({ className, ...props }: BreadcrumbEllipsisProps) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cx(styles.ellipsis, className)}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className={styles.srOnly}>More</span>
    </span>
  );
}
