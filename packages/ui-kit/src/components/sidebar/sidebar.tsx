// Load-bearing: SidebarProvider/Sidebar/SidebarMenuButton call useContext
// (useSidebar) and useState/useEffect directly in their own render body,
// same shape as DrawerContent's useDrawer() — see that file's own banner
// comment. Coupled to CLIENT_COMPONENTS in scripts/verify-consumer.sh —
// keep both in sync if this ever changes.
'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, cx, type VariantProps } from 'class-variance-authority';
import { PanelLeftIcon } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { Button, type ButtonProps } from '../button/button.js';
import { Input, type InputProps } from '../input/input.js';
import { Separator, type SeparatorProps } from '../separator/separator.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../sheet/sheet.js';
import { Skeleton } from '../skeleton/skeleton.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type TooltipContentProps,
} from '../tooltip/tooltip.js';
import { useIsMobile } from './use-mobile.js';
import styles from './sidebar.module.css';

/*
 * Upstream (apps/v4/registry/bases/base/ui/sidebar.tsx) has no Base UI
 * primitive of its own — it is the kit's own application-shell state
 * machine (open/collapsed, mobile-vs-desktop, three collapse modes) built
 * ENTIRELY on composed kit parts (Sheet for the mobile drawer, Button,
 * Input, Separator, Skeleton, Tooltip) plus Base UI's headless
 * `useRender`/`mergeProps` render-prop utilities for the parts upstream
 * itself makes polymorphic. See sidebar.md for the parts whose visual
 * design is this port's own (upstream routes them through a marker-class
 * layer the fetched registry file doesn't include).
 */

const SIDEBAR_COOKIE_NAME = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = '16rem';
const SIDEBAR_WIDTH_MOBILE = '18rem';
const SIDEBAR_WIDTH_ICON = '3rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

function readOpenCookie(defaultOpen: boolean): boolean {
  // SSR guard: this is a 'use client' component, but a framework can still
  // render it once on the server before hydration, where `document` does
  // not exist — same defensive shape as use-mobile.ts's effect-only window
  // reads, just at initializer time instead.
  if (typeof document === 'undefined') {
    return defaultOpen;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] === 'true' : defaultOpen;
}

function writeOpenCookie(open: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
}

interface SidebarContextValue {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  openMobile: boolean;
  setOpenMobile: Dispatch<SetStateAction<boolean>>;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/**
 * Reads the nearest SidebarProvider's open/collapsed state and controls —
 * `SidebarTrigger`/`SidebarRail` are thin wrappers over `toggleSidebar`
 * from this same hook, so any custom trigger a consumer builds (e.g. a
 * command-palette action) uses the exact same call.
 *
 * @throws {Error} outside a `SidebarProvider` — matching upstream's own
 * contract; there is no sensible default state to fall back to (a bare
 * `Sidebar` still needs to know whether it's mobile, and asking the
 * question outside a Provider means no one is answering it).
 */
export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }
  return context;
}

export interface SidebarProviderProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
  /**
   * Initial expanded/collapsed state for an uncontrolled Sidebar, and an
   * opt-OUT of the persisted cookie: pass it and it wins outright; omit it
   * and the last persisted state is restored instead (falling back to
   * expanded on a first visit).
   *
   * The distinction matters because the cookie is one global key for the
   * whole document. Without the opt-out, two Providers on one page — a
   * gallery, a split view, a docs page with several examples — would each
   * read the same key and move together, and `defaultOpen={false}` would
   * silently do nothing as soon as anything had ever toggled anything.
   */
  defaultOpen?: boolean;
  /** Controlled desktop open state — pass with `onOpenChange` to own it entirely. */
  open?: boolean;
  /**
   * Fires on every desktop expand/collapse (trigger click, rail click, the
   * Cmd/Ctrl+B shortcut) whether or not `open` is controlled — the cookie
   * write below always runs from here, not from a `useEffect` on `open`,
   * so an external state manager driving `open` still gets the persistence
   * for free by simply passing this through.
   */
  onOpenChange?: (open: boolean) => void;
}

