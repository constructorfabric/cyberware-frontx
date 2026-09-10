import React from 'react';
import { upperFirst } from 'lodash';
import { useTheme, useTranslation } from '@gears-frontx/react';
import { ButtonVariant } from '../uikit/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../uikit/base/dropdown-menu';
import { DropdownButton } from '../uikit/composite/DropdownButton';
import { useStudioContext } from '../StudioProvider';
import { STUDIO_THEME_TRIGGER_TESTID, studioThemeOptionTestId } from '../testIds';

/**
 * ThemeSelector Component
 * Uses useTheme hook for theme selection using DropdownMenu
 */

export interface ThemeSelectorProps {
  className?: string;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  className = '',
}) => {
  const { currentTheme, themes, setTheme } = useTheme();
  const { portalContainer } = useStudioContext();
  const { t } = useTranslation();

  const formatThemeName = (themeName: string): string => {
    return themeName
      .split('-')
      .map(word => upperFirst(word))
      .join(' ');
  };

  // Resolved through the registry list so the trigger reads back the same text
  // the option carries: `currentTheme` is the registry id, and a theme whose
  // `name` is not simply its id spelled out - `dracula-large` named
  // `Dracula (Large)` - would otherwise have one label in the menu and another
  // on the trigger, leaving a verification run unable to confirm from the
  // trigger that the theme it clicked is the one applied. Falls back to the id
  // for a `currentTheme` the list does not carry, which is what a theme applied
  // before its registration lands looks like.
  const activeThemeLabel = themes.find((theme) => theme.id === currentTheme)?.name || currentTheme;

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <label className="text-sm text-muted-foreground whitespace-nowrap">
        {t('studio:controls.theme')}
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/*
            The trigger's own text is the active theme, so a verification run
            reads which theme is applied off this one element rather than
            probing classes or computed styles for it.
          */}
          <DropdownButton
            variant={ButtonVariant.Outline}
            data-testid={STUDIO_THEME_TRIGGER_TESTID}
          >
            {formatThemeName(activeThemeLabel || '')}
          </DropdownButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" container={portalContainer} className="z-[99999] pointer-events-auto">
          {themes.map((theme) => (
            <DropdownMenuItem
              key={theme.id}
              data-testid={studioThemeOptionTestId(theme.id)}
              onClick={() => setTheme(theme.id)}
            >
              {formatThemeName(theme.name || theme.id)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

ThemeSelector.displayName = 'ThemeSelector';
