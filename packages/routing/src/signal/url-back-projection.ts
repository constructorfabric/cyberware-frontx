/**
 * URL Back-Projection Helper Via Own-Key Rewrite —
 * `cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`.
 *
 * FEATURE (route-ownership-signal) §3, "URL Back-Projection Helper Via
 * Own-Key Rewrite"; DoD `cpt-frontx-dod-routing-route-ownership-signal-url-back-projection`.
 *
 * The single write path: parse the current location, apply the caller's
 * delta to one domain key's own entries (in place, at their existing
 * position), remove the structural-reset subtree of every removed or
 * replaced extension token, serialize the result, and issue exactly one
 * `push`/`replace` call against the shared history — never more than one,
 * regardless of how many subtree entries a structural reset removes.
 */
import { RoutingError } from '../errors.js';
import { isValidDomainKey, validateName } from '../grammar/name.js';
import { parseGrammar } from '../grammar/parse.js';
import { serializeGrammar } from '../grammar/serialize.js';
import { resolveNavigationHistory } from '../history/singleton.js';
import type {
  BackProjectEntries,
  BackProjectionDelta,
  DomainKey,
  Entry,
  ExtensionToken,
} from '../types/index.js';

/**
 * Validates the domain key and every extension token any of the delta's
 * five operations names — the added list, removed list, the old and new
 * extension of every replaced pair, the payload-changed list's own
 * extension tokens, and the reordered list. ADR 0003, "Occupant Identity
 * Lexical Rule" ("the URL back-projection helper, where each delta names an
 * entry carrying an extension token") is a MUST that covers every one of
 * the delta's five operations, payload-changed included, not only the four
 * FEATURE §3 step 1.1 names by enumeration — the ADR is normative where the
 * two differ.
 */
function validateBackProjectionInput(
  domainKey: string,
  delta: BackProjectionDelta,
): asserts domainKey is DomainKey {
  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-validate-back-projection-tokens
  if (!isValidDomainKey(domainKey)) {
    throw RoutingError.invalidDomainKey(domainKey);
  }
  for (const added of delta.added ?? []) {
    if (!validateName(added.extension)) {
      throw RoutingError.invalidExtensionToken(added.extension);
    }
  }
  for (const removed of delta.removed ?? []) {
    if (!validateName(removed)) {
      throw RoutingError.invalidExtensionToken(removed);
    }
  }
  for (const pair of delta.payloadChanged ?? []) {
    if (!validateName(pair.extension)) {
      throw RoutingError.invalidExtensionToken(pair.extension);
    }
  }
  for (const pair of delta.replaced ?? []) {
    if (!validateName(pair.oldExtension)) {
      throw RoutingError.invalidExtensionToken(pair.oldExtension);
    }
    if (!validateName(pair.entry.extension)) {
      throw RoutingError.invalidExtensionToken(pair.entry.extension);
    }
  }
  for (const token of delta.reordered ?? []) {
    if (!validateName(token)) {
      throw RoutingError.invalidExtensionToken(token);
    }
  }
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-validate-back-projection-tokens
}