export function SidebarProvider({
  defaultOpen,
  open: openProp,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);

  // Deterministic first render, cookie restored after mount. Reading
  // `document.cookie` in the state initializer instead would make the
  // first client render disagree with the server's (which has no cookie
  // to read and always produced the expanded default) — a hydration
  // mismatch on the one attribute the whole layout keys off,
  // `data-state`. Restoring in an effect keeps render pure and pays for
  // it with one frame of expanded sidebar before a persisted collapsed
  // state applies. An app that owns a server render and wants that frame
  // back reads the cookie there and hands the answer down as
  // `defaultOpen` — upstream's own model, and the opt-out this prop
  // already documents.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? true);
  const open = openProp ?? uncontrolledOpen;

  useEffect(() => {
    if (defaultOpen !== undefined) {
      return;
    }
    // Reading a browser-owned store that has no render-time equivalent is
    // the "subscribe to an external system" case effects exist for; the
    // lint rule's static heuristic can't tell it apart from derived state
    // (same call, same reasoning, as carousel.tsx's embla snapshot).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUncontrolledOpen(readOpenCookie(true));
  }, [defaultOpen]);

  const setOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      const next = typeof value === 'function' ? value(open) : value;
      onOpenChange?.(next);
      setUncontrolledOpen(next);
      writeOpenCookie(next);
    },
    [open, onOpenChange],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((value) => !value);
    } else {
      setOpen((value) => !value);
    }
  }, [isMobile, setOpen]);

  // Cmd/Ctrl+B toggles the sidebar from anywhere in the document —
  // upstream's own shortcut, kept at the same key.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  const state: SidebarContextValue['state'] = open ? 'expanded' : 'collapsed';

  const contextValue = useMemo<SidebarContextValue>(
    () => ({ state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar }),
    [state, open, setOpen, openMobile, isMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      {/*
       * delayDuration={0} (upstream's own value) is what makes the icon
       * rail usable: collapsed to 48px the label IS the tooltip, so the
       * default hover delay would leave a nav with no readable names for
       * as long as it lasts. Nesting inside a consumer's own
       * TooltipProvider is fine — Base UI's Provider is scoped, so this
       * only retimes tooltips belonging to this sidebar.
       */}
      <TooltipProvider delay={0}>
        <div
          style={
            {
              '--sidebar-width': SIDEBAR_WIDTH,
              '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
              ...style,
            } as CSSProperties
          }
          className={cx(styles.wrapper, className)}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

export interface SidebarProps extends Omit<ComponentProps<'div'>, 'className'> {
  className?: string;
  /** Which edge the sidebar is anchored to. @default 'left' */
  side?: 'left' | 'right';
  /**
   * `sidebar` sits flush against the edge; `floating` and `inset` add a
   * margin so it (and, for `inset`, the page content in `SidebarInset`)
   * read as a raised card instead. @default 'sidebar'
   */
  variant?: 'sidebar' | 'floating' | 'inset';
  /**
   * How the sidebar behaves when collapsed: `offcanvas` slides fully out
   * of view, `icon` shrinks to an icon-only rail, `none` disables
   * collapsing (and the mobile Sheet behavior) entirely — a fixed-width
   * panel at every viewport. @default 'offcanvas'
   */
  collapsible?: 'offcanvas' | 'icon' | 'none';
}

export function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  className,
  children,
  ...props
}: SidebarProps) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === 'none') {
    return (
      <div className={cx(styles.none, className)} {...props}>
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side={side}
          showCloseButton={false}
          className={cx(styles.mobileContent, className)}
          style={{ '--sidebar-width': SIDEBAR_WIDTH_MOBILE } as CSSProperties}
          {...props}
        >
          {/*
           * Required by SheetContent's underlying Dialog (an accessible
           * name is not optional there) but redundant for a sighted user —
           * "Sidebar" is the whole panel's own identity, not new
           * information. Visually hidden the same way CommandDialog hides
           * its own title/description (see command.tsx).
           */}
          <SheetHeader className={styles.srOnly}>
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className={styles.mobileInner}>{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className={styles.root}
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-variant={variant}
      data-side={side}
    >
      <div className={styles.gap} />
      {/*
       * No cva here despite `variant` being a real prop: every visual
       * difference between sidebar/floating/inset is a `[data-variant='x']`
       * attribute selector in sidebar.module.css (the "descendant/attribute
       * selectors keyed off data-state/data-collapsible" translation of
       * upstream's group-data variants), not a swapped class — a cva call
       * whose every branch adds the same class would be dead ceremony.
       */}
      <div data-side={side} className={cx(styles.container, className)} {...props}>
        <div className={styles.inner}>{children}</div>
      </div>
    </div>
  );
}

export interface SidebarTriggerProps extends Omit<ButtonProps, 'icon' | 'children'> {
  /** Accessible name for the icon-only button. @default 'Toggle Sidebar' */
  label?: string;
}

export function SidebarTrigger({ className, onClick, label = 'Toggle Sidebar', ...props }: SidebarTriggerProps) {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      icon={<PanelLeftIcon className={styles.triggerIcon} />}
      aria-label={label}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    />
  );
}

export type SidebarRailProps = Omit<ComponentProps<'button'>, 'children'>;

/**
 * An invisible, wide hit-target hugging the sidebar's collapsed edge —
 * `SidebarTrigger`'s alternative for a resize-handle-shaped affordance.
 * Not in the tab order (`tabIndex={-1}`): a keyboard user already has
 * `SidebarTrigger` and the Cmd/Ctrl+B shortcut for the same action, and a
 * near-invisible full-height button in the tab order would be a confusing
 * stop with no visible focus target.
 */
