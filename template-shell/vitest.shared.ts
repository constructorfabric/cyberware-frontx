import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Type-only imports: erased at runtime so they do NOT pull `vitest/config`'s
// transitive build-time graph (esbuild) into callers of this module. That
// matters because `vitest.shared.ts` is imported from test files running in
// `jsdom`, where esbuild's bootstrap invariant check fails at load time.
import type { Plugin } from 'vite';
import type { ViteUserConfig } from 'vitest/config';

//
// Shared Vitest configuration primitives for the monorepo.
//
// Every vitest.config.ts in the monorepo (root, host-app, per-package, and
// per-MFE) imports from this module so test include globs, default exclude
// globs, coverage excludes, coverage thresholds, and shared setup hooks
// cannot drift apart.
//
// The standalone CLI scaffold also derives its generated `vitest.config.ts`
// and `src/mfe_packages/vitest.mfe.base.ts` from this module via
// `packages/cli/scripts/copy-templates.ts`, so scaffolded projects stay in
// lockstep with the monorepo defaults without maintaining a second hand-edited
// template copy.
//
// NOTE: The glob strings below cannot appear inside a JSDoc block comment
// because "**/" contains the "*/" sequence that closes the comment, so all
// narrative documentation for this file uses line comments instead.

const TEST_FILE_EXTENSIONS = 'js,jsx,ts,tsx,cjs,cts,mjs,mts';

export const DEFAULT_TEST_EXCLUDE: readonly string[] = [
  '**/__test-utils__/**',
  '**/node_modules/**',
  '**/dist/**',
];

export const COVERAGE_EXCLUDE: readonly string[] = [
  `**/*.test.{${TEST_FILE_EXTENSIONS}}`,
  `**/*.spec.{${TEST_FILE_EXTENSIONS}}`,
  '**/dist/**',
  '**/__tests__/**',
  '**/__test-utils__/**',
  '**/*.config.*',
];

export const TEST_INCLUDE_TS: readonly string[] = [
  '__tests__/**/*.test.ts',
  '__tests__/**/*.spec.ts',
  'src/**/*.test.ts',
  'src/**/*.spec.ts',
];

export const TEST_INCLUDE_TSX: readonly string[] = [
  '__tests__/**/*.test.{ts,tsx}',
  '__tests__/**/*.spec.{ts,tsx}',
  'src/**/*.test.{ts,tsx}',
  'src/**/*.spec.{ts,tsx}',
];

/**
 * Vite `resolve.dedupe` for the host app and CLI scaffold. Under pnpm, multiple
 * symlinked copies of `@gears-frontx/*` can resolve from different paths; without
 * dedupe, `vi.doMock('@gears-frontx/react')` may not match the module instance
 * that application code imports (e.g. bootstrap contract tests).
 */
export const VITE_RESOLVE_DEDUPE: readonly string[] = [
  'react',
  'react-dom',
  '@gears-frontx/react',
  '@gears-frontx/framework',
];

/**
 * Vitest `server.deps.inline` — see {@link VITE_RESOLVE_DEDUPE} (pnpm + vi.doMock).
 * `@gears-frontx/ui-kit` is inlined for a different reason: its dist chunks
 * import their component CSS as sibling files, which Node's ESM loader rejects
 * ("Unknown file extension .css") unless Vite processes the package.
 */
export const VITEST_SERVER_DEPS_INLINE: readonly string[] = [
  '@gears-frontx/react',
  '@gears-frontx/framework',
  '@gears-frontx/ui-kit',
];

/**
 * Monorepo-wide coverage thresholds, enforced whenever a config is executed
 * with `vitest --coverage`. Treated as a ratchet: bumping a number here forces
 * every package to re-verify its coverage floor before the change can merge.
 *
 * The values below were chosen as the current-state baseline (rounded down)
 * so adding the thresholds does not retroactively break existing coverage
 * runs. Raise, never lower.
 */
export const COVERAGE_THRESHOLDS = Object.freeze({
  lines: 70,
  functions: 70,
  statements: 70,
  branches: 60,
});

/**
 * Per-test and per-hook timeout for every Vitest config built from this module.
 *
 * Vitest's 5000 ms default runs from the moment a test starts, so on a cold
 * transform cache that same clock also covers the Vite transform of everything
 * the first test file pulls in. Measured cold first runs cross it by more than
 * an order of magnitude and fail tests that pass in under two seconds on the
 * next invocation, which reports the state of the cache rather than the code.
 *
 * 30 s absorbs a cold start with room to spare and hides no genuine hang: a
 * test that never settles still fails, and the per-project timeout in the
 * monorepo test runner still bounds the run as a whole.
 *
 * Applied uniformly to every config this module produces (package configs, the
 * MFE base, the host config and its scaffolded twin) because the cold cache
 * belongs to the checkout rather than to any one kind of suite: a timeout that
 * differed by lane would move the false red rather than remove it. Every other
 * site that sets these two options points here instead of restating the
 * reasoning.
 */
