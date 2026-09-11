#!/usr/bin/env node

/**
 * MFE Manifest Generation Script
 *
 * Reads the enriched mfe-manifest.json (produced by the frontx-mf-gts Vite
 * plugin into each MFE's dist directory) and writes the aggregated manifest
 * to a public asset (`public/generated-mfe-manifests.json`) served by Vite at
 * the runtime URL `/generated-mfe-manifests.json`. Every FrontX app instance
 * (root host AND any nested app) reads it from that URL at runtime.
 *
 * The enriched mfe-manifest.json already contains all required data:
 * - manifest.metaData: publicPath, remoteEntry, buildInfo from mf-manifest.json
 * - manifest.shared[]: standalone ESM deps with resolved versions and chunkPaths
 * - entries[].exposeAssets: from mf-manifest.json exposes[]
 *
 * Pipeline per MFE package:
 *   1. Read dist/mfe-manifest.json — enriched by the build plugin
 *   2. Refuse the run when any identifier in it is not a parseable GTS id, so a
 *      typo fails the build instead of the host's bootstrap
 *   3. Inject resolved publicPath (overrides build-time placeholder)
 *   4. Copy shared dep `chunkPath` entries unchanged from the enriched manifest
 *   5. Map entries to MfeEntryMF shape with the resolved MfManifest object
 *      inlined into each entry's `manifest` field (the schema accepts both
 *      string ID and inline object; inline removes the need for any consumer
 *      to spread/override the entry to attach the manifest reference at
 *      registration time, so consumers can pass entries opaquely to
 *      `typeSystem.register()`)
 *
 * A package whose `mfe.json` declares `"templateExample": true` is left out of
 * the aggregate entirely: it is content the template ships to be read and
 * copied, and an applied project that registered it would offer screens its
 * developer never asked for. `FRONTX_INCLUDE_TEMPLATE_EXAMPLES=1` puts them
 * back, for a run that means to watch the shipped examples rather than read
 * them.
 *
 * Usage:
 *   npx tsx scripts/generate-mfe-manifests.ts [--base-url <url>]
 *
 * When --base-url is omitted, publicPath comes from manifest.metaData.publicPath
 * in the enriched mfe-manifest.json (set by the build plugin from mf-manifest.json).
 */

import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Gts } from '@globaltypesystem/gts-ts';

import {
  isNonPackageDirectory,
  isTemplateExamplePackage,
  templateExamplesIncluded,
  templateExamplesSkippedNotice,
} from './lib/mfe-tools.js';

// ---------------------------------------------------------------------------
// Raw JSON shape types (what we read from the enriched mfe-manifest.json on disk)
// ---------------------------------------------------------------------------

interface RawMetaData {
  name: string;
  type: string;
  buildInfo: { buildVersion: string; buildName: string };
  remoteEntry: { name: string; path: string; type: string };
  globalName: string;
  publicPath: string;
}

interface RawShared {
  name: string;
  version: string;
  chunkPath: string;
  unwrapKey: string | null;
  contentHash?: string;
}

interface RawExposeAssets {
  js: { async: string[]; sync: string[] };
  css: { async: string[]; sync: string[] };
}

interface RawEntry {
  id: string;
  requiredProperties: string[];
  optionalProperties?: string[];
  actions: string[];
  domainActions: string[];
  manifest: string;
  exposedModule: string;
  exposeAssets: RawExposeAssets;
}

