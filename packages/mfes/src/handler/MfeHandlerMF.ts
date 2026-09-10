/**
 * Module Federation MFE Handler Implementation
 *
 * Achieves per-runtime isolation by blob-URL'ing the entire module dependency
 * chain for each load() call. Each screen/extension load gets fresh evaluations
 * of all code-split chunks and shared dependencies — no module instances are
 * shared between runtimes, with no exception. A dependency cycle admits no
 * order in which blob URLs could be minted (a blob URL is produced BY its
 * content, so a module's URL cannot exist before every dependency's URL
 * does), so a cyclic graph fails the load with a diagnostic naming the
 * chunks on the cycle rather than resolving any module from its origin URL.
 *
 * Manifest-based loading:
 * - baseUrl is derived from manifest.metaData.publicPath
 * - expose chunk filename comes from entry.exposeAssets.js.sync[0]
 * - CSS paths come from entry.exposeAssets.css.sync/async
 * - shared dep standalone ESM files are resolved from manifest.shared[].chunkPath (relative to publicPath)
 * No remoteEntry.js parsing is required.
 *
 * Bare specifier rewriting for shared deps:
 * - Shared deps are fetched as standalone ESM files from each MFE's server (chunkPath relative to publicPath).
 * - Dependency order is derived from the fetched sources themselves, not from
 *   manifest.shared[]'s enumeration order; shared deps that import one another
 *   circularly admit no such order and fail the load with a diagnostic.
 * - Within expose chunks and their dependency chains, bare specifiers (e.g. from "react")
 *   are rewritten to the pre-built blob URLs for the corresponding shared dep.
 * - This gives per-load isolation without any MF 2.0 runtime involvement.
 *
 * @packageDocumentation
 */
// @cpt-dod:cpt-frontx-dod-mfe-isolation-blob-core:p1
// @cpt-dod:cpt-frontx-dod-mfe-isolation-manifest-reference-resolution:p1
// @cpt-state:cpt-frontx-state-mfe-isolation-module-lifecycle:p1
// @cpt-state:cpt-frontx-state-mfe-loading-load-lifecycle:p1

import type { MfeEntryMF } from '../types/mfe-entry-mf';
import type { MfManifest } from '../manifest/mf-manifest';
import { LazyLoaderRegistry } from '../lazy-loader/lazy-loader-registry';
import {
  MfeHandler,
  ChildMfeBridge,
  MfeEntryLifecycle,
} from './types';
import { MfeLoadError } from '../errors';
import { RetryHandler } from './retry-handler';
import { MfeBridgeFactoryDefault } from './mfe-bridge-factory-default';
import {
  sourceImports,
  rewriteBareSpecifier,
  importBlobModule,
} from './mf-dynamic-module-ops';

const RUNTIME_STYLE_ID_PREFIX = '__frontx-mfe-runtime-style-';

/**
 * Width of every bounded fan-out in this file: the number of chunk-source
 * fetches one chain build may have in flight at once (see
 * {@link FetchBudget}), and the number of concurrent invocations within one
 * {@link boundedMap} batch (the shared-dep source fetches of a single
 * manifest).
 *
 * The width is chosen to stay well short of the browser's per-origin
 * connection pool, so that added concurrency still shortens wall-clock time
 * instead of just queuing behind that pool, while an unbounded fan-out
 * risks minting page-lifetime blob URLs (see the never-revoke invariant on
 * {@link createBlobUrlChainInternal}) for work a failed load will never
 * use.
 */
const MAX_CONCURRENT_FETCHES = 6;

/**
 * Single concurrency budget shared by every fetch of one chain build.
 *
 * A per-batch limit is not enough for the recursive chunk graph: a batch
 * opened at each recursion level and for each sibling group multiplies the
 * width by the graph's bushiness, so a deep, wide graph can put an
 * arbitrary number of fetches in flight even though every individual batch
 * is "bounded". One budget instance lives on the {@link ChainBuildState} of
 * a build and is acquired around the chunk-source fetch itself, so the
 * bound holds for the whole build regardless of depth or sibling-group
 * count.
 *
 * A slot is held ONLY across the source fetch, never across a recursion
 * into a dependency: a parent holding a slot while waiting for its
 * children's fetches would deadlock as soon as the graph is deeper than
 * the width. Waiters are released strictly first-in-first-out, so siblings
 * admitted from one fan-out enter in declaration order.
 */
class FetchBudget {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(width: number) {
    this.available = width;
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Hand the slot directly to the longest-waiting acquirer when there is
   * one (rather than incrementing and letting an arbitrary waiter win the
   * next turn of the event loop), which is what keeps the in-flight count
   * exactly at the width under saturation.
   */
  release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    this.available += 1;
  }
}

/**
 * Run `task` over `items` with at most {@link MAX_CONCURRENT_FETCHES}
 * concurrent in-flight invocations. Returns one settled result per item, in
 * the SAME order as `items` (not completion order) — callers that need
 * deterministic, declaration-order error reporting (rather than
 * first-to-reject-in-wall-clock-time) can scan the returned array in order
 * for the first `rejected` entry.
 *
 * Used for the flat shared-dep batch only. The recursive chunk graph fans
 * its siblings out unbounded and throttles the fetches themselves through
 * the build-scoped {@link FetchBudget} instead, because a per-batch pool
 * cannot bound a recursion (see that class).
 *
 * Each `task` invocation runs synchronously up to its first `await` before
 * the pool moves on to start the next one, so any synchronous check-then-set
 * a caller performs before its own first `await` (e.g. a cache lookup
 * followed by issuing a fetch) is preserved relative to that item's own
 * fetch — only the *waiting* is made concurrent, not the dispatch ordering
 * guarantees a caller already relies on.
 */
async function boundedMap<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        const value = await task(items[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  };

  const workerCount = Math.min(MAX_CONCURRENT_FETCHES, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * An in-progress {@link MfeHandlerMF.createBlobUrlChain} construction.
 *
 * `lineage` is the set of ancestor filenames whose construction this entry
 * is nested under. It starts as a copy of the constructing call's own
 * ancestor set and grows afterward: any other branch that joins this entry
 * instead of constructing it contributes its own lineage in, so a cycle
 * that only becomes visible once two independently-fanned-out branches
 * meet can still be detected from either side (see the doc comment on
 * {@link MfeHandlerMF.createBlobUrlChain}).
 *
 * A branch that detects a cycle rejects rather than returning (see
 * {@link MfeHandlerMF.onDependencyCycleDetected}), and the rejection fails
 * the whole chain build, so no branch ever stops awaiting this entry while
 * leaving its contribution behind. The lineage therefore never outlives the
 * build whose branches wrote it, and it names exactly the branches waiting
 * on this construction rather than an over-approximation of them.
 */
interface InFlightChainEntry {
  readonly promise: Promise<void>;
  readonly lineage: Set<string>;
}

/**
 * Per-load shared state for blob URL chain creation.
 *
 * Shared across all blob URL chains within a single load() call so that
 * common transitive dependencies (e.g., the bundled React CJS module) are
 * blob-URL'd once and reused by all modules within the same load.
 */
// @cpt-state:cpt-frontx-state-mfe-isolation-load-blob-state:p1
interface LoadBlobState {
  readonly blobUrlMap: Map<string, string>;
  /**
   * Stores the in-flight promise for each filename currently being
   * constructed, rather than its resolved value, precisely so that
   * concurrent callers for the same filename can share one construction
   * instead of each starting (and blob-URL'ing) their own — the value only
   * ever settles to a resolved blob URL through `blobUrlMap`, checked
   * before this map, once the construction completes.
   */
  readonly inFlight: Map<string, InFlightChainEntry>;
  readonly baseUrl: string;
  /** MFE entry ID for this load; used in error messages. */
  readonly entryId: string;
  /** Shared dep blob URLs: package name → blob URL. Built before the expose chain. */
  readonly sharedDepBlobUrls: Map<string, string>;
  /**
   * Entry-chunk path (relative to `baseUrl`) for this load. Used as the
   * resolution base when `__frontx_lazy('<rel>')` is invoked at runtime:
   * Rollup emits dynamic-import paths relative to the importing chunk's
   * directory, and every MFE chunk in a Vite build lives in the same
   * output directory as the entry chunk, so the entry chunk's path is
   * the correct resolution base for any lazy chunk in the load.
   */
  readonly entryChunkFilename: string;
  /**
   * Blob URL of the per-load `__frontx_lazy` loader stub module. Lazily
   * minted on the first chunk that contains a `__frontx_lazy(` call and
   * reused for every subsequent chunk in the same load. Closed over this
   * load's resolver in the host-side global registry — sibling loads get
   * distinct stub URLs so a chunk's `__frontx_lazy(./X)` call routes back
   * to the parent load that owns it.
   *
   * Mutable: this is the single field in `LoadBlobState` that the chain
   * code mutates after construction. Kept on `LoadBlobState` rather than
   * a side-map so that the per-load lifetime tracking is co-located with
   * the rest of the load's blob URLs (per ADR-0004 + ADR-0022, the stub
   * URL is owned by the same load and shares its never-revoke invariant).
   */
  lazyLoaderUrl?: string;
  /**
   * The ledger of the load ATTEMPT that built this state, if the attempt is
   * raced against a timeout budget. Threaded here rather than passed down
   * every chain-build signature because `loadState` already reaches every
   * source-text fetch in the load. Absent for a state built outside an
   * attempt (a hand-built one in tests, for instance).
   *
   * Note that a lazy chunk resolved through this state long after the load
   * settled still records into the ledger; that is harmless, because the
   * ledger stops recording once released and is only ever released while
   * its own attempt is still in flight.
   */
  readonly attemptLedger?: AttemptSourceTextLedger;
}

/**
 * Per-chain-build state: the build's failure signal, its fetch-concurrency
 * budget, and the set of chunks it has already diagnosed a dependency cycle
 * for.
 *
 * A single call into {@link MfeHandlerMF.createBlobUrlChain} — the initial
 * expose-chunk build for a load, or one later {@link
 * MfeHandlerMF.resolveLazyChunk} call reached through the lazy-import ABI —
 * is one "chain build". Every recursive fan-out inside that one build
 * shares one `ChainBuildState` instance, created fresh by whichever
 * method starts the build.
 *
 * This is deliberately NOT part of {@link LoadBlobState}: `LoadBlobState`
 * lives for the whole load (page lifetime, per the never-revoke invariant)
 * and is shared by every lazy chunk resolved through it, but "a fetch
 * failed somewhere in this build" must not survive past the build it
 * happened in. A `LoadBlobState`-scoped flag would latch permanently after
 * the first failed lazy import — poisoning every later, otherwise
 * independent, lazy import on the same already-mounted MFE, with no retry
 * path short of a full page reload. Scoping the flag to one build instead
 * means a failed lazy import fails only its own `resolveLazyChunk` call;
 * the next lazy import starts its own fresh `ChainBuildState` and is
 * unaffected.
 *
 * Sibling continuations belonging to the SAME build still check `inFlight`
 * (on `LoadBlobState`) to join or await one another's construction — this
 * token governs only "stop starting new work because a
 * sibling in my own build already failed", never cross-build promise
 * rejection, which continues to propagate through the shared `inFlight`
 * promise itself (a build awaiting a promise another build created still
 * sees that promise reject on its own terms).
 */
interface ChainBuildState {
  failed: boolean;
  /**
   * Single concurrency budget for every chunk-source fetch this build
   * issues — see {@link FetchBudget} for why the bound has to be build-wide
   * rather than per fan-out batch.
   */
  readonly fetchBudget: FetchBudget;
  /**
   * Filenames this build has already raised a dependency-cycle diagnostic
   * for, so the same cycle is reported once per build however many branches
   * run into it (see {@link MfeHandlerMF.onDependencyCycleDetected}).
   *
   * Build-scoped for the same reason `failed` is: a detected cycle is a
   * fact about one build's traversal, not about the load.
   */
  readonly reportedCycles: Set<string>;
}

/**
 * Marker for a load failure a repeat attempt cannot change.
 *
 * A dependency cycle is a property of the microfrontend's build, so every
 * attempt reaches the same refusal: retrying only multiplies the source
 * fetches and delays the same user-visible error by the retry backoff. The
 * marker is a module-private symbol rather than an error subclass so that
 * `MfeLoadError` — the handler's public error contract — is unchanged.
 */
const DETERMINISTIC_LOAD_FAILURE = Symbol('frontx.deterministicLoadFailure');

/** Mark `error` as one no further attempt could change, and return it. */
function markDeterministicLoadFailure<E extends Error>(error: E): E {
  Object.defineProperty(error, DETERMINISTIC_LOAD_FAILURE, { value: true });
  return error;
}

/**
 * Sentinel wrapper carrying a deterministic failure out of the retry loop as
 * a fulfilment, so `RetryHandler` — which retries every rejection — makes no
 * further attempt. Unwrapped by `load()` into the original rejection.
 */
const DETERMINISTIC_FAILURE = Symbol('frontx.deterministicFailure');

interface DeterministicFailure {
  readonly [DETERMINISTIC_FAILURE]: Error;
}

function isDeterministicFailureSentinel(
  value: unknown
): value is DeterministicFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    DETERMINISTIC_FAILURE in (value as object)
  );
}

