// Location-Preserving Navigation Helper
// `cpt-frontx-algo-routing-engine-provider-index-redirect`.
//
// FEATURE (engine-provider) §3, "Location-Preserving Navigation Helper".
// Reusable by any consumer redirect within the occupant's own virtual
// location — an index-route redirect is one call site, not the only one
// (§3, Rationale).
import { redirect, type RedirectOptions, type RouterHistory } from '@tanstack/react-router';

/** @internal Test/consumer seam mirroring this file's own default hash
 * reader: a conforming consumer never passes this except to avoid touching
 * `window` in a test, exactly like `history-adaptation.ts`'s own
 * `defaultReportError`. The page's own hash is unaffected by whether this
 * occupant is composed or standalone (FEATURE §3, Location-Preserving
 * Navigation Helper, Input: "the hash the navigation substrate copies
 * verbatim on every read and write is the page's own"), so this default
 * reads `window.location.hash` directly, stripped of its leading `#` — the
 * grammar's own convention for a hash value (routing FEATURE §1.5). */
function defaultReadPageHash(): string {
  return typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';
}

/**
 * Turns a raw `?a=b&c=d`-shaped search string (`RouterHistory#location`'s
 * own `search` member) into the plain key/value object TanStack's own
 * `redirect`/navigate `search` option expects — the identical
 * generic-`name=value` treatment `./virtual-location.ts`'s own
 * `buildSearchString`/`parseSearchString` pair gives TanStack's search
 * string everywhere else in this package: an opaque string this adapter
 * never re-parses beyond that.
 */
function searchStringToRecord(search: string): Record<string, string> {
  const trimmed = search.startsWith('?') ? search.slice(1) : search;
  if (trimmed === '') {
    return {};
  }
  return Object.fromEntries(
    trimmed.split('&').map((pair) => {
      const eq = pair.indexOf('=');
      return eq === -1
        ? [decodeURIComponent(pair), '']
        : [decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1))];
    }),
  );
}

/**
 * Builds a `redirect` to `targetPath`, carrying `history`'s own current
 * virtual-location search and the page's own current hash forward onto it
 * — rather than requiring every caller to assemble that carry-forward
 * itself (FEATURE §3, steps 1-4).
 *
 * `targetPath` is interpreted against this occupant's own virtual location
 * (step 1) — `history` is the adapted `RouterHistory` this occupant's own
 * engine provider already constructed
 * (`cpt-frontx-algo-routing-engine-provider-history-adaptation`), so
 * `targetPath` never reaches the composed-application URL directly.
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-index-redirect:p2
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-redirect-and-standalone:p1
export function locationPreservingRedirect(history: RouterHistory, targetPath: string, options: { readPageHash?: () => string } = {}) {
  const readPageHash = options.readPageHash ?? defaultReadPageHash;

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-read-current-search-hash
  const currentSearch = history.location.search;
  const currentHash = readPageHash();
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-read-current-search-hash

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-accept-target-path
  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-carry-search-hash
  // The search is carried forward as given, not merged with the target
  // route's own declared search shape — a full carry-forward, matching
  // this helper's own instance of the substrate's own explicit-carry-only
  // convention (§3, Rationale). `search`/`hash` are typed against
  // `MakeOptionalSearchParams`/`Updater`, both keyed to a registered route
  // tree this package-level helper does not have (it is reusable by any
  // consumer's own route tree, never bound to one) — the one cast this
  // file needs, routed through `unknown` as the compiler itself suggests,
  // for the identical reason `router-creation.tsx`'s own single cast
  // exists: a conditional type TypeScript cannot resolve generically, only
  // against a concrete route tree the caller supplies at its own call
  // site.
  const redirectOptions = {
    to: targetPath,
    search: searchStringToRecord(currentSearch),
    hash: currentHash,
  } as unknown as RedirectOptions;
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-carry-search-hash
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-accept-target-path

  // @cpt-begin:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-return-redirect
  return redirect(redirectOptions);
  // @cpt-end:cpt-frontx-algo-routing-engine-provider-index-redirect:p2:inst-return-redirect
}
