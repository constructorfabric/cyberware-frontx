import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { createComposedVirtualLocationSource } from '../composed-history-source.js';
import { resetRealm } from './helpers/index.js';

const SHEET_ENTRY_ADDRESS: EntryAddress = { domainKey: 'sheet' as DomainKey, extension: 'tenant-details' as ExtensionToken };
const URL = '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=456';

describe('createComposedVirtualLocationSource', () => {
  it('reads the addressed occupant own params, ignoring every other entry', () => {
    resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);
    expect(source.readParams()).toEqual([
      { name: 'route', value: 'contacts' },
      { name: 'tenantId', value: '456' },
    ]);
  });

  it('reports undefined when the addressed entry is not present in the URL', () => {
    resetRealm('/en?screen=dashboard;route=settings/general');
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);
    expect(source.readParams()).toBeUndefined();
  });

  it('writes back the full new parameter list for the addressed occupant only, via one call', () => {
    const adapter = resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999',
    );
  });

  it('drops a parameter the new search no longer carries, since payloadChanged replaces the whole list', () => {
    const adapter = resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '', 'replace');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts',
    );
  });

  // A5: once this occupant's own entry is no longer in the URL, a write
  // through this source has nothing of its own left to write to (FEATURE
  // §3, step 7.1 — "no write-back runs, because there is no longer an
  // entry of this occupant's own to write to"). Without this guard,
  // `backProjectEntries` still issues one no-op-content write (the
  // unchanged URL, since there is no matching entry to change), which is a
  // spurious history entry and a spurious fan-out round for every other
  // subscriber.
  it('issues no write at all once this occupant own entry is absent from the URL', () => {
    const adapter = resetRealm('/en?screen=dashboard;route=settings/general');
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push');

    expect(adapter.lastWrite).toBeUndefined();
  });
});