interface RawExtension {
  id: string;
  domain: string;
  entry: string;
  presentation?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RawSchema {
  $id?: string;
  [key: string]: unknown;
}

interface RawDomain {
  id: string;
  sharedProperties: string[];
  actions: string[];
  extensionsActions: string[];
  defaultActionTimeout: number;
  lifecycleStages: string[];
  extensionsLifecycleStages: string[];
}

interface RawManifest {
  id: string;
  name: string;
  remoteEntry: string;
  metaData: RawMetaData;
  shared: RawShared[];
}

/** Enriched mfe-manifest.json shape produced by the frontx-mf-gts Vite plugin. */
interface RawEnrichedMfeJson {
  manifest: RawManifest;
  domains?: RawDomain[];
  entries: RawEntry[];
  extensions: RawExtension[];
  schemas?: RawSchema[];
}

// ---------------------------------------------------------------------------
// Output shape types (mirror the SDK MfManifest / MfeEntryMF types; kept
// local so the script has no dependency on @gears-frontx packages at run time)
// ---------------------------------------------------------------------------

interface OutMfManifestShared {
  name: string;
  version: string;
  chunkPath: string;
  unwrapKey: string | null;
  contentHash?: string;
}

interface OutMfManifest {
  id: string;
  name: string;
  metaData: {
    name: string;
    type: string;
    buildInfo: { buildVersion: string; buildName: string };
    remoteEntry: { name: string; path: string; type: string };
    globalName: string;
    publicPath: string;
  };
  shared: OutMfManifestShared[];
}

interface OutMfManifestAssets {
  js: { async: string[]; sync: string[] };
  css: { async: string[]; sync: string[] };
}

interface OutMfeEntryMF {
  id: string;
  requiredProperties: string[];
  optionalProperties?: string[];
  actions: string[];
  domainActions: string[];
  manifest: OutMfManifest;
  exposedModule: string;
  exposeAssets: OutMfManifestAssets;
}

interface OutMfeManifestConfig {
  manifest: OutMfManifest;
  domains?: RawDomain[];
  entries: OutMfeEntryMF[];
  extensions: RawExtension[];
  schemas?: RawSchema[];
}

// ---------------------------------------------------------------------------
// ManifestGenerator — class-based implementation
// ---------------------------------------------------------------------------

/**
 * Exported for `__tests__/template-example-packages.test.ts` and
 * `__tests__/mfe-manifest-gts-ids.test.ts`, which drive the real generator over
 * fixture trees rather than a copy of its rules. The CLI entry at the foot of
 * this file guards on being the process entry point so that import writes no
 * manifest of its own.
 */
export class ManifestGenerator {
  private readonly mfePackagesDir: string;
  private readonly outputFile: string;
  private readonly globalBaseUrl: string | null;
  private readonly mfeManifestPath: string;

  constructor(
    mfePackagesDir: string,
    outputFile: string,
    mfeManifestPath: string,
    globalBaseUrl: string | null
  ) {
    this.mfePackagesDir = mfePackagesDir;
    this.outputFile = outputFile;
    this.mfeManifestPath = mfeManifestPath;
    this.globalBaseUrl = globalBaseUrl;
  }

  run(): void {
    // A shell-only seed (no `add mfe` applied yet, or every MFE removed)
    // never creates `src-app/mfe_packages/`. That is a valid, working
    // topology — not an error — so this degrades to an empty manifest set
    // instead of throwing ENOENT, matching the guard convention already used
    // by the sibling scanner in scripts/lib/mfe-tools.ts (getMFEPackages).
    if (!existsSync(this.mfePackagesDir)) {
      console.log(
        `No MFE packages directory found at ${this.mfePackagesDir} — writing empty manifest set.`,
      );
    }

    try {
      const packageDirs = this.discoverPackages();
      console.log(`Found ${packageDirs.length} MFE package(s):`);
      packageDirs.forEach((p) => console.log(`  - ${p}`));

      const configs = packageDirs.map((dir) => this.processPackage(dir));
      const output = this.renderOutputFile(configs);
      writeFileSync(this.outputFile, output, 'utf-8');
    } catch (err) {
      this.discardAggregate();
      throw err;
    }

    console.log(`\nGenerated ${this.outputFile}`);
  }

  /**
   * Drop the aggregate, so that a run which fails leaves none behind.
   *
   * The invariant matters because the file outlives the run that wrote it. Every
   * refusal in `processPackage` - an unparseable GTS id, an unbuilt package, a
   * manifest missing metaData - would otherwise leave the previous run's
   * `generated-mfe-manifests.json` in place, and the host reads that file at
   * bootstrap without knowing which run produced it. A red build followed by a
   * dev server that mounts the last good manifest shows working screens, so
   * nothing points at the failed generation.
   *
   * The guarded block spans discovery through the write rather than just the
   * validation, because the boundary belongs to the run and not to one gate: an
   * unreadable packages directory leaves the aggregate as stale as a rejected id
   * does, a future check added anywhere in `processPackage` inherits the guard,
   * and a `writeFileSync` that dies partway through cannot leave a truncated
   * aggregate either.
   */
  private discardAggregate(): void {
    try {
      // `force` makes a missing file a no-op, which is the common case: most
      // failures happen on a tree that never generated successfully.
      rmSync(this.outputFile, { force: true });
    } catch (err) {
      // A failure to unlink (a read-only mount, a directory in the file's place)
      // must not replace the error that is already on its way to the operator -
      // that one names the id or the package to fix, this one would only name
      // the path. Reported as a warning and swallowed so the original throws.
      console.error(
        `Warning: could not remove ${this.outputFile} after a failed run ` +
          `(${err instanceof Error ? err.message : String(err)}). ` +
          `It may hold the output of an earlier run - delete it before trusting it.`
      );
    }
  }

