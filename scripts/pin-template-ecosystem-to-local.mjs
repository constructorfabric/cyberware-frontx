/**
 * CI-runtime-only fix for a `npm ci` that cannot possibly succeed on a feature
 * branch: `template-shell` pins the FrontX ecosystem packages it consumes
 * (`@gears-frontx/mfes`, `@gears-frontx/gts-plugin`, ...) to exact registry
 * versions, and `policy:version-bump-on-change` requires that pin to move the
 * moment a package's `src/` changes substantively. Publishing, though, is
 * gated to protected branches (`publish-packages.yml` runs only on
 * `main`/`develop`/`release/*`), so on any other branch the version the
 * template now names is one the registry does not carry yet. `npm ci` exits
 * `ETARGET` before the tree it installs even exists.
 *
 * That failure is spurious for `template-drift.yml` specifically: that job's
 * entire point is to discard whatever `npm ci` installs and repoint it at the
 * working tree (`dev:template:link`), so the unpublished version was never
 * going to be tested regardless. This script exists to get an installable
 * tree in front of that relink step in the one case where the registry
 * cannot supply one - by rewriting the template's OWN pins to `file:` paths
 * into `packages/*` before `npm install` ever runs, in the runner's checkout
 * only. The workflow restores the committed manifests with `git checkout`
 * immediately afterward, so no build or type-check step ever sees a rewritten
 * manifest.
 *
 * WHICH pins get rewritten is derived, never declared: `scanTreePins` (the
 * same helper `dev:template:link` and the pin-drift guard use) finds every
 * exact-registry-version pin site in the template's tree, and this script
 * substitutes exactly the ones naming a package this repo actually builds
 * under `packages/*` (`readEcosystemPackages`). A pin this repo does not
 * build - a foreign scope, a template-internal workspace member - is left
 * completely untouched.
 *
 * What this deliberately does NOT do: it never resolves an `@gears-frontx`
 * ecosystem name from the registry, and it never relaxes a pin onto some
 * OTHER registry version - the substitution always points at this checkout's
 * own `packages/*`. Every other way an install can fail (an unresolvable
 * third-party dependency, a peer conflict, a corrupt lockfile edge) still
 * fails exactly as before it. Whether the PUBLISHED pins install at all is a
 * different question, answered by `Template Validate` (`main.yml`), which this
 * script does not touch. That job used to have to go red while a bumped pin did
 * not resolve; it now substitutes a `npm pack` tarball of the very version the
 * pin names, and only for that version - see
 * `pin-unpublished-ecosystem-to-local-pack.mjs`, whose docblock explains why
 * that job needs the published ARTIFACT while this one wants the working tree.
 *
 * Core logic is exported for unit tests; only `runCli` touches the process.
 *
 * CLI entry: `node scripts/pin-template-ecosystem-to-local.mjs` (exit 0 on
 * success, non-zero if there is nothing to substitute or an `overrides`
 * conflict is found).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { templateDirName } from './link-template-ecosystem.mjs';
import { ecosystemScopeMatcher, readEcosystemPackages, scanTreePins } from './template-ecosystem-packages.mjs';

/**
 * @typedef {{
 *   file: string;
 *   field: string;
 *   packageName: string;
 *   pinnedVersion: string;
 *   localDir: string;
 * }} Substitution
 * @typedef {{ packageName: string; fileSpec: string }} OverrideEntry
 * @typedef {{
 *   manifestPath: string;
 *   relFile: string;
 *   edits: { field: string; packageName: string; pinnedVersion: string; fileSpec: string }[];
 *   overrides: OverrideEntry[] | null;
 * }} ManifestEdit
 * @typedef {{ ok: true; templateDirName: string; manifestEdits: ManifestEdit[] } | { ok: false; reason: 'nothing-to-substitute' | 'override-conflict'; message: string }} PlanResult
 */

/**
 * Normalizes a `path.relative` result to posix separators, since the
 * `file:` specifier this writes has to be portable: this script runs on a
 * Linux CI runner today, but a backslash baked into a manifest would still be
 * wrong on any platform that later reads it.
 *
 * @param {string} relativePath
 * @returns {string}
 */
export function toPosixRelative(relativePath) {
  const posix = relativePath.split(path.sep).join('/');
  // `path.relative` omits the leading `./` a same-directory result needs to
  // read as a relative specifier rather than a bare (registry) one.
  return posix.startsWith('.') || posix.startsWith('/') ? posix : `./${posix}`;
}

