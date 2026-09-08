// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-delete-target:p1
// @cpt-state:cpt-frontx-state-cli-scaffolding-delete-op:p1
// @cpt-state:cpt-frontx-state-composed-provenance-registration-lifecycle:p2
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-delete:p1
//
// `delete <target>` — cpt-frontx-flow-cli-scaffolding-delete-target. Computes
// the deletion plan (`../scaffold/delete-plan.ts`), gates removal on
// explicit confirmation (interactive, defaulting to No) or the `--json`
// `CONFIRMATION_REQUIRED`/`--yes` protocol, removes the plan's `toDelete`
// ground from disk, and removes `<target>` from its owning template's
// `targets[]` entry in the single project state document
// (`../project-state/io.ts`) — through the injected `ReadProjectStateFn`/
// `WriteProjectStateFn` seams, exactly as `register`/`unregister`/`ownership`
// already do: no direct filesystem access here beyond what the injected
// `ListTargetFilesFn`/`RemoveProjectFileFn` seams already isolate.
//
// AI-extension bundle removal: this module detects the "just emptied a
// name's last remaining target" condition (`wasLastTarget` below) and calls
// the optional `removeAiBundleFn` seam when one is supplied
// (`cpt-frontx-algo-cli-scaffolding-ai-bundle`, `../scaffold/ai-bundle.ts`) —
// wired at the `cli.ts` call site, which adapts that algorithm's three-seam
// shape down to this module's own single `RemoveAiBundleFn`. Optional here
// rather than required so a caller with no bundle-removal need at all (a
// test fixture, say) is never forced to supply a no-op.
import path from 'node:path';
import { computeDeletionPlan } from '../scaffold/delete-plan';
import type {
  DeletePlanInventoryPort,
  DeletionPlanResult,
  ListTargetFilesFn,
  ListUnenumerableTargetEntriesFn,
} from '../scaffold/delete-plan';
import { readProjectState, mutateProjectState } from '../project-state/io';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn, TemplateEntry } from '../project-state/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ReadFileFn } from '../manifest/types';
import type { ErrorCode } from '../envelope';
import type { AssertPathWithinRootFn } from '../scaffold/types';
// `listTargetFilesFn`'s real implementation (`createFsListTargetFilesFn`,
// `../adapters/fs-project-io.ts`) throws this typed error, rather than
// letting a bare `ENOTDIR` propagate, when a registered, applied target's
// own on-disk location is no longer a directory. Caught inside `computePlan`
// below and converted to the same structured refusal shape every other exit
// from this function already returns — see that catch's own comment for why
// `CONTENT_CONFLICT` is the code chosen. A read failure on the owning
// template's own CURRENT manifest (a FIFO, a directory, a dangling symlink,
// ...) is a DIFFERENT concern this module no longer catches directly:
// `computeDeletionPlan` (`../scaffold/delete-plan.ts`) now catches that
// failure itself and folds it into its own recorded-value fallback, so it
// never reaches this call as a thrown error at all.
import { TargetNotDirectoryError } from '../adapters/fs-project-io';

// Symmetric to `upgrade/types.ts`'s `RemoveProjectFileFn` — removes one
// absolute file path, no-op when already absent. Reused directly rather
// than a second "remove a file" seam invented for this command: the real
// implementation (`createFsRemoveProjectFileFn`, `../adapters/fs-project-
// io.ts`) already does exactly what removing one `toDelete` entry needs.
export type RemoveTargetFileFn = (absolutePath: string) => Promise<void>;

// The CLI-owned AI-extension bundle removal this flow's `inst-del-remove-
// bundle` step names (`cpt-frontx-algo-cli-scaffolding-ai-bundle`) — declared
// here as the seam this command calls, not implemented here. The real
// implementation is wired at the `cli.ts` call site (see this file's own
// header comment above): a closure there adapts `scaffold/ai-bundle.ts`'s
// three-seam `materializeOrRemoveAiBundle` algorithm down to this single
// function shape, fixed to the `LAST_TARGET_LOST` transition.
export type RemoveAiBundleFn = (manifestName: string) => Promise<void>;

