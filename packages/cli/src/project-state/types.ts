// @cpt-FEATURE:cpt-frontx-feature-composed-provenance:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-contract-ownership:p1
// @cpt-dod:cpt-frontx-dod-composed-provenance-atomic-project-state:p1
//
// The project state document's concrete shape —
// `cpt-frontx-contract-project-provenance` — and the injected I/O seams its
// atomic read/write algorithm (`cpt-frontx-algo-composed-provenance-project-
// state-io`) depends on. This feature is the OWNER of this schema
// (`cpt-frontx-dod-composed-provenance-contract-ownership`); every other
// feature that reads or writes `.frontx/project.json` cites these types
// rather than declaring its own.
//
// Deliberately a NEW directory, not `src/provenance/` — that directory holds
// the OLD per-template `.frontx/provenance.json` model (a SET of records,
// one per applied template, `provenance/types.ts`'s `ProvenanceRecord`),
// slated for deletion once callers migrate to this single-document model.
// The two are unrelated shapes that happen to share a similar name; keeping
// them in separate directories keeps that migration from confusing the two.

/** One generation a name's most recent upgrade or restore moved it away
 * from — absent until the name's first upgrade, never a longer history.
 * Written and rotated only by `cpt-frontx-feature-upgrade-changeset`'s
 * commit; cleared only by this feature's own `register --replace`
 * (`inst-cpreg-write-replace`), which starts a new lineage for the name.
 * This feature declares the field as part of the schema it owns and does
 * not itself read it (FEATURE §1.1). */
export interface PreviousOrigin {
  origin: string;
  version: string;
}

export interface TemplateEntry {
  origin: string;
  version: string;
  targets: string[];
  previous?: PreviousOrigin;
  /** The name's declared `excludedSubtrees`, recorded at register/upgrade
   * time so `scaffold/delete-plan.ts` never depends on the origin still
   * being resolvable to compute what is safe to delete — a vendored `path:`
   * origin folder is transient by design (`QUICK_START` §4 vendors it into
   * the project, and a developer may remove it once applied). OPTIONAL so
   * an existing document written before this field existed still parses;
   * an entry without it falls back to resolving the manifest live
   * (`cpt-frontx-algo-cli-scaffolding-delete-plan`'s own
   * `inst-dp-else-resolve-manifest`). Written by every path that creates or
   * replaces an entry (`commands/register.ts`), carried forward unchanged by
   * every path that only extends `targets[]` (`commands/apply.ts`'s own
   * spread of the existing entry), and re-recorded from the NEW payload's
   * own declaration by `upgrade/commit.ts` — an upgrade can narrow or widen
   * what a name excludes, and the recorded value must track whichever
   * origin is now actually registered. */
  excludedSubtrees?: string[];
}

export interface ProjectStateDocument {
  formatVersion: 1;
  templates: Record<string, TemplateEntry>;
  projectOwnedRoots: string[];
}

// Injected dependency types — no direct filesystem access in core logic,
// mirroring `upgrade/types.ts`'s `ReadProjectFileFn`/`WriteProjectFileFn`
// convention exactly: absence is signaled by `null`, never a throw, and the
// caller supplies the already-resolved absolute path rather than the
// function computing it itself.
export type ReadProjectStateFn = (absolutePath: string) => Promise<string | null>;
export type WriteProjectStateFn = (absolutePath: string, content: string) => Promise<void>;

/**
 * A described mutation is a pure data transform on the in-memory document —
 * never a raw JSON patch — so `inst-psio-construct-copy` has exactly one
 * change to apply and nothing else (FEATURE §3 "Atomic Project State
 * Read/Write", Input). `set-template` covers both create and replace: the
 * caller (register's own algorithm) decides which by inspecting the read
 * document first: this seam does not itself distinguish them.
 */
export type ProjectStateMutation =
  | { kind: 'set-template'; name: string; entry: TemplateEntry }
  | { kind: 'remove-template'; name: string }
  | { kind: 'add-owned-root'; path: string }
  | { kind: 'remove-owned-root'; path: string };

/**
 * The document could not be parsed as `{ formatVersion, templates,
 * projectOwnedRoots }` (`inst-psio-if-malformed`). A PLAIN result value —
 * NOT yet the shared `{ok:false, error:{code,message,details}}` envelope
 * `cpt-frontx-adr-cli-machine-readable-output` fixes (`envelope.ts`,
 * built separately) — because this module is pure project-state logic with
 * no dependency on the command-dispatch layer that owns rendering that
 * envelope; a caller one layer up (register/unregister, a later checkpoint)
 * is what maps this into `PROJECT_INVALID`.
 */
export interface ProjectStateInvalidResult {
  ok: false;
  error: 'PROJECT_INVALID';
  message: string;
}

export interface ProjectStateOkResult {
  ok: true;
  document: ProjectStateDocument;
}

/** Outcome of a read-only request (`inst-psio-if-read`). */
export type ReadProjectStateResult = ProjectStateOkResult | ProjectStateInvalidResult;

/** Outcome of a described mutation (`inst-psio-if-mutate`) — the document
 * carried on success is the one just written, reflecting exactly the
 * described change and nothing else (`inst-psio-return-written`). */
export type MutateProjectStateResult = ProjectStateOkResult | ProjectStateInvalidResult;
