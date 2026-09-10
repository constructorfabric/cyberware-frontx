import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { ThemeAwareReactLifecycle } from '@gears-frontx/react';
import kitThemeCss from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { anchorKitThemeOnShadowHost } from './shared/anchorKitThemeOnShadowHost';
import { HomeScreen } from './screens/home/HomeScreen';

/**
 * `@gears-frontx/ui-kit`'s design tokens, scoped to this MFE's shadow root.
 *
 * Rewritten once at module load rather than per mount: the source never
 * changes, and every mounted instance appends the same text.
 *
 * The alternative — loading `theme.css` into the host document instead — is
 * rejected on purpose: the host document's token declarations belong to the
 * shell (which imports the kit's CSS at its own entry), and this MFE cannot
 * assume which shell build hosts it. Anchoring the kit's tokens on this
 * shadow host keeps the screens correct in any host.
 */
const kitThemeCssForShadowRoot = anchorKitThemeOnShadowHost(kitThemeCss);

class BlankMfeLifecycle extends ThemeAwareReactLifecycle {
  constructor() {
    // ThemeAwareReactLifecycle consumes the host handoff and passes the
    // shared server-state runtime into FrontXProvider for this mounted root.
    super(mfeApp);
  }

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
   * The kit's own `[data-theme]` rule paints the screen root, which is the
   * shadow root's only rendered child and sits at the host's origin covering
   * its full width and height. A screen that leaves part of the host
   * uncovered has to paint the host itself.
   *
   * `@gears-frontx/mfes` exports `injectStylesheet`, which is these three lines
   * plus id-keyed idempotency, and is deliberately not used: it takes a
   * `ShadowRoot` where this hook is handed `Element | ShadowRoot`, and the
   * package is not a runtime dependency of an MFE.
   */
  protected override initializeStyles(container: Element | ShadowRoot): void {
    const style = document.createElement('style');
    style.textContent = kitThemeCssForShadowRoot;
    container.appendChild(style);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <HomeScreen bridge={bridge} />;
  }
}

/**
 * Export a singleton instance of the lifecycle class.
 * Module Federation expects a default export; the handler calls
 * moduleFactory() which returns this module, then validates it
 * has mount/unmount methods.
 */
export default new BlankMfeLifecycle();
