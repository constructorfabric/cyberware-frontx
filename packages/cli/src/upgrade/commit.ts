// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
// @cpt-algo:cpt-frontx-algo-upgrade-changeset-commit:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-apply:p1
// @cpt-state:cpt-frontx-state-composed-provenance-registration-lifecycle:p2
//
// Lands an APPROVED `UpgradePlan` (`cpt-frontx-algo-upgrade-changeset-
// validate`'s output, reviewed by the developer) through the staged write
// `cpt-frontx-adr-project-upgrade-mechanism` fixes. The ORDERING below is
// the entire correctness argument, not an implementation detail:
//
//   reclaim stale temp -> verify no reserved temp path is occupied by
//   anything but a regular file -> materialize every new temp file -> verify
//   every destination against what classification saw -> only then
//   rename/unlink -> commit {origin,version} atomically -> promote inventory
//   -> refresh the AI bundle
//
// Each rule in that chain exists to close one specific failure window:
//   - Verifying temp occupancy BEFORE any temp file is written is what keeps
//     a symlink, directory, or special file planted at a destination's own
//     reserved temp path from ever being written through or renamed into
//     place - `inst-com-verify-temp-occupancy`. `inst-com-reclaim-stale-temp`
//     already clears the ONE shape (a regular file) this algorithm's own
//     litter could ever take there; this step exists for every other shape,
//     which reclaiming a regular file was never designed to answer.
//   - Materializing EVERY temp file before touching ANY destination means a
//     crash mid-materialization leaves every target exactly as it was
//     (nothing has been renamed yet) - `inst-com-materialize-temp`.
//   - Verifying immediately before the FIRST rename, rather than trusting
//     what classification saw minutes or hours earlier during developer
//     review, closes the window where a developer's own edit could land in
//     the interval between approval and commit - `inst-com-verify-
//     destinations`. It is a precondition check ONLY: it can refuse, but it
//     never recomputes the plan, so "reviewed equals applied" still holds.
//   - Landing the project-state write LAST, after every destination write
//     has landed, is what makes a crashed run's re-run converge instead of
//     refusing: the recorded entry still names the baseline until this
//     write lands, so re-running the identical upgrade sees every
//     already-landed path as already matching the candidate
//     (`inst-cls-if-unchanged`'s disk-equals-candidate precedence) and just
//     finishes the rest - `inst-com-commit-state`.
//   - Promotion and the AI-bundle refresh are two SEPARATE writes to two
//     SEPARATE stores that happen AFTER that commit point, on purpose: a
//     failure in either must never be allowed to unwind a transition that
//     has already committed, because both are re-derivable (by resolving
//     the now-recorded origin) while the commit itself is not - `inst-com-
//     replace-inventory` / `inst-com-refresh-bundle`.
//
// This is why a promotion/bundle failure and an in-TRY I/O failure are
// caught by two structurally DIFFERENT handlers below rather than one: they
// make OPPOSITE claims about the world (nothing committed vs. the
// transition stands committed), and folding them into one catch would make
// it possible to report one as the other.
import path from 'node:path';
import { PathContainmentError } from '../adapters/fs-project-io';
import { ReservedTempPathOccupiedError } from '../adapters/fs-upgrade-io';
import { RESERVED_TEMP_SUFFIX, isReservedTempName } from '../paths/reserved-temp-name';
import { joinUnderTarget } from '../paths/relative-path';
import { isWithinEffectiveOwnership } from '../scaffold/effective-ownership';
import { mutateProjectState } from '../project-state/io';
import type { ReadProjectStateFn, WriteProjectStateFn, TemplateEntry } from '../project-state/types';
import type {
  ListDiskFilesFn,
  ReadDiskEntryFn,
  RenameDiskFileFn,
  UnlinkDiskFileFn,
  UpgradeOperation,
  UpgradePlan,
  UpgradeRefusalCode,
  WriteDiskFileFn,
} from './types';

export type CommitOutcome =
  // `reclaimedTempPaths` names every stale reserved-suffix path
  // `inst-com-reclaim-stale-temp` removed for THIS attempt, project-relative
  // - `[]` on the ordinary run that finds none. Surfaced here, on the one
  // success shape this algorithm returns, rather than through a parallel
  // reporting channel: a developer whose prior run crashed and left real
  // litter on disk is otherwise never told it was cleared.
  | { ok: true; plan: UpgradePlan; reclaimedTempPaths: string[] }
  | {
      ok: false;
      code: Extract<UpgradeRefusalCode, 'CONTENT_CONFLICT'>;
      message: string;
      // `tempPath` is present only for a temp-occupancy refusal (pre-flight
      // or the exclusive-create backstop below) - a drift refusal
      // (`inst-com-return-drift-conflict`) names a destination with nothing
      // reserved-suffixed to report alongside it.
      details: { drifted: { target: string; path: string; tempPath?: string }[] };
    }
  | { ok: false; code: Extract<UpgradeRefusalCode, 'INTERNAL'>; message: string; details?: Record<string, unknown> };

