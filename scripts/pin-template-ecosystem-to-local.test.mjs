// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPinLocalization, planPinLocalization } from './pin-template-ecosystem-to-local.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-pin-localize-'));
  return rootDir;
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n');
}

/**
 * @param {string} filePath
 * @returns {Promise<unknown>}
 */
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/**
 * @param {unknown} manifest
 * @returns {{ dependencies: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; overrides?: Record<string, string> }}
 */
function asManifest(manifest) {
  return /** @type {{ dependencies: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; overrides?: Record<string, string> }} */ (manifest);
}

/**
 * The one package the fixtures pin at an exact, unpublished-on-this-branch
 * registry version — mirrors `@gears-frontx/mfes` in the real ecosystem.
 *
 * @param {string} root
 */
async function writePinnedPackage(root) {
  await writeJson(path.join(root, 'packages', 'mfes', 'package.json'), {
    name: '@gears-frontx/mfes',
    version: '0.3.0-alpha.3',
  });
}

describe('planPinLocalization', () => {
  it('rewrites a root manifest pin to a file: path and adds a matching overrides entry', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.manifestEdits).toHaveLength(1);
    const [edit] = plan.manifestEdits;
    expect(edit.relFile).toBe('package.json');
    expect(edit.edits).toEqual([
      {
        field: 'dependencies',
        packageName: '@gears-frontx/mfes',
        pinnedVersion: '0.3.0-alpha.3',
        fileSpec: 'file:../packages/mfes',
      },
    ]);
    expect(edit.overrides).toEqual([{ packageName: '@gears-frontx/mfes', fileSpec: 'file:../packages/mfes' }]);

    applyPinLocalization(plan.manifestEdits, root);

    const manifest = asManifest(await readJson(path.join(root, 'template-shell', 'package.json')));
    expect(manifest.dependencies['@gears-frontx/mfes']).toBe('file:../packages/mfes');
    expect(manifest.overrides).toEqual({ '@gears-frontx/mfes': 'file:../packages/mfes' });
  });

  it('computes a deeper relative path for a nested workspace-member manifest, and adds no overrides there', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      workspaces: ['src-app/mfe_packages/*'],
    });
    await writeJson(path.join(root, 'template-shell', 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'), {
      name: 'demo-mfe',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const nestedEdit = plan.manifestEdits.find((/** @type {{ manifestPath: string; relFile: string; edits: { field: string; packageName: string; pinnedVersion: string; fileSpec: string }[]; overrides: { packageName: string; fileSpec: string }[] | null }} */ edit) => edit.relFile !== 'package.json');
    expect(nestedEdit).toBeDefined();
    expect(nestedEdit?.relFile).toBe(path.join('src-app', 'mfe_packages', 'demo-mfe', 'package.json'));
    expect(nestedEdit?.edits[0].fileSpec).toBe('file:../../../../packages/mfes');
    // Only the root manifest may carry `overrides` (see planPinLocalization docblock).
    expect(nestedEdit?.overrides).toBeNull();

    applyPinLocalization(plan.manifestEdits, root);

    const nestedManifest = asManifest(await readJson(
      path.join(root, 'template-shell', 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'),
    ));
    expect(nestedManifest.dependencies['@gears-frontx/mfes']).toBe('file:../../../../packages/mfes');
    expect(nestedManifest.overrides).toBeUndefined();
  });

  it('leaves a pin on a package this repo does not build under packages/* completely untouched', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      dependencies: {
        '@gears-frontx/mfes': '0.3.0-alpha.3',
        '@some-other-scope/unrelated': '1.2.3',
      },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    applyPinLocalization(plan.manifestEdits, root);
    const manifest = asManifest(await readJson(path.join(root, 'template-shell', 'package.json')));
    expect(manifest.dependencies['@some-other-scope/unrelated']).toBe('1.2.3');
  });

  it('fails closed with a non-zero-signalling result when nothing in the template pins a local package', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      dependencies: { '@gears-frontx/mfes': 'file:../packages/mfes' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('nothing-to-substitute');
    expect(plan.message).toMatch(/no pin site/i);
  });

  it('fails closed naming both values when an existing overrides entry disagrees with the local-tree value', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
      overrides: { '@gears-frontx/mfes': 'file:../some/other/path' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('override-conflict');
    expect(plan.message).toMatch(/@gears-frontx\/mfes/);
    expect(plan.message).toMatch(/file:\.\.\/some\/other\/path/);
    expect(plan.message).toMatch(/file:\.\.\/packages\/mfes/);
  });

  it('merges additively with a pre-existing overrides entry for an unrelated package', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
      overrides: { 'some-unrelated-package': '2.0.0' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    applyPinLocalization(plan.manifestEdits, root);
    const manifest = asManifest(await readJson(path.join(root, 'template-shell', 'package.json')));
    expect(manifest.overrides).toEqual({
      'some-unrelated-package': '2.0.0',
      '@gears-frontx/mfes': 'file:../packages/mfes',
    });
  });

  it('fails closed when the only pin site is in peerDependencies', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    const manifestPath = path.join(root, 'template-shell', 'package.json');
    await writeJson(manifestPath, {
      name: '@gears-frontx/frontx-template-shell',
      peerDependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
    });
    const before = await readFile(manifestPath, 'utf8');

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('nothing-to-substitute');

    const after = await readFile(manifestPath, 'utf8');
    expect(after).toBe(before);
  });

  it('localizes a real dependency pin but leaves a coexisting peerDependencies pin untouched, with exactly one overrides entry', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
      peerDependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.manifestEdits).toHaveLength(1);
    const [edit] = plan.manifestEdits;
    expect(edit.edits).toHaveLength(1);
    expect(edit.edits[0].field).toBe('dependencies');
    expect(edit.overrides).toEqual([{ packageName: '@gears-frontx/mfes', fileSpec: 'file:../packages/mfes' }]);

    applyPinLocalization(plan.manifestEdits, root);
    const manifest = asManifest(await readJson(path.join(root, 'template-shell', 'package.json')));
    expect(manifest.dependencies['@gears-frontx/mfes']).toBe('file:../packages/mfes');
    expect(manifest.peerDependencies?.['@gears-frontx/mfes']).toBe('0.3.0-alpha.3');
  });

  it('localizes an optionalDependencies pin (allowlist is not over-narrow)', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      optionalDependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    applyPinLocalization(plan.manifestEdits, root);
    const manifest = asManifest(await readJson(path.join(root, 'template-shell', 'package.json')));
    expect(manifest.optionalDependencies?.['@gears-frontx/mfes']).toBe('file:../packages/mfes');
  });
});

