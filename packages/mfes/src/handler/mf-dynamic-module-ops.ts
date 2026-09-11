/**
 * MFE Dynamic Module Operations — Audited Trust Kernel
 *
 * This file concentrates operations that static analyzers flag as security
 * risks but are safe by construction. It is EXCLUDED from Codacy's security
 * scan (via `.codacy.yaml`) because its patterns trip too many false-positive
 * rules (non-literal RegExp, unsafe dynamic import) despite being provably
 * safe for our inputs.
 *
 * **TRUST BOUNDARY — READ BEFORE EDITING:**
 *
 * This file is the ONLY place where blob-URL `import()` and RegExp
 * construction from interpolated strings are allowed in production source.
 * A custom ESLint rule (`local/trusted-patterns-file`) enforces:
 *
 *   1. Every exported function must have a JSDoc block with `@safety-reviewed`
 *      and `@why` tags explaining why the pattern is safe.
 *   2. No module-level state — only pure function declarations at the top level.
 *   3. No dangerous imports: `fs`, `child_process`, `process.env`, etc.
 *
 * **Scope creep control:** adding a function here should require a security
 * review. If you find yourself tempted to "just add one more helper," STOP.
 * Either prove the helper is safe and document it with `@why`, or put it in a
 * scanned file where Codacy can keep watching it.
 *
 * @packageDocumentation
 */
// @cpt-dod:cpt-frontx-dod-mfe-isolation-blob-core:p1
// @cpt-algo:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1

/**
 * Test whether a source text contains an import of a specific package name.
 * Matches both `from "pkg"` (static imports and re-exports) and `import "pkg"`
 * (side-effect imports). Exact package names only — `react-dom` is not matched
 * by a query for `react`.
 *
 * @safety-reviewed 2026-04-20
 * @why The `packageName` argument is interpolated into a RegExp. All regex
 *      metacharacters are escaped one line above via
 *      `/[.*+?^${}()|[\]\\]/g` → `String.raw\`\\$&\``. The escape covers every
 *      character that has regex meaning; ReDoS requires a pattern capable of
 *      catastrophic backtracking, which the escaped literal cannot produce.
 * @inputs `packageName` ∈ the set of shared dep names declared on the resolved
 *         `MfManifest` contract — bounded, author-declared, not user input.
 */
export function sourceImports(source: string, packageName: string): boolean {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?:from|import)\s*["']${escaped}["']`).test(source);
}

/**
 * Build the regex that matches the exactly two import forms this trust
 * kernel handles, for one exact package name: `from "x"` (static imports/
 * re-exports) and `import "x"` (bare side-effect imports). Quote style is
 * captured (group 2) so callers can preserve it, and the specifier text is
 * captured (group 3). Deliberately does not match `import("x")` (dynamic
 * import) — neither this function's callers rewrite that form, so nothing
 * may assert against it either.
 *
 * `rewriteBareSpecifier` and `findSurvivingDeclaredSharedDepSpecifier` both
 * build on this single per-name pattern so the two can never drift apart:
 * whatever the rewriter can rewrite for a given declared name is exactly
 * what the assertion checks for that name's survival. A generic (no package
 * name) form of this matcher intentionally does not live here — see
 * `findUndeclaredWellFormedSpecifiers` in `mf-shared-dep-specifier-scan.ts`,
 * which needs no interpolation and so carries no trust-kernel residency
 * requirement.
 *
 * @safety-reviewed 2026-04-20
 * @why `packageName` is regex-escaped before interpolation (same escaping
 *      argument as `sourceImports`), so the constructed RegExp cannot be
 *      exploited by adversarial inputs.
 * @inputs `packageName` is a shared dep name from the resolved `MfManifest`
 *         contract — bounded, author-declared, not user input.
 */
export function bareSpecifierPattern(packageName: string): RegExp {
  const specifierPart = packageName.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(
    String.raw`(from|import)(\s*["'])(${specifierPart})(["'])`,
    'g',
  );
}

/**
 * Rewrite a single bare specifier in source text. Handles both static
 * (`from "pkg"`) and side-effect (`import "pkg"`) import forms. Preserves
 * quote style (single or double). Matches exact package names only.
 *
 * @safety-reviewed 2026-04-20
 * @why Same escaping argument as `sourceImports`: `packageName` is
 *      regex-escaped before interpolation, so the constructed RegExp cannot
 *      be exploited by adversarial inputs.
 * @inputs `packageName` in shared dep names from the resolved `MfManifest` contract.
 *         `replacement` is a blob URL produced by `URL.createObjectURL`.
 *         Neither is user input.
 */
// @cpt-algo:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1
export function rewriteBareSpecifier(
  source: string,
  packageName: string,
  replacement: string,
): string {
  // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-shared
  return source.replace(
    bareSpecifierPattern(packageName),
    `$1$2${replacement}$4`,
  );
  // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-shared
}

