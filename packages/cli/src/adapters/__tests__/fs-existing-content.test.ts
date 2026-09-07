// Real-fs coverage for symlink classification in the directory walk:
// `adapters/fs-existing-content.ts`'s directory walk must not classify
// entries with `isDirectory()`/`isFile()` alone, under which a symlink
// dirent is neither — so a symlink already standing at a TARGET path would
// otherwise be skipped entirely, invisible to `reconcileExistingContent`.
// This suite proves, against a real filesystem
// (a fake `ReadExistingContentFn` cannot honestly model a real symlink):
//
//   1. `createFsReadExistingContentFn` now reports a symlink as an existing
//      entry rather than dropping it.
//   2. `createFsReadInstalledContentFn` (the sibling walk, reading a
//      TEMPLATE's own payload — a different data source, not this fix's
//      target) still skips a symlink outright, unchanged.
//   3. `reconcileExistingContent` (the pure logic this walker feeds) lands a
//      symlink at a declared payload path in `contentConflicts`, and a
//      symlink NOT declared by the payload in `additionalPaths` — never in
//      `identicalFiles` — closing the hole that let `apply --adopt-existing`
//      write straight through an aliasing symlink.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsReadExistingContentFn, createFsReadInstalledContentFn } from '../fs-existing-content';
import { reconcileExistingContent, DIRECTORY_CONTENT_MARKER, SPECIAL_CONTENT_MARKER } from '../../scaffold/existing-content';

// `mkfifo` has no Node.js API — shelled out to the real command, present on
// every POSIX platform this package targets (macOS/Linux CI). Windows is not
// this suite's concern (a FIFO is a POSIX concept).
function makeFifo(absolutePath: string): void {
  execFileSync('mkfifo', [absolutePath]);
}

describe('createFsReadExistingContentFn (symlinks)', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-existing-content-'));
    repoRoot = dir;
    return dir;
  }

  it('reports a symlink inside the target as an existing entry, rather than skipping it', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'shared'), { recursive: true });
    await writeFile(path.join(dir, 'shared', 'precious.txt'), 'PRECIOUS-CONTENT', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'shared', 'precious.txt'), path.join(dir, 'app', 'config.json'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    expect(items.map((item) => item.path)).toContain('app/config.json');
  });

  it('reports the same content for a symlink across two separate reads when nothing about it changed', async () => {
    // `commands/apply.ts`'s own adopted-path snapshot-then-reread
    // verification depends on this: a stable read of unchanged on-disk state
    // must not itself look like corruption.
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'shared'), { recursive: true });
    await writeFile(path.join(dir, 'shared', 'precious.txt'), 'PRECIOUS-CONTENT', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'shared', 'precious.txt'), path.join(dir, 'app', 'config.json'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const first = await readExistingContent('app');
    const second = await readExistingContent('app');

    const firstItem = first.find((item) => item.path === 'app/config.json');
    const secondItem = second.find((item) => item.path === 'app/config.json');
    expect(firstItem).toBeDefined();
    expect(secondItem).toBeDefined();
    expect(firstItem?.content).toBe(secondItem?.content);
  });

  it('never reports the symlink content as identical to any plausible payload text', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'shared'), { recursive: true });
    // The aliased file's content happens to be exactly what a payload might
    // legitimately author too — a symlink still must never be treated as
    // "identical", because its on-disk shape (a link) can never honestly be
    // compared against a payload's declared text content at all (matching
    // the sibling upgrade engine's ADR-0021 precedent for the same class of
    // ground).
    await writeFile(path.join(dir, 'shared', 'precious.txt'), 'TEMPLATE-CONTENT', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'shared', 'precious.txt'), path.join(dir, 'app', 'config.json'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    const item = items.find((i) => i.path === 'app/config.json');
    expect(item?.content).not.toBe('TEMPLATE-CONTENT');
  });

  it('does not descend into a symlinked directory (reports only the link itself)', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'real-dir'), { recursive: true });
    await writeFile(path.join(dir, 'real-dir', 'nested.txt'), 'nested', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'real-dir'), path.join(dir, 'app', 'linked'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    expect(items.map((item) => item.path)).toEqual(['app/linked']);
  });

  it('still enumerates an ordinary file normally alongside a symlink', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await writeFile(path.join(dir, 'app', 'ordinary.txt'), 'ordinary', 'utf-8');
    await symlink(path.join(dir, 'app', 'ordinary.txt'), path.join(dir, 'app', 'aliased.txt'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    const ordinary = items.find((item) => item.path === 'app/ordinary.txt');
    expect(ordinary?.content).toBe('ordinary');
    expect(items.map((item) => item.path).sort()).toEqual(['app/aliased.txt', 'app/ordinary.txt']);
  });

  it('reports a broken (dangling) symlink as an existing entry too, rather than skipping or throwing', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'app', 'never-created.txt'), path.join(dir, 'app', 'dangling.json'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    expect(items.map((item) => item.path)).toContain('app/dangling.json');
  });

  // A FIFO at a payload leaf position: the walk must report it with the
  // uncomparable marker, never read it — reading blocks forever waiting for
  // a writer/reader that never attaches, hanging the whole process with no
  // stdout, no stderr, and no exit. Proving the call RETURNS is the point of
  // this test: if the fix regressed, this test would time out rather than
  // fail cleanly.
  it('reports a FIFO inside the target as an uncomparable entry, and the call returns rather than hanging', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    makeFifo(path.join(dir, 'app', 'pipe'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    expect(items).toEqual([{ path: 'app/pipe', content: SPECIAL_CONTENT_MARKER }]);
  });

  // A FIFO standing exactly AT the target itself — `blockingComponentOf`'s
  // own concern, distinct from the walk above. Before this fix, a FIFO here
  // fell through to `fs.readFileSync`, which blocks identically.
  it('reports a FIFO standing at the target itself as the blocking component, and the call returns', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    makeFifo(path.join(dir, 'app', 'pipe'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app/pipe');

    expect(items).toEqual([{ path: 'app/pipe', content: SPECIAL_CONTENT_MARKER }]);
  });

  // DIRECTORY-AT-LEAF fix: a directory standing exactly where the payload
  // declares a FILE is otherwise invisible to reconciliation — the walk
  // recurses INTO a directory rather than reporting it at its own path, so
  // `existing.get(payloadPath)` reads as "nothing here yet" for a path that
  // is, in fact, occupied. Reported here alongside recursing into it (its
  // one real child file is still enumerated normally).
  it('reports a directory at its own path with the directory marker, alongside recursing into it', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app', 'README.md'), { recursive: true });
    await writeFile(path.join(dir, 'app', 'README.md', 'inner.txt'), 'nested', 'utf-8');
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    expect(items).toContainEqual({ path: 'app/README.md', content: DIRECTORY_CONTENT_MARKER });
    expect(items).toContainEqual({ path: 'app/README.md/inner.txt', content: 'nested' });
  });

  it('reports an EMPTY directory too, at its own path, producing no other entry beneath it', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app', 'README.md'), { recursive: true });
    const readExistingContent = createFsReadExistingContentFn(dir);

    const items = await readExistingContent('app');

    expect(items).toEqual([{ path: 'app/README.md', content: DIRECTORY_CONTENT_MARKER }]);
  });
});

