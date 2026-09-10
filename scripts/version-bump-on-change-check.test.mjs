// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dependencyFieldsChanged,
  discoverPackageRoots,
  groupChangedFilesByPackageRoot,
  isDocsOnlyPath,
  runCli,
} from './version-bump-on-change-check.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

/**
 * @param {string} filePath
 * @param {unknown} value
 */
async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

/**
 * @param {string} dir
 * @param {string[]} args
 */
function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

/** Builds a fresh git repo with one commit on `develop` carrying the given files. */
async function makeRepo() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-version-bump-'));
  git(rootDir, ['init', '-q', '-b', 'develop']);
  git(rootDir, ['config', 'user.email', 'test@example.com']);
  git(rootDir, ['config', 'user.name', 'Test']);
  return rootDir;
}

/**
 * @param {string} root
 * @param {string} message
 */
function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

/**
 * Baseline fixture: two governed ecosystem packages, matching this repo's
 * real shape closely enough for `discoverPackageRoots` to exercise it.
 * @param {string} root
 */
async function writeBaselineFixture(root) {
  await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
    name: '@gears-frontx/api',
    version: '0.3.0-alpha.0',
  });
  await writeJson(path.join(root, 'packages', 'api', 'src', 'index.js'), 'export const x = 1;\n');
  await writeJson(path.join(root, 'packages', 'mfes', 'package.json'), {
    name: '@gears-frontx/mfes',
    version: '0.3.0-alpha.0',
  });
}

describe('isDocsOnlyPath', () => {
  it('flags a markdown file', () => {
    expect(isDocsOnlyPath('packages/api/src/README.md')).toBe(true);
  });

  it('flags llms.txt regardless of directory', () => {
    expect(isDocsOnlyPath('packages/api/llms.txt')).toBe(true);
  });

  it('does not flag a source file', () => {
    expect(isDocsOnlyPath('packages/api/src/index.ts')).toBe(false);
  });
});

describe('discoverPackageRoots', () => {
  it('finds every non-private packages/* directory', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);

    expect(discoverPackageRoots(root)).toEqual(['packages/api', 'packages/mfes']);
  });

  it('excludes a private packages/* directory', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), {
      name: '@gears-frontx/ui-kit',
      version: '0.1.0-alpha.0',
      private: true,
    });

    expect(discoverPackageRoots(root)).not.toContain('packages/ui-kit');
  });
});

describe('groupChangedFilesByPackageRoot', () => {
  it('buckets each changed file under the package root that owns it, dropping files that match no root', () => {
    const roots = ['packages/api', 'packages/mfes'];
    const files = [
      'packages/api/src/index.js',
      'packages/api/package.json',
      'packages/mfes/src/registry.ts',
      'README.md',
    ];

    const grouped = groupChangedFilesByPackageRoot(files, roots);

    expect(grouped.get('packages/api')).toEqual(['packages/api/src/index.js', 'packages/api/package.json']);
    expect(grouped.get('packages/mfes')).toEqual(['packages/mfes/src/registry.ts']);
    expect(grouped.size).toBe(2);
  });

  it('attributes a nested file to the longer (more specific) root, not the also-matching parent', () => {
    const roots = ['packages/mfes', 'packages/mfes/sub-widget'];
    const files = ['packages/mfes/sub-widget/src/index.ts', 'packages/mfes/src/index.ts'];

    const grouped = groupChangedFilesByPackageRoot(files, roots);

    expect(grouped.get('packages/mfes/sub-widget')).toEqual(['packages/mfes/sub-widget/src/index.ts']);
    expect(grouped.get('packages/mfes')).toEqual(['packages/mfes/src/index.ts']);
  });
});