/** Whether `error` was marked by {@link markDeterministicLoadFailure}. */
function isDeterministicLoadFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[DETERMINISTIC_LOAD_FAILURE] === true
  );
}

/**
 * Name the shared dependencies left unresolved by a stalled dependency-order
 * pass, together with the imports among them that close the cycle.
 */
function describeSharedDepCycle(pending: ReadonlyMap<string, string>): string {
  const names = [...pending.keys()];
  return names
    .map((name) => {
      const importsOthers = names.filter(
        (other) => other !== name && sourceImports(pending.get(name) ?? '', other)
      );
      return importsOthers.length > 0
        ? `'${name}' (imports ${importsOthers.map((o) => `'${o}'`).join(', ')})`
        : `'${name}'`;
    })
    .join(', ');
}

/** Start a fresh chain build (see {@link ChainBuildState}). */
// @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-build-failure-scope
function createChainBuildState(): ChainBuildState {
  return {
    failed: false,
    fetchBudget: new FetchBudget(MAX_CONCURRENT_FETCHES),
    reportedCycles: new Set<string>(),
  };
}
// @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-build-failure-scope

/**
 * Internal cache for Module Federation manifests.
 */
class ManifestCache {
  private readonly manifests = new Map<string, MfManifest>();

  cacheManifest(manifest: MfManifest): void {
    this.manifests.set(manifest.id, manifest);
  }

  getManifest(manifestId: string): MfManifest | undefined {
    return this.manifests.get(manifestId);
  }
}

/**
 * Minimal LRU cache with fixed capacity. Leverages insertion-order semantics
 * of `Map`: each `get` re-inserts the key (moving it to the end, i.e. "most
 * recent"), and `set` evicts the oldest key when capacity would be exceeded.
 *
 * We use this for source-text caches to prevent unbounded growth on
 * long-running hosts that accumulate many distinct chunk URLs over time
 * (a partial miss on issue #253).
 *
 * @internal Exported for unit testing; not part of the public API.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError(`LruCache capacity must be a positive integer, got ${capacity}`);
    }
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    // Re-insert to mark as most-recently-used.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    // If already present, delete first so the re-insert moves it to the end.
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict the oldest (first) key.
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }
}

/**
 * Max source-text entries retained. Expose-chunk entries evict oldest-first.
 *
 * Concurrent fan-out (see {@link boundedMap}) can insert up to
 * {@link MAX_CONCURRENT_FETCHES} entries from a single burst instead of one
 * at a time, which raises eviction odds under this capacity versus a
 * strictly-sequential insertion pattern. This is not a correctness break —
 * `LruCache.delete` only removes the map entry;
 * a caller already holding the evicted entry's promise still resolves it
 * (see {@link LruCache}) — but a too-small capacity can reduce the
 * cross-MFE cache hit rate for large expose chains. 256 comfortably covers
 * realistic per-load chunk counts (an expose chain rarely exceeds a few
 * dozen static-import chunks) with headroom for several concurrent loads'
 * worth of burst insertions; re-evaluate upward if a real MFE's static
 * import graph approaches this width.
 */
const SOURCE_TEXT_CACHE_CAPACITY = 256;
/**
 * Max shared-dep text entries retained (keyed by name@version, cross-MFE).
 *
 * Same burst-eviction trade-off as {@link SOURCE_TEXT_CACHE_CAPACITY}
 * applies here, scaled down: shared deps are bounded by the distinct
 * npm-published packages declared across all MFEs' `rollupOptions.external`
 * (typically far fewer than the number of chunks any one MFE emits), so 128
 * keeps ample headroom even with concurrent fan-out bursts of up to
 * {@link MAX_CONCURRENT_FETCHES} per load.
 */
const SHARED_DEP_TEXT_CACHE_CAPACITY = 128;

/**
 * One load attempt's record of the source-text cache entries it is waiting
 * on, so the attempt's abandonment on timeout can release them.
 *
 * `MfeHandlerMF.fetchSourceText` publishes its in-flight fetch promise in
 * the handler-level, URL-keyed `sourceTextCache` (and
 * `buildSharedDepBlobUrls` does the same in the `name@version`-keyed
 * `sharedDepTextCache`), evicting it only when it REJECTS. A fetch that
 * never settles is therefore never evicted, so the retry that follows a
 * timeout rejoins the very promise the timed-out attempt already gave up
 * on and expires against its own budget in turn — the timeout bounds the
 * hang without ever recovering from it.
 *
 * Every attempt gets its own ledger (created per invocation of the retry
 * callback in {@link MfeHandlerMF.load}). Each cache entry the attempt
 * registers OR joins is recorded here; on timeout {@link release} removes
 * exactly those entries, so the next attempt issues its own fetch. A blunt
 * "clear the cache" would instead discard entries other, still-live loads
 * are legitimately waiting on.
 */
class AttemptSourceTextLedger {
  private readonly entries: Array<{
    readonly cache: LruCache<string, Promise<string>>;
    readonly key: string;
    readonly promise: Promise<string>;
    settled: boolean;
  }> = [];

  private released = false;

  /**
   * Record that this attempt is waiting on `promise` under `key` in
   * `cache`. Entries that settle before {@link release} are marked and
   * skipped there: a settled entry is not one the attempt is still
   * waiting on, and dropping it would only cost the cache a legitimate
   * hit. Recording stops once the ledger is released — anything the
   * abandoned attempt's background work registers afterwards belongs to
   * that work, not to a retry this ledger can still speak for.
   */
  record(
    cache: LruCache<string, Promise<string>>,
    key: string,
    promise: Promise<string>
  ): void {
    if (this.released) {
      return;
    }
    const entry = { cache, key, promise, settled: false };
    const markSettled = (): void => {
      entry.settled = true;
    };
    promise.then(markSettled, markSettled);
    this.entries.push(entry);
  }

  /**
   * Release the still-unsettled cache entries this attempt was waiting on.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-abandoned-source-text
  release(): void {
    this.released = true;
    for (const entry of this.entries) {
      if (entry.settled) {
        continue;
      }
      // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-identity-checked
      // Identity-checked, exactly as the eviction-on-rejection in
      // `fetchSourceText` and `buildSharedDepBlobUrls` is: remove the key
      // only while it still maps to the very promise this attempt was
      // waiting on, never one a concurrent load has since registered
      // under the same key.
      if (entry.cache.get(entry.key) === entry.promise) {
        entry.cache.delete(entry.key);
      }
      // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-identity-checked
    }
    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-not-cancel
    // Releasing an entry is NOT cancelling the work behind it: no
    // `AbortController` is signalled here and none exists in this file, so
    // the abandoned fetch runs to completion (`inst-lto-no-cancel` holds
    // unchanged) — only the cache mapping goes, so the retry cannot
    // resolve to it. The accepted cost is that the abandoned fetch and the
    // retry's own fetch may be in flight for the same source at once, the
    // price of a retry that can actually succeed.
    this.entries.length = 0;
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-not-cancel
  }
  // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-abandoned-source-text
}

/**
 * Configuration for MFE loading behavior.
 */
interface MfeLoaderConfig {
  timeout?: number;
  retries?: number;
}

/**
 * Module Federation handler for loading MFE bundles.
 *
 * For each load() call:
 *  1. Resolves the MfManifest (validates metaData.publicPath and shared[])
 *  2. Derives baseUrl from manifest.metaData.publicPath
 *  3. Reads the expose chunk filename from entry.exposeAssets.js.sync[0]
 *  4. Builds blob URLs for shared deps from standalone ESM files (leaves first)
 *  5. Creates a blob URL chain for the expose chunk and all its static deps,
 *     rewriting bare specifiers to the pre-built shared dep blob URLs
 *  6. All blob URLs share a per-load map so common transitive deps are
 *     evaluated once within the same load
 */
class MfeHandlerMF extends MfeHandler<MfeEntryMF, ChildMfeBridge> {
  /**
   * Process-wide load cache.
   *
   * Keyed by the EXTENSION INSTANCE ID — the `id` field of the registered
   * `MfeExtension` whose entry is being loaded. Two extensions registered
   * against the same `MfeEntry` definition (sibling extensions sharing an
   * `entry.id`) populate DISTINCT cache entries — distinct blob URL chains,
   * distinct module evaluations, distinct module-scope state — per ADR-0004
   * (`cpt-frontx-adr-mfe-load-isolation`) + ADR-0020
   * (`cpt-frontx-adr-mfe-state-lifecycle-boundary`) isolation invariant.
   * Sibling isolation is the handler's responsibility, not the MFE author's.
   *
   * Re-mount of the SAME extension instance (same `extensionId`) reuses the
   * cached load — same blob URLs, same module instance, same
   * `MfeEntryLifecycle` reference, satisfying the never-revoke invariant.
   *
   * Cache lifetime = page lifetime. No eviction except on load failure
   * (a rejected promise is removed so a subsequent load can retry from
   * scratch). Memory bound = catalog-bounded by unique extension instance
   * IDs ever loaded.
   */
  // @cpt-dod:cpt-frontx-dod-mfe-isolation-handler-load-cache:p1
  private static loadCache = new Map<string, Promise<MfeEntryLifecycle<ChildMfeBridge>>>();

