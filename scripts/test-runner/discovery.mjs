/**
 * Project discovery for the ecosystem monorepo test runner.
 *
 * Root workspaces are discovered from package.json so `test:unit` packages
 * register automatically and this script cannot drift when new packages land.
 *
 * The host app + its nested MFEs are template territory, which lives in its
 * own repository and is not discovered here; each template runs its own
 * tests via its own package.json `test:unit` script.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultRepoRoot } from './common.mjs';

/**
 * Directory-entry shape shared with `check-test-dependency-versions.mjs` —
 * see `../fs-types.mjs` for why this lives in one place now.
 *
 * @typedef {import('../fs-types.mjs').DirEntryLike} DirEntryLike
 */

/**
 * The repo-root `scripts/` toolchain, tested through the root
 * `vitest.scripts.config.mjs` and the private `_test:unit:host` script.
 *
 * Static rather than discovered, because `scripts/` is not an npm workspace and
 * so cannot appear in `package.json#workspaces` — the mechanism every other
 * project here comes from. That is exactly how its tests went dark: the split
 * removed the host project that used to own `scripts/`, discovery had no way to
 * find a replacement, and four test files stopped running without anything
 * failing (#483).
 */
const repoScriptsProject = Object.freeze(
  /** @type {import('./common.mjs').HostProject} */ ({
    kind: 'host',
    name: 'repo-scripts',
    rootPath: 'scripts',
  }),
);

/**
 * @param {string} [repoRoot]
 * @returns {Promise<import('./common.mjs').Project[]>}
 */
export async function loadProjects(repoRoot = defaultRepoRoot) {
  /** @type {import('./common.mjs').Project[]} */
  const projects = [
    repoScriptsProject,
    ...(await discoverWorkspaceProjects({ repoRoot })),
  ];

  return projects;
}

/**
 * Discover nested MFE packages under `src/mfe_packages/*`. MFEs are not npm
 * workspaces (they have their own install boundary), so they can't come from
 * `discoverWorkspaceProjects`. Dynamic discovery keeps this runner in sync
 * when MFEs are added or removed without editing this script.
 *
 * A directory counts as an MFE project only when it contains a `package.json`
 * that declares a `test:unit` script; otherwise the runner has nothing to
 * delegate to.
 *
 * Only an absent root means "no MFE projects", and that is the ordinary case
 * here: this repository has no `src/mfe_packages` of its own. Every other
 * failure to read it — EACCES, EIO, a path that turns out to be a file — reaches
 * the caller, because swallowing it would report a clean run over a tree this
 * never managed to read. The consuming template's own `run-mfe-type-checks.ts`
 * draws the same line for its own MFE scan.
 *
 * @param {{ repoRoot?: string; readdir?: (path: string, options: { withFileTypes: true }) => Promise<DirEntryLike[]> }} [options]
 * @returns {Promise<import('./common.mjs').MfeProject[]>}
 */
export async function discoverMfeProjects({
  repoRoot = defaultRepoRoot,
  readdir: readdirFn = readdir,
} = {}) {
  const mfeRoot = path.join(repoRoot, 'src/mfe_packages');
  /** @type {DirEntryLike[]} */
  let entries;
  try {
    entries = await readdirFn(mfeRoot, { withFileTypes: true });
  } catch (err) {
    if (!isMissingDirectory(err)) {
      throw err;
    }
    return [];
  }

  /** @type {import('./common.mjs').MfeProject[]} */
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const cwd = path.join(mfeRoot, entry.name);
    const packageJsonPath = path.join(cwd, 'package.json');
    let packageJson;
    try {
      packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    } catch {
      continue;
    }

    if (!packageJson?.scripts?.['test:unit']) {
      continue;
    }

    projects.push({
      kind: 'mfe',
      name: entry.name,
      cwd,
      rootPath: `src/mfe_packages/${entry.name}`,
    });
  }

  return projects.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
}

/**
 * Whether a rejection is the "directory is not there" case, told apart from
 * every other reason a read can fail.
 *
 * The rejection arrives untyped, so the hop down to `code` is checked rather
 * than assumed; a `readdir` rejection carries it as a string.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isMissingDirectory(err) {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

/**
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<import('./common.mjs').WorkspaceProject[]>}
 */
export async function discoverWorkspaceProjects({ repoRoot = defaultRepoRoot } = {}) {
  const rootPackage = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  /** @type {string[]} */
  const workspaceEntries = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  /** @type {import('./common.mjs').WorkspaceProject[]} */
  const projects = [];

  /** Short `--project=<name>` tokens already claimed by an earlier workspace. */
  const claimedNames = new Set();

  const workspacePaths = await resolveWorkspaceEntries(workspaceEntries, { repoRoot });
  for (const workspacePath of workspacePaths) {
    const packageJson = await readWorkspacePackageJson(workspacePath, { repoRoot });
    const project = createWorkspaceProject(workspacePath, packageJson, claimedNames);
    if (!project) {
      continue;
    }

    claimedNames.add(project.name);
    projects.push(project);
  }

  return projects.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
}

/**
 * Expand each root `package.json#workspaces` entry into repo-relative paths.
 *
 * @param {string[]} workspaceEntries
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<string[]>}
 */
