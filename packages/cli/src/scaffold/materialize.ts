import { readManifestFromContent } from '../manifest/validate-contract';
import { writeProvenance } from '../provenance/write';
import { formatTemplateAddress, parseSourceSpec } from '../spec-parser/parse';
import { composeSharedFiles } from './compose-shared-files';
import type { ComposeSharedFilesResult } from './compose-shared-files';
import type { ProvenanceRecord, ProvenanceWriteFn } from '../provenance/types';
import type { InventoryEntry } from '../inventory/types';
import type { OccupiedBoundaryEntry } from './state';
import type { ReadProjectFileFn, StagedAssembly, WriteFileFn } from './types';

// Injected reader for a target repository's existing provenance records —
// empty for a seed (the target is empty by definition) or the repository's
// current records for an add (cpt-frontx-flow-cli-scaffolding-add-template).
export type ReadProvenanceRecordsFn = (targetDir: string) => Promise<ProvenanceRecord[]>;

export type OccupiedBoundariesResult =
  | { ok: true; occupied: OccupiedBoundaryEntry[] }
  | {
      ok: false;
      reason: 'occupied-not-installed' | 'occupied-manifest-unreadable' | 'occupied-source-ambiguous';
      templateIdentity: string;
      sourceSpec: string;
      message: string;
    };

// Derives the ownership boundaries already occupied by a repository's
// previously-applied templates by cross-referencing each existing provenance
// record against the local inventory — the boundaries
// cpt-frontx-flow-cli-scaffolding-add-template submits to the pre-flight
// conflict check TOGETHER WITH the newly staged assembly.
//
// A record that cannot be resolved fails the whole derivation instead of being
// skipped. Skipping drops that template's boundaries from the conflict check,
// so the check would pass a claim over ground an applied template already owns
// and the add would overwrite it — the one outcome the pre-flight check exists
// to prevent.
//
// A record written before identity came from the manifest holds the repository
// name, which no inventory entry answers to any more, so identity alone would
// fail every such repository with no recovery: reinstalling from the recorded
// source-spec lands under the manifest identity, not the recorded one. The
// record's source-spec is the value that survived the change, so an identity
// miss falls back to matching the installed template by source address. That
// makes the migration silent where it can be, and leaves a loud failure only
// where the template genuinely is not installed.
//
// The upgrade path recognizes the same pre-manifest-identity record by a
// different mechanic, and the two must stay in step rather than silently
// diverge: matching by address discriminates HERE because it picks one entry
// out of many installed, whereas upgrade re-resolves both diff sides from the
// record's own single source-spec, where an address comparison is true by
// construction and would admit every record. That side therefore derives the
// previous scheme's value from the address instead — see
// `verifyTemplateIdentity` in packages/cli/src/upgrade/verify-identity.ts.
//
// One claim per resolved installed template, however many records point at it:
// a template owns its boundaries once, and the reason is at the skip below.
export function occupiedBoundariesFromProvenance(
  records: ProvenanceRecord[],
  lookupFn: (name: string) => InventoryEntry | undefined,
  installed: InventoryEntry[],
): OccupiedBoundariesResult {
  const occupied: OccupiedBoundaryEntry[] = [];
  const claimed = new Set<string>();
  for (const record of records) {
    // An identity hit is trusted only when the entry came from the address the
    // record names. An inventory written before the collision guard existed can
    // hold this key pointing at another template, and its boundaries would then
    // be checked in place of the real occupant's — a claim over ground the
    // actual owner holds would pass.
    const byIdentity = lookupFn(record.templateIdentity);
    const candidates =
      byIdentity !== undefined && sameSourceAddress(byIdentity.source, record.sourceSpec)
        ? [byIdentity]
        : matchBySourceAddress(record.sourceSpec, installed);
    const [entry, ...surplus] = candidates;

    if (entry === undefined) {
      return {
        ok: false,
        reason: 'occupied-not-installed',
        templateIdentity: record.templateIdentity,
        sourceSpec: record.sourceSpec,
        message:
          `Applied template "${record.templateIdentity}" is recorded in this repository but is not installed locally, ` +
          `so the ground it owns cannot be checked. Install it with "frontx install ${record.sourceSpec}" and retry.`,
      };
    }
    if (surplus.length > 0) {
      return {
        ok: false,
        reason: 'occupied-source-ambiguous',
        templateIdentity: record.templateIdentity,
        sourceSpec: record.sourceSpec,
        message:
          `Applied template "${record.templateIdentity}" is not installed under that identity, and more than one ` +
          `installed template was acquired from "${record.sourceSpec}", so the ground it owns cannot be established. ` +
          'Remove the duplicate from the local inventory and retry.',
      };
    }

    // Two records resolving to one installed template describe one occupant,
    // not two. The conflict check pairs each staged claim with every occupied
    // one, so the same boundaries submitted twice make one occupant contest an
    // incoming claim twice and appear in the refusal report under two
    // identities — a duplicate the reader has to work out is a single occupant,
    // over records already on disk that they cannot change. Reachable from
    // provenance written before identity came from the manifest, where a legacy
    // record and a manifest-identity record for one template both resolve here:
    // one by identity, one by address. The first record's identity is the one
    // reported, and either names ground the same entry owns.
    if (claimed.has(entry.name)) continue;
    claimed.add(entry.name);

    const manifestResult = readManifestFromContent(entry.content);
    if (!manifestResult.ok) {
      return {
        ok: false,
        reason: 'occupied-manifest-unreadable',
        templateIdentity: record.templateIdentity,
        sourceSpec: record.sourceSpec,
        message:
          `Applied template "${record.templateIdentity}" is installed locally but does not satisfy the manifest ` +
          `contract, so the ground it owns cannot be checked: ${manifestResult.message}. ` +
          `Reinstall it with "frontx install ${record.sourceSpec}" and retry.`,
      };
    }
    // The record's identity, not the entry's, names the occupant: it is what
    // this repository's own region markers and provenance already carry.
    occupied.push({ templateName: record.templateIdentity, boundary: manifestResult.manifest.ownershipBoundaries });
  }
  return { ok: true, occupied };
}

