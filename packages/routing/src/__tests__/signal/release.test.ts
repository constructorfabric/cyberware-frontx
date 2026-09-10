import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createObserver } from '../../signal/observe-change.js';
import { resolveNavigationHistory } from '../../history/singleton.js';
import { resetRealm, staticSource, mutableSource } from '../helpers.js';
import type { DomainKey, ReleaseFunction, Transition } from '../../types/index.js';

// FEATURE (route-ownership-signal) §3, Observer Release
// (cpt-frontx-algo-routing-route-ownership-signal-release).

beforeEach(() => {
  resetRealm();
});

describe('release — unsubscribes the fan-out', () => {
  it('reports no further transitions after release', () => {
    const adapter = resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const release = createObserver('screen' as DomainKey, staticSource(), onTransition);
    onTransition.mockClear();

    release();
    resolveNavigationHistory(() => adapter).push('/en?screen=dashboard');

    expect(onTransition).not.toHaveBeenCalled();
  });
});

describe('release — unsubscribes the registered-extensions-source change notification', () => {
  it('the source\'s own release function is called', () => {
    resetRealm('/en');
    const source = mutableSource();
    const release = createObserver('screen' as DomainKey, source, vi.fn());

    release();

    // Firing the (now-released) callback must not reach the observer: since
    // the fake source only clears its own reference on release, firing after
    // release is a plain no-op with nothing listening any more.
    expect(() => source.fireChange()).not.toThrow();
  });
});

describe('release — idempotent', () => {
  it('calling release more than once is a no-op after the first call', () => {
    resetRealm('/en');
    const onTransition = vi.fn<(transition: Transition<string>) => void>();
    const release = createObserver('screen' as DomainKey, staticSource(), onTransition);

    release();
    expect(() => release()).not.toThrow();
  });

  it('a second release call does not call the registered-extensions source\'s own release function a second time', () => {
    resetRealm('/en');
    const source = mutableSource();
    const release = createObserver('screen' as DomainKey, source, vi.fn());

    release();
    release();

    expect(source.sourceReleaseCallCount).toBe(1);
  });
});

describe('release — round-in-progress', () => {
  it('skips a still-pending delivery to an observer released mid-round by an earlier observer, without undoing an earlier delivery in that same round', () => {
    const adapter = resetRealm('/en?screen=dashboard');
    const firstOnTransition = vi.fn<(transition: Transition<string>) => void>();
    const secondOnTransition = vi.fn<(transition: Transition<string>) => void>();

    let secondRelease: ReleaseFunction = () => undefined;
    let callCount = 0;
    createObserver('screen' as DomainKey, staticSource(), (transition) => {
      firstOnTransition(transition);
      callCount += 1;
      if (callCount === 2) {
        // Second invocation is the navigation below, not the initial report.
        secondRelease();
      }
    });
    secondRelease = createObserver('screen' as DomainKey, staticSource(), secondOnTransition);

    firstOnTransition.mockClear();
    secondOnTransition.mockClear();

    resolveNavigationHistory(() => adapter).push('/en?screen=settings');

    // The first observer (subscribed before the second) still receives this
    // round's own delivery — an invocation already completed earlier in the
    // round is never undone by a later release in that same round.
    expect(firstOnTransition).toHaveBeenCalledTimes(1);
    // The second observer's own slot, not yet reached when the first
    // observer released it, is skipped rather than invoked.
    expect(secondOnTransition).not.toHaveBeenCalled();
  });
});
