import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contrastRatio } from '../../__test-utils__/contrast';
import { declarationMap, extractRules } from '../../__test-utils__/css-rules';
import { readThemeTokens } from '../../__test-utils__/theme-tokens';
import { Button } from './button';
import styles from './button.module.css';

afterEach(cleanup);

describe('Button', () => {
  it('renders a button with its content and base class', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain(styles.button);
    expect(button).toHaveProperty('type', 'button');
  });

  it('applies variant and size classes from the CSS module', () => {
    render(
      <Button variant="outline" size="sm">
        Cancel
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.className).toContain(styles.variantOutline);
    expect(button.className).toContain(styles.sizeSm);
  });

  it('defaults to the primary variant and medium size', () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.className).toContain(styles.variantDefault);
    expect(button.className).toContain(styles.sizeDefault);
  });

  it('merges a consumer className and forwards props', () => {
    const onClick = vi.fn();
    render(
      <Button className="consumer" onClick={onClick} disabled={false}>
        Click
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Click' });
    expect(button.className).toContain('consumer');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a custom element via the render prop', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Button render={<a href="/docs" />} nativeButton={false} variant="link">
        Docs
      </Button>,
    );
    // Base UI applies button semantics to the anchor: role="button", real href.
    const link = screen.getByRole('button', { name: 'Docs' });
    expect(link).toHaveProperty('tagName', 'A');
    expect(link).toHaveProperty('href', expect.stringContaining('/docs'));
    expect(link.className).toContain(styles.button);
    expect(link.className).toContain(styles.variantLink);
    // nativeButton={false} keeps Base UI's non-native-button warning silent.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not fire clicks when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Nope
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the icon slot as decorative and keeps the label as the name', () => {
    render(
      <Button icon={<svg data-testid="plus" />}>
        Add
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add' });
    const slot = screen.getByTestId('plus').parentElement;
    expect(slot).toHaveProperty('tagName', 'SPAN');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    // Icon next to a label is a regular button, not an icon-only one.
    expect(button.hasAttribute('data-icon-only')).toBe(false);
  });

  it('squares up when the icon slot is the only content', () => {
    render(<Button icon={<svg />} aria-label="Close" />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button.hasAttribute('data-icon-only')).toBe(true);
  });

  it('treats a false icon as absent, never going icon-only', () => {
    // `icon={cond && <Icon/>}` with cond=false passes `false` — a valid
    // ReactNode that renders nothing, but `icon != null` alone read it as
    // present, forcing icon-only geometry around an empty square; see
    // hasIcon in button.tsx.
    render(<Button icon={false} aria-label="Refresh" />);
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button.hasAttribute('data-icon-only')).toBe(false);
    expect(button.querySelector(`.${styles.icon}`)).toBeNull();
  });

  it('treats a false icon as absent while a label is present', () => {
    render(<Button icon={false}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.hasAttribute('data-icon-only')).toBe(false);
    expect(button.querySelector(`.${styles.icon}`)).toBeNull();
  });

  it('loading disables the button, reports aria-busy, and keeps the accessible name', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Save
      </Button>,
    );
    // The name must survive loading: content is hidden with opacity, which
    // stays in the accessibility tree (visibility would strip the name).
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    // aria-disabled, not the native `disabled` attribute: a real `disabled`
    // would blur the element the instant it landed and pull it out of the
    // tab order, leaving aria-busy announced to nothing (see the dedicated
    // focus test below). Clicks are still suppressed either way.
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    // The spinner specifically, not just "some aria-hidden descendant" —
    // the icon slot is aria-hidden too, and a selector that only checks
    // that attribute would pass even if the spinner never rendered.
    const spinner = Array.from(button.querySelectorAll('span')).find((el) =>
      el.classList.contains(styles.spinner),
    );
    expect(spinner).not.toBeUndefined();
  });

  it('does not mark an idle button busy or icon-only', () => {
    render(<Button>Idle</Button>);
    const button = screen.getByRole('button', { name: 'Idle' });
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hasAttribute('data-loading')).toBe(false);
    expect(button.hasAttribute('data-icon-only')).toBe(false);
  });

  it('squares up for a falsy label even with an icon and children both present', () => {
    // `{cond && 'Save'}` is a real, common pattern (a conditional label) —
    // `children == null` misses it because `false` is neither null nor
    // undefined, so the button rendered a wide pill with an empty label
    // span instead of going icon-only.
    const showLabel = false;
    render(
      <Button icon={<svg />} aria-label="Create">
        {showLabel && 'Create'}
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.hasAttribute('data-icon-only')).toBe(true);
  });

  it('squares up for an empty-string label', () => {
    // The other falsy shape, and the one Children.toArray does NOT drop:
    // `toArray('')` has length 1, so an array-emptiness test alone reads
    // this button as labelled and leaves it a wide pill wrapping an empty
    // span. `{label}` with a blank `label` is how it arrives in practice.
    const label = '';
    render(
      <Button icon={<svg />} aria-label="Create">
        {label}
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.hasAttribute('data-icon-only')).toBe(true);
    expect(button.querySelector(`.${styles.label}`)).toBeNull();
  });

  it('stays icon-only while loading', () => {
    render(<Button icon={<svg />} loading aria-label="Refresh" />);
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button.hasAttribute('data-icon-only')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps a loading button focusable instead of blurring it', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    expect(document.activeElement).toBe(button);
    // Base UI reports the state via aria-disabled while focusableWhenDisabled
    // is in effect, not the native `disabled` attribute — a real `disabled`
    // attribute would have blurred the element the instant it landed.
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('lets its own derived state win over a conflicting prop of the same name', () => {
    // A caller passing aria-busy/data-loading that disagrees with the
    // actual `loading` prop must not shadow the derived value — Button
    // computed loading=true, so that wins regardless of prop order.
    render(
      <Button loading aria-busy={false} data-loading="">
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('data-loading')).toBe('true');
  });
});