// Installed templates acquired from the same address as `sourceSpec`, ignoring
// the version selector: the address is what identifies a template across a
// change of identity scheme, and across the version the record was applied at.
function matchBySourceAddress(sourceSpec: string, installed: InventoryEntry[]): InventoryEntry[] {
  return installed.filter((entry) => sameSourceAddress(entry.source, sourceSpec));
}

// Whether two source-specs address the same template, ignoring the version
// selector. A spec that no longer parses matches nothing: its origin cannot be
// established, and guessing would be worse than the loud failure downstream.
function sameSourceAddress(left: string, right: string): boolean {
  const a = parseSourceSpec(left);
  const b = parseSourceSpec(right);
  return a.ok && b.ok && formatTemplateAddress(a.value) === formatTemplateAddress(b.value);
}

// The subset of ComposeSharedFilesResult's discriminant reachable here —
// derived rather than hand-duplicated, so a new compose refusal reason added
// there flows into this union automatically. The type alias alone does not
// force anything, though: see USER_FIXABLE_COMPOSE_REASONS below, whose
// Record<ComposeFailureReason, boolean> shape is what turns "a new reason
// wasn't classified yet" into a compile error in THIS file, instead of
// silently falling through to 'provenance-failed' at the caller.
type ComposeFailureReason = Extract<ComposeSharedFilesResult, { ok: false }>['reason'];

// review #500 (fix 2/2): `composeSharedFiles` already distinguishes a
// user-fixable refusal (the developer can edit the target repository and
// retry) from a materialization-invariant violation (a bug in the pre-flight
// conflict check, not something the user did wrong) via its typed `reason`.
// The FIRST fix on this review thread propagated that same distinction one
// hop further — `materializeAssembly` used to collapse every compose failure
// to a bare `message`, which is what let `addTemplate`/`seedRepository`
// re-tag EVERY materialization refusal as `'provenance-failed'` regardless
// of cause, and `cli.ts` then exit that as EXIT_INTERNAL_ERROR even for a
// refusal the user could fix themselves (`unrecorded-owner`). `composeReason`
// carries the SAME typed reason one hop further: undefined for a real
// provenance-write failure (writeProvenance below never produces a
// ComposeFailureReason), populated with compose's own reason otherwise.
export type MaterializeResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      composeReason?: ComposeFailureReason;
      // Populated only when composeReason is 'unrecorded-owner' — lets a
      // caller (e.g. `seedRepository`) build its OWN wording around the
      // concrete path/owner/region rather than reusing compose's generic
      // "record this owner's provenance and retry" message verbatim, which
      // is not always actionable advice for every caller (see seedRepository).
      unrecordedOwner?: { path: string; templateIdentity: string; regionKey: string };
    };

// The four compose refusals the target repository's OWNER can resolve and
// retry: `unrecorded-owner` (register the occupying template's provenance),
// `span-overlap` (disentangle overlapping markers in template content),
// `carried-block-conflict` (fix a hand-edited or corrupted on-disk file), and
// `malformed-marker-block` (fix or remove the on-disk marker composeSharedFiles
// names by path and line number — a token with no `identity:key` separator, an
// unterminated region, or an orphaned end marker; added review #500 round 3,
// having been missed when the refusal itself was added in round 2 — see
// composeSharedFiles' own inst-cs-if-malformed-marker doc for why this is
// detected on the on-disk buffer itself and, like the other three, is
// something ONLY the repository's owner can fix, never a pre-flight-check
// miss). Every other compose reason (`exclusive-contested`, `key-collision`,
// `carried-key-collision`) names a materialization invariant the pre-flight
// conflict check should already have caught — reaching materialization means
// that check missed it, which is a mechanism bug, not the user's to fix.
// review #500 round 4: a `ReadonlySet` used to stand in here. A Set's `.has`
// answers `false` for a member it was never told about — so the exact defect
// this round's review caught (`malformed-marker-block` added to
// ComposeSharedFilesResult's reason union in round 2 but never added to this
// list, silently falling through to 'provenance-failed'/EXIT_INTERNAL_ERROR)
// produced no compile error. A `Record` keyed by the FULL `ComposeFailureReason`
// union requires an explicit `true`/`false` verdict for every member: omitting
// one is `error TS2741: Property '<reason>' is missing`, raised at THIS
// declaration the moment a new reason is added to the union above, not a
// silent runtime fallback discovered later in a caller two hops away.
const USER_FIXABLE_COMPOSE_REASONS: Record<ComposeFailureReason, boolean> = {
  'unrecorded-owner': true,
  'span-overlap': true,
  'carried-block-conflict': true,
  'malformed-marker-block': true,
  'exclusive-contested': false,
  'key-collision': false,
  'carried-key-collision': false,
};

