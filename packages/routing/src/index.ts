// @gears-frontx/routing — package entry point.
//
// This package's public surface is specified by two FEATUREs
// (packages/routing/architecture/features/):
//
//   - navigation-substrate    (cpt-frontx-feature-routing-navigation-substrate)
//   - route-ownership-signal  (cpt-frontx-feature-routing-route-ownership-signal)
//
// Every export below is grouped by the FEATURE section that specifies it;
// `export type *` for `./types` (rather than `export *`) guarantees that
// re-export erases entirely at compile time — the type contracts carry no
// runtime footprint of their own, only the grouped exports beneath them do.
export type * from './types/index.js';

// Navigation Substrate — history half (`cpt-frontx-feature-routing-navigation-substrate`,
// DoD `cpt-frontx-dod-routing-navigation-substrate-shared-history` /
// `cpt-frontx-dod-routing-navigation-substrate-imperative-navigation`).
//
// `resolveNavigationHistory` alone — not `createNavigationHistory` or
// `createWindowHistoryAdapter` — is this package's own public construction
// path (DESIGN §3.3, public surface); see `./history/index.ts` for why.
// `HistoryAdapter` and `AdapterLocation` (its own return/parameter type) are
// not re-exported here (N2, review round 16-re3): see `./history/index.ts`'s
// own comment for why an `@internal` re-export could not be relied on to
// strip from the published `dist/index.d.ts`.
export { resolveNavigationHistory } from './history/index.js';

// URL grammar codec (`cpt-frontx-feature-routing-navigation-substrate` §3:
// Grammar Parse, Grammar Serialize, Name Validity And Equality,
// Domain-Key Composition).
export * from './errors.js';
// Named exports, not `export *`: `isValidDomainKey` is shared, unmarked
// infrastructure internal to the grammar codec (see its own doc comment in
// `./grammar/name.js`), not part of this package's public surface.
export { deriveExtensionToken, namesEqual, validateName } from './grammar/name.js';
export * from './grammar/compose.js';
export * from './grammar/parse.js';
export * from './grammar/serialize.js';

// Route Ownership Signal (`cpt-frontx-feature-routing-route-ownership-signal`,
// DoD `cpt-frontx-dod-routing-route-ownership-signal-resolution-and-observation`
// / `cpt-frontx-dod-routing-route-ownership-signal-release` /
// `cpt-frontx-dod-routing-route-ownership-signal-url-back-projection`) —
// entry resolution, and `createRouteSignal` (F1: the `history`-bound
// construction path for the observable transition signal and the URL
// back-projection helper — see `./signal/route-signal.js` for why the
// previous unbound `createObserver`/`backProjectEntries` exports are gone,
// with no compatibility shim left in their place).
export * from './signal/entry-resolution.js';
export * from './signal/route-signal.js';
