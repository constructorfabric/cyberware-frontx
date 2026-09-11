import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  FrontXApp,
  MfeEntryLifecycle,
  ChildMfeBridge,
  MfeMountContext,
} from '@gears-frontx/framework';
import { FrontXProvider } from '../FrontXProvider';
import { hasFrontXQueryClientActivator, resolveFrontXQueryClient } from '../queryClient';

/**
 * Marks every node `adoptHostStylesIntoShadowRoot` puts into a shadow root, so
 * a later mount can find its own previous block and replace it.
 *
 * A marker attribute rather than the single `id` that
 * `injectStylesheet`/`injectCssVariables` key on in `@gears-frontx/mfes`'
 * shadow utilities, because the adopted block is many nodes whose order
 * relative to each other is load-bearing: one id can only name one of them.
 */
const ADOPTED_HOST_STYLE_ATTR = 'data-frontx-adopted-host-style';

/** Identity of the base-resets node, so a remount reuses it instead of adding a second. */
const BASE_RESETS_STYLE_ID = '__frontx-base-resets__';

/**
 * Ids of the style nodes `@gears-frontx/mfes` puts in a shadow root itself -
 * the isolation block from `createShadowRoot` and the theme variables from
 * `injectCssVariables`. Together with the adopted block they are the
 * shell-owned head of the shadow root, and the base resets belong at its end:
 * after them, ahead of the MFE's own CSS.
 *
 * Mirrored here rather than imported because those utilities keep the ids as
 * local constants. The values are what the shell puts in the shadow root, so
 * they change only when the shell changes them - and the remount test pins
 * this list against the ids those utilities actually emit.
 */
const SHELL_OWNED_SHADOW_STYLE_IDS = ['__frontx-shadow-isolation__', '__frontx-css-variables__'];

interface ProviderMountOptions {
  mfeBridge?: {
    bridge: ChildMfeBridge;
    extensionId: string;
    domainId: string;
  };
}

function resolveProviderMountOptions(
  app: FrontXApp,
  bridge: ChildMfeBridge,
  mountContext?: MfeMountContext
): ProviderMountOptions {
  const extensionId = mountContext?.extensionId;
  const domainId = mountContext?.domainId;
  const isMountedMfe = typeof extensionId === 'string' && typeof domainId === 'string';

  if (
    isMountedMfe &&
    !resolveFrontXQueryClient(app) &&
    !hasFrontXQueryClientActivator(app)
  ) {
    throw new Error(
      '[FrontXProvider] Mounted MFEs require queryCacheShared() in the child app and queryCache() in the host app before loading the MFE app.'
    );
  }

  return {
    mfeBridge:
      isMountedMfe
        ? { bridge, extensionId, domainId }
        : undefined,
  };
}

interface MountRuntimeAwareProviderProps {
  readonly app: FrontXApp;
  readonly mfeBridge?: Readonly<{
    readonly bridge: ChildMfeBridge;
    readonly extensionId: string;
    readonly domainId: string;
  }>;
  readonly children: React.ReactNode;
}

function MountRuntimeAwareProvider({
  app,
  mfeBridge,
  children,
}: Readonly<MountRuntimeAwareProviderProps>): React.JSX.Element {
  return (
    <FrontXProvider app={app} mfeBridge={mfeBridge}>
      {children}
    </FrontXProvider>
  );
}

/**
 * Abstract base class for React-based MFE lifecycle implementations.
 *
 * Styling strategy:
 * 1. adoptHostStylesIntoShadowRoot() clones all host <style> and <link> into the
 *    front of the shadow root, bringing the full compiled Tailwind CSS (including
 *    MFE utilities, since the host's content paths cover src-app/mfe_packages/**) and
 *    the ui-kit component CSS (the host entry side-effect-imports
 *    @gears-frontx/ui-kit so that CSS exists in the host document; the kit's
 *    CSS-module class names are stable per kit version, so they match the
 *    classes MFE bundles reference only while host and MFE install the same
 *    kit version - the template-pin-drift policy check is what guarantees
 *    that; a drifted MFE renders its kit components unstyled with no error).
 *    Front, not back, so the MFE's own stylesheets
 *    outrank them - see the method. Design tokens must therefore be full CSS
 *    colors - both Tailwind utilities (var(--x)) and ui-kit component CSS
 *    consume them directly.
 * 2. injectBaseResets() adds box-model resets and :host defaults that aren't part
 *    of Tailwind's compiled output but are needed for consistent rendering, and
 *    positions them at the end of the shell-owned head - after the adopted block
 *    and the isolation style, ahead of the MFE's own CSS.
 * 3. Subclasses may override initializeStyles() to inject additional CSS that is
 *    not covered by the host stylesheet (e.g., MFE-specific @font-face rules).
 *
 * Every mount therefore leaves the same sequence - adopted host block, shadow
 * isolation, base resets, then the MFE's stylesheets - so the shell's CSS is
 * context and the MFE wins every specificity tie against all three shell blocks.
 * Steps 1 and 2 both position what they own rather than appending beside it,
 * because a remounted container arrives with its shadow root intact and the MFE's
 * own stylesheet removed and re-appended around the remount - see each method.
 *
 * Theme CSS variables are delivered via CSS inheritance from :root (Shadow DOM)
 * or via MountManager injection (iframe). MFE lifecycles do NOT need to subscribe
 * to theme changes or call applyThemeToShadowRoot.
 *
 * Concrete subclasses must provide:
 * - `renderContent(bridge)` - screen component rendering
 */