export interface CommitDeps {
  repoRoot: string;
  readDiskEntry: ReadDiskEntryFn;
  writeDiskFile: WriteDiskFileFn;
  renameDiskFile: RenameDiskFileFn;
  unlinkDiskFile: UnlinkDiskFileFn;
  // For `inst-com-reclaim-stale-temp`: enumerates a target's directory so
  // any leftover `RESERVED_TEMP_SUFFIX` file from a prior crashed attempt
  // can be found and removed before this attempt stages its own.
  listDiskFiles: ListDiskFilesFn;
  readProjectStateFn: ReadProjectStateFn;
  writeProjectStateFn: WriteProjectStateFn;
  // `inst-com-replace-inventory` (step 12): promotes the staged candidate
  // content into `name`'s local inventory slot. A SEPARATE write to a
  // SEPARATE store from `inst-com-commit-state`'s project-state write -
  // never described as part of that write, and never allowed to unwind it.
  // Rejecting signals failure; the actual local-inventory mechanics are the
  // wiring layer's concern, not this algorithm's - keeping this seam a bare
  // callback is what lets `mutateProjectState`'s already-committed write
  // stand untouched by whatever this does.
  promoteInventory: (name: string) => Promise<void>;
  // `inst-com-refresh-bundle` (step 14): refreshes `name`'s CLI-owned
  // `.frontx/ai/<manifest-name>/` bundle through the SAME step `apply`/
  // `delete` use (`cpt-frontx-algo-cli-scaffolding-ai-bundle`,
  // `materializeOrRemoveAiBundle` in `../scaffold/ai-bundle.ts`). This
  // algorithm does not call that function directly - doing so would need
  // the manifest/payload plumbing `commitUpgrade` is never handed, and
  // would risk a second, drifting idea of "refresh". The wiring layer
  // (this feature's `flow.ts`, not yet written) closes over that function
  // and the resolved payload to build this callback.
  refreshAiBundle: (name: string) => Promise<void>;
}

// ADD/REPLACE always carry `newContent` per `UpgradeOperation`'s own
// contract ("for ADD/REPLACE only") - but that contract lives in a comment,
// not in the type, because `UpgradeOperation` is not a discriminated union
// keyed on `op`. This turns a violation of that contract into an ordinary
// I/O-phase failure (caught by `inst-com-catch` like any other) instead of
// a silent `undefined` write reaching `writeDiskFile`.
function requireNewContent(op: UpgradeOperation): string {
  if (op.newContent === undefined) {
    throw new Error(
      `Upgrade plan operation "${op.op}" for "${op.path}" in target "${op.target}" carries no content to materialize.`,
    );
  }
  return op.newContent;
}

function destinationPath(repoRoot: string, op: UpgradeOperation): string {
  // `op.path` is already the FULL project-relative POSIX path of the
  // destination (`UpgradeOperation`'s own comment), not a target-relative
  // fragment that would need re-joining under `op.target` - so a plain
  // `path.join` is exactly right here and carries none of the `target ===
  // '.'` string-concatenation hazard that joining a target-relative
  // fragment under a target would (`node`'s `path.join` normalizes a `.`
  // segment away on its own, unlike `${a}/${b}` template concatenation).
  return path.join(repoRoot, op.path);
}

// Beside its destination, named by APPENDING the reserved suffix to the
// destination's own filename (`inst-com-materialize-temp`). Since a
// filesystem path is `directory + separator + filename`, appending the
// suffix to the very end of the full path string is byte-identical to
// appending it to just the filename - no `path.dirname`/`path.basename`
// round-trip needed.
function tempPath(destAbsolutePath: string): string {
  return destAbsolutePath + RESERVED_TEMP_SUFFIX;
}

