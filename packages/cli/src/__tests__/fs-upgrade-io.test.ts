// @cpt-algo:cpt-frontx-algo-upgrade-changeset-classify:p1
//
// Real-filesystem coverage for `createFsReadDiskEntryFn`/`createFsListDiskFilesFn`
// (`../adapters/fs-upgrade-io.ts`) against a genuine special file (a FIFO) —
// the one disk shape no fake `ReadDiskEntryFn`/`ListDiskFilesFn` can honestly
// stand in for, since the defect this suite pins was in the REAL adapter's
// own `stat`-based classification, not in anything a test double could get
// wrong on its own. `mkfifo` (a POSIX utility on every platform this suite
// runs on) creates the node without ever opening it — this suite never opens
// it either, matching the seam's own contract that a special file's content
// is never read.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFsReadDiskEntryFn,
  createFsListDiskFilesFn,
  createFsWriteDiskFileFn,
  ReservedTempPathOccupiedError,
} from '../adapters/fs-upgrade-io';
import { RESERVED_TEMP_SUFFIX } from '../paths/reserved-temp-name';
import { makeFifo, fifosAvailable } from './support/fifo';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});


describe('createFsReadDiskEntryFn — a real special file (FIFO)', () => {
  it.skipIf(!fifosAvailable())('reports a FIFO as {kind: "special"}, never as "directory", without ever opening it', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-special-'));
    const fifoPath = path.join(root, 'pipe');
    makeFifo(fifoPath);

    const readDiskEntry = createFsReadDiskEntryFn();
    // If this call ever opened the FIFO for reading, it would hang forever
    // (no writer exists) and this test would time out rather than fail
    // cleanly — the strongest proof this seam has that it never does.
    const entry = await readDiskEntry(fifoPath);

    expect(entry).toEqual({ kind: 'special' });
  });

  it.skipIf(!fifosAvailable())('reports a FIFO standing in for an ancestor directory as "special", never as "directory"', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-special-'));
    const fifoPath = path.join(root, 'pipe');
    makeFifo(fifoPath);

    const readDiskEntry = createFsReadDiskEntryFn();
    const entry = await readDiskEntry(fifoPath);

    // The defect this pins: an earlier version of this function returned
    // `{ kind: 'directory' }` here, which `classify.ts`'s ancestor probe
    // treats as ordinary, permitted structure — never flagging a FIFO
    // standing where a directory is required.
    expect(entry.kind).not.toBe('directory');
    expect(entry).toEqual({ kind: 'special' });
  });

  it('reports a real directory as "directory" and a real regular file as "file", unaffected by the special-file change', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-special-'));
    await mkdir(path.join(root, 'dir'));
    await writeFile(path.join(root, 'file.txt'), 'content', 'utf-8');

    const readDiskEntry = createFsReadDiskEntryFn();
    expect(await readDiskEntry(path.join(root, 'dir'))).toEqual({ kind: 'directory' });
    expect(await readDiskEntry(path.join(root, 'file.txt'))).toEqual({ kind: 'file', content: 'content' });
    expect(await readDiskEntry(path.join(root, 'does-not-exist.txt'))).toEqual({ kind: 'absent' });
  });
});

describe('createFsWriteDiskFileFn — exclusive-create backstop on a reserved temp path', () => {
  it('creates a reserved temp path that does not yet exist, writing exactly the given content', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-write-'));
    const temp = path.join(root, `new.txt${RESERVED_TEMP_SUFFIX}`);

    const writeDiskFile = createFsWriteDiskFileFn(root);
    await writeDiskFile(temp, 'v2');

    expect(await readFile(temp, 'utf-8')).toBe('v2');
  });

  it('refuses with ReservedTempPathOccupiedError, never following it or writing through it, when a symlink already occupies the reserved temp path', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-write-'));
    const temp = path.join(root, `new.txt${RESERVED_TEMP_SUFFIX}`);
    const victim = path.join(root, 'victim.txt');
    await writeFile(victim, 'PRECIOUS', 'utf-8');
    await symlink(victim, temp);

    const writeDiskFile = createFsWriteDiskFileFn(root);

    await expect(writeDiskFile(temp, 'v2')).rejects.toBeInstanceOf(ReservedTempPathOccupiedError);
    // Never followed the symlink to write through it...
    expect(await readFile(victim, 'utf-8')).toBe('PRECIOUS');
    // ...and never replaced the symlink itself with a regular file either.
    expect((await lstat(temp)).isSymbolicLink()).toBe(true);
  });

  it('still overwrites an ordinary (non-reserved) destination unconditionally, as a REPLACE requires', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-write-'));
    const dest = path.join(root, 'existing.txt');
    await writeFile(dest, 'BASELINE', 'utf-8');

    const writeDiskFile = createFsWriteDiskFileFn(root);
    await writeDiskFile(dest, 'REPLACED');

    expect(await readFile(dest, 'utf-8')).toBe('REPLACED');
  });
});

describe('createFsListDiskFilesFn — a FIFO inside the walked directory', () => {
  it.skipIf(!fifosAvailable())('silently omits a FIFO from the enumerated regular files, without recursing into it or throwing', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-upgrade-special-list-'));
    await writeFile(path.join(root, 'a.txt'), 'A', 'utf-8');
    makeFifo(path.join(root, 'pipe'));
    await mkdir(path.join(root, 'sub'));
    await writeFile(path.join(root, 'sub', 'b.txt'), 'B', 'utf-8');

    const listDiskFiles = createFsListDiskFilesFn();
    const files = await listDiskFiles(root);

    expect(files.sort()).toEqual(['a.txt', 'sub/b.txt']);
    expect(files).not.toContain('pipe');
  });
});
