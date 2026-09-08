// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
import type { StructuredRef } from '../spec-parser/types';

// A fetch adapter's outcome, widened (additively) to let it report the
// immutable ref its fetch settled on alongside the content — the channel
// `inst-resolve-pin` needs to record a remote origin's pin instead of the
// typed, possibly-moving `@ref` (`cpt-frontx-adr-source-spec-syntax`).
// `pinnedRef` is optional, and a bare `string` remains a valid `FetchFn`
// return value (the union's other arm) precisely so an adapter with nothing
// to report — `adapters/local-fetch.ts`, a `path:` origin's fetch is never
// even reached — needs no change: it already returns `Promise<string>`,
// which still satisfies this widened signature unchanged. This is the union
// choice over a clean break to `Promise<FetchResult>`: exactly one place in
// this codebase interprets the return value (`resolver/resolve.ts`'s
// `resolveRemoteOrigin`), so the "two shapes forever" cost of a union is
// borne by one function, while a clean break would force every test fake
// across this package (`grep -rn "fetchFn" packages/cli/src --include
// "*.test.ts"`) to wrap a bare string in `{ content }` for no behavioral
// gain — pure churn against files that never need to know a pin exists.
export interface FetchResult {
  content: string;
  pinnedRef?: string;
}

export type FetchFn = (url: string) => Promise<string | FetchResult>;

// The prefix that names a local origin (`inst-resolve-origin-kind-check`'s
// own discriminator: "a local `path:<relative-path>` origin"). Owned here —
// the resolver is the one place origin KIND is decided — and exported
// because every caller that must choose between constructing
// `{kind:'remote', ref}` and `{kind:'local', origin}` (`commands/
// register.ts`, `scaffold/assembler.ts`, `upgrade/payload.ts`) needs the
// identical prefix to make that choice; each of those three used to carry
// its own copy of this exact string.
export const LOCAL_ORIGIN_PREFIX = 'path:';

// The "is this a local origin, and if so what relative path does it name"
// pair every caller that must branch on an origin's kind before acting on
// its local arm needs together — returned as one value so nothing can act
// on the predicate half (the prefix check) without the extraction half (the
// slice past it) agreeing about the same prefix. `undefined` for a remote
// origin, which names no local relative path at all. Exported for the same
// reason `LOCAL_ORIGIN_PREFIX` above is: every caller that used to carry its
// own copy of `origin.startsWith(LOCAL_ORIGIN_PREFIX)` followed by
// `origin.slice(LOCAL_ORIGIN_PREFIX.length)` now shares this one
// formulation instead.
export function parseLocalOrigin(origin: string): string | undefined {
  return origin.startsWith(LOCAL_ORIGIN_PREFIX) ? origin.slice(LOCAL_ORIGIN_PREFIX.length) : undefined;
}

// Either a validated structured reference for a remote origin, or a local
// `path:<relative-path>` origin naming a folder inside the project's own
// tree — the resolver's own Input line (`cpt-frontx-algo-template-
// resolution-resolve-to-inventory`). `origin` for the local arm carries the
// prefix verbatim (`path:...`), exactly as a caller received it, since the
// resolver itself is what strips it.
export type ResolveOrigin =
  | { kind: 'remote'; ref: StructuredRef }
  | { kind: 'local'; origin: string };

// Confirms a project-relative candidate path resolves to somewhere inside
// the project root, fail-closed: `null` when the path cannot be PROVEN to
// stay inside the root. Structurally identical to `scaffold/conflict-
// check.ts`'s `CanonicalizeTargetFn` — restated here, not imported, so the
// resolver (the package's most foundational internal component per DESIGN
// §3.2, "only the template resolver talks to the source registry") depends
// on nothing from `scaffold/`; every other component's dependency arrow
// points INTO the resolver, never the reverse. The one real adapter
// (`createFsCanonicalizeTargetFn`, `adapters/fs-project-io.ts`) satisfies
// both types without any change, since TypeScript structural typing does not
// care which name a caller imports.
export type ContainmentCheckFn = (rawPath: string) => string | null;

