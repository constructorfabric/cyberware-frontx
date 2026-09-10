/**
 * Shared test tooling version guard for the monorepo.
 *
 * Walks every `package.json` under the repo and asserts that declared versions of
 * shared Vitest/Testing Library/jsdom-related dependencies match the root
 * `devDependencies` pin (exact string equality). Prevents workspace drift where a
 * nested package would resolve a different major than CI and the host app.
 *
 * **Relationship to lint:** This script is the implementation of `npm run lint:deps`.
 * `npm run lint` runs `lint:deps` first, then builds eslint-plugin-local, then ESLint.
 * Failures here surface as dependency-sync errors before any ESLint pass.
 *
 * CLI entry: `node scripts/check-test-dependency-versions.mjs` (exit 0 on success).
 * Core logic is exported for unit tests in `scripts/check-test-dependency-versions.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Shared test dependencies guarded by this script. Every name here MUST be
// pinned in the root `devDependencies` (the `overrides` key stays optional).
// Keep the list in lockstep with actual usage across workspaces — extra
// entries make `lint:deps` fail on a clean repo, missing entries let a
// drifted workspace pin slip through. If you add a new shared test dep to
// any package.json, add it here too (or add it only to the package that
// owns it if it's not genuinely shared).
export const sharedTestDependencies = [
  '@vitejs/plugin-react',
  '@testing-library/react',
  '@vitest/coverage-v8',
  'jsdom',
  'vitest',
];

// Dependency groups (besides root `devDependencies` / `overrides`) that are
// expected to stay pinned to the root devDep version when they reference a
// shared test dependency. `peerDependencies` is included so packages like
// `@gears-frontx/framework` — which pins `vitest` as a peer — cannot drift
// away from the root monorepo pin without this guard catching it.
/** @typedef {'devDependencies' | 'peerDependencies'} DependencyGroupName */

/** @type {DependencyGroupName[]} */
export const checkedDependencyGroups = ['devDependencies', 'peerDependencies'];

/**
 * Narrow shape of a `package.json` this script actually reads — just the
 * fields the version guard compares. Kept intentionally narrower than "every
 * possible package.json field" so indexing `devDependencies`/`overrides`
 * stays a plain typed lookup instead of an `unknown` that every call site
 * would have to re-narrow.
 *
 * @typedef {{
 *   name?: string;
 *   private?: boolean;
 *   devDependencies?: Record<string, string>;
 *   peerDependencies?: Record<string, string>;
 *   overrides?: Record<string, string | Record<string, string>>;
 * }} PackageJson
 */

/**
 * Structural subset of `node:fs` that the recursive walker uses. Narrower
 * than `Pick<typeof fs, ...>` — the real `fs.realpathSync` carries a `.native`
 * variant and multiple encoding overloads that a test fake has no reason to
 * implement; this shape is exactly the three single-arg calls made below.
 *
 * @typedef {import('./fs-types.mjs').DirEntryLike} DirEntryLike
 *
 * @typedef {{
 *   existsSync: (path: string) => boolean;
 *   realpathSync: (path: string) => string;
 *   readdirSync: (path: string, options: { withFileTypes: true }) => DirEntryLike[];
 * }} FileSystemLike
 */

// Directories to skip during recursive discovery. Walking every `package.json`
// under the repo (instead of hardcoding a list of roots) keeps this script in
// sync whenever new workspaces, MFEs, or scaffolding templates land — at the
// cost of needing a skip-list for noise directories. `node_modules` must be
// skipped to avoid picking up transitive dependency manifests.
export const skipDirectories = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.nyc_output',
  '.turbo',
  '.cache',
  '.next',
  // Self-contained templates (issue #470 split the formerly-combined
  // template directory into a shell + mfe pair; Phase 11 template-move):
  // each manages its own test tooling versions independently now that
  // neither is a root workspace.
  'template-shell',
  'template-mfe',
  // Bundled scaffold content shipped by the CLI (never installed/run inside
  // this repo) — same "templates/ is not a live workspace" convention already
  // used by eslint.config.js's `packages/**/templates/**` ignore.
  'templates',
  // Disposable Claude Code agent worktrees (`.claude/worktrees/*`) are full
  // repo checkouts — walking into them would double-count every workspace's
  // package.json against a stale copy of this same dependency policy.
  '.claude',
]);

