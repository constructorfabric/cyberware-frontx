import type { CSSProperties } from 'react';

import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='160'%3E%3Crect width='320' height='160' fill='%23d4d4d8'/%3E%3C/svg%3E";

export default function CardExample() {
  return (
    <>
      <Section title="Basic">
        <Card style={{ maxWidth: 420 }}>
          <CardHeader>
            <CardTitle>Project Amber</CardTitle>
          </CardHeader>
          <CardContent>Surfaces sit on --card with --border.</CardContent>
          {/* CardFooter is a bare flex row with no gap of its own — the same
              contract as upstream, where every card demo spaces its own
              buttons on the footer (`justify-end gap-2`). Spelled out here
              because the demo is what a consumer copies: two buttons dropped
              into a bare CardFooter render flush against each other. */}
          <CardFooter style={{ gap: 'var(--space-2)' }}>
            <Button variant="outline">Cancel</Button>
            <Button size="sm">Open</Button>
          </CardFooter>
        </Card>
      </Section>
      <Section title="With description and action">
        <Card style={{ maxWidth: 420 }}>
          <CardHeader>
            <CardTitle>Team plan</CardTitle>
            <CardDescription>Billed monthly, 5 seats in use.</CardDescription>
            <CardAction>
              <Badge variant="success">active</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>Next invoice on the 1st.</CardContent>
        </Card>
      </Section>
      <Section title="Small size">
        <Card size="sm" style={{ maxWidth: 320 }}>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>12 GB of 20 GB used</CardDescription>
          </CardHeader>
          <CardContent>8 GB free</CardContent>
        </Card>
      </Section>
      <Section title="Spacing">
        <Row style={{ alignItems: 'flex-start' }}>
          <Card style={{ maxWidth: 220, '--card-spacing': '0.75rem' } as CSSProperties}>
            <CardHeader>
              <CardTitle>12px</CardTitle>
            </CardHeader>
            <CardContent>Tight spacing</CardContent>
          </Card>
          <Card style={{ maxWidth: 220 }}>
            <CardHeader>
              <CardTitle>Default</CardTitle>
            </CardHeader>
            <CardContent>Default spacing</CardContent>
          </Card>
          <Card style={{ maxWidth: 220, '--card-spacing': '2rem' } as CSSProperties}>
            <CardHeader>
              <CardTitle>32px</CardTitle>
            </CardHeader>
            <CardContent>Loose spacing</CardContent>
          </Card>
        </Row>
      </Section>
      <Section title="With image">
        <Card style={{ maxWidth: 320 }}>
          <img src={PLACEHOLDER_IMAGE} alt="" style={{ width: '100%', height: 160, objectFit: 'cover' }} />
          <CardHeader>
            <CardTitle>Design systems meetup</CardTitle>
            <CardDescription>Thursday, 6:00 PM</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm">RSVP</Button>
          </CardContent>
        </Card>
      </Section>
    </>
  );
}
