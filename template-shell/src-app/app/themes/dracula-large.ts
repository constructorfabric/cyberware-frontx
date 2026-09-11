/**
 * Dracula Large theme for FrontX
 * Based on Dracula theme with larger spacing and typography
 * CSS custom properties map following shadcn/ui variable naming convention.
 */
// @cpt-algo:cpt-frontx-algo-ui-libraries-choice-theme-propagation:p1

import type { ThemeConfig } from '@gears-frontx/react';
import { cssColor } from './utils';

/**
 * Dracula Large theme ID
 */
export const DRACULA_LARGE_THEME_ID = 'dracula-large' as const;

/**
 * Dracula color palette
 * Official Dracula colors: https://draculatheme.com/contribute
 */
const dracula = {
  purple: 'hsl(265 89% 78%)',       // #bd93f9
  comment: 'hsl(225 27% 51%)',      // #6272a4
  pink: 'hsl(326 100% 74%)',        // #ff79c6
  background: 'hsl(231 15% 18%)',   // #282a36
  foreground: 'hsl(60 30% 96%)',    // #f8f8f2
  currentLine: 'hsl(232 14% 31%)',  // #44475a
  red: 'hsl(0 100% 67%)',           // #ff5555
  yellow: 'hsl(65 92% 76%)',        // #f1fa8c
  green: 'hsl(135 94% 65%)',        // #50fa7b
  cyan: 'hsl(191 97% 77%)',         // #8be9fd
  backgroundDark: 'hsl(231 15% 14%)', // darker variant
};

export const draculaLargeTheme: ThemeConfig = {
  id: DRACULA_LARGE_THEME_ID,
  name: 'Dracula Large',
  appearance: 'dark',
  variables: {
    // Shadcn color variables (same colors as dracula)
    '--background': cssColor(dracula.background),
    '--foreground': cssColor(dracula.foreground),
    '--card': cssColor(dracula.background),
    '--card-foreground': cssColor(dracula.foreground),
    '--card-hover': 'color-mix(in oklab, var(--card) 96%, var(--foreground))',
    '--popover': cssColor(dracula.background),
    '--popover-foreground': cssColor(dracula.foreground),
    '--primary': cssColor(dracula.purple),
    '--primary-foreground': cssColor(dracula.background),
    '--primary-hover': 'color-mix(in oklab, var(--primary) 90%, var(--background))',
    '--secondary': cssColor(dracula.comment),
    '--secondary-foreground': cssColor(dracula.foreground),
    '--muted': cssColor(dracula.currentLine),
    '--muted-foreground': cssColor(dracula.foreground),
    '--accent': cssColor(dracula.pink),
    '--accent-foreground': cssColor(dracula.background),
    '--destructive': cssColor(dracula.red),
    '--destructive-foreground': cssColor(dracula.foreground),
    '--border': cssColor(dracula.currentLine),
    '--input': cssColor(dracula.currentLine),
    '--ring': cssColor(dracula.purple),

    // State colors
    '--error': cssColor(dracula.red),
    '--warning': cssColor(dracula.yellow),
    '--success': cssColor(dracula.green),
    '--info': cssColor(dracula.cyan),

    // Chart colors (OKLCH format, Dracula-inspired palette)
    '--chart-1': 'oklch(0.714 0.203 313.26)',
    '--chart-2': 'oklch(0.799 0.194 145.19)',
    '--chart-3': 'oklch(0.821 0.173 85.29)',
    '--chart-4': 'oklch(0.71 0.191 349.76)',
    '--chart-5': 'oklch(0.822 0.131 194.77)',

    // Left menu colors
    '--left-menu': cssColor(dracula.backgroundDark),
    '--left-menu-foreground': cssColor(dracula.comment),
    '--left-menu-hover': cssColor(dracula.currentLine),
    '--left-menu-selected': cssColor(dracula.purple),
    '--left-menu-border': cssColor(dracula.currentLine),

    // Spacing (1.5x scaled)
    '--spacing-xs': '0.375rem',
    '--spacing-sm': '0.75rem',
    '--spacing-md': '1.5rem',
    '--spacing-lg': '2.25rem',
    '--spacing-xl': '3rem',
    '--spacing-2xl': '4.5rem',
    '--spacing-3xl': '6rem',

    // Border radius (slightly larger)
    '--radius-none': '0',
    '--radius-sm': '0.1875rem',
    '--radius-md': '0.375rem',
    '--radius-lg': '0.75rem',
    '--radius-xl': '1.5rem',
    '--radius-full': '9999px',

    // Shadows
    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.4)',
    '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
    '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.6)',
    '--shadow-xl': '0 20px 25px -5px rgba(0, 0, 0, 0.7)',

    // Transitions
    '--transition-fast': '150ms',
    '--transition-base': '200ms',
    '--transition-slow': '300ms',
    '--transition-slower': '500ms',
  },
};
