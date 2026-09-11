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

// N2 (review round 16-re3): `AdapterLocation`/`HistoryAdapter` used to be
// re-exported here under an `@internal` tag, relying on `tsup`'s dts bundler
// to strip the tag from the published `dist/index.d.ts`. It never did —
// `stripInternal` only strips a declaration where it is itself written, and
// a multi-file re-export chain (`./adapter.js` -> here -> `../index.ts`)
// carries no tag of its own at either hop, so enabling `stripInternal`
// (`tsconfig.json`) does not touch it; it also produces an unrelated rollup
// break once the upstream declaration IS stripped from a mid-chain file
// (`AdapterLocation is not exported by src/history/index.ts`). The fix is
// the one this file's own module comment above already prescribes for the
// same reason: neither type is part of this package's public surface, so
// they are not re-exported here or from `../index.ts` at all — a test
// (`packages/routing-tanstack`'s own `FakeHistoryAdapter` included) imports
// `./adapter.js` directly.
