/**
 * useScreenTranslations Hook
 *
 * MFE-local i18n loading hook. Accepts a language map produced by
 * `import.meta.glob('./i18n/*.json')` (Vite-compatible glob).
 *
 * The hook:
 * 1. Gets current language from bridge.getProperty(FRONTX_SHARED_PROPERTY_LANGUAGE)
 * 2. Builds module key from language (e.g., './i18n/en.json')
 * 3. Dynamically imports the module
 * 4. Returns t(key) function that looks up key in loaded translations
 * 5. Subscribes to language property changes to reload translations
 *
 * Usage in screen component:
 * ```tsx
 * const languageModules = import.meta.glob('./i18n/*.json');
 * const { t, loading } = useScreenTranslations(languageModules, bridge);
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { FRONTX_SHARED_PROPERTY_LANGUAGE } from '@gears-frontx/react';

interface TranslationJsonModule {
  default: Record<string, string>;
}
type LanguageModuleImporter = () => Promise<TranslationJsonModule>;
type LanguageModuleMap = Record<string, LanguageModuleImporter>;

interface UseScreenTranslationsReturn {
  t: (key: string) => string;
  loading: boolean;
}

/**
 * Hook for loading MFE-local translations based on the current language from the bridge.
 *
 * @param languageModules - Language module map from `import.meta.glob('./i18n/*.json')`
 * @param bridge - ChildMfeBridge instance
 * @returns Object with `t(key)` function and `loading` state
 */
export function useScreenTranslations(
  languageModules: LanguageModuleMap,
  bridge: ChildMfeBridge
): UseScreenTranslationsReturn {
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Use ref to track current language for comparison without triggering effect re-runs
  const currentLanguageRef = useRef<string>('en');
  const lastLoadedLanguageRef = useRef<string | null>(null);
  const lastLoadedModulesRef = useRef<LanguageModuleMap | null>(null);

  // Load translations for the given language
  const loadTranslations = useCallback(
    async (language: string) => {
      // Keep ref in sync
      currentLanguageRef.current = language;
      lastLoadedLanguageRef.current = language;
      lastLoadedModulesRef.current = languageModules;
      setLoading(true);
      try {
        // Build module key from language (e.g., './i18n/en.json')
        const moduleKey = `./i18n/${language}.json`;
        const importer = languageModules[moduleKey];

        if (!importer) {
          console.warn(`[useScreenTranslations] No translation module found for language: ${language}, falling back to en`);
          // Fall back to English
          const fallbackKey = './i18n/en.json';
          const fallbackImporter = languageModules[fallbackKey];
          if (fallbackImporter) {
            const module = await fallbackImporter();
            setTranslations(module.default);
          } else {
            console.error('[useScreenTranslations] English fallback not found');
            setTranslations({});
          }
        } else {
          // Dynamically import the module
          const module = await importer();
          setTranslations(module.default);
        }
      } catch (error) {
        console.error(`[useScreenTranslations] Failed to load translations for ${language}:`, error);
        setTranslations({});
      } finally {
        setLoading(false);
      }
    },
    [languageModules]
  );

  // Subscribe to language property changes
  useEffect(() => {
    // Get initial language
    const initialProperty = bridge.getProperty(FRONTX_SHARED_PROPERTY_LANGUAGE);
    const lang = initialProperty && typeof initialProperty.value === 'string' ? initialProperty.value : 'en';
    const shouldLoadInitialTranslations =
      lastLoadedLanguageRef.current !== lang || lastLoadedModulesRef.current !== languageModules;

    if (shouldLoadInitialTranslations) {
      loadTranslations(lang);
    }

    // Subscribe to language changes
    const unsubscribe = bridge.subscribeToProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, (property) => {
      if (
        typeof property.value === 'string' &&
        (property.value !== currentLanguageRef.current ||
          lastLoadedModulesRef.current !== languageModules)
      ) {
        loadTranslations(property.value);
      }
    });

    return unsubscribe;
  }, [bridge, languageModules, loadTranslations]);

  // Translation function
  const t = useCallback(
    (key: string): string => {
      const translation = translations[key];
      if (translation === undefined) {
        console.warn(`[useScreenTranslations] Missing translation key: ${key}`);
        return key; // Return key as fallback
      }
      return translation;
    },
    [translations]
  );

  return { t, loading };
}
