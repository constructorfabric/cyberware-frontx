// TEMPORARY module - exists only so the assembly/composition/upgrade code
// slated for deletion under the manifest contract's cutover from the old
// five-category shape to the new four-field shape
// (`cpt-frontx-adr-template-manifest-contract`) keeps compiling during the
// migration. It is NOT part of the manifest contract - the contract
// (`cpt-frontx-contract-template-manifest`) declares exactly `name`,
// `version`, `excludedSubtrees`, `description` (see `./types.ts`) - and
// carries NO `@cpt-*` markers of its own: nothing here is validated
// behavior, only a staging area for the types the four-field contract
// retired. This module is deleted together with its consumers once that
// retiring code is removed.
import { readBundleFiles } from '../bundle/envelope';
import { MANIFEST_FILENAME } from './types';

// Closed set of exactly two legacy merge-strategy values.
export type MergeStrategy = 'exclusive' | 'region-union';

// Legacy ownership category: per shared file, the regions a template owned
// and the merge strategy applied when another template also wrote it.
export interface SharedFileEntry {
  path: string;
  mergeStrategy: string;
  ownedRegions: string[];
}

// Legacy ownership category: the ground a template owned - the exclusive
// subtrees it alone wrote and, per shared file, the regions it owned with a
// declared merge.
export interface OwnershipBoundary {
  exclusiveSubtrees: string[];
  sharedFiles: SharedFileEntry[];
}

// Legacy referenced-templates category: a template a preset applied
// together, declared by reference alone.
export interface ReferencedTemplate {
  ref: string;
}

// Mirrors `validate-contract.ts`'s own bundle-envelope unwrap. Duplicated
// rather than imported so this temporary module has no dependency on the
// current-shape read path - it reads raw manifest content on its own terms,
// exactly as a legacy reader would have before the cutover.
function unwrapBundleEnvelope(content: string): string {
  const files = readBundleFiles(content);
  if (files === undefined) return content;
  const manifestText = files[MANIFEST_FILENAME];
  return typeof manifestText === 'string' ? manifestText : content;
}

function parseLegacyContent(content: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapBundleEnvelope(content));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

// The closed set of merge-strategy values the retired manifest contract
// validator used to enforce (`inst-if-merge-strategy-invalid`, now gone
// along with the rest of that validator). Enforced HERE instead, because
// this accessor is the only place left that reads a legacy shared-file
// entry at all: a value outside the set makes the whole entry - and so the
// whole boundary, since one bad entry cannot be silently dropped without
// coercing a malformed manifest into a usable-looking empty one - unusable.
const MERGE_STRATEGIES: readonly string[] = ['exclusive', 'region-union'];

// Reads the legacy `ownershipBoundaries` category off raw manifest content
// (the same content string `readManifestFromContent` takes). Returns
// `undefined` when the category is absent OR malformed in any way that
// makes it unusable as a legacy boundary - the two are deliberately NOT
// distinguished: a manifest carrying `ownershipBoundaries: {}`, an
// `exclusiveSubtrees` that is not an array, a non-string entry inside it, a
// `sharedFiles` entry missing `path`/`mergeStrategy`, or a `mergeStrategy`
// outside the closed set below, must not silently read as "declares an
// empty boundary" - `{ exclusiveSubtrees: [], sharedFiles: [] }` is exactly
// what a template that legitimately owns nothing declares, and every
// caller's absence guard exists to catch the manifest that never declared
// this category honestly in the first place. Coercing a malformed shape
// into that same empty-looking value defeats those guards outright:
// `uniformApply` would filter every content item against an empty
// boundary, apply zero files, and still report success. Only a genuinely
// well-formed legacy boundary is returned; anything else is `undefined`,
// exactly like absence.
export function readLegacyOwnershipBoundary(content: string): OwnershipBoundary | undefined {
  const obj = parseLegacyContent(content);
  if (obj === undefined) return undefined;
  const boundaries = obj['ownershipBoundaries'];
  if (typeof boundaries !== 'object' || boundaries === null || Array.isArray(boundaries)) return undefined;
  const b = boundaries as Record<string, unknown>;

  const exclusiveSubtreesRaw = b['exclusiveSubtrees'];
  if (!Array.isArray(exclusiveSubtreesRaw)) return undefined;
  const exclusiveSubtrees: string[] = [];
  for (const entry of exclusiveSubtreesRaw) {
    if (typeof entry !== 'string') return undefined;
    exclusiveSubtrees.push(entry);
  }

  const sharedFilesRaw = b['sharedFiles'];
  if (!Array.isArray(sharedFilesRaw)) return undefined;
  const sharedFiles: SharedFileEntry[] = [];
  for (const entry of sharedFilesRaw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
    const e = entry as Record<string, unknown>;
    const path = e['path'];
    const mergeStrategy = e['mergeStrategy'];
    if (typeof path !== 'string' || typeof mergeStrategy !== 'string') return undefined;
    if (!MERGE_STRATEGIES.includes(mergeStrategy)) return undefined;

    const ownedRegionsRaw = e['ownedRegions'];
    let ownedRegions: string[];
    if (ownedRegionsRaw === undefined) {
      // Absent is tolerated (an `exclusive` entry never needed one); PRESENT
      // but malformed is not - the same "absent vs. malformed" distinction
      // this whole accessor draws at every level.
      ownedRegions = [];
    } else if (!Array.isArray(ownedRegionsRaw)) {
      return undefined;
    } else {
      ownedRegions = [];
      for (const region of ownedRegionsRaw) {
        if (typeof region !== 'string') return undefined;
        ownedRegions.push(region);
      }
    }

    sharedFiles.push({ path, mergeStrategy, ownedRegions });
  }

  return { exclusiveSubtrees, sharedFiles };
}

// Reads the legacy `referencedTemplates` category off raw manifest content,
// or `[]` when absent, unparseable, or not an array.
export function readLegacyReferencedTemplates(content: string): ReferencedTemplate[] | undefined {
  const obj = parseLegacyContent(content);
  if (obj === undefined) return undefined;
  const referenced = obj['referencedTemplates'];
  // Absent is the ordinary case for a template that composes with nothing,
  // and an empty list is what its consumer reads as "this is a leaf". A
  // MALFORMED declaration must not read as either: the same absent-vs-
  // malformed line `readLegacyOwnershipBoundary` draws, for the same
  // reason - a preset whose reference list silently came back empty would
  // apply its root template alone and report success.
  if (referenced === undefined) return [];
  if (!Array.isArray(referenced)) return undefined;

  const result: ReferencedTemplate[] = [];
  for (const entry of referenced) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
    const ref = (entry as Record<string, unknown>)['ref'];
    if (typeof ref !== 'string' || ref.trim() === '') return undefined;
    result.push({ ref });
  }
  return result;
}
