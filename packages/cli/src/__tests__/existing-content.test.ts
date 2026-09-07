// @cpt-algo:cpt-frontx-algo-cli-scaffolding-existing-content:p1
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileExistingContent, SYMLINK_CONTENT_MARKER } from '../scaffold/existing-content';
import { computeExclusionRoots } from '../scaffold/effective-ownership';
import { createFsReadExistingContentFn } from '../adapters/fs-existing-content';
import type { ContentItem } from '../scaffold/types';
import type { ReadExistingContentFn, ReadInstalledContentFn } from '../scaffold/existing-content';

function fakeReadInstalledContent(items: ContentItem[]): ReadInstalledContentFn {
  return async () => items;
}

function fakeReadExistingContent(items: ContentItem[]): ReadExistingContentFn {
  return async () => items;
}

describe('reconcileExistingContent', () => {
  it('reports every partition empty when nothing pre-exists', async () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'packages/app',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'src/index.ts', content: 'export {};' }]),
      readExistingContent: fakeReadExistingContent([]),
    });

    expect(result).toEqual({
      uncomparablePaths: [],
      uncomparableCauses: [],
      identicalFiles: [],
      contentConflicts: [],
      additionalPaths: [],
    });
  });

  it('classifies a payload path whose on-disk content matches exactly as identicalFiles', async () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'packages/app',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'src/index.ts', content: 'export {};' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'packages/app/src/index.ts', content: 'export {};' }]),
    });

    expect(result.identicalFiles).toEqual(['packages/app/src/index.ts']);
    expect(result.contentConflicts).toEqual([]);
    expect(result.additionalPaths).toEqual([]);
  });

  it('classifies a payload path whose on-disk content differs as contentConflicts', async () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'packages/app',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'src/index.ts', content: 'export {};' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'packages/app/src/index.ts', content: 'hand-edited' }]),
    });

    expect(result.contentConflicts).toEqual(['packages/app/src/index.ts']);
    expect(result.identicalFiles).toEqual([]);
    expect(result.additionalPaths).toEqual([]);
  });

  it('classifies an on-disk file outside the payload but inside effective ownership as additionalPaths', async () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'packages/app',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'src/index.ts', content: 'export {};' }]),
      readExistingContent: fakeReadExistingContent([
        { path: 'packages/app/src/index.ts', content: 'export {};' },
        { path: 'packages/app/README.md', content: '# hand-written notes' },
      ]),
    });

    expect(result.additionalPaths).toEqual(['packages/app/README.md']);
    expect(result.identicalFiles).toEqual(['packages/app/src/index.ts']);
    expect(result.contentConflicts).toEqual([]);
  });

  // The algorithm's input is already SCOPED to the target's effective
  // ownership area (`cpt-frontx-dod-cli-scaffolding-existing-content-
  // protocol`'s own text) — a seam that over-reports beyond that scope (an
  // adapter enumerating wider than strictly necessary, or a fake standing
  // in for one) must never leak a result into any partition. Exercised on
  // BOTH sides: an existing-disk item outside the target entirely, and a
  // payload item that would land inside a declared `excludedSubtrees` entry.
  it('never reports a path outside the target\'s effective ownership, on either side', async () => {
    const roots = computeExclusionRoots({
      target: 'packages/app',
      excludedSubtrees: ['vendor/'],
      projectOwnedRoots: [],
    });

    const result = await reconcileExistingContent({
      target: 'packages/app',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([
        { path: 'src/index.ts', content: 'export {};' },
        // Lands inside the template's own declared excludedSubtrees entry —
        // ground reserved for a nested template, never this payload's own.
        { path: 'vendor/lib.js', content: 'vendored' },
      ]),
      readExistingContent: fakeReadExistingContent([
        { path: 'packages/app/src/index.ts', content: 'export {};' },
        // Outside the target entirely — a sibling package, not this target.
        { path: 'packages/other/index.ts', content: 'unrelated' },
      ]),
    });

    expect(result.identicalFiles).toEqual(['packages/app/src/index.ts']);
    expect(result.contentConflicts).toEqual([]);
    expect(result.additionalPaths).toEqual([]);
  });

  // `target` may legitimately be `.`, the project root
  // (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own text uses exactly
  // this example) — `effective-ownership.ts`'s root handling must be honored
  // here too: a payload path re-roots to itself (not `./readme.md`), and
  // `.frontx`/reserved environment entries are still unconditionally excluded.
  it('reconciles correctly when the target is "." (the project root)', async () => {
    const roots = computeExclusionRoots({ target: '.', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: '.',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([
        { path: 'README.md', content: '# hello' },
        { path: 'src/index.ts', content: 'export {};' },
      ]),
      readExistingContent: fakeReadExistingContent([
        { path: 'README.md', content: '# hello' },
        { path: 'src/index.ts', content: 'different content' },
        { path: 'notes.md', content: 'extra' },
        // Unconditionally reserved — must never surface in any partition.
        { path: '.frontx/project.json', content: '{}' },
        { path: '.git/config', content: 'core' },
      ]),
    });

    expect(result.identicalFiles).toEqual(['README.md']);
    expect(result.contentConflicts).toEqual(['src/index.ts']);
    expect(result.additionalPaths).toEqual(['notes.md']);
  });

  // Regression (defect confirmed on a live run): `computePayloadSet` used to
  // filter ONLY by effective ownership, which subtracts `.frontx` but not
  // the template's own manifest — so a `frontx-template.json` already
  // present in the target used to be reported as `identicalFiles` or
  // `contentConflicts` on the payload's behalf. `isTemplatePayloadPath`
  // (`../manifest/types.ts`) now excludes the manifest from the payload
  // side before either partition is computed, at both a non-`.` target and
  // a nested one — the hazard the fix brief calls out: a target named `sub`
  // re-roots the manifest as `sub/frontx-template.json`, so the exclusion
  // must be applied to the still-template-relative path, before re-rooting.
  it('never treats the template\'s own manifest path as payload, so a pre-existing frontx-template.json is neither identicalFiles nor contentConflicts', async () => {
    const roots = computeExclusionRoots({ target: 'packages/app', excludedSubtrees: [], projectOwnedRoots: [] });

    const matching = await reconcileExistingContent({
      target: 'packages/app',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([
        { path: 'src/index.ts', content: 'export {};' },
        { path: 'frontx-template.json', content: '{"name":"my-template"}' },
      ]),
      readExistingContent: fakeReadExistingContent([
        { path: 'packages/app/src/index.ts', content: 'export {};' },
        // On disk already, byte-identical to what the payload would carry
        // for this path — must still never be reported as identicalFiles
        // "on the payload's behalf".
        { path: 'packages/app/frontx-template.json', content: '{"name":"my-template"}' },
      ]),
    });

    expect(matching.identicalFiles).toEqual(['packages/app/src/index.ts']);
    expect(matching.contentConflicts).toEqual([]);
    expect(matching.additionalPaths).toEqual(['packages/app/frontx-template.json']);

    const differing = await reconcileExistingContent({
      target: 'packages/app',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([
        { path: 'src/index.ts', content: 'export {};' },
        { path: 'frontx-template.json', content: '{"name":"my-template"}' },
      ]),
      readExistingContent: fakeReadExistingContent([
        { path: 'packages/app/src/index.ts', content: 'export {};' },
        // On disk already, DIFFERING from what the payload would carry —
        // must never be reported as a contentConflict "on the payload's
        // behalf" either.
        { path: 'packages/app/frontx-template.json', content: '{"name":"something-else"}' },
      ]),
    });

    expect(differing.contentConflicts).toEqual([]);
    expect(differing.identicalFiles).toEqual(['packages/app/src/index.ts']);
    expect(differing.additionalPaths).toEqual(['packages/app/frontx-template.json']);
  });

  // Same regression, for a NESTED target — proves the manifest exclusion is
  // applied to the still-template-relative path (`item.path`) BEFORE
  // `joinUnderTarget` re-roots it, not to the already-re-rooted
  // project-relative path: a naive comparison against the bare
  // `MANIFEST_FILENAME` after re-rooting would never match
  // `sub/dir/frontx-template.json`.
  it('never treats the manifest path as payload for a nested (non-".") target either', async () => {
    const roots = computeExclusionRoots({ target: 'sub/dir', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'sub/dir',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([
        { path: 'src/index.ts', content: 'export {};' },
        { path: 'frontx-template.json', content: '{"name":"my-template"}' },
      ]),
      readExistingContent: fakeReadExistingContent([
        { path: 'sub/dir/src/index.ts', content: 'export {};' },
        { path: 'sub/dir/frontx-template.json', content: '{"name":"my-template"}' },
      ]),
    });

    expect(result.identicalFiles).toEqual(['sub/dir/src/index.ts']);
    expect(result.contentConflicts).toEqual([]);
    expect(result.additionalPaths).toEqual(['sub/dir/frontx-template.json']);
  });

  // Directory-symlink case, variant A: the symlink stands INSIDE the
  // target. The real `readExistingContent` walk
  // (`adapters/fs-existing-content.ts`) never descends into a symlinked
  // directory: it reports the symlink itself, at its own path, and nothing
  // beneath it. A payload path hidden beneath such a symlink must not be
  // treated as a brand-new path merely because `existing.get(payloadPath)`
  // is `undefined` — reporting it as neither `contentConflicts` nor
  // `additionalPaths` would let materialization write straight through the
  // link into whatever it actually points at (here, `app/realdir/file.txt`,
  // which this fake models as a REAL file the walk reports normally,
  // exactly as the real walk would).
  it('reports a payload path as contentConflicts when a directory ANCESTOR inside the target is a symlink, never as a silent no-op', async () => {
    const roots = computeExclusionRoots({ target: '.', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: '.',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'app/dir/file.txt', content: 'TEMPLATE-CONTENT' }]),
      readExistingContent: fakeReadExistingContent([
        // The symlink itself — reported at its own path, the walk never
        // descending into it (so no `app/dir/file.txt` entry exists at all).
        { path: 'app/dir', content: SYMLINK_CONTENT_MARKER },
        // What the link actually points at — real, unrelated content the
        // walk reports normally because it is a plain directory.
        { path: 'app/realdir/file.txt', content: 'PRECIOUS-DO-NOT-TOUCH' },
      ]),
    });

    expect(result.contentConflicts).toEqual(['app/dir/file.txt']);
    // ...and named in the subset that says WHY, so the refusal can tell a
    // developer to resolve a link rather than to reconcile a content
    // difference that does not exist. Every uncomparable path is also a
    // content conflict; the subset never stands alone.
    expect(result.uncomparablePaths).toEqual(['app/dir/file.txt']);
    expect(result.identicalFiles).toEqual([]);
    // Both the symlink's own directory entry AND the real content it
    // happens to point at are foreign ground the payload never declared —
    // reported honestly as `additionalPaths`, never silently adopted or
    // overwritten by this algorithm (materialization is a separate concern).
    expect(result.additionalPaths.sort()).toEqual(['app/dir', 'app/realdir/file.txt']);
  });

  // A component at or ABOVE the target can be occupied by a regular file too,
  // and nothing can be created beneath it. Canonicalizing the target proves it
  // resolves inside the project root; it does not prove every component of it
  // is a directory, so the walk reaches the root rather than stopping at the
  // target's own depth.
  it('reports a payload path as contentConflicts when the target itself is occupied by a regular file', async () => {
    const result = await reconcileExistingContent({
      target: 'dst',
      exclusionRoots: [],
      installedContentPath: 'inv/t',
      readInstalledContent: fakeReadInstalledContent([{ path: 'pkg/z.txt', content: 'FROM-PAYLOAD' }]),
      // What the real read reports for this shape: the blocking component
      // itself, at its own project-relative path.
      readExistingContent: fakeReadExistingContent([{ path: 'dst', content: 'FILE-AT-TARGET' }]),
    });

    expect(result.contentConflicts).toEqual(['dst/pkg/z.txt']);
    expect(result.uncomparablePaths).toEqual(['dst/pkg/z.txt']);
    expect(result.identicalFiles).toEqual([]);
  });

  it('reports a payload path as contentConflicts when a component ABOVE the target is a regular file', async () => {
    const result = await reconcileExistingContent({
      target: 'parent/child',
      exclusionRoots: [],
      installedContentPath: 'inv/t',
      readInstalledContent: fakeReadInstalledContent([{ path: 'pkg/z.txt', content: 'FROM-PAYLOAD' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'parent', content: 'FILE-ABOVE-TARGET' }]),
    });

    expect(result.contentConflicts).toEqual(['parent/child/pkg/z.txt']);
    expect(result.uncomparablePaths).toEqual(['parent/child/pkg/z.txt']);
  });

  // The other half of the same distinction: an ordinary differing file is a
  // content conflict and is NOT named uncomparable, so a refusal listing
  // both causes attributes each path to the right one.
  it('leaves an ordinary differing payload path out of uncomparablePaths', async () => {
    const result = await reconcileExistingContent({
      target: '.',
      exclusionRoots: [],
      installedContentPath: 'inv/t',
      readInstalledContent: fakeReadInstalledContent([{ path: 'app/a.txt', content: 'FROM-PAYLOAD' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'app/a.txt', content: 'EDITED-BY-DEVELOPER' }]),
    });

    expect(result.contentConflicts).toEqual(['app/a.txt']);
    expect(result.uncomparablePaths).toEqual([]);
  });

  // DIRECTORY-SYMLINK FIX, variant B: the symlink stands ABOVE a payload
  // path but its own directory entry is reported WITHIN the target's own
  // effective-ownership area (`dst/app/dir`, for target `dst`) even though
  // the link's target lies outside the target entirely. Before this fix
  // `existing.get('dst/app/dir/file.txt')` was `undefined` for the identical
  // reason as variant A — the walk never produced that entry — and the
  // batch reported `ok:true`, materializing into whatever `dst/app/dir`
  // actually pointed at, worse than variant A because no refusal fired at
  // all.
  it('reports a payload path as contentConflicts when a directory ancestor ABOVE it in the target is a symlink, for a nested target too', async () => {
    const roots = computeExclusionRoots({ target: 'dst', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'dst',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'app/dir/file.txt', content: 'TEMPLATE-CONTENT' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'dst/app/dir', content: SYMLINK_CONTENT_MARKER }]),
    });

    expect(result.contentConflicts).toEqual(['dst/app/dir/file.txt']);
    expect(result.identicalFiles).toEqual([]);
    // The symlink's own directory entry is itself foreign, undeclared
    // ground — reported as `additionalPaths` exactly like any other
    // existing path the payload does not declare.
    expect(result.additionalPaths).toEqual(['dst/app/dir']);
  });

  // The ancestor walk must catch a symlink at ANY depth between the target
  // and the payload path, not only the immediate parent directory.
  it('catches a symlink two directory levels above the payload path, not only the immediate parent', async () => {
    const roots = computeExclusionRoots({ target: 'pkg', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'pkg',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'sub/dir/deep/file.txt', content: 'x' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'pkg/sub/dir', content: SYMLINK_CONTENT_MARKER }]),
    });

    expect(result.contentConflicts).toEqual(['pkg/sub/dir/deep/file.txt']);
  });

  // A symlink standing elsewhere — never an ancestor of the payload path
  // under test — must not cause a false-positive conflict for an unrelated
  // payload path.
  it('does not flag a payload path whose ancestors are all ordinary directories, even when an unrelated symlink exists elsewhere', async () => {
    const roots = computeExclusionRoots({ target: '.', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: '.',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'app/src/index.ts', content: 'export {};' }]),
      readExistingContent: fakeReadExistingContent([
        { path: 'app/src/index.ts', content: 'export {};' },
        // An unrelated symlink, sibling to `app`, never an ancestor of the
        // payload path above.
        { path: 'other/link', content: SYMLINK_CONTENT_MARKER },
      ]),
    });

    expect(result.identicalFiles).toEqual(['app/src/index.ts']);
    expect(result.contentConflicts).toEqual([]);
    expect(result.additionalPaths).toEqual(['other/link']);
  });

  // --- a REGULAR FILE standing where a directory is required, not only a
  // symlink — the real `readExistingContent` walk never descends into a
  // regular file either (there is nothing beneath a file to descend into),
  // so it reports the file itself, at its own path, exactly like a symlinked
  // directory — and a payload path beneath it is exactly as invisible to the
  // two-map lookup as one beneath a symlink is. Before this fix, only a
  // `SYMLINK_CONTENT_MARKER` entry counted as an obstruction; an ordinary
  // file entry at the identical position was invisible to the ancestor walk,
  // so the payload path underneath it looked like nothing on disk, and
  // `commands/apply.ts` reached its own `writeFileFn` and failed with a raw
  // `ENOTDIR: not a directory, mkdir ...` — exit 2, `INTERNAL` — rather than
  // this module's own structured `CONTENT_CONFLICT`.

  it('reports a payload path as contentConflicts when a directory ancestor is an ordinary REGULAR FILE, never a silent no-op', async () => {
    const roots = computeExclusionRoots({ target: '.', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: '.',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'app2/dir/sub/a.txt', content: 'TEMPLATE-CONTENT' }]),
      readExistingContent: fakeReadExistingContent([
        // A plain file stands where a directory is required — never
        // descended into by the real walk, so `app2/dir/sub/a.txt` never
        // appears as its own entry.
        { path: 'app2/dir', content: 'PROTECTED-ANCESTOR-FILE' },
      ]),
    });

    expect(result.contentConflicts).toEqual(['app2/dir/sub/a.txt']);
    expect(result.uncomparablePaths).toEqual(['app2/dir/sub/a.txt']);
    expect(result.uncomparableCauses).toEqual([{ path: 'app2/dir/sub/a.txt', component: 'app2/dir', kind: 'file' }]);
    expect(result.identicalFiles).toEqual([]);
    // The file itself is foreign, undeclared ground — reported as
    // `additionalPaths`, never silently overwritten or adopted.
    expect(result.additionalPaths).toEqual(['app2/dir']);
  });

  it('catches a regular-file ancestor two directory levels above the payload path, not only the immediate parent', async () => {
    const roots = computeExclusionRoots({ target: 'pkg', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: 'pkg',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'sub/dir/deep/file.txt', content: 'x' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'pkg/sub/dir', content: 'PROTECTED-ANCESTOR-FILE' }]),
    });

    expect(result.contentConflicts).toEqual(['pkg/sub/dir/deep/file.txt']);
    expect(result.uncomparableCauses).toEqual([{ path: 'pkg/sub/dir/deep/file.txt', component: 'pkg/sub/dir', kind: 'file' }]);
  });

  // The SHALLOWEST bad ancestor wins — it is the one that actually blocks
  // the path, since nothing beneath a non-directory entry can exist on a
  // real filesystem regardless of what a deeper ancestor might otherwise
  // report; the deeper "symlink" entry cannot honestly coexist with it on a
  // real filesystem, but the deterministic precedence is still worth pinning
  // so the two causes can never both fire for the same path.
  it('names the shallowest bad ancestor when checking a payload path several levels deep', async () => {
    const roots = computeExclusionRoots({ target: '.', excludedSubtrees: [], projectOwnedRoots: [] });

    const result = await reconcileExistingContent({
      target: '.',
      exclusionRoots: roots,
      installedContentPath: '/inventory/my-template',
      readInstalledContent: fakeReadInstalledContent([{ path: 'a/b/c/leaf.txt', content: 'x' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'a/b', content: 'SHALLOW-FILE' }]),
    });

    expect(result.uncomparableCauses).toEqual([{ path: 'a/b/c/leaf.txt', component: 'a/b', kind: 'file' }]);
  });

  // A symlink AT the payload path itself is still named with `component`
  // equal to `path` — the leaf-symlink case `inst-ec-if-symlink-component`
  // already covered before this fix, unaffected by broadening the ancestor
  // check to non-symlink entries.
  it('names the payload path itself as the cause when the symlink stands exactly there, not an ancestor', async () => {
    const result = await reconcileExistingContent({
      target: '.',
      exclusionRoots: [],
      installedContentPath: 'inv/t',
      readInstalledContent: fakeReadInstalledContent([{ path: 'app/leaf.txt', content: 'TEMPLATE' }]),
      readExistingContent: fakeReadExistingContent([{ path: 'app/leaf.txt', content: SYMLINK_CONTENT_MARKER }]),
    });

    expect(result.uncomparableCauses).toEqual([{ path: 'app/leaf.txt', component: 'app/leaf.txt', kind: 'symlink' }]);
  });
});