  private discoverPackages(): string[] {
    if (!existsSync(this.mfePackagesDir)) {
      return [];
    }

    const includeExamples = templateExamplesIncluded();
    const discovered: string[] = [];
    const skippedExamples: string[] = [];

    for (const dir of readdirSync(this.mfePackagesDir)) {
      // The same non-package rule the other two scanners apply, so `shared` and
      // dot-directories are out of all three. A local set here answered only
      // for dot-prefixed names and let a `shared/` carrying an `mfe.json` reach
      // the aggregate that the other two had already dropped.
      if (isNonPackageDirectory(dir)) continue;

      const pkgPath = join(this.mfePackagesDir, dir);
      if (!existsSync(join(pkgPath, 'mfe.json'))) continue;

      // A package the template ships as an example or as the copy-from scaffold
      // contributes no extension to the aggregated manifest, so nothing of it
      // reaches the registry the host's navigation menu is built from. Excluding
      // it here rather than in the menu covers every consumer of the generated
      // file at once, and spares the build and the dev orchestrator the work of
      // producing something no product asked for.
      if (!includeExamples && isTemplateExamplePackage(pkgPath)) {
        skippedExamples.push(dir);
        continue;
      }

      discovered.push(dir);
    }

    if (skippedExamples.length > 0) {
      console.log(templateExamplesSkippedNotice(skippedExamples));
    }

    return discovered;
  }

  private processPackage(packageDir: string): OutMfeManifestConfig {
    const pkgPath = join(this.mfePackagesDir, packageDir);

    const mfeJson = this.readEnrichedMfeJson(pkgPath, packageDir);
    this.assertRequiredCollectionsArePresent(mfeJson, packageDir);
    this.assertGtsIdsAreValid(mfeJson, pkgPath, packageDir);
    const publicPath = this.resolvePublicPath(mfeJson, packageDir);

    const outManifest = this.buildManifest(mfeJson.manifest, publicPath);
    const outEntries = this.buildEntries(mfeJson.entries, outManifest, packageDir);

    return {
      manifest: outManifest,
      ...(mfeJson.domains !== undefined && { domains: mfeJson.domains }),
      entries: outEntries,
      extensions: mfeJson.extensions,
      ...(mfeJson.schemas !== undefined && { schemas: mfeJson.schemas }),
    };
  }

  private readEnrichedMfeJson(pkgPath: string, packageDir: string): RawEnrichedMfeJson {
    const manifestFilePath = join(pkgPath, this.mfeManifestPath);
    if (!existsSync(manifestFilePath)) {
      throw new Error(
        `[${packageDir}] ${this.mfeManifestPath} not found. ` +
          `Build the MFE package first and ensure the frontxMfGts plugin is configured in vite.config.ts.`
      );
    }
    let mfeJson: RawEnrichedMfeJson;
    try {
      mfeJson = JSON.parse(readFileSync(manifestFilePath, 'utf-8')) as RawEnrichedMfeJson;
    } catch (err) {
      throw new Error(`[${packageDir}] Cannot parse ${this.mfeManifestPath}: ${String(err)}`);
    }
    if (!mfeJson.manifest?.metaData) {
      throw new Error(
        `[${packageDir}] ${this.mfeManifestPath} is missing manifest.metaData. ` +
          `Build the MFE package first and ensure the frontxMfGts plugin is configured in vite.config.ts.`
      );
    }
    return mfeJson;
  }

