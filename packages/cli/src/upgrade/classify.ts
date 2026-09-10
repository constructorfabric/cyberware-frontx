// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
// @cpt-algo:cpt-frontx-algo-upgrade-changeset-classify:p1
//
// The three-way, whole-file classification `cpt-frontx-adr-project-upgrade-
// mechanism`'s "Decision Outcome" fixes: for one already-applied target,
// compare the currently recorded origin's payload (baseline) against the
// requested new origin's payload (candidate) and what is actually on disk,
// and turn that comparison into a plan of typed whole-file operations —
// never a merge, never a hunk- or line-level diff. This module computes the
// plan; it never writes anything (`classifyTarget` "never throws for an
// ordinary classification outcome and never writes anything" — the
// commit algorithm, `./commit.ts`, is the only writer).
//
// Two formulations this module MUST NOT restate, per this codebase's "one
// formulation, never a second" convention:
//   - the six-term effective-ownership subtraction
//     (`../scaffold/effective-ownership.ts`'s `computeExclusionRoots` /
//     `isWithinEffectiveOwnership`) — `inst-cls-compute-candidate-boundary`
//     and `inst-cls-compute-baseline-boundary` are calls into it, not a
//     second implementation of it;
//   - the nesting-aware pre-flight conflict check
//     (`../scaffold/conflict-check.ts`'s `checkTargetConflicts`) — reused
//     verbatim for `inst-cls-if-newly-claimed-nested`, exactly the way
//     `commands/ownership.ts`'s single-candidate check already reuses it
//     (`targetsUnderCheck: [{ target, templateName: null,
//     excludedSubtrees: [] }]`).
import path from 'node:path';
import { computeExclusionRoots, isWithinEffectiveOwnership } from '../scaffold/effective-ownership';
import { checkTargetConflicts } from '../scaffold/conflict-check';
import type { TargetClaim } from '../scaffold/conflict-check';
import { isReservedTempName } from '../paths/reserved-temp-name';
import { joinUnderTarget } from '../paths/relative-path';
import type {
  DiskEntry,
  ReadDiskEntryFn,
  ResolvedPayload,
  UpgradeOpKind,
  UpgradeOperation,
  UpgradeSkippedPath,
} from './types';

// The exact inverse of `joinUnderTarget` (`../paths/relative-path.ts`),
// needed to look a classified project-relative path back up in the
// payloads' template-relative `files` maps. Safe because every path this
// module strips was itself produced by `joinUnderTarget(target, ...)`
// elsewhere in this module — never a path handed in from outside this
// module's own bookkeeping.
function stripTarget(target: string, projectRelativePath: string): string {
  return target === '.' ? projectRelativePath : projectRelativePath.slice(target.length + 1);
}

// The one comparison helper the FEATURE requires ("implement one small
// comparison helper so this rule lives in exactly one place"): absence is
// modelled as `null`, an absent path is unequal to any content, and two
// absences are equal. Plain `===` already expresses exactly that for a
// `string | null` pair — no special-casing needed, which is itself the
// point of writing it as its own named function: every one of the seven
// branches below reads the rule from here, so the rule can never drift
// between them.
function contentEquals(a: string | null, b: string | null): boolean {
  return a === b;
}

// What `readDiskEntry` reports, collapsed to the one shape every comparison
// branch below actually needs: a regular file's content, or `null` for an
// absence. Only reachable for a path already cleared by
// `inst-cls-if-not-regular` (a directory, a symlink, or a special file —
// a FIFO, socket, or device — where a payload declares the path is refused
// before this ever runs).
function diskContentOf(entry: DiskEntry): string | null {
  return entry.kind === 'file' ? entry.content : null;
}

