import { PlusIcon } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

export default function TabsExample() {
  return (
    <>
      <Section title="Default">
        <Tabs defaultValue="account">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>
          <TabsContent value="account">Update your account details here.</TabsContent>
          <TabsContent value="password">Change your password here.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Line variant">
        <Tabs defaultValue="one">
          <TabsList variant="line">
            <TabsTrigger value="one">Line one</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel.</TabsContent>
          <TabsContent value="two">Second panel.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Vertical">
        <Tabs defaultValue="general" orientation="vertical">
          <TabsList variant="line">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
          </TabsList>
          <TabsContent value="general">General settings.</TabsContent>
          <TabsContent value="billing">Billing settings.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Disabled tab">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Enabled</TabsTrigger>
            <TabsTrigger value="two" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel.</TabsContent>
          <TabsContent value="two">Second panel.</TabsContent>
        </Tabs>
      </Section>

      <Section title="With icons">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <PlusIcon size={14} strokeWidth={1.5} /> One
            </TabsTrigger>
            <TabsTrigger value="two" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <PlusIcon size={14} strokeWidth={1.5} /> Two
            </TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel.</TabsContent>
          <TabsContent value="two">Second panel.</TabsContent>
        </Tabs>
      </Section>
    </>
  );
}
