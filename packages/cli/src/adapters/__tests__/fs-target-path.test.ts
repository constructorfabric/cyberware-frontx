// @cpt-dod:cpt-frontx-dod-cli-scaffolding-add-undeclared-content:p1
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';

// Created with `vi.hoisted` so the handle exists before the mock factory runs.
// The real module is spread and only `stat` is replaced, so every case below
// that touches a real path still goes through the real implementation — only the
// rejection cases override it, one call at a time.
const { statMock } = vi.hoisted(() => ({ statMock: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, stat: statMock };
});

const { stat: realStat } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

// Imported after the mock, so the adapter binds the mocked `stat`.
const { createFsReadTargetPathStateFn } = await import('../fs-target-path');

const created: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-target-path-'));
  created.push(dir);
  return dir;
}

beforeEach(() => {
  // Default to the real implementation; a case that wants a failure queues a
  // one-shot rejection over it.
  statMock.mockReset();
  statMock.mockImplementation(realStat);
});

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createFsReadTargetPathStateFn — cpt-frontx-dod-cli-scaffolding-add-undeclared-content', () => {
  it('reports a path nothing stands at as absent, the free ground materialization writes into', async () => {
    const readTargetPathState = createFsReadTargetPathStateFn();

    expect(await readTargetPathState(joinWithinRoot(tmpDir(), 'does-not-exist'))).toBe('absent');
  });

  it('reports an existing file as a file, so the guard sees content a write would destroy', async () => {
    const file = joinWithinRoot(tmpDir(), 'held.ts');
    fs.writeFileSync(file, 'content');
    const readTargetPathState = createFsReadTargetPathStateFn();

    expect(await readTargetPathState(file)).toBe('file');
  });

  it('reports an existing directory as a directory, which is what the target path itself must be', async () => {
    const readTargetPathState = createFsReadTargetPathStateFn();

    expect(await readTargetPathState(tmpDir())).toBe('directory');
  });

  // A write through the link lands on what it points at, so the link is the
  // occupant of this path, not an absence.
  it('resolves a symlink to what it points at rather than reporting the link itself', async () => {
    const dir = tmpDir();
    fs.writeFileSync(joinWithinRoot(dir, 'real.ts'), 'content');
    fs.symlinkSync(joinWithinRoot(dir, 'real.ts'), joinWithinRoot(dir, 'link.ts'));
    const readTargetPathState = createFsReadTargetPathStateFn();

    expect(await readTargetPathState(joinWithinRoot(dir, 'link.ts'))).toBe('file');
  });

  // The link resolves to nothing, so the resolving `stat` reports it missing —
  // but the link IS an entry, and a write through it creates the file it names,
  // which for a link pointing outside the target lands outside the directory
  // being guarded. Reported as occupied so the guard refuses it.
  it('reports a dangling symlink as a file, since a write through it creates the file it names', async () => {
    const dir = tmpDir();
    fs.symlinkSync(joinWithinRoot(dir, 'never-created.ts'), joinWithinRoot(dir, 'dangling.ts'));
    const readTargetPathState = createFsReadTargetPathStateFn();

    expect(await readTargetPathState(joinWithinRoot(dir, 'dangling.ts'))).toBe('file');
  });

  // An unreadable path says nothing about what stands there; swallowing the
  // error would read it as free ground and wave the assembly through.
  //
  // Driven through a mocked `stat` rejection rather than a real chmod: mode bits
  // do not deny a root process and Windows ignores them, so the on-disk version
  // passed without ever reaching the rethrow on exactly the hosts where it
  // mattered least to run.
  it.each(['EACCES', 'EPERM'])('rethrows a %s failure rather than reporting an unreadable path as free', async (code) => {
    statMock.mockRejectedValueOnce(Object.assign(new Error(`${code}: permission denied`), { code }));
    const readTargetPathState = createFsReadTargetPathStateFn();

    await expect(readTargetPathState('/whatever')).rejects.toThrow(code);
  });

  it('reports ENOENT as absent and ENOTDIR as a file standing on the way, rather than rethrowing either', async () => {
    statMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    statMock.mockRejectedValueOnce(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }));
    const readTargetPathState = createFsReadTargetPathStateFn();

    expect(await readTargetPathState('/absent')).toBe('absent');
    expect(await readTargetPathState('/a-file/beneath-it.ts')).toBe('file');
  });
});
