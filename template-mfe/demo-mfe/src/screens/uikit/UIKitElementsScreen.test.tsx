import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { FRONTX_SHARED_PROPERTY_LANGUAGE, FRONTX_SHARED_PROPERTY_THEME } from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@gears-frontx/mfe-test-support/createMfeBridgeFixture';
import { mockShadowHost } from '@gears-frontx/mfe-test-support/mockShadowHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  observeSpy,
  toasterContainerSpy,
  toasterLabelsSpy,
  useScreenTranslationsMock,
} = vi.hoisted(() => ({
  observeSpy: vi.fn(),
  toasterContainerSpy: vi.fn(),
  toasterLabelsSpy: vi.fn(),
  useScreenTranslationsMock: vi.fn(),
}));

vi.mock('../../shared/useScreenTranslations', () => ({
  useScreenTranslations: useScreenTranslationsMock,
}));

// One shared `observe` across instances: the screen may rebuild its observer as
// the screen's own state changes, and what the assertions care about is which
// nodes were handed to one, not which instance took them.
class MockIntersectionObserver {
  observe = observeSpy;
  disconnect = vi.fn();
  unobserve = vi.fn();
}

// Stub children to isolate the screen's bridge wiring. No assertions are made on
// their output; their only purpose is to keep JSDOM happy (portalled popups,
// toasts, and the heavy kit tree would otherwise force additional global
// polyfills without adding coverage over what E2E tests already cover).
vi.mock('./components/CategoryMenu', () => ({ CategoryMenu: () => null }));
// The one exception: this category carries the DOM id the scroll-spy looks for,
// so there is a node to observe. Like every category it arrives from its own
// React.lazy chunk, in a commit after the screen's own.
vi.mock('./components/LayoutElements', () => ({
  LayoutElements: () => <div id="element-card" />,
}));
vi.mock('./components/NavigationElements', () => ({ NavigationElements: () => null }));
vi.mock('./components/FormElements', () => ({ FormElements: () => null }));
vi.mock('./components/ActionElements', () => ({ ActionElements: () => null }));
vi.mock('./components/FeedbackElements', () => ({ FeedbackElements: () => null }));
vi.mock('./components/DataDisplayElements', () => ({ DataDisplayElements: () => null }));
vi.mock('./components/OverlayElements', () => ({ OverlayElements: () => null }));

// Only the Toaster is replaced: it mounts a portalled viewport and a global
// toast manager the screen never asserts on, while Card and Skeleton around it
// stay real so the screen renders the tree it actually ships.
//
// The stand-in keeps the one behaviour the screen's layout depends on: Base UI
// resolves `container` from the ref in a layout effect on its first commit, and
// never re-resolves it, so what that effect reads is the whole question. A
// container rendered after the Toaster is not attached yet at that point and the
// real component falls back to `<body>`, outside the shadow root and the theme
// scope both.
vi.mock('@gears-frontx/ui-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gears-frontx/ui-kit')>();
  return {
    ...actual,
    Toaster: ({ container, label, closeLabel }: {
      container?: React.RefObject<HTMLElement | null>;
      label?: string;
      closeLabel?: string;
    }) => {
      React.useLayoutEffect(() => {
        toasterContainerSpy(container?.current ?? null);
      }, [container]);
      toasterLabelsSpy({ label, closeLabel });
      return null;
    },
  };
});

