// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PACK_DIR_NAME,
  RESTORE_JOURNAL_NAME,
  applyLocalPackSubstitution,
  packSubstitutedPackages,
  parseArgs,
  planLocalPackSubstitution,
  restoreSubstitutedManifests,
} from './pin-unpublished-ecosystem-to-local-pack.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-local-pack-'));
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
 * @returns {Promise<Record<string, Record<string, string>>>}
 */
async function readManifest(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** The tree every fixture composes into, mirroring the real composed shell. */
const TREE = 'template-shell';

/**
 * The tree is addressed by PATH, not by a name under the repo, because the real
 * one is a copy in `$RUNNER_TEMP` (#586). The fixtures keep it inside the
 * fixture root anyway, since `packages/*` has to be resolvable from `repoRoot`.
 *
 * @param {string} root
 * @param {...string} segments
 */
function inTree(root, ...segments) {
  return path.join(root, TREE, ...segments);
}

/**
 * Where the tarballs and the journal live: inside the tree, so every `file:`
 * specifier stays a relative path within it.
 *
 * @param {string} root
 * @param {...string} segments
 */
function inPackDir(root, ...segments) {
  return path.join(root, TREE, PACK_DIR_NAME, ...segments);
}

/**
 * The bumped-in-this-PR package the fixtures pin - `@gears-frontx/ui-kit` at
 * `0.4.0-alpha.2` is the real instance from PR #598.
 *
 * @param {string} root
 * @param {string} version version `packages/ui-kit` declares locally
 */
async function writeLocalUiKit(root, version) {
  await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), {
    name: '@gears-frontx/ui-kit',
    version,
    exports: { '.': { import: './dist/index.js' } },
  });
}

/**
 * `readEcosystemPackages` reads only `name` and `version`, so the fixture
 * manifest above is deliberately minimal; the entry-point shape only matters to
 * `packSubstitutedPackages`, which gets its own fixture.
 *
 * @param {string} root
 * @param {Record<string, string>} dependencies
 * @param {Record<string, unknown>} [overrides]
 */
async function writeComposedTree(root, dependencies, overrides) {
  await writeJson(inTree(root, 'package.json'), {
    name: '@gears-frontx/frontx-template-shell',
    version: '0.1.0-alpha.3',
    dependencies,
    ...(overrides ? { overrides } : {}),
  });
}

/**
 * A probe that answers from a fixed set of published specs and never fails, so
 * a test's only variable is which versions the registry carries.
 *
 * @param {string[]} publishedSpecs
 * @returns {import('./pin-unpublished-ecosystem-to-local-pack.mjs').ProbeRegistryFn}
 */
function registryWith(publishedSpecs) {
  const published = new Set(publishedSpecs);
  return (packageName, version) => ({ ok: true, published: published.has(`${packageName}@${version}`) });
}

