import { describe, expect, it } from 'vitest';
import { resolveNavigationHistory } from '@gears-frontx/routing';
import { adaptStandaloneHistory, createStandaloneVirtualLocationSource } from '../standalone-history-source.js';
import { resetRealm } from './helpers/index.js';

// FEATURE example 7.4, the acceptance scenario this task's implementation
// MUST reproduce (engine-provider FEATURE §6): the same microfrontend served
// standalone, virtual location projected onto the page's own address:
//   /settings/general?orientation=left
const EXAMPLE_7_4_URL = '/settings/general?orientation=left';

describe('example 7.4 (MUST) — the same microfrontend served standalone', () => {
  it('projects pathname /settings/general and search orientation=left directly from the page address', () => {
    resetRealm(EXAMPLE_7_4_URL);
    const history = adaptStandaloneHistory(resolveNavigationHistory());
    expect(history.location.pathname).toBe('/settings/general');
    expect(history.location.search).toBe('?orientation=left');
  });

  it('writes back through the page own history directly, with exactly one write, no entry and no grammar codec', () => {
    const adapter = resetRealm(EXAMPLE_7_4_URL);
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    let writes = 0;
    const originalPushState = adapter.pushState.bind(adapter);
    adapter.pushState = (path: string) => {
      writes += 1;
      originalPushState(path);
    };

    history.push('/settings/profile?orientation=left');

    expect(writes).toBe(1);
    expect(adapter.lastWrite).toBe('/settings/profile?orientation=left');
  });

  it('createHref composes the page own full address directly, with no grammar serializer involved', () => {
    resetRealm(EXAMPLE_7_4_URL);
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    expect(history.createHref('/settings/profile?orientation=left')).toBe('/settings/profile?orientation=left');
  });
});

describe('composed and standalone virtual location round-trip to the identical form', () => {
  it('produces the same pathname and search for the identical page address in both modes', () => {
    resetRealm(EXAMPLE_7_4_URL);
    const source = createStandaloneVirtualLocationSource(resolveNavigationHistory());
    expect(source.readParams()).toEqual([
      { name: 'route', value: 'settings/general' },
      { name: 'orientation', value: 'left' },
    ]);
  });

  it('round-trips a pushed virtual location back to the same pathname and search on the next read', () => {
    resetRealm(EXAMPLE_7_4_URL);
    const navigationHistory = resolveNavigationHistory();
    const history = adaptStandaloneHistory(navigationHistory);

    history.push('/settings/profile?orientation=right&density=compact');

    expect(history.location.pathname).toBe('/settings/profile');
    expect(history.location.search).toBe('?orientation=right&density=compact');
  });
});

describe('standalone source never reports an absent entry', () => {
  it('always returns a params array, unlike the composed source when its own entry is absent', () => {
    resetRealm('/');
    const source = createStandaloneVirtualLocationSource(resolveNavigationHistory());
    expect(source.readParams()).not.toBeUndefined();
  });
});

describe('standalone write-back preserves the page hash (A4, composed/standalone parity)', () => {
  it('keeps the page own hash on push, exactly as the composed source does', () => {
    const adapter = resetRealm('/settings/general?orientation=left#frag');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    history.push('/settings/profile?orientation=left');

    expect(adapter.lastWrite).toBe('/settings/profile?orientation=left#frag');
  });

  it('keeps the page own hash on replace', () => {
    const adapter = resetRealm('/settings/general?orientation=left#frag');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    history.replace('/settings/profile?orientation=left');

    expect(adapter.lastWrite).toBe('/settings/profile?orientation=left#frag');
  });

  it('writes no hash suffix at all when the page carries none', () => {
    const adapter = resetRealm('/settings/general?orientation=left');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    history.push('/settings/profile?orientation=left');

    expect(adapter.lastWrite).toBe('/settings/profile?orientation=left');
  });
});

// F7: a hash passed to a navigation is applied to the page's own hash in
// both modes, never carried into an entry — this mode has no entry to carry
// it into at all, but the given-versus-absent distinction still governs
// whether the page's own existing hash survives.
describe('standalone hash on push/replace/createHref (F7)', () => {
  it('applies a caller-given hash to the page, replacing whatever hash was there before', () => {
    const adapter = resetRealm('/settings/general?orientation=left#old');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    history.push('/settings/profile?orientation=left#new');

    expect(adapter.lastWrite).toBe('/settings/profile?orientation=left#new');
  });

  it('applies a caller-given hash on replace the same way', () => {
    const adapter = resetRealm('/settings/general?orientation=left#old');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    history.replace('/settings/profile?orientation=left#new');

    expect(adapter.lastWrite).toBe('/settings/profile?orientation=left#new');
  });

  it('createHref includes a caller-given hash', () => {
    resetRealm('/settings/general?orientation=left#old');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    expect(history.createHref('/settings/profile?orientation=left#new')).toBe(
      '/settings/profile?orientation=left#new',
    );
  });

  it('createHref preserves the page own current hash when none is given', () => {
    resetRealm('/settings/general?orientation=left#current');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    expect(history.createHref('/settings/profile?orientation=left')).toBe(
      '/settings/profile?orientation=left#current',
    );
  });
});

// F2: `decodeURIComponent` throws `URIError` on a bare `%` or any other
// malformed percent-escape — a real possibility for a page's own query
// string, which this adapter never controls. Construction (and every read
// through it) must stay total rather than throwing.
describe('standalone source with a malformed query string (F2)', () => {
  it('does not throw at construction on a bare "%"', () => {
    resetRealm('/settings/general?a=%');
    expect(() => adaptStandaloneHistory(resolveNavigationHistory())).not.toThrow();
  });

  it('keeps the malformed pair as raw text rather than dropping it or throwing on read', () => {
    resetRealm('/settings/general?a=%');
    const source = createStandaloneVirtualLocationSource(resolveNavigationHistory());

    expect(source.readParams()).toEqual([
      { name: 'route', value: 'settings/general' },
      { name: 'a', value: '%' },
    ]);
  });

  it('does not throw on an invalid escape sequence ("%zz")', () => {
    resetRealm('/settings/general?a=%zz');
    const source = createStandaloneVirtualLocationSource(resolveNavigationHistory());

    expect(() => source.readParams()).not.toThrow();
    expect(source.readParams()).toEqual([
      { name: 'route', value: 'settings/general' },
      { name: 'a', value: '%zz' },
    ]);
  });

  it('still decodes every well-formed pair alongside a malformed one', () => {
    resetRealm('/settings/general?a=%&b=hello%20world');
    const source = createStandaloneVirtualLocationSource(resolveNavigationHistory());

    expect(source.readParams()).toEqual([
      { name: 'route', value: 'settings/general' },
      { name: 'a', value: '%' },
      { name: 'b', value: 'hello world' },
    ]);
  });

  // F2 (review round 16-re): the raw, kept-as-is value does not survive a
  // write unchanged — `buildSearchString` re-encodes every value on write
  // regardless of where it came from, so the malformed escape becomes its
  // own percent-encoded form (`%` -> `%25`) on the next history call, with
  // no signal of that mutation beyond the URL itself changing.
  it('re-encodes a kept-raw malformed pair on the next write', () => {
    resetRealm('/settings/general?a=%');
    const history = adaptStandaloneHistory(resolveNavigationHistory());

    history.push('/settings/general?a=%');

    expect(history.location.search).toBe('?a=%25');
  });
});
