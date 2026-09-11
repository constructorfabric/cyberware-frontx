/**
 * Version-Bump-On-Change CI Gate (#575, follow-up from #574 review).
 *
 * #574 changed `@gears-frontx/react`'s public API and shipped with no version
 * bump, and nothing caught it. The two existing `policy:*` guards could not
 * have caught it either, because both are CONSISTENCY checks, not CHANGE
 * checks: `policy:version-check` validates the ecosystem packages' semver
 * lines and the mfes->gts-plugin coupling edge in isolation, and
 * `policy:template-pin-drift` verifies a pinned dependency range matches
 * whatever version is on disk RIGHT NOW. A PR that edits `src/` and bumps
 * nothing passes both: the pins still "match" the stale version, and the
 * semver line is still internally consistent - just unchanged.
 *
 * This guard asks the one question neither of those does: did a package with
 * substantive changes in this PR ALSO change its own `version`? It diffs the
 * PR branch against the merge base with its target branch, groups the changed
 * files by owning package directory, and fails for any package whose
 * substantive changes were not accompanied by a version bump.
 *
 * ## Which directories are "a package" here
 *
 * A governed package is any non-`private` package whose own name is in the
 * ecosystem's npm scope (`@gears-frontx/*`), discovered by REUSING
 * `template-ecosystem-packages.mjs`'s existing structural discovery
 * (`readEcosystemPackages` for `packages/*`, `readTemplateEcosystemPackages`
 * for every template's own root identity AND every one of its workspace
 * members - see that module's docblock for why re-deriving either walk here
 * would be the duplicated-knowledge bug its own predecessor was rewritten to
 * remove) rather than a second, narrower copy of it. Concretely, today:
 *
 *  - every `packages/*` directory (this repo's own published ecosystem
 *    artifacts);
 *  - `template-shell` ITSELF (`@gears-frontx/frontx-template-shell`) - it
 *    publishes `dist-lib`, built from its own `src/`, and is exact-pinned by
 *    four `template-mfe` fixture manifests, exactly the #574 shape this gate
 *    exists for;
 *  - every `template-shell/packages/*` workspace member (react, auth,
 *    framework, i18n, state, studio - ADR-0033 relocated `@gears-frontx/react`'s
 *    source there, and #574 is the concrete case that skipped a bump).
 *
 * `template-mfe` and its four `src-app/mfe_packages/*` fixture apps
 * (`@gears-frontx/demo-mfe` and friends) ARE in the ecosystem's npm scope -
 * scope alone does not exclude them - but every one of them declares
 * `private: true`, and it is exactly that per-package fact, not a heuristic
 * on `template-mfe`'s own (unscoped) root manifest, that excludes them here:
 * they pin these packages' PUBLISHED versions rather than being one of them,
 * and are covered once the source package bumps by
 * `policy:template-pin-drift`, not by this gate. The same `private: true`
 * check is what would exempt a future `template-shell/src-app/mfe_packages/*`
 * member too, should that workspace pattern ever gain one.
 *
 * A MANIFEST-ONLY template - a top-level template dir with
 * `frontx-template.json` but no `package.json` at all - is governed too,
 * discovered separately by `discoverManifestOnlyTemplateRoots`: nothing
 * installable lives there, so the manifest's own `version` field is the
 * version this gate compares, and the substantive rule is
 * `hasSubstantiveTemplateChange` (the whole tree, not a `src/` convention).
 * "Manifest-only" describes a ROOT (no package.json, only the template
 * manifest); it is unrelated to "docs-only", which describes a FILE that
 * `isDocsOnlyPath` exempts (`*.md`, `llms.txt`). Whether a root is
 * manifest-only is decided by whether it had a `package.json` AT THE MERGE
 * BASE, not at HEAD: a PR that both adds a `package.json` to such a template
 * and changes its content must not thereby talk its way out of the manifest
 * bump the base classification demands.
 *
 * ## What counts as a substantive change
 *
 * Per file, relative to its package root:
 *  - anything under `src/` (excluding a pure-docs file - `*.md` or
 *    `llms.txt` - even one that happens to live inside `src/`);
 *  - `package.json` ITSELF, but only when a dependency field
 *    (`dependencies`/`devDependencies`/`peerDependencies`/
 *    `optionalDependencies`) actually changed between the merge base and
 *    HEAD - not merely appearing in the diff (a version-only edit, a
 *    `scripts` tweak, must not itself force a second bump).
 *
 * Everything else - README changes, build config, a `package.json` edit that
 * touches no dependency field - is out of scope for this gate by
 * construction: it is simply never classified as substantive. This repo
 * colocates tests under `src/` (e.g. `src/tokens.test.ts`), so the issue's
 * open question about test-only changes resolves to "still substantive"
 * here: a change to only `packages/ui-kit/src/tokens.test.ts` DOES force a
 * bump, same as any other `src/` file - deliberately, since `src/` is the
 * one signal this gate trusts, not a second classification of what's
 * "inside" it.
 *
 * ## Why the comparison is merge-base-to-HEAD content, not "did the diff touch
 * version"
 *
 * `versionAt(ref, packageRoot)` reads the actual `package.json` blob at a ref
 * and pulls `version` out of it - it does not inspect the diff hunk. That is
 * what makes a bump-then-revert within one PR still fail: if `version` is
 * edited in an early commit and reverted in a later one, `git diff --name-only`
 * may not even list `package.json` as changed at the merge base once the
 * revert lands, and the two blobs compared here are IDENTICAL - so if `src/`
 * also changed in that PR (a separate file), the substantive check still
 * trips and the version comparison still correctly reports "unchanged".
 * Comparing anything other than the two endpoints' actual content would miss
 * that case.
 *
 * A package with no `package.json` at the merge base (introduced by this PR)
 * is skipped rather than failed: a brand-new package has no prior version to
 * have bumped FROM. Likewise a package whose `package.json` no longer exists
 * at HEAD (removed by this PR) is skipped - there is no version left to check.
 * The same two skips apply to a manifest-only template root, with
 * `frontx-template.json` in the role of the manifest that must exist at the
 * ref. A manifest that EXISTS at a ref but declares no usable `version` is
 * a different situation entirely and is never a silent skip - `versionAt`
 * fails loudly instead.
 *
 * CLI entry: `node scripts/version-bump-on-change-check.mjs [--base-ref <ref>]`
 * (exit 0 on success). `--base-ref` defaults to `VERSION_BUMP_BASE_REF`, then
 * `origin/${GITHUB_BASE_REF}` (set by GitHub Actions on `pull_request`
 * events), then `origin/develop`. Core logic is exported for unit tests in
 * `scripts/version-bump-on-change-check.test.mjs`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  DEPENDENCY_FIELDS,
  ecosystemScopeMatcher,
  readEcosystemPackages,
  readPackageManifest,
  readTemplateEcosystemPackages,
} from './template-ecosystem-packages.mjs';
import { MANIFEST_FILENAME, findTemplateDirs } from './template-discovery.mjs';

/**
 * @typedef {{
 *   mergeBase: (baseRef: string) => string;
 *   listChangedFiles: (mergeBaseSha: string) => string[];
 *   readTextAtRef: (ref: string, filePath: string) => string | null;
 * }} GitReader
 */

