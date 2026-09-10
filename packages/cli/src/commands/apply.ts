// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-add-template:p1
// @cpt-state:cpt-frontx-state-composed-provenance-registration-lifecycle:p2
//
// `apply` — cpt-frontx-flow-cli-scaffolding-add-template. Replaces the OLD
// `commands/add-template.ts` (the command TOKEN is `apply`, not `add` —
// confirmed against this FEATURE's own command-surface list). Independently
// re-resolves and re-stages the batch through `uniformApply`
// (`../scaffold/assembler.ts`) — never trusting a prior `assemble` run —
// runs the shared pre-flight conflict check
// (`../scaffold/conflict-check.ts`) against the batch's own entries AND
// everything already recorded, reconciles existing on-disk content for
// every target not already recorded under its template (`../scaffold/
// existing-content.ts`), materializes every non-no-op target, materializes
// each name's CLI-owned AI-extension bundle on its first target
// (`../scaffold/ai-bundle.ts`), and records every newly-applied target into
// the single project state document (`../project-state/io.ts`).
//
// `resolveAndCheckBatch` below is the ONE shared "canonicalize, stage,
// conflict-check" formulation `commands/assemble.ts`'s stateless preview
// and this file's own `runApplyPipeline` both call — never a second,
// independently-reformulated resolve-and-check path for either flow.
// `runApplyPipeline` itself is the ONE shared apply mechanism `apply`'s own
// dispatch and `commands/seed-repository.ts` both call after seed's own
// project-state-creation/default-registration steps — per this package's
// own "no second formulation" discipline.
import path from 'node:path';
import { uniformApply } from '../scaffold/assembler';
import type {
  ResolveInstalledContentPathFn,
  UniformApplyBatch,
  UniformApplyDeps,
  UniformApplyInventoryPort,
} from '../scaffold/assembler';
import { checkTargetConflicts } from '../scaffold/conflict-check';
import type { CanonicalizeTargetFn, TargetClaim } from '../scaffold/conflict-check';
import { reconcileExistingContent } from '../scaffold/existing-content';
import type { ReadExistingContentFn, ReadInstalledContentFn } from '../scaffold/existing-content';
import { materializeOrRemoveAiBundle } from '../scaffold/ai-bundle';
import type { BundleExistsFn, CopyBundleFn, RemoveBundleFn } from '../scaffold/ai-bundle';
import { isWithinEffectiveOwnership } from '../scaffold/effective-ownership';
import type { AssertPathWithinRootFn, ContributionEntry, StagedAssembly, WriteFileFn } from '../scaffold/types';
import { readProjectState, mutateProjectState } from '../project-state/io';
import type { ProjectStateDocument, ReadProjectStateFn, TemplateEntry, WriteProjectStateFn } from '../project-state/types';
import { resolveRegisteredExcludedSubtrees } from '../scaffold/registered-manifest';
import { isTemplatePayloadPath } from '../manifest/types';
import type { ReadFileFn } from '../manifest/types';
import { parseLocalOrigin } from '../resolver/types';
import type { FetchFn, ListFolderFilesFn, PathExistsFn } from '../resolver/types';
import { joinUnderTarget } from '../paths/relative-path';
import { foldForIdentity } from '../paths/volume-case';
import type { ErrorCode } from '../envelope';
// `apply`'s own blanket `catch` at the end of `runApplyPipeline` must not
// report two deliberate, typed refusals as `INTERNAL`: `PathContainmentError`
// (`../adapters/fs-project-io.ts`, thrown by `createFsWriteProjectStateFn`
// when `.frontx` itself resolves outside the project root through a
// symlink) and `ExistingSymlinkDestinationError` (same file, thrown by
// `createFsWriteFileFn` when a payload path already exists as a symlink)
// already know their own honest error code and must be mapped to it before
// the generic catch below ever sees them. Unlike `upgrade/commit.ts`, which
// handles the identical case for the upgrade engine by RETHROWING
// `PathContainmentError` for `cli.ts`'s own top-level `run()` catch to map,
// this file does NOT rethrow: `seed` (`commands/seed-repository.ts`) reads
// `details.writtenPaths` off THIS function's own RETURNED outcome to roll
// back, and a rethrow here would hand seed an exception it never gets a
// chance to catch cleanly — exactly what `runApplyPipeline`'s own generic
// catch below is written to prevent for every OTHER thrown failure. A
// deliberate, typed refusal must never arrive as `INTERNAL`: that code
// tells a caller the CLI itself broke, when in fact the CLI worked
// correctly and the tree it was pointed at is the problem — the same
// distinction `PathContainmentError` and `ExistingSymlinkDestinationError`
// already carry in their own names.
import { PathContainmentError, ExistingSymlinkDestinationError } from '../adapters/fs-project-io';
import { AiNamespaceAliasError } from '../adapters/fs-ai-bundle';
import type { RemoveProjectFileFn } from '../upgrade/types';

/**
 * Canonicalizes every target in a raw batch to a project-relative path,
 * fail-closed on the first target that cannot be proven to stay inside the
 * project root. Run BEFORE `uniformApply` stages the batch (rather than
 * left to the conflict check's own `inst-cc-canonicalize` alone) so every
 * downstream step — effective-ownership computation inside `uniformApply`,
 * existing-content reconciliation, materialization, and project-state
 * recording — all operate on the SAME canonical spelling the conflict check
 * itself will re-derive (idempotently) from an already-canonical input,
 * rather than three different steps risking three different ideas of what
 * one raw target string resolves to.
 */
function canonicalizeBatch(
  batch: UniformApplyBatch,
  canonicalizeFn: CanonicalizeTargetFn,
): { ok: true; batch: UniformApplyBatch } | { ok: false; rawTarget: string } {
  const templates: Record<string, string[]> = {};
  for (const [name, targets] of Object.entries(batch.templates)) {
    // De-duplicated AFTER canonicalization, never before: two raw spellings a
    // developer might write for one location (`pkg/a` and `./pkg/a`) are one
    // target, and only canonicalization can tell. Without this, the conflict
    // check deliberately no-ops a same-name-same-target pair
    // (`inst-cc-record-same-target`), so a duplicate reached
    // `inst-add-record` and was appended to `templates[name].targets` twice —
    // a project state document asserting a target is applied twice, which no
    // sequence of real operations could otherwise produce. Deletion happened
    // to clear both copies (`delete.ts` filters by value), so the duplicate
    // was inert rather than dangerous, but a state document that lies about
    // its own contents is a defect regardless of who currently reads it.
    const canonicalTargets: string[] = [];
    for (const rawTarget of targets) {
      const canonical = canonicalizeFn(rawTarget);
      if (canonical === null) return { ok: false, rawTarget };
      // Folds case per the project volume (`paths/volume-case.ts`), not a
      // bare `.includes`: two spellings of one not-yet-existing target
      // (`app`/`App`) in this SAME template's own list are the identical
      // ground `checkTargetConflicts` would otherwise refuse as a
      // `TARGET_CONFLICT` a moment later — this template's own idempotent
      // duplicate, not a conflict with itself, so it is dropped here exactly
      // as an exact-spelling duplicate already is.
      if (canonicalTargets.some((existing) => foldForIdentity(existing) === foldForIdentity(canonical))) continue;
      canonicalTargets.push(canonical);
    }
    templates[name] = canonicalTargets;
  }
  return { ok: true, batch: { templates } };
}

/**
 * Every local `path:` origin folder currently registered across the WHOLE
 * project state document — not only the batch's own templates — since ANY
 * registered template's local origin folder is reserved ground a target
 * under check must never land on (`conflict-check.ts`'s own
 * `localOriginFolders` input). Mirrors `scaffold/delete-plan.ts`'s own
 * (unexported) `deriveLocalOriginFolder`, generalized from one owning
 * template to every registered one.
 */
function collectLocalOriginFolders(document: ProjectStateDocument, canonicalizeFn: CanonicalizeTargetFn): string[] {
  const folders: string[] = [];
  for (const entry of Object.values(document.templates)) {
    const relativePath = parseLocalOrigin(entry.origin);
    if (relativePath === undefined) continue;
    const canonical = canonicalizeFn(relativePath);
    if (canonical !== null) folders.push(canonical);
  }
  return folders;
}

