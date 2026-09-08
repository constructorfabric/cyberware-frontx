// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
// @cpt-algo:cpt-frontx-algo-upgrade-changeset-validate:p1
// @cpt-dod:cpt-frontx-dod-upgrade-changeset-computation:p1
// @cpt-state:cpt-frontx-state-upgrade-changeset-lifecycle:p1
//
// Validates a candidate new origin against every target a registered name
// carries, per `cpt-frontx-adr-project-upgrade-mechanism`'s ordering: several
// refusals MUST happen before anything else is resolved or inspected, so the
// step ORDER below is as normative as the individual checks —
//
//   check baseline honesty -> resolve candidate (ONCE) -> check candidate's
//   own recorded-version honesty (restore only) -> check declared identity
//   -> check no-op -> classify every target -> refuse on the first
//   conflict class found, never mid-loop, containment before content
//
// Each ordering rule closes one specific correctness hole:
//   - Baseline honesty BEFORE candidate resolution (`inst-val-check-baseline`
//     / `inst-val-if-baseline-drift`) means a transition is never computed
//     from a baseline the project state misreports — resolving the candidate
//     first and only then discovering the baseline was wrong would have
//     already spent a network round-trip diffing against a version this
//     project never actually had.
//   - The candidate is resolved EXACTLY ONCE, here (`inst-val-resolve-new-
//     origin`) — never re-resolved by a caller (including restore) before or
//     after calling this function. Two resolutions of what is supposed to be
//     the SAME candidate could disagree (a mutable ref moving between calls),
//     silently classifying against content the developer never actually
//     reviewed.
//   - Identity and no-op checks BEFORE any target is classified
//     (`inst-val-if-identity-mismatch`, `inst-val-if-candidate-is-baseline`)
//     means a name is never silently re-keyed to a different template's
//     content, and an upgrade to where the name already is never computes a
//     plan or consumes the one generation of reversal.
//   - EVERY target is classified before any conflict check runs
//     (`inst-val-if-target-fails`, `inst-val-if-nested-conflict`) — no
//     early return inside the loop — so a refusal always names every
//     doubly-changed path and every nested conflict in one report, never a
//     partial one that would require a second run to discover the rest.
//   - Among the conflict checks, containment is decided before content
//     (`escapingConflicts` before `contentConflicts`, both inside
//     `inst-val-if-target-fails`): an ancestor symlink whose resolved target
//     escapes the project root is refused `INVALID_PATH`, naming a
//     different, more fundamental problem than "a symlink stands here,
//     reconcile it" — the same ordering `commands/apply.ts`'s own
//     pre-flight containment check already settled for the identical
//     on-disk shape on the apply side.
import { classifyTarget } from './classify';
import type { ClassifyInput } from './classify';
import { versionMatchesRecorded } from './payload';
import type {
  OriginVersion,
  ReadDiskEntryFn,
  ResolvePayloadFn,
  UpgradeOperation,
  UpgradePlan,
  UpgradeRefusal,
  UpgradeSkippedPath,
} from './types';
import type { ProjectStateDocument, TemplateEntry } from '../project-state/types';
import { joinUnderTarget } from '../paths/relative-path';
import { parseLocalOrigin } from '../resolver/types';

// Derives the project-relative folder a `path:`-installed name's own origin
// occupies. Derived from the BASELINE's currently recorded origin
// (`entry.origin`) — never the candidate's — since that is the origin
// actually registered in the project state store for the whole of this
// validation; the transition to the candidate's origin has not committed
// yet.
function deriveLocalOriginFolder(origin: string, canonicalizeFn: (raw: string) => string | null): string | undefined {
  const relativePath = parseLocalOrigin(origin);
  if (relativePath === undefined) return undefined;
  const canonical = canonicalizeFn(relativePath);
  return canonical ?? undefined;
}

// Renders a `{target, path}` list as `target:path` pairs, joined for a
// refusal message. Pairing the two rather than listing bare paths matters
// here specifically because this algorithm classifies MULTIPLE targets in
// one validation pass — a bare path is ambiguous the moment two targets both
// carry one at the same project-relative suffix.
function describeConflictPaths(conflicts: readonly { target: string; path: string }[]): string {
  return conflicts.map((conflict) => `${conflict.target}:${conflict.path}`).join(', ');
}

