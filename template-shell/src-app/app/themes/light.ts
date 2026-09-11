/**
 * Light theme for FrontX
 * CSS custom properties map following shadcn/ui variable naming convention.
 */
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1

import type { ThemeConfig } from '@gears-frontx/react';
import colors from './tailwindColors';
import { cssColor } from './utils';

/**
 * Light theme ID
 */
export const LIGHT_THEME_ID = 'light' as const;

export const lightTheme: ThemeConfig = {
  id: LIGHT_THEME_ID,
  name: 'Light',
  appearance: 'light',
  variables: {
    // Shadcn color variables
    '--background': cssColor(colors.white),
    '--foreground': cssColor(colors.zinc[950]),
    '--card': cssColor(colors.white),
    '--card-foreground': cssColor(colors.zinc[950]),
    '--card-hover': 'color-mix(in oklab, var(--card) 96%, var(--foreground))',
    '--popover': cssColor(colors.white),
    '--popover-foreground': cssColor(colors.zinc[950]),
    '--primary': cssColor(colors.zinc[900]),
    '--primary-foreground': cssColor(colors.white),
    '--primary-hover': 'color-mix(in oklab, var(--primary) 90%, var(--background))',
    '--secondary': cssColor(colors.zinc[100]),
    '--secondary-foreground': cssColor(colors.zinc[950]),
    '--muted': cssColor(colors.zinc[100]),
    '--muted-foreground': cssColor(colors.zinc[950]),
    '--accent': cssColor(colors.zinc[400]),
    '--accent-foreground': cssColor(colors.zinc[950]),
    '--destructive': cssColor(colors.red[500]),
    '--destructive-foreground': cssColor(colors.zinc[950]),
    '--border': cssColor(colors.zinc[200]),
    '--input': cssColor(colors.zinc[200]),
    '--ring': cssColor(colors.zinc[900]),

    // State colors
    '--error': cssColor(colors.red[500]),
    '--warning': cssColor(colors.orange[500]),
    '--success': cssColor(colors.green[600]),
    '--info': cssColor(colors.sky[500]),

    // Chart colors (OKLCH format, shadcn/ui light theme)
    '--chart-1': 'oklch(0.646 0.222 41.116)',
    '--chart-2': 'oklch(0.6 0.118 184.704)',
    '--chart-3': 'oklch(0.398 0.07 227.392)',
    '--chart-4': 'oklch(0.828 0.189 84.429)',
    '--chart-5': 'oklch(0.769 0.188 70.08)',

    // Left menu colors
    '--left-menu': cssColor(colors.zinc[100]),
    '--left-menu-foreground': cssColor(colors.zinc[500]),
    '--left-menu-hover': cssColor(colors.zinc[200]),
    '--left-menu-selected': cssColor(colors.blue[600]),
    '--left-menu-border': cssColor(colors.zinc[200]),

    // Spacing
    '--spacing-xs': '0.25rem',
    '--spacing-sm': '0.5rem',
    '--spacing-md': '1rem',
    '--spacing-lg': '1.5rem',
    '--spacing-xl': '2rem',
    '--spacing-2xl': '3rem',
    '--spacing-3xl': '4rem',

    // Border radius
    '--radius-none': '0',
    '--radius-sm': '0.125rem',
    '--radius-md': '0.25rem',
    '--radius-lg': '0.5rem',
    '--radius-xl': '1rem',
    '--radius-full': '9999px',

    // Shadows
    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    '--shadow-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1)',

    // Transitions
    '--transition-fast': '150ms',
    '--transition-base': '200ms',
    '--transition-slow': '300ms',
    '--transition-slower': '500ms',
  },
};