describe('planLocalPackSubstitution', () => {
  it('substitutes nothing when the registry carries the pinned version', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeComposedTree(root, { '@gears-frontx/ui-kit': '0.4.0-alpha.2' });

    const plan = planLocalPackSubstitution({
      repoRoot: root,
      treeDir: inTree(root),
      probeRegistry: registryWith(['@gears-frontx/ui-kit@0.4.0-alpha.2']),
    });

    expect(plan).toEqual({ ok: true, substitutions: [] });
  });

  it('substitutes the pin when the registry lacks the version and the local package declares it', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeComposedTree(root, { '@gears-frontx/ui-kit': '0.4.0-alpha.2' });

    const plan = planLocalPackSubstitution({
      repoRoot: root,
      treeDir: inTree(root),
      probeRegistry: registryWith(['@gears-frontx/ui-kit@0.4.0-alpha.1']),
    });

    expect(plan).toEqual({
      ok: true,
      substitutions: [
        {
          file: 'package.json',
          field: 'dependencies',
          packageName: '@gears-frontx/ui-kit',
          pinnedVersion: '0.4.0-alpha.2',
          localDir: 'ui-kit',
        },
      ],
    });
  });

  it('refuses when the registry lacks the version and the local package declares a different one', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeComposedTree(root, { '@gears-frontx/ui-kit': '0.4.0-alpha.3' });

    const plan = planLocalPackSubstitution({
      repoRoot: root,
      treeDir: inTree(root),
      probeRegistry: registryWith([]),
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('pin-resolves-nowhere');
    expect(plan.message).toContain('@gears-frontx/ui-kit@0.4.0-alpha.3');
    expect(plan.message).toContain('0.4.0-alpha.2');
  });

  it('refuses when the registry could not answer, rather than reading silence as unpublished', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeComposedTree(root, { '@gears-frontx/ui-kit': '0.4.0-alpha.2' });

    const plan = planLocalPackSubstitution({
      repoRoot: root,
      treeDir: inTree(root),
      probeRegistry: () => ({ ok: false, reason: 'registry-unanswerable', message: 'getaddrinfo EAI_AGAIN registry.npmjs.org' }),
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('registry-unanswerable');
    expect(plan.message).toContain('EAI_AGAIN');
  });

  it('asks the registry once per distinct pin however many manifests declare it', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeComposedTree(root, { '@gears-frontx/ui-kit': '0.4.0-alpha.2' });
    await writeJson(inTree(root, 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'), {
      name: '@gears-frontx/demo-mfe',
      dependencies: { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
    });

    /** @type {string[]} */
    const asked = [];
    /** @type {import('./pin-unpublished-ecosystem-to-local-pack.mjs').ProbeRegistryFn} */
    const probeRegistry = (packageName, version) => {
      asked.push(`${packageName}@${version}`);
      return { ok: true, published: false };
    };

    const plan = planLocalPackSubstitution({ repoRoot: root, treeDir: inTree(root), probeRegistry });

    expect(asked).toEqual(['@gears-frontx/ui-kit@0.4.0-alpha.2']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.substitutions.map((sub) => sub.file).sort()).toEqual([
      'package.json',
      path.join('src-app', 'mfe_packages', 'demo-mfe', 'package.json'),
    ]);
  });

  it('substitutes a non-optional peer-dependency pin, since npm 7+ auto-installs an unsatisfied one', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeJson(inTree(root, 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      peerDependencies: { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
    });

    const plan = planLocalPackSubstitution({ repoRoot: root, treeDir: inTree(root), probeRegistry: registryWith([]) });

    expect(plan).toEqual({
      ok: true,
      substitutions: [
        {
          file: 'package.json',
          field: 'peerDependencies',
          packageName: '@gears-frontx/ui-kit',
          pinnedVersion: '0.4.0-alpha.2',
          localDir: 'ui-kit',
        },
      ],
    });
  });

  it('leaves an optional peer-dependency pin alone, since npm never installs one it can skip', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeJson(inTree(root, 'package.json'), {
      name: '@gears-frontx/frontx-template-shell',
      peerDependencies: { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
      peerDependenciesMeta: { '@gears-frontx/ui-kit': { optional: true } },
    });

    const plan = planLocalPackSubstitution({ repoRoot: root, treeDir: inTree(root), probeRegistry: registryWith([]) });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('no-governed-pin-sites');
  });

  it('refuses when the tree pins no packages/* package at all, instead of reporting a vacuous pass', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');
    await writeComposedTree(root, { react: '19.2.4' });

    const plan = planLocalPackSubstitution({ repoRoot: root, treeDir: inTree(root), probeRegistry: registryWith([]) });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('no-governed-pin-sites');
  });

  it('refuses when the named tree does not exist', async () => {
    const root = await makeRoot();
    await writeLocalUiKit(root, '0.4.0-alpha.2');

    const plan = planLocalPackSubstitution({ repoRoot: root, treeDir: inTree(root), probeRegistry: registryWith([]) });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe('tree-missing');
  });
});

/**
 * The `npm pack --json` body a harness case gets when it does not supply its
 * own: a `files` list that DOES carry the fixture's entry point
 * (`dist/index.js`), so a case testing something else does not also trip the
 * entry-point-in-tarball check by omission.
 */
