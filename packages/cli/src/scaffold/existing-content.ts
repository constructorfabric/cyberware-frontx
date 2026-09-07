// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-existing-content:p1
//
// Pure reconciliation logic behind injected seams — no direct filesystem
// access here, matching every other scaffold/manifest module's convention
// (`manifest/validate-content-self-containment.ts`'s `ListPayloadFilesFn`/
// `ResolveDeclaredExclusionFn`, `scaffold/conflict-check.ts`'s
// `CanonicalizeTargetFn`). The real fs-backed implementations of the two
// seams below are someone else's wiring, not this module's concern.
//
// This algorithm runs ONLY for a target already cleared by the pre-flight
// conflict check and NOT already recorded under its template's own
// `targets[]` entry (`cpt-frontx-dod-cli-scaffolding-existing-content-
// protocol`) — a recorded target is an idempotent no-op by that record
// alone and never reaches here. That precondition is the caller's to
// enforce; this module only reconciles whatever payload and on-disk content
// it is handed.
import { isWithinEffectiveOwnership } from './effective-ownership';
import { isTemplatePayloadPath } from '../manifest/types';
import { joinUnderTarget } from '../paths/relative-path';
import type { ContentItem } from './types';

// Declared here, not in `adapters/fs-existing-content.ts`: a value only the
// WRITER (the adapter) and the READER (this module) agree on has exactly
// one honest home — the module that reads it and acts on it, with the
// writer importing the constant rather than each side keeping its own copy
// that could silently drift apart. `adapters/fs-existing-content.ts`
// imports this export rather than redefining it.
//
// The marker exists because this algorithm needs to treat "a symlink stands
// here" as a reconciliation-level fact, not an adapter-level implementation
// detail: a symlinked DIRECTORY anywhere above a payload path has to make
// every payload path beneath it uncomparable (see this module's own
// `inst-ec-if-symlink-component` step below), and only this module — the
// one place that walks the payload path set against what exists — can
// decide that.
export const SYMLINK_CONTENT_MARKER = '\uFFFF\uFFFFfrontx:existing-content:symlink-cannot-be-compared\uFFFF\uFFFF';

// Injected reader for a template's installed content — every file reachable
// under the template's installed content path, template-relative (never
// project-relative), unfiltered by any target's effective ownership. Reuses
// `ContentItem` (`scaffold/types.ts`) rather than inventing a second "path
// plus content" shape — the same shape `ReadContentItemsFn` already reads
// for materialization. This module itself narrows the result down to one
// target's effective ownership area (`joinUnderTarget` +
// `isWithinEffectiveOwnership` below), so the seam only has to enumerate,
// never judge scope.
export type ReadInstalledContentFn = (installedContentPath: string) => Promise<ContentItem[]>;

// Injected reader for what already exists on disk, project-relative, under
// `target` — empty when nothing has been written there yet (a brand-new
// target). Like the payload seam above, this is expected to enumerate
// everything reachable under `target` without itself deciding effective
// ownership; this module applies the identical `isWithinEffectiveOwnership`
// filter to both sides so a stray file the seam over-reports (e.g. one that
// actually sits inside an excluded subtree) can never leak into a partition
// on either side of the comparison.
export type ReadExistingContentFn = (target: string) => Promise<ContentItem[]>;

export interface ExistingContentReconciliationInput {
  target: string;
  // The same exclusion-root list `computeExclusionRoots` (`./effective-
  // ownership.ts`) produces for this target — passed in already computed,
  // exactly as `checkTargetConflicts` accepts `localOriginFolders` already
  // resolved rather than re-deriving it, so the six-term subtraction is
  // computed in the one place the codebase already agreed it lives.
  exclusionRoots: string[];
  installedContentPath: string;
  readInstalledContent: ReadInstalledContentFn;
  readExistingContent: ReadExistingContentFn;
}

