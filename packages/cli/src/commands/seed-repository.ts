// @cpt-flow:cpt-frontx-flow-cli-scaffolding-seed-repository:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-seed-empty-target:p1
import { resolveComposition } from '../composition/resolve';
import { uniformApply } from '../scaffold/assembler';
import { checkAssemblyConflicts } from '../scaffold/conflict';
import { isUserFixableMaterializeFailure, materializeAssembly } from '../scaffold/materialize';
import { RESERVED_ENVIRONMENT_ENTRIES } from '../manifest/validate-contract';
import { summarizeEntries } from './summarize-entries';
import type { InventoryEntry } from '../inventory/types';
import type { ReadContentItemsFn, ReadProjectFileFn, WriteFileFn } from '../scaffold/types';
import type { BoundaryConflictEntry } from '../scaffold/state';
import type { ProvenanceWriteFn } from '../provenance/types';

export type SeedRepositoryResult =
  | { ok: true; message: string; appliedTemplates: string[] }
  | {
      ok: false;
      reason:
        | 'unresolved'
        | 'cycle'
        | 'manifest-unreadable'
        | 'provenance-failed'
        // review #500 (fix 2/2): mirrors AddTemplateResult's reason of the
        // same name — see the comment there for the exit-code rationale. A
        // fresh seed target is normally empty, but composeSharedFiles is
        // still invoked and can still refuse for the same reasons an `add`
        // can (a template's manifest declares a `region-union` path that
        // collides with content the caller's own writeFileFn/readProjectFileFn
        // adapter already has on disk at the target).
        | 'materialization-refused';
      message: string;
    }
  | { ok: false; reason: 'conflict'; conflicts: BoundaryConflictEntry[]; message: string }
  | { ok: false; reason: 'target-not-empty'; message: string }
  | { ok: false; reason: 'target-not-directory'; message: string };

/**
 * What the target path holds: the entry names of an existing directory,
 * `'not-a-directory'` when the path exists but is not a directory, or
 * `undefined` when it does not exist.
 *
 * All three are distinguished because the seed flow answers each differently: a
 * nonexistent target is created by materialization, an existing directory is
 * partitioned into content and non-content, and a non-directory is refused
 * outright with no add remedy. Injected so this flow touches no filesystem
 * itself; the concrete implementation is `createFsReadTargetDirFn` in
 * `adapters/fs-target-dir.ts`.
 */
export type TargetDirState = string[] | 'not-a-directory' | undefined;

export type ReadTargetDirFn = (path: string) => Promise<TargetDirState>;

// Entries whose presence says nothing about whether the ground is free: no
// assembly writes to them, and materialization cannot collide with them.
//
// Taken from the manifest contract rather than restated, because the exemption
// here and the prohibition there are two halves of one rule: the validator
// refuses any template that declares one of these as ownership ground
// (`RESERVED_ENVIRONMENT_ENTRIES`), which is precisely what makes it safe to
// wave them through here. Two hand-maintained copies could drift apart, and the
// drift would be silent and destructive — a name exempted here but declarable
// there lets a template claim ground this guard already called empty.
//
// Closed deliberately. `.git` is the load-bearing member: `git init` followed by
// `frontx seed` is the ordinary way to start, and treating VCS metadata as
// content would refuse the most common first step there is. Widening the set to
// anything a template COULD write would reopen the hole the guard closes.
const NON_CONTENT_ENTRIES: ReadonlySet<string> = new Set(RESERVED_ENVIRONMENT_ENTRIES);

/**
 * cpt-frontx-flow-cli-scaffolding-seed-repository — applies an installed
 * template, plus any templates its preset references, to a target directory
 * that does not yet exist, is empty, or holds only non-content entries:
 * refuses a target already holding content and a target path that is not a
 * directory, resolves the set through the shared F10 resolver, stages it
 * through the P14 uniform-apply path, submits the staged assembly to the P29
 * pre-flight conflict check, and on pass materializes the repository writing
 * one provenance record per applied template.
 *
 * @param targetDir - the directory to seed; pass it already resolved for
 * display, since it is quoted verbatim in every refusal message
 */