/** A pure-docs file never counts as a substantive change, even under `src/`. */
const DOCS_ONLY_EXTENSIONS = new Set(['.md']);
const DOCS_ONLY_BASENAMES = new Set(['llms.txt']);

/**
 * @param {string} filePath repo-root-relative, posix-separated
 * @returns {boolean}
 */
export function isDocsOnlyPath(filePath) {
  return DOCS_ONLY_EXTENSIONS.has(path.posix.extname(filePath)) || DOCS_ONLY_BASENAMES.has(path.posix.basename(filePath));
}

/**
 * Whether the package rooted at `dir` (repo-root-relative) declares
 * `private: true` in its own manifest - the per-package fact this gate
 * exempts on, rather than any heuristic about its parent template (see
 * module docblock). A directory with no manifest at all governs nothing
 * either, though every `dir` passed in here comes from
 * `readEcosystemPackages`/`readTemplateEcosystemPackages`, both of which
 * already guarantee the manifest they named exists and parses.
 *
 * @param {string} rootDir monorepo root
 * @param {string} dir repo-root-relative
 * @returns {boolean}
 */
function isPrivatePackage(rootDir, dir) {
  const manifestPath = path.join(rootDir, dir, 'package.json');
  if (!fs.existsSync(manifestPath)) return true;
  return readPackageManifest(manifestPath)['private'] === true;
}

