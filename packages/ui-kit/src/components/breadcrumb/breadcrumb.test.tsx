import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb';
import styles from './breadcrumb.module.css';

afterEach(cleanup);

function renderTrail() {
  return render(
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Current</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>,
  );
}

describe('Breadcrumb', () => {
  it('renders a nav labelled "breadcrumb"', () => {
    renderTrail();
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toHaveProperty('tagName', 'NAV');
  });

  it('renders the list as an ordered list with the kit class', () => {
    renderTrail();
    const list = screen.getByRole('list');
    expect(list).toHaveProperty('tagName', 'OL');
    expect(list.className).toContain(styles.list);
  });

  it('renders a link crumb as a real anchor', () => {
    renderTrail();
    const link = screen.getByRole('link', { name: 'Home' });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link).toHaveProperty('href', expect.stringContaining('/'));
    expect(link.className).toContain(styles.link);
  });

  it('renders through a custom render element (polymorphism)', () => {
    render(
      <BreadcrumbLink render={<button type="button" />}>Custom</BreadcrumbLink>,
    );
    const el = screen.getByText('Custom');
    expect(el).toHaveProperty('tagName', 'BUTTON');
    expect(el.className).toContain(styles.link);
  });

  it('marks the current page as a disabled, current link', () => {
    renderTrail();
    const page = screen.getByText('Current');
    expect(page.getAttribute('role')).toBe('link');
    expect(page.getAttribute('aria-disabled')).toBe('true');
    expect(page.getAttribute('aria-current')).toBe('page');
  });

  it('renders a decorative chevron separator by default, hidden from AT', () => {
    const { container } = render(
      <BreadcrumbList>
        <BreadcrumbSeparator />
      </BreadcrumbList>,
    );
    const separator = container.querySelector(`.${styles.separator}`);
    expect(separator?.getAttribute('aria-hidden')).toBe('true');
    expect(separator?.getAttribute('role')).toBe('presentation');
    expect(separator?.querySelector('svg')).not.toBeNull();
  });

  it('lets a consumer replace the separator content', () => {
    render(
      <BreadcrumbList>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
      </BreadcrumbList>,
    );
    expect(screen.getByText('/')).toBeTruthy();
  });

  it('renders the ellipsis as decorative with an accessible "More" fallback', () => {
    renderTrail();
    const ellipsis = document.querySelector(`.${styles.ellipsis}`);
    expect(ellipsis?.getAttribute('aria-hidden')).toBe('true');
    expect(ellipsis?.textContent).toBe('More');
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Breadcrumb className="consumer" />);
    const nav = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(nav.className).toContain(styles.breadcrumb);
    expect(nav.className).toContain('consumer');
  });
});
