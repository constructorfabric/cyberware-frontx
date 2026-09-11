/**
 * Guideline-Index Generator.
 *
 * The design-guardrails bundle routes which guideline documents an agent
 * loads for a given screen task. Before this generator, the routing rules
 * lived as two hand-maintained prose tables (generate-interface and
 * review-interface SKILL.md) that had already drifted in wording — the same
 * restated-canonical-list failure mode as PR #586 finding D-001. The routing
 * metadata now lives in each guideline's own front matter (`summary`, `tier`,
 * `loadWhen`), and this script derives the single machine-readable index the
 * skills consume: `reference-artifacts/guideline-index.json`, sibling of
 * `guidelines/`. The document owns its routing metadata; the index is a build
 * artifact and must never be edited by hand.
 *
 * Front-matter contract (strict — unknown keys are errors, so typos fail the
 * build instead of silently dropping a route):
 *   summary   one line, required — the always-visible stub for the doc.
 *   tier      `core` (loaded for every screen task) or `conditional`.
 *   loadWhen  list of trigger phrases; required for `conditional`,
 *             forbidden for `core` (a core doc with triggers has two
 *             contradictory routing meanings).
 *
 * Scope is an explicit opt-in list (GOVERNED_BUNDLES), not template
 * discovery: other template bundles also ship `guidelines/` directories that
 * have not adopted front matter, and auto-scanning would either fail on them
 * or skip them silently. A governed bundle with zero guideline files is a
 * hard failure, never a vacuous pass, matching the sibling guards.
 *
 * CLI entry: `node scripts/generate-guideline-index.mjs` regenerates the
 * index in place; `--check` fails (exit 1) when the on-disk index differs
 * from what the front matter produces — CI runs the check so a guideline
 * edit cannot land without its index regeneration, and a hand edit to the
 * index cannot land at all. Core logic is exported for unit tests in
 * `scripts/generate-guideline-index.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Bundle roots (relative to the repo root) whose guidelines carry routing front matter. */
export const GOVERNED_BUNDLES = [
  'template-design-guardrails/.frontx/ai/@gears-frontx/template-design-guardrails',
];

export const INDEX_FILENAME = 'guideline-index.json';
export const INDEX_CONTRACT_VERSION = '1.0.0';

const FRONT_MATTER_KEYS = new Set(['summary', 'tier', 'loadWhen']);
const TIERS = new Set(['core', 'conditional']);

/**
 * Parse the strict front-matter subset this contract allows. Not a YAML
 * parser: exactly the three known scalar/list keys, anything else is an
 * error so a typo (`loadwhen:`) fails loudly instead of dropping a route.
 *
 * @param {string} content raw markdown file content
 * @param {string} fileLabel for error messages
 * @returns {{summary: string, tier: string, loadWhen: string[]}}
 */
export function parseFrontMatter(content, fileLabel) {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new Error(`${fileLabel}: missing front matter (file must start with ---)`);
  }
  /** @type {{summary?: string, tier?: string, loadWhen?: string[]}} */
  const data = {};
  /** @type {string | undefined} current list key being filled */
  let listKey;
  let closed = false;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') {
      closed = true;
      break;
    }
    if (line.trim() === '') continue;
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem) {
      if (listKey !== 'loadWhen') {
        throw new Error(`${fileLabel}: list item outside a list key at line ${i + 1}`);
      }
      data.loadWhen ??= [];
      data.loadWhen.push(listItem[1].trim());
      continue;
    }
    const field = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!field) {
      throw new Error(`${fileLabel}: unparseable front-matter line ${i + 1}: ${line.trim()}`);
    }
    const [, key, rawValue] = field;
    if (!FRONT_MATTER_KEYS.has(key)) {
      throw new Error(`${fileLabel}: unknown front-matter key "${key}" (allowed: summary, tier, loadWhen)`);
    }
    if (key in data) {
      throw new Error(`${fileLabel}: duplicate front-matter key "${key}"`);
    }
    if (key === 'loadWhen') {
      if (rawValue.trim() !== '') {
        throw new Error(`${fileLabel}: loadWhen must be a list, not an inline value`);
      }
      listKey = 'loadWhen';
      data.loadWhen = [];
      continue;
    }
    listKey = undefined;
    data[key === 'summary' ? 'summary' : 'tier'] = rawValue.trim();
  }
  if (!closed) throw new Error(`${fileLabel}: front matter never closed with ---`);
  if (!data.summary) throw new Error(`${fileLabel}: front matter missing required "summary"`);
  if (!data.tier || !TIERS.has(data.tier)) {
    throw new Error(`${fileLabel}: front matter "tier" must be core or conditional`);
  }
  if (data.tier === 'conditional' && (!data.loadWhen || data.loadWhen.length === 0)) {
    throw new Error(`${fileLabel}: conditional guideline must declare a non-empty loadWhen list`);
  }
  if (data.tier === 'core' && data.loadWhen !== undefined) {
    throw new Error(`${fileLabel}: core guideline must not declare loadWhen (core always loads)`);
  }
  return { summary: data.summary, tier: data.tier, loadWhen: data.loadWhen ?? [] };
}

