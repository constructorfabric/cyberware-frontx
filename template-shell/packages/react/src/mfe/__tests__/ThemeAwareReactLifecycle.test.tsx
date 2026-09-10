/**
 * Unit tests for the style-adoption half of ThemeAwareReactLifecycle.
 *
 * The cascade inside a shadow root is settled by document order once specificity
 * ties, so these cases assert the position of the adopted host stylesheets rather
 * than any computed colour: jsdom does not resolve a shadow-tree cascade, and the
 * position is the whole mechanism the invariant rests on.
 */
import type React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { createFrontX, type ChildMfeBridge } from '@gears-frontx/framework';
import { ThemeAwareReactLifecycle } from '../ThemeAwareReactLifecycle';

/**
 * Stands in for the shell's Tailwind preflight. Neutral, test-owned CSS, but the
 * shape is the one that caused the defect: an attribute selector at specificity
 * (0,1,0) that ties with a single-class component rule.
 */
const HOST_PREFLIGHT_CSS = "button, [type='submit'] { background-color: transparent; }";

const HOST_LINK_HREF = 'https://shell.test/assets/shell.css';

/** Stands in for the MFE's compiled stylesheet, which MfeHandlerMF injects before mount. */
const MFE_BUTTON_CSS = '._variantDefault { background-color: var(--primary); }';

const MFE_LINK_HREF = 'https://remote.test/assets/blank-mfe.css';

/** Stands in for a CSS module that reaches the shadow root after mounting has started. */
const LATE_MODULE_CSS = '._lazyPanel { padding: 1rem; }';

class ProbeLifecycle extends ThemeAwareReactLifecycle {
  /** Widens the protected hook so a case can exercise adoption without a full mount. */
  adoptInto(shadowRoot: ShadowRoot): void {
    this.adoptHostStylesIntoShadowRoot(shadowRoot);
  }

  protected renderContent(_bridge: ChildMfeBridge): React.ReactNode {
    return null;
  }
}

function adoptIntoFreshLifecycle(shadowRoot: ShadowRoot): void {
  new ProbeLifecycle(createFrontX().build()).adoptInto(shadowRoot);
}

/** Nothing in these cases reaches the bridge - renderContent ignores it. */
const noopBridge = {} as ChildMfeBridge;

function appendHostStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function appendHostLink(href: string): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function shadowRootHoldingMfeStyle(css: string): ShadowRoot {
  const shadowRoot = document.createElement('div').attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadowRoot.appendChild(style);
  return shadowRoot;
}

/**
 * Ids and text mirroring what `@gears-frontx/mfes` itself puts in a shadow root:
 * `createShadowRoot` appends the isolation style when it attaches the root, and
 * `MfeHandlerMF.upsertStyleElement` appends the MFE's compiled stylesheet under
 * an id-keyed handle before every mount. Spelled out rather than imported
 * because both are local constants over there, and the point of the remount case
 * is to hold the lifecycle against the values that actually reach it.
 */
const SHADOW_ISOLATION_STYLE_ID = '__frontx-shadow-isolation__';
const SHADOW_ISOLATION_CSS = ':host {\n  all: initial;\n  display: block;\n}';
const MFE_RUNTIME_STYLE_ID = '__frontx-mfe-runtime-style-0';

/** The shadow root a mount really arrives at: isolation style already appended. */
function shadowRootWithIsolationStyle(): ShadowRoot {
  const shadowRoot = document.createElement('div').attachShadow({ mode: 'open' });
  const isolation = document.createElement('style');
  isolation.id = SHADOW_ISOLATION_STYLE_ID;
  isolation.textContent = SHADOW_ISOLATION_CSS;
  shadowRoot.appendChild(isolation);
  return shadowRoot;
}

/** Mirrors MfeHandlerMF appending the MFE's stylesheet ahead of each mount. */
function appendMfeRuntimeStyle(shadowRoot: ShadowRoot, css: string): void {
  const style = document.createElement('style');
  style.id = MFE_RUNTIME_STYLE_ID;
  style.textContent = css;
  shadowRoot.appendChild(style);
}

/** Mirrors MfeHandlerMF removing its injected stylesheets on unmount. */
function removeMfeRuntimeStyles(shadowRoot: ShadowRoot): void {
  shadowRoot.querySelectorAll(`[id^="__frontx-mfe-runtime-style-"]`).forEach((el) => el.remove());
}

function shadowRootHoldingMfeLink(href: string): ShadowRoot {
  const shadowRoot = document.createElement('div').attachShadow({ mode: 'open' });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  shadowRoot.appendChild(link);
  return shadowRoot;
}

