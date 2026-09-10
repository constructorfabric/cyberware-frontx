// Host-app Vitest config: owns `template-shell/src-app/` (everything under
// this directory) except nested MFE packages, which own their own Vitest
// configs and are orchestrated as separate projects. Covering all of this
// directory here means any future host-side folder (for example a new
// top-level `shared/`) is picked up automatically instead of being silently
// skipped.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import {
  COLD_START_TIMEOUT_MS,
  COVERAGE_EXCLUDE,
  COVERAGE_THRESHOLDS,
  DEFAULT_TEST_EXCLUDE,
  SHARED_VITEST_SETUP_FILES,
  VITE_RESOLVE_DEDUPE,
  VITEST_SERVER_DEPS_INLINE,
  vitestNodeWorkerExecArgv,
} from '../vitest.shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Vitest's `root` does not default to this config file's own directory
  // when invoked via `--config` from a different CWD (e.g. `template-shell/`
  // via `npm test`) — it defaults to the CWD. Set it explicitly so `include`/
  // `exclude` below resolve against `src-app/` as the header comment states,
  // and so this config does not pick up `packages/*` tests (which have their
  // own configs) or nested MFE tests (excluded below, relative to this root).
  root: __dirname,
  // `vitest.setup.ts` lives inside template-shell — one level up from this
  // config's own directory (`src-app/` -> `template-shell/`). Vite's
  // dev-server file-serving restriction otherwise blocks reading it via
  // `/@fs/...` outside the default project-root boundary.
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  resolve: {
    alias: [
      {
        find: '@gears-frontx/react/testing',
        replacement: path.resolve(__dirname, '../packages/framework/dist/testing.js'),
      },
      {
        find: '@',
        replacement: __dirname,
      },
    ],
    dedupe: [...VITE_RESOLVE_DEDUPE],
  },
  test: {
    globals: true,
    passWithNoTests: false,
    environment: 'jsdom',
    execArgv: vitestNodeWorkerExecArgv(),
    setupFiles: [...SHARED_VITEST_SETUP_FILES],
    // Reached here too, not only in scaffolded projects: a rebuild of
    // `packages/*` leaves this lane's first run cold. See
    // COLD_START_TIMEOUT_MS.
    testTimeout: COLD_START_TIMEOUT_MS,
    hookTimeout: COLD_START_TIMEOUT_MS,
    include: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    exclude: ['mfe_packages/**', ...DEFAULT_TEST_EXCLUDE],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [...COVERAGE_EXCLUDE],
      thresholds: { ...COVERAGE_THRESHOLDS },
    },
    server: {
      deps: {
        inline: [...VITEST_SERVER_DEPS_INLINE],
      },
    },
  },
});