/**
 * Classifies a materialization failure as user-fixable (the target
 * repository's owner can resolve it and retry `seed`/`add`) or not (a
 * mechanism bug — an invariant violation, or a real provenance-write
 * failure). Shared by `addTemplate` and `seedRepository` so both commands
 * map the same set of compose reasons to the same exit code, rather than
 * each re-deriving — and risking drifting — its own copy of this list.
 */
export function isUserFixableMaterializeFailure(result: { ok: false; composeReason?: ComposeFailureReason }): boolean {
  return result.composeReason !== undefined && USER_FIXABLE_COMPOSE_REASONS[result.composeReason];
}

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-boundary-declared-assembly:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-compose-shared-files:p1
/**
 * Realizes the boundary-declared-assembly DoD AND the shared-file region
 * composition DoD. The staged assembly already carries, per applied
 * template, ownership boundaries read from its manifest and content items
 * read from its installed content path scoped to those declared boundaries
 * — never from the manifest — via the P14 uniform-apply path
 * (cpt-frontx-algo-cli-scaffolding-uniform-apply). This function delegates
 * the actual write to `composeSharedFiles` (cpt-frontx-algo-cli-scaffolding-compose-shared-files)
 * rather than writing each contribution's files directly, because a naive
 * per-contribution write would let the LAST contributor to a shared
 * `region-union` path silently clobber every earlier contributor's region —
 * exactly the silent-merge failure mode `cpt-frontx-dod-cli-scaffolding-conflict-check`
 * exists to prevent. It then writes one provenance record PER applied
 * template — appended to any records the target already holds (add-template)
 * rather than overwriting them; a seed always starts from an empty
 * `existingProvenance` set. `existingProvenance` is also threaded through to
 * `composeSharedFiles`, which needs the identities it names to tell a
 * recorded-but-not-contributing template's on-disk region-union block (carry
 * forward verbatim, `cpt-frontx-dod-cli-scaffolding-preserve-applied-regions`)
 * apart from an unrecorded one (refuse the assembly). On a compose refusal,
 * the returned failure carries composeSharedFiles' own typed `reason` as
 * `composeReason` (review #500 fix 2/2) — undefined only for a real
 * `writeProvenance` failure below — so `addTemplate`/`seedRepository` can
 * tell a user-fixable materialization refusal apart from a mechanism bug
 * instead of collapsing every failure into one internal-error code.
 */
export async function materializeAssembly(
  assembly: StagedAssembly,
  targetDir: string,
  existingProvenance: ProvenanceRecord[],
  lookupFn: (name: string) => InventoryEntry | undefined,
  writeFileFn: WriteFileFn,
  provenanceWriteFn: ProvenanceWriteFn,
  // Defaults to "nothing already on disk" — see composeSharedFiles for why
  // that default is safe: it reproduces the pre-fix behavior exactly for a
  // caller that has no target repository state to reconcile against.
  // TODO(#489): make required once the pending #489 branch merges — see the
  // identical TODO on composeSharedFiles' own default for why it cannot be
  // done yet.
  readProjectFileFn: ReadProjectFileFn = async () => null,
): Promise<MaterializeResult> {
  const composeResult = await composeSharedFiles(assembly, targetDir, writeFileFn, readProjectFileFn, existingProvenance);
  if (!composeResult.ok) {
    return {
      ok: false,
      message: composeResult.message,
      composeReason: composeResult.reason,
      ...(composeResult.reason === 'unrecorded-owner'
        ? {
            unrecordedOwner: {
              path: composeResult.path,
              templateIdentity: composeResult.templateIdentity,
              regionKey: composeResult.regionKey,
            },
          }
        : {}),
    };
  }

  const newRecords: ProvenanceRecord[] = assembly.contributions.map((contribution) => {
    const entry = lookupFn(contribution.templateName);
    const manifestResult = entry ? readManifestFromContent(entry.content) : undefined;
    return {
      templateIdentity: contribution.templateName,
      scaffoldedFromVersion: manifestResult && manifestResult.ok ? manifestResult.manifest.version : '',
      sourceSpec: entry?.source ?? '',
    };
  });

  const result = await writeProvenance([...existingProvenance, ...newRecords], targetDir, provenanceWriteFn);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true };
}
