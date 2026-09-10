#!/usr/bin/env node

/**
 * FrontX Guard Config Verification Script
 * Verifies that the shared ESLint and dependency-cruiser configs in `internal/`
 * are correctly structured and still carry the rules the boundary guards
 * depend on. Running a guard cannot detect the guard being weakened — a rule
 * deleted or renamed in the config produces no violation, only silence — so
 * this script asserts the rules exist by name (see #476).
 *
 * This script:
 * 1. Loads each config and verifies it's a valid config array/object
 * 2. Checks that derived configs extend base configs correctly
 * 3. Verifies expected rules are present in each config
 * 4. Verifies the rules that do exist are still pointed at something — that
 *    `arch:deps:core` cruises every core published library, and that no
 *    artifact-registry `[[ignore]]` names a path that is gone. A rule aimed at
 *    nothing is as silent as a rule that was deleted, and both read as green.
 * 5. Verifies the member artifact chain is registered for enforcement
 *    (`cpt-frontx-constraint-member-artifact-chain`, root DESIGN §2.2): every
 *    FrontX-owned layer member is registered in the artifacts registry as a
 *    child system in the autodetect form with DESIGN and FEATURE required, or
 *    is covered by a package-shaped `[[ignore]]` that records the debt.
 *
 * Layer *membership* and package.json edges are `npm run arch:edges`
 * (scripts/package-edge-tests.ts), not this script.
 *
 * Reads the ESLint configs from `internal/eslint-config/dist/`, so invoke it via
 * `npm run arch:guards`, which builds that package first. Run bare on a tree
 * where the package has never been built and every ESLint assertion fails on a
 * missing file — `dist/` is gitignored and `npm install` does not produce it.
 *
 * The dependency-cruiser side is ecosystem-only (base + core) after the
 * framework/template split: the retired framework/react/screenset configs
 * described packages that emigrated to the templates repository, which now
 * enforces its own internal layering in its self-owned
 * `.dependency-cruiser.cjs`. The ESLint side still ships the full set
 * because the templates in that other repository consume
 * `@gears-frontx/eslint-config/{framework,react}.js` directly as a published
 * contract, and this script is the only ecosystem-side check that those
 * published configs still build and load — ecosystem CI does not lint any
 * template.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

interface IgnoreEntry {
  reason: string;
  patterns: string[];
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
 * Repo root from this file's own location, not `process.cwd()`: the check must
 * report the same thing whether it runs via `npm run arch:guards` from the root,
 * from a pre-commit hook, or from inside a package directory. Under cwd
 * resolution the last two report every config as a missing file.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ESLINT_CONFIG_DIR = join(REPO_ROOT, 'internal', 'eslint-config', 'dist');
const DEPCRUISE_CONFIG_DIR = join(REPO_ROOT, 'internal', 'depcruise-config');

// ESLint configs shipped by @gears-frontx/eslint-config. `framework`, `react`,
// and `screenset` serve template packages in the templates repository,
// which import them directly; `base` and `sdk` serve the ecosystem's own
// packages.
const ESLINT_CONFIG_NAMES = ['base', 'sdk', 'framework', 'react', 'screenset'];

// Depcruise configs shipped by @gears-frontx/depcruise-config. Ecosystem-only.
const DEPCRUISE_CONFIG_NAMES = ['base', 'core'];

/**
 * Verify ESLint configs can be imported and have correct structure
 */
async function verifyEslintConfigs(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const configs = ESLINT_CONFIG_NAMES;

  for (const configName of configs) {
    const configPath = join(ESLINT_CONFIG_DIR, `${configName}.js`);

    try {
      // Check file exists
      if (!existsSync(configPath)) {
        results.push({
          name: `ESLint ${configName}: File exists`,
          passed: false,
          message: `File not found: ${configPath}`,
        });
        continue;
      }

      // Try to import the config
      const configModule = await import(configPath);
      const config = configModule.default || configModule[`${configName}Config`];

      if (!config) {
        results.push({
          name: `ESLint ${configName}: Export found`,
          passed: false,
          message: 'No default or named export found',
        });
        continue;
      }

      // For screenset, check if it's a function (createScreensetConfig) or array
      if (configName === 'screenset') {
        const hasCreateFunction = typeof configModule.createScreensetConfig === 'function';
        const hasDefaultConfig = Array.isArray(config);

        results.push({
          name: `ESLint ${configName}: Valid structure`,
          passed: hasCreateFunction && hasDefaultConfig,
          message: hasCreateFunction && hasDefaultConfig
            ? 'Has createScreensetConfig function and default array'
            : 'Missing createScreensetConfig or default array',
        });
      } else {
        // Check it's an array (flat config format)
        const isArray = Array.isArray(config);
        results.push({
          name: `ESLint ${configName}: Valid array`,
          passed: isArray,
          message: isArray ? `Config has ${config.length} entries` : 'Config is not an array',
        });
      }

      results.push({
        name: `ESLint ${configName}: Loads successfully`,
        passed: true,
        message: 'Config loaded without errors',
      });
    } catch (error) {
      results.push({
        name: `ESLint ${configName}: Loads successfully`,
        passed: false,
        message: `Import error: ${(error as Error).message}`,
      });
    }
  }

  return results;
}

