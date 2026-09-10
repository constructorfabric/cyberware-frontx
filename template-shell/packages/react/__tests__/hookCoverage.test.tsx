import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider as ReduxProvider } from 'react-redux';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatCurrency, Language, type TranslationMap } from '@gears-frontx/framework';
import {
  FrontXContext,
  useAppDispatch,
  useFormatters,
  useScreenTranslations,
  useTheme,
  useTranslation,
} from '@gears-frontx/react';

type Subscriber = () => void;

type ThemeRecord = {
  id: string;
  name: string;
};

function createThemeRegistry(initialTheme: string) {
  let currentTheme = initialTheme;
  let version = 0;
  const subscribers = new Set<Subscriber>();
  const themes: ThemeRecord[] = [
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
  ];

  return {
    notify(nextTheme: string) {
      currentTheme = nextTheme;
      version += 1;
      subscribers.forEach((callback) => {
        callback();
      });
    },
    subscribe(callback: Subscriber) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    getVersion() {
      return version;
    },
    getCurrent() {
      return themes.find((theme) => theme.id === currentTheme);
    },
    getAll() {
      return themes;
    },
  };
}

function createI18nRegistry(initialLanguage: string) {
  let language: string | null = initialLanguage;
  let version = 0;
  let isRTL = false;
  const subscribers = new Set<Subscriber>();

  return {
    register: vi.fn(),
    registerLoader: vi.fn(),
    notify(nextLanguage: string, nextIsRTL = false) {
      language = nextLanguage;
      isRTL = nextIsRTL;
      version += 1;
      subscribers.forEach((callback) => {
        callback();
      });
    },
    subscribe(callback: Subscriber) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    getVersion() {
      return version;
    },
    getLanguage() {
      return language;
    },
    t(key: string, params?: Record<string, string | number | boolean>) {
      return `${key}:${params?.name ?? ''}`;
    },
    isRTL() {
      return isRTL;
    },
  };
}

function createApp() {
  const themeRegistry = createThemeRegistry('light');
  const i18nRegistry = createI18nRegistry('en');
  const store = configureStore({
    reducer: () => ({ ok: true }),
  });
  const actions = {
    changeTheme: vi.fn(),
    setLanguage: vi.fn(),
  };

  const app = {
    actions,
    i18nRegistry,
    store,
    themeRegistry,
  } as unknown as import('@gears-frontx/framework').FrontXApp;

  return {
    app,
    actions,
    i18nRegistry,
    store,
    themeRegistry,
  };
}

function createWrapper(app: import('@gears-frontx/framework').FrontXApp) {
  return function Wrapper({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
      <FrontXContext.Provider value={app}>
        <ReduxProvider store={app.store}>{children}</ReduxProvider>
      </FrontXContext.Provider>
    );
  };
}