const PACK_JSON_WITH_ENTRY_POINT =
  '[{"filename":"gears-frontx-ui-kit-0.4.0-alpha.2.tgz","files":[{"path":"package.json"},{"path":"dist/index.js"}]}]';

/**
 * @param {string} root
 * @param {{ entryPointBuilt: boolean; packJson?: string; buildOk?: boolean }} options
 */
function packHarness(root, { entryPointBuilt, packJson = PACK_JSON_WITH_ENTRY_POINT, buildOk = true }) {
  /** @type {string[]} */
  const ran = [];
  /** @type {import('./pin-unpublished-ecosystem-to-local-pack.mjs').RunCommandFn} */
  const runCommand = ({ command, args }) => {
    ran.push(`${command} ${args.join(' ')}`);
    if (args[0] === 'run') {
      if (!buildOk) return { ok: false, message: 'tsup exited 1' };
      // The build is what puts the entry point on disk, so the fake does the
      // same: an "unbuilt" case is exactly the one where it does not.
      if (entryPointBuilt) {
        const distDir = path.join(root, 'packages', 'ui-kit', 'dist');
        writeFileSync(path.join(distDir, 'index.js'), '');
      }
      return { ok: true, stdout: '' };
    }
    return { ok: true, stdout: packJson };
  };
  return { ran, runCommand };
}

/** @type {import('./pin-unpublished-ecosystem-to-local-pack.mjs').PinSubstitution} */
const UI_KIT_SUBSTITUTION = {
  file: 'package.json',
  field: 'dependencies',
  packageName: '@gears-frontx/ui-kit',
  pinnedVersion: '0.4.0-alpha.2',
  localDir: 'ui-kit',
};