/**
 * Verify dependency-cruiser configs can be loaded and have correct structure
 */
function verifyDepcruiseConfigs(): TestResult[] {
  const results: TestResult[] = [];
  const configs = DEPCRUISE_CONFIG_NAMES;

  for (const configName of configs) {
    const configPath = join(DEPCRUISE_CONFIG_DIR, `${configName}.cjs`);

    try {
      // Check file exists
      if (!existsSync(configPath)) {
        results.push({
          name: `Depcruise ${configName}: File exists`,
          passed: false,
          message: `File not found: ${configPath}`,
        });
        continue;
      }

      // Try to require the config
      const config = require(configPath);

      // Check it has forbidden array
      const hasForbidden = Array.isArray(config.forbidden);
      results.push({
        name: `Depcruise ${configName}: Has forbidden array`,
        passed: hasForbidden,
        message: hasForbidden
          ? `${config.forbidden.length} forbidden rules`
          : 'Missing forbidden array',
      });

      // Check it has options
      const hasOptions = typeof config.options === 'object';
      results.push({
        name: `Depcruise ${configName}: Has options`,
        passed: hasOptions,
        message: hasOptions ? 'Options present' : 'Missing options object',
      });

      results.push({
        name: `Depcruise ${configName}: Loads successfully`,
        passed: true,
        message: 'Config loaded without errors',
      });
    } catch (error) {
      results.push({
        name: `Depcruise ${configName}: Loads successfully`,
        passed: false,
        message: `Require error: ${(error as Error).message}`,
      });
    }
  }

  return results;
}

/**
 * Verify the core config carries the boundary restrictions.
 *
 * Rule names are asserted literally, so a rename in core.cjs without a matching
 * update here fails the check. That is deliberate: the previous version of this
 * script asserted a name (`sdk-no-frontx-imports`) that the config had since
 * renamed, and because nothing ran the script the mismatch sat undetected (#476).
 * The fix for a failure here is to reconcile the two, never to loosen the check.
 */
function verifyCoreRestrictions(): TestResult[] {
  const results: TestResult[] = [];

  try {
    const coreConfig = require(join(DEPCRUISE_CONFIG_DIR, 'core.cjs'));

    const requiredRules: [string, string][] = [
      // Core packages carry no @gears-frontx imports...
      ['core-no-gears-frontx-imports', 'Core isolation'],
      // ...except the one type-substrate port edge, itself narrowed to the runtime.
      ['core-port-provider-only-imports-runtime', 'Type-substrate port narrowing'],
      // The substrate stays UI-framework-agnostic.
      ['core-no-react', 'UI-framework agnosticism'],
      // Inherited from base.cjs.
      ['no-circular', 'Inherited base rule'],
    ];

    for (const [ruleName, description] of requiredRules) {
      const hasRule = coreConfig.forbidden.some(
        (rule: { name: string }) => rule.name === ruleName
      );
      results.push({
        name: `Core config: Has ${ruleName} (${description})`,
        passed: hasRule,
        message: hasRule ? 'Rule present' : 'RULE MISSING - boundary enforcement lost!',
      });
    }
  } catch (error) {
    results.push({
      name: 'Core config: Verification',
      passed: false,
      message: `Error: ${(error as Error).message}`,
    });
  }

  return results;
}