/*
 * Focus-ring contrast guard's raw-CSS parsing, shared with the
 * custom-color API guard below. It lives here rather than in
 * tokens.test.ts with the link-text/table-header cases (genuinely
 * theme-level pairs), because a Button focus ring is DERIVED from
 * something this file already owns — which token button.module.css's
 * --button-focus-ring actually resolves to per variant. Hardcoding
 * "default's ring is --primary-ring" here would restate the CSS instead
 * of reading it: if a future edit re-points --button-focus-ring, this
 * guard needs to notice on its own, not keep asserting yesterday's
 * mapping. So it parses the raw button.module.css source (not the hashed
 * `styles` import, which has no selector names or values left in it) with
 * the same extractRules the theme.css guards use, resolves each variant's
 * custom-property cascade by hand (button.module.css declares
 * --button-focus-ring in more than one rule per variant — a rest-fill
 * rule and a separate focus-color rule further down the file — so "merge
 * every matching rule in source order" is what actually reproduces the
 * cascade, not a single lookup).
 */
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'button.module.css');
const rules = extractRules(readFileSync(cssPath, 'utf8'));

// Every declaration from every rule whose selector list includes `.button`
// (the shared base) or `targetClass`, applied in source order — the same
// property from a later rule overrides an earlier one, same as the
// cascade would resolve two same-specificity rules for the same class.
function effectiveDeclarations(targetClass: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of rules) {
    const selectors = rule.selector.split(',').map((selector) => selector.replace(/\s+/g, ''));
    if (selectors.includes('.button') || selectors.includes(targetClass)) {
      for (const [prop, value] of declarationMap(rule.body)) {
        merged.set(prop, value);
      }
    }
  }
  return merged;
}

const variants = [
  'variantDefault',
  'variantDestructive',
  'variantOutline',
  'variantSecondary',
  'variantGhost',
  'variantLink',
];

