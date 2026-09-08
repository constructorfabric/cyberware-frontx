// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-delete-plan:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-delete:p1
//
// Computes one already-applied target's deletion plan: which real on-disk
// paths under it are safe to remove (`toDelete`), and which must be
// preserved (`toPreserve`). Pure logic behind injected seams — no direct
// filesystem access here, matching every other scaffold/manifest module's
// convention (`manifest/validate-content-self-containment.ts`'s
// `ListPayloadFilesFn`, `scaffold/conflict-check.ts`'s `CanonicalizeTargetFn`,
// `scaffold/existing-content.ts`'s reader seams).
//
// The target's effective ownership — the six-term subtraction
// `cpt-frontx-algo-cli-scaffolding-uniform-apply`'s own `inst-ua-compute-
// ownership` step fixes — is computed by calling `effective-ownership.ts`
// directly rather than restating it: that module's own header comment names
// this algorithm's `inst-dp-compute-ownership` step as ONE of the two
// callers of the ONE shared formulation, and marks that step there,
// alongside `inst-ua-compute-ownership`, as the single implementation both
// invoke. It is not marked a second time in this file — calling the
// function is what realizes the step.
import path from 'node:path';
import { RESERVED_ENVIRONMENT_ENTRIES } from '../manifest/validate-contract';
import { computeExclusionRoots, isWithinEffectiveOwnership } from './effective-ownership';
import { resolveRegisteredExcludedSubtrees } from './registered-manifest';
import { pathWithinSubtree, pathWithinTarget, joinUnderTarget } from '../paths/relative-path';
import { parseLocalOrigin } from '../resolver/types';
import type { CanonicalizeTargetFn } from './conflict-check';
import type { ProjectStateDocument } from '../project-state/types';
import type { InventoryEntry } from '../inventory/types';
import type { ReadFileFn } from '../manifest/types';
import type { ErrorCode } from '../envelope';

// Narrow port over `TemplateInventory` — this algorithm needs only
// `lookup`, to read the owning template's installed manifest for its
// declared `excludedSubtrees` (the project state store's own `TemplateEntry`
// carries no such field — `commands/ownership.ts`'s `OwnershipInventoryPort`
// makes the identical join for the identical reason). A fresh, local port
// rather than an import of that one: this module lives in `scaffold/`, one
// layer below `commands/`, and must not take an upward dependency on it for
// a two-method shape this simple.
export interface DeletePlanInventoryPort {
  lookup(name: string): InventoryEntry | undefined;
}

// Enumerates every real file reachable under `absoluteDir`, POSIX-relative
// to `absoluteDir` (no leading slash) — the concrete on-disk enumeration
// this algorithm's effective-ownership PREDICATE (`isWithinEffectiveOwnership`)
// needs turned into an actual list of candidate paths (`inst-dp-compute-
// ownership`'s own text: a target's effective ownership is a predicate, not
// an enumeration; this seam is what supplies the candidates the predicate
// then filters). Resolves to `[]`, never a throw, when `absoluteDir` does
// not exist at all — an applied target ordinarily DOES exist on disk, but a
// target whose ground was already partially or fully removed by hand is not
// this algorithm's error to raise; it simply has fewer real candidates to
// plan against.
//
// Deliberately NOT `ListPayloadFilesFn` (`manifest/types.ts`): that seam is
// scoped to a TEMPLATE's own directory and, by its own contract, skips
// `node_modules`. This algorithm's six-term subtraction names no such
// exclusion, and reusing that behavior here would silently add a seventh,
// undeclared term to the ONE effective-ownership formula this algorithm
// shares verbatim with `apply` (`cpt-frontx-algo-cli-scaffolding-uniform-
// apply`'s own `inst-ua-compute-ownership`).
export type ListTargetFilesFn = (absoluteDir: string) => Promise<string[]>;

