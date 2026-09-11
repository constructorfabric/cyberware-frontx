/**
 * Makes `Template Validate`'s composed install possible on a pull request that
 * bumped an ecosystem package: where a template pins a version the registry
 * does not carry yet, the pin is repointed at a tarball this checkout produces
 * with `npm pack`, and put back the moment the install is done.
 *
 * ## The failure this exists for
 *
 * `policy:version-bump-on-change` requires a `packages/*` manifest's `version`
 * to move in the same pull request that changes that package's `src/`, and the
 * templates pin `@gears-frontx/*` to exact registry versions, so the same pull
 * request also moves every pin site onto a version that only the post-merge
 * `publish-packages.yml` run will ever publish. `Template Validate` then
 * resolves those pins from the real registry and exits before the tree it
 * validates exists:
 *
 *     npm error code ETARGET
 *     npm error notarget No matching version found for @gears-frontx/ui-kit@0.4.0-alpha.2
 *
 * ## The criterion, and why it has exactly three branches
 *
 * Per exact-registry-version pin site in the tree under validation, naming a
 * package THIS repo builds under `packages/*`:
 *
 *  1. the registry answers with that version -> nothing happens, the ordinary
 *     install resolves the published tarball, and the drift that pin may carry
 *     stays this job's to catch;
 *  2. the registry does not have it AND it equals the version
 *     `packages/<dir>/package.json` declares -> the pin names the artifact this
 *     very checkout would publish, so the checkout supplies it;
 *  3. the registry does not have it and it does NOT equal the local version ->
 *     LOUD REFUSAL naming the package, the pin and the local version. That is a
 *     mistyped or stale pin (`policy:template-pin-drift` owns that class), and
 *     substituting anything for it would mask it behind a green install.
 *
 * A network or registry failure is NOT branch 2. Only npm's own `E404` answer
 * counts as "this version does not exist"; any other way the probe can end -
 * an unreachable registry, a 401, an unparseable body - refuses with its own
 * reason, because "we could not ask" must never install as "the answer is no".
 *
 * ## Why an empty result here is success, unlike its sibling
 *
 * `pin-template-ecosystem-to-local.mjs` fails when it finds nothing to
 * substitute, because rewriting pins is that script's only reason to run.
 * This one is conditional by design: on any pull request that did not bump a
 * pinned package - the overwhelming majority - every pin resolves and doing
 * nothing is the correct outcome. What still fails closed is finding no
 * GOVERNED PIN SITE AT ALL in the tree: the composed tree is known to pin this
 * repo's `packages/*`, so an empty scan means the tree argument or the
 * derivation is wrong, not that the step is unnecessary.
 *
 * ## Why `npm pack` and not a `file:` path into `packages/*`
 *
 * A `file:` specifier pointing at a package DIRECTORY installs a link to the
 * working tree, so the consumer sees whatever is on disk - including source
 * `.npmignore`d out of a release. That is the right trade for
 * `template-drift.yml`, whose whole point is to test the working tree. It is
 * the wrong one here: this job exists to validate what a seeded project
 * INSTALLS, so the substitute has to be the artifact `npm publish` would upload.
 * `npm pack` produces exactly that - `files`, `.npmignore` and the
 * `prepack`/`prepare` lifecycle all applied (see `packSubstitutedPackages`
 * for what that buys and what it still cannot catch on its own).
 *
 * ## Why a post-merge run never substitutes
 *
 * Not by the criterion alone. On the `develop` push that merges the pull
 * request, `main.yml` and `publish-packages.yml` start together, so for a few
 * minutes the bumped version is still absent from the registry AND still equal
 * to the local one - branch 2 would fire and paper over a publish that had not
 * happened yet, or failed. The guarantee is therefore in the workflow, not
 * here: the composition step calls this script only on `pull_request`, and
 * `main.yml` runs on nothing but `main`/`develop` pushes and pull requests
 * against them. On a push, an unresolvable pin is a real publish failure and
 * stays red.
 *
 * ## Scope
 *
 * Only pin sites in fields npm materialises and only names this repo builds
 * under `packages/*`. A pin on a name the composed tree DEFINES -
 * `@gears-frontx/react` and the rest of `template-shell/packages/*`, or the
 * shell's own identity - resolves through the workspace and never reaches the
 * registry, so it is not this script's business. A pin on a name that is
 * neither is `policy:template-pin-drift`'s to refuse as unverifiable.
 *
 * "Materialises" is this script's own question, not `INSTALLED_DEPENDENCY_
 * FIELDS`'s: that constant (shared with `pin-template-ecosystem-to-local.mjs`)
 * answers a WRITER's question - is a `file:` spec here a meaningful pin - and
 * excludes `peerDependencies` because a peer range is a compatibility claim on
 * the consumer, not an edge that sibling script installs from. This script
 * asks a different question: will `npm install`, left to install the composed
 * tree as committed, go to the registry for this name at this version. Since
 * npm 7, the answer is yes for a NON-OPTIONAL peer - an unsatisfied one is
 * auto-installed unless `peerDependenciesMeta` marks it `optional` (verified
 * locally against npm 11.6.2, PR #613: a workspace member with an exact,
 * unpublished, non-optional peer pin fails `npm install` with `ETARGET`; the
 * same pin marked `optional` installs clean with no attempt to resolve it).
 * `governed` below therefore includes `peerDependencies` sites too, MINUS the
 * ones `peerDependenciesMeta` marks optional - those really are never
 * installed, and substituting a tarball for one would be a rewrite with no
 * install to fix.
 *
 * ## Where the tree is
 *
 * `--tree` is a PATH, not a directory name under the repo, and the tarballs are
 * packed INTO that tree. Both template steps install from a copy placed outside
 * the checkout (#586), so the tree this rewrites lives in `$RUNNER_TEMP` and
 * only `packages/*` and the `npm pack` invocation still refer to the repo.
 * Keeping the tarballs inside the tree is what makes every `file:` specifier a
 * short relative path within it, instead of one climbing out of `$RUNNER_TEMP`
 * and back into the workspace.
 *
 * Core logic is exported for unit tests: every process and registry effect
 * arrives through an injected seam, and only `runCli` supplies the real ones.
 *
 * CLI entry (CI runtime only - it shells out to `npm` by bare name):
 *   node scripts/pin-unpublished-ecosystem-to-local-pack.mjs --tree <path>
 *   node scripts/pin-unpublished-ecosystem-to-local-pack.mjs --tree <path> --restore
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtEntryPointOf } from './link-template-ecosystem.mjs';
import { INSTALLED_DEPENDENCY_FIELDS, toPosixRelative } from './pin-template-ecosystem-to-local.mjs';
import {
  ecosystemScopeMatcher,
  readEcosystemPackages,
  readPackageManifest,
  scanTreePins,
} from './template-ecosystem-packages.mjs';

/**
 * Where the tarballs and the restore journal live, relative to the tree being
 * substituted. A dot-directory at the tree's root is invisible to everything
 * the tree then runs: it matches no `workspaces` pattern, eslint skips dot
 * directories and lints no `.tgz` anyway, and `arch:deps` is pointed at
 * `src-app/` and `packages/`.
 */
