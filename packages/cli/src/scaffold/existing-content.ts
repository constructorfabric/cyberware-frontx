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
  // payload path, or a symlink or a regular file stands on the way to it,
  // rather than because the content there differs. Not a fourth partition:
  // every path here is also in `contentConflicts`, and a caller that only
  // reads the three partitions behaves exactly as before. It exists because
  // the two causes are one refusal with two different remedies — reconcile
  // the edit, versus resolve the link or move the file — and a report that
  // names only the more common one sends a developer looking for a content
  // difference that does not exist.
  uncomparablePaths: string[];
  // One entry per path in `uncomparablePaths`, naming the specific component
  // that made it so — the payload path itself (a symlink stands there), or
  // the offending ancestor directory component (a symlink or a regular file
  // stands where a directory is required) — so a refusal can tell a
  // developer "`app/dir` is a regular file" rather than leaving them to walk
  // the chain by hand. `component` equals `path` itself for the payload-path
  // case.
  uncomparableCauses: { path: string; component: string; kind: 'symlink' | 'file' }[];
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

// This function must catch a symlinked OR a plain-file directory standing
// either INSIDE the target or inside the PROJECT but outside the target:
// neither `readExistingContent` walk (the real one, `adapters/fs-existing-
// content.ts`, or a test fake standing in for it) ever descends into a
// symlinked directory it finds, or into a REGULAR FILE it finds (there is
// nothing beneath a file to descend into) — either way it reports the entry
// itself, at its own path, and stops. That makes every payload path BENEATH
// such an entry invisible to the two-map lookup `inst-ec-if-exists` performs
// below: `existing.get(payloadPath)` returns `undefined` for a path the walk
// never produced an entry for, which is indistinguishable from "nothing has
// ever been written here". Without this check, a payload path standing
// beneath a symlinked directory, or beneath a plain file occupying a
// directory's position, would be treated as brand new, and
// `commands/apply.ts` would materialize straight through it — following the
// link into whatever it actually aliases, or attempting to create a
// directory where a file already stands and failing with a raw `ENOTDIR`
// past this module's own structured refusal
// (`fs-containment.test.ts`'s own end-to-end suite already proves the
// mirror case, a symlinked FILE standing exactly AT a payload path — this
// is the same risk one directory level up, where the existing-map lookup is
// empty rather than populated with the wrong content).
//
// A directory is never itself reported as an entry by that walk — only a
// file or a symlink is, since the walk recurses INTO a directory rather than
// stopping at it. So the full set of raw existing paths (`collectExistingPaths`
// below) already means exactly "occupied by something other than a
// directory" — no separate "is this a directory" test is needed; membership
// in that set alone answers it. `collectSymlinkPaths` narrows the identical
// raw set to the symlink subset, needed to tell the two kinds of obstruction
// apart for the caller's own message (`ExistingContentPartitions.
// uncomparableCauses`) and to keep the payload-path-itself check (below)
// scoped to symlinks only, unchanged from before this fix — a regular file
// AT the payload path itself is not this hazard: its content is read and
// compared normally, exactly like any other on-disk file.
//
// Both built from the RAW existing items — BEFORE `filterExistingWithinOwnership`
// above narrows them to one target's effective ownership area — because
// ownership subtraction answers a different question ("is this MY ground to
// write") than this set answers ("can content at or beneath this path be
// compared at all"). An obstruction an exclusion subtracts from this
// target's effective ownership (a nested template's own `excludedSubtrees`,
// say) still makes every path beneath it, that this target's OWN payload
// would otherwise land on, just as uncomparable — fail-closed, per this
// module's own precedent for a plain symlinked or directory-shaped entry
// (`architecture/ADR/0021-project-upgrade-mechanism.md`, quoted at
// `inst-ec-if-symlink-component` below).
function collectExistingPaths(rawExisting: ContentItem[]): Set<string> {
  const existingPaths = new Set<string>();
  for (const item of rawExisting) existingPaths.add(item.path);
  return existingPaths;
}

function collectSymlinkPaths(rawExisting: ContentItem[]): Set<string> {
  const symlinkPaths = new Set<string>();
  for (const item of rawExisting) {
    if (item.content === SYMLINK_CONTENT_MARKER) symlinkPaths.add(item.path);
  }
  return symlinkPaths;
}

// Returns the SHALLOWEST ancestor of `payloadPath` occupied by anything other
// than a directory — the component that actually blocks the path, since
// nothing beneath a non-directory entry can exist on a real filesystem
// regardless of what a deeper ancestor might otherwise look like. `null` when
// every ancestor is either an ordinary directory or does not exist yet (the
// ordinary case for a path about to be created).
function findBadAncestorComponent(
  payloadPath: string,
  existingPaths: ReadonlySet<string>,
  symlinkPaths: ReadonlySet<string>,
): { component: string; kind: 'symlink' | 'file' } | null {
  for (const ancestor of ancestorDirsOf(payloadPath)) {
    if (existingPaths.has(ancestor)) {
      return { component: ancestor, kind: symlinkPaths.has(ancestor) ? 'symlink' : 'file' };
    }
  }
  return null;
}

