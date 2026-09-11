# Feature: MFE Discovery & Lazy-Import Loading


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [On-Demand MFE Load via Manifest Discovery](#on-demand-mfe-load-via-manifest-discovery)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Manifest-Driven Discovery](#manifest-driven-discovery)
  - [Lazy-Import ABI Resolution](#lazy-import-abi-resolution)
  - [Per-Attempt Load Timeout](#per-attempt-load-timeout)
- [4. States (CDSL)](#4-states-cdsl)
  - [MFE Load Lifecycle State Machine](#mfe-load-lifecycle-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Manifest Fields Drive Discovery — No Remote-Entry Parsing](#manifest-fields-drive-discovery--no-remote-entry-parsing)
  - [Lazy-Import ABI Inherits Parent Load Bindings](#lazy-import-abi-inherits-parent-load-bindings)
  - [Per-Attempt Load Timeout Budget](#per-attempt-load-timeout-budget)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-mfe-loading`
## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-mfe-loading`

### 1.1 Overview

This feature drives microfrontend asset discovery from an enriched published manifest and resolves lazy dynamic imports through a per-load runtime ABI that inherits the parent load's shared-dependency bindings — so the runtime stays decoupled from template build internals and lazy chunks always join their parent load's isolated graph.

### 1.2 Purpose

The MFE Runtime must locate a microfrontend's chunks without parsing bundler-emitted output, and code-split MFEs must have their lazily reached chunks resolve inside the same isolated module graph as their parent load. This feature provides the manifest-driven discovery contract and the lazy-import ABI that together satisfy on-demand loading without coupling the runtime to any particular bundler or build substrate.

**Requirements**: `cpt-frontx-fr-mfe-runtime-registration`, `cpt-frontx-nfr-runtime-performance`

**Principles**: none owned by this feature

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Registers a microfrontend entry (with its manifest) against the registry, triggering on-demand load when the extension is first needed |

### 1.4 References

- **PRD**: [PRD.md](../../../../../architecture/PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADRs**: `cpt-frontx-adr-mfe-asset-discovery`, `cpt-frontx-adr-lazy-import-resolution`
- **Component**: `cpt-frontx-component-mfe-runtime` (shared with F4, F6, F7, F8)
- **Dependencies**: `cpt-frontx-feature-mfe-registry` (F4)

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor (human or external system) and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: `cpt-frontx-usecase-add-microfrontend-to-project`

### On-Demand MFE Load via Manifest Discovery

- [x] `p1` - **ID**: `cpt-frontx-flow-mfe-loading-on-demand-load`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer registers an MFE entry with a conforming manifest; the registry loads it on demand when the extension is first exercised and returns a lifecycle module factory.

**Error Scenarios**:
- Manifest is absent or malformed — load fails at MANIFEST_RESOLVED, entry transitions to LOAD_FAILED.
- Expose chunk backing file is empty in the manifest — load fails at LOADING.
- A lazy chunk's relative path cannot be resolved within the load's chunk set — lazy resolution fails and the load transitions to LOAD_FAILED.
- A load attempt does not settle within the per-attempt timeout budget configured on the handler — that attempt fails with a diagnostic naming the entry and the elapsed budget, its abandoned in-flight work is left running, and any retry is raced against its own fresh budget.
- A load attempt fails on a dependency cycle in the microfrontend's chunk graph or among its shared dependencies — the load fails on that attempt with the cycle diagnostic and is not retried, the outcome being identical on every attempt.

**Steps**:
1. [x] - `p1` - Registry receives the microfrontend entry with its manifest reference (`MfeEntry` with manifest field) and, at load start, resolves and caches the declared manifest — `inst-register-entry`
2. [x] - `p1` - Registry triggers on-demand load for the entry when the extension is first needed — `inst-trigger-load`
3. [ ] - `p1` - System validates that the entry's manifest carries the required declared fields (`metaData.publicPath`, `exposeAssets`, `shared[]`) — `inst-validate-manifest-fields`
4. [ ] - `p1` - **IF** required manifest fields are absent or malformed — `inst-if-manifest-invalid`
   1. [ ] - `p1` - **RETURN** load failure; entry transitions to LOAD_FAILED — `inst-manifest-invalid-fail`
5. [ ] - `p1` - System derives the asset base URL from `manifest.metaData.publicPath` — `inst-derive-base-url`
6. [x] - `p1` - System executes manifest-driven discovery (see §3 `cpt-frontx-algo-mfe-loading-manifest-discovery`) to build shared-dependency blob URLs and locate the expose chunk — `inst-run-manifest-discovery`
7. [ ] - `p1` - System mints a per-load lazy-import ABI resolver stub and registers it with the host-side registry (see §3 `cpt-frontx-algo-mfe-loading-lazy-import-abi`) — `inst-mint-lazy-stub`
8. [ ] - `p1` - System fetches and rewrites the expose chunk's bare specifiers to the per-load blob URLs, producing an isolated module blob URL — `inst-rewrite-expose-chunk`
9. [ ] - `p1` - System imports the expose chunk blob URL and extracts the lifecycle module factory — `inst-import-expose-chunk`
10. [ ] - `p1` - **IF** lazy chunks are exercised during mount — `inst-if-lazy-exercised`
    1. [ ] - `p1` - System resolves each `__frontx_lazy(path)` call via the per-load ABI resolver; each lazy chunk joins the same isolated graph and inherits the parent load's shared-dependency bindings — `inst-resolve-lazy-chunks`
11. [ ] - `p1` - System collects CSS paths from `exposeAssets.css.sync` and `exposeAssets.css.async` for stylesheet injection at mount — `inst-collect-css`
12. [x] - `p1` - **RETURN** lifecycle module factory and stylesheet paths to the registry — `inst-return-lifecycle`

**Recorded debt — flow specified ahead of the runtime**: the unchecked steps above stay unchecked on the same ground §4 records — where the behaviour exists in code at all, it lives under mfe-isolation's marked regions rather than under anchors of this feature's own.

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures that do not interact with actors directly. These are reusable building blocks called by Actor Flows or other processes.

### Manifest-Driven Discovery

- [x] `p1` - **ID**: `cpt-frontx-algo-mfe-loading-manifest-discovery`

**Input**: `MfeEntry` with a resolved `MfManifest` (fields: `metaData.publicPath`, `shared[]` in the manifest's published enumeration order — a given entry may optionally declare a content hash of its emitted chunk — `exposeAssets` per entry)

**Output**: asset base URL, expose chunk filename, stylesheet paths, shared-dependency blob URLs

**Steps**:
1. [x] - `p1` - Read `manifest.metaData.publicPath` as the asset base URL for all chunk references in this MFE — `inst-md-read-public-path`
2. [x] - `p1` - Read `exposeAssets.js.sync[0]` as the expose chunk filename; if empty, emit a load error — `inst-md-read-expose-chunk`
3. [x] - `p1` - Read `exposeAssets.css.sync` and `exposeAssets.css.async` as the stylesheet asset paths — `inst-md-read-css`
4. [x] - `p1` - **FOR EACH** entry in `manifest.shared[]`, visited in the manifest's enumeration order, which fixes the sequence of visits and not the order in which the fetches are issued or completed (`cpt-frontx-adr-mfe-asset-discovery`) — `inst-md-for-each-shared`
   1. [x] - `p1` - Resolve `shared.chunkPath` against the asset base URL to form the standalone ESM fetch URL — `inst-md-resolve-chunk-path`
   2. [x] - `p1` - Fetch the standalone ESM source text for this shared dependency — `inst-md-fetch-shared-dep`
   3. [x] - `p1` - Rewrite bare specifiers in the fetched source to the already-resolved blob URLs of the shared dependencies it imports, in the leaves-first order the consumer derives from the fetched sources themselves (`cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls`, step `inst-resolve-order`) — `inst-md-rewrite-specifiers`
   4. [x] - `p1` - Mint a blob URL for this shared dependency and record it in the per-load shared-dep blob URL map — `inst-md-mint-shared-blob`
5. [ ] - `p1` - **RETURN** asset base URL, expose chunk filename, stylesheet paths, and the completed shared-dep blob URL map — `inst-md-return`

### Lazy-Import ABI Resolution

- [x] `p1` - **ID**: `cpt-frontx-algo-mfe-loading-lazy-import-abi`

**Input**: `LoadState` carrying the per-load shared-dep blob URL map, asset base URL, and entry chunk filename; a lazy chunk relative path emitted as `__frontx_lazy(path)` by the build-time transform

**Output**: a blob URL for the lazy chunk, joined to the parent load's isolated graph with its shared-dependency bindings inherited

**Steps**:
1. [x] - `p1` - At load time, mint a per-load loader stub (tiny ESM blob) that re-exports `__frontx_lazy` as a function closed over this load's resolver identifier — `inst-lai-mint-stub`
2. [x] - `p1` - Register the per-load resolver in the host-side `__FRONTX_LAZY__` global registry, keyed by the load's resolver identifier — `inst-lai-register-resolver`
3. [ ] - `p1` - Inject the loader stub's blob URL into every chunk in this load that references the `__frontx_lazy` identifier, so compiled lazy calls reach this load's resolver — `inst-lai-inject-stub`
4. [x] - `p1` - **WHEN** `__frontx_lazy(path)` is first exercised in a loaded chunk — `inst-lai-when-exercised`
   1. [x] - `p1` - Resolve the relative path against the entry chunk's directory to obtain a filename relative to the asset base URL — `inst-lai-resolve-relative-path`
   2. [ ] - `p1` - **IF** a blob URL for this filename already exists in the per-load blob URL map — `inst-lai-if-cached`
      1. [ ] - `p1` - **RETURN** the cached blob URL, skipping re-fetch and re-rewrite — `inst-lai-return-cached`
   3. [x] - `p1` - Fetch the lazy chunk source from the asset base URL — `inst-lai-fetch-lazy-chunk`
   4. [ ] - `p1` - Rewrite bare specifiers in the lazy chunk source to the parent load's shared-dep blob URLs (inherited from the same `LoadState`) — `inst-lai-rewrite-lazy-specifiers`
   5. [ ] - `p1` - Rewrite any nested `__frontx_lazy` references in the lazy chunk to the same per-load loader stub URL — `inst-lai-rewrite-nested-lazy`
   6. [ ] - `p1` - Mint a blob URL for the lazy chunk and record it in the per-load blob URL map — `inst-lai-mint-lazy-blob`
   7. [x] - `p1` - **RETURN** the lazy chunk's blob URL; the caller imports it, joining the parent load's isolated graph — `inst-lai-return-lazy-blob`
5. [x] - `p1` - **IF** a lazy call reaches a loader identifier no resolver is registered for — the unresolvable-path failure itself surfaces inside the lazy-blob resolution above — `inst-lai-if-unknown`
   1. [ ] - `p1` - **RETURN** load failure — `inst-lai-unknown-fail`

**Recorded debt — algorithms specified ahead of the runtime**: the unchecked steps in both algorithms stay unchecked on the same ground §4 records — where the behaviour exists in code at all, it lives under mfe-isolation's marked regions rather than under anchors of this feature's own.

### Per-Attempt Load Timeout

- [x] `p1` - **ID**: `cpt-frontx-algo-mfe-loading-attempt-timeout`

**Input**: One load attempt in progress for an entry, and the timeout budget configured on the handler

**Output**: The attempt's own outcome when it settles within the budget, or a diagnostic load error naming the entry and the elapsed budget; and, for a failed attempt, whether a further attempt may follow

**Steps**:
1. [x] - `p1` - Read the configured per-attempt timeout budget from the handler configuration — `inst-lto-read-budget`
2. [x] - `p1` - **IF** the budget is absent or non-positive — `inst-lto-if-disabled`
   1. [x] - `p1` - **RETURN** the attempt unraced, so a configured zero (the conventional "no timeout" idiom) or any other non-positive value disables the race instead of failing every attempt immediately — `inst-lto-return-unraced`
3. [x] - `p1` - Race the attempt against the budget, so whichever settles first determines this attempt's outcome, and release the timer once either side settles — `inst-lto-race-attempt`
4. [x] - `p1` - **IF** the budget elapses before the attempt settles — `inst-lto-if-elapsed`
   1. [x] - `p1` - **RETURN** error — raise a load error naming the entry and the elapsed budget — `inst-lto-raise-timeout`
   2. [x] - `p1` - Leave the abandoned attempt's in-flight work running: the race abandons the attempt's result, it does not cancel the work in progress, and anything that work goes on to produce stays subject to the retention invariant of `cpt-frontx-adr-mfe-load-isolation` — `inst-lto-no-cancel`
   3. [x] - `p1` - Release the source-text cache entries the abandoned attempt was waiting on — both the per-chunk-URL entries (`cpt-frontx-algo-mfe-isolation-blob-url-chain`, step `inst-fetch-source`) and the per-shared-dependency-key entries (`cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls`, step `inst-fetch-and-cache`) — so that a subsequent attempt issues its own fetch instead of resolving to the abandoned attempt's in-flight one; without this the timeout bounds a hung fetch without recovering from it, because every retry rejoins the same hung result and expires against its own budget in turn — `inst-lto-release-abandoned-source-text`
   4. [x] - `p1` - Make each release identity-checked: remove an entry only while it still holds the very in-flight result the abandoned attempt was waiting on, and never one a concurrent load has since registered under the same key — the same discipline those steps already require of their eviction on rejection — `inst-lto-release-identity-checked`
   5. [x] - `p1` - Treat releasing an entry as distinct from cancelling the work behind it: `inst-lto-no-cancel` continues to hold unchanged, and the accepted cost is that the abandoned fetch and the retry's own fetch may be in flight for the same source at once — the price of a retry that can actually succeed — `inst-lto-release-not-cancel`
5. [x] - `p1` - Apply the budget to one attempt and not to the load as a whole: every retry of a failed attempt is raced against its own fresh budget, so a single load's worst-case wall clock is the budget multiplied by the number of attempts plus the backoff between them — `inst-lto-per-attempt-budget`
6. [x] - `p1` - **IF** an attempt fails for a reason a repeat attempt cannot change — a dependency cycle detected while building the load's isolated module graph (`cpt-frontx-algo-mfe-isolation-blob-url-chain`, `inst-raise-ancestor-cycle` and `inst-raise-join-cycle`; `cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls`, `inst-raise-shared-cycle`), which is a property of the microfrontend's build and is identical on every attempt — `inst-lto-if-deterministic-failure`
   1. [x] - `p1` - **RETURN** that failure to the caller without a further attempt, so a deterministic refusal is not re-attempted: retrying it multiplies the source fetches and delays the same user-visible error by the backoff for no possible benefit — `inst-lto-no-retry-deterministic`
7. [x] - `p1` - **RETURN** the attempt's own outcome when it settles within the budget — `inst-lto-return-attempt`

## 4. States (CDSL)

### MFE Load Lifecycle State Machine

- [x] `p1` - **ID**: `cpt-frontx-state-mfe-loading-load-lifecycle`

**States**: PENDING, MANIFEST_RESOLVED, LOADING, LOADED, LOAD_FAILED

**Initial State**: PENDING

**Recorded debt — machine specified ahead of the runtime**: no code reifies these states; the mount manager tracks `loadState: 'idle' | 'loading' | 'loaded' | 'error'` per extension instance instead, and several unchecked steps above describe behaviour that exists in code only under mfe-isolation's marked regions (the expose-chunk import and CSS collection, for instance). The transitions below stay unchecked until this feature's own anchors are placed or the machine is restated over `loadState`.

**Transitions**:
1. [ ] - `p1` - **FROM** PENDING **TO** MANIFEST_RESOLVED **WHEN** the entry's manifest is present and all required fields (`metaData.publicPath`, `exposeAssets`, `shared[]`) are validated — `inst-lt-pending-to-resolved`
2. [ ] - `p1` - **FROM** PENDING **TO** LOAD_FAILED **WHEN** the manifest is absent, malformed, or required fields are missing — `inst-lt-pending-to-failed`
3. [ ] - `p1` - **FROM** MANIFEST_RESOLVED **TO** LOADING **WHEN** shared-dep blob URLs are built, expose chunk filename is confirmed, and the per-load lazy-import ABI resolver stub is minted — `inst-lt-resolved-to-loading`
4. [ ] - `p1` - **FROM** LOADING **TO** LOADED **WHEN** the expose chunk blob URL is minted, imported, and a valid lifecycle module factory is extracted — `inst-lt-loading-to-loaded`
5. [ ] - `p1` - **FROM** LOADING **TO** LOAD_FAILED **WHEN** any step in blob URL chain construction, expose chunk fetch, or lifecycle import fails — `inst-lt-loading-to-failed`

## 5. Definitions of Done

### Manifest Fields Drive Discovery — No Remote-Entry Parsing

- [x] `p1` - **ID**: `cpt-frontx-dod-mfe-loading-manifest-field-discovery`

The system **MUST** derive every locating fact needed for a microfrontend load exclusively from the declared fields of the published manifest (`metaData.publicPath`, `exposeAssets.js.sync[0]`, `exposeAssets.css.sync`, `exposeAssets.css.async`, `shared[]`) without fetching or parsing a compiled remote-entry module. The `shared[]` array's published order **MUST** be treated as an enumeration order only; the system **MUST** derive the leaves-first construction order from the fetched sources themselves, so each shared dependency's blob URL is available before the dependents that reference it as a bare specifier are processed.

**Implements**:
- `cpt-frontx-flow-mfe-loading-on-demand-load`
- `cpt-frontx-algo-mfe-loading-manifest-discovery`

**Addresses**:
- `cpt-frontx-fr-mfe-runtime-registration`
- `cpt-frontx-adr-mfe-asset-discovery`

**Constraints**: none owned — contract `template-manifest` is defined by F11 and consumed here

**Touches**:
- Entities: `MfeEntry`

### Lazy-Import ABI Inherits Parent Load Bindings

- [x] `p1` - **ID**: `cpt-frontx-dod-mfe-loading-lazy-abi-isolation`

The system **MUST** resolve every `__frontx_lazy(path)` call emitted by the build-time transform through a per-load ABI resolver that is distinct for each concurrent load, routes the lazy chunk through the same blob URL chain as the parent load, and rewrites the lazy chunk's bare specifiers to the parent load's shared-dependency blob URLs — so a lazy chunk always evaluates inside its parent load's isolated graph and inherits its shared-dependency bindings without spawning a divergent second copy of any singleton dependency. Deferred resolution **MUST** be preserved: a lazy chunk is fetched and evaluated only on first exercise.

**Implements**:
- `cpt-frontx-flow-mfe-loading-on-demand-load`
- `cpt-frontx-algo-mfe-loading-lazy-import-abi`

**Addresses**:
- `cpt-frontx-fr-mfe-runtime-registration`
- `cpt-frontx-nfr-runtime-performance` — lazy deferral keeps the eager working set small; per-load inheritance avoids duplicating shared dependencies
- `cpt-frontx-adr-lazy-import-resolution`

**Touches**:
- Entities: `MfeEntry`

### Per-Attempt Load Timeout Budget

- [x] `p1` - **ID**: `cpt-frontx-dod-mfe-loading-attempt-timeout`

The system **MUST** race every individual load attempt against the timeout budget configured on the handler, giving each retry of a failed attempt its own fresh budget rather than a share of the first attempt's. A budget that is absent or non-positive **MUST** disable the race entirely rather than expire immediately. An attempt that exceeds its budget **MUST** fail with a diagnostic load error naming the entry and the elapsed budget, and the abandoned attempt's in-flight work **MUST NOT** be treated as cancelled — anything it goes on to produce remains subject to the retention invariant of `cpt-frontx-adr-mfe-load-isolation`. On expiry the system **MUST** also release, under an identity check against the entry the abandoned attempt was waiting on, the source-text cache entries that attempt was awaiting, so a retry issues its own fetch rather than rejoining the abandoned one and expiring against the same stalled work. An attempt that fails for a reason a repeat attempt cannot change — a dependency cycle detected while building the load's isolated module graph — **MUST NOT** be retried, because every further attempt reaches the same refusal at the cost of the same fetches and the backoff between them.

**Implements**:
- `cpt-frontx-flow-mfe-loading-on-demand-load`
- `cpt-frontx-algo-mfe-loading-attempt-timeout`

**Addresses**:
- `cpt-frontx-nfr-runtime-performance` — a bounded per-attempt budget keeps a stalled fetch from holding a load open indefinitely

**Constraints**: none owned

**Touches**:
- Entities: `MfeEntry`

## 6. Acceptance Criteria

- [x] When the registry triggers an on-demand load, the system reads `manifest.metaData.publicPath`, `exposeAssets.js.sync[0]`, `exposeAssets.css.sync/async`, and `manifest.shared[]` to locate and load the expose chunk without fetching or parsing a compiled remote-entry module.
- [x] Shared dependencies declared in `manifest.shared[]` are constructed in a leaves-first order the system derives from the fetched sources rather than from the manifest's enumeration order, and each dependency's bare specifier is rewritten to its per-load blob URL before dependents that reference it are processed.
- [x] Each concurrent MFE load receives a distinct per-load `__frontx_lazy` resolver stub; a `__frontx_lazy(path)` call from load A routes to load A's resolver and not load B's.
- [x] A lazy chunk resolved via `__frontx_lazy` inherits the parent load's shared-dependency blob URL map; the same shared dependency is not fetched or instantiated a second time within one load.
- [x] Deferred resolution is preserved: a lazy chunk is fetched and its blob URL minted only when `__frontx_lazy(path)` is first exercised, not eagerly at parent-load time.
- [x] A load whose manifest is missing or whose required fields are absent transitions to LOAD_FAILED and does not progress to LOADING.
- [x] A lazy chunk whose relative path cannot be resolved within the load's known chunk set causes the load to transition to LOAD_FAILED with a diagnostic identifying the unresolvable path.
- [x] Each load attempt is raced against the configured timeout budget; a retry of a failed attempt receives its own fresh budget rather than sharing the first attempt's.
- [x] A configured timeout that is absent or non-positive disables the race, and the attempt settles on its own.
- [ ] An attempt that fails on a dependency cycle is not retried: the load rejects with the cycle diagnostic after one attempt, issuing no further source fetches and waiting out no backoff.
- [x] An attempt that exceeds its budget fails with a diagnostic naming the entry and the elapsed budget, while the abandoned attempt's in-flight work is left to run rather than cancelled.
- [x] When an attempt whose source fetch never settles expires, the retry issues its own fetch for that source instead of resolving to the abandoned attempt's in-flight one, so a retry that can succeed does succeed; the release is identity-checked and therefore leaves untouched any entry a concurrent load registered under the same key after the abandoned attempt registered its own.
- [x] The load lifecycle state machine transitions follow the sequence PENDING → MANIFEST_RESOLVED → LOADING → LOADED on the success path, and either PENDING → LOAD_FAILED or LOADING → LOAD_FAILED on error paths.