  /**
   * Refuse a manifest that does not carry both collections the aggregate is
   * built from.
   *
   * `entries` and `extensions` are required by the contract, and the frontxMfGts
   * plugin writes both, so an absent one means an incomplete build rather than a
   * package that chose to have none - an MFE with no extensions writes
   * `"extensions": []`.
   *
   * Treating absence as "nothing to check" is worse than it sounds in either
   * direction. Without `entries`, validation passed and `buildEntries` then died
   * on `Cannot read properties of undefined (reading 'map')`, a stack pointing
   * at this script rather than at the package. Without `extensions`, the run
   * stayed green: the aggregate was written with the key silently dropped, which
   * is the empty navigation menu the id gate above exists to prevent, arrived at
   * by a different road. Both are named here, before anything reads them.
   */
  private assertRequiredCollectionsArePresent(
    mfeJson: RawEnrichedMfeJson,
    packageDir: string
  ): void {
    const missing = (['entries', 'extensions'] as const).filter(
      (field) => !Array.isArray(mfeJson[field])
    );

    if (missing.length === 0) {
      return;
    }

    const named = missing.map((field) => `'${field}'`).join(' and ');
    throw new Error(
      `[${packageDir}] ${this.mfeManifestPath} carries no ${named} ` +
        `${missing.length === 1 ? 'array' : 'arrays'}.\n` +
        `Both are required, and the frontxMfGts plugin writes them, so this is an ` +
        `incomplete build rather than a package without any: an MFE that contributes ` +
        `nothing still writes an empty array. Rebuild the package.`
    );
  }

  /**
   * Refuse a package whose enriched manifest carries an identifier GTS cannot
   * parse.
   *
   * Without this gate every command stays green: an id one dot-token short of
   * the grammar compiles, type-checks, builds and lands in the aggregate, and
   * the only thing that rejects it is the host's bootstrap, which reports it as
   * a console error and leaves an empty navigation menu behind. Nothing then
   * names the file to edit, so the cost of the typo is a runtime hunt rather
   * than a failed build.
   *
   * The check runs through the same parser the runtime registry parses ids
   * with, so this gate cannot come to disagree with the runtime about what a
   * valid id is: a grammar restated here would start rejecting ids GTS accepts
   * the first time the id grammar moves.
   *
   * Validating here does not widen anyone's ownership of id syntax
   * (ADR 0005 keeps that in GTS): the plugin exposes no id-syntax surface to
   * call instead, this aggregator is the last point that sees every package's
   * ids at once, and it is a build script rather than runtime, so the
   * confinement holds.
   *
   * Every invalid id in the package is reported together. Stopping at the first
   * would turn a manifest that carries several into one rebuild per typo.
   */
  private assertGtsIdsAreValid(
    mfeJson: RawEnrichedMfeJson,
    pkgPath: string,
    packageDir: string
  ): void {
    const invalid = collectGtsIds(mfeJson)
      .map(({ field, id }) => ({ field, id, result: Gts.validateGtsID(id) }))
      .filter(({ result }) => !result.ok);

    if (invalid.length === 0) {
      return;
    }

    const detail = invalid
      .map(({ field, id, result }) => `  - ${field}: "${id}"\n      ${result.error}`)
      .join('\n');

    throw new Error(
      `[${packageDir}] ${invalid.length} invalid GTS identifier(s) in ${this.mfeManifestPath}:\n` +
        `${detail}\n` +
        `An id chains at least two '~'-delimited segments. The first carries the ` +
        `'gts.' prefix ahead of its five dot-tokens ` +
        `(gts.vendor.package.namespace.type.vN), every later segment carries the ` +
        `five alone, and any segment may end in a minor version. For example: ` +
        `gts.frontx.mfes.ext.extension.v1~acme.billing.screens.home.v1\n` +
        `Fix the ids in ${join(pkgPath, 'mfe.json')} and rebuild the package.`
    );
  }

