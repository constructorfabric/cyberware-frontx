import type { OwnershipBoundary } from '../manifest/types';
import type { ProvenanceRecord } from '../provenance/types';
import type { ReadProjectFileFn, StagedAssembly, WriteFileFn } from './types';

// Region-addressing schema owned by `cpt-frontx-feature-template-manifest`: a
// `region-union` shared-file entry's owned region is delimited on disk by a
// matched begin/end sentinel-marker pair embedding the owning template's
// identity and the region key — a comment-style marker line pair of the
// shape `frontx:region <identity>:<key>` … `frontx:endregion <identity>:<key>`.
const REGION_BEGIN_PREFIX = 'frontx:region';
const REGION_END_PREFIX = 'frontx:endregion';

// A single template's declared claim on one target repository file path,
// carrying the identity, declared merge strategy, and owned region keys
// needed to resolve write ownership. `mergeStrategy` mirrors
// `SharedFileEntry.mergeStrategy` (a closed set already validated upstream by
// the manifest contract) — kept as `string` here rather than narrowed via a
// cast.
interface PathContribution {
  templateName: string;
  mergeStrategy: string;
  ownedRegions: string[];
  content: string;
}

// One contributing template's extracted region-union content for a shared
// path — the sentinel markers are preserved in `markerBlock` so a later
// boundary-scoped upgrade, and the pt.2 disjoint-union composition (out of
// scope here), can re-locate it.
export interface ExtractedRegion {
  templateName: string;
  regionKey: string;
  markerBlock: string;
}

// A single repository file materialized by the algorithm — either a
// whole-file single-owner write or the composed disjoint-region union.
export interface MaterializedFile {
  path: string;
  content: string;
}

// The algorithm's outcome: the full set of materialized repository files
// (`inst-cs-return-materialized`), or one of several refusals. Three are
// declared-level or carried-key materialization invariants (each names a
// condition the pre-flight conflict check,
// `cpt-frontx-algo-cli-scaffolding-conflict-check`, should already have
// refused, so reaching any of them here is a bug in that earlier gate rather
// than a normal refusal path); `span-overlap` is the content-level conflict
// only materialization can observe; `unrecorded-owner` is neither a bug nor
// a content-level conflict — it is evidence the occupied-boundary picture
// the pre-flight check evaluated was incomplete (`inst-cs-return-unrecorded-owner`).
// `carried-block-conflict` is likewise not a pre-flight-check miss: it is
// detected entirely WITHIN the carried-block set read from one on-disk
// buffer, which the pre-flight check never sees at all, so a duplicate or
// overlapping pair there can only mean the on-disk file itself — the same
// insufficiently-trusted source `unrecorded-owner` already treats with
// suspicion — was hand-edited or corrupted since it was last written
// (`inst-cs-return-carried-block-conflict`). `malformed-marker-block` is
// detected EARLIER than any of those three: while scanning the on-disk buffer
// for marker pairs at all (`inst-cs-read-existing-blocks`), before contributor
// identity is even considered. A begin or end marker whose token has no
// `identity:key` separator, a begin marker with no matching end marker before
// end of file, or an end marker that closes no block (no preceding begin for
// its key, or an earlier begin of that same key already claimed the only
// preceding available end — review #500 round-3 P1), means that block's
// boundaries cannot be established for ANY marker on the path — contributor-
// owned or not — so it cannot be classified as either a carried block or an
// unrecorded owner; `carried-block-conflict`, by contrast, only ever compares
// blocks that already parsed and closed successfully
// (`inst-cs-return-malformed-marker`).
export type ComposeSharedFilesResult =
  | { ok: true; files: MaterializedFile[] }
  | { ok: false; reason: 'exclusive-contested'; path: string; contestants: string[]; message: string }
  | { ok: false; reason: 'key-collision'; path: string; regionKey: string; contestants: string[]; message: string }
  | {
      ok: false;
      reason: 'span-overlap';
      path: string;
      contestants: string[];
      regionKeys: string[];
      message: string;
    }
  | {
      ok: false;
      reason: 'unrecorded-owner';
      path: string;
      templateIdentity: string;
      regionKey: string;
      message: string;
    }
  | {
      ok: false;
      reason: 'carried-key-collision';
      path: string;
      regionKey: string;
      contestants: string[];
      message: string;
    }
  | {
      ok: false;
      reason: 'carried-block-conflict';
      path: string;
      contestants: string[];
      regionKeys: string[];
      message: string;
    }
  | {
      ok: false;
      reason: 'malformed-marker-block';
      path: string;
      lineNumber: number;
      kind: 'malformed' | 'unterminated' | 'orphan-end';
      identity?: string;
      regionKey?: string;
      message: string;
    };

// Resolves a single content item's declared ownership on its own path — a
// whole-file `exclusive` claim when no shared-file entry declares the path
// (it is written whole by its template because it falls under a declared
// exclusive subtree), or the declared merge strategy + owned region keys
// when a shared-file entry declares it.
function resolvePathContribution(
  templateName: string,
  path: string,
  content: string,
  boundaries: OwnershipBoundary,
): PathContribution {
  const sharedEntry = boundaries.sharedFiles.find((entry) => entry.path === path);
  if (!sharedEntry) {
    return { templateName, mergeStrategy: 'exclusive', ownedRegions: [], content };
  }
  return { templateName, mergeStrategy: sharedEntry.mergeStrategy, ownedRegions: sharedEntry.ownedRegions, content };
}

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-group-by-path
/**
 * Groups the staged assembly's contributions by target repository file path,
 * carrying each contributing template's identity, declared merge strategy,
 * and owned region keys.
 */
