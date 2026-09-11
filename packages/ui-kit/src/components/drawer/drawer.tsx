// Load-bearing: DrawerContent calls useDrawer() (React.useContext under the
// hood) directly in its own render body, same shape as DropdownMenuContent's
// useContext(MenuContainerContext) — see that file's own banner comment.
// Coupled to CLIENT_COMPONENTS in scripts/verify-consumer.sh — keep both in
// sync if this ever changes.
'use client';

import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import { cva, cx } from 'class-variance-authority';
import { createContext, useContext, type ComponentProps } from 'react';

import styles from './drawer.module.css';

/**
 * Which edge the drawer opens from and swipes back out toward — same
 * vocabulary and default as Sheet's `side` (top/right/bottom/left,
 * default 'right' there vs. 'bottom' here, the conventional default for
 * each). Base UI's own Drawer primitive names this axis `swipeDirection`
 * with values 'up'/'down'/'left'/'right' (the direction a dismiss swipe
 * travels, not the edge the panel sits against) — the two vocabularies are
 * a straight 1:1 map (a bottom-anchored drawer is always dismissed by
 * swiping down, a top-anchored one by swiping up; left/right name the
 * same thing either way), so this kit-level prop renames only the
 * top/bottom half for consistency with Sheet's own edge-anchored
 * vocabulary, without losing any distinction Base UI itself draws.
 */
export type DrawerSide = 'top' | 'right' | 'bottom' | 'left';

const SIDE_TO_SWIPE_DIRECTION: Record<DrawerSide, NonNullable<DrawerPrimitive.Root.Props['swipeDirection']>> = {
  top: 'up',
  right: 'right',
  bottom: 'down',
  left: 'left',
};

interface DrawerContextValue {
  /** Whether `snapPoints` was given a non-empty list — drives `data-snap-points`
   * on both Backdrop and Popup (see drawer.module.css). */
  hasSnapPoints: boolean;
  modal: DrawerPrimitive.Root.Props['modal'];
  showSwipeHandle: boolean;
  side: DrawerSide;
}

/**
 * `Drawer` (root) and `DrawerContent` are siblings in the JSX tree, not
 * parent/child — same shape as upstream's own `useDrawer()` context, needed
 * because `DrawerContent` has to know `side`/`modal`/`showSwipeHandle`
 * without the root prop-drilling them through whatever intervening markup
 * a consumer places between `Drawer` and `DrawerContent`.
 */
const DrawerContext = createContext<DrawerContextValue | null>(null);

function useDrawer() {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error('Drawer parts (DrawerContent, DrawerPortal, ...) must be rendered inside a Drawer.');
  }
  return context;
}

export interface DrawerProps extends Omit<DrawerPrimitive.Root.Props, 'swipeDirection'> {
  /** @default 'bottom' */
  side?: DrawerSide;
  /**
   * Renders a small grab-handle bar at the panel's innermost edge — a
   * visual affordance only (`aria-hidden`); swipe-to-dismiss itself works
   * from anywhere in the popup regardless of this prop. @default false
   */
  showSwipeHandle?: boolean;
}

export function Drawer({
  modal = true,
  side = 'bottom',
  showSwipeHandle = false,
  snapPoints,
  ...props
}: DrawerProps) {
  const hasSnapPoints = snapPoints != null && snapPoints.length > 0;
  // No useMemo: this object is small (four primitives) and Drawer's own
  // render body stays hook-free either way — DrawerContent is what pulls in
  // the 'use client' requirement (see the file banner), not this recompute.
  const contextValue: DrawerContextValue = { hasSnapPoints, modal, showSwipeHandle, side };

  return (
    <DrawerContext.Provider value={contextValue}>
      <DrawerPrimitive.Root
        modal={modal}
        snapPoints={snapPoints}
        swipeDirection={SIDE_TO_SWIPE_DIRECTION[side]}
        {...props}
      />
    </DrawerContext.Provider>
  );
}
/**
 * Unlike Dialog's plain `export const Dialog = DialogPrimitive.Root` alias,
 * `Drawer` above is a real wrapper function: the root renders no DOM element
 * of its own (Base UI groups the parts via context only), so this is the
 * only place the `side`→`swipeDirection` translation and the
 * `modal`/`showSwipeHandle`/`side` handoff to `DrawerContent` (via
 * `DrawerContext`) can live.
 */

export interface DrawerTriggerProps extends Omit<DrawerPrimitive.Trigger.Props, 'className'> {
  className?: string;
}

export function DrawerTrigger({ className, ...props }: DrawerTriggerProps) {
  return <DrawerPrimitive.Trigger className={className} {...props} />;
}

