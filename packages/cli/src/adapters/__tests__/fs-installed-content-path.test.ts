// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { assertWithinRoot, resolveInstalledContentPath } from '../fs-installed-content-path';
import { PathContainmentError } from '../fs-project-io';

describe('resolveInstalledContentPath', () => {
  // inst-resolve-write, inst-resolve-return — installed content path
  // addresses the template's actual on-disk files under the store root.
  it('joins the store root and the template name', () => {
    const result = resolveInstalledContentPath('/store', 'my-template');
    expect(result).toBe(path.join('/store', 'my-template'));
  });
});

describe('assertWithinRoot', () => {
  // inst-bupd-boundary-confirm — bounded-update writes exclusively within
  // the inventory store root.
  it('does not throw for a path within the root', () => {
    expect(() => assertWithinRoot('/store', '/store/my-template/file.txt')).not.toThrow();
  });

  it('throws PathContainmentError for a path escaping the root via a parent segment', () => {
    expect(() => assertWithinRoot('/store', '/store/../outside/file.txt')).toThrow(PathContainmentError);
  });

  it('throws PathContainmentError for an unrelated absolute path', () => {
    expect(() => assertWithinRoot('/store', '/etc/passwd')).toThrow(PathContainmentError);
  });

  // DEFECT: the old implementation proved containment with pure
  // `path.relative` string arithmetic, never touching the filesystem — a
  // symlink INSIDE the store whose target resolves OUTSIDE it was lexically
  // "within the root" and so passed unnoticed. Only a REAL symlink, resolved
  // by a real `lstat`/`readlink` walk, can prove the fix actually closes
  // this: a fake path string can't fail the way a real escaping link does.
  describe('against a real filesystem symlink escaping the root', () => {
    let root: string;
    let outside: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-assert-within-root-'));
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-assert-within-root-outside-'));
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('throws PathContainmentError for a symlink at the candidate path whose real target resolves outside the root', () => {
      const candidate = path.join(root, 'my-template');
      fs.symlinkSync(outside, candidate, 'dir');

      expect(() => assertWithinRoot(root, candidate)).toThrow(PathContainmentError);
    });

    it('does not throw for a symlink at the candidate path whose real target resolves inside the root', () => {
      const insideTarget = path.join(root, 'actual-content');
      fs.mkdirSync(insideTarget);
      const candidate = path.join(root, 'my-template');
      fs.symlinkSync(insideTarget, candidate, 'dir');

      expect(() => assertWithinRoot(root, candidate)).not.toThrow();
    });
  });
});
