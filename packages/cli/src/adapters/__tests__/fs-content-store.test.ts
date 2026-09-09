// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-install-by-spec:p1
// @cpt-dod:cpt-frontx-dod-template-resolution-bounded-local-update:p1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { FsContentStore } from '../fs-content-store';
import { resolveInstalledContentPath } from '../fs-installed-content-path';
import { MANIFEST_FILENAME } from '../../manifest/types';
import { UnreachablePathError } from '../fs-project-io';

describe('FsContentStore', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-content-store-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // inst-resolve-write — materializes a manifest-only string as a real
  // on-disk manifest file, round-tripping via inst-resolve-return's read.
  it('writes single-string content as the manifest file and round-trips on read', () => {
    const store = new FsContentStore(root);
    store.write('my-template', '{"name":"my-template"}');

    const manifestPath = joinWithinRoot(resolveInstalledContentPath(root, 'my-template'), MANIFEST_FILENAME);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe('{"name":"my-template"}');
    expect(store.read('my-template')).toBe('{"name":"my-template"}');
  });

  // inst-resolve-write — a JSON file-map bundle materializes as the
  // template's ACTUAL multiple on-disk files (not a single manifest blob).
  it('writes a JSON file-map bundle as multiple real files and round-trips on read', () => {
    const store = new FsContentStore(root);
    const bundle = {
      [MANIFEST_FILENAME]: '{"name":"my-template"}',
      'src/index.ts': 'export const x = 1;',
    };
    store.write('my-template', JSON.stringify({ $frontxTemplateFiles: bundle }));

    const installedPath = resolveInstalledContentPath(root, 'my-template');
    expect(fs.readFileSync(joinWithinRoot(installedPath, MANIFEST_FILENAME), 'utf-8')).toBe(bundle[MANIFEST_FILENAME]);
    expect(fs.readFileSync(joinWithinRoot(installedPath, 'src', 'index.ts'), 'utf-8')).toBe(bundle['src/index.ts']);

    const roundTripped = JSON.parse(store.read('my-template')!);
    expect(roundTripped).toEqual({ $frontxTemplateFiles: bundle });
  });

  it('has() reflects real on-disk presence', () => {
    const store = new FsContentStore(root);
    expect(store.has('my-template')).toBe(false);
    store.write('my-template', 'content');
    expect(store.has('my-template')).toBe(true);
  });

  // inst-bupd-replace — replace fully materializes the new content and
  // removes files from the previous version that are absent from the new one.
  it('replace() removes stale files not present in the new bundle', () => {
    const store = new FsContentStore(root);
    store.write(
      'my-template',
      JSON.stringify({ $frontxTemplateFiles: { [MANIFEST_FILENAME]: 'v1', 'old-file.txt': 'stale' } }),
    );
    store.replace('my-template', JSON.stringify({ $frontxTemplateFiles: { [MANIFEST_FILENAME]: 'v2' } }));

    const installedPath = resolveInstalledContentPath(root, 'my-template');
    expect(fs.existsSync(joinWithinRoot(installedPath, 'old-file.txt'))).toBe(false);
    expect(fs.readFileSync(joinWithinRoot(installedPath, MANIFEST_FILENAME), 'utf-8')).toBe('v2');
  });

  // inst-bupd-boundary-confirm — no path outside the store root is ever
  // written, even against a real filesystem path.
  it('never writes outside the store root', () => {
    const store = new FsContentStore(root);
    store.write('my-template', 'content');
    const entriesOutsideRoot = fs
      .readdirSync(path.dirname(root))
      .filter((entry) => entry !== path.basename(root));
    // Only pre-existing sibling temp-dir entries may exist; none were created
    // by this write (the assertion is that no NEW sibling appeared).
    expect(entriesOutsideRoot.every((entry) => !entry.includes('my-template'))).toBe(true);
  });

  // DEFECT: `assertWithinRoot` (`../fs-installed-content-path.ts`) used to
  // prove containment with pure `path.relative` string arithmetic — no
  // filesystem call at all — so a symlink INSIDE the store pointing OUTSIDE
  // it escaped the check entirely: the lexical path was inside the store, so
  // the check passed, and the template's payload landed at whatever the
  // symlink actually resolved to. A REAL symlink (not a fake seam) is what
  // proves the fix resolves the link via the filesystem rather than by
  // string comparison alone.
  describe('a symlink at the installed content path escaping the store root', () => {
    let outside: string;

    beforeEach(() => {
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-content-store-outside-'));
    });

    afterEach(() => {
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('write() refuses instead of writing through the symlink, and the outside directory survives untouched', () => {
      fs.writeFileSync(joinWithinRoot(outside, 'keep.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
      fs.mkdirSync(resolveInstalledContentPath(root, '@x'), { recursive: true });
      fs.symlinkSync(outside, resolveInstalledContentPath(root, '@x/inv'), 'dir');

      const store = new FsContentStore(root);
      expect(() => store.write('@x/inv', 'content')).toThrow();

      expect(fs.readFileSync(joinWithinRoot(outside, 'keep.txt'), 'utf-8')).toBe(
        'DEVELOPER-OWNED — must survive',
      );
      expect(fs.readdirSync(outside)).toEqual(['keep.txt']);
    });

    // The write side proved containment a round before the read side did,
    // and `apply` reads its payload from this store: a symlink here let a
    // payload from outside the inventory land in the developer's project
    // under `ok:true`.
    it('read() refuses instead of returning content from outside the store', () => {
      fs.writeFileSync(joinWithinRoot(outside, MANIFEST_FILENAME), '{"name":"@x/inv"}', 'utf-8');
      fs.writeFileSync(joinWithinRoot(outside, 'foreign.txt'), 'FOREIGN PAYLOAD', 'utf-8');
      fs.mkdirSync(resolveInstalledContentPath(root, '@x'), { recursive: true });
      fs.symlinkSync(outside, resolveInstalledContentPath(root, '@x/inv'), 'dir');

      const store = new FsContentStore(root);
      expect(() => store.read('@x/inv')).toThrow();
    });

    it('has() refuses instead of reporting outside content as installed', () => {
      fs.writeFileSync(joinWithinRoot(outside, 'foreign.txt'), 'FOREIGN PAYLOAD', 'utf-8');
      fs.mkdirSync(resolveInstalledContentPath(root, '@x'), { recursive: true });
      fs.symlinkSync(outside, resolveInstalledContentPath(root, '@x/inv'), 'dir');

      const store = new FsContentStore(root);
      expect(() => store.has('@x/inv')).toThrow();
    });

    it('read() still works through a symlink that resolves back INSIDE the store', () => {
      const realDir = resolveInstalledContentPath(root, '@x/real');
      fs.mkdirSync(realDir, { recursive: true });
      fs.writeFileSync(path.join(realDir, MANIFEST_FILENAME), 'manifest text', 'utf-8');
      fs.symlinkSync(realDir, resolveInstalledContentPath(root, '@x/aliased'), 'dir');

      const store = new FsContentStore(root);
      expect(store.read('@x/aliased')).toBe('manifest text');
      expect(store.has('@x/aliased')).toBe(true);
    });

    it('replace() refuses instead of writing through the symlink or removing what it points at, and the outside directory survives untouched', () => {
      fs.writeFileSync(joinWithinRoot(outside, 'keep.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
      fs.mkdirSync(resolveInstalledContentPath(root, '@x'), { recursive: true });
      fs.symlinkSync(outside, resolveInstalledContentPath(root, '@x/inv'), 'dir');

      const store = new FsContentStore(root);
      expect(() => store.replace('@x/inv', 'content')).toThrow();

      expect(fs.existsSync(outside)).toBe(true);
      expect(fs.readFileSync(joinWithinRoot(outside, 'keep.txt'), 'utf-8')).toBe(
        'DEVELOPER-OWNED — must survive',
      );
      expect(fs.readdirSync(outside)).toEqual(['keep.txt']);
    });
  });

  // inst-resolve-write-guard / inst-bupd-replace-guard — DEFECT 3c: a
  // non-directory entry standing where an installed content path's own
  // ancestor directory belongs (a scoped identity's own leading segment,
  // e.g. `@x` in `@x/inv`, replaced by a plain file) used to reach
  // `fs.mkdirSync(installedPath, { recursive: true })` unguarded, failing
  // with a bare `ENOTDIR` no caller here catches — an unstructured
  // internal-error exit with no `--json` envelope.
  describe('a non-directory entry blocking an ancestor of the installed content path', () => {
    it('write() refuses with UnreachablePathError naming the blocking file instead of a raw ENOTDIR', () => {
      const scopeSegment = resolveInstalledContentPath(root, '@x');
      fs.mkdirSync(path.dirname(scopeSegment), { recursive: true });
      fs.writeFileSync(scopeSegment, 'not-a-directory', 'utf-8');

      const store = new FsContentStore(root);
      let thrown: unknown;
      try {
        store.write('@x/inv', 'content');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(UnreachablePathError);
      expect((thrown as UnreachablePathError).blockingAncestor).toBe(scopeSegment);
    });

    it('replace() refuses with UnreachablePathError naming the blocking file instead of a raw ENOTDIR', () => {
      const scopeSegment = resolveInstalledContentPath(root, '@x');
      fs.mkdirSync(path.dirname(scopeSegment), { recursive: true });
      fs.writeFileSync(scopeSegment, 'not-a-directory', 'utf-8');

      const store = new FsContentStore(root);
      expect(() => store.replace('@x/inv', 'content')).toThrow(UnreachablePathError);
    });
  });

  // DEFECT 1 (regression): the store root itself reached through a
  // symlinked ancestor — the exact `/tmp` shape (`/tmp` is a symlink to
  // `/private/tmp` on macOS) a live repro hit as `FRONTX_INVENTORY_ROOT=/tmp/
  // frontx-store` — used to refuse with `UnreachablePathError` naming the
  // symlinked ancestor itself, because `firstNonDirectoryComponentOf`
  // decided with `lstatSync(...).isDirectory()`, which is never true for a
  // symlink no matter what it resolves to. Built with a REAL symlink in a
  // temp tree so this does not depend on `/tmp` itself being one on the host
  // running this suite.
  describe('an inventory root reached through a symlinked ancestor', () => {
    let outerBase: string;

    afterEach(() => {
      if (outerBase) fs.rmSync(outerBase, { recursive: true, force: true });
    });

    it('write() succeeds, materializing content on the REAL side of the link', () => {
      outerBase = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-content-store-symlinked-root-'));
      const realStoreParent = path.join(outerBase, 'real');
      fs.mkdirSync(realStoreParent, { recursive: true });
      const linkedAncestor = path.join(outerBase, 'linked');
      fs.symlinkSync(realStoreParent, linkedAncestor, 'dir');
      // Neither the store root nor anything beneath it exists yet — the
      // ordinary shape of a fresh local inventory store's first write.
      const storeRoot = path.join(linkedAncestor, 'frontx-store');

      const store = new FsContentStore(storeRoot);
      store.write('@x/inv', 'content');

      const installedPath = resolveInstalledContentPath(storeRoot, '@x/inv');
      expect(fs.readFileSync(joinWithinRoot(installedPath, MANIFEST_FILENAME), 'utf-8')).toBe('content');
      // Materialized on the REAL side of the link, not merely reachable
      // through it.
      const realInstalledPath = resolveInstalledContentPath(path.join(realStoreParent, 'frontx-store'), '@x/inv');
      expect(fs.readFileSync(joinWithinRoot(realInstalledPath, MANIFEST_FILENAME), 'utf-8')).toBe('content');
    });
  });
});
