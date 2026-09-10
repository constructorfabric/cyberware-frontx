// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  dependencyFieldsChanged,
  discoverManifestOnlyTemplateRoots,
  discoverPackageRoots,
  groupChangedFilesByPackageRoot,
  hasSubstantiveTemplateChange,
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
 * Baseline fixture: two ecosystem packages and one template-shell package,
 * matching this repo's real shape closely enough for `discoverPackageRoots`
 * to exercise both groups.
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
  await writeJson(path.join(root, 'template-shell', 'frontx-template.json'), {});
  await writeJson(path.join(root, 'template-shell', 'package.json'), {
    name: '@gears-frontx/frontx-template-shell',
    version: '0.1.0-alpha.1',
    workspaces: ['packages/*'],
  });
  await writeJson(path.join(root, 'template-shell', 'src', 'entry.ts'), 'export {};\n');
  await writeJson(path.join(root, 'template-shell', 'packages', 'react', 'package.json'), {
    name: '@gears-frontx/react',
    version: '0.2.0-alpha.3',
  });
  await writeJson(path.join(root, 'template-mfe', 'frontx-template.json'), {});
  await writeJson(path.join(root, 'template-mfe', 'package.json'), {
    name: 'frontx-template-mfe-monorepo-harness',
    private: true,
    workspaces: ['src-app/mfe_packages/*'],
  });
  await writeJson(path.join(root, 'template-mfe', 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'), {
    name: '@gears-frontx/demo-mfe',
    private: true,
    version: '0.1.0-alpha.0',
    dependencies: { '@gears-frontx/react': '0.2.0-alpha.3' },
  });
}

const MANIFEST_ONLY_DIR = 'template-design-guardrails';
const MANIFEST_ONLY_NAME = '@gears-frontx/template-design-guardrails';

/**
 * A manifest-only template: frontx-template.json (the only version truth -
 * there is deliberately NO package.json), a DESIGN.md, and the template's own
 * .frontx/ai/<identity>/ bundle subtree. The design-guardrails template shape.
 * Passing `version: null` omits the field entirely (the broken-manifest case).
 * @param {string} root
 * @param {string | null} [version]
 */
async function writeManifestOnlyTemplateFixture(root, version = '0.1.0-alpha.1') {
  await writeJson(path.join(root, MANIFEST_ONLY_DIR, 'frontx-template.json'), {
    schemaVersion: '1.0',
    name: MANIFEST_ONLY_NAME,
    ...(version === null ? {} : { version }),
    ownershipBoundaries: {
      exclusiveSubtrees: ['DESIGN.md', `.frontx/ai/${MANIFEST_ONLY_NAME}/`],
      sharedFiles: [],
    },
  });
  await writeFile(path.join(root, MANIFEST_ONLY_DIR, 'DESIGN.md'), '# Design guardrails\n');
  await writeJson(path.join(root, MANIFEST_ONLY_DIR, '.frontx', 'ai', MANIFEST_ONLY_NAME, 'extension.json'), {
    skills: ['skills/guardrails.md'],
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
  it('finds every packages/* directory plus template-shell itself and template-shell/packages/*, excluding template-mfe and its private fixtures entirely', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);

    expect(discoverPackageRoots(root)).toEqual([
      'packages/api',
      'packages/mfes',
      'template-shell',
      'template-shell/packages/react',
    ]);
  });

  // The scope check alone would NOT exclude a template-mfe fixture (its name
  // IS in the @gears-frontx scope) - only its own `private: true` does. This
  // proves the exemption is the per-package fact, not a heuristic on
  // template-mfe's (unscoped) root manifest.
  it('excludes a scope-qualified fixture package specifically because it is private, not because its template root is unscoped', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);

    const roots = discoverPackageRoots(root);
    expect(roots).not.toContain('template-mfe/src-app/mfe_packages/demo-mfe');
  });
});

