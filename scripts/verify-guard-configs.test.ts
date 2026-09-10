import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyMemberRegistrationInRegistry } from './verify-guard-configs.ts';

describe('verifyMemberRegistrationInRegistry', () => {
  const cleanupDirs: string[] = [];
  const members = ['@gears-frontx/ui-kit'] as const;
  const packageDirs = { '@gears-frontx/ui-kit': 'packages/ui-kit' } as const;

  afterEach(async () => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const registrySourcePath = path.join(
    process.cwd(),
    '.cf-studio',
    'config',
    'artifacts.toml',
  );

  /**
   * Write a fixture registry in which ui-kit is NOT registered as a child
   * system, carrying `ignoreBlock` as an additional `[[ignore]]`.
   *
   * ui-kit is a registered child today, so the real registry exercises only
   * the registered path. The debt path still has to be covered - it is the
   * branch that decides whether an unregistered member's exemption is
   * documented well enough to accept - so these cases redirect the child's
   * `artifacts_dir` away from the package and inject the ignore under test.
   * Redirecting rather than deleting the block keeps the fixture valid TOML
   * and keeps the edit independent of where the block sits in the file.
   */
  async function makeRegistryWithoutChild(ignoreBlock: string): Promise<string> {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), 'verify-guard-configs-'));
    cleanupDirs.push(fixtureDir);

    const registryPath = path.join(fixtureDir, 'artifacts.toml');
    const source = await readFile(registrySourcePath, 'utf8');
    const unregistered = source.replace(
      'artifacts_dir = "packages/ui-kit/architecture"',
      'artifacts_dir = "packages/not-a-member/architecture"',
    );
    const registry = `${ignoreBlock}\n\n${unregistered}`;
    await writeFile(registryPath, registry);

    return registryPath;
  }

  it('accepts ui-kit as a registered child system', () => {
    expect(
      verifyMemberRegistrationInRegistry(registrySourcePath, members, packageDirs),
    ).toEqual([
      expect.objectContaining({
        name: 'Member @gears-frontx/ui-kit: Artifact chain registered for enforcement',
        passed: true,
        message: expect.stringContaining('DESIGN, FEATURE, PRD'),
      }),
    ]);
  });

  it('accepts a documented debt reason when the member is unregistered', async () => {
    const registryPath = await makeRegistryWithoutChild(`[[ignore]]
reason = "UI Kit package has no backing CDSL artifact yet. Removal criterion per the member artifact chain (cpt-frontx-constraint-member-artifact-chain, root DESIGN section 2.2): ui-kit is registered as its own child system owning a PRD, a DESIGN, and at least one FEATURE (never a DECOMPOSITION), per the member artifact chain's 3-layer rule. NOT satisfied by adding a requirement to the root PRD or a component to the root DESIGN - that is the centralized shape the layer partition replaced."
patterns = ["packages/ui-kit/**"]`);

    expect(
      verifyMemberRegistrationInRegistry(registryPath, members, packageDirs),
    ).toEqual([
      expect.objectContaining({
        name: 'Member @gears-frontx/ui-kit: Artifact chain registered for enforcement',
        passed: true,
      }),
    ]);
  });

  it('rejects a matching ignore with only a temporary reason', async () => {
    const registryPath = await makeRegistryWithoutChild(`[[ignore]]
reason = "temporary"
patterns = ["packages/ui-kit/**"]`);

    expect(
      verifyMemberRegistrationInRegistry(registryPath, members, packageDirs),
    ).toEqual([
      expect.objectContaining({
        passed: false,
        message: expect.stringContaining(
          'missing current artifact-chain debt and objective removal criterion',
        ),
      }),
    ]);
  });

  it('fails closed when a matching ignore has no reason', async () => {
    const registryPath = await makeRegistryWithoutChild(`[[ignore]]
patterns = ["packages/ui-kit/**"]`);

    expect(
      verifyMemberRegistrationInRegistry(registryPath, members, packageDirs),
    ).toEqual([
      expect.objectContaining({
        name: 'Member registration: Registry readable',
        passed: false,
        message: expect.stringContaining('an [[ignore]] table with no reason key'),
      }),
    ]);
  });

  it('fails when no matching ignore exists and no child registration remains', async () => {
    const registryPath = await makeRegistryWithoutChild(`[[ignore]]
reason = "Build artifacts and dependencies"
patterns = ["*/dist/*"]`);

    expect(
      verifyMemberRegistrationInRegistry(registryPath, members, packageDirs),
    ).toEqual([
      expect.objectContaining({
        passed: false,
        message: expect.stringContaining('no [[ignore]] recording the debt'),
      }),
    ]);
  });
});
