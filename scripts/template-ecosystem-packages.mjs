/**
 * What this repo's FrontX ecosystem IS, and which of its packages a template
 * pins - both DERIVED from manifests on disk, never declared.
 *
 * The predecessor of this module declared them: `['api', 'mfes', 'gts-plugin']`,
 * one constant shared by the pin-drift CI guard and the dev-link script so the
 * two could not disagree. Sharing was right; the array was the bug. #496 added
 * `packages/telemetry` while #493 was in review, and nothing in either tool
 * noticed: a template pinning `@gears-frontx/telemetry` at a stale version was
 * silently unchecked by the guard and silently left unlinked by the dev loop. A
 * list a human must remember to edit is exactly the duplicated knowledge these
 * tools exist to prevent, so there is no package array here at all.
 *
 * ## The ecosystem truth map
 *
 * Every `packages/*` manifest contributes `name -> version`. Not a curated
 * subset: `cli` and `cyber-pilot-kit-frontx` are never installed by a seeded
 * project, but including them costs nothing (no template pins them) and makes a
 * pin on them verifiable rather than unverifiable. A `packages/*` directory with
 * NO manifest is skipped - a stray directory or a cleaned build output is not a
 * package. A manifest that IS there but cannot be read, cannot be parsed, or
 * declares no `name`/`version` FAILS CLOSED naming the file: an unusable
 * manifest must never read as "this package has no version to compare against",
 * which is indistinguishable from "none of its pin sites drifted".
 *
 * `packages/*` is not the whole truth, though (#501): a template can pin
 * ANOTHER template's own identity or one of that template's workspace members
 * - `template-mfe` pins `@gears-frontx/frontx-template-shell` and every one of
 * `template-shell/packages/*` (react, auth, framework, i18n, state) to exact
 * versions, and none of those names live under this repo's own `packages/*`.
 * `readTemplateEcosystemPackages` asks each template the same question
 * `packages/*` already answers - what do you publish, and at what version -
 * and `readEcosystemTruthVersions` folds the answer in on top. Its own
 * docblock covers the scope gate and the fail-closed rule on a missing
 * version; `packages/*` is folded in first and never overwritten by a
 * template's contribution of the same name (see `readEcosystemTruthVersions`
 * for why that tie-break is the right one).
 *
 * ## A pin on a name the truth map does not have
 *
 * FAILS LOUDLY, naming the site - a pin this repo cannot verify is not a pin
 * this repo may assume correct. Deleting `packages/api/package.json` is what
 * makes that rule load-bearing: `@gears-frontx/api` drops out of the truth map,
 * and without this rule every pin on it would quietly stop being compared
 * (`findDriftedSites` cannot distinguish "no truth entry" from "matches"). With
 * it, the missing manifest surfaces at the pin sites that depend on it.
 *
 * The remaining exception is a name the scanned tree DEFINES itself, which npm
 * resolves locally through a workspace whatever range it carries, so no
 * registry version exists for it to drift from. That exception is not a
 * courtesy: `template-shell` is a workspace root (`workspaces: ["packages/*",
 * ...]`) whose members are `@gears-frontx/auth`, `@gears-frontx/state` and
 * friends - names in the ecosystem's own npm scope that this repo's `packages/`
 * deliberately does not publish. The monorepo's own manifests get the same
 * treatment against the names its root `workspaces` declare, which is why
 * `internal/*` (`@gears-frontx/eslint-config`, `@gears-frontx/depcruise-config`)
 * needs no special case despite being outside the truth map. In practice this
 * exception now mostly matters for a template pinning its OWN workspace
 * member (`template-shell` pinning its own `@gears-frontx/auth`, say): the
 * truth map above already carries that name at that template's real version,
 * so the exception and the truth map agree; it stays load-bearing for a name
 * defined in a tree the truth map has no reason to walk (an `internal/*`
 * workspace, for one).
 *
 * The npm scope itself is derived from the truth map's own names, so not even
 * the string `@gears-frontx` is written down here.
 *
 * Consumers: `template-pin-drift-check.mjs` (compares every pin site against
 * the truth map); `link-template-ecosystem.mjs` (repoints exactly the
 * `packages/*` directories the template pins at their local builds - template
 * contributions never enter that linker, since a template's own workspace
 * member already resolves locally with nothing published to shadow it);
 * `version-bump-on-change-check.mjs` (reuses `readTemplateEcosystemPackages`
 * directly, on top of the same `packages/*` walk, to enumerate the package
 * ROOTS its CI gate governs - narrowed further there to the non-`private`
 * ones, since a template's own scope-qualified fixture apps are pinned
 * consumers rather than publishable sources); and the two install-time pin
 * rewriters, `pin-template-ecosystem-to-local.mjs` and
 * `pin-unpublished-ecosystem-to-local-pack.mjs`, which substitute a local
 * directory or a local `npm pack` tarball for a pin the registry cannot serve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { findTemplateDirs } from './template-discovery.mjs';

/**
 * Mirrors `DEPENDENCY_FIELDS` (`packages/cli/src/manifest/validate-content-
 * self-containment.ts`) - kept as a local literal, not an import, so no
 * repo-script depends on `@gears-frontx/cli` being built (unlike
 * `validate-templates.mjs`, which already needs the built CLI for
 * `validateCommand` and pays that cost deliberately). Kept honest by the
 * sync-guard test in `template-ecosystem-packages.test.mjs` rather than by
 * hope (#492 review finding 2's "unguarded duplicated literal" class).
 */