// @cpt-algo:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2
// @cpt-dod:cpt-frontx-dod-routing-route-ownership-signal-url-back-projection:p1
export const backProjectEntries: BackProjectEntries = (domainKey, delta, verb) => {
  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-consumer-calls-helper
  validateBackProjectionInput(domainKey, delta);
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-consumer-calls-helper

  const history = resolveNavigationHistory();

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-parse-current
  const location = history.location;
  const parsed = parseGrammar({
    shellSubroute: location.path,
    search: location.search,
    hash: location.hash,
  });
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-parse-current

  const removedTokens = new Set(delta.removed ?? []);
  const replacedByOldExtension = new Map(
    (delta.replaced ?? []).map((pair) => [pair.oldExtension, pair.entry] as const),
  );
  const payloadByExtension = new Map(
    (delta.payloadChanged ?? []).map((pair) => [pair.extension, pair.params] as const),
  );

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-compose-own-entries
  // Every index in the currently parsed full list carrying this domain
  // key — its own existing position is what every transformation below
  // preserves; nothing here regroups this domain's own entries into a
  // contiguous block (Rationale, "This domain key's own entries are never
  // regrouped").
  const ownIndices: number[] = [];
  parsed.entries.forEach((entry, index) => {
    if (entry.domainKey === domainKey) {
      ownIndices.push(index);
    }
  });

  // `null` marks an own-key position removed outright (a plain removal);
  // any other `Entry` is what survives at that same position, unchanged,
  // payload-updated, or replaced.
  const transformedByIndex = new Map<number, Entry | null>();
  for (const index of ownIndices) {
    const entry = parsed.entries[index];
    const extension = entry.extension;

    const replacement = replacedByOldExtension.get(extension);
    if (replacement !== undefined) {
      transformedByIndex.set(index, {
        domainKey,
        extension: replacement.extension,
        params: replacement.params,
      });
      continue;
    }
    if (removedTokens.has(extension)) {
      transformedByIndex.set(index, null);
      continue;
    }

    const changedParams = payloadByExtension.get(extension);
    if (changedParams !== undefined) {
      transformedByIndex.set(index, { domainKey, extension, params: changedParams });
      continue;
    }

    transformedByIndex.set(index, entry);
  }

  // Reorder: reassign the entries surviving the transformations above to
  // the identical set of positions this domain's own entries already
  // occupy, in the caller's given relative order — keyed by each
  // survivor's own *current* extension token, since `reordered` never also
  // renames a token (that is what `replaced` does, as a distinct
  // operation).
  if (delta.reordered !== undefined) {
    const survivingIndices = ownIndices.filter((index) => transformedByIndex.get(index) !== null);
    const survivorByCurrentExtension = new Map<ExtensionToken, Entry>();
    for (const index of survivingIndices) {
      const survivor = transformedByIndex.get(index);
      // Every index in `ownIndices` was set exactly once in the loop above
      // (to an `Entry` or to `null`), and `survivingIndices` already
      // excludes `null`, so `survivor` is always an `Entry` here at
      // runtime — `Map#get`'s own return type still includes `undefined`
      // for "key absent", which this check satisfies for the compiler.
      if (survivor !== undefined && survivor !== null) {
        survivorByCurrentExtension.set(parsed.entries[index].extension, survivor);
      }
    }

    // `reordered` must be exactly a permutation of this domain's own
    // surviving tokens (a bijection: same size, no duplicate, nothing
    // outside the surviving set) — otherwise a duplicated or dropped token
    // would silently reuse the identical `Entry` object at two positions, or
    // silently drop a survivor the caller never asked to remove.
    const reorderedTokenSet = new Set(delta.reordered);
    const isPermutation =
      delta.reordered.length === survivorByCurrentExtension.size &&
      reorderedTokenSet.size === survivorByCurrentExtension.size &&
      delta.reordered.every((token) => survivorByCurrentExtension.has(token));
    if (!isPermutation) {
      throw RoutingError.reorderedNotPermutation(domainKey, delta.reordered);
    }

    // The permutation check just above guarantees every token in
    // `delta.reordered` is a key of `survivorByCurrentExtension`, so this
    // lookup is never `undefined` in practice — the assertion documents
    // that guarantee rather than working around an unproven one.
    const newOrder = delta.reordered.map((token) => survivorByCurrentExtension.get(token) as Entry);
    survivingIndices.forEach((index, position) => {
      transformedByIndex.set(index, newOrder[position]);
    });
  }
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-compose-own-entries

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-foreach-removed-token
  // Structural reset applies only to a removed or replaced extension's own
  // subtree — never to a token named only in a payload change or a
  // reorder (Rationale, "the grammar's own edge rule").
  const structuralResetPrefixes = [
    ...removedTokens,
    ...replacedByOldExtension.keys(),
  ].map((token) => `${domainKey}.${token}.`);
  // The actual removal happens in the single full-list pass below (step 5,
  // `inst-structural-reset-subtree`), in the same history write as the
  // own-key rewrite — `structuralResetPrefixes` is this step's own output,
  // consulted there.
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-foreach-removed-token

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-compose-full-list
  const composed: Entry[] = [];
  parsed.entries.forEach((entry, index) => {
    if (transformedByIndex.has(index)) {
      const transformed = transformedByIndex.get(index);
      if (transformed !== null && transformed !== undefined) {
        composed.push(transformed);
      }
      return;
    }
    // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-structural-reset-subtree
    if (structuralResetPrefixes.some((prefix) => entry.domainKey.startsWith(prefix))) {
      return;
    }
    // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-structural-reset-subtree
    composed.push(entry);
  });
  for (const added of delta.added ?? []) {
    composed.push({ domainKey, extension: added.extension, params: added.params });
  }
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-compose-full-list

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-serialize
  const serialized = serializeGrammar({
    shellSubroute: parsed.shellSubroute,
    hash: parsed.hash,
    entries: composed,
  });
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-serialize

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-call-history
  history[verb](serialized);
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-call-history

  // @cpt-begin:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-return-reflected
  return;
  // @cpt-end:cpt-frontx-algo-routing-route-ownership-signal-url-back-projection:p2:inst-return-reflected
};
