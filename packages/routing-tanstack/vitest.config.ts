import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    // jsdom (not node): this package's Engine Provider mounts into a
    // microfrontend's own React component tree and adapts a browser
    // navigation history (PRD §3.1 "Requires a browser environment with the
    // primitives TanStack Router's own history contract assumes"), unlike the
    // navigation substrate it depends on, which stays framework- and
    // DOM-agnostic by constraint.
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