/**
 * The recorded-target claim set every registered template's `targets[]`
 * joins onto its own manifest's `excludedSubtrees` — the declared list is
 * re-derived through `resolveRegisteredExcludedSubtrees`
 * (`../scaffold/registered-manifest.ts`), the ONE shared formulation that
 * correctly resolves BOTH a remote (inventory-installed) and a local
 * `path:`-registered name's current manifest, rather than `inventory.lookup`
 * alone (which silently returns `[]` for a local origin).
 * `commands/ownership.ts`'s own
 * `buildRecordedTargets` calls the identical shared function for the
 * identical join.
 */
async function buildRecordedTargetClaims(
  templates: Record<string, TemplateEntry>,
  repoRoot: string,
  inventory: UniformApplyInventoryPort,
  readFileFn: ReadFileFn,
  canonicalizeFn: CanonicalizeTargetFn,
): Promise<TargetClaim[]> {
  const claims: TargetClaim[] = [];
  for (const [name, entry] of Object.entries(templates)) {
    if (entry.targets.length === 0) continue;
    const resolution = await resolveRegisteredExcludedSubtrees(name, entry.origin, {
      repoRoot,
      inventory,
      readFileFn,
      canonicalizeFn,
    });
    // `name` here is an OTHER registered template than whichever this batch
    // is staging — its manifest cannot currently be read (`resolution.known
    // === false`, a FIFO, a permission error, ...) is not this claim-set's
    // failure to raise (`cpt-frontx-cli-nfr-template-scale`'s per-template
    // independence: confirmed live, a `chmod 000` on ONE registered
    // template's manifest must never block `apply`/`assemble` for a
    // completely different one). Joining `[]` here can only make `name`'s
    // own claim WIDER, which can only ADMIT more conflicts, never silently
    // permit one.
    const declaredExclusions = resolution.known ? resolution.excludedSubtrees : [];
    for (const target of entry.targets) {
      const excludedSubtrees = declaredExclusions.map((declared) => joinUnderTarget(target, declared));
      claims.push({ target, templateName: name, excludedSubtrees });
    }
  }
  return claims;
}

export interface ResolveAndCheckDeps {
  inventory: UniformApplyInventoryPort;
  fetchFn: FetchFn;
  readFileFn: ReadFileFn;
  canonicalizeFn: CanonicalizeTargetFn;
  // The shared resolver's own local-origin seams (`resolver/types.ts`'s
  // `LocalOriginDeps`) — threaded through to `uniformApply`'s
  // `resolveRegisteredTemplate`, which resolves a `path:`-registered name
  // through the same resolver register.ts's own resolution already uses.
  existsFn: PathExistsFn;
  listFolderFilesFn: ListFolderFilesFn;
  resolveInstalledContentPathFn: ResolveInstalledContentPathFn;
}

export type ResolveAndCheckOutcome =
  | { ok: true; document: ProjectStateDocument; assembly: StagedAssembly }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-uniform-apply:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-conflict-check:p1
/**
 * Reads the current project state document, canonicalizes and stages the
 * batch through `uniformApply`, and runs the pre-flight conflict check
 * against the batch's own entries plus everything already recorded. The
 * ONE resolve-and-check path `assemble` (stateless preview) and `apply`
 * (via `runApplyPipeline` below) both call — realizing, for EITHER caller,
 * `inst-asm-resolve`/`inst-asm-if-resolve-fail`/`inst-asm-return-resolve-
 * fail`/`inst-asm-conflict-check`/`inst-asm-if-conflict`/`inst-asm-return-
 * conflict` (`cpt-frontx-flow-cli-scaffolding-assemble-preview`) and
 * `inst-add-resolve`/`inst-add-if-resolve-fail`/`inst-add-return-resolve-
 * fail`/`inst-add-conflict-check`/`inst-add-if-conflict`/`inst-add-return-
 * conflict` (`cpt-frontx-flow-cli-scaffolding-add-template`) at once —
 * never two independently-formulated resolve-and-check paths for the two
 * flows.
 */
