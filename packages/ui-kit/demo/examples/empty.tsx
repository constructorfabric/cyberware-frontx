import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Row, Section } from '../shared';

export default function EmptyExample() {
  return (
    <>
      <Section title="No projects yet">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DemoIcon />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>Create a project or import an existing one.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Row>
              <Button>Create project</Button>
              <Button variant="outline">Import</Button>
            </Row>
          </EmptyContent>
        </Empty>
      </Section>

      <Section title="With border">
        <Empty style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DemoIcon />
            </EmptyMedia>
            <EmptyTitle>No storage connected</EmptyTitle>
            <EmptyDescription>Connect a cloud storage provider to sync files.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline">Connect storage</Button>
          </EmptyContent>
        </Empty>
      </Section>

      <Section title="Avatar">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Avatar size="lg">
                <AvatarFallback>CN</AvatarFallback>
              </Avatar>
            </EmptyMedia>
            <EmptyTitle>You are offline</EmptyTitle>
            <EmptyDescription>Check your connection and try again.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Section>

      <Section title="Avatar group">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <AvatarGroup>
                <Avatar>
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>LR</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>KL</AvatarFallback>
                </Avatar>
              </AvatarGroup>
            </EmptyMedia>
            <EmptyTitle>No team members yet</EmptyTitle>
            <EmptyDescription>Invite your team to start collaborating.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button>Invite members</Button>
          </EmptyContent>
        </Empty>
      </Section>

      <Section title="With input group">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DemoIcon />
            </EmptyMedia>
            <EmptyTitle>404 - Page not found</EmptyTitle>
            <EmptyDescription>The page you are looking for does not exist.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <InputGroup style={{ maxWidth: '20rem' }}>
              <InputGroupInput placeholder="Search pages" aria-label="Search pages" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton>Search</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </EmptyContent>
        </Empty>
      </Section>
    </>
  );
}
