// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEPENDENCY_FIELDS,
  ecosystemScopeMatcher,
  isExactRegistryVersionPin,
  readEcosystemPackages,
  readEcosystemTruthVersions,
  readRepoDefinedPackageNames,
} from './ecosystem-packages.mjs';

/** @type {string | undefined} */
let rootDir;

afterEach(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

async function makeRoot() {
  rootDir = await mkdtemp(path.join(tmpdir(), 'frontx-ecosystem-'));
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

/** The three packages the predecessor of this module used to name by hand. */
/**
 * @param {string} root
 * @param {Record<string, string>} [versions]
 */
async function writeEcosystemPackages(root, versions = {}) {
  for (const dir of ['api', 'mfes', 'gts-plugin']) {
    await writeJson(path.join(root, 'packages', dir, 'package.json'), {
      name: `@gears-frontx/${dir}`,
      version: versions[dir] ?? '0.3.0-alpha.0',
    });
  }
}

describe('readEcosystemPackages', () => {
  it('derives the ecosystem from every packages/* manifest, not from a curated subset', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root, { api: '0.4.0-alpha.1' });
    await writeJson(path.join(root, 'packages', 'cli', 'package.json'), {
      name: '@gears-frontx/cli',
      version: '0.3.0-alpha.1',
    });

    expect(readEcosystemPackages(root)).toEqual([
      { dir: 'api', name: '@gears-frontx/api', version: '0.4.0-alpha.1' },
      { dir: 'cli', name: '@gears-frontx/cli', version: '0.3.0-alpha.1' },
      { dir: 'gts-plugin', name: '@gears-frontx/gts-plugin', version: '0.3.0-alpha.0' },
      { dir: 'mfes', name: '@gears-frontx/mfes', version: '0.3.0-alpha.0' },
    ]);
  });

  // The whole reason the hand-maintained array had to go: #496 added
  // `packages/telemetry` while #493 was in review, and nothing noticed.
  it('picks up a package added to packages/ with no list to edit', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'telemetry', 'package.json'), {
      name: '@gears-frontx/telemetry',
      version: '0.3.0-alpha.0',
    });

    expect(readEcosystemTruthVersions(root)['@gears-frontx/telemetry']).toBe('0.3.0-alpha.0');
  });

  it('skips a packages/* directory that carries no manifest at all', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await mkdir(path.join(root, 'packages', 'not-a-package'), { recursive: true });

    expect(readEcosystemPackages(root)).toHaveLength(3);
  });

  // An unusable manifest must never read as "this package has no version to
  // compare against", which is indistinguishable from "none of its pin sites
  // drifted". Each way the read can fail names the file.
  it('fails closed, naming the file, when a manifest cannot be parsed', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeFile(path.join(root, 'packages', 'api', 'package.json'), '{ "name": broken');

    expect(() => readEcosystemPackages(root)).toThrow(/cannot parse .*packages[/\\]api[/\\]package\.json as JSON/);
  });

  it('fails closed, naming the file, when a manifest is not a JSON object', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeFile(path.join(root, 'packages', 'mfes', 'package.json'), '["not", "an", "object"]');

    expect(() => readEcosystemPackages(root)).toThrow(/packages[/\\]mfes[/\\]package\.json is not a JSON object/);
  });

  it('fails closed, naming the file, when a manifest has no valid "name"', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'api', 'package.json'), { version: '0.3.0-alpha.0' });

    expect(() => readEcosystemPackages(root)).toThrow(/packages[/\\]api[/\\]package\.json has no valid "name"/);
  });

  it('fails closed, naming the file, when a manifest has no valid "version"', async () => {
    const root = await makeRoot();
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'packages', 'mfes', 'package.json'), { name: '@gears-frontx/mfes', version: '' });

    expect(() => readEcosystemPackages(root)).toThrow(/packages[/\\]mfes[/\\]package\.json has no valid "version"/);
  });
});

describe('ecosystemScopeMatcher', () => {
  it('recognises the ecosystem scope from the truth map\'s own names, never a written-down string', () => {
    const isEcosystemScopeName = ecosystemScopeMatcher(['@gears-frontx/api', '@gears-frontx/mfes']);

    expect(isEcosystemScopeName('@gears-frontx/telemetry')).toBe(true);
    expect(isEcosystemScopeName('@other-scope/api')).toBe(false);
    expect(isEcosystemScopeName('react')).toBe(false);
  });

  it('treats an unscoped ecosystem package as contributing no scope', () => {
    const isEcosystemScopeName = ecosystemScopeMatcher(['frontx-cli']);

    expect(isEcosystemScopeName('anything')).toBe(false);
  });
});

