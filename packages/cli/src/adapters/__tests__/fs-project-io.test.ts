// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
// @cpt-algo:cpt-frontx-algo-composed-provenance-project-state-io:p1
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile, chmod, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFsListPayloadFilesFn,
  createFsResolveDeclaredExclusionFn,
  createFsReadFileFn,
  createFsReadProjectFileFn,
  createFsReadProjectStateFn,
  createFsWriteProjectStateFn,
  createFsListTargetFilesFn,
  firstNonDirectoryComponentOf,
  TargetNotDirectoryError,
  NotRegularFileError,
  UnreachablePathError,
  PathUnreadableError,
  ProjectStateUnreadableError,
} from '../fs-project-io';

function makeFifo(fifoPath: string): void {
  execFileSync('mkfifo', [fifoPath]);
}

// Real-fs coverage for the two adapters behind the content self-containment
// algorithm's seams: `ListPayloadFilesFn` (enumerates the whole candidate
// template directory in one call) and `ResolveDeclaredExclusionFn` (confirms
// a single declared `excludedSubtrees` entry resolves honestly, without
// enumerating it). Everything else in fs-project-io.ts is an existing,
// already-integration-tested thin wrapper (exercised end-to-end via
// cli.test.ts's fake-deps suite).
describe('createFsListPayloadFilesFn', () => {
  let templateDir: string;
  // A second root, outside the template, for the escaping-symlink cases.
  let outsideDir: string;
  // A directory whose permissions are stripped mid-test, restored in
  // `afterEach` so `rm(..., { recursive: true })` can still clean it up.
  let restrictedDir: string;

  afterEach(async () => {
    if (restrictedDir) await chmod(restrictedDir, 0o700).catch(() => {});
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    templateDir = '';
    outsideDir = '';
    restrictedDir = '';
  });

  async function makeTemplate(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-list-payload-'));
    templateDir = dir;
    return dir;
  }

  it('enumerates a root-level file with no leading slash', async () => {
    const dir = await makeTemplate();
    await writeFile(path.join(dir, 'package.json'), '{}');
    const listPayloadFiles = createFsListPayloadFilesFn();

    const files = await listPayloadFiles(dir);

    expect(files).toEqual(['package.json']);
  });

  it('walks the whole directory recursively, returning POSIX-relative paths with no leading slash', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', 'auth', 'src'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', 'auth', 'src', 'index.ts'), 'export {};');
    const listPayloadFiles = createFsListPayloadFilesFn();

    const files = await listPayloadFiles(dir);

    expect(files.sort()).toEqual(['packages/auth/package.json', 'packages/auth/src/index.ts']);
    // The bug this suite exists to catch: a leading "/" on every enumerated
    // path (`/package.json` instead of `package.json`) breaks every
    // downstream string-prefix comparison the content self-containment
    // algorithm makes against these paths.
    expect(files.every((f) => !f.startsWith('/'))).toBe(true);
  });

  it('never descends into node_modules', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', 'auth', 'node_modules', 'some-dep'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', 'auth', 'node_modules', 'some-dep', 'package.json'), '{}');
    const listPayloadFiles = createFsListPayloadFilesFn();

    const files = await listPayloadFiles(dir);

    expect(files).toEqual(['packages/auth/package.json']);
  });

  // Skipping every dot-prefixed entry would open a completeness hole in the
  // exact guard this branch adds - a carrier (`package.json`) nested under a
  // hidden directory would go uninspected. `node_modules` is the only
  // exclusion; a dot-prefixed directory is ordinary template content and is
  // walked.
  it('descends into a dot-prefixed directory found while walking, and includes files inside it', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'packages', '.turbo'), { recursive: true });
    await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
    await writeFile(path.join(dir, 'packages', '.turbo', 'cache.json'), '{}');
    const listPayloadFiles = createFsListPayloadFilesFn();

    const files = await listPayloadFiles(dir);

    expect(files.sort()).toEqual(['packages/.turbo/cache.json', 'packages/package.json']);
  });

  it('includes a dot-file directly (e.g. a template-shipped .gitignore) alongside ordinary files', async () => {
    const dir = await makeTemplate();
    await writeFile(path.join(dir, '.gitignore'), 'dist/\n');
    await writeFile(path.join(dir, 'package.json'), '{}');
    const listPayloadFiles = createFsListPayloadFilesFn();

    const files = await listPayloadFiles(dir);

    expect(files.sort()).toEqual(['.gitignore', 'package.json']);
  });

  it('inspects a carrier (package.json) nested under a dot-prefixed directory - the completeness hole this fix closes', async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, '.hidden-workspace'), { recursive: true });
    await writeFile(path.join(dir, '.hidden-workspace', 'package.json'), '{}');
    const listPayloadFiles = createFsListPayloadFilesFn();

    const files = await listPayloadFiles(dir);

    expect(files).toEqual(['.hidden-workspace/package.json']);
  });

  it("walks a subtree that is itself dot-prefixed (a template's own .frontx/ai bundle)", async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, '.frontx', 'ai', 'my-tpl'), { recursive: true });
    await writeFile(path.join(dir, '.frontx', 'ai', 'my-tpl', 'manifest.json'), '{}');
    const listPayloadFiles = createFsListPayloadFilesFn();

    const files = await listPayloadFiles(dir);

    expect(files).toEqual(['.frontx/ai/my-tpl/manifest.json']);
  });

  it('throws, naming the path, when templateDir itself cannot be resolved', async () => {
    const listPayloadFiles = createFsListPayloadFilesFn();

    await expect(listPayloadFiles('/definitely/does/not/exist/frontx-fixture')).rejects.toThrow(
      '/definitely/does/not/exist/frontx-fixture',
    );
  });

  it('throws, naming the path, when the OS refuses to read a directory mid-walk (a check that could not look must never report the outcome of having looked)', async () => {
    const dir = await makeTemplate();
    restrictedDir = path.join(dir, 'restricted');
    await mkdir(restrictedDir);
    await writeFile(path.join(restrictedDir, 'package.json'), '{}');
    // No read/execute permission: `readdirSync` on this directory throws
    // EACCES. Running as root would bypass this, but the sandbox this suite
    // runs in does not.
    await chmod(restrictedDir, 0o000);
    const listPayloadFiles = createFsListPayloadFilesFn();

    await expect(listPayloadFiles(dir)).rejects.toThrow(dir);
  });

  describe('symlinks', () => {
    // A symlinked carrier is the whole point of the fix: this file WOULD have
    // been dropped from the enumeration, so its `file:` specifiers were never
    // checked for containment.
    it('includes a symlinked carrier file, resolving the link rather than skipping it', async () => {
      const dir = await makeTemplate();
      await mkdir(path.join(dir, 'packages', 'real'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'real', 'package.json'), '{}');
      await symlink(
        path.join(dir, 'packages', 'real', 'package.json'),
        path.join(dir, 'packages', 'package.json'),
      );
      const listPayloadFiles = createFsListPayloadFilesFn();

      const files = await listPayloadFiles(dir);

      expect(files.sort()).toEqual(['packages/package.json', 'packages/real/package.json']);
    });

    it('descends through a symlinked directory that stays inside the template', async () => {
      const dir = await makeTemplate();
      // `real-workspace` sits OUTSIDE `packages` on purpose: the payload-root
      // enumeration walks the whole template directory in one call, so its
      // own content is enumerated directly, in addition to being reachable
      // a second time through the symlink at `packages/linked`.
      await mkdir(path.join(dir, 'real-workspace'), { recursive: true });
      await writeFile(path.join(dir, 'real-workspace', 'package.json'), '{}');
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await symlink(path.join(dir, 'real-workspace'), path.join(dir, 'packages', 'linked'));
      const listPayloadFiles = createFsListPayloadFilesFn();

      const files = await listPayloadFiles(dir);

      expect(files.sort()).toEqual(['packages/linked/package.json', 'real-workspace/package.json']);
    });

    // A link out of the template is the escape the whole check exists to catch.
    // Walking into it would report files that are not the template's content as
    // if they were.
    it('does NOT descend when a symlinked directory resolves outside the template', async () => {
      const dir = await makeTemplate();
      outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-outside-'));
      await writeFile(path.join(outsideDir, 'package.json'), '{}');
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
      await symlink(outsideDir, path.join(dir, 'packages', 'escaping'));
      const listPayloadFiles = createFsListPayloadFilesFn();

      const files = await listPayloadFiles(dir);

      expect(files).toEqual(['packages/package.json']);
    });

    it('does NOT include a symlinked file that resolves outside the template', async () => {
      const dir = await makeTemplate();
      outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-outside-'));
      await writeFile(path.join(outsideDir, 'package.json'), '{}');
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await symlink(path.join(outsideDir, 'package.json'), path.join(dir, 'packages', 'package.json'));
      const listPayloadFiles = createFsListPayloadFilesFn();

      const files = await listPayloadFiles(dir);

      expect(files).toEqual([]);
    });

    it('skips a broken symlink instead of throwing', async () => {
      const dir = await makeTemplate();
      await mkdir(path.join(dir, 'packages'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'package.json'), '{}');
      await symlink(path.join(dir, 'packages', 'gone'), path.join(dir, 'packages', 'dangling'));
      const listPayloadFiles = createFsListPayloadFilesFn();

      const files = await listPayloadFiles(dir);

      expect(files).toEqual(['packages/package.json']);
    });

    // Only a symlink can make this walk cycle; without the visited-set the
    // link back to an ancestor recurses until the stack blows.
    it('terminates on a symlink cycle back to an ancestor directory', async () => {
      const dir = await makeTemplate();
      await mkdir(path.join(dir, 'packages', 'auth'), { recursive: true });
      await writeFile(path.join(dir, 'packages', 'auth', 'package.json'), '{}');
      await symlink(path.join(dir, 'packages'), path.join(dir, 'packages', 'auth', 'loop'));
      const listPayloadFiles = createFsListPayloadFilesFn();

      const files = await listPayloadFiles(dir);

      expect(files).toEqual(['packages/auth/package.json']);
    });
  });
});