/**
 * `inst-com-reclaim-stale-temp` - removes any REGULAR FILE matching
 * `RESERVED_TEMP_SUFFIX` already sitting inside any of the plan's targets,
 * left behind by a prior attempt on this name that crashed before landing
 * it. Runs BEFORE any new temp file is materialized, so this attempt's own
 * temp files are never mistaken for stale ones and never collide with a
 * leftover of the same name.
 *
 * REGULAR FILE only - the same restriction `deps.listDiskFiles` already
 * enforces by construction (it never reports a symlink, a directory, or a
 * special file). That is deliberate here, not a blind spot this function
 * happens to inherit: a regular file is the only shape THIS algorithm's own
 * staged write ever produces at a reserved-suffix path, so it is the only
 * shape this step can reclaim with any confidence that it is reclaiming its
 * own past litter. Anything else standing at such a path is a different
 * question `verifyTempOccupancy` below answers, deliberately not folded into
 * this same walk - see that function's own header for why REFUSAL, not
 * reclamation, is the answer for those shapes.
 *
 * Scoped to each target's EFFECTIVE OWNERSHIP, which is what the step's own
 * text ("already inside any target's effective ownership") and the DoD both
 * require - not to the target's whole directory tree.
 *
 * The distinction is the whole point of this step. Its justification is that a
 * stale temp file can only have been written by THIS algorithm; that argument
 * covers files the engine WROTE, but it does not license deleting a file the
 * engine did not. Walking the unfiltered tree would unlink a developer's own
 * file that merely happens to end in the reserved suffix wherever it sits -
 * inside a `projectOwnedRoots` entry, an `excludedSubtrees` subtree, another
 * template's nested target or origin folder, or, for a target at the project
 * root, even inside `.git` or `node_modules` (the enumeration adapter
 * deliberately applies no skip list). Deleting a developer's file before their
 * approval has even been executed against is exactly the failure this step's
 * reserved-naming convention exists to make impossible.
 *
 * The boundary comes from the plan (`UpgradePlan.exclusionRootsByTarget`),
 * recorded by the classification that computed it - never recomputed here,
 * which would be a second formulation of a boundary this algorithm is not
 * handed the manifests to derive.
 */
// Returns every path this call actually reclaimed, project-relative — the
// developer's crashed prior run left real litter on disk, and `inst-com-
// return-success` reports this list back so a re-run is not the only way to
// learn it was cleared.
async function reclaimStaleTempFiles(
  plan: UpgradePlan,
  deps: Pick<CommitDeps, 'repoRoot' | 'listDiskFiles' | 'unlinkDiskFile'>,
): Promise<string[]> {
  const reclaimed: string[] = [];
  for (const target of plan.targets) {
    const exclusionRoots = plan.exclusionRootsByTarget[target] ?? [];
    const absoluteTargetDir = path.join(deps.repoRoot, target);
    const relativeFiles = await deps.listDiskFiles(absoluteTargetDir);
    for (const relativeFile of relativeFiles) {
      if (!isReservedTempName(relativeFile)) continue;
      const projectRelative = joinUnderTarget(target, relativeFile);
      if (!isWithinEffectiveOwnership(projectRelative, target, exclusionRoots)) continue;
      await deps.unlinkDiskFile(path.join(absoluteTargetDir, relativeFile));
      reclaimed.push(projectRelative);
    }
  }
  return reclaimed;
}