// Every proper ancestor directory of `payloadPath`, from the project root
// down to the leaf's parent. The range is deliberately root-relative rather
// than target-relative: a component AT or ABOVE `target` can be occupied by a
// non-directory just as one below it can, and nothing can be created beneath
// such a component wherever it sits.
//
// Only components the existing-content read actually reported can match, and
// that read reports exactly two things: entries inside `target` that are not
// directories, and — when one exists — the single shallowest component of
// `target`'s own path that is not a directory
// (`adapters/fs-existing-content.ts`'s `blockingComponentOf`). An ordinary
// directory is never an entry in that set, so widening this walk to the root
// cannot invent a refusal; it only lets the one deliberately-reported
// blocking component be seen.
//
// A symlink at or above `target` is a different matter and is not this
// walk's concern: `commands/apply.ts`'s pre-flight canonicalization
// (`inst-cc-canonicalize`) resolves `target` through every symlink on its own
// path before this module ever runs, so such a link has already been walked
// through by the time reconciliation sees a target at all. That is the one
// place `apply` and the upgrade engine legitimately differ — `classify.ts`
// probes the target's own component because ITS target is a bare string
// pulled unresolved from the project state store, where a target that has
// since become a link is drift to refuse rather than ground to follow.
function ancestorDirsOf(payloadPath: string): string[] {
  const segments = payloadPath.split('/');
  const ancestors: string[] = [];
  // From the project root down, not from `target` down: a component AT or
  // ABOVE `target` can be occupied by a non-directory too, and the existing-
  // content read reports exactly that component when it is
  // (`adapters/fs-existing-content.ts`'s `blockingComponentOf`). Starting at
  // `target`'s own depth would skip the one entry that read went out of its
  // way to name. Nothing else above `target` is ever reported, so widening
  // the walk cannot introduce a false refusal: an ordinary directory is never
  // an entry in this set.
  for (let depth = 1; depth < segments.length; depth++) {
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
  const existingPaths = collectExistingPaths(rawExisting);

  const identicalFiles: string[] = [];
  const contentConflicts: string[] = [];
  const uncomparablePaths: string[] = [];
  const uncomparableCauses: { path: string; component: string; kind: 'symlink' | 'file' }[] = [];

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-foreach-payload-path
  for (const [payloadPath, payloadContent] of payload) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-if-symlink-component
    // See `collectExistingPaths`'s own doc comment above for why this check
    // exists, and why it is no longer scoped to symlinks alone. A symlink at
    // the payload path itself (see `fs-containment.test.ts`'s "aliasing
    // another file via symlink" suite), or a symlink OR A REGULAR FILE at ANY
    // directory component between it and `target`, cannot be compared
    // against the payload's declared text content, and writing through it —
    // or beneath it — lands somewhere the payload path does not name, or
    // fails outright with a raw `ENOTDIR`: the identical ground
    // `architecture/ADR/0021-project-upgrade-mechanism.md` already settled
    // for the upgrade engine ("A payload path where the disk holds a
    // directory or a symlink instead of a regular file cannot be compared at
    // all and refuses the same way, fail-closed, with CONTENT_CONFLICT"),
    // applied here to reconciliation rather than restated a second time.
    // This check runs BEFORE `inst-ec-if-exists` below, not as a special
    // case of it: `existing.get(payloadPath)` cannot even see a path hidden
    // beneath a symlinked or file-occupied directory (the walk never
    // descended into it), so waiting for that lookup to fire would let this
    // exact class of path slip through as "nothing on disk" instead.
    const badAncestor = findBadAncestorComponent(payloadPath, existingPaths, symlinkPaths);
    const isSymlinkAtLeaf = symlinkPaths.has(payloadPath);
    if (isSymlinkAtLeaf || badAncestor !== null) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-add-symlink-conflict
      // A conflict in BOTH modes: `--adopt-existing` means "leave whatever
      // is already there untouched", and a write that follows a symlink, or
      // that attempts to create a directory where a file already stands,
      // touches something else entirely — never the thing `--adopt-existing`
      // was asked to leave alone in the first place.
      contentConflicts.push(payloadPath);
      // Recorded a second time, in the subset that names WHY — see
      // `ExistingContentPartitions.uncomparablePaths`. The push is here, in
      // this branch itself, so the two lists cannot drift: nothing else in
      // this function can add to `uncomparablePaths`, and this branch cannot
      // add to `contentConflicts` without also naming the cause. A bad
      // ancestor takes precedence over the payload path's own leaf shape
      // when both are true at once (an impossible on-disk combination in
      // practice, since nothing can exist beneath a non-directory ancestor,
      // but the ordering is fixed regardless, matching `classify.ts`'s own
      // ancestor-first precedent for the identical class of shape).
      uncomparablePaths.push(payloadPath);
      uncomparableCauses.push(
        badAncestor !== null
          ? { path: payloadPath, component: badAncestor.component, kind: badAncestor.kind }
          : { path: payloadPath, component: payloadPath, kind: 'symlink' },
      );
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
  return { identicalFiles, contentConflicts, additionalPaths, uncomparablePaths, uncomparableCauses };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-existing-content:p1:inst-ec-return-partitions
}
