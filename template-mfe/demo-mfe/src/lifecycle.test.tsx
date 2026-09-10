import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMfeBridgeFixture } from '@gears-frontx/mfe-test-support/createMfeBridgeFixture';
import { KitThemedLifecycle } from './shared/KitThemedLifecycle';

type BridgeFixture = ReturnType<typeof createMfeBridgeFixture>;
type TestBridge = BridgeFixture['bridge'];
type TestApp = { id: string };
type ActionPayload = Record<string, string | number | boolean | null>;

const superMountSpy = vi.fn();
const fetchUserSpy = vi.fn();

vi.mock('@gears-frontx/react', () => ({
  ActionHandler: class ActionHandler {
    static {
      void 0;
    }
  },
  ThemeAwareReactLifecycle: class ThemeAwareReactLifecycle {
    constructor(public readonly app: TestApp) {}

    mount(container: Element | ShadowRoot, bridge: TestBridge): void {
      superMountSpy(container, bridge);
    }
  },
}));

vi.mock('./init', () => ({
  mfeApp: { id: 'demo-mfe-app' },
}));

vi.mock('./actions/profileActions', () => ({
  fetchUser: fetchUserSpy,
}));

vi.mock('./screens/helloworld/HelloWorldScreen', () => ({
  HelloWorldScreen: ({ bridge }: { bridge: { extensionId: string } }) => (
    <div data-testid="hello-screen">{bridge.extensionId}</div>
  ),
}));

vi.mock('./screens/profile/ProfileScreen', () => ({
  ProfileScreen: ({ bridge }: { bridge: { extDomainId: string } }) => (
    <div data-testid="profile-screen">{bridge.extDomainId}</div>
  ),
}));

vi.mock('./screens/theme/CurrentThemeScreen', () => ({
  CurrentThemeScreen: ({ bridge }: { bridge: { extensionId: string } }) => (
    <div data-testid="theme-screen">{bridge.extensionId}</div>
  ),
}));

vi.mock('./screens/uikit/UIKitElementsScreen', () => ({
  UIKitElementsScreen: ({ bridge }: { bridge: { extensionId: string } }) => (
    <div data-testid="uikit-screen">{bridge.extensionId}</div>
  ),
}));