describe('Button focus-ring contrast', () => {
  const { light, dark } = readThemeTokens();

  // Parses `var(--name)` / `var(--name, <fallback>)`. Returns null for
  // anything that isn't a var() expression (literal colors, `transparent`).
  function parseVar(value: string): { name: string; fallback: string | null } | null {
    const match = value.trim().match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/);
    if (!match) return null;
    return { name: match[1] as string, fallback: match[2] ?? null };
  }

  // Peels away scope's own declared aliases — the base rule's
  // `--button-focus-ring: var(--ring)`, a variant's own `var(--primary-
  // ring)` / `var(--destructive-ring)` — until the value names a token
  // that ISN'T declared in `scope`. An undeclared name WITH a fallback is
  // an override hook nobody set (no current --button-focus-ring value
  // actually carries one, but the branch stays general for the same
  // reason the custom-color hooks below need it); an undeclared name with
  // NO fallback can only be a real theme.css token.
  function resolveThemeToken(rawValue: string, scope: Map<string, string>): string | null {
    let current = rawValue.trim();
    const seen = new Set<string>();
    for (;;) {
      const parsed = parseVar(current);
      if (!parsed) return null; // not a var() at all (e.g. a literal color, `transparent`)
      if (scope.has(parsed.name)) {
        if (seen.has(parsed.name)) return null; // cycle guard — should never trigger
        seen.add(parsed.name);
        current = scope.get(parsed.name) as string;
        continue;
      }
      if (parsed.fallback !== null) {
        current = parsed.fallback;
        continue;
      }
      return parsed.name;
    }
  }

  const themes: Array<[string, Map<string, string>]> = [
    ['light', light],
    ['dark', dark],
  ];

  // Resolves a possibly-null token NAME (from resolveThemeToken) to its
  // literal hex VALUE in a given theme block, failing loudly at either step
  // instead of silently comparing `undefined` against something — the same
  // "assert then narrow" shape as tokens.test.ts's own `token()` helper.
  function hexFor(name: string | null, tokens: Map<string, string>, label: string): string {
    expect(name, `${label} did not resolve to a theme token`).not.toBeNull();
    const hex = tokens.get(name as string);
    expect(hex, `${name} missing from the theme block being checked`).toBeDefined();
    return hex as string;
  }

  // The ring now lives OUTSIDE the button (see button.module.css's
  // `:focus-visible`), so it only ever borders the page background —
  // there is no second, fill-side surface to check anymore.
  it.each(variants)('%s clears 3:1 against the page background', (variant) => {
    const scope = effectiveDeclarations(`.${variant}`);
    const ringName = resolveThemeToken(scope.get('--button-focus-ring') ?? '', scope);
    for (const [themeName, tokens] of themes) {
      const background = hexFor('--background', tokens, '--background');
      const ringHex = hexFor(ringName, tokens, `${variant}'s --button-focus-ring`);
      expect(
        contrastRatio(ringHex, background),
        `${themeName} ${variant} ring vs page bg`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  // Under the single-tone model only default and destructive need a family
  // color of their own; everything else shares the kit-wide --ring, same as
  // every non-Button control. Guards against a future edit silently
  // re-special-casing one of those four.
  it('resolves default and destructive to their own ring tone and the rest to --ring', () => {
    const ringNameFor = (variant: string) => {
      const scope = effectiveDeclarations(`.${variant}`);
      return resolveThemeToken(scope.get('--button-focus-ring') ?? '', scope);
    };
    expect(ringNameFor('variantDefault')).toBe('--primary-ring');
    expect(ringNameFor('variantDestructive')).toBe('--destructive-ring');
    const sharedRingVariants = variants.filter(
      (variant) => variant !== 'variantDefault' && variant !== 'variantDestructive',
    );
    for (const variant of sharedRingVariants) {
      expect(ringNameFor(variant), variant).toBe('--ring');
    }
  });
});

/*
 * Guards the destructive hover fill recipe. The old recipe mixed
 * --destructive toward --foreground, which darkens in light mode but
 * LIGHTENS in dark (the token flips near-white there) and dropped the
 * fixed white label to ~3.90:1 — under the 4.5:1 floor. The fix is the
 * --destructive-hover token (tokens.test.ts holds the label to 4.5:1 on
 * it in both themes), so the guard here is that this rule actually paints
 * the token rather than re-deriving a theme-dependent mix.
 */
describe('Button destructive hover fill', () => {
  it('paints --destructive-hover, not a mix toward --foreground', () => {
    const hover = rules.find((rule) => rule.selector === '.variantDestructive:hover');
    expect(hover, '.variantDestructive:hover rule missing').toBeDefined();
    const background = declarationMap(hover?.body ?? '').get('background-color');
    expect(background).toContain('var(--destructive-hover)');
    expect(background).not.toContain('color-mix');
  });
});

/*
 * Guards the custom-color override API: every variant's rest and hover
 * colors must route through the documented --button-* hooks (with the
 * variant's own token as the var() fallback), so a consumer class setting
 * `--button-bg`/`--button-bg-hover`/`--button-fg`/`--button-fg-hover`
 * recolors the button in every state. A hard-coded color here silently
 * breaks that contract — this suite is what notices.
 */
describe('Button custom-color API', () => {
  function hoverDeclarations(targetClass: string): Map<string, string> {
    const merged = new Map<string, string>();
    for (const rule of rules) {
      const selectors = rule.selector.split(',').map((selector) => selector.replace(/\s+/g, ''));
      if (selectors.includes(`${targetClass}:hover`)) {
        for (const [prop, value] of declarationMap(rule.body)) {
          merged.set(prop, value);
        }
      }
    }
    return merged;
  }

  it.each(variants)('%s routes rest colors through --button-bg/--button-fg', (variant) => {
    const rest = effectiveDeclarations(`.${variant}`);
    expect(rest.get('background-color'), `${variant} background-color`).toMatch(/^var\(--button-bg,/);
    expect(rest.get('color'), `${variant} color`).toMatch(/^var\(--button-fg,/);
  });

  it.each(variants)('%s routes hover colors through the -hover chain', (variant) => {
    const hover = hoverDeclarations(`.${variant}`);
    expect(hover.get('background-color'), `${variant}:hover background-color`).toMatch(
      /^var\(\s*--button-bg-hover,\s*var\(\s*--button-bg,/,
    );
    expect(hover.get('color'), `${variant}:hover color`).toMatch(
      /^var\(\s*--button-fg-hover,\s*var\(\s*--button-fg,/,
    );
  });
});