/**
 * Verify `arch:deps:core` still cruises exactly the core membership.
 *
 * `layer-constants.cjs` calls itself the single source of truth for layer
 * membership, and the depcruise rules do derive their path patterns from it —
 * but the npm script that *invokes* dependency-cruiser names the source roots
 * literally on the command line, so membership is duplicated there in a place
 * no rule can see. A package whose `core` property is set in
 * `PUBLISHED_LIBRARY_PROPERTIES` but is missing from the script gets the core
 * rules compiled and then never applied to it: the cruise passes because that
 * package's files were never in the set being cruised. That is the shape this
 * whole script exists for, and it is the exact shape that let
 * `packages/telemetry` land unguarded (#495) — an enumeration standing in for
 * the membership list, failing open.
 */
function verifyCoreCruiseTargets(): TestResult[] {
  const results: TestResult[] = [];

  try {
    const { CORE_PACKAGES } = require(
      join(DEPCRUISE_CONFIG_DIR, 'layer-constants.cjs')
    ) as { CORE_PACKAGES: readonly string[] };

    const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const script = rootPkg.scripts?.['arch:deps:core'];

    if (script === undefined) {
      return [
        {
          name: 'arch:deps:core: Script present',
          passed: false,
          message:
            'No `arch:deps:core` script in the root package.json — the core ' +
            'import-graph rules have no invocation, so they enforce nothing.',
        },
      ];
    }

    // Positional source roots only: every token shaped like a package src root.
    // Flags and their values never take this shape.
    const cruised = script.split(/\s+/).filter((token) => /^packages\/[^/]+\/src$/.test(token));
    const expected = CORE_PACKAGES.map((name) => `packages/${name}/src`);

    const missing = expected.filter((dir) => !cruised.includes(dir));
    const extra = cruised.filter((dir) => !expected.includes(dir));

    results.push({
      name: 'arch:deps:core: Cruises exactly the core membership',
      passed: missing.length === 0 && extra.length === 0,
      message:
        missing.length === 0 && extra.length === 0
          ? `All ${expected.length} core src roots cruised`
          : [
              missing.length > 0
                ? `Not cruised, so unguarded: ${missing.join(', ')}`
                : undefined,
              extra.length > 0 ? `Cruised but not a member: ${extra.join(', ')}` : undefined,
              'Reconcile the `arch:deps:core` script with the core property in ' +
                'internal/depcruise-config/layer-constants.cjs (PUBLISHED_LIBRARY_PROPERTIES).',
            ]
              .filter(Boolean)
              .join('. '),
    });
  } catch (error) {
    results.push({
      name: 'arch:deps:core: Verification',
      passed: false,
      message: `Error: ${(error as Error).message}`,
    });
  }

  return results;
}

/**
 * Verify `doNotFollow` bounds `node_modules` at any depth in both depcruise
 * configs that cruise the ecosystem tree.
 *
 * The pattern is asserted literally: npm nests a `node_modules` under a
 * workspace whenever its pins conflict with the root's, and an anchored
 * `^node_modules` lets traversal descend into those until dependency-cruiser
 * OOMs in CI (#523). Running the cruise cannot detect a regression here — a
 * loosened pattern produces no violation, only a silently growing graph — so
 * this is asserted the same way the rule names are. The root config lives
 * outside `internal/`, but it is a boundary guard all the same.
 */
const NODE_MODULES_ANY_DEPTH = '(^|/)node_modules/';

function verifyDoNotFollowPatterns(): TestResult[] {
  const results: TestResult[] = [];

  const targets: [string, string][] = [
    [join(DEPCRUISE_CONFIG_DIR, 'base.cjs'), 'Depcruise base'],
    [join(REPO_ROOT, '.dependency-cruiser.cjs'), 'Depcruise root'],
  ];

  for (const [configPath, label] of targets) {
    try {
      const config = require(configPath);
      const doNotFollow = config.options?.doNotFollow;
      const paths =
        typeof doNotFollow === 'string'
          ? [doNotFollow]
          : Array.isArray(doNotFollow?.path)
            ? doNotFollow.path
            : [doNotFollow?.path];
      const hasPattern = paths.includes(NODE_MODULES_ANY_DEPTH);
      results.push({
        name: `${label}: doNotFollow matches node_modules at any depth`,
        passed: hasPattern,
        message: hasPattern
          ? `Pattern ${NODE_MODULES_ANY_DEPTH} present`
          : `PATTERN MISSING - an anchored node_modules regresses to the #523 CI OOM! Got: ${JSON.stringify(doNotFollow)}`,
      });
    } catch (error) {
      results.push({
        name: `${label}: doNotFollow verification`,
        passed: false,
        message: `Error: ${(error as Error).message}`,
      });
    }
  }

  return results;
}

