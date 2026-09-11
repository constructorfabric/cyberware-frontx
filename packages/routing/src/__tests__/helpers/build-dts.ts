// Shared `tsup` build helper for `dist-internal.test.ts` and
// `package.test.ts` (LOW, review round 16-re4): both need the *real*
// published `dist/index.d.ts` — not a bare `tsc` declaration emit, since
// `tsup`'s rollup-dts bundling step is exactly where a re-export chain's
// `@internal` handling (N2/N3, review rounds 16-re3/16-re4) either does or
// does not survive — built once into a throwaway directory. Factoring the
// build itself out here means both test files exercise the identical build
// rather than two independently maintained copies of the same `execFileSync`
// call that could drift apart.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const tsupBin = path.join(repoRoot, 'node_modules/.bin/tsup');

export interface BuiltDts {
  /** The emitted `index.d.ts` text. */
  dts: string;
  /** The throwaway directory `tsup` built into — also holds `index.d.cts`,
   * `index.js`, etc., so a consumer type-check can point its own `paths`
   * mapping at `index.d.ts` inside it without a second build. */
  outDir: string;
}

/** Runs the real `tsup` build into a fresh temp directory and returns its
 * emitted `index.d.ts` plus the directory itself. The caller owns cleanup
 * via `cleanupBuiltDts` — deferred to the caller (rather than done here)
 * because a consumer type-check needs the directory to still exist after
 * this call returns. */
export function buildFreshDts(): BuiltDts {
  const outDir = mkdtempSync(path.join(tmpdir(), 'routing-dist-internal-'));
  try {
    execFileSync(tsupBin, ['--out-dir', outDir, '--clean'], { cwd: packageRoot, stdio: 'pipe' });
  } catch (error) {
    const stdout =
      error !== null && typeof error === 'object' && 'stdout' in error
        ? String((error as { stdout?: Buffer | string }).stdout ?? '')
        : '';
    const message = error instanceof Error ? error.message : String(error);
    rmSync(outDir, { recursive: true, force: true });
    throw new Error(`tsup failed: ${message}\n${stdout}`, { cause: error });
  }
  return { dts: readFileSync(path.join(outDir, 'index.d.ts'), 'utf-8'), outDir };
}

export function cleanupBuiltDts(outDir: string): void {
  rmSync(outDir, { recursive: true, force: true });
}