/**
 * Resolve `candidatePath` under `rootDir` and ensure it cannot escape the repo
 * root (Codacy: path construction must stay within a trusted boundary).
 *
 * @param {string} rootDir
 * @param {string} candidatePath
 * @returns {string}
 */
function resolvePackageJsonPathWithinRoot(rootDir, candidatePath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.normalize(path.resolve(candidatePath));
  const relativeToRoot = path.relative(resolvedRoot, resolvedPath);
  const isInsideRoot =
    relativeToRoot === '' ||
    (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot));
  if (!isInsideRoot) {
    throw new Error(
      `Refusing to read package.json outside repo root (${resolvedRoot}): ${candidatePath}`,
    );
  }
  return resolvedPath;
}

/**
 * Root `package.json` at `rootDir/package.json` using `path.resolve` only (no
 * `path.join` with a dynamic first segment) so static analysis does not flag
 * unchecked path composition.
 *
 * @param {string} rootDir
 * @returns {string}
 */
function resolveRootPackageJsonPath(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.normalize(path.resolve(resolvedRoot, 'package.json'));
  const relativeToRoot = path.relative(resolvedRoot, resolvedPath);
  if (relativeToRoot !== 'package.json') {
    throw new Error(
      `Refusing to resolve root package.json outside repo root (${resolvedRoot})`,
    );
  }
  return resolvedPath;
}

/**
 * `readdir` entry names must be single path segments (Codacy: avoid joining
 * untrusted multi-segment names onto a directory walk cursor).
 *
 * @param {string} name
 * @returns {boolean}
 */
function isSafePathSegment(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return false;
  }
  if (name === '.' || name === '..') {
    return false;
  }
  if (
    name.includes(path.sep) ||
    name.includes(path.posix.sep) ||
    name.includes(path.win32.sep) ||
    name.includes('\0')
  ) {
    return false;
  }
  return true;
}

/**
 * @param {string} packageJsonPath
 * @param {string} rootDir
 * @returns {PackageJson}
 */
function readPackageJsonSync(packageJsonPath, rootDir) {
  const safePath = resolvePackageJsonPathWithinRoot(rootDir, packageJsonPath);
  // safePath is confined to repo root by resolvePackageJsonPathWithinRoot (see above).
  return JSON.parse(fs.readFileSync(safePath, 'utf8'));
}

/**
 * Compare every declared shared test dependency against the root monorepo pin.
 * Exporting the pure scan lets Vitest cover the mismatch logic directly
 * without shelling out to a Node subprocess.
 *
 * @param {PackageJson} rootPackage
 * @param {string[]} packageJsonPaths
 * @param {{
 *   readPackageJson?: (packageJsonPath: string) => PackageJson;
 *   rootDir?: string;
 *   rootPackagePath?: string;
 * }} [options]
 * @returns {string[]}
 */
export function checkMismatches(rootPackage, packageJsonPaths, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const rootPackagePath =
    options.rootPackagePath === undefined
      ? resolveRootPackageJsonPath(rootDir)
      : resolvePackageJsonPathWithinRoot(rootDir, options.rootPackagePath);
  const readPackageJson =
    options.readPackageJson ??
    ((packageJsonPath) => readPackageJsonSync(packageJsonPath, rootDir));

  const rootVersions = Object.fromEntries(
    sharedTestDependencies.map((dependencyName) => [
      dependencyName,
      rootPackage.devDependencies?.[dependencyName],
    ])
  );

  return [
    ...collectRootMismatches(rootPackage, rootVersions),
    ...collectWorkspaceMismatches(packageJsonPaths, {
      readPackageJson,
      rootDir,
      rootPackagePath,
      rootVersions,
    }),
  ];
}

/**
 * @param {{ rootDir?: string }} [options]
 * @returns {number}
 */
