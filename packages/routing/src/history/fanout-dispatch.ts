import type { HistoryNotification, HistorySubscriber, ReleaseFunction } from '../types/index.js';

// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2

/**
 * A single `subscribe` registration. Its own identity (not the callback's)
 * is what a round's liveness check and the returned release function key
 * off — FEATURE §3, step 1: "return an unsubscribe function closed over
 * that registry entry," so two `subscribe` calls with the identical
 * callback reference remain two independent, independently releasable
 * registrations.
 */
interface SubscriberToken {
  readonly callback: HistorySubscriber;
}

/**
 * The fan-out registry and round-dispatch machinery shared by both dispatch
 * triggers in FEATURE §3 (the underlying browser subscription, and this
 * instance's own `push`/`replace` calls) — kept as its own class so
 * `navigation-history.ts` composes it rather than re-implementing the
 * snapshot/liveness/reentrancy rules inline.
 */
export class FanOutDispatcher {
  private readonly live = new Set<SubscriberToken>();
  private dispatching = false;
  private readonly pending: HistoryNotification[] = [];

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-add-subscriber
  subscribe(callback: HistorySubscriber): ReleaseFunction {
    const token: SubscriberToken = { callback };
    this.live.add(token);
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-add-subscriber
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-unsubscribe
    return () => {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-remove-subscriber
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-unsubscribe-mid-round
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-unsubscribe-mid-round-safe
      // Removing the token from `live` immediately is what makes this safe to
      // call mid-round: the round in progress iterates the snapshot it
      // already took (step 4.1), and the still-live check below (inst-if-
      // still-live) is what turns this removal into a skip for a slot the
      // round has not reached yet — an invocation already completed earlier
      // in this same round is never undone by this delete.
      this.live.delete(token);
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-unsubscribe-mid-round-safe
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-unsubscribe-mid-round
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-remove-subscriber
    };
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-when-unsubscribe
  }

  /**
   * Dispatches one round for `notification`. A round triggered while another
   * is already in progress — a subscriber that navigates from inside its own
   * callback — is deferred to run after the in-progress round finishes,
   * never folded into it (step 4.4, reentrant navigation).
   */
  dispatch(notification: HistoryNotification): void {
    if (this.dispatching) {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-reentrant-navigation
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-reentrant-new-round
      // Queuing rather than recursing into `runRound` is what keeps this
      // navigation's own dispatch a later, separate round instead of folding
      // it into the round already in progress.
      this.pending.push(notification);
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-reentrant-new-round
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-reentrant-navigation
      return;
    }

    this.dispatching = true;
    try {
      this.runRound(notification);
      // A round dispatched while this one was running queued itself above
      // instead of interleaving; drain it now as its own, later round.
      while (this.pending.length > 0) {
        const next = this.pending.shift();
        if (next !== undefined) {
          this.runRound(next);
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-dispatch-round
  private runRound(notification: HistoryNotification): void {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-snapshot-subscribers
    const snapshot = Array.from(this.live);
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-snapshot-subscribers

    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-foreach-subscriber
    for (const token of snapshot) {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-still-live
      // Marker wraps the liveness test itself — not only what happens once
      // it passes.
      if (!this.live.has(token)) {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-else-unsubscribed-before-turn
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-skip-unsubscribed-slot
        continue; // unsubscribed after the snapshot, before this slot — skip without invoking
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-skip-unsubscribed-slot
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-else-unsubscribed-before-turn
      }
      // A subscriber's own thrown error is isolated by this whole
      // `try`/`catch` — the empty `catch` clause is what stops it from
      // propagating past this one callback's own invocation and out of
      // `runRound`, so it never stops delivery to the remaining callbacks in
      // this same snapshot. `inst-isolate-error` wraps the full statement
      // (not the empty `catch` body alone) since the kit's marker rule
      // requires a marked block to wrap non-empty code.
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-catch-subscriber-error
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-isolate-error
      try {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-invoke-subscriber
        token.callback(notification);
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-invoke-subscriber
      } catch {
        // Empty on purpose: isolating the error IS not re-throwing it.
      }
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-isolate-error
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-catch-subscriber-error
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-if-still-live
    }
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-foreach-subscriber
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch:p2:inst-dispatch-round
}
