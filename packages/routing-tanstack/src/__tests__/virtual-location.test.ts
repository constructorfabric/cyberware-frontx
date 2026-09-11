import { describe, expect, it } from 'vitest';
import { projectParamsToVirtualLocation, projectVirtualLocationToParams, splitHref } from '../virtual-location.js';

describe('projectParamsToVirtualLocation', () => {
  it('projects the route parameter as pathname with exactly one leading slash', () => {
    const location = projectParamsToVirtualLocation([{ name: 'route', value: 'settings/general' }]);
    expect(location.pathname).toBe('/settings/general');
  });

  it('defaults pathname to / when no route parameter is present', () => {
    const location = projectParamsToVirtualLocation([{ name: 'orientation', value: 'left' }]);
    expect(location.pathname).toBe('/');
  });

  it('projects every other parameter as search, excluding route', () => {
    const location = projectParamsToVirtualLocation([
      { name: 'route', value: 'settings/general' },
      { name: 'orientation', value: 'left' },
    ]);
    expect(location.search).toBe('?orientation=left');
  });

  it('produces empty search when no non-route parameters exist', () => {
    const location = projectParamsToVirtualLocation([{ name: 'route', value: 'x' }]);
    expect(location.search).toBe('');
  });

  it('percent-encodes search keys and values', () => {
    const location = projectParamsToVirtualLocation([{ name: 'a b', value: 'c&d' }]);
    expect(location.search).toBe('?a%20b=c%26d');
  });

  it('reproduces the dashboard slice of FEATURE example 7.3', () => {
    // /en?screen=dashboard;route=settings/general;orientation=left&...
    const location = projectParamsToVirtualLocation([
      { name: 'screen', value: 'dashboard' },
      { name: 'route', value: 'settings/general' },
      { name: 'orientation', value: 'left' },
    ]);
    expect(location.pathname).toBe('/settings/general');
    expect(location.search).toBe('?screen=dashboard&orientation=left');
  });
});

describe('projectVirtualLocationToParams', () => {
  it('strips exactly one leading slash off the pathname into the route parameter, placed first', () => {
    const params = projectVirtualLocationToParams('/settings/general', '');
    expect(params[0]).toEqual({ name: 'route', value: 'settings/general' });
  });

  it('writes an empty route value for the root pathname', () => {
    const params = projectVirtualLocationToParams('/', '');
    expect(params[0]).toEqual({ name: 'route', value: '' });
  });

  it('appends every search parameter after route, in the order the search string carries them', () => {
    const params = projectVirtualLocationToParams('/x', '?b=2&a=1');
    expect(params).toEqual([
      { name: 'route', value: 'x' },
      { name: 'b', value: '2' },
      { name: 'a', value: '1' },
    ]);
  });

  it('decodes percent-encoded search keys and values', () => {
    const params = projectVirtualLocationToParams('/x', '?a%20b=c%26d');
    expect(params).toEqual([
      { name: 'route', value: 'x' },
      { name: 'a b', value: 'c&d' },
    ]);
  });

  it('round-trips through projectParamsToVirtualLocation', () => {
    const original = [
      { name: 'route', value: 'contacts' },
      { name: 'tenantId', value: '456' },
    ];
    const location = projectParamsToVirtualLocation(original);
    const roundTripped = projectVirtualLocationToParams(location.pathname, location.search);
    expect(roundTripped).toEqual(original);
  });
});

describe('splitHref', () => {
  it('splits pathname, search and hash out of a shell-relative path', () => {
    expect(splitHref('/settings/general?orientation=left#frag')).toEqual({
      pathname: '/settings/general',
      search: '?orientation=left',
      hash: 'frag',
    });
  });

  it('handles a path with no search and no hash', () => {
    expect(splitHref('/settings/general')).toEqual({ pathname: '/settings/general', search: '', hash: undefined });
  });

  it('reports an explicit empty hash (`#` with nothing after it) as the empty string, distinct from no hash at all', () => {
    expect(splitHref('/settings/general#')).toEqual({ pathname: '/settings/general', search: '', hash: '' });
  });
});
