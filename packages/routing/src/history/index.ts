// Public surface of the history half of the Navigation Substrate
// (`cpt-frontx-feature-routing-navigation-substrate`, DoD
// `cpt-frontx-dod-routing-navigation-substrate-shared-history` and
// `cpt-frontx-dod-routing-navigation-substrate-imperative-navigation`).
//
// The grammar codec half of this FEATURE (`grammar-parse`/`grammar-serialize`
// /name-validity/domain-key-composition) lives in `../grammar/` and is
// re-exported from `../index.ts` on its own.
//
// `createNavigationHistory` and `createWindowHistoryAdapter` are
// deliberately NOT re-exported here (DESIGN §3.3, public surface):
// `resolveNavigationHistory` — the realm-shared singleton resolver — is the
// one construction path a consumer is meant to reach;
// `createNavigationHistory`/`createWindowHistoryAdapter` are internal
// building blocks a test reaches by importing
// `./navigation-history.js`/`./adapter.js` directly, never through this
// package's own public entry point.
export { resolveNavigationHistory } from './singleton.js';
/** @internal Test seam — see the module comment above and the
 * `HistoryAdapter` interface declaration in `./adapter.js`. Import
 * `./adapter.js` directly rather than relying on this type being re-exported
 * from the package's own public entry point. */
export type { HistoryAdapter } from './adapter.js';