export type DrawerPortalProps = Omit<DrawerPrimitive.Portal.Props, 'className'>;

export function DrawerPortal(props: DrawerPortalProps) {
  return <DrawerPrimitive.Portal {...props} />;
}

export interface DrawerCloseProps extends Omit<DrawerPrimitive.Close.Props, 'className'> {
  className?: string;
}

export function DrawerClose({ className, ...props }: DrawerCloseProps) {
  return <DrawerPrimitive.Close className={className} {...props} />;
}

/**
 * The visual grab-handle bar shown at the panel's innermost edge when
 * `Drawer`'s `showSwipeHandle` is true. `aria-hidden`: it's a drag
 * affordance, not a control — the whole popup already responds to a swipe
 * gesture, and Base UI's own Escape/outside-press/trigger dismissal need no
 * button here. Orientation and edge-ordering are driven entirely by the
 * ancestor `.popup`'s own `side`/axis classes (see drawer.module.css) — this
 * component itself carries no side-awareness.
 */
export type DrawerSwipeHandleProps = ComponentProps<'div'>;

export function DrawerSwipeHandle({ className, ...props }: DrawerSwipeHandleProps) {
  return <div aria-hidden="true" className={cx(styles.swipeHandle, className)} {...props} />;
}

export interface DrawerBackdropProps extends Omit<DrawerPrimitive.Backdrop.Props, 'className'> {
  className?: string;
}

export function DrawerBackdrop({ className, ...props }: DrawerBackdropProps) {
  return <DrawerPrimitive.Backdrop className={cx(styles.backdrop, className)} {...props} />;
}

const drawerPopupVariants = cva(styles.popup, {
  variants: {
    side: {
      top: styles.sideTop,
      right: styles.sideRight,
      bottom: styles.sideBottom,
      left: styles.sideLeft,
    },
  },
});

export interface DrawerContentProps extends Omit<DrawerPrimitive.Popup.Props, 'className'> {
  className?: string;
  /**
   * Where to portal the popup. Defaults to <body>. Pass a themed container
   * when the theme is scoped to a subtree — same contract as
   * DialogContent/SheetContent.
   */
  container?: DrawerPrimitive.Portal.Props['container'];
}

export function DrawerContent({ className, children, container, ...props }: DrawerContentProps) {
  const { hasSnapPoints, modal, showSwipeHandle, side } = useDrawer();
  // Base UI's own axis split (down/up dismiss vertically, left/right
  // horizontally) — matches its `data-swipe-axis` exactly, computed the same
  // way upstream's own useDrawer()-based DrawerContent does.
  const swipeAxis = side === 'top' || side === 'bottom' ? 'y' : 'x';

  return (
    <DrawerPortal container={container}>
      {/* Overlay/backdrop renders only for a genuinely modal drawer, exactly
       * like Dialog/Sheet's own modal+showBackdrop pairing — but Drawer has
       * no separate showBackdrop escape hatch because upstream's own source
       * ties Overlay strictly to `modal === true` with no independent prop,
       * and this port stays faithful to that shape rather than inventing one. */}
      {modal === true && <DrawerBackdrop data-snap-points={hasSnapPoints ? '' : undefined} />}
      <DrawerPrimitive.Viewport data-modal={modal} className={styles.viewport}>
        <DrawerPrimitive.Popup
          data-swipe-axis={swipeAxis}
          data-snap-points={hasSnapPoints ? '' : undefined}
          data-side={side}
          className={drawerPopupVariants({ side, className })}
          {...props}
        >
          {showSwipeHandle && <DrawerSwipeHandle />}
          <DrawerPrimitive.Content className={styles.content}>{children}</DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPortal>
  );
}

export type DrawerHeaderProps = ComponentProps<'div'>;

export function DrawerHeader({ className, ...props }: DrawerHeaderProps) {
  return <div className={cx(styles.header, className)} {...props} />;
}

export type DrawerFooterProps = ComponentProps<'div'>;

export function DrawerFooter({ className, ...props }: DrawerFooterProps) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

export interface DrawerTitleProps extends Omit<DrawerPrimitive.Title.Props, 'className'> {
  className?: string;
}

export function DrawerTitle({ className, ...props }: DrawerTitleProps) {
  return <DrawerPrimitive.Title className={cx(styles.title, className)} {...props} />;
}

export interface DrawerDescriptionProps extends Omit<DrawerPrimitive.Description.Props, 'className'> {
  className?: string;
}

export function DrawerDescription({ className, ...props }: DrawerDescriptionProps) {
  return <DrawerPrimitive.Description className={cx(styles.description, className)} {...props} />;
}