export const PACK_DIR_NAME = '.frontx-local-packs';

/**
 * The substitution has to be undone before the tree is built, linted and
 * tested, so those checks read the manifests a seeded project actually ships
 * (the invariant `template-drift.yml` states for the same rewrite). `git
 * checkout` cannot do it: the tree is a copy outside the checkout, and the
 * overlaid MFE manifests it holds are untracked even in the original. So the
 * substituting run records the original bytes of every manifest it touches
 * here, and `--restore` writes them back.
 */
export const RESTORE_JOURNAL_NAME = 'restore-journal.json';

/**
 * The one npm error code that answers the question. `E404` is npm's
 * authoritative "no such package, or no such version of it"; everything else -
 * `ENOTFOUND`, `EAI_AGAIN`, `ERR_SOCKET_TIMEOUT`, `E401`, a 5xx, an
 * unparseable body - means the probe failed to get an answer. Allowlisting the
 * single affirmative code rather than denylisting the failure codes is what
 * makes an unknown failure mode refuse instead of silently reading as
 * "unpublished" and installing a local pack over a registry this run never
 * managed to reach.
 */
const REGISTRY_ABSENT_ERROR_CODE = 'E404';

/**
 * The one dependency field `INSTALLED_DEPENDENCY_FIELDS` leaves out that this
 * script governs anyway - see the module docblock's "Scope" section for why
 * this script's materialisation question differs from that constant's.
 */
const PEER_DEPENDENCY_FIELD = 'peerDependencies';

/**
 * Whether `packageName`'s peer range in `manifest` is declared optional via
 * `peerDependenciesMeta`, npm's own opt-out from peer auto-install. A missing
 * or malformed `peerDependenciesMeta` - or no entry for this name - answers
 * `false`: the absence of an explicit opt-out is exactly what makes a peer
 * non-optional and therefore installed.
 *
 * @param {Record<string, unknown>} manifest
 * @param {string} packageName
 * @returns {boolean}
 */
function isOptionalPeerDependency(manifest, packageName) {
  const meta = manifest['peerDependenciesMeta'];
  if (typeof meta !== 'object' || meta === null) return false;
  const entry = Reflect.get(meta, packageName);
  if (typeof entry !== 'object' || entry === null) return false;
  return Reflect.get(entry, 'optional') === true;
}

/**
 * The `file:` specifier installing `tarballPath` from a manifest in `fromDir`.
 *
 * `toPosixRelative` alone is not enough here, and the reason is the pack
 * directory's own name: it prefixes `./` only when the relative path does not
 * already begin with a dot, and `.frontx-local-packs/x.tgz` does. The result
 * would be `file:.frontx-local-packs/x.tgz` - a specifier whose leading dot is
 * a directory name rather than the "here" it looks like. Anchoring every
 * specifier explicitly keeps it readable and keeps it a path npm cannot read
 * two ways.
 *
 * @param {string} fromDir directory of the manifest the specifier is written into
 * @param {string} tarballPath
 * @returns {string}
 */
