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
import { FsInventoryIndex } from '../fs-inventory-index';
import { InventoryState } from '../../inventory/types';
import { NotRegularFileError } from '../fs-project-io';

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
});
