// Real fs-backed seams for the rewritten upgrade engine
// (`../upgrade/types.ts`'s `ReadDiskEntryFn`, `ListDiskFilesFn`,
// `WriteDiskFileFn`, `RenameDiskFileFn`, `UnlinkDiskFileFn`).
//
// WHY THIS IS NOT `fs-project-io.ts`'s EXISTING WALK. `createFsListTargetFilesFn`
// (`./fs-project-io.ts`) FOLLOWS symlinks: a symlink pointing at a file
// inside the walked root is reported as an ordinary file entry, and a symlink
// pointing at a directory is descended into. That is correct for the
// delete-plan algorithm it serves — a target's real reachable content — but
// it directly contradicts the upgrade classification's own disk-term
// contract, which `cpt-frontx-algo-upgrade-changeset-classify`'s
// `inst-cls-enumerate` states explicitly: "The disk term contributing regular
// files only is what keeps a developer's own symlink, and every ordinary
// directory, out of this enumeration on its own account". Enumerating a
// developer's symlink there would make it a payload-absent path the engine
// then compares and could refuse over, which the FEATURE's own acceptance
// criterion forbids ("A developer's own symlink ... at a path neither payload
// carries is never enumerated and never refuses the upgrade"). So the
// enumeration below is strictly regular-files-only and never follows a link.
//
// The read seam is `lstat`-based for the same reason: `ReadDiskEntryFn` must
// distinguish a SYMLINK from the regular file it points at, because
// `inst-cls-if-not-regular` refuses fail-closed on a symlink sitting where a
// payload declares a path. `fs.statSync` would resolve the link and report
// `'file'`, silently turning a refusal into a comparison.
import fs from 'node:fs';
import path from 'node:path';
import type {
  DiskEntry,
  ListDiskFilesFn,
  ReadDiskEntryFn,
  RenameDiskFileFn,
  UnlinkDiskFileFn,
  WriteDiskFileFn,
} from '../upgrade/types';
import { assertPathWithinProjectRoot, resolveWriteParentDir } from './fs-project-io';

