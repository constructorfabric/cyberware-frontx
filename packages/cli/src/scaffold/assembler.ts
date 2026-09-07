// @cpt-FEATURE:cpt-frontx-feature-cli-scaffolding:p1
// @cpt-algo:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1
//
// REWRITE (checkpoint 3): the prior `uniformApply` resolved a `templateRef[]`
// through a preset/composition tree and read content items filtered by the
// legacy `exclusiveSubtrees`/`sharedFiles` ownership shape
// (`manifest/legacy-ownership.ts`). The CURRENT algorithm this file
// implements is structurally different: it stages an explicit, target-keyed
// batch `{"templates": {"<registeredName>": ["<target>", ...]}}` against
// names ALREADY REGISTERED in the project state store
// (`project-state/types.ts`'s `ProjectStateDocument`), auto-installs a
// name's registered origin when not yet locally available, and computes
// each target's EFFECTIVE OWNERSHIP via the six-term subtraction
// (`./effective-ownership.ts`) — never a preset tree, never
// `referencedTemplates`, never a content read (that is existing-content
// reconciliation's job, `./existing-content.ts`, a later pipeline step this
// algorithm's own Output feeds but does not itself run).
import path from 'node:path';
import { computeExclusionRoots } from './effective-ownership';
import type { CanonicalizeTargetFn } from './conflict-check';
import type { InventoryEntry, InventoryResult } from '../inventory/types';
import { readManifestFromContent } from '../manifest/validate-contract';
import type { ReadFileFn } from '../manifest/types';
import type { ProjectStateDocument } from '../project-state/types';
import { resolveToInventory } from '../resolver/resolve';
import { parseLocalOrigin } from '../resolver/types';
import type { FetchFn, ListFolderFilesFn, PathExistsFn } from '../resolver/types';
import type { ErrorCode } from '../envelope';
import type { ContributionEntry, StagedAssembly } from './types';

// An explicit batch naming, for each registered template, the target or
// targets to apply it to — the exact JSON shape
// `cpt-frontx-algo-cli-scaffolding-uniform-apply`'s own Input line names.
export interface UniformApplyBatch {
  templates: Record<string, string[]>;
}

// Narrow port over `TemplateInventory` — the SAME two methods
// `commands/register.ts`'s `RegisterInventoryPort` injects, reused here
// rather than re-derived so this algorithm's "is this name's content already
// available" check and its auto-install both go through the one shared
// resolver pattern (`inventory/TemplateInventory.ts`'s `install`/`lookup`)
// register already established, per this checkpoint's own instruction not to
// invent a second one.
export interface UniformApplyInventoryPort {
  lookup(name: string): InventoryEntry | undefined;
  install(spec: string, fetchFn: FetchFn): Promise<InventoryResult<{ name: string; ref: string }>>;
}

// Resolves a name already INSTALLED in the local inventory (`lookup`
// returned an entry) to the project-relative directory its real on-disk
// content lives under. Pure path arithmetic behind an injected seam — the
// same discipline every other scaffold/manifest module holds to (no direct
// filesystem access in core logic); the real implementation is
// `resolveInstalledContentPath` (`adapters/fs-installed-content-path.ts`),
// which this pure layer cannot import directly (that module lives in the
// adapters layer; core logic depends on adapters only through an injected
// seam, never the reverse).
export type ResolveInstalledContentPathFn = (name: string) => string;

export type UniformApplyResult =
  | { ok: true; assembly: StagedAssembly }
  | { ok: false; code: Extract<ErrorCode, 'TEMPLATE_NOT_REGISTERED'>; name: string; message: string }
  | { ok: false; code: Extract<ErrorCode, 'ORIGIN_UNAVAILABLE'>; name: string; origin: string; message: string };

export interface UniformApplyDeps {
  repoRoot: string;
  inventory: UniformApplyInventoryPort;
  fetchFn: FetchFn;
  // A local `path:` origin is resolved through the shared resolver
  // (`cpt-frontx-algo-template-resolution-resolve-to-inventory`), never
  // through the inventory — a local origin was never installed there at
  // register time either. `readFileFn` and `existsFn`/`listFolderFilesFn`
  // below are the resolver's own local-origin seams
  // (`resolver/types.ts`'s `LocalOriginDeps`), reused here under this
  // package's existing names rather than renamed.
  readFileFn: ReadFileFn;
  // Validates a local `path:` origin's relative path stays inside the
  // project root — the SAME `CanonicalizeTargetFn` the pre-flight conflict
  // check canonicalizes batch TARGETS with (`conflict-check.ts`), reused
  // here for the structurally identical operation register.ts already
  // reuses it for (its own `canonicalizeFn` parameter).
  canonicalizeFn: CanonicalizeTargetFn;
  // Confirms a local `path:` origin's folder actually exists — the
  // resolver's own existence check (`resolver/types.ts`'s `PathExistsFn`),
  // which containment alone cannot answer.
  existsFn: PathExistsFn;
  // Enumerates a local `path:` origin folder's own regular files, for the
  // resolver to acquire as its content.
  listFolderFilesFn: ListFolderFilesFn;
  resolveInstalledContentPathFn: ResolveInstalledContentPathFn;
}

