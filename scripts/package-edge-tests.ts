#!/usr/bin/env node

/**
 * FrontX Ecosystem Package Edge Tests
 *
 * Asserts the package.json-manifest half of the boundary model in
 * architecture/DESIGN.md §1.3 (`cpt-frontx-adr-core-package-boundaries`).
 * `npm run arch:check` asserts the import-graph half via dependency-cruiser and
 * greps; neither sees declared-but-unimported edges, so this guard covers what
 * the manifests claim:
 *
 * - Every ecosystem package's `@gears-frontx/*` dependencies are a subset of the
 *   edges the boundary model permits (ALLOWED_ECOSYSTEM_EDGES).
 * - The edges the model requires still exist (REQUIRED_ECOSYSTEM_EDGES) — so
 *   dropping the type-substrate port fails loudly instead of silently passing.
 * - The `standalone` property each published library declares
 *   (PUBLISHED_LIBRARY_PROPERTIES) is consistent with its edge allowlist, so the
 *   model cannot claim a property its own permissions contradict.
 * - No ecosystem package declares a dependency on a template-side package.
 *   Enforced by shape: the allowlists name no template package, so this holds
 *   without the guard knowing the template's identity or location.
 * - Every workspace on disk is accounted for by the boundary model. The
 *   `workspaces` field is a glob while the layer lists are hand-maintained, so
 *   without a reciprocal check a newly added package is simply unguarded — the
 *   guard passes because it never looks. That is the same silent-drift shape as
 *   a rule that cannot match anything (#476), and it happened for real:
 *   `packages/telemetry` landed via #496 and no list knew about it.
 *
 * Covers both workspace roots — `packages/*` and `internal/*` — since a
 * dependency on a shared config package is as much a declared workspace edge as
 * any other, and checks `dependencies`/`peerDependencies` separately from
 * `devDependencies` so a runtime edge cannot pass on a dev-group allowance.
 *
 * Integrity of the guard *configs* themselves is `npm run arch:guards`
 * (scripts/verify-guard-configs.ts), not this script.
 *
 * Replaces the former `sdk-layer-tests.ts`, which encoded the retired
 * SDK -> framework -> react chain over packages that emigrated to the
 * templates repository in #456.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Load the boundary model from the same module the depcruise rules consume, so
// the manifest guard and the import-graph rules cannot drift apart.
// See internal/depcruise-config/layer-constants.cjs.
const require = createRequire(import.meta.url);
interface AllowedEdges {
  runtime?: readonly string[];
  dev?: readonly string[];
}

const LAYER_CONSTANTS = require('../internal/depcruise-config/layer-constants.cjs') as {
  PUBLISHED_LIBRARY_PROPERTIES: Readonly<
    Record<string, Readonly<{ core: boolean; standalone: boolean }>>
  >;
  PUBLISHED_LIBRARY_PACKAGES: readonly string[];
  PROJECTS_ORCHESTRATION_PACKAGES: readonly string[];
  BUILD_INTERNALS_PACKAGES: readonly string[];
  ECOSYSTEM_PACKAGES: readonly string[];
  ECOSYSTEM_PACKAGE_DIRS: Readonly<Record<string, string>>;
  ALLOWED_ECOSYSTEM_EDGES: Readonly<Record<string, AllowedEdges>>;
  REQUIRED_ECOSYSTEM_EDGES: readonly (readonly [string, string, string])[];
  TYPE_SUBSTRATE_PORT_MANIFEST_EDGES: readonly (readonly [string, string])[];
};

const {
  PUBLISHED_LIBRARY_PROPERTIES,
  PUBLISHED_LIBRARY_PACKAGES,
  PROJECTS_ORCHESTRATION_PACKAGES,
  BUILD_INTERNALS_PACKAGES,
  ECOSYSTEM_PACKAGES,
  ECOSYSTEM_PACKAGE_DIRS,
  ALLOWED_ECOSYSTEM_EDGES,
  REQUIRED_ECOSYSTEM_EDGES,
  TYPE_SUBSTRATE_PORT_MANIFEST_EDGES,
} = LAYER_CONSTANTS;

/**
 * Repo root derived from this file's own location, not `process.cwd()`: the
 * guard must report the same thing whether it is run via `npm run arch:edges`
 * from the root, from a pre-commit hook, or from inside a package directory.
 * Under cwd resolution the last two silently find no manifests at all.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Ecosystem packages live under two workspace roots — `packages/*` and
 * `internal/*` — so the directory comes from the shared map, never from a
 * hardcoded prefix. Template-side packages live in the templates repository
 * and are deliberately absent from the map: the ecosystem guard must not
 * reach into template territory (see #456, #476).
 */