describe('react hook coverage', () => {
  it('useTheme exposes current theme data and changeTheme action', () => {
    const { app, actions, themeRegistry } = createApp();
    const { result } = renderHook(() => useTheme(), {
      wrapper: createWrapper(app),
    });

    expect(result.current.currentTheme).toBe('light');
    expect(result.current.themes).toEqual([
      { id: 'light', name: 'Light' },
      { id: 'dark', name: 'Dark' },
    ]);

    result.current.setTheme('dark');
    expect(actions.changeTheme).toHaveBeenCalledWith({ themeId: 'dark' });

    act(() => {
      themeRegistry.notify('dark');
    });

    expect(result.current.currentTheme).toBe('dark');
  });

  it('useTranslation exposes translation helpers and language updates', () => {
    const { app, actions, i18nRegistry } = createApp();
    const { result } = renderHook(() => useTranslation(), {
      wrapper: createWrapper(app),
    });

    expect(result.current.t('screen:title', { name: 'demo' })).toBe('screen:title:demo');
    expect(result.current.language).toBe('en');
    expect(result.current.isRTL).toBe(false);

    result.current.setLanguage(Language.Arabic);
    expect(actions.setLanguage).toHaveBeenCalledWith({ language: 'ar' });

    act(() => {
      i18nRegistry.notify('ar', true);
    });

    expect(result.current.language).toBe('ar');
    expect(result.current.isRTL).toBe(true);
  });

  it('useFormatters re-exposes locale-aware formatter functions', () => {
    const { app, i18nRegistry } = createApp();
    const { result } = renderHook(() => useFormatters(), {
      wrapper: createWrapper(app),
    });
    const firstResult = result.current;

    expect(result.current.formatCurrency).toBe(formatCurrency);

    act(() => {
      i18nRegistry.notify('fr');
    });

    expect(result.current).not.toBe(firstResult);
    expect(result.current.formatCurrency).toBe(formatCurrency);
  });

  it('useScreenTranslations loads and registers translation maps', async () => {
    const { app, i18nRegistry } = createApp();
    const translations = {
      en: vi.fn(async () => ({ default: { title: 'Hello' } })),
      fr: vi.fn(async () => ({ default: { title: 'Bonjour' } })),
    } as unknown as TranslationMap;
    const { result } = renderHook(
      () => useScreenTranslations('demo', 'home', translations),
      { wrapper: createWrapper(app) }
    );

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(i18nRegistry.registerLoader).toHaveBeenCalledWith(
      'screen.demo.home',
      expect.any(Function)
    );
    expect(i18nRegistry.register).toHaveBeenCalledWith(
      'screen.demo.home',
      'en',
      { title: 'Hello' }
    );

    act(() => {
      i18nRegistry.notify('fr');
    });

    await waitFor(() =>
      expect(i18nRegistry.register).toHaveBeenCalledWith(
        'screen.demo.home',
        'fr',
        { title: 'Bonjour' }
      )
    );
  });

  it('useScreenTranslations reports loader failures', async () => {
    const { app } = createApp();
    const translations = {
      en: vi.fn(async () => {
        throw new Error('translation load failed');
      }),
    } as unknown as TranslationMap;
    const { result } = renderHook(
      () => useScreenTranslations('demo', 'profile', translations),
      { wrapper: createWrapper(app) }
    );

    await waitFor(() => expect(result.current.error?.message).toBe('translation load failed'));
    expect(result.current.isLoaded).toBe(false);
  });

  it('useScreenTranslations stays loaded when a language change is superseded before it settles', async () => {
    const { app, i18nRegistry } = createApp();
    let releaseFrench: () => void = () => {};
    const frenchLoaded = new Promise<void>((resolve) => {
      releaseFrench = resolve;
    });
    const translations = {
      en: vi.fn(async () => ({ default: { title: 'Hello' } })),
      fr: vi.fn(async () => {
        await frenchLoaded;
        return { default: { title: 'Bonjour' } };
      }),
    } as unknown as TranslationMap;

    const { result } = renderHook(
      () => useScreenTranslations('demo', 'superseded', translations),
      { wrapper: createWrapper(app) }
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // Switch to a language whose load never settles before the switch back:
    // the French load is cancelled with English already registered, so nothing
    // will ever arrive to report the hook loaded again. This is what a stored
    // in-flight flag could not survive - the cancelled load has no settle path
    // left to lower it - and it is why `isLoaded` is derived from
    // `loadedLanguage` alone.
    act(() => {
      i18nRegistry.notify('fr');
    });
    act(() => {
      i18nRegistry.notify('en');
    });
    await act(async () => {
      releaseFrench();
      await frenchLoaded;
    });

    expect(result.current.isLoaded).toBe(true);
  });

  it('useAppDispatch returns the Redux store dispatch function', () => {
    const { app, store } = createApp();
    const { result } = renderHook(() => useAppDispatch(), {
      wrapper: createWrapper(app),
    });

    expect(result.current).toBe(store.dispatch);
  });

});
