// Load-bearing: ToastList calls useToastManager directly, so this can't be
// dropped. Coupled to CLIENT_COMPONENTS in scripts/verify-consumer.sh —
// keep both in sync if this ever changes.
'use client';

import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { cx } from 'class-variance-authority';
import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';

import { Button } from '../button/button';
import styles from './toast.module.css';

/* One icon per toast `type`; an unset/unrecognized type renders no icon,
 * matching the base-vega source's <ToastIcon>. */
function ToastTypeIcon({ type }: { type?: string }) {
  switch (type) {
    case 'success':
      return <CircleCheckIcon className={styles.icon} />;
    case 'info':
      return <InfoIcon className={styles.icon} />;
    case 'warning':
      return <TriangleAlertIcon className={styles.icon} />;
    case 'error':
      return <OctagonXIcon className={cx(styles.icon, styles.iconDestructive)} />;
    case 'loading':
      return <LoaderCircleIcon className={cx(styles.icon, styles.iconSpin)} />;
    default:
      return null;
  }
}

/*
 * One rendered toast card. Not exported — a `Toast` type prop drives the
 * icon and (via CSS `data-type`) any future type-specific styling, but the
 * kit's usage model is imperative (`toast.add({...})`, see below), not
 * composing a `<Toast>` per notification the way `Dialog`/`DropdownMenu`
 * are composed. `ToastPrimitive.Title`/`Description`/`Action` all read
 * their content from the `toast` object via context and render nothing if
 * it's unset — no children needed here.
 */
function ToastCard({
  toast: item,
  closeLabel,
}: {
  toast: ToastPrimitive.Root.ToastObject;
  closeLabel: string;
}) {
  return (
    <ToastPrimitive.Root toast={item} className={styles.toast}>
      <ToastPrimitive.Content className={styles.content}>
        <ToastTypeIcon type={item.type} />
        <div className={styles.body}>
          <ToastPrimitive.Title className={styles.title} />
          <ToastPrimitive.Description className={styles.description} />
        </div>
        <ToastPrimitive.Action className={styles.action} render={<Button variant="outline" size="sm" />} />
        <ToastPrimitive.Close
          aria-label={closeLabel}
          className={styles.close}
          render={<Button variant="ghost" icon={<XIcon className={styles.svgIcon} />} />}
        />
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  );
}

function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((item) => <ToastCard key={item.id} toast={item} closeLabel={closeLabel} />);
}

/**
 * Shared imperative toast manager: call `toast.add({ title, description })`
 * (or `.close()`, `.update()`, `.promise()`) from anywhere in the app —
 * no hook, and no ancestor `Toaster`/`ToastProvider`, required to fire
 * one. `Toaster` renders whatever this manager holds by default.
 *
 * A module-scope singleton is a deliberate choice, not the only shape Base
 * UI's Toast offers (see `createToastManager`/`useToastManager` below): it
 * keeps sonner's own call-anywhere `toast()` ergonomics (see
 * design-notes.md for why Base UI's Toast replaced sonner) without needing
 * a component to be inside a Provider's subtree or accept a manager prop.
 *
 * Three failure modes worth knowing about a singleton, all silent: it's
 * SSR-safe (the object above holds no toast state itself, only a listener
 * registered by whichever `Toaster` mounts), but `toast.add(...)` called
 * before any `Toaster` has mounted, or from code that resolved a
 * different copy of this module (e.g. a mixed CJS/ESM require graph),
 * drops the toast with no error — there is no queue and nothing to catch.
 * And the inverse: TWO mounted `Toaster`s on this shared manager render
 * every toast twice, once per viewport (plausible in a shell + MFE setup
 * where each fragment mounts its own) — a second viewport should get its
 * own `createToastManager()` instead.
 */
export const toast = ToastPrimitive.createToastManager();

/**
 * Reads the live toast list and the `add`/`close`/`update`/`promise`
 * bound to whichever manager the nearest `Toaster` ancestor was given
 * (the shared `toast` singleton unless overridden) — from a component
 * nested under `Toaster`, this is how you react to the toast list itself
 * (e.g. an unread-count badge) or call that same manager without
 * importing it directly. Not a way to render toast cards in place of
 * `Toaster`: the kit exports no Root/Content/Title/etc. parts to build
 * one with.
 *
 * Whether a consumer's own `@base-ui/react` shares this context depends
 * on whether the installer resolved one copy or two. `@base-ui/react` is
 * a regular dependency of this package and stays external in the build
 * (nothing is bundled but the CSS class maps), so a consumer whose own
 * range is satisfied by the same version dedupes to a single copy and
 * shares context; a consumer pinned to an incompatible version gets a
 * nested second copy, and then Base UI's Toast context — like every
 * React context — does not cross between them.
 */
export const useToastManager = ToastPrimitive.useToastManager;

/**
 * Creates an isolated toast manager, independent of the shared `toast`
 * singleton — e.g. to scope a second, differently-positioned `Toaster` to
 * one part of the app instead of sharing the app-wide instance. Pass the
 * result as `toastManager` to `Toaster`.
 */
export const createToastManager = ToastPrimitive.createToastManager;

export interface ToasterProps extends ToastPrimitive.Provider.Props {
  /**
   * Where to portal the toast viewport. Defaults to <body>. Pass a themed
   * container when the theme is scoped to a subtree (data-theme on a
   * container that isn't at document root) so toasts inherit its tokens
   * and font.
   */
  container?: ToastPrimitive.Portal.Props['container'];
  /**
   * Accessible name for each toast's close (X) button — one of the two
   * strings a non-English app needs to replace (`label` below is the
   * other). @default 'Close toast'
   */
  closeLabel?: string;
  /**
   * Accessible name for the toast region landmark. Base UI puts
   * `role="region" aria-label="Notifications"` on the viewport; without
   * this prop a screen-reader user hears that English landmark name no
   * matter what language the app is in. @default 'Notifications'
   */
  label?: string;
}

/**
 * Mount once, wrapping the app (or at least any subtree that calls
 * `useToastManager`) — pass the app as `children`. The toast list itself
 * portals to `<body>` (or `container`) regardless of where `Toaster` sits
 * in the tree, so wrapping vs. mounting as a leaf near the root both work
 * for the common case of firing toasts via the `toast` manager above.
 *
 * Defaults `toastManager` to this module's shared singleton — see `toast`.
 */
export function Toaster({
  container,
  children,
  closeLabel = 'Close toast',
  // Defaulted here rather than left to Base UI's own 'Notifications', so an
  // explicit undefined can never wipe the landmark name in the merge.
  label = 'Notifications',
  toastManager = toast,
  ...props
}: ToasterProps) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} {...props}>
      {children}
      <ToastPrimitive.Portal container={container}>
        <ToastPrimitive.Viewport aria-label={label} className={styles.viewport}>
          <ToastList closeLabel={closeLabel} />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}