// Every registered template's local `path:` origin folder EXCEPT `ownName`'s
// own, project-relative and canonicalized the same way
// `resolveRegisteredTemplate` canonicalizes the one it returns as
// `localOriginFolder`.
//
// This is NOT a seventh term of the shared six-term subtraction — the
// FEATURE's own `inst-ua-compute-ownership`/`inst-dp-compute-ownership` text
// names exactly six, and the sixth is the template's OWN origin folder.
// Another template's origin folder is the caller's additional subtraction,
// exactly as `scaffold/delete-plan.ts`'s `inst-dp-find-other-origins` makes
// it delete's own (surfaced there in `toPreserve`; appended here to the
// staged entry's `exclusionRoots`, the one list both existing-content
// reconciliation and materialization already filter by, so one append fixes
// both).
//
// Without it, `conflict-check.ts`'s own `inst-cc-permit-reverse` promise —
// that a local origin folder landing inside a target under check "is a
// permitted subtraction from that target's effective ownership, not a
// conflict" — was true of the CONFLICT CHECK but false of the pipeline that
// runs after it: another template's origin folder stayed inside the applying
// target's effective ownership, so existing-content reconciliation reported
// its real files as `additionalPaths` (demanding `--adopt-existing` over
// ground the checker itself calls reserved — confirmed live), and any payload
// path colliding with that folder would have been written into it.
function collectOtherLocalOriginFolders(
  document: ProjectStateDocument,
  ownName: string,
  canonicalizeFn: CanonicalizeTargetFn,
): string[] {
  const folders: string[] = [];
  for (const [name, entry] of Object.entries(document.templates)) {
    if (name === ownName) continue;
    const relativePath = parseLocalOrigin(entry.origin);
    if (relativePath === undefined) continue;
    const canonical = canonicalizeFn(relativePath);
    // A folder that can no longer be proven to stay inside the project root
    // is simply omitted rather than refusing the whole batch: it was proven
    // at register time, so a failure here means that ground has since been
    // removed or now escapes via a changed symlink — there is nothing real
    // left to subtract. `deriveLocalOriginFolder` (`./delete-plan.ts`) omits
    // it for the identical reason.
    if (canonical !== null) folders.push(canonical);
  }
  return folders;
}

interface ResolvedTemplate {
  manifestContent: string;
  // ALWAYS an absolute filesystem path (`ContributionEntry.installedContentPath`'s
  // own doc comment states the one rule this field answers to). The inventory
  // branch below gets that for free — `resolveInstalledContentPathFn` joins
  // against the inventory root, itself always absolute
  // (`adapters/github-fetch.ts`'s `resolveInventoryRoot`) — so the local
  // `path:` branch joins its own canonical, project-relative folder against
  // `deps.repoRoot` to match, rather than leaving the two branches to hand
  // callers two different kinds of string under one field name.
  installedContentPath: string;
  // Present only when this name's origin is a local `path:` origin whose
  // resolved directory sits inside the project — the six-term subtraction's
  // "local origin folder" term (`effective-ownership.ts`'s
  // `EffectiveOwnershipTerms.localOriginFolder`). Deliberately PROJECT-RELATIVE,
  // unlike `installedContentPath` above: every consumer of this field
  // (`collectOtherLocalOriginFolders`, `computeExclusionRoots`) compares it
  // against project-relative targets, never reads a file through it.
  localOriginFolder?: string;
}

