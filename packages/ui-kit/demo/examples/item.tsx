import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Section } from '../shared';

export default function ItemExample() {
  return (
    <>
      <Section title="Basic">
        <Item>
          <ItemContent>
            <ItemTitle>Your subscription is expiring soon</ItemTitle>
            <ItemDescription>Renew before the end of the month to avoid interruption.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm">Renew</Button>
          </ItemActions>
        </Item>
      </Section>

      <Section title="Variant">
        <ItemGroup>
          <Item variant="default">Default variant</Item>
          <ItemSeparator />
          <Item variant="outline">Outline variant</Item>
          <ItemSeparator />
          <Item variant="muted">Muted variant</Item>
        </ItemGroup>
      </Section>

      <Section title="Size">
        <ItemGroup>
          <Item size="default">Default size</Item>
          <ItemSeparator />
          <Item size="sm">Small size</Item>
          <ItemSeparator />
          <Item size="xs">Extra small size</Item>
        </ItemGroup>
      </Section>

      <Section title="Icon">
        <Item variant="outline">
          <ItemMedia variant="icon">
            <DemoIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Suspicious sign-in blocked</ItemTitle>
            <ItemDescription>A sign-in from a new device was blocked.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" size="sm">
              Review
            </Button>
          </ItemActions>
        </Item>
      </Section>

      <Section title="Avatar">
        <Item variant="outline">
          <ItemMedia>
            <Avatar>
              <AvatarFallback>CN</AvatarFallback>
            </Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>shadcn</ItemTitle>
            <ItemDescription>Invited you to join the Design team.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm">Accept</Button>
          </ItemActions>
        </Item>
      </Section>

      <Section title="Image">
        <Item variant="outline">
          <ItemMedia variant="image">
            <DemoIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Weekend Mix</ItemTitle>
            <ItemDescription>32 tracks · 2h 14m</ItemDescription>
          </ItemContent>
          <ItemActions>
            <span>3:45</span>
          </ItemActions>
        </Item>
      </Section>

      <Section title="Group">
        <ItemGroup>
          <Item>
            <ItemMedia variant="icon">
              <DemoIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Jane Doe</ItemTitle>
              <ItemDescription>jane@company.com</ItemDescription>
            </ItemContent>
          </Item>
          <ItemSeparator />
          <Item>
            <ItemMedia variant="icon">
              <DemoIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Kim Lee</ItemTitle>
              <ItemDescription>kim@company.com</ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </Section>

      <Section title="Header">
        <Item variant="outline">
          <ItemHeader>
            <ItemMedia variant="image">
              <DemoIcon />
            </ItemMedia>
          </ItemHeader>
          <ItemContent>
            <ItemTitle>Claude 3.5 Sonnet</ItemTitle>
            <ItemDescription>Vision, tool use, and long-context reasoning.</ItemDescription>
          </ItemContent>
          <ItemFooter>
            <span>Capabilities: text, vision, tools</span>
          </ItemFooter>
        </Item>
      </Section>

      <Section title="Link">
        <Item variant="outline" render={<a href="#" onClick={(event) => event.preventDefault()} />}>
          <ItemContent>
            <ItemTitle>Notes.txt</ItemTitle>
            <ItemDescription>Open this file</ItemDescription>
          </ItemContent>
        </Item>
      </Section>

      <Section title="Dropdown">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Q3 report.pdf</ItemTitle>
            <ItemDescription>Uploaded 2 days ago, 1.2 MB</ItemDescription>
          </ItemContent>
          <ItemActions>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm">Options</Button>} />
              <DropdownMenuContent>
                <DropdownMenuItem>Download</DropdownMenuItem>
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </Item>
      </Section>
    </>
  );
}
