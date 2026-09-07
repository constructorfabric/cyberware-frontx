// Real-fs coverage for `createFsBundleExistsFn`/`createFsCopyBundleFn`/
// `createFsRemoveBundleFn` (`cpt-frontx-algo-cli-scaffolding-ai-bundle`) —
// kept in its own file, mirroring `fs-canonicalize-target.test.ts`'s own
// rationale for a dedicated real-fs suite alongside the pure-logic fakes in
// `__tests__/ai-bundle.test.ts`.
//
// The nested-folder shape used below (`extension.json` plus a
// `guidelines/`-style subdirectory with more than one file) mirrors the
// REAL convention folders this checkpoint verified on disk at
// `template-shell/.frontx/ai/@gears-frontx/frontx-template-shell/` and
// `template-mfe/.frontx/ai/@gears-frontx/frontx-template-mfe/` — a scoped
// manifest name (containing its own "/") with more than one file at more
// than one depth, not a single flat file a shallower fixture could pass
// against by accident.
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsBundleExistsFn, createFsCopyBundleFn, createFsRemoveBundleFn } from '../fs-ai-bundle';

const MANIFEST_NAME = '@gears-frontx/frontx-template-shell';

describe('fs-ai-bundle real adapters', () => {
  let sourceRoot: string;
  let destRoot: string;

  afterEach(async () => {
    if (sourceRoot) await rm(sourceRoot, { recursive: true, force: true });
    if (destRoot) await rm(destRoot, { recursive: true, force: true });
    sourceRoot = '';
    destRoot = '';
  });

  async function makeDir(prefix: string): Promise<string> {
    return mkdtemp(path.join(tmpdir(), prefix));
  }

  async function writeRealBundleFixture(root: string): Promise<void> {
    const bundleDir = path.join(root, '.frontx', 'ai', MANIFEST_NAME);
    await mkdir(path.join(bundleDir, 'guidelines'), { recursive: true });
    await writeFile(path.join(bundleDir, 'extension.json'), JSON.stringify({ name: MANIFEST_NAME }));
    await writeFile(path.join(bundleDir, 'guidelines', 'mfe-package-contract.md'), '# contract');
    await writeFile(path.join(bundleDir, 'guidelines', 'navigation-composition.md'), '# navigation');
  }

  describe('createFsBundleExistsFn', () => {
    it('reports false when no bundle folder exists yet', async () => {
      sourceRoot = await makeDir('frontx-ai-bundle-exists-');
      const bundleExists = createFsBundleExistsFn();

      expect(await bundleExists(sourceRoot, MANIFEST_NAME)).toBe(false);
    });

    it('reports true once a real bundle folder is on disk', async () => {
      sourceRoot = await makeDir('frontx-ai-bundle-exists-');
      await writeRealBundleFixture(sourceRoot);
      const bundleExists = createFsBundleExistsFn();

      expect(await bundleExists(sourceRoot, MANIFEST_NAME)).toBe(true);
    });

    // A dangling symlink standing at the bundle path — its own target
    // already removed, the link itself still present — must be reported as
    // existing: `existsSync` follows the final path component and would
    // read it as absent, but `lstat` reports the entry AT the path without
    // dereferencing it, so a dangling link is "there" regardless of whether
    // its target is.
    it('reports true when the bundle path is a dangling symlink', async () => {
      sourceRoot = await makeDir('frontx-ai-bundle-exists-dangling-');
      const bundleDir = path.join(sourceRoot, '.frontx', 'ai', MANIFEST_NAME);
      await mkdir(path.dirname(bundleDir), { recursive: true });
      await symlink(path.join(sourceRoot, 'nonexistent-target'), bundleDir);
      const bundleExists = createFsBundleExistsFn();

      expect(await bundleExists(sourceRoot, MANIFEST_NAME)).toBe(true);
    });
  });

  describe('createFsCopyBundleFn', () => {
    it('copies a real nested bundle folder verbatim into the destination root', async () => {
      sourceRoot = await makeDir('frontx-ai-bundle-source-');
      destRoot = await makeDir('frontx-ai-bundle-dest-');
      await writeRealBundleFixture(sourceRoot);
      const copyBundle = createFsCopyBundleFn();

      await copyBundle(sourceRoot, destRoot, MANIFEST_NAME);

      const destBundleDir = path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME);
      expect(existsSync(path.join(destBundleDir, 'extension.json'))).toBe(true);
      const contract = await readFile(path.join(destBundleDir, 'guidelines', 'mfe-package-contract.md'), 'utf-8');
      expect(contract).toBe('# contract');
      const navigation = await readFile(path.join(destBundleDir, 'guidelines', 'navigation-composition.md'), 'utf-8');
      expect(navigation).toBe('# navigation');
      // The source is untouched — this is a copy, never a move.
      expect(existsSync(path.join(sourceRoot, '.frontx', 'ai', MANIFEST_NAME, 'extension.json'))).toBe(true);
    });

    // `fs.cpSync` internally dereferences its destination to decide
    // file-vs-directory, and dereferencing a DANGLING symlink throws a
    // native `filesystem_error` no JS `try`/`catch` around this call can
    // see, aborting the whole process — so copying onto a dangling symlink
    // destination must replace it with a real directory rather than
    // dereference it. This state arises in practice by applying a template,
    // deleting its last target (removing the bundle), replacing
    // `.frontx/ai/<identity>` with a symlink to a nonexistent path still
    // INSIDE the project (so containment allows it), then applying again.
    it('copies successfully onto a dangling symlink destination, replacing it with a real directory', async () => {
      sourceRoot = await makeDir('frontx-ai-bundle-source-');
      destRoot = await makeDir('frontx-ai-bundle-dest-');
      await writeRealBundleFixture(sourceRoot);
      const destBundleDir = path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME);
      await mkdir(path.dirname(destBundleDir), { recursive: true });
      await symlink(path.join(destRoot, 'nonexistent-target'), destBundleDir);
      const copyBundle = createFsCopyBundleFn();

      await expect(copyBundle(sourceRoot, destRoot, MANIFEST_NAME)).resolves.toBeUndefined();

      expect(lstatSync(destBundleDir).isSymbolicLink()).toBe(false);
      expect(lstatSync(destBundleDir).isDirectory()).toBe(true);
      expect(existsSync(path.join(destBundleDir, 'extension.json'))).toBe(true);
    });

    // The live-symlink mirror of the above: a symlink at the bundle path
    // whose target DOES exist (elsewhere inside the project) behaves the
    // same way — the stale link is removed and replaced with a real,
    // freshly-copied directory, while the symlink's former target (reachable
    // from elsewhere) is left untouched, since only the link itself, never
    // what it points at, is ever removed.
    it('copies successfully onto an existing (live) symlink destination, leaving its former target untouched', async () => {
      sourceRoot = await makeDir('frontx-ai-bundle-source-');
      destRoot = await makeDir('frontx-ai-bundle-dest-');
      await writeRealBundleFixture(sourceRoot);
      const destBundleDir = path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME);
      const elsewhere = path.join(destRoot, 'elsewhere-real-dir');
      await mkdir(elsewhere, { recursive: true });
      await writeFile(path.join(elsewhere, 'keep.txt'), 'do not delete me', 'utf-8');
      await mkdir(path.dirname(destBundleDir), { recursive: true });
      await symlink(elsewhere, destBundleDir);
      const copyBundle = createFsCopyBundleFn();

      await expect(copyBundle(sourceRoot, destRoot, MANIFEST_NAME)).resolves.toBeUndefined();

      expect(lstatSync(destBundleDir).isSymbolicLink()).toBe(false);
      expect(existsSync(path.join(destBundleDir, 'extension.json'))).toBe(true);
      // The former target of the link is untouched — only the stale
      // reference to it was removed, never the directory itself.
      expect(existsSync(path.join(elsewhere, 'keep.txt'))).toBe(true);
    });

    // The containment guard this fix must not weaken: a bundle path that
    // resolves outside the project (here, `.frontx` itself replaced with a
    // symlink escaping the root) is still refused before any removal or
    // copy is attempted — mirroring the existing coverage in
    // `../../__tests__/fs-containment.test.ts`.
    it('still refuses when the destination resolves outside the project root via a symlinked ancestor', async () => {
      sourceRoot = await makeDir('frontx-ai-bundle-source-');
      destRoot = await makeDir('frontx-ai-bundle-dest-');
      await writeRealBundleFixture(sourceRoot);
      const outsideDir = await makeDir('frontx-ai-bundle-outside-');
      try {
        await symlink(outsideDir, path.join(destRoot, '.frontx'));
        const copyBundle = createFsCopyBundleFn();

        await expect(copyBundle(sourceRoot, destRoot, MANIFEST_NAME)).rejects.toThrow(/outside the project root/);
        expect(existsSync(path.join(outsideDir, 'ai', MANIFEST_NAME))).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('createFsRemoveBundleFn', () => {
    it('removes a real bundle folder recursively', async () => {
      destRoot = await makeDir('frontx-ai-bundle-remove-');
      await writeRealBundleFixture(destRoot);
      const removeBundle = createFsRemoveBundleFn();

      await removeBundle(destRoot, MANIFEST_NAME);

      expect(existsSync(path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME))).toBe(false);
    });

    it('is a no-op, not a throw, when nothing exists to remove', async () => {
      destRoot = await makeDir('frontx-ai-bundle-remove-noop-');
      const removeBundle = createFsRemoveBundleFn();

      await expect(removeBundle(destRoot, MANIFEST_NAME)).resolves.toBeUndefined();
    });

    // Removal removes the LINK, never what it points at — whether the link
    // is dangling or live. `fs.rmSync` (Node's own documented behaviour)
    // unlinks a symlink at `path` rather than recursing through it, but this
    // proves it directly for the bundle path rather than assuming it.
    it('removes a dangling symlink standing at the bundle path', async () => {
      destRoot = await makeDir('frontx-ai-bundle-remove-dangling-');
      const bundleDir = path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME);
      await mkdir(path.dirname(bundleDir), { recursive: true });
      await symlink(path.join(destRoot, 'nonexistent-target'), bundleDir);
      const removeBundle = createFsRemoveBundleFn();

      await removeBundle(destRoot, MANIFEST_NAME);

      expect(existsSync(bundleDir)).toBe(false);
    });

    it('removes a live symlink standing at the bundle path without touching its target', async () => {
      destRoot = await makeDir('frontx-ai-bundle-remove-live-link-');
      const bundleDir = path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME);
      const elsewhere = path.join(destRoot, 'elsewhere-real-dir');
      await mkdir(elsewhere, { recursive: true });
      await writeFile(path.join(elsewhere, 'keep.txt'), 'do not delete me', 'utf-8');
      await mkdir(path.dirname(bundleDir), { recursive: true });
      await symlink(elsewhere, bundleDir);
      const removeBundle = createFsRemoveBundleFn();

      await removeBundle(destRoot, MANIFEST_NAME);

      // The link itself is gone...
      expect(existsSync(bundleDir)).toBe(false);
      // ...but the directory it pointed at, and its content, survive.
      expect(existsSync(path.join(elsewhere, 'keep.txt'))).toBe(true);
    });
  });
});

