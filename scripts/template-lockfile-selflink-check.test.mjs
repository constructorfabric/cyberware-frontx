// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findMissingSelfLinks,
  isSelfLinkSpec,
  runCli,
  selfLinkDependenciesOf,
} from './template-lockfile-selflink-check.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-selflink-'));
  return rootDir;
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
}

// A minimal marker manifest - discovery only checks for the file's presence
// (`findTemplateDirs`), never its content.
/** @param {string} templateDir */
async function writeManifest(templateDir) {
  await writeJson(path.join(templateDir, 'frontx-template.json'), {});
}

/** Runs the guard with its output captured, so a case can assert what it named. */
/** @param {string} root */
function run(root) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} line */
  const record = (line) => lines.push(line);
  const exitCode = runCli({ rootDir: root, log: record, logError: record });
  return { exitCode, output: lines.join('\n') };
}

// The exact shapes from the tree this guard protects: template-shell's root
// manifest declares its self-link in `overrides` (the workspace packages
// depend on the name; the override pins it to the template root), and the
// lockfile entry below is what npm's reconciliation drops (#524).
const SELF_NAME = '@gears-frontx/frontx-template-shell';
const manifestWithSelfLink = {
  name: SELF_NAME,
  version: '0.1.0-alpha.2',
  overrides: { [SELF_NAME]: 'file:.' },
};
const lockfileWithSelfLink = {
  lockfileVersion: 3,
  packages: {
    '': { name: SELF_NAME, version: '0.1.0-alpha.2' },
    [`node_modules/${SELF_NAME}`]: { resolved: '', link: true },
  },
};

describe('isSelfLinkSpec', () => {
  it('accepts the declared shape and its normalised variants', () => {
    expect(isSelfLinkSpec('file:.')).toBe(true);
    expect(isSelfLinkSpec('file:./')).toBe(true);
    expect(isSelfLinkSpec('file:')).toBe(true);
  });

  it('rejects file: paths that leave the directory and non-file specs', () => {
    expect(isSelfLinkSpec('file:../..')).toBe(false);
    expect(isSelfLinkSpec('file:./packages/framework')).toBe(false);
    expect(isSelfLinkSpec('0.3.0-alpha.1')).toBe(false);
    expect(isSelfLinkSpec('workspace:*')).toBe(false);
  });
});

describe('selfLinkDependenciesOf', () => {
  it('finds a self-link in any installed-dependency field, with its field named', () => {
    const manifest = {
      dependencies: { a: 'file:.' },
      devDependencies: { b: 'file:./' },
      optionalDependencies: { c: 'file:.' },
    };
    expect(selfLinkDependenciesOf(manifest)).toEqual([
      { name: 'a', field: 'dependencies', spec: 'file:.' },
      { name: 'b', field: 'devDependencies', spec: 'file:./' },
      { name: 'c', field: 'optionalDependencies', spec: 'file:.' },
    ]);
  });

  it('finds the real tree\'s shape: a self-link declared in overrides', () => {
    expect(selfLinkDependenciesOf(manifestWithSelfLink)).toEqual([
      { name: SELF_NAME, field: 'overrides', spec: 'file:.' },
    ]);
  });

  it('finds a self-link in a nested override object under its "." key', () => {
    expect(selfLinkDependenciesOf({ overrides: { a: { '.': 'file:.', b: '1.0.0' } } })).toEqual([
      { name: 'a', field: 'overrides', spec: 'file:.' },
    ]);
  });

  it('ignores overrides that redirect elsewhere', () => {
    expect(selfLinkDependenciesOf({ overrides: { a: '2.0.0', b: 'file:../out', c: { d: 'file:.' } } })).toEqual([]);
  });

  it('ignores peerDependencies - a peer declaration installs no entry to lose', () => {
    expect(selfLinkDependenciesOf({ peerDependencies: { a: 'file:.' } })).toEqual([]);
  });

  it('returns nothing for a manifest with no self-link', () => {
    expect(selfLinkDependenciesOf({ dependencies: { a: '1.0.0', b: 'file:../sibling' } })).toEqual([]);
  });
});

describe('findMissingSelfLinks', () => {
  const base = { templateName: 'template-shell', lockfilePath: 'template-shell/package-lock.json' };

  it('passes when the lockfile carries the link entry', () => {
    expect(
      findMissingSelfLinks({ ...base, manifest: manifestWithSelfLink, lockfile: lockfileWithSelfLink }),
    ).toEqual([]);
  });

  it('reports entry-missing when npm reconciliation dropped it (#524)', () => {
    const lockfile = { lockfileVersion: 3, packages: { '': { name: SELF_NAME } } };
    const findings = findMissingSelfLinks({ ...base, manifest: manifestWithSelfLink, lockfile });
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toBe('entry-missing');
    expect(findings[0].dependency.name).toBe(SELF_NAME);
  });

  it('reports entry-not-link when the entry exists but would install from the registry', () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        '': { name: SELF_NAME },
        [`node_modules/${SELF_NAME}`]: { version: '0.1.0-alpha.2', resolved: 'https://registry.npmjs.org/...' },
      },
    };
    const findings = findMissingSelfLinks({ ...base, manifest: manifestWithSelfLink, lockfile });
    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toBe('entry-not-link');
  });

  it('has nothing to assert for a manifest without a self-link', () => {
    expect(
      findMissingSelfLinks({ ...base, manifest: { dependencies: { x: '1.0.0' } }, lockfile: { packages: {} } }),
    ).toEqual([]);
  });
});

