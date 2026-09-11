/**
 * Grammar Serialize — `cpt-frontx-algo-routing-navigation-substrate-grammar-serialize`.
 *
 * FEATURE (navigation-substrate) §3, "Grammar Serialize"; ADR 0003, "URL
 * Grammar" / "Entry".
 */
import { RoutingError } from '../errors.js';
import type { SerializeGrammar } from '../types/index.js';
import { isValidDomainKey, validateName } from './name.js';
import { encodePercent } from './percent-codec.js';

// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1
// @cpt-dod:cpt-frontx-dod-routing-navigation-substrate-shared-history:p1
export const serializeGrammar: SerializeGrammar = (input) => {
  const { shellSubroute, hash, entries } = input;

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-foreach-entry-validate
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-invalid-tokens
    if (!isValidDomainKey(entry.domainKey)) {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-invalid-tokens
      throw RoutingError.invalidDomainKey(entry.domainKey, entry);
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-invalid-tokens
    }
    if (!validateName(entry.extension)) {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-invalid-tokens
      throw RoutingError.invalidExtensionToken(entry.extension, entry);
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-invalid-tokens
    }
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-invalid-tokens

    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-duplicate-param-name
    const seenParamNames = new Set<string>();
    for (const param of entry.params) {
      if (seenParamNames.has(param.name)) {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-duplicate-param
        throw RoutingError.duplicateParamName(entry);
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-duplicate-param
      }
      seenParamNames.add(param.name);
    }
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-duplicate-param-name

    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-duplicate-extension-serialize
    // Index-based scan (`j < i`), not a reference-identity check against
    // `entry` — the input list may legitimately carry the identical `Entry`
    // object at two positions (e.g. a back-projection reorder that reused
    // one survivor object), and a reference-identity check would skip
    // straight past every earlier element without ever comparing them.
    for (let j = 0; j < i; j += 1) {
      const earlier = entries[j];
      if (earlier.domainKey === entry.domainKey && earlier.extension === entry.extension) {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-duplicate-extension
        throw RoutingError.duplicateExtension([earlier, entry]);
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-throw-duplicate-extension
      }
    }
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-duplicate-extension-serialize
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-foreach-entry-validate

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-foreach-entry-build
  const entryTexts = entries.map((entry) => {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-build-head
    let text = `${entry.domainKey}=${entry.extension}`;
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-build-head

    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-foreach-param-build
    for (const param of entry.params) {
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-append-param-name
      text += `;${encodePercent(param.name)}`;
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-append-param-name

      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-nonempty-value
      // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-append-bare
      if (param.value !== '') {
        // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-append-param-value
        text += `=${encodePercent(param.value)}`;
        // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-append-param-value
      }
      // else: append nothing further — a bare name is already a complete,
      // empty-valued param once no `=` was appended. Co-located with the
      // enclosing `if`: the branch this step names has no code of its own
      // beyond falling through.
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-append-bare
      // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-nonempty-value
    }
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-foreach-param-build

    return text;
  });
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-foreach-entry-build

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-join-entries
  const joined = entryTexts.join('&');
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-join-entries

  // `hash !== undefined && hash !== ''` (not just `!== undefined`) at both
  // return sites below: parse always normalizes an empty hash to
  // `undefined` before it ever reaches serialize (see `parse.ts`), but a
  // caller building `SerializeInput` directly — never routed through
  // parse — could still pass `{ hash: '' }`; without this guard that would
  // write a bare trailing `#` for a URL that carries no fragment at all.
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-zero-entries
  if (entries.length === 0) {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-return-bare-subroute
    return hash !== undefined && hash !== '' ? `${shellSubroute}#${hash}` : shellSubroute;
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-return-bare-subroute
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-if-zero-entries

  // Reached only when the zero-entries branch above did not return — the
  // implicit else of step 5.
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-else-nonzero-entries
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-return-full-url
  return hash !== undefined && hash !== ''
    ? `${shellSubroute}?${joined}#${hash}`
    : `${shellSubroute}?${joined}`;
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-return-full-url
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-grammar-serialize:p1:inst-else-nonzero-entries
};