  /**
   * Resolve publicPath for this MFE.
   * Priority:
   *   1. --base-url CLI flag (global override for all packages)
   *   2. publicPath from enriched mfe-manifest.json manifest.metaData (set by plugin) —
   *      ONLY when it is a concrete, already-resolved value
   *   3. Origin from mfe-manifest.json manifest.remoteEntry URL (per-package default)
   *   4. "/" as final fallback
   */
  private resolvePublicPath(
    mfeJson: RawEnrichedMfeJson,
    packageDir: string
  ): string {
    if (this.globalBaseUrl !== null) {
      return this.globalBaseUrl.endsWith('/')
        ? this.globalBaseUrl
        : `${this.globalBaseUrl}/`;
    }

    // Use publicPath from enriched manifest (set by the plugin from mfe-manifest.json).
    //
    // "auto" (and its normalized "auto/" form) is Module Federation's own
    // build-time placeholder meaning "resolve at runtime from wherever the
    // remoteEntry/manifest was actually served" — it is NEVER a usable base
    // URL on its own. This is the DEFAULT publicPath value MF emits whenever
    // an MFE's vite.config.ts does not set `federation({ ... publicPath })`
    // explicitly (true for every MFE in src-app/mfe_packages/ today). Treating
    // it as already-resolved (as a naive `!== '/'` truthy check would) writes
    // the literal string "auto/" into generated-mfe-manifests.json, which the
    // runtime handler (MfeHandlerMF) then concatenates onto every chunk
    // filename — producing a same-origin relative URL that Vite's SPA
    // fallback answers with a 200 index.html instead of a 404, masking the
    // failure as a silent no-op mount.
    const manifestPublicPath = mfeJson.manifest.metaData.publicPath;
    const isUnresolvedAutoPlaceholder =
      manifestPublicPath === 'auto' || manifestPublicPath === 'auto/';
    if (
      manifestPublicPath &&
      manifestPublicPath !== '/' &&
      !isUnresolvedAutoPlaceholder
    ) {
      return manifestPublicPath.endsWith('/')
        ? manifestPublicPath
        : `${manifestPublicPath}/`;
    }

    // Fall back to mfe-manifest.json manifest.remoteEntry origin.
    const remoteEntry = mfeJson.manifest.remoteEntry;
    if (remoteEntry) {
      try {
        const url = new URL(remoteEntry);
        return `${url.origin}/`;
      } catch {
        console.warn(
          `[${packageDir}] Cannot parse remoteEntry URL "${remoteEntry}", defaulting publicPath to "/"`
        );
      }
    }

    return '/';
  }

  private buildManifest(rawManifest: RawManifest, publicPath: string): OutMfManifest {
    return {
      id: rawManifest.id,
      name: rawManifest.name,
      metaData: {
        name: rawManifest.metaData.name,
        type: rawManifest.metaData.type,
        buildInfo: {
          buildVersion: rawManifest.metaData.buildInfo.buildVersion,
          buildName: rawManifest.metaData.buildInfo.buildName,
        },
        remoteEntry: {
          name: rawManifest.metaData.remoteEntry.name,
          path: rawManifest.metaData.remoteEntry.path,
          type: rawManifest.metaData.remoteEntry.type,
        },
        globalName: rawManifest.metaData.globalName,
        // Inject resolved publicPath — overrides the "/" placeholder from the build
        publicPath,
      },
      shared: rawManifest.shared.map((s) => ({
        name: s.name,
        version: s.version,
        chunkPath: s.chunkPath,
        unwrapKey: s.unwrapKey,
        ...(s.contentHash !== undefined ? { contentHash: s.contentHash } : {}),
      })),
    };
  }

  private buildEntries(
    entries: RawEntry[],
    outManifest: OutMfManifest,
    packageDir: string
  ): OutMfeEntryMF[] {
    return entries.map((entry) => {
      if (!entry.exposeAssets) {
        throw new Error(
          `[${packageDir}] Entry "${entry.id}" has no exposeAssets. ` +
            `This usually means the manifest was not enriched by the build plugin. ` +
            `Rebuild the MFE package and ensure the frontxMfGts plugin is configured.`
        );
      }

      const out: OutMfeEntryMF = {
        id: entry.id,
        requiredProperties: entry.requiredProperties,
        actions: entry.actions,
        domainActions: entry.domainActions,
        manifest: outManifest,
        exposedModule: entry.exposedModule,
        exposeAssets: {
          js: {
            async: entry.exposeAssets.js.async,
            sync: entry.exposeAssets.js.sync,
          },
          css: {
            async: entry.exposeAssets.css.async,
            sync: entry.exposeAssets.css.sync,
          },
        },
      };

      if (entry.optionalProperties !== undefined) {
        out.optionalProperties = entry.optionalProperties;
      }

      return out;
    });
  }