/**
 * Return the first shared-dependency name the manifest declares that still
 * survives, as a bare specifier, a rewrite of `source` — checked in exactly
 * the same two import forms the rewrite handles, `from "x"` and
 * `import "x"`. This is the exact inverse of a rewrite performed per
 * declared name (see `rewriteBareSpecifier` / `bareSpecifierPattern`), so it
 * cannot mistake ordinary code for an import: it only ever tests for the
 * literal declared names it is given, using the same escaped per-name
 * pattern the rewriter itself uses. A dynamically imported specifier
 * (`import("x")`) is outside this surface and is never matched, because the
 * rewrite does not handle that form either.
 *
 * Undeclared specifiers are out of scope here by construction — only names
 * `declaredNames` supplies are ever tested — see
 * `findUndeclaredWellFormedSpecifiers` in `mf-shared-dep-specifier-scan.ts`
 * for the separate, heuristic, warn-only scan over specifiers the manifest
 * never declared.
 *
 * @safety-reviewed 2026-04-20
 * @why Delegates to `sourceImports`, which regex-escapes each declared name
 *      before interpolation (same escaping argument as `sourceImports`
 *      itself), so the constructed RegExp cannot be exploited by
 *      adversarial inputs.
 * @inputs `source` is shared-dep chunk text already fetched from a
 *         manifest-declared chunk URL — not user input. `declaredNames` is
 *         the set of shared dep names declared on the resolved `MfManifest`
 *         contract — bounded, author-declared, not user input.
 */
// @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-assert-shared-dep-no-bare-specifier
export function findSurvivingDeclaredSharedDepSpecifier(
  source: string,
  declaredNames: Iterable<string>,
): string | undefined {
  for (const name of declaredNames) {
    if (sourceImports(source, name)) {
      return name;
    }
  }
  return undefined;
}
// @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-assert-shared-dep-no-bare-specifier

/**
 * Dynamically import a blob URL and return the evaluated ES module record.
 * This is the core mechanism of per-MFE module isolation: each MFE load
 * produces a fresh blob URL whose content is evaluated as an isolated ES
 * module instance.
 *
 * @safety-reviewed 2026-04-22
 * @why The URL is ALWAYS a scheme-prefixed inline-content URL constructed
 *      by the handler itself — `blob:` in production (from
 *      `URL.createObjectURL(new Blob([rewrittenSource]))`), or `data:` in
 *      tests that stub `createObjectURL` because jsdom cannot `import()` a
 *      `blob:` URL directly. Both schemes carry inline content with no
 *      network access, so the safety property is identical: no path,
 *      network URL, or user input can reach this function. The runtime
 *      guard below makes that invariant executable so accidental call
 *      sites that pass a path or `http:`/`file:` URL fail fast rather than
 *      silently loading untrusted code.
 *
 *      **BUNDLER PRAGMAS — the two inline comments in the `import()` below
 *      are load-bearing. Do not remove or reorder them.**
 *      `webpackIgnore: true` tells webpack/rspack/rsbuild hosts, and
 *      `@vite-ignore` tells Vite hosts, to leave this dynamic import native
 *      instead of rewriting it into their chunk-loading runtime. A bundler
 *      that rewrites it makes MFE mount fail at runtime under that host
 *      with `Cannot find module 'blob:…'` (#504). The pragmas survive the
 *      package's current tsup/esbuild build in both output formats, but
 *      esbuild minification (`minify: true`) strips comments without a
 *      diagnostic — so the build script runs
 *      `scripts/verify-dist-import-pragmas.mjs`, which fails the build if
 *      either pragma is missing from the published dist.
 * @inputs `blobUrl` — a `blob:` URL from `URL.createObjectURL(...)` or a
 *         `data:` URL from the same code path under test mocks.
 */
export async function importBlobModule(blobUrl: string): Promise<unknown> {
  // @cpt-begin:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-inspect-scheme
  // @cpt-begin:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-if-invalid-scheme
  if (!(blobUrl.startsWith('blob:') || blobUrl.startsWith('data:'))) {
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-reject-scheme
    throw new TypeError(
      `importBlobModule accepts only blob: or data: URLs, received: ${blobUrl}`,
    );
    // @cpt-end:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-reject-scheme
  }
  // @cpt-end:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-if-invalid-scheme
  // @cpt-end:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-inspect-scheme
  // @cpt-begin:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-exec-import
  // @cpt-begin:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-return-module
  return await import(/* webpackIgnore: true */ /* @vite-ignore */ blobUrl);
  // @cpt-end:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-return-module
  // @cpt-end:cpt-frontx-algo-mfe-isolation-trust-kernel-import:p1:inst-exec-import
}