describe('createFsResolveDeclaredExclusionFn', () => {
  let templateDir: string;
  let outsideDir: string;
  let restrictedDir: string;

  afterEach(async () => {
    if (restrictedDir) await chmod(restrictedDir, 0o700).catch(() => {});
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
    if (outsideDir) await rm(outsideDir, { recursive: true, force: true });
    templateDir = '';
    outsideDir = '';
    restrictedDir = '';
  });

  async function makeTemplate(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-resolve-exclusion-'));
    templateDir = dir;
    return dir;
  }

  // The ORDINARY case: the manifest is authored before any target is known,
  // so a declared excludedSubtrees entry normally does not exist yet.
  it("returns 'ABSENT' when nothing exists at the declared path", async () => {
    const dir = await makeTemplate();
    const resolveDeclaredExclusion = createFsResolveDeclaredExclusionFn();

    const result = await resolveDeclaredExclusion(dir, 'never-created/');

    expect(result).toBe('ABSENT');
  });

  it("returns 'ABSENT' when an ancestor segment of the declared path does not exist either", async () => {
    const dir = await makeTemplate();
    const resolveDeclaredExclusion = createFsResolveDeclaredExclusionFn();

    const result = await resolveDeclaredExclusion(dir, 'nested/deeper/still-absent/');

    expect(result).toBe('ABSENT');
  });

  it("returns 'RESOLVED' when the declared path exists as a real directory inside the template", async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'vendor'), { recursive: true });
    const resolveDeclaredExclusion = createFsResolveDeclaredExclusionFn();

    const result = await resolveDeclaredExclusion(dir, 'vendor/');

    expect(result).toBe('RESOLVED');
  });

  it("returns 'RESOLVED' when the declared path exists as a symlinked directory that stays inside the template", async () => {
    const dir = await makeTemplate();
    await mkdir(path.join(dir, 'real-vendor'), { recursive: true });
    await symlink(path.join(dir, 'real-vendor'), path.join(dir, 'vendor'));
    const resolveDeclaredExclusion = createFsResolveDeclaredExclusionFn();

    const result = await resolveDeclaredExclusion(dir, 'vendor/');

    expect(result).toBe('RESOLVED');
  });

  // `existsSync` FOLLOWS a symlink, so a broken one would read as absent and
  // the AC that demands a FAIL for it would silently pass; `lstatSync`
  // reports the link itself, so this is distinguishable from genuine absence.
  it('throws, naming the path, when the declared entry is a broken symlink', async () => {
    const dir = await makeTemplate();
    await symlink(path.join(dir, 'gone-target'), path.join(dir, 'vendor'));
    const resolveDeclaredExclusion = createFsResolveDeclaredExclusionFn();

    await expect(resolveDeclaredExclusion(dir, 'vendor/')).rejects.toThrow('vendor/');
  });

  it('throws, naming the path, when the declared entry is a symlink resolving outside the template root', async () => {
    const dir = await makeTemplate();
    outsideDir = await mkdtemp(path.join(tmpdir(), 'frontx-outside-'));
    await symlink(outsideDir, path.join(dir, 'vendor'));
    const resolveDeclaredExclusion = createFsResolveDeclaredExclusionFn();

    await expect(resolveDeclaredExclusion(dir, 'vendor/')).rejects.toThrow('resolves outside the template root');
  });

  it('throws, naming the path, when the OS refuses to inspect the declared entry', async () => {
    const dir = await makeTemplate();
    restrictedDir = path.join(dir, 'restricted');
    await mkdir(restrictedDir);
    await mkdir(path.join(restrictedDir, 'vendor'));
    // No execute permission on the parent: `lstatSync` on the child throws
    // EACCES rather than ENOENT, so this must not be read as merely absent.
    await chmod(restrictedDir, 0o000);
    const resolveDeclaredExclusion = createFsResolveDeclaredExclusionFn();

    await expect(resolveDeclaredExclusion(dir, 'restricted/vendor/')).rejects.toThrow('restricted/vendor/');
  });
});

