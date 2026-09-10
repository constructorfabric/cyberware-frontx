import { describe, expect, it } from 'vitest';
import { parseGrammar } from '../../grammar/parse.js';

// cpt-frontx-algo-routing-navigation-substrate-grammar-parse
// FEATURE §6 Acceptance Criteria — examples 7.1, 7.6, 7.8, malformed,
// duplicate-param, duplicate-extension scenarios (verbatim fixtures).

describe('parseGrammar — example 7.1 (reference link, the model task)', () => {
  const url =
    '/en?screen=dashboard;orientation=left' +
    '&sheet=tenant-details;tenantId=456' +
    '&sheet=user-contacts;contactId=123;view=active' +
    '&widgets=line-a;range=7d' +
    '&widgets=line-b;range=30d' +
    '&widgets=pie;metric=revenue';

  it('copies the shell subroute verbatim and produces no warnings', () => {
    const result = parseGrammar(url);
    expect(result.shellSubroute).toBe('/en');
    expect(result.hash).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('produces one entry per occupant, in order, each carrying its own params', () => {
    const result = parseGrammar(url);
    expect(result.entries).toEqual([
      { domainKey: 'screen', extension: 'dashboard', params: [{ name: 'orientation', value: 'left' }] },
      {
        domainKey: 'sheet',
        extension: 'tenant-details',
        params: [{ name: 'tenantId', value: '456' }],
      },
      {
        domainKey: 'sheet',
        extension: 'user-contacts',
        params: [
          { name: 'contactId', value: '123' },
          { name: 'view', value: 'active' },
        ],
      },
      { domainKey: 'widgets', extension: 'line-a', params: [{ name: 'range', value: '7d' }] },
      { domainKey: 'widgets', extension: 'line-b', params: [{ name: 'range', value: '30d' }] },
      { domainKey: 'widgets', extension: 'pie', params: [{ name: 'metric', value: 'revenue' }] },
    ]);
  });
});

describe('parseGrammar — example 7.6 (escaping)', () => {
  it('decodes a payload value containing &, =, and a space', () => {
    const result = parseGrammar('/en?sheet=search;q=a%26b%3Dc%20d');
    expect(result.entries).toEqual([
      { domainKey: 'sheet', extension: 'search', params: [{ name: 'q', value: 'a&b=c d' }] },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe('parseGrammar — example 7.8 (zero entries)', () => {
  it('parses an empty query string to an empty entry list, not an error', () => {
    const result = parseGrammar('/en');
    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.shellSubroute).toBe('/en');
  });

  it('parses a present-but-empty query string (/en?) identically to no query string at all', () => {
    const result = parseGrammar('/en?');
    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe('parseGrammar — malformed entries', () => {
  it('drops an entry with no "=", a token outside the name alphabet, or an even-segment domain key', () => {
    const result = parseGrammar('/en?screen&a.b=x&widgets=line-a;range=7d');
    expect(result.entries).toEqual([
      { domainKey: 'widgets', extension: 'line-a', params: [{ name: 'range', value: '7d' }] },
    ]);
    expect(result.warnings).toEqual([
      { code: 'malformed-entry', rawEntry: 'screen' },
      { code: 'malformed-entry', rawEntry: 'a.b=x' },
    ]);
  });

  it('silently ignores an empty raw entry from a doubled or trailing "&", with no warning', () => {
    const result = parseGrammar('/en?screen=dashboard&&sheet=search&');
    expect(result.entries).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it('drops the whole entry on a malformed percent-escape, reporting it as malformed-entry', () => {
    const result = parseGrammar('/en?sheet=search;q=%zz&screen=dashboard');
    expect(result.entries).toEqual([
      { domainKey: 'screen', extension: 'dashboard', params: [] },
    ]);
    expect(result.warnings).toEqual([{ code: 'malformed-entry', rawEntry: 'sheet=search;q=%zz' }]);
  });
});

describe('parseGrammar — duplicate parameter', () => {
  it('keeps the last value at the first position and reports a warning', () => {
    const result = parseGrammar('/en?sheet=search;q=first;q=second');
    expect(result.entries).toEqual([
      { domainKey: 'sheet', extension: 'search', params: [{ name: 'q', value: 'second' }] },
    ]);
    expect(result.warnings).toEqual([
      { code: 'duplicate-parameter', rawEntry: 'sheet=search;q=first;q=second' },
    ]);
  });

  it('a bare param-name and an explicit empty value both parse to the identical empty string', () => {
    const bare = parseGrammar('/en?sheet=tenant-details');
    const explicit = parseGrammar('/en?sheet=tenant-details;k=');
    expect(bare.entries[0].params).toEqual([]);
    expect(explicit.entries[0].params).toEqual([{ name: 'k', value: '' }]);
  });
});

describe('parseGrammar — duplicate extension', () => {
  it('keeps the first occurrence under one domain key and drops the second, with a warning', () => {
    const result = parseGrammar('/en?widgets=line-a;range=7d&widgets=line-a;range=30d');
    expect(result.entries).toEqual([
      { domainKey: 'widgets', extension: 'line-a', params: [{ name: 'range', value: '7d' }] },
    ]);
    expect(result.warnings).toEqual([
      { code: 'duplicate-extension', rawEntry: 'widgets=line-a;range=30d' },
    ]);
  });
});

describe('parseGrammar — hash', () => {
  it('copies the hash verbatim without the leading "#"', () => {
    const result = parseGrammar('/en#x');
    expect(result.hash).toBe('x');
    expect(result.entries).toEqual([]);
  });

  it('normalizes a present-but-empty fragment ("/en#") to undefined, identically to no fragment at all', () => {
    const result = parseGrammar('/en#');
    expect(result.hash).toBeUndefined();
  });

  it('normalizes an empty hash given through the object-input form the same way', () => {
    const result = parseGrammar({ shellSubroute: '/en', search: '', hash: '' });
    expect(result.hash).toBeUndefined();
  });
});

describe('parseGrammar — percent-decoding edge cases', () => {
  it('passes a raw "+" through unchanged — no form-style "+"-to-space decoding', () => {
    const result = parseGrammar('/en?sheet=search;q=a+b');
    expect(result.entries).toEqual([
      { domainKey: 'sheet', extension: 'search', params: [{ name: 'q', value: 'a+b' }] },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('assembles a run of consecutive escapes into one multi-byte UTF-8 character (%C3%A9 -> "é")', () => {
    const result = parseGrammar('/en?sheet=search;q=%C3%A9');
    expect(result.entries).toEqual([
      { domainKey: 'sheet', extension: 'search', params: [{ name: 'q', value: 'é' }] },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('drops the whole entry when an escape run is not valid UTF-8 (%FF), reporting it as malformed-entry', () => {
    const result = parseGrammar('/en?sheet=search;q=%FF&screen=dashboard');
    expect(result.entries).toEqual([{ domainKey: 'screen', extension: 'dashboard', params: [] }]);
    expect(result.warnings).toEqual([{ code: 'malformed-entry', rawEntry: 'sheet=search;q=%FF' }]);
  });

  it('drops the whole entry when a trailing "%" has no hex pair to follow it', () => {
    const result = parseGrammar('/en?sheet=search;q=abc%&screen=dashboard');
    expect(result.entries).toEqual([{ domainKey: 'screen', extension: 'dashboard', params: [] }]);
    expect(result.warnings).toEqual([{ code: 'malformed-entry', rawEntry: 'sheet=search;q=abc%' }]);
  });

  it('drops the whole entry when a "%" is followed by only a single hex digit', () => {
    const result = parseGrammar('/en?sheet=search;q=a%4&screen=dashboard');
    expect(result.entries).toEqual([{ domainKey: 'screen', extension: 'dashboard', params: [] }]);
    expect(result.warnings).toEqual([{ code: 'malformed-entry', rawEntry: 'sheet=search;q=a%4' }]);
  });

  it('decodes a mixed-case hex pair identically to an all-uppercase one', () => {
    const result = parseGrammar('/en?sheet=search;q=%c3%A9');
    expect(result.entries).toEqual([
      { domainKey: 'sheet', extension: 'search', params: [{ name: 'q', value: 'é' }] },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe('parseGrammar — abandonment drops this entry\'s own already-recorded warnings', () => {
  it('a duplicate-parameter warning recorded earlier in an entry that a later malformed escape abandons does not survive', () => {
    const result = parseGrammar('/en?sheet=search;q=first;q=second;v=%zz');
    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([
      { code: 'malformed-entry', rawEntry: 'sheet=search;q=first;q=second;v=%zz' },
    ]);
  });
});

describe('parseGrammar — an empty param name violates param-name = 1*(...) and drops the whole entry', () => {
  it('drops the whole entry when two consecutive ";" leave an empty param segment', () => {
    const result = parseGrammar('/en?sheet=search;q=x;;a=y');
    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'malformed-entry', rawEntry: 'sheet=search;q=x;;a=y' }]);
  });

  it('drops the whole entry when a param segment is a bare "=value" with nothing before the "="', () => {
    const result = parseGrammar('/en?sheet=search;=value');
    expect(result.entries).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'malformed-entry', rawEntry: 'sheet=search;=value' }]);
  });
});
