import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeSelector } from './ThemeSelector';
import { STUDIO_CSS } from '../styles/studioStyles';

const { setTheme, themeState, studioState } = vi.hoisted(() => ({
  setTheme: vi.fn(),
  // Read at render time rather than baked into the factory, so a case can pick
  // which theme is active and which container the dropdown portals into.
  themeState: { currentTheme: 'default' },
  studioState: { portalContainer: null as HTMLElement | null },
}));

const themes = [
  { id: 'default', name: 'Default' },
  // Name and id diverge on purpose: formatting the id would spell this one
  // "Dracula Large", so any case reading the label off the trigger says whether
  // the trigger resolved the registry name or just reformatted the id.
  { id: 'dracula-large', name: 'Dracula (Large)' },
];

vi.mock('@gears-frontx/react', () => ({
  useTheme: () => ({ currentTheme: themeState.currentTheme, themes, setTheme }),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../StudioProvider', () => ({
  useStudioContext: () => ({ portalContainer: studioState.portalContainer }),
}));

describe('ThemeSelector', () => {
  afterEach(() => {
    themeState.currentTheme = 'default';
    studioState.portalContainer = null;
    setTheme.mockClear();
    document.querySelectorAll('.studio-portal-container').forEach((el) => el.remove());
  });

  // The switcher is what an unattended browser run applies a theme with and
  // reads the applied theme back from, so both halves of that contract are
  // held here: the trigger's own text is the active theme, and every
  // registered theme is reachable by an id built from the theme's registry id.
  it('offers every registered theme by id and applies the one selected', async () => {
    render(<ThemeSelector />);

    const trigger = screen.getByTestId('studio-theme-trigger');
    expect(trigger.textContent).toContain('Default');

    await userEvent.click(trigger);

    // Spelled out rather than built with `studioThemeOptionTestId`: a helper
    // used on both sides would let the published derivation drift unnoticed.
    expect(screen.getByTestId('studio-theme-option-default')).toBeTruthy();
    await userEvent.click(screen.getByTestId('studio-theme-option-dracula-large'));

    expect(setTheme).toHaveBeenCalledWith('dracula-large');
  });

  it('reads the active theme back as the registry name, not as its reformatted id', () => {
    // The half of the contract a run depends on to confirm what it applied: the
    // trigger's text has to be the label the option carried, so a theme whose
    // name is not its id spelled out still matches. Reformatting the id gives
    // "Dracula Large" here and leaves the two labels disagreeing.
    themeState.currentTheme = 'dracula-large';

    render(<ThemeSelector />);

    expect(screen.getByTestId('studio-theme-trigger').textContent).toContain('Dracula (Large)');
  });

  it('portals the open menu into the studio container the scoped animation rules select on', async () => {
    // The overlay hands the dropdown a container of its own, and studioStyles.ts
    // re-declares the two animate-in/animate-out rules scoped under
    // `.studio-portal-container` precisely so they outrank an identically named
    // host utility that names keyframes this document may not define. Radix
    // waits for `animationend` before unmounting a closed menu, so a scope that
    // stops matching leaves the closed menu visible and clickable over the app.
    // Nothing selects on it while the container is mocked away, which is what
    // this case supplies.
    const portalContainer = document.createElement('div');
    portalContainer.className = 'studio-portal-container';
    document.body.appendChild(portalContainer);
    studioState.portalContainer = portalContainer;

    render(<ThemeSelector />);
    await userEvent.click(screen.getByTestId('studio-theme-trigger'));

    const menu = screen.getByTestId('studio-theme-option-default').parentElement;
    expect(menu?.closest('.studio-portal-container')).toBe(portalContainer);

    // Read off the stylesheet rather than retyped, so the case fails on either
    // side of the drift: a rule that stops naming the class the menu renders,
    // and a menu that stops rendering the class the rule names.
    const scopedAnimationSelectors = STUDIO_CSS.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('.studio-portal-container') && line.includes(':animate-'))
      .map((line) => line.slice(0, line.indexOf('{')).trim());
    expect(scopedAnimationSelectors).toHaveLength(2);

    for (const selector of scopedAnimationSelectors) {
      // The state qualifier is dropped for the reachability check: only one of
      // the two states holds at a time, and what the scope has to keep matching
      // is the class the menu carries in both.
      expect(document.querySelector(selector.replace(/\[data-state=\w+\]$/, ''))).toBe(menu);
    }
    // And in full for the state the open menu is actually in, so the pair is
    // held as written and not only as trimmed above.
    const openStateSelector = scopedAnimationSelectors.find((selector) =>
      selector.endsWith('[data-state=open]')
    );
    if (!openStateSelector) {
      throw new Error('studioStyles.ts declares no portal-scoped open-state animation rule');
    }
    expect(document.querySelector(openStateSelector)).toBe(menu);
  });
});
