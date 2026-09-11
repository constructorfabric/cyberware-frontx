// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOVERNED_BUNDLES,
  INDEX_FILENAME,
  buildIndex,
  parseFrontMatter,
  runCli,
} from './generate-guideline-index.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  vi.restoreAllMocks();
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-guideline-index-'));
  return rootDir;
}

const CORE_DOC = `---
summary: Core rules.
tier: core
---

# Standard: Core
`;

const CONDITIONAL_DOC = `---
summary: Data rules.
tier: conditional
loadWhen:
  - table screens
  - dashboards
---

# Standard: Data
`;

/**
 * @param {string} root
 * @param {Record<string, string>} docs filename -> content
 */
async function writeBundle(root, docs, bundle = 'bundle') {
  const guidelinesDir = path.join(root, bundle, 'guidelines');
  await mkdir(guidelinesDir, { recursive: true });
  for (const [name, content] of Object.entries(docs)) {
    await writeFile(path.join(guidelinesDir, name), content);
  }
  return path.join(root, bundle);
}

describe('parseFrontMatter', () => {
  it('parses core and conditional metadata', () => {
    expect(parseFrontMatter(CORE_DOC, 'core.md')).toEqual({
      summary: 'Core rules.',
      tier: 'core',
      loadWhen: [],
    });
    expect(parseFrontMatter(CONDITIONAL_DOC, 'data.md')).toEqual({
      summary: 'Data rules.',
      tier: 'conditional',
      loadWhen: ['table screens', 'dashboards'],
    });
  });

  it('rejects a document without front matter', () => {
    expect(() => parseFrontMatter('# Standard: Bare\n', 'bare.md')).toThrow(/missing front matter/);
  });

  it('rejects unknown keys so typos fail instead of dropping a route', () => {
    const doc = '---\nsummary: X.\ntier: core\nloadwhen:\n  - a\n---\n';
    expect(() => parseFrontMatter(doc, 'typo.md')).toThrow(/unknown front-matter key "loadwhen"/);
  });

  it('rejects a conditional guideline without loadWhen triggers', () => {
    const doc = '---\nsummary: X.\ntier: conditional\n---\n';
    expect(() => parseFrontMatter(doc, 'x.md')).toThrow(/non-empty loadWhen/);
  });

  it('rejects a core guideline that declares loadWhen', () => {
    const doc = '---\nsummary: X.\ntier: core\nloadWhen:\n  - a\n---\n';
    expect(() => parseFrontMatter(doc, 'x.md')).toThrow(/core guideline must not declare loadWhen/);
  });

  it('rejects an invalid tier and an unclosed block', () => {
    expect(() => parseFrontMatter('---\nsummary: X.\ntier: optional\n---\n', 'x.md')).toThrow(
      /"tier" must be core or conditional/,
    );
    expect(() => parseFrontMatter('---\nsummary: X.\ntier: core\n', 'x.md')).toThrow(
      /never closed/,
    );
  });
});

describe('buildIndex', () => {
  it('emits sorted entries with loadWhen only on conditional guidelines', async () => {
    const root = await makeRoot();
    const bundleDir = await writeBundle(root, {
      'zeta-data.md': CONDITIONAL_DOC,
      'alpha-core.md': CORE_DOC,
    });
    const index = buildIndex(bundleDir);
    expect(index.guidelines.map((g) => g.id)).toEqual(['alpha-core', 'zeta-data']);
    expect(index.guidelines[0]).not.toHaveProperty('loadWhen');
    expect(index.guidelines[1].loadWhen).toEqual(['table screens', 'dashboards']);
    expect(index.guidelines[1].path).toBe('guidelines/zeta-data.md');
  });

  it('hard-fails on a governed bundle with zero guideline documents', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'bundle', 'guidelines'), { recursive: true });
    expect(() => buildIndex(path.join(root, 'bundle'))).toThrow(/zero guideline documents/);
  });
});

describe('runCli', () => {
  const quiet = { log: () => {} };

  it('writes the index, then reports up to date in check mode', async () => {
    const root = await makeRoot();
    await writeBundle(root, { 'core.md': CORE_DOC, 'data.md': CONDITIONAL_DOC });
    expect(runCli(root, { ...quiet, bundles: ['bundle'] })).toBe(0);
    const indexPath = path.join(root, 'bundle', 'reference-artifacts', INDEX_FILENAME);
    expect(existsSync(indexPath)).toBe(true);
    expect(runCli(root, { ...quiet, bundles: ['bundle'], check: true })).toBe(0);
  });

  it('fails check mode when the index is stale or hand-edited', async () => {
    const root = await makeRoot();
    await writeBundle(root, { 'core.md': CORE_DOC });
    expect(runCli(root, { ...quiet, bundles: ['bundle'] })).toBe(0);
    const indexPath = path.join(root, 'bundle', 'reference-artifacts', INDEX_FILENAME);
    await writeFile(indexPath, `${await readFile(indexPath, 'utf8')}\n// hand edit`);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runCli(root, { ...quiet, bundles: ['bundle'], check: true })).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('stale or hand-edited'));
  });

  it('fails check mode when the index has never been generated', async () => {
    const root = await makeRoot();
    await writeBundle(root, { 'core.md': CORE_DOC });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runCli(root, { ...quiet, bundles: ['bundle'], check: true })).toBe(1);
  });

  it('fails on a doc with invalid front matter, naming the file', async () => {
    const root = await makeRoot();
    await writeBundle(root, { 'core.md': CORE_DOC, 'bare.md': '# Standard: Bare\n' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runCli(root, { ...quiet, bundles: ['bundle'] })).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bare.md'));
  });

  it('refuses a vacuous pass on zero configured bundles', async () => {
    const root = await makeRoot();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runCli(root, { ...quiet, bundles: [] })).toBe(1);
  });

  it('governs the real design-guardrails bundle and its index is current', () => {
    // Repo-integration assertion, same shape as the sibling guards: the
    // checked-in index must match what the checked-in front matter produces.
    const repoRoot = path.resolve(import.meta.dirname, '..');
    expect(GOVERNED_BUNDLES.length).toBeGreaterThan(0);
    expect(runCli(repoRoot, { check: true, log: () => {} })).toBe(0);
  });
});