describe('applyPinLocalization log lines', () => {
  it('reports the root manifest path exactly once, for both the dependency rewrite and the overrides merge', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const lines = applyPinLocalization(plan.manifestEdits, root);
    expect(lines).toEqual([
      `@gears-frontx/mfes 0.3.0-alpha.3 -> file:../packages/mfes (${path.join('template-shell', 'package.json')} / dependencies)`,
      `@gears-frontx/mfes -> file:../packages/mfes (${path.join('template-shell', 'package.json')} / overrides)`,
    ]);
  });

  it('reports a nested manifest at its own repo-relative path exactly once, not double-joined with its own directory', async () => {
    const root = await makeRoot();
    await writePinnedPackage(root);
    await writeJson(path.join(root, 'template-shell', 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      workspaces: ['src-app/mfe_packages/*'],
    });
    await writeJson(path.join(root, 'template-shell', 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'), {
      name: 'demo-mfe',
      dependencies: { '@gears-frontx/mfes': '0.3.0-alpha.3' },
    });

    const plan = planPinLocalization({ repoRoot: root });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const lines = applyPinLocalization(plan.manifestEdits, root);
    const nestedPath = path.join('template-shell', 'src-app', 'mfe_packages', 'demo-mfe', 'package.json');
    const nestedLine = lines.find((line) => line.includes('demo-mfe'));
    expect(nestedLine).toBe(
      `@gears-frontx/mfes 0.3.0-alpha.3 -> file:../../../../packages/mfes (${nestedPath} / dependencies)`,
    );
    expect(nestedLine).not.toMatch(/demo-mfe[\\/].*demo-mfe/);
  });
});