// Install-time output, never committed template content
// (`cpt-frontx-algo-template-manifest-validate-content-self-containment`'s own
// `inst-csc-enumerate-files`). Spelled here rather than imported because
// `adapters/fs-project-io.ts`'s own `DEFAULT_SKIP_NAMES` is module-private; the
// two are the same rule for the same reason.
const PAYLOAD_SKIP_DIR = 'node_modules';

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Real `ReadDiskEntryFn` — what is actually at one absolute path, with a
 * symlink reported AS a symlink (never resolved to its target) and an absence
 * reported as a first-class `'absent'` rather than a throw, since absence is
 * an ordinary comparison input for the classification ("an absent path is
 * unequal to any content, and two absences are equal").
 *
 * Anything that is neither a regular file, a directory, nor a symlink (a
 * FIFO, socket, or device node) is reported as its own `'special'` kind —
 * the identical word `scaffold/existing-content.ts` already uses for the
 * apply-side sibling of this same fact, never a second name for it.
 *
 * NOT folded into `'directory'`, unlike an earlier version of this function:
 * `'directory'` is a PERMITTED ancestor shape (`classify.ts`'s own ancestor
 * probe treats it as ordinary structure to descend through and never flags
 * it), while a special file standing at that same position must block
 * everything beneath it exactly like a symlink does. Collapsing the two let
 * a FIFO standing where an ancestor directory is required pass as a
 * perfectly good directory: an `ADD` whose new ancestor would be created
 * there reached `fs.mkdirSync` at commit time and crashed on
 * `EEXIST`/`ENOTDIR`, and every path already beneath it hit `ENOTDIR` on
 * THIS function's own `lstatSync` call — caught by the `catch` below and
 * reported `'absent'`, which then satisfied the classification's own "two
 * absences are equal" rule and silently reported nothing to do for content
 * this function had never actually been able to read at all.
 *
 * Reported without ever reading the entry's content, and never resolved to
 * `readFileSync` — the check below returns before that call is ever reached
 * for anything but a confirmed regular file. Opening a FIFO for reading
 * blocks forever waiting for a writer that will never arrive; a special file
 * this fail-closed instead of attempted is the only way this seam can name
 * the fact without risking exactly that hang.
 */
export function createFsReadDiskEntryFn(): ReadDiskEntryFn {
  return async function readDiskEntry(absolutePath: string): Promise<DiskEntry> {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch {
      // ENOENT and every other stat failure alike: the engine cannot see
      // content here, which is exactly what `'absent'` means to it. A
      // permission error reported as `'absent'` would classify a path as
      // addable rather than refusing — but the write that followed would
      // fail on the same permission and be caught by the commit algorithm's
      // own recovery, so this cannot silently corrupt anything.
      return { kind: 'absent' };
    }
    if (stat.isSymbolicLink()) return { kind: 'symlink' };
    if (stat.isDirectory()) return { kind: 'directory' };
    if (!stat.isFile()) return { kind: 'special' };
    return { kind: 'file', content: fs.readFileSync(absolutePath, 'utf-8') };
  };
}

/**
 * Real `ListDiskFilesFn` — every REGULAR file reachable under `absoluteDir`,
 * POSIX-relative to it, never following a symlink and never reporting one.
 * Resolves to `[]` when the directory does not exist: an applied target
 * ordinarily does exist, but a target whose ground was removed by hand is not
 * this seam's error to raise — it simply has fewer candidates.
 *
 * Skips `node_modules`, which is NOT a seventh term of the effective-ownership
 * subtraction but the payload definition itself. `cpt-frontx-feature-template-
 * manifest`'s own `inst-csc-enumerate-files` enumerates a template's payload
 * "never descending into a `node_modules` directory (install-time output, never
 * committed template content)" — so a template's `node_modules` was never
 * payload to read in the first place.
 *
 * This was measured, not assumed: this repository's own `template-shell` is
 * 428 MB across 32,813 files, of which 529 are payload and the rest are
 * `node_modules`. Without this skip the resolver's local-origin read acquired
 * all 397 MB of it and then tried to encode it as ONE bundle-envelope string,
 * which exceeds V8's maximum string length — `JSON.stringify` threw
 * `RangeError: Invalid string length`, so `register`/`apply`/`seed` of that
 * template could not complete at all.
 *
 * The commit algorithm's stale-temporary-file reclaim shares this seam and is
 * unaffected in substance: the engine only ever writes payload paths, and
 * payload now definitionally excludes `node_modules`, so no temporary file the
 * engine created can be inside one. Skipping there loses nothing and protects a
 * developer's own files under `node_modules` from a reclaim that has no
 * business reaching them.
 *
 * A PROJECT TARGET walk is a different question and keeps its empty skip set
 * (`createFsListTargetFilesFn`, `../adapters/fs-project-io.ts`): the six-term
 * subtraction genuinely names no `node_modules` exclusion for ground a template
 * owns, and adding one there WOULD be an undeclared seventh term.
 */
export function createFsListDiskFilesFn(): ListDiskFilesFn {
  return async function listDiskFiles(absoluteDir: string): Promise<string[]> {
    if (!fs.existsSync(absoluteDir)) return [];
    return walkRegularFiles(absoluteDir, '');
  };
}

function walkRegularFiles(root: string, relativeDir: string): string[] {
  const absoluteDir = path.join(root, relativeDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    // `withFileTypes` reports the entry itself, unresolved — so a symlink is
    // `isSymbolicLink()`, never `isFile()`/`isDirectory()`. Checked FIRST so
    // no link is ever descended into or counted, which is what makes this
    // walk cycle-free by construction rather than by a visited-set guard
    // (`createFsListTargetFilesFn` needs one precisely because it does
    // follow links).
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      // Payload definition, not an ownership term — see this function's own
      // doc comment for the measurement that forced it.
      if (entry.name === PAYLOAD_SKIP_DIR) continue;
      files.push(...walkRegularFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) files.push(toPosixPath(relativePath));
    // A FIFO, socket, or device: not content, and not a regular file — never
    // added to `files`, and, being neither `isDirectory()` nor
    // `isSymbolicLink()`, never recursed into or skipped-with-a-reason
    // either. This walk is also the one `payload.ts`'s `resolveLocalPayload`
    // reuses to enumerate a `path:` origin TEMPLATE'S OWN source folder
    // (`listFolderFilesFn: deps.listDiskFiles`) — so a special file sitting
    // inside a template's own local folder is never added to that template's
    // `ResolvedPayload.files` map at all. That is not a gap: `ResolvedPayload.
    // files`'s own contract (`../upgrade/types.ts`) is "Regular files only",
    // identically to how this same walk already omits `node_modules` — a
    // special file was never payload CONTENT to begin with, the same way a
    // developer's own undeclared file elsewhere in a target is never payload
    // content either. Nothing in this engine ever learns such a path exists,
    // classifies it, or refuses over it; the template's own author is who
    // would need to know their source folder holds one, which is outside
    // this engine's own concern.
  }
  return files;
}

/**
 * Real `WriteDiskFileFn` — writes `content`, creating parent directories as
 * needed. Used for the staged write's temporary files and for recovery's
 * baseline restoration.
 *
 * CONTAINMENT ESCAPE FIX: `destinationPath`/`tempPath` in `../upgrade/
 * commit.ts` are computed by joining `repoRoot` with a plan-declared
 * project-relative path — proven inside the project only at the CANDIDATE/
 * BASELINE level classification saw it, never re-checked against the real
 * filesystem at write time. A path segment a developer replaced with a
 * symlink to somewhere outside the project between review and commit would
 * otherwise let `fs.writeFileSync` follow it straight past `repoRoot`.
 * `assertPathWithinProjectRoot` (`./fs-project-io.ts`) is the ONE shared
 * "inside the root, symlinks resolved" check every adapter that writes into
 * a project uses; thrown here, it is caught by `commitUpgrade`'s own
 * `inst-com-catch` exactly like any other I/O failure — recovery runs
 * exactly as it would for any other failure at this point — but the outcome
 * `commitUpgrade` reports for THIS class of failure is a rethrow of the
 * original `PathContainmentError`, once recovery has fully returned every
 * already-landed destination to baseline, never its own `INTERNAL` shape.
 * That rethrow propagates past `upgrade/flow.ts` and `commands/upgrade.ts`
 * (neither wraps `commitUpgrade`'s call) to `cli.ts`'s `run()`, which maps
 * `PathContainmentError` to `INVALID_PATH` — the SAME mapping `register`/
 * `apply`/`delete`'s own containment refusals already get. `commitUpgrade`'s
 * own TYPED refusal vocabulary (`CommitOutcome`/`UpgradeRefusalCode`) still
 * never lists `INVALID_PATH` (`upgrade/payload.ts`'s own header explains
 * why) — that vocabulary is for VALUES this algorithm decides to hand back,
 * and a containment escape was never one of upgrade's own decisions to
 * classify, exactly like it is not `register`'s or `apply`'s.
 */
export function createFsWriteDiskFileFn(repoRoot: string): WriteDiskFileFn {
  return async function writeDiskFile(absolutePath: string, content: string): Promise<void> {
    assertPathWithinProjectRoot(repoRoot, absolutePath);
    // `resolveWriteParentDir`, not a literal `path.dirname(absolutePath)`:
    // see `fs-project-io.ts`'s DANGLING-SYMLINK-INSIDE FIX comment. An
    // ALLOWED dangling symlink at (or above) `absolutePath` needs its
    // resolved target's directory created, not the directory literally
    // containing the link — which already exists.
    fs.mkdirSync(resolveWriteParentDir(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf-8');
  };
}

/**
 * Real `RenameDiskFileFn` — the atomic rename that lands one `ADD`/`REPLACE`,
 * creating any parent directory the rename needs (`inst-com-apply-within-
 * boundary` requires exactly that). `fs.renameSync` is atomic within one
 * filesystem, which a temporary file written beside its own destination is by
 * construction — that adjacency is why the staged write places temporaries
 * beside their destinations rather than in a shared temp directory.
 *
 * `to` (the actual landing destination) is proven to stay inside the project
 * root, symlinks resolved, before the rename — see `createFsWriteDiskFileFn`
 * above for why this check exists and how a violation is reported.
 */
export function createFsRenameDiskFileFn(repoRoot: string): RenameDiskFileFn {
  return async function renameDiskFile(from: string, to: string): Promise<void> {
    assertPathWithinProjectRoot(repoRoot, to);
    // See `createFsWriteDiskFileFn` above and `fs-project-io.ts`'s
    // DANGLING-SYMLINK-INSIDE FIX comment: `to` may resolve through an
    // ALLOWED dangling symlink whose target's own directory does not exist
    // yet.
    fs.mkdirSync(resolveWriteParentDir(to), { recursive: true });
    fs.renameSync(from, to);
  };
}

/**
 * Real `UnlinkDiskFileFn` — removes one path, a no-op when already absent.
 * Never removes the directory it leaves empty: `inst-com-apply-within-
 * boundary` requires a `REMOVE` to "unlink each `REMOVE` operation's path
 * without removing the directory it leaves empty", since that directory may
 * hold ground this engine does not own.
 *
 * Proven to stay inside the project root, symlinks resolved, before the
 * unlink — see `createFsWriteDiskFileFn` above for why this check exists.
 */
export function createFsUnlinkDiskFileFn(repoRoot: string): UnlinkDiskFileFn {
  return async function unlinkDiskFile(absolutePath: string): Promise<void> {
    assertPathWithinProjectRoot(repoRoot, absolutePath);
    try {
      fs.unlinkSync(absolutePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // already absent: the intended end state
      throw error;
    }
  };
}
