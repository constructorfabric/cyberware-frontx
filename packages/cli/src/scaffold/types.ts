import type { InventoryEntry } from '../inventory/types';

// Injected write function — caller supplies; no direct filesystem access in core logic.
export type WriteFileFn = (destPath: string, content: string) => Promise<void>;

// Injected containment guard — proves an absolute path stays inside a
// project root the caller already resolved, symlinks resolved, throwing
// when it does not (the real implementation, `assertPathWithinProjectRoot`
// in `../adapters/fs-project-io.ts`, is a plain throwing function rather
// than a `Promise`-returning one: every call site here is a synchronous,
// read-only filesystem check before an async write, not itself an I/O
// operation worth awaiting).
//
// Injected — never imported directly by `commands/apply.ts`/`commands/
// delete.ts` — because `WriteFileFn`/`RemoveProjectFileFn` are shared,
// `CliDeps`-injected values whose applicable root varies per command
// (`apply`'s `process.cwd()` vs. `seed <dir>`'s own directory argument),
// and because a directly-imported real-fs check would run unconditionally
// even against this package's own in-memory, no-real-filesystem dispatch
// fixtures (`__tests__/entry-flows.test.ts`, `__tests__/cli.test.ts`),
// which model a project root (`/repo`, `/tmp/fresh-repo`, ...) that does
// not exist on the real filesystem at all.
export type AssertPathWithinRootFn = (absolutePath: string) => void;

// Injected reader for a file already on disk at a target repository path —
// `null` when absent. Symmetric to upgrade's `ReadProjectFileFn`
// (`../upgrade/types.ts`), redeclared here (rather than imported) so
// scaffold does not take a cross-feature dependency on upgrade for a shape
// this simple; both seams share the SAME real implementation
// (`createFsReadProjectFileFn`, `../adapters/fs-project-io.ts`). Needed by
// `composeSharedFiles` (cpt-frontx-algo-cli-scaffolding-compose-shared-files
// inst-cs-read-existing-blocks) to read a `region-union` shared file already
// on disk before composing over it.
export type ReadProjectFileFn = (absolutePath: string) => Promise<string | null>;

// Injected conflict check — returns true when the target directory has conflicting content.
// Used by the composed-provenance (F13) scaffolder; unrelated to the kindless
// assembly-op's boundary-intersection conflict verdict (cpt-frontx-state-cli-scaffolding-assembly-op).
export type ConflictCheckFn = (targetDir: string) => Promise<boolean>;

// A single content item — a path within the template and the content to write
// at that destination. Read directly from a template's resolved on-disk
// installed content path — never carried by the manifest
// (cpt-frontx-algo-cli-scaffolding-uniform-apply inst-ua-read-content).
export interface ContentItem {
  path: string;    // relative path within the template
  content: string; // file content to write at destination
}

// Injected content reader — reads a resolved template's content items
// directly from its installed content path (never from the manifest).
// No filesystem access in core logic; the caller supplies the real
// implementation once the installed content path is materialized to disk.
export type ReadContentItemsFn = (entry: InventoryEntry) => Promise<ContentItem[]>;

// One (template, target) claim staged by the rewritten uniform-apply path
// (`cpt-frontx-algo-cli-scaffolding-uniform-apply`'s own `inst-ua-stage-entry`)
// — one entry PER BATCH TARGET, not one per template, since effective
// ownership (`exclusionRoots`) is computed per target, not per template. The
// legacy shape this replaced staged one entry per TEMPLATE, carrying content
// items filtered through a manifest-declared `OwnershipBoundary`
// (`exclusiveSubtrees`/`sharedFiles`) that no longer exists in the current
// manifest contract (`manifest/types.ts`'s four-field `TemplateManifest`) —
// composition is now driven by the caller's own batch, and a target is owned
// wholly by one template, so there is no boundary category left to carry
// here, and no content read happens in this algorithm at all (that is
// existing-content reconciliation's job, `scaffold/existing-content.ts`).
//
// Deliberately a superset of `conflict-check.ts`'s `TargetClaim`
// (`{templateName, target, excludedSubtrees}`): a caller building
// `TargetClaim[]` for `checkTargetConflicts` needs no translation beyond
// picking those three fields off each entry — the explicit handoff contract
// `cpt-frontx-algo-cli-scaffolding-uniform-apply`'s own Output line names
// ("ready for the conflict check to evaluate").
export interface ContributionEntry {
  templateName: string;
  target: string;
  // The template's installed content path — ALWAYS an absolute filesystem
  // path, one rule regardless of origin kind: the local inventory's own
  // installed content path for a remote origin
  // (`inventory/TemplateInventory.ts`'s `install`/`lookup`, joined against the
  // always-absolute inventory root), or a local `path:` origin's canonical
  // folder joined against the applicable project root
  // (`scaffold/assembler.ts`'s `resolveRegisteredTemplate`, the one place
  // this field is produced). Read by later pipeline steps (existing-content
  // reconciliation, materialization, the AI-bundle seams) — this algorithm
  // reads no content itself, but every reader downstream is entitled to use
  // this value directly, with no repo root of its own to join it against.
  installedContentPath: string;
  excludedSubtrees: string[];
  // The six-term subtraction's own output for this (template, target) pair —
  // `effective-ownership.ts`'s `computeExclusionRoots`, called once per
  // target rather than reformulated here (that module's own header: "never
  // computed a second, independently-formulated way"). Carried forward so
  // existing-content reconciliation (`scaffold/existing-content.ts`'s own
  // `ExistingContentReconciliationInput.exclusionRoots`) and materialization
  // never have to recompute it.
  exclusionRoots: string[];
}

// The staged assembly produced by the rewritten uniform-apply path — one
// entry per batch target, ready for the pre-flight conflict check to
// evaluate before any file is written.
export interface StagedAssembly {
  entries: ContributionEntry[];
}