describe('runCli', () => {
  it('passes on a template whose lockfile carries the self-link entry', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'template-shell');
    await writeManifest(dir);
    await writeJson(path.join(dir, 'package.json'), manifestWithSelfLink);
    await writeJson(path.join(dir, 'package-lock.json'), lockfileWithSelfLink);

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('passed');
  });

  it('fails naming the lockfile, the entry, and the #524 remediation when the entry is gone', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'template-shell');
    await writeManifest(dir);
    await writeJson(path.join(dir, 'package.json'), manifestWithSelfLink);
    await writeJson(path.join(dir, 'package-lock.json'), { lockfileVersion: 3, packages: { '': {} } });

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain(`packages["node_modules/${SELF_NAME}"] is missing`);
    expect(output).toContain(path.join('template-shell', 'package-lock.json'));
    expect(output).toContain('issues/524');
    expect(output).toContain('Do NOT re-run `npm install`');
  });

  it('skips an overlay template with no root package.json instead of failing on it', async () => {
    const root = await makeRoot();
    const shell = path.join(root, 'template-shell');
    await writeManifest(shell);
    await writeJson(path.join(shell, 'package.json'), manifestWithSelfLink);
    await writeJson(path.join(shell, 'package-lock.json'), lockfileWithSelfLink);
    // Overlay: manifest marker only, nothing installable at its root.
    await writeManifest(path.join(root, 'template-mfe'));

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('1 installable template(s) of 2 discovered');
  });

  // The doc-only template shape (template-design-guardrails): a
  // manifest, a DESIGN.md, and its own .frontx/ai bundle subtree. No root
  // package.json and no lockfile means no `npm ci` contract to protect -
  // correctly skipped, never a crash or a false failure.
  it('skips a doc-only template (no package.json, no lockfile) instead of failing on it', async () => {
    const root = await makeRoot();
    const shell = path.join(root, 'template-shell');
    await writeManifest(shell);
    await writeJson(path.join(shell, 'package.json'), manifestWithSelfLink);
    await writeJson(path.join(shell, 'package-lock.json'), lockfileWithSelfLink);
    const docOnly = path.join(root, 'template-design-guardrails');
    await writeManifest(docOnly);
    await writeFile(path.join(docOnly, 'DESIGN.md'), '# Design guardrails\n');
    await writeJson(
      path.join(docOnly, '.frontx', 'ai', '@gears-frontx/template-design-guardrails', 'extension.json'),
      { skills: [] },
    );

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('1 installable template(s) of 2 discovered');
  });

  it('skips a template that has a package.json but no lockfile', async () => {
    const root = await makeRoot();
    const shell = path.join(root, 'template-shell');
    await writeManifest(shell);
    await writeJson(path.join(shell, 'package.json'), manifestWithSelfLink);
    await writeJson(path.join(shell, 'package-lock.json'), lockfileWithSelfLink);
    // Lockfile-less: nothing `npm ci` installs at its root, so nothing to assert.
    const bare = path.join(root, 'template-x');
    await writeManifest(bare);
    await writeJson(path.join(bare, 'package.json'), manifestWithSelfLink);

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(0);
    expect(output).toContain('1 installable template(s) of 2 discovered');
  });

  it('fails hard when every discovered template is skipped - a lost lockfile must not disarm the guard', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'template-shell');
    await writeManifest(dir);
    await writeJson(path.join(dir, 'package.json'), manifestWithSelfLink);
    // No package-lock.json: the one discovered template is skipped, so a
    // vacuous pass here would hide a renamed or deleted lockfile forever.

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('nothing was checked');
  });

  it('fails hard when discovery finds no template at all', async () => {
    const root = await makeRoot();
    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('no template found');
  });

  it('fails closed on a lockfile that is not valid JSON, naming the file', async () => {
    const root = await makeRoot();
    const dir = path.join(root, 'template-shell');
    await writeManifest(dir);
    await writeJson(path.join(dir, 'package.json'), manifestWithSelfLink);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package-lock.json'), '{ not json');

    const { exitCode, output } = run(root);
    expect(exitCode).toBe(1);
    expect(output).toContain('not valid JSON');
    expect(output).toContain('package-lock.json');
  });
});

// The guard must stay true on the real tree it protects: template-shell's
// committed manifest and lockfile. A fixture-only suite would keep passing
// after a repo change broke the guard's assumptions about either file's shape
// - which is exactly how the first version of this guard shipped vacuous: it
// scanned only dependency fields while the real manifest declares its
// self-link in `overrides`, so it passed on a lockfile with the entry deleted.
describe('against the real repository', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');

  it('sees at least one self-link in the committed template-shell manifest (vacuity guard)', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(path.join(repoRoot, 'template-shell', 'package.json'), 'utf8'));
    expect(selfLinkDependenciesOf(manifest)).not.toEqual([]);
  });

  it('passes on the committed template-shell manifest and lockfile', () => {
    const { exitCode, output } = run(repoRoot);
    expect(exitCode).toBe(0);
    expect(output).toContain('passed');
  });
});
