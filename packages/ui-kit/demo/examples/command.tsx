import { useEffect, useState } from 'react';

import {
  Button,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@gears-frontx/ui-kit';

import { Section } from '../shared';

function DialogDemo() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open command palette (⌘K)
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem value="new-file" onSelect={() => setOpen(false)}>
              New File
            </CommandItem>
            <CommandItem value="new-window" onSelect={() => setOpen(false)}>
              New Window
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

export default function CommandExample() {
  return (
    <>
      <Section title="Inline">
        <Command style={{ maxWidth: '24rem', border: '1px solid var(--border)' }}>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Suggestions">
              <CommandItem value="calendar">Calendar</CommandItem>
              <CommandItem value="search-emoji">Search Emoji</CommandItem>
              <CommandItem value="calculator">
                Calculator
                <CommandShortcut>⌘K</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Settings">
              <CommandItem value="profile">
                Profile
                <CommandShortcut>⌘P</CommandShortcut>
              </CommandItem>
              <CommandItem value="billing" disabled>
                Billing
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </Section>
      <Section title="Dialog">
        <DialogDemo />
      </Section>
      <Section title="Scrollable">
        <Command style={{ maxWidth: '24rem', border: '1px solid var(--border)' }}>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Files">
              {Array.from({ length: 20 }, (_, index) => (
                <CommandItem key={index} value={`file-${index}`}>
                  file-{index}.tsx
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </Section>
    </>
  );
}