export function groupContributionsByPath(assembly: StagedAssembly): Map<string, PathContribution[]> {
  const grouped = new Map<string, PathContribution[]>();
  for (const contribution of assembly.contributions) {
    for (const file of contribution.files) {
      const entry = resolvePathContribution(
        contribution.templateName,
        file.path,
        file.content,
        contribution.ownershipBoundaries,
      );
      const existing = grouped.get(file.path);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(file.path, [entry]);
      }
    }
  }
  return grouped;
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-group-by-path

// The actual on-disk line-index span of one located marker pair — the
// content-level position that pt.2's span-overlap check (inst-cs-if-span-overlap)
// compares across regions; a declared region key alone (checked by pt.1's
// inst-cs-if-key-collision) cannot reveal this.
export interface RegionSpan {
  beginIndex: number;
  endIndex: number;
}

// Parses ONE marker line for a given sentinel PREFIX (`frontx:region` or
// `frontx:endregion`), extracting its `identity:key` token the same way
// regardless of which direction is calling: the known-pair locator
// (`locateRegionSpan`) and the blind scanner (`locateAllMarkerBlocks`) must
// agree on where a token ends, or a shared key prefix (e.g. declared region
// keys "scripts" and "scripts-dev") lets one marker be mistaken for a
// substring of another's — the review #500 round-2 P1-2 defect this function
// exists to close. Returns `undefined` when the line carries no occurrence of
// `prefix` with a valid boundary anywhere in it — INCLUDING when every
// occurrence of `prefix` is only a leading substring of a longer word (e.g.
// "frontx:regional configuration", "frontx:endregionally noted") —
// `'malformed'` when the first occurrence of `prefix` with a proper boundary
// after it has a token with no `identity:key` separator, or the parsed pair
// otherwise. Tolerates an arbitrary comment PREFIX before the marker token
// (the marker hides inside a comment of any language) and takes the token up
// to the first whitespace as its SUFFIX boundary — see
// `locateAllMarkerBlocks`'s docstring below for why that boundary rule is the
// most this scanner can resolve in general.
//
// The contract (`cpt-frontx-feature-template-manifest`) shapes a marker as
// `<PREFIX> <identity>:<key>` — a whitespace boundary between PREFIX and the
// token is part of that shape, not incidental. Before the round-4 boundary
// check, `indexOf` alone treated ANY occurrence of the bare prefix text as a
// marker: ordinary prose that merely happens to START with the prefix's
// characters (e.g. the word "frontx:regional") was misparsed as a marker with
// no `identity:key` separator and reported `malformed` — which, since commits
// 1bf44af1/ce4584c8 made `malformed` a materialization refusal, meant any
// file containing that word broke `add`/`seed` outright. Requiring a
// whitespace-or-end-of-line boundary right after `prefix` distinguishes an
// actual marker occurrence from prose that is merely prefixed by the same
// characters, without weakening detection of a genuine malformed marker (a
// real marker line with a boundary, but no resolvable `identity:key` after
// it, is still reported `'malformed'`).
//
// That round-4 fix checked only the FIRST `indexOf` hit, though: comment
// prefixes are arbitrary and unbounded (the marker "hides inside a comment of
// any language"), so boundary-less prose ahead of a genuine marker on the
// SAME line is not a hypothetical — it is exactly what an arbitrary-prefix
// scanner must expect. Stopping at the first hit meant a real marker further
// along the line (e.g. "frontx:regional note; frontx:region prior:k") was
// never reached at all, reported `undefined` as if no marker existed on the
// line (review #500 round-5, regression from round-4's own fix). This loop
// walks every occurrence of `prefix` in on-disk order and returns on the
// FIRST one with a valid boundary — whether that first bounded occurrence
// goes on to parse cleanly or turns out `'malformed'`, per the same
// first-occurrence contract this function has always had (a well-formed
// marker occurring for a SECOND time, with the same prefix, on one line is
// intentionally left to that first-found occurrence — see
// `locateAllMarkerBlocks`'s docstring for why one marker per line-and-prefix
// is the shape every real manifest and fixture uses, and why extending this
// function to return more than one match would be a contract change no
// caller asks for).
function parseMarkerLine(line: string, prefix: string): { identity: string; regionKey: string } | 'malformed' | undefined {
  let searchFrom = 0;
  while (searchFrom <= line.length) {
    const prefixIndex = line.indexOf(prefix, searchFrom);
    if (prefixIndex === -1) return undefined;
    const boundaryChar = line[prefixIndex + prefix.length];
    if (boundaryChar === undefined || /\s/.test(boundaryChar)) {
      const afterPrefix = line.slice(prefixIndex + prefix.length).trimStart();
      const token = afterPrefix.split(/\s/)[0] ?? '';
      const colonIndex = token.indexOf(':');
      if (colonIndex === -1) return 'malformed';
      return { identity: token.slice(0, colonIndex), regionKey: token.slice(colonIndex + 1) };
    }
    // This occurrence had no boundary (e.g. "regional" continuing past
    // "frontx:region") — keep scanning from just past where it started, not
    // past its whole length, so an adversarially overlapping repeat of
    // `prefix` immediately after is still found.
    searchFrom = prefixIndex + 1;
  }
  return undefined;
}

