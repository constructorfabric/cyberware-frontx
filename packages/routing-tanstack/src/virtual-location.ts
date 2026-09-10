// Virtual-location projection — the pathname/search codec this package's
// default adapter builds on top of one occupant's own entry (or, for a
// standalone deployment, the page's own address directly — a later change,
// not this file's own concern).
//
// FEATURE (engine-provider) §1.1, §1.5, §3 "History Adaptation To The
// RouterHistory Contract".
import type { Param } from '@gears-frontx/routing';

/** The one payload parameter this package's adapter reserves for an
 * occupant's own internal route — this provider's own convention, not a
 * rule the navigation substrate's own grammar imposes (FEATURE §1.1). */
export const ROUTE_PARAM_NAME = 'route';

/** The `{pathname, search}` pair a virtual location carries — no hash of
 * its own (DESIGN §3.1, "Virtual location"; the page's own hash is a
 * location-preserving-helper concern, out of this file's scope). */
export interface VirtualLocationParts {
  readonly pathname: string;
  readonly search: string;
}

// @cpt-algo:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2

/**
 * Projects one occupant's own ordered parameter list into a virtual
 * location: the reserved `route` parameter (first occurrence, by this
 * provider's own convention — the grammar admits a duplicate parameter name
 * without ordering the copies as "canonical" and "shadow") becomes the
 * pathname, with exactly one `/` prepended; every other parameter becomes
 * the search string.
 *
 * FEATURE §3, History Adaptation, step 1.
 */
// @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location
export function projectParamsToVirtualLocation(params: readonly Param[]): VirtualLocationParts {
  const routeParam = params.find((param) => param.name === ROUTE_PARAM_NAME);
  const pathname = `/${routeParam?.value ?? ''}`;
  const search = buildSearchString(params.filter((param) => param.name !== ROUTE_PARAM_NAME));
  return { pathname, search };
}
// @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location

/**
 * The reverse of `projectParamsToVirtualLocation`: builds the entry's own
 * new, full parameter list from a virtual location's pathname and search —
 * `route` first, with exactly one leading `/` stripped off the pathname,
 * then every remaining parameter as given, in the order the search string
 * itself carries them (TanStack's own search-serializer order, since this
 * package treats that string as opaque and never re-parses it beyond
 * splitting it into name/value pairs).
 *
 * FEATURE §3, History Adaptation, step 2 ("`route` first, with exactly one
 * leading `/` stripped ... then every remaining parameter as given").
 */
// @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members
export function projectVirtualLocationToParams(pathname: string, search: string): readonly Param[] {
  const routeValue = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return [{ name: ROUTE_PARAM_NAME, value: routeValue }, ...parseSearchString(search)];
}
// @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members


/**
 * Splits a TanStack-supplied `path` argument (as handed to `push`/`replace`,
 * or accepted by `createHref`) into its pathname/search/hash components.
 * Deliberately not a URL parse — the input is always shell-relative, never
 * carrying an origin — so a plain, dependency-free split on the first `?`
 * and first `#` is enough and keeps this package independent of the exact
 * encoding TanStack's own internals choose for that argument.
 */
export function splitHref(path: string): { pathname: string; search: string; hash: string } {
  const hashIndex = path.indexOf('#');
  const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex + 1);

  const searchIndex = withoutHash.indexOf('?');
  const pathname = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : withoutHash.slice(searchIndex);

  return { pathname, search, hash };
}

/**
 * Builds a `?a=b&c=d`-shaped search string from a virtual location's own
 * non-`route` parameters, on read. Not the navigation substrate's own
 * grammar codec — that codec encodes the composed-application URL's entry
 * syntax (ADR 0003), a structurally different grammar from TanStack's own
 * query-string surface, which this adapter treats as an opaque string it
 * never re-parses beyond generic `name=value` splitting (FEATURE §3, step
 * 1: "this package's own adapter treats as an opaque string").
 */
function buildSearchString(params: readonly Param[]): string {
  if (params.length === 0) {
    return '';
  }
  return `?${params.map((param) => `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`).join('&')}`;
}

/** The reverse of `buildSearchString`, applied to whatever search string
 * TanStack's own router handed this adapter back (via `push`/`replace`'s
 * `path` argument, itself built by TanStack's own search serializer) —
 * generic `name=value` splitting, not the grammar's own percent-codec. */
function parseSearchString(search: string): readonly Param[] {
  const trimmed = search.startsWith('?') ? search.slice(1) : search;
  if (trimmed === '') {
    return [];
  }
  return trimmed.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) {
      return { name: decodeURIComponent(pair), value: '' };
    }
    return { name: decodeURIComponent(pair.slice(0, eq)), value: decodeURIComponent(pair.slice(eq + 1)) };
  });
}
