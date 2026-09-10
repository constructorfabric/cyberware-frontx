import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { adaptComposedHistory } from '../composed-history-source.js';
import { locationPreservingRedirect } from '../location-preserving-redirect.js';
import { resetRealm } from './helpers/index.js';

const ENTRY_ADDRESS: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };

describe('locationPreservingRedirect', () => {
  it('carries the current virtual location search forward onto the target path', () => {
    resetRealm('/en?screen=dashboard;route=settings/general;orientation=left');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/settings/profile', { readPageHash: () => '' });

    expect(result.options.to).toBe('/settings/profile');
    expect(result.options.search).toEqual({ orientation: 'left' });
  });

  it('carries the page own current hash forward onto the target path', () => {
    resetRealm('/en?screen=dashboard;route=settings/general');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/settings/profile', { readPageHash: () => 'section-2' });

    expect(result.options.hash).toBe('section-2');
  });

  it('drops nothing from a search carrying several parameters', () => {
    resetRealm('/en?screen=dashboard;route=settings/general;a=1;b=2');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/other', { readPageHash: () => '' });

    expect(result.options.search).toEqual({ a: '1', b: '2' });
  });

  it('carries an empty search and empty hash forward when neither is present', () => {
    resetRealm('/en?screen=dashboard;route=settings/general');
    const history = adaptComposedHistory(resolveNavigationHistory(), ENTRY_ADDRESS);

    const result = locationPreservingRedirect(history, '/other', { readPageHash: () => '' });

    expect(result.options.search).toEqual({});
    expect(result.options.hash).toBe('');
  });
});