function resolvePackageDir(pkgName: string): string {
  const dir = ECOSYSTEM_PACKAGE_DIRS[pkgName];
  if (dir === undefined) {
    // Every name in ECOSYSTEM_PACKAGES is built from the same lists that build
    // the map, so this is unreachable unless the two are edited apart.
    throw new Error(
      `No directory mapped for '${pkgName}'. ECOSYSTEM_PACKAGES and ECOSYSTEM_PACKAGE_DIRS have diverged in layer-constants.cjs.`
    );
  }
  return path.join(REPO_ROOT, dir);
}

/**
 * Which layer (or stated non-layer category) a package belongs to, for test
 * naming.
 *
 * Throws rather than returning a catch-all, for the same reason
 * `resolvePackageDir` does. `ECOSYSTEM_PACKAGES` is the concatenation of exactly
 * the classifications tested here, and `testAllowedEdges` is the only caller, so
 * no argument can reach the end of this function. The previous
 * `return 'Unlayered'` looked like the safety net for an unclassified package
 * and was not one — it was unreachable, while a package on disk that no list
 * mentions was never visited at all. `testWorkspaceCoverage` is the real
 * reciprocal check; leaving a dead fallback next to it invites the reader to
 * believe this function shares the work.
 */
function layerOf(pkgName: string): string {
  if (PUBLISHED_LIBRARY_PACKAGES.includes(pkgName)) return 'Published lib';
  if (PROJECTS_ORCHESTRATION_PACKAGES.includes(pkgName)) return 'Orchestration';
  if (BUILD_INTERNALS_PACKAGES.includes(pkgName)) return 'Build internals';
  throw new Error(
    `'${pkgName}' is in ECOSYSTEM_PACKAGES but in none of the membership lists. ` +
      `The lists and their concatenation have been edited apart in layer-constants.cjs.`
  );
}

function readPackageJson(packageDir: string): PackageJson | null {
  const pkgPath = path.join(packageDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }
  return JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
}

/** The `@gears-frontx/*` names a manifest declares in one dependency group. */
function ecosystemDepsIn(group: Record<string, string> | undefined): string[] {
  return Object.keys(group ?? {})
    .filter((dep) => dep.startsWith('@gears-frontx/'))
    .sort();
}

/**
 * `@gears-frontx/*` edges split by what the group means, matching the shape of
 * ALLOWED_ECOSYSTEM_EDGES.
 *
 * - `runtime` — `dependencies` + `peerDependencies`: ships to consumers, so it
 *   is the layering proper.
 * - `dev` — `devDependencies`: development-time only, but still checked. A
 *   boundary-crossing coupling must not be able to hide by being declared here
 *   (a common shape for types-only or test-only pins), which is why devDeps are
 *   allowlisted rather than ignored.
 */
function getEcosystemDependencies(pkg: PackageJson): { runtime: string[]; dev: string[] } {
  return {
    runtime: [
      ...new Set([...ecosystemDepsIn(pkg.dependencies), ...ecosystemDepsIn(pkg.peerDependencies)]),
    ].sort(),
    dev: ecosystemDepsIn(pkg.devDependencies),
  };
}

