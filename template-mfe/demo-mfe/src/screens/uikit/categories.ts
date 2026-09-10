/**
 * UIKit Elements Categories
 *
 * The showcase covers `@gears-frontx/ui-kit`'s published surface and nothing
 * else: every element below maps to exactly one exported component, and the kit
 * exports no component that is missing here. An entry with no component behind
 * it would be a promise the template cannot keep — a reader copying this
 * scaffold takes the list as the inventory it is allowed to build from.
 */

export const CATEGORIES = {
  layout: 'layout',
  navigation: 'navigation',
  forms: 'forms',
  actions: 'actions',
  feedback: 'feedback',
  dataDisplay: 'data_display',
  overlays: 'overlays',
} as const;

export type Category = typeof CATEGORIES[keyof typeof CATEGORIES];

/**
 * Mapping of categories to their elements.
 * Each element maps to an ID used in translation keys and DOM element IDs.
 */
export const CATEGORY_ELEMENTS: Record<Category, string[]> = {
  [CATEGORIES.layout]: ['card', 'separator'],
  [CATEGORIES.navigation]: ['tab'],
  [CATEGORIES.forms]: [
    'field',
    'label',
    'input',
    'textarea',
    'select',
    'checkbox',
    'radio',
    'switch',
  ],
  [CATEGORIES.actions]: ['button', 'dropdown'],
  [CATEGORIES.feedback]: ['toast', 'skeleton'],
  [CATEGORIES.dataDisplay]: ['table', 'badge', 'tooltip'],
  [CATEGORIES.overlays]: ['dialog'],
};
