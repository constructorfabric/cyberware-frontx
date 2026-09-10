/**
 * Domain-Key Composition — `cpt-frontx-algo-routing-navigation-substrate-domain-key-compose`.
 *
 * FEATURE (navigation-substrate) §3, "Domain-Key Composition".
 */
import { RoutingError } from '../errors.js';
import type { ComposeDomainKey, DomainKey } from '../types/index.js';
import { isValidDomainKey, validateName } from './name.js';

// @cpt-algo:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1
// @cpt-dod:cpt-frontx-dod-routing-navigation-substrate-shared-history:p1
export const composeDomainKey: ComposeDomainKey = (parentDomainKey, parentExtension, name) => {
  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-if-invalid-parent-key
  if (!isValidDomainKey(parentDomainKey)) {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-throw-invalid-parent-key
    throw RoutingError.invalidDomainKey(parentDomainKey);
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-throw-invalid-parent-key
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-if-invalid-parent-key

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-if-invalid-parent-extension
  if (!validateName(parentExtension)) {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-throw-invalid-parent-extension
    throw RoutingError.invalidExtensionToken(parentExtension);
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-throw-invalid-parent-extension
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-if-invalid-parent-extension

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-if-invalid-name
  if (!validateName(name)) {
    // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-throw-invalid-name
    throw RoutingError.invalidName(name);
    // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-throw-invalid-name
  }
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-if-invalid-name

  // @cpt-begin:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-return-composed-key
  return `${parentDomainKey}.${parentExtension}.${name}` as DomainKey;
  // @cpt-end:cpt-frontx-algo-routing-navigation-substrate-domain-key-compose:p1:inst-return-composed-key
};
