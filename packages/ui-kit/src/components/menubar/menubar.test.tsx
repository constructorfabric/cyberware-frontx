import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import dropdownMenuStyles from '../dropdown-menu/dropdown-menu.module.css';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from './menubar';
import styles from './menubar.module.css';

afterEach(cleanup);

function renderMenubar() {
  return render(
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>New Tab</MenubarItem>
          <MenubarItem disabled>New Window</MenubarItem>
          <MenubarSeparator data-testid="separator" />
          <MenubarItem variant="destructive">Close</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Undo</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>,
  );
}

describe('Menubar', () => {
  it('renders top-level triggers with the kit trigger class and keeps popups out of the DOM', () => {
    renderMenubar();
    const fileTrigger = screen.getByRole('menuitem', { name: 'File' });
    expect(fileTrigger.className).toContain(styles.trigger);
    expect(screen.getByRole('menuitem', { name: 'Edit' }).className).toContain(styles.trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu on trigger click and renders its items', () => {
    renderMenubar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'New Tab' })).toBeTruthy();
  });

  it('applies the destructive item variant, reused from DropdownMenuItem', () => {
    renderMenubar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: 'Close' }).className).toContain(
      dropdownMenuStyles.variantDestructive,
    );
  });

  it('marks a disabled item', () => {
    renderMenubar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    const disabledItem = screen.getByRole('menuitem', { name: 'New Window' });
    expect(disabledItem.getAttribute('data-disabled')).not.toBeNull();
  });

  it('renders a separator with the kit class', () => {
    renderMenubar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByTestId('separator').className).toContain(dropdownMenuStyles.separator);
  });

  it('closes on Escape', async () => {
    renderMenubar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('closes when an item is clicked and fires its handler', async () => {
    const onNewTab = vi.fn();
    render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onNewTab}>New Tab</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Tab' }));
    expect(onNewTab).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('toggles a checkbox item without closing the menu', () => {
    const onCheckedChange = vi.fn();
    render(
      <Menubar>
        <MenubarMenu defaultOpen>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
              Show bookmarks
            </MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show bookmarks' }));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('selects a radio item and reports through onValueChange', () => {
    const onValueChange = vi.fn();
    render(
      <Menubar>
        <MenubarMenu defaultOpen>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            <MenubarRadioGroup value="list" onValueChange={onValueChange}>
              <MenubarRadioItem value="list">List</MenubarRadioItem>
              <MenubarRadioItem value="grid">Grid</MenubarRadioItem>
            </MenubarRadioGroup>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Grid' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('grid');
  });

  // Defining Menubar behavior: with one menu already open, moving focus to a
  // sibling top-level trigger (arrow keys move focus within the roving
  // tabindex row Base UI's Menubar manages) switches straight to that menu
  // without a click, rather than requiring the first menu to be dismissed.
  it('switches to an adjacent top-level menu via the keyboard while staying open', async () => {
    renderMenubar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: 'New Tab' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeTruthy());
    expect(screen.queryByRole('menuitem', { name: 'New Tab' })).toBeNull();
  });

  // Outside-press dismissal — same contract as dropdown-menu.test.tsx, since
  // MenubarContent is DropdownMenuContent with different positioning defaults.
  it('closes on outside click', async () => {
    renderMenubar();
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('opens a submenu and renders its items', async () => {
    render(
      <Menubar>
        <MenubarMenu defaultOpen>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarSub>
              <MenubarSubTrigger>Share</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem>Email link</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));
    const submenuItem = await waitFor(() => screen.getByRole('menuitem', { name: 'Email link' }));
    expect(submenuItem).toBeTruthy();
  });

  // Native Base UI hover-switch: once one top-level menu is open, moving the
  // pointer onto an adjacent trigger opens THAT menu directly — no click, and
  // no need to close the first one first. delay={0} keeps this deterministic
  // with real timers, same rationale as popover.test.tsx's openOnHover case.
  it('switches to an adjacent top-level menu on pointer hover while staying open', async () => {
    render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger delay={0}>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>New Tab</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger delay={0}>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>Undo</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: 'New Tab' })).toBeTruthy();
    const editTrigger = screen.getByRole('menuitem', { name: 'Edit' });
    fireEvent.mouseEnter(editTrigger);
    fireEvent.mouseMove(editTrigger);
    // Both assertions in one waitFor: File's popup closing and Edit's popup
    // opening are two independent state updates, not guaranteed to land in
    // the same microtask flush.
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'New Tab' })).toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeTruthy();
    });
  });
});
