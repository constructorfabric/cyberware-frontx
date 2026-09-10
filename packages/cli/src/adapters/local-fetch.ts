// TEST-ONLY — this file carries NO `@cpt` marker and traces to NO FEATURE
// instruction. It is NOT product behavior: it introduces no new source-spec
// host or grammar. The `FetchFn` seam (`packages/cli/src/resolver/types.ts`)
// widened to `(url: string) => Promise<string | FetchResult>` so an adapter
// CAN report a pin (`inst-resolve-pin`); this adapter still returns a bare
// `Promise<string>` — it has no pin to report, a `path:` origin's own
// resolution never even reaches a `FetchFn` — which remains a valid,
// narrower realization of that seam.
//
// It realizes that EXISTING seam with a local-directory adapter so
// `frontx install` + `frontx seed` can assemble the on-disk
// `template-shell/` OFFLINE (no network / no GitHub publish) for e2e
// exercise of the real materialize path. It walks a local directory and
// emits the exact bundle envelope `FsContentStore`
// (`packages/cli/src/adapters/fs-content-store.ts`) already materializes —
// `{ "$frontxTemplateFiles": { <relative path>: <file text>, ... } }` — the
// same envelope the real GitHub adapter (`github-fetch.ts`) produces. The
// `url` argument the seam passes is ignored: the local adapter's whole point
// is to serve fixed on-disk content regardless of the fetch address the
// pure-logic resolver built from the parsed source-spec.
import fs from 'node:fs';
import path from 'node:path';
import { BUNDLE_MARKER } from '../bundle/envelope';

/** Directory names never included in the local bundle: build and dependency
 * artifacts, plus the agent session-state directories (`.omc/`, `.omo/`) that
 * can sit inside a template source tree during local development. The real
 * template-shell `.gitignore` excludes all of them too — none is declared
 * template content, and bundling one would seed a developer's repository with
 * another session's scratch state. */
const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-lib',
  'dist-ssr',
  '.git',
  'coverage',
  '.cache',
  '.vite',
  '.mf',
  '.__mf__temp',
  '.omc',
  '.omo',
]);

export interface LocalFetchOptions {
  /** Directory names to skip while walking; defaults to build/dependency artifact dirs. */
  excludedDirs?: Set<string>;
}

/**
 * TEST-ONLY: builds a `FetchFn` that ignores its `url` argument and instead
 * reads `localDir` from disk, returning the `$frontxTemplateFiles` bundle
 * envelope for every file found (skipping excluded directories). Read
 * failures reject the returned promise, matching the real `FetchFn`
 * contract's error path (`resolveToInventory`'s `inst-resolve-fetch-fail`).
 */
// Declared return type is narrower than `FetchFn` itself (a plain
// `Promise<string>` producer rather than `Promise<string | FetchResult>`):
// this adapter never has a pin to report, and a `string`-returning function
// is still assignable everywhere a `FetchFn` is expected (return-type
// covariance), so every call site that consumes this fake's result directly
// as a string — this is a TEST-ONLY adapter used that way throughout its own
// test suite — keeps compiling without a `typeof` narrowing it has no reason
// to perform.
export function createLocalFetchFn(
  localDir: string,
  options: LocalFetchOptions = {},
): (url: string) => Promise<string> {
  const excludedDirs = options.excludedDirs ?? DEFAULT_EXCLUDED_DIRS;

  return async function localFetch(_url: string): Promise<string> {
    if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
      throw new Error(`Local fetch source directory does not exist or is not a directory: "${localDir}"`);
    }
    const files = walkDirectory(localDir, excludedDirs);
    const bundle: Record<string, string> = {};
    for (const relativePath of files.sort()) {
      bundle[relativePath] = fs.readFileSync(path.join(localDir, relativePath), 'utf-8');
    }
    return JSON.stringify({ [BUNDLE_MARKER]: bundle });
  };
}

function walkDirectory(root: string, excludedDirs: Set<string>, relativeDir = ''): string[] {
  const absoluteDir = path.join(root, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue;
    // POSIX separator, per the envelope's key contract (bundle/envelope.ts):
    // `path.join` would emit `\` on Windows, and a subtree-addressed install of
    // a local template would fail there as `empty-subtree`. The reads below
    // accept `/` on every platform.
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...walkDirectory(root, excludedDirs, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}
