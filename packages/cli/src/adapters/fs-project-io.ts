// @cpt-dod:cpt-frontx-dod-composed-provenance-atomic-project-state:p1
// Generic filesystem IO glue, plugged into the command surface at the F18
// executable entrypoint (`cli.ts`). These are thin fs wrappers behind seams
// the scaffolding (F12 `WriteFileFn`), manifest (F11 `ReadFileFn`), and
// upgrade (F14 `ReadProjectFileFn`/`WriteProjectFileFn`/`RemoveProjectFileFn`)
// FEATUREs already define — no template-resolution/inventory/provenance
// logic lives here (that is Phase 9/10's `adapters/fs-*` and
// `adapters/provenance-io.ts` scope). Not pure IO plumbing throughout,
// though: `createFsListPayloadFilesFn` and `createFsResolveDeclaredExclusionFn`
// below refuse what they cannot honestly inspect, rather than reporting it
// as an empty list or a silent pass — see their doc comments.
//
// `createFsReadProjectStateFn`/`createFsWriteProjectStateFn` below are a
// THIRD, unrelated concern living in this same file: the real adapter for
// `cpt-frontx-feature-composed-provenance`'s single-document project state
// store (`.frontx/project.json`, `project-state/types.ts`). They are NEW
// functions rather than reuses of `createFsReadProjectFileFn`/
// `createFsWriteProjectFileFn` just above — those exist for the upgrade
// engine's own single scratch file and neither one performs the
// temp-file-then-rename discipline this store's write requires (both write
// directly with `fs.writeFileSync`, no interruption safety); this store's
// shape and the upgrade engine's are different concerns that happen to share
// only the general idea of "a project-relative file read/write", not the
// atomicity requirement.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AssertPathWithinRootFn, WriteFileFn } from '../scaffold/types';
import type { ListPayloadFilesFn, ResolveDeclaredExclusionFn, ReadFileFn } from '../manifest/types';
import type { ReadProjectFileFn, WriteProjectFileFn, RemoveProjectFileFn } from '../upgrade/types';
import type { ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ListTargetFilesFn, ListUnenumerableTargetEntriesFn } from '../scaffold/delete-plan';
import type { PathExistsFn } from '../resolver/types';

// `writeFile` below refuses to hand `destPath` straight to
// `fs.writeFileSync` when it already exists as a symlink. `fs.writeFileSync`
// follows a symlink at its FINAL path component exactly like it follows one
// at an intermediate component, so if `destPath` were itself an existing
// symlink aliasing a DIFFERENT on-disk file, writing through it would
// silently overwrite whatever the link pointed at — precisely what
// `--adopt-existing` promises never to touch. (`adapters/fs-existing-
// content.ts`'s own SYMLINK-INVISIBLE check lets reconciliation SEE and
// refuse this shape earlier, before it ever reaches this point.)
//
// This function is the last, narrowest place that promise can still be kept:
// it refuses outright when `destPath` already exists as a symlink, rather
// than replacing it. `adapters/fs-ai-bundle.ts`'s `createFsCopyBundleFn`
// replaces a symlink found at ITS destination instead — correct there
// because that destination (`.frontx/ai/<name>/`) is ground ADR 0031 already
// makes the CLI's own sole property, so nothing else is ever entitled to
// have placed a symlink there. A payload path materialized by THIS function
// is ordinary ground inside a developer's project, never CLI-owned — a
// symlink standing there may be the developer's own deliberate structure
// (see `fs-containment.test.ts`'s "a project may legitimately contain its
// own symlinks"), and this function has no way to tell that case apart from
// the aliasing risk above. Refusing is the only choice that cannot corrupt
// content on either side of that distinction.
//
// This check is orthogonal to `assertPathWithinProjectRoot`: that function
// (called separately, by `commands/apply.ts`, before this one) proves
// `destPath` itself resolves inside the project root, symlinks resolved — it
// says nothing about whether `destPath` ALREADY exists as a symlink, which
// is exactly the case an INTERNAL alias (the link's target is another file
// inside the same project) passes cleanly.
//
// Only the FINAL component is inspected here — an ANCESTOR directory
// component being a symlink is not this check's business, and is not
// closable at this seam: `writeFile` receives one absolute destination and
// no project root, so it has nowhere to stop walking up. That case is
// refused a whole phase earlier instead, by `scaffold/existing-content.ts`'s
// own DIRECTORY-SYMLINK check, which sees a symlinked directory standing
// between a target and a payload path and reports `CONTENT_CONFLICT` before
// materialization begins. Note what that means for a project deliberately
// structured through a symlinked directory (`app/src` -> `app/real-src`): a
// template is never applied through that link — the batch is refused,
// fail-closed, and the developer resolves the link. That is a deliberate
// behaviour, recorded in the FEATURE's own acceptance criteria, because the
// alternative is data loss: writing through a link the CLI cannot compare
// against, into content it never named.
function refuseIfDestinationIsSymlink(destPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(destPath);
  } catch (error) {
    if (isEnoent(error)) return; // ordinary case: nothing stands here yet
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new ExistingSymlinkDestinationError(destPath);
  }
}

/**
 * `destPath` already exists as a symlink, and a write was refused rather
 * than following it — see `refuseIfDestinationIsSymlink`'s own doc comment
 * for the full defect this guards against.
 */
export class ExistingSymlinkDestinationError extends Error {
  readonly destPath: string;

  constructor(destPath: string) {
    super(
      `Refusing to write "${destPath}": it already exists as a symlink, and writing through it could silently ` +
        'overwrite whatever it points at instead of leaving existing content untouched.',
    );
    this.name = 'ExistingSymlinkDestinationError';
    this.destPath = destPath;
  }
}

/**
 * Real `WriteFileFn` — writes a destination file, creating parent dirs.
 *
 * Creates the destination's parent via `resolveWriteParentDir`, never a
 * literal `fs.mkdirSync(path.dirname(destPath), ...)` — matching
 * `createFsWriteProjectStateFn` and every writer in `fs-upgrade-io.ts`. A
 * dangling symlink whose lexical target resolves INSIDE the project root is
 * deliberately ALLOWED by `assertPathWithinProjectRoot`, but a literal
 * `mkdirSync(path.dirname(...))` creates nothing the link's resolved target
 * needs, since the literal parent — the directory containing the link
 * itself — already exists. For example, a dangling symlink `app/dir ->
 * missing-parent/real-dir` (lexical target inside the project) with a
 * payload declaring `app/dir/file.txt` needs `missing-parent/` created
 * before the write can land; the literal parent (`app/dir`'s own containing
 * directory) already exists, so building only that would leave the write
 * failing with an uncaught `ENOENT`.
 *
 * `resolveWriteParentDir` is the one formulation every writer in this
 * package that creates parent directories for a path inside a PROJECT
 * shares — this function, `createFsWriteProjectFileFn` below in this same
 * file, and `createFsCopyBundleFn` (`./fs-ai-bundle.ts`). `fs-content-
 * store.ts`'s own `mkdirSync` calls are deliberately excluded from that
 * set: they write into the CLI's own local inventory cache, a directory
 * tree only this store itself ever populates (never a developer's project,
 * never a template's content), so no dangling symlink planted by anything
 * other than this store's own `mkdirSync`/`writeFileSync` calls — which
 * never create a symlink — can ever appear there for
 * `resolveWriteParentDir`'s walk to matter against.
 *
 * `scaffold/existing-content.ts`'s own DIRECTORY-SYMLINK check means
 * reconciliation refuses this exact shape (a symlinked directory standing
 * between `target` and a payload path) with `CONTENT_CONFLICT` before
 * materialization ever reaches this function — and it refuses a DANGLING
 * symlink there identically to a live one: `inst-ec-if-symlink-component`
 * (`scaffold/existing-content.ts`) checks for a symlink AT that path by
 * name, never by dereferencing it, so whether the link's target exists is
 * irrelevant to whether reconciliation catches it. Do not assume a dangling
 * link is treated as "not a data-loss risk" and let through — it is not.
 * What this function genuinely remains the backstop for is narrower: a link
 * that appears in the window between that read and this write (an
 * existing-content snapshot is not a lock, dangling or not), and a dangling
 * symlink standing ABOVE `target` itself — an ancestor of `target`, never a
 * descendant of it — which reconciliation's own walk never inspects at all,
 * since it only checks the ground BETWEEN `target` and a payload path,
 * never `target`'s own ancestors. Refusing that remaining shape outright
 * would be strictly more conservative than this package's settled position
 * that a project may legitimately contain its own (non-aliasing) symlinks.
 */
export function createFsWriteFileFn(): WriteFileFn {
  return async function writeFile(destPath: string, content: string): Promise<void> {
    fs.mkdirSync(resolveWriteParentDir(destPath), { recursive: true });
    refuseIfDestinationIsSymlink(destPath);
    fs.writeFileSync(destPath, content, 'utf-8');
  };
}