function localPackFileSpec(fromDir, tarballPath) {
  const relative = toPosixRelative(path.relative(fromDir, tarballPath));
  return `file:${relative.startsWith('.') && !relative.startsWith('./') && !relative.startsWith('../') ? `./${relative}` : relative}`;
}

/**
 * The tree-relative path `scanTreePins` reports for the tree's own root
 * manifest - the one npm installs as the top-level project, and therefore the
 * only one whose `overrides` it honours.
 */
const ROOT_MANIFEST_FILE = 'package.json';

/**
 * Every union below is written on ONE line after the opening brace on purpose.
 * TypeScript's JSDoc parser silently gives up on `@typedef {` followed by a
 * newline and types the alias as `any`, which means a result union formatted
 * for readability is a result union nothing checks. That is not hypothetical:
 * `pin-template-ecosystem-to-local.mjs`'s `PlanResult` carries the multi-line
 * shape, so `type-check:scripts` has never checked one line of it.
 *
 * @typedef {{ dir: string; name: string; version: string }} EcosystemPackage
 * @typedef {{ file: string; field: string; packageName: string; pinnedVersion: string }} PinSite
 * @typedef {{ file: string; field: string; packageName: string; pinnedVersion: string; localDir: string }} PinSubstitution
 * @typedef {{ file: string; original: string }} JournalledManifest
 * @typedef {{ tree: string; manifests: JournalledManifest[] }} RestoreJournal
 * @typedef {{ command: string; args: string[]; cwd: string; captureStdout: boolean }} CommandSpec
 *
 * @typedef {{ ok: true; published: boolean } | { ok: false; reason: 'registry-unanswerable'; message: string }} RegistryAnswer
 * @typedef {(packageName: string, version: string) => RegistryAnswer} ProbeRegistryFn
 *
 * @typedef {{ ok: true; stdout: string } | { ok: false; message: string }} CommandOutcome
 * @typedef {(spec: CommandSpec) => CommandOutcome} RunCommandFn
 *
 * @typedef {'tree-missing' | 'no-governed-pin-sites' | 'registry-unanswerable' | 'pin-resolves-nowhere'} PlanRefusalReason
 * @typedef {{ ok: true; substitutions: PinSubstitution[] } | { ok: false; reason: PlanRefusalReason; message: string }} SubstitutionPlan
 *
 * @typedef {'build-failed' | 'unbuilt-package' | 'pack-failed' | 'entry-point-not-packed'} PackRefusalReason
 * @typedef {{ ok: true; tarballByPackage: Record<string, string>; logLines: string[] } | { ok: false; reason: PackRefusalReason; message: string }} PackOutcome
 *
 * @typedef {'override-conflict' | 'override-not-comparable'} ApplyRefusalReason
 * @typedef {{ ok: true; logLines: string[] } | { ok: false; reason: ApplyRefusalReason; message: string }} ApplyOutcome
 *
 * @typedef {'journal-unusable' | 'journal-escapes-tree'} RestoreRefusalReason
 * @typedef {{ ok: true; restored: string[] } | { ok: false; reason: RestoreRefusalReason; message: string }} RestoreOutcome
 *
 * @typedef {{ ok: true; tree: string; restore: boolean } | { ok: false; message: string }} ParsedArgs
 */

/**
 * Every pin site in `treeDir` that must be substituted for the
 * composed install to resolve, or the reason nothing may be installed at all.
 * The three branches of the criterion live here and nowhere else; see the module
 * docblock for why each is what it is.
 *
 * The registry is asked once per distinct `name@version`, not once per site:
 * the composed tree pins `@gears-frontx/ui-kit` from two MFE manifests at the
 * same version, and one answer governs both.
 *
 * @param {{ repoRoot: string; treeDir: string; probeRegistry: ProbeRegistryFn }} options
 * @returns {SubstitutionPlan}
 */