async function setupUIKitElementsScreen() {
  const { UIKitElementsScreen } = await import('./UIKitElementsScreen');
  const bridgeFixture = createMfeBridgeFixture({
    extDomainId: 'uikit-domain',
    extensionId: 'uikit-screen',
    initialProperties: {
      [FRONTX_SHARED_PROPERTY_THEME]: 'ocean',
      [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'de',
    },
  });

  // Raised before the render, so the screen's mount effect has a host to write
  // its direction on. Attached afterwards, that first pass reaches no host at
  // all and the initial LTR direction is asserted by nothing.
  const { host } = mockShadowHost(HTMLDivElement);
  const { rerender, unmount } = render(<UIKitElementsScreen bridge={bridgeFixture.bridge} />);

  await screen.findByRole('heading', { level: 1 });

  return {
    UIKitElementsScreen,
    bridgeFixture,
    host,
    rerender,
    unmount,
  };
}

describe('UIKitElementsScreen bridge wiring smoke', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders bridge values and initial shared properties', async () => {
    const { host } = await setupUIKitElementsScreen();

    // `de` resolves to the left-to-right default, written on the shadow host.
    expect(host.dir).toBe('ltr');
    expect(screen.getByText('uikit-domain')).toBeTruthy();
    expect(screen.getByText('uikit-screen')).toBeTruthy();
    expect(screen.getByText('ocean')).toBeTruthy();
    expect(screen.getByText('de')).toBeTruthy();
  });

  it('subscribes to theme and language bridge properties', async () => {
    const { bridgeFixture } = await setupUIKitElementsScreen();

    await waitFor(() => {
      expect(bridgeFixture.subscribeToProperty).toHaveBeenCalledWith(FRONTX_SHARED_PROPERTY_THEME, expect.any(Function));
      expect(bridgeFixture.subscribeToProperty).toHaveBeenCalledWith(FRONTX_SHARED_PROPERTY_LANGUAGE, expect.any(Function));
    });
  });

  // Every kit component that portals is handed this one node, and it only works
  // while the node exists by the time they look for it.
  it('has the portal container attached before the Toaster resolves it', async () => {
    await setupUIKitElementsScreen();

    expect(toasterContainerSpy).toHaveBeenCalledTimes(1);

    const [resolvedContainer] = toasterContainerSpy.mock.calls[0] as [HTMLElement | null];

    expect(resolvedContainer).toBeInstanceOf(HTMLElement);
    expect(resolvedContainer?.isConnected).toBe(true);
    // Inside the screen root, which is what carries the kit's theme scope and,
    // at runtime, sits inside the shadow root.
    expect(resolvedContainer?.closest('[data-theme]')).toBeTruthy();
  });

  // Base UI labels the toast region "Notifications" and each close button "Close
  // toast" in English whatever language the screen runs in, so both come from
  // this screen's namespace. The identity `t` here makes the key the value.
  it('names the toast region and its close buttons from the screen namespace', async () => {
    await setupUIKitElementsScreen();

    expect(toasterLabelsSpy).toHaveBeenCalledWith({
      label: 'toast_region_label',
      closeLabel: 'toast_close_label',
    });
  });

  // The scroll-spy has to survive two commits it does not control: the first one
  // renders the translations skeleton instead of any section, and each section
  // then arrives from its own React.lazy chunk later still. An observer built
  // once over an empty query holds no targets and reports nothing for the whole
  // session, leaving the menu's active highlight permanently dark.
  it('observes the element nodes that mount after the translations resolve', async () => {
    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: true });

    const { UIKitElementsScreen } = await import('./UIKitElementsScreen');
    const bridgeFixture = createMfeBridgeFixture({
      extDomainId: 'uikit-domain',
      extensionId: 'uikit-screen',
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: 'ocean',
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'de',
      },
    });
    const { rerender } = render(<UIKitElementsScreen bridge={bridgeFixture.bridge} />);

    expect(observeSpy).not.toHaveBeenCalled();

    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: false });
    rerender(<UIKitElementsScreen bridge={bridgeFixture.bridge} />);

    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => {
      const observedIds = observeSpy.mock.calls.map(([node]) => (node as Element).id);

      expect(observedIds).toContain('element-card');
    });
  });

  it('updates the language value and host direction', async () => {
    const { host, bridgeFixture } = await setupUIKitElementsScreen();

    expect(host.dir).toBe('ltr');

    await act(async () => {
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, 'ar');
    });

    await waitFor(() => {
      expect(host.getAttribute('dir')).toBe('rtl');
      expect(screen.getByText('ar')).toBeTruthy();
    });
  });

  it('unsubscribes from bridge properties on unmount', async () => {
    const { unmount, bridgeFixture } = await setupUIKitElementsScreen();

    unmount();

    for (const { unsubscribe } of bridgeFixture.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});