/**
 * `inst-com-verify-temp-occupancy` - for every `ADD`/`REPLACE` operation,
 * inspects what already stands at its OWN reserved temporary path
 * (`tempPath`) before `inst-com-materialize-temp` below ever writes to it.
 * `REMOVE` never stages one, so this is confined to the same
 * `addOrReplaceOps` list materialization itself iterates.
 *
 * Nothing but this engine's own staged write is entitled to have placed
 * anything at a path shaped by `RESERVED_TEMP_SUFFIX` - the very reason
 * `inst-cls-enumerate` excludes it from every comparison and
 * `inst-com-reclaim-stale-temp` above reclaims a stale REGULAR FILE there.
 * But a regular file is the ONLY shape this algorithm's own convention ever
 * produces at that path: `createFsWriteDiskFileFn` (`../adapters/
 * fs-upgrade-io.ts`) always writes plain file content, never a directory, a
 * symlink, or a special file. So finding one of THOSE shapes there is proof
 * that something else placed it, regardless of when or how - and
 * `createFsWriteDiskFileFn` does not open with `O_NOFOLLOW`: writing through
 * a live symlink standing at this exact path silently lands the new content
 * wherever the link actually points, and the rename that follows then moves
 * the LINK itself - not a regular file - into the destination. That is the
 * whole failure this check exists to make impossible: a developer's own
 * file destroyed at a path this engine never named, and a payload
 * destination left as a symlink instead of the regular file it must always
 * be.
 *
 * REFUSE, never reclaim, is the deliberate choice for every one of these
 * shapes - unlike `createFsCopyBundleFn`'s `clearBundleDestination`
 * (`../adapters/fs-ai-bundle.ts`), which unconditionally clears whatever
 * stands at `.frontx/ai/<manifest-name>/` before every copy. That precedent
 * does not transfer here. ADR 0031 makes the ENTIRE bundle path CLI-owned
 * ground at every moment it exists - no template and no developer ever has a
 * legitimate reason to put anything there, at any time, so clearing it is
 * reclaiming territory only this package has ever had a claim to. A reserved
 * TEMP path is a different kind of ground: it sits directly beside a file a
 * developer owns and edits freely, distinguished from it only by a suffix,
 * and only for the brief span of one commit attempt. This algorithm cannot
 * tell a deliberately planted symlink apart from a developer's own
 * accidental same-named file by inspecting it, and unlike the
 * always-safe-to-discard bundle folder, guessing wrong here means either
 * destroying a developer's file through a symlink or silently writing
 * through content this plan was never reviewed against. Refusing costs the
 * developer nothing they had before - the upgrade simply does not proceed,
 * and every target is untouched, exactly like any other refusal this step
 * returns before the first rename; reclaiming risks the exact destruction
 * this check exists to prevent. A directory at this exact path is refused
 * the same way for the same reason: this algorithm never creates one there
 * either, and `fs.renameSync`'s failure mode for a non-empty directory
 * standing at its destination is no safer to guess through than a symlink's
 * is.
 */
async function verifyTempOccupancy(
  addOrReplaceOps: readonly UpgradeOperation[],
  deps: Pick<CommitDeps, 'repoRoot' | 'readDiskEntry'>,
): Promise<{ target: string; path: string; tempPath: string }[]> {
  const occupied: { target: string; path: string; tempPath: string }[] = [];
  for (const op of addOrReplaceOps) {
    const temp = tempPath(destinationPath(deps.repoRoot, op));
    const entry = await deps.readDiskEntry(temp);
    // `'file'` (this attempt's own reclaimed-or-untouched scratch ground) and
    // `'absent'` (the ordinary case) are the only two shapes this engine's
    // own convention ever produces or expects here - both are safe for
    // `inst-com-materialize-temp` to overwrite unconditionally next.
    if (entry.kind === 'directory' || entry.kind === 'symlink' || entry.kind === 'special') {
      // `tempPath(destinationPath(...))` re-derived project-relative rather
      // than carried as the absolute `temp` above: `op.path` is already the
      // full project-relative path, and appending the reserved suffix to it
      // is byte-identical to appending it to the absolute form (`tempPath`'s
      // own doc comment) - so this needs no second join through `repoRoot`.
      // Naming THIS path, not only `op.path` (the destination), is the whole
      // point: the destination is what the developer approved, but it is the
      // reserved temp path where the offending shape actually stands.
      occupied.push({ target: op.target, path: op.path, tempPath: op.path + RESERVED_TEMP_SUFFIX });
    }
  }
  return occupied;
}

/**
 * `cpt-frontx-algo-upgrade-changeset-commit` - lands an approved
 * `UpgradePlan` through the staged write described in this file's header
 * comment. See `CommitOutcome` for the three shapes this can return.
 */