// Renders one `uncomparableCauses` `kind` as the phrase a developer reads —
// identical to the bare word for `'directory'`/`'symlink'`/`'file'`, which
// already read as a complete noun phrase on their own ("a directory stands
// at the path"), but expanded for `'special'`: the bare word alone ("a
// special stands at the path") names nothing a developer can act on, since
// "special" is this codebase's own internal classification term
// (`DiskEntry`'s own kind, `../upgrade/types.ts`), never a word a developer
// used on their own filesystem. Naming the concrete shapes it covers — a
// FIFO, socket, or device — gives them a specific answer instead: SPELLED
// IDENTICALLY to `scaffold/existing-content.ts`'s own doc comment for the
// same fact on the apply side, never a second phrasing for it.
function describeKind(kind: string): string {
  return kind === 'special' ? 'special file (a FIFO, socket, or device)' : kind;
}

// Names the specific component `cause` blames for making `target:path`
// uncomparable, so a developer reads what is actually wrong on disk instead
// of having to walk the path themselves. `component === path` means the leaf
// itself is the offender (a directory, a symlink, or a special file standing
// exactly where the payload declares a regular file); any other `component`
// names the offending ancestor between the project root and that leaf.
function describeCause(target: string, path: string, cause: { component: string; kind: string } | undefined): string {
  const location = `${target}:${path}`;
  if (cause === undefined) return location; // defensive: every uncomparable path carries a cause
  if (cause.component === path) {
    return `${location} (a ${describeKind(cause.kind)} stands at the path)`;
  }
  return `${location} (ancestor "${cause.component}" is a ${describeKind(cause.kind)}, not a directory)`;
}

// The `INVALID_PATH`-specific sibling of `describeCause` above: every
// `escapingConflicts` entry's cause is always a symlink (`ClassifyResult.
// escapingPaths` is only ever populated for a symlink cause, never a
// directory or a plain file — see `classify.ts`'s own `escapesRoot` sites),
// so this never has a `kind` to report and instead names the one thing
// `describeCause` cannot: WHICH position — the leaf itself, or a named
// ancestor — actually escapes, in place of the removed "the path itself, or
// an ancestor directory component" disjunction that left a reader to guess.
function describeEscapeCause(target: string, path: string, cause: { component: string } | undefined): string {
  const location = `${target}:${path}`;
  if (cause === undefined) return location; // defensive: every escaping path carries a cause
  if (cause.component === path) {
    return `${location} (the path itself is a symlink whose target escapes the project root)`;
  }
  return `${location} (ancestor "${cause.component}" is a symlink whose target escapes the project root)`;
}

// Composes the `CONTENT_CONFLICT` message naming each of the two causes
// `contentConflicts` unions, with its own remedy — mirroring
// `commands/apply.ts`'s own `describeContentConflictCause` in shape and
// intent (that function partitions a flat path list for one batch; this one
// partitions `{target, path}` pairs across every target this algorithm just
// classified, so the two are not the same formulation restated, only the
// same idea applied to a differently-shaped result). A path recorded because
// the disk shape is uncomparable — a directory, a symlink, or a special file
// (a FIFO, socket, or device) at the leaf, or a symlink, a regular file, or a
// special file at an ancestor directory component — has moved
// nothing "away from" the baseline; telling a developer it did sends them
// looking for a content difference that does not exist, so that cause is
// named separately from genuine drift, and each such path is named together
// with the specific component that blocked it. Either clause is omitted
// entirely when its own list is empty, so a refusal caused by one class
// alone reads as one sentence about that cause, not a disjunction inviting a
// guess.
function describeConflictCause(
  name: string,
  conflicts: readonly { target: string; path: string }[],
  uncomparable: readonly { target: string; path: string }[],
  uncomparableCauses: readonly { target: string; path: string; component: string; kind: string }[],
): string {
  const uncomparableKeys = new Set(uncomparable.map((conflict) => `${conflict.target}\u0000${conflict.path}`));
  const differing = conflicts.filter((conflict) => !uncomparableKeys.has(`${conflict.target}\u0000${conflict.path}`));
  const causeByKey = new Map(uncomparableCauses.map((cause) => [`${cause.target}\u0000${cause.path}`, cause]));
  const clauses: string[] = [];
  if (differing.length > 0) {
    clauses.push(
      `${differing.length} file(s) moved away from the baseline without already matching the candidate: ` +
        describeConflictPaths(differing),
    );
  }
  if (uncomparable.length > 0) {
    clauses.push(
      `${uncomparable.length} file(s) cannot be compared against the payload at all: ` +
        uncomparable
          .map((conflict) => describeCause(conflict.target, conflict.path, causeByKey.get(`${conflict.target}\u0000${conflict.path}`)))
          .join(', '),
    );
  }
  return `"${name}"'s upgrade was refused: ${clauses.join('; and ')}.`;
}