/**
 * Every package root this gate governs, repo-root-relative and posix-joined
 * (`packages/api`, `template-shell`, `template-shell/packages/react`, ...).
 * See the module docblock for what qualifies and why.
 *
 * @param {string} rootDir monorepo root
 * @returns {string[]} sorted
 */
export function discoverPackageRoots(rootDir) {
  const ecosystem = readEcosystemPackages(rootDir);
  const isEcosystemScopeName = ecosystemScopeMatcher(ecosystem.map(({ name }) => name));

  /** @type {string[]} */
  const candidateDirs = [
    ...ecosystem.map(({ dir }) => `packages/${dir}`),
    ...readTemplateEcosystemPackages(rootDir, isEcosystemScopeName).map(({ dir }) => dir),
  ];

  return candidateDirs
    .filter((dir) => !isPrivatePackage(rootDir, dir))
    .map((dir) => dir.split(path.sep).join('/'))
    .sort();
}

/**
 * Every manifest-only template root this gate governs: a top-level template
 * dir (manifest-presence rule, via `findTemplateDirs`) that carries NO
 * `package.json` at all - by design nothing installable, so
 * `readTemplateEcosystemPackages` rightly contributes nothing for it and the
 * `version` field of `frontx-template.json` itself is the only version truth
 * its changes can be held against.
 *
 * `hasPackageManifest` decides the "no package.json" half of the rule.
 * `check()` passes a git-blob check AT THE MERGE BASE, not a working-tree
 * check: a PR that adds a `package.json` to a previously manifest-only
 * template would otherwise flip the root out of this governance in the very
 * PR that changes it (see module docblock). The working-tree default exists
 * for direct callers with no diff in play.
 *
 * @param {string} rootDir monorepo root
 * @param {(templateRoot: string) => boolean} [hasPackageManifest] given a
 *   repo-root-relative posix root, whether it has a `package.json`
 * @returns {string[]} repo-root-relative, posix-separated, sorted
 */
export function discoverManifestOnlyTemplateRoots(rootDir, hasPackageManifest) {
  const hasManifest = hasPackageManifest ?? ((templateRoot) => fs.existsSync(path.join(rootDir, templateRoot, 'package.json')));
  return findTemplateDirs(rootDir)
    .map((dir) => path.relative(rootDir, dir).split(path.sep).join('/'))
    .filter((templateRoot) => !hasManifest(templateRoot))
    .sort();
}

/**
 * The substantive-change rule for a manifest-only template root. There is no
 * `src/` convention to trust here - the template IS its content - so every
 * changed file under the root counts, except a pure-docs file (same
 * `isDocsOnlyPath` exemption as everywhere else in this gate) and
 * `frontx-template.json` itself. The manifest exemption is UNCONDITIONAL,
 * which is deliberately stricter-in-simplicity than the `package.json` rule
 * in `hasSubstantiveChange` (there the manifest still counts when
 * `dependencyFieldsChanged()` is true): `frontx-template.json` declares no
 * dependency fields, so there is no edit to it that this gate would want to
 * classify as substantive.
 *
 * @param {string} templateRoot repo-root-relative, posix-separated
 * @param {string[]} filesInRoot already filtered to this root
 * @returns {boolean}
 */
export function hasSubstantiveTemplateChange(templateRoot, filesInRoot) {
  const manifestPath = `${templateRoot}/${MANIFEST_FILENAME}`;
  return filesInRoot.some((file) => file !== manifestPath && !isDocsOnlyPath(file));
}

/**
 * Groups changed files under whichever package root owns them, picking the
 * LONGEST matching root when more than one is a prefix - e.g.
 * `template-shell/packages/react/src/x.ts` must attribute to
 * `template-shell/packages/react`, not to the also-matching parent
 * `template-shell`, now that both are governed roots (a nested-root
 * scenario this gate did not have to consider until `template-shell` itself
 * became one). A file that matches no root (repo tooling, docs at the repo
 * root, an excluded private fixture tree) is silently dropped - this gate
 * has nothing to say about it.
 *
 * @param {string[]} changedFiles repo-root-relative, posix-separated
 * @param {string[]} packageRoots from `discoverPackageRoots`
 * @returns {Map<string, string[]>}
 */
