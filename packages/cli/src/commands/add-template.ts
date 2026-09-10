// @cpt-flow:cpt-frontx-flow-cli-scaffolding-add-template:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-add-undeclared-content:p1
import { resolveComposition } from '../composition/resolve';
import { pathWithinSubtree } from '../paths/relative-path';
import { uniformApply } from '../scaffold/assembler';
import { groupContributionsByPath } from '../scaffold/compose-shared-files';
import { checkAssemblyConflicts } from '../scaffold/conflict';
import { isUserFixableMaterializeFailure, materializeAssembly, occupiedBoundariesFromProvenance } from '../scaffold/materialize';
import { summarizeEntries } from './summarize-entries';
import type { ReadProvenanceRecordsFn } from '../scaffold/materialize';
import type { InventoryEntry } from '../inventory/types';
import type { OwnershipBoundary } from '../manifest/types';
import type { ReadContentItemsFn, ReadProjectFileFn, StagedAssembly, WriteFileFn } from '../scaffold/types';
import type { BoundaryConflictEntry, OccupiedBoundaryEntry } from '../scaffold/state';
import type { ProvenanceWriteFn } from '../provenance/types';

export type AddTemplateResult =
  | { ok: true; message: string; appliedTemplates: string[] }
  | {
      ok: false;
      reason:
        | 'unresolved'
        | 'cycle'
        | 'manifest-unreadable'
        | 'provenance-failed'
        // review #500 (fix 2/2): a materialization refusal the repository's
        // owner can act on and retry — composeSharedFiles' 'unrecorded-owner',
        // 'span-overlap', or 'carried-block-conflict' (see
        // isUserFixableMaterializeFailure). Kept distinct from
        // 'provenance-failed' so cli.ts's exit-code mapping (anything but
        // 'manifest-unreadable'/'provenance-failed' is EXIT_USER_ERROR) sends
        // the user a fixable-error code instead of an internal-error one.
        | 'materialization-refused'
        | 'occupied-not-installed'
        | 'occupied-manifest-unreadable'
        | 'occupied-source-ambiguous';
      message: string;
    }
  | { ok: false; reason: 'conflict'; conflicts: BoundaryConflictEntry[]; message: string }
  | { ok: false; reason: 'target-holds-undeclared-content'; paths: string[]; message: string }
  | { ok: false; reason: 'target-not-directory'; message: string };

/**
 * What stands at one absolute path in the target repository: a directory, any
 * other kind of on-disk entry, or nothing at all.
 *
 * The three are distinguished because the add flow answers each differently: an
 * absent path is free ground materialization writes into, a directory or a file
 * standing where the incoming template owns ground is content the write would
 * destroy, and a target path that is a file at all is refused outright. Injected
 * so this flow touches no filesystem itself; the concrete implementation is
 * `createFsReadTargetPathStateFn` in `adapters/fs-target-path.ts`.
 */
export type TargetPathState = 'directory' | 'file' | 'absent';

export type ReadTargetPathStateFn = (absolutePath: string) => Promise<TargetPathState>;

/**
 * cpt-frontx-flow-cli-scaffolding-add-template — applies an installed
 * template, plus any templates its preset references, into an EXISTING
 * repository that already holds applied templates: resolves the set through
 * the shared F10 resolver, stages it through the SAME P14 uniform-apply path
 * used to seed a repository, and submits the staged assembly TOGETHER WITH
 * the boundaries already occupied by the repository's applied templates
 * (derived from its existing provenance records) to the P29 pre-flight
 * conflict check. On pass, materializes ONLY the newly applied templates'
 * contribution and adds one provenance record per newly applied template.
 *
 * Refuses, before any write, a target that holds content at a path the incoming
 * assembly owns and that no applied template's recorded provenance accounts for:
 * the conflict check above arbitrates DECLARED boundaries only, so content that
 * arrived by any other route is declared by nobody and every claim over it looks
 * free (cpt-frontx-dod-cli-scaffolding-add-undeclared-content).
 *
 * @param targetDir - the repository to extend; pass it already resolved for
 * display, since it is quoted verbatim in every refusal message
 */
