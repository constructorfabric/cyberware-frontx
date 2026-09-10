/**
 * FrontX Studio Package
 * Development tools overlay for FrontX applications
 *
 * This package should ONLY be imported in development mode
 * Use conditional imports to ensure it's tree-shaken in production
 *
 * Translations are registered automatically when StudioProvider is imported
 */
// @cpt-dod:cpt-frontx-dod-studio-devtools-conditional-loading:p1

export { StudioOverlay } from './StudioOverlay';
export { StudioProvider, useStudioContext } from './StudioProvider';
export type { Position, Size, StudioState } from './types';
// The test ids the overlay publishes to automated verification. Re-exported
// because a verification API a consumer cannot import is not published: a
// browser run driving the overlay would otherwise have to retype the literals
// and lose the compile-time link to the values the components actually render.
export * from './testIds';