// A payload path where the disk holds a directory, a symlink, or a special
// file (a FIFO, socket, or device) instead of a regular file cannot be
// compared at all — the rule this module's own header cites (`architecture/
// ADR/0021-project-upgrade-mechanism.md`, "Decision Outcome"). The identical
// hazard applies one level up: `readDiskEntry` is `lstat`-based on the full
// leaf path only (`../adapters/fs-upgrade-io.ts`'s own header), so it
// correctly reports a symlinked LEAF as `'symlink'`, but an intermediate
// directory component between the project root and the leaf that is itself
// a symlink is simply followed by the OS on every read of a path beneath it
// — a plan naming `app/dir/sub/b.txt` would compare, and let the commit
// algorithm land, content at wherever `app/dir` actually points, while still
// reporting the plan as touching `app/dir/sub/b.txt`. A special file at that
// same ancestor position is a DIFFERENT failure, not a variant of the same
// one: the OS does not resolve it anywhere else the way it does a symlink —
// it simply refuses to descend, so `lstat` on anything beneath it throws
// `ENOTDIR`, which this seam's own `readDiskEntry` — unable to distinguish
// "nothing here" from "something here I cannot get past" — reports as a
// first-class `'absent'`. Left unflagged, that absence would satisfy this
// algorithm's own "two absences are equal" rule for `UNCHANGED`/`KEEP_LOCAL`
// and report nothing to do for content the engine never actually managed to
// read — the false-success shape this ancestor probe exists to close for a
// special file exactly as it already does for a symlink.
//
// The probe below covers the WHOLE chain from the project root down to the
// leaf's parent — `target`'s own path component included, not only the
// components strictly below it. `target` is a string recorded in the
// project state store, never canonicalized by this engine the way `apply`'s
// pre-flight canonicalizes a batch's own target before reconciliation ever
// runs — so a `target` that is itself a symlink, or that sits beneath one,
// reaches this classification unresolved, and carries the identical hazard
// any other ancestor does.
//
// An ancestor that is an ordinary regular FILE — neither a directory, a
// symlink, nor a special file — is exactly as uncomparable as a symlinked
// one: a directory is required at that position for the leaf to exist
// beneath it at all, and a plain file standing there instead means the leaf
// cannot be reached on disk the way the payload declares it — a failure
// this module classifies rather than one the commit algorithm's own write
// should ever have to discover.
//
// `../scaffold/existing-content.ts`'s own `collectSymlinkPaths` /
// `ancestorDirsBelowTarget` closes the identical ancestor-symlink hole on
// the apply side, but it is shaped around a full-tree walk
// (`ReadExistingContentFn` enumerates everything reachable under `target` in
// one call) and its own `ancestorDirsBelowTarget` is a private, unexported
// function of a module this package does not otherwise import a free
// function from (`scaffold/**` belongs to another agent this round). This
// module's own `readDiskEntry` is a per-path probe, not a walk, so the two
// sides carry their own, differently-shaped realizations of the SAME rule
// rather than one shared function — the rule itself stays singular; only
// its two mechanical realizations differ.
function ancestorSegmentsOf(projectPath: string): string[] {
  const segments = projectPath.split('/');
  const ancestors: string[] = [];
  for (let depth = 1; depth < segments.length; depth++) {
    ancestors.push(segments.slice(0, depth).join('/'));
  }
  return ancestors;
}

// What an ancestor probe found standing where a directory is required. Not a
// plain boolean: the caller (`inst-cls-if-not-regular`) reports the two
// symlink outcomes differently at the validate layer — a symlink whose
// resolved target escapes the project root is `INVALID_PATH` (this module
// never returns a refusal code itself; it only classifies and lets the
// caller decide), while a symlink that resolves inside the project, a
// regular file, and a special file (a FIFO, socket, or device) standing
// where a directory belongs, are all `CONTENT_CONFLICT`. Either way this
// module treats them identically for classification purposes: no comparison
// is attempted and the path is recorded doubly-changed. `path` carries the
// ancestor's own project-relative location — never the enumerated payload
// path itself — so a refusal can name which component blocked the path
// rather than leaving a developer to walk the chain by hand.
type BadAncestor =
  | { path: string; kind: 'symlink'; escapesRoot: boolean }
  | { path: string; kind: 'file' }
  | { path: string; kind: 'special' };

