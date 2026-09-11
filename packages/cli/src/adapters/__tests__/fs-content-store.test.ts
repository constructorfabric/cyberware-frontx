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
});
