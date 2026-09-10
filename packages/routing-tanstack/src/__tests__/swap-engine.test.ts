import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { adaptComposedHistory } from '../composed-history-source.js';
import { resetRealm } from './helpers/index.js';

// FEATURE (engine-provider) §2, Swap The Router Engine Used By One
// Microfrontend. This package's own default provider, torn down and
// reconstructed, stands in for "a replacement provider satisfying the same
// engine-provider port" (§2, step 1, consumer-side — every replacement
// provider still goes through the same two provider-side steps this
// default one does: adapt-history (§3, History Adaptation) and
// construct-and-mount (§3, Router Creation)).
const ENTRY_ADDRESS: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };
const URL = '/en?screen=dashboard;route=settings/general;orientation=left';

describe('swapping to a second provider instance for the same entry', () => {
  it('adapts and constructs the replacement without issuing a second history write', () => {
    const adapter = resetRealm(URL);
    const navigationHistory = resolveNavigationHistory();
    const first = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);
    expect(adapter.lastWrite).toBeUndefined();

    // §2, step 1 (consumer-side): the microfrontend developer replaces the
    // provider — teardown of the outgoing one, then construction of the
    // replacement, handed the same NavigationHistory instance and entry
    // address (§2, step 2, consumer-side).
    first.destroy();
    const second = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);

    // Swapping providers, by itself, reads the occupant own entry — it
    // never writes it.
    expect(adapter.lastWrite).toBeUndefined();
    expect(second.location.pathname).toBe('/settings/general');
  });

  it('leaves exactly one active subscription against the shared NavigationHistory after the swap', () => {
    resetRealm(URL);
    const navigationHistory = resolveNavigationHistory();

    let activeSubscriptions = 0;
    const originalSubscribe = navigationHistory.subscribe.bind(navigationHistory);
    navigationHistory.subscribe = (subscriber) => {
      activeSubscriptions += 1;
      const release = originalSubscribe(subscriber);
      return () => {
        activeSubscriptions -= 1;
        release();
      };
    };

    const first = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);
    expect(activeSubscriptions).toBe(1);

    first.destroy();
    expect(activeSubscriptions).toBe(0);

    const second = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);
    expect(activeSubscriptions).toBe(1);

    second.destroy();
    expect(activeSubscriptions).toBe(0);
  });

  it('the replacement router matches only its own virtual location, exactly like the one it replaced', () => {
    resetRealm(URL);
    const navigationHistory = resolveNavigationHistory();
    const first = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);
    first.destroy();

    const second = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);

    expect(second.location.pathname).toBe('/settings/general');
    expect(second.location.search).toBe('?orientation=left');
  });
});
