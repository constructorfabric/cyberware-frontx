import { describe, expect, it } from 'vitest';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { resolveNavigationHistory, type DomainKey, type EntryAddress, type ExtensionToken } from '@gears-frontx/routing';
import { adaptProviderHistory } from '../engine-provider-history.js';
import { createProviderRouter } from '../router-creation.js';
import { resetRealm } from './helpers/index.js';

const DASHBOARD_ENTRY_ADDRESS: EntryAddress = { domainKey: 'screen' as DomainKey, extension: 'dashboard' as ExtensionToken };
const COMPOSED_URL = '/en?screen=dashboard;route=settings/general;orientation=left';
const STANDALONE_URL = '/settings/general?orientation=left';

describe('mode selection by presence of an entry address', () => {
  it('projects from the occupant own entry when an entry address is supplied', () => {
    resetRealm(COMPOSED_URL);
    const history = adaptProviderHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    expect(history.location.pathname).toBe('/settings/general');
    expect(history.location.search).toBe('?orientation=left');
  });

  it('projects directly from the page own address when no entry address is given', () => {
    resetRealm(STANDALONE_URL);
    const history = adaptProviderHistory(resolveNavigationHistory(), undefined);
    expect(history.location.pathname).toBe('/settings/general');
    expect(history.location.search).toBe('?orientation=left');
  });

  it('produces the identical resulting virtual location for one navigation sequence in either mode', () => {
    resetRealm(COMPOSED_URL);
    const composed = adaptProviderHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    composed.push('/settings/profile?orientation=right');
    const composedResult = { pathname: composed.location.pathname, search: composed.location.search };

    resetRealm(STANDALONE_URL);
    const standalone = adaptProviderHistory(resolveNavigationHistory(), undefined);
    standalone.push('/settings/profile?orientation=right');
    const standaloneResult = { pathname: standalone.location.pathname, search: standalone.location.search };

    expect(standaloneResult).toEqual(composedResult);
  });
});

function buildRouteTreeWithNotFound() {
  const rootRoute = createRootRoute({ component: () => 'root', notFoundComponent: () => 'not found' });
  const knownRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/general', component: () => 'known' });
  return rootRoute.addChildren([knownRoute]);
}

function buildRouteTreeWithTwoRoutes() {
  const rootRoute = createRootRoute({ component: () => 'root' });
  const generalRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/general', component: () => 'general' });
  const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/profile', component: () => 'profile' });
  return rootRoute.addChildren([generalRoute, profileRoute]);
}

// B1: exercises `router.navigate()` end to end — the real path a mounted
// router's own imperative navigation takes (`commitLocation` ->
// `history.push(href, state, { ignoreBlocker })`), not only this adapter's
// own `history.push` called directly. A defect only reachable through the
// engine's own `navigate` call (a missing `ignoreBlocker` forward, a state
// argument `commitLocation` supplies that this adapter mishandles) is
// invisible to every other test in this package, which drives `history`
// itself.
describe('router.navigate() writes back through the adapter, in both modes (B1)', () => {
  it('composed mode: navigate() reaches the occupant own entry', async () => {
    const adapter = resetRealm(COMPOSED_URL);
    const history = adaptProviderHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    const router = createProviderRouter(buildRouteTreeWithTwoRoutes(), history);
    await router.load();

    await router.navigate({ to: '/settings/profile' });

    // `navigate({ to })` with no `search` option does not carry the
    // previous search forward — TanStack's own behavior, not this
    // adapter's — so the write reaches only the occupant's own entry, with
    // its `route` parameter updated and `orientation` dropped.
    expect(adapter.lastWrite).toBe('/en?screen=dashboard;route=settings/profile');
    expect(router.state.location.pathname).toBe('/settings/profile');
  });

  it('standalone mode: navigate() reaches the page own address', async () => {
    const adapter = resetRealm(STANDALONE_URL);
    const history = adaptProviderHistory(resolveNavigationHistory(), undefined);
    const router = createProviderRouter(buildRouteTreeWithTwoRoutes(), history);
    await router.load();

    await router.navigate({ to: '/settings/profile' });

    expect(adapter.lastWrite).toBe('/settings/profile');
    expect(router.state.location.pathname).toBe('/settings/profile');
  });
});

describe('an undeclared route= path resolves to the engine own notFound identically in both modes', () => {
  it('composed mode resolves an undeclared path to this router own notFound match', async () => {
    resetRealm('/en?screen=dashboard;route=settings/unknown');
    const history = adaptProviderHistory(resolveNavigationHistory(), DASHBOARD_ENTRY_ADDRESS);
    const router = createProviderRouter(buildRouteTreeWithNotFound(), history);

    await router.load();

    expect(router.state.matches.some((match) => match._notFound === true)).toBe(true);
  });

  it('standalone mode resolves the identical undeclared path to the same notFound match', async () => {
    resetRealm('/settings/unknown');
    const history = adaptProviderHistory(resolveNavigationHistory(), undefined);
    const router = createProviderRouter(buildRouteTreeWithNotFound(), history);

    await router.load();

    expect(router.state.matches.some((match) => match._notFound === true)).toBe(true);
  });
});