// Probes every ancestor directory component of `projectPath`, from the
// project root down to the leaf's parent, through the injected
// `readDiskEntry` seam, returning the first one that cannot stand as a
// directory. `cache` is shared across every enumerated path in one
// `classifyTarget` call (declared once by the caller, at
// `inst-cls-foreach-path`'s own loop below) so a directory shared by many
// enumerated paths — a common `src/` or `app/` prefix — costs exactly one
// `readDiskEntry` call for the whole classification, never one per path
// beneath it.
//
// A symlink ancestor's escape verdict is decided by `canonicalizeFn` — the
// SAME containment resolution `inst-cls-if-newly-claimed-nested` above
// already threads through this module for the nesting check, never a
// second, independently-formulated walk. Handed the ancestor's own
// project-relative path, it resolves every symlink along the way exactly as
// it would for a target string, and reports `null` when the resolved
// location escapes the project root.
async function findBadAncestor(
  projectPath: string,
  repoRoot: string,
  cache: Map<string, DiskEntry>,
  readDiskEntry: ReadDiskEntryFn,
  canonicalizeFn: (raw: string) => string | null,
): Promise<BadAncestor | null> {
  for (const ancestor of ancestorSegmentsOf(projectPath)) {
    let entry = cache.get(ancestor);
    if (entry === undefined) {
      entry = await readDiskEntry(path.join(repoRoot, ancestor));
      cache.set(ancestor, entry);
    }
    if (entry.kind === 'symlink') {
      return { path: ancestor, kind: 'symlink', escapesRoot: canonicalizeFn(ancestor) === null };
    }
    if (entry.kind === 'file') {
      return { path: ancestor, kind: 'file' };
    }
    if (entry.kind === 'special') {
      // A FIFO, socket, or device standing where a directory is required
      // blocks descent through it exactly as a symlink or a regular file
      // does — never treated as `'directory'`'s permitted ancestor shape.
      // This is the exact defect this branch closes: without it, a special
      // file here read as an ordinary directory, every path beneath it went
      // on to `readDiskEntry` and hit `ENOTDIR` (reported `'absent'`), and an
      // `ADD` whose new ancestor would be created here instead reached
      // `fs.mkdirSync` at commit time and crashed on `EEXIST`/`ENOTDIR`.
      return { path: ancestor, kind: 'special' };
    }
  }
  return null;
}

export interface ClassifyInput {
  target: string;
  repoRoot: string;
  baseline: ResolvedPayload;
  candidate: ResolvedPayload;
  projectOwnedRoots: string[];
  localOriginFolder?: string;
  // Every target already recorded across every registered template — EXCLUDING
  // this template's own targets, per `inst-cls-if-newly-claimed-nested`'s own
  // text ("every other registered template's already-recorded targets").
  otherTemplateTargets: { target: string; templateName: string; excludedSubtrees: string[] }[];
  // Reserved ground BEYOND the six-term subtraction, appended to both
  // boundaries: every OTHER registered template's local `path:` origin folder,
  // plus the CANDIDATE's own origin folder (the six-term `localOriginFolder`
  // slot carries the BASELINE's, and on a `path:`->`path:` transition those
  // are different directories).
  //
  // Not a seventh term of the shared formula — the caller's additional
  // subtraction, exactly as `scaffold/assembler.ts`'s
  // `collectOtherLocalOriginFolders` makes it apply's own (appended to each
  // staged entry's `exclusionRoots`) and `scaffold/delete-plan.ts`'s
  // `inst-dp-find-other-origins` makes it delete's own (surfaced in
  // `toPreserve`). Without it an upgrade would ADD/REPLACE/REMOVE inside
  // another template's source-of-truth folder whenever a payload path
  // collides with it — the identical exposure assembler's own comment records
  // as live-confirmed, and which ADR 0021's "Ownership subtraction still
  // applies" driver forbids.
  additionalExclusionRoots: string[];
  readDiskEntry: ReadDiskEntryFn;
  // No `ListDiskFilesFn` here on purpose: classification enumerates only
  // payload-declared paths (see `inst-cls-enumerate` below on why the
  // FEATURE's disk term is dropped in favour of its own ADR), so it has
  // nothing to walk a directory for. The commit algorithm still takes that
  // seam for its own stale-temporary-file reclaim step.
  canonicalizeFn: (raw: string) => string | null;
}