/** Every declared edge, both groups, for the required-edge check. */
function getAllEcosystemDependencies(pkg: PackageJson): string[] {
  const { runtime, dev } = getEcosystemDependencies(pkg);
  return [...new Set([...runtime, ...dev])].sort();
}

/**
 * Test: every ecosystem package's @gears-frontx edges are within its allowlist,
 * checked per dependency group so a runtime edge cannot pass on the strength of
 * a dev-group allowance.
 */
function testAllowedEdges(): TestResult[] {
  const results: TestResult[] = [];

  for (const pkgName of ECOSYSTEM_PACKAGES) {
    const layer = layerOf(pkgName);
    const dir = ECOSYSTEM_PACKAGE_DIRS[pkgName];
    const pkg = readPackageJson(resolvePackageDir(pkgName));

    if (!pkg) {
      // A missing manifest means the layering lists a package that no longer
      // exists. That is the exact drift this guard exists to catch, so it fails
      // rather than skipping (the old script skipped, which is how #476 hid).
      results.push({
        name: `${layer} @gears-frontx/${pkgName}: Only permitted @gears-frontx edges`,
        passed: false,
        message: `No package.json at ${dir}/ — layer membership in layer-constants.cjs is stale`,
      });
      continue;
    }

    const allowed = ALLOWED_ECOSYSTEM_EDGES[pkgName] ?? {};
    const declared = getEcosystemDependencies(pkg);

    for (const group of ['runtime', 'dev'] as const) {
      const permitted = allowed[group] ?? [];
      const invalid = declared[group].filter((dep) => !permitted.includes(dep));

      results.push({
        name: `${layer} @gears-frontx/${pkgName}: Only permitted ${group} edges`,
        passed: invalid.length === 0,
        message:
          invalid.length === 0
            ? `Permitted ${group} edges: ${declared[group].join(', ') || 'none'}`
            : `Forbidden ${group} edges: ${invalid.join(', ')} (permitted: ${permitted.join(', ') || 'none'})`,
      });
    }
  }

  return results;
}

/**
 * Every workspace directory that actually exists on disk, resolved from the
 * root manifest's `workspaces` globs.
 *
 * Only the two glob shapes this repo uses are supported — a literal path and a
 * single trailing `/*`. Anything else throws rather than being skipped: a glob
 * this function silently ignored would hide exactly the packages the coverage
 * check exists to find.
 */
function discoverWorkspaceDirs(): string[] {
  // @cpt-begin:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-discover
  const rootPkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')
  ) as { workspaces?: string[] };
  const globs = rootPkg.workspaces ?? [];
  const dirs: string[] = [];

  for (const glob of globs) {
    if (!glob.includes('*')) {
      if (existsSync(path.join(REPO_ROOT, glob, 'package.json'))) dirs.push(glob);
      continue;
    }
    if (!glob.endsWith('/*') || glob.slice(0, -2).includes('*')) {
      throw new Error(
        `Unsupported workspace glob '${glob}' in the root package.json. ` +
          `discoverWorkspaceDirs() handles a literal path or a single trailing '/*'; ` +
          `extend it rather than leaving the glob's packages unchecked.`
      );
    }
    const root = glob.slice(0, -2);
    const rootPath = path.join(REPO_ROOT, root);
    if (!existsSync(rootPath)) continue;
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(path.join(rootPath, entry.name, 'package.json'))) {
        dirs.push(`${root}/${entry.name}`);
      }
    }
  }

  return dirs.sort();
  // @cpt-end:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-discover
}

/**
 * Test: the boundary model covers every workspace, in both directions.
 *
 * `testAllowedEdges` already fails on a listed package whose manifest is gone.
 * This is the reciprocal: a package on disk that no list mentions, and a listed
 * package with no allowlist entry. Without the first, adding a workspace opts it
 * out of every guard by default — the guard stays green because nothing points
 * it at the new package. Without the second, `ALLOWED_ECOSYSTEM_EDGES[pkg] ?? {}`
 * quietly stands in for a reviewed decision.
 */