/**
 * The dependency fields a `file:` specifier may be written into - `npm install`
 * resolves and installs each of these edges, so repointing one at this
 * checkout's `packages/*` is exactly what this script means.
 *
 * `peerDependencies` is deliberately absent, which is why this is an ALLOWLIST
 * rather than `DEPENDENCY_FIELDS` minus one name: a peer range declares the
 * semver window a CONSUMER must independently satisfy, not an edge npm resolves
 * here, so `file:../packages/mfes` in that field is not a localized pin - it is
 * an unsatisfiable compatibility claim shipped into the template's manifest.
 * A field added to `DEPENDENCY_FIELDS` later stays excluded until someone
 * decides it is installable, which is the safe default for a writer.
 *
 * `DEPENDENCY_FIELDS` itself stays whole: `template-pin-drift-check.mjs` must
 * keep reporting a stale exact peer pin (a real drift), `version-bump-on-
 * change-check.mjs` must keep counting a peer edit as substantive, and a
 * sync-guard test binds that constant byte-for-byte to the CLI's
 * `validate-content-self-containment.ts`.
 *
 * Only a WRITER of `file:` specifiers has the narrower question, which is why
 * the narrower list lives here and is exported to the second such writer
 * (`pin-unpublished-ecosystem-to-local-pack.mjs`) rather than copied into it.
 * `template-lockfile-selflink-check.mjs` keeps its own same-valued list on
 * purpose: it READS an install tree and asks which fields materialise an entry
 * there, a different question that happens to have the same answer today.
 */
export const INSTALLED_DEPENDENCY_FIELDS = new Set(['dependencies', 'devDependencies', 'optionalDependencies']);

/**
 * Every exact-registry-version pin site in `<repoRoot>/<templateDirName>`
 * naming a package this repo builds under `packages/*`, grouped by the
 * manifest file that declares it - and, for the template's ROOT manifest
 * only, the `overrides` entries the same substitutions require.
 *
 * Fails closed on two conditions rather than silently doing nothing:
 *  - `nothing-to-substitute`: an empty result here is indistinguishable from
 *    "nothing pins an unpublished version" only if it is reported loudly,
 *    since the whole reason this script exists is that case going undetected
 *    used to mean `npm ci` failing later with no signal pointing here.
 *  - `override-conflict`: the root manifest already carries an `overrides`
 *    entry for one of these packages at a DIFFERENT value. Overwriting it
 *    would silently discard whatever that entry was protecting; this stops
 *    and names both values instead.
 *
 * @param {{ repoRoot: string }} options
 * @returns {PlanResult}
 */