// Enumerates every path under `absoluteDir` that `ListTargetFilesFn` above
// silently leaves out of ITS OWN enumeration — a FIFO, a socket, a device, a
// dangling symlink, or a symlink escaping the target's own real root, live
// or dangling — none of which is a "real file" that seam's contract can
// answer for, and none of which this algorithm may simply drop: an entry in
// neither `toDelete` nor `toPreserve` breaks the one promise `delete`'s
// confirmation gate rests on, that the lists state the blast radius before
// anything is executed. A DIFFERENT, dedicated seam rather than widening
// `ListTargetFilesFn`'s own `string[]` contract to somehow carry both
// answers at once: `ListTargetFilesFn` is shared with callers outside this
// algorithm (`commands/delete.ts`'s own containment pass reuses its
// candidate list verbatim), and none of them ask this second question.
export type ListUnenumerableTargetEntriesFn = (absoluteDir: string) => Promise<string[]>;

export type DeletionPlanResult =
  | {
      ok: true;
      toDelete: string[];
      toPreserve: string[];
      // Not itself part of the algorithm's literal `{toDelete, toPreserve}`
      // output (FEATURE §3 "Compute a Target's Deletion Plan") — surfaced
      // anyway because `inst-dp-record-owner` already determines it as an
      // intermediate step, and the caller (`commands/delete.ts`) needs to
      // know which template's `targets[]` entry to remove `<target>` from.
      templateName: string;
    }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

// Derives the project-relative folder a `path:`-installed template's own
// origin occupies, re-running the SAME canonicalization `register.ts`'s own
// `resolveOrigin` performs (and discards without storing) at register time —
// the raw stored `origin` string may carry a `./` prefix or other spelling
// `computeExclusionRoots`'s whole-path-segment comparisons would not
// recognize as the plain form a real on-disk path resolves to. `undefined`
// for a remote origin (no local folder to exclude at all), and also for a
// local origin whose folder can no longer be proven to stay inside the
// project root — it was already proven to at register time
// (`register.ts`'s own `inst-cpreg-install` clause), so a failure here means
// that ground has since been removed or now escapes via a changed symlink;
// either way there is nothing real left to subtract, so the term is simply
// omitted rather than refusing the whole plan over ground that no longer
// exists.
function deriveLocalOriginFolder(origin: string, canonicalizeFn: CanonicalizeTargetFn): string | undefined {
  const relativePath = parseLocalOrigin(origin);
  if (relativePath === undefined) return undefined;
  const canonical = canonicalizeFn(relativePath);
  return canonical ?? undefined;
}

/**
 * cpt-frontx-algo-cli-scaffolding-delete-plan — the deletion plan for one
 * already-canonicalized `<target>`: its effective ownership (the six-term
 * subtraction `effective-ownership.ts` fixes, shared verbatim with
 * `apply`), minus every nested target belonging to a DIFFERENT registered
 * template, enumerated against what actually exists on disk. Refuses with
 * `TARGET_NOT_APPLIED` when `<target>` matches no registered template's
 * `targets[]` array.
 */
