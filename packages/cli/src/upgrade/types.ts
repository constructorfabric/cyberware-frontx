// @cpt-FEATURE:cpt-frontx-feature-upgrade-changeset:p1
//
// REWRITE (checkpoint 5): the prior shapes here described the retired
// region-union engine — `ChangeSet` with `clean`/`conflicts` entries carrying
// a `regionKey`, a `ProjectSnapshot` rollback carrier, and a
// provenance-record baseline. `cpt-frontx-adr-project-upgrade-mechanism`
// retires all three: granularity is the WHOLE FILE (no hunk, region-marker,
// or line-level representation anywhere in the plan), the baseline is the
// project state store's own `{origin, version}` entry rather than a
// per-instance provenance record, and reversal is carried by one recorded
// preceding `{origin, version}` rather than a retained content snapshot.
//
// These are the shapes every module of the rewritten engine shares:
// `./classify.ts` (cpt-frontx-algo-upgrade-changeset-classify),
// `./validate.ts` (cpt-frontx-algo-upgrade-changeset-validate),
// `./commit.ts` (cpt-frontx-algo-upgrade-changeset-commit), and `./flow.ts`
// (the forward and restore flows). They are declared in one place so the
// four never disagree about what a plan is.
import type { ContentItem } from '../scaffold/types';
import type { PreviousOrigin } from '../project-state/types';
import type { ErrorCode } from '../envelope';

export type { ContentItem, PreviousOrigin };

// The five whole-file operation kinds `cpt-frontx-adr-project-upgrade-
// mechanism` fixes, spelled exactly as the FEATURE names them. There is no
// sixth kind for a doubly-changed file: that is a REFUSAL
// (`CONTENT_CONFLICT`), never an operation to perform.
export type UpgradeOpKind = 'ADD' | 'REPLACE' | 'REMOVE' | 'KEEP_LOCAL' | 'UNCHANGED';

// One classified path within one target.
//
// `expectedDisk` and `newContent` exist for the COMMIT algorithm, not for the
// developer's review: `inst-com-verify-destinations` must re-verify,
// immediately before the first rename, that every destination "still holds
// exactly the content classification saw for it", which is only checkable if
// classification recorded what it saw. `renderReviewablePlan` (`./plan.ts`)
// projects all three away before a plan reaches a developer or a calling
// program, so the REVIEWED plan stays a list of files and actions — never
// textual deltas, and never a copy of the baseline's own content — exactly as
// the ADR requires. Every caller that shows a plan to anyone goes through
// that one function.
export interface UpgradeOperation {
  target: string;
  // Project-relative POSIX path of the destination.
  path: string;
  op: UpgradeOpKind;
  // What classification saw on disk: the file's content, or `null` for an
  // absence. The pre-rename verification compares against this.
  expectedDisk: string | null;
  // The content to land, for `ADD`/`REPLACE` only. `undefined` for
  // `REMOVE` (nothing to write), `KEEP_LOCAL`, and `UNCHANGED` (never
  // opened for writing at all).
  newContent?: string;
  // The baseline's content for this path, or `null` when the baseline does
  // not carry it. Recovery (`inst-com-restore-on-error`) needs exactly this
  // to return a landed destination to its baseline state: write the content
  // where the baseline carries the path, unlink where it does not.
  baselineContent: string | null;
}

// Why a payload path was left untouched. Both reasons are reported
// identically in the plan (`SKIPPED`) but named distinctly so a developer can
// tell "the boundary excludes this" from "this collides with the CLI's own
// reserved temporary-file convention" — the FEATURE requires the latter be
// reported "naming that collision, never silently dropped from the plan".
export type SkipReason = 'OUTSIDE_BOUNDARY' | 'RESERVED_TEMP_NAME';

export interface UpgradeSkippedPath {
  target: string;
  path: string;
  reason: SkipReason;
}

// An origin plus the version it reports — the pair the project state store
// records, and the pair a plan names on both ends of the transition.
export interface OriginVersion {
  origin: string;
  version: string;
}

// The validated operation plan `inst-val-return-pass` returns and
// `inst-com-*` consumes: `{ from, to, targets[], operations[], skipped[] }`.
export interface UpgradePlan {
  name: string;
  from: OriginVersion;
  to: OriginVersion;
  targets: string[];
  operations: UpgradeOperation[];
  skipped: UpgradeSkippedPath[];
  // Per target, the effective-ownership exclusion roots the classification was
  // computed against. Carried on the plan because the commit algorithm's own
  // stale-temporary-file reclaim (`inst-com-reclaim-stale-temp`) is scoped to
  // "inside any target's effective ownership", and commit is handed a plan
  // rather than the manifests the boundary is derived from. Internal: stripped
  // by `renderReviewablePlan` (`./plan.ts`) before any plan reaches a reviewer.
  exclusionRootsByTarget: Record<string, string[]>;
}

