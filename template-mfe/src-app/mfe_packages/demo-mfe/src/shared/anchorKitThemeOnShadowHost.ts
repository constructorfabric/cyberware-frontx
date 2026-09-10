/**
 * Re-anchoring of `@gears-frontx/ui-kit`'s theme tokens for a shadow root.
 *
 * The kit declares its design tokens on `:root` because its intended consumer
 * is a document. An MFE is not one: it renders inside a shadow root, whose root
 * node is a `DocumentFragment`, and `:root` matches nothing in a shadow tree at
 * all. A stylesheet loaded there unchanged delivers no tokens, and every kit
 * component paints from unresolved `var()` references.
 *
 * `_blank-mfe` carries a copy of this module at the same path, with the same
 * implementation. The duplication is deliberate: an MFE package never imports
 * from a sibling MFE package, and the only shared homes available —
 * `@gears-frontx/ui-kit` and `@gears-frontx/mfes` — are respectively a
 * published surface this template does not own and a package no MFE takes as a
 * runtime dependency. Folding the two copies into one is a decision for whoever
 * moves this helper into a package both can depend on.
 */

/**
 * Simple selectors that may follow `:root` inside one compound selector and
 * have to move inside `:host(...)` with it: classes, ids, attribute selectors
 * and pseudo-classes with an optional non-nested argument. Pseudo-elements are
 * deliberately not among them - `:host::before` is valid where
 * `:host(::before)` is not - so the double-colon form and the four legacy
 * single-colon spellings end the tail and stay outside the parentheses.
 */
const ROOT_WITH_COMPOUND_TAIL =
  /:root\b((?:\[[^\]]*\]|[.#][\w-]+|:(?!:|before\b|after\b|first-line\b|first-letter\b)[\w-]+(?:\([^()]*\))?)*)/g;

/**
 * Rewrite every `:root` selector in a stylesheet so it names the shadow host.
 *
 * A bare `:root` becomes `:host`. A `:root` carrying a compound tail becomes
 * the functional form instead: `:root:not([data-theme='light'])` becomes
 * `:host(:not([data-theme='light']))`. That distinction is load-bearing, not
 * cosmetic - a shadow host is featureless, so only `:host`, `:host()` and
 * `:host-context()` match it and a `:host:not(...)` compound matches nothing at
 * all. The kit hangs its whole `prefers-color-scheme: dark` block off exactly
 * that selector, so the naive rewrite drops dark mode in a shadow root without
 * leaving a trace.
 *
 * Comments are stripped first, and only first: `:root` appears in the kit's
 * prose as well as its selectors, and once the prose is gone every remaining
 * occurrence is a selector. Recognising selector *positions* instead — anchored
 * on a preceding `{`, `}` or start of input — buys nothing over replacing them
 * all and loses `[data-theme='light'],:root { … }`, which is the same
 * silent-partial-rewrite this function exists to avoid.
 *
 * What this buys instead is a constraint, and it is worth stating plainly: the
 * rewrite is textual, not a parse, so it cannot tell a selector from the two
 * other places `:root` may legally appear. Inside a quoted value (a string, or
 * an attribute selector's value) it would rewrite text that is data, and inside
 * a feature query such as `@supports selector(:root)` it would rewrite the
 * condition being tested rather than a selector. The comment stripper has the
 * same blind spot in reverse: a quoted value containing a comment delimiter
 * would be eaten as prose.
 *
 * The pinned kit version satisfies the assumption. Every `:root` in its
 * `theme.css` sits either in plain selector position or in prose, and neither
 * a quoted value nor a feature query names it anywhere. Two things hold that:
 * the exact version pin in this package's `package.json`, and the tests beside
 * this file, which count the `:root` occurrences in the real imported
 * stylesheet and assert every one of them stands in selector position. That
 * pair is what a "no `:root` left afterwards" check cannot give: a survivor
 * inside a quoted value or an `@supports` condition would be rewritten too, and
 * so would pass such a check while corrupting data or a feature test. A kit
 * upgrade that introduces either context needs a real CSS parser here, not a
 * wider regex.
 *
 * @param css - Stylesheet source, minified or not
 */
export function anchorKitThemeOnShadowHost(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(ROOT_WITH_COMPOUND_TAIL, (_match, tail: string) =>
      tail === '' ? ':host' : `:host(${tail})`
    );
}
