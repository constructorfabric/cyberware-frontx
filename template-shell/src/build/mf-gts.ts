import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { Plugin } from 'vite';
import type { MfManifestShared as PublishedMfManifestShared } from '@gears-frontx/mfes';

/**
 * Extract the root npm package name from a shared-dep entry that may include
 * a subpath. Handles scoped packages:
 *   'react-dom/client'        → 'react-dom'
 *   '@cyberfabric/react/hooks' → '@cyberfabric/react'
 *   'react'                   → 'react'
 */
function extractRootPackageName(name: string): string {
  if (name.startsWith('@')) {
    const parts = name.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : name;
  }
  const firstSlash = name.indexOf('/');
  return firstSlash === -1 ? name : name.slice(0, firstSlash);
}

/**
 * Locates a shared dep's `package.json` across npm / pnpm / yarn-pnp
 * layouts. Tries `nodeRequire.resolve('${rootName}/package.json')` first
 * (honors each package manager's resolver) and falls back to a manual
 * walk up `node_modules` directories when the package's `exports` field
 * blocks subpath access to `package.json`.
 *
 * Returns `undefined` when the package cannot be located either way —
 * callers decide whether to throw with a specific error message.
 */
function resolvePackageJsonPath(
  nodeRequire: NodeRequire,
  startDir: string,
  rootName: string
): string | undefined {
  try {
    return nodeRequire.resolve(`${rootName}/package.json`);
  } catch {
    // Fall through — some packages' `exports` block subpath access.
  }
  let current = startDir;
  for (;;) {
    const candidate = path.join(current, 'node_modules', rootName, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

// ── Types matching mf-manifest.json structure ───────────────────────────────

interface MfManifestSharedAssets {
  js: { async: string[]; sync: string[] };
  css: { async: string[]; sync: string[] };
}

interface MfManifestShared {
  id: string;
  name: string;
  version: string;
  singleton: boolean;
  requiredVersion: string;
  assets: MfManifestSharedAssets;
}

interface MfManifestExposeAssets {
  js: { async: string[]; sync: string[] };
  css: { async: string[]; sync: string[] };
}

interface MfManifestExpose {
  id: string;
  name: string;
  assets: MfManifestExposeAssets;
  path: string;
}

interface MfManifestMetaData {
  name: string;
  type: string;
  buildInfo: { buildVersion: string; buildName: string };
  remoteEntry: { name: string; path: string; type: string };
  ssrRemoteEntry: { name: string; path: string; type: string };
  types: { path: string; name: string };
  globalName: string;
  pluginVersion: string;
  publicPath: string;
}

interface MfManifest {
  id: string;
  name: string;
  metaData: MfManifestMetaData;
  shared: MfManifestShared[];
  remotes: unknown[];
  exposes: MfManifestExpose[];
}

// ── Types matching mfe.json structure ───────────────────────────────────────

interface MfeJsonManifest {
  id: string;
  remoteEntry: string;
}

interface MfeJsonEntry {
  id: string;
  requiredProperties: string[];
  actions: string[];
  domainActions: string[];
  manifest: string;
  exposedModule: string;
}

interface MfeJsonExtensionPresentation {
  label: string;
  icon: string;
  route: string;
  order: number;
}

interface MfeJsonExtension {
  id: string;
  domain: string;
  entry: string;
  presentation: MfeJsonExtensionPresentation;
}

interface MfeJsonSchema {
  $id: string;
  [key: string]: unknown;
}

interface MfeJson {
  /**
   * Set by a package the template ships as an example or as the copy-from
   * scaffold. Declared here because the plugin reads this file, not because the
   * plugin acts on it: the plugin builds such a package like any other. The
   * consumers are the shell's manifest generation and dev orchestration, and
   * both read the flag from the source `mfe.json` on disk. `enrich` spreads it
   * into `dist/mfe-manifest.json` along with every other field it does not
   * rewrite, and that copy has no reader.
   */
  templateExample?: boolean;
  manifest: MfeJsonManifest;
  entries: MfeJsonEntry[];
  extensions: MfeJsonExtension[];
  schemas: MfeJsonSchema[];
}

// ── Types for enriched build-output manifest fields ─────────────────────────

interface EnrichedMetaData {
  publicPath: string;
  name: string;
  type: string;
  buildInfo: { buildVersion: string; buildName: string };
  remoteEntry: { name: string; path: string; type: string };
  globalName: string;
}

// `PublishedMfManifestShared` is `@gears-frontx/mfes`' `MfManifestShared`
// (name/version/chunkPath/unwrapKey/contentHash?) — imported rather than
// redeclared so the producer-local shape cannot drift from the published
// consumer contract the runtime actually reads.
type EnrichedSharedEntry = PublishedMfManifestShared;

type EnrichedManifest = MfeJsonManifest & {
  name: string;
  metaData: EnrichedMetaData;
  shared: EnrichedSharedEntry[];
};

type EnrichedMfeJsonEntry = MfeJsonEntry & {
  exposeAssets: MfManifestExposeAssets;
};

type EnrichedMfeJson = Omit<MfeJson, 'manifest' | 'entries'> & {
  manifest: EnrichedManifest;
  entries: EnrichedMfeJsonEntry[];
};

// ── Build-output manifest enricher ──────────────────────────────────────────

class MfeJsonEnricher {
  private readonly packageRoot: string;
  private readonly nodeRequire: NodeRequire;

  constructor(packageRoot: string) {
    this.packageRoot = packageRoot;
    this.nodeRequire = createRequire(path.join(packageRoot, 'package.json'));
  }

  enrich(
    mfeJson: MfeJson,
    mfManifest: MfManifest,
    sharedDeps: string[],
    sharedOutputDir: string
  ): EnrichedMfeJson {
    const metaData = this.buildMetaData(mfManifest);
    const shared = this.buildSharedEntries(sharedDeps, sharedOutputDir);
    const entries = this.buildEntries(mfeJson.entries, mfManifest.exposes);

    return {
      ...mfeJson,
      manifest: {
        ...mfeJson.manifest,
        name: mfManifest.metaData.name,
        metaData,
        shared,
      },
      entries,
    };
  }

  private buildMetaData(mfManifest: MfManifest): EnrichedMetaData {
    return {
      publicPath: mfManifest.metaData.publicPath,
      name: mfManifest.metaData.name,
      type: mfManifest.metaData.type,
      buildInfo: mfManifest.metaData.buildInfo,
      remoteEntry: mfManifest.metaData.remoteEntry,
      globalName: mfManifest.metaData.globalName,
    };
  }

  private buildSharedEntries(
    declaredDeps: string[],
    sharedOutputDir: string
  ): EnrichedSharedEntry[] {
    return declaredDeps.map((name) => {
      const fileName = `${StandaloneEsmBuilder.normalizeDepName(name)}.js`;
      const contentHash = this.computeContentHash(
        path.join(sharedOutputDir, fileName)
      );
      return {
        name,
        version: this.resolvePackageVersion(name),
        chunkPath: `shared/${fileName}`,
        unwrapKey: null,
        ...(contentHash !== undefined ? { contentHash } : {}),
      };
    });
  }

  /**
   * sha256 (hex, full 64 chars — well past the 16-char collision-safety
   * floor) of a shared dep's emitted chunk, computed over the file's final
   * on-disk bytes: after every post-process pass, including path
   * normalization, so the hash is stable across package-manager layout and
   * build-depth differences that would otherwise make two builds of the
   * same dependency at the same version hash differently. Returns
   * `undefined` when the chunk is missing rather than emitting a hash for
   * bytes that were never actually published — an absent `contentHash` is a
   * valid, well-handled manifest state; a wrong one is not.
   */
  private computeContentHash(chunkFilePath: string): string | undefined {
    try {
      const bytes = fs.readFileSync(chunkFilePath);
      return createHash('sha256').update(bytes).digest('hex');
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves the installed version of a package by locating its
   * `package.json`. Accepts subpath entries like `react-dom/client` and
   * resolves the version from the parent package's `package.json`.
   *
   * Tries `nodeRequire.resolve(\`${rootName}/package.json\`)` first so the
   * lookup works across npm, pnpm, and yarn-pnp layouts; falls back to a
   * manual `node_modules` walk when the package's `exports` field blocks
   * the subpath.
   */
  private resolvePackageVersion(packageName: string): string {
    const rootName = extractRootPackageName(packageName);
    const pkgJsonPath = resolvePackageJsonPath(
      this.nodeRequire,
      this.packageRoot,
      rootName
    );
    if (!pkgJsonPath) {
      throw new Error(
        `Cannot resolve version for "${packageName}" (root package "${rootName}") from ${this.packageRoot}`
      );
    }
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? '*';
  }

  private buildEntries(
    mfeEntries: MfeJsonEntry[],
    mfExposes: MfManifestExpose[]
  ): EnrichedMfeJsonEntry[] {
    const exposesIndex = new Map<string, MfManifestExpose>();
    for (const expose of mfExposes) {
      exposesIndex.set(expose.path, expose);
    }

    return mfeEntries.map((entry) => {
      const expose = exposesIndex.get(entry.exposedModule);
      if (!expose) {
        throw new Error(
          `[frontx-mf-gts] No expose in mf-manifest.json matches ` +
            `entry exposedModule "${entry.exposedModule}"`
        );
      }
      return {
        ...entry,
        exposeAssets: expose.assets,
      };
    });
  }
}

// ── Standalone ESM builder ──────────────────────────────────────────────────

interface SharedDepPackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface ResolvedSharedDep {
  name: string;
  externals: string[];
}

/**
 * One minted shared-dependency chunk and the sibling shared chunks its
 * emitted file actually imports — the outgoing edges of the shared-chunk
 * graph.
 *
 * `imports` comes from esbuild's metafile (the external imports left
 * unresolved in the output), NOT from the dep's declared `externals`. The
 * two differ, and the difference is the whole point: `externals` is derived
 * from package.json and marks what *may* stay unbundled, while only the
 * imports the bundled code truly emits are edges between chunks.
 * `@gears-frontx/mfes` and `@gears-frontx/gts-plugin`, for instance, declare
 * each other as dependencies and each is external to the other, yet neither
 * minted file imports the other because every cross-reference between them
 * is `import type` or JSDoc. A guard over declared externals would fail that
 * perfectly healthy build.
 */
export interface SharedChunkNode {
  name: string;
  imports: string[];
}

// ── Shared-dependency cycle guard ──────────────────────────────────────────

/**
 * The external (unbundled) import paths esbuild left in `outfile`, read from
 * a build's metafile — the outgoing edges of one minted shared chunk.
 *
 * Metafile output keys are paths relative to esbuild's working directory, so
 * the entry is matched by resolved absolute path rather than by key equality.
 * External imports carry the specifier exactly as written, which for a shared
 * dep is the bare package name the graph uses as its node key. Both
 * `import`-statement and `require-call` edges count: a CJS package bundled to
 * ESM reaches its externals through `__require()`, which `patchCjsExternals`
 * later rewrites into real ESM imports — an edge either way.
 *
 * Pure; exported for unit tests.
 */
export function externalImportsOf(
  metafile: esbuild.Metafile,
  outfile: string
): string[] {
  const target = path.resolve(outfile);
  for (const [file, output] of Object.entries(metafile.outputs)) {
    if (path.resolve(file) !== target) continue;
    return output.imports
      .filter((imported) => imported.external)
      .map((imported) => imported.path);
  }
  return [];
}

/**
 * Finds a cycle in the shared-chunk import graph, or `undefined` when the
 * graph is acyclic.
 *
 * Why this layer needs its own check: Rollup guards its own chunk graph
 * (it hoists module cycles into a single chunk and warns `CIRCULAR_CHUNK`
 * when it cannot), but the shared deps minted here are esbuild output that
 * Rollup never sees — one standalone ESM file per shared package, with every
 * sibling shared dep left external. esbuild has no `CIRCULAR_CHUNK`
 * equivalent, so nothing else can catch a cycle among these files. It is the
 * more dangerous of the two layers: every MFE mints the same shared chunks,
 * so a single cyclic shared graph breaks every MFE at once.
 *
 * Why a cycle is fatal at runtime: per-load isolation means the
 * cycle-closing import can no longer be satisfied from the origin module
 * instance (that fallback shared one instance across all loads and broke the
 * isolation property), so the import fails and the MFE never mounts.
 *
 * Algorithm: iterative depth-first search over the directed graph with the
 * classic white/grey/black colouring. The first back edge into a node still
 * on the DFS stack closes a cycle, which is returned as the node sequence in
 * traversal order with the entry node repeated at the end. A self-edge is a
 * length-1 cycle and is reported the same way. Edges pointing at names that
 * are not themselves minted shared deps are ignored (they are not chunks).
 * Linear in nodes + edges over a handful of packages, on metadata esbuild
 * produced anyway — and it writes nothing, so an acyclic graph leaves the
 * emitted output exactly as it was.
 *
 * Pure; exported for unit tests.
 */
export function findSharedDepCycle(
  chunks: readonly SharedChunkNode[]
): string[] | undefined {
  const edges = new Map<string, string[]>();
  for (const chunk of chunks) edges.set(chunk.name, []);
  for (const chunk of chunks) {
    const out = edges.get(chunk.name) as string[];
    for (const target of chunk.imports) {
      // Only sibling shared deps are chunks in this graph.
      if (edges.has(target)) out.push(target);
    }
  }

  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  for (const root of edges.keys()) {
    if (colour.get(root) !== undefined) continue;
    // Explicit work list: each frame is a node plus the index of the next
    // outgoing edge to visit, so deep graphs cannot blow the call stack.
    const frames: Array<{ node: string; edgeIndex: number }> = [
      { node: root, edgeIndex: 0 },
    ];
    colour.set(root, GREY);
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const out = edges.get(frame.node) as string[];
      if (frame.edgeIndex < out.length) {
        const next = out[frame.edgeIndex];
        frame.edgeIndex += 1;
        if (onStack.has(next)) {
          // Back edge — the cycle is the stack suffix starting at `next`.
          return [...stack.slice(stack.indexOf(next)), next];
        }
        if (colour.get(next) === undefined) {
          colour.set(next, GREY);
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, edgeIndex: 0 });
        }
      } else {
        colour.set(frame.node, BLACK);
        onStack.delete(frame.node);
        stack.pop();
        frames.pop();
      }
    }
  }

  return undefined;
}

/**
 * Formats the cycle guard failure, naming the packages on the cycle in
 * traversal order so the message points at the offending dependency edge
 * rather than merely asserting that a cycle exists.
 */
export function formatSharedDepCycleError(cycle: readonly string[]): string {
  return (
    `[frontx-mf-gts] Cyclic shared-dependency graph: ` +
    `${cycle.join(' -> ')}\n` +
    `Each shared dependency is minted as one standalone ESM file that leaves ` +
    `its sibling shared deps external, so this package cycle becomes a cycle ` +
    `between the emitted shared chunks. Every MFE mints the same shared ` +
    `chunks, so at runtime the cycle-closing import cannot be resolved within ` +
    `the load — per-load isolation forbids falling back to the origin module ` +
    `instance — and every MFE fails to mount.\n` +
    `Fix: break one edge of the cycle (make one direction 'import type' only, ` +
    `move the shared code into a third package, or stop sharing one of these ` +
    `packages).`
  );
}

class StandaloneEsmBuilder {
  private readonly sharedDeps: string[];
  private readonly outputDir: string;
  private readonly packageRoot: string;
  private readonly nodeRequire: NodeRequire;

  constructor(sharedDeps: string[], outputDir: string, packageRoot: string) {
    this.sharedDeps = sharedDeps;
    this.outputDir = outputDir;
    this.packageRoot = packageRoot;
    this.nodeRequire = createRequire(path.join(packageRoot, 'package.json'));
  }

  /**
   * Mints one standalone ESM file per shared dep.
   *
   * `onError` aborts the build (the Rollup plugin context's `this.error`);
   * it is taken as a callback so the pure resolution/cycle logic stays
   * independent of the plugin context, matching `transformLazyImports`.
   * The cycle guard reads the emitted files' real import edges, so it runs
   * once every dep is minted — and it only reads, so a healthy graph is
   * bit-for-bit unaffected by it.
   */
  async build(onError: (message: string) => never): Promise<void> {
    fs.mkdirSync(this.outputDir, { recursive: true });

    const resolved = this.resolveTransitiveDeps();

    const graph: SharedChunkNode[] = [];
    for (const dep of resolved) {
      graph.push(await this.buildEntry(dep));
    }

    // ── Guard: the minted shared chunks must form an acyclic graph ────────
    // Runs on the real emitted import edges, after minting and before the
    // manifest that publishes these chunks is written. Nothing emitted
    // depends on the check, so an acyclic graph is bit-for-bit unaffected.
    const cycle = findSharedDepCycle(graph);
    if (cycle) onError(formatSharedDepCycleError(cycle));
  }

  /**
   * For each shared dep, inspect its package.json dependencies and
   * peerDependencies. Any dep that is ALSO in the shared dep list
   * becomes an external for that dep's build.
   *
   * For subpath entries (e.g. `react-dom/client`) whose parent package
   * is also a declared shared dep, the parent is added to externals so
   * that internal `import 'react-dom'` references inside the subpath
   * bundle resolve to the shared parent blob URL at runtime.
   */
  private resolveTransitiveDeps(): ResolvedSharedDep[] {
    const sharedSet = new Set(this.sharedDeps);
    return this.sharedDeps.map((name) => {
      const pkgJsonPath = this.findPackageJsonPath(name);
      const pkg = JSON.parse(
        fs.readFileSync(pkgJsonPath, 'utf-8')
      ) as SharedDepPackageJson;
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.peerDependencies,
      };
      const transitiveExternals = Object.keys(allDeps).filter((d) =>
        sharedSet.has(d)
      );

      const rootName = extractRootPackageName(name);
      const isSubpath = rootName !== name;
      const externals =
        isSubpath && sharedSet.has(rootName)
          ? Array.from(new Set([rootName, ...transitiveExternals]))
          : transitiveExternals;

      return { name, externals };
    });
  }

  /**
   * Locates the `package.json` of a shared dep. Accepts subpath entries
   * like `react-dom/client` and resolves the parent package's
   * `package.json`.
   *
   * Tries `nodeRequire.resolve(\`${rootName}/package.json\`)` first so the
   * lookup works across npm, pnpm, and yarn-pnp layouts; falls back to a
   * manual `node_modules` walk when the package's `exports` field blocks
   * the subpath.
   */
  private findPackageJsonPath(packageName: string): string {
    const rootName = extractRootPackageName(packageName);
    const pkgJsonPath = resolvePackageJsonPath(
      this.nodeRequire,
      this.packageRoot,
      rootName
    );
    if (!pkgJsonPath) {
      throw new Error(
        `Cannot find package.json for "${packageName}" (root package "${rootName}") from ${this.packageRoot}`
      );
    }
    return pkgJsonPath;
  }

  /**
   * Mints one shared dep's standalone ESM file and reports the sibling
   * shared chunks the emitted file actually imports.
   */
  private async buildEntry(dep: ResolvedSharedDep): Promise<SharedChunkNode> {
    const outfile = path.join(
      this.outputDir,
      StandaloneEsmBuilder.normalizeDepName(dep.name) + '.js'
    );

    const plugins: esbuild.Plugin[] = [];
    if (dep.externals.length > 0) {
      plugins.push(
        StandaloneEsmBuilder.createExternalsPlugin(dep.externals)
      );
    }

    const result = await esbuild.build({
      entryPoints: [dep.name],
      bundle: true,
      format: 'esm',
      outfile,
      // Reports which imports were left unresolved in the output, feeding
      // the cycle guard. Analysis metadata only — it alters no emitted byte.
      metafile: true,
      plugins,
      platform: 'browser',
      target: 'esnext',
      logLevel: 'warning',
      // Use production builds for CJS packages (react, react-dom).
      // MFE expose chunks are production builds; mismatched dev/prod
      // react internals cause `dispatcher.getOwner is not a function`.
      define: { 'process.env.NODE_ENV': '"production"' },
    });

    // CJS packages bundled to ESM use __require() for external deps, which
    // doesn't work in browser ES module context. Post-process to replace
    // __require("dep") with proper ESM imports.
    if (dep.externals.length > 0) {
      StandaloneEsmBuilder.patchCjsExternals(outfile, dep.externals);
    }

    // CJS packages bundled to ESM only get `export default ...`. Add named
    // re-exports so `import { createContext } from "react"` works in blob URLs.
    this.patchCjsNamedExports(outfile, dep.name);

    // Canonicalize embedded module paths so identical (dep, version,
    // externals) inputs emit byte-identical output regardless of
    // package-manager layout (pnpm vs npm-flat) or build depth relative to
    // cwd. Must run last, after both patches above, and before anything
    // hashes this file's bytes (see `MfeJsonEnricher.computeContentHash`,
    // which runs later in `closeBundle` once every chunk on this list is
    // final).
    StandaloneEsmBuilder.normalizeEmbeddedModulePaths(outfile);

    const label =
      dep.externals.length > 0
        ? `(external: ${dep.externals.join(', ')})`
        : '(standalone)';
    console.log(
      `  [frontx-mf-gts] ${dep.name} -> ${path.basename(outfile)} ${label}`
    );

    return {
      name: dep.name,
      imports: externalImportsOf(result.metafile, outfile),
    };
  }

  /**
   * esbuild plugin that externalizes exact package name imports only.
   *
   * Sub-path imports (e.g. 'react/jsx-runtime') are NOT externalized — they
   * are bundled inline. Their internal imports of the parent package remain
   * external via the exact match.
   */
  private static createExternalsPlugin(
    externals: string[]
  ): esbuild.Plugin {
    const externalSet = new Set(externals);

    return {
      name: 'externalize-shared-deps',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.startsWith('.') || args.path.startsWith('/')) {
            return null;
          }
          if (externalSet.has(args.path)) {
            return { path: args.path, external: true };
          }
          return null;
        });
      },
    };
  }

  /**
   * Post-processes esbuild output to fix CJS→ESM external references.
   *
   * When esbuild bundles a CJS package to ESM format with external deps,
   * it generates `__require("react")` calls. This replaces them with ESM
   * imports.
   */
  private static patchCjsExternals(
    outfile: string,
    externals: string[]
  ): void {
    let source = fs.readFileSync(outfile, 'utf-8');

    const importLines: string[] = [];
    let patched = false;

    for (const ext of externals) {
      const escaped = ext.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const requirePattern = new RegExp(
        String.raw`__require\(["']${escaped}["']\)`,
        'g'
      );

      if (!requirePattern.test(source)) continue;

      // Reset lastIndex after test()
      requirePattern.lastIndex = 0;

      const varName = '__ext_' + ext.replace(/\W/g, '_');
      importLines.push(`import ${varName} from "${ext}";`);
      source = source.replace(requirePattern, varName);
      patched = true;
    }

    if (patched) {
      source = importLines.join('\n') + '\n' + source;
      fs.writeFileSync(outfile, source, 'utf-8');
    }
  }

  /**
   * Post-processes esbuild output to add named re-exports for CJS packages.
   *
   * esbuild wraps CJS packages with `export default require_xxx()` which
   * only provides a default export. This detects default-only exports, loads
   * the package to discover named properties, and appends named re-exports.
   */
  private patchCjsNamedExports(
    outfile: string,
    packageName: string
  ): void {
    let source = fs.readFileSync(outfile, 'utf-8');

    // Only patch if the module is a CJS-wrapped default-only export
    const defaultMatch = source.match(/^export default (.+);$/m);
    if (!defaultMatch) return;

    // Skip if named exports already exist
    if (/^export \{/m.test(source)) return;

    // Load the package at build time to discover its named exports.
    // Node's `require()` throws `ERR_REQUIRE_ESM` on ESM-only packages and
    // may throw for packages with environment-gated (Node-vs-browser)
    // export conditions — warn so silent patch-skipping is visible.
    let mod: Record<string, unknown>;
    try {
      mod = this.nodeRequire(packageName) as Record<string, unknown>;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[frontx-mf-gts] named-export patching skipped for "${packageName}": ` +
          `${reason}. Default-only export will be used in the standalone ESM; ` +
          `consumers that import named symbols may fail at runtime.`
      );
      return;
    }

    const keys = Object.keys(mod).filter(
      (k) =>
        k !== 'default' &&
        k !== '__esModule' &&
        /^[A-Za-z_$][\w$]*$/u.test(k)
    );
    if (keys.length === 0) {
      console.warn(
        `[frontx-mf-gts] named-export patching produced no keys for "${packageName}" — ` +
          `the package's require() result exposes no valid named bindings. ` +
          `If consumers import named symbols, this will fail at runtime.`
      );
      return;
    }

    // Replace `export default <expr>;` with variable + named re-exports
    const expr = defaultMatch[1];
    const replacement = [
      `var __mod_default = ${expr};`,
      `export default __mod_default;`,
      `export var { ${keys.join(', ')} } = __mod_default;`,
    ].join('\n');

    source = source.replace(defaultMatch[0], replacement);
    fs.writeFileSync(outfile, source, 'utf-8');
  }

  /**
   * Normalizes a package name for use as a filename.
   * @scope/pkg -> scope-pkg, react-dom -> react-dom
   */
  static normalizeDepName(name: string): string {
    return name.replace(/^@/, '').replace(/\//g, '-');
  }

  /**
   * Canonicalizes the embedded `node_modules` source paths esbuild writes
   * into non-minified output, so the same dependency/version/externals
   * combination produces byte-identical output regardless of package
   * manager layout or the build's depth relative to `cwd`.
   *
   * esbuild never bundles a minified path, comment, or absolute prefix into
   * these outputs — only two path-bearing forms occur, both derived from the
   * same cwd-relative path per module: the `// <path>` provenance comment
   * above each `__commonJS`-wrapped module, and that same path repeated as
   * the object key esbuild uses to name/register the wrapper (e.g.
   * `"node_modules/react-dom/cjs/react-dom.development.js"(exports, module) {`).
   * A single textual substitution handles both, since neither form needs to
   * be located independently — whichever regex matches, matches in either
   * context.
   *
   * Two layout-dependent variations are collapsed to one canonical form:
   *   - pnpm's content-addressed store segment, e.g.
   *     `node_modules/.pnpm/react-dom@19.2.8_react@19.2.8/node_modules/` →
   *     `node_modules/` (npm's flat layout never has this segment, so this
   *     only fires on pnpm output; the peer suffix after `_` is optional and
   *     part of the same segment; the enclosing `node_modules/` on both
   *     sides collapses to the single flat-layout one).
   *   - leading `../` hops before `node_modules/`, produced when esbuild's
   *     cwd sits at a different depth than the dependency's install path,
   *     e.g. `../../node_modules/` → `node_modules/`.
   *
   * Must run after `patchCjsExternals`/`patchCjsNamedExports` (both can
   * rewrite surrounding source, though neither touches these path strings)
   * and before anything hashes the file's bytes.
   */
  private static normalizeEmbeddedModulePaths(outfile: string): void {
    const source = fs.readFileSync(outfile, 'utf-8');
    const normalized = source
      // pnpm's store-path segment (with its enclosing node_modules/ on
      // both sides), with or without leading '../' hops.
      .replace(
        /(?:\.\.\/)*(?:node_modules\/)?\.pnpm\/[^/"'\s]+\/node_modules\//g,
        'node_modules/'
      )
      // Remaining depth-only '../' hops immediately preceding node_modules.
      .replace(/(?:\.\.\/)+node_modules\//g, 'node_modules/');

    if (normalized !== source) {
      fs.writeFileSync(outfile, normalized, 'utf-8');
    }
  }
}


// ── Expose CSS-delivery guard ────────────────────────────────────────────────

/**
 * Chunk facts captured during `generateBundle`, the only hook that still sees
 * Rollup's chunk graph. `ownCssModules` holds the module ids of stylesheets
 * this chunk owns that came from the package's own source: `.css` module ids
 * excluding `?inline` imports (those travel inside the JS as strings, nothing
 * to deliver separately) and excluding `node_modules` (the UI kit's
 * CSS-module styles are delivered by `adoptHostStylesIntoShadowRoot()` from
 * the host document, by design — see the `mfe-package-contract` guideline).
 */
export interface CapturedChunk {
  fileName: string;
  imports: string[];
  dynamicImports: string[];
  ownCssModules: string[];
}

/** The `ownCssModules` filter, applied to a raw Rollup module id. */
export function isOwnCssModule(moduleId: string): boolean {
  const [pathPart, query] = moduleId.split('?', 2);
  if (!pathPart.endsWith('.css')) return false;
  if (query !== undefined && /(^|&)inline(=|&|$)/.test(query)) return false;
  return !pathPart.includes('/node_modules/');
}

/**
 * Detects package-own CSS an expose needs at runtime but that
 * mf-manifest.json does not attribute to it — CSS that can never reach the
 * MFE's shadow root.
 *
 * Failure mode this guards: an exposed lifecycle (or a module in its graph)
 * imports a package-own stylesheet normally (`import './styles.css'`).
 * Rollup may hoist the extracted CSS into a chunk shared with other exposes
 * or the standalone entry; the federation manifest then reports
 * `css: { async: [], sync: [] }` for the expose, the host's stylesheet
 * injection has nothing to inject, and the screen renders unstyled with no
 * error anywhere. This turns that silence into a build failure.
 *
 * For each expose whose manifest attributes no CSS at all: walk the chunk
 * graph reachable from its declared JS assets (static and dynamic imports)
 * and collect the package-own CSS modules found there. An expose that does
 * declare CSS is trusted — the guard targets the empty-attribution hoist,
 * not attribution completeness. Pure; exported for unit tests.
 */
export function findUndeclaredExposeCss(
  exposes: readonly MfManifestExpose[],
  chunks: ReadonlyMap<string, CapturedChunk>
): Array<{ exposePath: string; missingCss: string[] }> {
  const results: Array<{ exposePath: string; missingCss: string[] }> = [];
  for (const expose of exposes) {
    if (expose.assets.css.sync.length > 0 || expose.assets.css.async.length > 0) {
      continue;
    }
    const needed = new Set<string>();
    const queue = [...expose.assets.js.sync, ...expose.assets.js.async];
    const seen = new Set<string>(queue);
    while (queue.length > 0) {
      const chunk = chunks.get(queue.pop() as string);
      if (!chunk) continue;
      for (const css of chunk.ownCssModules) needed.add(css);
      for (const next of [...chunk.imports, ...chunk.dynamicImports]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (needed.size > 0) {
      results.push({ exposePath: expose.path, missingCss: Array.from(needed) });
    }
  }
  return results;
}

/**
 * Formats the guard failure. The reliable fix is inlining: `?inline` turns
 * the stylesheet into a string bundled with the lifecycle chunk itself, and
 * `initializeStyles()` (the `ThemeAwareReactLifecycle` hook) appends it to
 * the mount container, so delivery no longer depends on manifest CSS
 * attribution at all. See the `mfe-package-contract` guideline, "CSS
 * delivery" section.
 */
export function formatUndeclaredExposeCssError(
  findings: ReadonlyArray<{ exposePath: string; missingCss: string[] }>
): string {
  const lines = findings.map(
    (f) => `  - expose '${f.exposePath}' needs: ${f.missingCss.join(', ')}`
  );
  return (
    `[frontx-mf-gts] CSS imported by an exposed module was not attributed ` +
    `to that expose in mf-manifest.json — the host injects only ` +
    `manifest-attributed CSS into the MFE's shadow root, so these styles ` +
    `would silently never render:\n${lines.join('\n')}\n` +
    `Fix: import the stylesheet with '?inline' in the lifecycle module and ` +
    `append it in an initializeStyles() override ` +
    `(see the mfe-package-contract guideline, "CSS delivery"), or keep the ` +
    `CSS in the expose's own chunk so the manifest attributes it.`
  );
}

// ── Lazy-import AST transform ───────────────────────────────────────────────

/**
 * AST shape exported by Rollup's `this.parse()` (ESTree-compliant). Only the
 * fields the transform reads are declared — the rest of the tree is opaque.
 */
interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface ImportExpressionNode extends AstNode {
  type: 'ImportExpression';
  source: AstNode;
}

/**
 * AST-level rewriter that converts dynamic `import('<relative-path>')` calls
 * into `__frontx_lazy('<relative-path>')` calls in compiled MFE chunks.
 *
 * Operates on Rollup-emitted output (post-bundle) rather than on TypeScript
 * source. Rationale: a source-level transform would replace `import('./X')`
 * before Rollup analyses the module graph, killing code-splitting — Rollup
 * would no longer see the dynamic import and would tree-shake `./X` out of
 * the build entirely. Operating in `renderChunk` preserves Rollup's
 * code-splitting (every lazy chunk is still emitted as its own file) while
 * still performing the rewrite at build time with full AST fidelity.
 *
 * Supported source patterns (after Rollup compilation, dynamic-import args
 * are always literal — Rollup constant-folds template/expression imports at
 * build time):
 *  - `import('./X.js')` — string-literal path.
 *  - `` import(`./X.js`) `` — template-literal with no embedded expressions.
 *
 * Non-statically-resolvable patterns (runtime-computed paths, dynamic
 * property lookup) emit a build-time error with file + position pointing at
 * the offending expression.
 */
class LazyImportTransformer {
  private readonly replacements: { start: number; end: number }[] = [];
  private transformedCount = 0;
  private readonly nonStatic: { node: AstNode }[] = [];

  constructor(private readonly code: string) {}

  visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) this.visit(child);
      return;
    }
    const astNode = node as AstNode;

    if (astNode.type === 'ImportExpression') {
      this.handleImportExpression(astNode as ImportExpressionNode);
    }

    for (const key of Object.keys(astNode)) {
      if (
        key === 'loc' ||
        key === 'range' ||
        key === 'start' ||
        key === 'end' ||
        key === 'type'
      ) {
        continue;
      }
      this.visit(astNode[key]);
    }
  }

  private handleImportExpression(node: ImportExpressionNode): void {
    const source = node.source;
    if (LazyImportTransformer.isStaticallyResolvable(source)) {
      this.replacements.push({
        start: node.start,
        end: node.start + 'import'.length,
      });
      this.transformedCount += 1;
      return;
    }
    // `@vite-ignore` between `import(` and the argument is the standard
    // bundler convention for an intentionally non-static dynamic import
    // (e.g. federation runtimes loading a remote by a runtime-computed URL).
    // Such imports are not FrontX lazy-import call sites — leave them
    // untouched rather than erroring or rewriting.
    if (this.code.slice(node.start, source.start).includes('@vite-ignore')) {
      return;
    }
    this.nonStatic.push({ node: source });
  }

  private static isStaticallyResolvable(node: AstNode): boolean {
    if (node.type === 'Literal' && typeof node.value === 'string') return true;
    if (
      node.type === 'TemplateLiteral' &&
      Array.isArray(node.expressions) &&
      node.expressions.length === 0
    ) {
      return true;
    }
    if (
      node.type === 'BinaryExpression' &&
      node.operator === '+'
    ) {
      const left = node.left as AstNode | undefined;
      const right = node.right as AstNode | undefined;
      return (
        left !== undefined &&
        right !== undefined &&
        LazyImportTransformer.isStaticallyResolvable(left) &&
        LazyImportTransformer.isStaticallyResolvable(right)
      );
    }
    return false;
  }

  apply(code: string): string {
    if (this.replacements.length === 0) return code;
    // Reverse order so each replacement preserves the offsets of earlier ones.
    const sorted = [...this.replacements].sort((a, b) => b.start - a.start);
    let out = code;
    for (const r of sorted) {
      out = out.slice(0, r.start) + '__frontx_lazy' + out.slice(r.end);
    }
    return out;
  }

  count(): number {
    return this.transformedCount;
  }

  nonStaticNodes(): readonly { node: AstNode }[] {
    return this.nonStatic;
  }
}

/**
 * Substrings that identify chunks `@module-federation/vite` emits as part
 * of its own runtime — federation share initialisation, remote-entry
 * bootstrap, virtual expose maps, the share-load helper indirection. The
 * lazy-import transform MUST skip these chunks: their `import()` calls are
 * federation's internal protocol (share loading, container init), not
 * vendor lazy chunks. Substituting `__frontx_lazy` for `import` there would
 * silently break federation's share/remote-entry mechanics.
 *
 * Kept in lockstep with `@module-federation/vite`'s
 * `FEDERATION_CONTROL_CHUNK_HINTS` list (and `__loadShare__` helper
 * chunks emitted under the same plugin). Updates to the federation
 * version may require expanding this list.
 */
const FEDERATION_CONTROL_CHUNK_PATTERNS: readonly string[] = [
  'hostInit',
  'virtualExposes',
  'localSharedImportMap',
  'remoteEntry',
  '__loadShare__',
  '__federation_',
];

function isFederationControlChunk(fileName: string): boolean {
  return FEDERATION_CONTROL_CHUNK_PATTERNS.some((hint) =>
    fileName.includes(hint)
  );
}

/**
 * Run the lazy-import AST transform on a compiled chunk. Returns the
 * rewritten code and transform count, or `null` if nothing changed.
 *
 * The parser is the caller-provided Rollup `parse` — using Rollup's bundled
 * acorn means no new dependency in the plugin and exact compatibility with
 * the chunk syntax Rollup itself emits.
 *
 * Non-static dynamic imports are surfaced via the caller-provided `error`
 * callback (Rollup's `this.error`); the caller decides how to format
 * file/position context for the message.
 */
function transformLazyImports(
  code: string,
  parse: (input: string) => unknown,
  error: (message: string, pos: number) => never,
  chunkFileName: string
): { code: string; count: number } | null {
  // Fast skip — nothing to do for chunks without a dynamic import.
  if (!code.includes('import(')) return null;

  let ast: unknown;
  try {
    ast = parse(code);
  } catch {
    // Parse failure here means another plugin will surface the issue with a
    // proper diagnostic. We don't mask it by throwing our own error.
    return null;
  }

  const transformer = new LazyImportTransformer(code);
  transformer.visit(ast);

  for (const { node } of transformer.nonStaticNodes()) {
    error(
      `[frontx-mf-gts] Non-statically-resolvable dynamic import in compiled chunk ` +
        `'${chunkFileName}'. Lazy-import paths MUST be string literals, ` +
        `constant template literals, or constant string concatenation so the ` +
        `vendor MFE's runtime can resolve them through the per-load blob URL ` +
        `chain. See architecture/ADR/0012-lazy-import-resolution.md.`,
      node.start
    );
  }

  if (transformer.count() === 0) return null;

  return { code: transformer.apply(code), count: transformer.count() };
}

/**
 * Creates the frontx-mf-gts Vite plugin.
 *
 * Runs in `closeBundle` after `@module-federation/vite`. Builds standalone
 * ESM modules for shared deps and writes `{outDir}/mfe-manifest.json` with
 * manifest metadata, shared dep info, and per-entry expose assets.
 *
 * The package root is resolved from Vite's `config.root` — no `__dirname`
 * argument needed.
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { frontxMfGts } from '@gears-frontx/frontx-template-shell/build/mf-gts';
 *
 * export default defineConfig({
 *   plugins: [react(), federation({ ... }), frontxMfGts()],
 * });
 * ```
 */
export function frontxMfGts(): Plugin {
  let packageRoot = '';
  let distDirPath = '';
  let resolvedExternals: string[] = [];
  const capturedChunks = new Map<string, CapturedChunk>();

  return {
    name: 'frontx-mf-gts',
    // Run after all other plugins, including @module-federation/vite, so
    // that dist/mf-manifest.json is already on disk.
    enforce: 'post',

    // ── Lazy-import AST transform (build-time half of ADR-0022) ─────────
    // Rewrites every dynamic `import('<rel>')` in compiled MFE chunks to
    // `__frontx_lazy('<rel>')`. The handler-side `__frontx_lazy` runtime
    // resolver then fetches the lazy chunk, rewrites its bare specifiers
    // against the parent load's `sharedDepBlobUrls`, and mints a per-load
    // blob URL — preserving per-load isolation for lazy chunks.
    //
    // Hook choice: `renderChunk` (post-bundle) rather than `transform`
    // (pre-bundle). A pre-bundle transform on TS source would replace
    // `import('./X')` before Rollup analyses the module graph, killing
    // code-splitting. `renderChunk` operates after Rollup has emitted
    // chunks for every lazy import, so the transform preserves Rollup's
    // splitting while still performing an AST-level rewrite at build
    // time — matching the ADR's intent ("build-time AST rewrite, not
    // runtime regex on compiled output").
    renderChunk(code, chunk) {
      // Skip federation control chunks: `@module-federation/vite` generates
      // its own runtime chunks (`hostInit`, `virtualExposes`,
      // `localSharedImportMap`, `remoteEntry`, federation share-bootstrap
      // helpers) whose dynamic-import calls are part of federation's
      // internal protocol, NOT vendor lazy loading. Transforming them
      // would replace federation's `import()` runtime hooks with a
      // `__frontx_lazy` identifier federation has no awareness of, breaking
      // federation's share-init and remote-entry mechanics.
      if (isFederationControlChunk(chunk.fileName)) return null;

      const result = transformLazyImports(
        code,
        (input) => this.parse(input),
        (message, pos) => this.error({ message, pos }),
        chunk.fileName
      );
      if (result === null) return null;
      console.log(
        `[frontx-mf-gts] transformed ${result.count} dynamic import(s) in ${chunk.fileName}`
      );
      // No source map emitted: the byte-for-byte replacements (`import` → `__frontx_lazy`)
      // shift offsets by a constant 5 per call. Downstream sourcemap accuracy
      // for those exact lines degrades to the nearest preceding token — an
      // acceptable trade since the transformed sites are FrontX runtime
      // plumbing, not vendor source debugging targets.
      return { code: result.code, map: null };
    },

    configResolved(config) {
      packageRoot = config.root;
      distDirPath = config.build?.outDir ?? 'dist';
      // Derive shared deps from rollupOptions.external so they stay in sync
      // with what the build actually externalizes. Sub-path imports and
      // function-form externals are not supported here — the handler
      // runtime only rewrites exact bare specifiers anyway.
      const ext = config.build?.rollupOptions?.external;
      if (Array.isArray(ext)) {
        resolvedExternals = ext.filter(
          (e): e is string => typeof e === 'string'
        );
      } else {
        if (ext !== undefined) {
          console.warn(
            '[frontx-mf-gts] rollupOptions.external is not a string[]; ' +
              'no shared deps will be derived for auto-sharing.'
          );
        }
        resolvedExternals = [];
      }
    },

    // Capture the chunk graph while it is still visible — closeBundle (where
    // the manifests are read) runs after Rollup discards it. `moduleIds`
    // still lists the extracted CSS modules a chunk owned; the CSS-delivery
    // guard below checks them against the federation manifest's per-expose
    // CSS attribution.
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        capturedChunks.set(fileName, {
          fileName,
          imports: [...output.imports],
          dynamicImports: [...output.dynamicImports],
          ownCssModules: output.moduleIds.filter(isOwnCssModule),
        });
      }
    },

    async closeBundle() {
      const distDir = path.isAbsolute(distDirPath)
        ? distDirPath
        : path.join(packageRoot, distDirPath);
      const mfeJsonPath = path.join(packageRoot, 'mfe.json');
      const mfeJsonManifestPath = path.join(distDir, 'mfe-manifest.json');

        // ── Read inputs ─────────────────────────────────────────────────────

        const mfeJson = JSON.parse(
          fs.readFileSync(mfeJsonPath, 'utf-8')
        ) as MfeJson;

        const mfManifestPath = path.join(distDir, 'mf-manifest.json');
        if (!fs.existsSync(mfManifestPath)) {
          throw new Error(
            `[frontx-mf-gts] mf-manifest.json not found at '${mfManifestPath}'. ` +
              `The Module Federation build for this MFE did not complete ` +
              `successfully — check the MFE's own build output above for ` +
              `the real failure.`
          );
        }
        const mfManifest = JSON.parse(
          fs.readFileSync(mfManifestPath, 'utf-8')
        ) as MfManifest;

        // ── Guard: every stylesheet an expose needs must be deliverable ─────
        const undeclaredCss = findUndeclaredExposeCss(
          mfManifest.exposes,
          capturedChunks
        );
        if (undeclaredCss.length > 0) {
          throw new Error(formatUndeclaredExposeCssError(undeclaredCss));
        }

        // With shared:{}, the MF 2.0 build no longer produces:
        //   - localSharedImportMap (no shared dep chunks)
        //   - __mf_init__ keys (no FederationHost initialization)
        //   - shared dep proxy/library chunks
        // The plugin only needs mf-manifest.json for expose asset paths.

        // ── Build standalone ESMs for shared deps ───────────────────────────

        const sharedDeps = resolvedExternals;
        const sharedOutputDir = path.join(distDir, 'shared');
        if (sharedDeps.length > 0) {
          const esmBuilder = new StandaloneEsmBuilder(
            sharedDeps,
            sharedOutputDir,
            packageRoot
          );
          console.log(
            '[frontx-mf-gts] Building shared deps as standalone ESM...'
          );
          await esmBuilder.build((message) => this.error({ message }));
          console.log('[frontx-mf-gts] Shared deps build complete.');
        }

        // ── Write enriched build-output manifest ─────────────────────────────
        // `sharedOutputDir` lets the enricher hash each shared dep's final
        // emitted bytes (post every post-process pass, including path
        // normalization) — hashing cannot live in `buildSharedEntries`
        // above because that runs before the chunks exist on disk.

        const enricher = new MfeJsonEnricher(packageRoot);
        const enrichedMfeJson = enricher.enrich(
          mfeJson,
          mfManifest,
          sharedDeps,
          sharedOutputDir
        );

        fs.writeFileSync(
          mfeJsonManifestPath,
          JSON.stringify(enrichedMfeJson, null, 2) + '\n',
          'utf-8'
        );

        console.log(`[frontx-mf-gts] enriched ${mfeJsonManifestPath}`);

        // ── Repair lifecycle chunks whose default export was rewritten ─
        // Each `entries[].exposedModule` writes `export default <lifecycle>`
        // at the source level. Rollup may consolidate a heavy lifecycle
        // (large transitive footprint, lazy sub-modules) with sibling
        // shared code into a single chunk that rewrites the entry's
        // `export default <X>` to a namespace-aliased re-export like
        // `export { ..., oa as q, ... }`, leaving the chunk's namespace
        // with no `default` field. The MfeHandler reads
        // `moduleRecord['default']` and surfaces the breakage as
        // `Module './lifecycle-uikit' must implement MfeEntryLifecycle
        // interface (mount/unmount)` at host runtime.
        //
        // To keep `MfeHandler.loadInternal()` simple (it reads `default`
        // only), the plugin repairs the chunk: detects the consolidation
        // shape, identifies the lifecycle variable from the synthesized
        // frozen-namespace object, and appends an explicit
        // `export default <lifecycle>` to the chunk file. The repair runs
        // post-bundle (rollup's chunk emission is complete), so the
        // host-side `import()` of the chunk picks up the added default.
        //
        // Throws when neither a clean default-export nor the consolidation
        // pattern is detected — that's a true plugin bug worth surfacing
        // at build time rather than at runtime.
        const hasDefaultExport = (src: string): boolean => {
          // `export default ...` — direct default.
          if (/export\s+default\s/u.test(src)) return true;
          // `export { X as default }` — locate `as default` then verify the
          // surrounding context is inside an `export { … }` block. Scanning
          // forward over each match avoids the unbounded `[^}]*` Sonar flagged.
          const asDefaultRegex = /\bas\s+default\b/gu;
          for (let m = asDefaultRegex.exec(src); m !== null; m = asDefaultRegex.exec(src)) {
            const openBrace = src.lastIndexOf('{', m.index);
            const closeBrace = src.indexOf('}', m.index);
            if (openBrace === -1 || closeBrace === -1) continue;
            const before = src.slice(0, openBrace);
            if (/export\s*$/u.test(before)) return true;
          }
          return false;
        };

        const findConsolidatedNamespaces = (src: string): Array<{ ns: string; defaultVar: string }> => {
          // Walk each `=Object.freeze(Object.defineProperty(` occurrence and
          // parse it incrementally, avoiding the long monolithic regex Sonar
          // flagged on S5852/S5843.
          const out: Array<{ ns: string; defaultVar: string }> = [];
          const idTail = /[\w$]/u;
          const isIdHead = (c: string): boolean => /[A-Za-z_$]/u.test(c);
          const objectFreeze = 'Object.freeze(Object.defineProperty(';
          let cursor = 0;
          for (;;) {
            const idx = src.indexOf(objectFreeze, cursor);
            if (idx === -1) break;
            cursor = idx + objectFreeze.length;
            // Walk backwards from idx, skipping whitespace and `=`, then read the namespace identifier.
            let p = idx - 1;
            while (p >= 0 && src[p] === ' ') p--;
            if (p < 0 || src[p] !== '=') continue;
            p--;
            while (p >= 0 && src[p] === ' ') p--;
            const idEnd = p + 1;
            while (p >= 0 && idTail.test(src[p])) p--;
            const idStart = p + 1;
            if (idStart >= idEnd || !isIdHead(src[idStart])) continue;
            const ns = src.slice(idStart, idEnd);
            // After `defineProperty(` expect `{__proto__:null,default:<X>}`.
            const objectStart = src.indexOf('{', cursor);
            if (objectStart === -1) continue;
            const objectEnd = src.indexOf('}', objectStart);
            if (objectEnd === -1) continue;
            const objectBody = src.slice(objectStart + 1, objectEnd);
            const defaultMatch = /__proto__\s*:\s*null\s*,\s*default\s*:\s*([A-Za-z_$][\w$]*)/u.exec(objectBody);
            if (!defaultMatch) continue;
            // After the inner object check that the remaining args carry the `Module` tag.
            const tail = src.slice(objectEnd + 1, Math.min(src.length, objectEnd + 200));
            if (!/Symbol\.toStringTag\s*,\s*\{\s*value\s*:\s*"Module"/u.test(tail)) continue;
            out.push({ ns, defaultVar: defaultMatch[1] });
            cursor = objectEnd + 1;
          }
          return out;
        };

        const extractExportedNamespaces = (src: string): Set<string> => {
          // Replaces the `/export\s*\{\s*([^}]*)\s*\}/gu` extractor by
          // bracket-walking each `export {` occurrence.
          const out = new Set<string>();
          const exportKw = /\bexport\s*\{/gu;
          for (let m = exportKw.exec(src); m !== null; m = exportKw.exec(src)) {
            const openIdx = src.indexOf('{', m.index);
            const closeIdx = openIdx === -1 ? -1 : src.indexOf('}', openIdx);
            if (openIdx === -1 || closeIdx === -1) continue;
            const body = src.slice(openIdx + 1, closeIdx);
            for (const part of body.split(',')) {
              const aliasMatch = /^\s*([A-Za-z_$][\w$]*)\s+as\s+[A-Za-z_$][\w$]*\s*$/u.exec(part);
              if (aliasMatch) out.add(aliasMatch[1]);
            }
            exportKw.lastIndex = closeIdx;
          }
          return out;
        };

        for (const entry of enrichedMfeJson.entries) {
          const syncChunks = entry.exposeAssets?.js?.sync ?? [];
          for (const relChunk of syncChunks) {
            const chunkPath = path.join(distDir, relChunk);
            if (!fs.existsSync(chunkPath)) continue;
            const source = fs.readFileSync(chunkPath, 'utf-8');
            if (hasDefaultExport(source)) continue;

            // Find every `Object.freeze(Object.defineProperty({__proto__:null,default:Y},...))`
            // in the chunk — one per co-located source module — and pick the
            // one whose namespace name appears in the chunk's export list.
            const namespaceMatches = findConsolidatedNamespaces(source);
            if (namespaceMatches.length === 0) {
              const tail = source.slice(Math.max(0, source.length - 200));
              throw new Error(
                `[frontx-mf-gts] Lifecycle chunk '${relChunk}' does not ` +
                  `export 'default' cleanly and shows no recognizable ` +
                  `consolidation pattern to repair. Expected either ` +
                  `\`export default ...\` / \`export{...as default}\` or ` +
                  `a namespace-wrapped default ` +
                  `(\`<ns>=Object.freeze(Object.defineProperty({__proto__:null,default:<X>},...))\`). ` +
                  `Got tail (last 200 chars): ${tail}.`
              );
            }

            const exportedNamespaces = extractExportedNamespaces(source);

            let lifecycleVar: string | undefined;
            for (const { ns, defaultVar } of namespaceMatches) {
              if (exportedNamespaces.has(ns)) {
                lifecycleVar = defaultVar;
                break;
              }
            }
            // Fallback: the entry module's namespace is typically the
            // last one rollup emits in a consolidated chunk.
            lifecycleVar ??= namespaceMatches[namespaceMatches.length - 1].defaultVar;

            const repaired = source.trimEnd() + `\nexport default ${lifecycleVar};\n`;
            fs.writeFileSync(chunkPath, repaired, 'utf-8');
            console.log(
              `[frontx-mf-gts] repaired lifecycle chunk '${relChunk}' — ` +
                `appended \`export default ${lifecycleVar}\` for entry ` +
                `'${entry.exposedModule}' (consolidated with sibling code)`
            );
          }
        }
      },
    };
}

export { LazyImportTransformer, transformLazyImports };