describe('groupChangedFilesByPackageRoot', () => {
  it('buckets each changed file under the package root that owns it, dropping files that match no root', () => {
    const roots = ['packages/api', 'template-shell/packages/react'];
    const files = [
      'packages/api/src/index.js',
      'packages/api/package.json',
      'template-shell/packages/react/src/hooks.ts',
      'README.md',
      'template-shell/package.json',
    ];

    const grouped = groupChangedFilesByPackageRoot(files, roots);

    expect(grouped.get('packages/api')).toEqual(['packages/api/src/index.js', 'packages/api/package.json']);
    expect(grouped.get('template-shell/packages/react')).toEqual(['template-shell/packages/react/src/hooks.ts']);
    expect(grouped.size).toBe(2);
  });

  // The nesting scenario change #1 introduces: template-shell is now ALSO a
  // governed root, so a file under its packages/react subdirectory matches
  // BOTH `template-shell/` and `template-shell/packages/react/` as prefixes.
  // The longer (more specific) root must win.
  it('attributes a nested file to the longer (more specific) root, not the also-matching parent', () => {
    const roots = ['template-shell', 'template-shell/packages/react'];
    const files = ['template-shell/packages/react/src/hooks.ts', 'template-shell/src/index.ts'];

    const grouped = groupChangedFilesByPackageRoot(files, roots);

    expect(grouped.get('template-shell/packages/react')).toEqual(['template-shell/packages/react/src/hooks.ts']);
    expect(grouped.get('template-shell')).toEqual(['template-shell/src/index.ts']);
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

  // The #574 scenario this gate exists to catch: template-shell/packages/react
  // is exactly where an ADR-0033-relocated package's source lives.
  it('fails when template-shell/packages/react changes without a bump, the #574 scenario', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'template-shell', 'packages', 'react', 'src', 'index.ts'), 'export {};\n');
    commitAll(root, 'change react src without bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('template-shell/packages/react');
  });

  // Change #1: template-shell itself is now governed (it publishes dist-lib
  // built from its own src/, and is exact-pinned by template-mfe fixtures -
  // the same #574 shape as its packages/react member).
  it('fails when template-shell\'s own src/ changes without a bump to template-shell\'s own version', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'template-shell', 'src', 'entry.ts'), 'export const y = 1;\n');
    commitAll(root, 'change template-shell src without bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('template-shell is still at');
  });

  // The nesting scenario change #1 introduces at the integration level: a
  // change confined to template-shell/packages/react/src must attribute (and
  // demand a bump) at that package, never at the also-matching parent
  // template-shell - the longest-prefix fix in `groupChangedFilesByPackageRoot`
  // is what this end-to-end test guards.
  it('attributes a template-shell/packages/react-only change to that package, not to the parent template-shell', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'template-shell', 'packages', 'react', 'src', 'index.ts'), 'export {};\n');
    await writeJson(path.join(root, 'template-shell', 'packages', 'react', 'package.json'), {
      name: '@gears-frontx/react',
      version: '0.2.0-alpha.4',
    });
    commitAll(root, 'change and bump react only');

    // react bumped, template-shell itself untouched and unchanged - must pass,
    // proving the change was never also attributed to (and demanded a bump
    // from) the parent template-shell root.
    expect(run(root).exitCode).toBe(0);
  });

  it('ignores a change inside a template-mfe fixture package entirely - pinned consumers, not this gate\'s concern', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(
      path.join(root, 'template-mfe', 'src-app', 'mfe_packages', 'demo-mfe', 'src', 'App.tsx'),
      'export {};\n',
    );
    commitAll(root, 'change mfe fixture');

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
  // a real pass would also print. Same rule as template-pin-drift-check.
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
    expect(output).toContain('none of 4 governed package(s) and 0 manifest-only template(s) had substantive changes');
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
    expect(output).toContain('every one of 1 governed root(s) with substantive changes');
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

describe('discoverManifestOnlyTemplateRoots', () => {
  it('returns only the template roots with no package.json, not the manifest+package.json ones', async () => {
    const root = await makeRepo();
    // Mixed fixture: template-shell and template-mfe both carry a manifest AND
    // a package.json; only the guardrails template is manifest-only.
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);

    expect(discoverManifestOnlyTemplateRoots(root)).toEqual([MANIFEST_ONLY_DIR]);
  });
});

describe('hasSubstantiveTemplateChange', () => {
  const templateRoot = MANIFEST_ONLY_DIR;

  it('exempts frontx-template.json itself - the bump edit must not force a second bump', () => {
    expect(hasSubstantiveTemplateChange(templateRoot, [`${templateRoot}/frontx-template.json`])).toBe(false);
  });

  it('exempts a docs-only file', () => {
    expect(hasSubstantiveTemplateChange(templateRoot, [`${templateRoot}/DESIGN.md`])).toBe(false);
  });

  it('counts any other file under the root', () => {
    expect(hasSubstantiveTemplateChange(templateRoot, [`${templateRoot}/.frontx/ai/x/extension.json`])).toBe(true);
  });
});