export const COLD_START_TIMEOUT_MS = 30_000;

/**
 * Node.js 25+ enables experimental global Web Storage; without
 * `--localstorage-file`, worker processes print a warning whenever anything
 * touches `localStorage`. Vitest tests use jsdom's `window.localStorage`, so
 * disabling Node's implementation via `--no-experimental-webstorage` on workers
 * is safe. Older Node releases do not recognize that flag, so it is omitted.
 */
export function vitestNodeWorkerExecArgv(): string[] {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major < 25) return [];
  return ['--no-experimental-webstorage'];
}

/** Inlined by `renderStandaloneMfeVitestBase`; must stay aligned with {@link vitestNodeWorkerExecArgv}. */
const STANDALONE_VITEST_NODE_WORKER_EXEC_ARGV_FN = `function vitestNodeWorkerExecArgv(): string[] {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major < 25) return [];
  return ['--no-experimental-webstorage'];
}
`;

// Resolve this file's directory so we can anchor the setup-file path against
// it instead of the caller's CWD. vite-node occasionally passes a
// non-`file://` import.meta.url (observed under `vitest --run` when the test
// runner imports this module), which breaks `fileURLToPath`. The fallback
// branch below covers that case by interpreting the URL as a plain path.
const SHARED_SHARED_FILE_PATH = resolveSharedModulePath(import.meta.url);
const REPO_ROOT = path.dirname(SHARED_SHARED_FILE_PATH);
// `vitest.setup.ts` lives INSIDE template-shell (a deliberate copy of the
// ecosystem's own root-level setup file — see the comment in that file).
// template-shell is a self-contained, out-of-workspace directory whose
// `server.fs.allow` is scoped to its own root, so this module must not
// resolve any path outside `REPO_ROOT`, including for ecosystem packages
// (e.g. `packages/api/vitest.config.ts`) that import this shared config.
const SHARED_SETUP_FILE_PATH = path.join(REPO_ROOT, 'vitest.setup.ts');
const MFE_BASE_FILE_PATH = path.join(
  REPO_ROOT,
  'packages',
  'mfe-test-support',
  'vitest.mfe.base.ts',
);

