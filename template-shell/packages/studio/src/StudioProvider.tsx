import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { I18nRegistry, Language, i18nRegistry } from '@gears-frontx/react';
import { saveStudioState, loadStudioState } from './utils/persistence';
import { STORAGE_KEYS } from './types';
import { initPersistenceEffects } from './effects/persistenceEffects';
import { useRestoreStudioSettings } from './hooks/useRestoreStudioSettings';

/**
 * Studio Translation Loader
 * Registered on module import to ensure translations are available before components render
 */
const studioTranslations = I18nRegistry.createLoader({
  [Language.English]: () => import('./i18n/en.json'),
  [Language.Arabic]: () => import('./i18n/ar.json'),
  [Language.Bengali]: () => import('./i18n/bn.json'),
  [Language.Czech]: () => import('./i18n/cs.json'),
  [Language.Danish]: () => import('./i18n/da.json'),
  [Language.German]: () => import('./i18n/de.json'),
  [Language.Greek]: () => import('./i18n/el.json'),
  [Language.Spanish]: () => import('./i18n/es.json'),
  [Language.Persian]: () => import('./i18n/fa.json'),
  [Language.Finnish]: () => import('./i18n/fi.json'),
  [Language.French]: () => import('./i18n/fr.json'),
  [Language.Hebrew]: () => import('./i18n/he.json'),
  [Language.Hindi]: () => import('./i18n/hi.json'),
  [Language.Hungarian]: () => import('./i18n/hu.json'),
  [Language.Indonesian]: () => import('./i18n/id.json'),
  [Language.Italian]: () => import('./i18n/it.json'),
  [Language.Japanese]: () => import('./i18n/ja.json'),
  [Language.Korean]: () => import('./i18n/ko.json'),
  [Language.Malay]: () => import('./i18n/ms.json'),
  [Language.Dutch]: () => import('./i18n/nl.json'),
  [Language.Norwegian]: () => import('./i18n/no.json'),
  [Language.Polish]: () => import('./i18n/pl.json'),
  [Language.Portuguese]: () => import('./i18n/pt.json'),
  [Language.Romanian]: () => import('./i18n/ro.json'),
  [Language.Russian]: () => import('./i18n/ru.json'),
  [Language.Swedish]: () => import('./i18n/sv.json'),
  [Language.Swahili]: () => import('./i18n/sw.json'),
  [Language.Tamil]: () => import('./i18n/ta.json'),
  [Language.Thai]: () => import('./i18n/th.json'),
  [Language.Tagalog]: () => import('./i18n/tl.json'),
  [Language.Turkish]: () => import('./i18n/tr.json'),
  [Language.Ukrainian]: () => import('./i18n/uk.json'),
  [Language.Urdu]: () => import('./i18n/ur.json'),
  [Language.Vietnamese]: () => import('./i18n/vi.json'),
  [Language.ChineseTraditional]: () => import('./i18n/zh-TW.json'),
  [Language.ChineseSimplified]: () => import('./i18n/zh.json'),
});

// Register translations immediately on module import
i18nRegistry.registerLoader('studio', studioTranslations);

/**
 * Studio Context Value
 * Includes portal container for high z-index dropdown rendering
 */
interface StudioContextValue {
  collapsed: boolean;
  toggleCollapsed: () => void;
  portalContainer: HTMLElement | null;
  setPortalContainer: (container: HTMLElement | null) => void;
}

const StudioContext = createContext<StudioContextValue | undefined>(undefined);

export const useStudioContext = () => {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error('useStudioContext must be used within StudioProvider');
  }
  return context;
};

interface StudioProviderProps {
  children: React.ReactNode;
}

export const StudioProvider: React.FC<StudioProviderProps> = ({ children }) => {
  // A first visit has nothing stored under STORAGE_KEYS.COLLAPSED, so this
  // default is what every freshly scaffolded project shows. It is `true`
  // because the expanded panel is a fixed overlay above the product's own UI:
  // left open by default it covers the screen's controls and takes their
  // clicks. Collapsed is the only default that cannot obstruct the product,
  // and a developer who wants the panel is one click away from it - so the
  // cost falls on the party who can undo it, not on the one who cannot.
  const [collapsed, setCollapsed] = useState(() =>
    loadStudioState(STORAGE_KEYS.COLLAPSED, true)
  );
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Initialize persistence effects on mount
  useEffect(() => {
    const cleanup = initPersistenceEffects();
    return cleanup;
  }, []);

  // Restore theme, language, mock from localStorage
  useRestoreStudioSettings();

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const newValue = !prev;
      saveStudioState(STORAGE_KEYS.COLLAPSED, newValue);
      return newValue;
    });
  }, []);

  return (
    <StudioContext.Provider
      value={{
        collapsed,
        toggleCollapsed,
        portalContainer,
        setPortalContainer,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
};

StudioProvider.displayName = 'StudioProvider';
