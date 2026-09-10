/**
 * Entry Resolution — `cpt-frontx-algo-routing-route-ownership-signal-entry-resolution`.
 *
 * FEATURE (route-ownership-signal) §3, "Entry Resolution".
 */
import { namesEqual } from '../grammar/name.js';
import type { ResolveEntries } from '../types/index.js';

// @cpt-algo:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2
export const resolveEntries: ResolveEntries = (domainKey, entries, source) => {
  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-filter-by-domain-key
  const filtered = entries.filter((entry) => entry.domainKey === domainKey);
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-filter-by-domain-key

  const registrations = source.getRegistrations();

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-foreach-filtered-entry
  const resolved = filtered.map((entry) => {
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-if-extension-matches
    const registration = registrations.find((candidate) =>
      namesEqual(candidate.extension, entry.extension),
    );
    if (registration !== undefined) {
      // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-pair-resolved
      return {
        extension: entry.extension,
        params: entry.params,
        resolution: { resolved: true as const, routeOwner: registration.routeOwner },
      };
      // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-pair-resolved
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-if-extension-matches

    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-else-no-match
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-pair-unresolved
    return {
      extension: entry.extension,
      params: entry.params,
      resolution: { resolved: false as const },
    };
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-pair-unresolved
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-else-no-match
  });
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-foreach-filtered-entry

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-return-resolution
  return resolved;
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-entry-resolution:p2:inst-return-resolution
};
