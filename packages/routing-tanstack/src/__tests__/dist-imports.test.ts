import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifySpecifier, collectModuleSpecifiers } from './helpers/module-specifiers.js';
import { TANSTACK_RUNTIME_SURFACE, TANSTACK_TYPE_ONLY_SURFACE } from './helpers/public-surface.js';

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
// builds its own throwaway declaration output into a temp directory, via
// `tsc --declaration --emitDeclarationOnly` (not `tsup`, whose dts step is a
// slower, less-composable rollup-dts bundle this test has no need for) —
// `packages/routing` first, then `packages/routing-tanstack` against it
// through a `paths` override pointing at that temp declaration output
// rather than `packages/routing`'s own `dist` or `src`. The `paths`
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
//
// N3 (review round 16-re4): the build this file already produces — one
// throwaway declaration output for `packages/routing`, one for
// `packages/routing-tanstack` compiled against it — is also exactly what a
// presence/consumer-type-check pair needs, mirroring
// `packages/routing`'s own `dist-internal.test.ts`. Built once in
// `beforeAll` (this file used to build fresh per `it`, and now has more than
// one) rather than once per assertion.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(packageRoot, '../..');
const tscBin = path.join(repoRoot, 'node_modules/.bin/tsc');

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

interface BuiltTanstackDts {
  workDir: string;
  routingOutDir: string;
  tanstackOutDir: string;
}

function buildFreshTanstackDtsDir(): BuiltTanstackDts {
  const workDir = mkdtempSync(path.join(tmpdir(), 'routing-tanstack-dist-imports-'));
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

  return { workDir, routingOutDir, tanstackOutDir };
}

let built: BuiltTanstackDts;

beforeAll(() => {
  built = buildFreshTanstackDtsDir();
});

afterAll(() => {
  rmSync(built.workDir, { recursive: true, force: true });
});

// LOW (review round 16-re4): this describe title used to read
// "dist/index.d.ts module specifiers" while the test scanned every emitted
// `.d.ts` file (N1's own fix, above) — corrected to say what it actually
// checks.
describe('published declarations: module specifiers (F3) and public surface (N3)', () => {
  it('every non-relative import, across every emitted .d.ts, is a declared dependency or peerDependency', () => {
    const specifiers = collectModuleSpecifiers(built.tanstackOutDir);
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

  const indexDts = () => readFileSync(path.join(built.tanstackOutDir, 'index.d.ts'), 'utf-8');

  it.each(TANSTACK_RUNTIME_SURFACE)('exports %s', (name) => {
    expect(indexDts(), `${name} missing from the export list`).toMatch(new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b`, 'm'));
  });

  it.each(TANSTACK_TYPE_ONLY_SURFACE)('declares %s', (name) => {
    const dts = indexDts();
    const declaredOrReExported =
      new RegExp(`\\b(?:declare\\s+(?:type|interface)|type)\\s+${name}\\b`).test(dts) ||
      new RegExp(`^export\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b`, 'm').test(dts);
    expect(declaredOrReExported, `${name} missing from the emitted declarations`).toBe(true);
  });

  it('a consumer importing every surface name from the emitted d.ts type-checks cleanly', () => {
    const consumerDir = mkdtempSync(path.join(tmpdir(), 'routing-tanstack-dist-consumer-'));
    try {
      const valueImports = TANSTACK_RUNTIME_SURFACE.join(', ');
      const typeImports = TANSTACK_TYPE_ONLY_SURFACE.map((name) => `type ${name}`).join(', ');
      // `EngineProviderProps`/`EngineProviderFromRouterProps` are generic
      // over the concrete route tree/router type a consumer's own router
      // module supplies — referencing the bare name here (with no consumer
      // router to infer one from) needs an explicit type argument, same as
      // any other generic interface would.
      const typeArgs: Partial<Record<(typeof TANSTACK_TYPE_ONLY_SURFACE)[number], string>> = {
        EngineProviderProps: '<any>',
        EngineProviderFromRouterProps: '<any>',
      };
      writeFileSync(
        path.join(consumerDir, 'consumer.ts'),
        [
          `import { ${valueImports}, ${typeImports} } from '@gears-frontx/routing-tanstack';`,
          '',
          `export const _values = { ${valueImports} };`,
          `export type _types = [${TANSTACK_TYPE_ONLY_SURFACE.map((name) => `${name}${typeArgs[name] ?? ''}`).join(', ')}];`,
          '',
        ].join('\n'),
      );
      // The tmp consumer directory sits outside the monorepo tree, so
      // TypeScript's own upward `node_modules` walk (from wherever
      // `consumer.ts` lives) never reaches `repoRoot/node_modules` — unlike
      // the build above, whose `cwd` is `packageRoot` and so resolves
      // `react`/`@tanstack/react-router`/`@tanstack/router-core` normally.
      // Pointing `paths` at those packages' own declaration entry points
      // directly sidesteps that without moving this test's temp output
      // into the tracked package tree (the residue LOW review round 16-re3
      // already closed once for this same test file).
      writeFileSync(
        path.join(consumerDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'react-jsx',
              strict: true,
              skipLibCheck: false,
              noEmit: true,
              baseUrl: consumerDir,
              paths: {
                '@gears-frontx/routing-tanstack': [path.join(built.tanstackOutDir, 'index.d.ts')],
                '@gears-frontx/routing': [path.join(built.routingOutDir, 'index.d.ts')],
                react: [path.join(repoRoot, 'node_modules/@types/react/index.d.ts')],
                'react/jsx-runtime': [path.join(repoRoot, 'node_modules/@types/react/jsx-runtime.d.ts')],
                '@tanstack/react-router': [path.join(repoRoot, 'node_modules/@tanstack/react-router/dist/esm/index.d.ts')],
                '@tanstack/router-core': [path.join(repoRoot, 'node_modules/@tanstack/router-core/dist/esm/index.d.ts')],
              },
            },
            include: ['consumer.ts'],
          },
          null,
          2,
        ),
      );
      runTsc(['-p', path.join(consumerDir, 'tsconfig.json')], consumerDir);
    } finally {
      rmSync(consumerDir, { recursive: true, force: true });
    }
  });
});