/**
 * Every `[[ignore]]` entry in the Studio artifact registry, in file order.
 *
 * A deliberately narrow reader rather than a TOML dependency: it needs one
 * table kind with two string-bearing keys. Every departure from the shape it
 * expects throws instead of being skipped, because a parser that silently
 * understood less than the file says would make these checks pass by finding
 * nothing — the same fail-open they exist to detect.
 */
function ignoreEntries(tomlPath: string): IgnoreEntry[] {
  const entries: IgnoreEntry[] = [];
  let inIgnoreTable = false;
  let sawPatterns = false;
  let sawReason = false;
  let pendingPatterns: string | null = null;
  let currentEntry: IgnoreEntry | null = null;

  const finalizeCurrentEntry = (lineNo: number): void => {
    if (!inIgnoreTable) return;
    if (!sawReason) {
      throw new Error(
        `${tomlPath}:${lineNo}: an [[ignore]] table with no reason key. The registry's ignore ` +
          `shape has changed; update this reader.`
      );
    }
    if (!sawPatterns) {
      throw new Error(
        `${tomlPath}:${lineNo}: an [[ignore]] table with no patterns key. The registry's ` +
          `ignore shape has changed; update this reader.`
      );
    }
    if (currentEntry === null || currentEntry.reason.trim() === '') {
      throw new Error(
        `${tomlPath}:${lineNo}: an [[ignore]] reason must be a non-empty double-quoted string.`
      );
    }
    if (currentEntry.patterns.length === 0) {
      throw new Error(
        `${tomlPath}:${lineNo}: an [[ignore]] patterns array must contain at least one pattern.`
      );
    }
  };

  const collect = (raw: string, lineNo: number): void => {
    const quoted = raw.match(/"[^"]*"/g);
    if (quoted === null) {
      throw new Error(
        `${tomlPath}:${lineNo}: an [[ignore]] patterns array with no double-quoted entries. ` +
          `This reader handles double-quoted strings only; extend it rather than letting ` +
          `patterns go unchecked.`
      );
    }
    currentEntry?.patterns.push(...quoted.map((entry) => entry.slice(1, -1)));
  };

  const readReason = (text: string, lineNo: number): void => {
    const match = text.match(/^reason\s*=\s*"([^"]*)"\s*(#.*)?$/);
    if (match === null) {
      throw new Error(
        `${tomlPath}:${lineNo}: an [[ignore]] reason must be a double-quoted string on one line.`
      );
    }
    const reason = match[1].trim();
    if (reason === '') {
      throw new Error(`${tomlPath}:${lineNo}: an [[ignore]] reason must not be blank.`);
    }
    if (currentEntry === null) {
      throw new Error(`${tomlPath}:${lineNo}: internal error: missing [[ignore]] entry state.`);
    }
    currentEntry.reason = reason;
  };

  const lines = readFileSync(tomlPath, 'utf-8').split('\n');

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const text = line.trim();

    if (pendingPatterns !== null) {
      pendingPatterns += text;
      if (text.includes(']')) {
        collect(pendingPatterns, lineNo);
        pendingPatterns = null;
      }
      return;
    }

    if (text.startsWith('[')) {
      if (inIgnoreTable) {
        finalizeCurrentEntry(lineNo);
      }
      inIgnoreTable = text === '[[ignore]]';
      sawPatterns = false;
      sawReason = false;
      if (inIgnoreTable) {
        currentEntry = { reason: '', patterns: [] };
        entries.push(currentEntry);
      } else {
        currentEntry = null;
      }
      return;
    }

    if (!inIgnoreTable || text === '' || text.startsWith('#')) return;

    if (/^reason\s*=/.test(text)) {
      sawReason = true;
      readReason(text, lineNo);
      return;
    }

    if (/^patterns\s*=/.test(text)) {
      sawPatterns = true;
      if (text.includes(']')) {
        collect(text, lineNo);
      } else {
        pendingPatterns = text;
      }
    }
  });

  if (pendingPatterns !== null) {
    throw new Error(`${tomlPath}: unterminated patterns array at end of file.`);
  }
  if (inIgnoreTable) {
    finalizeCurrentEntry(lines.length);
  }

  return entries;
}

