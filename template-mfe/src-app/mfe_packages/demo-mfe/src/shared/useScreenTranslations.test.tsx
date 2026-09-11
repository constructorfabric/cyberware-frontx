import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { FRONTX_SHARED_PROPERTY_LANGUAGE } from '@gears-frontx/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScreenTranslations } from './useScreenTranslations';

function screenTranslationsTestBridge(
  overrides: Partial<Pick<ChildMfeBridge, 'getProperty' | 'subscribeToProperty'>>
): ChildMfeBridge {
  return {
    extDomainId: 'test-domain',
    extensionId: 'test-instance',
    executeActionsChain: vi.fn().mockResolvedValue(undefined),
    registerActionHandler: vi.fn(),
    getProperty: overrides.getProperty ?? vi.fn(),
    subscribeToProperty: overrides.subscribeToProperty ?? vi.fn().mockReturnValue(() => undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

type LanguageProperty = {
  id: string;
  value: string | undefined;
};

function languageProperty(value: string | undefined): LanguageProperty {
  return { id: FRONTX_SHARED_PROPERTY_LANGUAGE, value };
}

describe('useScreenTranslations', () => {
  it('falls back to English when the requested language file is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const englishImporter = vi.fn(async () => ({
      default: {
        title: 'Home',
      },
    }));
    const languageModules = {
      './i18n/en.json': englishImporter,
    };
    const bridge = screenTranslationsTestBridge({
      getProperty: vi.fn(() => languageProperty('fr')),
      subscribeToProperty: vi.fn(() => vi.fn()),
    });

    const { result } = renderHook(() => useScreenTranslations(languageModules, bridge));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(englishImporter).toHaveBeenCalledTimes(1);
    expect(result.current.t('title')).toBe('Home');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('No translation module found');
    expect(warnSpy.mock.calls[0]?.[0]).toContain('fr');
  });

  it('returns the translation key when a key is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const languageModules = {
      './i18n/en.json': async () => ({
        default: {
          title: 'Home',
        },
      }),
    };
    const bridge = screenTranslationsTestBridge({
      getProperty: vi.fn(() => languageProperty('en')),
      subscribeToProperty: vi.fn(() => vi.fn()),
    });

    const { result } = renderHook(() => useScreenTranslations(languageModules, bridge));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.t('missing_key')).toBe('missing_key');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Missing translation key');
    expect(warnSpy.mock.calls[0]?.[0]).toContain('missing_key');
  });

  it('reloads translations when the bridge language changes', async () => {
    const englishImporter = vi.fn(async () => ({
      default: {
        title: 'Home',
      },
    }));
    const frenchImporter = vi.fn(async () => ({
      default: {
        title: 'Accueil',
      },
    }));
    let subscriptionCallback: ((property: LanguageProperty) => void) | undefined;
    const bridge = screenTranslationsTestBridge({
      getProperty: vi.fn(() => languageProperty('en')),
      subscribeToProperty: vi.fn((_propertyName: string, callback: (property: LanguageProperty) => void) => {
        subscriptionCallback = callback;
        return vi.fn();
      }),
    });
    const languageModules = {
      './i18n/en.json': englishImporter,
      './i18n/fr.json': frenchImporter,
    };

    const { result } = renderHook(() => useScreenTranslations(languageModules, bridge));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.t('title')).toBe('Home');
    });

    await act(async () => {
      subscriptionCallback?.(languageProperty('fr'));
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.t('title')).toBe('Accueil');
    });

    expect(englishImporter).toHaveBeenCalledTimes(1);
    expect(frenchImporter).toHaveBeenCalledTimes(1);

    await act(async () => {
      subscriptionCallback?.(languageProperty('fr'));
    });

    await waitFor(() => {
      expect(frenchImporter).toHaveBeenCalledTimes(1);
    });
  });

  it('unsubscribes from bridge language updates on unmount', async () => {
    const unsubscribe = vi.fn();
    const bridge = screenTranslationsTestBridge({
      getProperty: vi.fn(() => languageProperty('en')),
      subscribeToProperty: vi.fn(() => unsubscribe),
    });
    const languageModules = {
      './i18n/en.json': async () => ({
        default: {
          title: 'Home',
        },
      }),
    };

    const { unmount } = renderHook(() => useScreenTranslations(languageModules, bridge));

    await waitFor(() => {
      expect(bridge.subscribeToProperty).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
