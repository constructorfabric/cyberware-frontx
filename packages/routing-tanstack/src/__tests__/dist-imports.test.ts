import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { classifySpecifier, collectModuleSpecifiers } from './helpers/module-specifiers.js';

// F3 (review round 16-re): the published `dist/index.d.ts` must never
// import a module specifier this package does not declare as a dependency
// or peerDependency (or a relative path) — an undeclared import resolves
// only by accident, through hoisting in this monorepo's own workspace, and
// breaks the moment a consumer installs this package on its own (the
// defect this round's own `@tanstack/router-core` fix closed: it appeared
// in `dist/index.d.ts` while only implicitly present via
// `@tanstack/react-router`'s own dependency).
//
// R1 (review round 16-re2): the previous version of this test read the
// *real* `packages/routing-tanstack/dist/index.d.ts`, building it on demand
// with `npm run build -w packages/routing-tanstack` when absent. That build
// resolves `@gears-frontx/routing` through `node_modules` to
// `packages/routing/package.json`'s own `exports`, which point at
// `packages/routing/dist` — also absent on a fresh clone — so the on-demand
// build itself failed there (`TS2307`), and a *present* `dist/` was read
// stale, checking whatever a previous build happened to leave behind rather
// than the change under test. Both are closed the same way: this test
// builds its own throwaway declaration output into a temp directory on
// every run, via `tsc --declaration --emitDeclarationOnly` (not `tsup`,
// whose dts step is a slower, less-composable rollup-dts bundle this test
// has no need for) — `packages/routing` first, then `packages/routing-tanstack`
// against it through a `paths` override pointing at that temp declaration
// output rather than `packages/routing`'s own `dist` or `src`. The `paths`
// override changes only how the specifier resolves for type-checking; the
// specifier text preserved in the emitted `.d.ts` is exactly what the
// source wrote (`from '@gears-frontx/routing'`), so this still exercises
// the same "is this specifier declared" question the real published
// artifact answers.
//
// N1 (review round 16-re3): a per-file `tsc` emit (what this test builds,
// and what `tsup`'s own rollup-dts step ultimately draws from too) spreads
// a package's own import surface across *several* `.d.ts` files, not just
// `index.d.ts` — `react` and `@tanstack/router-core` sit in
// `router-creation.d.ts`, the latter only as a dynamic `import("…")` type
// reference, not a static `from '…'`. Reading only `index.d.ts` and
// matching only `from '…'` understated the real surface enough that
// removing `@tanstack/router-core` from `dependencies` — the exact defect
// this test exists to catch — would have kept passing. This version scans
// every `*.d.ts` file the build produces and matches both import forms
// (`./helpers/module-specifiers.ts`, unit-tested on its own in
// `module-specifiers.test.ts`).
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(packageRoot, '../..');
const tscBin = path.join(repoRoot, 'node_modules/.bin/tsc');

let workDir: string | undefined;

afterEach(() => {
  if (workDir !== undefined) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

// LOW (review round 16-re3): `stdio: 'pipe'` swallows `tsc`'s own
// diagnostics — a failing compile used to surface here as a bare
// "Command failed" with no indication of which type error caused it.
// `execFileSync` attaches the captured output to the thrown error's own
// `stdout`; folding it into the re-thrown message is what actually makes a
// failure here diagnosable without reproducing the build by hand.
function runTsc(args: string[], cwd: string): void {
  try {
    execFileSync(tscBin, args, { cwd, stdio: 'pipe' });
  } catch (error) {
    const stdout =
      error !== null && typeof error === 'object' && 'stdout' in error
        ? String((error as { stdout?: Buffer | string }).stdout ?? '')
        : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`tsc failed: ${message}\n${stdout}`, { cause: error });
  }
}

function buildFreshTanstackDtsDir(): string {
  workDir = mkdtempSync(path.join(tmpdir(), 'routing-tanstack-dist-imports-'));
  const routingOutDir = path.join(workDir, 'routing');
  const tanstackOutDir = path.join(workDir, 'routing-tanstack');

  // `packages/routing` has no ecosystem dependency of its own — its base
  // `tsconfig.json` (rootDir `./src`) emits declarations straight into a
  // temp dir standing in for its own `dist/`.
  runTsc(
    ['-p', path.join(repoRoot, 'packages/routing/tsconfig.json'), '--declaration', '--emitDeclarationOnly', '--outDir', routingOutDir],
    repoRoot,
  );

  // `packages/routing-tanstack` needs `@gears-frontx/routing` resolved
  // somewhere — pointed here at the just-built temp declaration output
  // (not at `../routing/src`, which would pull the sibling's own source
  // graph into this compile and prove nothing about the published
  // artifact's import specifiers). LOW (review round 16-re3): this
  // throwaway tsconfig used to be written next to the package's own
  // `tsconfig.json` — inside the tracked package directory, untracked and
  // gitignore-invisible, so a killed run left residue there. It now lives
  // in `workDir` alongside the rest of this test's own temp output, with
  // an absolute `extends` back to the real config so a relative location
  // never matters for how it resolves.
  const tmpConfigPath = path.join(workDir, 'tsconfig.dist-imports-test.tmp.json');
  writeFileSync(
    tmpConfigPath,
    JSON.stringify(
      {
        extends: path.join(packageRoot, 'tsconfig.json'),
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          outDir: tanstackOutDir,
          baseUrl: packageRoot,
          paths: {
            '@gears-frontx/routing': [path.join(routingOutDir, 'index.d.ts')],
          },
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(tanstackOutDir, { recursive: true });
  runTsc(['-p', tmpConfigPath], packageRoot);

  return tanstackOutDir;
}

describe('published dist/index.d.ts module specifiers (F3)', () => {
  it('every non-relative import, across every emitted .d.ts, is a declared dependency or peerDependency', () => {
    const tanstackOutDir = buildFreshTanstackDtsDir();
    const specifiers = collectModuleSpecifiers(tanstackOutDir);
    expect(specifiers.size).toBeGreaterThan(0);

    const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ]);

    for (const specifier of specifiers) {
      const specifierClass = classifySpecifier(specifier, declared);
      expect(specifierClass, `undeclared module specifier: ${specifier}`).not.toBe('undeclared');
    }
  });
});
