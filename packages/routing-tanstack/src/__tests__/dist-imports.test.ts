import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

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

function buildFreshIndexDts(): string {
  workDir = mkdtempSync(path.join(tmpdir(), 'routing-tanstack-dist-imports-'));
  const routingOutDir = path.join(workDir, 'routing');
  const tanstackOutDir = path.join(workDir, 'routing-tanstack');

  // `packages/routing` has no ecosystem dependency of its own — its base
  // `tsconfig.json` (rootDir `./src`) emits declarations straight into a
  // temp dir standing in for its own `dist/`.
  execFileSync(
    tscBin,
    ['-p', path.join(repoRoot, 'packages/routing/tsconfig.json'), '--declaration', '--emitDeclarationOnly', '--outDir', routingOutDir],
    { cwd: repoRoot, stdio: 'pipe' },
  );

  // `packages/routing-tanstack` needs `@gears-frontx/routing` resolved
  // somewhere — pointed here at the just-built temp declaration output
  // (not at `../routing/src`, which would pull the sibling's own source
  // graph into this compile and prove nothing about the published
  // artifact's import specifiers). A throwaway tsconfig lives next to the
  // package's own `tsconfig.json` only for the duration of this compile,
  // extending it so this stays in sync with the package's real compiler
  // options.
  const tmpConfigPath = path.join(packageRoot, 'tsconfig.dist-imports-test.tmp.json');
  writeFileSync(
    tmpConfigPath,
    JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          outDir: tanstackOutDir,
          baseUrl: '.',
          paths: {
            '@gears-frontx/routing': [path.join(routingOutDir, 'index.d.ts')],
          },
        },
      },
      null,
      2,
    ),
  );
  try {
    mkdirSync(tanstackOutDir, { recursive: true });
    execFileSync(tscBin, ['-p', tmpConfigPath], { cwd: packageRoot, stdio: 'pipe' });
  } finally {
    rmSync(tmpConfigPath, { force: true });
  }

  return readFileSync(path.join(tanstackOutDir, 'index.d.ts'), 'utf-8');
}

describe('published dist/index.d.ts module specifiers (F3)', () => {
  it('every non-relative import is a declared dependency or peerDependency', () => {
    const dts = buildFreshIndexDts();
    const specifiers = new Set(
      Array.from(dts.matchAll(/from '([^']+)'/g), (match) => match[1]),
    );
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
      const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
      const isDeclared = declared.has(specifier);
      expect(isRelative || isDeclared, `undeclared module specifier: ${specifier}`).toBe(true);
    }
  });
});
