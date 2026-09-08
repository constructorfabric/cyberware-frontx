// @cpt-algo:cpt-frontx-algo-composed-provenance-project-state-io:p1
//
// Real-filesystem coverage for a live repro: `.frontx/project.json` replaced
// by a symlink to `elsewhere/real.json` INSIDE the project. Every command
// that mutates project state answered `{"ok":true,...}` exit 0, and
// afterwards `.frontx/project.json` was a plain regular file while
// `elsewhere/real.json` still held the STALE document — the developer's own
// real document silently orphaned, with nothing in the report saying so.
//
// The cause: `createFsWriteProjectStateFn` (`../adapters/fs-project-io.ts`)
// renamed its temp file straight onto `absolutePath` — the symlink's own
// path — and `fs.renameSync` does not follow a symlink standing at its
// destination; it REPLACES the link itself with the new file, leaving
// whatever the link named untouched. The fix resolves the write's actual
// destination first (`inst-psio-resolve-write-destination`) and renames onto
// THAT, so the link survives and the real document is the one updated.
//
// The companion case this suite pins, UNCHANGED: a symlink resolving OUTSIDE
// the repository root still refuses via `PathContainmentError`
// (`assertPathWithinProjectRoot`, called before any resolution happens),
// and the outside file is left untouched.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink, lstat, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFsWriteProjectStateFn,
  createFsReadProjectStateFn,
  PathContainmentError,
} from '../adapters/fs-project-io';
import type { ProjectStateDocument } from '../project-state/types';

let root: string | undefined;
let outside: string | undefined;

afterEach(async () => {
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
  if (outside !== undefined) {
    await rm(outside, { recursive: true, force: true });
    outside = undefined;
  }
});

function staleDocument(): ProjectStateDocument {
  return { formatVersion: 1, templates: {}, projectOwnedRoots: [] };
}

function newDocument(): ProjectStateDocument {
  return {
    formatVersion: 1,
    templates: { '@x/a': { origin: 'path:vendor-a', version: '1.0.0', targets: ['app'] } },
    projectOwnedRoots: [],
  };
}

describe('createFsWriteProjectStateFn — write onto a symlinked project.json (real filesystem)', () => {
  it('updates the real document behind the link and leaves the link itself intact', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-psio-symlink-inside-'));
    await mkdir(path.join(root, '.frontx'), { recursive: true });
    await mkdir(path.join(root, 'elsewhere'), { recursive: true });
    const realPath = path.join(root, 'elsewhere', 'real.json');
    await writeFile(realPath, JSON.stringify(staleDocument()), 'utf-8');
    const linkPath = path.join(root, '.frontx', 'project.json');
    await symlink(realPath, linkPath);

    const writeProjectStateFn = createFsWriteProjectStateFn();
    await writeProjectStateFn(linkPath, JSON.stringify(newDocument()));

    // The link itself survives, pointing at the SAME real file.
    const linkStat = await lstat(linkPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
    expect(await readlink(linkPath)).toBe(realPath);

    // The real document holds the NEW content — never orphaned with the
    // stale one.
    const realContent = JSON.parse(await readFile(realPath, 'utf-8'));
    expect(realContent).toEqual(newDocument());

    // A second command's read, through the ordinary `ReadProjectStateFn`,
    // sees the new content — the link is followed on read exactly as it
    // always was.
    const readProjectStateFn = createFsReadProjectStateFn();
    const readBack = await readProjectStateFn(linkPath);
    expect(readBack).not.toBeNull();
    expect(JSON.parse(readBack as string)).toEqual(newDocument());
  });

  it('still refuses when the symlink resolves outside the repository root, leaving the outside file untouched', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-psio-symlink-outside-'));
    outside = await mkdtemp(path.join(tmpdir(), 'frontx-psio-symlink-outside-target-'));
    await mkdir(path.join(root, '.frontx'), { recursive: true });
    const outsideRealPath = path.join(outside, 'real.json');
    await writeFile(outsideRealPath, JSON.stringify(staleDocument()), 'utf-8');
    const linkPath = path.join(root, '.frontx', 'project.json');
    await symlink(outsideRealPath, linkPath);

    const writeProjectStateFn = createFsWriteProjectStateFn();
    await expect(writeProjectStateFn(linkPath, JSON.stringify(newDocument()))).rejects.toBeInstanceOf(
      PathContainmentError,
    );

    // Nothing was written outside the project — the stale document survives
    // byte-for-byte.
    const outsideContent = JSON.parse(await readFile(outsideRealPath, 'utf-8'));
    expect(outsideContent).toEqual(staleDocument());
  });
});
