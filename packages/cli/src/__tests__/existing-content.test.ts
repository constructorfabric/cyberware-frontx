// @cpt-algo:cpt-frontx-algo-cli-scaffolding-existing-content:p1
import { describe, expect, it } from 'vitest';
import { reconcileExistingContent, SYMLINK_CONTENT_MARKER } from '../scaffold/existing-content';
import { computeExclusionRoots } from '../scaffold/effective-ownership';
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

    expect(result).toEqual({ uncomparablePaths: [], identicalFiles: [], contentConflicts: [], additionalPaths: [] });
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
});