export async function commitUpgrade(plan: UpgradePlan, deps: CommitDeps): Promise<CommitOutcome> {
  const addOrReplaceOps = plan.operations.filter((op) => op.op === 'ADD' || op.op === 'REPLACE');
  const removeOps = plan.operations.filter((op) => op.op === 'REMOVE');
  // KEEP_LOCAL and UNCHANGED never appear in either list above, which is
  // exactly what "never opened for writing at all" means in code: no seam
  // in this module is ever called with either kind's path.

  // Every op whose rename/unlink has ACTUALLY completed, in landing order -
  // recomputed fresh on every call, never carried between attempts. This is
  // exactly what `inst-com-restore-on-error` needs to know what to undo: a
  // failure mid-way through the apply-within-boundary loop must return only
  // the destinations that got there, never the ones the loop never reached.
  const landedOps: UpgradeOperation[] = [];

  // Declared here, OUTSIDE the `TRY`, so the `CATCH` below can see which temp
  // files this attempt actually materialized — not only which ops landed.
  // `inst-com-restore-on-error` needs both: `landedOps` names what to return
  // to baseline, and this map names this attempt's own litter that never
  // became a destination at all, which recovery must sweep up rather than
  // leave behind for a "fully recovered" report to be true.
  const tempPathByOp = new Map<UpgradeOperation, string>();

  // Declared here, OUTSIDE the `TRY`, for the identical reason `landedOps`/
  // `tempPathByOp` above are: `inst-com-return-success` reads it after the
  // `TRY` has completed, past the block scope its own assignment lives in.
  // No initializer: every `CATCH` branch below returns or rethrows, so this
  // is definitely assigned by the time the success path reads it.
  let reclaimedTempPaths: string[];

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-try
  try {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-reclaim-stale-temp
    reclaimedTempPaths = await reclaimStaleTempFiles(plan, deps);
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-reclaim-stale-temp

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-verify-temp-occupancy
    const occupiedTempPaths = await verifyTempOccupancy(addOrReplaceOps, deps);
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-verify-temp-occupancy

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-temp-occupied
    if (occupiedTempPaths.length > 0) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-temp-occupied
      // Nothing has been materialised or touched at this point, for this
      // destination or any other - this check runs before the first temp
      // file of THIS attempt is ever written, exactly like
      // `inst-com-if-drift-detected` below runs before the first rename.
      // Reuses that same refusal shape (`CONTENT_CONFLICT` / `drifted`)
      // rather than a second vocabulary for "something is wrong at a
      // destination's own staging ground" - the caller does not need a new
      // code to learn it must resolve the offending path and re-run.
      return {
        ok: false,
        code: 'CONTENT_CONFLICT',
        message:
          `${plan.name}'s upgrade was refused: ${occupiedTempPaths.length} destination(s) cannot be staged because ` +
          'something other than a regular file already stands at their reserved temporary path, which this engine ' +
          'never creates there itself. Nothing was written; remove the offending path(s) and re-run the upgrade.',
        details: { drifted: occupiedTempPaths },
      };
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-temp-occupied
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-temp-occupied

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-materialize-temp
    // For EVERY ADD/REPLACE across EVERY target - never destination paths,
    // only their beside-it temp files - so a crash anywhere in this loop
    // leaves every destination exactly as it was (nothing here mutates a
    // destination path).
    for (const op of addOrReplaceOps) {
      const dest = destinationPath(deps.repoRoot, op);
      const temp = tempPath(dest);
      try {
        await deps.writeDiskFile(temp, requireNewContent(op));
      } catch (writeError) {
        // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-temp-occupied-at-write
        if (writeError instanceof ReservedTempPathOccupiedError) {
          // The residual window `inst-com-verify-temp-occupancy` cannot
          // close by itself: something occupied THIS op's own reserved temp
          // path between that check and this write. The real write seam's
          // own exclusive-create call is the backstop that turns the window
          // into an EEXIST rather than a silent write-through or a moved
          // symlink; reported here through the identical refusal shape
          // `inst-com-return-temp-occupied` already uses, never as an
          // internal failure — nothing has been renamed yet, so there is
          // still nothing to restore, only this attempt's own already-
          // materialized temp files (for earlier operations in this same
          // loop) left to sweep before returning.
          for (const priorTemp of tempPathByOp.values()) {
            await deps.unlinkDiskFile(priorTemp).catch(() => undefined);
          }
          // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-temp-occupied-at-write
          return {
            ok: false,
            code: 'CONTENT_CONFLICT',
            message:
              `${plan.name}'s upgrade was refused: the destination "${op.path}" cannot be staged because something ` +
              'other than a regular file now occupies its reserved temporary path, which this engine never creates ' +
              'there itself. Nothing was written; remove the offending path and re-run the upgrade.',
            details: { drifted: [{ target: op.target, path: op.path, tempPath: op.path + RESERVED_TEMP_SUFFIX }] },
          };
          // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-temp-occupied-at-write
        }
        // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-temp-occupied-at-write
        throw writeError;
      }
      tempPathByOp.set(op, temp);
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-materialize-temp

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-verify-destinations
    // Once EVERY temp file above exists, and immediately before the FIRST
    // rename: re-check every destination the plan actually WRITES to
    // (ADD/REPLACE/REMOVE) against `expectedDisk` - what classification saw
    // for it. KEEP_LOCAL/UNCHANGED are excluded from this loop on purpose:
    // nothing is ever planned for them regardless of their current disk
    // state, so re-checking them here would not be a precondition on
    // anything this algorithm is about to do.
    const drifted: { target: string; path: string }[] = [];
    for (const op of [...addOrReplaceOps, ...removeOps]) {
      const dest = destinationPath(deps.repoRoot, op);
      const entry = await deps.readDiskEntry(dest);
      // A directory, a symlink, or a special file (a FIFO, socket, or
      // device) is drift OUTRIGHT, never folded into a content comparison.
      // Collapsing any of them to `null` (as "not a file") made it compare
      // EQUAL to an `ADD`'s `expectedDisk`, which is `null` because
      // classification saw an absence — so a symlink, directory, or special
      // file the developer created at that path between review and this
      // moment was reported as "unchanged" and the rename proceeded. For a
      // directory the rename then fails and is recovered (mislabelled, but
      // nothing lost); for a SYMLINK, `rename(2)` replaces the link silently
      // and the developer's own symlink is destroyed; for a SPECIAL file,
      // `rename(2)` replaces it just as silently, destroying it identically
      // — in precisely the window this check exists to close. Classification
      // itself refuses fail-closed on the identical disk state
      // (`inst-cls-if-not-regular`), so treating any of these as anything but
      // drift here would also make this check disagree with the
      // classification whose result it is verifying.
      if (entry.kind === 'directory' || entry.kind === 'symlink' || entry.kind === 'special') {
        drifted.push({ target: op.target, path: op.path });
        continue;
      }
      const currentContent = entry.kind === 'file' ? entry.content : null;
      if (currentContent !== op.expectedDisk) {
        drifted.push({ target: op.target, path: op.path });
      }
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-verify-destinations

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-drift-detected
    if (drifted.length > 0) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-drift-conflict
      // No destination has been touched at this point - every write above
      // landed on a TEMP path, and every read above was a read - so there
      // is nothing to recover. This is a precondition check, never a
      // recomputation: it can only refuse, never change what was approved.
      // A write that lands during the rename phase itself, after this
      // check, is NOT detectable here; the repository's own version
      // control is the remedy for that residual window (ADR 0021).
      return {
        ok: false,
        code: 'CONTENT_CONFLICT',
        message:
          `${plan.name}'s upgrade was refused: ${drifted.length} destination(s) no longer hold what classification saw ` +
          'for them. Nothing was written; re-run the upgrade to review the current state.',
        details: { drifted },
      };
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-drift-conflict
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-drift-detected

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-apply-within-boundary
    // Only now, past the verification above, does any destination path get
    // touched. `renameDiskFile`/`unlinkDiskFile` are trusted to create any
    // parent directory a rename needs and to never remove the directory an
    // unlink leaves empty (both real-adapter contracts this module does not
    // re-implement).
    for (const op of addOrReplaceOps) {
      const temp = tempPathByOp.get(op);
      if (temp === undefined) {
        // Unreachable by construction (every `addOrReplaceOps` entry was
        // given a temp path above) - guarded rather than asserted with `!`
        // to keep this module free of non-null assertions.
        throw new Error(`Internal: no temp file was staged for "${op.path}" before the rename phase.`);
      }
      await deps.renameDiskFile(temp, destinationPath(deps.repoRoot, op));
      landedOps.push(op);
    }
    for (const op of removeOps) {
      await deps.unlinkDiskFile(destinationPath(deps.repoRoot, op));
      landedOps.push(op);
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-apply-within-boundary
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-try
  } catch (caught) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-catch
    // Any I/O failure from reclaiming, verifying temp occupancy,
    // materializing, verifying destinations, or the destination-write step
    // lands here - and ONLY those; a promotion or
    // bundle-refresh failure below is caught by its own separate handler,
    // because those two failures leave the transition COMMITTED while this
    // one must leave NOTHING committed. Folding them together would erase
    // that distinction.
    const originalFailureMessage = caught instanceof Error ? caught.message : String(caught);

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-restore-on-error
    // Return every ALREADY-LANDED destination to its baseline: write
    // `baselineContent` where the baseline carries the path (a landed
    // REPLACE), unlink where it does not (a landed ADD is reversed by
    // unlinking - never by writing content the baseline does not have).
    // A failure caught before the first rename lands no destination, so
    // `landedOps` is empty and this loop is vacuously, trivially
    // successful - exactly what the FEATURE requires for that case.
    const unrecovered: { target: string; path: string }[] = [];
    for (const op of landedOps) {
      const dest = destinationPath(deps.repoRoot, op);
      try {
        if (op.baselineContent !== null) {
          await deps.writeDiskFile(dest, op.baselineContent);
        } else {
          await deps.unlinkDiskFile(dest);
        }
      } catch {
        unrecovered.push({ target: op.target, path: op.path });
      }
    }

    // Also sweep this attempt's OWN litter: every temp file materialized in
    // `inst-com-materialize-temp` above whose op never reached the rename
    // phase — `landedOps` never contains it, since a rename never landed —
    // is still sitting on disk beside its destination. It was never a
    // destination, so there is no baseline content to write back for it; its
    // state before this attempt began was simply not existing, and recovery
    // means removing it, exactly the way a landed `ADD` is reversed by
    // unlinking rather than by writing content the baseline does not have.
    // Left behind, it would sit there indefinitely: the NEXT upgrade of this
    // name would eventually reclaim it as a stale temp file
    // (`inst-com-reclaim-stale-temp`), but that step exists for a prior
    // CRASH this `CATCH` never observed, not for tidying up after a failure
    // this very run already caught and is about to report as recovered. A
    // failure to remove it is exactly as much a recovery failure as failing
    // to return a landed destination to baseline is — either way, something
    // this attempt is responsible for is left in a state the developer never
    // approved and was never told about — so it is folded into the SAME
    // `unrecovered` list rather than tracked and reported separately: one
    // list of "what this attempt could not undo," not two.
    const landedSet = new Set(landedOps);
    for (const [op, temp] of tempPathByOp) {
      if (landedSet.has(op)) continue; // renamed away already - nothing left here to remove
      try {
        await deps.unlinkDiskFile(temp);
      } catch {
        unrecovered.push({ target: op.target, path: op.path });
      }
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-restore-on-error

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-recovery-succeeds
    if (unrecovered.length === 0) {
      // A CONTAINMENT refusal is reported through the SAME channel every
      // other command's containment refusal already uses, never
      // re-classified into this algorithm's own generic `INTERNAL` shape —
      // `cli.ts`'s `run()` catches `PathContainmentError` specifically and
      // maps it to an `INVALID_PATH` envelope with the user-error exit,
      // exactly as it does for `register`/`apply`/`delete`. Recovery above
      // already ran to completion for this error exactly like any other
      // failure caught here — every already-landed destination is back at
      // baseline before this rethrow, so nothing about that discipline is
      // skipped for this error class. This is a RETHROW, not a second
      // formulation of what containment means: `PathContainmentError`
      // itself, and the one check that produces it
      // (`assertPathWithinProjectRoot`), are untouched here.
      if (caught instanceof PathContainmentError) {
        throw caught;
      }
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-failure
      // Every target, the project state store, and the inventory entry are
      // exactly as they were before this attempt: nothing below this point
      // (project-state commit, promotion, bundle refresh) has run yet.
      return {
        ok: false,
        code: 'INTERNAL',
        message: `${plan.name}'s upgrade failed and was fully recovered to its baseline: ${originalFailureMessage}`,
        details: { originalFailure: originalFailureMessage },
      };
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-failure
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-recovery-succeeds

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-else-recovery-fails
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-recovery-failure
    // `templates[name]` and the inventory entry remain untouched (the
    // commit point below never ran), though one or more destination paths
    // may not be at their baseline state - named explicitly so no
    // partially-recovered target is ever reported as clean.
    return {
      ok: false,
      code: 'INTERNAL',
      message:
        `${plan.name}'s upgrade failed and recovery could not restore ${unrecovered.length} path(s): ${originalFailureMessage}`,
      details: { originalFailure: originalFailureMessage, unrecovered },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-recovery-failure
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-else-recovery-fails
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-catch
  }

  // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-to-applied
  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-commit-state
  // THE single atomic write that is this transition's commit point. It
  // lands ONLY here, after every target's destination writes have landed -
  // never earlier, never as a side effect of validation - so a crash or
  // failure before this line leaves the recorded entry exactly at the
  // baseline it started from (ADR 0021, "the single atomic write of the
  // project state document"). `previous` is set to `plan.from` regardless
  // of whether `from` itself carried a `previous` - reversal always goes
  // back exactly one generation, never further.
  const entry: TemplateEntry = {
    origin: plan.to.origin,
    version: plan.to.version,
    targets: plan.targets,
    previous: { origin: plan.from.origin, version: plan.from.version },
    // The NEW (candidate) payload's own declared `excludedSubtrees`, not the
    // baseline's — an upgrade can narrow or widen what a name excludes, and
    // `scaffold/delete-plan.ts`'s own recorded-value join
    // (`inst-dp-if-recorded-exclusions`) must see whichever declaration is
    // now actually registered.
    excludedSubtrees: plan.toExcludedSubtrees,
  };
  // `mutateProjectState` reports a malformed existing document as
  // `{ ok: false }` but lets the WRITE itself throw (`project-state/io.ts`
  // awaits `writeProjectStateFn` with no handler of its own) - so both
  // shapes are collected here into the ONE outcome
  // `inst-com-if-commit-state-fails` describes. Issue #506 was exactly a
  // store write escaping its function's declared `{ok:false}` contract
  // after project files had already been rewritten; letting a throw from
  // this line past `CommitOutcome` would be that same defect on this
  // engine's own commit point.
  const stateWrite = await mutateProjectState(
    deps.repoRoot,
    { kind: 'set-template', name: plan.name, entry },
    deps.readProjectStateFn,
    deps.writeProjectStateFn,
  ).catch((caught: unknown) => ({
    ok: false as const,
    error: 'INTERNAL' as const,
    message: caught instanceof Error ? caught.message : String(caught),
  }));
  if (!stateWrite.ok) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-commit-state-fails
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-commit-state-failure
    // Every destination write has already landed by this point, so - unlike
    // every INTERNAL above - this is NOT a recovered-to-baseline outcome,
    // and nothing is rolled back. The recorded entry still names the
    // baseline, which is precisely what lets a re-run of the identical
    // upgrade converge (`inst-cls-if-unchanged`'s disk-equals-candidate
    // precedence) rather than refuse - the same convergence a hard crash at
    // this exact point already relies on. This is the whole-file model's
    // answer to issue #506, which the retired region-merge engine answered
    // by moving its separate `.frontx/provenance.json` write inside the
    // rollback boundary: that engine had TWO stores to keep consistent and
    // a snapshot to restore from, while this one has a single commit point
    // that lands last and a baseline payload that is re-resolvable rather
    // than stored, so the failure is reported truthfully instead of
    // triggering a rollback that would undo approved work to recover a
    // document that was never written.
    return {
      ok: false,
      code: 'INTERNAL',
      message: `${plan.name}'s destination writes landed, but the project state store could not be updated: ${stateWrite.message}`,
      details: { projectStateError: stateWrite.message },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-commit-state-failure
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-commit-state-fails
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-commit-state
  // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-to-applied

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-replace-inventory
  // A SEPARATE write to a SEPARATE store, never described as part of the
  // write above - two writes to two different stores are never one atomic
  // write (ADR 0021). Caught by its OWN handler, never the in-TRY one
  // above: a promotion failure must never unwind the transition that just
  // committed.
  try {
    await deps.promoteInventory(plan.name);
  } catch (caught) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-promotion-fails
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-promotion-failure
    // The transition itself STANDS committed - `templates[name].origin`/
    // `.version` and the preceding pair recorded above remain exactly as
    // written - because the slot's content is re-derivable by resolving
    // the now-recorded origin, the same resolution every command needing
    // that content already performs when it finds nothing staged.
    return {
      ok: false,
      code: 'INTERNAL',
      message: `${plan.name}'s transition committed, but its local inventory slot could not be replaced: ${caught instanceof Error ? caught.message : String(caught)}`,
      details: { slot: plan.name },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-promotion-failure
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-promotion-fails
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-replace-inventory

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-refresh-bundle
  // Reuses the SAME CLI-owned step `apply`/`delete` use
  // (`cpt-frontx-algo-cli-scaffolding-ai-bundle`) through the
  // `refreshAiBundle` seam this module was handed - never a second bundle
  // mechanism written here.
  try {
    await deps.refreshAiBundle(plan.name);
  } catch (caught) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-bundle-refresh-fails
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-bundle-refresh-failure
    // The transition AND the promoted inventory entry both stand - defined
    // the same way a promotion failure is, because the bundle content is
    // re-derivable from the same installed content path the refresh step
    // reads.
    return {
      ok: false,
      code: 'INTERNAL',
      message: `${plan.name}'s transition and inventory promotion both landed, but its AI-extension bundle could not be refreshed: ${caught instanceof Error ? caught.message : String(caught)}`,
      details: { bundle: plan.name },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-bundle-refresh-failure
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-if-bundle-refresh-fails
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-refresh-bundle

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-success
  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-report-reclaimed-temp
  return { ok: true, plan, reclaimedTempPaths };
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-report-reclaimed-temp
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-commit:p1:inst-com-return-success
}