// Shared by every read seam below (`createFsReadFileFn`/
// `createFsReadProjectFileFn`/`createFsReadProjectStateFn`) — a manifest
// read, an upgrade-engine scratch-file read, and the project state document
// read each belong to a DIFFERENT FEATURE (template-manifest, upgrade, and
// composed-provenance respectively, none of them this package's own
// cli-scaffolding FEATURE this file's other markers trace to), so this fix
// carries no `@cpt-` marker of its own: it hardens a shared low-level
// primitive those FEATUREs' own seams are built on, rather than realizing a
// cli-scaffolding plan item.
//
// The kind `resolvePathKind` reports for a path that exists but is not a
// regular file, once every symlink along its FINAL component is resolved —
// `'dangling-symlink'` is not a `fs.Stats` kind at all (there is no `Stats`
// object for a target that does not exist), so it is named separately from
// the four kinds `fs.Stats` itself can report.
export type NonRegularKind = 'directory' | 'fifo' | 'socket' | 'device' | 'dangling-symlink';

export function describeNonRegularKind(kind: NonRegularKind): string {
  switch (kind) {
    case 'directory':
      return 'a directory';
    case 'fifo':
      return 'a FIFO';
    case 'socket':
      return 'a socket';
    case 'device':
      return 'a device file';
    case 'dangling-symlink':
      return 'a symlink whose target does not exist';
  }
}

/**
 * A read was refused because `filePath` — once every symlink is resolved —
 * denotes something other than a regular file. Typed, rather than a bare
 * `Error`, so a caller that reads a manifest, a project-owned scratch file,
 * or the project state document can tell this fact apart from a genuine
 * internal failure and report it as its own structured refusal, the same
 * discipline `PathContainmentError`/`ExistingSymlinkDestinationError` above
 * already establish for their own classes of honest, expected refusal.
 */
export class NotRegularFileError extends Error {
  readonly filePath: string;
  readonly kind: NonRegularKind;

  constructor(filePath: string, kind: NonRegularKind) {
    super(`"${filePath}" is ${describeNonRegularKind(kind)}, not a regular file — refusing to read it.`);
    this.name = 'NotRegularFileError';
    this.filePath = filePath;
    this.kind = kind;
  }
}

/**
 * A read was refused because `filePath` itself could never be reached at
 * all: some component ABOVE it (`blockingAncestor`) exists and is not a
 * directory, so nothing beneath it — regardless of what would otherwise
 * stand at `filePath` — can be resolved (`ENOTDIR`, the one `lstat` failure
 * `resolvePathKind` does not fold into plain absence). This is a different
 * fact from `filePath` being absent (nothing blocks the way; there is simply
 * nothing at the leaf yet) and from `NotRegularFileError` above (the leaf
 * itself is reachable and stands in the wrong shape): here the leaf is
 * unreachable, and its own shape — were it reachable — is not the question.
 * Naming `blockingAncestor` rather than `filePath` is what makes the refusal
 * actionable: it is the one entry a caller has to resolve, and nothing below
 * it can be inspected regardless of what `filePath` itself would have been.
 */
export class UnreachablePathError extends Error {
  readonly filePath: string;
  readonly blockingAncestor: string;

  constructor(filePath: string, blockingAncestor: string) {
    super(`"${filePath}" cannot be reached: "${blockingAncestor}" exists and is not a directory.`);
    this.name = 'UnreachablePathError';
    this.filePath = filePath;
    this.blockingAncestor = blockingAncestor;
  }
}

/**
 * A read was refused because `filePath` could not actually be opened, for a
 * reason `resolvePathKind`'s own `lstat`/`stat` probe cannot see in advance —
 * most often a permission bit denying read access to the file itself (`chmod
 * 000`), or denying search access to a directory somewhere along the path
 * before the probe itself ever runs. This is the third fact this module's
 * read seams distinguish, beside absence and wrong shape: a path that IS (or
 * would be) the right shape, but cannot actually be read. `errnoCode` is
 * carried for diagnostics only — this class exists so a caller never has to
 * branch on it to decide what happened.
 */
export class PathUnreadableError extends Error {
  readonly filePath: string;
  readonly errnoCode: string;

  constructor(filePath: string, errnoCode: string) {
    super(`"${filePath}" could not be read (${errnoCode}): permission was refused, or the path could not be opened.`);
    this.name = 'PathUnreadableError';
    this.filePath = filePath;
    this.errnoCode = errnoCode;
  }
}

/**
 * The single project state document (`.frontx/project.json`) could not be
 * read, for one of the three reasons `resolvePathKind`/`readRegularFileOrThrow`
 * distinguish (`NotRegularFileError`/`UnreachablePathError`/`PathUnreadableError`
 * — `underlying`, below). Every OTHER read seam in this module lets its own
 * typed refusal travel unwrapped, because whichever command dispatched it
 * decides the reported code from the refusal's own shape — but this document
 * is CLI-owned bookkeeping, not template content, and every other way its
 * content can already be unusable (malformed JSON, an unrecognized
 * `formatVersion`, a shape violation — `project-state/io.ts`'s own
 * `parseProjectStateDocument`) already reports the SAME `PROJECT_INVALID`
 * regardless of cause. Wrapping the three read-side refusals into this one
 * type, rather than leaving them to fall through to the generic
 * `NotRegularFileError` handling `cli.ts` gives every OTHER content read
 * (`CONTENT_CONFLICT`), is what keeps that one promise — "the project state
 * document is unusable" is one fact with one code, whatever broke it —
 * instead of the code depending on which layer happened to notice the break.
 */
export class ProjectStateUnreadableError extends Error {
  readonly filePath: string;
  readonly underlying: NotRegularFileError | UnreachablePathError | PathUnreadableError;

  constructor(filePath: string, underlying: NotRegularFileError | UnreachablePathError | PathUnreadableError) {
    super(`Project state document at "${filePath}" could not be read: ${underlying.message}`);
    this.name = 'ProjectStateUnreadableError';
    this.filePath = filePath;
    this.underlying = underlying;
  }
}

function kindFromStat(stat: fs.Stats): Exclude<NonRegularKind, 'dangling-symlink'> | 'file' {
  if (stat.isFile()) return 'file';
  if (stat.isDirectory()) return 'directory';
  if (stat.isFIFO()) return 'fifo';
  if (stat.isSocket()) return 'socket';
  return 'device'; // a block or character device, or any other special entry `fs.Stats` can name
}

/**
 * Resolves what actually stands at `filePath` — following every symlink the
 * FINAL component may be, exactly as `fs.readFileSync` itself would — into
 * one of `'absent'`, `'file'`, or a `NonRegularKind`, WITHOUT ever opening
 * the path for reading. This is the one check every read seam below runs
 * before its own `fs.readFileSync` call: `fs.readFileSync` on a FIFO with no
 * writer attached blocks forever — no stdout, no stderr, no exit — and
 * neither `fs.existsSync` (follows a symlink to decide existence, so it
 * answers `true` for a FIFO exactly as readily as for a text file) nor a
 * bare, unchecked `fs.readFileSync` call guards against that; only checking
 * the KIND first, via `lstatSync`, and — for a symlink — what it resolves to,
 * via `statSync` (which itself never blocks; only `open()` for read/write on
 * a FIFO does), closes it.
 *
 * A DANGLING symlink is reported as its own kind, never folded into
 * `'absent'`: something real does stand at `filePath` (`lstatSync` succeeds,
 * a real directory entry exists), it is simply unreadable — collapsing it
 * into "absent" would let a caller silently proceed as if nothing were
 * registered there at all, exactly the false-success class this fix exists
 * to close.
 */
// `ENOTDIR` on either `lstat` call below means a component ABOVE `filePath`
// exists and is not a directory — the OS refuses to resolve anything beneath
// it, so `filePath` itself was never actually inspected. Folding that into
// `'absent'` would be the exact false success this function exists to
// refuse: something real (the blocking ancestor) stands in the way, which is
// a different, more actionable fact than nothing being there at all. Every
// OTHER `lstat`/`stat` failure (most commonly `EACCES`, a permission refusal
// on a directory somewhere along the path) means the probe itself could not
// even determine what stands at `filePath` — a third fact, distinct from
// both absence and a wrong-but-known shape.
function throwForLstatFailure(filePath: string, error: unknown): never {
  if (isErrnoCode(error, 'ENOTDIR')) {
    throw new UnreachablePathError(filePath, firstNonDirectoryComponentOf(filePath) ?? filePath);
  }
  throw new PathUnreadableError(filePath, errnoCodeOf(error));
}