export function planLocalPackSubstitution({ repoRoot, treeDir, probeRegistry }) {
  if (!fs.existsSync(treeDir)) {
    return {
      ok: false,
      reason: 'tree-missing',
      message:
        `Cannot substitute: ${treeDir} does not exist. The path given to --tree is the tree whose ` +
        'install is about to run, so a missing one means this step is pointed at nothing and would ' +
        'report success having checked no pin at all.',
    };
  }

  const ecosystem = readEcosystemPackages(repoRoot);
  /** @type {Map<string, EcosystemPackage>} */
  const localByName = new Map(ecosystem.map((pkg) => [pkg.name, pkg]));
  const isEcosystemScopeName = ecosystemScopeMatcher(ecosystem.map((pkg) => pkg.name));

  const { sites } = scanTreePins(treeDir, isEcosystemScopeName);

  // One parse per manifest file, however many pin sites it declares - a
  // manifest with two peer pins must not be re-read from disk once per site.
  /** @type {Map<string, Record<string, unknown>>} */
  const manifestCache = new Map();
  /**
   * @param {string} relFile
   * @returns {Record<string, unknown>}
   */
  const manifestAt = (relFile) => {
    const cached = manifestCache.get(relFile);
    if (cached !== undefined) return cached;
    const manifest = readPackageManifest(path.join(treeDir, relFile));
    manifestCache.set(relFile, manifest);
    return manifest;
  };

  // Resolved to its local package here rather than looked up again below, so
  // "this repo builds it" is decided once and every later step already holds
  // the `packages/*` directory it needs.
  /** @type {{ site: PinSite; local: EcosystemPackage }[]} */
  const governed = [];
  for (const site of sites) {
    const isPeer = site.field === PEER_DEPENDENCY_FIELD;
    if (!INSTALLED_DEPENDENCY_FIELDS.has(site.field) && !isPeer) continue;
    if (isPeer && isOptionalPeerDependency(manifestAt(site.file), site.packageName)) continue;
    const local = localByName.get(site.packageName);
    if (local === undefined) continue;
    governed.push({ site, local });
  }

  if (governed.length === 0) {
    return {
      ok: false,
      reason: 'no-governed-pin-sites',
      message:
        `Cannot substitute: no manifest under ${treeDir} pins a packages/* package of this repo ` +
        'at an exact registry version. Either the templates stopped pinning the ecosystem (in which ' +
        'case this step is obsolete and should be deleted rather than left passing), or the pin ' +
        'derivation broke - and a silent success here would hand the failure to `npm install`, with ' +
        'nothing pointing back at this step.',
    };
  }

  /** @type {Map<string, boolean>} */
  const publishedByPin = new Map();
  for (const { site } of governed) {
    const pin = `${site.packageName}@${site.pinnedVersion}`;
    if (publishedByPin.has(pin)) continue;

    const answer = probeRegistry(site.packageName, site.pinnedVersion);
    if (!answer.ok) {
      return {
        ok: false,
        reason: 'registry-unanswerable',
        message:
          `Cannot substitute: the registry did not answer whether ${pin} exists. ${answer.message}\n` +
          'Refusing to treat an unanswered probe as "unpublished": that would install this ' +
          "checkout's own pack over a registry version this run never managed to read.",
      };
    }
    publishedByPin.set(pin, answer.published);
  }

  /** @type {PinSubstitution[]} */
  const substitutions = [];
  for (const { site, local } of governed) {
    if (publishedByPin.get(`${site.packageName}@${site.pinnedVersion}`) === true) continue;

    if (local.version !== site.pinnedVersion) {
      return {
        ok: false,
        reason: 'pin-resolves-nowhere',
        message:
          `Cannot substitute: ${path.join(treeDir, site.file)} (${site.field}) pins ` +
          `${site.packageName}@${site.pinnedVersion}, which the registry does not carry and which is ` +
          `not the version packages/${local.dir} declares (${local.version}). That pin resolves ` +
          'nowhere - a typo or a stale bump, which `policy:template-pin-drift` reports as drift. ' +
          'Substituting a local pack for it would hide it behind a green install.',
      };
    }
    substitutions.push({ ...site, localDir: local.dir });
  }

  return { ok: true, substitutions };
}

/**
 * Builds the workspace packages and packs the ones a plan substitutes, keyed by
 * package name.
 *
 * `npm run build:packages` runs once for the whole set rather than per package:
 * that script owns the order the packages have to be built in
 * (`gts-plugin` after `mfes`, and so on), and duplicating that order here is
 * exactly the hand-maintained knowledge `template-ecosystem-packages.mjs`
 * exists to avoid. `Template Validate` deliberately does not build - with the
 * pins on registry tarballs nothing in that job reads any package's `dist` -
 * so the build is paid for here, only on the runs that substitute.
 *
 * The entry-point check afterwards is what keeps that reuse honest: a package
 * `build:packages` does not cover (or whose build silently emitted nothing)
 * would otherwise pack into a well-formed tarball with no code in it, install
 * green, and fail at the first import.
 *
 * @param {{
 *   repoRoot: string;
 *   treeDir: string;
 *   substitutions: PinSubstitution[];
 *   runCommand: RunCommandFn;
 * }} options
 * @returns {PackOutcome}
 */
