import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    // node (not jsdom/happy-dom): the navigation substrate and route ownership
    // signal are framework- and DOM-agnostic by constraint
    // (cpt-frontx-constraint-routing-no-engine-leak); a browser environment is
    // adopted only if a future suite needs to exercise a real `window.history`.
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