export interface ClassifyResult {
  // The candidate-bounded exclusion roots this classification was computed
  // against, returned so the plan can carry them to the commit algorithm.
  // `inst-com-reclaim-stale-temp` is scoped to "inside any target's effective
  // ownership", and commit is handed a plan rather than the manifests — so
  // without this it could only either re-derive the boundary (plumbing it is
  // never given) or walk the target's whole tree, which would let it unlink a
  // developer's own `*.frontx-upgrade-tmp` sitting in EXCLUDED ground.
  exclusionRoots: string[];
  operations: UpgradeOperation[];
  skipped: UpgradeSkippedPath[];
  // Doubly-changed paths for this target — the caller refuses the whole
  // upgrade with `CONTENT_CONFLICT` when this is non-empty
  // (`inst-cls-if-any-conflict` / `inst-cls-return-conflict`).
  conflictPaths: string[];
  // The SUBSET of `conflictPaths` recorded because the disk shape at (or
  // above) the path cannot be compared at all — a directory, a symlink, or a
  // special file (a FIFO, socket, or device) at the leaf, or a symlink, a
  // regular file, or a special file standing at an ancestor component —
  // rather than because the candidate and the disk each genuinely moved
  // away from the baseline. Mirrors `scaffold/existing-
  // content.ts`'s own `ExistingContentPartitions.uncomparablePaths` (a
  // different module, the SAME distinction) so the two engines' refusals
  // read alike: one cause names "resolve the link or the directory", the
  // other names "reconcile the edit", and a caller that only reads
  // `conflictPaths` behaves exactly as it always has.
  uncomparablePaths: string[];
  // The SUBSET of `uncomparablePaths` recorded because an ancestor symlink's,
  // or the LEAF's own, resolved target escapes the project root, as opposed
  // to one that resolves inside it or a non-symlink obstruction. The caller
  // (`validate.ts`) refuses these with `INVALID_PATH` rather than
  // `CONTENT_CONFLICT` — the same code `commands/apply.ts` already reports
  // for the identical on-disk shape on the apply side — since "this path
  // cannot be proven to stay inside the project" is a different, more
  // fundamental problem than "a symlink stands here, resolve it" and names
  // a different remedy.
  escapingPaths: string[];
  // One entry per path in `uncomparablePaths`, naming the specific component
  // that blocked it — the leaf itself, or the offending ancestor — and its
  // kind. A refusal built from `conflictPaths`/`uncomparablePaths` alone can
  // only say a path is uncomparable; it cannot say WHY without a developer
  // walking the chain by hand. `component` equals `path` itself for a leaf
  // directory, symlink, or special file, and names the offending ancestor's
  // own project-relative location otherwise.
  uncomparableCauses: { path: string; component: string; kind: 'symlink' | 'file' | 'directory' | 'special' }[];
  // Nested-target conflicts for this target — the caller refuses with
  // `TARGET_CONFLICT` when this is non-empty.
  nestedConflicts: { target: string; templateName: string }[];
}

function makeOperation(
  target: string,
  path_: string,
  op: UpgradeOpKind,
  expectedDisk: string | null,
  newContent: string | undefined,
  baselineContent: string | null,
): UpgradeOperation {
  return { target, path: path_, op, expectedDisk, newContent, baselineContent };
}

/**
 * cpt-frontx-algo-upgrade-changeset-classify — classifies one already-
 * applied target's files against its baseline (currently recorded) and
 * candidate (requested new) payloads. See this file's header for the two
 * shared formulations it reuses rather than restates.
 */
