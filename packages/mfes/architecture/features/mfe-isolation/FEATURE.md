# Feature: MFE Runtime Isolation

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Isolated MFE Load](#isolated-mfe-load)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Blob URL Chain Construction](#blob-url-chain-construction)
  - [Shared-Dependency Blob URL Construction](#shared-dependency-blob-url-construction)
  - [Trust-Kernel Guarded Import](#trust-kernel-guarded-import)
- [4. States (CDSL)](#4-states-cdsl)
  - [Isolated Module Lifecycle](#isolated-module-lifecycle)
  - [Per-Load Blob State](#per-load-blob-state)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Audited Trust Kernel — Blob Core](#audited-trust-kernel--blob-core)
  - [Instance-Keyed Load Cache](#instance-keyed-load-cache)
  - [Manifest Reference Resolution](#manifest-reference-resolution)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-mfe-isolation`

## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-mfe-isolation`

### 1.1 Overview

Isolates each loaded microfrontend in its own module graph behind an audited trust kernel — concentrating all dynamic-code primitives in one safety-annotated, contract-enforced file with a no-mutable-state invariant, retaining backing references for the page lifetime to support post-resolution evaluation.

### 1.2 Purpose

A registered microfrontend must evaluate as its own module instance so distinct occupants cannot couple through a shared module record. At the same time, the dynamic-code primitives isolation requires (dynamic import of inline content, construction of specifier matchers) must be confined to one small, audited, lint-enforced location so the arbitrary-code-admission surface stays provably bounded. This feature defines how that isolation is achieved and how the trust kernel is structured and enforced.

**Requirements**: `cpt-frontx-fr-mfe-runtime-registration`, `cpt-frontx-nfr-security`

**Principles**: `cpt-frontx-principle-default-deny-admission`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Registers and loads a microfrontend into the running application; the isolation mechanism is transparent to this actor but guarantees their MFE evaluates as its own isolated instance |

### 1.4 References

- **PRD**: [PRD.md](../../../../../architecture/PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: `cpt-frontx-adr-mfe-load-isolation`
- **Component**: `cpt-frontx-component-mfe-runtime` (shared with F4, F5, F6, F7)
- **Dependencies**: `cpt-frontx-feature-mfe-registry` (F4), `cpt-frontx-feature-mfe-loading` (F5)

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor and describe the end-to-end flow of a use case.

**Use cases**: `cpt-frontx-usecase-add-microfrontend-to-project`

### Isolated MFE Load

- [x] `p1` - **ID**: `cpt-frontx-flow-mfe-isolation-load`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer's MFE code is loaded and evaluated as a fresh isolated module instance keyed by the extension instance ID, then mounted into its target domain
- Two extensions sharing the same entry definition produce distinct isolated evaluations with no shared module state

**Error Scenarios**:
- The expose chunk source cannot be fetched — load fails and the cache entry is evicted for retry
- The import primitive receives a non-inline-content URL — guard rejects it with a type error before any dynamic import executes
- The entry names its manifest by id, and neither the handler's own manifest cache nor the type system supplied at handler registration holds a manifest under that id — load fails with an error naming the unresolved reference; a handler that belongs to no registry has no type system to ask and fails the same way
- The manifest declares the same shared-dependency package name more than once — load fails with an error naming the duplicated package and the manifest, before any shared-dependency source is fetched
- A chunk's static dependency has no blob URL when that chunk is rewritten — load fails with an error naming the referring chunk and the unbuilt dependency, rather than emitting an origin URL for it
- A chunk's static-dependency graph contains a cycle, whether closed within one branch or across two branches that fanned out independently — load fails with a diagnostic naming the chunks on the cycle and the microfrontend, because no module may be resolved outside the load's own graph
- The manifest's shared dependencies import one another circularly — load fails with a diagnostic naming those dependencies and the imports among them, rather than minting a module whose bare specifiers are left unrewritten

**Steps**:
1. [x] - `p1` - Actor registers the microfrontend entry with the registry - `inst-register`
2. [x] - `p1` - Actor triggers the load action for the microfrontend - `inst-trigger-load`
3. [x] - `p1` - System checks the instance-keyed load cache for an existing promise keyed by the extension instance ID - `inst-check-cache`
4. [x] - `p1` - **IF** a cached load promise exists for this instance ID - `inst-if-cached`
   1. [x] - `p1` - **RETURN** the cached lifecycle (same blob URLs, same module instance, same lifecycle reference) - `inst-return-cached`
5. [x] - `p1` - **ELSE** - `inst-else-new-load`
   1. [x] - `p1` - System resolves the MFE manifest from the entry's manifest reference - `inst-resolve-manifest`
      1. [x] - `p1` - **IF** the reference carries the manifest document itself, System caches it under its own id and uses it for this load - `inst-manifest-inline`
      2. [x] - `p1` - **ELSE** the reference names the manifest by id: System reads the handler's manifest cache and, on a miss, asks the type system supplied to the handler at registration for the manifest registered under that id, accepting only a value of manifest shape - `inst-manifest-by-id`
      3. [x] - `p1` - **IF** no source yields a manifest for the id, System raises an MFE load error naming the unresolved reference and the ways to supply it - `inst-manifest-unresolved-raise`
   2. [x] - `p1` - System builds shared-dependency blob URLs for every shared dependency the manifest declares via the build-shared-dep-blobs algorithm, which decides their construction order itself from the fetched sources - `inst-build-shared-blobs`
   3. [x] - `p1` - System builds the blob URL chain for the expose chunk and its full static-dependency graph via the blob-url-chain algorithm - `inst-build-expose-chain`
   4. [x] - `p1` - System imports the expose blob URL through the trust-kernel guarded import primitive - `inst-import-expose`
   5. [x] - `p1` - System validates that the imported module implements the lifecycle contract (mount and unmount functions) - `inst-validate-lifecycle`
   6. [x] - `p1` - **IF** lifecycle contract not satisfied - `inst-if-bad-lifecycle`
      1. [x] - `p1` - System evicts the cache entry and raises an MFE load error - `inst-evict-raise`
   7. [x] - `p1` - System wraps the lifecycle with stylesheet injection logic and records the load promise in the instance-keyed cache - `inst-cache-promise`
6. [x] - `p1` - Actor mounts the returned lifecycle into the target domain container - `inst-actor-mount`
7. [x] - `p1` - **RETURN** the mounted lifecycle instance - `inst-return-lifecycle`

## 3. Processes / Business Logic (CDSL)

Internal system functions that implement the isolation mechanism.

### Blob URL Chain Construction

- [x] `p1` - **ID**: `cpt-frontx-algo-mfe-isolation-blob-url-chain`

**Input**: Expose chunk filename, the requesting lineage (ancestor filenames whose construction transitively awaits this one), a build-scoped failure signal, and per-load state (base URL, entry ID, shared-dep blob URL map, an in-flight construction registry — a transient join point that lets concurrent requesters for one filename share a single construction — and the blob URL map, the one durable record of completed constructions)

**Output**: Per-load blob URL map updated with the expose chunk and all transitive static-dependency blob URLs — the whole chain, with no exception — or a failure of the chain build

**Steps**:
1. [x] - `p1` - Operate under a failure signal created fresh for each chain build — the initial expose-chunk build, or one lazy-chunk resolution — and shared only by the recursive constructions of that same build, so a failed build never suppresses or fails a later independent build within the same load - `inst-build-failure-scope`
2. [x] - `p1` - Check whether the chunk filename is already present in the per-load blob URL map - `inst-check-map`
3. [x] - `p1` - **IF** chunk already mapped - `inst-if-mapped`
   1. [x] - `p1` - **RETURN** immediately (already computed for this load) - `inst-return-mapped`
4. [x] - `p1` - Check whether the requested filename already appears in the lineage carried by this request, which would make its own construction depend on itself — a cycle this load's graph cannot express - `inst-check-ancestor-cycle`
5. [x] - `p1` - **IF** the filename is present in its own lineage - `inst-if-ancestor-cycle`
   1. [x] - `p1` - **RETURN** error — fail this chain build with a diagnostic naming the chunk and the lineage that closes the cycle, without constructing and **without awaiting**, so no circular wait is created - `inst-raise-ancestor-cycle`
6. [x] - `p1` - **WHEN** a cycle is detected — in a construction's own lineage or in a joined lineage — emit the diagnostic as the raised error itself, once per chunk per chain build, naming the chunk, the lineage that closes the cycle, the microfrontend, and the remedy (rebuild the microfrontend so its chunk graph is acyclic), rather than as a warning alongside a degraded resolution - `inst-diagnose-cycle`
7. [x] - `p1` - Check whether a construction promise for this filename is already in-flight in the per-load in-flight map - `inst-check-inflight`
8. [x] - `p1` - **IF** an in-flight promise exists - `inst-if-inflight`
   1. [x] - `p1` - Form the union of this request's own lineage and the lineage recorded on the in-flight entry - `inst-join-lineage-union`
   2. [x] - `p1` - **IF** that union already names the requested filename — awaiting it would close a cycle across two branches that fanned out independently, which is the cross-branch circular wait this check exists to prevent - `inst-if-join-cycle`
      1. [x] - `p1` - **RETURN** error — fail this chain build with the same diagnostic as `inst-raise-ancestor-cycle`, without awaiting, so no circular wait is created across the two branches - `inst-raise-join-cycle`
   3. [x] - `p1` - **ELSE** contribute this request's own lineage into the in-flight entry's lineage before awaiting it, so that a later request issued by the joined construction back into this branch is detectable as the cycle it is - `inst-contribute-lineage`
   4. [x] - `p1` - **RETURN** the existing in-flight promise (concurrent callers share one construction) - `inst-return-inflight`
9. [x] - `p1` - Register an in-flight entry for this filename carrying a lineage seeded from the requesting lineage, and thread that lineage — live, not a snapshot — through this construction and into every dependency it recurses into - `inst-register-inflight`
10. [x] - `p1` - **IF** the build's failure signal is already raised when this construction begins - `inst-if-failed-at-entry`
    1. [x] - `p1` - **RETURN** without fetching, abandoning work this build will never use - `inst-return-failed-at-entry`
11. [x] - `p1` - Fetch the chunk source text from the absolute chunk URL using the LRU source-text cache for URL-level deduplication - `inst-fetch-source`
12. [x] - `p1` - **IF** the build's failure signal was raised by another branch while this fetch was in flight - `inst-if-failed-after-fetch`
    1. [x] - `p1` - **RETURN** without minting a blob URL - `inst-return-failed-after-fetch`
13. [x] - `p1` - Parse all relative static import filenames from the chunk source - `inst-parse-static-imports`
14. [x] - `p1` - Fan the sibling dependency recursions out concurrently rather than awaiting each sibling's entire subtree before starting the next, admitting them through a single concurrency budget shared by the whole chain build so that the number of source fetches in flight for that build never exceeds one fixed width — a constant of the runtime, not a field a caller configures — regardless of graph depth or the number of sibling groups; the bound keeps added concurrency shortening wall-clock time instead of queuing behind the transport's own connection limit, and keeps a build from minting page-lifetime blob URLs for work a failing build will never use - `inst-fanout-bounded`
15. [x] - `p1` - **FOR EACH** dependency filename in the parsed static imports - `inst-for-each-dep`
    1. [x] - `p1` - Recursively build the blob URL chain for the dependency, passing a lineage extended with this chunk's own filename - `inst-recurse-dep`
16. [x] - `p1` - Await every sibling recursion and scan the outcomes in declaration order — not completion order — for the first failure, so the reported error is deterministic regardless of which sibling lost the wall-clock race - `inst-first-failure-declaration-order`
17. [x] - `p1` - **IF** a sibling recursion failed - `inst-if-sibling-failed`
    1. [x] - `p1` - Raise this build's failure signal and propagate that first failure to the caller - `inst-raise-build-failure`
18. [x] - `p1` - **IF** the build's failure signal was raised by a branch outside this construction's own subtree - `inst-if-failed-elsewhere`
    1. [x] - `p1` - **RETURN** without minting a blob URL - `inst-return-failed-elsewhere`
19. [x] - `p1` - Rewrite all relative static import specifiers to their resolved blob URLs from the per-load blob URL map - `inst-rewrite-static`
20. [x] - `p1` - Raise an MFE load error for any static dependency that has no entry in the per-load blob URL map when its referrer is rewritten — unconditionally, there being no sanctioned reason for an absence now that a detected cycle fails the build where it is detected — naming the referring chunk and the dependency, rather than emitting an origin URL for a module that would then evaluate outside the isolated graph with its bare specifiers unrewritten - `inst-raise-unbuilt-dep`
21. [x] - `p1` - Rewrite all bare shared-dependency specifiers to their pre-built shared-dep blob URLs - `inst-rewrite-shared`
22. [x] - `p1` - Replace `import.meta.url` occurrences with the chunk's real HTTP base URL to preserve relative URL resolution under blob evaluation - `inst-rewrite-meta-url`
23. [x] - `p1` - **IF** the rewritten source references the lazy-import ABI function - `inst-if-lazy-ref`
    1. [x] - `p1` - Mint or reuse the per-load lazy-loader stub blob URL and inject its import at the top of the source - `inst-inject-lazy-stub`
24. [x] - `p1` - Wrap the fully rewritten source in a blob, create a blob URL, and record it in the per-load blob URL map - `inst-create-blob`
25. [x] - `p1` - **RETURN** with the blob URL present in the per-load map, which is the durable record of this construction - `inst-return-complete`
26. [x] - `p1` - **WHEN** a construction settles — fulfilled or rejected — without a blob URL recorded for its filename (abandonment because another branch of the same build failed, or its own failure — including a detected cycle), remove its in-flight registry entry, so a later request re-attempts construction instead of joining a settled promise that produced nothing - `inst-settle-drop-inflight`

### Shared-Dependency Blob URL Construction

- [x] `p1` - **ID**: `cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls`

**Input**: MFE manifest containing the shared-dependency list (name, version, chunk path) in the manifest's published enumeration order, which fixes only the sequence in which the declarations are visited (`cpt-frontx-adr-mfe-asset-discovery`)

**Output**: Map of shared-dependency package name to blob URL, covering all shared dependencies declared in the manifest

**Steps**:
1. [x] - `p1` - Verify that every shared-dependency package name declared in the manifest is unique within that manifest, before any network access - `inst-assert-unique-names`
2. [x] - `p1` - **IF** the same package name is declared more than once, regardless of version - `inst-if-duplicate-name`
   1. [x] - `p1` - **RETURN** error — fail the load with a diagnostic naming the duplicated package and the manifest, because sources and rewrite maps are keyed by bare package name and a duplicate would silently displace the earlier declaration - `inst-raise-duplicate-name`
3. [x] - `p1` - **FOR EACH** shared dependency declared in the manifest, visited in the manifest's enumeration order — which governs only the sequence of visits and, when two declarations collide on the same `name@version` key, which one claims the cross-MFE cache entry, so the enumeration may issue its fetches concurrently, admitted through the same fixed width `inst-fanout-bounded` names; this phase completes before the load's expose-chunk chain build begins, so the two phases never contribute to one another's in-flight count - `inst-for-each-dep`
   1. [x] - `p1` - Compute the deduplication cache key as `name@version` - `inst-compute-key`
   2. [x] - `p1` - **IF** the cross-MFE shared-dep text cache already holds a promise for this key - `inst-if-cache-hit`
      1. [x] - `p1` - Retrieve the cached source text promise - `inst-retrieve-cached`
   3. [x] - `p1` - **ELSE** - `inst-else-fetch`
      1. [x] - `p1` - Derive the absolute chunk URL from the manifest's `publicPath` and the dependency's `chunkPath` - `inst-derive-url`
      2. [x] - `p1` - Fetch the source text and store the *in-flight fetch promise* in the cross-MFE cache under the key before awaiting it — which is what keeps the deduplication race-free however the concurrent fetches are interleaved; on rejection, evict the entry to permit retry - `inst-fetch-and-cache`
4. [x] - `p1` - Resolve the collected sources in dependency order — the sole source of dependency-order correctness for blob construction, derived from the fetched sources themselves and not from the manifest's enumeration order — processing each dependency only after all dependencies it imports have been resolved - `inst-resolve-order`
5. [x] - `p1` - **IF** a pass over the pending shared dependencies resolves none of them, the remaining set imports one another circularly and no dependency order over it exists - `inst-if-shared-cycle`
   1. [x] - `p1` - **RETURN** error — fail the load with a diagnostic naming the shared dependencies that remain unresolved and the imports among them that form the cycle, rather than minting a module whose bare specifiers are left unrewritten and which therefore cannot be instantiated - `inst-raise-shared-cycle`
6. [x] - `p1` - **FOR EACH** dependency in resolved order - `inst-for-each-resolved`
   1. [x] - `p1` - Rewrite bare shared-dep specifiers in the source to the already-resolved blob URLs - `inst-rewrite-specifiers`
   2. [x] - `p1` - Wrap the rewritten source in a blob, create a fresh blob URL, and add it to the shared-dep blob URL map - `inst-create-dep-blob`
7. [x] - `p1` - **RETURN** the complete shared-dep blob URL map - `inst-return-map`

### Trust-Kernel Guarded Import

- [x] `p1` - **ID**: `cpt-frontx-algo-mfe-isolation-trust-kernel-import`

**Input**: URL string provided as the target for dynamic module import

**Output**: Evaluated ES module record, or a type error if the URL does not begin with an inline-content scheme

**Steps**:
1. [x] - `p1` - Inspect the leading scheme of the URL - `inst-inspect-scheme`
2. [x] - `p1` - **IF** URL does not begin with `blob:` or `data:` - `inst-if-invalid-scheme`
   1. [x] - `p1` - **RETURN** error — reject with a type error identifying the non-conforming URL - `inst-reject-scheme`
3. [x] - `p1` - Execute the dynamic import of the inline-content URL through the trust kernel - `inst-exec-import`
4. [x] - `p1` - **RETURN** the evaluated module record - `inst-return-module`

## 4. States (CDSL)

### Isolated Module Lifecycle

- [x] `p2` - **ID**: `cpt-frontx-state-mfe-isolation-module-lifecycle`

**States**: UNLOADED, ISOLATED, ACTIVE, DISPOSED

**Initial State**: UNLOADED

**Transitions**:
1. [x] - `p1` - **FROM** UNLOADED **TO** ISOLATED **WHEN** the blob URL chain is successfully built and the expose module is imported through the trust kernel, with the load promise recorded in the instance-keyed cache - `inst-to-isolated`
2. [x] - `p1` - **FROM** ISOLATED **TO** ACTIVE **WHEN** the lifecycle's mount function is called and the MFE is rendered into the target domain container - `inst-to-active`
3. [x] - `p1` - **FROM** ACTIVE **TO** DISPOSED **WHEN** the lifecycle's unmount function is called and the MFE is removed from the domain container - `inst-to-disposed`
4. [x] - `p1` - **FROM** UNLOADED **TO** UNLOADED **WHEN** a load attempt fails; the cache entry is evicted so a subsequent load attempt starts fresh - `inst-load-failed-retry`

### Per-Load Blob State

- [x] `p2` - **ID**: `cpt-frontx-state-mfe-isolation-load-blob-state`

**States**: INITIALIZING, BUILDING, COMPLETE

**Initial State**: INITIALIZING

**Transitions**:
1. [x] - `p1` - **FROM** INITIALIZING **TO** BUILDING **WHEN** the shared-dep blob URLs are constructed and the expose chunk construction begins - `inst-blob-building`
2. [x] - `p1` - **FROM** BUILDING **TO** COMPLETE **WHEN** all chunks in the dependency graph have blob URLs recorded in the per-load map - `inst-blob-complete`

## 5. Definitions of Done

### Audited Trust Kernel — Blob Core

- [x] `p1` - **ID**: `cpt-frontx-dod-mfe-isolation-blob-core`

The system **MUST** maintain a single audited trust-kernel file that is the sole site of dynamic import of inline content and dynamic construction of specifier matchers. Every exported function in this file **MUST** carry a safety rationale, the file **MUST** declare no mutable module-level state, it **MUST** import no dangerous host capabilities, and the dynamic-import function **MUST** guard its input to accept only scheme-prefixed inline-content URLs (`blob:` or `data:`). A custom lint rule **MUST** enforce that these dynamic-code primitives appear only in this file.

**Implements**:
- `cpt-frontx-flow-mfe-isolation-load`
- `cpt-frontx-algo-mfe-isolation-trust-kernel-import`

**Constraints**: none owned (F8 owns no DESIGN constraint per DECOMPOSITION 2.7)

**Addresses (NFR)**: `cpt-frontx-nfr-security`

**Touches**:
- Entities: `MfeEntry`

### Instance-Keyed Load Cache

- [x] `p1` - **ID**: `cpt-frontx-dod-mfe-isolation-handler-load-cache`

The system **MUST** key the load cache by the extension instance ID (not the entry definition ID) so that two extensions sharing the same entry definition produce distinct blob URL chains and distinct module evaluations. The cache **MUST** retain load promises for the page lifetime and **MUST NOT** revoke blob URLs after the import resolves, because a module may continue evaluating after its import promise settles. Cache entries **MUST** be evicted only on load failure, to permit retry.

**Implements**:
- `cpt-frontx-flow-mfe-isolation-load`
- `cpt-frontx-algo-mfe-isolation-blob-url-chain`

**Constraints**: none owned (F8 owns no DESIGN constraint per DECOMPOSITION 2.7)

**Addresses (NFR)**: `cpt-frontx-nfr-security`

**Touches**:
- Entities: `MfeEntry`

### Manifest Reference Resolution

- [x] `p1` - **ID**: `cpt-frontx-dod-mfe-isolation-manifest-reference-resolution`

The system **MUST** accept an entry's manifest either as the document itself or as an id naming a manifest the type system holds. For an id, the handler **MUST** read its own manifest cache first and, on a miss, the type system the registry supplied to it at registration, accepting the answer only when it is of manifest shape and caching it for subsequent loads. The handler **MUST NOT** carry a type system obtained any other way — a handler registered into no registry has none. When no source yields a manifest for the id, the system **MUST** fail the load with an error naming the unresolved reference rather than proceeding with an absent or foreign manifest.

**Implements**:
- `cpt-frontx-flow-mfe-isolation-load`

**Constraints**: none owned (F8 owns no DESIGN constraint per DECOMPOSITION 2.7)

**Touches**:
- Entities: `MfeEntry`

## 6. Acceptance Criteria

- [x] Each loaded microfrontend evaluates as its own isolated module instance; two extensions sharing the same entry definition receive distinct instance-keyed cache entries and distinct module evaluations
- [x] All dynamic-code primitives (dynamic import of inline content, dynamic construction of specifier matchers) are confined to the single audited trust-kernel file; a lint rule enforces this boundary
- [x] The trust-kernel import primitive rejects any input URL that does not begin with `blob:` or `data:` before any import executes
- [x] All blob URLs in the instance-keyed load cache are retained for the page lifetime and are never revoked after the import resolves
- [x] Shared-dependency source text is deduplicated across MFE loads using a cross-MFE LRU cache keyed by `name@version`; cache entries for failed fetches are evicted to permit retry
- [x] On load failure, the cache entry for the failed extension instance is evicted so a subsequent call can attempt a fresh load
- [ ] No load ever emits, for any module and for any reason, a specifier that is not an inline-content URL minted by that load. There is no exception for dependency cycles.
- [ ] A chunk whose static-dependency graph closes a cycle — including one that closes across two branches that fanned out independently — fails the load without a circular wait, with a diagnostic naming the chunk, the lineage that closes the cycle, and the microfrontend.
- [ ] Shared dependencies that import one another circularly fail the load with a diagnostic naming them, rather than producing a module whose bare specifiers are left unrewritten.
- [ ] A static dependency absent from the per-load blob URL map when its referrer is rewritten fails the load with a diagnostic naming the referring chunk and the dependency — unconditionally, there being no sanctioned reason for an absence.
- [x] A chain build that fails does not affect any later independent chain build of the same load: a lazy import that follows a failed one re-attempts construction of every chunk the failed build abandoned, including chunks the two builds share.
- [x] Sibling static-import dependencies are fetched concurrently, and the number of chunk-source fetches in flight for one chain build never exceeds the runtime's fixed width no matter how deep or how wide the dependency graph is; the failure reported for a group of siblings is still the first in declaration order regardless of completion order.
- [x] A manifest declaring the same shared-dependency package name more than once fails the load with a diagnostic naming that package, before any shared-dependency source is fetched.
- [ ] An entry whose manifest is named by id loads when the manifest is registered with the type system of the registry the handler was registered into, without the id ever being cached by an earlier load
- [ ] An entry whose manifest id no source resolves fails the load with a diagnostic naming that reference, both when a type system was supplied and when the handler belongs to no registry
