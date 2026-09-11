/**
 * Lifecycle base for demo-mfe screens built from `@gears-frontx/ui-kit`.
 *
 * Three of this package's five entries render kit components and therefore
 * need the kit's design tokens inside their own shadow root; they extend this
 * class instead of `ThemeAwareReactLifecycle` directly. The other two —
 * `lifecycle-theme` and `lifecycle-widgets-host` — deliberately do not: they
 * paint from the shell's Tailwind colour utilities alone, render no kit
 * components, and so need no kit CSS inside their shadow root.
 */

import { ThemeAwareReactLifecycle } from '@gears-frontx/react';
import kitThemeCss from '@gears-frontx/ui-kit/theme.css?inline';
import { anchorKitThemeOnShadowHost } from './anchorKitThemeOnShadowHost';

/**
 * `@gears-frontx/ui-kit`'s design tokens, scoped to a shadow root.
 *
 * Rewritten once at module load rather than per mount: the source never
 * changes, and every mounted instance appends the same text.
 *
 * The alternative — loading `theme.css` into the host document instead — is
 * rejected on purpose: the host document's token declarations belong to the
 * shell (which imports the kit's CSS at its own entry), and this MFE cannot
 * assume which shell build hosts it. Anchoring the kit's tokens on the
 * shadow host keeps the screens correct in any host.
 */
const kitThemeCssForShadowRoot = anchorKitThemeOnShadowHost(kitThemeCss);

/**
 * A `ThemeAwareReactLifecycle` whose shadow root carries the kit's tokens.
 */
export abstract class KitThemedLifecycle extends ThemeAwareReactLifecycle {
  /**
   * The base class adopts the host document's stylesheets into the shadow root;
   * the kit's tokens are not among them, and this is the hook the base class
   * documents for exactly that gap.
   *
   * These tokens compose with the base resets the same base class injects:
   * `injectBaseResets` paints `:host` with `var(--foreground)` and
   * `var(--background)` (full CSS colours since the shell's token migration),
   * and the kit declares those same names as complete colours on the same
   * `:host`, so the host paints in the kit's palette for the active theme.
   * Every kit-themed screen here still paints its own root through its
   * `.screen` rule; a screen that leaves part of the host uncovered has to
   * paint the host itself.
   */
  protected override initializeStyles(container: Element | ShadowRoot): void {
    const style = document.createElement('style');
    style.textContent = kitThemeCssForShadowRoot;
    container.appendChild(style);
  }
}