export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * @typedef {{ dir: string; name: string; version: string }} EcosystemPackage
 * @typedef {{ file: string; field: string; packageName: string; pinnedVersion: string }} PinSite
 */

/**
 * Reads and parses one `package.json`. FAILS CLOSED on every way the operation
 * can fail - an unreadable file, unparseable JSON, a non-object body - each
 * aborting with a message NAMING the file rather than escaping as node's raw
 * `ENOENT`/`SyntaxError`, which names neither the file's role nor the tool that
 * wanted it (so a red build reads as a broken script instead of a broken
 * manifest).
 *
 * @param {string} packageJsonPath
 * @returns {Record<string, unknown>}
 */
export function readPackageManifest(packageJsonPath) {
  /** @type {string} */
  let raw;
  try {
    raw = fs.readFileSync(packageJsonPath, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${packageJsonPath} (${describeError(error)}) - no pin site it declares or defines can be checked.`);
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `cannot parse ${packageJsonPath} as JSON (${describeError(error)}) - no pin site it declares or defines can be checked.`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${packageJsonPath} is not a JSON object - no pin site it declares or defines can be checked.`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every package `packages/*` publishes, in directory order. See the module
 * docblock for why the set is every directory rather than a governed subset,
 * and why a missing manifest is skipped while an unusable one is fatal.
 *
 * @param {string} rootDir monorepo root
 * @returns {EcosystemPackage[]}
 */
export function readEcosystemPackages(rootDir) {
  const packagesDir = path.join(rootDir, 'packages');
  if (!fs.existsSync(packagesDir)) return [];

  /** @type {EcosystemPackage[]} */
  const packages = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const manifestPath = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = readPackageManifest(manifestPath);
    const name = manifest['name'];
    const version = manifest['version'];
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(`${manifestPath} has no valid "name" - the ecosystem truth map cannot be built.`);
    }
    if (typeof version !== 'string' || version.trim() === '') {
      throw new Error(`${manifestPath} has no valid "version" - the ecosystem truth map cannot be built.`);
    }
    packages.push({ dir: entry.name, name, version });
  }
  return packages;
}

/**
 * The truth a pinned site is compared against: package name -> current version.
 *
 * `packages/*` is not the whole truth: a template can pin another template's
 * own identity or one of that template's workspace members (`template-mfe`
 * pinning `@gears-frontx/frontx-template-shell` and `template-shell/packages/*`
 * - #501), and neither lives under this repo's `packages/*`. Those
 * contributions are folded in on top, from `readTemplateEcosystemPackages`.
 *
 * `packages/*` is folded in FIRST and never overwritten by a template
 * contribution of the same name. Verified today: no `packages/*` directory
 * shares a name with any template or template workspace member (see this
 * module's docblock). If that ever changes, `packages/*` is this repo's actual
 * publish source - the manifest a real `npm install` resolves - so it must win
 * over a template's copy of the same name rather than being silently
 * overwritten by it, which is what `if (!(name in truth))` below guarantees.
 *
 * @param {string} rootDir monorepo root
 * @returns {Record<string, string>}
 */
export function readEcosystemTruthVersions(rootDir) {
  const ecosystem = readEcosystemPackages(rootDir);
  /** @type {Record<string, string>} */
  const truth = Object.fromEntries(ecosystem.map(({ name, version }) => [name, version]));

  const isEcosystemScopeName = ecosystemScopeMatcher(ecosystem.map(({ name }) => name));
  for (const { name, version } of readTemplateEcosystemPackages(rootDir, isEcosystemScopeName)) {
    if (!(name in truth)) truth[name] = version;
  }
  return truth;
}

/**
 * Answers "is this dependency name one of OURS" from the truth map's own names,
 * so the npm scope is never written down. An unscoped ecosystem package
 * contributes no scope and therefore makes no name suspicious - its own pins
 * are still compared, since that comparison keys on the exact name.
 *
 * @param {Iterable<string>} ecosystemPackageNames
 * @returns {(candidate: string) => boolean}
 */
export function ecosystemScopeMatcher(ecosystemPackageNames) {
  /** @type {Set<string>} */
  const scopes = new Set();
  for (const name of ecosystemPackageNames) {
    const scope = scopeOf(name);
    if (scope !== null) scopes.add(scope);
  }
  return (candidate) => {
    const scope = scopeOf(candidate);
    return scope !== null && scopes.has(scope);
  };
}

/**
 * @param {string} packageName
 * @returns {string | null} `"@scope"`, or `null` for an unscoped name
 */
function scopeOf(packageName) {
  if (!packageName.startsWith('@')) return null;
  const slash = packageName.indexOf('/');
  return slash > 0 ? packageName.slice(0, slash) : null;
}

/**
 * A dependency range is a pin THIS policy governs only when it is a bare exact
 * registry version (`0.3.0-alpha.1`). `isExactPin` alone is the wrong question:
 * it answers "does this range carry a range operator", and a
 * `file:`/`link:`/`workspace:`/`git+…` specifier carries none either - so it
 * classified every monorepo-local `file:../../../packages/mfes` as a pinned
 * site and reported it as drifted from a version it was never expressing. A
 * local-path specifier is the CONTENT self-containment check's subject
 * (`validate-content-self-containment.ts`), never a version to compare.
 *
 * @param {string} range
 * @returns {boolean}
 */
export function isExactRegistryVersionPin(range) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(range.trim());
}

