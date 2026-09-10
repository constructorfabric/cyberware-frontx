import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFsRemoveProjectFileFn } from '../adapters/fs-project-io';

// The one behaviour in this adapter that a decision rests on, exercised
// against a REAL filesystem because that is the only place it is observable:
// every other seam in this package models a project as a path->content map,
// in which a directory has no representation at all and "the directory is
// left standing" cannot be asserted either way.
//
// `cpt-frontx-algo-cli-scaffolding-delete-plan`'s `inst-dp-set-delete` fixes
// that a deletion plan names files, never the directories holding them, and
// that a directory the removal empties is left standing rather than pruned —
// a confirmed deletion removes exactly what the list it was confirmed
// against named, which is the property delete's whole confirmation gate
// rests on. The removal seam this adapter satisfies is per-file, so the
// deletion flow cannot express a directory removal; this test pins the
// adapter itself, the one layer that COULD have reached for a recursive
// remove and does not.
describe('createFsRemoveProjectFileFn', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fs-project-io-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('leaves the directory it empties standing, at every level of the emptied chain', async () => {
    const removeProjectFile = createFsRemoveProjectFileFn();
    const nested = path.join(root, 'app', 'src');
    fs.mkdirSync(nested, { recursive: true });
    const file = path.join(nested, 'index.ts');
    fs.writeFileSync(file, 'export {};', 'utf-8');

    await removeProjectFile(file);

    expect(fs.existsSync(file)).toBe(false);
    // Both levels survive — not just the immediate parent. A recursive or
    // parent-pruning remove would take `app/src` with the file and could
    // walk up from there.
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(path.join(root, 'app'))).toBe(true);
    expect(fs.readdirSync(nested)).toEqual([]);
  });

  it('removes only the named file, leaving its siblings untouched', async () => {
    const removeProjectFile = createFsRemoveProjectFileFn();
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    const named = path.join(root, 'app', 'gone.ts');
    const sibling = path.join(root, 'app', 'kept.ts');
    fs.writeFileSync(named, 'gone', 'utf-8');
    fs.writeFileSync(sibling, 'kept', 'utf-8');

    await removeProjectFile(named);

    expect(fs.existsSync(named)).toBe(false);
    expect(fs.readFileSync(sibling, 'utf-8')).toBe('kept');
  });

  it('is a no-op for an absent path rather than a throw', async () => {
    const removeProjectFile = createFsRemoveProjectFileFn();

    await expect(removeProjectFile(path.join(root, 'never-existed.ts'))).resolves.toBeUndefined();
  });

  // A directory handed to this seam is NOT removed: the seam's contract is a
  // file, and `fs.rmSync` without `recursive` refuses a directory. Asserted
  // so a future change to `{ force: true }`'s options — adding `recursive`
  // for convenience — cannot silently turn one named file into a subtree.
  it('refuses to remove a directory handed to it in place of a file', async () => {
    const removeProjectFile = createFsRemoveProjectFileFn();
    const dir = path.join(root, 'app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'inside.ts'), 'inside', 'utf-8');

    await expect(removeProjectFile(dir)).rejects.toThrow();

    expect(fs.existsSync(path.join(dir, 'inside.ts'))).toBe(true);
  });
});
