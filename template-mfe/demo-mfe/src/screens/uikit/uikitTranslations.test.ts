import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_ELEMENTS } from './categories';

/*
 * The screen loads one of these files per language through the same glob its
 * `useScreenTranslations` call uses, so a key the screen asks for and a locale
 * does not carry renders as its own identifier - in that language only, and with
 * nothing failing anywhere. This file is what makes adding a key to the screen
 * a 36-file change rather than an English-only one.
 */
const localeModules = import.meta.glob<{ default: Record<string, string> }>('./i18n/*.json', {
  eager: true,
});

const locales = Object.fromEntries(
  Object.entries(localeModules).map(([file, module]) => [
    file.replace('./i18n/', '').replace('.json', ''),
    module.default,
  ])
);

const english = locales.en;

describe('uikit screen translations', () => {
  it('carries the keys the screen and its menu call, in English', () => {
    for (const key of [
      'title',
      'description',
      'menu_title',
      'toast_region_label',
      'toast_close_label',
      'form_email_required',
      'form_email_invalid',
    ]) {
      expect(english[key]).toBeTruthy();
    }

    for (const category of Object.values(CATEGORIES)) {
      expect(english[`category.${category}`]).toBeTruthy();

      for (const element of CATEGORY_ELEMENTS[category]) {
        expect(english[`element.${element}.title`]).toBeTruthy();
        expect(english[`element.${element}.description`]).toBeTruthy();
      }
    }
  });

  it('exposes the same key set in every locale', () => {
    const englishKeys = Object.keys(english).sort();

    // A count in its own right: an assertion per locale would pass vacuously if
    // the glob resolved nothing.
    expect(Object.keys(locales)).toHaveLength(36);

    for (const [locale, translations] of Object.entries(locales)) {
      expect(Object.keys(translations).sort(), locale).toEqual(englishKeys);
    }
  });
});
