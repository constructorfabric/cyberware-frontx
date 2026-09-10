import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { cx } from 'class-variance-authority';

import styles from './scroll-area.module.css';

/*
 * Upstream (apps/v4/registry/bases/base/ui/scroll-area.tsx) exports exactly
 * two names, `ScrollArea` and `ScrollBar` — not one export per Base UI part.
 * `ScrollArea` is a fixed composition (Root > Viewport(children) + ScrollBar
 * + Corner); `ScrollBar` is exposed separately only so a consumer can add a
 * second one for the other axis (e.g. `<ScrollBar orientation="horizontal" />`
 * as an extra child, alongside the vertical one `ScrollArea` already
 * renders). This kit replicates that exact two-export surface rather than
 * expanding it to one export per Base UI part (Viewport/Content/Corner are
 * not exported here either, matching upstream) — see scroll-area.md.
 *
 * `data-orientation` is not re-declared on the Scrollbar the way upstream's
 * tsx does (`data-orientation={orientation}` alongside `orientation=
 * {orientation}`): Base UI's Scrollbar already stamps its own
 * `data-orientation` from state (see ScrollAreaScrollbarState's
 * `orientation` field, mirrored via getStateAttributesProps — the same
 * mechanism Separator uses, see separator.tsx), so re-declaring it here
 * would just be a duplicate of what Base UI already renders.
 */
export interface ScrollAreaProps extends Omit<ScrollAreaPrimitive.Root.Props, 'className'> {
  className?: string;
}

export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root className={cx(styles.root, className)} {...props}>
      <ScrollAreaPrimitive.Viewport className={styles.viewport}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      {/*
       * Corner is rendered internally, exactly as upstream does — it is
       * not one of the two exported names, and neither variant (base or
       * new-york) ever gives it a className: Base UI's own ScrollAreaCorner
       * positions and sizes itself from the measured scrollbar/thumb
       * geometry (--scroll-area-corner-height/-width), with nothing left
       * for a consumer stylesheet to add.
       */}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export interface ScrollBarProps extends Omit<ScrollAreaPrimitive.Scrollbar.Props, 'className'> {
  className?: string;
}

export function ScrollBar({ className, orientation = 'vertical', ...props }: ScrollBarProps) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cx(styles.scrollbar, className)}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className={styles.thumb} />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