/**
 * Build the index object for one bundle root.
 *
 * @param {string} bundleDir absolute path to the bundle root
 * @returns {{contractVersion: string, generatedBy: string, guidelines: Array<{id: string, path: string, summary: string, tier: string, loadWhen?: string[]}>}}
 */
export function buildIndex(bundleDir) {
  const guidelinesDir = path.join(bundleDir, 'guidelines');
  if (!fs.existsSync(guidelinesDir)) {
    throw new Error(`governed bundle has no guidelines/ directory: ${bundleDir}`);
  }
  const files = fs
    .readdirSync(guidelinesDir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  if (files.length === 0) {
    throw new Error(`governed bundle has zero guideline documents (refusing vacuous pass): ${guidelinesDir}`);
  }
  const guidelines = files.map((name) => {
    const relPath = `guidelines/${name}`;
    const content = fs.readFileSync(path.join(guidelinesDir, name), 'utf8');
    const meta = parseFrontMatter(content, relPath);
    return {
      id: name.replace(/\.md$/, ''),
      path: relPath,
      summary: meta.summary,
      tier: meta.tier,
      ...(meta.tier === 'conditional' ? { loadWhen: meta.loadWhen } : {}),
    };
  });
  return {
    contractVersion: INDEX_CONTRACT_VERSION,
    generatedBy:
      'scripts/generate-guideline-index.mjs from guideline front matter - do not edit by hand',
    guidelines,
  };
}

/** @param {object} index */
export function renderIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/**
 * Generate or check the index for every governed bundle.
 *
 * @param {string} rootDir repo root
 * @param {{check?: boolean, bundles?: string[], log?: (msg: string) => void}} [options]
 * @returns {number} process exit code
 */
export function runCli(rootDir, options = {}) {
  const { check = false, bundles = GOVERNED_BUNDLES, log = console.log } = options;
  if (bundles.length === 0) {
    console.error('guideline-index: zero governed bundles configured (refusing vacuous pass)');
    return 1;
  }
  let failed = false;
  for (const bundle of bundles) {
    const bundleDir = path.join(rootDir, bundle);
    const indexPath = path.join(bundleDir, 'reference-artifacts', INDEX_FILENAME);
    /** @type {string} */
    let rendered;
    try {
      rendered = renderIndex(buildIndex(bundleDir));
    } catch (error) {
      console.error(`guideline-index: ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
      continue;
    }
    const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : undefined;
    if (check) {
      if (existing !== rendered) {
        console.error(
          `guideline-index: ${path.relative(rootDir, indexPath)} is stale or hand-edited - ` +
            'run `node scripts/generate-guideline-index.mjs` and commit the result',
        );
        failed = true;
      } else {
        log(`guideline-index: ${path.relative(rootDir, indexPath)} is up to date`);
      }
      continue;
    }
    if (existing === rendered) {
      log(`guideline-index: ${path.relative(rootDir, indexPath)} unchanged`);
      continue;
    }
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, rendered);
    log(`guideline-index: wrote ${path.relative(rootDir, indexPath)}`);
  }
  return failed ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(runCli(process.cwd(), { check: process.argv.includes('--check') }));
}
