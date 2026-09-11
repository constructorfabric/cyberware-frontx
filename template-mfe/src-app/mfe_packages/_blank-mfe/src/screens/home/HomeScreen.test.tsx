import { act, render, screen, within } from '@testing-library/react';
import {
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  FRONTX_SHARED_PROPERTY_THEME,
} from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServiceMock,
  useApiQueryMock,
  useScreenTranslationsMock,
} = vi.hoisted(() => ({
  getServiceMock: vi.fn(),
  useApiQueryMock: vi.fn(),
  useScreenTranslationsMock: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gears-frontx/react')>();
  return {
    ...actual,
    apiRegistry: {
      getService: getServiceMock,
    },
    useApiQuery: useApiQueryMock,
  };
});

vi.mock('../../api/_BlankApiService', () => ({
  _BlankApiService: class MockBlankApiService {
    static {
      void 0;
    }
  },
}));

vi.mock('../../shared/useScreenTranslations', () => ({
  useScreenTranslations: useScreenTranslationsMock,
}));

import { HomeScreen } from './HomeScreen';

// Neutral fixture values — test-controlled, not tied to any template placeholder.
const TEST_THEME = 'smoke-theme';
const TEST_LANGUAGE = 'en';
const TEST_DOMAIN_ID = 'smoke-domain';
const TEST_INSTANCE_ID = 'smoke-instance';

const testStatusData = {
  message: 'test-status-ok',
  generatedAt: '2024-01-01T00:00:00.000Z',
  capabilities: ['cap-a'],
};

describe('HomeScreen', () => {
  beforeEach(() => {
    getServiceMock.mockReturnValue({ getStatus: { type: 'status' } });
    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: false });
    useApiQueryMock.mockReturnValue({ data: testStatusData, isLoading: false, isError: false, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders bridge-provided values and API status data', async () => {
    const { bridge } = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });

    render(<HomeScreen bridge={bridge} />);

    // Addressed through the testids the scaffold publishes as its verification
    // API rather than by text, which also pins which value reaches which slot:
    // a plain text query cannot tell the theme cell from the language one, and
    // both carry values a browser run reads back after switching them.
    expect((await screen.findByTestId('screen-domain-id')).textContent).toBe(TEST_DOMAIN_ID);
    expect(screen.getByTestId('screen-instance-id').textContent).toBe(TEST_INSTANCE_ID);
    expect(screen.getByTestId('screen-theme').textContent).toBe(TEST_THEME);
    expect(screen.getByTestId('screen-language').textContent).toBe(TEST_LANGUAGE);

    expect(screen.getByTestId('screen-root')).toBeTruthy();
    expect(screen.getByTestId('screen-title')).toBeTruthy();

    // API response content is rendered (JSON-serialized blob contains the message field).
    expect(screen.getByTestId('screen-status-payload').textContent).toContain(
      testStatusData.message
    );
    // The card around it is published too, and it is what a browser run waits on
    // to know the status section arrived at all: it is the one testid present on
    // every branch of that section, whether the payload, the error or the
    // skeleton is inside.
    expect(screen.getByTestId('screen-status')).toBeTruthy();
  });

  it('renders the API error message when the status call fails', async () => {
    useApiQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: new Error('status fetch failed'),
    });

    const { bridge } = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });

    render(<HomeScreen bridge={bridge} />);

    expect((await screen.findByTestId('screen-status-error')).textContent).toBe(
      'status fetch failed'
    );
  });

  it('announces a busy region instead of bridge values before translations are ready', () => {
    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: true });

    const { bridge } = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });

    render(<HomeScreen bridge={bridge} />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(TEST_DOMAIN_ID)).toBeNull();

    // `screen-root` is on both branches on purpose, so a run has one node to
    // wait for; `screen-loading` beside it is what says which branch rendered.
    expect(screen.getByTestId('screen-root')).toBeTruthy();
    expect(screen.getByTestId('screen-loading')).toBeTruthy();
  });

  it('announces a busy region beside the bridge values while the API request is pending', async () => {
    useApiQueryMock.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      error: null,
    });

    const { bridge } = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });

    render(<HomeScreen bridge={bridge} />);

    expect(await screen.findByText(TEST_DOMAIN_ID)).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('screen-status-loading')).toBeTruthy();
  });

  // Every dark palette the host registers has to reach the kit's dark scope:
  // the screen paints its own surface from those tokens, so a miss puts a light
  // card on dark host chrome. An unrecognised identifier falls back to the light
  // scope rather than to no scope, which would inherit whatever
  // prefers-color-scheme resolved on the shadow host.
  it('scopes the screen to the kit dark tokens for every dark host theme and to light otherwise', async () => {
    const bridgeFixture = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });

    const { container } = render(<HomeScreen bridge={bridgeFixture.bridge} />);

    // TEST_THEME is an identifier the host never registers.
    expect(await screen.findByText(TEST_DOMAIN_ID)).toBeTruthy();
    expect(container.firstElementChild?.getAttribute('data-theme')).toBe('light');

    for (const darkTheme of ['dark', 'dracula', 'dracula-large']) {
      act(() => {
        bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_THEME, darkTheme);
      });

      expect(container.firstElementChild?.getAttribute('data-theme')).toBe('dark');
    }

    for (const lightTheme of ['default', 'light']) {
      act(() => {
        bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_THEME, lightTheme);
      });

      expect(container.firstElementChild?.getAttribute('data-theme')).toBe('light');
    }
  });

  it('re-reads current properties when the host swaps the bridge instance', async () => {
    const first = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'en',
      },
    });
    const second = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: 'swapped-theme',
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'ar',
      },
    });
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const mountNode = document.createElement('div');
    shadowRoot.appendChild(mountNode);
    document.body.appendChild(host);
    const shadowQueries = within(mountNode);

    const { rerender } = render(<HomeScreen bridge={first.bridge} />, {
      container: mountNode,
    });

    expect((await shadowQueries.findByTestId('screen-theme')).textContent).toBe(TEST_THEME);
    expect(host.dir).toBe('ltr');

    rerender(<HomeScreen bridge={second.bridge} />);

    // The new bridge's current values are re-read during render — its
    // subscriptions only deliver future changes and never fire here.
    expect(shadowQueries.getByTestId('screen-theme').textContent).toBe('swapped-theme');
    expect(shadowQueries.getByTestId('screen-language').textContent).toBe('ar');
    expect(host.dir).toBe('rtl');

    // The old bridge's subscriptions were torn down and re-registered on the
    // new instance.
    expect(first.unsubscriptions).toHaveLength(2);
    for (const { unsubscribe } of first.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
    expect(second.subscribeToProperty).toHaveBeenCalledTimes(2);

    host.remove();
  });

  it('reacts to bridge property updates and unsubscribes on unmount', async () => {
    const bridgeFixture = createMfeBridgeFixture({
      extDomainId: TEST_DOMAIN_ID,
      extensionId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const mountNode = document.createElement('div');
    shadowRoot.appendChild(mountNode);
    document.body.appendChild(host);
    const shadowQueries = within(mountNode);

    const { unmount } = render(<HomeScreen bridge={bridgeFixture.bridge} />, {
      container: mountNode,
    });

    expect(await shadowQueries.findByText(TEST_THEME)).toBeTruthy();
    expect(shadowQueries.getByText(TEST_LANGUAGE)).toBeTruthy();

    act(() => {
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_THEME, 'updated-theme');
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, 'ar');
    });

    expect(shadowQueries.getByText('updated-theme')).toBeTruthy();
    expect(shadowQueries.getByText('ar')).toBeTruthy();
    expect(host.dir).toBe('rtl');

    act(() => {
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, 'en');
    });

    expect(shadowQueries.getByText('en')).toBeTruthy();
    expect(host.dir).toBe('ltr');

    unmount();

    expect(bridgeFixture.unsubscriptions).toHaveLength(2);
    for (const { unsubscribe } of bridgeFixture.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }

    host.remove();
  });
});