  readonly bridgeFactory: MfeBridgeFactoryDefault;
  private readonly manifestCache: ManifestCache;
  private readonly config: MfeLoaderConfig;
  private readonly retryHandler: RetryHandler;
  // LRU-bounded so a long-running host that loads many distinct MFEs cannot
  // grow the cache without limit. Expose-chunk source text has no reuse
  // value after its load settles, so oldest-first eviction is acceptable.
  private readonly sourceTextCache = new LruCache<string, Promise<string>>(
    SOURCE_TEXT_CACHE_CAPACITY,
  );

  /**
   * Cross-runtime shared dep source text deduplication.
   * Keyed by `name@version`. The first MFE to load a given shared dep
   * caches its source text here. Subsequent MFEs declaring the same
   * name@version get a cache hit — zero network fetch, regardless of
   * which server hosts the MFE.
   *
   * LRU-bounded for the same reason as `sourceTextCache`. Shared deps are
   * naturally fewer (only npm-published packages declared in `rollupOptions.external`),
   * but the cap defends against a pathological host that keeps adding new
   * versions over time.
   */
  private readonly sharedDepTextCache = new LruCache<string, Promise<string>>(
    SHARED_DEP_TEXT_CACHE_CAPACITY,
  );


  constructor(
    handledBaseTypeId: string,
    config: MfeLoaderConfig = {}
  ) {
    super(handledBaseTypeId, 0);
    this.bridgeFactory = new MfeBridgeFactoryDefault();
    this.manifestCache = new ManifestCache();
    this.retryHandler = new RetryHandler();
    this.config = {
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 2,
    };
  }

  /**
   * Load an MFE bundle using Module Federation.
   *
   * Cache is keyed by `extensionId` (the extension instance ID), not by
   * `entry.id`. Two extensions sharing the same `entry` definition get
   * distinct cache entries and distinct module evaluations.
   */
  // @cpt-flow:cpt-frontx-flow-mfe-isolation-load:p1
  async load(
    entry: MfeEntryMF,
    extensionId: string
  ): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-register
    // Registry registration happens via MFE host framework
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-register
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-trigger-load
    // Load action triggered by actor via MFE host
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-trigger-load
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-check-cache
    const cached = MfeHandlerMF.loadCache.get(extensionId);
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-check-cache
    if (cached !== undefined) {
    // Registry registration happens via MFE host framework
    // Load action triggered by actor via MFE host
      // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-if-cached
      // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-return-cached
      return cached;
      // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-return-cached
      // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-if-cached
    }
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-else-new-load
    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-per-attempt-budget
    // The timeout wraps the ATTEMPT, inside the retry loop — every retry of
    // a failed attempt is raced against its own fresh budget rather than
    // sharing the first attempt's, so a load's worst-case wall clock is the
    // budget times the attempt count plus `RetryHandler`'s backoff.
    // Each attempt gets its own ledger of the source-text cache entries it
    // waits on, so a timeout releases exactly that attempt's entries and
    // the retry issues its own fetch (see `AttemptSourceTextLedger`).
    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-if-deterministic-failure
    // A deterministic refusal — today, a dependency cycle in the
    // microfrontend's own chunk graph — is settled as a FULFILLED sentinel
    // rather than a rejection, so `RetryHandler` sees nothing to retry: no
    // further attempt is made, no backoff is waited, and the fetches are
    // not multiplied. The sentinel is unwrapped back into the original
    // rejection immediately below, so callers of `load()` see exactly the
    // error the attempt raised. Every other failure keeps rejecting and so
    // keeps its retries.
    const promise = this.retryHandler
      .retry<MfeEntryLifecycle<ChildMfeBridge> | DeterministicFailure>(
        async () => {
          const ledger = new AttemptSourceTextLedger();
          try {
            return await this.withLoadTimeout(
              this.loadInternal(entry, ledger),
              entry.id,
              ledger
            );
          } catch (error) {
            if (isDeterministicLoadFailure(error)) {
              // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-no-retry-deterministic
              return { [DETERMINISTIC_FAILURE]: error as Error };
              // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-no-retry-deterministic
            }
            throw error;
          }
        },
        this.config.retries ?? 0,
        1000
      )
      .then((result) => {
        if (isDeterministicFailureSentinel(result)) {
          throw result[DETERMINISTIC_FAILURE];
        }
        return result;
      });
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-if-deterministic-failure
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-per-attempt-budget
    // @cpt-begin:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-to-isolated
    MfeHandlerMF.loadCache.set(extensionId, promise);
    // @cpt-end:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-to-isolated
    // On failure, evict so future calls can retry from scratch.
    // Identity check guards against racing with a newer successful load.
    // @cpt-begin:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-load-failed-retry
    promise.catch(() => {
      if (MfeHandlerMF.loadCache.get(extensionId) === promise) {
        MfeHandlerMF.loadCache.delete(extensionId);
      }
    });
    // @cpt-end:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-load-failed-retry
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-else-new-load
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-resolve-manifest
    // Manifest resolved inside loadInternal()
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-resolve-manifest
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-build-shared-blobs
    // Shared blob URLs built inside loadInternal()
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-build-shared-blobs
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-build-expose-chain
    // Expose blob URL chain built inside loadInternal()
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-build-expose-chain
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-actor-mount
    // Actor mounts lifecycle via registry/extension domain
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-actor-mount
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-return-lifecycle
    return promise;
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-return-lifecycle
  }

