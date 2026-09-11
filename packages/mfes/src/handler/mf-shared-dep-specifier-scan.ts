/**
 * Undeclared-specifier diagnostic scan for shared-dependency chunks.
 *
 * This is deliberately NOT part of the audited trust kernel
 * (`mf-dynamic-module-ops.ts`): it interpolates nothing into a `RegExp` — the
 * matcher below is a fixed literal, not built from any argument this module
 * receives — so it is not "dynamic construction of specifier matchers" and
 * carries no trust-kernel residency requirement (see the kernel file's
 * header comment and `cpt-frontx-adr-mfe-load-isolation`). Keeping it out of
 * the kernel keeps that file's audited surface from growing with a
 * diagnostic-only heuristic that has no safety property to review.
 *
 * The scan is heuristic and MUST NEVER be able to fail a load: it reads
 * chunk text without parsing it, so it cannot tell an ordinary string
 * literal from an actual import. Its only caller (`MfeHandlerMF`) passes its
 * result to `console.warn` and continues the load unconditionally — nothing
 * in this file throws.
 *
 * @packageDocumentation
 */

/**
 * Matches the same two import forms the trust kernel's rewriter and
 * assertion handle — `from "x"` and `import "x"` — but with no package name
 * constraint, so it also matches specifiers the manifest never declared.
 * Fixed literal, no interpolation: safe to keep outside the trust kernel.
 */
const GENERIC_IMPORT_SPECIFIER_PATTERN = /(from|import)(\s*["'])([^"']+)(["'])/g;

/**
 * A specifier text is well-formed as a package module specifier when it
 * matches the grammar: an optional `@scope/` prefix (scope starting with
 * alphanumeric), a package name (starting with alphanumeric), and zero or
 * more `/`-separated subpath segments, where each segment uses only the
 * characters npm package names permit (letters, digits, `.`, `_`, `-`, `~`).
 * This double-checks both the shape (optionally scoped package name with
 * optional subpath) and the exclusions (no whitespace, quote, parenthesis,
 * colon, or line break). Already-rewritten `blob:`/`data:` specifiers fail
 * this grammar because they contain a colon. Excluding parentheses, quotes,
 * and whitespace/line breaks keeps ordinary code from being mistaken for
 * a specifier (see the file header and `inst-if-undeclared-specifier`).
 */
const WELL_FORMED_MODULE_SPECIFIER_PATTERN = /^(@[a-zA-Z0-9][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._~-]*(?:\/[a-zA-Z0-9._~-]+)*$/;

/**
 * Find every specifier in `source`, in the two import forms above, that is
 * well-formed as a package module specifier and is NOT one of
 * `declaredNames`. Duplicates are reported once. Returns an empty array when
 * there is nothing to warn about.
 *
 * This function never throws for any input; a caller may use its result
 * only for diagnostics.
 */
// @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-undeclared-specifier
export function findUndeclaredWellFormedSpecifiers(
  source: string,
  declaredNames: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(GENERIC_IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[3];
    if (declaredNames.has(specifier)) {
      continue;
    }
    if (!WELL_FORMED_MODULE_SPECIFIER_PATTERN.test(specifier)) {
      continue;
    }
    if (seen.has(specifier)) {
      continue;
    }
    seen.add(specifier);
    found.push(specifier);
  }
  return found;
}
// @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-undeclared-specifier