export type ValidateOutcome =
  | { ok: true; kind: 'plan'; plan: UpgradePlan }
  // `excludedSubtrees` carries the CANDIDATE's own declared exclusions,
  // already resolved above — never a second read — so `flow.ts`'s own
  // no-op handling can record it onto a baseline entry missing the field
  // without re-resolving the candidate's manifest a second time.
  | { ok: true; kind: 'noop'; at: OriginVersion; excludedSubtrees: string[] }
  | UpgradeRefusal;

export interface ValidateInput {
  name: string;
  // The baseline: `templates[name]` as currently recorded — `{origin,
  // version, targets[], previous?}`. `previous` is read by neither this
  // algorithm nor `flow.ts`'s call into it; only `commit.ts` writes it.
  entry: TemplateEntry;
  candidateOrigin: string;
  // Supplied ONLY by a restore invocation, carrying the recorded preceding
  // pair's own recorded version — a forward upgrade's candidate carries no
  // such recorded expectation and never supplies this
  // (`inst-val-if-candidate-version-mismatch`'s own text).
  candidateExpectedVersion?: string;
  // For `projectOwnedRoots` and every OTHER registered template's targets
  // (`inst-cls-if-newly-claimed-nested`'s nesting-aware check needs both).
  document: ProjectStateDocument;
  repoRoot: string;
  resolvePayload: ResolvePayloadFn;
  // Resolves one OTHER registered template's declared `excludedSubtrees` —
  // its MANIFEST only, never its payload.
  //
  // A separate seam from `resolvePayload` on purpose, and the distinction is
  // load-bearing rather than stylistic. The nesting check needs nothing from
  // another template but its declared exclusions, while `resolvePayload`
  // reads that template's ENTIRE payload — every file, and a network fetch
  // for a remote origin. Routing this through `resolvePayload` would make
  // preparing ONE name's upgrade resolve every other registered template in
  // full: for the twenty-registered-template project
  // `cpt-frontx-cli-nfr-template-scale` names as its own threshold, that is
  // nineteen needless full resolutions per upgrade, which is precisely the
  // independence that NFR requires upgrade to preserve.
  //
  // The wiring layer satisfies this with `resolveRegisteredExcludedSubtrees`
  // (`../scaffold/registered-manifest.ts`) — the ONE shared formulation
  // `apply`, `ownership add`, and `delete-plan` already re-derive a
  // registered name's current exclusions through, and the one that reads a
  // local `path:` origin's manifest directly rather than via the inventory
  // (the checkpoint-4 defect where `inventory.lookup` alone silently returned
  // `[]` for every locally-registered template). Kept as an injected seam
  // rather than an import so this algorithm takes no dependency on the
  // inventory it has no other use for.
  resolveRegisteredExclusions: (name: string, origin: string) => Promise<string[]>;
  readDiskEntry: ReadDiskEntryFn;
  canonicalizeFn: (raw: string) => string | null;
}

/**
 * `cpt-frontx-algo-upgrade-changeset-validate` — validates `candidateOrigin`
 * against every target `entry.targets[]` names, in the exact order this
 * file's header comment fixes. See `ValidateOutcome` for the three shapes
 * this can return: a validated `UpgradePlan` ready for review, an idempotent
 * `noop`, or an `UpgradeRefusal` naming why.
 */
