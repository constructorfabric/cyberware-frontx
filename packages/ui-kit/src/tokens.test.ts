import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from './__test-utils__/contrast';
import { declarationMap, declarations, extractRules } from './__test-utils__/css-rules';

// Guards the theme seam: every CSS variable a component module consumes must
// be defined by theme.css (the single branding surface), except the vars the
// Base UI positioner provides at runtime.

const srcDir = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(join(srcDir, 'styles', 'theme.css'), 'utf8');

const BASE_UI_RUNTIME_VARS = new Set([
  '--anchor-width',
  '--anchor-height',
  '--available-width',
  '--available-height',
  '--transform-origin',
  // Written by Base UI's Toast primitive (index/offset/height/swipe state
  // per toast, frontmost height on the viewport) — the Toast equivalent of
  // the positioner vars above.
  '--toast-index',
  '--toast-offset-y',
  '--toast-height',
  '--toast-swipe-movement-x',
  '--toast-swipe-movement-y',
  '--toast-frontmost-height',
  // Written by Base UI's Collapsible primitive: the panel's measured
  // content height/width, kept in sync while mounted so CSS can animate
  // toward/from an intrinsic (not hand-authored) size — see
  // collapsible.module.css.
  '--collapsible-panel-height',
  '--collapsible-panel-width',
  // Written by Base UI's Accordion primitive: the same measured-height
  // mechanism as Collapsible's panel, one per accordion item — see
  // accordion.module.css.
  '--accordion-panel-height',
  // Written by Base UI's Popover/Menu-family positioner (shared by
  // NavigationMenu's single popup): the positioner's own box size and the
  // currently active item's popup size, kept in sync as NavigationMenu
  // morphs the shared popup/Viewport to each newly active item's measured
  // content — see navigation-menu.module.css.
  '--positioner-width',
  '--positioner-height',
  '--popup-width',
  '--popup-height',
  // Written by Base UI's Drawer primitive during a swipe gesture: progress/
  // strength/movement along the swipe axis, whether a nested drawer is
  // present, and (for snap points) the panel's own height/frontmost-height/
  // active-snap-point offset — see drawer.module.css.
  '--drawer-swipe-progress',
  '--drawer-swipe-strength',
  '--drawer-swipe-movement-x',
  '--drawer-swipe-movement-y',
  '--nested-drawers',
  '--drawer-height',
  '--drawer-frontmost-height',
  '--drawer-snap-point-offset',
]);

// Strip comments before scanning for declarations: theme.css's prose quotes
// tokens with their values (`--radius: 0.625rem` etc.), and a token that
// only survives inside a comment must read as *removed*, not defined.
const definedTokens = new Set(
  Array.from(
    themeCss.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/(--[a-z0-9-]+)\s*:/g),
    (match) => match[1],
  ),
);

