// Composed-mode virtual-location source: reads and writes one occupant's
// own entry, addressed by `{domainKey, extension}`, inside a larger
// composed-application URL. The standalone-mode source (projecting directly
// onto the page's own pathname/search, no entry involved) is a separate
// algorithm — `cpt-frontx-algo-routing-engine-provider-standalone-deployment`
// — not implemented here.
//
// FEATURE (engine-provider) §3, "History Adaptation To The RouterHistory
// Contract", steps 1 (entry resolution), 2 (write-back), 4 (`createHref`).
import {
  namesEqual,
  parseGrammar,
  serializeGrammar,
  backProjectEntries,
  type Entry,
  type EntryAddress,
  type NavigationHistory,
  type HistoryVerb,
} from '@gears-frontx/routing';
import { adaptVirtualLocationHistory, type VirtualLocationSource } from './history-adaptation.js';
import { projectVirtualLocationToParams } from './virtual-location.js';
import type { RouterHistory } from '@tanstack/react-router';

/**
 * Parses `navigationHistory`'s own current location and selects, from the
 * resulting entry list, the one entry whose own `{domainKey, extension}`
 * equals `entryAddress` — equality checked with the navigation substrate's
 * own name-equality predicate on each field, never by asking the route
 * ownership signal to resolve an owner (FEATURE §3, step 1: "this provider
 * never performs, and never depends on, entry resolution").
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2
// @cpt-dod:cpt-frontx-dod-routing-engine-provider-adaptation-and-creation:p1
// @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location
function resolveOwnEntry(navigationHistory: NavigationHistory, entryAddress: EntryAddress): Entry | undefined {
  const { path, search, hash } = navigationHistory.location;
  const { entries } = parseGrammar({ shellSubroute: path, search, hash });
  return entries.find(
    (entry) => namesEqual(entry.domainKey, entryAddress.domainKey) && namesEqual(entry.extension, entryAddress.extension),
  );
}
// @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location

/**
 * Builds a `VirtualLocationSource` (`./history-adaptation.js`) addressed at
 * one occupant's own entry: reading re-resolves that entry on every call
 * (`undefined` when it is currently absent — FEATURE §3, step 7); writing
 * issues exactly one call to the core's own URL back-projection helper,
 * naming this occupant's own entry address and its full new parameter list
 * — never a sibling's entry, another domain's entry, or the shell subroute.
 */
export function createComposedVirtualLocationSource(
  navigationHistory: NavigationHistory,
  entryAddress: EntryAddress,
): VirtualLocationSource {
  return {
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members
    readParams: () => resolveOwnEntry(navigationHistory, entryAddress)?.params,

    // Because `payloadChanged` replaces an entry's entire parameter list
    // rather than merging into it, any parameter of this occupant's own
    // entry that is not `route` and not a member of TanStack's own current
    // search is dropped here for free — the new list is built purely from
    // the virtual location just navigated to (FEATURE §3, step 2).
    //
    // A5: once this occupant's own entry is no longer present in the URL
    // (step 7's own absent-entry case), there is nothing of its own left to
    // write to — issuing `backProjectEntries` anyway would still write
    // *something* (the unchanged URL, since there is no matching entry for
    // `payloadChanged` to touch), a spurious history entry and a spurious
    // fan-out round for every other subscriber over a navigation that
    // changes nothing (FEATURE §3, step 7.1: "no write-back runs, because
    // there is no longer an entry of this occupant's own to write to").
    write: (pathname: string, search: string, verb: HistoryVerb): void => {
      if (resolveOwnEntry(navigationHistory, entryAddress) === undefined) {
        return;
      }
      const params = projectVirtualLocationToParams(pathname, search);
      backProjectEntries(entryAddress.domainKey, { payloadChanged: [{ extension: entryAddress.extension, params }] }, verb);
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-create-href
    // Composes the full composed-application URL by calling the navigation
    // substrate's own grammar serializer over the current entry list with
    // this occupant's own entry replaced by the one the target virtual
    // location projects back to — never by concatenating path fragments
    // (FEATURE §3, step 4).
    createHref: (pathname: string, search: string): string => {
      const newParams = projectVirtualLocationToParams(pathname, search);
      const { shellSubroute, hash, entries } = parseGrammar({
        shellSubroute: navigationHistory.location.path,
        search: navigationHistory.location.search,
        hash: navigationHistory.location.hash,
      });
      const updatedEntries = entries.map((entry) =>
        namesEqual(entry.domainKey, entryAddress.domainKey) && namesEqual(entry.extension, entryAddress.extension)
          ? { domainKey: entry.domainKey, extension: entry.extension, params: newParams }
          : entry,
      );
      return serializeGrammar({ shellSubroute, hash, entries: updatedEntries });
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-create-href
  };
}

/**
 * Convenience composition of `createComposedVirtualLocationSource` and
 * `adaptVirtualLocationHistory` (`./history-adaptation.js`) — this task's
 * own public entry point for the composed case (an entry address is always
 * supplied). The standalone case (no entry address) is a different
 * algorithm this package does not yet implement
 * (`cpt-frontx-algo-routing-engine-provider-standalone-deployment`).
 */
export function adaptComposedHistory(navigationHistory: NavigationHistory, entryAddress: EntryAddress): RouterHistory {
  return adaptVirtualLocationHistory(navigationHistory, createComposedVirtualLocationSource(navigationHistory, entryAddress));
}
