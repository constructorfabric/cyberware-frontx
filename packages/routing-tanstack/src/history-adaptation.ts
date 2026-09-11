// History Adaptation To The RouterHistory Contract
// `cpt-frontx-algo-routing-engine-provider-history-adaptation`.
//
// Adapts the navigation substrate's shared `NavigationHistory` — together
// with a `VirtualLocationSource` that knows how to read and write one
// occupant's own virtual location — into an object satisfying
// `@tanstack/history`'s own `RouterHistory` contract.
//
// `VirtualLocationSource` is this file's own seam, not a FEATURE-defined
// shape: the algorithm's own step 1 delegates "when running standalone" to
// a *different* algorithm
// (`cpt-frontx-algo-routing-engine-provider-standalone-deployment`) that
// projects a virtual location from the page's own address rather than from
// one entry — the composed and standalone cases share every derivation
// this file performs (steps 2 onward) and differ only in where a virtual
// location is read from and written to. This seam is what lets both
// sources reuse this file's own derivation without duplicating it;
// `./composed-history-source.js` and `./standalone-history-source.js` are
// the two concrete sources this package implements.
import type { HistoryVerb, NavigationHistory, Param } from '@gears-frontx/routing';
import { projectParamsToVirtualLocation, splitHref } from './virtual-location.js';

// The concrete engine's own `RouterHistory` contract, `@tanstack/history`,
// re-exports its type (not its own package name) through
// `@tanstack/react-router` — this package's own single ecosystem-external
// binding (DESIGN §1.3, §3.5). `SubscriberArgs` and `NavigationBlocker` are
// *not* re-exported anywhere reachable, so they are derived structurally
// from `RouterHistory`'s own field types below, rather than imported by
// name.
import type { RouterHistory } from '@tanstack/react-router';

type RouterHistoryLocation = RouterHistory['location'];
type RouterHistoryState = RouterHistoryLocation['state'];
type RouterSubscribeCallback = Parameters<RouterHistory['subscribe']>[0];
type RouterSubscriberArgs = Parameters<RouterSubscribeCallback>[0];
type RouterNavigationBlocker = Parameters<RouterHistory['block']>[0];
type RouterSubscriberAction = RouterSubscriberArgs['action'];
type RouterNavigateOptions = Parameters<RouterHistory['push']>[2];
type RouterBlockerFn = RouterNavigationBlocker['blockerFn'];
type RouterBlockerFnArgs = Parameters<RouterBlockerFn>[0];
type RouterBlockerAction = RouterBlockerFnArgs['action'];

/**
 * What a `VirtualLocationSource` supplies `adaptVirtualLocationHistory`
 * (this file) so it never has to know whether it is adapting a composed
 * occupant's own entry or a standalone deployment's own page address.
 */
export interface VirtualLocationSource {
  /** This occupant's own current parameter list, or `undefined` when its
   * own entry is absent from the URL right now (FEATURE §3, step 7) — a
   * state a standalone source never reports, since there is no entry to be
   * absent. */
  readParams(): readonly Param[] | undefined;
  /**
   * Writes a new virtual location back through this source's own single
   * write path — one call to the core's URL back-projection helper for the
   * composed source, the page's own `history.pushState`/`replaceState` for
   * the standalone one.
   *
   * `hash`, when given, is a caller-supplied fragment from `navigate`/
   * `Link`/`createHref` — it is applied to the *page's own* hash, never to
   * this occupant's own entry (a virtual location carries no hash of its
   * own; DESIGN §3.1), identically in both modes (FEATURE (engine-provider)
   * §3, "a hash passed to a navigation is applied to the page hash and
   * never enters an entry"). `undefined` means no hash was given at all —
   * the page's own current hash is preserved verbatim, the existing
   * behaviour; an explicit empty string is a caller asking to clear it.
   */
  write(pathname: string, search: string, verb: HistoryVerb, hash?: string): void;
  /** Composes the full, shareable URL a target virtual location resolves
   * to, for `RouterHistory#createHref` — `hash` follows the identical
   * given-versus-absent convention `write` documents above. */
  createHref(pathname: string, search: string, hash?: string): string;
}