// @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-resolve
// @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve
export async function resolveAndCheckBatch(
  rawBatch: UniformApplyBatch,
  repoRoot: string,
  deps: ResolveAndCheckDeps,
  readProjectStateFn: ReadProjectStateFn,
): Promise<ResolveAndCheckOutcome> {
  const stateResult = await readProjectState(repoRoot, readProjectStateFn);
  if (!stateResult.ok) {
    return { ok: false, code: 'PROJECT_INVALID', message: stateResult.message };
  }
  const document = stateResult.document;

  const canonicalized = canonicalizeBatch(rawBatch, deps.canonicalizeFn);
  if (!canonicalized.ok) {
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-resolve
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-resolve
    return {
      ok: false,
      code: 'INVALID_PATH',
      message: `Target "${canonicalized.rawTarget}" could not be proven to stay inside the project root.`,
      // `path`, not `target`: this is the same single-offending-path shape
      // every other `INVALID_PATH` refusal in this package's `details`
      // already carries (`commands/ownership.ts`, `commands/validate.ts`,
      // and this file's own `PathContainmentError` catch below) — one
      // vocabulary for one fact, rather than a second field name invented
      // for the identical thing because this refusal happens to fire from a
      // different call site.
      details: { path: canonicalized.rawTarget },
    };
  }

  const uniformDeps: UniformApplyDeps = {
    repoRoot,
    inventory: deps.inventory,
    fetchFn: deps.fetchFn,
    readFileFn: deps.readFileFn,
    canonicalizeFn: deps.canonicalizeFn,
    existsFn: deps.existsFn,
    listFolderFilesFn: deps.listFolderFilesFn,
    resolveInstalledContentPathFn: deps.resolveInstalledContentPathFn,
  };
  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-req-resolved
  const staged = await uniformApply(canonicalized.batch, document, uniformDeps);
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-req-resolved

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-if-resolve-fail
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-resolve-fail
  if (!staged.ok) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-return-resolve-fail
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-req-aborted-unresolved
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-resolve-fail
    return {
      ok: false,
      code: staged.code,
      message: staged.message,
      details: staged.code === 'TEMPLATE_NOT_REGISTERED' ? { name: staged.name } : { name: staged.name, origin: staged.origin },
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-resolve-fail
    // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-req-aborted-unresolved
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-return-resolve-fail
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-resolve-fail
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-if-resolve-fail

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-conflict-check
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-conflict-check
  const targetsUnderCheck: TargetClaim[] = staged.assembly.entries.map((entry) => ({
    target: entry.target,
    templateName: entry.templateName,
    // `entry.excludedSubtrees` is the template's RAW, target-relative
    // declared list (`scaffold/types.ts`'s own `ContributionEntry` doc
    // comment) — joined under THIS entry's own target here, exactly as
    // `buildRecordedTargetClaims` above joins a recorded target's declared
    // list under ITS target, so both sides of the conflict check's nesting
    // comparison (`conflict-check.test.ts`'s own fixtures: a project-
    // relative `excludedSubtrees` entry such as `packages/app/admin/` for
    // target `packages/app`) are the same project-relative shape.
    excludedSubtrees: entry.excludedSubtrees.map((declared) => joinUnderTarget(entry.target, declared)),
  }));
  const recordedTargets = await buildRecordedTargetClaims(
    document.templates,
    repoRoot,
    deps.inventory,
    deps.readFileFn,
    deps.canonicalizeFn,
  );
  const localOriginFolders = collectLocalOriginFolders(document, deps.canonicalizeFn);

  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-resolved-checked
  const verdict = checkTargetConflicts({
    targetsUnderCheck,
    recordedTargets,
    projectOwnedRoots: document.projectOwnedRoots,
    localOriginFolders,
    canonicalizeFn: deps.canonicalizeFn,
  });
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-resolved-checked

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-if-conflict
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-conflict
  if (!verdict.ok) {
    if (verdict.kind === 'INVALID_PATH') {
      // Defensive: every target under check was already canonicalized above
      // (`canonicalizeBatch`), so the checker's own internal
      // re-canonicalization of an already-canonical string cannot genuinely
      // disagree — kept only so this branch is exhaustive over
      // `ConflictCheckResult`'s discriminant rather than assumed away.
      return {
        ok: false,
        code: 'INVALID_PATH',
        message: `Target "${verdict.path}" could not be proven to stay inside the project root.`,
        // Same `path` shape as every other single-offending-path
        // `INVALID_PATH` refusal in this package — see the sibling refusal
        // just above this function's own `canonicalizeBatch` check for the
        // full reasoning.
        details: { path: verdict.path },
      };
    }
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-return-conflict
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-resolved-aborted-conflict
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-conflict
    const contestingTemplates = [
      ...new Set(
        verdict.conflicts.flatMap((conflict) =>
          conflict.contestants.map((contestant) => contestant.templateName).filter((n): n is string => n !== null),
        ),
      ),
    ];
    return {
      ok: false,
      code: 'TARGET_CONFLICT',
      message:
        `Aborted — the staged batch has an intersecting claim contested by: ${contestingTemplates.join(', ') || 'unknown'}; ` +
        'nothing written.',
      details: { conflicts: verdict.conflicts },
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-conflict
    // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-resolved-aborted-conflict
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-return-conflict
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-conflict
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-if-conflict
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-conflict-check
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-assemble-preview:p1:inst-asm-conflict-check

  return { ok: true, document, assembly: staged.assembly };
}

// Mirrors `existing-content.ts`'s own (unexported) `computePayloadSet`
// exactly — restated here rather than imported (that function is private to
// that module) so materialization writes precisely the payload paths
// reconciliation itself judged, never a second, independently-recomputed
// idea of what the payload is. The one part of "what the payload is" that
// is NOT restated here is the manifest/`.frontx`-namespace exclusion:
// `isTemplatePayloadPath` (`../manifest/types.ts`) is the shared
// formulation both this function and `existing-content.ts`'s
// `computePayloadSet` call, so the two mirrored functions can never drift
// on that question independently of each other. It is applied to
// `item.path` — still template-relative — BEFORE re-rooting under
// `entry.target`, because a non-`.` target would otherwise re-root the
// manifest as `<target>/frontx-template.json`, which a check against the
// bare `MANIFEST_FILENAME` would never recognize.
async function computePayloadForTarget(
  entry: ContributionEntry,
  readInstalledContentFn: ReadInstalledContentFn,
): Promise<Map<string, string>> {
  const rawContent = await readInstalledContentFn(entry.installedContentPath);
  const payload = new Map<string, string>();
  for (const item of rawContent) {
    if (!isTemplatePayloadPath(item.path)) continue;
    const projectPath = entry.target === '.' ? item.path : `${entry.target}/${item.path}`;
    if (!isWithinEffectiveOwnership(projectPath, entry.target, entry.exclusionRoots)) continue;
    payload.set(projectPath, item.content);
  }
  return payload;
}

// The human-readable name for each `uncomparableCauses` `kind` — the one
// formulation both branches of `describePathCause` below read from, so the
// wording for, say, `'special'` cannot drift between "at the path" and "as
// an ancestor" phrasing.
function describeCauseKind(kind: 'symlink' | 'file' | 'directory' | 'special'): string {
  switch (kind) {
    case 'symlink':
      return 'a symlink';
    case 'file':
      return 'a regular file';
    case 'directory':
      return 'a directory';
    case 'special':
      return 'a special file (a FIFO, socket, or device) whose content cannot be read safely';
  }
}

// Names the specific component `cause` blames for making `path` uncomparable
// — the payload path itself (a symlink, a directory, or a special file
// stands there), or the offending ancestor directory component (a symlink,
// a regular file, or a special file stands where a directory is required)
// — so a refusal tells a developer, for example, `"app2/dir" is a regular
// file` rather than leaving them to walk the chain by hand.
function describePathCause(
  path: string,
  cause: { component: string; kind: 'symlink' | 'file' | 'directory' | 'special' } | undefined,
): string {
  if (cause === undefined) return path; // defensive: every uncomparable path carries a cause
  if (cause.component === path) return `${path} (${describeCauseKind(cause.kind)} stands at the path)`;
  return `${path} (ancestor "${cause.component}" is ${describeCauseKind(cause.kind)}, not a directory)`;
}

// The ONE place the `CONTENT_CONFLICT` message for an unrecorded target's
// content conflicts is composed — isolated into its own function rather
// than inlined at the one call site below.
//
// `contentConflicts` (`scaffold/existing-content.ts`'s own
// `ExistingContentPartitions`) unions two internally-distinct causes —
// content that differs from the payload's declared text
// (`inst-ec-add-conflict`) and a path that cannot be compared at all because
// a symlink or a regular file stands at it or on the way to it
// (`inst-ec-add-symlink-conflict`) — into one flat list
// (`contentConflicts`/`paths` here). `uncomparablePaths` (same type) is the
// SUBSET of that list caused by the latter case — populated at
// `inst-ec-add-symlink-conflict`, never at `inst-ec-add-conflict` — so this
// function can partition `paths` by membership in it: a path that branch
// refused is named as uncomparable, together with the specific component
// `uncomparableCauses` blames, everything else as differing, and a developer
// is never sent looking for a content difference that does not exist. Either
// clause is omitted entirely when its list is empty — a batch refused for
// one cause alone reads as one sentence about that cause, not a disjunction
// inviting the reader to guess.
function describeContentConflictCause(
  paths: readonly string[],
  uncomparable: readonly string[],
  uncomparableCauses: readonly { path: string; component: string; kind: 'symlink' | 'file' | 'directory' | 'special' }[],
): string {
  const uncomparableSet = new Set(uncomparable);
  const differing = paths.filter((candidate) => !uncomparableSet.has(candidate));
  const causeByPath = new Map(uncomparableCauses.map((cause) => [cause.path, cause]));
  const clauses: string[] = [];
  if (differing.length > 0) {
    clauses.push(`differs from what the template's payload declares at: ${differing.join(', ')}`);
  }
  if (uncomparable.length > 0) {
    clauses.push(
      'cannot be compared against the payload at all: ' +
        uncomparable.map((path) => describePathCause(path, causeByPath.get(path))).join(', '),
    );
  }
  return `Aborted — existing content ${clauses.join('; and it ')}; nothing written.`;
}

export interface ApplyPipelineDeps extends ResolveAndCheckDeps {
  readInstalledContentFn: ReadInstalledContentFn;
  readExistingContentFn: ReadExistingContentFn;
  writeFileFn: WriteFileFn;
  readProjectStateFn: ReadProjectStateFn;
  writeProjectStateFn: WriteProjectStateFn;
  bundleExistsFn: BundleExistsFn;
  copyBundleFn: CopyBundleFn;
  removeBundleFn: RemoveBundleFn;
  // Proves an individual payload path stays inside `repoRoot`, symlinks
  // resolved, immediately before `writeFileFn` is called for it — see this
  // file's own comment about per-payload-path containment below for why
  // canonicalizing the batch's own TARGET is not enough. Curried over
  // the caller's own applicable root (`createFsAssertPathWithinRootFn`,
  // `../adapters/fs-project-io.ts`) at the `cli.ts` dispatch site, exactly
  // as `canonicalizeFn` already is.
  assertPathWithinRootFn: AssertPathWithinRootFn;
  // The two seams `rollbackWrittenPaths` below needs to make "nothing
  // recorded" also mean "nothing left" (`inst-add-rollback-writes`) —
  // reused rather than reinvented. `removeProjectFileFn` is the SAME
  // `RemoveProjectFileFn` shape `commands/delete.ts` already calls to remove
  // one `toDelete` entry, and the SAME real adapter
  // (`createFsRemoveProjectFileFn`, `../adapters/fs-project-io.ts`) already
  // wired into `CliDeps` for `register`/`unregister`/`ownership`/`delete`. A
  // second, independently-named "remove one file" seam for this call site
  // would be a second formulation of a rule this package has already
  // settled once. `removeEmptyDirFn` lives here, shared by both this
  // pipeline and `commands/seed-repository.ts`'s own rollback — see
  // `RemoveEmptyDirFn`'s own doc comment below for why.
  removeProjectFileFn: RemoveProjectFileFn;
  removeEmptyDirFn: RemoveEmptyDirFn;
}

// Shared by both `apply`'s own post-materialization rollback
// (`rollbackWrittenPaths` below) and `commands/seed-repository.ts`'s own
// rollback: a directory a failed batch's writes brought into being and left
// empty on a refusal is exactly as much apply's to remove as one seed's
// writes create, for the identical reason — no existing seam can remove a
// DIRECTORY (every other project-state seam reads/writes the one
// `.frontx/project.json` FILE, or removes a single file). One type,
// imported by both callers, rather than two independently-declared copies
// of the same function shape.
export type RemoveEmptyDirFn = (absolutePath: string) => Promise<void>;

// The ONE shared removal formulation both `apply`'s own post-materialization
// rollback and `seed`'s own rollback (`commands/seed-repository.ts`'s
// `rollbackSeedWrites`) call (`inst-add-rollback-writes`), rather than two
// independently duplicated directory-pruning walks. Removes every file
// in `writtenPaths` (project-relative to `repoRoot` — exactly the shape
// `ApplyBatchOutcome`'s own `details.writtenPaths` already carries), then
// prunes every directory those removals leave empty, deepest-first,
// bounded by `repoRoot` itself: `repoRoot` is never a candidate (a caller
// removing its OWN writes has no business ever removing the project root
// it was invoked against), and neither is anything above it. "Deepest
// first" matters because `removeEmptyDirFn`'s own contract — no-op unless
// the directory is ALREADY empty — means a parent can only ever become
// removable once its child already was; sorting by path-segment count,
// descending, guarantees every child is considered before the parent that
// would otherwise still see it standing.
//
// `dirsThisCallCreated` is what keeps the pruning honest, and it is not
// optional: pruning every emptied ancestor up to `repoRoot` — rather than
// only directories THIS CALL created — would quietly delete a directory the
// DEVELOPER created and this batch merely wrote into. For example, a
// project with its own empty `app/`, a payload declaring `app/dir/
// file.txt`, and a post-materialization refusal: pruning to root would
// remove the file, then `app/dir`, then `app` itself, taking the
// developer's own directory with it and reporting nothing about it. A
// rollback may only undo what the call itself did; a directory already
// standing when materialization began is not this call's to remove,
// however empty the file's removal leaves it. So the walk climbs only
// through directories
// named in this set, and stops at the first one that is not — the set
// `runApplyPipeline` fills in its pre-write pass, BEFORE any write, which is
// the only moment "was this already here" is still answerable at all. A
// caller that cannot answer it passes an EMPTY set and prunes nothing:
// leaving an empty directory behind is a residue, while removing someone
// else's is damage, and the two are not comparable.
//
// Every path in `writtenPaths` is safe to remove outright, never merely
// "probably" safe: `apply` never overwrites pre-existing content (a content
// conflict or an un-adopted additional path both abort BEFORE
// materialization, per `cpt-frontx-dod-cli-scaffolding-existing-content-
// protocol`, and an ADOPTED additional path is never written at all — see
// `runApplyPipeline`'s own `adoptedSnapshots` mechanism), so every path this
// function is ever asked to remove is a file THIS CALL itself brought into
// being.
//
// A refusal reached AFTER the AI-extension bundle step
// (`inst-add-materialize-bundle`) must roll back every `.frontx/ai/
// <name>/` bundle THIS CALL itself materialized, not only `writtenPaths` —
// the ordinary payload files. Otherwise, consider a two-template batch
// where each name ships both a payload file and a bundle, refused during
// the project-state RECORD step (an EACCES on a read-only `.frontx`) before
// either name committed: the payload files would be correctly removed, but
// both bundle directories would survive with `targets: []` for both names,
// and `validate --project` would report PASS over ground no state document
// mentions — precisely what `cpt-frontx-dod-cli-scaffolding-uniform-apply`'s
// own DoD text rules out ("nothing recorded" must also mean "nothing
// left"). `.frontx/ai/<name>/` is CLI-owned ground by `architecture/ADR/
// 0031-template-ownership-boundary-declaration.md` — no template ever
// claims or writes it — so removing a bundle THIS CALL created is this
// rollback reclaiming its own ground, the identical discipline
// `createFsCopyBundleFn`'s own `clearBundleDestination` already rests on
// for the analogous "this path is the CLI's alone, so clearing whatever
// stands there is never a destructive guess" reasoning.
//
// `bundledNamesThisCall` carries EXACTLY the names this call's own bundle
// step materialized a bundle for — never a name whose bundle already stood
// before this call ran (`runApplyPipeline`'s bundle loop already skips any
// name with `targetsBefore > 0`, so a batch that adds a SECOND target to an
// already-bundled name never adds that name here, and this rollback never
// touches its bundle). The narrow exception `dirsThisCallCreated` already
// observes — an earlier name in the SAME batch whose targets were already
// committed to the project state store keeps its files — is respected
// identically for bundles: every call site below only invokes this function
// at all when no name has yet committed (`recordedAnyThisCall`/`canRollback`
// gate every call site the same way they already gate the file removal), so
// a committed name's bundle is never reached by this loop either — not
// because this function special-cases it, but because it is never called in
// that case.
// @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-rollback-writes
export async function rollbackWrittenPaths(
  repoRoot: string,
  writtenPaths: readonly string[],
  removeProjectFileFn: RemoveProjectFileFn,
  removeEmptyDirFn: RemoveEmptyDirFn,
  dirsThisCallCreated: ReadonlySet<string>,
  removeBundleFn: RemoveBundleFn,
  bundledNamesThisCall: ReadonlySet<string>,
): Promise<void> {
  const candidateDirs = new Set<string>();
  for (const relativePath of writtenPaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    await removeProjectFileFn(absolutePath);
    // `relativePath` is project-relative (no `..` segment can survive
    // `joinUnderTarget`/effective-ownership scoping this far), so
    // `absolutePath` is always a proper descendant of `repoRoot` and this
    // walk is guaranteed to reach `repoRoot` itself — never the filesystem
    // root above it — and stop there.
    let dir = path.dirname(absolutePath);
    while (dir !== repoRoot && dirsThisCallCreated.has(dir)) {
      candidateDirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  const deepestFirst = [...candidateDirs].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length,
  );
  for (const dir of deepestFirst) {
    await removeEmptyDirFn(dir);
  }
  for (const name of bundledNamesThisCall) {
    await removeBundleFn(repoRoot, name);
  }
}
// @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-rollback-writes

// The ONE trailing clause every refusal message below composes from
// `writtenPaths` — never a per-call-site restatement of the same sentence.
// The clause must not always say "remain on disk": once a refusal starts
// rolling those same paths back (`rollbackWrittenPaths` above), a message
// cannot honestly say both "nothing was recorded" and "N files remain on
// disk" in the same breath. `removed` names which of the
// two is true for THIS call site: `false` only for the one refusal that
// still cannot roll back (a mid-record-loop failure after an earlier name
// in the same batch already committed, `recordedAnyThisCall`'s own doc
// comment above).
//
// Exported so `commands/seed-repository.ts` can strip this EXACT clause back
// off `applyResult.message` before composing its own wrapper text
// (`stripWrittenPathsClause`) — seed's own rollback runs AFTER apply already
// returned, so whatever this function said about `writtenPaths` at the
// moment apply composed it may no longer be true once seed's rollback runs
// too; reusing this same formulation to find and remove that clause is the
// one honest way to recover apply's underlying REASON without seed
// re-deriving or re-guessing the clause's exact wording a second time.
export function describeWrittenPaths(writtenPaths: readonly string[], removed: boolean): string {
  if (writtenPaths.length === 0) return ' Nothing from this batch was written to disk.';
  return removed
    ? ` ${writtenPaths.length} file(s) this batch had written have been removed as part of this refusal: ${writtenPaths.join(', ')}.`
    : ` ${writtenPaths.length} file(s) this batch already wrote remain on disk: ${writtenPaths.join(', ')}.`;
}

// The trailing clause naming which AI-extension bundles this call
// materialized — the honesty `describeWrittenPaths` already owes
// `writtenPaths` extended to `bundledNamesThisCall`, with the identical
// `removed` discriminant: a bundle a rollback actually removed and a bundle
// left standing (the one case a rollback deliberately does not run — an
// earlier name in the same batch already committed its targets to the
// project state store) are different facts on disk, and a caller acting on
// this message — most of all `seed`, whose own rollback reads
// `details.bundledNames` to know what is left for it to remove regardless
// of which of the two is true — needs to know which. A separate function,
// not folded into `describeWrittenPaths` itself, because the two lists
// answer different questions (which PAYLOAD FILES were written vs. which
// NAMES got a bundle) and a batch can have one without the other (a
// content-conflict refusal never reaches the bundle step at all, so calling
// this with an empty set there composes no clause — `writtenPaths.length ===
// 0` in `describeWrittenPaths` already keeps THAT function silent for the
// symmetrical reason).
//
// Exported for the identical reason `describeWrittenPaths` is: this
// function's own output is the SECOND trailing clause `commands/seed-
// repository.ts`'s `stripWrittenPathsClause` must recognize and strip back
// off `applyResult.message` before composing its own wrapper text — seed's
// rollback runs AFTER apply already composed this exact sentence, so
// whatever it said about `bundledNamesThisCall` at that moment may no longer
// be true once seed's OWN rollback also runs.
export function describeBundleRollback(bundledNamesThisCall: ReadonlySet<string>, removed: boolean): string {
  if (bundledNamesThisCall.size === 0) return '';
  const names = [...bundledNamesThisCall];
  return removed
    ? ` ${names.length} AI-extension bundle(s) this batch had materialized have also been removed as part of ` +
        `this refusal: ${names.join(', ')}.`
    : ` ${names.length} AI-extension bundle(s) this batch had materialized remain on disk: ${names.join(', ')}.`;
}

// The `details.bundledNames` fragment every refusal below spreads in
// alongside `writtenPaths` — present whenever this call materialized at
// least one bundle, regardless of whether THIS refusal is the one that
// rolls it back: a bundle left standing (the earlier-name-already-committed
// case) is exactly as much this call's own doing as one it just removed,
// and a caller deciding what is left on disk — `seed`'s own rollback most of
// all — needs the name either way, the same reason `writtenPaths` itself
// spreads into `details` unconditionally rather than only when a removal
// happened. Exists so `seed-repository.ts` can recover WHICH names
// `describeBundleRollback` named, the same way it already recovers
// `writtenPaths` from `details` — a message-only record (`bundledNamesThisCall`
// itself never survives past this function's own return) would leave seed's
// own `stripWrittenPathsClause` nothing to reconstruct the exact clause to
// strip.
function bundledNamesDetail(bundledNamesThisCall: ReadonlySet<string>): { bundledNames: string[] } | Record<string, never> {
  return bundledNamesThisCall.size > 0 ? { bundledNames: [...bundledNamesThisCall] } : {};
}

export interface ApplyBatchTargetRef {
  templateName: string;
  target: string;
}

export type ApplyBatchOutcome =
  | { ok: true; applied: ApplyBatchTargetRef[]; noop: ApplyBatchTargetRef[] }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-existing-content-protocol:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-ai-bundle:p1
/**
 * cpt-frontx-flow-cli-scaffolding-add-template's own apply mechanism — the
 * ONE shared pipeline both the `apply` command (this file's own dispatch)
 * and `seed` (`../commands/seed-repository.ts`, AFTER its own project-
 * state-creation and default-registration steps) call, rather than two
 * independently duplicated materialize/reconcile/record sequences.
 */
// @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-invoke
export async function runApplyPipeline(
  rawBatch: UniformApplyBatch,
  repoRoot: string,
  adoptExisting: boolean,
  deps: ApplyPipelineDeps,
): Promise<ApplyBatchOutcome> {
  // The batch names one or more registered templates and their targets,
  // "individually or together" — the uniform batch shape is what makes those
  // the same invocation rather than two command forms. Whether the
  // repository already has an applied target is a property of the recorded
  // state this pipeline goes on to read, never a precondition it tests: a
  // batch against a repository with none is `seed`'s own flow, and it
  // reaches this same pipeline afterwards.
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-invoke
  const resolved = await resolveAndCheckBatch(rawBatch, repoRoot, deps, deps.readProjectStateFn);
  if (!resolved.ok) return resolved;
  const { document, assembly } = resolved;

  // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-checked-reconciled
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-recorded-noop
  const noop: ApplyBatchTargetRef[] = [];
  const unrecorded: ContributionEntry[] = [];
  for (const entry of assembly.entries) {
    const existingEntry = document.templates[entry.templateName];
    if (existingEntry !== undefined && existingEntry.targets.includes(entry.target)) {
      // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-noop-target
      // No on-disk content is read for this target, existing-content
      // reconciliation never runs for it (it is simply excluded from
      // `unrecorded` below), and no file is written for it.
      noop.push({ templateName: entry.templateName, target: entry.target });
      // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-noop-target
      continue;
    }
    unrecorded.push(entry);
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-recorded-noop

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-existing-content
  const payloads = new Map<ContributionEntry, Map<string, string>>();
  const identicalByEntry = new Map<ContributionEntry, Set<string>>();
  const contentConflictPaths: string[] = [];
  // The subset of `contentConflictPaths` refused because a symlink stands at
  // (or above) the path rather than because its content differs — see the
  // refusal's own comment below for why the distinction reaches the report.
  const uncomparableConflictPaths: string[] = [];
  // One entry per `uncomparableConflictPaths` member, naming the specific
  // component (the path itself, or an ancestor) that made it so — see
  // `describePathCause` above and `ExistingContentPartitions.uncomparableCauses`
  // (`scaffold/existing-content.ts`) for why the refusal names each path's
  // own cause rather than leaving a developer to find it.
  const uncomparableCauses: { path: string; component: string; kind: 'symlink' | 'file' | 'directory' | 'special' }[] = [];
  const undecidedAdditionalPaths: string[] = [];
  // `--adopt-existing`'s own contract is to leave an undeclared on-disk path
  // untouched — but the real existing-content walk (`adapters/fs-existing-
  // content.ts`) reports neither `isFile()` nor `isDirectory()` for a
  // symlink dirent, so a DECLARED payload path that is ITSELF a
  // pre-existing symlink is invisible to reconciliation: it looks exactly
  // like a brand-new path, and materialization below would write straight
  // through it. For example, two targets in the same batch, one an adopted
  // additional path, the other a declared payload path that is a symlink
  // aliasing it: writing the second would silently overwrite the first's
  // content — the exact thing `--adopt-existing` promises not to do. This
  // module has no seam that can SEE a symlink before writing (that
  // seam lives in `adapters/`); what it CAN do honestly is snapshot every
  // adopted path's content now, before anything is written, and verify it
  // again after materialization (below) — detection, not prevention, but
  // the batch is then refused and nothing is recorded, rather than
  // reporting success over content it silently corrupted.
  const adoptedSnapshots: { target: string; path: string; content: string }[] = [];
  for (const entry of unrecorded) {
    const payload = await computePayloadForTarget(entry, deps.readInstalledContentFn);
    payloads.set(entry, payload);
    const partitions = await reconcileExistingContent({
      target: entry.target,
      exclusionRoots: entry.exclusionRoots,
      installedContentPath: entry.installedContentPath,
      readInstalledContent: deps.readInstalledContentFn,
      readExistingContent: deps.readExistingContentFn,
    });
    identicalByEntry.set(entry, new Set(partitions.identicalFiles));
    contentConflictPaths.push(...partitions.contentConflicts);
    uncomparableConflictPaths.push(...partitions.uncomparablePaths);
    uncomparableCauses.push(...partitions.uncomparableCauses);
    if (!adoptExisting) {
      undecidedAdditionalPaths.push(...partitions.additionalPaths);
    } else if (partitions.additionalPaths.length > 0) {
      const rawExisting = await deps.readExistingContentFn(entry.target);
      const existingByPath = new Map(rawExisting.map((item) => [item.path, item.content]));
      for (const adoptedPath of partitions.additionalPaths) {
        const content = existingByPath.get(adoptedPath);
        if (content !== undefined) adoptedSnapshots.push({ target: entry.target, path: adoptedPath, content });
      }
    }
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-existing-content
  // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-checked-reconciled

  // Canonicalizing the batch's own TARGET
  // (`canonicalizeBatch` above) proves the target resolves inside the
  // project root, symlinks resolved — it says nothing about a path segment
  // BELOW the target (an `app/src` a developer or attacker replaced with a
  // symlink to somewhere outside the project between registration and this
  // apply). Every individual payload path this batch is about to write is
  // proven to stay inside `repoRoot`, symlinks resolved, in its own pass
  // BEFORE anything is written — an escape anywhere in the batch aborts the
  // whole batch, nothing written, exactly as `contentConflictPaths`/
  // `undecidedAdditionalPaths` below already abort before writing anything.
  //
  // The same pass also answers the one question a rollback can no longer ask
  // once materialization has begun: which of the directories this batch is
  // about to write into were ALREADY standing. `rollbackWrittenPaths` above
  // prunes only the directories the batch itself brought into being, and
  // "already standing" is only observable BEFORE the first write — afterwards
  // a directory apply created and one the developer created look identical.
  // Probed here rather than in a pass of its own so the two questions asked
  // of the same path set are asked once, walking it once.
  //
  // This containment check (`inst-add-if-escape`) must run BEFORE the two
  // existing-content refusals just below, not after: a payload path reaching
  // this batch through a symlinked ancestor that escapes the project root —
  // a containment problem — would otherwise be reported as
  // `CONTENT_CONFLICT` instead of `INVALID_PATH` whenever `scaffold/
  // existing-content.ts`'s own symlink detection (`inst-ec-if-symlink-
  // component`) happens to see the same path first, since that detection
  // cannot tell an INTERNAL symlink (a project legitimately containing its
  // own links) apart from one that escapes outside it — both are simply
  // "uncomparable" to reconciliation. Nothing is ever written outside the
  // project either way (reconciliation's own refusal already aborts before
  // any write), but the two refusals name different remedies: `INVALID_PATH`
  // says "this path cannot be proven to stay inside the project",
  // `CONTENT_CONFLICT` says "resolve or remove the symlink", and a developer
  // chasing the wrong one wastes a diagnosis step. Containment is the more
  // fundamental question — whether a path is even addressable inside the
  // project at all — so it is decided FIRST, ahead of the two returns below:
  // an escaping path is `INVALID_PATH` even when it would also have been
  // `contentConflicts` under reconciliation's own, coarser test.
  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-escape
  const invalidPaths: string[] = [];
  const dirsThisCallCreated = new Set<string>();
  const probedDirs = new Set<string>();
  for (const entry of unrecorded) {
    const payload = payloads.get(entry) ?? new Map<string, string>();
    const identical = identicalByEntry.get(entry) ?? new Set<string>();
    for (const [projectPath] of payload) {
      if (identical.has(projectPath)) continue;
      const absolutePath = path.join(repoRoot, projectPath);
      try {
        deps.assertPathWithinRootFn(absolutePath);
      } catch {
        invalidPaths.push(projectPath);
      }
      // Every ancestor between the file and `repoRoot`, deduplicated across
      // the whole batch (`probedDirs`) so a directory shared by two hundred
      // payload paths costs one `existsFn` call, not two hundred.
      let dir = path.dirname(absolutePath);
      while (dir !== repoRoot && !probedDirs.has(dir)) {
        probedDirs.add(dir);
        if (!(await deps.existsFn(dir))) dirsThisCallCreated.add(dir);
        dir = path.dirname(dir);
      }
    }
  }
  if (invalidPaths.length > 0) {
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-escape
    return {
      ok: false,
      code: 'INVALID_PATH',
      message:
        `Aborted — path(s) could not be proven to stay inside the project root: ${invalidPaths.join(', ')}; ` +
        'nothing written.',
      details: { paths: invalidPaths },
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-escape
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-escape

  // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-existing-conflict
  if (contentConflictPaths.length > 0) {
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-checked-aborted-existing-content
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-existing-conflict
    return {
      ok: false,
      code: 'CONTENT_CONFLICT',
      message:
        // Both causes named, because `contentConflicts` unions two of them
        // (the FEATURE's own Output line for this algorithm says so): content
        // that differs from what the payload declares, and content that
        // cannot be compared against it AT ALL because a symlink stands at
        // the payload path or on the way to it. Saying only "differs" was
        // accurate for the first and false for the second — a developer
        // reading it went looking for a content difference that does not
        // exist, and the remedy is different in each case (edit or remove
        // the file, versus resolve the link).
        //
        // Reconciliation (`scaffold/existing-content.ts`) tracks the two
        // branches (`inst-ec-add-symlink-conflict` vs. `inst-ec-add-conflict`)
        // separately internally, and its OWN return type,
        // `ExistingContentPartitions`, reports `uncomparablePaths` — the
        // SUBSET of `contentConflicts` the symlink branch refused. Passing
        // that subset through to `describeContentConflictCause` below lets
        // the message name WHICH path has which cause, rather than naming
        // both possible causes for the whole list and leaving the reader to
        // guess. `details` carries the subset too: a machine caller acts
        // differently on "resolve this link" than on "reconcile this edit",
        // and could not tell them apart from the union alone.
        describeContentConflictCause(contentConflictPaths, uncomparableConflictPaths, uncomparableCauses),
      details:
        uncomparableConflictPaths.length > 0
          ? { paths: contentConflictPaths, uncomparablePaths: uncomparableConflictPaths, uncomparableCauses }
          : { paths: contentConflictPaths },
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-existing-conflict
    // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-checked-aborted-existing-content
  }
  if (undecidedAdditionalPaths.length > 0) {
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-checked-aborted-existing-content
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-existing-conflict
    return {
      ok: false,
      code: 'EXISTING_PATHS_REQUIRE_DECISION',
      message:
        `Aborted — existing content stands at path(s) the payload does not declare: ${undecidedAdditionalPaths.join(', ')}. ` +
        'Pass --adopt-existing to leave them untouched, or move/remove them and retry; nothing written.',
      details: { paths: undecidedAdditionalPaths },
    };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-existing-conflict
    // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-checked-aborted-existing-content
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-existing-conflict

  // A thrown write failure (EACCES, ENOSPC, or any other exception this
  // pipeline does not itself convert to a structured refusal) must not
  // propagate straight out of this function — `seed`'s own caller has no
  // return value to roll back FROM if it does. Everything below that can
  // still write or refuse runs inside one `try`, so every exit from here on
  // is the same honest, structured shape every EARLIER refusal above
  // already returns — `writtenPaths` names exactly what this call actually
  // wrote before stopping, rather than leaving the caller to guess (or
  // assume "nothing written", which only the checks ABOVE this point can
  // honestly claim).
  const writtenPaths: string[] = [];
  // True from the moment this call's FIRST project-state commit
  // (`mutateProjectState` below) succeeds
  // (`inst-add-rollback-writes`/`inst-add-if-write-refusal`). Every refusal
  // below this point rolls back
  // `writtenPaths` unconditionally EXCEPT one already committed a name's
  // targets to the project state store during THIS call — rolling back
  // `writtenPaths` there would delete files a just-recorded project-state
  // entry now (correctly) claims are applied, trading one inconsistency for
  // a worse one. This narrow case is bounded to a multi-name batch whose
  // record loop commits one name and then fails on a LATER one — the
  // sibling defensive branch below already calls its own failure
  // "unreachable in practice" for the same reason a validated document's
  // shape does not usually turn valid then invalid between two writes in
  // the same call; when it is reached, this flag is what keeps the already-
  // recorded name's files honestly left in place rather than corrupted by
  // an overzealous rollback.
  let recordedAnyThisCall = false;
  // Names this call's own bundle step (`inst-add-materialize-bundle` below)
  // actually materialized a bundle for — filled in as that loop runs, read
  // by every `rollbackWrittenPaths` call site below it. Declared here
  // (empty) rather than at the bundle loop itself so the two refusals that
  // can fire BEFORE
  // that loop ever runs (the adopted-content-corrupted check just below)
  // pass a set that is correctly, structurally empty — nothing has been
  // bundled yet at that point in this call, not merely "none reported".
  const bundledNamesThisCall = new Set<string>();
  try {
    // @cpt-begin:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-reconciled-assembled
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize
    for (const entry of unrecorded) {
      const payload = payloads.get(entry) ?? new Map<string, string>();
      const identical = identicalByEntry.get(entry) ?? new Set<string>();
      for (const [projectPath, content] of payload) {
        // Already correct on disk — writing it again would be harmless but
        // pointless; skipped so materialization writes exactly the paths that
        // are NEW or that reconciliation cleared as adopted, never a path
        // already confirmed byte-identical.
        if (identical.has(projectPath)) continue;
        await deps.writeFileFn(path.join(repoRoot, projectPath), content);
        writtenPaths.push(projectPath);
      }
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize

    // Verifies every `--adopt-existing`-adopted path snapshotted above
    // (`adoptedSnapshots`, see its own comment for the mechanism) still
    // reads exactly as it did before the writes just above. Detection, not
    // prevention — the write already happened through ground this module
    // has no seam to inspect beforehand — but the batch is refused and
    // nothing below is recorded, rather than reporting success over content
    // it silently corrupted.
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-adopted-corrupted
    if (adoptedSnapshots.length > 0) {
      const rereadByTarget = new Map<string, Map<string, string>>();
      const corruptedAdoptedPaths: string[] = [];
      for (const snapshot of adoptedSnapshots) {
        let reread = rereadByTarget.get(snapshot.target);
        if (reread === undefined) {
          const rawExisting = await deps.readExistingContentFn(snapshot.target);
          reread = new Map(rawExisting.map((item) => [item.path, item.content]));
          rereadByTarget.set(snapshot.target, reread);
        }
        if (reread.get(snapshot.path) !== snapshot.content) corruptedAdoptedPaths.push(snapshot.path);
      }
      if (corruptedAdoptedPaths.length > 0) {
        // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-adopted-corrupted
        // Reached before the record loop below ever runs, so
        // `recordedAnyThisCall` is always false here — every file this call
        // wrote is unconditionally safe to remove
        // (`inst-add-rollback-writes`). `bundledNamesThisCall` is always
        // structurally empty at
        // this point too (the AI-extension bundle loop runs AFTER this
        // check, never before it), so `describeBundleRollback` composes no
        // clause here — passed through anyway so this call site does not
        // drift from the shared signature every other rollback call below
        // uses.
        await rollbackWrittenPaths(
          repoRoot,
          writtenPaths,
          deps.removeProjectFileFn,
          deps.removeEmptyDirFn,
          dirsThisCallCreated,
          deps.removeBundleFn,
          bundledNamesThisCall,
        );
        return {
          ok: false,
          code: 'CONTENT_CONFLICT',
          message:
            `Aborted — "--adopt-existing" promised to leave existing content untouched, but materializing this ` +
            `batch altered it anyway at: ${corruptedAdoptedPaths.join(', ')} (a declared payload path elsewhere in ` +
            'this batch is very likely a symlink aliasing one of these locations); nothing was recorded, and' +
            describeWrittenPaths(writtenPaths, true) +
            describeBundleRollback(bundledNamesThisCall, true),
          details: { paths: corruptedAdoptedPaths, writtenPaths },
        };
        // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-adopted-corrupted
      }
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-adopted-corrupted

    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize-bundle
    // Run ONCE per name that just gained its first target across the WHOLE
    // batch — never per target — matching `cpt-frontx-algo-cli-scaffolding-
    // ai-bundle`'s own "runs once per name transition" contract.
    const handledNames = new Set<string>();
    for (const entry of unrecorded) {
      if (handledNames.has(entry.templateName)) continue;
      handledNames.add(entry.templateName);
      const targetsBefore = document.templates[entry.templateName]?.targets.length ?? 0;
      if (targetsBefore > 0) continue; // this name already had a target before this batch
      try {
        const bundleOutcome = await materializeOrRemoveAiBundle({
          manifestName: entry.templateName,
          transition: { kind: 'FIRST_TARGET_GAINED', installedContentPath: entry.installedContentPath },
          projectRoot: repoRoot,
          bundleExists: deps.bundleExistsFn,
          copyBundle: deps.copyBundleFn,
          removeBundle: deps.removeBundleFn,
        });
        // Recorded only on an actual `'materialized'` outcome — a `'no-op'`
        // (the template's
        // payload carries no bundle at all) never wrote anything to
        // `.frontx/ai/<name>/`, so nothing about it belongs in the set a
        // rollback below would otherwise spend a (harmless but pointless)
        // `removeBundleFn` call reclaiming. `'removed'` never occurs here —
        // this loop only ever requests the `FIRST_TARGET_GAINED` transition.
        if (bundleOutcome === 'materialized') bundledNamesThisCall.add(entry.templateName);
      } catch (error) {
        // Every failure reaching this `catch` is reached AFTER the main
        // payload materialize loop above has already written this batch's
        // files, and BEFORE the record loop below has committed anything for
        // ANY name this call — `recordedAnyThisCall` is always false here, so
        // every file this call wrote, and every bundle an EARLIER iteration
        // of this same loop already materialized (`bundledNamesThisCall`),
        // is unconditionally safe to remove (`inst-add-rollback-writes`);
        // `writtenPaths` still names the files in `details` for the caller's
        // own audit, but the message now says they were removed, not that
        // they remain. The name whose OWN bundle copy just threw is never
        // added to `bundledNamesThisCall` in the first place (the `if` above
        // this `catch` is never reached for it), so this rollback is never
        // asked to remove a bundle that was never actually written.
        await rollbackWrittenPaths(
          repoRoot,
          writtenPaths,
          deps.removeProjectFileFn,
          deps.removeEmptyDirFn,
          dirsThisCallCreated,
          deps.removeBundleFn,
          bundledNamesThisCall,
        );
        const bundleFailureDetails = {
          name: entry.templateName,
          ...(writtenPaths.length > 0 ? { writtenPaths } : {}),
          ...bundledNamesDetail(bundledNamesThisCall),
        };
        // A thrown failure here is not one thing: `createFsCopyBundleFn`
        // (`adapters/fs-ai-bundle.ts`) refuses fail-closed with
        // `PathContainmentError` when its own destination cannot be proven
        // to stay inside the project root, and with `AiNamespaceAliasError`
        // when the destination resolves, through an aliased scope component,
        // outside the CLI-owned `.frontx/ai/` namespace. Those two are the
        // cases this catch may honestly call `INVALID_PATH` — the same discrimination
        // the pipeline's own outer catch already applies to a write refusal
        // reached later, at the record step. Anything else — a permission
        // error reading the source bundle or writing the destination, a
        // missing source directory, disk exhaustion — is a real but
        // different problem: the bundle was never proven to escape the
        // project, it simply could not be copied, and reporting it as a
        // containment escape sends whoever reads the refusal chasing a
        // symlink that is not there.
        if (error instanceof PathContainmentError || error instanceof AiNamespaceAliasError) {
          return {
            ok: false,
            code: 'INVALID_PATH',
            message:
              `Aborted — the AI-extension bundle for "${entry.templateName}" could not be proven to stay inside the ` +
              `ground the CLI owns: ${error.message}` +
              describeWrittenPaths(writtenPaths, true) +
              describeBundleRollback(bundledNamesThisCall, true),
            details: bundleFailureDetails,
          };
        }
        return {
          ok: false,
          code: 'INTERNAL',
          message:
            `Aborted — the AI-extension bundle for "${entry.templateName}" could not be materialized: ` +
            `${error instanceof Error ? error.message : String(error)}` +
            describeWrittenPaths(writtenPaths, true) +
            describeBundleRollback(bundledNamesThisCall, true),
          details: bundleFailureDetails,
        };
      }
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-materialize-bundle

    // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-to-applied
    // @cpt-begin:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-applied
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-record
    const newTargetsByName = new Map<string, string[]>();
    for (const entry of unrecorded) {
      const list = newTargetsByName.get(entry.templateName) ?? [];
      list.push(entry.target);
      newTargetsByName.set(entry.templateName, list);
    }
    const applied: ApplyBatchTargetRef[] = [];
    for (const [name, newTargets] of newTargetsByName) {
      const existingEntry = document.templates[name];
      if (existingEntry === undefined) {
        // Unreachable in practice — `uniformApply` already refuses
        // `TEMPLATE_NOT_REGISTERED` for any name with no project-state entry,
        // so every name reaching here was already confirmed registered.
        // Guarded rather than asserted so a caller-supplied fake document
        // cannot turn this into a thrown TypeError. Rolls back only when no
        // earlier name in this same batch has already committed
        // (`recordedAnyThisCall`'s own doc comment above) — this defensive
        // branch can in principle be reached after an earlier name's
        // `mutateProjectState` call already succeeded.
        if (!recordedAnyThisCall) {
          await rollbackWrittenPaths(
            repoRoot,
            writtenPaths,
            deps.removeProjectFileFn,
            deps.removeEmptyDirFn,
            dirsThisCallCreated,
            deps.removeBundleFn,
            bundledNamesThisCall,
          );
        }
        return {
          ok: false,
          code: 'INTERNAL',
          message:
            `Template "${name}" was staged but is no longer registered.` +
            describeWrittenPaths(writtenPaths, !recordedAnyThisCall) +
            describeBundleRollback(bundledNamesThisCall, !recordedAnyThisCall),
          details:
            writtenPaths.length > 0 || bundledNamesThisCall.size > 0
              ? { ...(writtenPaths.length > 0 ? { writtenPaths } : {}), ...bundledNamesDetail(bundledNamesThisCall) }
              : undefined,
        };
      }
      const mergedTargets = [...existingEntry.targets, ...newTargets];
      const written = await mutateProjectState(
        repoRoot,
        { kind: 'set-template', name, entry: { ...existingEntry, targets: mergedTargets } },
        deps.readProjectStateFn,
        deps.writeProjectStateFn,
      );
      if (!written.ok) {
        // See the defensive branch just above for why this rollback is
        // conditional on `recordedAnyThisCall` rather than unconditional
        // like the two earlier (pre-record-loop) refusals. A
        // multi-name batch whose record loop already committed an EARLIER
        // name before a LATER name's own record step fails this way (a
        // read-only `.frontx`, or a document a concurrent writer changed
        // underneath this call) reaches here with `recordedAnyThisCall`
        // true, and this rollback correctly does nothing — the earlier
        // name's files and bundle are its own just-committed record, not
        // this refusal's to remove.
        //
        // What is NOT conditional is REPORTING what is true either way:
        // `writtenPaths`/`bundledNamesThisCall` name every payload file and
        // bundle this call brought into being regardless of which later
        // name's record step failed, so `details` and the message below
        // carry both unconditionally — `describeWrittenPaths`/
        // `describeBundleRollback`'s own `removed` argument is what tells
        // the reader (and `seed`'s own rollback, which reads exactly these
        // fields to know what is left for it to clean up) whether THIS
        // refusal actually removed them or left them standing.
        if (!recordedAnyThisCall) {
          await rollbackWrittenPaths(
            repoRoot,
            writtenPaths,
            deps.removeProjectFileFn,
            deps.removeEmptyDirFn,
            dirsThisCallCreated,
            deps.removeBundleFn,
            bundledNamesThisCall,
          );
        }
        return {
          ok: false,
          code: 'PROJECT_INVALID',
          message:
            written.message +
            describeWrittenPaths(writtenPaths, !recordedAnyThisCall) +
            describeBundleRollback(bundledNamesThisCall, !recordedAnyThisCall),
          details:
            writtenPaths.length > 0 || bundledNamesThisCall.size > 0
              ? { ...(writtenPaths.length > 0 ? { writtenPaths } : {}), ...bundledNamesDetail(bundledNamesThisCall) }
              : undefined,
        };
      }
      recordedAnyThisCall = true;
      for (const target of newTargets) applied.push({ templateName: name, target });
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-record
    // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-empty-to-applied
    // @cpt-end:cpt-frontx-state-composed-provenance-registration-lifecycle:p1:inst-rl-applied-to-applied
    // @cpt-end:cpt-frontx-state-cli-scaffolding-assembly-op:p1:inst-as-reconciled-assembled

    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-done
    return { ok: true, applied, noop };
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-done
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-write-refusal
  } catch (error) {
    // Unconditional whenever no name in this call has yet been recorded
    // (`inst-add-rollback-writes`) — see `recordedAnyThisCall`'s own doc
    // comment above for the one narrow case where it must NOT run.
    const canRollback = !recordedAnyThisCall;
    if (canRollback) {
      await rollbackWrittenPaths(
        repoRoot,
        writtenPaths,
        deps.removeProjectFileFn,
        deps.removeEmptyDirFn,
        dirsThisCallCreated,
        deps.removeBundleFn,
        bundledNamesThisCall,
      );
    }
    // `canRollback` decides whether the removal above ran, never whether
    // `bundledNamesThisCall` is reported: a bundle this call materialized is
    // this call's own doing whether or not THIS refusal is the one that
    // rolls it back, so both the message and `details` name it either way —
    // `describeBundleRollback`'s own `removed` argument (mirroring
    // `describeWrittenPaths`'s identical one just below) is what keeps the
    // wording honest about which of the two is true.
    const bundleClause = describeBundleRollback(bundledNamesThisCall, canRollback);
    const bundleDetail = bundledNamesDetail(bundledNamesThisCall);

    // A deliberate, typed refusal — `PathContainmentError` (thrown by
    // `createFsWriteProjectStateFn` when `.frontx` itself resolves outside
    // the project root through a symlink introduced since the pre-flight
    // check) or `ExistingSymlinkDestinationError` (thrown by
    // `createFsWriteFileFn` when a payload path already exists as a
    // symlink) — must not fall straight through to the generic `INTERNAL`
    // branch below, as any other unrecognized exception would. Both are
    // discriminated here, BEFORE the generic fallback, into the SAME
    // structured code every OTHER refusal for their own class of problem
    // already uses elsewhere in this file (`INVALID_PATH` for a containment
    // escape, `CONTENT_CONFLICT` for an existing-symlink destination) — see
    // this file's own import comment for why this is a RETURN, never a
    // rethrow, unlike `upgrade/commit.ts`'s handling of the same two error
    // classes.
    // @cpt-begin:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-write-refusal
    if (error instanceof PathContainmentError) {
      return {
        ok: false,
        code: 'INVALID_PATH',
        message: error.message + describeWrittenPaths(writtenPaths, canRollback) + bundleClause,
        details: { path: error.offendingPath, ...(writtenPaths.length > 0 ? { writtenPaths } : {}), ...bundleDetail },
      };
    }
    if (error instanceof ExistingSymlinkDestinationError) {
      return {
        ok: false,
        code: 'CONTENT_CONFLICT',
        message: error.message + describeWrittenPaths(writtenPaths, canRollback) + bundleClause,
        details: { paths: [error.destPath], ...(writtenPaths.length > 0 ? { writtenPaths } : {}), ...bundleDetail },
      };
    }
    // The third of the same class: the bundle's destination resolves, through
    // an aliased scope component, outside the CLI-owned `.frontx/ai/`
    // namespace. A containment escape like the first, and reported with the
    // same code — never `INTERNAL`, which would make an ordinary, actionable
    // state of the developer's own tree read as a failure of this engine.
    if (error instanceof AiNamespaceAliasError) {
      return {
        ok: false,
        code: 'INVALID_PATH',
        message: error.message + describeWrittenPaths(writtenPaths, canRollback) + bundleClause,
        details: {
          path: error.destPath,
          resolvedPath: error.resolvedPath,
          ...(writtenPaths.length > 0 ? { writtenPaths } : {}),
          ...bundleDetail,
        },
      };
    }
    // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-return-write-refusal

    // Any OTHER thrown failure materializing this batch is converted to the
    // same honest, structured shape, `writtenPaths` naming whatever this
    // call actually wrote before the failure, so `seed`'s own rollback
    // (`commands/seed-repository.ts`) has something real to undo instead of
    // an exception it never gets a chance to catch cleanly.
    return {
      ok: false,
      code: 'INTERNAL',
      message:
        `Aborted — an unexpected error interrupted materialization: ${error instanceof Error ? error.message : String(error)}.` +
        describeWrittenPaths(writtenPaths, canRollback) +
        bundleClause,
      details:
        writtenPaths.length > 0 || Object.keys(bundleDetail).length > 0
          ? { ...(writtenPaths.length > 0 ? { writtenPaths } : {}), ...bundleDetail }
          : undefined,
    };
  }
  // @cpt-end:cpt-frontx-flow-cli-scaffolding-add-template:p1:inst-add-if-write-refusal
}
