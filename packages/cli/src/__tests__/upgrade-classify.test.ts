// @cpt-algo:cpt-frontx-algo-upgrade-changeset-classify:p1
import { describe, expect, it } from 'vitest';
import { classifyTarget } from '../upgrade/classify';
import type { ClassifyInput } from '../upgrade/classify';
import type { DiskEntry, ReadDiskEntryFn, ResolvedPayload } from '../upgrade/types';

// A resolved payload fixture — `name`/`version`/`origin` are never read by
// classification itself (only `files` and `excludedSubtrees` are), so they
// carry fixed placeholder values across every test.
function payload(files: Record<string, string>, excludedSubtrees: string[] = []): ResolvedPayload {
  return {
    name: 'my-template',
    version: '1.0.0',
    origin: 'github:acme/my-template@v1.0.0',
    files: new Map(Object.entries(files)),
    excludedSubtrees,
  };
}

const fileEntry = (content: string): DiskEntry => ({ kind: 'file', content });
const absentEntry: DiskEntry = { kind: 'absent' };
const directoryEntry: DiskEntry = { kind: 'directory' };
const symlinkEntry: DiskEntry = { kind: 'symlink' };
const specialEntry: DiskEntry = { kind: 'special' };

// Keyed by absolute path; unlisted paths default to absent, which is the
// ordinary case for every path a test does not care to stage disk content
// for. `forbidden` lets a test assert a path this seam contracts to skip
// enumerating is never even queried.
function fakeReadDiskEntry(entries: Record<string, DiskEntry> = {}, forbidden: string[] = []): ReadDiskEntryFn {
  return async (absolutePath) => {
    if (forbidden.includes(absolutePath)) {
      throw new Error(`readDiskEntry must not be called for ${absolutePath} — it is never enumerated`);
    }
    return entries[absolutePath] ?? absentEntry;
  };
}

// Keyed by absolute directory; unlisted directories default to no regular
// files, mirroring `ListDiskFilesFn`'s own "resolves to `[]`... when the
// directory does not exist" contract.
const identityCanonicalize = (raw: string): string | null => raw;

function baseInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    target: 'packages/app',
    repoRoot: '/repo',
    baseline: payload({}),
    candidate: payload({}),
    projectOwnedRoots: [],
    otherTemplateTargets: [],
    additionalExclusionRoots: [],
    readDiskEntry: fakeReadDiskEntry({}),
    canonicalizeFn: identityCanonicalize,
    ...overrides,
  };
}

