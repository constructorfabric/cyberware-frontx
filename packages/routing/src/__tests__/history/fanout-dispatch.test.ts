import { describe, expect, it, vi } from 'vitest';
import { FanOutDispatcher } from '../../history/fanout-dispatch.js';
import type { HistoryNotification } from '../../types/index.js';

// FEATURE (navigation-substrate) §3, Fan-Out Subscription Dispatch, step 4
// and its Rationale.

const notification: HistoryNotification = {
  location: { path: '/en', search: '', hash: '' },
  kind: 'push',
};

describe('FanOutDispatcher — registration order', () => {
  it('invokes every live subscriber once, in registration order', () => {
    const dispatcher = new FanOutDispatcher();
    const calls: string[] = [];
    dispatcher.subscribe(() => calls.push('a'));
    dispatcher.subscribe(() => calls.push('b'));
    dispatcher.subscribe(() => calls.push('c'));

    dispatcher.dispatch(notification);

    expect(calls).toEqual(['a', 'b', 'c']);
  });
});

describe('FanOutDispatcher — error isolation', () => {
  it('a throwing subscriber does not stop delivery to the rest of the round', () => {
    const dispatcher = new FanOutDispatcher();
    const first = vi.fn();
    const third = vi.fn();
    dispatcher.subscribe(first);
    dispatcher.subscribe(() => {
      throw new Error('boom');
    });
    dispatcher.subscribe(third);

    expect(() => dispatcher.dispatch(notification)).not.toThrow();

    expect(first).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });
});

describe('FanOutDispatcher — mid-round unsubscribe', () => {
  it('a listener that unsubscribes itself receives that round\'s own invocation', () => {
    const dispatcher = new FanOutDispatcher();
    const calls: string[] = [];
    let release = (): void => undefined;
    release = dispatcher.subscribe(() => {
      calls.push('self');
      release();
    });

    dispatcher.dispatch(notification);

    expect(calls).toEqual(['self']);
  });

  it('a listener unsubscribed by an earlier listener in the same round is skipped, not invoked', () => {
    const dispatcher = new FanOutDispatcher();
    const calls: string[] = [];
    const laterCallback = vi.fn(() => calls.push('later'));
    dispatcher.subscribe(() => {
      calls.push('earlier');
      releaseLater();
    });
    const releaseLater = dispatcher.subscribe(laterCallback);

    dispatcher.dispatch(notification);

    expect(calls).toEqual(['earlier']);
    expect(laterCallback).not.toHaveBeenCalled();
  });

  it('unsubscribing mid-round never un-invokes a callback already completed earlier in that same round', () => {
    const dispatcher = new FanOutDispatcher();
    const earlierCallback = vi.fn();
    const releaseEarlier = dispatcher.subscribe(earlierCallback);
    dispatcher.subscribe(() => {
      releaseEarlier();
    });

    dispatcher.dispatch(notification);

    expect(earlierCallback).toHaveBeenCalledTimes(1);
  });

  it('a listener subscribed twice is two independent registrations, each releasable on its own', () => {
    const dispatcher = new FanOutDispatcher();
    const callback = vi.fn();
    const releaseFirst = dispatcher.subscribe(callback);
    dispatcher.subscribe(callback);

    releaseFirst();
    dispatcher.dispatch(notification);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('FanOutDispatcher — reentrant navigation', () => {
  it('a navigation triggered from inside a callback dispatches as a new, later round, not folded into the current one', () => {
    const dispatcher = new FanOutDispatcher();
    const order: string[] = [];
    const second: HistoryNotification = {
      location: { path: '/fr', search: '', hash: '' },
      kind: 'push',
    };

    dispatcher.subscribe((n) => {
      order.push(`first-sees-${n.kind}-${n.location.path}`);
      if (n === notification) {
        dispatcher.dispatch(second);
        order.push('reentrant-dispatch-returned');
      }
    });
    dispatcher.subscribe((n) => {
      order.push(`second-sees-${n.kind}-${n.location.path}`);
    });

    dispatcher.dispatch(notification);

    // The reentrant dispatch call returns immediately (queued), and the
    // round in progress finishes iterating its own snapshot before the
    // queued round runs.
    expect(order).toEqual([
      'first-sees-push-/en',
      'reentrant-dispatch-returned',
      'second-sees-push-/en',
      'first-sees-push-/fr',
      'second-sees-push-/fr',
    ]);
  });
});

describe('FanOutDispatcher — release function', () => {
  it('the returned release function removes the subscriber from future rounds', () => {
    const dispatcher = new FanOutDispatcher();
    const callback = vi.fn();
    const release = dispatcher.subscribe(callback);

    release();
    dispatcher.dispatch(notification);

    expect(callback).not.toHaveBeenCalled();
  });

  it('calling release more than once is a no-op after the first call', () => {
    const dispatcher = new FanOutDispatcher();
    const callback = vi.fn();
    const release = dispatcher.subscribe(callback);

    release();
    expect(() => release()).not.toThrow();
    dispatcher.dispatch(notification);

    expect(callback).not.toHaveBeenCalled();
  });
});