// A manifest-only template has no package.json - by design, nothing
// installable - so its version truth is the "version" field of
// frontx-template.json itself. The gate must (a) never crash or false-fail on
// such a template's mere presence, and (b) still hold its changes to the
// bump-on-change contract, against the manifest version rather than a
// package.json one.
describe('manifest-only template (frontx-template.json carries the version)', () => {
  it('discovers the manifest-only root, and still passes, when only other packages change', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, 'packages', 'api', 'src', 'index.js'), 'export const x = 2;\n');
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), {
      name: '@gears-frontx/api',
      version: '0.3.0-alpha.1',
    });
    commitAll(root, 'change and bump api only');

    expect(discoverManifestOnlyTemplateRoots(root)).toContain(MANIFEST_ONLY_DIR);
    expect(run(root).exitCode).toBe(0);
  });

  it("fails when a manifest-only template's bundle content changes without a frontx-template.json version bump", async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, '.frontx', 'ai', MANIFEST_ONLY_NAME, 'extension.json'), {
      skills: ['skills/guardrails.md', 'skills/review.md'],
    });
    commitAll(root, 'change guardrails bundle without bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(MANIFEST_ONLY_DIR);
  });

  it("passes when a manifest-only template's content change comes with a frontx-template.json version bump", async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeManifestOnlyTemplateFixture(root, '0.1.0-alpha.2');
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, '.frontx', 'ai', MANIFEST_ONLY_NAME, 'extension.json'), {
      skills: ['skills/guardrails.md', 'skills/review.md'],
    });
    commitAll(root, 'change guardrails bundle and bump the manifest version');

    expect(run(root).exitCode).toBe(0);
  });

  it('passes a commit that touches ONLY frontx-template.json - a bump alone is never substantive', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, 'frontx-template.json'), {
      schemaVersion: '1.0',
      name: MANIFEST_ONLY_NAME,
      version: '0.1.0-alpha.2',
      ownershipBoundaries: {
        exclusiveSubtrees: ['DESIGN.md', `.frontx/ai/${MANIFEST_ONLY_NAME}/`],
        sharedFiles: [],
      },
    });
    commitAll(root, 'bump the manifest version alone');

    expect(run(root).exitCode).toBe(0);
  });

  // The .md exemption is INTENTIONAL: a manifest-only template's docs edits
  // inherit the same isDocsOnlyPath decision as everywhere else in this gate,
  // deliberately - DESIGN.md prose changing alone demands no bump.
  it('passes a commit that touches only DESIGN.md with no bump - the docs-only exemption is inherited on purpose', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeFile(path.join(root, MANIFEST_ONLY_DIR, 'DESIGN.md'), '# Design guardrails, revised\n');
    commitAll(root, 'docs-only edit to the template');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    // The success line counts BOTH kinds of governed root, not just packages.
    expect(output).toContain('none of 4 governed package(s) and 1 manifest-only template(s) had substantive changes');
  });

  // Mirror of the package bump-then-revert case: the manifest version is read
  // from the two endpoint blobs, so an intermediate bump that a later commit
  // reverts must still fail.
  it('fails when a frontx-template.json bump is reverted later in the same PR (bump-then-revert)', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeManifestOnlyTemplateFixture(root, '0.1.0-alpha.2');
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, '.frontx', 'ai', MANIFEST_ONLY_NAME, 'extension.json'), {
      skills: ['skills/guardrails.md', 'skills/review.md'],
    });
    commitAll(root, 'change bundle and bump');
    await writeManifestOnlyTemplateFixture(root, '0.1.0-alpha.1');
    // Re-assert the substantive bundle content so ONLY the version reverts.
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, '.frontx', 'ai', MANIFEST_ONLY_NAME, 'extension.json'), {
      skills: ['skills/guardrails.md', 'skills/review.md'],
    });
    commitAll(root, 'revert the bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(MANIFEST_ONLY_DIR);
  });

  // Governance is classified at the MERGE BASE: a PR that adds a package.json
  // to a previously manifest-only template must not thereby flip the root out
  // of manifest governance in the same PR that changes its content.
  it('still demands a manifest bump when the same PR adds a package.json to a previously manifest-only template', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, 'package.json'), {
      name: 'design-guardrails-harness',
      private: true,
    });
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, '.frontx', 'ai', MANIFEST_ONLY_NAME, 'extension.json'), {
      skills: ['skills/guardrails.md', 'skills/review.md'],
    });
    commitAll(root, 'add a package.json and change the bundle, no manifest bump');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(MANIFEST_ONLY_DIR);
  });

  // A manifest that EXISTS but has no version must fail loudly, not silently
  // exempt the root the way a genuinely absent manifest (new/removed package)
  // does - conflating the two would ungoverned the template forever.
  it('fails loudly, naming the root, when frontx-template.json declares no version at either ref', async () => {
    const root = await makeRepo();
    await writeBaselineFixture(root);
    await writeManifestOnlyTemplateFixture(root, null);
    commitAll(root, 'base');
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeJson(path.join(root, MANIFEST_ONLY_DIR, '.frontx', 'ai', MANIFEST_ONLY_NAME, 'extension.json'), {
      skills: ['skills/guardrails.md', 'skills/review.md'],
    });
    commitAll(root, 'change bundle under a versionless manifest');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(`${MANIFEST_ONLY_DIR}/frontx-template.json`);
    expect(output).toContain('no usable "version"');
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