/**
 * Recursively finds every `package.json` under `dir`, never descending into
 * `node_modules` (install-time output, never committed content). DOES descend
 * into a dot-prefixed directory: a pinned dependency site inside a hidden
 * directory is exactly as real as one anywhere else, and skipping it would
 * silently stop checking it - the same completeness hole CodeRabbit's review
 * found in `createFsListContentOwnedFilesFn` (#493), closed here too.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
export function findPackageJsonFiles(dir) {
  /** @type {string[]} */
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPackageJsonFiles(full));
    } else if (entry.isFile() && entry.name === 'package.json') {
      results.push(full);
    }
  }
  return results;
}

/**
 * Collects every exact-registry-version pin site one already-parsed manifest
 * declares on a name in the ecosystem's npm scope. The single place that decides
 * what "a pin site" is, so a template's tree and the ecosystem's own manifests
 * are judged by one rule rather than two copies of it.
 *
 * The dependency MAP is iterated, not a list of governed names: that is
 * precisely how a package added to `packages/` after this code was written gets
 * discovered without anyone editing anything.
 *
 * @param {Record<string, unknown>} packageJson
 * @param {string} reportedFile path to report the site at
 * @param {(name: string) => boolean} isEcosystemScopeName
 * @returns {PinSite[]}
 */