// Real-fs coverage for the project state store's real adapter
// (`cpt-frontx-algo-composed-provenance-project-state-io`,
// `inst-psio-write-atomic`) — the pure logic in `project-state/io.ts` is
// covered against fakes in `project-state/__tests__/io.test.ts`; this suite
// proves the REAL temp-file-then-rename write against a real filesystem,
// per this file's own existing convention above.
// Real-fs coverage for the three-way distinction `resolvePathKind` now makes
// for every non-absent read failure: `NotRegularFileError` (the leaf itself
// is reachable and stands in the wrong shape), `UnreachablePathError` (a
// component ABOVE the leaf is not a directory, so the leaf was never
// reached at all), and `PathUnreadableError` (the leaf resolves to the right
// shape but the OS refuses to open it). Before this, only `ENOENT` was
// mapped to a clean answer; every other `lstat` failure — most concretely an
// ancestor that is not a directory — was rethrown raw, reaching a caller as
// an unstructured internal error instead of a typed refusal.
describe('createFsReadFileFn', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function makeRoot(): Promise<string> {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-read-file-'));
    return root;
  }

  it('throws an ENOENT-shaped error for an absent path', async () => {
    const dir = await makeRoot();
    const readFile = createFsReadFileFn();

    await expect(readFile(path.join(dir, 'missing.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns the content of a regular file', async () => {
    const dir = await makeRoot();
    const filePath = path.join(dir, 'manifest.json');
    await writeFile(filePath, '{"name":"widget"}', 'utf-8');
    const readFile = createFsReadFileFn();

    await expect(readFile(filePath)).resolves.toBe('{"name":"widget"}');
  });

  it('throws NotRegularFileError, rather than hanging, when the path is a FIFO', async () => {
    const dir = await makeRoot();
    const fifoPath = path.join(dir, 'frontx-template.json');
    makeFifo(fifoPath);
    const readFile = createFsReadFileFn();

    await expect(readFile(fifoPath)).rejects.toBeInstanceOf(NotRegularFileError);
    await expect(readFile(fifoPath)).rejects.toMatchObject({ kind: 'fifo', filePath: fifoPath });
  });

  it('throws NotRegularFileError when a directory stands where the file is expected', async () => {
    const dir = await makeRoot();
    const dirPath = path.join(dir, 'frontx-template.json');
    await mkdir(dirPath);
    const readFile = createFsReadFileFn();

    await expect(readFile(dirPath)).rejects.toMatchObject({ kind: 'directory' });
  });

  it('throws NotRegularFileError for a dangling symlink', async () => {
    const dir = await makeRoot();
    const linkPath = path.join(dir, 'frontx-template.json');
    await symlink(path.join(dir, 'does-not-exist'), linkPath);
    const readFile = createFsReadFileFn();

    await expect(readFile(linkPath)).rejects.toMatchObject({ kind: 'dangling-symlink' });
  });

  // The regression this pins: `.frontx` (or any ancestor) replaced by an
  // ordinary file makes `lstat` on the path beneath it fail `ENOTDIR`, not
  // `ENOENT` — before this fix, `resolvePathKind` rethrew that raw, which
  // reached the CLI's own top-level catch as an unstructured internal error
  // (empty stdout under `--json`) rather than a typed, reportable refusal.
  it('throws UnreachablePathError naming the blocking ancestor when a component above the path is not a directory', async () => {
    const dir = await makeRoot();
    const blockingFile = path.join(dir, 'frontx-template.json');
    await writeFile(blockingFile, 'NOT-A-DIR', 'utf-8');
    const readFile = createFsReadFileFn();
    const unreachable = path.join(blockingFile, 'nested', 'deeper.json');

    await expect(readFile(unreachable)).rejects.toBeInstanceOf(UnreachablePathError);
    await expect(readFile(unreachable)).rejects.toMatchObject({ blockingAncestor: blockingFile });
  });

  it('throws PathUnreadableError for a regular file the probe accepts but cannot open (chmod 000)', async () => {
    const dir = await makeRoot();
    const filePath = path.join(dir, 'frontx-template.json');
    await writeFile(filePath, '{"name":"widget"}', 'utf-8');
    await chmod(filePath, 0o000);
    const readFile = createFsReadFileFn();

    try {
      await expect(readFile(filePath)).rejects.toBeInstanceOf(PathUnreadableError);
      await expect(readFile(filePath)).rejects.toMatchObject({ errnoCode: 'EACCES' });
    } finally {
      await chmod(filePath, 0o644); // restore so afterEach's rm can clean up
    }
  });
});

describe('createFsReadProjectFileFn', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function makeRoot(): Promise<string> {
    root = await mkdtemp(path.join(tmpdir(), 'frontx-read-project-file-'));
    return root;
  }

  it('returns null for an absent path', async () => {
    const dir = await makeRoot();
    const readProjectFile = createFsReadProjectFileFn();

    await expect(readProjectFile(path.join(dir, 'scratch.json'))).resolves.toBeNull();
  });

  it('returns null when a directory stands where the file is expected (this seam\'s own documented collapse)', async () => {
    const dir = await makeRoot();
    const dirPath = path.join(dir, 'scratch.json');
    await mkdir(dirPath);
    const readProjectFile = createFsReadProjectFileFn();

    await expect(readProjectFile(dirPath)).resolves.toBeNull();
  });

  it('throws NotRegularFileError, rather than hanging, when the path is a FIFO', async () => {
    const dir = await makeRoot();
    const fifoPath = path.join(dir, 'scratch.json');
    makeFifo(fifoPath);
    const readProjectFile = createFsReadProjectFileFn();

    await expect(readProjectFile(fifoPath)).rejects.toMatchObject({ kind: 'fifo' });
  });
});

describe('createFsReadProjectStateFn / createFsWriteProjectStateFn', () => {
  let repoDir: string;

  afterEach(async () => {
    if (repoDir) await rm(repoDir, { recursive: true, force: true });
    repoDir = '';
  });

  async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-project-state-'));
    repoDir = dir;
    return dir;
  }

  it('createFsReadProjectStateFn returns null when the document does not exist', async () => {
    const dir = await makeRepo();
    const readProjectState = createFsReadProjectStateFn();

    const result = await readProjectState(path.join(dir, '.frontx', 'project.json'));

    expect(result).toBeNull();
  });

  // Every one of this module's three read-side refusals is wrapped into ONE
  // `ProjectStateUnreadableError` for this document specifically — never left
  // to fall through to the generic per-refusal handling every OTHER content
  // read gets — so `PROJECT_INVALID` is the single code every way this
  // document can be unusable reports, matching the code already used when
  // the document is present but malformed (`project-state/io.ts`'s own
  // `parseProjectStateDocument` failure), rather than the previously
  // undocumented `CONTENT_CONFLICT` a bare `NotRegularFileError` collapsed
  // into at the CLI's own top-level catch.
  it('wraps a FIFO at the document path in ProjectStateUnreadableError (never hangs)', async () => {
    const dir = await makeRepo();
    const location = path.join(dir, '.frontx', 'project.json');
    await mkdir(path.dirname(location), { recursive: true });
    makeFifo(location);
    const readProjectState = createFsReadProjectStateFn();

    await expect(readProjectState(location)).rejects.toBeInstanceOf(ProjectStateUnreadableError);
    try {
      await readProjectState(location);
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectStateUnreadableError);
      expect((error as ProjectStateUnreadableError).underlying).toBeInstanceOf(NotRegularFileError);
    }
  });

  // The exact regression `.frontx` being a plain file (not a directory)
  // caused for `list`/`register`/`validate --project`: this document's own
  // path could never be reached, and the raw `ENOTDIR` used to escape as an
  // unstructured internal error with an empty `--json` stdout.
  it('wraps an ENOTDIR ancestor (.frontx replaced by a file) in ProjectStateUnreadableError', async () => {
    const dir = await makeRepo();
    const frontxPath = path.join(dir, '.frontx');
    await writeFile(frontxPath, 'NOT-A-DIR', 'utf-8');
    const location = path.join(frontxPath, 'project.json');
    const readProjectState = createFsReadProjectStateFn();

    await expect(readProjectState(location)).rejects.toBeInstanceOf(ProjectStateUnreadableError);
    try {
      await readProjectState(location);
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectStateUnreadableError);
      expect((error as ProjectStateUnreadableError).underlying).toBeInstanceOf(UnreachablePathError);
    }
  });

  it('wraps a permission refusal (chmod 000) in ProjectStateUnreadableError', async () => {
    const dir = await makeRepo();
    const location = path.join(dir, '.frontx', 'project.json');
    await mkdir(path.dirname(location), { recursive: true });
    await writeFile(location, JSON.stringify({ formatVersion: 1, templates: {}, projectOwnedRoots: [] }), 'utf-8');
    await chmod(location, 0o000);
    const readProjectState = createFsReadProjectStateFn();

    try {
      await expect(readProjectState(location)).rejects.toBeInstanceOf(ProjectStateUnreadableError);
      try {
        await readProjectState(location);
      } catch (error) {
        expect((error as ProjectStateUnreadableError).underlying).toBeInstanceOf(PathUnreadableError);
      }
    } finally {
      await chmod(location, 0o644); // restore so afterEach's rm can clean up
    }
  });

  it('round-trips a write through a real rename and back through a real read', async () => {
    const dir = await makeRepo();
    const location = path.join(dir, '.frontx', 'project.json');
    const writeProjectState = createFsWriteProjectStateFn();
    const readProjectState = createFsReadProjectStateFn();
    const content = JSON.stringify({ formatVersion: 1, templates: {}, projectOwnedRoots: ['docs'] });

    await writeProjectState(location, content);
    const readBack = await readProjectState(location);

    expect(readBack).toBe(content);
    // No leftover `.tmp` scratch file survives a successful write.
    const entries = await readdir(path.join(dir, '.frontx'));
    expect(entries).toEqual(['project.json']);
  });

  it('a second write replaces the first document atomically (temp file created beside it, then renamed over it)', async () => {
    const dir = await makeRepo();
    const location = path.join(dir, '.frontx', 'project.json');
    const writeProjectState = createFsWriteProjectStateFn();
    const readProjectState = createFsReadProjectStateFn();

    await writeProjectState(location, JSON.stringify({ formatVersion: 1, templates: {}, projectOwnedRoots: [] }));
    await writeProjectState(
      location,
      JSON.stringify({ formatVersion: 1, templates: {}, projectOwnedRoots: ['scripts'] }),
    );

    const readBack = await readProjectState(location);
    expect(JSON.parse(readBack ?? 'null')).toEqual({ formatVersion: 1, templates: {}, projectOwnedRoots: ['scripts'] });
  });

  // The AC this proves against a REAL filesystem: "A simulated interrupted
  // write ... leaves the repository holding the prior valid document, never
  // a partially-written or partially-merged one." `renameSync` is stubbed to
  // throw AFTER the real temp file has actually been written to disk (the
  // real interruption point the AC describes — after the temp path is
  // constructed and its content written, but before the publish rename
  // completes), so this proves the destination is untouched by an
  // interruption at exactly that point, not merely by a fake that never
  // touches disk at all.
  it('an interruption after the temp file is written but before rename leaves the prior document intact', async () => {
    const dir = await makeRepo();
    const location = path.join(dir, '.frontx', 'project.json');
    const writeProjectState = createFsWriteProjectStateFn();
    const readProjectState = createFsReadProjectStateFn();
    const priorContent = JSON.stringify({ formatVersion: 1, templates: {}, projectOwnedRoots: [] });
    await writeProjectState(location, priorContent);

    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('simulated interruption before rename completes');
    });
    try {
      await expect(
        writeProjectState(location, JSON.stringify({ formatVersion: 1, templates: {}, projectOwnedRoots: ['scripts'] })),
      ).rejects.toThrow('simulated interruption before rename completes');
    } finally {
      renameSpy.mockRestore();
    }

    // The destination still holds the PRIOR valid document, byte-for-byte.
    const readBack = await readProjectState(location);
    expect(readBack).toBe(priorContent);
    // The orphaned temp file is left behind (never cleaned up on this
    // failure path, which the spec does not require), proving the write
    // actually reached disk before the simulated interruption rather than
    // failing before ever touching the filesystem.
    const entries = await readdir(path.join(dir, '.frontx'));
    expect(entries.some((name) => name !== 'project.json' && name.endsWith('.tmp'))).toBe(true);
    const orphan = entries.find((name) => name.endsWith('.tmp'));
    expect(orphan).toBeDefined();
    if (orphan) {
      const orphanContent = await readFile(path.join(dir, '.frontx', orphan), 'utf-8');
      expect(JSON.parse(orphanContent)).toEqual({ formatVersion: 1, templates: {}, projectOwnedRoots: ['scripts'] });
    }
  });
});

