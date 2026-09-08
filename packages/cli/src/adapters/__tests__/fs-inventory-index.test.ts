// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-state:cpt-frontx-state-template-resolution-inventory-lifecycle:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-list-inventory:p1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { FsInventoryIndex, InvalidInventoryIndexError } from '../fs-inventory-index';
import { InventoryState } from '../../inventory/types';
import { NotRegularFileError, PathContainmentError } from '../fs-project-io';

describe('FsInventoryIndex', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-inventory-index-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // inst-resolve-index, inst-state-to-installed — persists metadata to disk
  // and survives a fresh instance reading the same root (real persistence,
  // not an in-memory Map).
  it('persists a recorded entry to disk and is readable by a new instance', () => {
    const index = new FsInventoryIndex(root);
    index.record({
      name: 'my-template',
      source: 'github:acme/my-template@v1.0.0',
      ref: 'v1.0.0',
      status: InventoryState.INSTALLED,
      content: '{"name":"my-template"}',
    });

    expect(fs.existsSync(joinWithinRoot(root, 'index.json'))).toBe(true);

    const reopened = new FsInventoryIndex(root);
    const entry = reopened.lookup('my-template');
    expect(entry?.ref).toBe('v1.0.0');
    expect(reopened.getState('my-template')).toBe(InventoryState.INSTALLED);
  });

  // inst-list-read / inst-dod-list-inventory — enumerates all persisted entries.
  it('all() returns every persisted entry', () => {
    const index = new FsInventoryIndex(root);
    index.record({
      name: 'template-a',
      source: 'a',
      ref: 'v1.0.0',
      status: InventoryState.INSTALLED,
      content: 'a',
    });
    index.record({
      name: 'template-b',
      source: 'b',
      ref: 'v2.0.0',
      status: InventoryState.INSTALLED,
      content: 'b',
    });
    const names = index.all().map((e) => e.name);
    expect(names).toContain('template-a');
    expect(names).toContain('template-b');
  });

  it('getState() returns UNRESOLVED for an absent entry', () => {
    const index = new FsInventoryIndex(root);
    expect(index.getState('nonexistent')).toBe(InventoryState.UNRESOLVED);
  });

  // inst-bupd-index-update, inst-state-to-updated — update persists the new
  // pinned ref/status to disk for the named entry.
  it('update() persists a patch to the named entry', () => {
    const index = new FsInventoryIndex(root);
    index.record({
      name: 'my-template',
      source: 'v1',
      ref: 'v1.0.0',
      status: InventoryState.INSTALLED,
      content: 'v1',
    });
    index.update('my-template', { ref: 'v2.0.0', status: InventoryState.UPDATED });

    const reopened = new FsInventoryIndex(root);
    expect(reopened.lookup('my-template')?.ref).toBe('v2.0.0');
    expect(reopened.getState('my-template')).toBe(InventoryState.UPDATED);
  });

  it('update() is a no-op for an absent entry', () => {
    const index = new FsInventoryIndex(root);
    index.update('nonexistent', { ref: 'v2.0.0' });
    expect(index.lookup('nonexistent')).toBeUndefined();
  });

  it('toJSON() serializes the persisted entries', () => {
    const index = new FsInventoryIndex(root);
    index.record({
      name: 'my-template',
      source: 'v1',
      ref: 'v1.0.0',
      status: InventoryState.INSTALLED,
      content: 'v1',
    });
    expect(JSON.parse(index.toJSON())).toHaveProperty('my-template');
  });

  // A FIFO standing at `index.json` used to hang every read of this store
  // forever: the old `readAll()` paired a symlink-following `existsSync`
  // (answers `true` for a FIFO exactly as readily as for a real index file)
  // with an unconditional `readFileSync`, which blocks on `open()` for a FIFO
  // with no writer attached — no stdout, no stderr, no exit, until the
  // process is killed. `readAll()` now goes through the same guarded
  // primitive every other read seam in this package uses
  // (`readFileIfRegular`, `../fs-project-io.ts`), so this resolves
  // immediately with a typed refusal instead of blocking. Real `mkfifo`, per
  // this package's own established convention for pinning this exact class
  // of defect (`fs-upgrade-io.test.ts`) — no fake `ReadFileFn` can stand in
  // for a real kernel-level blocking `open()`.
  it('lookup() refuses with NotRegularFileError instead of hanging when index.json is a FIFO', () => {
    const indexPath = joinWithinRoot(root, 'index.json');
    execFileSync('mkfifo', [indexPath]);
    const index = new FsInventoryIndex(root);

    expect(() => index.lookup('anything')).toThrow(NotRegularFileError);
    try {
      index.lookup('anything');
    } catch (error) {
      expect(error).toBeInstanceOf(NotRegularFileError);
      expect((error as NotRegularFileError).kind).toBe('fifo');
    }
  });

  // inst-bupd-lookup-guard — a hand-edited or corrupted `index.json` that is
  // not valid JSON must not reach a caller as a raw `JSON.parse` `SyntaxError`
  // (which used to escape all the way to the CLI's top-level catch as an
  // unstructured internal error, exit 2, no `--json` envelope).
  it('lookup() refuses with InvalidInventoryIndexError instead of a raw SyntaxError when index.json is not valid JSON', () => {
    const indexPath = joinWithinRoot(root, 'index.json');
    fs.writeFileSync(indexPath, 'DEVFILE-PRECIOUS\n', 'utf-8');
    const index = new FsInventoryIndex(root);

    expect(() => index.lookup('anything')).toThrow(InvalidInventoryIndexError);
  });

  // inst-bupd-lookup-guard — valid JSON of the wrong SHAPE (not a
  // `Record<string, InventoryEntry>`) used to reach `install`'s own nesting
  // check as `entry.name` silently `undefined`, crashing with a raw
  // `TypeError` rather than a structured refusal.
  it('lookup() refuses with InvalidInventoryIndexError instead of a downstream crash when index.json is valid JSON of the wrong shape', () => {
    const indexPath = joinWithinRoot(root, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify({ precious: 'not-an-entry-map' }), 'utf-8');
    const index = new FsInventoryIndex(root);

    expect(() => index.lookup('anything')).toThrow(InvalidInventoryIndexError);
  });

  // inst-resolve-index-guard / inst-bupd-index-guard — DEFECT: the writer
  // used to reach a bare `fs.writeFileSync(this.indexPath, ...)` unconditionally,
  // which FOLLOWS a symlink at its final component exactly like an ordinary
  // path — a symlink at `index.json` pointing OUTSIDE the store made
  // `record()` silently overwrite a developer's unrelated file with the
  // freshly-serialized inventory index, under a reported success. The real
  // symlink (not a fake seam) is what proves the fix actually resolves it
  // via the filesystem rather than by lexical string comparison.
  it('record() refuses with PathContainmentError instead of writing through a symlink escaping the store root, and the outside file survives byte-for-byte', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-inventory-index-outside-'));
    try {
      const outsideFile = joinWithinRoot(outside, 'devfile.json');
      fs.writeFileSync(outsideFile, '{}', 'utf-8');
      fs.symlinkSync(outsideFile, joinWithinRoot(root, 'index.json'));

      const index = new FsInventoryIndex(root);
      expect(() =>
        index.record({
          name: 'my-template',
          source: 'v1',
          ref: 'v1.0.0',
          status: InventoryState.INSTALLED,
          content: 'v1',
        }),
      ).toThrow(PathContainmentError);

      expect(fs.readFileSync(outsideFile, 'utf-8')).toBe('{}');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // inst-resolve-index-guard / inst-bupd-index-guard — the local inventory
  // store IS ground this CLI owns, but a directory standing where `index.json`
  // belongs is still refused rather than silently deleted: a read seam
  // already refuses to open this exact shape (`NotRegularFileError` above),
  // and the write side refuses it for the identical reason.
  it('record() refuses with NotRegularFileError instead of writing over a directory standing at index.json', () => {
    const indexPath = joinWithinRoot(root, 'index.json');
    fs.mkdirSync(indexPath);

    const index = new FsInventoryIndex(root);
    expect(() =>
      index.record({
        name: 'my-template',
        source: 'v1',
        ref: 'v1.0.0',
        status: InventoryState.INSTALLED,
        content: 'v1',
      }),
    ).toThrow(NotRegularFileError);
    expect(fs.statSync(indexPath).isDirectory()).toBe(true);
  });

  // inst-resolve-index-guard / inst-bupd-index-guard — a FIFO at `index.json`
  // must not hang the WRITE side either: `fs.writeFileSync` opening for write
  // on a FIFO with no reader attached blocks exactly as a read would.
  it('record() refuses with NotRegularFileError instead of hanging when index.json is a FIFO', () => {
    const indexPath = joinWithinRoot(root, 'index.json');
    execFileSync('mkfifo', [indexPath]);
    const index = new FsInventoryIndex(root);

    expect(() =>
      index.record({
        name: 'my-template',
        source: 'v1',
        ref: 'v1.0.0',
        status: InventoryState.INSTALLED,
        content: 'v1',
      }),
    ).toThrow(NotRegularFileError);
  });

  // DEFECT 3: the WRITE side already proves `index.json`, symlinks resolved,
  // stays inside the store root (`record() refuses ... escaping the store
  // root` above) — but the READ side used to trust `readFileIfRegular` alone,
  // which follows the identical symlink to decide WHAT KIND of thing is
  // there without ever asking WHERE it leads. A symlink at `index.json`
  // pointing OUTSIDE the store therefore used to read straight through to a
  // developer's own file and report its content as tracked local inventory
  // under `ok: true`. The real symlink (not a fake seam) is what proves the
  // fix actually resolves it via the filesystem.
  it('lookup()/all() refuse with PathContainmentError instead of reading through a symlink escaping the store root, and nothing it names is reported as installed', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-inventory-index-read-outside-'));
    try {
      const outsideIndex = joinWithinRoot(outside, 'devindex.json');
      fs.writeFileSync(
        outsideIndex,
        JSON.stringify({
          '@leaked/name': { name: '@leaked/name', source: 'x', ref: 'x', status: InventoryState.INSTALLED, content: 'x' },
        }),
        'utf-8',
      );
      fs.symlinkSync(outsideIndex, joinWithinRoot(root, 'index.json'));

      const index = new FsInventoryIndex(root);
      expect(() => index.lookup('@leaked/name')).toThrow(PathContainmentError);
      expect(() => index.all()).toThrow(PathContainmentError);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // DEFECT 4: the writer used to `fs.renameSync(tempPath, this.indexPath)`
  // unconditionally, and `fs.rename` does not follow a symlink standing at
  // its destination — it REPLACES the directory entry outright. A symlink at
  // `index.json` pointing to a document elsewhere INSIDE the store root
  // therefore used to be destroyed and replaced by an ordinary file, orphaning
  // the document it aliased with its now-stale content and nothing in the
  // report saying so. The fix publishes onto the RESOLVED destination instead
  // (the same treatment `.frontx/project.json`'s own writer already gets),
  // so the link survives and the real document is what a second instance
  // reads back.
  it('record() writes through an internal symlink onto its resolved destination — the link survives, the real file holds the new index, and a second instance reads it back', () => {
    const realIndexPath = joinWithinRoot(root, 'real-index.json');
    fs.writeFileSync(realIndexPath, '{}', 'utf-8');
    const indexPath = joinWithinRoot(root, 'index.json');
    fs.symlinkSync(realIndexPath, indexPath);

    const index = new FsInventoryIndex(root);
    index.record({
      name: 'my-template',
      source: 'v1',
      ref: 'v1.0.0',
      status: InventoryState.INSTALLED,
      content: 'v1',
    });

    expect(fs.lstatSync(indexPath).isSymbolicLink()).toBe(true); // the link itself survives
    expect(JSON.parse(fs.readFileSync(realIndexPath, 'utf-8'))).toHaveProperty('my-template'); // the real file holds the new index

    const reopened = new FsInventoryIndex(root);
    expect(reopened.lookup('my-template')?.ref).toBe('v1.0.0');
  });
});