export function groupChangedFilesByPackageRoot(changedFiles, packageRoots) {
  /** @type {Map<string, string[]>} */
  const grouped = new Map();
  for (const file of changedFiles) {
    /** @type {string | undefined} */
    let bestRoot;
    for (const candidate of packageRoots) {
      if (!file.startsWith(`${candidate}/`)) continue;
      if (bestRoot === undefined || candidate.length > bestRoot.length) bestRoot = candidate;
    }
    if (bestRoot === undefined) continue;
    const bucket = grouped.get(bestRoot);
    if (bucket) bucket.push(file);
    else grouped.set(bestRoot, [file]);
  }
  return grouped;
}

/**
 * @param {unknown} manifest
 * @returns {Record<string, unknown>}
 */
function dependencyFieldsOf(manifest) {
  /** @type {Record<string, unknown>} */
  const result = {};
  if (typeof manifest !== 'object' || manifest === null) return result;
  for (const field of DEPENDENCY_FIELDS) {
    const value = /** @type {Record<string, unknown>} */ (manifest)[field];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    // Entries sorted by key so the stringify comparison below is key-order
    // insensitive: `sort-package-json`, `npm pkg fix` and npm itself all
    // reorder dependency entries without changing their meaning, and a
    // reorder must not read as a dependency change.
    result[field] = Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return result;
}

/**
 * Whether a package.json's dependency declarations differ between two
 * already-parsed manifests. A `version`, `scripts`, or any other field
 * changing is NOT what this asks - only the four dependency fields
 * (`DEPENDENCY_FIELDS`), because a bare version-only edit must never force a
 * second bump of itself.
 *
 * @param {unknown} baseManifest
 * @param {unknown} headManifest
 * @returns {boolean}
 */
export function dependencyFieldsChanged(baseManifest, headManifest) {
  return JSON.stringify(dependencyFieldsOf(baseManifest)) !== JSON.stringify(dependencyFieldsOf(headManifest));
}

/**
 * @param {string} raw
 * @param {string} describedPath used only in the thrown message
 * @returns {unknown}
 */
function parseManifestText(raw, describedPath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`cannot parse ${describedPath} as JSON (${error instanceof Error ? error.message : String(error)}).`);
  }
}

/**
 * Whether ANY file changed under `packageRoot` is a substantive change, per
 * the rules in the module docblock. Stops at the first match - the exact
 * classification of every OTHER file is not needed once one substantive file
 * is found.
 *
 * @param {string} packageRoot
 * @param {string[]} filesInRoot repo-root-relative, posix-separated, already
 *   filtered to this root
 * @param {string} baseRef the merge-base sha (or any ref `readTextAtRef`
 *   accepts) to diff against
 * @param {GitReader} git
 * @returns {boolean}
 */
export function hasSubstantiveChange(packageRoot, filesInRoot, baseRef, git) {
  const srcPrefix = `${packageRoot}/src/`;
  const manifestPath = `${packageRoot}/package.json`;

  for (const file of filesInRoot) {
    if (file.startsWith(srcPrefix)) {
      if (!isDocsOnlyPath(file)) return true;
      continue;
    }
    if (file === manifestPath) {
      const baseRaw = git.readTextAtRef(baseRef, manifestPath);
      const headRaw = git.readTextAtRef('HEAD', manifestPath);
      const baseManifest = baseRaw === null ? {} : parseManifestText(baseRaw, `${manifestPath} @ ${baseRef}`);
      const headManifest = headRaw === null ? {} : parseManifestText(headRaw, `${manifestPath} @ HEAD`);
      if (dependencyFieldsChanged(baseManifest, headManifest)) return true;
    }
  }
  return false;
}

/**
 * The `version` field of `<packageRoot>/<manifestFilename>` as it reads AT
 * `ref`, read directly from that ref's blob rather than from a diff - see the
 * module docblock for why that is what makes bump-then-revert fail.
 * `manifestFilename` is `package.json` for every package root and
 * `frontx-template.json` for a manifest-only template root.
 *
 * `null` means exactly one thing: the manifest does not EXIST at `ref` (the
 * deliberate new-package/removed-package skip in `check()`). A manifest that
 * exists but declares no usable `version` (missing, non-string, or blank) is
 * NOT a skip - conflating the two would let a versionless manifest silently
 * exempt its root from this gate forever - so that case throws instead,
 * naming the root and ref.
 *
 * @param {string} ref
 * @param {string} packageRoot
 * @param {GitReader} git
 * @param {string} [manifestFilename]
 * @returns {string | null} `null` only when the manifest does not exist at `ref`
 */
