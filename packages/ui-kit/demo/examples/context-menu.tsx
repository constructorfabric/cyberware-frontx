import { useState } from 'react';

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
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DirectionProvider,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Row, Section } from '../shared';

const triggerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '6rem',
  width: '12rem',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-md)',
};

/* The composed example below gets the larger drop area upstream's own demo
 * uses, so the menu it opens is judged against a comparable surface. */
const fullTriggerStyle = { ...triggerStyle, height: '9.375rem', width: '18.75rem' };

/* Upstream's demo pins its composed menu to a fixed width (`w-52`) instead of
 * letting it size to content: the shortcut column is pushed right by
 * `margin-inline-start: auto`, so a content-sized popup leaves no gap between
 * a label and its shortcut. Matching the width here keeps the proportions
 * comparable to the reference — every other section stays content-sized to
 * exercise the popup's own min-width. */
const fullContentStyle = { width: '13rem' };

export default function ContextMenuExample() {
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [showFullUrls, setShowFullUrls] = useState(false);
  const [person, setPerson] = useState('pedro');
  const [view, setView] = useState('list');

  return (
    <>
      {/*
       * The one section that composes every part at once. The per-axis
       * sections below each isolate a single feature, which is what they are
       * for — but in isolation none of them shows how the parts read
       * together: the shortcut column lining up across rows, an inset row
       * sitting flush with the submenu trigger above it, indicators and
       * separators grouping the toggles. Mirrors the upstream registry's own
       * demo composition so the two can be compared row for row.
       */}
      <Section title="Full menu">
        <ContextMenu>
          <ContextMenuTrigger style={fullTriggerStyle}>Right-click here</ContextMenuTrigger>
          {/*
           * Upstream's own demo marks these four rows `inset` and this one
           * deliberately does not. That `inset` dates from when the registry
           * drew the checkbox/radio indicator in a LEFT column and the plain
           * rows had to be pushed out to match it. The indicator moved to the
           * end of the row since, and `inset` now reserves a leading-ICON
           * column and nothing else — so on the current registry those props
           * indent four rows past toggles that no longer sit under them, and
           * the menu's left edge comes out ragged. This menu has no icons, so
           * no row is inset and every label starts on the same line. The
           * Icons section below is where `inset` earns its keep.
           */}
          <ContextMenuContent style={fullContentStyle}>
            <ContextMenuItem>
              Back
              <ContextMenuShortcut>⌘[</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled>
              Forward
              <ContextMenuShortcut>⌘]</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              Reload
              <ContextMenuShortcut>⌘R</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>
                  Save page as...
                  <ContextMenuShortcut>⇧⌘S</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem>Create shortcut...</ContextMenuItem>
                <ContextMenuItem>Name window...</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem>Developer tools</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem checked={showBookmarks} onCheckedChange={setShowBookmarks}>
              Show bookmarks
              <ContextMenuShortcut>⌘B</ContextMenuShortcut>
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem checked={showFullUrls} onCheckedChange={setShowFullUrls}>
              Show full URLs
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuRadioGroup value={person} onValueChange={setPerson}>
              <ContextMenuLabel>People</ContextMenuLabel>
              <ContextMenuRadioItem value="pedro">Pedro Duarte</ContextMenuRadioItem>
              <ContextMenuRadioItem value="colm">Colm Tuite</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Basic">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Back</ContextMenuItem>
            <ContextMenuItem disabled>Forward</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>Reload</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Groups & labels">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuGroup>
              <ContextMenuLabel>Account</ContextMenuLabel>
              <ContextMenuItem>Profile</ContextMenuItem>
              <ContextMenuItem>Billing</ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuLabel>Team</ContextMenuLabel>
              <ContextMenuItem>Invite members</ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Shortcuts">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              Back
              <ContextMenuShortcut>⌘[</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              Forward
              <ContextMenuShortcut>⌘]</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              Reload
              <ContextMenuShortcut>⌘R</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      {/* Also the `inset` axis: the last row carries no icon, so it only lines
          up with the two above it because `inset` spends the same width on the
          icon column they use. Without it the three labels stagger. */}
      <Section title="Icons">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              <DemoIcon /> Add
            </ContextMenuItem>
            <ContextMenuItem>
              <DemoIcon /> Duplicate
            </ContextMenuItem>
            <ContextMenuItem inset>Rename</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Checkboxes">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuCheckboxItem checked={showBookmarks} onCheckedChange={setShowBookmarks}>
              Show bookmarks
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem checked disabled>
              Show full URLs
            </ContextMenuCheckboxItem>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Radio">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuRadioGroup value={view} onValueChange={setView}>
              <ContextMenuRadioItem value="list">List view</ContextMenuRadioItem>
              <ContextMenuRadioItem value="grid">Grid view</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Submenu">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Back</ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>Extensions</ContextMenuItem>
                <ContextMenuItem>Developer tools</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Destructive">
        <ContextMenu>
          <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Rename</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Section>

      <Section title="Sides">
        <Row>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <ContextMenu key={side}>
              <ContextMenuTrigger style={triggerStyle}>{side}</ContextMenuTrigger>
              <ContextMenuContent side={side}>
                <ContextMenuItem>Item one</ContextMenuItem>
                <ContextMenuItem>Item two</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </Row>
      </Section>

      <Section title="RTL">
        <DirectionProvider direction="rtl">
          <ContextMenu>
            <ContextMenuTrigger style={triggerStyle}>Right-click here</ContextMenuTrigger>
            <ContextMenuContent side="inline-end">
              <ContextMenuItem>Back</ContextMenuItem>
              <ContextMenuItem>Forward</ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>More tools</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuItem>Extensions</ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
        </DirectionProvider>
      </Section>
    </>
  );
}