/** Identifies each stylesheet node in cascade order: inline CSS for a style, href for a link. */
function cascadeOrder(shadowRoot: ShadowRoot): string[] {
  return Array.from(shadowRoot.querySelectorAll('style, link[rel="stylesheet"]')).map((el) =>
    el instanceof HTMLLinkElement ? el.href : (el.textContent ?? '')
  );
}

describe('ThemeAwareReactLifecycle.adoptHostStylesIntoShadowRoot', () => {
  afterEach(() => {
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => el.remove());
  });

  it('places the adopted host stylesheet ahead of an MFE stylesheet already in the shadow root, so a tied host rule cannot win on document order', () => {
    appendHostStyle(HOST_PREFLIGHT_CSS);
    const shadowRoot = shadowRootHoldingMfeStyle(MFE_BUTTON_CSS);

    adoptIntoFreshLifecycle(shadowRoot);

    expect(cascadeOrder(shadowRoot)).toEqual([HOST_PREFLIGHT_CSS, MFE_BUTTON_CSS]);
  });

  it('places adopted host <link> stylesheets ahead of the MFE <link> that MfeHandlerMF injected before mount', () => {
    appendHostLink(HOST_LINK_HREF);
    const shadowRoot = shadowRootHoldingMfeLink(MFE_LINK_HREF);

    adoptIntoFreshLifecycle(shadowRoot);

    expect(cascadeOrder(shadowRoot)).toEqual([HOST_LINK_HREF, MFE_LINK_HREF]);
  });

  it('adopts a host <link> and <style> in the order the host declares them, not grouped by kind', () => {
    // The link is declared first here on purpose: collecting <style> and <link>
    // through separate queries would concatenate the groups and hand the style
    // the later position, reversing which of the two wins a specificity tie.
    appendHostLink(HOST_LINK_HREF);
    appendHostStyle(HOST_PREFLIGHT_CSS);
    const shadowRoot = shadowRootHoldingMfeStyle(MFE_BUTTON_CSS);

    adoptIntoFreshLifecycle(shadowRoot);

    expect(cascadeOrder(shadowRoot)).toEqual([HOST_LINK_HREF, HOST_PREFLIGHT_CSS, MFE_BUTTON_CSS]);
  });

  it('puts a stylesheet arriving after adoption last, behind both the adopted block and the MFE stylesheet', () => {
    // Stands for whatever initializeStyles() or a lazily imported CSS module
    // appends once mounting is under way: only the adopted block is moved to
    // the front, so everything arriving later keeps falling behind it.
    appendHostStyle(HOST_PREFLIGHT_CSS);
    const shadowRoot = shadowRootHoldingMfeStyle(MFE_BUTTON_CSS);

    adoptIntoFreshLifecycle(shadowRoot);
    const lateStyle = document.createElement('style');
    lateStyle.textContent = ':host { color: red; }';
    shadowRoot.appendChild(lateStyle);

    expect(cascadeOrder(shadowRoot)).toEqual([
      HOST_PREFLIGHT_CSS,
      MFE_BUTTON_CSS,
      ':host { color: red; }',
    ]);
  });
});