async function resolveWorkspaceEntries(workspaceEntries, { repoRoot = defaultRepoRoot } = {}) {
  /** @type {string[]} */
  const workspacePaths = [];
  for (const entry of workspaceEntries) {
    workspacePaths.push(...(await resolveWorkspaceEntry(entry, { repoRoot })));
  }
  return workspacePaths;
}

/**
 * Read and parse a workspace manifest, warning on real misconfiguration while
 * still skipping legitimate empty glob slots.
 *
 * @param {string} workspacePath
 * @param {{ repoRoot?: string }} [options]
 * @returns {Promise<Record<string, any> | null>}
 */
async function readWorkspacePackageJson(workspacePath, { repoRoot = defaultRepoRoot } = {}) {
  const packageJsonPath = path.join(repoRoot, workspacePath, 'package.json');
  try {
    return JSON.parse(await readFile(packageJsonPath, 'utf8'));
  } catch (err) {
    // ENOENT = no package.json at this path (a legitimate "empty glob slot"
    // — e.g. `packages/*` matched a directory without a manifest).
    // Everything else (EACCES, EISDIR, JSON syntax errors) is a real
    // misconfiguration that used to be silently swallowed and made it very
    // hard to diagnose why a workspace "disappeared" from the runner's
    // project list. Log a warning in that case so the failure is visible
    // without tearing down the rest of the scan.
    if (!(err instanceof Error) || /** @type {any} */ (err).code !== 'ENOENT') {
      const relativePath = workspacePath.split(path.sep).join('/');
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[run-monorepo-unit-tests] Skipping workspace "${relativePath}": unable to read/parse package.json (${message}).`,
      );
    }
    return null;
  }
}

/**
 * Convert a parsed workspace manifest into a runnable project entry.
 *
 * @param {string} workspacePath
 * @param {Record<string, any> | null} packageJson
 * @param {Set<string>} claimedNames
 * @returns {import('./common.mjs').WorkspaceProject | null}
 */
function createWorkspaceProject(workspacePath, packageJson, claimedNames) {
  if (!packageJson?.scripts?.['test:unit']) {
    return null;
  }

  const rootPath = workspacePath.split(path.sep).join('/');
  const projectName = resolveWorkspaceProjectName(rootPath, packageJson.name, claimedNames);
  return {
    kind: 'workspace',
    name: projectName,
    workspace: packageJson.name,
    rootPath,
    hasWatchScript: Boolean(packageJson.scripts['test:unit:watch']),
  };
}

/**
 * Pick a short `--project=<name>` selector for a workspace.
 *
 * Historically this was just `path.basename(workspacePath)`, which collides
 * when two workspace globs share a leaf directory (e.g. `packages/foo/bar`
 * and `internal/foo/bar` — both would be `bar`). The selector MUST round-trip
 * to exactly one project or `--project=<name>` is ambiguous.
 *
 * Resolution order:
 *   1. Prefer `path.basename(rootPath)` when it hasn't been claimed yet —
 *      it's the shortest, most ergonomic name.
 *   2. Fall back to the unscoped `packageJson.name` (stripping the `@scope/`
 *      prefix) when basename is taken but the package name is free.
 *   3. Fall back to the full POSIX `rootPath` as a last-resort unique key
 *      so every workspace is at least addressable, even if typing the full
 *      path is less ergonomic.
 *
 * @param {string} rootPath POSIX, repo-relative workspace path.
 * @param {unknown} packageName Raw `packageJson.name` value.
 * @param {Set<string>} claimed Names already taken by earlier workspaces.
 * @returns {string}
 */
function resolveWorkspaceProjectName(rootPath, packageName, claimed) {
  const basename = path.posix.basename(rootPath);
  if (!claimed.has(basename)) {
    return basename;
  }

  if (typeof packageName === 'string' && packageName.length > 0) {
    const unscoped = packageName.includes('/')
      ? packageName.slice(packageName.indexOf('/') + 1)
      : packageName;
    if (unscoped && !claimed.has(unscoped)) {
      return unscoped;
    }
  }

  return rootPath;
}

/**
 * Resolve a single npm `workspaces` entry (possibly a `parent/*` glob) to
 * the repo-relative workspace paths it matches. Returns POSIX-separated
 * paths regardless of host platform so comparisons against `project.rootPath`
 * stay stable on Windows.
 *
 * @param {string} entry
 * @param {{ repoRoot?: string; readdir?: (path: string, options: { withFileTypes: true }) => Promise<DirEntryLike[]> }} [options]
 * @returns {Promise<string[]>}
 */
export async function resolveWorkspaceEntry(entry, options = {}) {
  const { repoRoot = defaultRepoRoot, readdir: readdirFn = readdir } = options;

  if (entry.endsWith('/*')) {
    const parent = entry.slice(0, -2);
    const absoluteParent = path.join(repoRoot, parent);
    let children = [];
    try {
      children = await readdirFn(absoluteParent, { withFileTypes: true });
    } catch {
      return [];
    }
    return children
      .filter((child) => child.isDirectory())
      .map((child) => path.posix.join(parent.split(path.sep).join('/'), child.name));
  }

  return [entry.split(path.sep).join('/')];
}