// Confirms whether something exists at an absolute path at all.
// Canonicalization ALONE cannot answer this: the real
// `createFsCanonicalizeTargetFn` walks up to the nearest EXISTING ancestor
// and returns a canonical spelling even for a path that does not itself
// exist yet — deliberate for a pre-flight TARGET check elsewhere in this
// package, but wrong for an origin that must resolve to real content
// (`inst-resolve-local-path-check`'s own "and confirm it exists" clause).
export type PathExistsFn = (absolutePath: string) => Promise<boolean>;

// Enumerates every regular file reachable under an absolute directory,
// POSIX-relative to it, never following a symlink — the same contract
// `ListDiskFilesFn` fixes in `upgrade/types.ts`. Restated rather than
// imported for the identical layering reason `ContainmentCheckFn` restates
// `CanonicalizeTargetFn`: the resolver sits below `upgrade/`, which already
// depends on the resolver, not the other way round. The one real adapter
// (`createFsListDiskFilesFn`, `adapters/fs-upgrade-io.ts`) already satisfies
// this shape — regular-files-only, symlinks never followed, `[]` when the
// directory is absent — which is exactly the discipline reading a template
// folder needs.
export type ListFolderFilesFn = (absoluteDir: string) => Promise<string[]>;

// Reads one file's content by absolute path — the same `ReadFileFn`
// contract `manifest/types.ts` fixes. Restated for the identical layering
// reason.
export type ReadFolderFileFn = (absolutePath: string) => Promise<string>;

// A local origin's own dependencies. Present only when a caller resolves at
// least one local origin through this module — `TemplateInventory`'s own
// `install`/`update-local` calls never populate this, since a `StructuredRef`
// can never select the local branch, so there is nothing for it to satisfy.
export interface LocalOriginDeps {
  repoRoot: string;
  canonicalizeFn: ContainmentCheckFn;
  existsFn: PathExistsFn;
  listFolderFilesFn: ListFolderFilesFn;
  readFolderFileFn: ReadFolderFileFn;
}

export interface ResolveDeps {
  fetchFn: FetchFn;
  local?: LocalOriginDeps;
}

export interface InventoryReadyRecord {
  name: string;
  content: string;
  // Empty for a local origin: there is no `@ref` version selector to carry —
  // a local origin's version identity comes from the manifest's own
  // `version` field instead, which every reader already reaches through
  // `readManifestFromContent`.
  ref: string;
  source: string;
}

// `code`/`undeclaredFields` are additive (optional): every existing caller
// that reads only `.message` keeps compiling unchanged. A caller that cares
// distinguishes the legacy-manifest refusal `inst-resolve-if-legacy-manifest`
// names (`code: 'INVALID_MANIFEST'` with `undeclaredFields` populated) and
// the generic identity-missing refusal `inst-resolve-identity-missing` names
// (`code: 'INVALID_MANIFEST'` without `undeclaredFields`) from a local
// origin's own containment/existence refusal (`code: 'INVALID_PATH'`), from
// a remote reference naming a host this resolver carries no fetch adapter
// for (`code: 'INVALID_INPUT'`, `inst-resolve-host-unsupported`), and from a
// local origin's manifest existing but standing in a shape a read can never
// honestly satisfy — a FIFO, socket, device, or dangling symlink; an
// ancestor that is not a directory; a permission refusal (`code:
// 'CONTENT_CONFLICT'`, the same code every other unreadable-content refusal
// in this package reports for "the disk holds something this operation
// cannot work with") — mirroring `ReadManifestResult`'s own additive
// widening (`manifest/validate-contract.ts`).
export interface ResolutionError {
  message: string;
  code?: 'INVALID_MANIFEST' | 'INVALID_PATH' | 'INVALID_INPUT' | 'CONTENT_CONFLICT';
  undeclaredFields?: string[];
}

export type ResolveResult =
  | { ok: true; value: InventoryReadyRecord }
  | { ok: false; error: ResolutionError };