export abstract class ThemeAwareReactLifecycle implements MfeEntryLifecycle<ChildMfeBridge> {
  private root: Root | null = null;

  constructor(private readonly app: FrontXApp) { }

  mount(container: Element | ShadowRoot, bridge: ChildMfeBridge, mountContext?: MfeMountContext): void {
    if (container instanceof ShadowRoot) {
      this.adoptHostStylesIntoShadowRoot(container);
    }

    this.injectBaseResets(container);
    this.initializeStyles(container);

    const providerMountOptions = resolveProviderMountOptions(this.app, bridge, mountContext);
    this.root = createRoot(container);
    this.root.render(
      <MountRuntimeAwareProvider
        app={this.app}
        mfeBridge={providerMountOptions.mfeBridge}
      >
        {this.renderContent(bridge)}
      </MountRuntimeAwareProvider>
    );
  }

  unmount(_container: Element | ShadowRoot): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  /**
   * Copy all inline <style> and <link rel="stylesheet"> from the host document
   * into the shadow root so that Tailwind and component styles apply inside the MFE.
   *
   * The clones are inserted ahead of everything already in the shadow root, never
   * appended, because adopted host styles are context rather than authority: where
   * they and the MFE's own CSS declare the same property at equal specificity, the
   * MFE has to win. Appending inverted that. `MfeHandlerMF` injects the MFE's
   * compiled stylesheet into the shadow root before it calls mount, so an appended
   * clone of the shell's Tailwind preflight - whose
   * `button, [type='button'], [type='reset'], [type='submit']` rule sets
   * `background-color: transparent` at specificity (0,1,0) - tied with
   * `@gears-frontx/ui-kit`'s single-class button rule and won on document order,
   * leaving every kit Button transparent until it was hovered.
   *
   * Inserting at the front rather than pushing MFE styles to the back is what makes
   * the invariant hold for stylesheets that appear after mount too - a lazily
   * imported component's CSS module, or whatever initializeStyles() adds - since
   * those land behind the adopted block by construction.
   *
   * A cascade layer around the adopted CSS was the alternative and is rejected:
   * layered rules lose to unlayered ones at *any* specificity, so a host utility
   * class would stop overriding an MFE element selector. Document order keeps
   * specificity in charge and only settles the ties.
   *
   * The block replaces its predecessor instead of stacking on it, the same
   * upsert shape `injectStylesheet` and `injectCssVariables` use in
   * `@gears-frontx/mfes`' shadow utilities, widened from one id-keyed node to a
   * marked block. Replacement is required rather than tidy: `createShadowRoot`
   * hands back an existing `element.shadowRoot` instead of attaching a new one,
   * so remounting the same container runs this method again on a shadow root
   * that already holds a full adopted block, and appending would grow it once
   * per mount with no bound. It does not save re-resolving the cloned `<link>`s -
   * every mount clones them afresh and the browser resolves each clone; what
   * replacement buys is that the count stays at one block instead of one per
   * mount.
   *
   * The block is rebuilt from the host head rather than left in place, because
   * the head is not fixed: a lazily imported chunk adds stylesheets to it after
   * the first mount, and the second mount has to pick those up.
   *
   * The fresh block goes in before the previous one comes out. Removing first
   * leaves the shadow root with no host CSS at all, and everything between that
   * removal and the insertion is synchronous work in this same task - so the gap
   * never reaches a paint, but any code that reads computed styles from the tree
   * in between sees an unstyled one. Inserting first costs one moment with two
   * blocks present, which changes nothing: the old block is a clone of the same
   * host head and loses every tie to the new one on document order anyway.
   */
  protected adoptHostStylesIntoShadowRoot(shadowRoot: ShadowRoot): void {
    // Collected before the insertion, so the marked nodes this removes are only
    // the ones already there: the fresh clones below carry the same marker and
    // a selector query after the insertion would match them too.
    const supersededStyles = Array.from(shadowRoot.querySelectorAll(`[${ADOPTED_HOST_STYLE_ATTR}]`));

    const adoptedStyles = document.createDocumentFragment();

    // One query covering both kinds, because querySelectorAll returns document
    // order: querying <style> and <link> separately would concatenate the two
    // groups instead, so a host declaring <link A> before <style B> would get
    // them adopted as B then A. That reordering decides which rule wins every
    // specificity tie between them, which is the tie this whole method exists
    // to settle - so the adopted block has to preserve the host's own order,
    // not just sit ahead of the MFE's CSS.
    const hostStyleNodes = document.head.querySelectorAll('style, link[rel="stylesheet"]');
    hostStyleNodes.forEach((el) => {
      if (el instanceof HTMLStyleElement) {
        const clone = document.createElement('style');
        clone.textContent = el.textContent ?? '';
        clone.setAttribute(ADOPTED_HOST_STYLE_ATTR, '');
        adoptedStyles.appendChild(clone);
        return;
      }
      const linkClone = el.cloneNode(true) as Element;
      linkClone.setAttribute(ADOPTED_HOST_STYLE_ATTR, '');
      adoptedStyles.appendChild(linkClone);
    });

    // Staged in a fragment so the adopted pieces keep their host-document order
    // relative to each other while moving as one block to the front.
    shadowRoot.insertBefore(adoptedStyles, shadowRoot.firstChild);
    supersededStyles.forEach((el) => el.remove());
  }