  /**
   * Race a single load attempt against `this.config.timeout`.
   *
   * `config.timeout` is consulted here rather than left unused: without a
   * race against a timer, `RetryHandler.retry` only retries on a thrown
   * error, so a load that hangs (network never resolves, a dependency
   * cycle, etc.) leaves the returned promise pending forever. Racing the
   * attempt against a timer converts that into BOUNDED FAILURE: after a
   * known wall-clock budget the caller gets a diagnostic `MfeLoadError`
   * instead of a promise that never settles.
   *
   * The race is also a recovery path, not only a bound.
   * {@link fetchSourceText} stores the in-flight fetch promise in the
   * handler-level, URL-keyed `sourceTextCache` (and
   * {@link buildSharedDepBlobUrls} does the same in the
   * `name@version`-keyed `sharedDepTextCache`) and evicts it only when
   * that promise REJECTS, so a fetch that never settles would never be
   * evicted and every retry would rejoin the same hung promise and expire
   * against its own budget in turn. On expiry this method therefore
   * releases the entries the abandoned attempt was waiting on, through
   * that attempt's {@link AttemptSourceTextLedger} and under the same
   * identity check the eviction-on-rejection uses, so the next attempt
   * issues its own fetch and can actually succeed.
   *
   * Releasing those cache entries is not cancellation: this method still
   * does not cancel the underlying fetch/blob-URL work in flight when the
   * timer wins the race — there is no `AbortController`
   * plumbed through this file (see the sibling {@link boundedMap} fan-out,
   * which relies on a `ChainBuildState` token rather than cancellation
   * for the same reason) — so a timed-out attempt's background work keeps
   * running to completion and its results are simply never observed by
   * this call.
   *
   * `this.config.timeout` is never `undefined` in practice — the
   * constructor fills `config.timeout ?? 30000`, and `??` only substitutes
   * `null`/`undefined`, so an explicit `0` (or any other falsy number)
   * passed by a caller survives the constructor unchanged. A timeout of
   * `0` is the conventional "disable the timeout" idiom, so it — and any
   * other non-positive value — is treated as "no timeout" below rather
   * than as a zero-delay timer that would fail every attempt immediately.
   *
   * This method races ONE attempt, not one `load()` call. `RetryHandler`
   * (see {@link RetryHandler.retry}) wraps every retry of a failed attempt
   * in its own call to this method, so with the defaults (`timeout: 30000`,
   * `retries: 2`) a single `load()` call's worst-case wall clock is roughly
   * `timeout × (retries + 1)` plus `RetryHandler`'s exponential backoff
   * between attempts — on the order of 90+ seconds, not the 30 seconds the
   * `timeout` field name alone would suggest.
   */
  // @cpt-algo:cpt-frontx-algo-mfe-loading-attempt-timeout:p1
  // @cpt-dod:cpt-frontx-dod-mfe-loading-attempt-timeout:p1
  private withLoadTimeout<T>(
    attempt: Promise<T>,
    entryId: string,
    ledger?: AttemptSourceTextLedger
  ): Promise<T> {
    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-read-budget
    const timeoutMs = this.config.timeout;
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-read-budget
    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-if-disabled
    if (timeoutMs === undefined || timeoutMs <= 0) {
      // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-return-unraced
      return attempt;
      // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-return-unraced
    }
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-if-disabled

    let timer: ReturnType<typeof setTimeout>;
    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-if-elapsed
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-raise-timeout
        reject(
          new MfeLoadError(
            `MFE load for '${entryId}' timed out after ${timeoutMs}ms`,
            entryId
          )
        );
        // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-raise-timeout
        // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-no-cancel
        // Nothing is aborted here: the losing attempt's fetches and blob
        // URL construction keep running to completion, their results
        // simply never observed by this call (see this method's doc
        // comment and the retention invariant of ADR-0004).
        // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-no-cancel
        // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-abandoned-source-text
        // What IS given up is this attempt's claim on the source-text
        // cache entries it was waiting on: released (identity-checked,
        // never cancelled) so the retry issues its own fetch instead of
        // rejoining the abandoned attempt's hung one.
        ledger?.release();
        // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-release-abandoned-source-text
      }, timeoutMs);
    });
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-if-elapsed

    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-race-attempt
    // @cpt-begin:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-return-attempt
    return Promise.race([attempt, timeout]).finally(() => clearTimeout(timer));
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-return-attempt
    // @cpt-end:cpt-frontx-algo-mfe-loading-attempt-timeout:p1:inst-lto-race-attempt
  }

  /**
   * Internal load implementation.
   * Each call creates a fully isolated module evaluation chain via blob URLs.
   */
  private async loadInternal(
    entry: MfeEntryMF,
    ledger?: AttemptSourceTextLedger
  ): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    // @cpt-begin:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-register-entry
    const manifest = await this.resolveManifest(entry.manifest);
    this.manifestCache.cacheManifest(manifest);
    // @cpt-end:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-register-entry

    // @cpt-begin:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-trigger-load
    const { moduleFactory, stylesheetPaths, baseUrl } = await this.loadExposedModuleIsolated(
      manifest,
      entry.exposedModule,
      entry.exposeAssets,
      entry.id,
      ledger
    );
    // @cpt-end:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-trigger-load

    const loadedModule = moduleFactory();

    if (!this.isValidLifecycleModule(loadedModule)) {
      throw new MfeLoadError(
        `Module '${entry.exposedModule}' must implement MfeEntryLifecycle interface (mount/unmount)`,
        entry.id
      );
    }

    // @cpt-begin:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-return-lifecycle
    return this.wrapLifecycleWithStylesheets(
      loadedModule,
      stylesheetPaths,
      baseUrl
    );
    // @cpt-end:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-return-lifecycle
  }

  /**
   * Load an exposed module with full per-runtime isolation.
   *
   * Creates a per-load blob URL chain:
   *  1. Shared dep standalone ESM files are blob-URL'd first (leaves first, dependency order)
   *  2. The expose chunk and all its static deps are blob-URL'd with bare specifiers
   *     rewritten to shared dep blob URLs
   *
   * baseUrl is derived from manifest.metaData.publicPath rather than parsing
   * remoteEntry.js — the publicPath field gives the exact chunk base URL.
   *
   * Blob URLs are NOT revoked — modules with top-level await continue
   * evaluating after import() resolves, and revoking during async evaluation
   * causes ERR_FILE_NOT_FOUND. Blob URLs are cleaned up by the browser on
   * page unload.
   */
  private async loadExposedModuleIsolated(
    manifest: MfManifest,
    exposedModule: string,
    exposeAssets: MfeEntryMF['exposeAssets'],
    entryId: string,
    ledger?: AttemptSourceTextLedger
  ): Promise<{
    moduleFactory: () => unknown;
    stylesheetPaths: string[];
    baseUrl: string;
  }> {
    // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-read-public-path
    // publicPath is the authoritative base URL for all chunks in this MFE.
    const baseUrl = manifest.metaData.publicPath;
    this.assertResolvedPublicPath(baseUrl, entryId);
    // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-read-public-path

    // @cpt-begin:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-run-manifest-discovery
    // Build shared dep blob URLs first (leaves first, dependency order).
    // Each dep's standalone ESM may import other shared deps as bare specifiers;
    // those are rewritten to already-resolved blob URLs before creating the blob.
    const sharedDepBlobUrls = await this.buildSharedDepBlobUrls(
      manifest,
      entryId,
      ledger
    );
    // @cpt-end:cpt-frontx-flow-mfe-loading-on-demand-load:p1:inst-run-manifest-discovery

    // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-read-expose-chunk
    // Derive expose chunk filename directly from entry metadata — no regex needed.
    const exposeChunkFilename = exposeAssets.js.sync[0];
    if (!exposeChunkFilename) {
      throw new MfeLoadError(
        `Cannot resolve expose chunk for '${exposedModule}': exposeAssets.js.sync is empty`,
        entryId
      );
    }
    // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-read-expose-chunk

    // @cpt-begin:cpt-frontx-state-mfe-isolation-load-blob-state:p1:inst-blob-building
    const loadState: LoadBlobState = {
      blobUrlMap: new Map(),
      inFlight: new Map(),
      baseUrl,
      entryId,
      sharedDepBlobUrls,
      entryChunkFilename: exposeChunkFilename,
      attemptLedger: ledger,
    };
    // @cpt-end:cpt-frontx-state-mfe-isolation-load-blob-state:p1:inst-blob-building

    // Fresh per-build failure token for this chain build (see
    // `ChainBuildState`) — scoped to this one expose-chunk build, not to
    // `loadState`, which lives for the whole page-lifetime load.
    const build = createChainBuildState();

    // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-read-css
    // Collect CSS paths from exposeAssets (sync injected at mount; async lazy).
    const stylesheetPaths = [
      ...exposeAssets.css.sync,
      ...exposeAssets.css.async,
    ];
    // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-read-css

    // Build blob URL chain for the expose chunk and all its static deps.
    // Bare specifiers within those chunks are rewritten to shared dep blob URLs.
    await this.createBlobUrlChain(loadState, exposeChunkFilename, build);

    const exposeBlobUrl = loadState.blobUrlMap.get(exposeChunkFilename);
    if (!exposeBlobUrl) {
      throw new MfeLoadError(
        `Failed to create blob URL for expose chunk '${exposeChunkFilename}'`,
        entryId
      );
    }

    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-import-expose
    const exposeModule = await importBlobModule(exposeBlobUrl);
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-import-expose

    // @cpt-begin:cpt-frontx-state-mfe-isolation-load-blob-state:p1:inst-blob-complete
    // The expose chunk exports the lifecycle object as `default`. Fall back to
    // the full module if default is absent (non-MF ESM expose pattern).
    const moduleRecord = exposeModule as Record<string, unknown>;
    return {
      moduleFactory: () => moduleRecord['default'] ?? exposeModule,
      stylesheetPaths,
      baseUrl,
    };
    // @cpt-end:cpt-frontx-state-mfe-isolation-load-blob-state:p1:inst-blob-complete
  }

  /**
   * Guard against Module Federation's unresolved `"auto"` publicPath
   * placeholder reaching the fetch layer.
   *
   * `MfManifestMetaData.publicPath` is documented (and by the handler's own
   * contract, at {@link loadExposedModuleIsolated}) as an already-resolved
   * absolute URL or `'/'` — never the literal string MF 2.0 emits when a
   * remote's `vite.config.ts` does not set an explicit `publicPath` (MF's
   * own runtime resolves `"auto"` from the script tag that loaded
   * `remoteEntry.js`; this handler never loads `remoteEntry.js` at all, so
   * that resolution point does not exist here — see the file header comment).
   *
   * The handler has no channel to recover the real origin at this point:
   * `manifest` arrives either inlined in `MfeEntryMF` or looked up by ID from
   * an in-process cache (see {@link resolveManifest}), with no fetch
   * response / page-relative context carried alongside it. Resolving
   * `"auto"` to a concrete origin is therefore the responsibility of
   * whatever produces the `MfManifest` (e.g. a build-time manifest
   * aggregator) — NOT this handler.
   *
   * Without this guard, `"auto"`/`"auto/"` gets silently concatenated into
   * every chunk fetch URL, producing a same-origin relative request that a
   * Vite dev server's SPA fallback answers with a 200 index.html — a load
   * failure that looks like a `SyntaxError` deep in module evaluation
   * instead of a clear, fail-fast diagnostic at the point of the actual
   * misconfiguration.
   */
  private assertResolvedPublicPath(publicPath: string, entryId: string): void {
    if (publicPath === 'auto' || publicPath === 'auto/') {
      throw new MfeLoadError(
        `manifest.metaData.publicPath is the unresolved Module Federation ` +
          `placeholder "${publicPath}". This handler requires an already-` +
          `resolved absolute URL (or '/') — resolve "auto" to the MFE's real ` +
          `serving origin when producing the MfManifest (e.g. in the build-time ` +
          `manifest generator), not at handler load time.`,
        entryId
      );
    }
  }

  // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-if-bad-lifecycle
  // Lifecycle contract validation failure path
  // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-if-bad-lifecycle
  // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-evict-raise
  // Evict cache and raise load error on bad lifecycle
  // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-evict-raise
  // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-validate-lifecycle
  private isValidLifecycleModule(
    module: unknown
  ): module is MfeEntryLifecycle<ChildMfeBridge> {
    if (typeof module !== 'object' || module === null) {
      return false;
    }
    const candidate = module as Record<string, unknown>;
    return (
      typeof candidate.mount === 'function' &&
      typeof candidate.unmount === 'function'
    );
  }
  // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-validate-lifecycle

  // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-cache-promise
  private wrapLifecycleWithStylesheets(
    lifecycle: MfeEntryLifecycle<ChildMfeBridge>,
    stylesheetPaths: string[],
    baseUrl: string
  ): MfeEntryLifecycle<ChildMfeBridge> {
    if (stylesheetPaths.length === 0) {
      return lifecycle;
    }

    return {
      // @cpt-begin:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-to-active
      mount: async (container, bridge) => {
        await this.injectRemoteStylesheets(container, stylesheetPaths, baseUrl);
        await lifecycle.mount(container, bridge);
      },
      // @cpt-end:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-to-active
      // @cpt-begin:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-to-disposed
      unmount: async (container) => {
        this.removeInjectedStylesheets(container);
        await lifecycle.unmount(container);
      },
      // @cpt-end:cpt-frontx-state-mfe-isolation-module-lifecycle:p1:inst-to-disposed
    };
  }
  // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-cache-promise

  private async injectRemoteStylesheets(
    container: Element | ShadowRoot,
    stylesheetPaths: string[],
    baseUrl: string
  ): Promise<void> {
    stylesheetPaths.forEach((path, index) => {
      const targetId = `${RUNTIME_STYLE_ID_PREFIX}${index}`;
      this.upsertStyleElement(
        container,
        { href: new URL(path, baseUrl).href },
        targetId
      );
    });
  }

  private removeInjectedStylesheets(container: Element | ShadowRoot): void {
    const injectedStyles = container.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
      `link[id^="${RUNTIME_STYLE_ID_PREFIX}"], style[id^="${RUNTIME_STYLE_ID_PREFIX}"]`
    );
    injectedStyles.forEach((styleElement) => styleElement.remove());
  }

  private upsertStyleElement(
    container: Element | ShadowRoot,
    stylesheet: { css?: string; href?: string },
    id: string
  ): void {
    let styleElement: HTMLLinkElement | HTMLStyleElement | null = null;
    if ('getElementById' in container && typeof container.getElementById === 'function') {
      styleElement = container.getElementById(id) as HTMLLinkElement | HTMLStyleElement | null;
    } else if (container instanceof Element) {
      styleElement = container.querySelector(`[id="${id}"]`);
    }

    if (stylesheet.href) {
      if (!styleElement || styleElement.tagName !== 'LINK') {
        styleElement?.remove();
        const linkElement = document.createElement('link');
        linkElement.id = id;
        linkElement.rel = 'stylesheet';
        container.appendChild(linkElement);
        styleElement = linkElement;
      }

      const linkElement = styleElement as HTMLLinkElement;
      linkElement.href = stylesheet.href;
      return;
    }

    if (!styleElement || styleElement.tagName !== 'STYLE') {
      styleElement?.remove();
      const inlineStyleElement = document.createElement('style');
      inlineStyleElement.id = id;
      container.appendChild(inlineStyleElement);
      styleElement = inlineStyleElement;
    }

    styleElement.textContent = stylesheet.css ?? '';
  }

  /**
   * Resolve manifest from reference.
   *
   * Accepts an inline MfManifest object (caches it) or a string type ID
   * (looks up from cache, then from the registry-supplied type system).
   * Schema validation is the type system plugin's responsibility — the
   * handler trusts registered manifests are valid.
   */
  private async resolveManifest(manifestRef: string | MfManifest): Promise<MfManifest> {
    // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-manifest-inline
    if (typeof manifestRef === 'object' && manifestRef !== null) {
      this.manifestCache.cacheManifest(manifestRef);
      return manifestRef;
    }
    // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-manifest-inline

    if (typeof manifestRef === 'string') {
      // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-manifest-by-id
      const cached = this.manifestCache.getManifest(manifestRef);
      if (cached) {
        return cached;
      }

      // A string reference names a manifest the type system holds — the entry
      // carries the id, not the document — so the cache only answers for
      // remotes some earlier load already pulled in. The plugin arrives at
      // registration, so an unregistered handler has none and stops here.
      const fromTypeSystem = this.typeSystem?.getSchema(manifestRef);
      if (isMfManifest(fromTypeSystem)) {
        this.manifestCache.cacheManifest(fromTypeSystem);
        return fromTypeSystem;
      }
      // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-manifest-by-id

      // @cpt-begin:cpt-frontx-flow-mfe-isolation-load:p1:inst-manifest-unresolved-raise
      throw new MfeLoadError(
        `Manifest '${manifestRef}' not found. Provide the manifest inline in MfeEntryMF, ` +
          'ensure another entry from the same remote was loaded first, or register the ' +
          'manifest with the type system of the registry this handler is registered into.',
        manifestRef
      );
      // @cpt-end:cpt-frontx-flow-mfe-isolation-load:p1:inst-manifest-unresolved-raise
    }

    throw new MfeLoadError(
      'Manifest reference must be a string (type ID) or MfManifest object',
      'invalid-manifest-ref'
    );
  }

  // ---- Shared dep blob URL construction ----

  // @cpt-algo:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1
  /**
   * Build blob URLs for all shared dependencies from standalone ESM files.
   *
   * Processes shared deps in manifest order (must be dependency-ordered: leaves first).
   * Each dep's standalone ESM may import other shared deps as bare specifiers —
   * those are rewritten to already-resolved blob URLs before creating the blob.
   * Per-load fresh blob URLs ensure isolated module instances.
   */
  private async buildSharedDepBlobUrls(
    manifest: MfManifest,
    entryId: string,
    ledger?: AttemptSourceTextLedger
  ): Promise<Map<string, string>> {
    // `sources`/`sharedDepBlobUrls` are keyed by bare `dep.name`, while
    // `sharedDepTextCache` is keyed by the more precise `name@version`. Two
    // shared entries with the same name but different versions would
    // silently overwrite one another in the name-keyed maps. Re-keying
    // every map end-to-end to `name@version` would ripple through
    // `rewriteBareSpecifiers` (which rewrites bare specifiers like
    // `from "react"` — it needs the bare name, not a versioned key) and the
    // static-import chain's shared-dep lookups, for a manifest this handler
    // already documents ({@link resolveManifest}) that it trusts. Failing
    // fast on a same-name collision is the smaller, targeted fix.
    this.assertUniqueSharedDepNames(manifest, entryId);
    const sources = await this.fetchSharedDepSources(manifest, ledger);
    const sharedNames = new Set(manifest.shared.map((d) => d.name));
    return this.createBlobUrlsInDependencyOrder(sources, sharedNames, entryId);
  }

  /**
   * Fail fast with a diagnostic when `manifest.shared` declares the same
   * package name more than once (regardless of version) — see the comment
   * on {@link buildSharedDepBlobUrls} for why this is preferred over
   * re-keying `sources`/`sharedDepBlobUrls` to `name@version`.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-assert-unique-names
  private assertUniqueSharedDepNames(
    manifest: MfManifest,
    entryId: string
  ): void {
    const seen = new Set<string>();
    for (const dep of manifest.shared) {
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-duplicate-name
      if (seen.has(dep.name)) {
        // The second argument is `MfeLoadError.entryTypeId` — the entry
        // being loaded, as at every other throw site in this file — while
        // the manifest is named in the message text.
        // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-raise-duplicate-name
        throw new MfeLoadError(
          `manifest.shared of '${manifest.id}' declares ` +
            `'${dep.name}' more than once. Shared dependency names must be ` +
            'unique within a manifest — blob URL construction keys sources ' +
            'and rewrite maps by bare package name, so a duplicate silently ' +
            'overwrites the earlier entry.',
          entryId
        );
        // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-raise-duplicate-name
      }
      // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-duplicate-name
      seen.add(dep.name);
    }
  }
  // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-assert-unique-names

  /**
   * Fetch standalone ESM source text for each shared dep.
   * sharedDepTextCache deduplicates by name@version across ALL MFEs — the
   * first MFE to load react@19.2.4 fetches it from its server; subsequent MFEs
   * get a cache hit regardless of their server URL.
   *
   * A rejected shared-dep fetch surfaces only once every sibling in the
   * batch has settled. Nothing is gained by aborting sooner: the batch is
   * dispatched concurrently, so the fetches a short-circuit could skip are
   * only those still queued behind the concurrency width, while the ones
   * already issued cannot be cancelled (no `AbortController` is plumbed
   * through this file — same reason the chain build uses a failure token
   * rather than cancellation), and the shared-dep list is short by
   * construction (the packages an MFE declares external). The failure
   * reported is deterministic regardless: the first in the manifest's
   * declaration order, not whichever fetch lost the wall-clock race.
   */
  private async fetchSharedDepSources(
    manifest: MfManifest,
    ledger?: AttemptSourceTextLedger
  ): Promise<Map<string, string>> {
    // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-for-each-shared
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-for-each-dep
    // Fetches for each declared dep are dispatched concurrently, bounded by
    // MAX_CONCURRENT_FETCHES, via `boundedMap` rather than a `for...of` loop
    // with a trailing `await` that would serialize every dep behind the
    // previous one's full round trip.
    // Per the FEATURE Note on `inst-for-each-dep`: enumeration order governs
    // cache-key precedence only (which declaration claims a `name@version`
    // cross-MFE cache slot), not fetch issuance/completion order. Each dep's
    // cache-get → derive-URL → fetch → catch-eviction → cache-set sequence
    // still runs synchronously relative to that dep's own fetch (no `await`
    // separates them), which is what keeps the cross-MFE dedup race-free
    // regardless of how the fetches are interleaved.
    const settled = await boundedMap(manifest.shared, async (dep) => {
      const cacheKey = `${dep.name}@${dep.version}`;
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-compute-key
      let textPromise = this.sharedDepTextCache.get(cacheKey);
      // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-compute-key
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-else-fetch
      if (textPromise === undefined) {
        // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-resolve-chunk-path
        // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-derive-url
        const absoluteUrl = dep.chunkPath.startsWith('http')
          ? dep.chunkPath
          : manifest.metaData.publicPath + dep.chunkPath;
        // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-derive-url
        // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-resolve-chunk-path
        // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-fetch-shared-dep
        // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-fetch-and-cache
        textPromise = this.fetchSourceText(absoluteUrl, ledger);
        // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-fetch-and-cache
        // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-fetch-shared-dep
        // Evict on rejection so a transient failure doesn't poison every
        // future load that shares this name@version. Identity check prevents
        // clobbering a later retry promise under the same key.
        textPromise.catch(() => {
          if (this.sharedDepTextCache.get(cacheKey) === textPromise) {
            this.sharedDepTextCache.delete(cacheKey);
          }
        });
        this.sharedDepTextCache.set(cacheKey, textPromise);
      }
      // Record the shared-dep entry this attempt is waiting on — whether it
      // registered it just now or joined one a previous load left in the
      // cache — so a timeout releases it and the retry re-fetches.
      ledger?.record(this.sharedDepTextCache, cacheKey, textPromise);
      // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-else-fetch
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-cache-hit
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-retrieve-cached
      const text = await textPromise;
      // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-retrieve-cached
      // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-cache-hit
      return { name: dep.name, text };
    });
    // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-for-each-dep
    // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-for-each-shared

    // Deterministic error surfacing: report the first failure in the
    // manifest's declaration order rather than whichever fetch happened to
    // lose the race in wall-clock time.
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failure) {
      throw failure.reason;
    }

    const sources = new Map<string, string>();
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        sources.set(result.value.name, result.value.text);
      }
    }
    return sources;
  }

  /**
   * Create blob URLs in dependency order: leaves first, dependents follow.
   *
   * The order is derived from the fetched sources themselves rather than
   * from `manifest.shared[]`'s enumeration order. Shared dependencies that
   * import one another circularly admit no such order, and minting them
   * anyway would leave their bare specifiers unrewritten inside a blob that
   * therefore cannot be instantiated at all — so that case fails the load
   * with a diagnostic naming them.
   */
  // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-resolve-order
  private createBlobUrlsInDependencyOrder(
    sources: Map<string, string>,
    sharedNames: Set<string>,
    entryId: string
  ): Map<string, string> {
    const blobUrls = new Map<string, string>();
    const pending = new Map(sources);

    while (pending.size > 0) {
      const before = pending.size;
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-for-each-resolved
      for (const [name, source] of pending) {
        if (this.isDepReadyToResolve(name, source, sharedNames, blobUrls)) {
          blobUrls.set(name, this.createRewrittenBlobUrl(source, blobUrls));
          pending.delete(name);
        }
      }
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-shared-cycle
      if (pending.size === before) {
        // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-raise-shared-cycle
        throw markDeterministicLoadFailure(
          new MfeLoadError(
            'circular shared dependencies: no dependency order exists over ' +
              `${describeSharedDepCycle(pending)}. ` +
              'Minting them anyway would leave those bare specifiers ' +
              'unrewritten inside blobs that cannot be instantiated. ' +
              'Rebuild the microfrontend so that its shared dependencies ' +
              'do not import one another circularly.',
            entryId
          )
        );
        // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-raise-shared-cycle
      }
      // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-if-shared-cycle
    }
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-return-map
    return blobUrls;
    // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-return-map
  }
      // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-for-each-resolved
  // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-resolve-order

  private isDepReadyToResolve(
    name: string,
    source: string,
    sharedNames: Set<string>,
    blobUrls: Map<string, string>
  ): boolean {
    return [...sharedNames].every(
      (other) =>
        other === name ||
        blobUrls.has(other) ||
        !sourceImports(source, other)
    );
  }

  private createRewrittenBlobUrl(
    source: string,
    blobUrls: Map<string, string>
  ): string {
    // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-rewrite-specifiers
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-rewrite-specifiers
    const rewritten = this.rewriteBareSpecifiers(source, blobUrls);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-rewrite-specifiers
    // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-rewrite-specifiers
    // @cpt-begin:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-mint-shared-blob
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-create-dep-blob
    const blob = new Blob([rewritten], { type: 'text/javascript' });
    return URL.createObjectURL(blob);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls:p1:inst-create-dep-blob
    // @cpt-end:cpt-frontx-algo-mfe-loading-manifest-discovery:p1:inst-md-mint-shared-blob
  }

  /**
   * Apply all shared dep bare specifier rewrites to a source text.
   */
  private rewriteBareSpecifiers(
    source: string,
    sharedDepBlobUrls: Map<string, string>
  ): string {
    let rewritten = source;
    for (const [name, blobUrl] of sharedDepBlobUrls) {
      rewritten = rewriteBareSpecifier(rewritten, name, blobUrl);
    }
    return rewritten;
  }

  // ---- Blob URL chain creation ----

  /**
   * Recursively create blob URLs for a module and all its static dependencies.
   *
   * Processes dependencies depth-first so that when a module's imports are
   * rewritten, all its dependencies already have blob URLs in the shared map.
   * Common dependencies are processed once per load (shared blobUrlMap).
   *
   * Concurrent calls for the same filename are deduplicated via the inFlight
   * map — callers await the same promise rather than returning early with no
   * result. This prevents a race where sibling ESM modules with top-level
   * await, and the sibling fan-out in {@link createBlobUrlChainInternal},
   * trigger overlapping resolution for the same dependency;
   * {@link resolveLazyChunk} is the current beneficiary that actually calls
   * back into this method from outside the static-import recursion.
   *
   * Cycle detection is tracked on the shared `inFlight` entry rather than on
   * any single call's recursion path, because the path a cycle is *detected*
   * on is not necessarily the path it was *created* on. A linear cycle
   * (chunk A imports B, B imports A) is visible on one call stack and a
   * simple "have I already seen this filename on my own way down" check
   * catches it. A cycle that closes across two independent branches does
   * not stay on one call stack: if a diamond (E imports A and B; A imports
   * C; B imports C; C imports back to B) fans A and B out concurrently, C is
   * reached only via A's path, so a plain per-call ancestor set never
   * contains "B" when C statically imports it — B was never on that
   * particular branch. Meanwhile B is independently blocked joining C's
   * `inFlight` promise (ordinary, legitimate dedup, not yet a cycle), so B
   * and C now await each other with no rejection, no timeout, and no retry
   * path (the `loadCache` entry never settles).
   *
   * `ancestors` is therefore not a per-call snapshot: it *is* the mutable
   * lineage stored on the filename's own `inFlight` entry (see
   * `LoadBlobState.inFlight`), threaded live through the recursion that
   * builds that filename's dependencies. When a second branch joins an
   * already in-flight filename instead of constructing it, that branch
   * contributes its own lineage into the joined entry's lineage before
   * awaiting it (synchronously, with no `await` between the check and the
   * contribution — the same discipline the `blobUrlMap`/`inFlight`
   * check-then-set already relies on, which is also why this method stays
   * non-`async`). Because the lineage object is shared by reference, that
   * contribution is visible the moment the joined filename's own
   * construction next reads it — including when it later closes the cycle
   * by requesting a dependency that is now present in its own (grown)
   * lineage. In the diamond above: B joining C's promise contributes B's
   * lineage into C's entry; when C's construction goes on to request B, its
   * own lineage now contains "B", the ordinary ancestor check fires, and C
   * fails the chain build instead of joining B's promise. A detected cycle
   * is fatal here, exactly as it is for circular shared deps in
   * {@link createBlobUrlsInDependencyOrder}: there is no order in which the
   * blob URLs on a cycle could be minted, and the alternative — leaving the
   * cycle-closing specifier pointing at a plain chunk URL — would evaluate
   * that module, and its whole origin-resolved subgraph, outside the load's
   * isolated graph.
   */
  // @cpt-algo:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1
  private createBlobUrlChain(
    loadState: LoadBlobState,
    filename: string,
    build: ChainBuildState,
    ancestors: ReadonlySet<string> = new Set()
  ): Promise<void> {
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-check-map
    if (loadState.blobUrlMap.has(filename)) {
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-mapped
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-mapped
      return Promise.resolve();
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-mapped
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-mapped
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-check-map

    // Check for a cycle on this call's own recursion path BEFORE consulting
    // `inFlight` — `filename` being an ancestor here means its `inFlight`
    // entry (if any) is the very promise this call would otherwise block
    // on, which is the deadlock this guard exists to avoid. This alone only
    // catches a cycle that stays on one call stack; the `inFlight`-join
    // branch below (see the class-level doc comment) covers a cycle that
    // closes across two branches that fanned out independently.
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-check-ancestor-cycle
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-ancestor-cycle
    if (ancestors.has(filename)) {
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-ancestor-cycle
      // Reject rather than await: returning the rejection (instead of
      // awaiting anything) is what keeps liveness — no circular wait is
      // created, and the rejection propagates through the sibling
      // `Promise.allSettled` scan into `build.failed`.
      return Promise.reject(
        this.onDependencyCycleDetected(
          loadState,
          build,
          filename,
          ancestors,
          'own lineage'
        )
      );
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-ancestor-cycle
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-ancestor-cycle
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-check-ancestor-cycle

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-check-inflight
    const existing = loadState.inFlight.get(filename);
    if (existing) {
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-inflight
      // A join, not a fresh construction: `filename` is already being built
      // by another branch. Check membership against the union of our own
      // lineage and the entry's recorded lineage before committing to await
      // it — if either already names `filename`, awaiting it would close a
      // cycle back onto ourselves. This is a defensive companion to the
      // ancestor check above, which only sees `filename` if it was
      // literally on the caller's own path; here `filename` could instead
      // have arrived via a contribution from some third branch.
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-join-lineage-union
      const union = new Set(ancestors);
      for (const inherited of existing.lineage) union.add(inherited);
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-join-lineage-union
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-join-cycle
      if (union.has(filename)) {
        // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-join-cycle
        // Same treatment as the own-lineage case, and for the same reason:
        // reject without awaiting the joined entry, so the cross-branch
        // circular wait is never entered.
        return Promise.reject(
          this.onDependencyCycleDetected(
            loadState,
            build,
            filename,
            union,
            'joined lineage'
          )
        );
        // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-join-cycle
      }
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-join-cycle
      // Contribute our own lineage into the joined entry before awaiting it
      // (synchronously — no `await` between the check above and this), so
      // that if the joined filename's own construction later requests
      // something in our lineage, it can detect that as the cycle it is.
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-contribute-lineage
      for (const inherited of ancestors) existing.lineage.add(inherited);
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-contribute-lineage
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-inflight
      return this.joinInFlightConstruction(
        loadState,
        filename,
        build,
        ancestors,
        existing
      );
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-inflight
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-inflight
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-check-inflight

    // This filename's own lineage starts as a copy of the caller's — it is
    // then threaded (by reference, mutably) through the construction below
    // and into every dependency it recurses into, so a later join can
    // contribute into it and this construction will see that contribution
    // the next time it reads its own lineage (see the class-level doc
    // comment for why that liveness is what makes cross-branch cycles
    // detectable).
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-register-inflight
    const lineage = new Set(ancestors);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-register-inflight

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-settle-drop-inflight
    // The `inFlight` entry is a join point for a construction still in
    // progress, not a record that one happened — `blobUrlMap` is the only
    // durable record. Three paths inside `createBlobUrlChainInternal`
    // resolve WITHOUT minting a blob URL (the build already failed on
    // entry, it failed while this fetch was in flight, or it failed in a
    // sibling subtree), and a rejection leaves nothing behind either. An
    // entry left in `inFlight` after any of those settles is a settled
    // promise that produced nothing: every later request for the filename
    // joins it, resolves immediately, never re-fetches, and then finds no
    // `blobUrlMap` entry. Dropping the entry on settle-without-a-blob-URL
    // is what lets a later build re-attempt the construction. It does
    // nothing for a caller that had ALREADY joined the promise before it
    // settled — that case is handled on the join side, by
    // {@link joinInFlightConstruction}.
    // Identity-checked against the wrapped promise below, so a construction
    // that settles late cannot delete an entry a NEWER request already
    // registered for the same filename.
    const dropIfUnproductive = (): void => {
      if (loadState.blobUrlMap.has(filename)) return;
      if (loadState.inFlight.get(filename)?.promise === promise) {
        loadState.inFlight.delete(filename);
      }
    };
    // The wrapped promise — not the raw construction — is what goes into
    // `inFlight`, so a joining caller cannot observe the construction as
    // settled before the entry has been pruned.
    const promise = this.createBlobUrlChainInternal(
      loadState,
      filename,
      build,
      lineage
    ).then(
      () => {
        dropIfUnproductive();
      },
      (error: unknown) => {
        dropIfUnproductive();
        throw error;
      }
    );
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-register-inflight
    loadState.inFlight.set(filename, { promise, lineage });
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-register-inflight
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-settle-drop-inflight
    return promise;
  }

  /**
   * Await a construction another branch already had in flight, then verify
   * it actually produced something — and construct it ourselves if it did
   * not.
   *
   * An `inFlight` entry is a join point for a construction in progress, not
   * a record that one succeeded: the entry's construction can settle
   * cleanly without minting a blob URL (a sibling of ITS build failed and it
   * abandoned the chunk — see `inst-settle-drop-inflight`). Dropping the unproductive entry helps the
   * NEXT requester, but not one that already joined the promise: that
   * joiner would resume, find no `blobUrlMap` entry for the filename, and
   * fail its own load at {@link rewriteModuleImports} for a chunk nothing
   * ever tried to build on its behalf.
   *
   * So the joiner re-attempts the construction inside its OWN build. By the
   * time this resumes, the entry it joined has already been pruned —
   * `dropIfUnproductive` runs inside the `.then` of the very promise
   * awaited here, so it cannot race the re-attempt — and the recursive call
   * re-enters {@link createBlobUrlChain} with this requester's own
   * `ancestors`, so the re-attempt is subject to the same lineage cycle
   * checks as any other request and cannot reintroduce a circular wait.
   *
   * The re-attempt is skipped when this build has itself failed: the absence
   * from `blobUrlMap` is then this build's own outcome, not a hole left by
   * someone else's.
   */
  private async joinInFlightConstruction(
    loadState: LoadBlobState,
    filename: string,
    build: ChainBuildState,
    ancestors: ReadonlySet<string>,
    joined: InFlightChainEntry
  ): Promise<void> {
    await joined.promise;
    if (loadState.blobUrlMap.has(filename)) return;
    if (build.failed) return;
    return this.createBlobUrlChain(loadState, filename, build, ancestors);
  }

  /**
   * The single point at which a detected dependency cycle becomes a
   * failure — both detection sites in {@link createBlobUrlChain} route
   * through here, and a future mechanism that could actually LOAD a cyclic
   * graph (a per-load naming layer) substitutes here rather than reopening
   * either site's check-then-set region.
   *
   * Returns the error rather than throwing it, so the callers can reject
   * without awaiting anything and without becoming `async` — the
   * `blobUrlMap`/`inFlight` check-then-set in {@link createBlobUrlChain}
   * must stay synchronous.
   *
   * The diagnostic IS the report: the condition is fatal, so a console
   * warning alongside it would be noise. It is raised once per chunk per
   * chain build, since several branches can reach the same cycle before
   * `build.failed` is observed by all of them.
   */
  private onDependencyCycleDetected(
    loadState: LoadBlobState,
    build: ChainBuildState,
    filename: string,
    lineage: ReadonlySet<string>,
    detectedVia: string
  ): MfeLoadError {
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-diagnose-cycle
    const alreadyReported = build.reportedCycles.has(filename);
    build.reportedCycles.add(filename);
    const message = alreadyReported
      ? `dependency cycle: chunk '${filename}' — already diagnosed for this ` +
        'chain build by the branch that reached the cycle first.'
      : `dependency cycle: chunk '${filename}' is already in the ` +
        `${detectedVia} of the branch requesting it (${[...lineage].join(' → ')}). ` +
        'A cyclic chunk graph has no order in which per-load blob URLs ' +
        'could be minted, and resolving the cycle-closing import from its ' +
        "origin URL would evaluate that module outside this load's " +
        'isolated graph. Rebuild the microfrontend so that its chunk graph ' +
        'is acyclic.';
    return markDeterministicLoadFailure(
      new MfeLoadError(message, loadState.entryId)
    );
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-diagnose-cycle
  }

  private async createBlobUrlChainInternal(
    loadState: LoadBlobState,
    filename: string,
    build: ChainBuildState,
    ancestors: ReadonlySet<string>
  ): Promise<void> {
    // A sibling elsewhere in THIS build already failed — stop before issuing
    // further fetches for work this build will never use. Scoped to
    // `build` (this one chain-build), not `loadState` (the whole
    // load) — see `ChainBuildState`.
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-at-entry
    if (build.failed) {
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-at-entry
      return;
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-at-entry
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-at-entry

    // Portable shared dep chunks use absolute URLs (resolved at generation time
    // to a canonical shared base). Use as-is to ensure sourceTextCache dedup.
    const chunkUrl = filename.startsWith('http://') || filename.startsWith('https://')
      ? filename
      : loadState.baseUrl + filename;
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-fanout-bounded
    // Admission to the build's single fetch budget. The slot is held across
    // this one fetch and released the moment it settles — never across the
    // dependency recursion below, which would deadlock any graph deeper
    // than the budget's width.
    await build.fetchBudget.acquire();
    let source: string;
    try {
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-after-fetch
      if (build.failed) {
        // Another branch failed while this call waited for a slot: give the
        // slot back without spending it on work this build will never use.
        // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-after-fetch
        return;
        // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-after-fetch
      }
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-after-fetch
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-fetch-source
      source = await this.fetchSourceText(chunkUrl, loadState.attemptLedger);
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-fetch-source
    } finally {
      build.fetchBudget.release();
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-fanout-bounded

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-after-fetch
    if (build.failed) {
      // Re-check after the `await` above: another branch of THIS build may
      // have failed while this fetch was in flight.
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-after-fetch
      return;
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-after-fetch
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-after-fetch

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-parse-static-imports
    const deps = this.parseStaticImportFilenames(source, filename);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-parse-static-imports

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-for-each-dep
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-recurse-dep
    // Siblings are fanned out concurrently instead of being awaited
    // serially one at a time — a sibling's entire recursive subtree no
    // longer blocks the next sibling from starting. The fan-out itself is
    // deliberately unbounded: what must be bounded is the number of
    // FETCHES in flight for this build, and that bound now lives on the
    // build's own `fetchBudget` (see {@link FetchBudget}) rather than on a
    // pool opened per sibling group, which multiplied the width by the
    // graph's bushiness. Cross-sibling / cross-load dedup for a shared
    // filename still holds because `createBlobUrlChain`'s check-then-set
    // against `blobUrlMap`/`inFlight` is synchronous (the method itself is
    // not `async`, so no other call can interleave between the check and
    // the `inFlight.set`); two siblings requesting the same filename settle
    // on one underlying fetch/chain. Dispatching with `map` keeps those
    // check-then-sets in declaration order.
    //
    // `ancestors` here is `loadState.inFlight.get(filename)!.lineage` — the
    // same mutable object passed down from `createBlobUrlChain` — so any
    // contribution another branch made into it while this fetch was
    // in-flight (see that method's join branch) is already visible.
    // `childAncestors` copies it and adds `filename` itself so a dependency
    // that cycles back here is detected by the plain ancestor check.
    const childAncestors = new Set(ancestors);
    childAncestors.add(filename);
    const settled = await Promise.allSettled(
      deps.map((dep) =>
        this.createBlobUrlChain(loadState, dep, build, childAncestors)
      )
    );
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-recurse-dep
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-for-each-dep

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-first-failure-declaration-order
    // Deterministic error surfacing: report the first failing dependency in
    // its declaration order, matching the pre-concurrency sequential loop's
    // error semantics rather than whichever sibling lost the race in
    // wall-clock time. `Promise.allSettled` preserves input order, so this
    // scan is unaffected by which sibling settled first.
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-first-failure-declaration-order
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-sibling-failed
    if (failure) {
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-build-failure
      build.failed = true;
      throw failure.reason;
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-build-failure
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-sibling-failed
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-elsewhere
    if (build.failed) {
      // A sibling outside this call's own subtree, but within THIS build,
      // already failed: stop here rather than minting a blob URL this
      // build will never use.
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-elsewhere
      return;
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-failed-elsewhere
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-failed-elsewhere

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-static
    let rewritten = this.rewriteModuleImports(source, loadState, filename);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-static

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-meta-url
    // Phase 19: Replace import.meta.url with the real chunk base URL string.
    // When a chunk is blob-URL'd, import.meta.url becomes a blob: URL, which
    // breaks new URL("../path", import.meta.url) — blob: URLs have no directory
    // component. Replacing with the HTTP base URL (directory of the chunk)
    // restores correct relative URL resolution (e.g. in preload-helper.js).
    // We target 'import.meta.url' specifically to leave import.meta.env intact.
    rewritten = this.rewriteImportMetaUrl(rewritten, chunkUrl);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-meta-url

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-shared
    // Rewrite bare specifiers (from "react" → from "blob:xxx") using
    // the pre-built shared dep blob URL map.
    rewritten = this.rewriteBareSpecifiers(rewritten, loadState.sharedDepBlobUrls);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-rewrite-shared

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-lazy-ref
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-inject-lazy-stub
    // Inject the per-load `__frontx_lazy` loader stub at the top of the chunk
    // when the chunk references it. The stub is the runtime half of ADR-0022:
    // a build-time AST transform rewrote every dynamic `import('./X')` to
    // `__frontx_lazy('./X')`; the loader stub closes over this load's resolver
    // and routes those calls through the parent load's blob URL chain so
    // lazy chunks inherit the same `sharedDepBlobUrls` as the entry chunk.
    if (rewritten.includes('__frontx_lazy(')) {
      const loaderUrl = this.ensureLazyLoaderUrl(loadState);
      rewritten = `import{__frontx_lazy}from${JSON.stringify(loaderUrl)};\n${rewritten}`;
    }
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-inject-lazy-stub
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-if-lazy-ref

    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-create-blob
    // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-complete
    const blob = new Blob([rewritten], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    loadState.blobUrlMap.set(filename, blobUrl);
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-return-complete
    // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-create-blob
  }

  // ---- Lazy-import ABI runtime resolver (ADR-0022) ----

  /**
   * Mint (lazily) and return this load's `__frontx_lazy` loader stub blob URL.
   *
   * The stub is a tiny ESM module that re-exports a `__frontx_lazy` function
   * closed over this load's resolver id. Vendor MFE chunks transformed by
   * the build plugin reference `__frontx_lazy` as an imported binding from
   * this stub URL — that import is injected at the top of every chunk that
   * uses the identifier (see {@link createBlobUrlChainInternal}).
   *
   * Stub URL is per-load (sibling loads get distinct stubs) and never
   * revoked — per ADR-0004 + ADR-0022 the stub joins the parent load's
   * blob URL chain and shares its page-lifetime invariant.
   */
  // @cpt-algo:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1
  private ensureLazyLoaderUrl(loadState: LoadBlobState): string {
    if (loadState.lazyLoaderUrl !== undefined) return loadState.lazyLoaderUrl;

    // @cpt-begin:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-mint-stub
    const registry = LazyLoaderRegistry.ensureExposed();
    const loaderId = registry.register((path) => this.resolveLazyChunk(path, loadState));

    // The stub uses `globalThis.__FRONTX_LAZY__.resolve` (exposed by
    // {@link LazyLoaderRegistry}) to reach the host-side resolver. Returning
    // a `Promise<Module>` mirrors the original `import()` semantic so the
    // caller's transformed code (`__frontx_lazy('./X').then(m => m.X)`) keeps
    // working unchanged.
    const stubSource =
      `const __id=${JSON.stringify(loaderId)};\n` +
      `export const __frontx_lazy=async(p)=>{` +
      `const u=await globalThis.__FRONTX_LAZY__.resolve(__id,p);` +
      `return import(u);` +
      `};\n`;

    const blob = new Blob([stubSource], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    loadState.lazyLoaderUrl = url;
    return url;
    // @cpt-end:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-mint-stub
  }

  /**
   * Resolve a vendor-relative lazy-import path to a per-load blob URL.
   *
   * The vendor's compiled chunk emits `__frontx_lazy('./LayoutElements-X.js')`
   * (sibling chunk reference — Rollup constant-folds the path to a hashed
   * filename relative to the importing chunk's directory). All MFE chunks
   * share a single output directory, so the path resolves to a filename
   * under `loadState.baseUrl`.
   *
   * The chunk is then funneled through {@link createBlobUrlChain}, which
   * fetches its source (via the URL-keyed `sourceTextCache`), recursively
   * rewrites bare specifiers + nested `__frontx_lazy()` calls (the static-
   * chain path takes care of both), mints a blob URL in this load's
   * `blobUrlMap`, and returns. Subsequent `__frontx_lazy(...)` calls for the
   * same path within the same load reuse the cached blob URL.
   *
   * This call site runs after `load()` has already resolved (the caller is
   * runtime code inside an already-mounted MFE, not the initial load
   * chain), so it has no static-import ancestor path to seed
   * `createBlobUrlChain`'s lineage with — the host-side registry this stub
   * calls through (see {@link ensureLazyLoaderUrl}) does not thread the
   * calling chunk's own filename back to us, so it genuinely cannot be
   * determined here. Seeding with the entry chunk instead still gives
   * `createBlobUrlChain` a non-empty starting lineage to grow from, which is
   * what the cross-branch join/contribute mechanism it implements needs to
   * detect a cycle between two lazy chunks triggered concurrently and
   * cross-referencing each other — the same shape of deadlock the
   * class-level doc comment on {@link createBlobUrlChain} describes for the
   * static-import case, reachable here too because this no longer starts a
   * disconnected, empty lineage against the load's shared `inFlight` map.
   */
  private async resolveLazyChunk(
    relPath: string,
    loadState: LoadBlobState
  ): Promise<string> {
    // @cpt-begin:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-resolve-relative-path
    // Compiled-chunk dynamic imports are sibling-relative: Rollup emits
    // paths like `./LayoutElements-hash.js` against the importing chunk's
    // directory. The entry chunk lives in `loadState.entryChunkFilename`
    // (e.g., `assets/lifecycle-uikit-X.js`); every other chunk in a Vite
    // build shares that directory, so resolving `./<file>` against the
    // entry chunk's path produces the correct filename relative to
    // `loadState.baseUrl` for both the entry chunk and its lazy siblings.
    const filename = this.resolveRelativePath(
      loadState.entryChunkFilename,
      relPath
    );
    // @cpt-end:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-resolve-relative-path

    // Fresh per-build failure token (see `ChainBuildState`) for THIS
    // `resolveLazyChunk` call, scoped to `loadState`. A network blip on one
    // lazy import must not latch a load-wide flag that then blocks every
    // later, otherwise-independent, lazy import on the same already-mounted
    // MFE — each call here gets its own token instead of sharing one on
    // `loadState`.
    const build = createChainBuildState();

    // @cpt-begin:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-fetch-lazy-chunk
    await this.createBlobUrlChain(
      loadState,
      filename,
      build,
      new Set([loadState.entryChunkFilename])
    );
    // @cpt-end:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-fetch-lazy-chunk

    // @cpt-begin:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-return-lazy-blob
    const blobUrl = loadState.blobUrlMap.get(filename);
    if (blobUrl === undefined) {
      throw new MfeLoadError(
        `__frontx_lazy: failed to mint blob URL for lazy chunk '${relPath}'`,
        loadState.entryId
      );
    }
    return blobUrl;
    // @cpt-end:cpt-frontx-algo-mfe-loading-lazy-import-abi:p1:inst-lai-return-lazy-blob
  }

  /**
   * Replace all `import.meta.url` references with the chunk's real base URL.
   *
   * The base URL is the directory containing the chunk (trailing slash included),
   * derived by stripping the filename from the full chunk URL. This is the URL
   * that relative `new URL("../x", import.meta.url)` calls should resolve against.
   */
  private rewriteImportMetaUrl(source: string, chunkAbsoluteUrl: string): string {
    // Derive the directory containing this chunk by stripping the filename.
    // e.g. "http://localhost:3001/assets/preload-helper.js" → "http://localhost:3001/assets/"
    const lastSlash = chunkAbsoluteUrl.lastIndexOf('/');
    const chunkBaseUrl = lastSlash >= 0
      ? chunkAbsoluteUrl.slice(0, lastSlash + 1)
      : chunkAbsoluteUrl;

    // Use a regex replacement targeting the exact token 'import.meta.url'
    // (word-boundary anchored to avoid matching 'import.meta.url.something').
    // JSON.stringify ensures the URL is properly quoted and special chars escaped.
    return source.replace(/import\.meta\.url/g, JSON.stringify(chunkBaseUrl));
  }

  // ---- Source text fetching and parsing ----

  /**
   * Fetch the source text of a chunk. Uses an in-memory cache so each URL
   * is fetched at most once across all loads.
   */
  private fetchSourceText(
    absoluteChunkUrl: string,
    ledger?: AttemptSourceTextLedger
  ): Promise<string> {
    const cached = this.sourceTextCache.get(absoluteChunkUrl);
    if (cached !== undefined) {
      // Joining an entry another load registered still makes this attempt a
      // waiter on it, so it belongs in the attempt's ledger.
      ledger?.record(this.sourceTextCache, absoluteChunkUrl, cached);
      return cached;
    }

    const fetchPromise = fetch(absoluteChunkUrl)
      .then((response) => {
        if (!response.ok) {
          throw new MfeLoadError(
            `HTTP ${response.status} fetching chunk source: ${absoluteChunkUrl}`,
            absoluteChunkUrl
          );
        }
        // SPA dev servers (e.g. Vite) return a 200 HTML document for unknown
        // paths. Detecting this early gives a clear error instead of a cryptic
        // SyntaxError when the HTML is imported as JavaScript.
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/html')) {
          throw new MfeLoadError(
            `Server returned HTML for chunk URL (Content-Type: ${contentType}). ` +
              `The chunk does not exist at the expected path: ${absoluteChunkUrl}. ` +
              'Run "npm run generate:mfe-manifests" to synchronize chunk paths with the current MFE build.',
            absoluteChunkUrl
          );
        }
        return response.text();
      })
      .then((text) => {
        // Belt-and-suspenders: reject any response that looks like HTML regardless
        // of the Content-Type header (some servers omit or misreport it).
        if (text.trimStart().startsWith('<')) {
          throw new MfeLoadError(
            `Chunk response starts with "<" — server returned HTML instead of JavaScript: ${absoluteChunkUrl}. ` +
              'Run "npm run generate:mfe-manifests" to synchronize chunk paths with the current MFE build.',
            absoluteChunkUrl
          );
        }
        return text;
      })
      .catch((error) => {
        this.sourceTextCache.delete(absoluteChunkUrl);
        if (error instanceof MfeLoadError) {
          throw error;
        }
        throw new MfeLoadError(
          `Network error fetching chunk source: ${absoluteChunkUrl}: ${error instanceof Error ? error.message : String(error)}`,
          absoluteChunkUrl,
          error instanceof Error ? error : undefined
        );
      });

    this.sourceTextCache.set(absoluteChunkUrl, fetchPromise);
    ledger?.record(this.sourceTextCache, absoluteChunkUrl, fetchPromise);
    return fetchPromise;
  }

  /**
   * Extract resolved filenames from static import statements.
   *
   * Matches all relative imports (both './' and '../' prefixed) and resolves
   * them relative to the importing chunk's path. For example, a chunk at
   * '__federation_shared_@gears-frontx/react.js' importing '../runtime.js' resolves
   * to 'runtime.js' (relative to baseUrl).
   */
  private parseStaticImportFilenames(
    source: string,
    chunkFilename: string
  ): string[] {
    const filenames: string[] = [];

    // Named imports: import { x } from './dep.js'  /  export { x } from './dep.js'
    const namedRegex = /from\s*['"](\.\.?\/[^'"]+)['"]/g;
    let match;
    while ((match = namedRegex.exec(source)) !== null) {
      filenames.push(this.resolveRelativePath(chunkFilename, match[1]));
    }

    filenames.push(
      ...this.parseBareSideEffectImportFilenames(source, chunkFilename)
    );

    return [...new Set(filenames)];
  }

  private parseBareSideEffectImportFilenames(
    source: string,
    chunkFilename: string
  ): string[] {
    const filenames: string[] = [];
    let cursor = 0;

    while (cursor < source.length) {
      const importIndex = source.indexOf('import', cursor);
      if (importIndex === -1) {
        break;
      }

      if (!this.hasBareImportBoundary(source, importIndex)) {
        cursor = importIndex + 'import'.length;
        continue;
      }

      let specifierIndex = this.skipImportWhitespace(
        source,
        importIndex + 'import'.length
      );
      const quote = source[specifierIndex];
      if (quote !== '"' && quote !== '\'') {
        cursor = importIndex + 'import'.length;
        continue;
      }

      specifierIndex += 1;
      if (!this.isRelativeImportSpecifier(source, specifierIndex)) {
        cursor = specifierIndex;
        continue;
      }

      let specifierEnd = specifierIndex;
      while (
        specifierEnd < source.length &&
        source[specifierEnd] !== quote
      ) {
        specifierEnd += 1;
      }

      if (specifierEnd >= source.length) {
        break;
      }

      filenames.push(
        this.resolveRelativePath(
          chunkFilename,
          source.slice(specifierIndex, specifierEnd)
        )
      );
      cursor = specifierEnd + 1;
    }

    return filenames;
  }

  private hasBareImportBoundary(source: string, importIndex: number): boolean {
    let boundaryIndex = importIndex - 1;
    while (
      boundaryIndex >= 0 &&
      this.isBareImportWhitespace(source[boundaryIndex])
    ) {
      boundaryIndex -= 1;
    }

    return (
      boundaryIndex < 0 ||
      source[boundaryIndex] === ';' ||
      source[boundaryIndex] === '\n'
    );
  }

  private skipImportWhitespace(source: string, index: number): number {
    let cursor = index;
    while (
      cursor < source.length &&
      this.isImportWhitespace(source[cursor])
    ) {
      cursor += 1;
    }
    return cursor;
  }

  private isRelativeImportSpecifier(source: string, index: number): boolean {
    return (
      source[index] === '.' &&
      (
        source[index + 1] === '/' ||
        (source[index + 1] === '.' && source[index + 2] === '/')
      )
    );
  }

  private isBareImportWhitespace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\r';
  }

  private isImportWhitespace(char: string): boolean {
    return this.isBareImportWhitespace(char) || char === '\n';
  }

  /**
   * Rewrite all relative imports in a module's source text.
   *
   * Handles both './' and '../' relative imports. Each relative specifier
   * is resolved against the chunk's own path to produce a normalized key
   * for the blobUrlMap lookup.
   *
   * A dependency missing from `blobUrlMap` has no sanctioned reading: it is
   * a chunk that was never built, and there is no longer any case (a
   * detected dependency cycle used to be one) in which an absence is
   * deliberate, because a cycle fails the build where it is detected.
   * Emitting an origin URL for an absent dependency would silently hand
   * back a module that evaluates outside the load's isolated graph with its
   * own bare specifiers unrewritten — a far worse outcome than a
   * diagnostic, so it fails the load instead.
   */
  private rewriteModuleImports(
    source: string,
    loadState: LoadBlobState,
    chunkFilename: string
  ): string {
    const resolve = (relPath: string): string => {
      const resolved = this.resolveRelativePath(chunkFilename, relPath);
      const blobUrl = loadState.blobUrlMap.get(resolved);
      if (blobUrl) return blobUrl;
      // @cpt-begin:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-unbuilt-dep
      throw new MfeLoadError(
        `Chunk '${chunkFilename}' imports '${relPath}' (resolved to ` +
          `'${resolved}'), which has no blob URL in this load — its ` +
          'construction never completed. There is no sanctioned reason for ' +
          'the absence: a detected dependency cycle fails the build where ' +
          'it is detected. Refusing to rewrite the import to its origin ' +
          "URL, which would evaluate that module outside the load's " +
          'isolated module graph.',
        loadState.entryId
      );
      // @cpt-end:cpt-frontx-algo-mfe-isolation-blob-url-chain:p1:inst-raise-unbuilt-dep
    };

    // Static imports: from './...' or from '../..'
    let result = source.replace(
      /from\s*'(\.\.?\/[^']+)'/g,
      (_match, relPath: string) => `from '${resolve(relPath)}'`
    );
    result = result.replace(
      /from\s*"(\.\.?\/[^"]+)"/g,
      (_match, relPath: string) => `from "${resolve(relPath)}"`
    );

    // Bare side-effect imports: import './dep.js'
    result = result.replace(
      /import\s*'(\.\.?\/[^']+)'\s*;?/g,
      (_match, relPath: string) => `import '${resolve(relPath)}';`
    );
    result = result.replace(
      /import\s*"(\.\.?\/[^"]+)"\s*;?/g,
      (_match, relPath: string) => `import "${resolve(relPath)}";`
    );

    // Dynamic `import('<rel>')` calls are NOT rewritten here. A build-time
    // AST transform converts every dynamic import to `__frontx_lazy('<rel>')`
    // (ADR-0022);
    // the loader stub injected by `createBlobUrlChainInternal` routes those
    // calls through `resolveLazyChunk`, which mints per-load blob URLs that
    // inherit the parent load's `sharedDepBlobUrls`. Eagerly rewriting
    // `import(...)` here would either bypass that path (loading lazy chunks
    // from origin with unrewritten bare specifiers — the bug ADR-0022
    // fixes) or eagerly resolve every lazy chunk into the static chain
    // (defeating lazy semantics).

    return result;
  }

  /**
   * Resolve a relative import path against the importing chunk's filename.
   *
   * Uses URL resolution to correctly handle '../' traversals. For example:
   *  - resolveRelativePath('__federation_shared_@gears-frontx/react.js', '../runtime.js')
   *    → 'runtime.js'
   *  - resolveRelativePath('expose-Widget1.js', './dep.js')
   *    → 'dep.js'
   */
  private resolveRelativePath(
    fromChunkFilename: string,
    relativeSpecifier: string
  ): string {
    // When the importing chunk has an absolute URL (portable shared dep served
    // from a canonical origin), resolve imports against that origin and return
    // the full URL. This ensures deps of cross-origin portable chunks are
    // fetched from the correct server, not the current MFE's baseUrl.
    if (fromChunkFilename.startsWith('http://') || fromChunkFilename.startsWith('https://')) {
      return new URL(relativeSpecifier, fromChunkFilename).href;
    }
    const syntheticBase = 'http://r/';
    const fromUrl = new URL(fromChunkFilename, syntheticBase);
    const resolved = new URL(relativeSpecifier, fromUrl);
    return resolved.pathname.slice(1); // strip leading '/'
  }
}

/**
 * Confirm that a value the type system returned for a manifest id is shaped
 * like an `MfManifest`.
 *
 * The plugin's registry is keyed by opaque ids and holds every kind of schema
 * a consumer registered, so a lookup can legitimately answer with something
 * that is not a manifest at all; the load must fail on that as it would on a
 * miss rather than cache the value and fail deeper in the chain. Whether the
 * manifest's contents are themselves valid stays the plugin's responsibility.
 */
function isMfManifest(value: unknown): value is MfManifest {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value && typeof value.id === 'string' &&
    'name' in value && typeof value.name === 'string' &&
    'metaData' in value && typeof value.metaData === 'object' && value.metaData !== null &&
    'shared' in value && Array.isArray(value.shared)
  );
}

export { MfeHandlerMF };
