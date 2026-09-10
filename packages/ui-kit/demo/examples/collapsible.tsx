import { ChevronsUpDownIcon } from 'lucide-react';
import { type CSSProperties, useState } from 'react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@gears-frontx/ui-kit';

import { Section } from '../shared';

/*
 * Upstream's own collapsible.tsx ships with no className handling at all —
 * the bordered-row, icon-button look comes entirely from upstream's demo
 * composition (apps/v4/examples/base/collapsible-demo.tsx), not the
 * component. This file reproduces that composition with kit tokens: a
 * static title + a small icon-only trigger (lucide's ChevronsUpDown),
 * bordered rows (the `--border`/`--border-width`/
 * `--radius-md` idiom accordion.tsx's own "Borders" demo section already
 * uses), and `--space-*` gap rhythm.
 *
 * The trigger is deliberately hand-styled here rather than composed as
 * `<CollapsibleTrigger render={<Button variant="ghost" .../>} />` (the
 * pattern dropdown-menu.tsx/popover.tsx use for their own Button-rendered
 * triggers): CollapsibleTrigger forces its own `.trigger` reset class
 * (collapsible.module.css — width:100%, border:none, padding:0, background:
 * none) onto whatever element `render` is given, via Base UI's class merge.
 * Button's own classes survive alongside it, but with equal CSS specificity
 * the two rulesets fight over the same properties (width/border/padding/
 * background) and the winner depends on CSS Modules' bundle load order —
 * confirmed broken in this build: the composed trigger measured 197px wide
 * instead of a 32px square. Unlike DropdownMenuTrigger/PopoverTrigger,
 * which pass through only a consumer className and never force a class of
 * their own onto `render`, Collapsible's (and Accordion's) Trigger always
 * does — flagged as a kit-level composition gap, out of this fix's scope
 * (component code wasn't touched here). Styling the icon trigger directly
 * sidesteps the collision and stays deterministic.
 */
const triggerIconStyle: CSSProperties = {
  width: 'var(--icon-size-sm)',
  height: 'var(--icon-size-sm)',
  color: 'var(--muted-foreground)',
};

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  width: '20rem',
};

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-4)',
  paddingInline: 'var(--space-4)',
};

const titleTextStyle: CSSProperties = {
  fontSize: 'var(--text-label-size)',
  fontWeight: 'var(--text-label-weight)' as CSSProperties['fontWeight'],
};

// Overrides .trigger's width:100%/justify-content:space-between (both meant
// for a full-row text trigger) to make the same reset element a small
// square icon button instead — see the file-header comment for why this
// isn't composed through Button.
const iconTriggerStyle: CSSProperties = {
  width: 'var(--space-8)',
  height: 'var(--space-8)',
  flexShrink: 0,
  justifyContent: 'center',
  borderRadius: 'var(--radius-md)',
};

const rowStyle: CSSProperties = {
  border: 'var(--border-width) solid var(--border)',
  borderRadius: 'var(--radius-md)',
  paddingInline: 'var(--space-4)',
  paddingBlock: 'var(--space-2)',
  fontSize: 'var(--text-body-size)',
};

const panelListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

function ControlledDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} style={listStyle}>
      <div style={titleRowStyle}>
        <span style={titleTextStyle}>Advanced options ({open ? 'open' : 'closed'})</span>
        <CollapsibleTrigger style={iconTriggerStyle} aria-label="Toggle advanced options">
          <ChevronsUpDownIcon style={triggerIconStyle} />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent style={panelListStyle}>
        <div style={rowStyle}>Custom endpoint</div>
        <div style={rowStyle}>Retry policy</div>
        <div style={rowStyle}>Timeout</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function CollapsibleExample() {
  return (
    <>
      <Section title="Default">
        <Collapsible defaultOpen style={listStyle}>
          <div style={titleRowStyle}>
            <span style={titleTextStyle}>What is included?</span>
            <CollapsibleTrigger style={iconTriggerStyle} aria-label="Toggle">
              <ChevronsUpDownIcon style={triggerIconStyle} />
            </CollapsibleTrigger>
          </div>
          <div style={rowStyle}>Pro plan</div>
          <CollapsibleContent style={panelListStyle}>
            <div style={rowStyle}>Priority support</div>
            <div style={rowStyle}>Unlimited seats</div>
          </CollapsibleContent>
        </Collapsible>
      </Section>
      <Section title="Controlled">
        <ControlledDemo />
      </Section>
      <Section title="Disabled">
        <Collapsible disabled style={listStyle}>
          <div style={titleRowStyle}>
            <span style={titleTextStyle}>Locked section</span>
            <CollapsibleTrigger style={iconTriggerStyle} aria-label="Toggle locked section">
              <ChevronsUpDownIcon style={triggerIconStyle} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent style={panelListStyle}>
            <div style={rowStyle}>Unavailable on your current plan.</div>
          </CollapsibleContent>
        </Collapsible>
      </Section>
      <Section title="Keep mounted">
        <Collapsible style={listStyle}>
          <div style={titleRowStyle}>
            <span style={titleTextStyle}>Custom endpoint</span>
            <CollapsibleTrigger style={iconTriggerStyle} aria-label="Toggle custom endpoint">
              <ChevronsUpDownIcon style={triggerIconStyle} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent keepMounted style={panelListStyle}>
            <input placeholder="https://api.example.com" style={{ ...rowStyle, width: '100%' }} />
          </CollapsibleContent>
        </Collapsible>
      </Section>
      <Section title="Nested">
        {/* A tree/list disclosure, not upstream's bordered card — the trigger's
            own text carries the label (matches collapsible.md's plain-text
            example) with the same chevron appended for a consistent
            non-bare affordance; .trigger's existing flex+space-between
            layout places it at the row's end with no extra styling. */}
        <Collapsible defaultOpen style={{ ...listStyle, width: '16rem' }}>
          <CollapsibleTrigger style={titleTextStyle}>
            src
            <ChevronsUpDownIcon style={triggerIconStyle} />
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted style={{ ...panelListStyle, paddingLeft: 'var(--space-4)' }}>
            <Collapsible defaultOpen>
              <CollapsibleTrigger style={titleTextStyle}>
                components
                <ChevronsUpDownIcon style={triggerIconStyle} />
              </CollapsibleTrigger>
              <CollapsibleContent keepMounted style={{ ...panelListStyle, paddingLeft: 'var(--space-4)' }}>
                <div style={rowStyle}>button.tsx</div>
                <div style={rowStyle}>card.tsx</div>
              </CollapsibleContent>
            </Collapsible>
            <Collapsible>
              <CollapsibleTrigger style={titleTextStyle}>
                hooks
                <ChevronsUpDownIcon style={triggerIconStyle} />
              </CollapsibleTrigger>
              <CollapsibleContent keepMounted style={{ ...panelListStyle, paddingLeft: 'var(--space-4)' }}>
                <div style={rowStyle}>use-toggle.ts</div>
              </CollapsibleContent>
            </Collapsible>
          </CollapsibleContent>
        </Collapsible>
      </Section>
    </>
  );
}