describe('demo-mfe lifecycles', () => {
  it('renders the hello world lifecycle content', async () => {
    const module = await import('./lifecycle-helloworld');
    const lifecycle = module.default;
    const renderContent = Reflect.get(lifecycle, 'renderContent') as (
      bridge: TestBridge,
    ) => React.ReactNode;
    const { bridge } = createMfeBridgeFixture({
      extDomainId: 'demo-domain',
      extensionId: 'hello-instance',
    });

    expect(Reflect.get(lifecycle, 'app')).toEqual({ id: 'demo-mfe-app' } satisfies TestApp);
    render(<>{renderContent(bridge)}</>);

    expect(screen.getByTestId('hello-screen').textContent).toContain('hello-instance');
  });

  it('renders the theme lifecycle content', async () => {
    const module = await import('./lifecycle-theme');
    const lifecycle = module.default;
    const renderContent = Reflect.get(lifecycle, 'renderContent') as (
      bridge: TestBridge,
    ) => React.ReactNode;
    const { bridge } = createMfeBridgeFixture({
      extDomainId: 'demo-domain',
      extensionId: 'theme-instance',
    });

    expect(Reflect.get(lifecycle, 'app')).toEqual({ id: 'demo-mfe-app' } satisfies TestApp);
    render(<>{renderContent(bridge)}</>);

    expect(screen.getByTestId('theme-screen').textContent).toContain('theme-instance');
  });

  it('renders the uikit lifecycle content', async () => {
    const module = await import('./lifecycle-uikit');
    const lifecycle = module.default;
    const renderContent = Reflect.get(lifecycle, 'renderContent') as (
      bridge: TestBridge,
    ) => React.ReactNode;
    const { bridge } = createMfeBridgeFixture({
      extDomainId: 'demo-domain',
      extensionId: 'uikit-instance',
    });

    expect(Reflect.get(lifecycle, 'app')).toEqual({ id: 'demo-mfe-app' } satisfies TestApp);
    render(<>{renderContent(bridge)}</>);

    expect(screen.getByTestId('uikit-screen').textContent).toContain('uikit-instance');
  });

  /*
   * Which base class an entry extends is the whole of whether its screen gets
   * the kit's tokens, and getting it wrong is invisible from inside the entry:
   * `ThemeAwareReactLifecycle` mounts and themes the screen either way, and the
   * kit components simply paint from unresolved `var()` references.
   *
   * The theme screen is the negative case rather than an omission: it paints
   * from the shell's Tailwind colour utilities alone and renders no kit
   * component, so it needs no kit CSS inside its shadow root.
   */
  it('builds the three kit screens on the lifecycle that carries the kit tokens', async () => {
    const kitEntries = await Promise.all([
      import('./lifecycle-helloworld'),
      import('./lifecycle-profile'),
      import('./lifecycle-uikit'),
    ]);

    for (const { default: lifecycle } of kitEntries) {
      expect(lifecycle).toBeInstanceOf(KitThemedLifecycle);
    }

    const { default: themeLifecycle } = await import('./lifecycle-theme');

    expect(themeLifecycle).not.toBeInstanceOf(KitThemedLifecycle);
  });

  // `:root` matches no node in a shadow tree, so the kit's tokens only reach its
  // components once every selector position naming it names the host instead.
  it('re-anchors the ui-kit design tokens onto the shadow host it renders into', async () => {
    const module = await import('./lifecycle-uikit');
    const initializeStyles = Reflect.get(module.default, 'initializeStyles') as (
      container: ShadowRoot
    ) => void;
    const shadowRoot = document.createElement('div').attachShadow({ mode: 'open' });

    initializeStyles.call(module.default, shadowRoot);

    const injectedCss = shadowRoot.querySelector('style')?.textContent ?? '';

    expect(injectedCss).toContain(':host {');
    // Not "no `:root` starts a line": a survivor mid-line matches nothing in a
    // shadow tree just as silently, so nothing named `:root` may remain at all.
    expect(injectedCss).not.toContain(':root');
    // And the dark block has to keep matching the host, which the functional
    // form is the only way to do: a featureless host matches `:host(...)` and
    // not a `:host:not(...)` compound.
    expect(injectedCss).toContain(":host(:not([data-theme='light']))");
  });

  it('registers the refresh handler after profile mount and delegates to fetchUser', async () => {
    const module = await import('./lifecycle-profile');
    const lifecycle = module.default as {
      mount: (container: Element, bridge: TestBridge) => void;
    };
    const renderContent = Reflect.get(lifecycle, 'renderContent') as (
      bridge: TestBridge,
    ) => React.ReactNode;
    const fixture = createMfeBridgeFixture({
      extDomainId: 'profile-domain',
      extensionId: 'profile-instance',
    });
    const container = document.createElement('div');

    expect(Reflect.get(lifecycle, 'app')).toEqual({ id: 'demo-mfe-app' } satisfies TestApp);
    render(<>{renderContent(fixture.bridge)}</>);

    expect(screen.getByTestId('profile-screen').textContent).toContain('profile-domain');

    lifecycle.mount(container, fixture.bridge);

    expect(superMountSpy).toHaveBeenCalledWith(container, fixture.bridge);
    expect(fixture.registerActionHandler).toHaveBeenCalledTimes(1);

    const [actionId, handler] = fixture.registerActionHandler.mock.calls[0] as [
      string,
      { handleAction: (actionTypeId: string, payload: ActionPayload | undefined) => Promise<void> },
    ];

    expect(actionId).toBe(
      'gts.frontx.mfes.comm.action.v1~frontx.demo.action.refresh_profile.v1~'
    );

    await expect(handler.handleAction(actionId, undefined)).resolves.toBeUndefined();
    expect(fetchUserSpy).toHaveBeenCalledTimes(1);
  });
});