/**
 * @internal Not part of the `RouterHistory` contract — a private channel
 * between this module and `./router-creation.js` only, keyed by object
 * identity rather than by an extra property on the returned `RouterHistory`
 * object itself (which would leak into every consumer's own enumeration of
 * it). Records, for every history this module has itself constructed, the
 * function that (re)establishes its single internal registration against
 * the shared `NavigationHistory` — the same registration `destroy()`
 * releases. `EngineProvider`'s own teardown effect (`router-creation.tsx`)
 * calls `attachAdaptedHistory` in its setup and `destroy()` in its
 * cleanup, making the two true inverses of each other: React's StrictMode
 * double-invoking that effect (setup, cleanup, setup) is then exactly as
 * safe as invoking it once, since the second setup re-does precisely what
 * the cleanup undid, rather than finding nothing left to redo (the N1
 * regression this pair fixes — see `router-creation.tsx`).
 */
const attachByHistory = new WeakMap<RouterHistory, () => void>();

/**
 * Re-establishes the internal `NavigationHistory` registration for `history`
 * if `destroy()` had released it (a no-op when it is still active, or when
 * `history` was not built by `adaptVirtualLocationHistory` at all — a
 * consumer-supplied test double, say, which owns its own lifecycle).
 */
export function attachAdaptedHistory(history: RouterHistory): void {
  attachByHistory.get(history)?.();
}

/**
 * @internal Default channel for an error this adapter catches rather than
 * lets propagate as a genuine unhandled promise rejection (F6) — a
 * navigation blocker that throws or rejects, or a subscriber that throws.
 * `@tanstack/history`'s own `RouterHistory` contract has no error-reporting
 * member of its own to route through, so this package adds the smallest one
 * that still makes the failure observable instead of silently swallowed: a
 * consuming test passes its own spy through `adaptVirtualLocationHistory`'s
 * `options.reportError` in place of this default.
 */
function defaultReportError(error: unknown): void {
  console.error('[@gears-frontx/routing-tanstack] navigation blocker or subscriber failed:', error);
}

/**
 * Options `adaptVirtualLocationHistory` accepts, and every entry point that
 * builds history through it forwards straight through unchanged (F6,
 * review round 16-re): `adaptComposedHistory`, `adaptStandaloneHistory`,
 * `adaptProviderHistory`. `reportError` in particular gives a consumer at
 * any of those entry points the same error-reporting channel this file's
 * own `dispatchToSubscribers`/blocker handling already routes through —
 * `defaultReportError` above otherwise.
 */
export interface AdaptHistoryOptions {
  readonly reportError?: (error: unknown) => void;
}

/**
 * Fans `args` out to every currently-registered subscriber, isolating each
 * one's own error the way the core's own `FanOutDispatcher` isolates a
 * history subscriber's error (F5): snapshotting the registry before
 * iterating (so a subscriber that subscribes or unsubscribes mid-round
 * cannot mutate the round already under way) and wrapping each individual
 * invocation in its own `try`/`catch`, so a throwing subscriber's own
 * failure is reported through `reportError` rather than stopping delivery
 * to the subscribers after it in the same round — `subscribers.forEach`
 * alone has neither property.
 */
function dispatchToSubscribers(
  subscribers: RouterHistory['subscribers'],
  args: RouterSubscriberArgs,
  reportError: (error: unknown) => void,
): void {
  for (const subscriber of Array.from(subscribers)) {
    if (!subscribers.has(subscriber)) {
      // Unsubscribed by an earlier subscriber in this same round — skip
      // without invoking, mirroring the core dispatcher's own liveness
      // check.
      continue;
    }
    try {
      subscriber(args);
    } catch (error) {
      reportError(error);
    }
  }
}

function buildHistoryLocation(parts: { pathname: string; search: string }, position: number): RouterHistoryLocation {
  // `__TSR_index` mirrors what the engine's own real browser history keeps
  // in `window.history.state` — `position` here is the navigation
  // substrate's own `Location.position` (F8/D3, review round 16-re:
  // `cpt-frontx-algo-routing-navigation-substrate-position-tracking`), not
  // a counter this adapter keeps of its own: the substrate is the one
  // party that sits on both sides of every write *and* every externally
  // observed traversal, so it is the only party that can keep this number
  // correct across a real back/forward step, a third-party `go`, or a
  // second router sharing the identical shared history.
  const state = { __TSR_index: position } as RouterHistoryState;
  return {
    href: `${parts.pathname}${parts.search}`,
    pathname: parts.pathname,
    search: parts.search,
    // The virtual location carries no hash of its own (DESIGN §3.1); the
    // page's own hash is the location-preserving-helper's own concern.
    hash: '',
    state,
  };
}