export function packSubstitutedPackages({ repoRoot, treeDir, substitutions, runCommand }) {
  /** @type {Map<string, string>} */
  const localDirByPackage = new Map(substitutions.map((sub) => [sub.packageName, sub.localDir]));

  const build = runCommand({
    command: 'npm',
    args: ['run', 'build:packages'],
    cwd: repoRoot,
    captureStdout: false,
  });
  if (!build.ok) {
    return {
      ok: false,
      reason: 'build-failed',
      message: `Cannot pack: \`npm run build:packages\` failed, so no package has the dist/ a pack would ship.\n${build.message}`,
    };
  }

  const packDir = path.join(treeDir, PACK_DIR_NAME);
  fs.mkdirSync(packDir, { recursive: true });

  /** @type {Record<string, string>} */
  const tarballByPackage = {};
  /** @type {string[]} */
  const logLines = [];

  for (const [packageName, localDir] of localDirByPackage) {
    const packageDir = path.join(repoRoot, 'packages', localDir);
    const entryPoint = builtEntryPointOf(readPackageManifest(path.join(packageDir, 'package.json')));
    if (entryPoint === null) {
      return {
        ok: false,
        reason: 'unbuilt-package',
        message:
          `Cannot pack ${packageName}: packages/${localDir}/package.json declares no entry point ` +
          '(no `exports["."].import`, `module` or `main`), so there is no built artifact to verify ' +
          'before packing it.',
      };
    }
    const entryPointPath = path.join(packageDir, entryPoint);
    if (!fs.existsSync(entryPointPath)) {
      return {
        ok: false,
        reason: 'unbuilt-package',
        message:
          `Cannot pack ${packageName}: its entry point ${path.relative(repoRoot, entryPointPath)} does ` +
          'not exist after `npm run build:packages`, so the tarball would install without the code it ' +
          `declares. Add packages/${localDir} to build:packages, or fix its build.`,
      };
    }

    const pack = runCommand({
      command: 'npm',
      args: ['pack', `--workspace=${packageName}`, `--pack-destination=${packDir}`, '--json'],
      cwd: repoRoot,
      captureStdout: true,
    });
    if (!pack.ok) {
      return {
        ok: false,
        reason: 'pack-failed',
        message: `Cannot pack ${packageName}: \`npm pack\` failed.\n${pack.message}`,
      };
    }

    const packedEntry = readPackedEntry(pack.stdout);
    if (packedEntry === null) {
      return {
        ok: false,
        reason: 'pack-failed',
        message:
          `Cannot pack ${packageName}: \`npm pack --json\` did not report a filename and file list. Read instead:\n${pack.stdout}`,
      };
    }
    const { filename, files } = packedEntry;

    // The filename comes from npm rather than being composed from name and
    // version: npm owns that mangling (`@gears-frontx/ui-kit` ->
    // `gears-frontx-ui-kit-0.4.0-alpha.2.tgz`), and a guess that drifts from it
    // would point every rewritten pin at a path that does not exist.
    const tarballPath = path.join(packDir, filename);
    if (!fs.existsSync(tarballPath)) {
      return {
        ok: false,
        reason: 'pack-failed',
        message: `Cannot pack ${packageName}: \`npm pack\` reported ${filename}, which is not in ${packDir}.`,
      };
    }

    // A built package can still ship WITHOUT its entry point: `files`/
    // `.npmignore` decide what `npm pack` includes independently of what's on
    // disk, so the disk check above misses it. Checked against `--json`'s own
    // `files` list rather than re-deriving the files/.npmignore answer again.
    if (!files.includes(posixEntryPointOf(entryPoint))) {
      return {
        ok: false,
        reason: 'entry-point-not-packed',
        message:
          `Cannot pack ${packageName}: \`npm pack\` produced ${filename} without ${entryPoint}, the entry ` +
          `point packages/${localDir}/package.json declares. Its "files" allowlist or .npmignore is ` +
          'excluding a file the built package needs - the tarball would install green and fail at the ' +
          'first import.',
      };
    }

    tarballByPackage[packageName] = tarballPath;
    logLines.push(`packed ${packageName} -> ${path.relative(treeDir, tarballPath)}`);
  }

  return { ok: true, tarballByPackage, logLines };
}

/**
 * The tarball name and file list from `npm pack --json`'s one-element array
 * (one packed workspace per call). Read together: a filename with no verified
 * `files` would leave the entry-point check below nothing to check against.
 *
 * @param {string} stdout
 * @returns {{ filename: string; files: string[] } | null}
 */
function readPackedEntry(stdout) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;

  const [entry] = parsed;
  if (typeof entry !== 'object' || entry === null) return null;
  const filename = Reflect.get(entry, 'filename');
  if (typeof filename !== 'string' || filename === '') return null;

  const rawFiles = Reflect.get(entry, 'files');
  if (!Array.isArray(rawFiles)) return null;
  /** @type {string[]} */
  const files = [];
  for (const file of rawFiles) {
    if (typeof file !== 'object' || file === null) return null;
    const filePath = Reflect.get(file, 'path');
    if (typeof filePath !== 'string' || filePath === '') return null;
    files.push(filePath);
  }

  return { filename, files };
}

/**
 * Normalizes `builtEntryPointOf`'s `./dist/index.js` to the form `npm pack
 * --json`'s `files[].path` reports (`dist/index.js`) - npm always packs and
 * reports posix paths regardless of platform, so stripping the leading `./`
 * is the only normalization the comparison needs.
 *
 * @param {string} entryPoint
 * @returns {string}
 */
function posixEntryPointOf(entryPoint) {
  return entryPoint.startsWith('./') ? entryPoint.slice(2) : entryPoint;
}

/**
 * Rewrites every manifest the plan names, adds the root `overrides` the
 * substitution needs, and records the bytes it overwrote so `--restore` can put
 * them back.
 *
 * Nothing is written until every manifest edit is known to be conflict-free, so
 * a refusal never leaves half a substitution and half a journal behind.
 *
 * @param {{
 *   treeDir: string;
 *   substitutions: PinSubstitution[];
 *   tarballByPackage: Record<string, string>;
 * }} options
 * @returns {ApplyOutcome}
 */