describe('packSubstitutedPackages', () => {
  it('packs the built package and reports the tarball npm named', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), {
      name: '@gears-frontx/ui-kit',
      version: '0.4.0-alpha.2',
      exports: { '.': { import: './dist/index.js' } },
    });
    await mkdir(path.join(root, 'packages', 'ui-kit', 'dist'), { recursive: true });
    const { ran, runCommand } = packHarness(root, { entryPointBuilt: true });
    // npm writes the tarball; the fake only reports its name, so the test puts
    // the file where npm would.
    await mkdir(inPackDir(root), { recursive: true });
    await writeFile(inPackDir(root, 'gears-frontx-ui-kit-0.4.0-alpha.2.tgz'), '');

    const packed = packSubstitutedPackages({ repoRoot: root, treeDir: inTree(root), substitutions: [UI_KIT_SUBSTITUTION], runCommand });

    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect(packed.tarballByPackage).toEqual({
      '@gears-frontx/ui-kit': inPackDir(root, 'gears-frontx-ui-kit-0.4.0-alpha.2.tgz'),
    });
    expect(ran).toEqual([
      'npm run build:packages',
      `npm pack --workspace=@gears-frontx/ui-kit --pack-destination=${inPackDir(root)} --json`,
    ]);
  });

  it('refuses to pack a package whose entry point the build did not produce', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), {
      name: '@gears-frontx/ui-kit',
      version: '0.4.0-alpha.2',
      exports: { '.': { import: './dist/index.js' } },
    });
    const { runCommand } = packHarness(root, { entryPointBuilt: false });

    const packed = packSubstitutedPackages({ repoRoot: root, treeDir: inTree(root), substitutions: [UI_KIT_SUBSTITUTION], runCommand });

    expect(packed.ok).toBe(false);
    if (packed.ok) return;
    expect(packed.reason).toBe('unbuilt-package');
    expect(packed.message).toContain(path.join('packages', 'ui-kit', 'dist', 'index.js'));
  });

  it('refuses when the build fails, before any tarball is produced', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), {
      name: '@gears-frontx/ui-kit',
      version: '0.4.0-alpha.2',
      exports: { '.': { import: './dist/index.js' } },
    });
    const { runCommand } = packHarness(root, { entryPointBuilt: false, buildOk: false });

    const packed = packSubstitutedPackages({ repoRoot: root, treeDir: inTree(root), substitutions: [UI_KIT_SUBSTITUTION], runCommand });

    expect(packed.ok).toBe(false);
    if (packed.ok) return;
    expect(packed.reason).toBe('build-failed');
    expect(existsSync(inPackDir(root))).toBe(false);
  });

  it('refuses when npm pack reports a filename that is not on disk', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), {
      name: '@gears-frontx/ui-kit',
      version: '0.4.0-alpha.2',
      exports: { '.': { import: './dist/index.js' } },
    });
    await mkdir(path.join(root, 'packages', 'ui-kit', 'dist'), { recursive: true });
    const { runCommand } = packHarness(root, { entryPointBuilt: true });

    const packed = packSubstitutedPackages({ repoRoot: root, treeDir: inTree(root), substitutions: [UI_KIT_SUBSTITUTION], runCommand });

    expect(packed.ok).toBe(false);
    if (packed.ok) return;
    expect(packed.reason).toBe('pack-failed');
  });

  it('refuses when npm pack ships a tarball missing the entry point the working tree has on disk', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), {
      name: '@gears-frontx/ui-kit',
      version: '0.4.0-alpha.2',
      exports: { '.': { import: './dist/index.js' } },
    });
    // The working-tree check above the `npm pack` call passes: the file is
    // really there. Only `npm pack`'s OWN `files` allowlist excludes it -
    // exactly the gap a pre-pack check alone cannot see.
    await mkdir(path.join(root, 'packages', 'ui-kit', 'dist'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'ui-kit', 'dist', 'index.js'), '');
    const { runCommand } = packHarness(root, {
      entryPointBuilt: false,
      packJson: '[{"filename":"gears-frontx-ui-kit-0.4.0-alpha.2.tgz","files":[{"path":"package.json"}]}]',
    });
    await mkdir(inPackDir(root), { recursive: true });
    await writeFile(inPackDir(root, 'gears-frontx-ui-kit-0.4.0-alpha.2.tgz'), '');

    const packed = packSubstitutedPackages({ repoRoot: root, treeDir: inTree(root), substitutions: [UI_KIT_SUBSTITUTION], runCommand });

    expect(packed.ok).toBe(false);
    if (packed.ok) return;
    expect(packed.reason).toBe('entry-point-not-packed');
    expect(packed.message).toContain('dist/index.js');
  });
});