// @cpt-dod:cpt-frontx-dod-ecosystem-governance-total-classification-enforced:p1
// @cpt-algo:cpt-frontx-algo-ecosystem-governance-total-classification:p1
function testWorkspaceCoverage(): TestResult[] {
  const results: TestResult[] = [];
  // @cpt-begin:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-unmapped
  const known = new Set(Object.values(ECOSYSTEM_PACKAGE_DIRS));
  const unmapped = discoverWorkspaceDirs().filter((dir) => !known.has(dir));

  results.push({
    name: 'Boundary model covers every workspace',
    passed: unmapped.length === 0,
    message:
      unmapped.length === 0
        ? `All ${known.size} workspaces are classified`
        : `Unclassified workspace(s): ${unmapped.join(', ')} — classify each in ` +
          `internal/depcruise-config/layer-constants.cjs (PUBLISHED_LIBRARY_PROPERTIES, ` +
          `PROJECTS_ORCHESTRATION_PACKAGES or BUILD_INTERNALS_PACKAGES). An unclassified ` +
          `package is exempt from every boundary guard.`,
  });
  // @cpt-end:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-unmapped

  // @cpt-begin:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-unlisted
  const unallowlisted = ECOSYSTEM_PACKAGES.filter(
    (pkgName) => ALLOWED_ECOSYSTEM_EDGES[pkgName] === undefined
  );

  results.push({
    name: 'Every classified package has an explicit edge allowlist',
    passed: unallowlisted.length === 0,
    message:
      unallowlisted.length === 0
        ? 'All layer members have an ALLOWED_ECOSYSTEM_EDGES entry'
        : `No ALLOWED_ECOSYSTEM_EDGES entry for: ${unallowlisted.join(', ')}`,
  });
  // @cpt-end:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-unlisted

  // @cpt-begin:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-return
  return results;
  // @cpt-end:cpt-frontx-algo-ecosystem-governance-total-classification:p1:inst-tc-return
}

/**
 * Test: the standalone property is consistent with the edge allowlist.
 *
 * `standalone` (DESIGN §1.3) means no intra-ecosystem runtime edge except the
 * type-substrate port. The property and the allowlist are both authored data,
 * so nothing structural stops them drifting apart — an allowlist entry widened
 * while `PUBLISHED_LIBRARY_PROPERTIES` still claims `standalone: true` would
 * leave the model asserting a property its own permissions contradict. Checked
 * against the *allowlist* rather than the manifests because `testAllowedEdges`
 * already holds the manifests to the allowlist; this closes the remaining gap
 * between the allowlist and the property it is supposed to express. Dev-group
 * edges are exempt: the property is about the shipped dependency graph, and
 * build-time config edges are held to the allowlist separately.
 */
function testStandaloneProperty(): TestResult[] {
  const results: TestResult[] = [];
  const portEdges = new Set(
    TYPE_SUBSTRATE_PORT_MANIFEST_EDGES.map(([pkgName, dep]) => `${pkgName} -> ${dep}`)
  );

  for (const pkgName of PUBLISHED_LIBRARY_PACKAGES) {
    if (!PUBLISHED_LIBRARY_PROPERTIES[pkgName].standalone) continue;

    const runtime = ALLOWED_ECOSYSTEM_EDGES[pkgName]?.runtime ?? [];
    const unexplained = runtime.filter((dep) => !portEdges.has(`${pkgName} -> ${dep}`));

    results.push({
      name: `Published lib @gears-frontx/${pkgName}: standalone property holds`,
      passed: unexplained.length === 0,
      message:
        unexplained.length === 0
          ? runtime.length === 0
            ? 'No intra-ecosystem runtime edge permitted'
            : `Only the type-substrate port permitted: ${runtime.join(', ')}`
          : `Allowlisted runtime edge(s) the standalone property forbids: ${unexplained.join(', ')} — ` +
            `remove the edge, or change the property in PUBLISHED_LIBRARY_PROPERTIES (an ` +
            `architecture decision, not a fix).`,
    });
  }

  return results;
}