// The exact end-to-end reproduction from the task brief, run directly
// against the two real seams together (rather than through the full CLI
// process) since that is what the FIX lives in: apply a template (bundle
// materialized), delete its last target (bundle removed, dangling link left
// in its place by a hostile or careless actor), replace
// `.frontx/ai/<identity>` with a symlink to a nonexistent path still INSIDE
// the project, then apply again. Before the fix, `copyBundle` handed
// `fs.cpSync` that dangling symlink as a destination and the process
// aborted with an uncatchable native `filesystem_error`; this proves the
// full sequence now completes, leaves a real directory behind, and never
// throws.
describe('defect regression — dangling bundle symlink no longer aborts a subsequent apply', () => {
  let sourceRoot: string;
  let destRoot: string;
  const MANIFEST_NAME = 'acme/regression-template';

  afterEach(async () => {
    if (sourceRoot) await rm(sourceRoot, { recursive: true, force: true });
    if (destRoot) await rm(destRoot, { recursive: true, force: true });
    sourceRoot = '';
    destRoot = '';
  });

  it('reports the dangling bundle as existing, removes it, then re-applies onto it without aborting', async () => {
    sourceRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-regression-source-'));
    destRoot = await mkdtemp(path.join(tmpdir(), 'frontx-ai-bundle-regression-dest-'));
    const bundleSourceDir = path.join(sourceRoot, '.frontx', 'ai', MANIFEST_NAME);
    await mkdir(bundleSourceDir, { recursive: true });
    await writeFile(path.join(bundleSourceDir, 'extension.json'), JSON.stringify({ name: MANIFEST_NAME }));

    const bundleExists = createFsBundleExistsFn();
    const copyBundle = createFsCopyBundleFn();
    const removeBundle = createFsRemoveBundleFn();

    // apply #1: bundle materialized normally.
    await copyBundle(sourceRoot, destRoot, MANIFEST_NAME);
    const destBundleDir = path.join(destRoot, '.frontx', 'ai', MANIFEST_NAME);
    expect(existsSync(path.join(destBundleDir, 'extension.json'))).toBe(true);

    // delete of the last target: bundle removed.
    await removeBundle(destRoot, MANIFEST_NAME);
    expect(existsSync(destBundleDir)).toBe(false);

    // A dangling symlink to a nonexistent path INSIDE the project is left
    // standing exactly where the bundle used to be.
    await symlink(path.join(destRoot, 'still-does-not-exist'), destBundleDir);

    // Defect 2's fix: this must now be reported as existing (dangling or
    // not), not silently absent.
    expect(await bundleExists(destRoot, MANIFEST_NAME)).toBe(true);

    // apply #2: this is the exact call that used to abort the process with
    // an uncatchable native `filesystem_error`.
    await expect(copyBundle(sourceRoot, destRoot, MANIFEST_NAME)).resolves.toBeUndefined();

    expect(lstatSync(destBundleDir).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(destBundleDir, 'extension.json'))).toBe(true);
  });
});