describe('applyLocalPackSubstitution', () => {
  it('rewrites the pin to the tarball and mirrors it into the root overrides', async () => {
    const root = await makeRoot();
    await writeComposedTree(root, { '@gears-frontx/ui-kit': '0.4.0-alpha.2' });
    const tarballPath = inPackDir(root, 'gears-frontx-ui-kit-0.4.0-alpha.2.tgz');

    const applied = applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [UI_KIT_SUBSTITUTION],
      tarballByPackage: { '@gears-frontx/ui-kit': tarballPath },
    });

    expect(applied.ok).toBe(true);
    const manifest = await readManifest(inTree(root, 'package.json'));
    const expectedSpec = `file:./${PACK_DIR_NAME}/gears-frontx-ui-kit-0.4.0-alpha.2.tgz`;
    expect(manifest.dependencies['@gears-frontx/ui-kit']).toBe(expectedSpec);
    expect(manifest.overrides).toEqual({ '@gears-frontx/ui-kit': expectedSpec });
  });

  it('writes a nested manifest a specifier relative to its own directory', async () => {
    const root = await makeRoot();
    await writeComposedTree(root, { react: '19.2.4' });
    await writeJson(inTree(root, 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'), {
      name: '@gears-frontx/demo-mfe',
      dependencies: { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
    });
    const tarballPath = inPackDir(root, 'gears-frontx-ui-kit-0.4.0-alpha.2.tgz');

    const applied = applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [{ ...UI_KIT_SUBSTITUTION, file: path.join('src-app', 'mfe_packages', 'demo-mfe', 'package.json') }],
      tarballByPackage: { '@gears-frontx/ui-kit': tarballPath },
    });

    expect(applied.ok).toBe(true);
    const manifest = await readManifest(inTree(root, 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'));
    expect(manifest.dependencies['@gears-frontx/ui-kit']).toBe(
      `file:../../../${PACK_DIR_NAME}/gears-frontx-ui-kit-0.4.0-alpha.2.tgz`,
    );
  });

  it('overrides a substituted package in the root manifest even when only a workspace member pins it', async () => {
    const root = await makeRoot();
    await writeComposedTree(root, { react: '19.2.4' });
    await writeJson(inTree(root, 'src-app', 'mfe_packages', 'demo-mfe', 'package.json'), {
      name: '@gears-frontx/demo-mfe',
      dependencies: { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
    });

    applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [{ ...UI_KIT_SUBSTITUTION, file: path.join('src-app', 'mfe_packages', 'demo-mfe', 'package.json') }],
      tarballByPackage: { '@gears-frontx/ui-kit': inPackDir(root, 'x.tgz') },
    });

    // The root is where npm honours `overrides`, and a transitive edge of the
    // packed tarball onto another unpublished ecosystem version is reachable
    // from nowhere else - so the entry has to land here whether or not the root
    // declares the dependency itself.
    const manifest = await readManifest(inTree(root, 'package.json'));
    expect(manifest.overrides).toEqual({ '@gears-frontx/ui-kit': `file:./${PACK_DIR_NAME}/x.tgz` });
    expect(manifest.dependencies).toEqual({ react: '19.2.4' });
  });

  it('keeps an unrelated overrides entry the tree already declared', async () => {
    const root = await makeRoot();
    await writeComposedTree(
      root,
      { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
      { '@gears-frontx/frontx-template-shell': 'file:.' },
    );

    const applied = applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [UI_KIT_SUBSTITUTION],
      tarballByPackage: { '@gears-frontx/ui-kit': inPackDir(root, 'x.tgz') },
    });

    expect(applied.ok).toBe(true);
    const manifest = await readManifest(inTree(root, 'package.json'));
    expect(manifest.overrides).toEqual({
      '@gears-frontx/frontx-template-shell': 'file:.',
      '@gears-frontx/ui-kit': `file:./${PACK_DIR_NAME}/x.tgz`,
    });
  });

  it('refuses when the tree scopes a substituted package to a dependency path instead of one spec', async () => {
    const root = await makeRoot();
    // A nested `overrides` value is valid npm configuration: it scopes the
    // override to one dependency path rather than naming a single spec.
    await writeComposedTree(
      root,
      { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
      { '@gears-frontx/ui-kit': { react: '19.2.4' } },
    );
    const before = await readFile(inTree(root, 'package.json'), 'utf8');

    const applied = applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [UI_KIT_SUBSTITUTION],
      tarballByPackage: { '@gears-frontx/ui-kit': inPackDir(root, 'x.tgz') },
    });

    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toBe('override-not-comparable');
    expect(await readFile(inTree(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('keeps a nested overrides entry for another package instead of dropping it on write', async () => {
    const root = await makeRoot();
    await writeComposedTree(
      root,
      { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
      { '@gears-frontx/api': { react: '19.2.4' } },
    );

    applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [UI_KIT_SUBSTITUTION],
      tarballByPackage: { '@gears-frontx/ui-kit': inPackDir(root, 'x.tgz') },
    });

    const manifest = await readManifest(inTree(root, 'package.json'));
    expect(manifest.overrides).toEqual({
      '@gears-frontx/api': { react: '19.2.4' },
      '@gears-frontx/ui-kit': `file:./${PACK_DIR_NAME}/x.tgz`,
    });
  });

  it('refuses when the tree already overrides a substituted package at a different value, writing nothing', async () => {
    const root = await makeRoot();
    await writeComposedTree(
      root,
      { '@gears-frontx/ui-kit': '0.4.0-alpha.2' },
      { '@gears-frontx/ui-kit': 'file:../vendor/ui-kit' },
    );
    const before = await readFile(inTree(root, 'package.json'), 'utf8');

    const applied = applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [UI_KIT_SUBSTITUTION],
      tarballByPackage: { '@gears-frontx/ui-kit': inPackDir(root, 'x.tgz') },
    });

    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toBe('override-conflict');
    // The refusal has to leave the tree installable-as-committed, so the point
    // of this case is what did NOT happen: no manifest write, no journal.
    expect(await readFile(inTree(root, 'package.json'), 'utf8')).toBe(before);
    expect(existsSync(inPackDir(root, RESTORE_JOURNAL_NAME))).toBe(false);
  });
});

