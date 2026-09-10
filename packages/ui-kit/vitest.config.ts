// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);

// Keep this config package-local: UI Kit is an ecosystem technology and must
// not depend on template-owned test infrastructure. The thresholds mirror the
// current monorepo floor and remain enforced by the root test runner.
export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__test-utils__/setup.ts'],
    execArgv: nodeMajor >= 25 ? ['--no-experimental-webstorage'] : [],
    include: [
      '__tests__/**/*.test.{ts,tsx}',
      '__tests__/**/*.spec.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'src/**/*.spec.{ts,tsx}',
      // The contract tooling's own unit tests (extract.ts's checker-based
      // resolution) live next to the tool, not under src/ - vite-plugin-dts
      // reads tsconfig.src.json to decide what ships, so tests never belong
      // there, but that leaves nothing else picking scripts/**/*.test.ts up.
      'scripts/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/__test-utils__/**', '**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/*.test.{js,jsx,ts,tsx,cjs,cts,mjs,mts}',
        '**/*.spec.{js,jsx,ts,tsx,cjs,cts,mjs,mts}',
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
