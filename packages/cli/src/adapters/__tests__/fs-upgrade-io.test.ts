// Real-fs coverage for the upgrade engine's own disk seams
// (`../fs-upgrade-io.ts`): `createFsReadDiskEntryFn`, `createFsListDiskFilesFn`,
// `createFsWriteDiskFileFn`, `createFsRenameDiskFileFn`,
// `createFsUnlinkDiskFileFn`. Modeled on `fs-canonicalize-target.test.ts`'s
// own real-temp-directory convention — a fake seam cannot honestly exercise
// `lstat`-vs-`stat` or an actual symlink cycle, so these run against a real
// filesystem.
import path from 'node:path';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFsReadDiskEntryFn,
  createFsListDiskFilesFn,
  createFsWriteDiskFileFn,
  createFsRenameDiskFileFn,
  createFsUnlinkDiskFileFn,
} from '../fs-upgrade-io';

describe('fs-upgrade-io', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  async function makeRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-io-'));
    root = dir;
    return dir;
  }

  describe('createFsReadDiskEntryFn', () => {
    it('reports a regular file as {kind: "file", content}', async () => {
      const dir = await makeRoot();
      const filePath = path.join(dir, 'a.txt');
      await writeFile(filePath, 'hello world', 'utf-8');
      const readDiskEntry = createFsReadDiskEntryFn();

      const result = await readDiskEntry(filePath);

      expect(result).toEqual({ kind: 'file', content: 'hello world' });
    });

    it('reports a missing path as {kind: "absent"}, never a throw', async () => {
      const dir = await makeRoot();
      const readDiskEntry = createFsReadDiskEntryFn();

      const result = await readDiskEntry(path.join(dir, 'does-not-exist.txt'));

      expect(result).toEqual({ kind: 'absent' });
    });

    it('reports a directory as {kind: "directory"}', async () => {
      const dir = await makeRoot();
      const subdir = path.join(dir, 'a-directory');
      await mkdir(subdir);
      const readDiskEntry = createFsReadDiskEntryFn();

      const result = await readDiskEntry(subdir);

      expect(result).toEqual({ kind: 'directory' });
    });

    // WHY THIS MATTERS (`inst-cls-if-not-regular`): a symlink sitting where a
    // payload declares a path must refuse fail-closed, never be silently
    // compared as though it were the file it points at. That distinction only
    // exists if this seam uses `lstat` rather than `stat` — `fs.statSync`
    // would resolve the link and report `'file'`, silently turning a refusal
    // into a comparison (`fs-upgrade-io.ts:21-25`'s own header comment).
    it('reports a symlink pointing at a regular file as {kind: "symlink"}, NOT {kind: "file"}', async () => {
      const dir = await makeRoot();
      const targetPath = path.join(dir, 'real.txt');
      await writeFile(targetPath, 'real content', 'utf-8');
      const linkPath = path.join(dir, 'link-to-file.txt');
      await symlink(targetPath, linkPath);
      const readDiskEntry = createFsReadDiskEntryFn();

      const result = await readDiskEntry(linkPath);

      expect(result).toEqual({ kind: 'symlink' });
    });

    it('reports a symlink pointing at a directory as {kind: "symlink"}, NOT {kind: "directory"}', async () => {
      const dir = await makeRoot();
      const targetDir = path.join(dir, 'real-dir');
      await mkdir(targetDir);
      const linkPath = path.join(dir, 'link-to-dir');
      await symlink(targetDir, linkPath);
      const readDiskEntry = createFsReadDiskEntryFn();

      const result = await readDiskEntry(linkPath);

      expect(result).toEqual({ kind: 'symlink' });
    });

    // A broken symlink still stats fine under `lstat` (it inspects the link
    // itself, not what it points at) — reported and pinned here explicitly
    // rather than assumed.
    it('reports a broken symlink (target does not exist) as {kind: "symlink"}', async () => {
      const dir = await makeRoot();
      const linkPath = path.join(dir, 'broken-link');
      await symlink(path.join(dir, 'never-created.txt'), linkPath);
      const readDiskEntry = createFsReadDiskEntryFn();

      const result = await readDiskEntry(linkPath);

      expect(result).toEqual({ kind: 'symlink' });
    });
  });

  describe('createFsListDiskFilesFn', () => {
    it('enumerates regular files recursively, POSIX-relative, including dot-files and dot-directories', async () => {
      const dir = await makeRoot();
      await mkdir(path.join(dir, 'src', 'nested'), { recursive: true });
      await writeFile(path.join(dir, 'top.txt'), '1', 'utf-8');
      await writeFile(path.join(dir, 'src', 'app.ts'), '2', 'utf-8');
      await writeFile(path.join(dir, 'src', 'nested', 'deep.ts'), '3', 'utf-8');
      await writeFile(path.join(dir, '.env'), '4', 'utf-8');
      await mkdir(path.join(dir, '.config'));
      await writeFile(path.join(dir, '.config', 'settings.json'), '5', 'utf-8');
      const listDiskFiles = createFsListDiskFilesFn();

      const result = await listDiskFiles(dir);

      expect(result.sort()).toEqual(
        ['top.txt', 'src/app.ts', 'src/nested/deep.ts', '.env', '.config/settings.json'].sort(),
      );
    });

    it('returns [] for a non-existent directory, never a throw', async () => {
      const dir = await makeRoot();
      const listDiskFiles = createFsListDiskFilesFn();

      const result = await listDiskFiles(path.join(dir, 'never-created'));

      expect(result).toEqual([]);
    });

    it('never includes a symlink pointing at a file', async () => {
      const dir = await makeRoot();
      await writeFile(path.join(dir, 'real.txt'), 'real', 'utf-8');
      await symlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
      const listDiskFiles = createFsListDiskFilesFn();

      const result = await listDiskFiles(dir);

      expect(result).toEqual(['real.txt']);
    });

    it('never includes a symlink pointing at a directory, and never descends into it', async () => {
      const dir = await makeRoot();
      const realDir = path.join(dir, 'real-dir');
      await mkdir(realDir);
      await writeFile(path.join(realDir, 'inside.txt'), 'inside', 'utf-8');
      await symlink(realDir, path.join(dir, 'link-dir'));
      const listDiskFiles = createFsListDiskFilesFn();

      const result = await listDiskFiles(dir);

      // Only the real path to the file is ever reported; the symlinked
      // alias to the same directory is neither listed nor descended into.
      expect(result).toEqual(['real-dir/inside.txt']);
    });

    // BEHAVIOUR CHANGE, deliberate: this walk used to return `node_modules`
    // content, and this test used to assert that. It now skips it, because
    // `node_modules` is excluded by the PAYLOAD DEFINITION itself
    // (`inst-csc-enumerate-files`: a payload is enumerated "never descending
    // into a `node_modules` directory (install-time output, never committed
    // template content)") — not by any ownership term.
    //
    // Measured, not theoretical: this repository's own `template-shell` is
    // 428 MB across 32,813 files, of which 529 are payload. Returning all of
    // it made the resolver's local-origin read encode ~397 MB as ONE bundle
    // envelope string, which exceeds V8's maximum string length —
    // `JSON.stringify` threw `RangeError: Invalid string length`, so
    // `register`/`apply`/`seed` of that template could not complete at all.
    //
    // A project TARGET walk still applies no skip list
    // (`createFsListTargetFilesFn`, `fs-project-io.ts`), because the six-term
    // subtraction genuinely names no such exclusion for owned ground.
    it('skips node_modules, which the payload definition excludes as install output', async () => {
      const dir = await makeRoot();
      await mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}', 'utf-8');
      await writeFile(path.join(dir, 'real.ts'), 'export const a = 1;', 'utf-8');
      const listDiskFiles = createFsListDiskFilesFn();

      const result = await listDiskFiles(dir);

      expect(result).toEqual(['real.ts']);
    });

    // A directory merely NAMED like install output, but not exactly it, is
    // ordinary content — whole-name comparison, never a prefix test.
    it('does not skip a directory whose name merely starts with node_modules', async () => {
      const dir = await makeRoot();
      await mkdir(path.join(dir, 'node_modules_backup'), { recursive: true });
      await writeFile(path.join(dir, 'node_modules_backup', 'keep.ts'), 'x', 'utf-8');
      const listDiskFiles = createFsListDiskFilesFn();

      const result = await listDiskFiles(dir);

      expect(result).toEqual(['node_modules_backup/keep.ts']);
    });

    // Since a symlink is never followed and never descended into, a
    // directory symlink pointing at its own ancestor cannot loop the walk —
    // this should be trivially safe, and is asserted rather than assumed to
    // guard against a future change that starts following links.
    it('does not hang or throw on a directory symlink cycle pointing at its own ancestor', async () => {
      const dir = await makeRoot();
      const childDir = path.join(dir, 'child');
      await mkdir(childDir);
      await writeFile(path.join(childDir, 'file.txt'), 'content', 'utf-8');
      // The cycle: child/self-loop -> child (its own parent directory).
      await symlink(childDir, path.join(childDir, 'self-loop'));
      const listDiskFiles = createFsListDiskFilesFn();

      const result = await listDiskFiles(dir);

      expect(result).toEqual(['child/file.txt']);
    });
  });

  describe('createFsWriteDiskFileFn', () => {
    it('writes content, creating missing parent directories', async () => {
      const dir = await makeRoot();
      const destination = path.join(dir, 'a', 'b', 'c', 'new-file.txt');
      const writeDiskFile = createFsWriteDiskFileFn(dir);

      await writeDiskFile(destination, 'staged content');

      expect(await readFile(destination, 'utf-8')).toBe('staged content');
    });
  });

  describe('createFsRenameDiskFileFn', () => {
    it('renames over an existing destination', async () => {
      const dir = await makeRoot();
      const from = path.join(dir, 'source.txt');
      const to = path.join(dir, 'destination.txt');
      await writeFile(from, 'new content', 'utf-8');
      await writeFile(to, 'old content', 'utf-8');
      const renameDiskFile = createFsRenameDiskFileFn(dir);

      await renameDiskFile(from, to);

      expect(await readFile(to, 'utf-8')).toBe('new content');
      await expect(stat(from)).rejects.toThrow();
    });

    it('creates a missing parent directory of the destination', async () => {
      const dir = await makeRoot();
      const from = path.join(dir, 'source.txt');
      const to = path.join(dir, 'nested', 'new', 'destination.txt');
      await writeFile(from, 'content', 'utf-8');
      const renameDiskFile = createFsRenameDiskFileFn(dir);

      await renameDiskFile(from, to);

      expect(await readFile(to, 'utf-8')).toBe('content');
    });
  });

  describe('createFsUnlinkDiskFileFn', () => {
    it('removes a file', async () => {
      const dir = await makeRoot();
      const filePath = path.join(dir, 'to-remove.txt');
      await writeFile(filePath, 'content', 'utf-8');
      const unlinkDiskFile = createFsUnlinkDiskFileFn(dir);

      await unlinkDiskFile(filePath);

      await expect(stat(filePath)).rejects.toThrow();
    });

    it('is a no-op (does not throw) when the path is already absent', async () => {
      const dir = await makeRoot();
      const unlinkDiskFile = createFsUnlinkDiskFileFn(dir);

      await expect(unlinkDiskFile(path.join(dir, 'never-existed.txt'))).resolves.toBeUndefined();
    });

    it('leaves the containing directory in place', async () => {
      const dir = await makeRoot();
      const subdir = path.join(dir, 'container');
      await mkdir(subdir);
      const filePath = path.join(subdir, 'only-file.txt');
      await writeFile(filePath, 'content', 'utf-8');
      const unlinkDiskFile = createFsUnlinkDiskFileFn(dir);

      await unlinkDiskFile(filePath);

      const dirStat = await stat(subdir);
      expect(dirStat.isDirectory()).toBe(true);
    });
  });
});