export function pinSitesIn(packageJson, reportedFile, isEcosystemScopeName) {
  /** @type {PinSite[]} */
  const sites = [];
  const selfName = typeof packageJson['name'] === 'string' ? packageJson['name'] : undefined;

  for (const field of DEPENDENCY_FIELDS) {
    const depMap = packageJson[field];
    if (typeof depMap !== 'object' || depMap === null || Array.isArray(depMap)) continue;
    for (const [packageName, range] of Object.entries(/** @type {Record<string, unknown>} */ (depMap))) {
      // A package pinning ITSELF is not a drift site: the pin and the truth
      // would be the same declaration, so the comparison could only ever
      // report a package as drifted from its own version.
      if (packageName === selfName) continue;
      if (typeof range !== 'string' || !isExactRegistryVersionPin(range)) continue;
      if (!isEcosystemScopeName(packageName)) continue;
      sites.push({ file: reportedFile, field, packageName, pinnedVersion: range });
    }
  }
  return sites;
}

/**
 * Walks every `package.json` in one tree, returning both the ecosystem pin
 * sites it declares and the package names the tree DEFINES.
 *
 * The second half is what tells a pin on a locally-resolved workspace member
 * apart from a pin on a name this repo is expected to publish (see the module
 * docblock) - and it is collected from the same parse, so it costs nothing.
 *
 * Every manifest is read through `readPackageManifest`, so an unreadable or
 * malformed one aborts naming the file instead of counting as "zero pins here"
 * (a review finding on #493: fail-open was the one thing this guard could not
 * afford, since silence is also what success looks like).
 *
 * @param {string} treeDir absolute path
 * @param {(name: string) => boolean} isEcosystemScopeName
 * @returns {{ sites: PinSite[]; definedPackageNames: Set<string> }}
 */
export function scanTreePins(treeDir, isEcosystemScopeName) {
  /** @type {PinSite[]} */
  const sites = [];
  /** @type {Set<string>} */
  const definedPackageNames = new Set();

  for (const filePath of findPackageJsonFiles(treeDir)) {
    const manifest = readPackageManifest(filePath);
    const name = manifest['name'];
    if (typeof name === 'string' && name.trim() !== '') definedPackageNames.add(name);
    sites.push(...pinSitesIn(manifest, path.relative(treeDir, filePath), isEcosystemScopeName));
  }
  return { sites, definedPackageNames };
}

/**
 * Every package name this repo defines locally, from the directories its root
 * `workspaces` patterns select. npm resolves these through the workspace
 * regardless of the range written against them, so they can never install a
 * registry tarball and can never drift - which is what exempts them from the
 * "unverifiable pin" failure without exempting them from anything else.
 *
 * Each pattern is taken up to its first wildcard segment and the directories
 * one level below that prefix are read, which covers the `<dir>/*` shape npm
 * workspaces use in practice. A pattern naming a directory literally works too.
 * Nothing here needs to be exhaustive: a name it misses only costs a loud,
 * actionable failure at the pin site, never a silent pass.
 *
 * @param {string} rootDir monorepo root
 * @returns {Set<string>}
 */