export async function seedRepository(
  templateRef: string,
  targetDir: string,
  lookupFn: (name: string) => InventoryEntry | undefined,
  readContentFn: ReadContentItemsFn,
  writeFileFn: WriteFileFn,
  provenanceWriteFn: ProvenanceWriteFn,
  // Required, and ahead of the optional parameter below: a call site that
  // omitted it would silently skip the empty-target guard, which is the hole
  // that guard exists to close.
  readTargetDirFn: ReadTargetDirFn,
  // Optional — defaults to "nothing already on disk", which is exactly what
  // a fresh seed target already is; a caller that has no reason to reconcile
  // with an existing file (e.g. a test fixture) can omit it.
  // TODO(#489): make required once the pending #489 branch merges — kept
  // optional only because `__tests__/template-split.e2e.test.ts` (edited on
  // that branch) calls this without supplying it.
  readProjectFileFn: ReadProjectFileFn = async () => null,
): Promise<SeedRepositoryResult> {
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-invoke
  // entry: apply command invoked with a template reference and a target directory path
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-invoke

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-check-resolved
  const rootEntry = lookupFn(templateRef);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-check-resolved

  if (!rootEntry) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-not-found
    return {
      ok: false,
      reason: 'unresolved',
      message: `Apply aborted — template "${templateRef}" not found in local inventory; no files written.`,
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-not-found
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-check-target-empty
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-target-not-directory
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-target-not-directory
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-target-not-empty
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-target-not-empty
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-aborted-target-not-directory
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-aborted-target-not-empty
  const preflight = await refuseUnlessSeedable(targetDir, templateRef, readTargetDirFn);
  if (preflight) return preflight;
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-aborted-target-not-empty
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-req-aborted-target-not-directory
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-target-not-empty
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-target-not-empty
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-target-not-directory
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-target-not-directory
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-check-target-empty

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-resolve-set
  const compositionResult = await resolveComposition(rootEntry, templateRef, new Set<string>(), 0, lookupFn);
  if (!compositionResult.ok) {
    return {
      ok: false,
      reason: compositionResult.reason === 'cycle' ? 'cycle' : 'unresolved',
      message:
        compositionResult.reason === 'cycle'
          ? `Apply aborted — cycle detected in composition graph: ${compositionResult.path.join(' → ')}; no files written.`
          : `Apply aborted — ${compositionResult.message}; no files written.`,
    };
  }
  const templateRefs = [...compositionResult.templates.keys()];
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-resolve-set

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-stage
  const applyResult = await uniformApply(templateRefs, false, lookupFn, readContentFn);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-stage

  if (!applyResult.ok) {
    return { ok: false, reason: applyResult.reason, message: `Apply aborted — ${applyResult.message}` };
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-conflict-check
  const verdict = checkAssemblyConflicts(applyResult.assembly, []);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-conflict-check

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-conflict
  if (!verdict.ok) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-conflict
    return {
      ok: false,
      reason: 'conflict',
      conflicts: verdict.conflicts,
      message: 'Apply aborted — the staged assembly has an intersecting ownership-boundary claim; no files written.',
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-abort-conflict
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-if-conflict

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-recheck-target
  // Resolution and the conflict check above take time, and the target can change
  // during it. Re-read at the last moment before the first write so a directory
  // that became occupied meanwhile is refused rather than written over.
  //
  // This NARROWS the check-to-write window; it does not close it atomically.
  // Closing it would need an exclusive-create protocol across every write path,
  // out of proportion to what it removes — the guard exists to catch a developer
  // aiming at the wrong directory, which is not a race.
  const recheck = await refuseUnlessSeedable(targetDir, templateRef, readTargetDirFn);
  if (recheck) return recheck;
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-recheck-target

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-materialize
  const materializeResult = await materializeAssembly(
    applyResult.assembly,
    targetDir,
    [],
    lookupFn,
    writeFileFn,
    provenanceWriteFn,
    readProjectFileFn,
  );
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-materialize

  if (!materializeResult.ok) {
    // review #500 (fix 2/2): see the identical branch in add-template.ts.
    const reason = isUserFixableMaterializeFailure(materializeResult) ? 'materialization-refused' : 'provenance-failed';
    // review #500 (round 5): composeSharedFiles' own 'unrecorded-owner'
    // message tells the caller to "record this owner's applied provenance
    // and retry" — sound advice for `add`, which reads the target's real
    // provenance, but never executable for `seed`: this command hardcodes
    // an empty `existingProvenance` a few lines up (a seed target has none
    // by definition — inst-seed-materialize), so no amount of recording
    // provenance in the target directory changes what THIS command passes
    // to `materializeAssembly` on a retry. Reusing compose's message
    // verbatim would present a fixable-looking exit code (EXIT_USER_ERROR,
    // via `isUserFixableMaterializeFailure`) with advice that can never
    // actually fix it. The real fix is the one FEATURE.md's seed error
    // scenario names: this target directory is not empty, contra seed's
    // documented precondition — the developer wants `frontx add`, not a
    // retry of `seed`.
    const message =
      materializeResult.composeReason === 'unrecorded-owner' && materializeResult.unrecordedOwner
        ? `Apply aborted — path "${materializeResult.unrecordedOwner.path}" in "${targetDir}" carries a block ` +
          `owned by "${materializeResult.unrecordedOwner.templateIdentity}" ` +
          `(region "${materializeResult.unrecordedOwner.regionKey}") that this seed does not apply. A seed target ` +
          'must be an empty directory: this one already holds applied-template content, and "frontx apply" (seed) ' +
          "never reads a target's existing provenance, so no owner can ever be recorded here to clear this " +
          'refusal on a retry. To add a template to a repository that already holds applied templates, use ' +
          '"frontx add" instead. No file was written.'
        : materializeResult.message;
    return { ok: false, reason, message };
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-done
  return {
    ok: true,
    message: `Apply complete — repository seeded at "${targetDir}"; one provenance record written per applied template.`,
    appliedTemplates: templateRefs,
  };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-seed-repository:p1:inst-seed-return-done
}

// Refuses when `targetDir` is not seedable, or returns `undefined` when it is.
//
// Extracted because the flow asks this question twice: once before doing any
// work, and again immediately before the first write (inst-seed-recheck-target),
// where the answer can have changed. One function keeps the two answers
// identical — a second copy of the partition or of either message would let the
// pre-flight refusal and the last-moment refusal drift apart, and a developer
// would see the same situation described two ways depending on timing.
async function refuseUnlessSeedable(
  targetDir: string,
  templateRef: string,
  readTargetDirFn: ReadTargetDirFn,
): Promise<SeedRepositoryResult | undefined> {
  // The P29 pre-flight conflict check cannot stand in for this. It arbitrates
  // between templates' DECLARED boundaries, and seeding passes it an empty
  // occupied set because no template has been applied here yet — so content that
  // arrived by any other route is declared by nobody and every claim looks free
  // no matter what the directory holds. Without this gate, pointing seed at a
  // populated tree overwrites it silently.
  const targetState = await readTargetDirFn(targetDir);

  if (targetState === 'not-a-directory') {
    // No add remedy here, deliberately: `frontx add` needs a directory too and
    // would fail on this same path, so naming it would send the developer to a
    // second failure rather than to a fix.
    return {
      ok: false,
      reason: 'target-not-directory',
      message:
        `Apply refused — target path "${targetDir}" exists and is not a directory, ` +
        'so no files were written. Seeding materializes a repository into a directory; ' +
        'point it at a directory path, or remove the file occupying this one.',
    };
  }

  // Partitioned here rather than in the adapter: which entries count as content
  // is a rule of this flow, and the adapter stays a pure listing that reports
  // what is on disk without judging it.
  const contentEntries =
    targetState === undefined ? [] : targetState.filter((entry) => !NON_CONTENT_ENTRIES.has(entry));
  if (contentEntries.length === 0) return undefined;

  // The add remedy carries its own boundary. `add` refuses any path it would
  // write that this directory already holds and no applied template's
  // provenance accounts for (cpt-frontx-dod-cli-scaffolding-add-undeclared-content),
  // so it lands the template alongside content it does not claim and refuses
  // rather than overwriting content it does. Stating what it leaves alone is
  // what makes this a remedy rather than a redirection whose outcome the
  // developer has to guess at — and the fresh-directory exit is named alongside
  // it because add refuses this same directory whenever what it holds IS the
  // template's own ground (a template declaring root files against a repository
  // that already has them), which would otherwise send the developer from one
  // refusal to the next with nothing left to try.
  return {
    ok: false,
    reason: 'target-not-empty',
    message:
      `Apply refused — target directory "${targetDir}" already holds ${contentEntries.length} ` +
      `${contentEntries.length === 1 ? 'entry' : 'entries'} (${summarizeEntries(contentEntries)}). ` +
      'Seeding materializes a whole repository and would write over content no template declared, ' +
      `so no files were written. Run "frontx add ${templateRef} ${targetDir}" instead to apply this ` +
      'template into a directory that already holds content — add writes only the ground the template ' +
      'declares, and refuses instead of overwriting where content already stands on it — or seed into ' +
      'a fresh directory, which is the way through when the content here stands on the ground this ' +
      'template declares and add therefore refuses it too.',
  };
}
