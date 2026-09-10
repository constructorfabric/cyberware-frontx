import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {
  COLD_START_TIMEOUT_MS,
  COVERAGE_EXCLUDE,
  COVERAGE_THRESHOLDS,
  DEFAULT_TEST_EXCLUDE,
  SHARED_VITEST_SETUP_FILES,
  TEST_INCLUDE_TSX,
  vitestNodeWorkerExecArgv,
  // This module is imported by consumers under its package name
  // (`@gears-frontx/mfe-test-support/vitest.mfe.base`), which resolves
  // through node_modules. Vite's config-file bundler treats a node_modules
  // resolution as external and stops bundling at that boundary, handing
  // this module's own relative imports to Node's native ESM resolver —
  // which, unlike a bundler, requires an exact extension on a relative
  // specifier. The explicit `.ts` here (rather than a bare `vitest.shared`)
  // is what keeps this import resolvable once loaded from outside the
  // shell's own bundled config graph.
} from '../../vitest.shared.ts';

/**
 * Shared Vitest project base for every MFE package (whichever template
 * contributes it — this shell's own examples, or an overlay like
 * `template-mfe` composed onto it). Imported by package name
 * (`@gears-frontx/mfe-test-support/vitest.mfe.base`) rather than a relative
 * reach across the template that hosts it, so an MFE package stays
 * self-contained regardless of where it is applied.
 */
export const mfeVitestBaseConfig = defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: false,
    execArgv: vitestNodeWorkerExecArgv(),
    setupFiles: [...SHARED_VITEST_SETUP_FILES],
    // A newly scaffolded MFE package pays its whole Vite transform inside the
    // first test's own budget; see COLD_START_TIMEOUT_MS.
    testTimeout: COLD_START_TIMEOUT_MS,
    hookTimeout: COLD_START_TIMEOUT_MS,
    include: [...TEST_INCLUDE_TSX],
    exclude: [...DEFAULT_TEST_EXCLUDE],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [...COVERAGE_EXCLUDE],
      thresholds: { ...COVERAGE_THRESHOLDS },
    },
  },
});

export function defineMfeProject(rootDir: string) {
  return mergeConfig(
    mfeVitestBaseConfig,
    defineConfig({
      root: rootDir,
    }),
  );
}
