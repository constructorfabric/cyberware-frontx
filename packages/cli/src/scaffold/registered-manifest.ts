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

// Returns a registered name's declared `excludedSubtrees`. Two distinct
// facts about a manifest this function could not turn into content are
// deliberately given DIFFERENT answers, not folded into one:
//
// - ABSENT — the inventory holds no entry for a remote-origin name, or, for
//   a local `path:` origin, nothing exists yet at its manifest path (or its
//   folder can no longer be proven to stay inside the project root, which
//   read a manifest from would hit the identical absence one step later
//   anyway) — resolves to `[]`. There is no exclusion FACT recorded
//   anywhere for this function to disagree with an empty answer about, and
//   this is the ordinary shape of a name whose local origin folder a
//   developer has since removed by hand.
// - UNREADABLE — something real stands at the local origin's manifest path
//   but is not a regular file (`deps.readFileFn`'s thrown `NotRegularFile
//   Error`: a FIFO, a directory, a dangling symlink, ...) — is a DIFFERENT
//   fact: a real declaration exists there and this function simply could
//   not read it. Returning `[]` for this case would report "nothing
//   excluded" over a manifest that may in fact exclude real ground,
//   silently WIDENING whichever caller trusts this answer to decide what it
//   is safe to remove (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own
//   `inst-dp-if-manifest-unreadable`) — the identical "refuse, don't guess"
//   discipline every other read seam in this package already gives a FIFO,
//   never a hang or a silent default. This function does not swallow that
//   failure: it lets it propagate, so the caller can convert it into its
//   own structured refusal, exactly as `commands/delete.ts`'s own catch for
//   this same error already does for the TARGET's own on-disk shape
//   (`inst-del-if-target-shape-drifted`).
//
// A manifest that IS read but fails contract validation (`readManifestFrom
// Content`'s own `{ ok: false }`) is a THIRD, pre-existing case, unchanged
// here: it still resolves to `[]` — a manifest that has drifted out of
// contract is not this function's failure to raise, and every caller
// already treats an invalid declaration as no declaration at all.
// @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-manifest-absent
// @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-manifest-unreadable
export async function resolveRegisteredExcludedSubtrees(
  name: string,
  origin: string,
  deps: ResolveRegisteredManifestDeps,
): Promise<string[]> {
  const content = await resolveRegisteredManifestContent(name, origin, deps);
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-else-manifest-absent-empty
  if (content === undefined) return [];
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-else-manifest-absent-empty
  const manifestResult = readManifestFromContent(content);
  return manifestResult.ok ? manifestResult.manifest.excludedSubtrees : [];
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

async function resolveRegisteredManifestContent(
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
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-return-manifest-unreadable
      throw error;
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-return-manifest-unreadable
    }
  }
  const installed = deps.inventory.lookup(name);
  return installed?.content;
}
// @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-manifest-unreadable
// @cpt-end:cpt-frontx-algo-cli-scaffolding-delete-plan:p1:inst-dp-if-manifest-absent
