/**
 * Ecosystem Pin-Drift CI Guard (#493 work item 3).
 *
 * `packages/gts-plugin` pins `@gears-frontx/mfes` to an exact registry
 * version - an intra-ecosystem exact pin that drifts with a bad blame radius:
 * a version bump to `packages/mfes/package.json` that misses that pin site
 * installs two different MFE runtime copies into one tree, which is the one
 * thing a single-runtime framework cannot survive (reviewer ask on #492).
 *
 * Nothing about this check is a static list - not the package set, not the
 * file paths. Every one of those lists would be the same duplicated knowledge
 * the guard exists to prevent, and #496 (which added `packages/telemetry`
 * while a related change was in review) is exactly the kind of drift a static
 * list would have missed. So everything is discovered structurally, via
 * `ecosystem-packages.mjs`:
 *
 *  - WHICH PACKAGES are a version truth: every `packages/*` manifest.
 *  - WHICH SITES to compare: every dependency field of every `packages/*`
 *    root manifest that names an ecosystem-scope package at an exact
 *    registry version.
 *
 * Historical note: this guard used to also walk every template at the repo
 * root (a directory carrying `frontx-template.json`), since templates pinned
 * these same packages to exact registry versions (#485/#501). Templates now
 * live in their own repository with their own pin-drift coverage, so that
 * half of this guard retired with them; what remains is the
 * ecosystem-internal half, which is still a real failure mode on its own
 * (`gts-plugin` pinning `mfes`, above).
 *
 * Every failure mode is reported through the exit code with a message naming the
 * file - an unreadable manifest, a malformed one, a pin nothing can verify - so
 * a red build never reads as a broken script.
 *
 * CLI entry: `node scripts/ecosystem-pin-drift-check.mjs` (exit 0 on success).
 * Core logic is exported for unit tests in
 * `scripts/ecosystem-pin-drift-check.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  ecosystemScopeMatcher,
  pinSitesIn,
  readEcosystemPackages,
  readEcosystemTruthVersions,
  readPackageManifest,
  readRepoDefinedPackageNames,
} from './ecosystem-packages.mjs';

/**
 * @typedef {import('./ecosystem-packages.mjs').PinSite} PinSite
 * @typedef {PinSite & { actualVersion: string }} DriftedSite
 */

/**
 * Finds every exact-registry-version pin, in the monorepo's OWN `packages/*`
 * manifests, that names an ecosystem-scope package.
 *
 * Only each package's own root manifest is read, not its whole subtree: that
 * manifest is the published dependency declaration, whereas a nested
 * `package.json` under `packages/*` is a build artifact or test fixture whose
 * pins nobody installs. A directory with no manifest at all is skipped, but a
 * manifest that IS there and cannot be read or parsed fails closed - "unreadable"
 * must never be allowed to read as "no pins here".
 *
 * @param {string} rootDir monorepo root
 * @param {(name: string) => boolean} isEcosystemScopeName
 * @returns {PinSite[]}
 */
export function findEcosystemPinSites(rootDir, isEcosystemScopeName) {
  const packagesDir = path.join(rootDir, 'packages');
  if (!fs.existsSync(packagesDir)) return [];

  /** @type {PinSite[]} */
  const sites = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const filePath = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(filePath)) continue;
    const manifest = readPackageManifest(filePath);
    sites.push(...pinSitesIn(manifest, path.relative(rootDir, filePath), isEcosystemScopeName));
  }
  return sites;
}

/**
 * @param {PinSite[]} sites
 * @param {Record<string, string>} truthVersions
 * @returns {DriftedSite[]}
 */
export function findDriftedSites(sites, truthVersions) {
  return sites
    .filter((site) => {
      const actual = truthVersions[site.packageName];
      return actual !== undefined && actual !== site.pinnedVersion;
    })
    .map((site) => ({ ...site, actualVersion: truthVersions[site.packageName] }));
}

