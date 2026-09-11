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

// N3 (review round 16-re4): `AdapterLocation`/`HistoryAdapter` are
// `resolveNavigationHistory`'s own `createAdapter` parameter and its return
// type — the `HistoryAdapter` seam (FEATURE §3) — so they cannot be marked
// compiler-internal at all: N2 (review round 16-re3) tagged them that way
// instead of leaving them untagged and unexported, on the theory that
// neither type was part of this package's public surface; `stripInternal`
// then dropped `resolveNavigationHistory`'s own declaration wholesale,
// because TypeScript's internal-declaration handling tests a declaration's
// *own* leading JSDoc, and a `@param` carrying that same tag inside that
// JSDoc is enough to strip the function it documents, not just the
// parameter. (This file's own prose avoids spelling that tag literally —
// TypeScript's own `stripInternal` compiler option, which `tsup`'s
// declaration step invokes rather than implementing itself, tests every
// leading comment range of a declaration — including a plain `//` block, not
// only JSDoc — as a plain substring match, and drops whatever declaration a
// literal mention of it precedes.) Both types
// are re-exported here as types only (`export type`, never a runtime value
// — neither carries one) so a caller can name `HistoryAdapter`'s shape when
// supplying its own `createAdapter`.
export type { AdapterLocation, HistoryAdapter } from './adapter.js';
