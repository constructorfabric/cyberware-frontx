import { cx } from 'class-variance-authority';
import { GripVerticalIcon } from 'lucide-react';
import * as ResizablePrimitive from 'react-resizable-panels';

import styles from './resizable.module.css';

/*
 * Translated from shadcn/ui base (registry/bases/base/ui/resizable.tsx) — a
 * react-resizable-panels wrapper with no Base UI primitive underneath (no
 * Base UI Resizable exists).
 *
 * No 'use client' here despite react-resizable-panels itself needing the
 * client runtime (measuring panels, dragging handles): none of the three
 * functions below calls a hook directly in ITS OWN render body — they are
 * pure prop-forwarding wrappers around the vendor primitive, which already
 * ships its own 'use client' boundary (see its dist bundle). Same
 * reasoning already applied to dialog.tsx/checkbox.tsx, which wrap equally
 * stateful Base UI primitives with no directive of their own — see
 * scripts/verify-consumer.sh's SERVER_COMPONENTS list.
 *
 * The pinned react-resizable-panels@4.12.3 exports `Group`/`Panel`/
 * `Separator` (confirmed against its own .d.ts) — a different surface than
 * the `PanelGroup`/`Panel`/`PanelResizeHandle` names shadcn's own
 * new-york-v4 sibling variant still documents. The `base` source this port
 * follows already matches the installed version's real names.
 */

export type ResizablePanelGroupProps = ResizablePrimitive.GroupProps;

export function ResizablePanelGroup({ className, ...props }: ResizablePanelGroupProps) {
  return <ResizablePrimitive.Group className={cx(styles.group, className)} {...props} />;
}

export type ResizablePanelProps = ResizablePrimitive.PanelProps;

/*
 * Upstream styles nothing on Panel itself (no `className` merge, no
 * wrapper class) — replicated faithfully: this is a bare pass-through, not
 * an oversight.
 */
export function ResizablePanel(props: ResizablePanelProps) {
  return <ResizablePrimitive.Panel {...props} />;
}

export interface ResizableHandleProps extends ResizablePrimitive.SeparatorProps {
  /** Renders a small grip glyph centered on the handle. @default false */
  withHandle?: boolean;
}

/* Upstream's `base` source renders an opaque `cn-resizable-handle-icon`
 * class with no concrete glyph or geometry in the fetched registry file
 * (that utility class's real definition lives in shadcn's own base theme
 * stylesheet, which this porting task has no access to) — the new-york-v4
 * sibling variant is the one that names an actual icon (`GripVerticalIcon`)
 * and gives concrete box geometry, so this follows that sibling for both,
 * the same "base ships structure only" pattern Avatar hits. */
export function ResizableHandle({ withHandle, className, ...props }: ResizableHandleProps) {
  return (
    <ResizablePrimitive.Separator className={cx(styles.handle, className)} {...props}>
      {withHandle && (
        <div className={styles.grip}>
          <GripVerticalIcon className={styles.gripIcon} />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}