export async function classifyTarget(input: ClassifyInput): Promise<ClassifyResult> {
  const { target, repoRoot, baseline, candidate, projectOwnedRoots, localOriginFolder, otherTemplateTargets, additionalExclusionRoots, readDiskEntry, canonicalizeFn } =
    input;

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-compute-candidate-boundary
  // Computed ONCE, from the CANDIDATE manifest's own declared
  // `excludedSubtrees` — never the baseline's, never recomputed per path.
  // This is the boundary every comparison below is confined to.
  const candidateExclusionRoots = [
    ...computeExclusionRoots({
      target,
      excludedSubtrees: candidate.excludedSubtrees,
      projectOwnedRoots,
      localOriginFolder,
    }),
    ...additionalExclusionRoots,
  ];
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-compute-candidate-boundary

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-compute-baseline-boundary
  // The SAME six-term subtraction, from the BASELINE manifest's own
  // declared `excludedSubtrees` — needed only to know which ground is
  // "newly claimed" (inside the candidate boundary but outside this one),
  // never used to gate the comparison loop itself.
  // `additionalExclusionRoots` is appended here TOO, not only to the
  // candidate boundary: ground inside another template's origin folder is
  // outside BOTH boundaries, so it never registers as "newly claimed" and
  // never reaches the nesting check that would otherwise refuse the whole
  // upgrade over ground no version was ever going to write.
  const baselineExclusionRoots = [
    ...computeExclusionRoots({
      target,
      excludedSubtrees: baseline.excludedSubtrees,
      projectOwnedRoots,
      localOriginFolder,
    }),
    ...additionalExclusionRoots,
  ];
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-compute-baseline-boundary

  const skipped: UpgradeSkippedPath[] = [];
  const skippedPaths = new Set<string>();

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-skip-excluded
  // Every path either payload declares, re-rooted under `target`. Read
  // here once so both this step and `inst-cls-enumerate` below share the
  // identical set rather than recomputing it twice and risking the two
  // copies drifting apart.
  const payloadPaths = new Set<string>();
  for (const relativePath of baseline.files.keys()) payloadPaths.add(joinUnderTarget(target, relativePath));
  for (const relativePath of candidate.files.keys()) payloadPaths.add(joinUnderTarget(target, relativePath));

  for (const payloadPath of payloadPaths) {
    if (!isWithinEffectiveOwnership(payloadPath, target, candidateExclusionRoots)) {
      // Outside the candidate boundary: leave disk untouched, make no
      // comparison, report `SKIPPED` — whether because the candidate
      // manifest now excludes ground the baseline owned, or because
      // `projectOwnedRoots`/`.frontx`/a reserved environment entry/the
      // local origin folder excludes it regardless of what changed
      // between the two manifests.
      skipped.push({ target, path: payloadPath, reason: 'OUTSIDE_BOUNDARY' });
      skippedPaths.add(payloadPath);
    }
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-skip-excluded

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-newly-claimed-nested
  // For every subtree the BASELINE manifest excluded: if the CANDIDATE
  // boundary no longer excludes it, that whole subtree is ground newly
  // claimed by this upgrade — ordinary eligible ground unless another
  // registered template's target already nests inside it. Only the
  // baseline's own declared entries need checking: the other five terms
  // of the six-term subtraction (`projectOwnedRoots`, `.frontx`, the
  // reserved environment entries, and the local origin folder) are
  // identical between the two boundary computations above, so they can
  // never themselves produce newly-claimed ground.
  const nestedConflictKeys = new Set<string>();
  const nestedConflicts: { target: string; templateName: string }[] = [];
  const recordedTargets: TargetClaim[] = otherTemplateTargets.map((other) => ({
    target: other.target,
    templateName: other.templateName,
    excludedSubtrees: other.excludedSubtrees,
  }));

  for (const declaredExclusion of baseline.excludedSubtrees) {
    const newlyClaimedRoot = joinUnderTarget(target, declaredExclusion);

    // This is exactly what `baselineExclusionRoots` (computed above) is
    // for: a defensive confirmation that this declaration genuinely lay
    // outside the baseline boundary, rather than trusting membership in
    // `baseline.excludedSubtrees` alone to mean that — a manifest field
    // and the boundary computed from it are two different things to this
    // module, and this is where the latter is actually consulted.
    const wasOutsideBaselineBoundary = !isWithinEffectiveOwnership(newlyClaimedRoot, target, baselineExclusionRoots);
    if (!wasOutsideBaselineBoundary) continue;

    const stillExcludedByCandidate = !isWithinEffectiveOwnership(newlyClaimedRoot, target, candidateExclusionRoots);
    if (stillExcludedByCandidate) continue; // the candidate kept this exclusion; not newly claimed

    // Resubmit this newly-claimed ground through the SAME nesting-aware
    // check `assemble`/`apply`/`ownership add` already run — a single
    // "target under check" with no template identity of its own (mirrors
    // `commands/ownership.ts`'s identical single-candidate shape),
    // against every OTHER template's recorded targets. `projectOwnedRoots`
    // and local origin folders are passed empty here: the ROOT of this
    // ground already passed the six-term subtraction above, so it cannot
    // itself sit inside any of those — the only thing left to learn from
    // this call is whether another template's target nests inside it.
    //
    // The claim carries the CANDIDATE's own re-rooted exclusions, NOT an
    // empty list. Empty was wrong for a candidate that NARROWS an exclusion
    // rather than dropping it: baseline excludes `vendor`, candidate excludes
    // `vendor/generated`. The root `<target>/vendor` is then genuinely newly
    // claimed and submitted here — but with no exclusions on the claim, a
    // legitimately nested target at `<target>/vendor/generated/lib`, on
    // ground the candidate STILL excludes and which the loop below correctly
    // reports `SKIPPED`, was flagged and refused the whole upgrade with
    // `TARGET_CONFLICT`.
    //
    // Passing the candidate's exclusions lets `checkTargetConflicts`' own
    // permitted-nesting exception (`inst-cc-if-excluded-nest`) carve exactly
    // that ground out — reusing the shared checker's own rule rather than
    // pre-filtering the recorded targets here, which would be a second
    // formulation of a nesting rule that module already owns.
    const result = checkTargetConflicts({
      targetsUnderCheck: [
        {
          target: newlyClaimedRoot,
          templateName: null,
          excludedSubtrees: candidate.excludedSubtrees.map((declared) => joinUnderTarget(target, declared)),
        },
      ],
      recordedTargets,
      projectOwnedRoots: [],
      canonicalizeFn,
    });

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-record-nested-conflict
    if (!result.ok && result.kind === 'TARGET_CONFLICT') {
      for (const conflict of result.conflicts) {
        for (const contestant of conflict.contestants) {
          // The one contestant carrying no template name IS this newly-
          // claimed ground's own placeholder claim — never the contesting
          // template.
          if (contestant.templateName === null) continue;
          const key = `${contestant.target}\u0000${contestant.templateName}`;
          if (nestedConflictKeys.has(key)) continue;
          nestedConflictKeys.add(key);
          nestedConflicts.push({ target: contestant.target, templateName: contestant.templateName });
        }
      }
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-record-nested-conflict
    // The rest of this newly-claimed ground remains ordinary eligible
    // ground for classification below, whether or not a conflict was
    // found here — `inst-cls-if-newly-claimed-nested`'s own text: "the
    // rest of that ground remains ordinary eligible ground for
    // classification below".
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-newly-claimed-nested

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-enumerate
  // The enumeration set: every path either payload declares, confined to the
  // candidate boundary, excluding anything already reported `SKIPPED` above.
  //
  // ADR PRECEDENCE OVER THE FEATURE'S STEP TEXT — read this before "fixing"
  // it back. `inst-cls-enumerate`'s own wording adds a third term to this
  // union: "or, as a regular file only ... on disk". Its governing decision
  // contradicts that directly, and in the stronger, more specific terms:
  // `cpt-frontx-adr-project-upgrade-mechanism` says classification runs "over
  // every path at least one of the baseline or candidate payloads declares
  // within the boundary above — NEVER every path the boundary merely admits,
  // so a developer's own file or symlink sitting there that neither payload
  // ever declared is NOT EXAMINED AT ALL". The ADR is the higher-altitude
  // authority and is explicit, so it wins; the FEATURE's step text has been
  // corrected to match rather than left contradicting its own ADR.
  //
  // The standalone disk term is not merely redundant, it is harmful. A path
  // neither payload declares has baseline absent and candidate absent, so it
  // reaches `inst-cls-if-keep-local` (candidate equals baseline; disk differs
  // from baseline) and classifies `KEEP_LOCAL`. Nothing is ever written for
  // it — but it LANDS IN THE PLAN, and the plan is what a developer reviews
  // and approves ("the plan presented is the plan applied"). For a target at
  // the project root that means one `KEEP_LOCAL` line per file in the whole
  // repository, burying the handful of real operations the upgrade actually
  // performs. Whole-file reviewability is the property the ADR chose this
  // entire mechanism for; drowning the plan in no-ops defeats it.
  //
  // Nothing depends on the dropped term. The reserved-temporary-name
  // `SKIPPED` report below is PAYLOAD-driven, not disk-driven — the FEATURE's
  // own acceptance criterion scopes it to "a published template WHOSE PAYLOAD
  // CARRIES a path matching that reserved convention" — and a stale temporary
  // file actually sitting on disk is reclaimed by the commit algorithm's own
  // first step (`inst-com-reclaim-stale-temp`), never by classification. A
  // directory or symlink where a payload DOES declare a path is still refused
  // fail-closed by `inst-cls-if-not-regular` below, which reads disk through
  // `readDiskEntry` per enumerated path and needs no enumeration term of its
  // own.
  const enumerated = new Set<string>();
  for (const payloadPath of payloadPaths) {
    if (skippedPaths.has(payloadPath)) continue;
    enumerated.add(payloadPath);
  }

  // A path matching the reserved temporary-file naming convention the
  // commit algorithm's write phase uses is excluded from comparison the
  // same way a boundary exclusion is — but never silently dropped: it is
  // recorded `SKIPPED`, naming the reserved-convention collision as the
  // reason.
  const enumeratedPaths: string[] = [];
  for (const candidatePath of enumerated) {
    if (isReservedTempName(candidatePath)) {
      skipped.push({ target, path: candidatePath, reason: 'RESERVED_TEMP_NAME' });
      continue;
    }
    enumeratedPaths.push(candidatePath);
  }
  enumeratedPaths.sort();
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-enumerate

  const operations: UpgradeOperation[] = [];
  const conflictPaths: string[] = [];
  const uncomparablePaths: string[] = [];
  const escapingPaths: string[] = [];
  const uncomparableCauses: { path: string; component: string; kind: 'symlink' | 'file' | 'directory' | 'special' }[] = [];
  // Shared across every enumerated path below — see `findBadAncestor`'s own
  // doc comment for why this cache is what keeps a directory shared by many
  // paths a single `readDiskEntry` probe rather than one per path.
  const ancestorEntryCache = new Map<string, DiskEntry>();

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-foreach-path
  for (const projectPath of enumeratedPaths) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-read-three
    const templateRelativePath = stripTarget(target, projectPath);
    const baselineContent = baseline.files.get(templateRelativePath) ?? null;
    const candidateContent = candidate.files.get(templateRelativePath) ?? null;
    const absolutePath = path.join(repoRoot, projectPath);
    const diskEntry = await readDiskEntry(absolutePath);
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-read-three

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-not-regular
    // The ancestor probe runs UNCONDITIONALLY, never gated on what
    // `diskEntry` above reported for the leaf: when an ancestor directory
    // component is a symlink, the OS already resolved it transparently
    // while producing `diskEntry` itself, so a leaf that LOOKS like an
    // ordinary file or absence here may in fact be reporting on whatever
    // the symlink actually points at, not on the path this plan names. See
    // `findBadAncestor`'s own doc comment for the full defect and why this
    // is this module's own formulation of the sibling rule
    // `../scaffold/existing-content.ts` already applies on the apply side.
    const badAncestor = await findBadAncestor(projectPath, repoRoot, ancestorEntryCache, readDiskEntry, canonicalizeFn);
    const carriedByPayload = baselineContent !== null || candidateContent !== null;
    if (
      carriedByPayload &&
      (diskEntry.kind === 'directory' || diskEntry.kind === 'symlink' || diskEntry.kind === 'special' || badAncestor !== null)
    ) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-record-not-regular
      // Fail-closed: a directory, a symlink, or a special file (a FIFO,
      // socket, or device) at the leaf, a symlink at any ancestor directory
      // component, or a regular file or a special file standing where an
      // ancestor directory component belongs — none of these can be
      // compared at all, so no comparison is attempted; this is not weighed
      // against `UNCHANGED` or any other branch below. A special file's own
      // content is never read to reach this conclusion either — opening a
      // FIFO for reading blocks forever waiting for a writer that will never
      // arrive, so `readDiskEntry` itself reports `'special'` without ever
      // touching the file (`../adapters/fs-upgrade-io.ts`'s own header).
      // Recorded in `uncomparablePaths` too, and in `escapingPaths` on top of
      // that when the cause is a symlink — at the leaf itself, or at an
      // ancestor — whose resolved target escapes the project root — see
      // `ClassifyResult`'s own doc comments for why the caller reports each
      // subset differently. A bad ancestor takes precedence over whatever
      // `diskEntry` itself reports for the leaf: when the ancestor is a
      // symlink the OS already resolved it transparently while producing
      // `diskEntry`, so the leaf's own kind may describe content at wherever
      // that link actually points, never at the path this plan names.
      conflictPaths.push(projectPath);
      uncomparablePaths.push(projectPath);
      if (badAncestor !== null) {
        uncomparableCauses.push({ path: projectPath, component: badAncestor.path, kind: badAncestor.kind });
        if (badAncestor.kind === 'symlink' && badAncestor.escapesRoot) {
          escapingPaths.push(projectPath);
        }
      } else {
        // The leaf itself is the bad component (every ancestor cleared).
        // `diskEntry.kind` is `'directory'`, `'symlink'`, or `'special'` here
        // — the only three ways to reach this branch with
        // `badAncestor === null`.
        uncomparableCauses.push({ path: projectPath, component: projectPath, kind: diskEntry.kind as 'directory' | 'symlink' | 'special' });
        if (diskEntry.kind === 'symlink' && canonicalizeFn(projectPath) === null) {
          escapingPaths.push(projectPath);
        }
      }
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-record-not-regular
      continue;
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-not-regular

    const diskContent = diskContentOf(diskEntry);

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-unchanged
    // Tested FIRST, before every other branch below, including when both
    // are absent: there is nothing to do for a path already at its
    // intended state, regardless of what the baseline holds. This
    // precedence is what makes upgrade idempotent and re-runnable — a
    // file the developer created byte-identical to what the candidate
    // adds, a file the candidate removes that the developer already
    // deleted, and a path a crashed run had already landed all converge on
    // `UNCHANGED` here rather than being weighed against the baseline.
    if (contentEquals(diskContent, candidateContent)) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-unchanged
      operations.push(makeOperation(target, projectPath, 'UNCHANGED', diskContent, undefined, baselineContent));
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-unchanged
      continue;
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-unchanged

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-add
    if (candidateContent !== null && baselineContent === null && diskContent === null) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-add
      operations.push(makeOperation(target, projectPath, 'ADD', diskContent, candidateContent, baselineContent));
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-add
      continue;
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-add

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-replace
    // `candidateContent !== null` is required here even though the FEATURE
    // states this branch as "the candidate differs from the baseline": a
    // REPLACE writes the candidate's content, so there must BE candidate
    // content to write (`UpgradeOperation.newContent` is only ever
    // populated "for ADD/REPLACE only"). An absent candidate that differs
    // from a present baseline is the REMOVE case below, tested next —
    // never a REPLACE with nothing to place.
    if (candidateContent !== null && !contentEquals(candidateContent, baselineContent) && contentEquals(diskContent, baselineContent)) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-replace
      operations.push(makeOperation(target, projectPath, 'REPLACE', diskContent, candidateContent, baselineContent));
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-replace
      continue;
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-replace

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-remove
    if (baselineContent !== null && candidateContent === null && contentEquals(diskContent, baselineContent)) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-remove
      operations.push(makeOperation(target, projectPath, 'REMOVE', diskContent, undefined, baselineContent));
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-remove
      continue;
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-remove

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-keep-local
    // Includes the path both versions carry identically that the
    // developer has deleted (`baselineContent === candidateContent`, both
    // non-null, `diskContent === null`): the deletion is itself the edit.
    if (contentEquals(candidateContent, baselineContent) && !contentEquals(diskContent, baselineContent)) {
      // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-keep-local
      // The developer's own edit stands; no write is ever planned for
      // this path.
      operations.push(makeOperation(target, projectPath, 'KEEP_LOCAL', diskContent, undefined, baselineContent));
      // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-keep-local
      continue;
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-keep-local

    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-else-conflict
    // Reached only when the candidate differs from the baseline AND the
    // disk, independently, also differs from both — including a candidate
    // that adds a path the disk already carries content for that the
    // baseline does not account for, and a path the developer deleted
    // that the candidate also changes. Not a sixth operation kind.
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-record-conflict
    conflictPaths.push(projectPath);
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-record-conflict
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-else-conflict
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-foreach-path

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-any-conflict
  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-conflict
  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-ops
  // This function's exported shape (`ClassifyResult`) always carries all
  // four lists together rather than branching into two distinct return
  // shapes: `conflictPaths`/`nestedConflicts` non-empty is exactly
  // `inst-cls-if-any-conflict`'s condition, and it is the CALLER's job
  // (the validate/flow layer this module does not own) to refuse the whole
  // upgrade with `CONTENT_CONFLICT`/`TARGET_CONFLICT` when either is
  // non-empty, per `inst-cls-return-conflict`'s own text ("for the
  // caller to refuse the whole upgrade"). When both are empty, this same
  // return is exactly `inst-cls-return-ops`: the target's per-file
  // operations together with its `SKIPPED` paths.
  return {
    exclusionRoots: candidateExclusionRoots,
    operations, skipped, conflictPaths, uncomparablePaths, escapingPaths, uncomparableCauses, nestedConflicts };
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-ops
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-return-conflict
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-classify:p1:inst-cls-if-any-conflict
}
