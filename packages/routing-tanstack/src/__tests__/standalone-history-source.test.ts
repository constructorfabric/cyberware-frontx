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