// The developer's or agent's confirmation decision for one computed plan —
// symmetric to `upgrade/types.ts`'s `PresentAndGetApprovalFn`, with a
// delete-shaped payload instead of a `ChangeSet`. The real interactive
// implementation prompts on stdin, defaulting to "No" on anything but an
// explicit affirmative (`cli.ts`'s own `createInteractiveApproval` precedent
// for `upgrade`); this seam is never called at all in `--json` mode
// (`inst-del-if-json-no-yes` returns `CONFIRMATION_REQUIRED` without
// reading stdin) or in `--dry-run` mode (nothing is at stake to confirm).
export type ConfirmDeletionFn = (plan: {
  target: string;
  toDelete: string[];
  toPreserve: string[];
}) => Promise<'confirmed' | 'declined'>;

export interface DeleteCommandFlags {
  jsonMode: boolean;
  dryRun: boolean;
  yes: boolean;
}

export type DeleteOutcome =
  // Two SEPARATE variants (never one variant with `outcome: 'dry-run' |
  // 'declined'`) so a caller narrowing on `outcome` gets ordinary
  // discriminated-union exhaustiveness checking on this field.
  | { ok: true; outcome: 'dry-run'; target: string; toDelete: string[]; toPreserve: string[] }
  | { ok: true; outcome: 'declined'; target: string; toDelete: string[]; toPreserve: string[] }
  | {
      ok: true;
      outcome: 'deleted';
      target: string;
      toDelete: string[];
      toPreserve: string[];
      templateName: string;
      // Whether this deletion just emptied `templateName`'s `targets[]`
      // array — correctly detected regardless of whether an AI-bundle
      // removal seam was supplied to act on it (see this file's own header
      // comment).
      wasLastTarget: boolean;
      // Set only when `wasLastTarget` triggered a bundle-removal attempt
      // (`removeAiBundleFn`) that itself failed. By the time this can
      // happen, the target's files are already off disk and
      // `.frontx/project.json` already reflects the removal — both real,
      // both correct — so this is reported as success carrying one named
      // CLI-owned residue, never as `ok: false` over a completed
      // destruction a retrying or error-branching caller would otherwise
      // read as "nothing happened." `removeAiBundleFn` is an opaque seam
      // from this module's point of view (see `RemoveAiBundleFn` above), so
      // its failure can only be discovered by calling it — there is no
      // precondition this module can check up front instead.
      aiBundleResidue?: { manifestName: string; path: string; message: string };
    }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

type PlanOutcome =
  // `target` is the RECORDED spelling this plan was computed for, which is
  // not always the caller's own and not always the canonical path either —
  // see `resolveRecordedTarget`. Everything downstream keys off it, the
  // project-state mutation included, so it travels with the plan rather than
  // being recomputed from `rawTarget` at each use.
  | { ok: true; document: ProjectStateDocument; target: string; plan: DeletionPlanResult & { ok: true } }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

// `path.relative` turned POSIX with `path.sep` collapsed — the shape every
// `--json` envelope in this package already carries for a project-relative
// path (`adapters/fs-project-io.ts`'s own `toPosixPath`), never the absolute
// filesystem path an internal error object happens to carry.
function toProjectRelativePath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}


// @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-resolve-recorded-name
// A leading "./" and a trailing "/" stripped, never resolving ".." and never
// touching the filesystem — the ONE lexical normalization every recorded
// `targets[]` entry already satisfies as a matter of how `canonicalizeFn`
// spells its own output (`adapters/fs-project-io.ts`'s `createFsCanonicalize
// TargetFn`), so a caller's ordinary spelling of the exact name they applied
// a template under compares equal to the recorded string without needing any
// symlink resolution at all.
function normalizeRawTargetLexically(rawTarget: string): string {
  let normalized = rawTarget;
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized === '' ? '.' : normalized;
}