const componentsDir = join(srcDir, 'components');
const moduleFiles = readdirSync(componentsDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.module.css'))
  .map((file) => join(componentsDir, file));

// The properties the metric-scale guard below polices. Module scope, because
// the guard and its synthetic fixture must test the SAME pattern — two
// copies would let an edit to one keep passing against the other.
const GUARDED_PROP =
  /^(?:padding|margin|scroll-margin)(?:-[a-z]+)*$|^(?:gap|row-gap|column-gap|font-size|line-height|letter-spacing|font-weight|border-spacing)$/;

describe('theme tokens', () => {
  it('defines the radius scale derived from --radius', () => {
    for (const token of [
      '--radius',
      '--radius-xs',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-xl',
    ]) {
      expect(definedTokens.has(token), `${token} is missing from theme.css`).toBe(true);
    }
  });

  // Policy: every `var(--x)` a component's CSS reads must be themeable
  // (theme.css), written by Base UI at runtime (BASE_UI_RUNTIME_VARS), or
  // locally declared and exempted below by one of two shapes:
  //   - SAME part, own private use — e.g. Toast's stacked-card transform
  //     math (local arithmetic, not a themeable/brandable value), read
  //     from another selector for that same class's states
  //     (`.toast[data-expanded]`, `.toast::after`, ...).
  //   - ANCESTOR part, read by a descendant via `.declarer .reader` — e.g.
  //     Card declares `--card-spacing`/`--card-title-*` on `.card` and
  //     reads them from `.card .cardHeader`, `.card .cardContent`,
  //     `.card .cardTitle`, etc. This is a genuine cross-part read (the
  //     value crosses from Card's root into its Header/Content/Footer/
  //     Title parts) — sanctioned because it's CSS custom-property
  //     inheritance itself doing the work, not a coincidence: prefixing
  //     the reader's selector with the declarer's class is what makes the
  //     value resolve to the *nearest* such ancestor at runtime, which is
  //     also what makes a nested Card size itself independently of an
  //     outer one (see card.module.css).
  // Both shapes are scoped by leading CSS class, not by file: a token
  // declared under `.card` may be read from any selector whose first class
  // is `.card` (`.card .cardHeader`, `.card.sizeSm`, `.card:has(...)`,
  // ...), but not from an unrelated class in the same file — a token must
  // never cross from one component part into another by accident just
  // because a test only checked "declared somewhere in this file".
  //
  // Known blind spot: `leadingClass` reads only the selector's first class
  // token, so it cannot distinguish a descendant combinator (`.card .x`,
  // where inheritance genuinely carries the declared value down) from a
  // sibling one (`.card ~ .x`, `.card + .x`, where it does not — `var()`
  // would resolve to nothing there). Both bucket identically today, so
  // the guard would wave a sibling-combinator reader through too. Nothing
  // in the kit currently reads a local token that way, so it's left
  // unfixed rather than guarded against speculatively — but it means this
  // exemption checks "is the reader prefixed by the declarer's class",
  // not "would inheritance actually deliver the value here", and the two
  // are not the same guarantee.
  //
  // Widening this further should widen the policy statement above, not
  // just the mechanism below.
  function leadingClass(selector: string) {
    return selector.match(/\.[a-z][a-z0-9-]*/i)?.[0];
  }

  // extractRules is imported from __test-utils__/css-rules (shared with
  // button.test.tsx's focus-ring contrast guard, which reads
  // button.module.css the same way this file reads theme.css/every
  // component module) — see that file for the rule-splitter's own
  // comments, including why its body keeps the trailing `}` (the
  // metric-scale guard below relies on that for its `[;}]` terminator).

  it.each(moduleFiles)('%s consumes only theme-defined or same-part local variables', (file) => {
    const css = readFileSync(file, 'utf8');
    const rules = extractRules(css);

    // A component's own public override hooks (button.module.css's
    // --button-bg/-fg/-border{,-hover}, see button.md's "Custom colors")
    // are named `--<component>-*`, derived from the module's own filename —
    // NOT declared anywhere in the module, by design: the kit never sets
    // them, a consumer class does. `--${basename(file, '.module.css')}-`.
    const hookPrefix = `--${basename(file, '.module.css')}-`;

    // Collect each class's own locally-declared custom properties first...
    const locallyDeclaredByClass = new Map<string, Set<string>>();
    for (const rule of rules) {
      const cls = leadingClass(rule.selector);
      if (!cls) {
        continue;
      }
      const declared = Array.from(
        rule.body.matchAll(/(--[a-z0-9-]+)\s*:/g),
        (match) => match[1] ?? '',
      );
      const set = locallyDeclaredByClass.get(cls) ?? new Set<string>();
      for (const name of declared) {
        set.add(name);
      }
      locallyDeclaredByClass.set(cls, set);
    }

    // ...then check every rule's usages, including rules with no leading
    // class (e.g. a bare @keyframes step) — those get no local exemption,
    // since there's no "part" to scope one to; they must be a real token.
    for (const rule of rules) {
      const cls = leadingClass(rule.selector);
      // Captures whether a fallback follows the name (`match[2] === ','`)
      // so the loop below can dedup by token+fallback-shape, not token
      // alone — the same token consumed once with a fallback and once
      // without (a bug: the fallback-less usage resolves to nothing at
      // runtime if nobody sets it) must still be flagged for that second
      // usage even though the first is exempt.
      const used = Array.from(
        rule.body.matchAll(/var\((--[a-z0-9-]+)\s*([,)])/g),
        (match) => ({ token: match[1] ?? '', hasFallback: match[2] === ',' }),
      );
      const seen = new Set<string>();
      for (const { token, hasFallback } of used) {
        const key = `${token}${hasFallback ? ',' : ''}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        if (BASE_UI_RUNTIME_VARS.has(token)) {
          continue;
        }
        if (cls && locallyDeclaredByClass.get(cls)?.has(token)) {
          continue;
        }
        // Consumer-override hook: a `--<component>-*` property consumed
        // WITH a fallback needs no declaration anywhere — the fallback IS
        // the kit default, so the var() resolves by construction whether
        // or not a consumer ever sets the property. This guard exists to
        // catch vars that resolve to nothing; a hook with a fallback
        // never does. The component-name prefix (not "any fallback var is
        // exempt") keeps this from also waving through a typoed theme
        // token that happens to carry a fallback.
        if (hasFallback && token.startsWith(hookPrefix)) {
          continue;
        }
        expect(definedTokens.has(token), `${token} is not defined in theme.css`).toBe(true);
      }
    }
  });

  // Policy: the token system wins over hand-set values — spacing sits on
  // the --space-* grid and text metrics on the --text-* ramp, with
  // off-scale drawn values snapped to the nearest step. This guard enforces
  // it: in the guarded properties, every term must be a token reference
  // (var/calc-of-var), 0, auto, or normal.
  // Dimensions (width/height/inset/...) are NOT guarded — components have
  // intrinsic sizes no token names (a 24px badge, a 38x22 switch track).
  // Exceptions carry their reason inline; add one only with a constraint
  // the token system genuinely cannot express.
  //
  // Known blind spot: a literal metric can be laundered through a local
  // custom property. `--foo: 12px` is itself a declaration whose "property"
  // is `--foo`, which GUARDED_PROP never matches, and the `padding:
  // var(--foo)` that reads it strips to nothing. Guarding custom properties
  // directly is not the fix: a local can legitimately hold literal geometry
  // for an UNguarded property, which this guard leaves alone by design —
  // Toast's `--peek: 0.75rem` feeds its stacked-card transform. Closing it
  // takes resolving each local var to its value before scanning the property
  // that reads it. Not exploited today: the kit declares exactly two locals
  // holding a literal (Toast's `--peek`, Table's `--table-row-ring-inset`),
  // and both feed unguarded properties — a transform and a box-shadow.
  it('keeps spacing and type metrics on the token scales', () => {
    const EXCEPTIONS = new Set([
      // 16px is the iOS Safari floor below which focusing a field zooms
      // the page — a platform constraint, not a type role (the ramp takes
      // over at the desktop breakpoint; see input/textarea.module.css).
      // Its own reason, not the font-size one re-used: the paired 1.5rem
      // line-height is that same 16px at a 1.5x ratio (WCAG 1.4.12's own
      // recommended floor for line spacing) — it shares a numeral with
      // --text-heading-2-line-height by coincidence, not by role.
      'input.module.css|font-size|1rem',
      'input.module.css|line-height|1.5rem',
      'textarea.module.css|font-size|1rem',
      'textarea.module.css|line-height|1.5rem',
      // Position geometry, not an on-grid space — but two INDEPENDENT
      // solutions for the same 2px inset, not one shared with the other:
      // the default size insets its thumb with this margin and travels
      // its own full width (`translateX(100%)`, overridden right below);
      // the small size carries no margin at all and instead gets that
      // same 2px inset from the OTHER thumb rule's `calc(100% - 2px)`
      // checked-state math (see switch.module.css). Both sizes are
      // geometrically correct on their own terms — they just don't share a
      // mechanism.
      'switch.module.css|margin-inline-start|2px',
    ]);
    for (const file of moduleFiles) {
      const base = file.slice(file.lastIndexOf('/') + 1);
      for (const rule of extractRules(readFileSync(file, 'utf8'))) {
        for (const { prop, value } of declarations(rule.body)) {
          if (!GUARDED_PROP.test(prop) || EXCEPTIONS.has(`${base}|${prop}|${value}`)) {
            continue;
          }
          const leftover = value
            .replace(/var\(--[a-z0-9-]+\)/g, ' ')
            .replace(/calc\(|\)|[+*]|-1\b/g, ' ')
            .replace(/\b(?:0|auto|normal)\b/g, ' ')
            .trim();
          expect(
            leftover,
            `literal metric "${prop}: ${value}" in ${base} — use the token scales (or add a reasoned exception)`,
          ).toBe('');
        }
      }
    }
  });

  // Synthetic fixture for the declaration splitter's `[;}]` terminator: a
  // rule whose LAST declaration has no trailing semicolon is invisible to a
  // `;`-only terminator (no `;` in the source means no match at all),
  // letting a literal metric slip through undetected. Exercises the pieces
  // the guard above is built from — the same `declarations` splitter and the
  // same module-scope GUARDED_PROP, so an edit to either shows up here —
  // rather than the whole test, which reads real component files this
  // fixture is not one of.
  it('does not let a semicolon-less final declaration bypass the metric guard', () => {
    const fixture = '.fixture { color: red; padding: 12px }';
    const [rule] = extractRules(fixture);
    expect(rule, 'fixture failed to parse as a single rule').toBeDefined();
    const literalPadding = declarations(rule?.body ?? '').find(({ prop }) =>
      GUARDED_PROP.test(prop),
    );
    expect(literalPadding, 'the semicolon-less "padding: 12px" declaration was not seen at all').toEqual({
      prop: 'padding',
      value: '12px',
    });
  });

  // Function notations plus the named colors someone might actually reach
  // for. `white`/`black` need the lookarounds: `white-space` and
  // custom-property names like `--color-black` must not trip this.
  const RAW_COLOR =
    /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|hwb\(|\blab\(|\blch\(|\bcolor\(|(?<![-\w])(?:white|black)(?![-\w])/i;

  // An attribute selector matching a colour is not a colour this kit
  // chooses — it is how a rule FINDS elements a third party has already
  // painted, so it can retint them onto the tokens. chart.module.css needs
  // it to reach Recharts' stock grid/dot strokes, which Recharts writes as
  // literal hex attributes on its own default-drawn SVG. Blanking those
  // fragments before the scan keeps that legal while leaving every place a
  // declaration could actually paint a colour — values, and the prose
  // around them — under the same rule as before. Deliberately narrow: only
  // a quoted `[attr='value']` form is blanked, which no declaration value
  // in this kit takes.
  const ATTRIBUTE_SELECTOR_VALUE = /\[[a-z-]+\s*[~|^$*]?=\s*(['"])[^'"]*\1\]/gi;
  const withoutAttributeSelectorValues = (css: string) =>
    css.replace(ATTRIBUTE_SELECTOR_VALUE, '[]');

  it('keeps raw colors out of component modules', () => {
    for (const file of moduleFiles) {
      const css = withoutAttributeSelectorValues(readFileSync(file, 'utf8'));
      const raw = css.match(RAW_COLOR);
      expect(raw, `raw color "${raw?.[0]}" in ${file}`).toBeNull();
    }
  });

  // Synthetic fixture, in the same spirit as the metric guard's own above:
  // the exemption carved out for attribute selectors is exactly the kind
  // that quietly widens into "hex is fine now", so it is pinned to the two
  // cases that define its edge, using the same regex and the same blanking
  // step the real guard runs.
  it('exempts hex in an attribute selector but not in a declaration value', () => {
    const selectorCase = ".container :global(.recharts-dot[stroke='#fff']) { stroke: transparent; }";
    expect(withoutAttributeSelectorValues(selectorCase).match(RAW_COLOR)).toBeNull();

    const declarationCase = ".container :global(.recharts-dot[stroke='#fff']) { stroke: #ccc; }";
    expect(withoutAttributeSelectorValues(declarationCase).match(RAW_COLOR)?.[0]).toBe('#ccc');
  });

  // Guards the token blocks in theme.css against drift: the dark palette is
  // hand-duplicated between [data-theme='dark'] and the prefers-color-scheme
  // media block (custom properties can't be shared across two selectors any
  // other way), and nothing but this test notices if the two copies diverge,
  // a new light token is added without a dark counterpart, or a
  // theme-invariant token (shape/scrim, not color) drifts into a theme block.
  describe('theme.css token blocks stay in sync', () => {
    const themeRules = extractRules(themeCss);

    // declarationMap, not a custom-property-only scan: the theme blocks also
    // carry `color-scheme`, and it needs the same drift guarantees — the two
    // dark blocks must both say `dark` (identity test), and a light-block
    // declaration must have dark counterparts (parity test). The shared util
    // matches custom properties (leading `--`) and ordinary properties alike,
    // and carries the `[;}]` terminator that catches a block's last
    // declaration when it has no trailing semicolon.

    // Identify each block by selector shape rather than array position, so
    // reordering theme.css doesn't silently break this test. `invariantsBlock`
    // must match `:root` exactly — `lightBlock`'s selector also contains the
    // substring `:root` (it's `:root, [data-theme='light']`), so an exact
    // match is what keeps the two finders pointing at different blocks.
    const invariantsBlock = themeRules.find((rule) => rule.selector === ':root');
    const lightBlock = themeRules.find(
      (rule) =>
        rule.selector.includes(':root') &&
        rule.selector.includes("[data-theme='light']") &&
        !rule.selector.includes(':not('),
    );
    const darkAttrBlock = themeRules.find((rule) => rule.selector === "[data-theme='dark']");
    const darkMediaBlock = themeRules.find((rule) => rule.selector.includes(':root:not('));

    if (!invariantsBlock || !lightBlock || !darkAttrBlock || !darkMediaBlock) {
      throw new Error(
        "theme.css's token block selectors changed shape — update this test's block finders",
      );
    }

    const invariantTokensDeclared = declarationMap(invariantsBlock.body);
    const lightTokens = declarationMap(lightBlock.body);
    const darkAttrTokens = declarationMap(darkAttrBlock.body);
    const darkMediaTokens = declarationMap(darkMediaBlock.body);

    // Shape/scale/scrim, not color: declared once on the invariants block and
    // deliberately never redefined in any theme block, because a theme scope
    // overrides colors, never shape or scale (see the comment on theme.css's
    // `:root` invariants block).
    const THEME_INVARIANT_TOKENS = new Set([
      // Scrim behind modal-style popups. A dark tint dims the page in both
      // light and dark UI; --foreground would flip to near-white in dark
      // mode and brighten instead of dim (see the --overlay comment in
      // theme.css).
      '--overlay',
      // Popover chrome (ring + drop shadow) shared by every card-like
      // popup, named after the --popover/--popover-foreground pair every
      // consumer already paints with (see theme.css for why not
      // "--overlay-*"). Both are mixed from --foreground, so the computed
      // value already flips correctly per theme without a separate
      // light/dark declaration — same rationale as --overlay above.
      '--popover-border',
      '--popover-shadow',
      // Radius scale derived from --radius. Corner shape isn't a light/dark
      // concern — consumers rebrand it by overriding --radius alone, in
      // either theme.
      '--radius',
      '--radius-xs',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-xl',
      // Spacing scale (Figma space/1–8; step number = value in 4px units,
      // so there is no space/7).
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--space-8',
      // Control metrics (Figma control/height/*, icon/size/*,
      // border/width/*). Sizes, not colors — never per-theme.
      '--control-height-sm',
      '--control-height-md',
      '--control-height-lg',
      '--icon-size-xs',
      '--icon-size-sm',
      '--icon-size-md',
      '--icon-size-lg',
      '--border-width',
      '--border-width-focus',
      // Typography (Figma "Typography / Specimens", frame 175:371):
      // families and the Studio type ramp. Shape and scale, not color —
      // never per-theme.
      '--font-sans',
      '--font-mono',
      '--text-display-size',
      '--text-display-line-height',
      '--text-display-weight',
      '--text-display-tracking',
      '--text-heading-1-size',
      '--text-heading-1-line-height',
      '--text-heading-1-weight',
      '--text-heading-1-tracking',
      '--text-heading-2-size',
      '--text-heading-2-line-height',
      '--text-heading-2-weight',
      '--text-heading-2-tracking',
      '--text-body-size',
      '--text-body-line-height',
      '--text-body-weight',
      '--text-body-tracking',
      '--text-label-size',
      '--text-label-line-height',
      '--text-label-weight',
      '--text-label-tracking',
      '--text-meta-size',
      '--text-meta-line-height',
      '--text-meta-weight',
      '--text-meta-tracking',
      '--text-mono-size',
      '--text-mono-line-height',
      '--text-mono-weight',
      '--text-mono-tracking',
    ]);

    it('defines the two dark blocks identically', () => {
      expect(Object.fromEntries(darkAttrTokens)).toEqual(Object.fromEntries(darkMediaTokens));
    });

    it('declares every theme-invariant token on the invariants block', () => {
      for (const token of Array.from(THEME_INVARIANT_TOKENS)) {
        expect(
          invariantTokensDeclared.has(token),
          `${token} is missing from theme.css's :root invariants block`,
        ).toBe(true);
      }
    });

    // A consequence of splitting shape/scrim onto their own :root-only block:
    // the light block now holds color tokens exclusively, so parity with the
    // dark blocks needs no exemption list — every light token must appear in
    // both. Don't reintroduce an exemption here; add a new entry to
    // THEME_INVARIANT_TOKENS (and to theme.css's invariants block) instead.
    it('redefines every light token in both dark blocks', () => {
      for (const token of Array.from(lightTokens.keys())) {
        expect(darkAttrTokens.has(token), `${token} missing from [data-theme='dark']`).toBe(true);
        expect(
          darkMediaTokens.has(token),
          `${token} missing from the prefers-color-scheme block`,
        ).toBe(true);
      }
    });

    it('never redefines the theme-invariant tokens in any theme block', () => {
      for (const token of Array.from(THEME_INVARIANT_TOKENS)) {
        expect(
          lightTokens.has(token),
          `${token} is theme-invariant but redefined in the light block`,
        ).toBe(false);
        expect(
          darkAttrTokens.has(token),
          `${token} is theme-invariant but redefined in [data-theme='dark']`,
        ).toBe(false);
        expect(
          darkMediaTokens.has(token),
          `${token} is theme-invariant but redefined in the prefers-color-scheme block`,
        ).toBe(false);
      }
    });

    // WCAG contrast guard for the theme-level pairs whose colors are picked
    // for a measured floor rather than taken from the mockups (link text,
    // the table header) — parses the SAME lightTokens/darkAttrTokens maps
    // above, live off theme.css, so a token drifting back under its floor
    // fails this test instead of shipping a color no one re-measured.
    // Button's OWN focus-ring cases live in button.test.tsx instead: they
    // need to read button.module.css's actual --button-focus-ring
    // declaration (a single tone drawn outside the button via outline +
    // outline-offset), which makes them a Button-specific guard, not a
    // theme-level one — see that file for why, and for the shared
    // contrastRatio/extractRules utilities both files import.
    //
    // Every case below reads a token's LITERAL hex out of theme.css via
    // `token()` — never a var() reference — so a guarded token can't be
    // "fixed" by aliasing it to another token's `var(--x)` instead of
    // carrying its own measured value; contrastRatio has no way to resolve
    // that alias and the parse would produce garbage input, which is the
    // point (see contrast.ts's own comment, and light --link-foreground in
    // theme.css, which duplicates --primary-hover's hex as a literal for
    // exactly this reason rather than referencing it).
    describe('WCAG contrast floors', () => {
      function token(tokens: Map<string, string>, name: string) {
        const value = tokens.get(name);
        expect(value, `${name} missing from the theme block being checked`).toBeDefined();
        return value as string;
      }

      const themes: Array<[string, Map<string, string>]> = [
        ['light', lightTokens],
        ['dark', darkAttrTokens],
      ];

      // Button's link variant text against --background specifically — the
      // page background the borderless variant actually sits on. Not
      // verified against --card/--surface (a Link button drawn on a raised
      // panel instead of the bare page): scoped to the one backdrop this
      // variant is documented to sit on, not widened into a full
      // every-surface matrix no drawn spec asks for.
      it('link button text clears 4.5:1 against the page background', () => {
        for (const [themeName, tokens] of themes) {
          expect(
            contrastRatio(token(tokens, '--link-foreground'), token(tokens, '--background')),
            themeName,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      // The table header label against the header bar's own fill
      // (--surface, not --background — see table.module.css).
      it('table header text clears 4.5:1 against the header bar fill', () => {
        for (const [themeName, tokens] of themes) {
          expect(
            contrastRatio(token(tokens, '--subtle-foreground'), token(tokens, '--surface')),
            themeName,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      // The status tokens are 12px label text in the kit — Badge's tone
      // variants and Avatar's soft treatment paint them over their own
      // -soft fill, and Field/Alert/Toast/Attachment/Bubble/Questionnaire
      // error text paints --danger over whatever page/card/panel the
      // component sits on — so each status color must clear the 4.5:1 AA
      // floor against ALL of those backdrops, not only the one a single
      // component happens to test. This is the guard the original Studio
      // values shipped without: they cleared their own -soft fills but not
      // every page/panel seat, and --destructive doubled as a text color
      // (see design-notes.md's "Post-review contrast pass" entry) — a hue
      // that only works as a dot or solid fill can no longer pass for a
      // text color. (--popover is included even though it currently equals
      // --card in both modes: Toast paints its error icon on --popover, and
      // the two tokens are free to diverge later.)
      it('status label text clears 4.5:1 on its soft fill and every surface it sits on', () => {
        for (const [themeName, tokens] of themes) {
          for (const status of ['--success', '--warning', '--danger', '--info']) {
            const label = token(tokens, status);
            for (const backdrop of [
              `${status}-soft`,
              '--background',
              '--surface',
              '--card',
              '--popover',
            ]) {
              expect(
                contrastRatio(label, token(tokens, backdrop)),
                `${themeName} ${status} on ${backdrop}`,
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      });

      // The brand-tinted pair: menus' hover/active rows, Badge's accent
      // tone and Bubble all paint --accent-foreground as label text over
      // the --accent fill.
      it('accent-foreground clears 4.5:1 on the accent fill', () => {
        for (const [themeName, tokens] of themes) {
          expect(
            contrastRatio(token(tokens, '--accent-foreground'), token(tokens, '--accent')),
            themeName,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      // Solid-fill on-colors, at rest AND on the hover fills: Button and
      // Badge keep the same fixed label while swapping the fill under it
      // on hover (--primary -> --primary-hover; --destructive ->
      // --destructive-hover on Badge), so the hover fill needs the same
      // 4.5:1 the resting fill does — the exact case the old
      // mix-toward-foreground hover recipe failed in dark mode (see
      // badge.module.css's destructive-hover comment).
      it('solid-fill labels clear 4.5:1 at rest and on the hover fills', () => {
        const pairs: Array<[string, string[]]> = [
          ['--primary-foreground', ['--primary', '--primary-hover']],
          ['--destructive-foreground', ['--destructive', '--destructive-hover']],
        ];
        for (const [themeName, tokens] of themes) {
          for (const [label, fills] of pairs) {
            for (const fill of fills) {
              expect(
                contrastRatio(token(tokens, label), token(tokens, fill)),
                `${themeName} ${label} on ${fill}`,
              ).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      });

      // Link text away from the bare page: FieldDescription, EmptyDescription
      // and ItemDescription links (and Badge's link variant on a card) sit on
      // --surface/--card rather than --background, which the link-button case
      // above already covers. Widened deliberately when those consumers moved
      // off --primary (whose dark value fails AA as text) onto
      // --link-foreground (design-notes.md's "Post-review contrast pass") —
      // the button-only scoping note on that case still holds for BUTTON,
      // but the token now has seats on every panel fill.
      it('link text clears 4.5:1 against surface and card', () => {
        for (const [themeName, tokens] of themes) {
          for (const backdrop of ['--surface', '--card']) {
            expect(
              contrastRatio(token(tokens, '--link-foreground'), token(tokens, backdrop)),
              `${themeName} --link-foreground on ${backdrop}`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      // Not a WCAG floor — a visibility floor. --muted is the kit's
      // workhorse fill (Skeleton, outline/ghost Button hover, Calendar's
      // outside days, …) and the rebrand frame draws it AT the light page
      // value and AT the dark card value, which makes every one of those
      // fills vanish against its own backdrop; theme.css steps it off
      // deliberately (see --muted's comment there). 1.1 is below the
      // shipped separations (1.13 light page / 1.22 dark card are the
      // tightest) but far above the ~1.0 a re-collapse would produce, so
      // this pins the intent without hard-coding the palette.
      it('the muted fill stays visibly separate from the page and card it fills on', () => {
        for (const [themeName, tokens] of themes) {
          for (const backdrop of ['--background', '--card']) {
            expect(
              contrastRatio(token(tokens, '--muted'), token(tokens, backdrop)),
              `${themeName} --muted on ${backdrop}`,
            ).toBeGreaterThanOrEqual(1.1);
          }
        }
      });

      // Same visibility floor for the sidebar's own hairline: --sidebar
      // follows --muted (see theme.css), and the first derivation of the
      // block put --border's value on --sidebar-border — which is the
      // panel fill itself in light mode, erasing SidebarSeparator, the
      // menu-sub rail and the floating variant's outline at 1.00:1. The
      // border now follows --border-strong (1.20 light / 1.41 dark against
      // the panel); this pins the pair the way the muted guard above pins
      // muted against its backdrops.
      it('the sidebar border stays visibly separate from the sidebar panel', () => {
        for (const [themeName, tokens] of themes) {
          expect(
            contrastRatio(token(tokens, '--sidebar-border'), token(tokens, '--sidebar')),
            `${themeName} --sidebar-border on --sidebar`,
          ).toBeGreaterThanOrEqual(1.1);
        }
      });
    });
  });
});