// A resolved payload: the manifest text plus every regular file the payload
// declares, template-relative.
//
// Held ENTIRELY IN MEMORY, never materialised into a staging directory on
// disk. `cpt-frontx-adr-project-upgrade-mechanism` requires only that every
// resolution serving an upgrade "reads its content without ever adopting a
// new identity into the project or disturbing the registered slot"; an
// in-memory payload satisfies that strictly, and the ADR's own
// staging-residue consequence ("a staging location orphaned by a killed
// process is never reclaimed automatically") is vacuous for it — there is no
// location to orphan. The resolver already hands back the fetched content as
// one string (`InventoryReadyRecord.content`), bundle-shaped when the payload
// is multi-file (`bundle/envelope.ts`'s `$frontxTemplateFiles`), so nothing
// needs to touch disk to read a remote payload; a local `path:` origin's
// payload is read from its own folder, which is not a staging location
// either.
export interface ResolvedPayload {
  // The declared identity from the resolved manifest.
  name: string;
  // The version the resolved origin actually reports — compared against a
  // recorded expectation by `inst-val-check-baseline` and
  // `inst-val-if-candidate-version-mismatch`.
  version: string;
  // The origin as resolved (pinned where the origin kind supports pinning).
  origin: string;
  // Template-relative path -> file content. Regular files only; the manifest
  // file itself is NOT part of the payload (a template's own manifest is not
  // content it applies onto a target).
  files: Map<string, string>;
  // The manifest's declared `excludedSubtrees`, which the boundary
  // computation consumes. Read here so no caller re-parses the manifest.
  excludedSubtrees: string[];
}

export type ResolvePayloadResult =
  | { ok: true; payload: ResolvedPayload }
  | { ok: false; code: Extract<ErrorCode, 'ORIGIN_UNAVAILABLE' | 'INVALID_MANIFEST'>; message: string };

// Resolves ONE origin to its payload, without adopting anything into the
// project or the registered inventory slot. The one seam both the baseline's
// re-resolution and the candidate's resolution go through, so neither can
// accidentally read "whatever the name's inventory slot currently holds" —
// which the ADR forbids explicitly, since a developer may have installed a
// different reference of the same identity into that slot since the name was
// last applied.
export type ResolvePayloadFn = (origin: string) => Promise<ResolvePayloadResult>;

// What is actually at a path on disk. The five cases are distinguished
// because `inst-cls-if-not-regular` must refuse fail-closed on a directory,
// a symlink, or a SPECIAL file (a FIFO, socket, or device — anything that is
// neither a regular file, a directory, nor a symlink) where a payload
// declares a path, while an ABSENCE is an ordinary comparison input ("an
// absent path is unequal to any content, and two absences are equal").
//
// `'special'` is its own kind, never folded into `'directory'` the way an
// earlier version of the real adapter (`../adapters/fs-upgrade-io.ts`) did:
// `'directory'` is a PERMITTED ancestor shape (`classify.ts`'s own ancestor
// probe treats it as ordinary structure to descend through), while a special
// file standing at that same position must block everything beneath it
// exactly like a symlink does. Collapsing the two let a FIFO standing where
// an ancestor directory is required pass as a perfectly good directory —
// this seam's own `lstatSync` then threw `ENOTDIR` for every path beneath
// it, caught and reported `'absent'`, which satisfied the "two absences are
// equal" comparison rule and reported nothing to do for content the engine
// had never actually been able to read. `'special'` is spelled identically
// to `scaffold/existing-content.ts`'s own `kind: 'special'` for the same
// fact on the apply side — one name for one shape, never a second.
export type DiskEntry =
  | { kind: 'file'; content: string }
  | { kind: 'absent' }
  | { kind: 'directory' }
  | { kind: 'symlink' }
  | { kind: 'special' };

// Reads one absolute path's disk state. Never throws for absence — that is
// the `'absent'` case, a first-class comparison input.
export type ReadDiskEntryFn = (absolutePath: string) => Promise<DiskEntry>;