  private renderOutputFile(configs: OutMfeManifestConfig[]): string {
    return JSON.stringify(configs, null, 2) + '\n';
  }
}

// ---------------------------------------------------------------------------
// GTS identifier collection
// ---------------------------------------------------------------------------

/** One identifier from the enriched manifest, with the path that produced it. */
interface LocatedGtsId {
  field: string;
  id: string;
}

/**
 * Collect every GTS identifier the aggregate carries, each paired with its
 * position in the enriched manifest.
 *
 * The position travels with the id because the value alone does not say where
 * to edit: the same manifest id is repeated on every entry, so reporting only
 * the string sends a reader looking through the whole file for it.
 *
 * The `schemas` documents are deliberately left out. Their `$id` and
 * `x-gts-ref` values are URI-prefixed and nested at arbitrary depth, and the
 * schema loader in @gears-frontx/gts-plugin already parses them on its own
 * terms; a second traversal here would be a second opinion about a document
 * this script otherwise copies through untouched.
 */
function collectGtsIds(mfeJson: RawEnrichedMfeJson): LocatedGtsId[] {
  const ids: LocatedGtsId[] = [];

  const add = (field: string, id: string): void => {
    ids.push({ field, id });
  };
  const addEach = (field: string, values: string[] | undefined): void => {
    values?.forEach((id, index) => add(`${field}[${index}]`, id));
  };

  add('manifest.id', mfeJson.manifest.id);

  mfeJson.domains?.forEach((domain, index) => {
    const at = `domains[${index}]`;
    add(`${at}.id`, domain.id);
    addEach(`${at}.sharedProperties`, domain.sharedProperties);
    addEach(`${at}.actions`, domain.actions);
    addEach(`${at}.extensionsActions`, domain.extensionsActions);
    addEach(`${at}.lifecycleStages`, domain.lifecycleStages);
    addEach(`${at}.extensionsLifecycleStages`, domain.extensionsLifecycleStages);
  });

  // `entries` and `extensions` are read without a guard because
  // `assertRequiredCollectionsArePresent` has already refused a manifest missing
  // either. Optional-chaining them here would turn absence into a silent pass
  // and hand the aggregate back with a collection quietly unvalidated, which is
  // the failure that check exists to make loud. `domains` is genuinely optional.
  mfeJson.entries.forEach((entry, index) => {
    const at = `entries[${index}]`;
    add(`${at}.id`, entry.id);
    add(`${at}.manifest`, entry.manifest);
    addEach(`${at}.requiredProperties`, entry.requiredProperties);
    addEach(`${at}.optionalProperties`, entry.optionalProperties);
    addEach(`${at}.actions`, entry.actions);
    addEach(`${at}.domainActions`, entry.domainActions);
  });

  mfeJson.extensions.forEach((extension, index) => {
    const at = `extensions[${index}]`;
    add(`${at}.id`, extension.id);
    add(`${at}.domain`, extension.domain);
    add(`${at}.entry`, extension.entry);
  });

  return ids;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { baseUrl: string | null } {
  const idx = argv.indexOf('--base-url');
  const baseUrl = (idx !== -1 && idx + 1 < argv.length) ? argv[idx + 1] : null;
  return { baseUrl };
}

const MFE_MANIFEST_PATH = 'dist/mfe-manifest.json';

/**
 * A path with symlinks resolved, or the path itself when it cannot be resolved.
 *
 * Node resolves the main module to its realpath, so a comparison against
 * `import.meta.url` has to resolve both sides or a symlinked checkout leaves the
 * two spellings different. `realpathSync` throws when the path does not exist,
 * which is not a reason to fail: fall back to the input and let the comparison
 * decide.
 */
function realPathOrSelf(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

// Generating is what running this file does, and only running it: a test that
// imports `ManifestGenerator` must not also rewrite the real project's
// `public/generated-mfe-manifests.json` as a side effect of the import. The
// comparison is against the real path of the file node was told to run, so it
// holds under `tsx scripts/generate-mfe-manifests.ts` as well as under node, and
// on a symlinked checkout - where comparing unresolved paths would make this
// script exit 0 having generated nothing.
const invokedPath = process.argv[1];
const isProcessEntryPoint =
  invokedPath !== undefined &&
  realPathOrSelf(resolve(invokedPath)) === realPathOrSelf(fileURLToPath(import.meta.url));

if (isProcessEntryPoint) {
  const { baseUrl } = parseArgs(process.argv.slice(2));
  const mfePackagesDir = join(process.cwd(), 'src-app/mfe_packages');
  const outputFile = join(process.cwd(), 'public/generated-mfe-manifests.json');

  try {
    new ManifestGenerator(mfePackagesDir, outputFile, MFE_MANIFEST_PATH, baseUrl).run();
  } catch (err) {
    console.error('Error generating MFE manifests:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