  /**
   * Box-model resets and :host defaults needed inside every shadow root.
   * These aren't part of Tailwind's compiled output but are required for
   * consistent rendering across browsers.
   *
   * Reuses the node a previous mount left behind, exactly as `injectStylesheet`
   * does in `@gears-frontx/mfes`' shadow utilities: a remount runs against a
   * shadow root that `createShadowRoot` handed back intact, and appending a
   * second copy would add one node per mount forever.
   *
   * Reuse alone is not enough, which is why the node is also positioned on every
   * mount rather than left where the previous one sat. These resets are context
   * like the adopted block is - `border-color: currentColor` on `*` is a 0-0-0
   * declaration that beats an MFE preflight's own 0-0-0 reset purely on document
   * order - so they have to stay ahead of the MFE's CSS, and where they land is
   * not stable on its own. `MfeHandlerMF.wrapLifecycleWithStylesheets` removes the
   * MFE's stylesheet on unmount and appends a fresh one before the next mount, so
   * a node merely left in place ends up ahead of that stylesheet on a remount and
   * behind it on the first mount: two different cascades for one component.
   * Anchoring it to the end of the shell-owned head gives every mount the same
   * order - adopted block, isolation, resets, MFE - which is also the order the
   * adoption method's invariant is written against.
   *
   * With no shell-owned node to anchor to, the resets go to the front. That is the
   * plain-`Element` container: no adopted block, no isolation style, and the MFE
   * stylesheet already appended by the handler, so the front is again the only
   * position that leaves the MFE winning ties.
   *
   * Looked up by attribute-selector form rather than `getElementById`, which
   * `ShadowRoot` has but `Element` does not, and this hook takes either.
   */
  private injectBaseResets(container: Element | ShadowRoot): void {
    const existing = container.querySelector<HTMLStyleElement>(
      `style[id="${BASE_RESETS_STYLE_ID}"]`
    );
    const style = existing ?? document.createElement('style');
    style.id = BASE_RESETS_STYLE_ID;
    style.textContent = `
      *, *::before, *::after {
        box-sizing: border-box;
        border-width: 0;
        border-style: solid;
        border-color: currentColor;
      }
      * { margin: 0; padding: 0; }
      :host {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        color: var(--foreground);
        background-color: var(--background);
      }
    `;
    // Runs whether the node is new or reused: `insertBefore` moves a node that
    // is already in the tree, and is a no-op when it already sits there.
    const shellOwnedHead = container.querySelectorAll(
      [
        `[${ADOPTED_HOST_STYLE_ATTR}]`,
        ...SHELL_OWNED_SHADOW_STYLE_IDS.map((id) => `[id="${id}"]`),
      ].join(', ')
    );
    const lastShellOwnedNode = shellOwnedHead[shellOwnedHead.length - 1];
    container.insertBefore(
      style,
      lastShellOwnedNode ? lastShellOwnedNode.nextSibling : container.firstChild
    );
  }

  /**
   * Hook for subclasses to inject additional CSS not covered by the adopted host
   * stylesheet (e.g., MFE-specific @font-face rules or custom animations).
   * No-op by default: host styles adopted in adoptHostStylesIntoShadowRoot()
   * already include all Tailwind utilities compiled from MFE source files.
   */
  protected initializeStyles(_container: Element | ShadowRoot): void {
    // No-op by default.
  }

  /**
   * Return the screen-specific React component tree.
   */
  protected abstract renderContent(bridge: ChildMfeBridge): React.ReactNode;
}
