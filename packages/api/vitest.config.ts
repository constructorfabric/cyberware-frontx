// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import { defineConfig } from 'vitest/config';

// Self-contained, like every other packages/* vitest config (mfes,
// gts-plugin, telemetry): this package must not depend on template
// territory (ecosystem packages never import template content - templates
// now live in their own repository).
// This used to borrow `definePackageVitestConfig` from a template's own
// shared vitest config and alias one template's package name to that
// template's source, but nothing under `src/` ever imported that package -
// the alias was dead weight, not a real test dependency.
//
// mfes and gts-plugin's own configs (the convention this file otherwise
// follows) never adopted the shared config's coverage thresholds, coverage
// excludes, or the four-glob test include, so there is no existing
// packages/* convention for those to match - they are carried over from the
// old shared config's actual values instead, because dropping them silently
// changes what "green" means:
// - `include` - all four of the old TEST_INCLUDE_TS globs, not just
//   `src/**/__tests__/**/*.test.ts`: a `.spec.ts` file, or a colocated
//   `*.test.ts` next to its source rather than under `__tests__/`, must keep
//   running rather than being silently skipped.
// - `exclude` / `coverage.exclude` - the shared DEFAULT_TEST_EXCLUDE /
//   COVERAGE_EXCLUDE globs, narrowed to the `.ts` extensions this
//   TypeScript-only package actually has (the shared module's own multi-
//   extension list served every kind of package in one shared file; a
//   package-local config only needs its own).
// - `coverage.thresholds` - the shared 70%/70%/70%/60% (lines/functions/
//   statements/branches) floor. Without this, a coverage regression here
//   passes green with no signal at all.
// - `setupFiles: ['./vitest.setup.ts']` - a local copy of the one piece of
//   the shared cleanup hook this package's tests actually rely on (real
//   timers restored after a fake-timer test; see that file).
// - `testTimeout`/`hookTimeout: 30_000` - the shared config's cold-start
//   allowance (`COLD_START_TIMEOUT_MS` in the old `vitest.shared.ts`):
//   Vitest's 5s default runs from test start, so on a cold transform cache it
//   also covers the first test file's Vite transform, which measured cold
//   runs cross by more than 10x.
// - `passWithNoTests: false` - an empty `include` match (a typo'd glob, a
//   deleted last test file) must fail loudly, not report a vacuous pass.
export default defineConfig({
  test: {
    globals: true,
    // 'node' (not jsdom): this package builds REST/plugin descriptors and
    // touches no DOM.
    environment: 'node',
    include: [
      '__tests__/**/*.test.ts',
      '__tests__/**/*.spec.ts',
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
    ],
    exclude: ['**/__test-utils__/**', '**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/dist/**',
        '**/__tests__/**',
        '**/__test-utils__/**',
        '**/*.config.*',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60,
      },
    },
  },
});
