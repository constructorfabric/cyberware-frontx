import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTING_EXCLUDED_BUILDING_BLOCKS, ROUTING_RUNTIME_SURFACE, ROUTING_TYPE_ONLY_SURFACE } from './helpers.js';
import { buildFreshDts, cleanupBuiltDts } from './helpers/build-dts.js';
import { declaresRuntimeExport, declaresType } from './helpers/surface-check.js';

// N2 (review round 16-re3): `stripInternal` (`../../tsconfig.json`, the same
// config `tsup` reads to build this package's own published declarations)
// is what is supposed to keep an `@internal`-tagged export — `HistoryAdapter`
// and `AdapterLocation` (`./history/adapter.ts`) were the concrete case —
// out of `dist/index.d.ts`. It was silently not in effect for a full
// review round (16-re/16-re2): the previous fix only added the tag, never
// verified the flag actually stripped it, and a follow-up fix that enabled
// the flag alone was not enough either — a multi-file re-export chain
// carries no `@internal` tag of its own at any hop, so `stripInternal`
// (which only strips a declaration where the tag is itself written) left
// it untouched regardless.
//
// N3 (review round 16-re4): the fix above regressed the other direction —
// `resolveNavigationHistory`'s own leading JSDoc carried an `@internal`-
// tagged `@param`, and TypeScript's `stripInternal` tests a declaration's
// *whole* leading comment range, so it silently dropped the entire function
// (the package's sole public construction path) from `dist/index.d.ts`
// while the runtime `dist/index.js` still exported it — invisible to N2's
// own absence-only assertions below. `HistoryAdapter`/`AdapterLocation` are
// now public types instead (they sit in that function's own signature), so
// this file also asserts their *presence*, and runs a real consumer
// type-check against the emitted declarations so a name TypeScript cannot
// resolve fails loudly here instead of at a real consumer's own build.
//
// This test runs the real build (`tsup`, not a bare `tsc` declaration emit —
// the rollup-dts bundling step is exactly where a re-export chain either
// does or does not survive) into a throwaway output directory once for the
// whole file (LOW, review round 16-re4 — it used to rebuild per `it`), so it
// exercises today's `tsconfig.json` + `src/index.ts` combination rather than
// a possibly-stale committed `dist/`.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const tscBin = path.join(repoRoot, 'node_modules/.bin/tsc');

let dts: string;
let outDir: string;

beforeAll(() => {
  const built = buildFreshDts();
  dts = built.dts;
  outDir = built.outDir;
});

afterAll(() => {
  cleanupBuiltDts(outDir);
});

describe('published dist/index.d.ts strips @internal declarations (N2)', () => {
  it('carries no @internal tag', () => {
    expect(dts).not.toMatch(/@internal/);
  });

  it('does not declare or export the internal construction building blocks', () => {
    for (const name of ROUTING_EXCLUDED_BUILDING_BLOCKS) {
      expect(dts, `unexpected declaration of ${name}`).not.toMatch(
        new RegExp(`\\bdeclare\\s+function\\s+${name}\\b`),
      );
      expect(dts, `unexpected export of ${name}`).not.toMatch(new RegExp(`^export\\s*\\{[^}]*\\b${name}\\b`, 'm'));
    }
  });
});

describe('published dist/index.d.ts declares the full DESIGN §3.3 public surface (N3)', () => {
  it.each(ROUTING_RUNTIME_SURFACE)('exports %s', (name) => {
    expect(declaresRuntimeExport(dts, name), `${name} missing from the export list`).toBe(true);
  });

  it.each(ROUTING_TYPE_ONLY_SURFACE)('declares %s', (name) => {
    expect(declaresType(dts, name), `${name} missing from the emitted declarations`).toBe(true);
  });

  it('a consumer importing every surface name from the emitted d.ts type-checks cleanly', () => {
    const consumerDir = mkdtempSync(path.join(tmpdir(), 'routing-dist-consumer-'));
    try {
      const valueImports = ROUTING_RUNTIME_SURFACE.join(', ');
      const typeImports = ROUTING_TYPE_ONLY_SURFACE.map((name) => `type ${name}`).join(', ');
      writeFileSync(
        path.join(consumerDir, 'consumer.ts'),
        [
          `import { ${valueImports}, ${typeImports} } from '@gears-frontx/routing';`,
          '',
          `export const _values = { ${valueImports} };`,
          `export type _types = [${ROUTING_TYPE_ONLY_SURFACE.join(', ')}];`,
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(consumerDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              strict: true,
              skipLibCheck: false,
              noEmit: true,
              baseUrl: consumerDir,
              paths: { '@gears-frontx/routing': [path.join(outDir, 'index.d.ts')] },
            },
            include: ['consumer.ts'],
          },
          null,
          2,
        ),
      );
      execFileSync(tscBin, ['-p', path.join(consumerDir, 'tsconfig.json')], { cwd: consumerDir, stdio: 'pipe' });
    } catch (error) {
      const stdout =
        error !== null && typeof error === 'object' && 'stdout' in error
          ? String((error as { stdout?: Buffer | string }).stdout ?? '')
          : '';
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`consumer type-check failed: ${message}\n${stdout}`, { cause: error });
    } finally {
      rmSync(consumerDir, { recursive: true, force: true });
    }
  });
});