// The guard's own truth about what it governs. `isExactPin` (the ecosystem
// version policy's helper) answers a DIFFERENT question - "does this range carry
// a range operator" - which a monorepo-local `file:` specifier also answers "no"
// to, so reusing it would report every such specifier as a pinned site drifted
// from a version it never expressed.
describe('isExactRegistryVersionPin', () => {
  it('accepts a bare exact registry version, prerelease included', () => {
    expect(isExactRegistryVersionPin('0.3.0-alpha.1')).toBe(true);
    expect(isExactRegistryVersionPin('1.2.3')).toBe(true);
  });

  it('rejects a local-path or protocol specifier, which expresses no version at all', () => {
    expect(isExactRegistryVersionPin('file:../../../packages/mfes')).toBe(false);
    expect(isExactRegistryVersionPin('link:../mfes')).toBe(false);
    expect(isExactRegistryVersionPin('workspace:*')).toBe(false);
    expect(isExactRegistryVersionPin('git+https://example.com/x.git')).toBe(false);
  });

  it('rejects a range - that is the ecosystem edge-compatibility policy\'s concern', () => {
    expect(isExactRegistryVersionPin('^0.3.0')).toBe(false);
    expect(isExactRegistryVersionPin('*')).toBe(false);
    expect(isExactRegistryVersionPin('>=0.2.0-0')).toBe(false);
  });
});

describe('readRepoDefinedPackageNames', () => {
  it('collects the root name plus every name its workspaces patterns select', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'package.json'), {
      name: 'gears-frontx',
      workspaces: ['packages/*', 'internal/*'],
    });
    await writeEcosystemPackages(root);
    await writeJson(path.join(root, 'internal', 'eslint-config', 'package.json'), {
      name: '@gears-frontx/eslint-config',
      version: '0.2.0-alpha.0',
    });

    const names = readRepoDefinedPackageNames(root);

    expect(names.has('gears-frontx')).toBe(true);
    expect(names.has('@gears-frontx/api')).toBe(true);
    // The name that motivates this function: outside the truth map, still
    // resolved locally by npm, so a pin on it is not an unverifiable pin.
    expect(names.has('@gears-frontx/eslint-config')).toBe(true);
  });

  it('handles a wildcard-free workspace pattern that names one directory', async () => {
    const root = await makeRoot();
    await writeJson(path.join(root, 'package.json'), { name: 'repo', workspaces: ['tools/codegen'] });
    await writeJson(path.join(root, 'tools', 'codegen', 'package.json'), { name: '@repo/codegen' });

    expect(readRepoDefinedPackageNames(root).has('@repo/codegen')).toBe(true);
  });

  it('returns an empty set for a root with no manifest', async () => {
    const root = await makeRoot();

    expect(readRepoDefinedPackageNames(root).size).toBe(0);
  });
});

// #492 review finding 2's "unguarded duplicated literal" class. DEPENDENCY_FIELDS
// is deliberately a local literal here (not an import from
// `validate-content-self-containment.ts`) so no repo-script depends on the CLI
// package being built - a real property worth keeping, but a duplicated literal
// that can silently drift needs a guard. This reads the CANONICAL TypeScript
// source as text (never `import`ed - a `.ts` file isn't loadable by plain node,
// and importing the built `dist/` would reintroduce exactly the build dependency
// this avoids).
describe('duplicated-literal sync guard (#492 review finding 2)', () => {
  it('DEPENDENCY_FIELDS stays in sync with validate-content-self-containment.ts', () => {
    const sourcePath = fileURLToPath(
      new URL('../packages/cli/src/manifest/validate-content-self-containment.ts', import.meta.url),
    );
    const match = /const DEPENDENCY_FIELDS = (\[[^\]]*\])/.exec(readFileSync(sourcePath, 'utf8'));

    expect(match, 'canonical DEPENDENCY_FIELDS declaration not found - did the algorithm module change shape?').not.toBeNull();
    const canonicalFields = JSON.parse((match?.[1] ?? '[]').replace(/'/g, '"'));
    expect(DEPENDENCY_FIELDS).toEqual(canonicalFields);
  });
});