// A marker on the scanned file whose block boundaries could not be
// established: either a begin OR end marker's token has no `identity:key`
// separator (`kind: 'malformed'` — which side it was on does not change how
// the caller must respond, so it is not tracked), a begin marker that opens a
// region with no matching end marker before end of file (`kind:
// 'unterminated'`, carrying the identity/regionKey that WAS parsed from its
// begin marker), or an end marker that never closes any located block (`kind:
// 'orphan-end'`, carrying the identity/regionKey that WAS parsed from its own
// token) — either because no begin marker for its `identity:key` precedes it
// at all, or because an earlier begin marker sharing that same `identity:key`
// already claimed the nearest preceding available end marker (review #500
// round-3 P1: nearest-first matching, per `locateAllMarkerBlocks`'s docstring,
// means at most one begin ever claims a given end, so a second begin sharing
// a key with an already-closed one is reported `unterminated` on ITS OWN
// line, never as a reason to call the end that already closed something
// `orphan-end`). Surfaced so the caller can refuse materialization naming the
// exact line and defect, rather than the file's content silently vanishing
// from the composed output the way a `continue` past it once did (review #500
// round-2 P1-1).
export type UnlocatableMarker =
  | { kind: 'malformed'; lineIndex: number }
  | { kind: 'unterminated'; lineIndex: number; identity: string; regionKey: string }
  | { kind: 'orphan-end'; lineIndex: number; identity: string; regionKey: string };

// Locates one template's owned region on disk by matching the begin/end
// sentinel-marker pair keyed by that template's identity and the declared
// region key. Returns undefined if the pair cannot be located — pre-publish
// manifest validation guarantees well-formed declared keys, not that the
// markers exist on disk. Matches by PARSED identity/regionKey equality
// (`parseMarkerLine`), never by substring containment — a declared region key
// that is a prefix of another declared key on the same path (e.g. "scripts"
// and "scripts-dev") must not let this locator's begin or end search land on
// the other key's marker line (review #500 round-2 P1-2).
export function locateRegionSpan(content: string, templateName: string, regionKey: string): RegionSpan | undefined {
  const lines = content.split('\n');
  const matchesTarget = (line: string, prefix: string): boolean => {
    const parsed = parseMarkerLine(line, prefix);
    return typeof parsed === 'object' && parsed.identity === templateName && parsed.regionKey === regionKey;
  };
  const beginIndex = lines.findIndex((line) => matchesTarget(line, REGION_BEGIN_PREFIX));
  if (beginIndex === -1) return undefined;
  const endIndex = lines.findIndex((line, index) => index > beginIndex && matchesTarget(line, REGION_END_PREFIX));
  if (endIndex === -1) return undefined;
  return { beginIndex, endIndex };
}

// Locates and extracts one template's owned region from its installed
// content by matching the begin/end sentinel-marker pair keyed by that
// template's identity and the declared region key. Returns the region text
// INCLUSIVE of its marker lines, undefined if the pair cannot be located.
export function extractOwnedRegion(content: string, templateName: string, regionKey: string): string | undefined {
  const span = locateRegionSpan(content, templateName, regionKey);
  if (!span) return undefined;
  const lines = content.split('\n');
  return lines.slice(span.beginIndex, span.endIndex + 1).join('\n');
}

// A block discovered by scanning a file for ANY begin/end sentinel-marker
// pair, without prior knowledge of the owning identity or region key — the
// reverse of `locateRegionSpan`/`extractOwnedRegion` above, which locate one
// ALREADY-KNOWN (identity, key) pair. `inst-cs-read-existing-blocks` needs
// this to discover a block whose owner may not be a contributor to the
// staged assembly at all: a template applied by an earlier `add` that this
// assembly does not touch.
export interface LocatedBlock {
  identity: string;
  regionKey: string;
  span: RegionSpan;
  text: string; // verbatim, INCLUSIVE of marker lines — carried forward as-is, never re-derived
}

// `locateAllMarkerBlocks`'s full result: every block it COULD locate, plus
// every begin-marker it found but could not resolve into one — sorted by
// `lineIndex` ascending so a caller refusing on the first one reports the
// earliest defect in the file, regardless of which of the two scan passes
// below (malformed-token detection, then unterminated-block detection) found
// it.
export interface LocateAllMarkerBlocksResult {
  blocks: LocatedBlock[];
  unlocatable: UnlocatableMarker[];
}