export function SidebarRail({ className, onClick, ...props }: SidebarRailProps) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      aria-label="Toggle Sidebar"
      title="Toggle Sidebar"
      tabIndex={-1}
      className={cx(styles.rail, className)}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
    />
  );
}

export type SidebarInsetProps = ComponentProps<'main'>;

export function SidebarInset({ className, ...props }: SidebarInsetProps) {
  return <main className={cx(styles.inset, className)} {...props} />;
}

export type SidebarInputProps = InputProps;

export function SidebarInput({ className, ...props }: SidebarInputProps) {
  return <Input className={cx(styles.input, className)} {...props} />;
}

export type SidebarHeaderProps = ComponentProps<'div'>;

export function SidebarHeader({ className, ...props }: SidebarHeaderProps) {
  return <div className={cx(styles.header, className)} {...props} />;
}

export type SidebarFooterProps = ComponentProps<'div'>;

export function SidebarFooter({ className, ...props }: SidebarFooterProps) {
  return <div className={cx(styles.footer, className)} {...props} />;
}

export type SidebarSeparatorProps = SeparatorProps;

export function SidebarSeparator({ className, ...props }: SidebarSeparatorProps) {
  return <Separator className={cx(styles.separator, className)} {...props} />;
}

export type SidebarContentProps = ComponentProps<'div'>;

export function SidebarContent({ className, ...props }: SidebarContentProps) {
  return <div className={cx(styles.content, className)} {...props} />;
}

export type SidebarGroupProps = ComponentProps<'div'>;

export function SidebarGroup({ className, ...props }: SidebarGroupProps) {
  return <div className={cx(styles.group, className)} {...props} />;
}

export type SidebarGroupLabelProps = useRender.ComponentProps<'div'>;

/** Polymorphic via `render` (e.g. `render={<label htmlFor="..." />}`) — same
 * `useRender`/`mergeProps` idiom as Badge (see badge.tsx). */
export function SidebarGroupLabel({ className, render, ...props }: SidebarGroupLabelProps) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({ className: cx(styles.groupLabel, className) }, props),
  });
}

export type SidebarGroupActionProps = useRender.ComponentProps<'button'>;

export function SidebarGroupAction({ className, render, ...props }: SidebarGroupActionProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>({ className: cx(styles.groupAction, className) }, props),
  });
}

export type SidebarGroupContentProps = ComponentProps<'div'>;

export function SidebarGroupContent({ className, ...props }: SidebarGroupContentProps) {
  return <div className={cx(styles.groupContent, className)} {...props} />;
}

export type SidebarMenuProps = ComponentProps<'ul'>;

export function SidebarMenu({ className, ...props }: SidebarMenuProps) {
  return <ul className={cx(styles.menu, className)} {...props} />;
}

export type SidebarMenuItemProps = ComponentProps<'li'>;

