import { describe, expect, it } from 'vitest';
import kitThemeCss from '@gears-frontx/ui-kit/theme.css?inline';
import { anchorKitThemeOnShadowHost } from './anchorKitThemeOnShadowHost';

// The two shapes the kit's theme.css reaches this code in: verbatim source in
// dev and tests, one minified line in a production build.
const EXPANDED_THEME_CSS = `/*
 * Tokens declared on :root, per the comment above.
 */
:root {
  --radius-md: 0.5rem;
}

:root,
[data-theme='light'] {
  --background: #f8fafc;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --background: #090b10;
  }
}
`;

const MINIFIED_THEME_CSS =
  ':root{--radius-md: 0.5rem}:root,[data-theme=light]{--background: #f8fafc}' +
  '@media (prefers-color-scheme: dark){:root:not([data-theme=light]){--background: #090b10}}';

/**
 * Offsets of every `:root` in a stylesheet, in source order.
 */
function rootOffsets(css: string): number[] {
  const offsets: number[] = [];

  for (let offset = css.indexOf(':root'); offset !== -1; offset = css.indexOf(':root', offset + 1)) {
    offsets.push(offset);
  }

  return offsets;
}

describe('anchorKitThemeOnShadowHost', () => {
  it('rewrites every root selector of an expanded stylesheet, including the one behind a comment', () => {
    const anchored = anchorKitThemeOnShadowHost(EXPANDED_THEME_CSS);

    expect(anchored).not.toContain(':root');
    expect(anchored.match(/:host/g)).toHaveLength(3);
  });

  it('rewrites every root selector of a minified stylesheet, where no selector starts a line', () => {
    const anchored = anchorKitThemeOnShadowHost(MINIFIED_THEME_CSS);

    expect(anchored).not.toContain(':root');
    expect(anchored.match(/:host/g)).toHaveLength(3);
  });

  it('leaves the theme scopes the kit selects on untouched, so an explicit scope still overrides the host', () => {
    const anchored = anchorKitThemeOnShadowHost(MINIFIED_THEME_CSS);

    expect(anchored).toContain(':host,[data-theme=light]');
    expect(anchored).toContain(':host(:not([data-theme=light]))');
  });

  // A shadow host is featureless: `:host` matches it, and a compound such as
  // `:host:not(...)` matches nothing at all. The kit hangs its whole
  // prefers-color-scheme dark block off `:root:not([data-theme='light'])`, so
  // the tail has to move inside the functional form or dark mode disappears in
  // a shadow root with nothing to see in the rewritten text.
  it('moves a compound tail inside :host() rather than leaving it in the compound', () => {
    expect(anchorKitThemeOnShadowHost(":root:not([data-theme='light']){--background:#090b10}")).toBe(
      ":host(:not([data-theme='light'])){--background:#090b10}"
    );
    expect(anchorKitThemeOnShadowHost(':root[dir=rtl] .a{margin:0}')).toBe(
      ':host([dir=rtl]) .a{margin:0}'
    );
  });

  // A pseudo-element is the one tail that must stay outside the parentheses:
  // `:host::before` is valid, `:host(::before)` is not.
  it('keeps a pseudo-element outside :host()', () => {
    expect(anchorKitThemeOnShadowHost(':root::before{content:""}')).toBe(
      ':host::before{content:""}'
    );
  });

  // A selector list may put :root anywhere, not only first; a rewrite that
  // recognised selector positions would drop this one and leave the rule
  // matching nothing in a shadow tree.
  it('rewrites a root selector that trails another selector in the same list', () => {
    const anchored = anchorKitThemeOnShadowHost("[data-theme='light'],:root{--background:#fff}");

    expect(anchored).toBe("[data-theme='light'],:host{--background:#fff}");
  });

  // The module rewrites once at load and every mount appends the same text, so
  // a second application must be a no-op. If it ever stopped being one, the
  // rewrite would be destroying something on each pass rather than converging.
  it('is idempotent, so a second application changes nothing', () => {
    for (const source of [EXPANDED_THEME_CSS, MINIFIED_THEME_CSS, kitThemeCss]) {
      const once = anchorKitThemeOnShadowHost(source);

      expect(anchorKitThemeOnShadowHost(once)).toBe(once);
    }
  });

  // The assertions above run on hand-written fixtures. This one runs on the
  // stylesheet the lifecycle actually imports, which is what the pinned kit
  // version has to keep satisfying: not one `:root` may survive, because each
  // survivor is a rule that silently matches nothing in a shadow tree.
  it('leaves no root selector in the kit stylesheet it is actually applied to', () => {
    expect(kitThemeCss).toContain(':root');

    const anchored = anchorKitThemeOnShadowHost(kitThemeCss);

    expect(anchored).not.toContain(':root');
    expect(anchored).toContain(':host');
    // Every `:host` the kit stylesheet comes back with has to be able to match
    // the host: alone, or with its tail inside the parentheses. A simple
    // selector welded straight onto `:host` is the featureless-host trap.
    expect(anchored).not.toMatch(/:host[.#[:]/);
    expect(anchored).toContain(":host(:not([data-theme='light']))");
  });

  // What the two limitations above are checked against, rather than assumed:
  // the docstring's claim is that every `:root` in the pinned stylesheet stands
  // in plain selector position, and this is that claim in machine-checkable
  // form. Asserting "nothing named `:root` survives the rewrite" cannot get
  // here - an occurrence inside a quoted value or an `@supports` condition is
  // rewritten just as thoroughly as a selector, so such a check passes while
  // the rewrite corrupts data or a feature test.
  it('finds every root in the pinned kit stylesheet in selector position, and as many as it pins', () => {
    const withoutComments = kitThemeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const offsets = rootOffsets(withoutComments);

    // Pinned, so a kit upgrade that adds an occurrence arrives through this
    // test rather than through a rendering bug.
    expect(offsets).toHaveLength(3);

    for (const offset of offsets) {
      // What precedes a selector is the end of the previous rule, the opening
      // of a block, or a selector-list comma. A quoted value or an `@supports
      // selector(...)` condition would leave a quote or a `(` here instead.
      const precedingCharacter = withoutComments.slice(0, offset).trimEnd().slice(-1);

      expect(['', '{', '}', ',', ';']).toContain(precedingCharacter);
    }
  });

  // A documented limitation, pinned rather than fixed: the rewrite is textual,
  // so a `:root` inside a quoted value is data it cannot recognise, and it is
  // rewritten like any other. The pinned kit stylesheet contains no such value
  // (the test above is what checks that), so no parser is warranted here. This
  // case exists so that changing the transform is a deliberate act: whoever
  // makes the rewrite selector-aware will see this expectation fail and can
  // then update it on purpose.
  it('rewrites a root inside a quoted value too, which is the known limitation', () => {
    const anchored = anchorKitThemeOnShadowHost(':host::after{content:":root"}');

    expect(anchored).toBe(':host::after{content:":host"}');
  });
});
