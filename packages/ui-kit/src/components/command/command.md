# Command

A searchable, keyboard-navigable list of commands or options, built on
[`cmdk`](https://github.com/pacocoursey/cmdk) — the same primitive
upstream shadcn/ui uses (Base UI has no comparable "filterable list with
built-in fuzzy scoring" primitive, so this is a deliberate exception to the
kit's usual Base UI foundation). `CommandDialog` composes the kit's own
`Dialog` (`../dialog`) rather than cmdk's bundled Radix-based dialog, so a
command palette gets the same portal/focus-trap/Escape-dismissal/theming
behavior every other kit overlay gets.

## Composition

```text
Command
├── CommandInput
└── CommandList
    ├── CommandEmpty
    ├── CommandGroup
    │   └── CommandItem (+ optional CommandShortcut)
    ├── CommandSeparator
    └── CommandGroup
        └── CommandItem
```

`CommandDialog` wraps that same tree with `Dialog` → `DialogContent`:

```text
CommandDialog
├── DialogHeader (visually hidden — DialogTitle + DialogDescription)
└── DialogContent
    └── Command
        ├── CommandInput
        └── CommandList
            └── ...
```

## When to use

- A command palette (⌘K-style) or any searchable action/option list where
  the user types to narrow down results.
- Filtering and keyboard navigation (arrow keys, Enter, Home/End) should
  come for free rather than being hand-rolled.

## When not to use

- A fixed, short list of mutually exclusive options with no need to
  search — use `select` or `radio-group`.
- A menu of actions anchored to a trigger button — use `dropdown-menu`.

## Props

`Command` — passes through every [cmdk `Command`
prop](https://github.com/pacocoursey/cmdk#command) (`label`, `filter`,
`shouldFilter`, `value` / `onValueChange`, `loop`, `vimBindings`, ...) plus
`className`.

`CommandDialog` (extends `Dialog`'s props minus `children`):

| Prop | Type | Default |
|------|------|---------|
| `title` | `ReactNode` — visually hidden, gives the dialog its accessible name | `'Command Palette'` |
| `description` | `ReactNode` — visually hidden | `'Search for a command to run...'` |
| `showCloseButton` | `boolean` — see below | `false` |
| `className` | `string` — merged onto the popup | — |

`showCloseButton` defaults to `false` here (unlike `DialogContent`, which
defaults it to `true`) — a command palette already dismisses on Escape or
an outside click, the palette's one-line header has no spare room for an
X button next to the search input, and the missing built-in escape hatch
DialogContent's own docs warn about is moot: `CommandDialog` never sets
`modal={false}`, and while modal a touch screen reader can still dismiss
via the platform's own "read next"/gesture dismissal rather than needing
an in-popup close control. Pass `showCloseButton` explicitly to override
either default.

`CommandInput` — forwards every [cmdk `Command.Input`
prop](https://github.com/pacocoursey/cmdk#commandinput) (`value` /
`onValueChange`, `disabled`, standard `<input>` attributes), plus
`wrapperClassName` for the icon+input row.

`CommandGroup` — `heading` (`ReactNode`), `value`, `forceMount`, plus every
other [cmdk `Command.Group`
prop](https://github.com/pacocoursey/cmdk#commandgroup).

`CommandItem` — `value`, `onSelect`, `disabled`, `keywords`, `forceMount`,
plus every other [cmdk `Command.Item`
prop](https://github.com/pacocoursey/cmdk#commanditem). Preferably pass a
stable `value`; without one cmdk infers it from `children`'s text content,
which breaks if that text changes between renders.

## Examples

```tsx
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@gears-frontx/ui-kit';

<Command className="max-w-sm">
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
      <CommandItem value="profile">Profile</CommandItem>
    </CommandGroup>
  </CommandList>
</Command>;
```

A palette opened from a keyboard shortcut:

```tsx
import { useEffect, useState } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@gears-frontx/ui-kit';

function CommandPalette() {
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
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem value="new-file" onSelect={() => setOpen(false)}>
            New file
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

## Anti-patterns

- Do not render `CommandInput`/`CommandList`/`CommandItem` outside a
  `Command` ancestor (directly under `CommandDialog`'s `children`, say) —
  they read cmdk's internal store off `Command`'s own React context; there
  is no fallback, and cmdk's own bundled dialog wraps children in exactly
  this same root for the same reason.
- Do not use `Command`/`CommandDialog` for a short, non-searchable list —
  the filtering/keyboard-navigation machinery is overhead a plain
  `dropdown-menu` or `select` doesn't need.