/**
 * Test: the edges the boundary model mandates are still declared.
 */
function testRequiredEdges(): TestResult[] {
  return REQUIRED_ECOSYSTEM_EDGES.map(([pkgName, dependency, description]) => {
    const testName = `${description}: @gears-frontx/${pkgName} -> ${dependency}`;
    const pkg = readPackageJson(resolvePackageDir(pkgName));

    if (!pkg) {
      return {
        name: testName,
        passed: false,
        message: `No package.json at ${ECOSYSTEM_PACKAGE_DIRS[pkgName]}/`,
      };
    }

    const present = getAllEcosystemDependencies(pkg).includes(dependency);

    return {
      name: testName,
      passed: present,
      message: present
        ? 'Edge declared'
        : `Edge missing — DESIGN §1.3 requires it; removing it changes the architecture`,
    };
  });
}

function runPackageEdgeTests(): { results: TestResult[]; summary: { passed: number; failed: number } } {
  const allResults: TestResult[] = [];

  log('\n📦 Ecosystem Package Edge Tests', 'blue');
  log('='.repeat(40), 'blue');
  log(
    `Published libs: ${PUBLISHED_LIBRARY_PACKAGES.map((name) => {
      const { core, standalone } = PUBLISHED_LIBRARY_PROPERTIES[name];
      const props = [core ? 'core' : null, standalone ? 'standalone' : null].filter(Boolean);
      return `${name}${props.length > 0 ? ` (${props.join(', ')})` : ''}`;
    }).join(', ')}  |  Orchestration: ${PROJECTS_ORCHESTRATION_PACKAGES.join(
      ', '
    )}  |  Build internals: ${BUILD_INTERNALS_PACKAGES.join(', ')}`,
    'yellow'
  );

  log('\n🗺️  Workspace coverage', 'blue');
  const coverage = testWorkspaceCoverage();
  allResults.push(...coverage);
  for (const result of coverage) {
    log(`${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`, result.passed ? 'green' : 'red');
  }

  log('\n🔒 Permitted layer edges', 'blue');
  const allowed = testAllowedEdges();
  allResults.push(...allowed);
  for (const result of allowed) {
    log(`${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`, result.passed ? 'green' : 'red');
  }

  log('\n🧩 Standalone property', 'blue');
  const standalone = testStandaloneProperty();
  allResults.push(...standalone);
  for (const result of standalone) {
    log(`${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`, result.passed ? 'green' : 'red');
  }

  log('\n🔌 Required layer edges', 'blue');
  const required = testRequiredEdges();
  allResults.push(...required);
  for (const result of required) {
    log(`${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`, result.passed ? 'green' : 'red');
  }

  return {
    results: allResults,
    summary: {
      passed: allResults.filter((r) => r.passed).length,
      failed: allResults.filter((r) => !r.passed).length,
    },
  };
}

// @cpt-flow:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1
function main(): void {
  // @cpt-begin:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-edges
  const { summary } = runPackageEdgeTests();
  // @cpt-end:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-edges

  log('\n📊 Summary', 'blue');
  log(`  ✅ Passed: ${summary.passed}`, 'green');
  log(`  ❌ Failed: ${summary.failed}`, summary.failed > 0 ? 'red' : 'green');

  // @cpt-begin:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-fail
  if (summary.failed > 0) {
    log('\n💥 Package edge tests failed!', 'red');
    process.exit(1);
  }
  // @cpt-end:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-fail
  log('\n🎉 Package edge tests passed!', 'green');
  process.exit(0);
}

// Execute if run directly. `pathToFileURL` rather than a hand-rolled
// `file://${argv[1]}`: the hand-rolled form fails on Windows (drive letters and
// backslashes need escaping) and on symlinks where argv[1] resolves differently
// from import.meta.url.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  main();
}

export {
  runPackageEdgeTests,
  testAllowedEdges,
  testRequiredEdges,
  testStandaloneProperty,
  testWorkspaceCoverage,
  discoverWorkspaceDirs,
};