export function versionAt(ref, packageRoot, git, manifestFilename = 'package.json') {
  const manifestPath = `${packageRoot}/${manifestFilename}`;
  const raw = git.readTextAtRef(ref, manifestPath);
  if (raw === null) return null;
  const manifest = parseManifestText(raw, `${manifestPath} @ ${ref}`);
  const version =
    typeof manifest === 'object' && manifest !== null ? /** @type {Record<string, unknown>} */ (manifest)['version'] : undefined;
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(
      `${manifestPath} @ ${ref} exists but declares no usable "version" (missing, non-string, or blank) - ` +
        `${packageRoot} cannot be governed without one; add a "version" field to it.`,
    );
  }
  return version;
}

/**
 * @typedef {{ packageRoot: string; version: string; files: string[] }} UnbumpedPackage
 */

/**
 * @param {{
 *   rootDir: string;
 *   baseRef: string;
 *   git: GitReader;
 *   log: (line: string) => void;
 *   logError: (line: string) => void;
 * }} context
 * @returns {number}
 */
function check({ rootDir, baseRef, git, log, logError }) {
  /** @type {string} */
  let mergeBaseSha;
  try {
    mergeBaseSha = git.mergeBase(baseRef);
  } catch (error) {
    logError(
      `[version-bump-on-change-check] FAIL: cannot resolve a merge base with "${baseRef}" ` +
        `(${error instanceof Error ? error.message : String(error)}). The checkout needs enough history to ` +
        `reach it - fetch the base branch (or check out with full history) before running this check.`,
    );
    return 1;
  }

  const packageRoots = discoverPackageRoots(rootDir);
  // Zero discovered roots is never a silent pass (same rule as
  // `template-pin-drift-check.mjs`): this repo always has governed packages,
  // so an empty result means discovery is broken - and a broken discovery
  // would otherwise report success in exactly the same voice as a real one.
  if (packageRoots.length === 0) {
    logError(
      `[version-bump-on-change-check] FAIL: discovered no governed packages under ${rootDir} - discovery is ` +
        `broken (this repo always has at least packages/*), so this gate cannot vouch for anything.`,
    );
    return 1;
  }
  // Manifest-only template roots ride the same grouping and version
  // comparison as package roots; only the substantive rule and the manifest
  // the version is read from differ. Classification is by package.json
  // presence AT THE MERGE BASE (a blob read, same as every other
  // at-a-ref question here), so a PR that adds a package.json to such a
  // template stays under manifest governance for this run - and when that
  // addition also makes the root a discovered package root, the
  // manifest-only classification deliberately wins below.
  const manifestOnlyRoots = new Set(
    discoverManifestOnlyTemplateRoots(rootDir, (templateRoot) => git.readTextAtRef(mergeBaseSha, `${templateRoot}/package.json`) !== null),
  );
  const changedFiles = git.listChangedFiles(mergeBaseSha);
  const grouped = groupChangedFilesByPackageRoot(changedFiles, [...packageRoots, ...manifestOnlyRoots]);

  /** @type {UnbumpedPackage[]} */
  const unbumped = [];
  let substantiveCount = 0;

  for (const [packageRoot, files] of grouped) {
    const isManifestOnlyRoot = manifestOnlyRoots.has(packageRoot);
    const substantive = isManifestOnlyRoot
      ? hasSubstantiveTemplateChange(packageRoot, files)
      : hasSubstantiveChange(packageRoot, files, mergeBaseSha, git);
    if (!substantive) continue;
    substantiveCount += 1;

    const manifestFilename = isManifestOnlyRoot ? MANIFEST_FILENAME : 'package.json';
    const baseVersion = versionAt(mergeBaseSha, packageRoot, git, manifestFilename);
    // No version at the merge base: this PR introduced the package itself -
    // there is no prior version it could have bumped FROM.
    if (baseVersion === null) continue;

    const headVersion = versionAt('HEAD', packageRoot, git, manifestFilename);
    // No version at HEAD: this PR removed the package - nothing left to bump.
    if (headVersion === null) continue;

    if (baseVersion === headVersion) unbumped.push({ packageRoot, version: headVersion, files });
  }

  if (unbumped.length > 0) {
    logError(
      `[version-bump-on-change-check] FAIL: ${unbumped.length} package(s) have substantive changes but no ` +
        `version bump:`,
    );
    for (const { packageRoot, version, files } of unbumped) {
      logError(`  ${packageRoot} is still at ${version} despite substantive changes:`);
      for (const file of files) logError(`    ${file}`);
    }
    logError(
      `\nBump the "version" in each package's package.json above (frontx-template.json for a manifest-only ` +
        `template) (and any exact pin on it elsewhere - see ` +
        '`npm run policy:template-pin-drift`), then rerun `npm run policy:version-bump-on-change` to confirm.',
    );
    return 1;
  }

  log(
    substantiveCount === 0
      ? `Version-bump-on-change check passed: none of ${packageRoots.length} governed package(s) and ` +
          `${manifestOnlyRoots.size} manifest-only template(s) had substantive changes since ${baseRef} ` +
          `(merge base ${mergeBaseSha}).`
      : `Version-bump-on-change check passed: every one of ${substantiveCount} governed root(s) with substantive ` +
          `changes since ${baseRef} (merge base ${mergeBaseSha}) also bumped its version.`,
  );
  return 0;
}

