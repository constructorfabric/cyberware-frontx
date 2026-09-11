import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { cx } from 'class-variance-authority';

import styles from './collapsible.module.css';

/*
 * Upstream (apps/v4/registry/bases/base/ui/collapsible.tsx) is a bare
 * pass-through with no className handling at all on any of the three parts
 * — this kit still merges a kit class via `cx` on Trigger/Content (dropping
 * only `data-slot`, per the kit's standing decision, see card.tsx), since a
 * usable component needs a default focus ring on the trigger and a real
 * open/close height transition on the content — both hand-written in CSS
 * Modules (upstream leaves both entirely to the consumer, the same way it
 * does for Accordion).
 */
export interface CollapsibleProps extends Omit<CollapsiblePrimitive.Root.Props, 'className'> {
  className?: string;
}

export function Collapsible({ className, ...props }: CollapsibleProps) {
  return <CollapsiblePrimitive.Root className={className} {...props} />;
}

export interface CollapsibleTriggerProps
  extends Omit<CollapsiblePrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function CollapsibleTrigger({ className, ...props }: CollapsibleTriggerProps) {
  return <CollapsiblePrimitive.Trigger className={cx(styles.trigger, className)} {...props} />;
}

export interface CollapsibleContentProps
  extends Omit<CollapsiblePrimitive.Panel.Props, 'className'> {
  className?: string;
}

export function CollapsibleContent({ className, ...props }: CollapsibleContentProps) {
  return <CollapsiblePrimitive.Panel className={cx(styles.content, className)} {...props} />;
}