// Real-fs coverage for `createFsListTargetFilesFn` — the delete-plan
// algorithm's target enumeration seam. A registered, applied target's own
// on-disk location replaced by an ordinary file (or any other non-directory
// entry) since it was applied must throw the typed `TargetNotDirectoryError`
// rather than either a bare `ENOTDIR` (what `fs.readdirSync` throws
// unprompted) or resolving to `[]` (indistinguishable from a genuinely empty,
// still-a-directory target) — `commands/delete.ts` depends on the typed
// class to report this as a structured refusal instead of letting a bare
// filesystem error reach the CLI's own top-level catch with no JSON envelope.
describe('createFsListTargetFilesFn', () => {
  let repoRoot: string;

  afterEach(async () => {
    if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
    repoRoot = '';
  });

  async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontx-list-target-files-'));
    repoRoot = dir;
    return dir;
  }

  it('enumerates real files under an ordinary target directory, unchanged', async () => {
    const dir = await makeRepo();
    await mkdir(path.join(dir, 'app'), { recursive: true });
    await writeFile(path.join(dir, 'app', 'a.txt'), 'a', 'utf-8');
    const listTargetFiles = createFsListTargetFilesFn();

    const files = await listTargetFiles(path.join(dir, 'app'));

    expect(files).toEqual(['a.txt']);
  });

  it('resolves to [] when the target does not exist at all, unchanged', async () => {
    const dir = await makeRepo();
    const listTargetFiles = createFsListTargetFilesFn();

    const files = await listTargetFiles(path.join(dir, 'never-created'));

    expect(files).toEqual([]);
  });

  // The same fact one component higher up. `realpathSync` refuses both a
  // genuinely absent path and one blocked by a non-directory ancestor, and
  // conflating them would let a deletion report success, remove nothing, and
  // strike the target from the record without ever having looked at its
  // ground.
  it('throws TargetNotDirectoryError, naming the blocking ancestor, when a component ABOVE the target is a regular file', async () => {
    const dir = await makeRepo();
    await writeFile(path.join(dir, 'parent'), 'FILE-ABOVE-TARGET', 'utf-8');
    const listTargetFiles = createFsListTargetFilesFn();

    await expect(listTargetFiles(path.join(dir, 'parent', 'child'))).rejects.toBeInstanceOf(TargetNotDirectoryError);
    await expect(listTargetFiles(path.join(dir, 'parent', 'child'))).rejects.toThrow(/parent/);
  });

  it('still resolves to [] when only a MISSING directory stands between the repo and the target', async () => {
    const dir = await makeRepo();
    const listTargetFiles = createFsListTargetFilesFn();

    // Nothing on this path exists: ground a developer removed by hand is an
    // ordinary empty enumeration, not a refusal.
    await expect(listTargetFiles(path.join(dir, 'gone', 'child'))).resolves.toEqual([]);
  });

  it('throws TargetNotDirectoryError, naming the path, when the target has been replaced by a regular file', async () => {
    const dir = await makeRepo();
    await writeFile(path.join(dir, 'dst'), 'PROTECTED-TARGET-FILE', 'utf-8');
    const listTargetFiles = createFsListTargetFilesFn();
    const targetPath = path.join(dir, 'dst');

    await expect(listTargetFiles(targetPath)).rejects.toThrow(TargetNotDirectoryError);
    try {
      await listTargetFiles(targetPath);
      expect.unreachable('expected TargetNotDirectoryError');
    } catch (error) {
      expect(error).toBeInstanceOf(TargetNotDirectoryError);
      if (error instanceof TargetNotDirectoryError) {
        expect(error.targetPath).toBe(targetPath);
      }
    }
  });
});