export function applyLocalPackSubstitution({ treeDir, substitutions, tarballByPackage }) {

  /** @type {Map<string, PinSubstitution[]>} */
  const byFile = new Map();
  for (const sub of substitutions) {
    const existing = byFile.get(sub.file);
    if (existing) existing.push(sub);
    else byFile.set(sub.file, [sub]);
  }

  /** @type {Map<string, { manifestPath: string; original: string; manifest: Record<string, unknown>; logLines: string[] }>} */
  const pending = new Map();

  /**
   * @param {string} relFile
   * @returns {{ manifestPath: string; original: string; manifest: Record<string, unknown>; logLines: string[] }}
   */
  const openManifest = (relFile) => {
    const already = pending.get(relFile);
    if (already !== undefined) return already;

    const manifestPath = path.join(treeDir, relFile);
    const entry = {
      manifestPath,
      original: fs.readFileSync(manifestPath, 'utf8'),
      manifest: readPackageManifest(manifestPath),
      logLines: /** @type {string[]} */ ([]),
    };
    pending.set(relFile, entry);
    return entry;
  };

  for (const [relFile, subs] of byFile) {
    const entry = openManifest(relFile);
    const manifestDir = path.dirname(entry.manifestPath);
    const reportedFile = path.relative(treeDir, entry.manifestPath);

    for (const sub of subs) {
      const fileSpec = localPackFileSpec(manifestDir, tarballByPackage[sub.packageName]);
      const depMap = entry.manifest[sub.field];
      if (typeof depMap !== 'object' || depMap === null) continue;
      Reflect.set(depMap, sub.packageName, fileSpec);
      entry.logLines.push(`${sub.packageName} ${sub.pinnedVersion} -> ${fileSpec} (${reportedFile} / ${sub.field})`);
    }
  }

  // The ROOT manifest gets an override per substituted package whether or not
  // it pins any of them itself: it is the only manifest installed as the
  // top-level project, so it is the only place `overrides` is honoured, and the
  // edge that needs it is transitive. `@gears-frontx/gts-plugin` declares
  // `@gears-frontx/mfes` at an exact version, so a pull request bumping both
  // leaves the packed gts-plugin tarball depending on an mfes version the
  // registry does not have either - a dependency no pin rewrite reaches, and
  // one whose pin site may sit in a workspace member rather than here.
  //
  // The spec is computed against the root's own directory, which is also what
  // any direct dependency rewritten above got, so npm's rule that an override
  // must agree with a direct dependency's spec holds by construction.
  const rootEntry = openManifest(ROOT_MANIFEST_FILE);
  const rootReportedFile = path.relative(treeDir, rootEntry.manifestPath);
  const existingOverrides = readOverrides(rootEntry.manifest);
  // Spread VERBATIM, values included: an npm `overrides` value may legally be a
  // nested object scoping the override to one dependency path, and a merge that
  // kept only the string values would delete every such entry on write - a
  // change to the install contract this step has no business making.
  /** @type {Record<string, unknown>} */
  const merged = { ...existingOverrides };

  for (const packageName of new Set(substitutions.map((sub) => sub.packageName))) {
    const fileSpec = localPackFileSpec(treeDir, tarballByPackage[packageName]);
    const existingValue = existingOverrides[packageName];

    // A nested object here is not a spec this step can compare a tarball
    // against, and it is not absent either - so neither "leave it" nor
    // "replace it" is a decision this step may make silently. Refusing names
    // the entry and hands it back, which is the same fail-closed trade the
    // disagreeing-string case takes below.
    if (existingValue !== undefined && typeof existingValue !== 'string') {
      return {
        ok: false,
        reason: 'override-not-comparable',
        message:
          `Cannot substitute: ${rootReportedFile} has a non-string "overrides" entry for ` +
          `${packageName} (${JSON.stringify(existingValue)}), which scopes the override to a ` +
          'dependency path rather than naming one spec. Replacing it with the local pack would ' +
          'change what the install resolves for every other path it covers - resolve it in the ' +
          'template manifest, or teach this step how the two compose.',
      };
    }

    if (existingValue !== undefined && existingValue !== fileSpec) {
      return {
        ok: false,
        reason: 'override-conflict',
        message:
          `Cannot substitute: ${rootReportedFile} already has an "overrides" entry for ${packageName} ` +
          `(${JSON.stringify(existingValue)}) that disagrees with the local pack this step would ` +
          `set (${JSON.stringify(fileSpec)}). Refusing to clobber it - resolve the conflict in the ` +
          'template manifest.',
      };
    }
    merged[packageName] = fileSpec;
    rootEntry.logLines.push(`${packageName} -> ${fileSpec} (${rootReportedFile} / overrides)`);
  }
  rootEntry.manifest['overrides'] = merged;

  /** @type {JournalledManifest[]} */
  const journalled = [];
  /** @type {string[]} */
  const allLogLines = [];
  for (const { manifestPath, original, manifest, logLines } of pending.values()) {
    journalled.push({ file: toPosixRelative(path.relative(treeDir, manifestPath)), original });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    allLogLines.push(...logLines);
  }

  writeRestoreJournal(treeDir, { tree: treeDir, manifests: journalled });
  return { ok: true, logLines: allLogLines };
}