export function SidebarMenuItem({ className, ...props }: SidebarMenuItemProps) {
  return <li className={cx(styles.menuItem, className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(styles.menuButton, {
  variants: {
    variant: {
      default: styles.variantDefault,
      outline: styles.variantOutline,
    },
    size: {
      default: styles.sizeDefault,
      sm: styles.sizeSm,
      lg: styles.sizeLg,
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

/** A string renders as the tooltip's whole content; an object is forwarded
 * to `TooltipContent` as-is (so `side`/`align`/etc. can be overridden). */
export type SidebarMenuButtonTooltip = string | TooltipContentProps;

export interface SidebarMenuButtonProps
  extends useRender.ComponentProps<'button'>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  /** Marks this as the current nav item — accent fill plus `data-active`. @default false */
  isActive?: boolean;
  /**
   * Shows a `Tooltip` with this content — but ONLY while the sidebar is
   * desktop-collapsed to its icon rail (`state === 'collapsed'` and not
   * mobile); expanded or on mobile, the label is already visible next to
   * the icon, so no tooltip is mounted at all. A stricter reproduction of
   * upstream's own intent than its literal mechanism: upstream always
   * mounts `TooltipContent` and toggles a `hidden` attribute on it, which
   * only suppresses paint if something declares `[hidden] { display: none
   * }` for that popup — this kit's own tooltip.module.css (an existing
   * component this port must not edit) declares no such rule, so `hidden`
   * alone would not actually hide it here. Conditionally mounting the
   * `Tooltip` wrapper achieves the same visible behavior without that gap.
   */
  tooltip?: SidebarMenuButtonTooltip;
}

export function SidebarMenuButton({
  render,
  isActive = false,
  variant,
  size,
  tooltip,
  className,
  ...props
}: SidebarMenuButtonProps) {
  const { isMobile, state: sidebarState } = useSidebar();
  const showTooltip = tooltip != null && sidebarState === 'collapsed' && !isMobile;

  const button = useRender({
    defaultTagName: 'button',
    render: showTooltip ? <TooltipTrigger render={render} /> : render,
    // `state`/`stateAttributesMapping` (not a plain `data-active` prop,
    // which mergeProps's HTML-attribute typing has no index signature for)
    // is Base UI's own mechanism for reflecting a boolean as a bare
    // `data-active` attribute (see getStateAttributesProps: `true` becomes
    // `''`, `false` is omitted entirely) — same utility item.tsx uses, just
    // NOT suppressed here: unlike Item's variant/size (fully expressed by
    // the CVA class already), `data-active` is the actual mechanism
    // sidebar.module.css's `.menuButton[data-active]` selector reads.
    state: { active: isActive },
    props: mergeProps<'button'>(
      { className: sidebarMenuButtonVariants({ variant, size, className }) },
      props,
    ),
  });

  if (!showTooltip) {
    return button;
  }

  const content: TooltipContentProps = typeof tooltip === 'string' ? { children: tooltip } : tooltip;

  return (
    <Tooltip>
      {button}
      <TooltipContent side="right" align="center" {...content} />
    </Tooltip>
  );
}

export { sidebarMenuButtonVariants };

export interface SidebarMenuActionProps extends useRender.ComponentProps<'button'> {
  /** Only paint on hover/focus-within of the parent `SidebarMenuItem` (or
   * while `aria-expanded`) instead of always-visible. @default false */
  showOnHover?: boolean;
}

export function SidebarMenuAction({ className, render, showOnHover = false, ...props }: SidebarMenuActionProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      { className: cx(styles.menuAction, showOnHover && styles.menuActionShowOnHover, className) },
      props,
    ),
  });
}

export type SidebarMenuBadgeProps = ComponentProps<'div'>;

export function SidebarMenuBadge({ className, ...props }: SidebarMenuBadgeProps) {
  return <div className={cx(styles.menuBadge, className)} {...props} />;
}

export interface SidebarMenuSkeletonProps extends ComponentProps<'div'> {
  /** Renders a leading icon-shaped placeholder alongside the text one. @default false */
  showIcon?: boolean;
}

// Spreads a string over the 50-89% width band the skeleton rows vary
// across. FNV-1a: a few lines, no dependency, and well-enough distributed
// that neighbouring `useId` values (which differ by one character) land on
// visibly different widths instead of a near-repeat.
function widthFromKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return 50 + (Math.abs(hash) % 40);
}

export function SidebarMenuSkeleton({ className, showIcon = false, style, ...props }: SidebarMenuSkeletonProps) {
  // Upstream rolls this width with `Math.random()` in a lazy state
  // initializer. That varies the rows (the point — a column of identical
  // bars reads as one repeated tile, not as loading content) but renders
  // a different number on the server than on the client, so the width
  // lands in the hydration diff. `useId` is the deterministic source of
  // the same per-row variety: React guarantees the same value for the
  // same position in the tree on both sides of hydration, and it differs
  // between sibling rows, which is all the width needs from it.
  const width = `${widthFromKey(useId())}%`;
  return (
    <div className={cx(styles.menuSkeleton, className)} style={style} {...props}>
      {showIcon && <Skeleton className={styles.menuSkeletonIcon} />}
      <Skeleton
        className={styles.menuSkeletonText}
        style={{ '--skeleton-width': width } as CSSProperties}
      />
    </div>
  );
}

export type SidebarMenuSubProps = ComponentProps<'ul'>;

export function SidebarMenuSub({ className, ...props }: SidebarMenuSubProps) {
  return <ul className={cx(styles.menuSub, className)} {...props} />;
}

export type SidebarMenuSubItemProps = ComponentProps<'li'>;

export function SidebarMenuSubItem({ className, ...props }: SidebarMenuSubItemProps) {
  return <li className={cx(styles.menuSubItem, className)} {...props} />;
}

const sidebarMenuSubButtonVariants = cva(styles.menuSubButton, {
  variants: {
    size: {
      sm: styles.subSizeSm,
      md: styles.subSizeMd,
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export interface SidebarMenuSubButtonProps
  extends useRender.ComponentProps<'a'>,
    VariantProps<typeof sidebarMenuSubButtonVariants> {
  isActive?: boolean;
}

export function SidebarMenuSubButton({
  render,
  size,
  isActive = false,
  className,
  ...props
}: SidebarMenuSubButtonProps) {
  return useRender({
    defaultTagName: 'a',
    render,
    // See SidebarMenuButton's identical comment on this same mechanism.
    state: { active: isActive },
    props: mergeProps<'a'>(
      { className: sidebarMenuSubButtonVariants({ size, className }) },
      props,
    ),
  });
}