export function readRepoDefinedPackageNames(rootDir) {
  /** @type {Set<string>} */
  const names = new Set();
  const rootManifestPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(rootManifestPath)) return names;

  const rootManifest = readPackageManifest(rootManifestPath);
  const rootName = rootManifest['name'];
  if (typeof rootName === 'string' && rootName.trim() !== '') names.add(rootName);

  const patterns = Array.isArray(rootManifest['workspaces']) ? rootManifest['workspaces'] : [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    for (const memberDir of workspaceMemberDirs(rootDir, pattern)) {
      const manifestPath = path.join(memberDir, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const name = readPackageManifest(manifestPath)['name'];
      if (typeof name === 'string' && name.trim() !== '') names.add(name);
    }
  }
  return names;
}

/**
 * @param {string} rootDir
 * @param {string} pattern a root `workspaces` entry
 * @returns {string[]} absolute directories the pattern selects
 */
function workspaceMemberDirs(rootDir, pattern) {
  const segments = pattern.split('/').filter((segment) => segment !== '' && segment !== '.');
  const literal = [];
  for (const segment of segments) {
    if (segment.includes('*')) break;
    literal.push(segment);
  }

  const prefixDir = path.join(rootDir, ...literal);
  if (!fs.existsSync(prefixDir)) return [];
  // A wildcard-free pattern names one directory; anything else expands to the
  // entries one level below the literal prefix.
  if (literal.length === segments.length) return [prefixDir];

  return fs
    .readdirSync(prefixDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => path.join(prefixDir, entry.name));
}

/**
 * Reads one already-parsed manifest as an ecosystem truth-map candidate, or
 * says why it is not one - the one rule shared by a template's own identity
 * and each of its workspace members (see `readTemplateEcosystemPackages`).
 *
 * A missing or non-ecosystem-scope `name` returns `null`: it declares no
 * identity this map governs, so there is nothing to compare and nothing to
 * fail closed on either - the same judgment `readEcosystemPackages` makes for
 * a `packages/*` directory with no manifest at all, applied here to a name
 * outside scope instead of a missing file. This is what lets
 * `template-mfe/package.json` (`frontx-template-mfe-monorepo-harness`,
 * unscoped, `private: true`, deliberately carrying no version - see that
 * file's own leading comment) sit right next to `template-shell/package.json`
 * (`@gears-frontx/frontx-template-shell`) without either needing a special
 * case: one is in scope and the other isn't, and only that decides.
 *
 * Once a name IS in scope, though, it is unconditionally a truth candidate,
 * so a missing `version` fails closed exactly as an unusable `packages/*`
 * manifest does - "no version" must never be indistinguishable from "matches".
 *
 * @param {Record<string, unknown>} manifest
 * @param {string} manifestPath reported in the fail-closed error
 * @param {(name: string) => boolean} isEcosystemScopeName
 * @returns {{ name: string; version: string } | null}
 */
function ecosystemScopedNameVersion(manifest, manifestPath, isEcosystemScopeName) {
  const name = manifest['name'];
  if (typeof name !== 'string' || name.trim() === '' || !isEcosystemScopeName(name)) return null;

  const version = manifest['version'];
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(`${manifestPath} has no valid "version" - the ecosystem truth map cannot be built.`);
  }
  return { name, version };
}

