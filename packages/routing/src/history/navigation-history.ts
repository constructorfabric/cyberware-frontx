import type { HistorySubscriber, NavigationHistory, ReleaseFunction } from '../types/index.js';
import type { HistoryAdapter } from './adapter.js';
import { FanOutDispatcher } from './fanout-dispatch.js';

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

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-construct-instance
  // Registered now, not lazily on first `subscribe` — see the doc comment
  // above and FEATURE §3, Fan-Out Subscription Dispatch, step 2.
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-underlying-fires
  adapter.onPop(() => {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-underlying-dispatch-round
    dispatcher.dispatch({ location: adapter.getLocation(), kind: 'history' });
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-underlying-dispatch-round
  });
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-underlying-fires
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-singleton-resolution:p2:inst-construct-instance

  return {
    // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-branch-immediate
    get location() {
      return adapter.getLocation();
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
    push(path: string): void {
      adapter.pushState(path);
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
      // @cpt-begin:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-return
      // Control returns to the caller once this statement completes; the
      // dispatch it performs already reached every subscribed listener
      // across the realm (flow step 4).
      dispatcher.dispatch({ location: adapter.getLocation(), kind: 'push' });
      // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-return
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
    },

    replace(path: string): void {
      adapter.replaceState(path);
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
      dispatcher.dispatch({ location: adapter.getLocation(), kind: 'replace' });
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-own-call-dispatch-round
    },
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-own-navigation-call

    // `go` is deliberately not dispatched here — it is observed only through
    // the `onPop` registration above, asynchronously, once the adapter's own
    // move actually lands (§1.5, Contract commitment; §3, step 3 rationale).
    go(delta: number): void {
      adapter.go(delta);
    },
    // @cpt-end:cpt-frontx-flow-routing-navigation-substrate-imperative-navigation:p1:inst-immediate-call
  };
}