// Exported (in addition to `readFileIfRegular`'s own use of it below) so a
// write-side seam outside this module — the local inventory store's own
// writers (`adapters/fs-inventory-index.ts`) — can run the identical
// FIFO-safe shape probe before ITS OWN write, rather than restating this
// exact `lstat`/`statSync` sequence a second time. See that module's own
// call site for why a write needs the same probe a read already has.
export function resolvePathKind(filePath: string): 'absent' | 'file' | NonRegularKind {
  let lst: fs.Stats;
  try {
    lst = fs.lstatSync(filePath);
  } catch (error) {
    if (isEnoent(error)) return 'absent';
    throwForLstatFailure(filePath, error);
  }
  if (!lst.isSymbolicLink()) return kindFromStat(lst);
  let target: fs.Stats;
  try {
    target = fs.statSync(filePath); // follows the whole chain, however long
  } catch (error) {
    if (isEnoent(error)) return 'dangling-symlink';
    throwForLstatFailure(filePath, error);
  }
  return kindFromStat(target);
}

/**
 * Reads `filePath` once `resolvePathKind` has already confirmed it names a
 * regular file — the one place every read seam below actually opens a file
 * for content, so the `EACCES`-on-`chmod 000` case (the probe above sees a
 * perfectly ordinary file; only the OPEN itself is refused) is guarded here
 * rather than duplicated at each call site.
 */
function readRegularFileOrThrow(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    if (isEnoent(error)) throw error; // vanished between the probe and this read: preserve the seam's ordinary absence handling
    throw new PathUnreadableError(filePath, errnoCodeOf(error));
  }
}

/**
 * Reads `filePath` if (and only if) it resolves to a regular file:
 * `null` for absence, the file's content for a regular file, and — for
 * anything else — whichever of `NotRegularFileError`/`UnreachablePathError`/
 * `PathUnreadableError` honestly names what stood in the way. This is the
 * one guarded "read a small file honestly" primitive every seam in this
 * module that is not itself `createFsReadFileFn`/`createFsReadProjectFileFn`/
 * `createFsReadProjectStateFn` reuses (`fs-inventory-index.ts`'s own local
 * metadata store, whose `readAll` used to pair a symlink-following
 * `existsSync` with a bare `readFileSync` and hang on a FIFO exactly as the
 * three seams below once did) — never a fourth, independently written copy
 * of the same guard.
 */
export function readFileIfRegular(filePath: string): string | null {
  const kind = resolvePathKind(filePath);
  if (kind === 'absent') return null;
  if (kind !== 'file') throw new NotRegularFileError(filePath, kind);
  return readRegularFileOrThrow(filePath);
}

/** An `ENOENT`-shaped error matching what `fs.readFileSync` itself throws for
 * an absent path — used to preserve a read seam's existing "throws on
 * absence" contract once its own `fs.readFileSync` call is guarded by
 * `resolvePathKind` above rather than reached unconditionally. */
function enoentError(filePath: string): NodeJS.ErrnoException {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  error.path = filePath;
  return error;
}

/** Real `ReadFileFn` — reads a manifest file; throws the plain `ENOENT`-shaped
 * error the seam's own contract has always thrown for absence, and one of
 * three typed refusals for anything else a manifest path can honestly be:
 * `NotRegularFileError` (a FIFO, socket, device, directory, or dangling
 * symlink stands there — never blocked on, the way a bare `fs.readFileSync`
 * on a FIFO with no writer attached would), `UnreachablePathError` (a
 * component ABOVE the manifest path is not a directory, so the manifest
 * itself was never actually inspected), or `PathUnreadableError` (the path
 * resolves to an ordinary file but could not be opened — most commonly a
 * permission refusal). Every caller that reads a manifest through this seam
 * (`scaffold/registered-manifest.ts`, `commands/validate.ts`,
 * `resolver/resolve.ts`'s own local-origin read) wraps it in its own
 * `try`/`catch`; each decides for itself whether to report a typed refusal's
 * own honest reason or fold it beside absence, rather than every caller being
 * forced to agree on one answer for what is, from a caller's own vantage,
 * sometimes a genuinely different fact. */
export function createFsReadFileFn(): ReadFileFn {
  return async function readFile(filePath: string): Promise<string> {
    const content = readFileIfRegular(filePath);
    if (content === null) throw enoentError(filePath);
    return content;
  };
}

// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
/**
 * Real `PathExistsFn` (`../resolver/types.ts`) — the resolver's own
 * existence half of `inst-resolve-local-path-check`, distinct from
 * `CanonicalizeTargetFn`: canonicalization alone proves containment, not
 * existence, since `createFsCanonicalizeTargetFn` below deliberately
 * resolves a path that does not yet exist (walking up to the nearest
 * existing ancestor) for its own pre-flight-target callers. `fs.existsSync`
 * follows a symlink, which is correct here — a local origin folder reached
 * through a symlink whose target exists is a real, readable folder, and
 * `canonicalizeFn` has already proven the whole chain resolves inside the
 * project root before this is ever called.
 */
export function createFsPathExistsFn(): PathExistsFn {
  return async function pathExists(absolutePath: string): Promise<boolean> {
    return fs.existsSync(absolutePath);
  };
}

/** Real `ReadProjectFileFn` — returns `null` (never throws) when the file is
 * absent, and ALSO when a directory now stands where the file is expected:
 * this seam's own contract (`upgrade/types.ts`'s doc comment on
 * `ReadProjectFileFn`) deliberately "collapses absence and a directory into
 * one `null`" for its caller's own reasons, and this fix preserves that
 * collapse rather than narrowing it. What it does NOT preserve is the
 * silent hang a FIFO with no writer attached used to cause: a FIFO, a
 * socket, a device, or a dangling symlink throws `NotRegularFileError`; an
 * ancestor that is not a directory throws `UnreachablePathError`; a path the
 * probe accepts but cannot actually open (`chmod 000`) throws
 * `PathUnreadableError` — none of those is a directory, so none is covered
 * by the documented collapse above. */
export function createFsReadProjectFileFn(): ReadProjectFileFn {
  return async function readProjectFile(absolutePath: string): Promise<string | null> {
    const kind = resolvePathKind(absolutePath);
    if (kind === 'absent' || kind === 'directory') return null;
    if (kind !== 'file') throw new NotRegularFileError(absolutePath, kind);
    return readRegularFileOrThrow(absolutePath);
  };
}

/** Real `WriteProjectFileFn` — writes an absolute project file, creating
 * parent dirs.
 *
 * Uses the same `resolveWriteParentDir` walk every other writer in this file
 * calls, rather than a literal `fs.mkdirSync(path.dirname(absolutePath),
 * ...)`. Same reasoning as `createFsWriteFileFn`'s own doc comment above: a
 * dangling symlink whose lexical target resolves INSIDE the applicable root
 * is deliberately ALLOWED, and a literal `mkdirSync(path.dirname(...))`
 * creates nothing that link's resolved target needs. */