export async function validateUpgrade(input: ValidateInput): Promise<ValidateOutcome> {
  const { name, entry, candidateOrigin, candidateExpectedVersion, document, repoRoot, resolvePayload, resolveRegisteredExclusions, readDiskEntry, canonicalizeFn } =
    input;

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-check-baseline
  // Resolve the name's CURRENTLY RECORDED origin and compare the version it
  // reports against the `version` recorded beside it — the baseline honesty
  // check that must run BEFORE the candidate is ever resolved
  // (`inst-val-check-baseline`'s own text: "obtain the baseline payload ...
  // classification will compare against").
  const baselineResolved = await resolvePayload(entry.origin);
  if (!baselineResolved.ok) {
    // Not itself one of this algorithm's numbered `inst-val-*` branches — the
    // FEATURE describes only the DRIFT case for an already-registered
    // baseline (`inst-val-if-baseline-drift`), never an outright unresolvable
    // one, since a name's baseline ordinarily resolves (it was applied from
    // it). Propagated as the resolver's OWN failure code/message rather than
    // fabricated as `VERSION_MISMATCH`: there is no version to compare a
    // baseline that cannot be resolved at all against, so reporting a
    // version mismatch would be dishonest about what actually failed.
    return { ok: false, code: baselineResolved.code, message: baselineResolved.message };
  }
  const baseline = baselineResolved.payload;
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-check-baseline

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-baseline-drift
  if (!versionMatchesRecorded(baseline, entry.version)) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-baseline-drift
    // No transition computed, no target inspected: a transition diffed
    // against a version this project never actually had would be worthless
    // regardless of what it concluded.
    return {
      ok: false,
      code: 'VERSION_MISMATCH',
      message:
        `"${name}"'s recorded version "${entry.version}" no longer matches what its recorded origin "${entry.origin}" ` +
        `now reports ("${baseline.version}"). Refusing before resolving the candidate origin or inspecting any target.`,
      details: { name, recordedVersion: entry.version, reportedVersion: baseline.version },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-baseline-drift
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-baseline-drift

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-resolve-new-origin
  // The ONLY resolution of `candidateOrigin` this algorithm performs — a
  // caller (including restore) never re-resolves it beforehand or
  // afterward.
  const candidateResolved = await resolvePayload(candidateOrigin);
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-resolve-new-origin

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-resolve-fail
  if (!candidateResolved.ok) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-unavailable
    // This line propagates `candidateResolved.code` VERBATIM, whatever
    // `resolvePayload` — the injected `ResolvePayloadFn` seam this function
    // is handed, never a hardcoded reference to one concrete implementation
    // — actually returns. `ResolvePayloadResult`'s own failure arm
    // (`./types.ts`) types that code as `'ORIGIN_UNAVAILABLE' |
    // 'INVALID_MANIFEST'`, so this pass-through must compile for either.
    //
    // `./payload.ts`'s own `createResolvePayloadFn` — the one implementation
    // this seam is wired to outside tests — never actually produces
    // `INVALID_MANIFEST` for a legacy-shaped manifest. `payload.ts`'s own
    // header and its `readDeclared` helper (verified directly: every
    // `return` in that module's failure paths, for both the local and the
    // remote branch, sets `code: 'ORIGIN_UNAVAILABLE'`) fold EVERY
    // unreadable manifest — legacy-shaped or any other kind of contract
    // violation — into `ORIGIN_UNAVAILABLE`, on the explicit ground that
    // upgrade's own FEATURE never lists `INVALID_MANIFEST` among its
    // refusals at all (`payload.ts`'s `readDeclared`/`resolveLocalPayload`/
    // `resolveRemotePayload` comments). `upgrade-payload.test.ts` asserts
    // this directly ("refuses ORIGIN_UNAVAILABLE, never INVALID_MANIFEST").
    //
    // `INVALID_MANIFEST` stays in `ResolvePayloadResult`'s and
    // `UpgradeRefusalCode`'s union regardless: both are typed against the
    // SEAM, not against `payload.ts` alone, and `upgrade-validate.test.ts`'s
    // own `makeResolvePayload` fixture helper is typed to allow a test
    // double to return it — so narrowing either union to drop
    // `INVALID_MANIFEST` would be a decision about the seam's contract, not
    // a decision about what this one wiring produces today, and is left
    // alone here.
    return { ok: false, code: candidateResolved.code, message: candidateResolved.message };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-unavailable
  }
  const candidate = candidateResolved.payload;
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-resolve-fail

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-candidate-version-mismatch
  if (candidateExpectedVersion !== undefined && candidate.version !== candidateExpectedVersion) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-candidate-version-mismatch
    // The SAME baseline-honesty semantics `inst-val-if-baseline-drift`
    // already applies, applied here to a candidate that itself carries a
    // recorded expectation — which is what a restore's preceding pair is. No
    // target is inspected.
    return {
      ok: false,
      code: 'VERSION_MISMATCH',
      message:
        `"${name}"'s candidate origin "${candidateOrigin}" was recorded at version "${candidateExpectedVersion}" but ` +
        `now reports "${candidate.version}". No target inspected.`,
      details: { name, recordedVersion: candidateExpectedVersion, reportedVersion: candidate.version },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-candidate-version-mismatch
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-candidate-version-mismatch

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-read-name
  // `candidate.name` and `candidate.excludedSubtrees` were already read as
  // part of resolution above (`ResolvedPayload`'s own shape) — this step is
  // realized by simply consulting those fields, not a second read.
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-read-name

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-identity-mismatch
  if (candidate.name !== name) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-identity-mismatch
    return {
      ok: false,
      code: 'REGISTRATION_CONFLICT',
      message: `Origin "${candidateOrigin}" declares identity "${candidate.name}", but "${name}" is the name being upgraded. No target inspected.`,
      details: { registeredName: name, declaredName: candidate.name },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-identity-mismatch
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-identity-mismatch

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-candidate-is-baseline
  if (candidate.origin === entry.origin && candidate.version === entry.version) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-noop
    // No plan computed, nothing written, and — the caller's responsibility,
    // not this function's — the name's preceding pair is left exactly as it
    // is: an upgrade to where the name already is does not consume the one
    // generation of reversal.
    return {
      ok: true,
      kind: 'noop',
      at: { origin: entry.origin, version: entry.version },
      excludedSubtrees: candidate.excludedSubtrees,
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-noop
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-candidate-is-baseline

  // Every OTHER registered template's targets, each tagged with that
  // template's currently declared `excludedSubtrees` joined under each of
  // its own targets — the identical join `commands/ownership.ts`'s own
  // `buildRecordedTargets` performs for the identical reason
  // (`checkTargetConflicts`'s nesting check compares a `TargetClaim`'s
  // `excludedSubtrees` against a full project-relative path, so each
  // declared entry must already be re-rooted under the target it was
  // declared for). Resolved through `resolveRegisteredExclusions` — the
  // MANIFEST-only seam, never `resolvePayload` (see `ValidateInput`'s own
  // doc comment for why routing it through the payload resolver would
  // defeat `cpt-frontx-cli-nfr-template-scale`). The wiring behind that seam
  // (`cli.ts`) joins `resolveRegisteredExcludedSubtrees`'s own `{ known:
  // false }` to `[]` itself — this function receives only the already-joined
  // `string[]`, never the discriminated resolution — because a template
  // whose origin cannot currently be resolved must fail closed to `[]`
  // here: an unrelated template's broken origin must never block validating
  // THIS name's upgrade (`cpt-frontx-cli-nfr-template-scale`'s own
  // independence requirement), and `[]` is the SAFE direction for a nesting
  // check — it can only ADMIT more conflicts, never silently permit one.
  const otherTemplateTargets: { target: string; templateName: string; excludedSubtrees: string[] }[] = [];
  for (const [otherName, otherEntry] of Object.entries(document.templates)) {
    if (otherName === name) continue;
    if (otherEntry.targets.length === 0) continue;
    // MANIFEST-only, never a payload read — see `resolveRegisteredExclusions`'s
    // own doc comment on `ValidateInput` for why routing this through
    // `resolvePayload` would defeat `cpt-frontx-cli-nfr-template-scale`.
    const declaredExclusions = await resolveRegisteredExclusions(otherName, otherEntry.origin);
    for (const otherTarget of otherEntry.targets) {
      otherTemplateTargets.push({
        target: otherTarget,
        templateName: otherName,
        excludedSubtrees: declaredExclusions.map((declared) => joinUnderTarget(otherTarget, declared)),
      });
    }
  }

  // The six-term slot carries the BASELINE's own origin folder (the origin
  // actually registered for the whole of this validation).
  const localOriginFolder = deriveLocalOriginFolder(entry.origin, canonicalizeFn);

  // Reserved ground beyond the six terms — see `ClassifyInput.additional
  // ExclusionRoots` for why this is the caller's addition rather than a
  // seventh term, and which live-confirmed exposure it closes.
  //
  // Two sources. First, the CANDIDATE's own origin folder: on a
  // `path:`->`path:` transition it is a DIFFERENT directory from the
  // baseline's, so the six-term slot does not cover it, and writing into the
  // very folder the content is being read from would be self-destructive.
  // Second, every OTHER registered template's local origin folder — that
  // template's own source of truth, which this name's upgrade must never
  // ADD/REPLACE/REMOVE inside, exactly as `apply` and `delete` already
  // guarantee.
  const additionalExclusionRoots: string[] = [];
  const candidateOwnFolder = deriveLocalOriginFolder(candidate.origin, canonicalizeFn);
  if (candidateOwnFolder !== undefined && candidateOwnFolder !== localOriginFolder) {
    additionalExclusionRoots.push(candidateOwnFolder);
  }
  for (const [otherName, otherEntry] of Object.entries(document.templates)) {
    if (otherName === name) continue;
    const otherFolder = deriveLocalOriginFolder(otherEntry.origin, canonicalizeFn);
    // A folder that can no longer be proven to stay inside the project root is
    // simply omitted: it was proven at register time, so a failure here means
    // that ground has since been removed or now escapes via a changed symlink
    // — there is nothing real left to subtract. `scaffold/assembler.ts`'s
    // `collectOtherLocalOriginFolders` omits it for the identical reason.
    if (otherFolder !== undefined && !additionalExclusionRoots.includes(otherFolder)) {
      additionalExclusionRoots.push(otherFolder);
    }
  }

  const operations: UpgradeOperation[] = [];
  // Per-target boundary, carried onto the plan for the commit algorithm's own
  // boundary-scoped stale-temp reclaim — see `UpgradePlan.exclusionRootsByTarget`.
  const exclusionRootsByTarget: Record<string, string[]> = {};
  const skipped: UpgradeSkippedPath[] = [];
  const contentConflicts: { target: string; path: string }[] = [];
  // The SUBSET of `contentConflicts` refused because the disk shape at (or
  // above) the path is uncomparable — see `ClassifyResult.uncomparablePaths`
  // (`./classify.ts`) for why this is tracked apart from a genuine content
  // drift, and `describeConflictCause` below for how the two read apart in
  // the refusal message.
  const uncomparableConflicts: { target: string; path: string }[] = [];
  // The SUBSET of `uncomparableConflicts` refused because an ancestor
  // symlink's resolved target escapes the project root — see
  // `ClassifyResult.escapingPaths`. Checked, and refused, BEFORE
  // `contentConflicts` below: whether a path is even addressable inside the
  // project at all is the more fundamental question, exactly the ordering
  // `commands/apply.ts`'s own pre-flight containment check already settled
  // for the identical on-disk shape on the apply side.
  const escapingConflicts: { target: string; path: string }[] = [];
  // One entry per `uncomparableConflicts` member, naming the specific
  // component (the leaf itself, or an ancestor) that made it uncomparable —
  // see `ClassifyResult.uncomparableCauses` and `describeCause` above for why
  // the report names each path's own cause rather than leaving a developer
  // to find it.
  const uncomparableCauses: { target: string; path: string; component: string; kind: string }[] = [];
  const targetConflicts: { target: string; contestingTarget: string; contestingTemplateName: string }[] = [];

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-foreach-target
  for (const target of entry.targets) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-check-target
    const classifyInput: ClassifyInput = {
      target,
      repoRoot,
      baseline,
      candidate,
      projectOwnedRoots: document.projectOwnedRoots,
      localOriginFolder,
      otherTemplateTargets,
      additionalExclusionRoots,
      readDiskEntry,
      canonicalizeFn,
    };
    const result = await classifyTarget(classifyInput);
    exclusionRootsByTarget[target] = result.exclusionRoots;
    operations.push(...result.operations);
    skipped.push(...result.skipped);
    const uncomparableForTarget = new Set(result.uncomparablePaths);
    const escapingForTarget = new Set(result.escapingPaths);
    const causeForTarget = new Map(result.uncomparableCauses.map((cause) => [cause.path, cause]));
    for (const path of result.conflictPaths) {
      contentConflicts.push({ target, path });
      if (uncomparableForTarget.has(path)) uncomparableConflicts.push({ target, path });
      if (escapingForTarget.has(path)) escapingConflicts.push({ target, path });
      const cause = causeForTarget.get(path);
      if (cause !== undefined) uncomparableCauses.push({ target, path, component: cause.component, kind: cause.kind });
    }
    for (const nested of result.nestedConflicts) {
      targetConflicts.push({ target, contestingTarget: nested.target, contestingTemplateName: nested.templateName });
    }
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-check-target
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-foreach-target

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-escaping-ancestor
  // Containment is checked, and refused, before content: whether a path is
  // even addressable inside the project at all is the more fundamental
  // question, exactly the ordering `commands/apply.ts`'s own pre-flight
  // containment check already settled for the identical on-disk shape (an
  // ancestor symlink whose resolved target escapes the project root) on the
  // apply side. Every target was classified above before either check runs
  // — no partial pass is ever returned, and every offending target/path is
  // named in one report.
  if (escapingConflicts.length > 0) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-escaping-ancestor
    // `causeForEscaping` is keyed the same way `describeConflictCause`'s own
    // `causeByKey` is built: `uncomparableCauses` already carries one entry
    // per escaping path (escaping is a subset of uncomparable — every
    // escaping path is, by construction, uncomparable first), so this is a
    // filter, never a second computation of the cause itself.
    const escapingKeys = new Set(escapingConflicts.map((conflict) => `${conflict.target}\u0000${conflict.path}`));
    const escapingCauses = uncomparableCauses.filter((cause) => escapingKeys.has(`${cause.target}\u0000${cause.path}`));
    const causeForEscaping = new Map(escapingCauses.map((cause) => [`${cause.target}\u0000${cause.path}`, cause]));
    return {
      ok: false,
      code: 'INVALID_PATH',
      message:
        `"${name}"'s upgrade was refused: ${escapingConflicts.length} path(s) could not be proven to stay inside the project root: ` +
        escapingConflicts
          .map((conflict) => describeEscapeCause(conflict.target, conflict.path, causeForEscaping.get(`${conflict.target}\u0000${conflict.path}`)))
          .join(', ') +
        '.',
      // Same shape `CONTENT_CONFLICT` reports (`conflicts`/`uncomparableConflicts`/
      // `uncomparableCauses`) so a caller parses one structure for the
      // component a refusal blames regardless of which code it got back,
      // rather than a second, differently-shaped payload for this one code.
      details: { paths: escapingConflicts, uncomparableCauses: escapingCauses },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-escaping-ancestor
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-escaping-ancestor

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-target-fails
  if (contentConflicts.length > 0) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-target-fail
    return {
      ok: false,
      code: 'CONTENT_CONFLICT',
      message: describeConflictCause(name, contentConflicts, uncomparableConflicts, uncomparableCauses),
      details:
        uncomparableConflicts.length > 0
          ? { conflicts: contentConflicts, uncomparableConflicts, uncomparableCauses }
          : { conflicts: contentConflicts },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-target-fail
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-target-fails

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-nested-conflict
  if (targetConflicts.length > 0) {
    // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-nested-conflict
    // Same "classify all first" rule: every nested conflict across every
    // target is named in one report, checked only AFTER the content-conflict
    // check above finds nothing, per `inst-val-if-target-fails` /
    // `inst-val-if-nested-conflict`'s own numbered order.
    return {
      ok: false,
      code: 'TARGET_CONFLICT',
      message: `"${name}"'s upgrade was refused: ${targetConflicts.length} target(s) newly claim ground another registered template's target nests inside.`,
      details: { conflicts: targetConflicts },
    };
    // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-nested-conflict
  }
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-if-nested-conflict

  // @cpt-begin:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-pass
  // @cpt-begin:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-validated
  const plan: UpgradePlan = {
    name,
    from: { origin: entry.origin, version: entry.version },
    to: { origin: candidate.origin, version: candidate.version },
    targets: entry.targets,
    operations,
    skipped,
    exclusionRootsByTarget,
    toExcludedSubtrees: candidate.excludedSubtrees,
  };
  return { ok: true, kind: 'plan', plan };
  // @cpt-end:cpt-frontx-state-upgrade-changeset-lifecycle:p1:inst-st-read-to-validated
  // @cpt-end:cpt-frontx-algo-upgrade-changeset-validate:p1:inst-val-return-pass
}
