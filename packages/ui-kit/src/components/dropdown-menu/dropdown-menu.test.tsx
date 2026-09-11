import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declarationMap, extractRules } from '../../__test-utils__/css-rules';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';
import styles from './dropdown-menu.module.css';

afterEach(cleanup);

function renderMenu() {
  return render(
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe('DropdownMenu', () => {
  it('renders a trigger and keeps the popup out of the DOM until opened', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on trigger click and renders items with kit classes', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    const item = screen.getByRole('menuitem', { name: 'Profile' });
    expect(item.className).toContain(styles.item);
    expect(item.className).toContain(styles.variantDefault);
  });

  it('applies the destructive item variant', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain(
      styles.variantDestructive,
    );
  });

  it('marks a disabled item', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const disabledItem = screen.getByRole('menuitem', { name: 'Disabled' });
    expect(disabledItem.getAttribute('data-disabled')).not.toBeNull();
  });

  it('closes on Escape', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes on outside click', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes when a regular item is clicked', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('toggles a checkbox item without closing the menu', () => {
    const onCheckedChange = vi.fn();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
            Show bookmarks
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show bookmarks' }));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('selects a radio item and reports through onValueChange', () => {
    const onValueChange = vi.fn();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="list" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Grid' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('grid');
  });

  it('renders a group label and separator with kit classes', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator data-testid="separator" />
          <DropdownMenuItem>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Account').className).toContain(styles.label);
    expect(screen.getByTestId('separator').className).toContain(styles.separator);
  });

  it('throws when a label is used outside a group', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Account</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>,
      ),
    ).toThrow();
    consoleError.mockRestore();
  });

  it('opens a submenu and renders its items', async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More tools</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Extensions</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'More tools' }));
    const submenuItem = await waitFor(() => screen.getByRole('menuitem', { name: 'Extensions' }));
    // The width-unbinding fix (.subPopup declared after .popup so it wins on
    // the overlapping width/min-width properties) depends on stylesheet
    // order — assert the class actually lands, not just that it renders.
    const submenuPopup = submenuItem.closest('[role="menu"]');
    expect(submenuPopup?.className).toContain(styles.subPopup);
  });

  // The scenario `container` exists for (a theme scoped to a subtree) must
  // hold one level deep: without inheritance the submenu portals to <body>
  // with the root theme — silently, since everything still renders.
  it('inherits container into a nested submenu popup', async () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent container={container}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More tools</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Extensions</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'More tools' }));
    const submenuItem = await waitFor(() => screen.getByRole('menuitem', { name: 'Extensions' }));
    expect(container.contains(submenuItem)).toBe(true);
    container.remove();
  });

  // dropdown-menu.md documents keyboard navigation as part of the contract;
  // nothing else in this suite leaves fireEvent.click. Same flush caveats as
  // tabs.test.tsx: Base UI moves highlight in queued microtasks.
  it('navigates and activates items from the keyboard', async () => {
    const onProfile = vi.fn();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onProfile}>Profile</DropdownMenuItem>
          <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
          <DropdownMenuItem>Settings</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const menu = await waitFor(() => screen.getByRole('menu'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const profile = screen.getByRole('menuitem', { name: 'Profile' });
    await waitFor(() => expect(document.activeElement).toBe(profile));
    // A disabled item is focusable but not activatable (the WAI-ARIA menu
    // pattern Base UI implements: keyboard users must be able to discover
    // it) — ArrowDown lands on it, Enter there is a no-op.
    fireEvent.keyDown(profile, { key: 'ArrowDown' });
    const disabled = screen.getByRole('menuitem', { name: 'Disabled' });
    await waitFor(() => expect(document.activeElement).toBe(disabled));
    fireEvent.keyDown(disabled, { key: 'Enter' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(disabled, { key: 'ArrowDown' });
    const settings = screen.getByRole('menuitem', { name: 'Settings' });
    await waitFor(() => expect(document.activeElement).toBe(settings));
    fireEvent.keyDown(settings, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(disabled));
    fireEvent.keyDown(disabled, { key: 'ArrowUp' });
    await waitFor(() => expect(document.activeElement).toBe(profile));
    fireEvent.keyDown(profile, { key: 'Enter' });
    await waitFor(() => expect(onProfile).toHaveBeenCalledTimes(1));
    // Activating an item closes the menu.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent container={container}>
          <DropdownMenuItem>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(true);
    container.remove();
  });
});

/*
 * Guards the destructive item's paint. --destructive is the kit's FILL
 * red, verified only under --destructive-foreground; as menu TEXT it needs
 * the AA-corrected --danger (held ≥ 4.5:1 against --popover by
 * tokens.test.ts's status matrix). The highlight fill is a 12% tint of
 * --danger over --popover — anchored to the popover so its direction
 * never flips with the theme, unlike the removed mix toward --foreground
 * that fell under the floor in dark mode; this guard notices if a
 * foreground-anchored mix ever comes back. Reads the raw module CSS
 * (jsdom computes no styles), same as badge.test.tsx.
 */
describe('DropdownMenu destructive item paint', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'dropdown-menu.module.css'),
    'utf8',
  );
  const menuRules = extractRules(css);

  it('paints --danger text and a popover-anchored danger tint, never a foreground mix', () => {
    const rest = menuRules.find((rule) => rule.selector === '.variantDestructive');
    expect(rest, '.variantDestructive rule missing').toBeDefined();
    expect(declarationMap(rest?.body ?? '').get('color')).toBe('var(--danger)');

    const highlighted = menuRules.find((rule) =>
      rule.selector.replace(/\s+/g, ' ').includes('.variantDestructive[data-highlighted]'),
    );
    expect(highlighted, 'highlighted .variantDestructive rule missing').toBeDefined();
    const decls = declarationMap(highlighted?.body ?? '');
    expect(decls.get('background-color')).toBe(
      'color-mix(in oklab, var(--danger) 12%, var(--popover))',
    );
    expect(decls.get('color')).toBe('var(--danger)');
    expect(highlighted?.body).not.toContain('--foreground');
    expect(highlighted?.body).not.toContain('--destructive');
  });
});
