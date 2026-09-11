import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declarationMap, extractRules } from '../../__test-utils__/css-rules';

import {
  Sidebar,
  SidebarContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuSkeleton,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from './sidebar';
import styles from './sidebar.module.css';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
}

function desktopRoot() {
  return document.querySelector(`.${styles.root}`);
}

function ReadsSidebarOutsideProvider() {
  useSidebar();
  return null;
}

afterEach(() => {
  cleanup();
  // Expire the cookie so persistence assertions in one test never leak
  // into the next — SidebarProvider reads it fresh on every mount.
  document.cookie = 'sidebar_state=; path=/; max-age=0';
  setViewportWidth(1024);
});

describe('Sidebar', () => {
  it('throws when useSidebar is called outside a SidebarProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ReadsSidebarOutsideProvider />)).toThrow(
      'useSidebar must be used within a SidebarProvider.',
    );
    consoleError.mockRestore();
  });

  it('renders expanded by default, exposing state via data-state on the desktop root', () => {
    render(
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>,
    );
    expect(desktopRoot()?.getAttribute('data-state')).toBe('expanded');
  });

  it('toggles to collapsed on SidebarTrigger click', () => {
    render(
      <SidebarProvider>
        <Sidebar />
        <SidebarTrigger />
      </SidebarProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(desktopRoot()?.getAttribute('data-state')).toBe('collapsed');
  });

  it('sets data-collapsible to the current mode only once collapsed', () => {
    render(
      <SidebarProvider>
        <Sidebar collapsible="icon" />
        <SidebarTrigger />
      </SidebarProvider>,
    );
    expect(desktopRoot()?.getAttribute('data-collapsible')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(desktopRoot()?.getAttribute('data-collapsible')).toBe('icon');
  });

  it('toggles on Cmd/Ctrl+B from anywhere in the document', () => {
    render(
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>,
    );
    expect(desktopRoot()?.getAttribute('data-state')).toBe('expanded');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(desktopRoot()?.getAttribute('data-state')).toBe('collapsed');
  });

  it('persists the collapsed state in a cookie and restores it on a fresh mount', () => {
    const { unmount } = render(
      <SidebarProvider>
        <Sidebar />
        <SidebarTrigger />
      </SidebarProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(document.cookie).toContain('sidebar_state=false');
    unmount();

    // A fresh provider that states no preference of its own — the cookie
    // written by the unmounted instance above is what it starts from.
    render(
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>,
    );
    expect(desktopRoot()?.getAttribute('data-state')).toBe('collapsed');
  });

  // The cookie is the one piece of state that exists on the client and not
  // on the server, so reading it during render is exactly what puts
  // `data-state` — the attribute the whole layout keys off — into the
  // hydration diff. Rendering the same tree twice, once through
  // renderToString and once by hydrating that output, is the only way to
  // observe that; React reports a mismatch through console.error.
  it('hydrates server markup without a mismatch, then applies the cookie', async () => {
    document.cookie = 'sidebar_state=false; path=/';
    const tree = (
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    );

    const container = document.createElement('div');
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    expect(container.querySelector(`.${styles.root}`)?.getAttribute('data-state')).toBe('expanded');

    const errors: string[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(String(args[0]));
    });
    const root = hydrateRoot(container, tree);
    await act(async () => {});
    consoleError.mockRestore();

    expect(errors).toEqual([]);
    expect(container.querySelector(`.${styles.root}`)?.getAttribute('data-state')).toBe('collapsed');

    act(() => root.unmount());
    container.remove();
  });

  it('lets an explicit defaultOpen override the persisted cookie', () => {
    // The cookie is one key for the whole document, so without this
    // opt-out a second Provider on the page could not state its own
    // starting state at all — see SidebarProvider's defaultOpen doc.
    document.cookie = 'sidebar_state=false; path=/';
    render(
      <SidebarProvider defaultOpen>
        <Sidebar />
      </SidebarProvider>,
    );
    expect(desktopRoot()?.getAttribute('data-state')).toBe('expanded');
  });

  it('defers to a controlled open prop and only reports intent via onOpenChange', () => {
    const onOpenChange = vi.fn();
    render(
      <SidebarProvider open onOpenChange={onOpenChange}>
        <Sidebar />
        <SidebarTrigger />
      </SidebarProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The prop was never updated by the (test-harness) consumer, so the
    // rendered state must not have moved on its own.
    expect(desktopRoot()?.getAttribute('data-state')).toBe('expanded');
  });

  it('renders as a mobile Sheet below the breakpoint instead of the desktop layout', async () => {
    setViewportWidth(375);
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Mobile nav</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    await waitFor(() => expect(desktopRoot()).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText('Mobile nav')).toBeTruthy();
  });

  it('renders a fixed-width panel with collapsible="none", ignoring open state', () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <Sidebar collapsible="none">
          <SidebarContent>Nav</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );
    expect(document.querySelector(`.${styles.none}`)).toBeTruthy();
    expect(desktopRoot()).toBeNull();
  });

  it('reflects isActive on SidebarMenuButton as a bare data-active attribute', () => {
    render(
      <SidebarProvider>
        <SidebarMenuButton isActive>Home</SidebarMenuButton>
      </SidebarProvider>,
    );
    // Base UI's state-attribute reflection writes booleans as an EMPTY
    // value (`data-active=""`), not the string "true" — see sidebar.tsx's
    // comment on SidebarMenuButton's `state` option.
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('data-active')).toBe('');
  });

  it('omits data-active on SidebarMenuButton when not active', () => {
    render(
      <SidebarProvider>
        <SidebarMenuButton>Home</SidebarMenuButton>
      </SidebarProvider>,
    );
    expect(screen.getByRole('button', { name: 'Home' }).hasAttribute('data-active')).toBe(false);
  });

  it('does not mount a tooltip while expanded, even with a tooltip prop', async () => {
    render(
      <SidebarProvider defaultOpen>
        <SidebarMenuButton tooltip="Homepage link">Home</SidebarMenuButton>
      </SidebarProvider>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Home' }));
    // Absence can't be waited for positively — give Base UI's open delay a
    // moment to have fired if the collapsed/expanded gate were broken (same
    // idiom as tooltip.test.tsx's own disabled-trigger case).
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Homepage link')).toBeNull();
  });

  it('mounts the tooltip once the sidebar is collapsed to its icon rail', async () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <SidebarMenuButton tooltip="Homepage link">Home</SidebarMenuButton>
      </SidebarProvider>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(screen.getByText('Homepage link')).toBeTruthy(), { timeout: 1000 });
  });

  it('renders SidebarMenuButton as a link via render, keeping isActive reflected', () => {
    // The overwhelmingly common real shape: a nav row IS the anchor, not a
    // button wrapping one — so `render` has to survive alongside the
    // state-attribute reflection rather than being swallowed by it.
    render(
      <SidebarProvider>
        <SidebarMenuButton isActive render={<a href="/inbox" />}>
          Inbox
        </SidebarMenuButton>
      </SidebarProvider>,
    );
    const link = screen.getByRole('link', { name: 'Inbox' });
    expect(link.getAttribute('href')).toBe('/inbox');
    expect(link.getAttribute('data-active')).toBe('');
  });

  it('reflects isActive on SidebarMenuSubButton, which defaults to an anchor', () => {
    render(
      <SidebarProvider>
        <SidebarMenuSubButton isActive href="/overview">
          Overview
        </SidebarMenuSubButton>
      </SidebarProvider>,
    );
    const link = screen.getByRole('link', { name: 'Overview' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('data-active')).toBe('');
  });

  it('renders SidebarGroupLabel as a custom element via render', () => {
    render(
      <SidebarProvider>
        <SidebarGroupLabel render={<label htmlFor="search" />}>Search</SidebarGroupLabel>
      </SidebarProvider>,
    );
    const label = screen.getByText('Search');
    expect(label.tagName).toBe('LABEL');
    expect(label.getAttribute('for')).toBe('search');
  });

  // Varied between rows (a column of identical bars reads as one tile, not
  // as loading content) but not RANDOM: a random width is a different
  // number on each side of hydration, which is what the server/hydrate
  // round-trip below is there to catch.
  it('varies SidebarMenuSkeleton text widths between rows, identically across hydration', async () => {
    const rows = (
      <>
        <SidebarMenuSkeleton />
        <SidebarMenuSkeleton />
        <SidebarMenuSkeleton />
      </>
    );
    const widthsIn = (element: ParentNode) =>
      Array.from(element.querySelectorAll<HTMLElement>(`.${styles.menuSkeletonText}`), (text) =>
        Number.parseFloat(text.style.getPropertyValue('--skeleton-width')),
      );

    const container = document.createElement('div');
    container.innerHTML = renderToString(rows);
    document.body.appendChild(container);

    const served = widthsIn(container);
    expect(served).toHaveLength(3);
    for (const width of served) {
      expect(width).toBeGreaterThanOrEqual(50);
      expect(width).toBeLessThanOrEqual(89);
    }
    expect(new Set(served).size).toBeGreaterThan(1);

    const root = hydrateRoot(container, rows);
    await act(async () => {});
    expect(widthsIn(container)).toEqual(served);

    act(() => root.unmount());
    container.remove();
  });
});