describe('classifyTarget (cpt-frontx-algo-upgrade-changeset-classify)', () => {
  // --- 1. straightforward cases for each op kind -------------------------

  it('classifies a path present only in the candidate as ADD', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'src/new.ts': 'new content' }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/new.ts', op: 'ADD', expectedDisk: null, newContent: 'new content', baselineContent: null },
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  it('classifies a path whose candidate content differs from baseline while disk still matches baseline as REPLACE', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/a.ts': 'old' }),
        candidate: payload({ 'src/a.ts': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/a.ts': fileEntry('old') }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/a.ts', op: 'REPLACE', expectedDisk: 'old', newContent: 'new', baselineContent: 'old' },
    ]);
  });

  it('classifies a path present only in the baseline with disk still matching baseline as REMOVE', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/old.ts': 'stuff' }),
        candidate: payload({}),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/old.ts': fileEntry('stuff') }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/old.ts', op: 'REMOVE', expectedDisk: 'stuff', baselineContent: 'stuff' },
    ]);
  });

  it('classifies a path both versions carry identically but the developer hand-edited as KEEP_LOCAL', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/keep.ts': 'same' }),
        candidate: payload({ 'src/keep.ts': 'same' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/keep.ts': fileEntry('hand-edited') }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/keep.ts', op: 'KEEP_LOCAL', expectedDisk: 'hand-edited', baselineContent: 'same' },
    ]);
  });

  it('classifies a path already at the candidate content (an ordinary already-applied file) as UNCHANGED', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/u.ts': 'old' }),
        candidate: payload({ 'src/u.ts': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/u.ts': fileEntry('new') }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/u.ts', op: 'UNCHANGED', expectedDisk: 'new', baselineContent: 'old' },
    ]);
  });

  // --- 2. doubly-changed -> conflictPaths, never an operation -------------

  it('reports a doubly-changed file in conflictPaths, not as an operation', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/c.ts': 'base' }),
        candidate: payload({ 'src/c.ts': 'cand' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/c.ts': fileEntry('local-edit') }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/src/c.ts']);
    expect(result.operations).toEqual([]);
  });

  // --- 3. UNCHANGED-first precedence, three separate scenarios ------------

  it('precedence (a): a developer-created file byte-identical to what the candidate adds classifies UNCHANGED, not ADD', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'src/x.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/x.ts': fileEntry('content') }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/x.ts', op: 'UNCHANGED', expectedDisk: 'content', baselineContent: null },
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  it('precedence (b): a candidate removal of a file the developer already deleted classifies UNCHANGED (both absences equal), not REMOVE', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/y.ts': 'content' }),
        candidate: payload({}),
        // Deleted: no disk listing, no disk content for it.
        readDiskEntry: fakeReadDiskEntry({}),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/y.ts', op: 'UNCHANGED', expectedDisk: null, baselineContent: 'content' },
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  it('precedence (c): a path a crashed run had already landed (disk equals candidate while baseline differs) classifies UNCHANGED, not a conflict', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/z.ts': 'old' }),
        candidate: payload({ 'src/z.ts': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/z.ts': fileEntry('new') }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/z.ts', op: 'UNCHANGED', expectedDisk: 'new', baselineContent: 'old' },
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  // --- 4. identical-in-both-versions file the developer deleted -> KEEP_LOCAL

  it('classifies a file both versions carry identically that the developer deleted as KEEP_LOCAL, never REMOVE', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/w.ts': 'shared' }),
        candidate: payload({ 'src/w.ts': 'shared' }),
        // Deleted: absent on disk, and no longer listed.
        readDiskEntry: fakeReadDiskEntry({}),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/src/w.ts', op: 'KEEP_LOCAL', expectedDisk: null, baselineContent: 'shared' },
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  // --- 5. developer deletion the candidate also changes -> conflict -------

  it('reports a path the developer deleted that the candidate also changes as a doubly-changed conflict', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/v.ts': 'base' }),
        candidate: payload({ 'src/v.ts': 'changed' }),
        // Deleted by the developer: absent on disk.
        readDiskEntry: fakeReadDiskEntry({}),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/src/v.ts']);
    expect(result.operations).toEqual([]);
  });

  // --- 6/7. non-regular disk entries fail-closed --------------------------

  it('reports a directory on disk where a payload declares a path as a conflict, fail-closed', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'src/dir.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/dir.ts': directoryEntry }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/src/dir.ts']);
    expect(result.operations).toEqual([]);
  });

  it('reports a symlink on disk where a payload declares a path as a conflict, fail-closed', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'src/link.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/link.ts': symlinkEntry }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/src/link.ts']);
    expect(result.operations).toEqual([]);
  });

  // A FIFO, socket, or device standing exactly at a payload-declared LEAF —
  // reported by the real adapter's own `'special'` kind (never collapsed
  // into `'directory'`, which is a PERMITTED ancestor shape and would have
  // let this pass as ordinary structure instead of refusing it).
  it('reports a special file (FIFO/socket/device) on disk where a payload declares a path as a conflict, fail-closed', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'src/pipe.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/pipe.ts': specialEntry }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/src/pipe.ts']);
    expect(result.uncomparableCauses).toEqual([
      { path: 'packages/app/src/pipe.ts', component: 'packages/app/src/pipe.ts', kind: 'special' },
    ]);
    expect(result.operations).toEqual([]);
  });

  // --- 7c. special-file ANCESTOR: the false-success this fixes ------------
  //
  // The defect this class of test pins: a FIFO standing where an ancestor
  // directory is required used to be reported `'directory'` (a PERMITTED
  // ancestor shape), so the ancestor probe never flagged it — every path
  // beneath it then reached `readDiskEntry`, which threw `ENOTDIR` (a real
  // adapter fact — see the fake's own limits noted in
  // `upgrade-classify-symlink-ancestor-fs.test.ts`) and was reported
  // `'absent'`. Because this algorithm's own precedence rule treats two
  // absences as equal, a path whose baseline and candidate carry it
  // IDENTICALLY then classified `UNCHANGED` — a false success for content
  // this algorithm never actually managed to read at all, exactly the
  // `--restore` failure mode this fixture reproduces the mechanism of.
  it('reports a conflict — never UNCHANGED — when an ancestor directory component is a special file, even though the baseline and candidate agree', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'pipe/sub/leaf.txt': 'same-in-both' }),
        candidate: payload({ 'pipe/sub/leaf.txt': 'same-in-both' }),
        readDiskEntry: fakeReadDiskEntry({
          '/repo/packages/app/pipe': specialEntry,
          // The leaf itself is never even asked: a bad ancestor takes
          // precedence over whatever the leaf's own probe would report.
        }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/pipe/sub/leaf.txt']);
    expect(result.uncomparablePaths).toEqual(['packages/app/pipe/sub/leaf.txt']);
    expect(result.escapingPaths).toEqual([]);
    expect(result.uncomparableCauses).toEqual([
      { path: 'packages/app/pipe/sub/leaf.txt', component: 'packages/app/pipe', kind: 'special' },
    ]);
    // Never `UNCHANGED`, and never any operation at all — the false success
    // this fixture exists to rule out.
    expect(result.operations).toEqual([]);
  });

  it('reports a conflict for ADD and REMOVE through a special-file ancestor, not only a path both payloads agree on', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'pipe/remove.ts': 'gone-baseline' }),
        candidate: payload({ 'pipe/add.ts': 'brand-new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/pipe': specialEntry }),
      }),
    );

    expect(result.conflictPaths.sort()).toEqual(['packages/app/pipe/add.ts', 'packages/app/pipe/remove.ts']);
    expect(result.operations).toEqual([]);
  });

  // --- 7b. symlinked ANCESTOR directory component, fail-closed -----------
  // The leaf-only check above refuses a symlinked LEAF, but a symlinked
  // ANCESTOR must be refused too rather than silently followed — see
  // `../upgrade/classify.ts`'s `hasSymlinkAncestor` doc comment for the full
  // reasoning.

  it('reports a conflict when an ancestor directory component below target is a symlink, regardless of what the leaf itself reports', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'vendor/lib.ts': 'old' }),
        candidate: payload({ 'vendor/lib.ts': 'new' }),
        readDiskEntry: fakeReadDiskEntry({
          '/repo/packages/app/vendor': symlinkEntry,
          // The leaf itself looks like an ordinary matching file — through
          // the symlink, this is whatever `vendor` actually resolves to,
          // never to be trusted once an ancestor is a symlink.
          '/repo/packages/app/vendor/lib.ts': fileEntry('old'),
        }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/vendor/lib.ts']);
    expect(result.operations).toEqual([]);
  });

  it('flags every operation class (ADD, REPLACE, REMOVE) sharing one symlinked ancestor, probing that ancestor exactly once', async () => {
    const calls: string[] = [];
    const readDiskEntry = async (absolutePath: string) => {
      calls.push(absolutePath);
      if (absolutePath === '/repo/packages/app/vendor') return symlinkEntry;
      if (absolutePath === '/repo/packages/app/vendor/replace.ts') return fileEntry('old');
      if (absolutePath === '/repo/packages/app/vendor/remove.ts') return fileEntry('gone-baseline');
      return absentEntry;
    };

    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'vendor/replace.ts': 'old', 'vendor/remove.ts': 'gone-baseline' }),
        candidate: payload({ 'vendor/replace.ts': 'new', 'vendor/add.ts': 'brand-new' }),
        readDiskEntry,
      }),
    );

    expect(result.conflictPaths.sort()).toEqual(
      ['packages/app/vendor/add.ts', 'packages/app/vendor/remove.ts', 'packages/app/vendor/replace.ts'].sort(),
    );
    expect(result.operations).toEqual([]);
    // The shared ancestor is probed once for the whole classification, not
    // once per path beneath it — the caching `hasSymlinkAncestor` requires.
    expect(calls.filter((c) => c === '/repo/packages/app/vendor')).toHaveLength(1);
  });

  it('flags a conflict when a DEEPER ancestor directory component is a symlink, not only the immediate parent', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'vendor/nested/deep/new.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({
          '/repo/packages/app/vendor': directoryEntry,
          '/repo/packages/app/vendor/nested': symlinkEntry,
        }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/vendor/nested/deep/new.ts']);
    expect(result.operations).toEqual([]);
  });

  it('does not flag a path whose ancestor directories are ordinary real directories', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'vendor/nested/new.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({
          '/repo/packages/app/vendor': directoryEntry,
          '/repo/packages/app/vendor/nested': directoryEntry,
        }),
      }),
    );

    expect(result.operations).toEqual([
      { target: 'packages/app', path: 'packages/app/vendor/nested/new.ts', op: 'ADD', expectedDisk: null, newContent: 'content', baselineContent: null },
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  it('target "." (the project root): a symlinked ancestor directory component is still detected, with a zero-segment target', async () => {
    const result = await classifyTarget(
      baseInput({
        target: '.',
        baseline: payload({}),
        candidate: payload({ 'app/dir/sub/b.txt': 'V2' }),
        readDiskEntry: fakeReadDiskEntry({
          '/repo/app': directoryEntry,
          '/repo/app/dir': symlinkEntry,
        }),
      }),
    );

    expect(result.conflictPaths).toEqual(['app/dir/sub/b.txt']);
    expect(result.operations).toEqual([]);
  });

  it('never probes a symlinked directory elsewhere in the target that is not an ancestor of any enumerated payload path', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/a.ts': 'v1' }),
        candidate: payload({ 'src/a.ts': 'v1' }),
        readDiskEntry: fakeReadDiskEntry(
          { '/repo/packages/app/src/a.ts': fileEntry('v1') },
          // An unrelated symlinked directory (simulating a node_modules
          // link) no enumerated payload path ever passes through — the
          // ancestor probe must never even ask about it.
          ['/repo/packages/app/vendor'],
        ),
      }),
    );

    expect(result.operations).toEqual([expect.objectContaining({ path: 'packages/app/src/a.ts', op: 'UNCHANGED' })]);
    expect(result.conflictPaths).toEqual([]);
  });

  // --- 7c. the ancestor probe covers the WHOLE chain, target's own
  // component included, and distinguishes uncomparable causes -------------
  // The probe must not start strictly BELOW `target`: `target`'s own path
  // component — and everything above it — must be probed too. `target` is
  // a string recorded in the project state store and is never canonicalized
  // by this engine the way `apply`'s pre-flight canonicalizes a batch's own
  // target, so a `target` that is itself a symlink can reach classification
  // unresolved.

  it("refuses fail-closed when target's own path component is a symlink, not only a component below it", async () => {
    const result = await classifyTarget(
      baseInput({
        target: 'packages/app',
        baseline: payload({ 'dir/sub/b.txt': 'V1' }),
        candidate: payload({ 'dir/sub/b.txt': 'V2' }),
        readDiskEntry: fakeReadDiskEntry({
          // The TARGET's own component, not a component below it.
          '/repo/packages/app': symlinkEntry,
          '/repo/packages/app/dir/sub/b.txt': fileEntry('V1'),
        }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/dir/sub/b.txt']);
    expect(result.uncomparablePaths).toEqual(['packages/app/dir/sub/b.txt']);
    expect(result.operations).toEqual([]);
  });

  it('refuses fail-closed when an ancestor ABOVE the target itself is a symlink', async () => {
    const result = await classifyTarget(
      baseInput({
        target: 'packages/app',
        baseline: payload({}),
        candidate: payload({ 'new.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({
          // 'packages' is a proper ancestor of `target`, not `target` itself.
          '/repo/packages': symlinkEntry,
        }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/new.ts']);
    expect(result.uncomparablePaths).toEqual(['packages/app/new.ts']);
    expect(result.operations).toEqual([]);
  });

  it('refuses fail-closed when an ancestor directory component is an ordinary regular file, exactly like a symlink', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'vendor/lib.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({
          // A plain file stands where a directory is required.
          '/repo/packages/app/vendor': fileEntry('not-a-directory'),
        }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/vendor/lib.ts']);
    expect(result.uncomparablePaths).toEqual(['packages/app/vendor/lib.ts']);
    expect(result.escapingPaths).toEqual([]);
    expect(result.operations).toEqual([]);
  });

  it('reports an ancestor symlink as escaping when canonicalizeFn proves its resolved target leaves the project root', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'vendor/lib.ts': 'old' }),
        candidate: payload({ 'vendor/lib.ts': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/vendor': symlinkEntry }),
        // Only the ancestor actually probed reports an escape — proves the
        // verdict is read from `canonicalizeFn`, not assumed from the
        // symlink's mere presence.
        canonicalizeFn: (raw) => (raw === 'packages/app/vendor' ? null : raw),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/vendor/lib.ts']);
    expect(result.uncomparablePaths).toEqual(['packages/app/vendor/lib.ts']);
    expect(result.escapingPaths).toEqual(['packages/app/vendor/lib.ts']);
  });

  it('does not mark an internal ancestor symlink (resolving inside the project) as escaping', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'vendor/lib.ts': 'old' }),
        candidate: payload({ 'vendor/lib.ts': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/vendor': symlinkEntry }),
        canonicalizeFn: identityCanonicalize, // never reports an escape
      }),
    );

    expect(result.uncomparablePaths).toEqual(['packages/app/vendor/lib.ts']);
    expect(result.escapingPaths).toEqual([]);
  });

  it('does not mark a genuinely doubly-changed file as uncomparable — the two causes stay disjoint', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/c.ts': 'base' }),
        candidate: payload({ 'src/c.ts': 'cand' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/c.ts': fileEntry('local-edit') }),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/src/c.ts']);
    expect(result.uncomparablePaths).toEqual([]);
    expect(result.escapingPaths).toEqual([]);
  });

  // --- LEAF symlink escaping the project root: `apply`'s own per-payload-
  // path containment check reports this as `INVALID_PATH` (it resolves the
  // whole absolute path, symlinks included); before this fix classification
  // reported it as an ordinary `CONTENT_CONFLICT`, since only an ANCESTOR
  // symlink's escape was ever checked — the leaf's own `diskEntry.kind ===
  // 'symlink'` branch never consulted `canonicalizeFn` at all. Both engines
  // must agree.

  it("reports the LEAF itself as escaping when canonicalizeFn proves its own resolved target leaves the project root", async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'leaf.txt': 'old' }),
        candidate: payload({ 'leaf.txt': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/leaf.txt': symlinkEntry }),
        canonicalizeFn: (raw) => (raw === 'packages/app/leaf.txt' ? null : raw),
      }),
    );

    expect(result.conflictPaths).toEqual(['packages/app/leaf.txt']);
    expect(result.uncomparablePaths).toEqual(['packages/app/leaf.txt']);
    expect(result.escapingPaths).toEqual(['packages/app/leaf.txt']);
  });

  it('does not mark a LEAF symlink resolving inside the project as escaping', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'leaf.txt': 'old' }),
        candidate: payload({ 'leaf.txt': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/leaf.txt': symlinkEntry }),
        canonicalizeFn: identityCanonicalize,
      }),
    );

    expect(result.uncomparablePaths).toEqual(['packages/app/leaf.txt']);
    expect(result.escapingPaths).toEqual([]);
  });

  // --- uncomparableCauses: naming the specific offending component --------

  it('names the leaf itself as the cause when the leaf is a directory or a symlink', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'leaf.txt': 'new' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/leaf.txt': directoryEntry }),
      }),
    );

    expect(result.uncomparableCauses).toEqual([
      { path: 'packages/app/leaf.txt', component: 'packages/app/leaf.txt', kind: 'directory' },
    ]);
  });

  it('names the offending ancestor, not the leaf, when an ancestor is the bad component', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'vendor/lib.ts': 'content' }),
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/vendor': fileEntry('not-a-directory') }),
      }),
    );

    expect(result.uncomparableCauses).toEqual([
      { path: 'packages/app/vendor/lib.ts', component: 'packages/app/vendor', kind: 'file' },
    ]);
  });

  // --- 8. an undeclared symlink is never enumerated -----------------------

  it('never enumerates, compares, or conflicts on a developer symlink at a path neither payload declares', async () => {
    // A conformant `listDiskFiles` never reports a symlink at all (regular
    // files only), so the symlink simply never reaches `readDiskEntry` —
    // asserted here by making that call throw if it ever happens.
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({}),
        readDiskEntry: fakeReadDiskEntry({}, ['/repo/packages/app/mystery-symlink']),
      }),
    );

    expect(result.operations).toEqual([]);
    expect(result.conflictPaths).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  // A developer's own REGULAR FILE at a path neither payload declares is
  // likewise never enumerated — the property `inst-cls-enumerate` was
  // corrected to state, after its original wording contradicted its own
  // governing ADR ("a developer's own file or symlink sitting there that
  // neither payload ever declared is not examined at all").
  //
  // The stakes are reviewability, not correctness of writes: such a path
  // classifies `KEEP_LOCAL` and nothing is ever written for it, but it would
  // still occupy a line in the plan the developer reviews and approves. For a
  // target at the project root that is one no-op line per file in the whole
  // repository, burying the operations the upgrade actually performs — and
  // whole-file reviewability is the property this entire mechanism was chosen
  // for. Asserted as an EMPTY plan, not merely "no write".
  it('never enumerates or reports a developer regular file at a path neither payload declares, keeping the plan reviewable', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/owned.ts': 'v1' }),
        candidate: payload({ 'src/owned.ts': 'v1' }),
        readDiskEntry: fakeReadDiskEntry(
          { '/repo/packages/app/src/owned.ts': { kind: 'file', content: 'v1' } },
          // The developer's own file sits inside the boundary but is declared
          // by neither payload: `readDiskEntry` must never even be ASKED
          // about it, which `forbidden` asserts by throwing if it is.
          ['/repo/packages/app/src/my-scratch-notes.ts'],
        ),
      }),
    );

    const paths = result.operations.map((op) => op.path);
    expect(paths).not.toContain('packages/app/src/my-scratch-notes.ts');
    expect(result.skipped.map((s) => s.path)).not.toContain('packages/app/src/my-scratch-notes.ts');
    expect(result.conflictPaths).toEqual([]);
    // The one payload-declared path converges (disk already equals candidate).
    expect(result.operations).toEqual([
      expect.objectContaining({ path: 'packages/app/src/owned.ts', op: 'UNCHANGED' }),
    ]);
  });

  // --- 9. boundary: candidate-manifest excludedSubtrees -------------------

  it('reports a payload path under the candidate manifest\'s excludedSubtrees as SKIPPED (OUTSIDE_BOUNDARY), never compared', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'vendor/lib.ts': 'vendored content' }, ['vendor']),
        readDiskEntry: fakeReadDiskEntry({}, ['/repo/packages/app/vendor/lib.ts']),
      }),
    );

    expect(result.skipped).toEqual([{ target: 'packages/app', path: 'packages/app/vendor/lib.ts', reason: 'OUTSIDE_BOUNDARY' }]);
    expect(result.operations).toEqual([]);
    expect(result.conflictPaths).toEqual([]);
  });

  // --- 10. boundary, one test per remaining term --------------------------

  it('boundary term: a payload path inside a projectOwnedRoots entry is SKIPPED', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'generated/x.ts': 'gen' }),
        projectOwnedRoots: ['packages/app/generated'],
      }),
    );

    expect(result.skipped).toEqual([{ target: 'packages/app', path: 'packages/app/generated/x.ts', reason: 'OUTSIDE_BOUNDARY' }]);
    expect(result.operations).toEqual([]);
  });

  it('boundary term: a payload path inside .frontx is SKIPPED', async () => {
    const result = await classifyTarget(
      baseInput({
        target: '.',
        baseline: payload({}),
        candidate: payload({ '.frontx/state.json': '{}' }),
      }),
    );

    expect(result.skipped).toEqual([{ target: '.', path: '.frontx/state.json', reason: 'OUTSIDE_BOUNDARY' }]);
    expect(result.operations).toEqual([]);
  });

  it('boundary term: a payload path inside a reserved environment entry (.git) is SKIPPED', async () => {
    const result = await classifyTarget(
      baseInput({
        target: '.',
        baseline: payload({}),
        candidate: payload({ '.git/config': 'stuff' }),
      }),
    );

    expect(result.skipped).toEqual([{ target: '.', path: '.git/config', reason: 'OUTSIDE_BOUNDARY' }]);
    expect(result.operations).toEqual([]);
  });

  it('boundary term: a payload path inside the template\'s own local origin folder is SKIPPED', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'local-origin/manifest.json': '{}' }),
        localOriginFolder: 'packages/app/local-origin',
      }),
    );

    expect(result.skipped).toEqual([{ target: 'packages/app', path: 'packages/app/local-origin/manifest.json', reason: 'OUTSIDE_BOUNDARY' }]);
    expect(result.operations).toEqual([]);
  });

  // --- 11. reserved temporary-file naming convention ----------------------

  it('reports a payload path matching the reserved temp-file convention as SKIPPED (RESERVED_TEMP_NAME)', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}),
        candidate: payload({ 'notes.txt.frontx-upgrade-tmp': 'scratch' }),
      }),
    );

    expect(result.skipped).toEqual([
      { target: 'packages/app', path: 'packages/app/notes.txt.frontx-upgrade-tmp', reason: 'RESERVED_TEMP_NAME' },
    ]);
    expect(result.operations).toEqual([]);
    expect(result.conflictPaths).toEqual([]);
  });

  // --- 12/13. newly-claimed ground and the nesting-aware check ------------

  it('reports newly-claimed ground occupied by another registered template\'s target as a nested conflict', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}, ['vendor/lib']),
        candidate: payload({}, []), // dropped the exclusion: newly claimed
        otherTemplateTargets: [{ target: 'packages/app/vendor/lib', templateName: 'otherTpl', excludedSubtrees: [] }],
      }),
    );

    expect(result.nestedConflicts).toEqual([{ target: 'packages/app/vendor/lib', templateName: 'otherTpl' }]);
  });

  it('classifies newly-claimed ground NOT occupied by another template as ordinary eligible ground', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({}, ['vendor/lib']),
        candidate: payload({ 'vendor/lib/new.ts': 'content' }, []), // dropped the exclusion, and now writes into it
        otherTemplateTargets: [],
      }),
    );

    expect(result.nestedConflicts).toEqual([]);
    expect(result.operations).toEqual([
      {
        target: 'packages/app',
        path: 'packages/app/vendor/lib/new.ts',
        op: 'ADD',
        expectedDisk: null,
        newContent: 'content',
        baselineContent: null,
      },
    ]);
  });

  // --- 14. target: '.' works for ADD and SKIPPED --------------------------

  it('target "." (the project root): an ADD case joins the path correctly', async () => {
    const result = await classifyTarget(
      baseInput({
        target: '.',
        baseline: payload({}),
        candidate: payload({ 'README.md': 'hello' }),
      }),
    );

    expect(result.operations).toEqual([
      { target: '.', path: 'README.md', op: 'ADD', expectedDisk: null, newContent: 'hello', baselineContent: null },
    ]);
  });

  it('target "." (the project root): a SKIPPED case (projectOwnedRoots) joins the path correctly', async () => {
    const result = await classifyTarget(
      baseInput({
        target: '.',
        baseline: payload({}),
        candidate: payload({ 'generated/x.ts': 'gen' }),
        projectOwnedRoots: ['generated'],
      }),
    );

    expect(result.skipped).toEqual([{ target: '.', path: 'generated/x.ts', reason: 'OUTSIDE_BOUNDARY' }]);
    expect(result.operations).toEqual([]);
  });
  // Regression for the boundary hole this engine reopened: `apply`
  // (`scaffold/assembler.ts`'s `collectOtherLocalOriginFolders`) and `delete`
  // (`delete-plan.ts`'s `inst-dp-find-other-origins`) both subtract every
  // OTHER registered template's local `path:` origin folder as a
  // caller-side addition beyond the six terms. Without the same subtraction
  // here, a payload path colliding with another template's origin folder
  // classified normally and commit would ADD/REPLACE/REMOVE inside that
  // template's own source of truth.
  it('never classifies a payload path inside reserved ground supplied as an additional exclusion root', async () => {
    const result = await classifyTarget(
      baseInput({
        // Both payloads declare a path that lands inside another template's
        // origin folder; the baseline drops it, which would otherwise REMOVE
        // a file belonging to that other template.
        baseline: payload({ 'vendor/other-tpl/README.md': 'theirs', 'src/mine.ts': 'v1' }),
        candidate: payload({ 'src/mine.ts': 'v2' }),
        additionalExclusionRoots: ['packages/app/vendor/other-tpl'],
        readDiskEntry: fakeReadDiskEntry({
          '/repo/packages/app/vendor/other-tpl/README.md': fileEntry('theirs'),
          '/repo/packages/app/src/mine.ts': fileEntry('v1'),
        }),
      }),
    );

    // Reported SKIPPED, never an operation — nothing is planned against it.
    expect(result.operations.map((operation) => operation.path)).toEqual(['packages/app/src/mine.ts']);
    expect(result.skipped).toEqual([
      { target: 'packages/app', path: 'packages/app/vendor/other-tpl/README.md', reason: 'OUTSIDE_BOUNDARY' },
    ]);
    expect(result.conflictPaths).toEqual([]);
  });

  // Appended to BOTH boundaries, so an additional exclusion root wins even
  // when the candidate newly claims the ground ENCLOSING it: dropping the
  // baseline's `vendor/` exclusion makes `vendor` ordinary eligible ground,
  // but the other template's origin folder inside it stays reserved.
  //
  // Note the deliberate distinction this pins: an applied TARGET nested in
  // newly-claimed ground DOES refuse `TARGET_CONFLICT` (the FEATURE requires
  // it, and `otherTemplateTargets` carries those). An origin FOLDER is not a
  // target — it is that template's source of truth, reserved ground the
  // upgrade must simply never write into.
  it('keeps an additional exclusion root reserved even when the candidate newly claims the ground enclosing it', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/a.ts': 'v1' }, ['vendor/']),
        candidate: payload({ 'src/a.ts': 'v1', 'vendor/other-tpl/theirs.ts': 'would-overwrite' }),
        additionalExclusionRoots: ['packages/app/vendor/other-tpl'],
        readDiskEntry: fakeReadDiskEntry({
          '/repo/packages/app/src/a.ts': fileEntry('v1'),
          '/repo/packages/app/vendor/other-tpl/theirs.ts': fileEntry('theirs'),
        }),
      }),
    );

    // The candidate WANTS to write into the other template's origin folder;
    // the additional exclusion root stops it dead, as SKIPPED rather than ADD.
    expect(result.skipped).toEqual([
      { target: 'packages/app', path: 'packages/app/vendor/other-tpl/theirs.ts', reason: 'OUTSIDE_BOUNDARY' },
    ]);
    expect(result.operations.map((operation) => operation.path)).toEqual(['packages/app/src/a.ts']);
    expect(result.conflictPaths).toEqual([]);
  });
  // Regression: a candidate that NARROWS an exclusion rather than dropping it
  // used to refuse the whole upgrade. Baseline excludes `vendor`, candidate
  // excludes `vendor/generated`; the root `vendor` is genuinely newly claimed
  // and resubmitted to the nesting check, but with an EMPTY exclusion list on
  // the claim, a target legitimately nested at `vendor/generated/lib` — ground
  // the candidate STILL excludes — was flagged. Availability bug: a correct
  // upgrade became impossible.
  it('does not refuse when the candidate merely NARROWS an exclusion and a nested target sits in the still-excluded part', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/a.ts': 'v1' }, ['vendor/']),
        candidate: payload({ 'src/a.ts': 'v1' }, ['vendor/generated/']),
        otherTemplateTargets: [
          { target: 'packages/app/vendor/generated/lib', templateName: 'other-tpl', excludedSubtrees: [] },
        ],
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/a.ts': fileEntry('v1') }),
      }),
    );

    expect(result.nestedConflicts).toEqual([]);
  });

  // The genuine case must still refuse: the candidate DROPS the exclusion
  // entirely, so another template's target now sits on ordinary eligible
  // ground. Asserted alongside the narrowing case so a fix to one cannot
  // silently disable the other.
  it('still refuses when the candidate DROPS an exclusion over ground another template\'s target occupies', async () => {
    const result = await classifyTarget(
      baseInput({
        baseline: payload({ 'src/a.ts': 'v1' }, ['vendor/']),
        candidate: payload({ 'src/a.ts': 'v1' }),
        otherTemplateTargets: [
          { target: 'packages/app/vendor/generated/lib', templateName: 'other-tpl', excludedSubtrees: [] },
        ],
        readDiskEntry: fakeReadDiskEntry({ '/repo/packages/app/src/a.ts': fileEntry('v1') }),
      }),
    );

    expect(result.nestedConflicts).toEqual([{ target: 'packages/app/vendor/generated/lib', templateName: 'other-tpl' }]);
  });
});
