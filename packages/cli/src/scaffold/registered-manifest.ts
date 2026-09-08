// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
//
// Resolves an ALREADY-REGISTERED template name's CURRENT manifest content —
// correctly for BOTH a remote/inventory-installed origin (via
// `TemplateInventory.lookup`) and a local `path:` origin (read directly from
// disk, mirroring `commands/register.ts`'s own `resolveOrigin` local-origin
// branch exactly: a local origin is never installed into the inventory at
// register time either, so `inventory.lookup` alone can never find it).
//
// Before this module existed, three independent sites each re-derived an
// already-registered name's declared `excludedSubtrees` via
// `inventory.lookup(name)` ALONE — `commands/apply.ts`'s
// `buildRecordedTargetClaims`, `commands/ownership.ts`'s
// `buildRecordedTargets`, and `scaffold/delete-plan.ts`'s own inline lookup.
// All three silently defaulted to `[]` for a `path:`-registered template,
// defeating the nested-target permission check `inst-cc-if-excluded-nest`
// grants for exactly that template. Confirmed live: applying a second
// template into a target a first, locally-registered template's
// `excludedSubtrees` explicitly permitted was wrongly refused as
// `TARGET_CONFLICT`. This function is the ONE shared re-derivation every one
// of those three sites now calls instead — the same "no second/third/fourth
// formulation" discipline `effective-ownership.ts`'s own header states for
// the six-term subtraction.
import path from 'node:path';
import { readManifestFromContent } from '../manifest/validate-contract';
import { MANIFEST_FILENAME } from '../manifest/types';
import type { ReadFileFn } from '../manifest/types';
import type { CanonicalizeTargetFn } from './conflict-check';
import type { InventoryEntry } from '../inventory/types';
import { parseLocalOrigin } from '../resolver/types';

// Narrow port over `TemplateInventory` — only `lookup` is needed here, the
// same one-method shape every prior call site already injected.
export interface RegisteredManifestInventoryPort {
  lookup(name: string): InventoryEntry | undefined;
}

export interface ResolveRegisteredManifestDeps {
  repoRoot: string;
  inventory: RegisteredManifestInventoryPort;
  readFileFn: ReadFileFn;
  canonicalizeFn: CanonicalizeTargetFn;
}

// This function's ONE caller-facing decision: whether a registered name's
// declared `excludedSubtrees` could be established at all (`known: true`,
// carrying the array — possibly empty, either because the manifest
// genuinely declares no exclusions or because it is genuinely ABSENT, see
// below) or could not (`known: false`, carrying whatever this function's
// own read attempt threw).
//
// This function does NOT throw for an unreadable manifest — a caller who
// treats an unrelated template's broken origin as this template's own
// problem is exactly the regression this shape exists to close (confirmed
// live: `chmod 000` on one `path:`-registered template's manifest blocked
// `apply`/`assemble` for a COMPLETELY DIFFERENT, unrelated template,
// `cpt-frontx-cli-nfr-template-scale`'s per-template independence). Every
// caller of THIS function resolves some OTHER registered template than the
// one it is acting on — `commands/apply.ts`'s `buildRecordedTargetClaims`,
// `commands/ownership.ts`'s `buildRecordedTargets`, and `cli.ts`'s upgrade
// wiring (`resolveRegisteredExclusions`) — and each joins `known: false` to
// `[]`: dropping a template's declared exclusions can only make ITS OWN
// claim WIDER, which can only ADMIT more conflicts, never silently permit
// one, and an unrelated template's broken origin must never block the one
// actually being checked.
//
// `scaffold/delete-plan.ts` — the one caller that needs the OWNING
// template's OWN declared exclusions to decide what is safe to delete —
// does NOT call this function for that join at all: it resolves the CURRENT
// manifest directly (via `resolveRegisteredManifestContent` below), falling
// back to a RECORDED declaration (`project-state/types.ts`'s `TemplateEntry.
// excludedSubtrees`) only when the current manifest cannot supply one, and
// refuses rather than folding an inconclusive answer to `[]` when NEITHER
// source can — see its own `inst-dp-else-if-recorded-exclusions`/
// `inst-dp-else-refuse-unestablished`.
export type RegisteredExclusionsResolution = { known: true; excludedSubtrees: string[] } | { known: false; cause: unknown };