/**
 * Resolves which recorded `targets[]` entry, if any, `rawTarget` identifies
 * — BEFORE `canonicalizeFn` ever resolves a symlink, and using its output
 * only as a FALLBACK, never as the primary key. Canonicalization decides
 * WHERE on disk a delete acts; using its output as the key for WHICH
 * recorded target the caller means breaks the moment a target directory is
 * replaced with a symlink after `apply` (`mv dst real && ln -s real dst`):
 * the recorded string ("dst") no longer equals what `canonicalizeFn` now
 * resolves it to ("real"), and typing the resolved name ("real") does not
 * equal the recorded string either — the target becomes unreachable by any
 * name at all, the defect this function exists to close.
 *
 * Two comparisons are tried, in order:
 *   1. `rawTarget`, lexically normalized only (`normalizeRawTargetLexically`
 *      above), against every template's recorded `targets[]` verbatim — the
 *      ordinary case, needing no filesystem access, where the developer
 *      types the exact name they applied the template under, symlink or
 *      not.
 *   2. Only when (1) finds nothing: `canonicalizeFn(rawTarget)` compared
 *      against `canonicalizeFn(recordedTarget)` for every recorded target,
 *      both resolved through whatever symlinks exist RIGHT NOW. This is the
 *      REVERSE case — a developer who types the CURRENT real name ("real")
 *      for a target recorded under its PRE-symlink name ("dst") — accepted
 *      deliberately: both spellings denote the identical on-disk location
 *      today, and a target's deletability should not depend on which of two
 *      names for the same place happened to be typed.
 *
 * Either match returns the RECORDED string, never the caller's own spelling
 * and never a resolved one: `computeDeletionPlan`'s own `targets.includes
 * (target)` check, and every `toPreserve`/`toDelete` computation downstream,
 * key off that recorded spelling, and returning anything else would silently
 * reintroduce the identical bug one level down. `undefined` when neither
 * comparison finds a match — an ordinary "not applied" case, or a target
 * that has never been registered at all.
 */
function resolveRecordedTarget(
  rawTarget: string,
  document: ProjectStateDocument,
  canonicalizeFn: CanonicalizeTargetFn,
): string | undefined {
  const normalizedRaw = normalizeRawTargetLexically(rawTarget);
  for (const entry of Object.values(document.templates)) {
    if (entry.targets.includes(normalizedRaw)) return normalizedRaw;
  }
  const resolvedRaw = canonicalizeFn(rawTarget);
  if (resolvedRaw === null) return undefined;
  for (const entry of Object.values(document.templates)) {
    for (const recordedTarget of entry.targets) {
      if (recordedTarget === normalizedRaw) continue; // already tried above and did not match
      if (canonicalizeFn(recordedTarget) === resolvedRaw) return recordedTarget;
    }
  }
  return undefined;
}
// @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-resolve-recorded-name

/**
 * cpt-frontx-flow-cli-scaffolding-delete-target — deletes one already-applied
 * `<target>` under explicit confirmation (interactive, `--json`, or
 * `--dry-run`), realizing the delete-op state machine
 * (`cpt-frontx-state-cli-scaffolding-delete-op`): PLAN_COMPUTED ->
 * CONFIRMATION_PENDING -> CONFIRMED -> DELETED, or -> DECLINED.
 */