/**
 * Every `{ dir, name, version }` a template's OWN tree contributes to the
 * ecosystem truth map, on top of `packages/*`: the template's own root
 * manifest (its published identity, e.g. `@gears-frontx/frontx-template-shell`)
 * and every workspace member its root `workspaces` patterns select (e.g.
 * `template-shell/packages/auth`).
 *
 * WHY templates need asking at all (#501): `template-mfe` pins subpackages of
 * `template-shell` (its own workspace members) and `template-shell` itself,
 * and none of those names live under this repo's `packages/*` - so without
 * this, every one of those pins is structurally unverifiable, not merely
 * unpinned coincidence. This closes that gap the same way `packages/*` is
 * built: derived from manifests on disk, never declared.
 *
 * This deliberately does NOT restrict which `workspaces` pattern counts - not
 * `packages/*` specifically, whatever the template's own root manifest
 * declares - for the same reason `readRepoDefinedPackageNames` does not
 * special-case `packages/*` for the monorepo root: a template's workspace
 * layout is exactly as free to change as the monorepo's own, and a governed
 * subset would be the hand-maintained list this file's whole design exists to
 * avoid. In practice this also picks up `template-mfe`'s own MFE fixture
 * packages (`@gears-frontx/demo-mfe` and friends) as truth entries; harmless,
 * since nothing pins an exact version of a leaf MFE app.
 *
 * Every candidate is filtered through `ecosystemScopedNameVersion`, so a
 * template or workspace member outside the ecosystem's own npm scope (or with
 * no manifest, or no `name`) contributes nothing, while one that IS in scope
 * fails closed on a missing `version` rather than silently dropping out.
 *
 * @param {string} rootDir monorepo root
 * @param {(name: string) => boolean} isEcosystemScopeName
 * @returns {EcosystemPackage[]}
 */
export function readTemplateEcosystemPackages(rootDir, isEcosystemScopeName) {
  /** @type {EcosystemPackage[]} */
  const packages = [];

  for (const templateDir of findTemplateDirs(rootDir)) {
    const templateName = path.basename(templateDir);
    const rootManifestPath = path.join(templateDir, 'package.json');
    // No root manifest at all: nothing to contribute, and no `workspaces`
    // field to discover members from either.
    if (!fs.existsSync(rootManifestPath)) continue;

    const rootManifest = readPackageManifest(rootManifestPath);
    const ownEntry = ecosystemScopedNameVersion(rootManifest, rootManifestPath, isEcosystemScopeName);
    if (ownEntry !== null) packages.push({ dir: templateName, ...ownEntry });

    const patterns = Array.isArray(rootManifest['workspaces']) ? rootManifest['workspaces'] : [];
    for (const pattern of patterns) {
      if (typeof pattern !== 'string') continue;
      for (const memberDir of workspaceMemberDirs(templateDir, pattern)) {
        const memberManifestPath = path.join(memberDir, 'package.json');
        if (!fs.existsSync(memberManifestPath)) continue;

        const memberManifest = readPackageManifest(memberManifestPath);
        const memberEntry = ecosystemScopedNameVersion(memberManifest, memberManifestPath, isEcosystemScopeName);
        if (memberEntry !== null) {
          packages.push({ dir: path.join(templateName, path.relative(templateDir, memberDir)), ...memberEntry });
        }
      }
    }
  }
  return packages;
}

/**
 * The `packages/*` directories one template pins to the registry - the exact
 * set `dev:template:link` must repoint, because a published tarball is the only
 * thing that can shadow a local edit.
 *
 * Derived from the template's own manifests, not from a declaration: the linker
 * links what the template pins, so asking the template is the honest question.
 * A package the template reaches only through a `file:` specifier or a
 * `workspace:` range already resolves locally and needs no link; a package it
 * pins that this repo does not publish yields no directory to link and is left
 * for the pin-drift guard to report.
 *
 * @param {string} rootDir monorepo root
 * @param {string} templateDirName template directory, relative to `rootDir`
 * @returns {string[]} `packages/*` directory names, in ecosystem order
 */
export function templatePinnedPackageDirs(rootDir, templateDirName) {
  const ecosystem = readEcosystemPackages(rootDir);
  const isEcosystemScopeName = ecosystemScopeMatcher(ecosystem.map(({ name }) => name));
  const templateDir = path.join(rootDir, templateDirName);
  if (!fs.existsSync(templateDir)) return [];

  const { sites } = scanTreePins(templateDir, isEcosystemScopeName);
  const pinnedNames = new Set(sites.map(({ packageName }) => packageName));
  return ecosystem.filter(({ name }) => pinnedNames.has(name)).map(({ dir }) => dir);
}