// DEFECT 1 (regression): `firstNonDirectoryComponentOf` decided with
// `lstatSync(...).isDirectory()`, so a symlink resolving to a perfectly good
// directory counted as "exists and is not a directory" — on macOS `/tmp`
// itself is exactly this shape (a symlink to `/private/tmp`), so every path
// reached through it (an inventory root, an ancestor of a project) was
// refused for a directory chain `mkdir -p` would have built through it
// without complaint. The fix follows a symlink ancestor through to what it
// actually resolves to, rather than judging the link's own `lstat` kind
// (never `isDirectory()`), while still reporting a genuine blocker by its
// OWN position — never by whatever it happens to alias.
describe('firstNonDirectoryComponentOf', () => {
  let base: string;

  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
    base = '';
  });

  async function makeBase(): Promise<string> {
    base = await mkdtemp(path.join(tmpdir(), 'frontx-first-non-dir-'));
    return base;
  }

  // The exact `/tmp` shape from the live repro, built with a REAL symlink in
  // a temp tree rather than depending on `/tmp` itself being one on the host
  // running this suite.
  it('is not a blocker for a symlinked ancestor that resolves to a real directory (the `/tmp` shape)', async () => {
    const dir = await makeBase();
    const realDir = path.join(dir, 'real');
    await mkdir(realDir, { recursive: true });
    const linkedAncestor = path.join(dir, 'linked');
    await symlink(realDir, linkedAncestor);
    // Nothing below the linked ancestor exists yet — the ordinary shape of
    // a fresh inventory root reached through a symlinked ancestor.
    const target = path.join(linkedAncestor, 'frontx-store', '@x', 'inv');

    expect(firstNonDirectoryComponentOf(target)).toBeNull();
  });

  it('reports the symlink itself as the blocker when it resolves to a regular file, never the file it aliases', async () => {
    const dir = await makeBase();
    const realFile = path.join(dir, 'real-file.txt');
    await writeFile(realFile, 'not a directory', 'utf-8');
    const linkedAncestor = path.join(dir, 'linked');
    await symlink(realFile, linkedAncestor);
    const target = path.join(linkedAncestor, 'nested', 'deeper');

    expect(firstNonDirectoryComponentOf(target)).toBe(linkedAncestor);
  });

  it('reports the symlink itself as the blocker when it is dangling', async () => {
    const dir = await makeBase();
    const linkedAncestor = path.join(dir, 'linked');
    await symlink(path.join(dir, 'does-not-exist'), linkedAncestor);
    const target = path.join(linkedAncestor, 'nested', 'deeper');

    expect(firstNonDirectoryComponentOf(target)).toBe(linkedAncestor);
  });

  it('reports an ordinary regular file as the blocker', async () => {
    const dir = await makeBase();
    const blockingFile = path.join(dir, 'blocking-file');
    await writeFile(blockingFile, 'not a directory', 'utf-8');
    const target = path.join(blockingFile, 'nested', 'deeper');

    expect(firstNonDirectoryComponentOf(target)).toBe(blockingFile);
  });

  it('reports a FIFO as the blocker', async () => {
    const dir = await makeBase();
    const fifoPath = path.join(dir, 'blocking-fifo');
    makeFifo(fifoPath);
    const target = path.join(fifoPath, 'nested', 'deeper');

    expect(firstNonDirectoryComponentOf(target)).toBe(fifoPath);
  });

  it('returns null when nothing exists at all along the path', async () => {
    const dir = await makeBase();

    expect(firstNonDirectoryComponentOf(path.join(dir, 'never', 'created'))).toBeNull();
  });

  it('returns null when the path itself already exists as an ordinary directory', async () => {
    const dir = await makeBase();
    const realDir = path.join(dir, 'already-a-directory');
    await mkdir(realDir);

    expect(firstNonDirectoryComponentOf(realDir)).toBeNull();
  });
});