export function createFsWriteProjectFileFn(): WriteProjectFileFn {
  return async function writeProjectFile(absolutePath: string, content: string): Promise<void> {
    fs.mkdirSync(resolveWriteParentDir(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf-8');
  };
}

/** Real `RemoveProjectFileFn` — removes an absolute project file; no-op when absent. */
export function createFsRemoveProjectFileFn(): RemoveProjectFileFn {
  return async function removeProjectFile(absolutePath: string): Promise<void> {
    if (fs.existsSync(absolutePath)) {
      fs.rmSync(absolutePath, { force: true });
    }
  };
}

// @cpt-algo:cpt-frontx-algo-composed-provenance-project-state-io:p1
/** Real `ReadProjectStateFn` — returns `null` (never throws) when the
 * project state document is absent, matching `createFsReadProjectFileFn`'s
 * own absence convention above so `project-state/io.ts`'s pure logic can
 * treat "no document yet" identically to "no scratch file yet". */
// Unlike `createFsReadProjectFileFn` just above, a DIRECTORY standing at
// `.frontx/project.json` is deliberately NOT collapsed into "absent" here:
// that seam's own contract only ever names a scratch file the upgrade
// engine itself writes and re-reads, but this one guards the single
// document every command's registration/ownership/apply/delete state is
// read from — silently treating a directory there as "no project
// registered yet" would let `register`/`apply`/`seed` write straight past
// real (if oddly-shaped) ground instead of refusing it, and every OTHER
// non-regular kind (a FIFO, a socket, a device, a dangling symlink) is
// refused for the identical reason a directory now is. A genuinely absent
// document is the only case this seam still answers with `null`.
export function createFsReadProjectStateFn(): ReadProjectStateFn {
  return async function readProjectState(absolutePath: string): Promise<string | null> {
    try {
      const kind = resolvePathKind(absolutePath);
      if (kind === 'absent') return null;
      if (kind !== 'file') throw new NotRegularFileError(absolutePath, kind);
      return readRegularFileOrThrow(absolutePath);
    } catch (error) {
      // Every one of this module's three read-side refusals is wrapped into
      // the ONE `ProjectStateUnreadableError` here — see that class's own doc
      // comment for why this specific document, alone among everything this
      // module reads, folds all three into a single reported fact rather
      // than letting the dispatcher's generic per-refusal handling apply.
      if (
        error instanceof NotRegularFileError ||
        error instanceof UnreachablePathError ||
        error instanceof PathUnreadableError
      ) {
        throw new ProjectStateUnreadableError(absolutePath, error);
      }
      throw error;
    }
  };
}

// @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-write-atomic
/**
 * Real `WriteProjectStateFn` — the one place this store's
 * write-through-temp-file-then-rename discipline is actually implemented
 * (`inst-psio-write-atomic`). The pure logic in `project-state/io.ts` only
 * knows it calls this function and trusts the atomicity contract; this is
 * where that trust is earned.
 *
 * The temporary file is written BESIDE the destination (same directory, so
 * the final `renameSync` stays on one filesystem/device and is therefore
 * atomic on POSIX and NTFS alike — a rename across devices is not), with a
 * random suffix so two concurrent writers never collide on the same
 * scratch path. The destination is never truncated or edited in place: an
 * interruption before the rename leaves the prior valid document exactly as
 * it was (the temp file is simply an orphan); an interruption after the
 * rename leaves the fully written new document in place. There is no
 * window in which the destination is partially written, because the
 * destination itself is never opened for writing at all — only the
 * temporary file is, and the rename that publishes it is a single atomic
 * filesystem operation.
 *
 * "The destination" here means the RESOLVED destination
 * (`inst-psio-resolve-write-destination` below) — `absolutePath` itself when
 * it names a regular file or nothing yet, or the target a symlink standing
 * there points at when it names one. The temporary file sits beside THAT
 * path, never beside a symlink found at `absolutePath`, so the rename that
 * publishes it lands on the real document a symlink names rather than
 * replacing the link.
 *
 * Unlike every other adapter that writes into or removes from a project —
 * where `assertPathWithinProjectRoot` is called by the CALLER
 * (`commands/apply.ts`/`commands/delete.ts` for `WriteFileFn`/
 * `RemoveProjectFileFn`; `fs-upgrade-io.ts`; `fs-ai-bundle.ts`) before the
 * write happens — this function performs that containment check itself,
 * inline. It has to: `register`/`unregister`/`ownership *` operate on the
 * current working directory with no explicit root argument of their own
 * (this file's header, and `CliDeps`' `writeProjectStateFn` itself, is a
 * plain shared value rather than a per-command factory precisely for that
 * reason), so there is no caller-side root to check against before reaching
 * here. Without this check, `ln -s /outside/state .frontx` followed by any
 * command that mutates project state (`register`, `unregister`, `ownership
 * add|remove`, `upgrade`, `seed`) would write straight through to
 * `/outside/state/project.json`.
 *
 * Every production caller reaches this function through
 * `projectStatePath(repoRoot)` (`project-state/io.ts`), which is ALWAYS
 * exactly `<repoRoot>/.frontx/project.json`, two path segments below the
 * applicable root. That invariant is used here to recover the root this
 * write must stay inside without threading a second constructor parameter
 * through `CliDeps` for a
 * value this store's own fixed shape already determines, then reuses the
 * SAME `assertPathWithinProjectRoot` helper `WriteFileFn`'s own callers use
 * — never a second, independently-formulated check.
 */
export function createFsWriteProjectStateFn(): WriteProjectStateFn {
  return async function writeProjectState(absolutePath: string, content: string): Promise<void> {
    const projectRoot = path.dirname(path.dirname(absolutePath));
    assertPathWithinProjectRoot(projectRoot, absolutePath);
    // @cpt-begin:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-resolve-write-destination
    // `absolutePath` (`.frontx/project.json`) may itself be a symlink — the
    // containment check just above already proved that wherever it points
    // resolves inside `projectRoot`, using this SAME `resolveNearestExistingAncestor`
    // walk, so reusing it here (rather than a second, independently
    // formulated resolution) costs nothing new to trust. What it answers
    // here is different: not WHETHER the write may land, but WHERE it
    // actually must. `fs.renameSync` does not follow a symlink standing at
    // its destination — replacing `absolutePath` with the newly-written
    // temp file destroys the link itself and leaves whatever real document
    // it named untouched, silently orphaned with the stale content it
    // already held (the developer's own document, still holding the OLD
    // state, with nothing in the report saying so). Resolving here and
    // writing onto the RESOLVED destination instead keeps the link intact
    // and updates the real document it names — an ordinary, non-symlinked
    // `absolutePath` resolves to itself, so this changes nothing for the
    // common case.
    const writeDestination = resolveNearestExistingAncestor(path.resolve(absolutePath)) ?? absolutePath;
    // @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-resolve-write-destination
    const dir = path.dirname(writeDestination);
    // `resolveWriteParentDir`, not a literal `fs.mkdirSync(dir, ...)`: `dir`
    // may itself BE (or sit beneath) an ALLOWED dangling symlink — e.g. a
    // `.frontx` symlink whose target lands inside the project but whose own
    // parent does not exist yet — and a literal mkdir on `dir` creates
    // nothing such a link's target needs (see this file's own doc comment
    // about dangling symlinks above `resolveWriteParentDir`).
    fs.mkdirSync(resolveWriteParentDir(writeDestination), { recursive: true });
    const tempPath = path.join(dir, `.${path.basename(writeDestination)}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, writeDestination);
  };
}
// @cpt-end:cpt-frontx-algo-composed-provenance-project-state-io:p1:inst-psio-write-atomic

/**
 * Real `ListPayloadFilesFn` - enumerates every regular file reachable under
 * `templateDir` itself, POSIX-relative to `templateDir` (never with a
 * leading slash). Never descends into `node_modules` (install-time output,
 * never committed template content). DOES descend into a dot-prefixed
 * directory and DOES include a dot-file: a template legitimately ships
 * dotfiles (`.gitignore`, its own `.frontx/ai/<identity>` bundle) as real
 * content, and a carrier nested under one (a `package.json` inside a hidden
 * directory) must still be inspected - skipping dot-prefixed entries would
 * open exactly the completeness hole the content self-containment check
 * exists to close.
 *
 * A SYMLINK is resolved, not skipped. `readdirSync(..., { withFileTypes:
 * true })` reports a symlink's own type, for which `isDirectory()` and
 * `isFile()` are BOTH false, so a symlinked carrier - or a whole symlinked
 * directory of them - would otherwise be silently dropped from the
 * enumeration and never inspected. What the link POINTS at decides, via
 * `statSync`, which follows it.
 *
 * A resolved symlink found WHILE walking must not take the walk outside the
 * template: a link to `../../shared` is exactly the escape this check exists
 * to catch, and walking into it would report files that are not the
 * template's content as if they were. Such a mid-walk link is skipped - its
 * existence as an escape is the CONTENT check's business only in so far as a
 * carrier declares it, and for content it FINDS this adapter enumerates rather
 * than judges. A template shipping an internal dangling or escaping link
 * alongside real content still enumerates that content.
 *
 * A `readdir`/`stat` the operating system REFUSES (a permission-denied
 * directory, most of all), or `templateDir` itself failing to resolve, is
 * refused outright rather than reported as an empty list: the seam's return
 * type is `Promise<string[]>`, so the only value this function could invent
 * for "I could not enumerate" is an empty list - which the content check
 * cannot tell apart from a template that is genuinely clean, and a
 * validation gate that passes because it could not look is worse than one
 * that crashes. Every throw is converted into a named failure result exactly
 * once, at the command boundary that owns the exit code
 * (`commands/validate.ts`), which is where the manifest read's own failure
 * is already turned into one.
 */
export function createFsListPayloadFilesFn(): ListPayloadFilesFn {
  return async function listPayloadFiles(templateDir: string): Promise<string[]> {
    const root = realPathOrNull(templateDir);
    if (root === null) {
      throw new Error(`template directory could not be resolved: ${templateDir}`);
    }
    try {
      return walkFiles(templateDir, '', root, new Set([root]));
    } catch (error) {
      // The caught error is attached through `Object.assign` rather than the
      // `Error` constructor's options argument: this file is compiled under
      // the repository root's tsconfig as well as the package's own, and the
      // root targets ES2020, whose `Error` constructor takes no options
      // argument (the same form `adapters/github-fetch.ts` already uses).
      throw Object.assign(
        new Error(`could not enumerate template directory ${templateDir}: ${describeError(error)}`),
        { cause: error },
      );
    }
  };
}

/**
 * Real `ResolveDeclaredExclusionFn` - confirms a single declared
 * `excludedSubtrees` entry resolves honestly, without enumerating its
 * content (that ground is reserved for a nested template, not this one, so
 * there is nothing here to walk).
 *
 * Distinguishes "genuinely absent" (the ORDINARY case: the manifest is
 * authored before any target is known, so the entry normally does not
 * exist in the candidate directory yet) from "a broken symlink" using
 * `lstatSync`, not `existsSync`. `existsSync` FOLLOWS a symlink, so a
 * broken one would read as absent and the AC that demands a FAIL for it
 * would silently pass - `lstatSync` reports the entry's own link, whether
 * or not its target exists, so a broken link is distinguishable from
 * nothing being there at all.
 *
 * An entry that exists must additionally resolve INSIDE `templateDir` - a
 * declared exclusion escaping the template root is exactly the same class
 * of bug an escaping carrier reference is, and is refused the same way,
 * never silently treated as if nothing were there.
 */
export function createFsResolveDeclaredExclusionFn(): ResolveDeclaredExclusionFn {
  return async function resolveDeclaredExclusion(
    templateDir: string,
    excludedSubtree: string,
  ): Promise<'ABSENT' | 'RESOLVED'> {
    // A trailing "/" (every excludedSubtrees entry has one - contract-
    // validated) forces `lstatSync` to dereference a symlink's final
    // component on POSIX, which would silently turn this into `statSync`
    // and defeat the whole point of using `lstat` over `existsSync` below -
    // a broken symlink would then read as ENOENT, indistinguishable from
    // genuine absence. Stripped once, here, before any fs call.
    const trimmedSubtree = excludedSubtree.endsWith('/') ? excludedSubtree.slice(0, -1) : excludedSubtree;
    const absoluteEntry = path.join(templateDir, trimmedSubtree);

    try {
      fs.lstatSync(absoluteEntry);
    } catch (error) {
      if (isEnoent(error)) return 'ABSENT';
      throw Object.assign(
        new Error(`declared excludedSubtrees entry could not be inspected: ${excludedSubtree} (${describeError(error)})`),
        { cause: error },
      );
    }

    // Something exists at this path (a file, a directory, or a symlink -
    // broken or not). `templateDir` may itself sit under a symlink (a
    // macOS `/tmp` -> `/private/tmp` prefix is the everyday case), so both
    // sides are resolved to real paths before containment is compared.
    const root = realPathOrNull(templateDir);
    if (root === null) {
      throw new Error(`template directory could not be resolved: ${templateDir}`);
    }
    const resolvedEntry = realPathOrNull(absoluteEntry);
    if (resolvedEntry === null) {
      // `lstatSync` succeeded a moment ago (something was there), but
      // `realpathSync` just failed. That has two possible causes, and this
      // message does not assert which: the entry IS a symlink whose target
      // does not exist (the ordinary "broken symlink" case), OR whatever
      // was there - symlink or not - vanished in the gap between the two
      // calls (a TOCTOU race), or `realpath` failed on the path for another
      // reason entirely - a symlink loop, or a permission refusal on a path
      // component. `realPathOrNull` collapses every one of those into the
      // same `null`, so the label names the common ones and stays open
      // rather than asserting a cause this branch cannot distinguish. Either
      // way the outcome is the same refusal, fail-closed, naming the path.
      throw new Error(
        `declared excludedSubtrees entry could not be resolved - a broken symlink, a symlink loop, a permission ` +
          `refusal on a path component, or removal between inspection and resolution: ${excludedSubtree}`,
      );
    }
    if (!isInside(root, resolvedEntry)) {
      throw new Error(
        `declared excludedSubtrees entry resolves outside the template root: ${excludedSubtree} -> ${resolvedEntry}`,
      );
    }

    return 'RESOLVED';
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

// The same narrowing `isEnoent` above performs for one fixed code, opened up
// to any code so `resolvePathKind`'s catch below can tell an ancestor-is-
// not-a-directory failure (`ENOTDIR`) apart from every other kind of lstat
// refusal without a third hand-rolled shape check.
function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

/** The errno `code` a rejected fs call carries, or `'UNKNOWN'` when the
 * rejection is not fs-shaped at all — kept a string, not a closed union,
 * because this package's own typed refusals (`PathUnreadableError` below)
 * exist precisely so a caller never has to switch on the raw code itself;
 * it is carried only for a human message and `--json` `details`. */
function errnoCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}

function toPosixPath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

/** `null` for a broken symlink or a path that vanished mid-walk. */
function realPathOrNull(absolutePath: string): string | null {
  try {
    return fs.realpathSync(absolutePath);
  } catch {
    return null;
  }
}

// Exported so a containment check OUTSIDE this module — the local inventory
// store's own boundary confirmation (`adapters/fs-installed-content-path.ts`,
// `adapters/fs-inventory-index.ts`) — can reuse this exact prefix test rather
// than restating it, once it has resolved a candidate through
// `resolveNearestExistingAncestor` below the same way this module's own
// callers do.
export function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root + path.sep);
}

// @cpt-algo:cpt-frontx-algo-cli-scaffolding-conflict-check:p1
/**
 * Real `CanonicalizeTargetFn` for the nesting-aware conflict checker
 * (`../scaffold/conflict-check.ts`, `inst-cc-canonicalize`). Resolves a
 * caller-supplied target path against the PROJECT root — in contrast to
 * `createFsResolveDeclaredExclusionFn` above, which resolves an
 * `excludedSubtrees` entry against a TEMPLATE directory root for a
 * different algorithm. The root differs, so that adapter's own
 * `realPathOrNull`/`isInside` pair is reused here directly rather than
 * copied, but the walk that gets a candidate down to a real path is new:
 * that adapter's caller (`ResolveDeclaredExclusionFn`) is only ever asked
 * about a path that has already been confirmed to exist via `lstatSync`,
 * while a target under check here ordinarily does NOT exist on disk yet —
 * this is the PRE-FLIGHT check for a batch that has not been materialized.
 *
 * `fs.realpathSync` throws on a path that does not exist — and also on one
 * that exists only as a DANGLING symlink, which is not the same thing as not
 * existing at all (see `resolveNearestExistingAncestor`'s own doc comment
 * below for why that distinction matters) — so it cannot be called on the
 * full candidate the way it is called on a template directory already known
 * to exist. Instead this walks the candidate component by component,
 * resolving every symlink actually found along the way (dangling or not)
 * exactly as an already-existing full path would be, and reattaches
 * whatever never exists at all literally once the walk runs out of real
 * ground — a segment that has never existed cannot itself be a symlink, so
 * nothing is lost by not resolving it. `path.resolve` (building the lexical
 * candidate below) already collapses a `..` segment before any filesystem
 * call is made, so a plain `../escape` is caught even when every component
 * along the way is on the same filesystem and fully readable.
 */
export function createFsCanonicalizeTargetFn(projectRoot: string): CanonicalizeTargetFn {
  const realRoot = realPathOrNull(projectRoot);
  if (realRoot === null) {
    throw new Error(`project root could not be resolved: ${projectRoot}`);
  }
  return function canonicalizeTarget(rawTarget: string): string | null {
    const lexicalCandidate = path.resolve(realRoot, rawTarget);
    const resolved = resolveNearestExistingAncestor(lexicalCandidate);
    if (resolved === null) return null;
    if (!isInside(realRoot, resolved)) return null;
    // `path.relative` returns `""` when `resolved` IS the project root —
    // spelled `.` here, the one canonical form every containment predicate
    // that accepts a concrete TARGET (as opposed to a declaration such as
    // `excludedSubtrees`) is written to recognize as "the whole project"
    // (`paths/relative-path.ts`'s `pathWithinTarget`/`targetsNest`). `""` is
    // reserved for what those same predicates already treat as a
    // declaration addressing no location at all — the two must never share
    // one spelling, or a real root target becomes indistinguishable from
    // "nothing" the moment it reaches them.
    const relative = path.relative(realRoot, resolved);
    return relative === '' ? '.' : toPosixPath(relative);
  };
}

// `createFsCanonicalizeTargetFn` above proves a batch's own TARGET resolves
// inside the project root, symlinks resolved — but that says nothing about
// an individual PAYLOAD PATH under that target. Joining `repoRoot` with an
// already-canonicalized project-relative payload path and handing the
// result straight to the injected `WriteFileFn` would not be enough: a
// developer (or an attacker) can replace a path SEGMENT BELOW the target
// with a symlink to somewhere outside the project between registration and
// `apply` (`mkdir -p app && ln -s /somewhere/outside app/src`), and neither
// the target canonicalization nor the plain `fs.writeFileSync`/`fs.rmSync`
// the real writer/remover perform re-checks that segment — the OS simply
// follows the link, and the write would land outside the project entirely.
// `assertPathWithinProjectRoot` below closes that gap by checking the full
// absolute path, not just the target, immediately before the write happens.
//
// This is the ONE "is this absolute path inside the root, symlinks
// resolved" formulation every adapter that writes into, or removes from, a
// project uses — reusing the identical walk-up-to-nearest-existing-ancestor
// algorithm `resolveNearestExistingAncestor` above already implements for a
// target string, rather than a second, independently-formulated check.
// `adapters/fs-upgrade-io.ts` and `adapters/fs-ai-bundle.ts` call it from
// INSIDE their own real adapters, whose seams already receive their root as
// an ordinary per-call argument. `WriteFileFn`/`RemoveProjectFileFn` below
// cannot do the same: both are shared, `CliDeps`-injected values whose
// caller varies the applicable root per command (`apply`'s `process.cwd()`
// vs. `seed <dir>`'s own directory argument) and whose exact call arity is
// asserted by this package's existing dispatch test suite — so
// `commands/apply.ts` and `commands/delete.ts` call this function directly,
// immediately before delegating to their own injected writer/remover, at
// the exact point repoRoot and the absolute path come together.
//
// A path that does not exist yet (the ordinary case for a write about to
// create one) is handled exactly as `resolveNearestExistingAncestor`
// already handles a not-yet-existing target: walk forward component by
// component, following every symlink found along the way — including one
// whose own target does not exist (a DANGLING link, final component or
// intermediate — see that function's own doc comment for why both shapes
// matter) — and reattach whatever never exists at all literally, once the
// walk runs out of real ground to stand on. An internal symlink — one whose
// real (or, for a dangling one, LEXICAL) target still resolves inside
// `root` — is deliberately ALLOWED, never refused outright: a project may
// legitimately contain its own symlinks, and only an escape past `root` is
// what this guard exists to catch.
/**
 * A path the CLI was asked to write, remove or claim could not be proven to
 * stay inside the root that owns it once symlinks were resolved. That root is
 * the project root for every project-side write, and the local inventory
 * store root for the two inventory adapters that reuse this same refusal
 * (`fs-inventory-index.ts`, `fs-installed-content-path.ts`) — `rootLabel`
 * names which, so the message never tells a developer their inventory store
 * is "the project root".
 *
 * Typed rather than a bare `Error` so the command boundary can tell it apart
 * from a genuine internal failure and report it accordingly: a bare `Error`
 * arrives at `run()`'s catch identically to any other internal failure —
 * exit 2 with a bare stderr line and, under `--json`, no envelope at all.
 * Containment being enforced is not the same as it being reported honestly —
 * a caller cannot act on an internal-error exit for what is an ordinary,
 * actionable problem with the tree it pointed the CLI at.
 */
export class PathContainmentError extends Error {
  readonly offendingPath: string;

  constructor(offendingPath: string, root: string, rootLabel = 'the project root') {
    super(`Refusing to write outside ${rootLabel}: "${offendingPath}" is not within "${root}".`);
    this.name = 'PathContainmentError';
    this.offendingPath = offendingPath;
  }
}

/**
 * The ONE wording for WHY a read refused, given the typed error that refused
 * it — the cause alone, never the path, so a caller that has already named
 * the path does not name it a second time in the same sentence. `describePath`
 * spells whatever SECOND path a cause genuinely needs (only
 * `UnreachablePathError`'s blocking ancestor) the way that caller spells
 * paths; both entrypoints pass their own.
 */
export function describeUnreadableCause(
  underlying: NotRegularFileError | UnreachablePathError | PathUnreadableError,
  describePath: (absolutePath: string) => string,
): string {
  if (underlying instanceof UnreachablePathError) {
    return `cannot be reached: "${describePath(underlying.blockingAncestor)}" exists and is not a directory.`;
  }
  if (underlying instanceof PathUnreadableError) {
    return `permission was refused, or the path could not be opened (${underlying.errnoCode}).`;
  }
  return `is ${describeNonRegularKind(underlying.kind)}, not a regular file — refusing to read it.`;
}

export function assertPathWithinProjectRoot(root: string, absolutePath: string): void {
  const realRoot = realPathOrNull(root);
  if (realRoot === null) {
    throw new Error(`Refusing write: project root could not be resolved: ${root}`);
  }
  const resolved = resolveNearestExistingAncestor(path.resolve(absolutePath));
  if (resolved === null || !isInside(realRoot, resolved)) {
    throw new PathContainmentError(absolutePath, root);
  }
}

// `assertPathWithinProjectRoot` above deliberately ALLOWS a dangling
// symlink whose (lexical, for a dangling one) target still resolves inside
// the project root — "a project may legitimately contain its own symlinks"
// (this file's own `resolveNearestExistingAncestor` header). A write through
// such a link must not fail with an uncaught `ENOENT` past every caller's
// error handling: every writer in this file and in `fs-upgrade-io.ts`
// creates missing parent directories with `fs.mkdirSync(path.dirname(
// absolutePath), { recursive: true })`, and `path.dirname` on a path
// THROUGH a symlink names the directory CONTAINING the link (which already
// exists — the link itself is a real directory entry there), never the
// directory the OS will actually land in once it follows that link. Note
// the failure this must avoid: `mkdir -p app && ln -s app/missing/
// target.txt app/README.md` followed by a write to `app/README.md` passes
// containment (correctly — `missing/target.txt` resolves inside `app`), but
// a literal `mkdirSync(path.dirname('app/README.md'))` creates nothing
// `missing/` needs, since `app` already exists — `fs.writeFileSync`/
// `fs.renameSync` would then follow the symlink straight into a `missing/`
// directory that was never created. `resolveWriteParentDir` below avoids
// this by resolving the same way `assertPathWithinProjectRoot` does.
/**
 * The directory that must exist before a write or rename into
 * `absolutePath` can succeed, resolving every symlink along the way exactly
 * as `assertPathWithinProjectRoot` already does for containment — the SAME
 * walk (`resolveNearestExistingAncestor`), never a second, independently
 * formulated resolution. The write/rename call itself is still made against
 * the ORIGINAL, unresolved `absolutePath`: this only widens what `mkdirSync`
 * is asked to prepare, so the OS's own symlink-following on the actual I/O
 * call behaves exactly as it always has.
 *
 * Only ever called after `assertPathWithinProjectRoot` has already accepted
 * the same path, so the `null` (symlink-cycle) case below is unreachable in
 * practice — that call would have thrown first. The fallback to the literal
 * `path.dirname` is defensive, not load-bearing, for a state this function
 * is never actually reached in.
 */
export function resolveWriteParentDir(absolutePath: string): string {
  const resolved = resolveNearestExistingAncestor(path.resolve(absolutePath));
  return path.dirname(resolved ?? absolutePath);
}

/**
 * Real `AssertPathWithinRootFn` (`../scaffold/types.ts`) — curries
 * `assertPathWithinProjectRoot` above over one project root, exactly as
 * `createFsCanonicalizeTargetFn` below curries its own containment check
 * over one project root for the SAME reason: `commands/apply.ts` (via
 * `seed-repository.ts` too) and `commands/delete.ts` each learn their
 * applicable root only at dispatch time, and `apply`'s root (`process.
 * cwd()`) is not always `seed <dir>`'s (`dir` itself) — so this is built
 * fresh per command, at the `cli.ts` dispatch site, never once at process
 * start.
 */
export function createFsAssertPathWithinRootFn(projectRoot: string): AssertPathWithinRootFn {
  return function assertPathWithinRoot(absolutePath: string): void {
    assertPathWithinProjectRoot(projectRoot, absolutePath);
  };
}

// This function must resolve symlinks the same way the OS does — left to
// right, one component at a time, from the filesystem root down — rather
// than walking UP from `lexicalCandidate` toward the filesystem root, one
// segment at a time, stopping at the nearest ancestor `fs.realpathSync` can
// resolve, and reattaching every segment below that literally as a plain
// name. That approach treats a DANGLING symlink — one that exists (an
// `lstat` on it succeeds) but whose own target does not (`realpathSync` on
// it therefore fails, exactly like a name that was never created at all) —
// as if it were an ordinary not-yet-existing path component, never as the
// link it actually is. `fs.writeFileSync` and every other write/remove
// syscall do not make that mistake: they follow a symlink's target on every
// component, dangling or not, so a dangling link pointing outside the
// project would silently become the OS's actual write destination while a
// walk-up check kept comparing the wrong (literal, unresolved) path against
// the root — `mkdir -p app && ln -s /outside/nonexistent.txt app/README.md`
// followed by a write to `app/README.md` would pass such a check and land
// on `/outside/nonexistent.txt`. The same gap applies to a dangling link in
// an INTERMEDIATE position, not only the final component: a walk-up
// approach can climb straight past it as just another unresolved segment.
//
// Instead this walk goes left to right, one component at a time, from the
// filesystem root down, following every symlink found — dangling or not,
// final or intermediate — via `lstatSync`
// (which reports the link itself, never silently follows it the way
// `existsSync`/`realpathSync` do) and `readlinkSync`. A component that does
// not exist at all (`lstatSync` throws `ENOENT`) ends the walk: since a
// segment that has never existed cannot itself be a symlink, it and every
// segment still queued behind it are joined onto what has been resolved so
// far literally — this is the ordinary "about to create this path" case a
// write is expected to hit constantly, and it is handled identically
// whether or not any dangling link appeared earlier in the same walk. A
// component that DOES exist as a symlink — whether or not what it points at
// exists — is dereferenced via `readlinkSync`: an absolute target replaces
// the walk's position outright; a relative one is resolved against the
// symlink's OWN containing directory (`path.resolve`, which also collapses
// any `..` the target itself contains) — either way the walk then continues
// from the target, which may itself be another symlink, another dangling
// link, or ground further outside `root` still to be discovered. A cycle of
// symlinks is the only way this walk could fail to terminate, so the number
// of links followed is capped (`MAX_SYMLINK_RESOLUTIONS`) and the walk
// returns `null` — the same fail-closed answer `realpathSync`'s own `ELOOP`
// produces — rather than looping forever.
const MAX_SYMLINK_RESOLUTIONS = 40;

// Exported so the local inventory store's own boundary confirmation
// (`adapters/fs-installed-content-path.ts`, `adapters/fs-inventory-index.ts`)
// can reuse this exact symlink-resolving walk for ITS OWN root — the
// inventory store root, not a project root — rather than a second,
// independently formulated resolution. Unlike `assertPathWithinProjectRoot`
// below, this walk alone tolerates a ROOT that does not exist yet (the
// ordinary shape of the inventory store before its first write), which is
// exactly why the inventory store's own checks call this directly instead of
// that assertion.
export function resolveNearestExistingAncestor(lexicalCandidate: string): string | null {
  const parsed = path.parse(lexicalCandidate);
  const relative = lexicalCandidate.slice(parsed.root.length);
  let queue = relative.length > 0 ? relative.split(path.sep).filter((segment) => segment.length > 0) : [];
  let resolvedPrefix = parsed.root;
  let linkResolutions = 0;

  while (queue.length > 0) {
    const name = queue.shift() as string;
    const candidate = path.join(resolvedPrefix, name);
    let stats;
    try {
      stats = fs.lstatSync(candidate);
    } catch {
      // Nothing stands here at all — this segment, and every segment still
      // queued behind it, cannot exist either (a segment cannot exist
      // beneath a parent that does not), so the whole remainder is reattached
      // literally onto what has been resolved so far.
      return queue.length > 0 ? path.join(candidate, ...queue) : candidate;
    }
    if (!stats.isSymbolicLink()) {
      resolvedPrefix = candidate;
      continue;
    }
    linkResolutions += 1;
    if (linkResolutions > MAX_SYMLINK_RESOLUTIONS) return null; // symlink cycle
    const linkTarget = fs.readlinkSync(candidate);
    const absoluteTarget = path.isAbsolute(linkTarget) ? linkTarget : path.resolve(resolvedPrefix, linkTarget);
    const targetParsed = path.parse(absoluteTarget);
    const targetRelative = absoluteTarget.slice(targetParsed.root.length);
    const targetSegments = targetRelative.length > 0 ? targetRelative.split(path.sep).filter((segment) => segment.length > 0) : [];
    queue = [...targetSegments, ...queue];
    resolvedPrefix = targetParsed.root;
  }
  return resolvedPrefix;
}

// `relativeDir === ''` addresses `templateDir` itself (the payload-root
// enumeration's starting point) - joining a child name onto an empty
// relative dir must yield a bare `entry.name`, never a leading-slash
// `/entry.name`. Every other depth behaves exactly as a plain `/`-join did.
function joinRelative(relativeDir: string, name: string): string {
  return relativeDir === '' ? name : `${relativeDir}/${name}`;
}

/**
 * @param visitedRealDirs real paths of directories already entered. Only a
 *   symlink can make this walk cycle (a plain directory tree cannot contain
 *   itself), and a link back to an ancestor would otherwise recurse forever.
 */
// The one name `walkFiles` skips by default — install-time output, never
// committed template content (`createFsListPayloadFilesFn`'s own doc
// comment). `createFsListTargetFilesFn` below passes an EMPTY skip set
// instead: an arbitrary project target's six-term effective-ownership
// subtraction (`scaffold/delete-plan.ts`) names no `node_modules` exclusion,
// and defaulting this walk to skip it unconditionally would silently add a
// term that formula does not declare.
const DEFAULT_SKIP_NAMES: ReadonlySet<string> = new Set(['node_modules']);

// `unenumerableSink`, when supplied, collects every path this walk would
// otherwise silently drop from its own return value: a FIFO, socket, or
// device found directly; a symlink that is dangling or escapes `root`; and a
// live symlink resolving to any of those same three special kinds (a live
// symlink to a FILE or a DIRECTORY is never dropped at all — both are
// already reported through the ordinary branches below). `createFsListTarget
// FilesFn`'s own candidate enumeration and `createFsListPayloadFilesFn`'s
// template-payload enumeration both still return exactly the files they did
// before this parameter existed; only a caller that supplies a real array
// (`createFsListUnenumerableTargetEntriesFn` below) ever observes it. One
// walk, one cycle guard, for both questions — never a second, independently
// maintained traversal asking the FIFO/socket/device question by itself.
function walkFiles(
  templateDir: string,
  relativeDir: string,
  root: string,
  visitedRealDirs: Set<string>,
  skipNames: ReadonlySet<string> = DEFAULT_SKIP_NAMES,
  unenumerableSink?: string[],
): string[] {
  const absoluteDir = path.join(templateDir, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    // A dot-prefixed entry is ordinary content (see the doc comment above)
    // and is walked/included like any other; only a name in `skipNames` is
    // excluded.
    if (skipNames.has(entry.name)) continue;
    const relativePath = joinRelative(relativeDir, entry.name);

    if (entry.isDirectory()) {
      // `visitedRealDirs` tracks the CURRENT ancestor chain, not "every
      // directory ever visited": a real path is added right before
      // recursing into it and removed right after returning
      // (`descendDirectory` below). Registering an ORDINARY directory's
      // real path too (not only a symlinked one, below) is what lets a
      // symlink further down the walk that cycles back to THIS exact
      // directory - reached the plain way, never through a link - be
      // recognized as an open ancestor. Removing it again on the way back
      // out is what keeps two SIBLING branches that both alias the same
      // real directory (one directly, one through a symlink elsewhere in
      // the tree) from having the second one wrongly skipped as "already
      // visited" - only a cycle back to a directory still open on the
      // current path is a cycle at all.
      files.push(
        ...descendDirectory(templateDir, relativePath, root, visitedRealDirs, undefined, skipNames, unenumerableSink),
      );
      continue;
    }
    if (entry.isFile()) {
      files.push(toPosixPath(relativePath));
      continue;
    }
    if (!entry.isSymbolicLink()) {
      unenumerableSink?.push(toPosixPath(relativePath)); // fifo, socket, device: not content
      continue;
    }

    const resolved = realPathOrNull(path.join(absoluteDir, entry.name));
    if (resolved === null) {
      unenumerableSink?.push(toPosixPath(relativePath)); // broken link
      continue;
    }
    if (!isInside(root, resolved)) {
      unenumerableSink?.push(toPosixPath(relativePath)); // points outside the template
      continue;
    }

    const targetStat = fs.statSync(resolved);
    if (targetStat.isDirectory()) {
      files.push(
        ...descendDirectory(templateDir, relativePath, root, visitedRealDirs, resolved, skipNames, unenumerableSink),
      );
    } else if (targetStat.isFile()) {
      files.push(toPosixPath(relativePath));
    } else {
      unenumerableSink?.push(toPosixPath(relativePath)); // a live symlink to a fifo, socket, or device
    }
  }
  return files;
}

// Enters one directory for the duration of its own subtree walk only:
// resolves its real path (or reuses `knownRealPath` when the caller - the
// symlink branch above - already resolved it), skips it as a CYCLE when
// that real path is already open on the current ancestor chain, otherwise
// marks it open, walks it, and unmarks it again before returning - so the
// mark reflects "currently being descended into", never "ever visited".
function descendDirectory(
  templateDir: string,
  relativeDir: string,
  root: string,
  visitedRealDirs: Set<string>,
  knownRealPath?: string,
  skipNames: ReadonlySet<string> = DEFAULT_SKIP_NAMES,
  unenumerableSink?: string[],
): string[] {
  const absoluteDir = path.join(templateDir, relativeDir);
  const resolvedDir = knownRealPath ?? realPathOrNull(absoluteDir);
  if (resolvedDir !== null && visitedRealDirs.has(resolvedDir)) return []; // cycle back to an open ancestor
  if (resolvedDir !== null) visitedRealDirs.add(resolvedDir);
  try {
    return walkFiles(templateDir, relativeDir, root, visitedRealDirs, skipNames, unenumerableSink);
  } finally {
    if (resolvedDir !== null) visitedRealDirs.delete(resolvedDir);
  }
}

// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
/**
 * The shallowest component of `absolutePath` that exists on disk as something
 * other than a directory, or `null` when the path is simply absent.
 *
 * Only ever consulted once `realpathSync` has already refused the whole path,
 * which happens for both of those cases and reports neither. The walk climbs
 * to the first component that exists at all: everything below it is absent by
 * construction, so if that component is a directory the path is genuinely
 * not there, and if it is anything else — a regular file, a dangling or live
 * symlink the chain cannot be followed through, a FIFO, a device — that is
 * the entry blocking the path, and its name is what a refusal has to carry.
 *
 * `lstat`, not `stat`: a symlink standing on the way is itself the blocking
 * entry, and dereferencing it would report on whatever it aliases instead.
 * The walk terminates at the filesystem root, whose own components are
 * ordinary directories, so no project root has to be threaded in for it.
 */
// Exported so the local inventory store's own content writer
// (`adapters/fs-content-store.ts`) can name the exact blocking component when
// a non-directory entry stands where an installed content path's own
// ancestor directory belongs, rather than letting `fs.mkdirSync` fail with a
// bare, unstructured `ENOTDIR`.
export function firstNonDirectoryComponentOf(absolutePath: string): string | null {
  let candidate = path.resolve(absolutePath);
  for (;;) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(candidate);
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return null; // walked to the filesystem root
      candidate = parent;
      continue;
    }
    return stat.isDirectory() ? null : candidate;
  }
}

/**
 * Real `ListTargetFilesFn` (`../scaffold/delete-plan.ts`) — enumerates every
 * real file reachable under an arbitrary project-relative TARGET's absolute
 * directory, POSIX-relative to it. Unlike `createFsListPayloadFilesFn`
 * above (scoped to a template's own directory, and which unconditionally
 * skips `node_modules`), this walks with an EMPTY skip set: the delete-plan
 * algorithm's six-term effective-ownership subtraction names no
 * `node_modules` exclusion, and skipping it here would silently add a
 * seventh, undeclared term to the ONE formula this algorithm shares
 * verbatim with `apply`.
 *
 * Resolves to `[]`, never a throw, when `absoluteDir` cannot be resolved at
 * all (absent, a broken symlink, or any other `realpath` failure) — an
 * applied target ordinarily exists on disk, but ground already partially or
 * fully removed by hand is not this seam's error to raise; it simply
 * enumerates fewer real candidates.
 *
 * Throws the typed `TargetNotDirectoryError` below, rather than reaching
 * `fs.readdirSync` at all, when `absoluteDir` resolves to something other
 * than a directory — a registered, applied target replaced by an ordinary
 * file (or any other non-directory entry) since it was recorded.
 * `fs.readdirSync` on a non-directory throws a bare `ENOTDIR` with no
 * structure to it, and this seam's own contract (`Promise<string[]>`) gives
 * this function no honest value to invent for "the target is not
 * enumerable" other than `[]` — indistinguishable from a target that is
 * genuinely empty, which `commands/delete.ts` must not be allowed to read as
 * "there is nothing here to preserve or delete". A typed throw is what lets
 * that command tell this fact apart from both cases and report it as its own
 * structured refusal, rather than either an empty deletion plan or a bare
 * `ENOTDIR` reaching the CLI's own top-level catch as an internal error with
 * no JSON envelope at all.
 */
export function createFsListTargetFilesFn(): ListTargetFilesFn {
  return async function listTargetFiles(absoluteDir: string): Promise<string[]> {
    const root = realPathOrNull(absoluteDir);
    if (root === null) {
      // `realpathSync` fails for two different facts, and they must not share
      // an answer: a target that genuinely does not exist (ground already
      // removed by hand — this seam's own contract calls that an ordinary
      // empty enumeration), and a target unreachable because a component ON
      // THE WAY to it is no longer a directory. Returning `[]` for the second
      // would let `commands/delete.ts` compute an empty plan, report success,
      // and strike the target from `targets[]` without having verified that
      // anything was there — the same false success a non-directory AT the
      // target produces, one component higher up.
      const blocking = firstNonDirectoryComponentOf(absoluteDir);
      if (blocking !== null) throw new TargetNotDirectoryError(blocking);
      return [];
    }
    let rootStat: fs.Stats;
    try {
      rootStat = fs.statSync(root);
    } catch {
      return []; // vanished between realpath and stat: nothing real left to enumerate
    }
    if (!rootStat.isDirectory()) {
      throw new TargetNotDirectoryError(absoluteDir);
    }
    try {
      return walkFiles(absoluteDir, '', root, new Set([root]), new Set());
    } catch (error) {
      throw Object.assign(
        new Error(`could not enumerate target directory ${absoluteDir}: ${describeError(error)}`),
        { cause: error },
      );
    }
  };
}

/**
 * `ListTargetFilesFn` (`createFsListTargetFilesFn` above) was asked to
 * enumerate `targetPath`, but whatever now stands there is not a directory
 * at all. Typed, rather than a bare `Error`, so `commands/delete.ts` can
 * report this the same way `apply` and `upgrade` already report a payload
 * path whose on-disk shape cannot be compared — a structured refusal naming
 * the offending path, never an internal failure with no envelope at all
 * under `--json`.
 */
export class TargetNotDirectoryError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string) {
    super(`"${targetPath}" is no longer a directory: its content cannot be enumerated for deletion.`);
    this.name = 'TargetNotDirectoryError';
    this.targetPath = targetPath;
  }
}

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-unenumerable
/**
 * Real `ListUnenumerableTargetEntriesFn` (`../scaffold/delete-plan.ts`) —
 * every path under a target's absolute directory that `createFsListTarget
 * FilesFn` above silently leaves out of its own returned list, because none
 * of the questions THAT seam's `string[]` contract can answer ("is this a
 * comparable file `toDelete`'s candidate pool can include") make sense for
 * it: a FIFO, a socket, a device, a dangling symlink, or a symlink escaping
 * the target's own real root — live or dangling, direct or aliased through
 * another symlink. Before this function existed, every one of those sat in
 * neither `toDelete` nor `toPreserve`: an entry belonging to NEITHER list
 * breaks the one promise `delete`'s whole confirmation gate rests on — that
 * the lists state the blast radius before anything is executed
 * (`cpt-frontx-dod-cli-scaffolding-delete`). `computeDeletionPlan` folds
 * every path this returns into `toPreserve`, after the identical
 * effective-ownership filter its file-based candidates already pass through
 * — ground outside this template's own ownership was never this template's
 * to report either way.
 *
 * Shares `walkFiles`'s own cycle-guarded traversal with `createFsListTarget
 * FilesFn` — the SAME walk, read through its OTHER output channel
 * (`unenumerableSink`) — rather than a second, independently maintained walk
 * asking the identical "what does this directory contain" question a second
 * time.
 */
export function createFsListUnenumerableTargetEntriesFn(): ListUnenumerableTargetEntriesFn {
  return async function listUnenumerableTargetEntries(absoluteDir: string): Promise<string[]> {
    const root = realPathOrNull(absoluteDir);
    if (root === null) return []; // absent, or blocked by a non-directory ancestor: `createFsListTargetFilesFn` already reports either fact on its own
    let rootStat: fs.Stats;
    try {
      rootStat = fs.statSync(root);
    } catch {
      return []; // vanished between realpath and stat: nothing real left to inspect
    }
    if (!rootStat.isDirectory()) return []; // the sibling enumerator already throws `TargetNotDirectoryError` for this exact shape
    const unenumerable: string[] = [];
    try {
      walkFiles(absoluteDir, '', root, new Set([root]), new Set(), unenumerable);
    } catch (error) {
      // The sibling `listTargetFilesFn` call `computeDeletionPlan` always
      // makes first walks this identical tree and would already have thrown
      // for a genuine permission/enumeration failure — reaching here at all
      // means that walk just succeeded a moment ago, so this is a narrow
      // TOCTOU race rather than the ordinary case. Wrapped the same way that
      // sibling wraps its own failure, rather than propagating a bare,
      // unstructured error into a caller that only expects `Promise<
      // string[]>` to resolve.
      throw Object.assign(
        new Error(`could not enumerate target directory ${absoluteDir} for unenumerable entries: ${describeError(error)}`),
        { cause: error },
      );
    }
    return unenumerable;
  };
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-unenumerable