describe('restoreSubstitutedManifests', () => {
  it('puts every rewritten manifest back byte for byte and drops the journal', async () => {
    const root = await makeRoot();
    await writeComposedTree(root, { '@gears-frontx/ui-kit': '0.4.0-alpha.2' });
    const manifestPath = inTree(root, 'package.json');
    const committed = await readFile(manifestPath, 'utf8');

    applyLocalPackSubstitution({
      treeDir: inTree(root),
      substitutions: [UI_KIT_SUBSTITUTION],
      tarballByPackage: { '@gears-frontx/ui-kit': inPackDir(root, 'x.tgz') },
    });
    const outcome = restoreSubstitutedManifests({ treeDir: inTree(root) });

    expect(outcome).toEqual({ ok: true, restored: ['package.json'] });
    expect(await readFile(manifestPath, 'utf8')).toBe(committed);
    expect(existsSync(inPackDir(root, RESTORE_JOURNAL_NAME))).toBe(false);
  });

  it('restores nothing when no substitution ran, since the workflow calls it unconditionally', async () => {
    const root = await makeRoot();

    expect(restoreSubstitutedManifests({ treeDir: inTree(root) })).toEqual({ ok: true, restored: [] });
  });

  it('refuses a journal written for a different tree instead of replaying it', async () => {
    const root = await makeRoot();
    await mkdir(inPackDir(root), { recursive: true });
    await writeJson(inPackDir(root, RESTORE_JOURNAL_NAME), {
      tree: path.join(root, 'template-mfe'),
      manifests: [{ file: 'package.json', original: '{}' }],
    });

    const outcome = restoreSubstitutedManifests({ treeDir: inTree(root) });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('journal-unusable');
  });

  it('refuses a journal naming a path outside the tree, writing nothing', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'packages', 'ui-kit', 'package.json'), { name: '@gears-frontx/ui-kit', version: '1.0.0' });
    await mkdir(inPackDir(root), { recursive: true });
    await writeJson(inPackDir(root, RESTORE_JOURNAL_NAME), {
      tree: inTree(root),
      manifests: [{ file: '../packages/ui-kit/package.json', original: 'clobbered' }],
    });

    const outcome = restoreSubstitutedManifests({ treeDir: inTree(root) });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('journal-escapes-tree');
    expect(await readFile(path.join(root, 'packages', 'ui-kit', 'package.json'), 'utf8')).not.toBe('clobbered');
  });

  it('refuses a journal that is not readable JSON', async () => {
    const root = await makeRoot();
    await mkdir(inPackDir(root), { recursive: true });
    await writeFile(inPackDir(root, RESTORE_JOURNAL_NAME), '{ not json');

    const outcome = restoreSubstitutedManifests({ treeDir: inTree(root) });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('journal-unusable');
  });
});

describe('parseArgs', () => {
  it('reads the tree name and the restore flag', () => {
    expect(parseArgs(['--tree', 'template-shell', '--restore'])).toEqual({
      ok: true,
      tree: 'template-shell',
      restore: true,
    });
  });

  it('refuses a run with no --tree, so the script can never guess which tree to rewrite', () => {
    const parsed = parseArgs(['--restore']);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('--tree');
  });

  it('refuses --tree followed by another flag rather than swallowing it as a directory', () => {
    const parsed = parseArgs(['--tree', '--restore']);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('--tree');
  });

  it('refuses an argument it does not know', () => {
    const parsed = parseArgs(['--tree', 'template-shell', '--force']);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('--force');
  });
});
