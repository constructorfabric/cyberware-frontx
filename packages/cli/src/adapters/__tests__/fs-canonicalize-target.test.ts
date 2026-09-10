// Real-fs coverage for `createFsCanonicalizeTargetFn`
// (`cpt-frontx-algo-cli-scaffolding-conflict-check`, `inst-cc-canonicalize`)
// — kept in its OWN file rather than added to `fs-project-io.test.ts`, which
// this checkpoint's project-state-store work is concurrently extending.
//
// A target under check ordinarily does not exist on disk yet (the pre-flight
// check runs before anything is materialized), so every "happy path" case
// here deliberately checks a path that has never been created, proving the
// nearest-existing-ancestor walk does not require the full target to exist.
// The `symlinks` suite is the one case a fake `CanonicalizeTargetFn` seam
// cannot honestly exercise — an ACTUAL escaping symlink, resolved by the real
// filesystem.
import path from 'node:path';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsCanonicalizeTargetFn } from '../fs-project-io';

describe('createFsCanonicalizeTargetFn', () => {
  let projectRoot: string;
  let outsideDir: string;

  afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    projectRoot = '';
    outsideDir = '';
  });

  async function makeProjectRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-canonicalize-target-'));
    projectRoot = dir;
    return dir;
  }

  it('canonicalizes a target that does not exist yet, one level deep', async () => {
    const dir = await makeProjectRoot();
    const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

    const result = canonicalizeTarget('packages/brand-new-app');

    expect(result).toBe('packages/brand-new-app');
  });

  it('canonicalizes a target several levels deep, none of which exist yet', async () => {
    const dir = await makeProjectRoot();
    const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

    const result = canonicalizeTarget('packages/brand-new-app/src/deeply/nested');

    expect(result).toBe('packages/brand-new-app/src/deeply/nested');
  });

  it('canonicalizes a target that already exists on disk', async () => {
    const dir = await makeProjectRoot();
    await mkdir(path.join(dir, 'packages', 'existing'), { recursive: true });
    const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

    const result = canonicalizeTarget('packages/existing');

    expect(result).toBe('packages/existing');
  });

  // `.` is a legitimate target — the project root itself
  // (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own text uses exactly
  // this example). Spelled `.`, never `""`: every containment predicate a
  // caller builds a target claim through (`paths/relative-path.ts`'s
  // `pathWithinTarget`/`targetsNest`) treats `""` as a DECLARATION
  // addressing no location at all, not a real, addressable target — the
  // two must never share one spelling.
  it('canonicalizes "." (the project root as a target) to "."', async () => {
    const dir = await makeProjectRoot();
    const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

    const result = canonicalizeTarget('.');

    expect(result).toBe('.');
  });

  it('canonicalizes an equivalent spelling of the project root ("./") to "." as well', async () => {
    const dir = await makeProjectRoot();
    const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

    const result = canonicalizeTarget('./');

    expect(result).toBe('.');
  });

  it('returns INVALID_PATH (null) for a lexical ".." escape, even with no symlink involved', async () => {
    const dir = await makeProjectRoot();
    const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

    const result = canonicalizeTarget('../escape');

    expect(result).toBeNull();
  });

  describe('symlinks', () => {
    it('canonicalizes through a real symlinked ancestor directory that stays inside the project root', async () => {
      const dir = await makeProjectRoot();
      await mkdir(path.join(dir, 'real-packages'), { recursive: true });
      await symlink(path.join(dir, 'real-packages'), path.join(dir, 'packages'));
      const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

      const result = canonicalizeTarget('packages/new-target');

      expect(result).toBe('real-packages/new-target');
    });

    // The escape this whole step exists to catch: a symlink already on disk,
    // somewhere along the target's path, that resolves outside the project
    // root — proven here against a REAL filesystem, not a fake seam.
    it('returns INVALID_PATH (null) when a real symlink on the target path resolves outside the project root', async () => {
      const dir = await makeProjectRoot();
      outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-canonicalize-outside-'));
      await symlink(outsideDir, path.join(dir, 'escaping-link'));
      const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

      const result = canonicalizeTarget('escaping-link/new-target');

      expect(result).toBeNull();
    });

    it('returns INVALID_PATH (null) when the project root itself is escaped via a nonexistent nested remainder through an escaping symlink', async () => {
      const dir = await makeProjectRoot();
      outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-canonicalize-outside-'));
      await symlink(outsideDir, path.join(dir, 'escaping-link'));
      const canonicalizeTarget = createFsCanonicalizeTargetFn(dir);

      const result = canonicalizeTarget('escaping-link/deep/not/created/yet');

      expect(result).toBeNull();
    });
  });

  it('throws, naming the path, when the project root itself cannot be resolved', () => {
    expect(() => createFsCanonicalizeTargetFn('/definitely/does/not/exist/frontx-fixture-root')).toThrow(
      '/definitely/does/not/exist/frontx-fixture-root',
    );
  });
});
