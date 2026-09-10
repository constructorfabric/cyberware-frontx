import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  FRONTX_SHARED_PROPERTY_THEME,
  TextDirection,
} from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@gears-frontx/mfe-test-support/createMfeBridgeFixture';
import { mockShadowHost } from '@gears-frontx/mfe-test-support/mockShadowHost';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../api/types';
import { AccountsApiService } from '../../api/AccountsApiService';

const {
  mockGetService,
  mockUseApiMutation,
  mockUseApiQuery,
  mockUseScreenTranslations,
} = vi.hoisted(() => ({
  mockGetService: vi.fn(),
  mockUseApiMutation: vi.fn(),
  mockUseApiQuery: vi.fn(),
  mockUseScreenTranslations: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gears-frontx/react')>();
  return {
    ...actual,
    apiRegistry: {
      ...actual.apiRegistry,
      getService: (
        ...args: Parameters<typeof actual.apiRegistry.getService>
      ) => mockGetService(...args),
    },
    useApiQuery: (...args: Parameters<typeof actual.useApiQuery>) =>
      mockUseApiQuery(...args),
    useApiMutation: (...args: Parameters<typeof actual.useApiMutation>) =>
      mockUseApiMutation(...args),
  };
});

vi.mock('../../shared/useScreenTranslations', () => ({
  useScreenTranslations: mockUseScreenTranslations,
}));

const defaultUser = {
  id: 'user-42',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  role: UserRole.Admin,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-02-01T00:00:00.000Z',
  extra: {
    department: 'Platform',
  },
};

function createQueryResult(overrides: Partial<{
  data: { user: typeof defaultUser } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    data: { user: defaultUser },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function createMutationResult(overrides: Partial<{
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  error: Error | null;
}> = {}) {
  return {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    ...overrides,
  };
}

async function setupProfileScreen(options?: {
  mutationResult?: ReturnType<typeof createMutationResult>;
  queryResult?: ReturnType<typeof createQueryResult>;
}) {
  const queryResult = options?.queryResult ?? createQueryResult();
  const mutationResult = options?.mutationResult ?? createMutationResult();

  mockGetService.mockReturnValue({
    getCurrentUser: { type: 'getCurrentUser' },
    updateProfile: { type: 'updateProfile' },
  });

  mockUseApiQuery.mockReturnValue(queryResult);
  mockUseApiMutation.mockReturnValue(mutationResult);

  const { ProfileScreen } = await import('./ProfileScreen');
  const bridgeFixture = createMfeBridgeFixture({
    extDomainId: 'profile-domain',
    extensionId: 'profile-screen',
    initialProperties: {
      [FRONTX_SHARED_PROPERTY_THEME]: 'corporate',
      [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'sv',
    },
  });
  // Raised before the render, so the screen's mount effect has a host to write
  // its direction on. Attached afterwards, that first pass reaches no host at
  // all and the initial LTR direction is asserted by nothing.
  const { host } = mockShadowHost(HTMLDivElement);
  const { container, rerender, unmount } = render(
    <ProfileScreen bridge={bridgeFixture.bridge} />
  );
  const rootElement = container.firstChild as HTMLElement | null;

  await screen.findByRole('heading', { level: 1 });

  return {
    ProfileScreen,
    bridgeFixture,
    host,
    mutationResult,
    queryResult,
    rerender,
    rootElement,
    unmount,
  };
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    mockGetService.mockReset();
    mockUseApiMutation.mockReset();
    mockUseApiQuery.mockReset();
    mockUseScreenTranslations.mockReset();
    mockUseScreenTranslations.mockReturnValue({ t: (key: string) => key, loading: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders profile data and bridge values', async () => {
    const { host, rootElement } = await setupProfileScreen();

    expect(mockGetService).toHaveBeenCalledWith(AccountsApiService);
    // The direction lands on the shadow host, not on the screen root, and `sv`
    // resolves to the left-to-right default.
    expect(host.dir).toBe(TextDirection.LeftToRight);
    expect(rootElement?.getAttribute('dir')).toBeNull();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Platform')).toBeTruthy();
    expect(screen.getByText('profile-domain')).toBeTruthy();
    expect(screen.getByText('profile-screen')).toBeTruthy();
    expect(screen.getByText('corporate')).toBeTruthy();
    expect(screen.getByText('sv')).toBeTruthy();
  });

  // `ApiUser` types the three edited fields as `string`, but nothing validates
  // the response body it describes, so a profile can arrive with nulls in them.
  // The card trims all three during render: an unguarded trim there takes the
  // whole screen down rather than showing an empty field.
  it('renders a profile whose editable fields came back null', async () => {
    const nullFieldsUser = {
      ...defaultUser,
      firstName: null,
      lastName: null,
      extra: { department: null },
      // Cast because the type forbids exactly the payload under test.
    } as unknown as typeof defaultUser;

    await setupProfileScreen({
      queryResult: createQueryResult({ data: { user: nullFieldsUser } }),
    });

    expect(screen.getByText('ada@example.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'edit_profile' }));

    for (const label of ['first_name_label', 'last_name_label', 'department_label']) {
      expect(screen.getByLabelText(label)).toHaveProperty('value', '');
    }
  });

  it('refetches the profile when refresh is clicked', async () => {
    const { queryResult, mutationResult } = await setupProfileScreen();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'refresh' }));
    expect(queryResult.refetch).toHaveBeenCalledTimes(1);
    expect(mutationResult.mutateAsync).not.toHaveBeenCalled();
  });

  it('subscribes to theme and language bridge properties', async () => {
    const { bridgeFixture } = await setupProfileScreen();

    await waitFor(() => {
      expect(bridgeFixture.subscribeToProperty).toHaveBeenCalledWith(FRONTX_SHARED_PROPERTY_THEME, expect.any(Function));
      expect(bridgeFixture.subscribeToProperty).toHaveBeenCalledWith(FRONTX_SHARED_PROPERTY_LANGUAGE, expect.any(Function));
    });
  });

  it('submits profile edits through the mutation hook', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    await setupProfileScreen({
      mutationResult: createMutationResult({ mutateAsync }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'edit_profile' }));
    fireEvent.change(screen.getByLabelText('first_name_label'), {
      target: { value: 'Grace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        firstName: 'Grace',
        lastName: 'Lovelace',
        department: 'Platform',
      });
      expect(screen.getByRole('button', { name: 'edit_profile' })).toBeTruthy();
    });
  });

  it('updates the language value and host direction', async () => {
    const { host, bridgeFixture } = await setupProfileScreen();

    expect(host.dir).toBe(TextDirection.LeftToRight);

    await act(async () => {
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, 'ar');
    });

    await waitFor(() => {
      expect(host.getAttribute('dir')).toBe(TextDirection.RightToLeft);
      expect(screen.getByText('ar')).toBeTruthy();
    });
  });

  it('unsubscribes from bridge properties on unmount', async () => {
    const { unmount, bridgeFixture } = await setupProfileScreen();

    unmount();

    for (const { unsubscribe } of bridgeFixture.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });
});