describe('ThemeAwareReactLifecycle remount', () => {
  afterEach(() => {
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => el.remove());
  });

  it('leaves the same stylesheets in the same order after a second mount into the shadow root the first one used', async () => {
    // The second mount is not hypothetical: createShadowRoot() hands back an
    // existing element.shadowRoot rather than attaching a new one, and
    // unmount() removes no styles, so a remounted container arrives here
    // already carrying a full adopted block plus the base resets.
    appendHostLink(HOST_LINK_HREF);
    appendHostStyle(HOST_PREFLIGHT_CSS);
    const shadowRoot = shadowRootHoldingMfeStyle(MFE_BUTTON_CSS);
    const lifecycle = new ProbeLifecycle(createFrontX().build());

    await act(async () => {
      lifecycle.mount(shadowRoot, noopBridge);
    });
    const afterFirstMount = cascadeOrder(shadowRoot);

    await act(async () => {
      lifecycle.unmount(shadowRoot);
      lifecycle.mount(shadowRoot, noopBridge);
    });

    // Equality across the two mounts covers both halves at once: the length
    // pins that nothing accumulated - the defect was one extra adopted block
    // per mount, each cloned <link> resolved again - and the sequence pins that
    // replacing the block did not disturb the two ordering invariants the cases
    // above establish.
    expect(cascadeOrder(shadowRoot)).toEqual(afterFirstMount);
    // Named explicitly rather than left to the equality, because an adoption
    // that wiped the shadow root instead of replacing its own block would
    // satisfy the equality and still take the MFE's own CSS with it.
    expect(cascadeOrder(shadowRoot)).toContain(MFE_BUTTON_CSS);
    expect(cascadeOrder(shadowRoot)).toEqual([
      HOST_LINK_HREF,
      HOST_PREFLIGHT_CSS,
      expect.stringContaining('box-sizing: border-box'),
      MFE_BUTTON_CSS,
    ]);
  });

  it('leaves one identical order when the MFE stylesheet is removed and re-appended around the remount', async () => {
    // The real remount, not a repeated mount: MfeHandlerMF wraps this lifecycle,
    // removes the MFE's stylesheet on unmount and appends a fresh one before the
    // next mount, so the node the shell's blocks have to stay ahead of is a new
    // node in a new position. A base-resets node merely left where the first
    // mount put it lands behind that stylesheet the first time and ahead of it
    // the second - one component, two cascades - which is what the full-order
    // equality below rules out.
    appendHostStyle(HOST_PREFLIGHT_CSS);
    const shadowRoot = shadowRootWithIsolationStyle();
    appendMfeRuntimeStyle(shadowRoot, MFE_BUTTON_CSS);
    const lifecycle = new ProbeLifecycle(createFrontX().build());

    await act(async () => {
      lifecycle.mount(shadowRoot, noopBridge);
    });
    const afterFirstMount = cascadeOrder(shadowRoot);

    await act(async () => {
      removeMfeRuntimeStyles(shadowRoot);
      lifecycle.unmount(shadowRoot);
      appendMfeRuntimeStyle(shadowRoot, MFE_BUTTON_CSS);
      lifecycle.mount(shadowRoot, noopBridge);
    });

    // Spelled out on the first mount too, so the equality holds the pair against
    // a stated order rather than against whatever the first mount happened to do.
    expect(afterFirstMount).toEqual([
      HOST_PREFLIGHT_CSS,
      SHADOW_ISOLATION_CSS,
      expect.stringContaining('box-sizing: border-box'),
      MFE_BUTTON_CSS,
    ]);
    expect(cascadeOrder(shadowRoot)).toEqual(afterFirstMount);
  });

  it('inserts the fresh adopted block before removing the block the previous mount left', async () => {
    // Between the two there is no paint, but there is synchronous work: anything
    // reading computed styles off the shadow tree in that window - the render
    // this method is called from, a subclass hook, a resize observer - would see
    // it with no host CSS at all. Records are queued in mutation order, so the
    // first addition arriving before the first removal is the claim.
    appendHostStyle(HOST_PREFLIGHT_CSS);
    const shadowRoot = shadowRootWithIsolationStyle();
    adoptIntoFreshLifecycle(shadowRoot);

    const mutationKinds: string[] = [];
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.addedNodes.length > 0) mutationKinds.push('added');
        if (record.removedNodes.length > 0) mutationKinds.push('removed');
      });
    });
    observer.observe(shadowRoot, { childList: true });

    adoptIntoFreshLifecycle(shadowRoot);
    await act(async () => {
      await Promise.resolve();
    });
    observer.disconnect();

    expect(mutationKinds).toContain('added');
    expect(mutationKinds).toContain('removed');
    expect(mutationKinds.indexOf('added')).toBeLessThan(mutationKinds.indexOf('removed'));
  });

  it('keeps the base resets behind a stylesheet that arrived between the two mounts', async () => {
    // Appending the resets on the second mount instead of positioning them at
    // the shell-owned head would move them past this one, and the resets are
    // context like the adopted block is: moved to the back they start winning
    // the specificity ties against the MFE's CSS that the front-insertion above
    // exists to make the MFE win.
    appendHostStyle(HOST_PREFLIGHT_CSS);
    const shadowRoot = shadowRootHoldingMfeStyle(MFE_BUTTON_CSS);
    const lifecycle = new ProbeLifecycle(createFrontX().build());

    await act(async () => {
      lifecycle.mount(shadowRoot, noopBridge);
    });

    // Stands for a lazily imported component's CSS module, which lands in the
    // shadow root once mounting is under way rather than before it.
    const lateStyle = document.createElement('style');
    lateStyle.textContent = LATE_MODULE_CSS;
    shadowRoot.appendChild(lateStyle);

    await act(async () => {
      lifecycle.unmount(shadowRoot);
      lifecycle.mount(shadowRoot, noopBridge);
    });

    const order = cascadeOrder(shadowRoot);
    const resetsIndex = order.findIndex((css) => css.includes('box-sizing: border-box'));
    expect(resetsIndex).toBeGreaterThan(-1);
    expect(resetsIndex).toBeLessThan(order.indexOf(LATE_MODULE_CSS));
  });
});
