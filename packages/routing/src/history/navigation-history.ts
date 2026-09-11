import type { HistorySubscriber, Location, NavigationHistory, ReleaseFunction } from '../types/index.js';
import type { HistoryAdapter } from './adapter.js';
import { FanOutDispatcher } from './fanout-dispatch.js';
import { readInitialPosition, readPosition, writePosition } from './position.js';

/**
 * Constructs one `NavigationHistory` instance over `adapter`. Registers the
 * adapter's own pop subscription immediately, at construction — FEATURE §3,
 * Realm-Global Singleton Resolution, step 2.1: "not deferred until a first
 * caller subscribes ... so `location` is live from the instant this
 * instance exists, for a reader who never subscribes at all."
 *
 * This is the constructor `resolveNavigationHistory` (./singleton.ts) calls
 * at most once per realm and per contract version; a caller that needs its
 * own private instance (a test, most commonly) can call this directly.
 *
 * The adapter's own pop subscription registered below is never released —
 * intentional: a realm-global singleton lives for the lifetime of the realm
 * itself, so there is no teardown moment to release it at. A caller that
 * constructs its own private instance for a scope narrower than the whole
 * realm (a test, again the common case) is responsible for discarding that
 * instance itself; this function has no `dispose` because the one caller it
 * is actually designed for (`resolveNavigationHistory`) never needs one.
 */
// @cpt-flow:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1
// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2
// @cpt-dod:cpt-frontx-dod-routing-navigation-substrate-imperative-navigation:p1
// This constructor is also where the shared-history DoD's own singleton and
// fan-out half is realized; the same DoD's URL grammar codec half is scoped
// at each of its own algorithms in src/grammar/*.ts.
// @cpt-dod:cpt-frontx-dod-routing-navigation-substrate-shared-history:p1
export function createNavigationHistory(adapter: HistoryAdapter): NavigationHistory {
  const dispatcher = new FanOutDispatcher();

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-cold-mount-default
  // Cold mount or foreign entry (FEATURE §3, Position Tracking, step 1):
  // this substrate never recorded a position for the current entry, so it
  // starts at `0` and is recorded for real only on this instance's own next
  // `push`/`replace` below — nothing is written back here, at construction.
  let position = readInitialPosition(adapter);
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-cold-mount-default

  function currentLocation(): Location {
    return { ...adapter.getLocation(), position };
  }

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-construct-instance
  // Registered now, not lazily on first `subscribe` — see the doc comment
  // above and FEATURE §3, Fan-Out Subscription Dispatch, step 2.
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-underlying-fires
  adapter.onPop(() => {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-restore-on-external-navigation
    // FEATURE §3, Position Tracking, step 3: an externally observed
    // navigation (a real back/forward step, a third-party `go`, an
    // observed third-party addition) restores this substrate's own
    // position from whatever the browser's own per-entry state now holds
    // for the entry it landed on — never advanced or decremented by a
    // fixed delta the way a provider-local counter would, since this is
    // the one case a delta cannot be attributed reliably (F8's own root
    // cause). No recorded position on that entry (a foreign entry a real
    // back/forward step landed on, or a cold mount observed only now)
    // defaults to `0`, identically to construction above.
    position = readPosition(adapter.getState()) ?? 0;
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-restore-on-external-navigation
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-underlying-dispatch-round
    dispatcher.dispatch({ location: currentLocation(), kind: 'history' });
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-underlying-dispatch-round
  });
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-underlying-fires
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-construct-instance

  return {
    // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-branch-immediate
    get location() {
      return currentLocation();
    },
    // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-branch-immediate

    // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-branch-subscribe
    // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-subscribe
    subscribe(subscriber: HistorySubscriber): ReleaseFunction {
      // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-retain-unsubscribe
      // The release function returned here is exactly what the caller
      // retains for later teardown (flow step 2.2).
      return dispatcher.subscribe(subscriber);
      // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-retain-unsubscribe
    },
    // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-subscribe
    // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-branch-subscribe

    // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-immediate-call
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-own-navigation-call
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-on-own-write
    push(path: string): void {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-advance-on-push
      // FEATURE §3, Position Tracking, step 2: advances one past the
      // previous entry's own position — this is a brand-new entry, so its
      // own state starts fresh (`undefined` base) rather than inheriting
      // whatever the *previous* entry's own state carried, exactly as a
      // real `pushState` call never carries a prior entry's state forward
      // on its own.
      position += 1;
      adapter.pushState(path, writePosition(undefined, position));
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-advance-on-push
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
      // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-return
      // Control returns to the caller once this statement completes; the
      // dispatch it performs already reached every subscribed listener
      // across the realm (flow step 4).
      dispatcher.dispatch({ location: currentLocation(), kind: 'push' });
      // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-return
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
    },

    replace(path: string): void {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-preserve-on-replace
      // FEATURE §3, Position Tracking, step 2: `replace` overwrites the
      // *current* entry, so its own position stays exactly what it already
      // was — merged with whatever raw state the host already carries on
      // this same entry (`adapter.getState()`, not `undefined`, unlike
      // `push` above), so a value some other code had already stored on
      // this one entry survives this substrate's own write.
      adapter.replaceState(path, writePosition(adapter.getState(), position));
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-preserve-on-replace
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
      dispatcher.dispatch({ location: currentLocation(), kind: 'replace' });
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
    },
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-position-tracking:p2:inst-on-own-write
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-own-navigation-call

    // `go` is deliberately not dispatched here — it is observed only through
    // the `onPop` registration above, asynchronously, once the adapter's own
    // move actually lands (§1.5, Contract commitment; §3, step 3 rationale).
    // Its own destination position is restored there too, from the
    // browser's own persisted per-entry state, not adjusted by `delta` here.
    go(delta: number): void {
      adapter.go(delta);
    },
    // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-immediate-call
  };
}
