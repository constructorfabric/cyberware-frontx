import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  resolve: {
    // F4 (review scope): this package is the one ecosystem package with an
    // intra-ecosystem edge at all (`@gears-frontx/routing`,
    // `cpt-frontx-routing-tanstack-nfr-single-ecosystem-edge`) — every other
    // package's own `vitest.config.ts` has no sibling-package alias because
    // no other package needs one. Node's own module resolution for a
    // workspace dependency goes through the `node_modules` symlink to that
    // package's `exports`/`main`, which point at `dist/` — unbuilt on a
    // fresh clone. Aliasing straight to source (mirroring the root
    // `tsconfig.json` `paths` entry) is what lets `npm test` here pass
    // without requiring `packages/routing` to be built first.
    alias: {
      '@gears-frontx/routing': path.resolve(__dirname, '../routing/src/index.ts'),
    },
  },
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
