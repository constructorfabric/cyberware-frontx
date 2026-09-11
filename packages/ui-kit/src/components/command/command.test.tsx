import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command';
import styles from './command.module.css';

afterEach(cleanup);

function renderMenu(onSelect = vi.fn()) {
  return {
    onSelect,
    ...render(
      <Command label="Command menu" aria-label="Command menu">
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem value="calendar" onSelect={onSelect}>
              Calendar
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
            <CommandItem value="calculator">Calculator</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Settings">
            <CommandItem value="profile">Profile</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    ),
  };
}

describe('Command', () => {
  it('renders the input and every item with kit classes', () => {
    renderMenu();
    const input = screen.getByPlaceholderText('Type a command or search...');
    expect(input.className).toContain(styles.input);
    const item = screen.getByText('Calendar').closest('[cmdk-item]');
    expect(item?.className).toContain(styles.item);
  });

  it('filters items by the search value and shows CommandEmpty when nothing matches', () => {
    renderMenu();
    const input = screen.getByPlaceholderText('Type a command or search...');
    fireEvent.change(input, { target: { value: 'calc' } });
    expect(screen.getByText('Calculator')).toBeTruthy();
    expect(screen.queryByText('Calendar')).toBeNull();

    fireEvent.change(input, { target: { value: 'nothing matches this' } });
    expect(screen.getByText('No results found.')).toBeTruthy();
  });

  it('fires onSelect when an item is clicked', () => {
    const { onSelect } = renderMenu();
    fireEvent.click(screen.getByText('Calendar'));
    expect(onSelect).toHaveBeenCalledWith('calendar');
  });

  it('renders group headings and a separator between groups', () => {
    renderMenu();
    expect(screen.getByText('Suggestions')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(document.querySelector('[cmdk-separator]')).toBeTruthy();
  });
});

describe('CommandDialog', () => {
  function renderDialog(rootProps: Parameters<typeof CommandDialog>[0] = { children: null }) {
    return render(
      <CommandDialog defaultOpen {...rootProps}>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandItem value="new-file">New file</CommandItem>
        </CommandList>
      </CommandDialog>,
    );
  }

  it('portals the command menu into a dialog with a visually-hidden title', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Base UI's Dialog role picks up its accessible name from DialogTitle
    // even though the title's own wrapper is visually hidden.
    expect(screen.getByRole('dialog', { name: 'Command Palette' })).toBeTruthy();
    expect(screen.getByText('New file')).toBeTruthy();
  });

  it('omits the built-in close button by default', () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('supports a custom title/description and closes on Escape', async () => {
    renderDialog({ title: 'Quick actions', description: 'Jump to anything', children: null });
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('still filters items when composed inside the dialog', () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Search...'), {
      target: { value: 'nothing matches this' },
    });
    expect(screen.getByText('No results found.')).toBeTruthy();
    expect(screen.queryByText('New file')).toBeNull();
  });
});
