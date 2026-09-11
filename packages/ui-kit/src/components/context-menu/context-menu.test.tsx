import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu';
import styles from './context-menu.module.css';

afterEach(cleanup);

function renderMenu() {
  return render(
    <ContextMenu>
      <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Profile</ContextMenuItem>
        <ContextMenuItem disabled>Disabled</ContextMenuItem>
        <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>,
  );
}

describe('ContextMenu', () => {
  it('renders a trigger and keeps the popup out of the DOM until opened', () => {
    renderMenu();
    expect(screen.getByText('Right-click area')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on right-click and renders items with kit classes', () => {
    renderMenu();
    fireEvent.contextMenu(screen.getByText('Right-click area'));
    expect(screen.getByRole('menu')).toBeTruthy();
    const item = screen.getByRole('menuitem', { name: 'Profile' });
    expect(item.className).toContain(styles.item);
    expect(item.className).toContain(styles.variantDefault);
  });

  it('applies the destructive item variant', () => {
    renderMenu();
    fireEvent.contextMenu(screen.getByText('Right-click area'));
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain(
      styles.variantDestructive,
    );
  });

  it('marks a disabled item', () => {
    renderMenu();
    fireEvent.contextMenu(screen.getByText('Right-click area'));
    const disabledItem = screen.getByRole('menuitem', { name: 'Disabled' });
    expect(disabledItem.getAttribute('data-disabled')).not.toBeNull();
  });

  it('closes on Escape', async () => {
    renderMenu();
    fireEvent.contextMenu(screen.getByText('Right-click area'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes on outside click', async () => {
    renderMenu();
    fireEvent.contextMenu(screen.getByText('Right-click area'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes when a regular item is clicked', async () => {
    renderMenu();
    fireEvent.contextMenu(screen.getByText('Right-click area'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('toggles a checkbox item without closing the menu', () => {
    const onCheckedChange = vi.fn();
    render(
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
            Show bookmarks
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show bookmarks' }));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('selects a radio item and reports through onValueChange', () => {
    const onValueChange = vi.fn();
    render(
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuRadioGroup value="list" onValueChange={onValueChange}>
            <ContextMenuRadioItem value="list">List</ContextMenuRadioItem>
            <ContextMenuRadioItem value="grid">Grid</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Grid' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('grid');
  });

  it('renders a group label and separator with kit classes', () => {
    render(
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel>Account</ContextMenuLabel>
            <ContextMenuItem>Profile</ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator data-testid="separator" />
          <ContextMenuItem>Log out</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.getByText('Account').className).toContain(styles.label);
    expect(screen.getByTestId('separator').className).toContain(styles.separator);
  });

  it('opens a submenu and renders its items', async () => {
    render(
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem>Extensions</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
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
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
        <ContextMenuContent container={container}>
          <ContextMenuSub>
            <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem>Extensions</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'More tools' }));
    const submenuItem = await waitFor(() => screen.getByRole('menuitem', { name: 'Extensions' }));
    expect(container.contains(submenuItem)).toBe(true);
    container.remove();
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
        <ContextMenuContent container={container}>
          <ContextMenuItem>Profile</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(true);
    container.remove();
  });

  // inset is this port's real addition over dropdown-menu (see the upstream
  // registry's `data-inset` prop) — a plain data-attribute pass-through, so
  // one assertion per part it reaches is enough confidence; the CSS effect
  // itself isn't retested here (jsdom doesn't compute layout).
  it('marks inset items, labels, and sub triggers via data-inset', () => {
    render(
      <ContextMenu defaultOpen>
        <ContextMenuTrigger>Right-click area</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel inset>Account</ContextMenuLabel>
            <ContextMenuItem inset>Profile</ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger inset>More tools</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem>Extensions</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.getByText('Account').getAttribute('data-inset')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Profile' }).getAttribute('data-inset')).toBe(
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'More tools' }).getAttribute('data-inset')).toBe(
      'true',
    );
  });
});