describe('dependencyFieldsChanged', () => {
  it('flags an added dependency', () => {
    expect(
      dependencyFieldsChanged({ dependencies: {} }, { dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' } }),
    ).toBe(true);
  });

  it('does not flag a version-only edit', () => {
    expect(dependencyFieldsChanged({ version: '0.1.0' }, { version: '0.2.0' })).toBe(false);
  });

  it('does not flag identical dependency sets', () => {
    const deps = { dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' } };
    expect(dependencyFieldsChanged(deps, { ...deps })).toBe(false);
  });

  // sort-package-json, `npm pkg fix` and npm itself all reorder dependency
  // entries without changing their meaning - a pure reorder must not read as
  // a dependency change. Built from JSON text (not object spread) so the two
  // manifests genuinely carry different key orders.
  it('does not flag a pure reorder of dependency entries', () => {
    const base = JSON.parse('{"dependencies": {"b": "1.0.0", "a": "2.0.0"}}');
    const head = JSON.parse('{"dependencies": {"a": "2.0.0", "b": "1.0.0"}}');
    expect(dependencyFieldsChanged(base, head)).toBe(false);
  });
});

describe('hasSubstantiveChange + versionAt (via runCli)', () => {
  it('passes when nothing changed at all', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    // No changes on the feature branch - an empty commit still exercises the
    // merge-base -> HEAD diff path with a genuinely empty changed-file set.
    git(root, ['commit', '-q', '--allow-empty', '-m', 'empty']);

    const { exitCode } = run(root);
    expect(exitCode).toBe(0);
  });

  it('fails when a package\'s src/ changed but its version did not', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'src', 'index.js'), 'export const x = 2;\n');
    commitAll(root, 'change api src without bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('packages/api');
  });

  it('passes when a package\'s src/ changed and its version was bumped', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'src', 'index.js'), 'export const x = 2;\n');
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.1',
    });
    commitAll(root, 'change api src with bump');

    expect(run(root).exitCode).toBe(0);
  });

  it('ignores a docs-only change under src/', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'src', 'README.md'), '# notes\n');
    commitAll(root, 'docs-only under src');

    expect(run(root).exitCode).toBe(0);
  });

  it('fails when a dependency was added to package.json without a version bump, even with src/ untouched', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.0',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.0' },
    });
    commitAll(root, 'add dependency without bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('packages/api');
  });

  it('does not fail on a package.json change that touches only scripts, not dependencies', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.0',
      scripts: { build: 'tsc' },
    });
    commitAll(root, 'add a script, no dependency change');

    expect(run(root).exitCode).toBe(0);
  });

  it('skips a brand-new package entirely - nothing to have bumped FROM', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'telemetry', 'package.json'), {
      name: '@gears-frontx/telemetry',
      version: '0.1.0-alpha.0',
    });
    await writeJson(path.join(root, 'packages', 'telemetry', 'src', 'index.js'), 'export {};\n');
    commitAll(root, 'introduce a new package');

    expect(run(root).exitCode).toBe(0);
  });

  // The bump-then-revert case the issue calls out by name: an intermediate
  // commit bumps the version, a later commit on the SAME branch reverts it -
  // net diff at HEAD shows the original version again, so this must still fail.
  it('fails when a version bump is reverted later in the same PR (bump-then-revert)', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'src', 'index.js'), 'export const x = 2;\n');
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.1',
    });
    commitAll(root, 'change src and bump');
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.0',
    });
    commitAll(root, 'revert the bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('packages/api');
  });

  // Rename detection would list only the destination path, so the package
  // that LOST the file would never be asked to bump - `--no-renames` makes
  // git print both sides. The file is moved verbatim (100% similarity) so
  // git's rename detection, on by default, would otherwise collapse it.
  it('demands a bump from BOTH packages when a file moves from one to the other unchanged', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await mkdir(path.join(root, 'packages', 'mfes', 'src'), { recursive: true });
    git(root, ['mv', 'packages/api/src/index.js', 'packages/mfes/src/index.js']);
    commitAll(root, 'move a module from api to mfes, no bumps');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('packages/api is still at');
    expect(output).toContain('packages/mfes is still at');
  });

  // Zero discovered roots is never a silent pass: an empty discovery means
  // the gate is broken, and "0 governed packages, all fine" is exactly what
  // a real pass would also print. Same rule as ecosystem-pin-drift-check.
  it('fails when discovery finds no governed packages at all', async () => {
    const root = await makeRepo();
    await writeFile(path.join(root, 'notes.txt'), 'no packages here\n');
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeFile(path.join(root, 'notes.txt'), 'still no packages\n');
    commitAll(root, 'change something');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('no governed packages');
  });

  // The success line must report a measured count: a PR touching nothing
  // substantive must not claim every governed package "had substantive
  // changes and bumped".
  it('reports zero substantive packages, not the full governed count, when nothing substantive changed', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeFile(path.join(root, 'README.md'), '# repo\n');
    commitAll(root, 'root docs only');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('none of 2 governed package(s) had substantive changes');
  });

  it('counts only the packages with substantive changes in the success line', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'src', 'index.js'), 'export const x = 2;\n');
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.1',
    });
    commitAll(root, 'change and bump api only');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('every one of 1 governed package(s) with substantive changes');
  });

  it('fails loudly, naming the base ref, when the merge base cannot be resolved', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');

    /** @type {string[]} */
    const lines = [];
    const exitCode = runCli({
      rootDir: root,
      baseRef: 'origin/does-not-exist',
      log: () => {},
      logError: (line) => lines.push(line),
    });
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('origin/does-not-exist');
  });
});

/** Runs the guard against a real repo with its output captured. */
/** @param {string} root */
function run(root) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} line */
  const record = (line) => lines.push(line);
  const exitCode = runCli({ rootDir: root, baseRef: 'develop', log: record, logError: record });
  return { exitCode, output: lines.join('\n') };
}