// @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-read-existing-blocks
/**
 * Scans a file's content for every begin/end sentinel-marker pair and
 * returns each located block's owning identity, region key, and verbatim
 * text. Applies the region-addressing schema owned by
 * `cpt-frontx-feature-template-manifest` in reverse: the forward matcher
 * (`locateRegionSpan`) already tolerates an arbitrary comment PREFIX before
 * the marker token via `parseMarkerLine`'s `indexOf`-based search, because the
 * marker is meant to hide inside a comment of any language. Scanning without
 * a known (identity, key) to match against additionally needs a SUFFIX
 * boundary — the manifest contract places no charset restriction on a
 * region key, so `identity:key` cannot be split from a trailing
 * comment-closer (e.g. an HTML comment's or a block comment's closing
 * token) by any rule guaranteed correct in general. Every existing manifest
 * and test fixture writes `identity:key` as
 * one whitespace-free token, so this scanner takes the marker token up to
 * the first whitespace as the boundary it CAN resolve, then splits that
 * token on the FIRST `:` — a template identity is a colon-free
 * package-style name, so the region key is whatever remains, colons
 * included. A marker whose key carries embedded whitespace, or whose
 * comment-closer touches the token with no separating space (so no
 * whitespace ever separates `identity:key` from the closing token), falls
 * outside what this scanner can resolve: it cannot tell where the key ends
 * and the comment-closer begins, because `cpt-frontx-feature-template-manifest`
 * — the sole owner of the region-addressing schema — declares no charset
 * restriction on a region key. Closing that gap is a manifest-contract change
 * (reserving a character, or requiring a separating space before any
 * comment-closer), not a scanner change, so it is left unsupported here
 * rather than "fixed" by a heuristic the contract does not license.
 *
 * A begin marker whose token has no `identity:key` separator, an end marker
 * whose token has no `identity:key` separator, a begin marker with no
 * matching end marker before end of file, or an end marker that closes no
 * block, is NOT silently skipped: all four are reported back via
 * `unlocatable` (review #500 round-2 P1-1, round-3 P1) so the caller can
 * refuse materialization by name rather than have that block's content
 * vanish from the composed output with no diagnostic. An end marker is
 * matched by PARSED identity/regionKey equality (`parseMarkerLine`), never by
 * substring containment, so a declared region key that is a prefix of another
 * declared key on the same path (e.g. "scripts" and "scripts-dev") cannot
 * close the wrong block (review #500 round-2 P1-2).
 *
 * Matching is NEAREST-FIRST and CONSUMING: begins are walked in on-disk order
 * and each claims the nearest still-unclaimed matching end after it, marking
 * that end claimed before the next begin searches — so an end marker can
 * close AT MOST ONE begin. Two begins sharing one `identity:key` and only one
 * matching end is therefore not silently misread as two overlapping blocks
 * sharing that end (which independent, non-consuming searches would produce):
 * the first begin claims the sole end, and the second is reported
 * `unterminated` on its own line (round-3 P1). Symmetrically, every end
 * marker that parses but is never claimed by any begin — because no matching
 * begin precedes it at all, or because an earlier begin of the same key
 * already claimed the only preceding available end — is reported
 * `orphan-end`; an end that DOES close a block is never also reported,
 * regardless of how many other begins or ends share its key elsewhere on the
 * path (round-3 P1).
 */
export function locateAllMarkerBlocks(content: string): LocateAllMarkerBlocksResult {
  const lines = content.split('\n');
  const begins: Array<{ lineIndex: number; identity: string; regionKey: string }> = [];
  const candidateEnds: Array<{ lineIndex: number; identity: string; regionKey: string }> = [];
  const unlocatable: UnlocatableMarker[] = [];

  // Single pass classifying every line: a line can carry (at most, in every
  // real fixture) one of a begin-marker prefix or an end-marker prefix, never
  // both — `REGION_END_PREFIX` is not a substring of `REGION_BEGIN_PREFIX` or
  // vice versa, so `parseMarkerLine`'s independent `indexOf` searches for each
  // never collide on an ordinary marker line.
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const beginParsed = parseMarkerLine(line, REGION_BEGIN_PREFIX);
    if (beginParsed === 'malformed') {
      unlocatable.push({ kind: 'malformed', lineIndex });
    } else if (beginParsed !== undefined) {
      begins.push({ lineIndex, identity: beginParsed.identity, regionKey: beginParsed.regionKey });
    }

    const endParsed = parseMarkerLine(line, REGION_END_PREFIX);
    if (endParsed === 'malformed') {
      unlocatable.push({ kind: 'malformed', lineIndex });
    } else if (endParsed !== undefined) {
      candidateEnds.push({ lineIndex, identity: endParsed.identity, regionKey: endParsed.regionKey });
    }
  }

  const blocks: LocatedBlock[] = [];
  const claimedEndLineIndices = new Set<number>();
  for (const begin of begins) {
    // Nearest-first: `candidateEnds` is in on-disk (ascending lineIndex)
    // order because the scan above appended to it in that order, so `.find`
    // returns the earliest still-unclaimed matching end — the same marker an
    // unconsuming forward scan would have found, UNLESS an earlier begin
    // (processed first, since `begins` is likewise in on-disk order) already
    // claimed it.
    const matchedEnd = candidateEnds.find(
      (end) =>
        end.lineIndex > begin.lineIndex &&
        !claimedEndLineIndices.has(end.lineIndex) &&
        end.identity === begin.identity &&
        end.regionKey === begin.regionKey,
    );
    if (!matchedEnd) {
      // unterminated — no unclaimed matching end marker left to close the span
      unlocatable.push({ kind: 'unterminated', lineIndex: begin.lineIndex, identity: begin.identity, regionKey: begin.regionKey });
      continue;
    }
    claimedEndLineIndices.add(matchedEnd.lineIndex);
    blocks.push({
      identity: begin.identity,
      regionKey: begin.regionKey,
      span: { beginIndex: begin.lineIndex, endIndex: matchedEnd.lineIndex },
      text: lines.slice(begin.lineIndex, matchedEnd.lineIndex + 1).join('\n'),
    });
  }

  // Every well-formed end marker left unclaimed after every begin has had its
  // chance to claim one closes nothing on this path — orphaned, never
  // silently ignored.
  for (const end of candidateEnds) {
    if (!claimedEndLineIndices.has(end.lineIndex)) {
      unlocatable.push({ kind: 'orphan-end', lineIndex: end.lineIndex, identity: end.identity, regionKey: end.regionKey });
    }
  }

  unlocatable.sort((a, b) => a.lineIndex - b.lineIndex);
  return { blocks, unlocatable };
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-read-existing-blocks

