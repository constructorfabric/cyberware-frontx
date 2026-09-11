import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import styles from '../button/button.module.css';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination';
import paginationStyles from './pagination.module.css';

afterEach(cleanup);

describe('Pagination', () => {
  it('renders a nav labelled "pagination"', () => {
    render(<Pagination />);
    expect(screen.getByRole('navigation', { name: 'pagination' })).toHaveProperty('tagName', 'NAV');
  });

  it('renders the content as an unordered list', () => {
    render(
      <PaginationContent>
        <PaginationItem>1</PaginationItem>
      </PaginationContent>,
    );
    expect(screen.getByRole('list')).toHaveProperty('tagName', 'UL');
  });

  it('renders a link with the button base class and square footprint by default', () => {
    render(<PaginationLink href="#2">2</PaginationLink>);
    const link = screen.getByRole('link', { name: '2' });
    expect(link.className).toContain(styles.button);
    expect(link.className).toContain(paginationStyles.square);
    // Not active: ghost variant, no aria-current.
    expect(link.className).toContain(styles.variantGhost);
    expect(link.hasAttribute('aria-current')).toBe(false);
  });

  it('switches to the outline variant and aria-current when active', () => {
    render(
      <PaginationLink href="#1" isActive>
        1
      </PaginationLink>,
    );
    const link = screen.getByRole('link', { name: '1' });
    expect(link.className).toContain(styles.variantOutline);
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.getAttribute('data-active')).toBe('true');
  });

  it('renders Previous with a label, an icon, and the wide (non-square) footprint', () => {
    render(<PaginationPrevious href="#" />);
    const link = screen.getByRole('link', { name: 'Go to previous page' });
    expect(link.className).not.toContain(paginationStyles.square);
    expect(screen.getByText('Previous')).toBeTruthy();
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('renders Next with a custom label', () => {
    render(<PaginationNext href="#" text="Forward" />);
    const link = screen.getByRole('link', { name: 'Go to next page' });
    expect(screen.getByText('Forward')).toBeTruthy();
    expect(link.className).not.toContain(paginationStyles.square);
  });

  it('renders the ellipsis as decorative with an accessible "More pages" fallback', () => {
    render(<PaginationEllipsis />);
    const ellipsis = document.querySelector(`.${paginationStyles.ellipsis}`);
    expect(ellipsis?.getAttribute('aria-hidden')).toBe('true');
    expect(ellipsis?.textContent).toBe('More pages');
  });

  it('forwards click handlers and native anchor props through PaginationLink', () => {
    const onClick = vi.fn();
    render(
      <PaginationLink href="#3" onClick={onClick}>
        3
      </PaginationLink>,
    );
    fireEvent.click(screen.getByRole('link', { name: '3' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