/**
 * The manifest's `overrides` map as it stands, every value kept as written.
 *
 * Values are deliberately NOT narrowed to strings. An earlier version of this
 * returned only the string ones, which read as harmless and was not: a nested
 * entry for a package being substituted came back `undefined`, the conflict
 * check saw no conflict, and the tarball spec replaced a valid path-scoped
 * override - and every nested entry for any other package was dropped from the
 * manifest on write. Both cases are decided at the call site now, one of them
 * by refusing.
 *
 * A missing or non-object `overrides` is no map at all rather than an error:
 * npm would reject the manifest itself long before this step's substitution
 * mattered.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {Record<string, unknown>}
 */
function readOverrides(manifest) {
  const overrides = manifest['overrides'];
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) return {};
  return { ...overrides };
}

/**
 * @param {string} treeDir
 * @param {RestoreJournal} journal
 */
function writeRestoreJournal(treeDir, journal) {
  const packDir = path.join(treeDir, PACK_DIR_NAME);
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, RESTORE_JOURNAL_NAME), JSON.stringify(journal, null, 2) + '\n');
}

/**
 * Puts every manifest the substituting run rewrote back, byte for byte, and
 * drops the journal.
 *
 * A missing journal is success with nothing restored: that is what a run which
 * found every pin published leaves behind, and the workflow calls `--restore`
 * unconditionally so the two calls stay symmetrical.
 *
 * A journal that IS there but names a path outside the tree it claims is
 * refused rather than obeyed. The journal is this script's own file, but it is
 * a file on disk that decides where bytes get written, and a stale one from a
 * differently-argued run must not write over anything.
 *
 * @param {{ treeDir: string }} options
 * @returns {RestoreOutcome}
 */
export function restoreSubstitutedManifests({ treeDir }) {
  const journalPath = path.join(treeDir, PACK_DIR_NAME, RESTORE_JOURNAL_NAME);
  if (!fs.existsSync(journalPath)) return { ok: true, restored: [] };

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      reason: 'journal-unusable',
      message: `Cannot restore: ${journalPath} is not readable JSON (${describeError(error)}).`,
    };
  }

  const manifests = readJournalManifests(parsed, treeDir);
  if (manifests === null) {
    return {
      ok: false,
      reason: 'journal-unusable',
      message:
        `Cannot restore: ${journalPath} does not describe manifests of ${treeDir}. A journal this ` +
        'step cannot read is a substitution it cannot undo, which would leave the tree building ' +
        'against rewritten manifests.',
    };
  }

  /** @type {{ manifestPath: string; original: string }[]} */
  const writes = [];
  for (const { file, original } of manifests) {
    const manifestPath = path.resolve(treeDir, file);
    if (manifestPath !== treeDir && !manifestPath.startsWith(treeDir + path.sep)) {
      return {
        ok: false,
        reason: 'journal-escapes-tree',
        message: `Cannot restore: ${journalPath} names ${file}, which is outside ${treeDir}. Refusing to write it.`,
      };
    }
    writes.push({ manifestPath, original });
  }

  /** @type {string[]} */
  const restored = [];
  for (const { manifestPath, original } of writes) {
    fs.writeFileSync(manifestPath, original);
    restored.push(path.relative(treeDir, manifestPath));
  }
  fs.rmSync(journalPath);

  return { ok: true, restored };
}

/**
 * @param {unknown} parsed
 * @param {string} treeDir
 * @returns {JournalledManifest[] | null}
 */
