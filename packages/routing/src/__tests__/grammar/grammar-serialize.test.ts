import { describe, expect, it } from 'vitest';
import { parseGrammar } from '../../grammar/parse.js';
import { serializeGrammar } from '../../grammar/serialize.js';
import { entry, expectRoutingError } from '../helpers.js';
import type { SerializeInput } from '../../types/index.js';

// cpt-frontx-algo-routing-navigation-substrate-grammar-serialize
// FEATURE §6 Acceptance Criteria — round-trip property, examples 7.1/7.6/7.8.

describe('serializeGrammar — round-trip (parse -> serialize is byte-exact for canonical input)', () => {
  it('reproduces example 7.1 exactly', () => {
    const url =
      '/en?screen=dashboard;orientation=left' +
      '&sheet=tenant-details;tenantId=456' +
      '&sheet=user-contacts;contactId=123;view=active' +
      '&widgets=line-a;range=7d' +
      '&widgets=line-b;range=30d' +
      '&widgets=pie;metric=revenue';
    const parsed = parseGrammar(url);
    expect(serializeGrammar(parsed)).toBe(url);
  });

  it('reproduces example 7.6 (escaping) exactly, byte for byte', () => {
    const url = '/en?sheet=search;q=a%26b%3Dc%20d';
    const parsed = parseGrammar(url);
    expect(serializeGrammar(parsed)).toBe(url);
  });

  it('reproduces example 7.8 (zero entries) as the bare shell subroute, no trailing "?"', () => {
    const parsed = parseGrammar('/en');
    expect(serializeGrammar(parsed)).toBe('/en');
  });

  it('normalizes an explicit "k=" empty value to the canonical bare form on re-serialize', () => {
    const parsed = parseGrammar('/en?sheet=tenant-details;k=');
    expect(serializeGrammar(parsed)).toBe('/en?sheet=tenant-details;k');
  });

  it('preserves the hash across a round-trip', () => {
    const parsed = parseGrammar('/en?screen=dashboard#x');
    expect(serializeGrammar(parsed)).toBe('/en?screen=dashboard#x');
  });

  // Direct on serializeGrammar, not routed through parseGrammar: parse
  // normalizes a present-but-empty hash to `undefined` before it ever
  // reaches serialize (see parse.ts), so a round-trip test alone cannot
  // prove serialize's own guard holds against a caller that constructs
  // `{ hash: '' }` directly instead of getting it from parse.
  it('treats an explicit empty-string hash as absent — no bare trailing "#"', () => {
    const input: SerializeInput = { shellSubroute: '/en', hash: '', entries: [] };
    expect(serializeGrammar(input)).toBe('/en');
  });

  it('treats an explicit empty-string hash as absent alongside entries — no bare trailing "#"', () => {
    const input: SerializeInput = {
      shellSubroute: '/en',
      hash: '',
      entries: [entry('screen', 'dashboard')],
    };
    expect(serializeGrammar(input)).toBe('/en?screen=dashboard');
  });
});

describe('serializeGrammar — validation errors', () => {
  const base: SerializeInput = { shellSubroute: '/en', hash: undefined, entries: [] };

  it('throws invalid-domain-key for a malformed domainKey, naming the offending entry', () => {
    const input = { ...base, entries: [entry('a.b', 'dashboard')] };
    const error = expectRoutingError(() => serializeGrammar(input));
    expect(error.code).toBe('invalid-domain-key');
    expect(error.entry).toEqual(input.entries[0]);
  });

  it('throws invalid-extension-token for a malformed extension, naming the offending entry', () => {
    const input = { ...base, entries: [entry('screen', 'Dashboard')] };
    const error = expectRoutingError(() => serializeGrammar(input));
    expect(error.code).toBe('invalid-extension-token');
    expect(error.entry).toEqual(input.entries[0]);
  });

  it('throws duplicate-param-name for two params of the identical name in one entry', () => {
    const input = {
      ...base,
      entries: [
        entry('sheet', 'search', [
          { name: 'q', value: 'first' },
          { name: 'q', value: 'second' },
        ]),
      ],
    };
    const error = expectRoutingError(() => serializeGrammar(input));
    expect(error.code).toBe('duplicate-param-name');
  });

  it('throws duplicate-extension for two entries sharing domainKey and extension', () => {
    const input = {
      ...base,
      entries: [entry('widgets', 'line-a'), entry('widgets', 'line-a')],
    };
    const error = expectRoutingError(() => serializeGrammar(input));
    expect(error.code).toBe('duplicate-extension');
  });

  it('throws duplicate-extension even when the identical Entry object occupies both positions', () => {
    const shared = entry('widgets', 'line-a');
    const input = { ...base, entries: [shared, shared] };
    const error = expectRoutingError(() => serializeGrammar(input));
    expect(error.code).toBe('duplicate-extension');
  });
});

describe('serializeGrammar — percent-encoding table', () => {
  it('escapes ; = & # % + and space, leaves pchar-safe raw, and UTF-8-escapes non-ASCII', () => {
    const input = {
      ...base(),
      entries: [entry('sheet', 'search', [{ name: 'q', value: ';=&#%+ é' }])],
    };
    const result = serializeGrammar(input);
    expect(result).toBe('/en?sheet=search;q=%3B%3D%26%23%25%2B%20%C3%A9');
  });

  it('leaves the pchar-safe set raw, e.g. a value like settings/general', () => {
    const input = {
      ...base(),
      entries: [entry('sheet', 'search', [{ name: 'route', value: 'settings/general' }])],
    };
    expect(serializeGrammar(input)).toBe('/en?sheet=search;route=settings/general');
  });

  function base(): SerializeInput {
    return { shellSubroute: '/en', hash: undefined, entries: [] };
  }
});
