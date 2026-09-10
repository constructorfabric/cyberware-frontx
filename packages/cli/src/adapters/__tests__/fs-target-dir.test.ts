// @cpt-dod:cpt-frontx-dod-cli-scaffolding-seed-empty-target:p1
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';

// Created with `vi.hoisted` so the handle exists before the mock factory runs.
// The real module is spread and only `readdir` is replaced, so every case below
// that touches a real directory still goes through the real implementation —
// only the rejection cases override it, one call at a time.
const { readdirMock } = vi.hoisted(() => ({ readdirMock: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: readdirMock };
});

const { readdir: realReaddir } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

// Imported after the mock, so the adapter binds the mocked `readdir`.
const { createFsReadTargetDirFn } = await import('../fs-target-dir');

const created: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-target-dir-'));
  created.push(dir);
  return dir;
}

beforeEach(() => {
  // Default to the real implementation; a case that wants a failure queues a
  // one-shot rejection over it.
  readdirMock.mockReset();
  readdirMock.mockImplementation(realReaddir);
});

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createFsReadTargetDirFn — cpt-frontx-dod-cli-scaffolding-seed-empty-target', () => {
  it('reports an absent path as undefined, distinguishing it from an empty directory', async () => {
    const readTargetDir = createFsReadTargetDirFn();

    const result = await readTargetDir(joinWithinRoot(tmpDir(), 'does-not-exist'));

    expect(result).toBeUndefined();
  });

  it('reports an existing empty directory as an empty listing', async () => {
    const readTargetDir = createFsReadTargetDirFn();

    const result = await readTargetDir(tmpDir());

    expect(result).toEqual([]);
  });

  it('reports the entry names of a directory that holds content', async () => {
    const dir = tmpDir();
    fs.writeFileSync(joinWithinRoot(dir, 'package.json'), '{}');
    fs.mkdirSync(joinWithinRoot(dir, 'src'));
    const readTargetDir = createFsReadTargetDirFn();

    const result = await readTargetDir(dir);

    expect(Array.isArray(result) ? [...result].sort() : result).toEqual(['package.json', 'src']);
  });

  // Its own state, not a listing: reporting `[path]` described a file as a
  // directory containing itself, and sent the refusal down the branch that
  // recommends `frontx add` against a path add cannot use either.
  it('reports a path that exists as a file as not-a-directory rather than as a listing', async () => {
    const file = joinWithinRoot(tmpDir(), 'not-a-dir.txt');
    fs.writeFileSync(file, 'content');
    const readTargetDir = createFsReadTargetDirFn();

    const result = await readTargetDir(file);

    expect(result).toBe('not-a-directory');
  });

  // An unreadable directory says nothing about emptiness; swallowing the error
  // would read it as empty and wave the assembly through.
  //
  // Driven through a mocked `readdir` rejection rather than a real chmod: mode
  // bits do not deny a root process and Windows ignores them, so the on-disk
  // version passed without ever reaching the rethrow on exactly the hosts where
  // it mattered least to run. The contract under test is "a non-ENOENT,
  // non-ENOTDIR rejection propagates", which is expressible without a
  // filesystem that agrees to be unreadable.
  it.each(['EACCES', 'EPERM'])('rethrows a %s failure rather than reporting an unreadable directory as empty', async (code) => {
    readdirMock.mockRejectedValueOnce(Object.assign(new Error(`${code}: permission denied`), { code }));
    const readTargetDir = createFsReadTargetDirFn();

    await expect(readTargetDir('/whatever')).rejects.toThrow(code);
  });

  it('reports ENOENT and ENOTDIR as states rather than rethrowing them', async () => {
    readdirMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    readdirMock.mockRejectedValueOnce(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }));
    const readTargetDir = createFsReadTargetDirFn();

    expect(await readTargetDir('/absent')).toBeUndefined();
    expect(await readTargetDir('/a-file')).toBe('not-a-directory');
  });
});
