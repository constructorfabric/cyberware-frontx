//
// Locks the rendered output of the standalone-scaffold helpers in
// `vitest.shared.ts` against the canonical constants they are built from.
// Without these assertions a drift in `TEST_INCLUDE_TSX`, `COVERAGE_EXCLUDE`,
// `COVERAGE_THRESHOLDS`, or the setup-file body could silently ship to every
// scaffolded project via `packages/cli/scripts/copy-templates.ts`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COLD_START_TIMEOUT_MS,
  COVERAGE_EXCLUDE,
  COVERAGE_THRESHOLDS,
  DEFAULT_TEST_EXCLUDE,
  HOST_SCRIPT_TEST_INCLUDE,
  TEST_INCLUDE_TSX,
  renderStandaloneMfeVitestBase,
  renderStandaloneVitestConfig,
  renderStandaloneVitestSetupFile,
} from '../vitest.shared';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `vitest.setup.ts` lives inside template-shell, one level up from this
// file (template-shell/__tests__/ -> template-shell/), so the template
// stays self-contained (see the comment in vitest.shared.ts).
const SETUP_FILE_PATH = path.join(HERE, '..', 'vitest.setup.ts');

/**
 * Normalize CRLF → LF so byte-compare assertions work across platforms.
 * Git on Windows can check files out with CRLF line endings depending on
 * `core.autocrlf`; without normalization, a clean Windows checkout would
 * fail this test even though the rendered template is semantically
 * identical to the on-disk file. The canonical form in this repo is LF,
 * so that's what the renderer emits and what we compare against.
 */
function toLf(contents: string): string {
  return contents.replaceAll('\r\n', '\n');
}

describe('renderStandaloneVitestSetupFile', () => {
  it('matches vitest.setup.ts byte-for-byte (LF-normalized)', () => {
    const onDisk = readFileSync(SETUP_FILE_PATH, 'utf-8');
    expect(toLf(renderStandaloneVitestSetupFile())).toBe(toLf(onDisk));
  });

  it('installs an afterEach hook (smoke check)', () => {
    expect(renderStandaloneVitestSetupFile()).toContain('afterEach');
  });
});

describe('renderStandaloneVitestConfig', () => {
  const rendered = renderStandaloneVitestConfig();

  it('emits every TEST_INCLUDE_TSX glob as a string literal', () => {
    for (const glob of TEST_INCLUDE_TSX) {
      expect(rendered).toContain(JSON.stringify(glob));
    }
  });

  it('wraps DEFAULT_TEST_EXCLUDE plus src/mfe_packages/** as host-app excludes', () => {
    expect(rendered).toContain(JSON.stringify('src/mfe_packages/**'));
    for (const glob of DEFAULT_TEST_EXCLUDE) {
      expect(rendered).toContain(JSON.stringify(glob));
    }
  });

  it('emits every COVERAGE_EXCLUDE glob', () => {
    for (const glob of COVERAGE_EXCLUDE) {
      expect(rendered).toContain(JSON.stringify(glob));
    }
  });

  it('emits the shared coverage thresholds', () => {
    for (const [key, value] of Object.entries(COVERAGE_THRESHOLDS)) {
      expect(rendered).toContain(`${JSON.stringify(key)}: ${value}`);
    }
  });

  it('keeps passWithNoTests strict, jsdom env, and shared setup wiring', () => {
    expect(rendered).toContain('passWithNoTests: false');
    expect(rendered).toContain("environment: 'jsdom'");
    expect(rendered).toContain('setupFiles: [sharedSetupFile]');
    expect(rendered).toContain(`testTimeout: ${COLD_START_TIMEOUT_MS}`);
    expect(rendered).toContain(`hookTimeout: ${COLD_START_TIMEOUT_MS}`);
    expect(rendered).toContain('@vitejs/plugin-react');
    expect(rendered).toContain('execArgv: vitestNodeWorkerExecArgv()');
    expect(rendered).toContain('--no-experimental-webstorage');
  });

  it('wires the @ and @frontx-test-utils aliases used by the host Vitest config', () => {
    expect(rendered).toContain("'@': fileURLToPath(new URL('./src'");
    expect(rendered).toContain(
      "'@frontx-test-utils': fileURLToPath(new URL('./src/__test-utils__'",
    );
  });

  it('includes the host scripts/**/*.test globs so scaffolds pick up logic-heavy script tests', () => {
    for (const glob of HOST_SCRIPT_TEST_INCLUDE) {
      expect(rendered).toContain(JSON.stringify(glob));
    }
  });
});

