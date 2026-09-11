// The two presence checks `dist-internal.test.ts` runs against a built
// `dist/index.d.ts` — pulled out here (LOW, review round 16-re5) so they can
// be unit-tested on their own against fixture strings (`surface-check.test.ts`)
// rather than only ever exercised end-to-end through a real `tsup` build.
// That is the only way left to prove a missing export actually fails this
// check, now that `helpers.ts`'s own surface lists are pinned as complete
// (MEDIUM, review round 16-re5) — a mutation of the checked-in build output
// itself is not something a test in this repository can perform.

/** Whether `dts` exports `name` as a runtime value, via the bundler's own
 * `export { ... }` list (rollup-dts's declaration bundling always emits one
 * such statement per module, never several inline `export const`s). */
export function declaresRuntimeExport(dts: string, name: string): boolean {
  return new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b`, 'm').test(dts);
}

// LOW (review round 16-re5): the previous version of this check only
// recognised `declare type`/`declare interface`/a bare `type X =` — never a
// bare `interface X {` with no `declare` keyword, which is exactly the form
// rollup-dts emits for every interface this package publishes (e.g.
// `dist/index.d.ts`'s own `interface HistoryAdapter {`, `interface
// RouteSignal {`). The assertion this fed only ever passed via the
// `exported` fallback below, so the "declared" half of this check was dead
// code for every interface pinned today — fixed by accepting `interface`/
// `type`/`function`/`const`/`class`, each optionally preceded by `export`
// and/or `declare` in either order rollup-dts or `tsc` might emit them in.
const DECLARATION_KEYWORDS = 'interface|type|function|const|class';

/** Whether `dts` declares `name` as a type-level construct — an
 * `interface`/`type` alias declared directly (with or without a leading
 * `export`/`declare`), or re-exported by name (plain or `type`-qualified)
 * through a bundler's own `export { ... }` list. */
export function declaresType(dts: string, name: string): boolean {
  const declared = new RegExp(`\\b(?:export\\s+)?(?:declare\\s+)?(?:${DECLARATION_KEYWORDS})\\s+${name}\\b`).test(
    dts,
  );
  const exported =
    new RegExp(`^export\\s*\\{[^}]*\\btype\\s+${name}\\b`, 'm').test(dts) ||
    new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b`, 'm').test(dts);
  return declared || exported;
}
