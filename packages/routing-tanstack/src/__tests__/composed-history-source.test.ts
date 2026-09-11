import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { adaptComposedHistory, createComposedVirtualLocationSource } from '../composed-history-source.js';
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

// F7/D2 (review round 16-re): a hash given to a navigation is applied to
// the page's own hash, never to this occupant's own entry. `write` now
// passes the hash straight through to the core's own `backProjectEntries`,
// which since D2 accepts an optional fourth `pageHash` parameter for
// exactly this — no separate grammar-codec round trip of this provider's
// own, still exactly one history call either way. `createHref` never
// writes to history, so it keeps composing the hash directly via the
// grammar serializer (FEATURE §3, step 4).
describe('composed hash on write/createHref (F7)', () => {
  it('applies a given hash to the page, leaving every entry exactly as payloadChanged would have', () => {
    const adapter = resetRealm(`${URL}#old`);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push', 'new');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999#new',
    );
  });

  it('preserves the current hash verbatim when no hash is given, exactly as before', () => {
    const adapter = resetRealm(`${URL}#current`);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999#current',
    );
  });

  it('createHref includes a given hash', () => {
    resetRealm(URL);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    expect(source.createHref('/contacts', '?tenantId=999', 'new')).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999#new',
    );
  });

  it('createHref preserves the current hash when none is given', () => {
    resetRealm(`${URL}#current`);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    expect(source.createHref('/contacts', '?tenantId=999')).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999#current',
    );
  });

  // D2: an explicit empty-string hash clears the page's own current hash,
  // through the same single `backProjectEntries` write — the core helper's
  // own `''` convention (serializeGrammar drops it), reached here through
  // `write`'s pass-through rather than a codec round trip of this
  // provider's own.
  it('an explicit empty-string hash clears the current hash', () => {
    const adapter = resetRealm(`${URL}#old`);
    const source = createComposedVirtualLocationSource(resolveNavigationHistory(), SHEET_ENTRY_ADDRESS);

    source.write('/contacts', '?tenantId=999', 'push', '');

    expect(adapter.lastWrite).toBe(
      '/en?screen=dashboard;route=settings/general;orientation=left&sheet=tenant-details;route=contacts;tenantId=999',
    );
  });
});

// Missing-tests audit: "two routers over one shared history (both receive
// the change, exactly once each)" — two independently constructed
// `RouterHistory` objects, each addressed at a different occupant, both
// wired to the identical realm-shared `NavigationHistory`.
describe('two routers over one shared history', () => {
  it('both receive a navigation the other one issued, exactly once each', () => {
    resetRealm(URL);
    const navigationHistory = resolveNavigationHistory();
    const dashboardHistory = adaptComposedHistory(navigationHistory, {
      domainKey: 'screen' as DomainKey,
      extension: 'dashboard' as ExtensionToken,
    });
    const sheetHistory = adaptComposedHistory(navigationHistory, SHEET_ENTRY_ADDRESS);

    const dashboardReceived: unknown[] = [];
    const sheetReceived: unknown[] = [];
    dashboardHistory.subscribe((args) => dashboardReceived.push(args));
    sheetHistory.subscribe((args) => sheetReceived.push(args));

    // A write through the sheet occupant's own history is observed by the
    // dashboard occupant's own history too (both share the identical
    // underlying `NavigationHistory`), even though only the sheet entry's
    // own payload changed.
    sheetHistory.push('/contacts?tenantId=999');

    expect(dashboardReceived).toHaveLength(1);
    expect(sheetReceived).toHaveLength(1);
    expect(sheetHistory.location.search).toBe('?tenantId=999');
    // The dashboard occupant's own entry is untouched by the sheet's own write.
    expect(dashboardHistory.location.pathname).toBe('/settings/general');
  });
});