describe('createFsReadInstalledContentFn (symlinks — unchanged by the fix)', () => {
  let templateDir: string;

  afterEach(async () => {
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
    templateDir = '';
  });

  async function makeTemplate(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-installed-content-'));
    templateDir = dir;
    return dir;
  }

  // A template's own installed content is a DIFFERENT data source (never
  // expected to be a symlink farm) — the SYMLINK-INVISIBLE FIX targets only
  // `readExistingContent` (the suite above); this walk keeps its
  // pre-existing behaviour, matching `adapters/fs-read-content-items.ts`'s
  // own simple scope.
  it('still skips a symlink in a template payload outright', async () => {
    const dir = await makeTemplate();
    await writeFile(path.join(dir, 'real.json'), '{}', 'utf-8');
    await symlink(path.join(dir, 'real.json'), path.join(dir, 'linked.json'));
    const readInstalledContent = createFsReadInstalledContentFn(dir);

    const items = await readInstalledContent('.');

    expect(items.map((item) => item.path)).toEqual(['real.json']);
  });

  // A template's payload directory structure and any special files it might
  // ship are not this fix's target either — `readInstalledContent` keeps its
  // pre-existing behaviour of reporting only real files, never a directory's
  // own path and never a FIFO/socket/device.
  it('still reports only real files, never a directory marker, for a template payload', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'sub'), { recursive: true });
    await writeFile(path.join(dir, 'sub', 'a.txt'), 'a', 'utf-8');
    const readInstalledContent = createFsReadInstalledContentFn(dir);

    const items = await readInstalledContent('.');

    expect(items).toEqual([{ path: 'sub/a.txt', content: 'a' }]);
  });
});

describe('reconcileExistingContent with the real existing-content walker (symlinks)', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-reconcile-symlink-'));
    repoRoot = dir;
    return dir;
  }

  it('lands a symlink at a DECLARED payload path in contentConflicts, never identicalFiles', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'shared'), { recursive: true });
    await writeFile(path.join(dir, 'shared', 'precious.txt'), 'PRECIOUS-CONTENT', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    // The reproduced defect's exact shape: the payload declares
    // "config.json", and a symlink already sits there aliasing a different
    // real file.
    await symlink(path.join(dir, 'shared', 'precious.txt'), path.join(dir, 'app', 'config.json'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const partitions = await reconcileExistingContent({
      target: 'app',
      exclusionRoots: [],
      installedContentPath: 'template',
      readInstalledContent: async () => [{ path: 'config.json', content: 'TEMPLATE-CONTENT' }],
      readExistingContent,
    });

    expect(partitions.contentConflicts).toEqual(['app/config.json']);
    expect(partitions.identicalFiles).toEqual([]);
    expect(partitions.additionalPaths).toEqual([]);
  });

  it('lands a symlink at a path the payload does NOT declare in additionalPaths', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'shared'), { recursive: true });
    await writeFile(path.join(dir, 'shared', 'precious.txt'), 'PRECIOUS-CONTENT', 'utf-8');
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await symlink(path.join(dir, 'shared', 'precious.txt'), path.join(dir, 'app', 'undeclared.json'));
    const readExistingContent = createFsReadExistingContentFn(dir);

    const partitions = await reconcileExistingContent({
      target: 'app',
      exclusionRoots: [],
      installedContentPath: 'template',
      readInstalledContent: async () => [{ path: 'config.json', content: 'TEMPLATE-CONTENT' }],
      readExistingContent,
    });

    expect(partitions.additionalPaths).toEqual(['app/undeclared.json']);
    expect(partitions.identicalFiles).toEqual([]);
    expect(partitions.contentConflicts).toEqual([]);
  });
});