export interface ExistingContentPartitions {
  identicalFiles: string[];
  contentConflicts: string[];
  additionalPaths: string[];
  // The SUBSET of `contentConflicts` refused because a symlink stands at the
  // payload path or on the way to it, rather than because the content there
  // differs. Not a fourth partition: every path here is also in
  // `contentConflicts`, and a caller that only reads the three partitions
  // behaves exactly as before. It exists because the two causes are one
  // refusal with two different remedies — reconcile the edit, versus resolve
  // the link — and a report that names only the more common one sends a
  // developer looking for a content difference that does not exist.
  uncomparablePaths: string[];
}

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-compute-payload
function computePayloadSet(
  target: string,
  exclusionRoots: string[],
  rawContent: ContentItem[],
): Map<string, string> {
  const payload = new Map<string, string>();
  for (const item of rawContent) {
    // `item.path` is still template-relative here — `isTemplatePayloadPath`
    // (`../manifest/types.ts`, the ONE shared formulation of the payload
    // definition FEATURE §1.2 owns) must see it BEFORE `joinUnderTarget`
    // (`../paths/relative-path.ts`) re-roots it under `target`: a non-`.`
    // target would otherwise re-root the manifest as
    // `<target>/frontx-template.json`, which a check against the bare
    // `MANIFEST_FILENAME` would never recognize.
    if (!isTemplatePayloadPath(item.path)) continue;
    const projectPath = joinUnderTarget(target, item.path);
    if (!isWithinEffectiveOwnership(projectPath, target, exclusionRoots)) continue;
    payload.set(projectPath, item.content);
  }
  return payload;
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-compute-payload

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-read-existing
function filterExistingWithinOwnership(
  target: string,
  exclusionRoots: string[],
  rawExisting: ContentItem[],
): Map<string, string> {
  const existing = new Map<string, string>();
  for (const item of rawExisting) {
    if (!isWithinEffectiveOwnership(item.path, target, exclusionRoots)) continue;
    existing.set(item.path, item.content);
  }
  return existing;
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-read-existing

// This function must catch a symlinked directory standing either INSIDE the
// target or inside the PROJECT but outside the target: neither
// `readExistingContent` walk (the real one, `adapters/fs-existing-
// content.ts`, or a test fake standing in for it) ever descends into a
// symlinked directory it finds — it reports the symlink itself, at its own
// path, and stops. That makes every payload path BENEATH that symlink
// invisible to the two-map lookup `inst-ec-if-exists` performs below:
// `existing.get(payloadPath)` returns `undefined` for a path the walk never
// produced an entry for, which is indistinguishable from "nothing has ever
// been written here". Without this check, a payload path standing beneath a
// symlinked directory would be treated as brand new, and
// `commands/apply.ts` would materialize straight through the link, silently
// overwriting whatever the link's target actually held
// (`fs-containment.test.ts`'s own end-to-end suite already proves the
// mirror case, a symlinked FILE standing exactly AT a payload path — this
// is the same risk one directory level up, where the existing-map lookup is
// empty rather than populated with the wrong content).
//
// Built from the RAW existing items — BEFORE `filterExistingWithinOwnership`
// above narrows them to one target's effective ownership area — because
// ownership subtraction answers a different question ("is this MY ground to
// write") than this set answers ("can content at or beneath this path be
// compared at all"). A symlinked directory an exclusion subtracts from this
// target's effective ownership (a nested template's own `excludedSubtrees`,
// say) still makes every path beneath it, that this target's OWN payload
// would otherwise land on, just as uncomparable — fail-closed, per this
// module's own precedent for a plain symlinked or directory-shaped entry
// (`architecture/ADR/0021-project-upgrade-mechanism.md`, quoted at
// `inst-ec-if-symlink-component` below).
function collectSymlinkPaths(rawExisting: ContentItem[]): Set<string> {
  const symlinkPaths = new Set<string>();
  for (const item of rawExisting) {
    if (item.content === SYMLINK_CONTENT_MARKER) symlinkPaths.add(item.path);
  }
  return symlinkPaths;
}

// Every proper ancestor directory of `payloadPath` that lies BELOW `target`
// itself — `target` may legitimately be `.`, the project root
// (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own text uses exactly
// this example), which has zero path segments of its own rather than the
// single empty-string segment a naive `target.split('/')` would produce, so
// `target`'s own segment count is computed as `0` in that case rather than
// `1`. `payloadPath` is already known (by `computePayloadSet`'s own
// ownership filter) to sit at or inside `target`, so every prefix strictly
// longer than `target`'s own segment count, and strictly shorter than
// `payloadPath`'s full segment count, is a directory `target` itself never
// addresses and `payloadPath` sits beneath — never `target` itself (a
// target being a symlink is a different, pre-existing concern this walk
// does not take on) and never `payloadPath`'s own full length (that is the
// path itself, checked separately by the caller).
function ancestorDirsBelowTarget(payloadPath: string, target: string): string[] {
  const segments = payloadPath.split('/');
  const targetDepth = target === '.' ? 0 : target.split('/').length;
  const ancestors: string[] = [];
  for (let depth = targetDepth + 1; depth < segments.length; depth++) {
    ancestors.push(segments.slice(0, depth).join('/'));
  }
  return ancestors;
}

/**
 * Reconciles one target's payload — the files the template's effective
 * ownership at `target` would write, read from its installed content —
 * against whatever already exists on disk within that same effective-
 * ownership area, into the three partitions
 * `cpt-frontx-dod-cli-scaffolding-existing-content-protocol` reports
 * separately: `identicalFiles` (on disk, matching the payload exactly),
 * `contentConflicts` (on disk, differing from the payload), and
 * `additionalPaths` (on disk, at a path the payload does not write). All
 * three are empty when nothing pre-exists.
 */
export async function reconcileExistingContent(
  input: ExistingContentReconciliationInput,
): Promise<ExistingContentPartitions> {
  const rawPayload = await input.readInstalledContent(input.installedContentPath);
  const payload = computePayloadSet(input.target, input.exclusionRoots, rawPayload);

  const rawExisting = await input.readExistingContent(input.target);
  const existing = filterExistingWithinOwnership(input.target, input.exclusionRoots, rawExisting);
  // Fail-closed, from the RAW read — see `collectSymlinkPaths`'s own doc
  // comment for why this is computed before, not after, the ownership
  // filter above narrows `existing` down to `target`'s own ground.
  const symlinkPaths = collectSymlinkPaths(rawExisting);

  const identicalFiles: string[] = [];
  const contentConflicts: string[] = [];
  const uncomparablePaths: string[] = [];

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-foreach-payload-path
  for (const [payloadPath, payloadContent] of payload) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-if-symlink-component
    // See `collectSymlinkPaths`'s own doc comment above for why this check
    // exists. A symlink — at the payload path itself (see
    // `fs-containment.test.ts`'s "aliasing another file via symlink" suite)
    // or at ANY directory component between it and `target` — cannot be
    // compared against the payload's declared text content, and writing
    // through it lands somewhere the payload path does not name: the
    // identical ground `architecture/ADR/0021-project-upgrade-
    // mechanism.md` already settled for the upgrade engine ("A payload path
    // where the disk holds a directory or a symlink instead of a regular
    // file cannot be compared at all and refuses the same way, fail-closed,
    // with CONTENT_CONFLICT"), applied here to reconciliation rather than
    // restated a second time.
    // This check runs BEFORE `inst-ec-if-exists` below, not as a special
    // case of it: `existing.get(payloadPath)` cannot even see a path
    // hidden beneath a symlinked directory (the walk never descended into
    // it), so waiting for that lookup to fire would let this exact class of
    // path slip through as "nothing on disk" instead.
    const hasSymlinkComponent =
      symlinkPaths.has(payloadPath) || ancestorDirsBelowTarget(payloadPath, input.target).some((ancestor) => symlinkPaths.has(ancestor));
    if (hasSymlinkComponent) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-symlink-conflict
      // A conflict in BOTH modes: `--adopt-existing` means "leave whatever
      // is already there untouched", and a write that follows a symlink
      // touches something else entirely — never the thing `--adopt-existing`
      // was asked to leave alone in the first place.
      contentConflicts.push(payloadPath);
      // Recorded a second time, in the subset that names WHY — see
      // `ExistingContentPartitions.uncomparablePaths`. The push is here, in
      // the symlink branch itself, so the two lists cannot drift: nothing
      // else in this function can add to `uncomparablePaths`, and this
      // branch cannot add to `contentConflicts` without also naming the
      // cause.
      uncomparablePaths.push(payloadPath);
      continue;
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-symlink-conflict
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-if-symlink-component

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-if-exists
    const existingContent = existing.get(payloadPath);
    if (existingContent === undefined) continue; // nothing on disk at this payload path
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-if-exists

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-if-match
    if (existingContent === payloadContent) {
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-if-match
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-identical
      identicalFiles.push(payloadPath);
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-identical
      continue;
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-else-differs
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-conflict
    contentConflicts.push(payloadPath);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-conflict
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-else-differs
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-foreach-payload-path

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-foreach-extra
  const additionalPaths: string[] = [];
  for (const existingPath of existing.keys()) {
    if (payload.has(existingPath)) continue;
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-additional
    additionalPaths.push(existingPath);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-additional
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-foreach-extra

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-return-partitions
  return { identicalFiles, contentConflicts, additionalPaths, uncomparablePaths };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-return-partitions
}
