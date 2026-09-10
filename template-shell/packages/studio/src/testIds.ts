/**
 * Test ids the Studio overlay exposes to automated verification.
 *
 * These are a verification API, not styling hooks: an unattended browser run
 * drives the overlay through them, so their values are part of what this
 * package promises and may not be renamed to suit a stylesheet. Nothing in
 * this package selects on them.
 *
 * They exist because the alternative is worse. Without a stable handle a run
 * has to address the overlay through accessibility references, which are
 * re-issued on every navigation and every theme switch, so each interaction
 * costs a fresh snapshot spent only on relearning the reference.
 *
 * Expand and collapse deliberately carry different ids rather than one id on
 * whichever control is mounted: the overlay renders the collapsed button and
 * the expanded panel as alternatives, so which id is present in the document
 * is also the answer to which state the overlay is in. A run can therefore
 * read the state and act on it in one selector instead of a snapshot plus a
 * decision.
 */

/** The collapsed floating button - clicking it expands the panel. */
export const STUDIO_EXPAND_TESTID = 'studio-expand';

/** The expanded panel's header control - clicking it collapses the panel. */
export const STUDIO_COLLAPSE_TESTID = 'studio-collapse';

/**
 * The theme switcher's trigger. Its text is the active theme's label - the
 * registry `name` when the theme carries one, its id otherwise - which is the
 * same text the matching option below carries, so a run reads back from the
 * trigger exactly what it clicked.
 */
export const STUDIO_THEME_TRIGGER_TESTID = 'studio-theme-trigger';

/**
 * Test id of one theme option in the switcher's dropdown.
 *
 * Keyed on the theme's registry id rather than its display name because the
 * id is what the registry keys on and what `setTheme` takes, while the name is
 * presentation: it is optional, translatable, and free to repeat.
 */
export const studioThemeOptionTestId = (themeId: string): string =>
  `studio-theme-option-${themeId}`;
