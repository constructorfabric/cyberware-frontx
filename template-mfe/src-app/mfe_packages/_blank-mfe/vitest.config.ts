/// <reference types="node" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import { defineMfeProject } from '../../vitest.mfe.base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  defineMfeProject(__dirname),
  defineConfig({
    test: {
      /*
       * Vitest resolves a stylesheet import to an empty string unless CSS is
       * processed, so this flag is what puts the kit's real theme.css in front
       * of the tests that rewrite it. Two of them depend on that content and
       * not on a fixture: the one asserting no `:root` survives the rewrite,
       * and the one pinning how many `:root` occurrences the pinned kit has and
       * where they sit. Turn CSS off and both assert against an empty string
       * and pass having checked nothing at all.
       */
      css: true,
      server: {
        deps: {
          /*
           * @gears-frontx/ui-kit ships one CSS Module per component and each
           * emitted chunk imports its own stylesheet. Left external, those
           * imports reach Node's ESM loader, which has no `.css` extension
           * handler and fails the whole suite before a single test runs.
           * Inlining hands them back to Vite, and from there through the same
           * CSS pipeline `css: true` above turns on.
           */
          inline: ['@gears-frontx/ui-kit'],
        },
      },
    },
  })
);