export function planPinLocalization({ repoRoot }) {
  const ecosystem = readEcosystemPackages(repoRoot);
  const localDirByName = new Map(ecosystem.map((pkg) => [pkg.name, pkg.dir]));
  const isEcosystemScopeName = ecosystemScopeMatcher(ecosystem.map((pkg) => pkg.name));

  const templateDir = path.join(repoRoot, templateDirName);
  const { sites } = scanTreePins(templateDir, isEcosystemScopeName);

  /** @type {Substitution[]} */
  const substitutions = [];
  for (const site of sites) {
    if (!INSTALLED_DEPENDENCY_FIELDS.has(site.field)) continue;
    const localDir = localDirByName.get(site.packageName);
    if (localDir === undefined) continue;
    substitutions.push({ ...site, localDir });
  }

  if (substitutions.length === 0) {
    return {
      ok: false,
      reason: 'nothing-to-substitute',
      message:
        `Cannot localize: no pin site under ${templateDirName} names a package/* this repo builds.\n` +
        'Either the template stopped pinning any ecosystem package to an exact registry version ' +
        '(in which case this step is obsolete), or the derivation broke - either way, silently ' +
        'exiting 0 here would leave npm install to fail with no signal pointing back at this step.',
    };
  }

  /** @type {Map<string, Substitution[]>} */
  const byFile = new Map();
  for (const sub of substitutions) {
    const existing = byFile.get(sub.file);
    if (existing) existing.push(sub);
    else byFile.set(sub.file, [sub]);
  }

  /** @type {ManifestEdit[]} */
  const manifestEdits = [];
  for (const [relFile, subs] of byFile) {
    const manifestPath = path.join(templateDir, relFile);
    const manifestDir = path.dirname(manifestPath);

    const edits = subs.map((sub) => {
      const localAbsDir = path.join(repoRoot, 'packages', sub.localDir);
      const fileSpec = `file:${toPosixRelative(path.relative(manifestDir, localAbsDir))}`;
      return { field: sub.field, packageName: sub.packageName, pinnedVersion: sub.pinnedVersion, fileSpec };
    });

    // Only the template's ROOT manifest gets `overrides`: that is the one
    // installed as `npm install`'s top-level project, so it is the only place
    // `overrides` is honored for a transitive edge (e.g. gts-plugin's own
    // internal dependency on @gears-frontx/mfes at the same unpublished
    // version) that this rewrite does not otherwise reach.
    /** @type {OverrideEntry[] | null} */
    let overrides = null;
    if (relFile === 'package.json') {
      const existingOverrides = readExistingOverrides(manifestPath);
      overrides = [];
      for (const edit of edits) {
        const existingValue = existingOverrides[edit.packageName];
        if (existingValue !== undefined && existingValue !== edit.fileSpec) {
          return {
            ok: false,
            reason: 'override-conflict',
            message:
              `Cannot localize: ${manifestPath} already has an "overrides" entry for ` +
              `${edit.packageName} (${JSON.stringify(existingValue)}) that disagrees with the ` +
              `local-tree value this step would set (${JSON.stringify(edit.fileSpec)}). Refusing ` +
              'to clobber it - resolve the conflict in the template manifest.',
          };
        }
        overrides.push({ packageName: edit.packageName, fileSpec: edit.fileSpec });
      }
    }

    manifestEdits.push({ manifestPath, relFile, edits, overrides });
  }

  return { ok: true, templateDirName, manifestEdits };
}

/**
 * @param {string} manifestPath
 * @returns {Record<string, string>}
 */
function readExistingOverrides(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const overrides = manifest['overrides'];
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) return {};
  return overrides;
}

/**
 * Writes every manifest a successful `planPinLocalization` names, and returns
 * one human-readable log line per substitution (dependency-field rewrites
 * first, then the root `overrides` merge, in the order the plan was built).
 *
 * Runs only after the whole plan is known to be conflict-free, so this never
 * writes half a plan: either every manifest a substitution touches is
 * rewritten, or (via the fail-closed cases above) nothing is written at all.
 *
 * @param {ManifestEdit[]} manifestEdits
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function applyPinLocalization(manifestEdits, repoRoot) {
  /** @type {string[]} */
  const logLines = [];

  for (const { manifestPath, edits, overrides } of manifestEdits) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // `manifestPath` is already `<repoRoot>/<templateDirName>/<relFile>`, so the
    // repo-relative report is one `path.relative` - re-joining `relFile` onto
    // `dirname(manifestPath)` duplicated every nested manifest's own directory
    // segment (harmless for the root manifest only by coincidence).
    const reportedFile = path.relative(repoRoot, manifestPath);

    for (const { field, packageName, pinnedVersion, fileSpec } of edits) {
      manifest[field][packageName] = fileSpec;
      logLines.push(`${packageName} ${pinnedVersion} -> ${fileSpec} (${reportedFile} / ${field})`);
    }

    if (overrides !== null && overrides.length > 0) {
      const existing = typeof manifest['overrides'] === 'object' && manifest['overrides'] !== null ? manifest['overrides'] : {};
      manifest['overrides'] = { ...existing };
      for (const { packageName, fileSpec } of overrides) {
        manifest['overrides'][packageName] = fileSpec;
        logLines.push(`${packageName} -> ${fileSpec} (${reportedFile} / overrides)`);
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  return logLines;
}

/**
 * @param {{
 *   repoRoot?: string;
 *   log?: (message: string) => void;
 *   error?: (message: string) => void;
 * }} [options]
 * @returns {number}
 */
export function runCli({
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  log = console.log,
  error = console.error,
} = {}) {
  const plan = planPinLocalization({ repoRoot });

  if (!plan.ok) {
    error(plan.message);
    return 1;
  }

  for (const line of applyPinLocalization(plan.manifestEdits, repoRoot)) {
    log(line);
  }

  return 0;
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  process.exitCode = runCli();
}