export async function addTemplate(
  templateRef: string,
  targetDir: string,
  lookupFn: (name: string) => InventoryEntry | undefined,
  // The whole installed set, needed to resolve a provenance record whose
  // identity predates the manifest-declared scheme by its source address.
  listInstalledFn: () => Promise<InventoryEntry[]>,
  readContentFn: ReadContentItemsFn,
  writeFileFn: WriteFileFn,
  readProvenanceFn: ReadProvenanceRecordsFn,
  provenanceWriteFn: ProvenanceWriteFn,
  // Required, and ahead of the optional parameter below: a call site that
  // omitted it would silently skip the occupied-ground guard, which is the hole
  // that guard exists to close.
  readTargetPathStateFn: ReadTargetPathStateFn,
  // Optional — defaults to "nothing already on disk". A real `add` against a
  // repository that already holds applied templates should always supply the
  // real adapter, or a recorded region-union block from an earlier apply
  // will not be found and carried forward.
  // TODO(#489): make required once the template-mfe-harness branch merges —
  // kept optional only because `__tests__/template-split.e2e.test.ts` (edited
  // on that branch) calls this without supplying it.
  readProjectFileFn: ReadProjectFileFn = async () => null,
): Promise<AddTemplateResult> {
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-invoke
  // entry: apply command invoked with a template reference and the path of a
  // repository that already holds applied templates
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-invoke

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-resolved
  const rootEntry = lookupFn(templateRef);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-resolved

  if (!rootEntry) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-not-found
    return {
      ok: false,
      reason: 'unresolved',
      message: `Apply aborted — template "${templateRef}" not found in local inventory; no files written.`,
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-not-found
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve-set
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
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve-set

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-stage
  const applyResult = await uniformApply(templateRefs, true, lookupFn, readContentFn);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-stage

  if (!applyResult.ok) {
    return { ok: false, reason: applyResult.reason, message: `Apply aborted — ${applyResult.message}` };
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve-occupied
  const existingProvenance = await readProvenanceFn(targetDir);
  const alreadyOccupied = occupiedBoundariesFromProvenance(
    existingProvenance,
    lookupFn,
    await listInstalledFn(),
  );
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve-occupied

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-occupied
  if (!alreadyOccupied.ok) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-occupied-unknown
    return {
      ok: false,
      reason: alreadyOccupied.reason,
      message: `Apply aborted — ${alreadyOccupied.message} No files written.`,
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-occupied-unknown
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-occupied

  // Runs as soon as both inputs exist — the staged assembly's own paths and the
  // ground the target's provenance accounts for — so a repository holding
  // undeclared content is refused without the pairwise conflict check below
  // having to run at all.
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-ground-free
  const preflight = await refuseUnlessGroundFree(applyResult.assembly, alreadyOccupied.occupied, targetDir, readTargetPathStateFn);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-check-ground-free

  // Both abort transitions leave RESOLVED through this one return; which of them
  // it is depends on the reason `refuseUnlessGroundFree` chose.
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-aborted-target-not-directory
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-aborted-ground-occupied
  if (preflight) return preflight;
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-aborted-ground-occupied
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-resolved-aborted-target-not-directory

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-conflict-check
  const verdict = checkAssemblyConflicts(applyResult.assembly, alreadyOccupied.occupied);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-conflict-check

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-conflict
  if (!verdict.ok) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-conflict
    return {
      ok: false,
      reason: 'conflict',
      conflicts: verdict.conflicts,
      message:
        'Apply aborted — the staged assembly claims ground already occupied by an applied template; no files written.',
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-conflict
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-conflict

  // The conflict check above takes time, and the target can change during it.
  // Re-probing at the last moment before the first write refuses a repository
  // that gained content at one of these paths meanwhile, rather than writing
  // over it.
  //
  // This NARROWS the check-to-write window; it does not close it atomically.
  // Closing it would need an exclusive-create protocol across every write path,
  // out of proportion to what it removes — the guard exists to catch a developer
  // adding into a directory whose content no template recorded, which is not a
  // race.
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-recheck-ground
  const recheck = await refuseUnlessGroundFree(applyResult.assembly, alreadyOccupied.occupied, targetDir, readTargetPathStateFn);
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-recheck-ground

  // The same two refusals as the pre-flight return above, but reached from
  // CONFLICT_CHECKED: the conflict check has already passed by the time this
  // runs, so these are their own transitions rather than the RESOLVED ones.
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-checked-aborted-target-not-directory
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-checked-aborted-ground-occupied
  if (recheck) return recheck;
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-checked-aborted-ground-occupied
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p2:inst-as-checked-aborted-target-not-directory

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize
  const materializeResult = await materializeAssembly(
    applyResult.assembly,
    targetDir,
    existingProvenance,
    lookupFn,
    writeFileFn,
    provenanceWriteFn,
    readProjectFileFn,
  );
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize

  if (!materializeResult.ok) {
    // review #500 (fix 2/2): only a user-fixable compose refusal gets its own
    // reason here — an invariant-violation compose reason, or a real
    // provenance-write failure (no composeReason at all), stays
    // 'provenance-failed' exactly as before.
    const reason = isUserFixableMaterializeFailure(materializeResult) ? 'materialization-refused' : 'provenance-failed';
    return { ok: false, reason, message: materializeResult.message };
  }

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-done
  return {
    ok: true,
    message: `Apply complete — "${targetDir}" extended; one provenance record added per newly applied template.`,
    appliedTemplates: templateRefs,
  };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-done
}

// Refuses when the target is not a directory, or holds content at a path the
// staged assembly owns that no applied template's provenance accounts for;
// returns `undefined` when the ground the assembly claims is free.
//
// Extracted because the flow asks this question twice: once as soon as both its
// inputs exist, and again immediately before the first write
// (inst-add-recheck-ground), where the answer can have changed. One function
// keeps the two answers identical — a second copy of the exemption rule or of
// either message would let the pre-flight refusal and the last-moment refusal
// drift apart, and a developer would see the same situation described two ways
// depending on timing.
async function refuseUnlessGroundFree(
  assembly: StagedAssembly,
  occupied: OccupiedBoundaryEntry[],
  targetDir: string,
  readTargetPathStateFn: ReadTargetPathStateFn,
): Promise<AddTemplateResult | undefined> {
  // The P29 pre-flight conflict check cannot stand in for this. It arbitrates
  // between templates' DECLARED boundaries, and content that arrived by any
  // other route — a hand-written file, a project the developer started before
  // installing any template, a template applied without recording provenance —
  // is declared by nobody, so no claim over it is ever contested and
  // materialization's whole-file write truncates whatever was there.
  const targetState = await readTargetPathStateFn(targetDir);

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-target-not-directory
  if (targetState === 'file') {
    // No seed remedy here, deliberately: `frontx seed` needs a directory too and
    // refuses this same path, so naming it would send the developer to a second
    // failure rather than to a fix.
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-target-not-directory
    return {
      ok: false,
      reason: 'target-not-directory',
      message:
        `Apply refused — target path "${targetDir}" exists and is not a directory, ` +
        'so no files were written. Adding materializes a template into a repository directory; ' +
        'point it at a directory path, or remove the file occupying this one.',
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-target-not-directory
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-target-not-directory

  // A target that does not exist holds nothing any write could destroy, and
  // materialization creates it — so no path beneath it needs probing.
  if (targetState === 'absent') return undefined;

  // Each contributor's own declared boundary, needed below to tell the ground an
  // incoming claim SHARES with a recorded one from ground it merely falls
  // inside.
  const declaredByContributor = new Map(
    assembly.contributions.map((contribution) => [contribution.templateName, contribution.ownershipBoundaries]),
  );

  const occupiedPaths: string[] = [];
  // The paths this assembly would write, taken from the SAME grouping
  // materialization composes from (`groupContributionsByPath`), so the guard
  // cannot check a set the writes then differ from.
  for (const [path, entries] of groupContributionsByPath(assembly)) {
    const claimed = claimedGroundOf(entries.map((entry) => entry.templateName), declaredByContributor);
    // Exempt only the ground an incoming claim and a recorded claim hold in
    // COMMON — the same shared-file path, or the same exclusive subtree — which
    // is exactly what the pre-flight conflict check compares (`subtreeA !==
    // subtreeB`, `sharedA.path !== sharedB.path`). Two templates co-owning one
    // `region-union` file, and re-applying a template over the subtree it
    // already occupies, both land here and are left to that check, which reports
    // them as the contested claims they are.
    //
    // A path that merely falls INSIDE another template's recorded subtree is not
    // exempt, because nothing arbitrates it: the conflict check compares subtree
    // strings for equality, so a nested subtree or a shared file declared under
    // someone else's subtree passes it untouched, and exempting such a path here
    // would hand it straight to a whole-file write over existing content. No
    // supported flow needs the wider exemption — the reference templates declare
    // disjoint ground on purpose, each claim as narrow as what the template
    // actually ships: the shell claims `src-app/app/` and its siblings rather
    // than `src-app/`, and the MFE template claims its own package directories
    // under `src-app/mfe_packages/` rather than that directory itself, which is
    // what lets a second template own a package beside them.
    if (isArbitratedGround(path, claimed, occupied)) continue;
    if ((await readTargetPathStateFn(`${targetDir}/${path}`)) === 'absent') continue;
    occupiedPaths.push(path);
  }

  // The whole point of the exemption above: a populated directory whose content
  // the incoming template does not claim stays a supported add target.
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-ground-occupied
  if (occupiedPaths.length === 0) return undefined;

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-ground-occupied
  const noun = occupiedPaths.length === 1 ? 'path' : 'paths';
  const pronoun = occupiedPaths.length === 1 ? 'it' : 'them';
  return {
    ok: false,
    reason: 'target-holds-undeclared-content',
    paths: occupiedPaths,
    message:
      `Apply refused — target directory "${targetDir}" already holds content at ${occupiedPaths.length} ` +
      `${noun} this template owns (${summarizeEntries(occupiedPaths)}), and no applied template's recorded ` +
      `provenance accounts for ${pronoun}. Materializing writes each owned path whole and would overwrite ` +
      `${pronoun}, so no files were written. Move or delete the named ${noun}, or record the applied provenance ` +
      `of the template that wrote ${pronoun}, and retry.`,
  };
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-abort-ground-occupied
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-ground-occupied
}

// The ground the templates contributing one path declare for themselves — the
// only ground of theirs a recorded claim can be compared against, since the
// conflict check compares declared claims and nothing else.
function claimedGroundOf(
  contributors: string[],
  declaredByContributor: Map<string, OwnershipBoundary>,
): { subtrees: ReadonlySet<string>; sharedFiles: ReadonlySet<string> } {
  const subtrees = new Set<string>();
  const sharedFiles = new Set<string>();
  for (const contributor of contributors) {
    const boundary = declaredByContributor.get(contributor);
    if (!boundary) continue;
    for (const subtree of boundary.exclusiveSubtrees) subtrees.add(subtree);
    for (const entry of boundary.sharedFiles) sharedFiles.add(entry.path);
  }
  return { subtrees, sharedFiles };
}

// Whether two subtree declarations address the same directory, which mutual
// containment says exactly: `src` and `src/` each contain the other, while a
// nested pair contains in one direction only. Nesting deliberately does NOT
// qualify — the exemption below is for ground both sides declare, and a path
// merely inside another template's subtree is arbitrated by nothing.
function subtreesAddressSameDirectory(a: string, b: string): boolean {
  return pathWithinSubtree(a, b) && pathWithinSubtree(b, a);
}

// Whether a repository-relative path stands on ground a recorded claim and an
// incoming claim BOTH declare: the same shared-file path, or the same exclusive
// subtree containing it. Both halves of that question are decided by
// `pathWithinSubtree`, the same predicate the conflict check and the assembler
// decide them by — matching the claims by raw string would refuse `src` against
// an occupied `src/` here, as content no provenance accounts for, ahead of the
// check whose job is to report that pair as the contest it is.
function isArbitratedGround(
  path: string,
  claimed: { subtrees: ReadonlySet<string>; sharedFiles: ReadonlySet<string> },
  occupied: OccupiedBoundaryEntry[],
): boolean {
  return occupied.some(
    ({ boundary }) =>
      (claimed.sharedFiles.has(path) && boundary.sharedFiles.some((entry) => entry.path === path)) ||
      boundary.exclusiveSubtrees.some(
        (subtree) =>
          pathWithinSubtree(path, subtree) &&
          [...claimed.subtrees].some((claimedSubtree) => subtreesAddressSameDirectory(claimedSubtree, subtree)),
      ),
  );
}
