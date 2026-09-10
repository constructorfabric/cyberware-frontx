/// <reference types="node" />
// Reuses the shell's shared jsdom project base (the same one MFE packages
// build on, two directories up in the composed app). On top of it:
// `@gears-frontx/ui-kit` is inlined because its dist chunks import their
// component CSS as sibling files, which Node's ESM loader rejects unless
// Vite processes the package — the a11y suite renders composed kit markup.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import { defineMfeProject } from '../../vitest.mfe.base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  defineMfeProject(__dirname),
  defineConfig({
    test: {
      server: {
        deps: {
          inline: ['@gears-frontx/ui-kit'],
        },
      },
    },
  }),
);