export function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const rootPackagePath = resolveRootPackageJsonPath(rootDir);
  const rootPackage = readPackageJsonSync(rootPackagePath, rootDir);
  const packageJsonPaths = collectPackageJsonPaths(rootDir);
  const mismatches = checkMismatches(rootPackage, packageJsonPaths, {
    rootDir,
    rootPackagePath,
  });

  if (mismatches.length > 0) {
    console.error('Shared test dependency versions are out of sync:\n');
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch}`);
    }
    return 1;
  }

  console.log('Shared test dependency versions are in sync.');
  return 0;
}

/**
 * npm `overrides` entries are usually a bare version string or a nested
 * object with a `.` sentinel for the top-level pin, but a hand-edited
 * package.json can put anything there — the param type stays a JSON-value
 * union (not `unknown`) so every branch below is a plain `typeof` narrowing.
 *
 * @param {string | number | boolean | null | undefined | Record<string, string>} overrideValue
 * @returns {string | undefined}
 */
export function normalizeOverrideVersion(overrideValue) {
  if (typeof overrideValue === 'string') {
    return overrideValue;
  }

  // Numbers/booleans/null/undefined have no `.` sentinel — same "no pin"
  // result as a per-importer-only object, just reached via a typeof guard
  // instead of blind optional chaining (which TS can't narrow through a
  // JSON-value union without a runtime check first).
  if (overrideValue && typeof overrideValue === 'object') {
    return overrideValue['.'];
  }

  return undefined;
}

/**
 * @param {PackageJson} rootPackage
 * @param {Record<string, string | undefined>} rootVersions
 * @returns {string[]}
 */
function collectRootMismatches(rootPackage, rootVersions) {
  /** @type {string[]} */
  const mismatches = [];

  for (const dependencyName of sharedTestDependencies) {
    const overrideVersion = normalizeOverrideVersion(
      rootPackage.overrides?.[dependencyName]
    );
    const devDependencyVersion = rootVersions[dependencyName];

    if (!devDependencyVersion) {
      mismatches.push(
        `root package.json is missing devDependencies.${dependencyName}`
      );
      continue;
    }

    if (overrideVersion === undefined || overrideVersion === devDependencyVersion) {
      continue;
    }

    mismatches.push(
      `root package.json mismatch for ${dependencyName}: overrides=${overrideVersion} devDependencies=${devDependencyVersion}`
    );
  }

  return mismatches;
}

/**
 * @param {string[]} packageJsonPaths
 * @param {{
 *   readPackageJson: (packageJsonPath: string) => PackageJson;
 *   rootDir: string;
 *   rootPackagePath: string;
 *   rootVersions: Record<string, string | undefined>;
 * }} options
 * @returns {string[]}
 */
function collectWorkspaceMismatches(packageJsonPaths, options) {
  /** @type {string[]} */
  const mismatches = [];

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = options.readPackageJson(packageJsonPath);
    const relativePath = path.relative(options.rootDir, packageJsonPath);
    const isRootPackage = packageJsonPath === options.rootPackagePath;

    for (const dependencyName of sharedTestDependencies) {
      const expectedVersion = options.rootVersions[dependencyName];

      for (const groupName of checkedDependencyGroups) {
        const declaredVersion = getDeclaredDependencyVersion({
          dependencyName,
          groupName,
          isRootPackage,
          packageJson,
        });

        if (!declaredVersion || declaredVersion === expectedVersion) {
          continue;
        }

        mismatches.push(
          `${relativePath} has ${groupName}.${dependencyName}=${declaredVersion}, expected ${expectedVersion}`
        );
      }
    }
  }

  return mismatches;
}

/**
 * @param {{
 *   dependencyName: string;
 *   groupName: DependencyGroupName;
 *   isRootPackage: boolean;
 *   packageJson: PackageJson;
 * }} options
 * @returns {string | undefined}
 */
function getDeclaredDependencyVersion(options) {
  // The root package.json's devDependencies is the source of truth and is
  // already compared against `overrides` above; skip comparing it to
  // itself to avoid a spurious mismatch.
  if (options.isRootPackage && options.groupName === 'devDependencies') {
    return undefined;
  }

  const declaredVersion = options.packageJson[options.groupName]?.[options.dependencyName];
  if (!declaredVersion) {
    return undefined;
  }

  // Exact-string equality is INTENTIONAL, not a bug. This check exists
  // precisely to prevent a workspace from declaring `^4.1.4` against a
  // root pin of `4.1.4` (or any other semver-equivalent range). Semver
  // compare would accept that drift — which is the failure mode this
  // script was written to catch. If a shared test dep needs to float in
  // one package, add it to an explicit allow-list here rather than
  // relaxing the comparison globally.
  return declaredVersion;
}

/**
 * Hard cap on recursion depth when walking the repo for package manifests.
 * The deepest real path in this monorepo is ~7 directories under the root
 * (e.g. `packages/cli/template-sources/project/.../package.json`); 20 is a
 * generous ceiling that still stops a pathological tree from blowing the
 * stack or running for minutes on a broken symlink farm.
 */
const maxWalkDepth = 20;

/**
 * Recursively discover every `package.json` under `directoryPath`, skipping
 * noise directories (`node_modules`, build output, VCS metadata, etc.) and
 * guarding against symlink cycles via a realpath-dedupe set + bounded depth.
 * A self-referential symlink under the repo root would otherwise hang the
 * walker indefinitely. Enumerating paths with the walk keeps the scanner
 * future-proof without per-directory maintenance.
 *
 * @param {string} directoryPath
 * @param {{
 *   fileSystem?: FileSystemLike;
 *   warn?: (message: string) => void;
 * }} [options]
 * @returns {string[]}
 */
export function collectPackageJsonPaths(directoryPath, options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const warn = options.warn ?? console.warn;

  if (!fileSystem.existsSync(directoryPath)) {
    return [];
  }

  const rootResolved = path.resolve(directoryPath);

  /** @type {string[]} */
  const results = [];
  /** Canonical (realpath-resolved) directories already visited. */
  const visited = new Set();

  /**
   * @param {string} current
   * @param {number} depth
   */
  const walk = (current, depth) => {
    if (depth > maxWalkDepth) {
      return;
    }

    let canonical;
    try {
      canonical = fileSystem.realpathSync(current);
    } catch (error) {
      warnWalkerError('realpathSync', current, error, warn);
      return;
    }
    if (visited.has(canonical)) {
      return;
    }
    visited.add(canonical);

    let rootManifest;
    try {
      rootManifest = resolvePackageJsonPathWithinRoot(
        rootResolved,
        path.resolve(current, 'package.json'),
      );
    } catch {
      return;
    }
    if (fileSystem.existsSync(rootManifest)) {
      results.push(rootManifest);
    }

    /** @type {DirEntryLike[]} */
    let entries;
    try {
      entries = fileSystem.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      warnWalkerError('readdirSync', current, error, warn);
      return;
    }

    for (const entry of entries) {
      // Follow directory-like entries (including symlinks that point at a
      // directory — the realpath dedupe above still prevents cycles). We
      // can't rely on `entry.isDirectory()` alone because it returns `false`
      // for symlinks whose target happens to be a directory.
      const isDirLike = entry.isDirectory() || entry.isSymbolicLink();
      if (!isDirLike) continue;
      if (skipDirectories.has(entry.name)) continue;
      if (!isSafePathSegment(entry.name)) continue;
      let nextPath;
      try {
        nextPath = resolvePackageJsonPathWithinRoot(
          rootResolved,
          path.resolve(current, entry.name),
        );
      } catch {
        continue;
      }
      walk(nextPath, depth + 1);
    }
  };

  walk(rootResolved, 0);
  return results;
}

/**
 * @param {'realpathSync' | 'readdirSync'} operation
 * @param {string} targetPath
 * @param {unknown} error
 * @param {(message: string) => void} warn
 */
function warnWalkerError(operation, targetPath, error, warn) {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const detail = message ? ` (${message})` : '';
  warn(
    `[check-test-dependency-versions] Skipping ${targetPath}: ${operation} failed${detail}.`,
  );
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  process.exit(runCli());
}