/** `NavigationHistory`'s own three-way `kind` translated into the
 * `SubscriberArgs.action` shape `RouterHistory#subscribe`'s callback
 * expects — a direct rename, never an invented finer split: `'history'`
 * covers a back/forward step, a third-party `go`, and an observed
 * third-party addition alike (FEATURE §1.5, "Navigation kind"), so `'GO'`
 * with no real index is the closest of TanStack's own five action names
 * that does not fabricate a direction the substrate's own notification
 * never states (FEATURE §3, step 6: "action is never invented or
 * independently inferred by this adapter"). */
function toSubscriberAction(kind: 'push' | 'replace' | 'history'): RouterSubscriberAction {
  switch (kind) {
    case 'push':
      return { type: 'PUSH' } as RouterSubscriberAction;
    case 'replace':
      return { type: 'REPLACE' } as RouterSubscriberAction;
    case 'history':
      return { type: 'GO', index: 0 } as RouterSubscriberAction;
  }
}

/**
 * Adapts `navigationHistory` and `source` into a `RouterHistory` object.
 *
 * FEATURE §3, "History Adaptation To The RouterHistory Contract", steps
 * 2-8 (step 1 is `source`'s own concern — see this file's module comment).
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2
// This constructor, together with `./router-creation.tsx`'s own
// `createProviderRouter`/`EngineProvider`, is where the "adaptation and
// creation" DoD is realized in full — the URL-grammar-consuming half of
// history adaptation (entry resolution, write-back, `createHref`) lives in
// `./composed-history-source.js`, which carries this same DoD marker.
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-adaptation-and-creation:p1
export function adaptVirtualLocationHistory(
  navigationHistory: NavigationHistory,
  source: VirtualLocationSource,
  options: AdaptHistoryOptions = {},
): RouterHistory {
  const reportError = options.reportError ?? defaultReportError;

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members
  let currentLocation = buildHistoryLocation(
    projectParamsToVirtualLocation(source.readParams() ?? []),
    navigationHistory.location.position,
  );
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-missing-members
  const subscribers: RouterHistory['subscribers'] = new Set();
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-missing-members

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-block-degraded
  // A recognized, degraded adaptation (FEATURE §3, step 5): a blocker
  // registered here is gated by this adapter's own `push`/`replace` below
  // (the navigation a call issued through this same constructed router's
  // own `RouterHistory` object always routes through), reproducing
  // `@tanstack/history`'s own `createHistory().push/replace` gate — never a
  // back/forward step, another unit's `go`, or a navigation another unit
  // performs directly through the shared `NavigationHistory`, which commits
  // regardless of any block state held here.
  let blockers: readonly RouterNavigationBlocker[] = [];
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-block-degraded

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-adapt-subscribe
  // One internal registration against the shared history for the lifetime
  // of this constructed `RouterHistory` (DESIGN §3.6, port role summary:
  // "one subscribe per router with release on unmount") — fanning out to
  // every external subscriber this object's own `subscribers` set collects,
  // rather than one shared-history registration per external `subscribe`
  // call. Wrapped in `attachToNavigationHistory` (below), rather than
  // called inline, so the same registration this constructor performs
  // eagerly can also be re-performed later by `attachAdaptedHistory` — the
  // exact inverse of `destroy()` (N1: the object that constructs this
  // registration owns re-establishing it, not just tearing it down once).
  let unsubscribeFromNavigationHistory: (() => void) | undefined;
  function attachToNavigationHistory(): void {
    if (unsubscribeFromNavigationHistory !== undefined) {
      // Already registered — `destroy()` has not run since the last
      // attach, so there is nothing of this call's own to redo.
      return;
    }
    // A real gap (unlike the synchronous StrictMode setup/cleanup/setup
    // cycle) can span a substrate navigation this adapter was not
    // subscribed to observe: no notification arrived while
    // `unsubscribeFromNavigationHistory` was `undefined`, so
    // `currentLocation` may still hold whatever it projected before
    // `destroy()` ran. Re-reading `source.readParams()` here — mirroring
    // this constructor's own initial projection above — brings it back in
    // sync with the substrate before the new subscription's own first
    // notification (which may not arrive until a later navigation).
    const params = source.readParams();
    if (params !== undefined) {
      currentLocation = buildHistoryLocation(projectParamsToVirtualLocation(params), navigationHistory.location.position);
    }
    unsubscribeFromNavigationHistory = navigationHistory.subscribe((notification) => {
      // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-if-own-entry-absent
      const params = source.readParams();
      if (params === undefined) {
        // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-own-entry-absent-inert
        // The virtual location keeps its own last-projected value; no
        // subscriber of this round is invoked (FEATURE §3, step 7).
        return;
        // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-own-entry-absent-inert
      }
      // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-if-own-entry-absent
      // F8/D3 (review round 16-re): `notification.location.position` is the
      // substrate's own recorded position for whichever entry this round's
      // navigation landed on — read from the notification already in hand
      // rather than a second `navigationHistory.location` access, though
      // both report the identical value (§1.5, Contract commitment).
      currentLocation = buildHistoryLocation(projectParamsToVirtualLocation(params), notification.location.position);
      const args = { location: currentLocation, action: toSubscriberAction(notification.kind) } as RouterSubscriberArgs;
      dispatchToSubscribers(subscribers, args, reportError);
    });
  }
  attachToNavigationHistory();
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-adapt-subscribe

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members
  const write = (path: string, verb: HistoryVerb, hash?: string): void => {
    const { pathname, search } = splitHref(path);
    source.write(pathname, search, verb, hash);
    // `length`/`canGoBack` below no longer count this write themselves
    // (F8/D3, review round 16-re): `source.write`'s own push, when it
    // actually reaches the shared history, already advances the
    // substrate's own `Location.position` — N3's own "no write reached the
    // shared history, so nothing should count" concern is satisfied for
    // free, since a `source.write` this occupant's own entry is absent for
    // never calls `navigationHistory[verb]` at all
    // (`./composed-history-source.js`'s own A5 early return).
  };
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-block-degraded
  // Reproduces `@tanstack/history`'s own `tryNavigation` gate
  // (`node_modules/@tanstack/history/dist/esm/index.js`) ahead of `write`:
  // `navigateOpts.ignoreBlocker` skips the gate entirely; otherwise every
  // registered blocker is asked in turn, awaited even when its own
  // `blockerFn` returns synchronously (matching `tryNavigation`'s own
  // `await`), and the first truthy answer stops the write — no blocker
  // registered is the common case, and stays fully synchronous, since the
  // loop below never runs and this function returns before any `await`.
  //
  // F6: the engine's own `tryNavigation` awaits `blockerFn` with no
  // `try`/`catch` of its own, and its own callers (`push`/`replace`) invoke
  // it fire-and-forget — a rejecting or throwing `blockerFn` becomes a
  // genuine unhandled promise rejection there too. This adapter does not
  // mirror that part: a `catch` here treats a throwing/rejecting blocker as
  // blocking the navigation (the safest reading of "the blocker could not
  // decide") and reports the failure through `reportError` instead of
  // letting the rejection reach `push`/`replace`'s own discarded
  // `void tryNavigation(...)` unobserved.
  const tryNavigation = async (path: string, verb: HistoryVerb, navigateOpts?: RouterNavigateOptions): Promise<void> => {
    if (navigateOpts?.ignoreBlocker ?? false) {
      write(path, verb, splitHref(path).hash);
      return;
    }
    if (typeof document !== 'undefined' && blockers.length > 0) {
      const { hash, ...pathnameAndSearch } = splitHref(path);
      const nextLocation = buildHistoryLocation(pathnameAndSearch, navigationHistory.location.position);
      const action: RouterBlockerAction = verb === 'push' ? 'PUSH' : 'REPLACE';
      for (const blocker of blockers) {
        let shouldBlock: boolean;
        try {
          shouldBlock = await blocker.blockerFn({ currentLocation, nextLocation, action });
        } catch (error) {
          reportError(error);
          return;
        }
        if (shouldBlock) {
          return;
        }
      }
      write(path, verb, hash);
      return;
    }
    const { hash } = splitHref(path);
    write(path, verb, hash);
  };
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-block-degraded

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-return-adapted-history
  const history: RouterHistory = {
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members
    get location() {
      return currentLocation;
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-missing-members
    // F8/D3 (review round 16-re): derived from the navigation substrate's
    // own `Location.position`
    // (`cpt-frontx-algo-routing-navigation-substrate-position-tracking`),
    // never a counter this adapter keeps of its own — the substrate is the
    // one party correct across every write *and* every externally observed
    // traversal (a real back/forward step, a third-party `go`, a second
    // router sharing the identical shared history), which a provider-local
    // counter could only ever approximate.
    get length() {
      return navigationHistory.location.position + 1;
    },
    subscribers,
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-missing-members

    subscribe: (callback: RouterSubscribeCallback) => {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members
    push: (path: string, _state?: RouterHistoryState, navigateOpts?: RouterNavigateOptions) => {
      void tryNavigation(path, 'push', navigateOpts);
    },
    replace: (path: string, _state?: RouterHistoryState, navigateOpts?: RouterNavigateOptions) => {
      void tryNavigation(path, 'replace', navigateOpts);
    },
    // F8/D3 (review round 16-re): no optimistic local adjustment here
    // anymore — `go`/`back`/`forward` simply delegate to the shared
    // history and let its own asynchronous `popstate` observation
    // (`cpt-frontx-algo-routing-navigation-substrate-position-tracking`,
    // step 3) restore `Location.position` from the browser's own
    // persisted per-entry state once the move actually lands. A stale
    // `length`/`canGoBack` read in between the call and that
    // confirmation is the same brief window `NavigationHistory#go` itself
    // already has (§1.5, "observed asynchronously... never dispatched
    // directly"), not a new one this adapter introduces.
    go: (delta: number) => {
      navigationHistory.go(delta);
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-missing-members
    back: () => {
      navigationHistory.go(-1);
    },
    forward: () => {
      navigationHistory.go(1);
    },
    // F8/D3: `> 0`, no `|| canGoBackFallback()` — a fallback that read
    // `window.history.length > 1` reported `true` in almost every real tab
    // regardless of this occupant's own stack (the original F8 symptom);
    // `Location.position` is accurate from construction (cold mount reads
    // `0`, per the substrate's own Position Tracking), so no fallback is
    // needed at all.
    canGoBack: () => navigationHistory.location.position > 0,
    flush: () => {
      // No throttling queue to flush — every write this adapter performs
      // already lands synchronously, through the composed source's single
      // `backProjectEntries` call.
    },
    // @cpt-algo:cpt-frontx-algo-routing-engine-provider-teardown:p2
    // @cpt-dod:cpt-frontx-dod-routing-engine-provider-teardown:p1
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-when-unmount
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-invoke-unsubscribe
    destroy: () => {
      // Invoked when the microfrontend that owns this constructed router is
      // unmounted (FEATURE (engine-provider) §3, Teardown On Unmount, step
      // 1 — the `WHEN` itself is the consumer's own unmount mechanism
      // calling this member, never observed by this adapter on its own).
      // `unsubscribeFromNavigationHistory` is `NavigationHistory`'s own
      // `ReleaseFunction`, already documented idempotent — "calling it more
      // than once is a no-op after the first call"
      // (`cpt-frontx-feature-routing-navigation-substrate` §1.5). This
      // adapter additionally clears its own reference once released (N1):
      // that clearing is what lets `attachToNavigationHistory` tell a
      // torn-down registration apart from a still-active one, so a second
      // `destroy()` call stays a safe no-op, and a later `attachAdaptedHistory`
      // call genuinely re-registers rather than finding nothing to do.
      unsubscribeFromNavigationHistory?.();
      unsubscribeFromNavigationHistory = undefined;
      // @cpt-end:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-invoke-unsubscribe
      // @cpt-begin:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-return-teardown
      return;
      // @cpt-end:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-return-teardown
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-teardown:p2:inst-when-unmount
    notify: (action: RouterSubscriberAction) => {
      const args = { location: currentLocation, action } as RouterSubscriberArgs;
      dispatchToSubscribers(subscribers, args, reportError);
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-missing-members

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-create-href
    createHref: (href: string) => {
      const { pathname, search, hash } = splitHref(href);
      return source.createHref(pathname, search, hash);
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-create-href

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-block-degraded
    block: (blocker: RouterNavigationBlocker) => {
      blockers = [...blockers, blocker];
      return () => {
        blockers = blockers.filter((registered) => registered !== blocker);
      };
    },
    _getBlockers: () => [...blockers],
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-block-degraded
  };

  // Registered by identity, after `history` exists to key it by (N1) — see
  // `attachByHistory`'s own doc comment above.
  attachByHistory.set(history, attachToNavigationHistory);

  return history;
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-return-adapted-history
}
