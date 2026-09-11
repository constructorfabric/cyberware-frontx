import { describe, expect, it } from 'vitest';
import { resolveEntries } from '../../signal/entry-resolution.js';
import { entry, staticSource as source } from '../helpers.js';
import type { DomainKey } from '../../types/index.js';

// FEATURE (route-ownership-signal) §3, Entry Resolution
// (cpt-frontx-algo-routing-route-ownership-signal-entry-resolution).

describe('resolveEntries', () => {
  it('filters to only the entries carrying the given domain key, preserving order', () => {
    const entries = [
      entry('screen', 'dashboard'),
      entry('modal', 'create-contact'),
      entry('screen', 'settings'),
    ];

    const result = resolveEntries('screen' as DomainKey, entries, source([]));

    expect(result.map((r) => r.extension)).toEqual(['dashboard', 'settings']);
  });

  it('pairs an entry with the matching registration\'s own route owner', () => {
    const entries = [entry('screen', 'dashboard')];
    const src = source([{ extension: 'dashboard', routeOwner: 'DashboardScreen' }]);

    const result = resolveEntries('screen' as DomainKey, entries, src);

    expect(result[0].resolution).toEqual({ resolved: true, routeOwner: 'DashboardScreen' });
  });

  it('pairs an entry with "unresolved" when no registration matches', () => {
    const entries = [entry('screen', 'unknown-screen')];

    const result = resolveEntries('screen' as DomainKey, entries, source([]));

    expect(result[0].resolution).toEqual({ resolved: false });
  });

  it('carries the entry\'s own params through untouched', () => {
    const entries = [entry('sheet', 'search', [{ name: 'q', value: 'x' }])];

    const result = resolveEntries('sheet' as DomainKey, entries, source([]));

    expect(result[0].params).toEqual([{ name: 'q', value: 'x' }]);
  });
});