function ignorePatterns(tomlPath: string): string[] {
  return ignoreEntries(tomlPath).flatMap((entry) => entry.patterns);
}

function literalPrefix(pattern: string): string | null {
  if (/^[*?[]/.test(pattern)) return null;
  const wildcard = pattern.search(/[*?[]/);
  const literal = (wildcard === -1 ? pattern : pattern.slice(0, wildcard)).replace(/\/+$/, '');
  return literal === '' ? null : literal;
}

function memberDebtReasonStatus(reason: string): { ok: boolean; missing: string[] } {
  const normalized = reason.trim();
  const recordsDebt =
    /\b(no|missing|without)\b[\s\S]{0,120}\b(backing|active)?\s*(cdsl|artifact)\b/i.test(normalized) ||
    /\bno\b[\s\S]{0,120}\bartifact\b[\s\S]{0,80}\b(backs?|backing)\b/i.test(normalized);
  const recordsRemovalCriterion =
    /\bRemoval criterion\b/i.test(normalized) &&
    /\bregister(?:ed|ing)?\b/i.test(normalized) &&
    /\bPRD\b/.test(normalized) &&
    /\bDESIGN\b/.test(normalized) &&
    /\bFEATURE\b/.test(normalized);

  return {
    ok: recordsDebt && recordsRemovalCriterion,
    missing: [
      ...(recordsDebt ? [] : ['current artifact-chain debt']),
      ...(recordsRemovalCriterion ? [] : ['objective removal criterion']),
    ],
  };
}

function matchingMemberDebtIgnore(
  dir: string,
  entries: readonly IgnoreEntry[]
): { reason: string; missing: string[] } | null {
  for (const entry of entries) {
    for (const pattern of entry.patterns) {
      if (literalPrefix(pattern) !== dir) continue;
      const status = memberDebtReasonStatus(entry.reason);
      if (status.ok) return { reason: entry.reason, missing: [] };
      return { reason: entry.reason, missing: status.missing };
    }
  }
  return null;
}

/**
 * Verify no `[[ignore]]` names a path that cannot match anything.
 *
 * An ignore is an assertion that some code needs no traceability. Once the code
 * it named is gone, the entry stops being an assertion and becomes a rule that
 * can never fire — indistinguishable from an active exemption when read, and
 * carrying a stale reason nobody will revisit. `packages/docs/*` and
 * `packages/auth/*` sat here long after both directories were deleted.
 *
 * Checked by existence rather than by an expiry date, because a date needs a
 * human to notice it passed, and the thing that makes these entries rot is
 * precisely that nobody looks. Only the literal prefix is checked, so the
 * *structural* ignores — the leading-wildcard patterns for dist, node_modules,
 * test files, build configs and demos — are correctly left alone: they are
 * permanent by nature and name no single location. That split is the one
 * decided for the registry, and it falls out of each pattern's own shape rather
 * than needing a second list to maintain.
 */
function verifyIgnoreFreshness(): TestResult[] {
  const tomlPath = join(REPO_ROOT, '.cf-studio', 'config', 'artifacts.toml');

  if (!existsSync(tomlPath)) {
    return [
      {
        name: 'Artifact registry: Present',
        passed: false,
        message: `Not found: ${tomlPath}`,
      },
    ];
  }

  try {
    const anchored = ignorePatterns(tomlPath).filter((pattern) => !/^[*?[]/.test(pattern));
    const stale = anchored.filter((pattern) => {
      const wildcard = pattern.search(/[*?[]/);
      const literal = (wildcard === -1 ? pattern : pattern.slice(0, wildcard)).replace(/\/+$/, '');
      return literal !== '' && !existsSync(join(REPO_ROOT, literal));
    });

    return [
      {
        name: 'Artifact registry: No ignore names a path that is gone',
        passed: stale.length === 0,
        message:
          stale.length === 0
            ? `All ${anchored.length} path-anchored ignore pattern(s) still name something on disk`
            : `Stale ignore pattern(s): ${stale.join(', ')} — delete the entry, or correct the ` +
              `path if the code moved. An ignore for code that no longer exists cannot fire.`,
      },
    ];
  } catch (error) {
    return [
      {
        name: 'Artifact registry: Ignore patterns readable',
        passed: false,
        message: (error as Error).message,
      },
    ];
  }
}

interface ChildSystem {
  slug: string | null;
  artifactsDir: string | null;
  /** Artifact kinds declared under the child's autodetect block: kind -> required. */
  autodetectKinds: Record<string, boolean>;
  /** True if the child declares artifacts outside an autodetect block. */
  hasExplicitArtifacts: boolean;
}

/**
 * Every `[[systems.children]]` node in the Studio artifact registry, with the
 * artifact kinds its autodetect block declares and their `required` flags.
 *
 * The same deliberately narrow reader philosophy as `ignorePatterns`: it needs
 * the child tables and three keys, and a parser that silently understood less
 * than the file says would make the registration check pass by finding nothing.
 * An unspecified `required` is `true` — that is the kit's own default (the root
 * system's PRD/DESIGN/DECOMPOSITION carry no flag and are required).
 */
function childSystems(tomlPath: string): ChildSystem[] {
  const children: ChildSystem[] = [];
  let current: ChildSystem | null = null;
  // Which table the following key lines belong to.
  let context: 'child' | 'autodetect-kind' | 'explicit-artifacts' | 'other' = 'other';
  let currentKind: string | null = null;

  const lines = readFileSync(tomlPath, 'utf-8').split('\n');

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const text = line.trim();
    if (text === '' || text.startsWith('#')) return;

    if (text.startsWith('[')) {
      currentKind = null;
      if (text === '[[systems.children]]') {
        current = { slug: null, artifactsDir: null, autodetectKinds: {}, hasExplicitArtifacts: false };
        children.push(current);
        context = 'child';
        return;
      }
      if (text === '[[systems.children.autodetect]]' || text === '[systems.children.autodetect.artifacts]') {
        context = 'other';
        return;
      }
      const kindHeader = text.match(/^\[systems\.children\.autodetect\.artifacts\.([A-Za-z0-9_-]+)\]$/);
      if (kindHeader !== null) {
        if (current === null) {
          throw new Error(
            `${tomlPath}:${lineNo}: a child autodetect artifact table before any [[systems.children]].`
          );
        }
        currentKind = kindHeader[1];
        current.autodetectKinds[currentKind] = true;
        context = 'autodetect-kind';
        return;
      }
      if (/^\[\[systems\.children\.artifacts\]\]$/.test(text)) {
        if (current === null) {
          throw new Error(
            `${tomlPath}:${lineNo}: a child artifacts table before any [[systems.children]].`
          );
        }
        current.hasExplicitArtifacts = true;
        context = 'explicit-artifacts';
        return;
      }
      // Any other table (root systems tables, children codebase, ignore, ...).
      context = 'other';
      return;
    }

    if (current === null) return;

    if (context === 'child') {
      const slugMatch = text.match(/^slug\s*=\s*"([^"]*)"/);
      if (slugMatch !== null) current.slug = slugMatch[1];
      const dirMatch = text.match(/^artifacts_dir\s*=\s*"([^"]*)"/);
      if (dirMatch !== null) current.artifactsDir = dirMatch[1];
      return;
    }

    if (context === 'autodetect-kind' && currentKind !== null) {
      const requiredMatch = text.match(/^required\s*=\s*(true|false)\s*(#.*)?$/);
      if (requiredMatch !== null) {
        current.autodetectKinds[currentKind] = requiredMatch[1] === 'true';
      }
    }
  });

  return children;
}

/**
 * Verify the member artifact chain is registered for enforcement.
 *
 * Root DESIGN §2.2, `cpt-frontx-constraint-member-artifact-chain` (LAYER-2):
 * every layer member owned by this repository owns the artifacts that describe
 * it, registered as its own child system with DESIGN and at least one FEATURE
 * required — in the autodetect form, because `required` flags do not inherit
 * and the explicit-artifact-list form validates while enforcing nothing. A
 * member registered the unenforcing way, or not registered at all, silently
 * reproduces the gap federation exists to close: `cfs validate` stays green
 * because it was never asked to look.
 *
 * Scope is exactly the constraint's: FrontX-owned layer members — published
 * libraries and projects orchestration, both read from layer-constants.cjs.
 * Build internals are exempt from the chain by DESIGN §1.3, and templates are
 * hosted outside this repository. A member whose package is still covered by a
 * path-anchored `[[ignore]]` is accepted as recorded debt: the ignore's reason
 * carries the removal criterion, `verifyIgnoreFreshness` keeps it honest, and
 * lifting the ignore is what arms this check for that member (autodetect
 * cannot see a member's artifacts through the ignore anyway — measured on
 * telemetry, #495).
 */
// @cpt-dod:cpt-frontx-dod-ecosystem-governance-member-registration-enforced:p1
// @cpt-algo:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1
function verifyMemberRegistrationInRegistry(
  tomlPath: string,
  members: readonly string[],
  packageDirs: Readonly<Record<string, string>>
): TestResult[] {
  try {
    // @cpt-begin:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-members
    const memberList = [...members];
    // @cpt-end:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-members
    // @cpt-begin:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-read
    const children = childSystems(tomlPath);
    const ignores = ignoreEntries(tomlPath);
    // @cpt-end:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-read

    return memberList.map((member) => {
      const dir = packageDirs[member];
      const testName = `Member ${member}: Artifact chain registered for enforcement`;

      // @cpt-begin:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-debt
      const ignored = matchingMemberDebtIgnore(dir, ignores);
      if (ignored?.missing.length === 0) {
        return {
          name: testName,
          passed: true,
          message:
            `Recorded debt: ${dir} is covered by a path-anchored [[ignore]] whose reason ` +
            `carries the removal criterion. Lifting the ignore arms this check.`,
        };
      }
      if (ignored !== null) {
        return {
          name: testName,
          passed: false,
          message:
            `Ignored member debt for ${dir} is undocumented: the matching path-anchored [[ignore]] ` +
            `reason is missing ${ignored.missing.join(' and ')}. Record both in the reason, or ` +
            `register the member's PRD, DESIGN and FEATURE chain now.`,
        };
      }
      // @cpt-end:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-debt

      // @cpt-begin:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-unregistered
      const child = children.find(
        (candidate) =>
          candidate.artifactsDir !== null && candidate.artifactsDir.startsWith(`${dir}/`)
      );

      if (child === undefined) {
        return {
          name: testName,
          passed: false,
          message:
            `No [[systems.children]] node with artifacts_dir under ${dir}/ in the artifact ` +
            `registry, and no [[ignore]] recording the debt. An unregistered member's chain ` +
            `is an honour system (cpt-frontx-constraint-member-artifact-chain).`,
        };
      }
      // @cpt-end:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-unregistered

      // @cpt-begin:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-unenforcing
      const declaredKinds = Object.keys(child.autodetectKinds);
      if (declaredKinds.length === 0) {
        return {
          name: testName,
          passed: false,
          message:
            `Child '${child.slug ?? dir}' declares no autodetect artifact kinds` +
            (child.hasExplicitArtifacts
              ? ' — the explicit-artifact-list form validates while enforcing nothing; use the autodetect form with required flags.'
              : ' — nothing is enforced for this member.'),
        };
      }

      const unenforced = ['DESIGN', 'FEATURE', 'PRD'].filter(
        (kind) => child.autodetectKinds[kind] !== true
      );
      // @cpt-end:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-unenforcing

      // @cpt-begin:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-pass
      return {
        name: testName,
        passed: unenforced.length === 0,
        message:
          unenforced.length === 0
            ? `Child '${child.slug ?? dir}' requires ${declaredKinds
                .filter((kind) => child.autodetectKinds[kind])
                .sort()
                .join(', ')} via autodetect`
            : `Child '${child.slug ?? dir}' does not require: ${unenforced.join(', ')} — the ` +
              `member artifact chain needs PRD, DESIGN and FEATURE declared with ` +
              `required = true in the autodetect form.`,
      };
      // @cpt-end:cpt-frontx-algo-ecosystem-governance-member-registration-gate:p1:inst-mrg-pass
    });
  } catch (error) {
    return [
      {
        name: 'Member registration: Registry readable',
        passed: false,
        message: (error as Error).message,
      },
    ];
  }
}

function verifyMemberRegistration(): TestResult[] {
  const tomlPath = join(REPO_ROOT, '.cf-studio', 'config', 'artifacts.toml');

  if (!existsSync(tomlPath)) {
    return [
      {
        name: 'Artifact registry: Present',
        passed: false,
        message: `Not found: ${tomlPath}`,
      },
    ];
  }

  const { PUBLISHED_LIBRARY_PACKAGES, PROJECTS_ORCHESTRATION_PACKAGES, ECOSYSTEM_PACKAGE_DIRS } =
    require(join(DEPCRUISE_CONFIG_DIR, 'layer-constants.cjs')) as {
      PUBLISHED_LIBRARY_PACKAGES: readonly string[];
      PROJECTS_ORCHESTRATION_PACKAGES: readonly string[];
      ECOSYSTEM_PACKAGE_DIRS: Readonly<Record<string, string>>;
    };

  return verifyMemberRegistrationInRegistry(
    tomlPath,
    [...PUBLISHED_LIBRARY_PACKAGES, ...PROJECTS_ORCHESTRATION_PACKAGES],
    ECOSYSTEM_PACKAGE_DIRS
  );
}

/**
 * Run all verification tests
 */
async function runVerification(): Promise<void> {
  log('\n🔍 Guard Config Verification', 'blue');
  log('='.repeat(40), 'blue');

  const allResults: TestResult[] = [];

  // ESLint configs
  log('\n📝 ESLint Configs', 'blue');
  const eslintResults = await verifyEslintConfigs();
  allResults.push(...eslintResults);
  for (const result of eslintResults) {
    log(
      `${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`,
      result.passed ? 'green' : 'red'
    );
  }

  // Depcruise configs
  log('\n📦 Dependency Cruiser Configs', 'blue');
  const depcruiseResults = verifyDepcruiseConfigs();
  allResults.push(...depcruiseResults);
  for (const result of depcruiseResults) {
    log(
      `${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`,
      result.passed ? 'green' : 'red'
    );
  }

  // Core boundary restrictions
  log('\n🔒 Core Boundary Restrictions', 'blue');
  const coreResults = verifyCoreRestrictions();
  allResults.push(...coreResults);
  for (const result of coreResults) {
    log(
      `${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`,
      result.passed ? 'green' : 'red'
    );
  }

  // Guard invocation: rules that exist but are never pointed at anything
  log('\n🎯 Guard Reach', 'blue');
  const reachResults = [...verifyCoreCruiseTargets(), ...verifyIgnoreFreshness()];
  allResults.push(...reachResults);
  for (const result of reachResults) {
    log(
      `${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`,
      result.passed ? 'green' : 'red'
    );
  }

  // Member artifact chain: registered for enforcement, not on honour
  log('\n🧾 Member Artifact Chain', 'blue');
  // @cpt-begin:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-guards
  const registrationResults = verifyMemberRegistration();
  // @cpt-end:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-guards
  allResults.push(...registrationResults);
  for (const result of registrationResults) {
    log(
      `${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`,
      result.passed ? 'green' : 'red'
    );
  }

  // doNotFollow patterns
  log('\n🕳️ doNotFollow Depth Guards', 'blue');
  const doNotFollowResults = verifyDoNotFollowPatterns();
  allResults.push(...doNotFollowResults);
  for (const result of doNotFollowResults) {
    log(
      `${result.passed ? '✅' : '❌'} ${result.name}: ${result.message}`,
      result.passed ? 'green' : 'red'
    );
  }

  // Summary
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;

  log('\n📊 Summary', 'blue');
  log(`  ✅ Passed: ${passed}`, 'green');
  log(`  ❌ Failed: ${failed}`, failed > 0 ? 'red' : 'green');

  if (failed > 0) {
    log('\n💥 Guard config verification failed!', 'red');
    process.exit(1);
  } else {
    // @cpt-begin:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-pass
    log('\n🎉 Guard config verification passed!', 'green');
    process.exit(0);
    // @cpt-end:cpt-frontx-flow-ecosystem-governance-ci-guard-run:p1:inst-cgr-pass
  }
}

// Execute if run directly. `pathToFileURL` rather than a hand-rolled
// `file://${argv[1]}`: the hand-rolled form fails on Windows (drive letters and
// backslashes need escaping) and on symlinks where argv[1] resolves differently
// from import.meta.url.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  runVerification();
}

export {
  runVerification,
  verifyEslintConfigs,
  verifyDepcruiseConfigs,
  verifyCoreRestrictions,
  verifyCoreCruiseTargets,
  verifyIgnoreFreshness,
  verifyMemberRegistration,
  verifyMemberRegistrationInRegistry,
  ignoreEntries,
  memberDebtReasonStatus,
  verifyDoNotFollowPatterns,
};