// Resolves one registered name's origin to its manifest content and
// installed content path — auto-installing through the shared resolver when
// not yet locally available, or reading a local `path:` origin's manifest
// directly when the origin is local (never through the inventory, exactly
// as `commands/register.ts`'s own `resolveOrigin` never routes a local
// origin through the inventory either).
async function resolveRegisteredTemplate(
  name: string,
  origin: string,
  deps: UniformApplyDeps,
): Promise<{ ok: true; value: ResolvedTemplate } | { ok: false; message: string }> {
  const relativePath = parseLocalOrigin(origin);
  if (relativePath !== undefined) {
    // Re-resolved here rather than trusted from an earlier `register` call,
    // since apply "never trusts a prior run" (FEATURE §5, "One Uniform
    // Batch Path") and the directory a `path:` origin names is free to be
    // renamed or removed between register and apply. The shared resolver
    // (`cpt-frontx-algo-template-resolution-resolve-to-inventory`) performs
    // the identical containment/existence/root check register's own
    // resolution already applies — including refusing the project root
    // itself, the sixth subtraction term this template's own origin folder
    // would otherwise become.
    const resolved = await resolveToInventory(
      { kind: 'local', origin },
      {
        fetchFn: deps.fetchFn,
        local: {
          repoRoot: deps.repoRoot,
          canonicalizeFn: deps.canonicalizeFn,
          existsFn: deps.existsFn,
          listFolderFilesFn: deps.listFolderFilesFn,
          readFolderFileFn: deps.readFileFn,
        },
      },
    );
    if (!resolved.ok) {
      return { ok: false, message: `Local origin "${origin}" for template "${name}" could not be resolved: ${resolved.error.message}` };
    }
    // `installedContentPath`/`localOriginFolder` are NOT something the
    // resolver computes — for a local origin they are simply the canonical
    // folder, derived here at the call site (the resolver's own return
    // value carries no path, only identity/content/ref/source).
    const canonical = deps.canonicalizeFn(relativePath);
    if (canonical === null) {
      // Unreachable in practice: `resolved.ok` above already proves this
      // exact call just succeeded against this exact origin. Guarded rather
      // than asserted so a caller-supplied fake `canonicalizeFn` that
      // disagrees between calls cannot turn this into a thrown TypeError.
      return { ok: false, message: `Local origin "${origin}" for template "${name}" could not be proven to stay inside the project root.` };
    }
    return {
      ok: true,
      value: {
        manifestContent: resolved.value.content,
        // `canonical` is project-relative, the right shape for
        // `localOriginFolder` below but not for `installedContentPath`: that
        // field is the ONE base every reader of a staged entry's template
        // content and AI bundle resolves paths against, and readers differ in
        // what they do when handed something relative. `createFsReadInstalledContentFn`
        // (`adapters/fs-existing-content.ts`) joins it against a repo root it
        // is separately given, so a relative value only ever works there by
        // coincidence, when that repo root happens to match this call's own
        // `deps.repoRoot`. The AI-bundle seams (`scaffold/ai-bundle.ts`'s
        // `bundleExists`/`copyBundle`, realized in `adapters/fs-ai-bundle.ts`)
        // take no repo root at all — they join whatever they are given
        // straight onto `.frontx/ai/<name>/` — so a relative value there
        // resolves against the CLI process's own working directory instead,
        // which is only ever correct when that directory happens to be the
        // project root. Absolute removes the coincidence: joining against
        // `deps.repoRoot` here, the one place this field is produced for a
        // local origin, gives every downstream reader an unambiguous base
        // with nothing left for it to assume, matching the inventory branch
        // below (`resolveInstalledContentPathFn` already returns an absolute
        // path there) and the identical join `cli.ts`'s own upgrade-refresh
        // wiring (`refreshAiBundle`) already performs for a local origin.
        installedContentPath: path.join(deps.repoRoot, canonical),
        localOriginFolder: canonical,
      },
    };
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-not-installed
  const existing = deps.inventory.lookup(name);
  if (existing !== undefined) {
    return {
      ok: true,
      value: {
        manifestContent: existing.content,
        installedContentPath: deps.resolveInstalledContentPathFn(existing.name),
      },
    };
  }

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-auto-install
  const installResult = await deps.inventory.install(origin, deps.fetchFn);
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-auto-install

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-install-fail
  if (!installResult.ok) {
    return { ok: false, message: installResult.error.message };
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-install-fail
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-not-installed

  const installed = deps.inventory.lookup(installResult.value.name);
  if (installed === undefined) {
    return {
      ok: false,
      message: `Template "${name}" was installed but could not be read back from the local inventory.`,
    };
  }
  return {
    ok: true,
    value: {
      manifestContent: installed.content,
      installedContentPath: deps.resolveInstalledContentPathFn(installed.name),
    },
  };
}

// @cpt-dod:cpt-frontx-dod-cli-scaffolding-uniform-apply:p1
/**
 * `cpt-frontx-algo-cli-scaffolding-uniform-apply` — the ONE batch-resolution
 * path `assemble`, `apply`, and `seed` (via `apply`) all invoke. Stages an
 * explicit batch against names already registered in the project state
 * store: unresolvable names and origins refuse the WHOLE batch before
 * anything is staged (`TEMPLATE_NOT_REGISTERED`, `ORIGIN_UNAVAILABLE`); a
 * resolved name's declared `excludedSubtrees` and each of its batch targets'
 * effective ownership (the six-term subtraction, `./effective-ownership.ts`)
 * are staged into one assembly, ready for the pre-flight conflict check
 * (`./conflict-check.ts`'s `checkTargetConflicts`) to evaluate — this
 * function does not itself call it (FEATURE §3, Output).
 */
export async function uniformApply(
  batch: UniformApplyBatch,
  document: ProjectStateDocument,
  deps: UniformApplyDeps,
): Promise<UniformApplyResult> {
  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-receive
  // Both the batch and the current project state document are received as
  // this function's own parameters.
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-receive

  const entries: ContributionEntry[] = [];

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-foreach-name
  for (const [name, targets] of Object.entries(batch.templates)) {
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-not-registered
    const registered = document.templates[name];
    if (registered === undefined) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-not-registered
      return {
        ok: false,
        code: 'TEMPLATE_NOT_REGISTERED',
        name,
        message: `Apply aborted — template "${name}" has no entry in the project state store. Register it first.`,
      };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-not-registered
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-not-registered

    // A registered name with no target in this batch has nothing to
    // resolve, install, or stage — the FEATURE's own steps operate "for each
    // of that name's batch targets", so a name contributing zero targets
    // (a degenerate but not malformed batch entry) triggers no install
    // attempt and no ownership computation, only the registration check
    // just above.
    if (targets.length === 0) continue;

    const resolved = await resolveRegisteredTemplate(name, registered.origin, deps);
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-install-fail
    if (!resolved.ok) {
      // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-unavailable
      return { ok: false, code: 'ORIGIN_UNAVAILABLE', name, origin: registered.origin, message: resolved.message };
      // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-unavailable
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-if-install-fail

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-read-manifest
    const manifestResult = readManifestFromContent(resolved.value.manifestContent);
    if (!manifestResult.ok) {
      // The algorithm's own closed failure vocabulary names only
      // `TEMPLATE_NOT_REGISTERED`/`ORIGIN_UNAVAILABLE` — an unreadable
      // resolved manifest is folded into the latter: the origin's content,
      // once resolved, turned out not to be usable, which is the same
      // practical outcome as the origin never having resolved at all. Rare
      // in practice — `register` already validated the identical four-field
      // contract before this name could ever be registered — but "apply
      // never trusts a prior run" means this re-validates rather than
      // assuming the content on disk still matches what register once saw.
      return {
        ok: false,
        code: 'ORIGIN_UNAVAILABLE',
        name,
        origin: registered.origin,
        message: `Template "${name}"'s resolved content could not be read as a valid manifest: ${manifestResult.message}`,
      };
    }
    const excludedSubtrees = manifestResult.manifest.excludedSubtrees;
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-read-manifest

    // inst-ua-compute-ownership is implemented and marked in
    // `./effective-ownership.ts` (`computeExclusionRoots`) — called here,
    // once per batch target, rather than re-marked or reformulated.
    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-subtract-other-origins
    // Every OTHER registered template's local origin folder — reserved
    // ground this template's apply must subtract rather than claim, see
    // `collectOtherLocalOriginFolders`'s own comment for why it is appended
    // here rather than made a seventh term of the shared formula. Appended
    // unfiltered: `isWithinEffectiveOwnership` answers false on its own for
    // any root that does not actually sit beneath the target, exactly as
    // `effective-ownership.ts`'s header states for every other
    // already-project-relative term.
    const otherLocalOriginFolders = collectOtherLocalOriginFolders(document, name, deps.canonicalizeFn);
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-subtract-other-origins

    // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-stage-entry
    for (const target of targets) {
      const exclusionRoots = [
        ...computeExclusionRoots({
          target,
          excludedSubtrees,
          projectOwnedRoots: document.projectOwnedRoots,
          localOriginFolder: resolved.value.localOriginFolder,
        }),
        ...otherLocalOriginFolders,
      ];
      entries.push({
        templateName: name,
        target,
        installedContentPath: resolved.value.installedContentPath,
        excludedSubtrees,
        exclusionRoots,
      });
    }
    // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-stage-entry
  }
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-foreach-name

  // @cpt-begin:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-staged
  return { ok: true, assembly: { entries } };
  // @cpt-end:cpt-frontx-algo-cli-scaffolding-uniform-apply:p1:inst-ua-return-staged
}