/**
 * The pins that cannot be compared at all: an ecosystem-scope name with no
 * truth entry, which the scanned tree does not define itself either.
 *
 * This is the counterpart to `findDriftedSites` and the reason it can stay as
 * simple as it is. "No truth entry" is indistinguishable from "matches" to a
 * comparison, so without this classification a name that leaves `packages/`
 * (renamed, deleted, moved out) would silently take every pin on it out of the
 * check. Names the tree defines itself are excluded because npm resolves those
 * through a workspace and no registry version exists to drift from.
 *
 * @param {PinSite[]} sites
 * @param {Record<string, string>} truthVersions
 * @param {Set<string>} locallyDefinedNames names the scanned tree itself defines
 * @returns {PinSite[]}
 */
export function findUnverifiableSites(sites, truthVersions, locallyDefinedNames) {
  return sites.filter(
    (site) => truthVersions[site.packageName] === undefined && !locallyDefinedNames.has(site.packageName),
  );
}

/**
 * @param {{ rootDir: string; log: (line: string) => void; logError: (line: string) => void }} context
 * @returns {number}
 */
function check({ rootDir, log, logError }) {
  const ecosystem = readEcosystemPackages(rootDir);
  const isEcosystemScopeName = ecosystemScopeMatcher(ecosystem.map(({ name }) => name));
  const truthVersions = readEcosystemTruthVersions(rootDir);

  // The ecosystem's own intra-ecosystem pins, checked against the truth map
  // built from the same manifests. `site.file` is already root-relative, and
  // the names this repo may resolve locally are the ones its root
  // `workspaces` declare.
  const sites = findEcosystemPinSites(rootDir, isEcosystemScopeName);
  const repoDefinedNames = readRepoDefinedPackageNames(rootDir);
  const drifted = findDriftedSites(sites, truthVersions);
  const unverifiable = findUnverifiableSites(sites, truthVersions, repoDefinedNames);

  if (drifted.length > 0) {
    logError(`[ecosystem-pin-drift-check] FAIL: ${drifted.length} pinned site(s) drifted from the ecosystem's actual version:`);
    for (const site of drifted) {
      logError(`  ${site.file} ${site.field}["${site.packageName}"]: pinned ${site.pinnedVersion}, actual ${site.actualVersion}`);
    }
    logError(
      '\nBump the pinned site(s) above to match the package(s)\' actual version, then rerun ' +
        '`npm run policy:ecosystem-pin-drift` to confirm.',
    );
  }

  if (unverifiable.length > 0) {
    logError(
      `[ecosystem-pin-drift-check] FAIL: ${unverifiable.length} pinned site(s) name an ecosystem package ` +
        'this repo does not publish, so the pin cannot be verified:',
    );
    for (const site of unverifiable) {
      logError(`  ${site.file} ${site.field}["${site.packageName}"]: pinned ${site.pinnedVersion}, no packages/* manifest declares that name`);
    }
    logError(
      '\nEither the package was renamed or removed from `packages/` and the pin(s) above still name ' +
        'the old name, or the name is a typo. A pin nobody can compare is not a pin that passes: fix ' +
        'the name, or drop the pin if the dependency is gone.',
    );
  }

  if (drifted.length > 0 || unverifiable.length > 0) return 1;

  log(
    `Ecosystem pin-drift check passed: every intra-ecosystem pinned site matches the ecosystem's actual versions ` +
      `(${Object.entries(truthVersions)
        .map(([name, version]) => `${name}@${version}`)
        .join(', ')}).`,
  );
  return 0;
}

/**
 * CI entry point. Wired into `npm run policy:ecosystem-pin-drift` and
 * `.github/workflows/main.yml`.
 *
 * Every fail-closed throw raised while reading a manifest is caught here and
 * turned into an exit code with the message that names the offending file: a
 * guard whose own crash looks different from its own failure teaches developers
 * to read a red build as "the script is broken".
 *
 * @param {{
 *   rootDir?: string;
 *   log?: (line: string) => void;
 *   logError?: (line: string) => void;
 * }} [options]
 * @returns {number} 0 on success, 1 on failure.
 */
export function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  try {
    return check({ rootDir, log, logError });
  } catch (error) {
    logError(`[ecosystem-pin-drift-check] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  // `process.exitCode` rather than `process.exit()`: the latter can truncate a
  // still-flushing stdout/stderr write, which for a guard means losing the very
  // lines that say what failed.
  process.exitCode = runCli();
}
