import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_SCREEN_DOMAIN,
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  FRONTX_SHARED_PROPERTY_THEME,
  TextDirection,
} from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@gears-frontx/mfe-test-support/createMfeBridgeFixture';
import { mockShadowHost } from '@gears-frontx/mfe-test-support/mockShadowHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_ACTION_REFRESH_PROFILE,
  PROFILE_EXTENSION_ID,
  THEME_EXTENSION_ID,
  WIDGETS_HOST_EXTENSION_ID,
  WIDGETS_DOMAIN_ID,
  WIDGET_ALPHA_EXTENSION_ID,
  WIDGET_PING_ACTION_TYPE,
} from '../../shared/extension-ids';

const { useScreenTranslationsMock } = vi.hoisted(() => ({
  useScreenTranslationsMock: vi.fn(),
}));

vi.mock('../../shared/useScreenTranslations', () => ({
  useScreenTranslations: useScreenTranslationsMock,
}));

async function setupHelloWorldScreen() {
  const { HelloWorldScreen } = await import('./HelloWorldScreen');
  const executeActionsChain = vi.fn().mockResolvedValue(undefined);
  const expectedTheme = 'custom-theme';
  const expectedLanguage = 'pl';
  const bridgeFixture = createMfeBridgeFixture({
    extDomainId: 'demo-domain',
    extensionId: 'hello-world',
    executeActionsChain,
    initialProperties: {
      [FRONTX_SHARED_PROPERTY_THEME]: expectedTheme,
      [FRONTX_SHARED_PROPERTY_LANGUAGE]: expectedLanguage,
    },
  });

  // Raised before the render, so the screen's mount effect has a host to write
  // its direction on. Attached afterwards, that first pass reaches no host at
  // all and the initial LTR direction is asserted by nothing.
  const { host } = mockShadowHost(HTMLDivElement);
  const { container, rerender, unmount } = render(
    <HelloWorldScreen bridge={bridgeFixture.bridge} />
  );
  const rootElement = container.firstChild as HTMLElement | null;

  await screen.findByRole('heading', { level: 1 });

  return {
    HelloWorldScreen,
    bridgeFixture,
    executeActionsChain,
    expectedLanguage,
    expectedTheme,
    host,
    rerender,
    rootElement,
    unmount,
  };
}

describe('HelloWorldScreen', () => {
  beforeEach(() => {
    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders bridge data and initial shared properties', async () => {
    const { expectedLanguage, expectedTheme, host, rootElement } = await setupHelloWorldScreen();

    // The direction lands on the shadow host, not on the screen root, and `pl`
    // resolves to the left-to-right default.
    expect(host.dir).toBe(TextDirection.LeftToRight);
    expect(rootElement?.getAttribute('dir')).toBeNull();
    expect(screen.getByText('demo-domain')).toBeTruthy();
    expect(screen.getByText('hello-world')).toBeTruthy();
    expect(screen.getByText(expectedTheme)).toBeTruthy();
    expect(screen.getByText(expectedLanguage)).toBeTruthy();
  });

  it('subscribes to theme and language bridge properties', async () => {
    const { bridgeFixture } = await setupHelloWorldScreen();

    await waitFor(() => {
      expect(bridgeFixture.subscribeToProperty).toHaveBeenCalledWith(FRONTX_SHARED_PROPERTY_THEME, expect.any(Function));
      expect(bridgeFixture.subscribeToProperty).toHaveBeenCalledWith(FRONTX_SHARED_PROPERTY_LANGUAGE, expect.any(Function));
    });
  });

  it('updates the language value and host direction', async () => {
    const { host, bridgeFixture } = await setupHelloWorldScreen();

    expect(host.dir).toBe(TextDirection.LeftToRight);

    await act(async () => {
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, 'ar');
    });

    await waitFor(() => {
      expect(host.getAttribute('dir')).toBe(TextDirection.RightToLeft);
      expect(screen.getByText('ar')).toBeTruthy();
    });
  });

  it('dispatches the theme navigation action', async () => {
    const { executeActionsChain } = await setupHelloWorldScreen();
    const user = userEvent.setup();
    const goToThemeButton = screen.getByRole('button', { name: 'go_to_theme' });

    await user.click(goToThemeButton);

    await waitFor(() => {
      expect(executeActionsChain).toHaveBeenCalledTimes(1);
      expect(executeActionsChain).toHaveBeenCalledWith({
        action: {
          type: FRONTX_ACTION_MOUNT_EXT,
          target: FRONTX_SCREEN_DOMAIN,
          payload: { subject: THEME_EXTENSION_ID },
        },
      });
    });
  });

  it('dispatches the profile mount and refresh action chain', async () => {
    const { executeActionsChain } = await setupHelloWorldScreen();
    const user = userEvent.setup();
    const openProfileButton = screen.getByRole('button', { name: 'open_profile_refresh' });

    await user.click(openProfileButton);

    await waitFor(() => {
      expect(executeActionsChain).toHaveBeenCalledTimes(1);
      expect(executeActionsChain).toHaveBeenCalledWith({
        action: {
          type: FRONTX_ACTION_MOUNT_EXT,
          target: FRONTX_SCREEN_DOMAIN,
          payload: { subject: PROFILE_EXTENSION_ID },
        },
        next: {
          action: {
            type: DEMO_ACTION_REFRESH_PROFILE,
            target: PROFILE_EXTENSION_ID,
          },
        },
      });
    });
  });

  it('dispatches the nested Widgets Host mount, widget-a mount, and ping action chain', async () => {
    const { executeActionsChain } = await setupHelloWorldScreen();
    const user = userEvent.setup();
    const mountWidgetsHostButton = screen.getByRole('button', { name: 'mount_widgets_host_and_ping' });

    await user.click(mountWidgetsHostButton);

    await waitFor(() => {
      expect(executeActionsChain).toHaveBeenCalledTimes(1);
      expect(executeActionsChain).toHaveBeenCalledWith({
        action: {
          type: FRONTX_ACTION_MOUNT_EXT,
          target: FRONTX_SCREEN_DOMAIN,
          payload: { subject: WIDGETS_HOST_EXTENSION_ID },
        },
        next: {
          action: {
            type: FRONTX_ACTION_MOUNT_EXT,
            target: WIDGETS_DOMAIN_ID,
            payload: { subject: WIDGET_ALPHA_EXTENSION_ID },
          },
          next: {
            action: {
              type: WIDGET_PING_ACTION_TYPE,
              target: WIDGET_ALPHA_EXTENSION_ID,
              payload: {},
            },
          },
        },
      });
    });
  });

  it('unsubscribes from bridge properties on unmount', async () => {
    const { unmount, bridgeFixture } = await setupHelloWorldScreen();

    unmount();

    for (const { unsubscribe } of bridgeFixture.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});
