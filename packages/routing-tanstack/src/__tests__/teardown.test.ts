import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { adaptComposedHistory } from '../composed-history-source.js';
import { resetRealm } from './helpers/index.js';

const ENTRY_ADDRESS: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };
const URL = '/en?screen=dashboard;route=settings/general;orientation=left';

describe('teardown on unmount', () => {
  it('releases the internal callback from the shared NavigationHistory, so it stops receiving the fan-out', async () => {
    resetRealm(URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptComposedHistory(navigationHistory, ENTRY_ADDRESS);

    let notified = 0;
    history.subscribe(() => {
      notified += 1;
    });

    history.destroy();

    navigationHistory.push('/en?screen=other');
    await flushMicrotasks();

    expect(notified).toBe(0);
  });

  it('a second teardown call is a safe no-op', () => {
    resetRealm(URL);
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    expect(() => {
      history.destroy();
      history.destroy();
    }).not.toThrow();
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}
