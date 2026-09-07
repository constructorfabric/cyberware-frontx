// Support file for cva-sibling.fixture.tsx: a real cva(...) config in a
// module the component file imports, rather than in its own source - the
// exact refactor F16 documents as silently losing every axis under the old
// syntax-only walk (compile.ts read only `${component}.tsx`). Named .fixture.tsx
// like its sibling so it stays outside both tsconfig.tools.json's
// `scripts/**/*.ts` project (a .tsx file, not .ts) and knip's project glob
// for the same reason - it exists to be imported by one fixture, not to be
// its own type-checked/knip-tracked unit.
import { cva } from 'class-variance-authority';

export const chipVariants = cva('chip', {
  variants: {
    tone: {
      neutral: 'chip-neutral',
      accent: 'chip-accent',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
});