function readJournalManifests(parsed, treeDir) {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  if (Reflect.get(parsed, 'tree') !== treeDir) return null;

  const manifests = Reflect.get(parsed, 'manifests');
  if (!Array.isArray(manifests)) return null;

  /** @type {JournalledManifest[]} */
  const entries = [];
  for (const entry of manifests) {
    if (typeof entry !== 'object' || entry === null) return null;
    const file = Reflect.get(entry, 'file');
    const original = Reflect.get(entry, 'original');
    if (typeof file !== 'string' || file === '' || typeof original !== 'string') return null;
    entries.push({ file, original });
  }
  return entries;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Asks npm whether one exact version exists, in the machine-readable form:
 * `npm view <name>@<version> version --json` answers a bare JSON string on a
 * hit and, on a miss, exits non-zero having written `{"error":{"code":"E404"}}`
 * to stdout.
 *
 * Only that code answers "no". See `REGISTRY_ABSENT_ERROR_CODE` for why the
 * discrimination is an allowlist of one rather than a list of network failures.
 *
 * @param {string} packageName
 * @param {string} version
 * @returns {RegistryAnswer}
 */
export function probeRegistryWithNpm(packageName, version) {
  const spec = `${packageName}@${version}`;
  const result = spawnSync('npm', ['view', spec, 'version', '--json'], { encoding: 'utf8' });

  if (result.error !== undefined) {
    return { ok: false, reason: 'registry-unanswerable', message: `\`npm view ${spec}\` could not run: ${describeError(result.error)}` };
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = undefined;
  }

  if (result.status === 0) {
    // A bare exact version can only match one release, so npm answers with the
    // string; an array would mean the spec was a range, which
    // `isExactRegistryVersionPin` already excluded upstream.
    if (parsed === version) return { ok: true, published: true };
    return {
      ok: false,
      reason: 'registry-unanswerable',
      message: `\`npm view ${spec}\` succeeded but answered ${JSON.stringify(result.stdout)} instead of ${JSON.stringify(version)}.`,
    };
  }

  if (readNpmErrorCode(parsed) === REGISTRY_ABSENT_ERROR_CODE) return { ok: true, published: false };

  return {
    ok: false,
    reason: 'registry-unanswerable',
    message: `\`npm view ${spec}\` exited ${result.status} without an ${REGISTRY_ABSENT_ERROR_CODE}:\n${result.stderr.trim()}`,
  };
}

/**
 * @param {unknown} parsed body of `npm view --json` on a failed run
 * @returns {string | null}
 */
function readNpmErrorCode(parsed) {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const error = Reflect.get(parsed, 'error');
  if (typeof error !== 'object' || error === null) return null;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
}

/**
 * @param {CommandSpec} spec
 * @returns {CommandOutcome}
 */
export function runCommandWithSpawn({ command, args, cwd, captureStdout }) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // A build streams to the job log, so the developer reading a red run sees
    // where it broke; `npm pack --json` is read back and must not.
    stdio: captureStdout ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  const label = `${command} ${args.join(' ')}`;
  if (result.error !== undefined) return { ok: false, message: `\`${label}\` could not run: ${describeError(result.error)}` };
  if (result.status !== 0) {
    const detail = captureStdout ? `\n${result.stdout}${result.stderr}`.trimEnd() : '';
    return { ok: false, message: `\`${label}\` exited ${result.status}.${detail}` };
  }
  return { ok: true, stdout: captureStdout ? result.stdout : '' };
}

/**
 * @param {string[]} argv arguments after the script path
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let tree;
  let restore = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--restore') {
      restore = true;
      continue;
    }
    if (arg === '--tree') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return { ok: false, message: '--tree needs a path.' };
      tree = value;
      index += 1;
      continue;
    }
    return { ok: false, message: `Unknown argument ${JSON.stringify(arg)}.` };
  }

  if (tree === undefined) return { ok: false, message: '--tree <path> is required.' };
  return { ok: true, tree, restore };
}

/**
 * @param {{
 *   argv?: string[];
 *   cwd?: string;
 *   repoRoot?: string;
 *   probeRegistry?: ProbeRegistryFn;
 *   runCommand?: RunCommandFn;
 *   log?: (message: string) => void;
 *   error?: (message: string) => void;
 * }} [options]
 * @returns {number}
 */
export function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  probeRegistry = probeRegistryWithNpm,
  runCommand = runCommandWithSpawn,
  log = console.log,
  error = console.error,
} = {}) {
  const args = parseArgs(argv);
  if (!args.ok) {
    error(`${args.message}\nUsage: node scripts/pin-unpublished-ecosystem-to-local-pack.mjs --tree <path> [--restore]`);
    return 1;
  }
  const { restore } = args;
  const treeDir = path.resolve(cwd, args.tree);

  if (restore) {
    const outcome = restoreSubstitutedManifests({ treeDir });
    if (!outcome.ok) {
      error(outcome.message);
      return 1;
    }
    if (outcome.restored.length === 0) log(`No local-pack substitution to undo in ${treeDir}.`);
    for (const file of outcome.restored) log(`restored ${file}`);
    return 0;
  }

  // The pack directory is entirely this script's, and a journal left by a run
  // that was killed mid-way would be replayed by a later `--restore` over
  // manifests it never rewrote. Clearing it first makes every run start from
  // the same state.
  fs.rmSync(path.join(treeDir, PACK_DIR_NAME), { recursive: true, force: true });

  const plan = planLocalPackSubstitution({ repoRoot, treeDir, probeRegistry });
  if (!plan.ok) {
    error(plan.message);
    return 1;
  }
  if (plan.substitutions.length === 0) {
    log(`Every ecosystem pin under ${treeDir} resolves in the registry - installing them unchanged.`);
    return 0;
  }

  const packed = packSubstitutedPackages({ repoRoot, treeDir, substitutions: plan.substitutions, runCommand });
  if (!packed.ok) {
    error(packed.message);
    return 1;
  }
  for (const line of packed.logLines) log(line);

  const applied = applyLocalPackSubstitution({
    treeDir,
    substitutions: plan.substitutions,
    tarballByPackage: packed.tarballByPackage,
  });
  if (!applied.ok) {
    error(applied.message);
    return 1;
  }
  for (const line of applied.logLines) log(line);

  return 0;
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  process.exitCode = runCli();
}
