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
import type { DeletePlanInventoryPort, DeletionPlanResult, ListTargetFilesFn } from '../scaffold/delete-plan';
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
// `CONTENT_CONFLICT` is the code chosen.
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
  | { ok: true; document: ProjectStateDocument; plan: DeletionPlanResult & { ok: true } }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

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

  const canonicalized = canonicalizeFn(rawTarget);
  if (canonicalized === null) {
    return {
      ok: false,
      code: 'INVALID_PATH',
      message: `Target "${rawTarget}" could not be proven to stay inside the project root.`,
      details: { target: rawTarget },
    };
  }
  // Rebound to a definitely-`string` const: `canonicalized`'s declared type
  // stays `string | null` across the closure boundary below (TypeScript's
  // control-flow narrowing does not persist into a nested function body for
  // an outer-scope binding), so `computePlan` closes over THIS binding,
  // whose type is `string` by construction, instead.
  const canonical: string = canonicalized;

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
    try {
      const plan = await computeDeletionPlan(
        canonical,
        repoRoot,
        stateResult.document,
        inventory,
        canonicalizeFn,
        listTargetFilesFn,
        readFileFn,
      );
      if (!plan.ok) return plan;
      return { ok: true, document: stateResult.document, plan };
    } catch (error) {
      if (error instanceof TargetNotDirectoryError) {
        // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-target-shape-drifted
        return {
          ok: false,
          code: 'CONTENT_CONFLICT',
          message:
            `Aborted — ${error.message} Its recorded content cannot be reconciled or deleted while something ` +
            'other than a directory occupies it; nothing deleted.',
          details: { target: canonical, path: error.targetPath },
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
    return { ok: true, outcome: 'dry-run', target: canonical, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve };
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
          `Deleting "${canonical}" requires confirmation. Re-issue this exact command with --yes after ` +
          'obtaining authorization out of band; nothing has been deleted.',
        details: { target: canonical, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve },
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
    const decision = await confirmDeletionFn({ target: canonical, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve });
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-prompt

    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-if-declined
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-declined
    if (decision === 'declined') {
      // @cpt-end:cpt-frontx-state-cli-scaffolding-delete-op:p1:inst-do-pending-declined
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-declined
      return { ok: true, outcome: 'declined', target: canonical, toDelete: initial.plan.toDelete, toPreserve: initial.plan.toPreserve };
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
      details: { target: canonical, paths: invalidPaths },
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
  const remainingTargets = ownerEntry ? ownerEntry.targets.filter((t) => t !== canonical) : [];
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
    target: canonical,
    toDelete: final.plan.toDelete,
    toPreserve: final.plan.toPreserve,
    templateName: ownerName,
    wasLastTarget,
    ...(aiBundleResidue ? { aiBundleResidue } : {}),
  };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-delete-target:p1:inst-del-return-success
}