describe('renderStandaloneMfeVitestBase', () => {
  const rendered = renderStandaloneMfeVitestBase();

  it('emits every TEST_INCLUDE_TSX glob', () => {
    for (const glob of TEST_INCLUDE_TSX) {
      expect(rendered).toContain(JSON.stringify(glob));
    }
  });

  it('emits every DEFAULT_TEST_EXCLUDE glob but does NOT bake in src/mfe_packages/**', () => {
    for (const glob of DEFAULT_TEST_EXCLUDE) {
      expect(rendered).toContain(JSON.stringify(glob));
    }
    // MFE base is scoped to an MFE package root; the host-app carve-out
    // belongs only to renderStandaloneVitestConfig.
    expect(rendered).not.toContain(JSON.stringify('src/mfe_packages/**'));
  });

  it('emits every COVERAGE_EXCLUDE glob and the shared coverage thresholds', () => {
    for (const glob of COVERAGE_EXCLUDE) {
      expect(rendered).toContain(JSON.stringify(glob));
    }
    for (const [key, value] of Object.entries(COVERAGE_THRESHOLDS)) {
      expect(rendered).toContain(`${JSON.stringify(key)}: ${value}`);
    }
  });

  it('strips vitest.shared imports and rewires shared setup locally so the module is self-contained', () => {
    expect(rendered).not.toContain('vitest.shared');
    expect(rendered).not.toContain('SHARED_VITEST_SETUP_FILES');
    expect(rendered).toContain(
      "const sharedSetupFile = path.resolve(__dirname, '../../vitest.setup.ts');",
    );
    expect(rendered).toContain('setupFiles: [sharedSetupFile]');
    expect(rendered).toContain(`const COLD_START_TIMEOUT_MS = ${COLD_START_TIMEOUT_MS};`);
    expect(rendered).toContain('const TEST_INCLUDE_TSX = [');
    expect(rendered).toContain('const DEFAULT_TEST_EXCLUDE = [');
    expect(rendered).toContain('const COVERAGE_EXCLUDE = [');
    expect(rendered).toContain('const COVERAGE_THRESHOLDS = {');
  });

  it('exposes the mfeVitestBaseConfig plus defineMfeProject helper', () => {
    expect(rendered).toContain('export const mfeVitestBaseConfig');
    expect(rendered).toContain('export function defineMfeProject');
    expect(rendered).toContain('passWithNoTests: false');
    expect(rendered).toContain('testTimeout: COLD_START_TIMEOUT_MS');
    expect(rendered).toContain('hookTimeout: COLD_START_TIMEOUT_MS');
    expect(rendered).toContain('execArgv: vitestNodeWorkerExecArgv()');
    expect(rendered).toContain('--no-experimental-webstorage');
  });

  it('preserves the non-shared runtime imports used by the rendered module', () => {
    // Regression guard: a too-greedy import-block regex previously swallowed
    // these imports along with the `vitest.shared` block, producing a module
    // that referenced `fileURLToPath`, `defineConfig`, `mergeConfig`, and
    // `react` without importing them.
    expect(rendered).toContain("import path from 'node:path';");
    expect(rendered).toContain("import { fileURLToPath } from 'node:url';");
    expect(rendered).toContain("import { defineConfig, mergeConfig } from 'vitest/config';");
    expect(rendered).toContain("import react from '@vitejs/plugin-react';");
  });
});