// --- `target` itself is no longer a directory, against a REAL filesystem --
//
// `apply`'s own pre-flight canonicalization (`createFsCanonicalizeTargetFn`,
// `../adapters/fs-project-io.ts`) proves a batch's target resolves inside the
// project root and resolves every symlink along its own path, but it never
// verifies every path component is actually a directory — a regular file
// standing at (or above) `target` survives that canonicalization untouched.
// Before this fix, `createFsReadExistingContentFn` called `fs.readdirSync`
// on `target` unconditionally once it existed at all, which throws `ENOTDIR`
// for a non-directory `target` — uncaught, since this reconciliation step
// runs in `runApplyPipeline` BEFORE its own try/catch begins, bypassing every
// structured refusal the pipeline otherwise builds. A fake `ReadExistingContentFn`
// cannot honestly exercise this (it never calls `fs.readdirSync` at all), so
// this is pinned against the real adapter.
describe('createFsReadExistingContentFn — target itself is not a directory', () => {
  let repoRoot: string | undefined;

  afterEach(async () => {
    if (repoRoot !== undefined) {
      await rm(repoRoot, { recursive: true, force: true });
      repoRoot = undefined;
    }
  });

  it('reports the blocking component itself, rather than throwing ENOTDIR, when target is a regular file', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-existing-content-target-file-'));
    await mkdir(path.join(repoRoot, 'app2'), { recursive: true });
    await writeFile(path.join(repoRoot, 'app2', 'dir'), 'PROTECTED-TARGET-FILE', 'utf-8');
    const readExistingContent = createFsReadExistingContentFn(repoRoot);

    const items = await readExistingContent('app2/dir');

    // Naming the component is what lets reconciliation refuse the payload
    // paths beneath it by name. Reporting `[]` would say "nothing is here",
    // which is the one thing that is not true: something is here, and it is
    // exactly what makes the target unusable.
    expect(items).toEqual([{ path: 'app2/dir', content: 'PROTECTED-TARGET-FILE' }]);
  });

  it('reports the shallowest blocking component when one stands ABOVE the target', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-existing-content-above-target-'));
    await writeFile(path.join(repoRoot, 'parent'), 'FILE-ABOVE-TARGET', 'utf-8');
    const readExistingContent = createFsReadExistingContentFn(repoRoot);

    const items = await readExistingContent('parent/child');

    expect(items).toEqual([{ path: 'parent', content: 'FILE-ABOVE-TARGET' }]);
  });

  it('still walks normally when target is an ordinary directory', async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'frontx-existing-content-target-dir-'));
    await mkdir(path.join(repoRoot, 'app'), { recursive: true });
    await writeFile(path.join(repoRoot, 'app', 'a.txt'), 'content', 'utf-8');
    const readExistingContent = createFsReadExistingContentFn(repoRoot);

    const items = await readExistingContent('app');

    expect(items).toEqual([{ path: 'app/a.txt', content: 'content' }]);
  });
});
