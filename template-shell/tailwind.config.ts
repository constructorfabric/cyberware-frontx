import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: [
    './index.html',
    // Host app chrome (layout, menu, studio, components/ui). MFE builds
    // compile no Tailwind of their own: they mount into shadow roots that
    // adopt the host's compiled sheet (adoptHostStylesIntoShadowRoot), so
    // their sources MUST be scanned here or their utility classes match no
    // rule and silently do nothing (a screen root's p-8 renders flush).
    // Sources only: scanning MFE node_modules/dist OOMs the host.
    './src-app/app/**/*.{js,ts,jsx,tsx}',
    './src-app/mfe_packages/*/src/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
    // Workspace package sources + built output (e.g. @gears-frontx/react UI)
    './packages/*/src/**/*.{js,ts,jsx,tsx}',
    './packages/*/dist/**/*.{js,mjs}',
  ],
  safelist: [
    // RTL utilities used in package components
    'rtl:flex-row-reverse',
    'rtl:rotate-180',
    'rtl:-translate-x-4',
    'ms-auto',  // Direction-aware margin (margin-inline-start: auto)
    // Data attribute + RTL combos for Switch
    'data-[state=checked]:ltr:translate-x-4',
    'data-[state=checked]:rtl:-translate-x-4',
    // ARIA invalid state for form elements
    'aria-[invalid=true]:ring-2',
    'aria-[invalid=true]:ring-[color-mix(in_oklab,var(--destructive)_30%,transparent)]',
    'aria-[invalid=true]:border-destructive',
    // Calendar cell size CSS variable
    '[--cell-size:2.75rem]',
    'md:[--cell-size:3rem]',
  ],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        error: 'var(--error)',
        warning: 'var(--warning)',
        success: 'var(--success)',
        info: 'var(--info)',
        mainMenu: {
          DEFAULT: 'var(--left-menu)',
          foreground: 'var(--left-menu-foreground)',
          hover: 'var(--left-menu-hover)',
          selected: 'var(--left-menu-selected)',
          border: 'var(--left-menu-border)',
        },
      },
      spacing: {
        xs: 'var(--spacing-xs)',
        sm: 'var(--spacing-sm)',
        md: 'var(--spacing-md)',
        lg: 'var(--spacing-lg)',
        xl: 'var(--spacing-xl)',
        '2xl': 'var(--spacing-2xl)',
        '3xl': 'var(--spacing-3xl)',
      },
      borderRadius: {
        none: '0',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: '9999px',
      },
      zIndex: {
        dropdown: '1000',
        sticky: '1020',
        fixed: '1030',
        modal: '1040',
        popover: '1050',
        tooltip: '1060',
      },
      transitionDuration: {
        fast: '150ms',
        base: '200ms',
        slow: '300ms',
        slower: '500ms',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
