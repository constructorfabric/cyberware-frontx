/**
 * Name Validity And Equality — `cpt-frontx-algo-routing-navigation-substrate-name-validity`.
 *
 * FEATURE (navigation-substrate) §3, "Name Validity And Equality"; ADR 0003,
 * "Tokens" (the `name` production this alphabet enforces).
 */
import type {
  DeriveExtensionToken,
  DomainKey,
  ExtensionToken,
  NamesEqual,
  ValidateName,
} from '../types/index.js';

/** `name = lower ( lower | digit | "-" )*` (ADR 0003, "Tokens"). */
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1
// @cpt-dod:cpt-frontx-dod-routing-navigation-substrate-shared-history:p1

/** Validity (a) — FEATURE §3, step 1. */
// @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-validate-name
export const validateName: ValidateName = (candidate) => NAME_PATTERN.test(candidate);
// @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-validate-name

/**
 * Extension-token derivation (b) — FEATURE §3, steps 2-3.
 *
 * Returns `undefined` for "not routable" rather than a sentinel string:
 * a string like `'not-routable'` is itself a valid `name` an occupant could
 * legitimately register as its own route, so it would collide with a real
 * extension token instead of unambiguously marking the absent/invalid case.
 */
export const deriveExtensionToken: DeriveExtensionToken = (route) => {
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-if-no-route
  if (route === undefined) {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-return-not-routable-absent
    return undefined;
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-return-not-routable-absent
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-if-no-route

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-strip-leading-slash
  const candidate = route.startsWith('/') ? route.slice(1) : route;
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-strip-leading-slash

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-if-candidate-valid
  if (validateName(candidate)) {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-return-token
    return candidate as ExtensionToken;
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-return-token
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-if-candidate-valid

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-else-candidate-invalid
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-return-not-routable-invalid
  return undefined;
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-return-not-routable-invalid
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-else-candidate-invalid
};

/** Equality (c) — FEATURE §3, step 4: character-by-character, no decoding. */
// @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-name-equality
export const namesEqual: NamesEqual = (a, b) => a === b;
// @cpt-end:cpt-frontx-algo-routing-navigation-substrate-name-validity:p1:inst-name-equality

/**
 * The `domain-key` production: `name`, or `domain-key "." extension "." name`
 * — an odd `.`-separated segment count, every segment a valid `name` (ADR
 * 0003, "Tokens"). Shared, unmarked infrastructure: this check is not itself
 * a numbered CDSL instruction — it is invoked *by* one at each of its three
 * call sites (Grammar Parse step 5.2, Grammar Serialize step 1.1, Domain-Key
 * Composition step 1), where the marker belongs.
 */
export function isValidDomainKey(candidate: string): candidate is DomainKey {
  const segments = candidate.split('.');
  return segments.length % 2 === 1 && segments.every((segment) => validateName(segment));
}
