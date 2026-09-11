import { useState } from 'react';

import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Row, Section } from '../shared';

export default function DropdownMenuExample() {
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [view, setView] = useState('list');

  return (
    <>
      <Section title="Basic">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open</Button>} />
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Billing</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Shortcuts">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open</Button>} />
          <DropdownMenuContent>
            <DropdownMenuItem>
              New Tab
              <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              New Window
              <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Icons">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open</Button>} />
          <DropdownMenuContent>
            <DropdownMenuItem>
              <DemoIcon />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <DemoIcon />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Checkboxes">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open</Button>} />
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={showBookmarks} onCheckedChange={setShowBookmarks}>
              Show bookmarks
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem defaultChecked>Show full URLs</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Radio group">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open</Button>} />
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value={view} onValueChange={setView}>
              <DropdownMenuRadioItem value="list">List view</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="grid">Grid view</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Submenu">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open</Button>} />
          <DropdownMenuContent>
            <DropdownMenuItem>Rename</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More tools</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Extensions</DropdownMenuItem>
                <DropdownMenuItem>Task manager</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Destructive">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">Open</Button>} />
          <DropdownMenuContent>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Avatar trigger">
        <Row>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Avatar style={{ cursor: 'pointer' }}>
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
              }
            />
            <DropdownMenuContent>
              <DropdownMenuLabel>shadcn</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
      </Section>
    </>
  );
}