export async function computeDeletionPlan(
  target: string,
  repoRoot: string,
  document: ProjectStateDocument,
  inventory: DeletePlanInventoryPort,
  canonicalizeFn: CanonicalizeTargetFn,
  listTargetFilesFn: ListTargetFilesFn,
  readFileFn: ReadFileFn,
  listUnenumerableTargetEntriesFn: ListUnenumerableTargetEntriesFn,
): Promise<DeletionPlanResult> {
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-foreach-template
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-found
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-record-owner
  let ownerName: string | undefined;
  for (const [candidateName, candidateEntry] of Object.entries(document.templates)) {
    if (candidateEntry.targets.includes(target)) {
      ownerName = candidateName;
      break;
    }
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-record-owner
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-found
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-foreach-template

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-not-found
  if (ownerName === undefined) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-return-not-found
    return {
      ok: false,
      code: 'TARGET_NOT_APPLIED',
      message: `"${target}" is not an applied instance of any registered template.`,
      details: { target },
    };
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-return-not-found
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-not-found

  const ownerEntry = document.templates[ownerName];

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-compute-ownership
  // Re-derived through `resolveRegisteredExcludedSubtrees`
  // (`./registered-manifest.ts`) — the ONE shared formulation that correctly
  // resolves BOTH a remote (inventory-installed) and a local
  // `path:`-registered name's current manifest, rather than
  // `inventory.lookup` alone (which silently returned `[]` for a local
  // origin — confirmed live as a real bug; `commands/apply.ts`'s/
  // `commands/ownership.ts`'s own claim-builders call the identical shared
  // function for the identical join).
  //
  // A genuinely ABSENT manifest still joins as `[]` (`inst-dp-if-manifest-
  // absent`): every other applied instance of a DIFFERENT template nested
  // under this target is caught independently below (`inst-dp-find-nested`)
  // regardless of whether this term is available — that independent check
  // is exactly the safety net `cpt-frontx-dod-cli-scaffolding-delete`'s own
  // text names it as, surviving even a manifest that has since drifted (an
  // upgrade narrowing `excludedSubtrees`) to no longer declare ground a
  // nested template still actually occupies. An UNREADABLE manifest — a
  // FIFO, a directory, or a dangling symlink standing where it is expected —
  // is a DIFFERENT fact from absence, and does NOT join as `[]`
  // (`inst-dp-if-manifest-unreadable`): `resolveRegisteredExcludedSubtrees`
  // lets that failure propagate rather than swallowing it, so this call
  // THROWS instead of resolving, uncaught here by design — the same
  // "propagate to the caller's own structured refusal" shape this
  // function's own `listTargetFilesFn` call below already relies on for
  // `TargetNotDirectoryError`, converted the identical way by
  // `commands/delete.ts`'s own catch around this whole algorithm
  // (`CONTENT_CONFLICT`, naming the unreadable path). A deletion plan whose
  // exclusions could not be read must refuse, not silently compute `toDelete`
  // from an emptied-out exclusion set nobody verified — the independent
  // `inst-dp-find-nested` safety net protects a DIFFERENT template's own
  // nested target, never the OWNING template's own declared exclusions,
  // so it is no substitute for actually reading this manifest.
  const declaredExclusions = await resolveRegisteredExcludedSubtrees(ownerName, ownerEntry.origin, {
    repoRoot,
    inventory,
    readFileFn,
    canonicalizeFn,
  });
  const localOriginFolder = deriveLocalOriginFolder(ownerEntry.origin, canonicalizeFn);
  const exclusionRoots = computeExclusionRoots({
    target,
    excludedSubtrees: declaredExclusions,
    projectOwnedRoots: document.projectOwnedRoots,
    localOriginFolder,
  });
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-compute-ownership

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-nested
  const nestedTargets: string[] = [];
  for (const [otherName, otherEntry] of Object.entries(document.templates)) {
    if (otherName === ownerName) continue;
    for (const otherTarget of otherEntry.targets) {
      if (otherTarget !== target && pathWithinTarget(otherTarget, target)) {
        nestedTargets.push(otherTarget);
      }
    }
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-nested

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-other-origins
  // Every OTHER registered template's local `path:` origin folder that sits
  // beneath this target — confirmed LIVE as a real, disk-verified bug before
  // this check existed: `listTargetFilesFn` enumerates every REAL file under
  // `target`, and only the OWNER's own local origin folder was ever excluded
  // (`localOriginFolder` above); a DIFFERENT registered template's origin
  // folder (e.g. `vendor/tpl-b`, still holding its manifest and installed
  // content for a currently-applied target elsewhere) was silently swept
  // into `toDelete` and genuinely deleted. Mirrors `commands/apply.ts`'s own
  // `collectLocalOriginFolders` (which protects the identical set of
  // folders during the pre-flight conflict check for apply/ownership-add) —
  // the same reserved ground, re-derived for the same reason, here for
  // deletion instead of for conflict.
  const otherLocalOriginFolders = Object.entries(document.templates)
    .filter(([name]) => name !== ownerName)
    .map(([, candidateEntry]) => deriveLocalOriginFolder(candidateEntry.origin, canonicalizeFn))
    .filter((folder): folder is string => folder !== undefined && pathWithinTarget(folder, target));
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-other-origins

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-unenumerable
  // Every FIFO, socket, device, dangling symlink, or escaping symlink found
  // under `target` — content `listTargetFilesFn` below cannot enumerate as a
  // comparable file at all, and so would otherwise sit in NEITHER `toDelete`
  // NOR `toPreserve` (`adapters/fs-project-io.ts`'s own `walkFiles` doc
  // comment names exactly this class of silently-dropped entry). Filtered
  // through the identical effective-ownership predicate `toDelete`'s own
  // candidates pass through below, so an entry OUTSIDE this template's
  // ownership (inside a nested target or a declared exclusion, say) is never
  // reported here either — it was never this template's ground to report.
  const absoluteTargetDir = path.join(repoRoot, target);
  const rawUnenumerable = await listUnenumerableTargetEntriesFn(absoluteTargetDir);
  const unenumerableWithinOwnership = rawUnenumerable
    .map((relativeFile) => joinUnderTarget(target, relativeFile))
    .filter((candidate) => isWithinEffectiveOwnership(candidate, target, exclusionRoots));
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-find-unenumerable

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-set-preserve
  // `excludedSubtrees`/`nestedTargets`/`projectOwnedRoots`/reserved
  // environment entries/other templates' local origin folders/the OWNING
  // template's own local origin folder (when it too lies beneath `target`)
  // are surfaced here — only `.frontx` stays OUT of `toPreserve` on purpose
  // (FEATURE §3's own text: this step decides which of the
  // already-subtracted exclusion roots to ALSO surface as explicit entries
  // the caller reports, distinct from ground `computeExclusionRoots`
  // silently excludes from effective ownership in the prior step without
  // ever being named back to the caller). The owning template's own origin
  // folder is named for the same reason a `projectOwnedRoots` entry is:
  // both are the DEVELOPER's own ground, and
  // `cpt-frontx-adr-template-ownership-boundary-declaration` rests delete's
  // safety on these lists stating the blast radius before it is executed —
  // a developer whose template source sits under the target would
  // otherwise watch it survive with nothing in the report saying why.
  // `.frontx` stays out on the opposite ground: it is CLI-owned, not the
  // developer's, and no confirmation decision turns on it. A DIFFERENT
  // template's origin folder is not the owner's own infrastructure-ish
  // exclusion, though — it is exactly as real and as protected as that
  // other template's own APPLIED TARGET (`nestedTargets` above), so it is
  // surfaced rather than silently excluded, for the identical reason: a
  // developer confirming a deletion must see WHY that ground survives.
  const excludedSubtreeRoots = declaredExclusions.map((declared) => joinUnderTarget(target, declared));
  const projectOwnedRootsBeneath = document.projectOwnedRoots.filter((root) => pathWithinTarget(root, target));
  const reservedEntriesBeneath = RESERVED_ENVIRONMENT_ENTRIES.filter((envEntry) => pathWithinTarget(envEntry, target));
  const ownerLocalOriginFolderBeneath =
    localOriginFolder !== undefined && pathWithinTarget(localOriginFolder, target) ? [localOriginFolder] : [];
  const toPreserve = Array.from(
    new Set([
      ...excludedSubtreeRoots,
      ...nestedTargets,
      ...projectOwnedRootsBeneath,
      ...reservedEntriesBeneath,
      ...otherLocalOriginFolders,
      ...ownerLocalOriginFolderBeneath,
      ...unenumerableWithinOwnership,
    ]),
  ).sort();
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-set-preserve

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-set-delete
  const rawFiles = await listTargetFilesFn(absoluteTargetDir);
  const candidatePaths = rawFiles.map((relativeFile) => joinUnderTarget(target, relativeFile));
  const toDelete = candidatePaths
    .filter((candidate) => isWithinEffectiveOwnership(candidate, target, exclusionRoots))
    .filter((candidate) => !toPreserve.some((preserved) => pathWithinSubtree(candidate, preserved)))
    .sort();
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-set-delete

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-return-plan
  return { ok: true, toDelete, toPreserve, templateName: ownerName };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-return-plan
}
