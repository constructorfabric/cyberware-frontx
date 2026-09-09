/**
 * Vitest project for the repo-root `scripts/` toolchain.
 *
 * Everything else in this repo owns its own config: `packages/*` are npm
 * workspaces. `scripts/` is neither, so until this config existed no project
 * claimed the runner, version-policy and dependency-check tests and
 * `npm run test:unit` walked straight past all of them (#483).
 *
 * `scripts/run-monorepo-unit-tests.mjs` drives this config as the `repo-scripts`
 * project via the private `_test:unit:host` script; that indirection is what
 * lets the runner treat it like any other project it fans out to.
 *
 * The filename is deliberately NOT `vitest.config.mjs`: Vitest searches upward
 * for that name, so a workspace without a config of its own — `packages/gts-plugin`
 * today — would silently inherit the globs below and report zero tests for
 * itself. Only an explicit `--config` reaches this file.
 *
 * The include glob is anchored at `scripts/` instead of relying on Vitest's
 * `**`-rooted default because a checked-out git worktree (`.claude/worktrees/*`)
 * is a second full copy of this repo: an unanchored glob collects every test
 * file twice and reports a suite size that depends on the developer's local
 * worktrees.
 *
 * It matches both `.mjs` and `.ts` because `scripts/` holds both kinds of source
 * (`test-architecture.ts`, `sdk-layer-tests.ts`, `verify-layered-configs.ts`
 * alongside the `.mjs` tooling). Every test here happens to be `.mjs` today, so
 * this changes nothing now - which is the point: a `.ts` test added next to a
 * `.ts` script would otherwise be collected by no project at all and report as
 * a pass, the same silent gap that left this whole directory untested until
 * #483 (review round 3 on #492).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.{mjs,ts}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: false,
  },
});