/**
 * @param {string} rootDir
 * @returns {GitReader}
 */
function realGitReader(rootDir) {
  // stderr piped rather than inherited (execFileSync's default) for every git
  // invocation here, not only `readTextAtRef`'s: a resolvable-but-noisy
  // command (this repo's own CI has none today, but a caller passing an
  // unresolvable `--base-ref` does) must not spill git's own "fatal: ..."
  // line into an otherwise-passing run's output. `error.message` on a thrown
  // failure still carries the piped stderr - Node appends a captured
  // stdio[2] to the Error it throws - so the caller-facing message in
  // `check()` loses nothing.
  /** @param {string[]} args */
  const run = (args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    mergeBase(baseRef) {
      return run(['merge-base', baseRef, 'HEAD']).trim();
    },
    listChangedFiles(mergeBaseSha) {
      // --no-renames: rename detection would list only the destination path,
      // so a file moved from one package to another would never name the
      // package that LOST it (nor a move out of src/ within one package).
      // Listing both sides asks both packages to bump.
      return run(['diff', '--name-only', '--no-renames', `${mergeBaseSha}..HEAD`])
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },
    readTextAtRef(ref, filePath) {
      try {
        // git show's path separator is always `/`, matching the posix-joined
        // paths this module works in throughout, regardless of host OS.
        // stdio for stderr is piped (not inherited) so the very common
        // "path exists on disk, but not in <ref>" case - a brand-new or
        // removed package, handled deliberately below - never spams a
        // passing CI run's log.
        return execFileSync('git', ['show', `${ref}:${filePath}`], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        // Cannot distinguish "file does not exist at this ref" from "some
        // other git failure" without parsing stderr, and every caller here
        // treats both the same way: no content to compare, not a hard abort.
        return null;
      }
    },
  };
}

/**
 * @param {string[]} argv `process.argv.slice(2)`
 * @returns {string | undefined}
 */
function baseRefFromArgv(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-ref') return argv[i + 1];
    if (arg.startsWith('--base-ref=')) return arg.slice('--base-ref='.length);
  }
  return undefined;
}

/**
 * CI entry point. Wired into `npm run policy:version-bump-on-change` and
 * `.github/workflows/main.yml`.
 *
 * @param {{
 *   rootDir?: string;
 *   baseRef?: string;
 *   git?: GitReader;
 *   argv?: string[];
 *   env?: Record<string, string | undefined>;
 *   log?: (line: string) => void;
 *   logError?: (line: string) => void;
 * }} [options]
 * @returns {number} 0 on success, 1 on failure.
 */
export function runCli(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);

  const baseRef =
    options.baseRef ??
    baseRefFromArgv(argv) ??
    env.VERSION_BUMP_BASE_REF ??
    (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : undefined) ??
    'origin/develop';

  const git = options.git ?? realGitReader(rootDir);

  try {
    return check({ rootDir, baseRef, git, log, logError });
  } catch (error) {
    logError(`[version-bump-on-change-check] FAIL: ${error instanceof Error ? error.message : String(error)}`);
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