// Enumerates every REGULAR FILE reachable under an absolute directory,
// POSIX-relative to it. Regular files only, and never following a symlink.
//
// Classification no longer has a disk-enumeration term at all (see
// `classify.ts`'s `inst-cls-enumerate` on why the ADR's "not examined at all"
// wins over the FEATURE's former disk clause), so this seam's remaining
// consumer is the commit algorithm's stale-temporary-file reclaim
// (`inst-com-reclaim-stale-temp`) and a local `path:` origin's own payload
// enumeration. Both want real files and nothing else: a symlink reported as a
// file would make reclaim unlink a link it never wrote, and would put a link's
// target into a payload as though the template declared it. Resolves to `[]`, never a throw, when the
// directory does not exist.
export type ListDiskFilesFn = (absoluteDir: string) => Promise<string[]>;

// --- commit-phase write seams -------------------------------------------
// Each is one primitive the staged write needs, injected so the algorithm
// itself performs no direct filesystem access (this package's convention).

// Writes `content` to `absolutePath`, creating parent directories as needed.
// Used for the temporary files of `inst-com-materialize-temp` and for
// recovery's baseline restoration (`inst-com-restore-on-error`).
export type WriteDiskFileFn = (absolutePath: string, content: string) => Promise<void>;

// Atomically renames `from` over `to`, creating any parent directory the
// rename needs (`inst-com-apply-within-boundary`).
export type RenameDiskFileFn = (from: string, to: string) => Promise<void>;

// Unlinks one absolute path, no-op when already absent. Used both for a
// `REMOVE` operation and to reverse a landed `ADD` during recovery. Never
// removes the directory a `REMOVE` leaves empty.
export type UnlinkDiskFileFn = (absolutePath: string) => Promise<void>;

// The developer's approval decision for one computed plan — symmetric to
// `commands/delete.ts`'s `ConfirmDeletionFn`, with a plan-shaped payload.
// Never called at all when validation refuses: the FEATURE requires the plan
// is "never presented when any of them applies".
export type PresentUpgradePlanFn = (plan: UpgradePlan) => Promise<'approved' | 'declined'>;

// --- outcomes -----------------------------------------------------------

// Every refusal draws from the shared, stable vocabulary
// `cpt-frontx-adr-cli-machine-readable-output` fixes; this feature
// introduces none and retires none.
//
// `INVALID_PATH` names one specific validation-time refusal:
// `cpt-frontx-algo-upgrade-changeset-classify` finds an ancestor symlink
// whose resolved target escapes the project root (`ClassifyResult.
// escapingPaths`, `./classify.ts`). This is a VALUE `validateUpgrade`
// decides to hand back before anything is written — the same way
// `commands/apply.ts`'s own pre-flight containment check returns
// `INVALID_PATH` as an ordinary outcome of its batch pipeline — and is
// unrelated to the commit algorithm's own containment escape, which is
// never one of this vocabulary's values: a TOCTOU race caught during the
// staged write is reported as a rethrown `PathContainmentError`
// (`../adapters/fs-upgrade-io.ts`'s own header), mapped to `INVALID_PATH`
// only once it reaches `cli.ts`'s `run()`, never surfaced as a
// `CommitOutcome` this type union has to carry.
export type UpgradeRefusalCode = Extract<
  ErrorCode,
  | 'TEMPLATE_NOT_REGISTERED'
  | 'TARGET_NOT_APPLIED'
  | 'NOTHING_TO_RESTORE'
  | 'VERSION_MISMATCH'
  | 'ORIGIN_UNAVAILABLE'
  | 'REGISTRATION_CONFLICT'
  | 'CONTENT_CONFLICT'
  | 'TARGET_CONFLICT'
  | 'INVALID_PATH'
  | 'PROJECT_INVALID'
  | 'INVALID_MANIFEST'
  | 'INTERNAL'
>;

export interface UpgradeRefusal {
  ok: false;
  code: UpgradeRefusalCode;
  message: string;
  details?: Record<string, unknown>;
}

// --- generic project-file seams -----------------------------------------
// Not upgrade-specific and not retired with the old engine: `adapters/
// fs-project-io.ts` implements these three for several callers, and the
// rewritten engine's own disk seams (`ReadDiskEntryFn`/`WriteDiskFileFn`/
// `UnlinkDiskFileFn`, above) are deliberately DISTINCT shapes rather than
// reuses — `ReadProjectFileFn` collapses absence and a directory into one
// `null`, which is exactly the distinction `inst-cls-if-not-regular` must
// refuse fail-closed on. Kept here, where their existing importers already
// find them, rather than moved and forcing an unrelated churn.
export type ReadProjectFileFn = (absolutePath: string) => Promise<string | null>;
export type WriteProjectFileFn = (absolutePath: string, content: string) => Promise<void>;
export type RemoveProjectFileFn = (absolutePath: string) => Promise<void>;
