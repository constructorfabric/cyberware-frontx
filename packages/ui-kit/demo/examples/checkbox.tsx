import { useState } from 'react';

import { Checkbox, Label } from '@gears-frontx/ui-kit';

import { Row, Section } from '../shared';

export default function CheckboxExample() {
  const [subscribed, setSubscribed] = useState(true);
  const [children, setChildren] = useState({ hardDisks: true, externalDisks: false });
  const allChildrenChecked = children.hardDisks && children.externalDisks;
  const noChildrenChecked = !children.hardDisks && !children.externalDisks;

  return (
    <>
      <Section title="Labelled">
        <Row>
          <Label>
            <Checkbox defaultChecked /> Accept terms and conditions
          </Label>
          <Label>
            <Checkbox /> Enable notifications
          </Label>
        </Row>
      </Section>

      <Section title="Controlled">
        <Label>
          <Checkbox checked={subscribed} onCheckedChange={setSubscribed} /> Subscribe to updates
        </Label>
      </Section>

      <Section title="Indeterminate">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Label>
            <Checkbox
              checked={allChildrenChecked}
              indeterminate={!allChildrenChecked && !noChildrenChecked}
              onCheckedChange={(checked) => setChildren({ hardDisks: checked, externalDisks: checked })}
            />
            Show these items on the desktop
          </Label>
          <Label style={{ paddingInlineStart: 'var(--space-5)' }}>
            <Checkbox
              checked={children.hardDisks}
              onCheckedChange={(checked) => setChildren((value) => ({ ...value, hardDisks: checked }))}
            />
            Hard disks
          </Label>
          <Label style={{ paddingInlineStart: 'var(--space-5)' }}>
            <Checkbox
              checked={children.externalDisks}
              onCheckedChange={(checked) => setChildren((value) => ({ ...value, externalDisks: checked }))}
            />
            External disks
          </Label>
        </div>
      </Section>

      <Section title="Invalid">
        <Label>
          <Checkbox aria-invalid required /> I agree to the terms
        </Label>
      </Section>

      <Section title="Disabled">
        <Row>
          <Label data-disabled="">
            <Checkbox disabled /> Not available
          </Label>
          <Label data-disabled="">
            <Checkbox disabled defaultChecked /> Locked option
          </Label>
        </Row>
      </Section>

      <Section title="Group">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Label>
            <Checkbox name="items" value="recents" defaultChecked /> Recents
          </Label>
          <Label>
            <Checkbox name="items" value="applications" defaultChecked /> Applications
          </Label>
          <Label>
            <Checkbox name="items" value="desktop" /> Desktop
          </Label>
        </div>
      </Section>
    </>
  );
}