export async function deleteTarget(
  rawTarget: string,
  repoRoot: string,
  flags: DeleteCommandFlags,
  inventory: DeletePlanInventoryPort,
  canonicalizeFn: CanonicalizeTargetFn,
  listTargetFilesFn: ListTargetFilesFn,
  // The entries `listTargetFilesFn` above cannot enumerate as regular files —
  // a FIFO, a socket, a device, a dangling symlink. They occupy ground inside
  // the target and survive the deletion, so the plan has to name them: the
  // confirmation gate's whole safety argument is that its two lists state the
  // blast radius before it is executed, and an entry in neither list is
  // outside that promise.
  listUnenumerableTargetEntriesFn: ListUnenumerableTargetEntriesFn,
  readFileFn: ReadFileFn,
  removeFileFn: RemoveTargetFileFn,
  // CONTAINMENT ESCAPE FIX: proves an individual `toDelete` path stays
  // inside `repoRoot`, symlinks resolved, immediately before `removeFileFn`
  // is called for it — `listTargetFilesFn` above deliberately FOLLOWS a
  // symlink while enumerating a target's real reachable content, which is
  // correct for the deletion plan itself but means a plan path can resolve
  // outside the project once re-joined with `repoRoot`. Curried over
  // `repoRoot` (`createFsAssertPathWithinRootFn`, `../adapters/fs-project-
  // io.ts`) at the `cli.ts` dispatch site, exactly as `canonicalizeFn`
  // already is.
  assertPathWithinRootFn: AssertPathWithinRootFn,
  readProjectStateFn: ReadProjectStateFn,
  writeProjectStateFn: WriteProjectStateFn,
  confirmDeletionFn: ConfirmDeletionFn,
  removeAiBundleFn?: RemoveAiBundleFn,
): Promise<DeleteOutcome> {
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-invoke
  // `rawTarget`/`flags` are accepted as this function's own parameters.
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-invoke

  // Refused up front, before anything about WHICH recorded target the
  // caller means is even asked: an argument that cannot be canonicalized at
  // all (escapes the project root, say) is an ordinary invalid-path
  // refusal regardless of whether some registered `targets[]` entry
  // happens to share its literal spelling, so this check runs first and
  // its result is not threaded any further — `resolveRecordedTarget` below
  // re-canonicalizes `rawTarget` itself wherever it actually needs that
  // form.
  if (canonicalizeFn(rawTarget) === null) {
    return {
      ok: false,
      code: 'INVALID_PATH',
      message: `Target "${rawTarget}" could not be proven to stay inside the project root.`,
      details: { target: rawTarget },
    };
  }

  // Recomputes the plan from the CURRENT project state document — called
  // once for the initial `TARGET_NOT_APPLIED`/dry-run check
  // (PLAN_COMPUTED), and called again immediately before any confirmed
  // deletion (`inst-del-recompute-plan` / `inst-do-pending-confirmed`),
  // never trusting the first call's result. Returns the document read
  // alongside the plan so a confirmed deletion's project-state mutation
  // (below) is built from the SAME read the executed plan was computed
  // against, rather than a third, potentially inconsistent read.
  async function computePlan(): Promise<PlanOutcome> {
    const stateResult = await readProjectState(repoRoot, readProjectStateFn);
    if (!stateResult.ok) {
      return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
    }
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-target-shape-drifted
    // `<target>` is recorded as applied (the `TARGET_NOT_APPLIED` check
    // below runs on `computeDeletionPlan`'s own return, so a target that is
    // not even registered never reaches this far), but its on-disk location
    // may have changed shape since — replaced by an ordinary file, or any
    // other non-directory entry — between `apply` and this `delete`. This is
    // the same class of fact `apply` and `upgrade` already refuse for a
    // payload path whose disk shape cannot be compared against declared
    // content (`architecture/ADR/0021-project-upgrade-mechanism.md`): here
    // it is the TARGET's own shape, not a path beneath it, but the target's
    // recorded content can no longer be read or reconciled either way, and
    // `CONTENT_CONFLICT` is the identical code both other engines already
    // use for "the disk holds something this operation cannot work with
    // where it expected a directory" — never a bespoke third code for what
    // is, from a caller's point of view, the same fact.
    // The recorded spelling comes first, and the canonical path only after
    // it: canonicalization answers WHERE on disk to act, never WHICH recorded
    // target the caller means. A target applied under `dst` that has since
    // become a symlink canonicalizes to its real path, which is not what
    // `targets[]` holds — keying the lookup off that would make the recorded
    // target unreachable through the only command that can remove it.
    // Falls back to `rawTarget` VERBATIM, never a canonicalized form, when
    // neither comparison matches: that is the ordinary "not applied" case,
    // and the `TARGET_NOT_APPLIED` refusal below names exactly what the
    // caller typed — a caller told about a resolved path they never wrote
    // has nothing to act on.
    const recordedTarget = resolveRecordedTarget(rawTarget, stateResult.document, canonicalizeFn) ?? rawTarget;
    try {
      const plan = await computeDeletionPlan(
        recordedTarget,
        repoRoot,
        stateResult.document,
        inventory,
        canonicalizeFn,
        listTargetFilesFn,
        readFileFn,
        listUnenumerableTargetEntriesFn,
      );
      if (!plan.ok) return plan;
      return { ok: true, document: stateResult.document, target: recordedTarget, plan };
    } catch (error) {
      // A read failure resolving the owning template's CURRENT manifest —
      // unreadable as a regular file, or genuinely absent — is no longer a
      // reason for `computeDeletionPlan` to throw: it is caught internally
      // there and folded into the recorded-value fallback
      // (`inst-dp-resolve-current-manifest`), so this catch no longer has
      // that class of error to answer for. Only `TargetNotDirectoryError` —
      // the TARGET's own on-disk shape, not its owning template's manifest —
      // still reaches here.
      if (error instanceof TargetNotDirectoryError) {
        // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-target-shape-drifted
        return {
          ok: false,
          code: 'CONTENT_CONFLICT',
          // The message quotes the PROJECT-RELATIVE path, not the absolute
          // one the error object carries: every other envelope in this
          // package spells a project path that way, and an absolute host path
          // in one of them is both noise for a person and a second shape for
          // a caller to parse.
          message:
            `Aborted — "${toProjectRelativePath(repoRoot, error.targetPath)}" is no longer a directory. Its ` +
            'recorded content cannot be reconciled or deleted while something other than a directory occupies ' +
            'it; nothing deleted.',
          details: { target: recordedTarget, path: toProjectRelativePath(repoRoot, error.targetPath) },
        };
        // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-target-shape-drifted
      }
      throw error;
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-target-shape-drifted
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-compute-plan
  const initial = await computePlan();
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-compute-plan

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-not-applied
  if (!initial.ok) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-not-applied
    return initial;
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-not-applied
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-not-applied

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-dry-run
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-plan-pending
  if (flags.dryRun) {
    // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-plan-pending
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-dry-run
    return { ok: true, outcome: 'dry-run', target: initial.target, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-dry-run
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-dry-run

  let final: PlanOutcome & { ok: true };

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-json
  if (flags.jsonMode) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-json-no-yes
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-plan-pending
    if (!flags.yes) {
      // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-plan-pending
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-confirmation-required
      // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-declined
      return {
        ok: false,
        code: 'CONFIRMATION_REQUIRED',
        message:
          `Deleting "${initial.target}" requires confirmation. Re-issue this exact command with --yes after ` +
          'obtaining authorization out of band; nothing has been deleted.',
        details: { target: initial.target, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve },
      };
      // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-declined
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-confirmation-required
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-json-no-yes

    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-else-json-yes
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-recompute-plan
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-confirmed
    const recomputed = await computePlan();
    // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-confirmed
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-recompute-plan
    if (!recomputed.ok) return recomputed;
    final = recomputed;
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-else-json-yes
  } else {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-else-interactive
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-prompt
    const decision = await confirmDeletionFn({ target: initial.target, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve });
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-prompt

    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-declined
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-declined
    if (decision === 'declined') {
      // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-declined
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-declined
      return { ok: true, outcome: 'declined', target: initial.target, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve };
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-declined
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-declined

    // Recomputed here too, on the identical confirmed path the `--json
    // --yes` branch above takes — the state machine's CONFIRMATION_PENDING
    // -> CONFIRMED transition holds for either route to CONFIRMED, and
    // both must recompute rather than trust the initial PLAN_COMPUTED read.
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-confirmed
    const recomputed = await computePlan();
    // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-confirmed
    if (!recomputed.ok) return recomputed;
    final = recomputed;
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-else-interactive
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-json

  // CONTAINMENT ESCAPE FIX: `listTargetFilesFn` (the real
  // `createFsListTargetFilesFn`, `adapters/fs-project-io.ts`) deliberately
  // FOLLOWS a symlink while enumerating the target's real reachable content
  // — correct for computing the deletion plan itself, but it means
  // `final.plan.toDelete` can legitimately name a project-relative path
  // whose actual on-disk location, once re-joined with `repoRoot` and
  // resolved through that same symlink, sits outside the project entirely
  // (a target directory a developer replaced with a symlink to somewhere
  // outside between `apply` and this `delete`). Every path this plan is
  // about to remove is proven to stay inside `repoRoot` in its own pass
  // BEFORE anything is deleted — an escape anywhere in the plan aborts the
  // whole deletion, nothing removed.
  const invalidPaths: string[] = [];
  for (const deletedPath of final.plan.toDelete) {
    try {
      assertPathWithinRootFn(path.join(repoRoot, deletedPath));
    } catch {
      invalidPaths.push(deletedPath);
    }
  }
  if (invalidPaths.length > 0) {
    return {
      ok: false,
      code: 'INVALID_PATH',
      message:
        `Aborted — path(s) could not be proven to stay inside the project root: ${invalidPaths.join(', ')}; ` +
        'nothing deleted.',
      details: { target: final.target, paths: invalidPaths },
    };
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-remove
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-confirmed-deleted
  for (const deletedPath of final.plan.toDelete) {
    await removeFileFn(path.join(repoRoot, deletedPath));
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-remove

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-update-state
  const ownerName = final.plan.templateName;
  const ownerEntry: TemplateEntry | undefined = final.document.templates[ownerName];
  const targetsBefore = ownerEntry ? ownerEntry.targets.length : 0;
  // Filtered against the RECORDED spelling the plan was computed for, not
  // the canonical path: a recorded target whose on-disk location has since
  // become a symlink canonicalizes to something `targets[]` never held, and
  // filtering by that would leave the entry standing after its ground was
  // removed.
  const remainingTargets = ownerEntry ? ownerEntry.targets.filter((t) => t !== final.target) : [];
  if (ownerEntry) {
    const written = await mutateProjectState(
      repoRoot,
      { kind: 'set-template', name: ownerName, entry: { ...ownerEntry, targets: remainingTargets } },
      readProjectStateFn,
      writeProjectStateFn,
    );
    if (!written.ok) return { ok: false, code: 'PROJECT_INVALID', message: written.message };
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-update-state
  // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-confirmed-deleted

  // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-to-empty
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-last-target
  const wasLastTarget = targetsBefore > 0 && remainingTargets.length === 0;
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-remove-bundle
  let aiBundleResidue: { manifestName: string; path: string; message: string } | undefined;
  if (wasLastTarget && removeAiBundleFn) {
    try {
      await removeAiBundleFn(ownerName);
    } catch (error) {
      // The CLI-owned bundle removal (`adapters/fs-ai-bundle.ts`'s
      // `createFsRemoveBundleFn`) refuses fail-closed, the same way, when
      // its own target cannot be proven to stay inside the project root.
      // By this point the target itself is already removed and its
      // project-state entry already updated above — both real, both
      // correct — so this is not surfaced as `ok: false` (which would tell
      // a caller the whole operation failed over a deletion that in fact
      // already happened and is already recorded). Instead it is carried
      // as a named residue on the success outcome below: the deletion
      // succeeded, one CLI-owned path could not be cleaned, and this
      // module cannot check that precondition up front because
      // `removeAiBundleFn` is an opaque seam whose failure is only
      // discoverable by calling it.
      aiBundleResidue = {
        manifestName: ownerName,
        path: `.frontx/ai/${ownerName}`,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-remove-bundle
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-last-target
  // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-to-empty

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-success
  return {
    ok: true,
    outcome: 'deleted',
    target: final.target,
    toDelete: final.plan.toDelete,
    toPreserve: final.plan.toPreserve,
    templateName: ownerName,
    wasLastTarget,
    ...(aiBundleResidue ? { aiBundleResidue } : {}),
  };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-success
}
