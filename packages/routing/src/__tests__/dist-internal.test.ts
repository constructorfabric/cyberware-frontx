import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

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
// it untouched regardless. This test runs the real build (`tsup`, not a
// bare `tsc` declaration emit — the rollup-dts bundling step is exactly
// where that chain either does or does not survive) into a throwaway
// output directory on every run, so it exercises today's `tsconfig.json` +
// `src/index.ts` combination rather than a possibly-stale committed
// `dist/`, and fails if `@internal` (or a symbol it once marked) leaks
// into the published surface again.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const tsupBin = path.join(repoRoot, 'node_modules/.bin/tsup');

let outDir: string | undefined;

afterEach(() => {
  if (outDir !== undefined) {
    rmSync(outDir, { recursive: true, force: true });
    outDir = undefined;
  }
});

function buildFreshDts(): string {
  outDir = mkdtempSync(path.join(tmpdir(), 'routing-dist-internal-'));
  try {
    execFileSync(tsupBin, ['--out-dir', outDir, '--clean'], { cwd: packageRoot, stdio: 'pipe' });
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String((error as { stdout?: Buffer | string }).stdout ?? '') : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`tsup failed: ${message}\n${stdout}`, { cause: error });
  }
  return readFileSync(path.join(outDir, 'index.d.ts'), 'utf-8');
}

describe('published dist/index.d.ts strips @internal declarations (N2)', () => {
  it('carries no @internal tag', () => {
    const dts = buildFreshDts();
    expect(dts).not.toMatch(/@internal/);
  });

  it('does not declare or export the internal test-seam types it used to leak', () => {
    const dts = buildFreshDts();
    // A loose substring check would false-fail on prose (this package's own
    // `RoutingError` doc comments mention "HistoryAdapter" by name without
    // declaring it) — what actually matters is that neither type is
    // *declared* or *exported* here.
    expect(dts).not.toMatch(/\bdeclare\s+(?:type|interface)\s+(?:AdapterLocation|HistoryAdapter)\b/);
    expect(dts).not.toMatch(/^export\s*\{[^}]*\b(?:AdapterLocation|HistoryAdapter)\b/m);
  });
});