// @cpt-algo:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-preserve-applied-regions:p1
/**
 * Groups the conflict-cleared staged assembly's contributions by target
 * repository file path and computes the whole-file single-owner paths'
 * content; for every path with any `region-union` contribution, guards the
 * declared-level materialization invariants (a contested `exclusive` path,
 * two contributors resolving the same declared region key, or a
 * carried-forward block colliding with a freshly-extracted region) that the
 * pre-flight conflict check (`cpt-frontx-algo-cli-scaffolding-conflict-check`)
 * should already have refused; reads any file already on disk at the path and
 * refuses the whole assembly, before either block-owner check below trusts
 * that file's shape at all, when scanning it finds a begin marker with no
 * parseable `identity:key` token or with no matching end marker before end of
 * file (`inst-cs-if-malformed-marker`) — an unlocatable marker means that
 * block's boundaries cannot be established for ANY block on the path, so it
 * cannot be classified as either carried-forward or unrecorded; otherwise
 * refuses the whole assembly when it carries a marker block whose owning
 * identity this assembly does not contribute AND the target's existing
 * provenance does not record (`inst-cs-if-unrecorded-block-owner`) — the
 * occupied-boundary picture the pre-flight check evaluated was incomplete —
 * otherwise carrying every other on-disk block forward verbatim
 * (`inst-cs-carry-forward-recorded-blocks`, the issue #487 fix: an earlier
 * `add` no longer truncates a previously-applied template's already-written
 * region-union block); refuses the assembly, before trusting that carried
 * set any further, when two CARRIED blocks resolve the same (identity,
 * regionKey) pair or have overlapping/nested spans — a corrupted or
 * hand-edited target file, not a pre-flight-check miss, since the pre-flight
 * check never sees carried blocks at all (`inst-cs-if-carried-block-conflict`);
 * extracts each contributor's owned region by its
 * identity-and-region-key sentinel markers; refuses the assembly if any two
 * EXTRACTED regions' actual on-disk marker spans overlap — the
 * content-level check only materialization can observe; composes the
 * collision-free set (extracted regions plus carried-forward blocks) as a
 * deterministic disjoint union with markers preserved. Only once every path
 * has been processed with no refusal does this function write any file
 * (`inst-cs-write-materialized`), so a refusal reached while processing any
 * path leaves the target repository untouched — ADR-0032's "a refused
 * assembly writes zero files", which writing each path inline as it was
 * computed would have violated the moment a LATER path's span-overlap
 * refusal fired. Returns every materialized repository file.
 */