/*
 * Two guards on the panel's horizontal geometry. Neither is observable
 * through the DOM: jsdom applies no stylesheet, so the CSS text is the only
 * place the answer exists — the same reason button.test.tsx reads its own
 * module (see that file's note on the idiom).
 */
const cssDir = dirname(fileURLToPath(import.meta.url));
const sidebarRules = extractRules(readFileSync(join(cssDir, 'sidebar.module.css'), 'utf8'));

describe('sidebar.module.css horizontal geometry', () => {
  /*
   * Upstream's `w-full` means "including the padding" because Tailwind's
   * preflight sets border-box globally; this kit ships no preflight, so the
   * same pair of declarations silently renders 16px wider than the panel and
   * puts a horizontal scrollbar inside it — which is exactly what
   * SidebarGroup did until it was given the box-sizing below.
   */
  it('gives every full-width padded part a border-box, since the kit has no preflight', () => {
    const offenders = sidebarRules
      .map((rule) => ({ selector: rule.selector, decls: declarationMap(rule.body) }))
      .filter(
        ({ decls }) =>
          decls.get('width') === '100%' &&
          // A `padding: 0` (SidebarMenu's list reset) adds nothing to the
          // box, so it is not a case border-box changes.
          [...decls].some(([prop, value]) => prop.startsWith('padding') && value !== '0') &&
          decls.get('box-sizing') !== 'border-box',
      )
      .map(({ selector }) => selector);
    expect(offenders).toEqual([]);
  });

  /*
   * SidebarSeparator's 8px inset (upstream's `mx-2 w-auto`) only survives the
   * cascade if it is stated on the same orientation-qualified selector
   * separator.module.css uses for its own `width` — an attribute selector
   * outranks a bare class, so a plain `.separator { width: auto }` loses and
   * the divider overhangs the panel's border into SidebarInset. Read from
   * both files so a change to either side of that coupling fails here rather
   * than in a screenshot.
   */
  it('states the separator inset on the same selector separator.module.css sizes it with', () => {
    const separatorRules = extractRules(
      readFileSync(join(cssDir, '..', 'separator', 'separator.module.css'), 'utf8'),
    );
    const qualifier = separatorRules.find((rule) => declarationMap(rule.body).has('width'))?.selector;
    expect(qualifier).toBe(".separator[data-orientation='horizontal']");

    const insetRule = sidebarRules.find(
      (rule) => rule.selector.startsWith('.separator') && declarationMap(rule.body).has('margin-inline'),
    );
    expect(insetRule?.selector).toBe(qualifier);
    expect(declarationMap(insetRule?.body ?? '').get('width')).toBe('auto');
  });
});