// Resolves a registered name's declared `excludedSubtrees`. Two distinct
// facts about a manifest this function could not turn into content are
// deliberately given DIFFERENT answers, not folded into one:
//
// - ABSENT — the inventory holds no entry for a remote-origin name, or, for
//   a local `path:` origin, nothing exists yet at its manifest path (or its
//   folder can no longer be proven to stay inside the project root, which
//   read a manifest from would hit the identical absence one step later
//   anyway) — resolves to `{ known: true, excludedSubtrees: [] }`. There is
//   no exclusion FACT recorded anywhere for this function to disagree with
//   an empty answer about, and this is the ordinary shape of a name whose
//   local origin folder a developer has since removed by hand.
// - UNREADABLE — something real stands at the local origin's manifest path
//   but is not a regular file (`deps.readFileFn`'s thrown `NotRegularFile
//   Error`: a FIFO, a directory, a dangling symlink, ...) — is a DIFFERENT
//   fact: a real declaration exists there and this function simply could
//   not read it. Resolving to `{ known: true, excludedSubtrees: [] }` for
//   this case would report "nothing excluded" over a manifest that may in
//   fact exclude real ground — this function neither swallows that failure
//   into an empty answer NOR throws it itself; it hands the failure back as
//   `{ known: false, cause }` so each caller can decide, for ITSELF, whether
//   an unresolved declaration is safe to treat as empty, which every actual
//   caller of this function currently does (see this type's own doc comment
//   for why: each resolves some OTHER template than the one it acts on).
//
// A manifest that IS read but fails contract validation (`readManifestFrom
// Content`'s own `{ ok: false }`) is a THIRD, pre-existing case, unchanged
// here: it still resolves to `{ known: true, excludedSubtrees: [] }` — a
// manifest that has drifted out of contract is not this function's failure
// to raise, and every caller already treats an invalid declaration as no
// declaration at all.
//
// No FEATURE instruction markers on the branches below: `scaffold/
// delete-plan.ts` — the one caller whose FEATURE (`cpt-frontx-algo-
// cli-scaffolding-delete-plan`) once specified this "absent versus
// unreadable" distinction — no longer resolves the OWNING template's own
// exclusions through this function at all (its own `inst-dp-else-resolve-
// manifest` fallback calls `resolveRegisteredManifestContent` below
// directly, since it must refuse rather than fold absence into `[]`). This
// function's remaining callers (`commands/apply.ts`, `commands/
// ownership.ts`, `cli.ts`'s upgrade wiring) all resolve an OTHER template's
// exclusions, a plain implementation join none of their own FEATUREs
// specify at this granularity.
export async function resolveRegisteredExcludedSubtrees(
  name: string,
  origin: string,
  deps: ResolveRegisteredManifestDeps,
): Promise<RegisteredExclusionsResolution> {
  let content: string | undefined;
  try {
    content = await resolveRegisteredManifestContent(name, origin, deps);
  } catch (cause) {
    return { known: false, cause };
  }
  if (content === undefined) return { known: true, excludedSubtrees: [] };
  const manifestResult = readManifestFromContent(content);
  return { known: true, excludedSubtrees: manifestResult.ok ? manifestResult.manifest.excludedSubtrees : [] };
}

// `error.code === 'ENOENT'` is the one shape every read seam in this package
// throws for a path that is genuinely absent (`adapters/fs-project-io.ts`'s
// own `enoentError`, which every real `ReadFileFn` implementation throws
// verbatim) — checked structurally here rather than imported, since this
// module stays one layer below `adapters/` and the `ReadFileFn` contract
// itself (`manifest/types.ts`) documents only the behaviour ("throws...
// when absent"), never a concrete error class this layer is entitled to
// depend on. Anything else thrown — `NotRegularFileError` most concretely,
// but genuinely any other failure this function was not written to expect
// — is NOT this shape, and is left to propagate rather than being
// classified here as "absent" too.
function isAbsentError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

// Exported for `scaffold/delete-plan.ts`'s own use alone: that algorithm
// calls this directly, as its PRIMARY source for the owning template's
// current declaration (falling back to the RECORDED value —
// `project-state/types.ts`'s `TemplateEntry.excludedSubtrees` — only when
// this call cannot supply one), rather than through
// `resolveRegisteredExcludedSubtrees` above's own `known`/`[]` join. The
// distinction that matters to delete-plan: a genuinely-declared-empty
// manifest (`content` present, `excludedSubtrees: []` by choice) must be
// told apart from a genuinely ABSENT one (`content === undefined`) or an
// unreadable one (a thrown error) — `resolveRegisteredExcludedSubtrees`
// above deliberately does NOT expose that distinction, since every OTHER
// caller treats all three identically (`[]` either way is the safe,
// widen-never direction for them). Delete's own resolution cannot fold an
// inconclusive answer to `[]`: when this call cannot supply a declaration
// AND no RECORDED value is present either, delete-plan refuses rather than
// silently computing `toDelete` as if nothing were ever excluded
// (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own
// `inst-dp-else-refuse-unestablished`). This is the SAME primitive
// `resolveRegisteredExcludedSubtrees` itself calls, not a second
// formulation of it — one read, two callers each making their own decision
// about what an inconclusive answer means for them.
export async function resolveRegisteredManifestContent(
  name: string,
  origin: string,
  deps: ResolveRegisteredManifestDeps,
): Promise<string | undefined> {
  const relativePath = parseLocalOrigin(origin);
  if (relativePath !== undefined) {
    const canonical = deps.canonicalizeFn(relativePath);
    if (canonical === null) return undefined;
    try {
      return await deps.readFileFn(path.join(deps.repoRoot, canonical, MANIFEST_FILENAME));
    } catch (error) {
      if (isAbsentError(error)) return undefined;
      throw error;
    }
  }
  const installed = deps.inventory.lookup(name);
  return installed?.content;
}