function resolveSharedModulePath(metaUrl: string): string {
  if (metaUrl.startsWith('file:')) {
    return fileURLToPath(metaUrl);
  }
  // Strip an optional scheme (e.g. `vite-node:`) and any query/hash segments.
  const schemeStripped = metaUrl.replace(/^[a-z][a-z0-9+.-]*:(?:\/\/)?/i, '/');
  const withoutSearch = schemeStripped.split(/[?#]/, 1)[0] ?? schemeStripped;
  return path.resolve(withoutSearch);
}

export const SHARED_VITEST_SETUP_FILES = [SHARED_SETUP_FILE_PATH] as const;

// Read the setup file at module-load time so `renderStandaloneVitestSetupFile`
// cannot drift from `vitest.setup.ts`. The CLI template build runs via `tsx`,
// which executes this file directly; no bundler is in the path.
const SHARED_SETUP_FILE_CONTENTS = readFileSync(SHARED_SETUP_FILE_PATH, 'utf-8');

// Read the live MFE base file so `renderStandaloneMfeVitestBase` cannot drift
// from `packages/mfe-test-support/vitest.mfe.base.ts` (imported by MFE
// packages under their own package name rather than a relative reach into
// this shell). The renderer below transforms the live source (stripping the
// vitest.shared import and inlining its constants) rather than maintaining a
// parallel template string.
const MFE_BASE_FILE_CONTENTS = readFileSync(MFE_BASE_FILE_PATH, 'utf-8');

export function renderStandaloneVitestSetupFile(): string {
  return SHARED_SETUP_FILE_CONTENTS;
}

// Host-side `scripts/**` test globs that the root `vitest.config.ts` wires in
// for the monorepo runner. They ride into the scaffolded config so scaffolded
// projects pick up logic-heavy scripts (e.g. custom codegen) without a second
// Vitest project.
export const HOST_SCRIPT_TEST_INCLUDE: readonly string[] = [
  'scripts/**/*.test.{ts,tsx,mts,mjs}',
  'scripts/**/*.spec.{ts,tsx,mts,mjs}',
];

export function renderStandaloneVitestConfig(): string {
  return `import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const sharedSetupFile = fileURLToPath(new URL('./vitest.setup.ts', import.meta.url));

${STANDALONE_VITEST_NODE_WORKER_EXEC_ARGV_FN}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@frontx-test-utils': fileURLToPath(new URL('./src/__test-utils__', import.meta.url)),
    },
    dedupe: ${formatArrayLiteral(VITE_RESOLVE_DEDUPE, 6)},
  },
  test: {
    globals: true,
    passWithNoTests: false,
    environment: 'jsdom',
    execArgv: vitestNodeWorkerExecArgv(),
    setupFiles: [sharedSetupFile],
    testTimeout: ${COLD_START_TIMEOUT_MS},
    hookTimeout: ${COLD_START_TIMEOUT_MS},
    include: ${formatArrayLiteral([...TEST_INCLUDE_TSX, ...HOST_SCRIPT_TEST_INCLUDE], 6)},
    exclude: ${formatArrayLiteral(['src/mfe_packages/**', ...DEFAULT_TEST_EXCLUDE], 6)},
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ${formatArrayLiteral(COVERAGE_EXCLUDE, 8)},
      thresholds: ${formatObjectLiteral(COVERAGE_THRESHOLDS, 8)},
    },
    server: {
      deps: {
        inline: ${formatArrayLiteral(VITEST_SERVER_DEPS_INLINE, 8)},
      },
    },
  },
});
`;
}

// Per-package vitest-config options. JSDoc blocks below avoid the "*/"
// sequence (closes the block comment) by pairing backticks with inline
// descriptions only — the glob explanation lives in line comments here.
//
// `rootDir`: absolute path to the package root. Pass __dirname computed from
//   the caller's import.meta.url so Vitest resolves relative globs against
//   the package instead of the host app.
// `environment`: 'node' for logic-only SDK/state packages, 'jsdom' for
//   anything that touches the DOM (React components, shadow-DOM helpers,
//   etc.). Matches the existing split in the per-package vitest.config.ts
//   files.
// `testInclude`: 'ts' for TypeScript-only packages (SDK, framework, CLI),
//   'tsx' for packages that ship React/JSX. Controls whether .tsx test
//   files are picked up. Defaults based on environment.
// `plugins`: extra Vite plugins — in practice this is `[react()]` for
//   React-owning packages. Defaults to an empty list so node-only packages
//   don't pay the plugin cost.
// `alias`: extra `resolve.alias` entries. A package needs these when its own
//   public entry must resolve to source for tests — otherwise a test importing
//   by package name and a test importing by relative path get two module
//   instances of the same file, and context published through one is invisible
//   through the other. Passing them here is what keeps such a package on this
//   helper: hand-rolling a config for the sake of two aliases silently opts the
//   package out of the shared setup files and timeouts as well.
export interface DefinePackageVitestConfigOptions {
  rootDir: string;
  environment: 'node' | 'jsdom';
  testInclude?: 'ts' | 'tsx';
  plugins?: Plugin[];
  alias?: Record<string, string>;
}

// Build a per-package Vitest config from the monorepo-shared primitives.
// This helper exists so the per-package vitest.config.ts files can't drift
// on setup wiring, coverage globs, thresholds, or exclude globs; the only
// things each package chooses are environment, include flavor, plugins, and
// root.
export function definePackageVitestConfig(
  options: DefinePackageVitestConfigOptions,
): ViteUserConfig {
  const {
    rootDir,
    environment,
    testInclude = environment === 'jsdom' ? 'tsx' : 'ts',
    plugins = [],
    alias,
  } = options;

  const include =
    testInclude === 'tsx' ? [...TEST_INCLUDE_TSX] : [...TEST_INCLUDE_TS];

  // Return the raw config object instead of passing it through Vitest's
  // `defineConfig` identity helper. `defineConfig` exists only for type
  // inference on inline object literals; the `ViteUserConfig` return type
  // below gives us the same guarantee without importing from `vitest/config`
  // at module load (see the type-only imports at the top of this file).
  return {
    plugins,
    root: rootDir,
    ...(alias ? { resolve: { alias } } : {}),
    server: {
      fs: {
        allow: [REPO_ROOT],
      },
    },
    test: {
      globals: true,
      environment,
      execArgv: vitestNodeWorkerExecArgv(),
      setupFiles: [...SHARED_VITEST_SETUP_FILES],
      testTimeout: COLD_START_TIMEOUT_MS,
      hookTimeout: COLD_START_TIMEOUT_MS,
      include,
      exclude: [...DEFAULT_TEST_EXCLUDE],
      passWithNoTests: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [...COVERAGE_EXCLUDE],
        thresholds: { ...COVERAGE_THRESHOLDS },
      },
    },
  } satisfies ViteUserConfig;
}

/**
 * Render the MFE Vitest base config for a scaffolded project.
 *
 * Rather than maintaining a template string that mirrors
 * `packages/mfe-test-support/vitest.mfe.base.ts`, this reads the live module
 * and performs a narrow transform:
 *   1. Replace the `import { ... } from '../../vitest.shared';` block with a
 *      locally-declared `__dirname`/`sharedSetupFile` pair plus inline
 *      literals of the shared constants — the canonical module needs none of
 *      that itself (it is imported by package name, not by relative path
 *      from a fixed scaffold location), but a scaffolded standalone copy
 *      does, since it has no `vitest.shared.ts` sibling to import.
 *   2. Swap `[...SHARED_VITEST_SETUP_FILES]` for that local `sharedSetupFile`
 *      reference.
 *
 * Any other change to the live MFE base file (plugins, dedupe rules, new test
 * options) propagates to scaffolded projects without touching this function.
 * `__tests__/vitest-shared.test.ts` asserts the rendered output still
 * contains every shared-constant value, so silent drift from the source
 * primitives still fails CI.
 */
export function renderStandaloneMfeVitestBase(): string {
  const inlineConstants = [
    `const COLD_START_TIMEOUT_MS = ${COLD_START_TIMEOUT_MS};`,
    `const TEST_INCLUDE_TSX = ${formatArrayLiteral(TEST_INCLUDE_TSX, 0)};`,
    `const DEFAULT_TEST_EXCLUDE = ${formatArrayLiteral(DEFAULT_TEST_EXCLUDE, 0)};`,
    `const COVERAGE_EXCLUDE = ${formatArrayLiteral(COVERAGE_EXCLUDE, 0)};`,
    `const COVERAGE_THRESHOLDS = ${formatObjectLiteral(COVERAGE_THRESHOLDS, 0)};`,
  ].join('\n');

  // `[^}]*?` (instead of `[\s\S]*?`) so the match cannot span across an
  // intermediate closing brace + `from '...'`. Without this, the regex happily
  // swallows earlier single-line `import { X } from '...'` blocks sitting above
  // the shared import, stripping their bindings from the rendered module.
  // The shared import body itself has no `}` characters, so confining the
  // group to non-brace content is safe.
  const importBlockRegex =
    /import\s+\{[^}]*?\}\s+from\s+['"](?:\.\.\/)*vitest\.shared(?:\.ts)?['"];\n?/;

  let importBlockMatched: boolean = false;
  let setupFilesMatched: boolean = false;

  const rendered = MFE_BASE_FILE_CONTENTS
    .replace(importBlockRegex, () => {
      importBlockMatched = true;
      return (
        `${STANDALONE_VITEST_NODE_WORKER_EXEC_ARGV_FN}\n` +
        `import path from 'node:path';\n` +
        `import { fileURLToPath } from 'node:url';\n\n` +
        `const __dirname = path.dirname(fileURLToPath(import.meta.url));\n` +
        `const sharedSetupFile = path.resolve(__dirname, '../../vitest.setup.ts');\n\n` +
        `${inlineConstants}\n`
      );
    })
    .replace(/\[\.\.\.SHARED_VITEST_SETUP_FILES\]/, () => {
      setupFilesMatched = true;
      return '[sharedSetupFile]';
    });

  if (!importBlockMatched || !setupFilesMatched) {
    throw new Error(
      'renderStandaloneMfeVitestBase could not rewrite packages/mfe-test-support/vitest.mfe.base.ts; update the transform for the new source shape.',
    );
  }

  if (
    rendered.includes('vitest.shared') ||
    rendered.includes('SHARED_VITEST_SETUP_FILES')
  ) {
    throw new Error(
      'renderStandaloneMfeVitestBase produced a non-standalone module; shared imports leaked into the rendered output.',
    );
  }

  return rendered;
}

function formatArrayLiteral(values: readonly string[], indentSize: number): string {
  const indent = ' '.repeat(indentSize);
  const itemIndent = ' '.repeat(indentSize + 2);

  const lines = values
    .map((value) => itemIndent + JSON.stringify(value) + ',')
    .join('\n');
  return `[\n${lines}\n${indent}]`;
}

function formatObjectLiteral(
  record: Readonly<Record<string, number>>,
  indentSize: number,
): string {
  const indent = ' '.repeat(indentSize);
  const itemIndent = ' '.repeat(indentSize + 2);
  const entries = Object.entries(record)
    .map(([key, value]) => `${itemIndent}${JSON.stringify(key)}: ${value},`)
    .join('\n');

  return `{\n${entries}\n${indent}}`;
}