export async function composeSharedFiles(
  assembly: StagedAssembly,
  targetDir: string,
  writeFileFn: WriteFileFn,
  // Both default to "nothing already on disk, nothing already applied" —
  // exactly the previous behavior — for the few call sites that genuinely
  // have no target repository to reconcile against (e.g. a fresh in-memory
  // fixture). Every real seed/add path (`seedRepository`, `addTemplate`)
  // always supplies its own real value here. `scaffoldComposedProject`
  // declares the same default but, unlike those two, has no production
  // caller in this CLI's own command surface (`cli.ts` never dispatches to
  // it) — its sole caller is `__tests__/composition.test.ts`, which passes a
  // null-returning stub of its own, not a real adapter (review #500).
  // TODO(#489): make this parameter required once the pending #489 branch
  // merges — kept optional for now only because
  // `__tests__/template-split.e2e.test.ts` (edited on that branch) calls
  // `seedRepository`/`addTemplate` without supplying it.
  readProjectFileFn: ReadProjectFileFn = async () => null,
  existingProvenance: ProvenanceRecord[] = [],
): Promise<ComposeSharedFilesResult> {
  const grouped = groupContributionsByPath(assembly);
  const materializedFiles: MaterializedFile[] = [];
  // Identities of templates already applied to the target repository, per
  // its existing provenance records — empty for a seed. Used ONLY to tell a
  // recorded-but-not-contributing owner apart from an unrecorded one
  // (inst-cs-if-unrecorded-block-owner / inst-cs-carry-forward-recorded-blocks);
  // never resolved to an installed template's own ownership boundary here,
  // because a carried block is written back verbatim from disk — never
  // re-derived from any template's installed content.
  const appliedIdentities = new Set(existingProvenance.map((record) => record.templateIdentity));

  for (const [path, entries] of grouped) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-single
    // A target file path owned whole by exactly one template — an exclusive
    // subtree or a whole-file `exclusive` claim (both resolve to
    // mergeStrategy 'exclusive' above).
    if (entries.length === 1 && entries[0].mergeStrategy === 'exclusive') {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-single
      // Computed only — the actual write is deferred to
      // inst-cs-write-materialized below, so a refusal raised while
      // processing a LATER path cannot leave THIS path already written.
      materializedFiles.push({ path, content: entries[0].content });
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-single
      continue;
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-single

    const hasRegionUnionContribution = entries.some((entry) => entry.mergeStrategy === 'region-union');
    // A contested exclusive-only path (no region-union contributor at all)
    // is out of this algorithm's scope — the pre-flight conflict check's
    // exclusive-clash rule already prevents it from reaching materialization.
    if (!hasRegionUnionContribution) continue;

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-multi
    // Any target file path with a region-union contribution — one
    // contributor or many.
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-exclusive-contested
    const exclusiveContested = entries.length > 1 && entries.some((entry) => entry.mergeStrategy === 'exclusive');
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-exclusive-contested
    if (exclusiveContested) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-exclusive-invariant
      return {
        ok: false,
        reason: 'exclusive-contested',
        path,
        contestants: entries.map((entry) => entry.templateName),
        message:
          `Materialization invariant violated — path "${path}" has a contested exclusive claim; ` +
          'the pre-flight conflict check should have refused this assembly before any file was written.',
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-exclusive-invariant
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-read-existing-blocks
    // The file already on disk at this path, if any — the ONLY source for a
    // block owned by a template this assembly does not contribute. Composing
    // without ever consulting it is exactly what issue #487 pinned as a
    // defect: a `region-union` file was rebuilt from the incoming assembly's
    // contribution alone, discarding whatever an earlier `add` had already
    // written there.
    const existingContent = await readProjectFileFn(`${targetDir}/${path}`);
    const { blocks: existingBlocks, unlocatable } =
      existingContent !== null ? locateAllMarkerBlocks(existingContent) : { blocks: [], unlocatable: [] };
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-read-existing-blocks

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-malformed-marker
    // Runs BEFORE either block-owner check below trusts this file's shape at
    // all: an unlocatable marker means this path's block boundaries cannot be
    // established for ANY block on it — contributor-owned or not — so it can
    // be neither classified as a carried block nor cleared as the
    // contributor's own stale extraction. Reported on the FIRST unlocatable
    // marker (`unlocatable` is sorted by line index) so a file with several
    // defects is refused on the earliest one rather than a nondeterministic
    // pick.
    const firstUnlocatable = unlocatable[0];
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-malformed-marker
    if (firstUnlocatable) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-malformed-marker
      const lineNumber = firstUnlocatable.lineIndex + 1; // 1-based for a human-readable diagnostic
      const message =
        firstUnlocatable.kind === 'malformed'
          ? `Materialization refused — path "${path}" line ${lineNumber} has a marker token with no ` +
            '"identity:key" separator, so it cannot be parsed into a locatable block. This on-disk file cannot be ' +
            'trusted to carry forward or check for unrecorded owners until this marker is fixed or removed. Fix or ' +
            `remove the marker at "${path}" line ${lineNumber} and retry. No file was written.`
          : firstUnlocatable.kind === 'unterminated'
            ? `Materialization refused — path "${path}" line ${lineNumber} opens a ` +
              `"${firstUnlocatable.identity}:${firstUnlocatable.regionKey}" region with no matching end marker ` +
              'before end of file. This on-disk file cannot be trusted to carry forward or check for unrecorded ' +
              `owners until this block is closed. Add the missing "frontx:endregion ` +
              `${firstUnlocatable.identity}:${firstUnlocatable.regionKey}" marker, or remove the orphaned begin ` +
              `marker at "${path}" line ${lineNumber}, and retry. No file was written.`
            : `Materialization refused — path "${path}" line ${lineNumber} closes a ` +
              `"${firstUnlocatable.identity}:${firstUnlocatable.regionKey}" region with no matching begin marker ` +
              'before it — either none exists on this path at all, or an earlier begin marker sharing that same ' +
              '"identity:key" already claimed the nearest preceding one. This on-disk file cannot be trusted to ' +
              'carry forward or check for unrecorded owners until this marker is fixed or removed. Add the ' +
              `missing "frontx:region ${firstUnlocatable.identity}:${firstUnlocatable.regionKey}" marker before ` +
              `it, or remove the orphaned end marker at "${path}" line ${lineNumber}, and retry. No file was ` +
              'written.';
      return {
        ok: false,
        reason: 'malformed-marker-block',
        path,
        lineNumber,
        kind: firstUnlocatable.kind,
        ...(firstUnlocatable.kind !== 'malformed'
          ? { identity: firstUnlocatable.identity, regionKey: firstUnlocatable.regionKey }
          : {}),
        message,
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-malformed-marker
    }

    const contributorIdentities = new Set(entries.map((entry) => entry.templateName));

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-unrecorded-block-owner
    const unrecordedBlock = existingBlocks.find(
      (block) => !contributorIdentities.has(block.identity) && !appliedIdentities.has(block.identity),
    );
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-unrecorded-block-owner
    if (unrecordedBlock) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-unrecorded-owner
      return {
        ok: false,
        reason: 'unrecorded-owner',
        path,
        templateIdentity: unrecordedBlock.identity,
        regionKey: unrecordedBlock.regionKey,
        message:
          `Materialization refused — path "${path}" carries a block owned by "${unrecordedBlock.identity}" ` +
          `(region "${unrecordedBlock.regionKey}") that this assembly does not contribute and that this ` +
          "repository's existing provenance does not record. That on-disk block is NOT a declaration of " +
          'ownership — it is evidence that the occupied-boundary picture the pre-flight conflict check ' +
          'evaluated was incomplete: no arbitrated claim accounts for this ground, so composing over it would ' +
          "either drop the occupying template's contribution or silently absorb an un-arbitrated claim, and " +
          'assembly-conflict-prevention forbids both outcomes. No file is written. Record ' +
          `"${unrecordedBlock.identity}"'s applied provenance for this repository (for example, reinstall it and ` +
          'reapply it through "frontx add") and retry.',
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-unrecorded-owner
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-carry-forward-recorded-blocks
    // Every located block reaching here is, by the check above, either a
    // contributor's own (stale) on-disk block — superseded by the fresh
    // extraction from its installed content just below — or owned by a
    // template recorded in provenance but NOT contributing to this
    // assembly: exactly the ground `cpt-frontx-flow-cli-scaffolding-add-template`
    // must leave untouched. Carried verbatim, never re-derived from
    // installed content, so `add` cannot silently upgrade a template outside
    // this assembly's own reviewable change-set.
    const carriedBlocks = existingBlocks.filter((block) => !contributorIdentities.has(block.identity));
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-carry-forward-recorded-blocks

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-carried-block-conflict
    // `locateAllMarkerBlocks` is a raw scanner: it neither deduplicates
    // repeated region keys nor rejects nested/overlapping spans, so this is
    // the first point that can catch a corrupted or hand-edited target file
    // BEFORE it is trusted the same way an occupied-boundary comparison
    // trusts a declared claim. Every carried block was located in the SAME
    // on-disk buffer (`inst-cs-read-existing-blocks`), so — unlike the
    // cross-buffer extracted-region check below, which only compares spans
    // when both buffers are byte-identical — comparing spans within this set
    // is unconditionally valid. Checked BEFORE building any Map keyed by
    // regionKey: a Map silently keeps the last duplicate and would hide
    // exactly the condition this check exists to surface.
    //
    // Keyed on regionKey ALONE, never on (identity, regionKey) — mirroring
    // `inst-cs-if-key-collision` and `inst-cs-if-carried-key-collision` (and,
    // upstream of both, the pre-flight conflict check's own
    // `inst-cc-if-region-key-clash`): a region key is unique per shared-file
    // PATH, not per identity, per `cpt-frontx-feature-template-manifest`.
    // Keying on the pair let two carried blocks with the SAME regionKey but
    // DIFFERENT identities pass silently into the composed union — the same
    // comparison-unit defect `carried-key-collision` (carried-vs-extracted)
    // already had fixed in commit 1ae41ec9, left unfixed here (review #500
    // round 2, P2). `kind: 'duplicate'` (same identity — the same block
    // repeated) and `kind: 'key-collision'` (different identities racing for
    // one key) are reported distinctly only in the message text below; both
    // are still one region-key match, so identity equality is checked to
    // pick the wording, never to gate whether a match occurred.
    let carriedBlockConflict:
      | { kind: 'duplicate' | 'key-collision' | 'overlap'; first: LocatedBlock; second: LocatedBlock }
      | undefined;
    for (let i = 0; i < carriedBlocks.length && !carriedBlockConflict; i++) {
      for (let j = i + 1; j < carriedBlocks.length; j++) {
        const first = carriedBlocks[i];
        const second = carriedBlocks[j];
        if (first.regionKey === second.regionKey) {
          carriedBlockConflict = { kind: first.identity === second.identity ? 'duplicate' : 'key-collision', first, second };
          break;
        }
        if (first.span.beginIndex <= second.span.endIndex && second.span.beginIndex <= first.span.endIndex) {
          carriedBlockConflict = { kind: 'overlap', first, second };
          break;
        }
      }
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-carried-block-conflict
    if (carriedBlockConflict) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-carried-block-conflict
      const { kind, first, second } = carriedBlockConflict;
      const found =
        kind === 'duplicate'
          ? `two carried blocks both resolving identity "${first.identity}" and region key "${first.regionKey}"`
          : kind === 'key-collision'
            ? `two carried blocks owned by different identities — "${first.identity}" and "${second.identity}" — ` +
              `both resolving the same region key "${first.regionKey}"`
            : `two carried blocks with overlapping or nested on-disk marker spans ` +
              `(${first.identity}:${first.regionKey} and ${second.identity}:${second.regionKey})`;
      const remedy =
        kind === 'key-collision'
          ? `remove or rename one of "${first.identity}"'s or "${second.identity}"'s "${first.regionKey}" marker pairs`
          : 'remove the duplicate marker pair, or disentangle the overlapping regions';
      return {
        ok: false,
        reason: 'carried-block-conflict',
        path,
        contestants: [first.identity, second.identity],
        regionKeys: [first.regionKey, second.regionKey],
        message:
          `Materialization refused — the file already on disk at path "${path}" carries ${found}. This is not a ` +
          'pre-flight conflict-check miss: carried blocks are read directly from that file and are never compared ' +
          'against each other before materialization, so this can only mean the file was edited by hand or ' +
          `otherwise corrupted since it was last written by this tool. Fix the file at "${path}" (${remedy}) and ` +
          'retry. No file was written.',
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-carried-block-conflict
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-extract-regions
    const extracted: ExtractedRegion[] = [];
    for (const entry of entries) {
      if (entry.mergeStrategy !== 'region-union') continue;
      for (const regionKey of entry.ownedRegions) {
        const markerBlock = extractOwnedRegion(entry.content, entry.templateName, regionKey);
        if (markerBlock === undefined) continue;
        extracted.push({ templateName: entry.templateName, regionKey, markerBlock });
      }
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-extract-regions

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-key-collision
    const ownersByRegionKey = new Map<string, string[]>();
    for (const region of extracted) {
      const owners = ownersByRegionKey.get(region.regionKey);
      if (owners) {
        owners.push(region.templateName);
      } else {
        ownersByRegionKey.set(region.regionKey, [region.templateName]);
      }
    }
    const collidedRegionKey = [...ownersByRegionKey.entries()].find(([, owners]) => owners.length > 1);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-key-collision
    if (collidedRegionKey) {
      const [regionKey, owners] = collidedRegionKey;
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-key-invariant
      return {
        ok: false,
        reason: 'key-collision',
        path,
        regionKey,
        contestants: owners,
        message:
          `Materialization invariant violated — path "${path}" has two contributors resolving region key ` +
          `"${regionKey}" (${owners.join(', ')}); the pre-flight conflict check should have refused this assembly.`,
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-key-invariant
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-carried-key-collision
    // Mirrors the pre-flight conflict check's OWN region-key-clash comparison
    // (`cpt-frontx-algo-cli-scaffolding-conflict-check` inst-cc-if-region-key-clash),
    // which flags two templates claiming the SAME region key on the SAME
    // shared-file path — keyed on regionKey ALONE, never on identity: two
    // different templates never share an identity, so requiring one would
    // make the comparison vacuous. Keying THIS check on (identity, regionKey)
    // — rather than regionKey alone, as it now reads — made it unreachable:
    // `carriedBlocks` excludes every contributor identity
    // (inst-cs-carry-forward-recorded-blocks), so a carried block's identity
    // can never equal a contributor's, and every `extracted` region's
    // templateName IS a contributor's. Keyed on regionKey alone, this check
    // is reachable: the target's existing provenance recording template A's
    // claim on key "k" (carried forward here) while the incoming assembly's
    // template B also claims "k" (extracted here) is exactly the
    // occupied-boundary clash `cpt-frontx-algo-cli-scaffolding-conflict-check`
    // exists to catch — reaching materialization means that check's
    // occupied-boundary derivation missed it.
    const carriedByRegionKey = new Map(carriedBlocks.map((block) => [block.regionKey, block]));
    let collidedCarried: { carriedBlock: LocatedBlock; extractedRegion: ExtractedRegion } | undefined;
    for (const region of extracted) {
      const carriedBlock = carriedByRegionKey.get(region.regionKey);
      if (carriedBlock) {
        collidedCarried = { carriedBlock, extractedRegion: region };
        break;
      }
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-carried-key-collision
    if (collidedCarried) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-carried-key-invariant
      const { carriedBlock, extractedRegion } = collidedCarried;
      return {
        ok: false,
        reason: 'carried-key-collision',
        path,
        regionKey: extractedRegion.regionKey,
        contestants: [carriedBlock.identity, extractedRegion.templateName],
        message:
          `Materialization invariant violated — path "${path}" has a carried-forward block owned by ` +
          `"${carriedBlock.identity}" and a freshly extracted region owned by "${extractedRegion.templateName}" ` +
          `both resolving region key "${extractedRegion.regionKey}"; the pre-flight conflict check's ` +
          'occupied-boundary comparison should have refused this assembly before any file was written.',
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-carried-key-invariant
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-span-overlap
    // Re-locates each extracted region's actual on-disk line-index span (not
    // carried by `ExtractedRegion` — pt.1 only needed the marker text) to
    // detect an overlap that neither manifest validation (well-formed keys
    // only) nor the pre-flight conflict check (declared keys only) can see.
    // A line-index span is only meaningful relative to the buffer it was
    // located in, so two regions are only compared when they were located in
    // the SAME on-disk buffer — trivially true for a single template's own
    // multiple keys (self-overlap), and true for two different templates only
    // when both ship byte-identical content for the shared path (the
    // canonical-shared-file convention `cpt-frontx-feature-template-manifest`
    // expects a region-union path to follow), which is what makes
    // cross-template overlap detectable at all.
    const contentByTemplate = new Map(entries.map((entry) => [entry.templateName, entry.content]));
    const spans = extracted.map((region) => {
      const content = contentByTemplate.get(region.templateName);
      const span = content ? locateRegionSpan(content, region.templateName, region.regionKey) : undefined;
      return { region, content, span };
    });
    let overlappingPair: [ExtractedRegion, ExtractedRegion] | undefined;
    for (let i = 0; i < spans.length && !overlappingPair; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i];
        const b = spans[j];
        if (!a.span || !b.span || a.content !== b.content) continue;
        if (a.span.beginIndex <= b.span.endIndex && b.span.beginIndex <= a.span.endIndex) {
          overlappingPair = [a.region, b.region];
          break;
        }
      }
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-if-span-overlap
    if (overlappingPair) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-span-overlap
      const [regionA, regionB] = overlappingPair;
      return {
        ok: false,
        reason: 'span-overlap',
        path,
        contestants: [regionA.templateName, regionB.templateName],
        regionKeys: [regionA.regionKey, regionB.regionKey],
        message:
          `Materialization conflict — path "${path}" has overlapping on-disk marker spans between ` +
          `${regionA.templateName}:${regionA.regionKey} and ${regionB.templateName}:${regionB.regionKey}; ` +
          'refusing the assembly and writing no file.',
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-span-overlap
    }

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-compose-union
    // Deterministic order — by owning identity, then region key — applied
    // uniformly across freshly extracted regions AND carried-forward blocks,
    // so re-materializing the same collision-free assembly always produces
    // byte-identical output regardless of whether a block was extracted or
    // carried forward.
    const allRegions: Array<{ templateName: string; regionKey: string; markerBlock: string }> = [
      ...extracted,
      ...carriedBlocks.map((block) => ({
        templateName: block.identity,
        regionKey: block.regionKey,
        markerBlock: block.text,
      })),
    ];
    // Compared by UTF-16 code unit (`<`/`>`), never `localeCompare` — this
    // composition is byte-for-byte deterministic by contract, and
    // `localeCompare`'s collation order for non-ASCII identities or region
    // keys varies by locale/ICU data across environments, which would make
    // the "same" collision-free assembly materialize in a different order
    // depending on where it runs (review #500 round-4 P3).
    const orderedRegions = allRegions.sort((a, b) => {
      if (a.templateName !== b.templateName) return a.templateName < b.templateName ? -1 : 1;
      return a.regionKey < b.regionKey ? -1 : 1;
    });
    const composedContent = orderedRegions.map((region) => region.markerBlock).join('\n');
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-compose-union

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-composed
    // Computed only — see inst-cs-write-materialized below for the actual write.
    materializedFiles.push({ path, content: composedContent });
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-composed
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-foreach-multi
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-materialized
  // Every target file path processed above with no refusal — write every
  // materialized file now, in one pass. A refusal reached while processing
  // any path returns before this loop runs, so the target repository
  // receives no write for a refused assembly (ADR-0032: "a refused assembly
  // writes zero files").
  for (const file of materializedFiles) {
    await writeFileFn(`${targetDir}/${file.path}`, file.content);
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-write-materialized

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-materialized
  return { ok: true, files: materializedFiles };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-compose-shared-files:p1:inst-cs-return-materialized
}
