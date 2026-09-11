/**
 * MfeHandlerMF — handler-level behaviour tests.
 *
 * Covers, in file order:
 *  - the unresolved `publicPath` placeholder guard (`assertResolvedPublicPath`);
 *  - chunk-source fetch concurrency: sibling fan-out, cross-caller dedup,
 *    the build-wide fetch width, cross-branch dependency cycles, the
 *    per-attempt timeout, and declaration-order failure reporting;
 *  - lazy-import isolation: one failed chain build must not poison a later
 *    independent one, sequentially or concurrently;
 *  - the hard failure for a dependency that was never built;
 *  - the per-load isolation invariant: every specifier in every minted
 *    source is an inline-content URL this load minted — no origin URL and
 *    no unrewritten bare specifier survives anywhere;
 *  - deterministic (cycle) failures not being retried;
 *  - `LruCache` capacity eviction and MRU re-insertion.
 *
 * On the `publicPath` guard specifically: Module Federation emits
 * `publicPath: "auto"` for any remote whose vite.config.ts does not set an
 * explicit publicPath — that literal string must never reach the fetch
 * layer as a base URL (see MfeHandlerMF.ts header comment: "No
 * remoteEntry.js parsing is required" — this handler has no channel to
 * recover the real origin at runtime, so an unresolved "auto" must fail
 * loudly rather than silently building a bogus same-origin relative URL).
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * Opt-in stub for `importBlobModule`.
 *
 * Dynamic `import()` of a `blob:` URL is unsupported under Node/vitest's
 * module loader, so a `load()` that gets all the way through its chain
 * build still rejects at the import step. Tests that need to observe a
 * SUCCESSFUL load (the timeout-recovery test below) set
 * `blobModuleStub.current` to the module the expose chunk would have
 * evaluated to; every other test leaves it `undefined` and gets the real
 * implementation, unchanged.
 */
const blobModuleStub = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('../mf-dynamic-module-ops', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../mf-dynamic-module-ops')>();
  return {
    ...actual,
    importBlobModule: (blobUrl: string): Promise<unknown> =>
      blobModuleStub.current !== undefined
        ? Promise.resolve(blobModuleStub.current)
        : actual.importBlobModule(blobUrl),
  };
});

import { MfeHandlerMF, LruCache } from '../MfeHandlerMF';
import { MfeLoadError } from '../../errors';
import type { MfeEntryMF } from '../../types/mfe-entry-mf';
import type { MfManifest, MfManifestShared } from '../../manifest/mf-manifest';

// Fixture type IDs use a mock notation rather than the real GTS strings: the
// handler treats them as opaque cache keys and error context, and MFES-1
// forbids @gears-frontx/mfes from carrying type-format literals at all.
const MANIFEST_ID = 'mock.mfe.mf_manifest.v1~test.manifest.v1';
const ENTRY_BASE_ID = 'mock.mfe.entry.v1~';
const ENTRY_ID = `${ENTRY_BASE_ID}test.entry.v1`;

function buildManifest(
  publicPath: string,
  shared: MfManifestShared[] = []
): MfManifest {
  return {
    id: MANIFEST_ID,
    name: 'testMfe',
    metaData: {
      name: 'testMfe',
      type: 'app',
      buildInfo: { buildVersion: '1.0.0', buildName: 'testMfe' },
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
      globalName: 'testMfe',
      publicPath,
    },
    shared,
  };
}

function buildEntry(
  manifest: MfManifest,
  exposeChunk: string = 'assets/lifecycle.js'
): MfeEntryMF {
  return {
    id: ENTRY_ID,
    requiredProperties: [],
    actions: [],
    domainActions: [],
    manifest,
    exposedModule: './lifecycle',
    exposeAssets: {
      js: { sync: [exposeChunk], async: [] },
      css: { sync: [], async: [] },
    },
  };
}

/** A `Response`-shaped object satisfying `fetchSourceText`'s checks. */
function jsResponse(body: string): Response {
  return {
    ok: true,
    headers: { get: () => 'application/javascript' },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Builds a `fetch` mock implementation that resolves each URL against
 * `routes` (keyed by the URL's trailing path segment, e.g. 'a.js'), after an
 * optional per-route delay, and records the wall-clock time each URL was
 * first invoked (dispatch time) and how many times it was called — the
 * signal these concurrency tests assert on.
 */
function createFetchRouter(
  routes: Record<string, { body: string; delayMs?: number }>
): {
  fetchImpl: (input: string | URL | Request) => Promise<Response>;
  dispatchedAt: Map<string, number>;
  callCounts: Map<string, number>;
} {
  const dispatchedAt = new Map<string, number>();
  const callCounts = new Map<string, number>();

  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    callCounts.set(url, (callCounts.get(url) ?? 0) + 1);
    if (!dispatchedAt.has(url)) {
      dispatchedAt.set(url, Date.now());
    }
    if (!key) {
      return Promise.reject(new TypeError(`unmocked fetch: ${url}`));
    }
    const route = routes[key];
    if (route.delayMs === undefined || route.delayMs === 0) {
      return Promise.resolve(jsResponse(route.body));
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve(jsResponse(route.body)), route.delayMs);
    });
  };

  return { fetchImpl, dispatchedAt, callCounts };
}

/** Sum of every recorded fetch call across all URLs. */
function totalFetches(callCounts: Map<string, number>): number {
  return [...callCounts.values()].reduce((sum, n) => sum + n, 0);
}

/** Calls recorded for the single URL ending in `suffix` (0 when never fetched). */
function fetchesFor(callCounts: Map<string, number>, suffix: string): number {
  let total = 0;
  for (const [url, count] of callCounts) {
    if (url.endsWith(suffix)) total += count;
  }
  return total;
}

/**
 * The per-load blob state `loadExposedModuleIsolated` builds internally.
 * Hand-built here so tests can drive `resolveLazyChunk` directly and then
 * inspect `blobUrlMap` — the durable record of which chunks actually got a
 * blob URL — which a `load()`-level test cannot observe (dynamic `import()`
 * of a `blob:` URL is unsupported under Node/vitest's module loader, so
 * `load()` always rejects downstream of the chain build).
 */
function buildLoadState(): {
  blobUrlMap: Map<string, string>;
  inFlight: Map<string, unknown>;
  baseUrl: string;
  entryId: string;
  sharedDepBlobUrls: Map<string, string>;
  entryChunkFilename: string;
} {
  return {
    blobUrlMap: new Map<string, string>(),
    inFlight: new Map<string, unknown>(),
    baseUrl: PUBLIC_PATH,
    entryId: ENTRY_ID,
    sharedDepBlobUrls: new Map<string, string>(),
    entryChunkFilename: 'assets/lifecycle.js',
  };
}

/** Invoke the handler's private `resolveLazyChunk` against a hand-built state. */
function resolveLazy(
  handler: MfeHandlerMF,
  relPath: string,
  loadState: unknown
): Promise<string> {
  return (
    handler as unknown as {
      resolveLazyChunk: (p: string, s: unknown) => Promise<string>;
    }
  ).resolveLazyChunk(relPath, loadState);
}

/**
 * Capture the source text of every module this load mints.
 *
 * `URL.createObjectURL` is the single choke point through which every minted
 * module passes (chunks and shared deps alike), so spying on it recovers
 * exactly the set of sources the browser would have evaluated — which is what
 * the isolation invariant has to be asserted over. The real implementation is
 * still called, so the URLs the handler stores stay genuine `blob:` URLs.
 */
function captureMintedSources(): {
  sources: () => Promise<string[]>;
  restore: () => void;
} {
  const blobs: Blob[] = [];
  const original = URL.createObjectURL.bind(URL);
  const spy = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation((object: Blob | MediaSource) => {
      if (object instanceof Blob) blobs.push(object);
      return original(object);
    });
  // jsdom's Blob has no `text()`, so the text comes back through FileReader.
  const readAsText = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsText(blob);
    });
  return {
    sources: () => Promise.all(blobs.map(readAsText)),
    restore: () => {
      spy.mockRestore();
    },
  };
}

/**
 * Every static/side-effect import specifier in `source` that is NOT an
 * inline-content URL minted by this load — i.e. every specifier that would
 * make the browser instantiate a module under a URL some other load could
 * reach too (`http(s):`), or that it could not resolve at all (a bare
 * specifier left unrewritten).
 */
function foreignSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|[^.\w$])(?:from|import)\s*(['"])([^'"]+)\1/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[2];
    if (!specifier.startsWith('blob:') && !specifier.startsWith('data:')) {
      found.push(specifier);
    }
  }
  return found;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('MfeHandlerMF — unresolved publicPath placeholder guard', () => {
  it.each(['auto', 'auto/'])(
    'rejects manifest.metaData.publicPath === %j with a diagnostic MfeLoadError',
    async (placeholder) => {
      // retries: 0 — the guard's rejection is deterministic and must not be
      // masked by RetryHandler's exponential-backoff retries (default 2
      // retries would add seconds of real delay per assertion here).
      const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
      const entry = buildEntry(buildManifest(placeholder));

      // Fetch must never be reached — the guard fires before any network
      // access derived from the unresolved baseUrl.
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(
        handler.load(entry, `extension-${placeholder}`)
      ).rejects.toThrow(MfeLoadError);
      await expect(
        handler.load(entry, `extension-${placeholder}-msg`)
      ).rejects.toThrow(/unresolved Module Federation placeholder "auto/);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    }
  );

  it('does not reject a concrete resolved publicPath at the guard step', async () => {
    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(buildManifest('http://localhost:3099/'));

    // A concrete publicPath passes the guard and proceeds to fetch the
    // (nonexistent, in this unit test) chunk — asserting on the failure
    // mode confirms the guard did NOT reject it as an "auto" placeholder.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('network error for test'));

    await expect(handler.load(entry, 'extension-concrete')).rejects.toThrow(
      MfeLoadError
    );
    await expect(handler.load(entry, 'extension-concrete-2')).rejects.not.toThrow(
      /unresolved Module Federation placeholder/
    );
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3099/assets/lifecycle.js');

    fetchSpy.mockRestore();
  });
});

const PUBLIC_PATH = 'http://localhost:3099/';

function sharedDep(
  name: string,
  chunkPath: string,
  opts: { version?: string; contentHash?: string } = {}
): MfManifestShared {
  return {
    name,
    version: opts.version ?? '1.0.0',
    chunkPath,
    unwrapKey: null,
    ...(opts.contentHash !== undefined ? { contentHash: opts.contentHash } : {}),
  };
}

/**
 * Concurrent-fetch behaviour of the two dependency-fanout loops
 * (`fetchSharedDepSources`'s shared-dep loop and
 * `createBlobUrlChainInternal`'s sibling loop) and the cycle-detection
 * fallback that keeps them from deadlocking on circular dependencies. Prior
 * coverage of these loops only mocked `fetch` to reject immediately, so the
 * concurrent-dispatch path, the cross-caller `inFlight`/`blobUrlMap` dedup
 * path, and the cycle-detection fallback were never actually exercised.
 */
describe('MfeHandlerMF — concurrent dependency fetch', () => {
  it('dispatches all shared-dependency fetches concurrently rather than one at a time', async () => {
    // Each dep is deliberately slow (40ms) and there are three of them.
    // A serial loop (await inside the loop before issuing the next fetch)
    // would issue dep-2's fetch only after dep-1's 40ms response arrived,
    // and dep-3's only after dep-2's — so the SECOND and THIRD fetch calls
    // would be dispatched ~40ms and ~80ms after the first. Concurrent
    // dispatch issues all three within a few ms of each other, regardless of
    // when each later resolves. Asserting on dispatch time (not total
    // elapsed load() time) isolates the dispatch-ordering behaviour and is
    // robust to the expose-chunk fetch that runs afterward.
    const manifest = buildManifest(PUBLIC_PATH, [
      sharedDep('dep-a', 'shared/dep-a.js'),
      sharedDep('dep-b', 'shared/dep-b.js'),
      sharedDep('dep-c', 'shared/dep-c.js'),
    ]);
    const entry = buildEntry(manifest);

    const { fetchImpl, dispatchedAt } = createFetchRouter({
      'dep-a.js': { body: 'export const a = 1;', delayMs: 40 },
      'dep-b.js': { body: 'export const b = 1;', delayMs: 40 },
      'dep-c.js': { body: 'export const c = 1;', delayMs: 40 },
      // Expose chunk: reject fast so the test doesn't wait on it — the
      // shared-dep dispatch timing has already been captured by then.
      'lifecycle.js': { body: '' },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    await handler.load(entry, 'ext-concurrent-shared').catch(() => {
      // The expose chunk resolves with an empty module (no lifecycle
      // exports), so load() rejects downstream of the assertion below —
      // irrelevant to what this test checks.
    });

    const depTimes = ['dep-a.js', 'dep-b.js', 'dep-c.js'].map((suffix) => {
      const url = [...dispatchedAt.keys()].find((u) => u.endsWith(suffix));
      expect(url, `expected a fetch call for ${suffix}`).toBeDefined();
      return dispatchedAt.get(url as string) as number;
    });

    const spread = Math.max(...depTimes) - Math.min(...depTimes);
    // Sequential dispatch would spread these by ~40-80ms (one full response
    // per iteration before the next fetch is even issued); concurrent
    // dispatch issues all three within a handful of milliseconds.
    expect(spread).toBeLessThan(30);

    fetchSpy.mockRestore();
  });

  it('shares a single underlying fetch across two concurrent callers requesting the same chunk', async () => {
    // The expose chunk imports two siblings, both of which statically
    // import a common chunk. Serial (depth-first, fully-awaited) sibling
    // processing would still de-dup this correctly; what this test isolates
    // is that fanning the two siblings out concurrently doesn't regress the
    // `inFlight` dedup for the chunk they share — a race the synchronous
    // check-then-set in `createBlobUrlChain` is documented to prevent, but
    // which this test alone (dedup count only) would still pass against a
    // fully serial implementation. See the next test for an assertion that
    // actually requires concurrent dispatch to pass.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const { fetchImpl, callCounts } = createFetchRouter({
      'lifecycle.js': {
        body: "import './sibling-a.js';\nimport './sibling-b.js';\nexport default { mount(){}, unmount(){} };",
      },
      'sibling-a.js': {
        body: "import './common.js';\nexport const a = 1;",
      },
      'sibling-b.js': {
        body: "import './common.js';\nexport const b = 1;",
      },
      // Delayed so both siblings' requests for it are in flight at once.
      'common.js': { body: 'export const common = 1;', delayMs: 20 },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    // The blob URL chain (what this test targets) fully resolves before
    // `load()` reaches `importBlobModule` — dynamic `import()` of a `blob:`
    // URL isn't supported under Node/vitest's module loader, so the load
    // itself rejects downstream of the assertion below; that rejection is
    // irrelevant to what's being verified here (the fetch de-dup).
    await handler.load(entry, 'ext-shared-common-dep').catch(() => {});

    const commonCalls = [...callCounts.entries()].filter(([url]) =>
      url.endsWith('common.js')
    );
    expect(commonCalls).toHaveLength(1);
    expect(commonCalls[0][1]).toBe(1);

    fetchSpy.mockRestore();
  });

  it('dispatches two independent sibling static-import chains before either one resolves', async () => {
    // Unlike the dedup test above, this asserts on dispatch ORDER (a
    // deterministic in-process log), not dedup count or a wall-clock
    // threshold: sibling-a.js and sibling-b.js share no dependency here, so
    // a fully serial sibling loop (await sibling-a's entire recursive
    // subtree before even starting sibling-b) would still pass every
    // assertion in the test above, but would dispatch sibling-b.js's fetch
    // only AFTER sibling-a.js's fetch has already resolved. Concurrent
    // fan-out dispatches both before either resolves.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);
    const events: string[] = [];

    const fetchImpl = (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('lifecycle.js')) {
        events.push('dispatch:lifecycle.js');
        return Promise.resolve(
          jsResponse(
            "import './sibling-a.js';\nimport './sibling-b.js';\nexport default { mount(){}, unmount(){} };"
          )
        );
      }
      const match = ['sibling-a.js', 'sibling-b.js'].find((key) => url.endsWith(key));
      if (!match) {
        return Promise.reject(new TypeError(`unmocked fetch: ${url}`));
      }
      events.push(`dispatch:${match}`);
      return new Promise((resolve) => {
        setTimeout(() => {
          events.push(`resolve:${match}`);
          resolve(jsResponse(`export const v = '${match}';`));
        }, 15);
      });
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    await handler.load(entry, 'ext-sibling-dispatch-order').catch(() => {});

    const dispatchB = events.indexOf('dispatch:sibling-b.js');
    const resolveA = events.indexOf('resolve:sibling-a.js');
    expect(dispatchB, `dispatch log: ${events.join(', ')}`).toBeGreaterThan(-1);
    expect(resolveA, `dispatch log: ${events.join(', ')}`).toBeGreaterThan(-1);
    expect(dispatchB).toBeLessThan(resolveA);

    fetchSpy.mockRestore();
  });

  it('fails a diamond-shaped cross-branch cycle with a diagnostic rather than resolving any chunk from origin', async () => {
    // a.js and b.js are independent siblings (both reached directly from
    // root.js) that both statically import c.js, and c.js statically imports
    // back to b.js — the cycle only closes once a's branch and b's branch
    // meet at c, not on either branch's own recursion path. A cycle guard
    // that only tracks each call's own ancestor chain (rather than the
    // shared in-flight entry) misses this shape entirely: c is reached via
    // a's path, which never has b.js as an ancestor, so it falls through to
    // joining b's already in-flight promise while b, elsewhere, is joining
    // c's — a genuine circular wait.
    //
    // The 20ms delay on c.js is the ordering device, not incidental: it is
    // what guarantees b joins c's in-flight construction (contributing its
    // lineage) BEFORE c parses its own imports, which is the order in which
    // the cross-branch cycle is detectable at all.
    //
    // A cyclic chunk graph has no order in which per-load blob URLs could be
    // minted, so the load fails rather than resolving the cycle-closing
    // specifier from origin. The deadlock guard still earns its keep: the
    // rejection has to arrive inside it, which is what proves detection
    // failed the build instead of entering the circular wait.
    const { fetchImpl, callCounts } = createFetchRouter({
      'root.js': { body: "import './a.js';\nimport './b.js';\nexport const r = 1;" },
      'a.js': { body: "import './c.js';\nexport const a = 1;" },
      'b.js': { body: "import './c.js';\nexport const b = 1;" },
      'c.js': { body: "import './b.js';\nexport const c = 1;", delayMs: 20 },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const minted = captureMintedSources();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    const startedAt = Date.now();
    const deadlockGuard = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('deadlocked: diamond-shaped cycle never settled')),
        2000
      );
    });

    let thrown: unknown;
    try {
      await Promise.race([
        resolveLazy(handler, './root.js', loadState),
        deadlockGuard,
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MfeLoadError);
    expect((thrown as Error).message).toMatch(
      /dependency cycle: chunk 'assets\/b\.js'/
    );
    // Well inside the guard, not near it: a rejection arriving at 1900ms of
    // a 2000ms guard would be a latent hang rather than a detection.
    expect(Date.now() - startedAt).toBeLessThan(1000);

    // Nothing minted for this build may name a module by anything other than
    // the inline content this load produced.
    for (const source of await minted.sources()) {
      expect(foreignSpecifiers(source), `minted source: ${source}`).toEqual([]);
    }
    // The cross-caller dedup still holds on the chunks that were fetched;
    // fail-at-detection stops the build early, so not every chunk
    // necessarily is.
    for (const chunk of ['root.js', 'a.js', 'b.js', 'c.js']) {
      expect(
        fetchesFor(callCounts, chunk),
        `fetch count for ${chunk}`
      ).toBeLessThanOrEqual(1);
    }
    // The diagnostic IS the raised error; a warning alongside it would be
    // noise for a condition that is fatal.
    expect(warnSpy).not.toHaveBeenCalled();

    minted.restore();
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('fails mutually-importing chunks with a diagnostic naming the chunk on the cycle', async () => {
    // x.js and y.js statically import each other on a single, linear call
    // path — the simplest cycle shape, and fully deterministic: no fetch
    // delay is needed to reproduce it, because x is on y's own recursion
    // path by construction. x registers itself in `inFlight` and starts
    // resolving y; y's request for x is detected by the plain ancestor
    // check instead of awaiting x's still-pending promise. Being the
    // deterministic fixture, this is where the exact diagnostic text is
    // asserted.
    const { fetchImpl, callCounts } = createFetchRouter({
      'x.js': { body: "import './y.js';\nexport const x = 1;" },
      'y.js': { body: "import './x.js';\nexport const y = 1;" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const minted = captureMintedSources();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    const startedAt = Date.now();
    const deadlockGuard = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('deadlocked: mutually-importing chunks never settled')),
        2000
      );
    });

    let thrown: unknown;
    try {
      await Promise.race([
        resolveLazy(handler, './x.js', loadState),
        deadlockGuard,
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MfeLoadError);
    const message = (thrown as Error).message;
    // Names the chunk on the cycle, the lineage that closes it, the
    // microfrontend, and the remedy.
    expect(message).toMatch(/dependency cycle: chunk 'assets\/x\.js'/);
    expect(message).toContain('own lineage');
    expect(message).toContain('assets/x.js');
    expect(message).toContain(ENTRY_ID);
    expect(message).toMatch(/acyclic/);
    expect(Date.now() - startedAt).toBeLessThan(1000);

    for (const source of await minted.sources()) {
      expect(foreignSpecifiers(source), `minted source: ${source}`).toEqual([]);
    }
    expect(fetchesFor(callCounts, 'x.js')).toBeLessThanOrEqual(1);
    expect(fetchesFor(callCounts, 'y.js')).toBeLessThanOrEqual(1);
    expect(warnSpy).not.toHaveBeenCalled();

    minted.restore();
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('rejects with a diagnostic MfeLoadError roughly at the configured timeout when a fetch never resolves', async () => {
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    // Never resolves — `RetryHandler.retry` only retries on a thrown error
    // and races nothing against a clock on its own, so without a timeout
    // race around the whole attempt this would hang the returned promise
    // indefinitely.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>(() => {}));

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0, timeout: 50 });

    const start = Date.now();
    await expect(handler.load(entry, 'ext-timeout')).rejects.toThrow(MfeLoadError);
    await expect(
      handler.load(entry, 'ext-timeout-msg')
    ).rejects.toThrow(/timed out after 50ms/);
    const elapsed = Date.now() - start;

    // Generous upper bound: two sequential 50ms-timeout attempts plus test
    // overhead should stay well under 1s; a hang would blow past this (and
    // the suite's own timeout) entirely.
    expect(elapsed).toBeLessThan(1000);

    fetchSpy.mockRestore();
  });

  it('releases the abandoned attempt\'s source-text cache entry on timeout, so the retry re-fetches and can succeed', async () => {
    // The recovery case, not just the bound: attempt 1's fetch never
    // settles and is abandoned at the budget; attempt 2 must issue its OWN
    // fetch for the same URL and complete the load. Before the release,
    // attempt 2 got the same hung promise back out of `sourceTextCache`
    // (evicted only on rejection, and a hang never rejects) and expired
    // against its own budget, so the load failed after every attempt.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const lifecycleUrls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(((
      input: string | URL | Request
    ) => {
      const url = String(input);
      if (!url.endsWith('lifecycle.js')) {
        return Promise.reject(new TypeError(`unmocked fetch: ${url}`));
      }
      lifecycleUrls.push(url);
      // Attempt 1 hangs forever; attempt 2's own fetch resolves.
      return lifecycleUrls.length === 1
        ? new Promise<Response>(() => {})
        : Promise.resolve(
            jsResponse('export default { mount(){}, unmount(){} };')
          );
    }) as unknown as typeof fetch);

    const lifecycle = { mount: (): void => {}, unmount: (): void => {} };
    blobModuleStub.current = { default: lifecycle };

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, {
      retries: 1,
      timeout: 50,
    });

    try {
      const loaded = await handler.load(entry, 'ext-timeout-recovery');
      expect(typeof loaded.mount).toBe('function');
      // Two SEPARATE fetches for the one chunk URL: the abandoned attempt's
      // and the retry's own. One call would mean the retry rejoined the
      // hung promise.
      expect(lifecycleUrls).toHaveLength(2);
      expect(lifecycleUrls[0]).toBe(lifecycleUrls[1]);
    } finally {
      blobModuleStub.current = undefined;
      fetchSpy.mockRestore();
    }
  });

  it('leaves an entry a concurrent load registered under the same key untouched when an attempt times out', async () => {
    // The release is identity-checked: it removes the key only while it
    // still maps to the very promise the abandoned attempt was waiting on.
    // An entry another, still-live load has since registered under that key
    // must survive.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>(() => {}));

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, {
      retries: 0,
      timeout: 80,
    });
    const sourceTextCache = (
      handler as unknown as {
        sourceTextCache: LruCache<string, Promise<string>>;
      }
    ).sourceTextCache;

    const chunkUrl = `${PUBLIC_PATH}assets/lifecycle.js`;
    const rejection = expect(
      handler.load(entry, 'ext-timeout-identity')
    ).rejects.toThrow(/timed out after 80ms/);

    // Let the attempt register its own hung promise, then stand in for a
    // concurrent load that replaces the entry under the same key.
    await sleep(20);
    expect(sourceTextCache.has(chunkUrl)).toBe(true);
    const concurrentEntry = new Promise<string>(() => {});
    sourceTextCache.set(chunkUrl, concurrentEntry);

    await rejection;

    expect(sourceTextCache.get(chunkUrl)).toBe(concurrentEntry);

    fetchSpy.mockRestore();
  });

  it('never exceeds the configured fetch width for one chain build, however deep and wide the graph', async () => {
    // Six branches of depth three, each level fanning out again: 1 + 6 + 12
    // + 24 chunks. With a per-batch pool, each sibling group opened its own
    // pool of MAX_CONCURRENT_FETCHES, so the width multiplied by the
    // graph's bushiness — the level-2 groups alone could put well over the
    // width in flight at once. A single build-scoped budget holds the bound
    // no matter the shape.
    const WIDTH = 6;
    const routes: Record<string, { body: string; delayMs?: number }> = {};
    const branches = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
    routes['root.js'] = {
      body: branches.map((b) => `import './${b}.js';`).join('\n'),
      delayMs: 5,
    };
    for (const b of branches) {
      routes[`${b}.js`] = {
        body: [0, 1].map((i) => `import './${b}-${i}.js';`).join('\n'),
        delayMs: 5,
      };
      for (const i of [0, 1]) {
        routes[`${b}-${i}.js`] = {
          body: [0, 1].map((j) => `import './${b}-${i}-${j}.js';`).join('\n'),
          delayMs: 5,
        };
        for (const j of [0, 1]) {
          routes[`${b}-${i}-${j}.js`] = {
            body: `export const leaf = '${b}-${i}-${j}';`,
            delayMs: 5,
          };
        }
      }
    }

    let inFlight = 0;
    let peakInFlight = 0;
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((async (input: string | URL | Request) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        try {
          return await fetchImpl(input);
        } finally {
          inFlight -= 1;
        }
      }) as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    const blobUrl = await resolveLazy(handler, './root.js', loadState);
    expect(blobUrl).toMatch(/^blob:/);
    // 1 root + 6 + 12 + 24 leaves all built.
    expect(loadState.blobUrlMap.size).toBe(43);
    expect(peakInFlight).toBeLessThanOrEqual(WIDTH);
    // Sanity: the budget is actually saturated, so the bound above is a
    // real ceiling rather than an artifact of nothing overlapping.
    expect(peakInFlight).toBeGreaterThan(1);

    fetchSpy.mockRestore();
  });

  it('reports the first failing sibling in declaration order, not the first to fail in wall-clock time', async () => {
    // `root.js` imports `first-bad.js` then `second-bad.js`; the SECOND one
    // fails immediately while the first takes 40ms to fail. Completion-order
    // reporting would surface `second-bad.js`; declaration-order reporting
    // (what `firstRejection` preserves across the concurrent fan-out) must
    // surface `first-bad.js` regardless of who lost the race.
    const { fetchImpl } = createFetchRouter({
      'root.js': {
        body: "import './first-bad.js';\nimport './second-bad.js';\nexport const r = 1;",
      },
      // Neither bad chunk is routed, so both reject; the delay decides only
      // WHICH rejects first in wall-clock time.
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('first-bad.js')) {
          return new Promise<Response>((_resolve, reject) => {
            setTimeout(() => reject(new TypeError('slow failure')), 40);
          });
        }
        if (url.endsWith('second-bad.js')) {
          return Promise.reject(new TypeError('fast failure'));
        }
        return fetchImpl(input);
      }) as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    await expect(resolveLazy(handler, './root.js', loadState)).rejects.toThrow(
      /first-bad\.js/
    );

    fetchSpy.mockRestore();
  });

  it('does not race the attempt against a clock when the configured timeout is non-positive', async () => {
    // 0 is the conventional "no timeout" idiom. A zero-delay timer would
    // fail every attempt immediately; the guard must disable the race.
    const manifest = buildManifest(PUBLIC_PATH, []);
    const entry = buildEntry(manifest);

    const { fetchImpl } = createFetchRouter({
      'lifecycle.js': {
        body: 'export default { mount(){}, unmount(){} };',
        delayMs: 60,
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0, timeout: 0 });

    const start = Date.now();
    // The chain build itself completes; `load()` still rejects downstream at
    // `importBlobModule` (dynamic `import()` of a `blob:` URL is unsupported
    // under Node/vitest's module loader). What matters is HOW it rejects.
    await expect(handler.load(entry, 'ext-timeout-disabled')).rejects.not.toThrow(
      /timed out after/
    );
    // The attempt was allowed to run past the 0ms budget rather than being
    // failed at once.
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    expect(fetchSpy).toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('fails fast on a manifest that declares the same shared-dependency name twice', async () => {
    const manifest = buildManifest(PUBLIC_PATH, [
      sharedDep('dup-dep', 'shared/dup-dep-v1.js'),
      sharedDep('dup-dep', 'shared/dup-dep-v2.js'),
    ]);
    const entry = buildEntry(manifest);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    await expect(handler.load(entry, 'ext-dup-shared-name')).rejects.toThrow(
      /declares 'dup-dep' more than once/
    );
    // The fail-fast check runs before any network access.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

/**
 * Regression coverage for the per-build failure token that replaced a
 * single load-wide `failed` flag on `LoadBlobState`. A shared, never-reset
 * flag latched permanently after the first failed lazy import, causing
 * every subsequent — otherwise entirely independent — lazy import on the
 * same already-mounted MFE to fail with
 * "failed to mint blob URL for lazy chunk" even though it never touched the
 * chunk that actually failed. These tests drive `resolveLazyChunk` directly
 * against a hand-built `LoadBlobState` (the private per-load state
 * `loadExposedModuleIsolated` would otherwise construct), since dynamic
 * `import()` of a `blob:` URL is not supported under Node/vitest's module
 * loader and would otherwise mask the failure downstream of the assertions
 * here.
 */
describe('MfeHandlerMF — lazy-import failure isolation', () => {
  it('does not let one failed lazy import block a later, independent lazy import on the same load', async () => {
    // `broken.js` itself fetches fine but statically imports `missing-dep.js`,
    // which does not. This is deliberate, not incidental: the failure must
    // surface through the sibling-fan-out rejection path in
    // `createBlobUrlChainInternal` (parse deps → fan out → first rejection
    // in declaration order → raise the build's failure signal → throw),
    // which is the path that raises the signal at all. A fetch failure on
    // the top-level lazy chunk's OWN source text rejects before that code
    // ever runs, so it would not exercise the isolation this test asserts.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(((input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('broken.js')) {
          return Promise.resolve(
            jsResponse("import './missing-dep.js';\nexport const broken = 1;")
          );
        }
        if (url.endsWith('missing-dep.js')) {
          return Promise.reject(new TypeError('network error for test'));
        }
        if (url.endsWith('ok.js')) {
          return Promise.resolve(jsResponse('export const ok = 1;'));
        }
        return Promise.reject(new TypeError(`unmocked fetch: ${url}`));
      }) as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });

    // Hand-built per-load state, mirroring what `loadExposedModuleIsolated`
    // builds internally. The failure signal is per chain build, never on
    // this per-load state.
    const loadState = {
      blobUrlMap: new Map<string, string>(),
      inFlight: new Map(),
      baseUrl: PUBLIC_PATH,
      entryId: ENTRY_ID,
      sharedDepBlobUrls: new Map<string, string>(),
      entryChunkFilename: 'assets/lifecycle.js',
    };

    // First lazy import fails (its target chunk 404s / network-errors).
    await expect(
      (handler as unknown as {
        resolveLazyChunk: (relPath: string, loadState: unknown) => Promise<string>;
      }).resolveLazyChunk('./broken.js', loadState)
    ).rejects.toThrow(MfeLoadError);

    // A second, wholly independent lazy import on the SAME load must still
    // succeed — it never depends on './broken.js' in any way. A failure
    // signal that outlived its own chain build would stop this call inside
    // `createBlobUrlChainInternal` before it fetched anything, leaving no
    // `blobUrlMap` entry for `resolveLazyChunk` to return.
    const blobUrl = await (
      handler as unknown as {
        resolveLazyChunk: (relPath: string, loadState: unknown) => Promise<string>;
      }
    ).resolveLazyChunk('./ok.js', loadState);
    expect(blobUrl).toMatch(/^blob:/);

    fetchSpy.mockRestore();
  });

  it('re-attempts a chunk the failed build abandoned instead of joining its settled, empty in-flight entry', async () => {
    // The previous test uses two DISJOINT lazy chunks, so the failed build
    // and the later one share nothing. This one makes them overlap, in the
    // SEQUENTIAL order: `broken.js` fans out to `a.js` (which imports a
    // chunk that never loads) and to `slow.js` (still mid-fetch when a's
    // failure raises the build's failure signal). `slow.js`'s construction
    // therefore RESOLVES — it returns early rather than throwing — without
    // ever minting a blob URL, leaving a settled promise in `inFlight`
    // under 'assets/slow.js' that produced nothing. Unless that entry is
    // dropped on settle, every later request for the filename joins it,
    // resolves instantly, never re-fetches, and finds no `blobUrlMap`
    // entry — so `resolveLazyChunk` rejects with "failed to mint blob URL
    // for lazy chunk './slow.js'" for the rest of the page's life.
    // The OVERLAPPING-CONCURRENT case is the test below.
    const { fetchImpl, callCounts } = createFetchRouter({
      'broken.js': { body: "import './a.js';\nimport './slow.js';\nexport const b = 1;" },
      // `missing.js` is deliberately unrouted — the router rejects any URL
      // it has no route for, which is the network failure this needs.
      'a.js': { body: "import './missing.js';\nexport const a = 1;" },
      'slow.js': {
        body: "import './slow-dep.js';\nexport const s = 1;",
        delayMs: 50,
      },
      'slow-dep.js': { body: 'export const d = 1;' },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    await expect(resolveLazy(handler, './broken.js', loadState)).rejects.toThrow(
      MfeLoadError
    );

    // Let `slow.js`'s own fetch settle, so its construction runs its
    // abandon-without-a-blob-URL path while nothing is watching.
    await sleep(120);
    expect(loadState.blobUrlMap.has('assets/slow.js')).toBe(false);
    const fetchesBefore = totalFetches(callCounts);

    const blobUrl = await resolveLazy(handler, './slow.js', loadState);
    expect(blobUrl).toMatch(/^blob:/);
    expect(loadState.blobUrlMap.get('assets/slow.js')).toBe(blobUrl);

    // Construction genuinely re-ran rather than short-circuiting on the
    // stale entry: `slow-dep.js` — a chunk the abandoned build never got as
    // far as parsing, let alone fetching — is fetched now, so the build's
    // total fetch count increases.
    expect(fetchesFor(callCounts, 'slow-dep.js')).toBe(1);
    expect(totalFetches(callCounts)).toBeGreaterThan(fetchesBefore);
    // `slow.js`'s own source text is NOT re-fetched, and must not be: the
    // URL-keyed `sourceTextCache` retains a successful fetch for the
    // handler's lifetime, so re-attempting a construction reuses the source
    // it already has. Re-fetching the SOURCE is not what the fix restores;
    // re-running the CONSTRUCTION is.
    expect(fetchesFor(callCounts, 'slow.js')).toBe(1);

    fetchSpy.mockRestore();
  });

  it('re-attempts a chunk it joined when the build it joined abandons that chunk mid-flight', async () => {
    // The OVERLAPPING-CONCURRENT case: build B does not arrive after build
    // A has finished — it joins A's still-running construction of a chunk
    // two levels down A's graph, and A then abandons that chunk.
    //
    //   A: abandon-root.js → fail-branch.js → nope.js   (unrouted: fails)
    //                      → mid.js         → shared.js → shared-dep.js
    //   B: b-root.js       → shared.js
    //
    // `shared.js` is registered in `inFlight` by A almost immediately and
    // is still mid-fetch when `fail-branch.js` raises A's failure signal,
    // so A's construction of it RESOLVES without minting a blob URL. B
    // joined that promise before it settled, so dropping the unproductive
    // entry afterwards does nothing for B: B resumes on a cleanly-resolved
    // promise with no `blobUrlMap` entry behind it, and — unless it
    // verifies and re-attempts — fails its own build at
    // `rewriteModuleImports` with the never-built diagnostic, for a chunk
    // that is perfectly fetchable and that nothing ever tried to build on
    // B's behalf.
    const { fetchImpl, callCounts } = createFetchRouter({
      'abandon-root.js': {
        body: "import './fail-branch.js';\nimport './mid.js';\nexport const r = 1;",
      },
      // `nope.js` is deliberately unrouted — the router rejects any URL it
      // has no route for, which is the network failure this needs. The
      // delay puts A's failure AFTER B has joined `shared.js`.
      'fail-branch.js': {
        body: "import './nope.js';\nexport const f = 1;",
        delayMs: 40,
      },
      'mid.js': { body: "import './shared.js';\nexport const m = 1;" },
      'shared.js': {
        body: "import './shared-dep.js';\nexport const s = 1;",
        delayMs: 80,
      },
      'shared-dep.js': { body: 'export const d = 1;' },
      'b-root.js': { body: "import './shared.js';\nexport const b = 1;" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    const buildA = resolveLazy(handler, './abandon-root.js', loadState);
    // Long enough for A to reach `shared.js` and register it in `inFlight`
    // (only zero-delay fetches stand between the two), far short of the
    // 40ms that raises A's failure signal.
    await sleep(5);
    expect(loadState.inFlight.has('assets/shared.js')).toBe(true);
    const buildB = resolveLazy(handler, './b-root.js', loadState);

    await expect(buildA).rejects.toThrow(MfeLoadError);

    // B must survive A's abandonment of the chunk they share.
    const blobUrl = await buildB;
    expect(blobUrl).toMatch(/^blob:/);
    expect(loadState.blobUrlMap.get('assets/shared.js')).toBeDefined();
    // B re-ran the CONSTRUCTION, so `shared.js`'s own dependency — which
    // A's abandoned build never got as far as requesting — is built now.
    expect(loadState.blobUrlMap.has('assets/shared-dep.js')).toBe(true);
    expect(fetchesFor(callCounts, 'shared-dep.js')).toBe(1);
    // The source text is not re-fetched: the URL-keyed `sourceTextCache`
    // still holds A's successful fetch. Re-running the construction is what
    // matters, not re-fetching the bytes.
    expect(fetchesFor(callCounts, 'shared.js')).toBe(1);

    fetchSpy.mockRestore();
  });
});

describe('MfeHandlerMF — an unbuilt dependency at rewrite time', () => {
  // Drives the private `rewriteModuleImports` directly. An absence from the
  // per-load blob URL map now has a single outcome: there is no sanctioned
  // reason for one, because a detected dependency cycle fails the build
  // where it is detected rather than leaving a hole to be filled from
  // origin here.
  const rewrite = (
    handler: MfeHandlerMF,
    source: string,
    loadState: unknown,
    chunkFilename: string
  ): string =>
    (
      handler as unknown as {
        rewriteModuleImports: (
          src: string,
          state: unknown,
          chunk: string
        ) => string;
      }
    ).rewriteModuleImports(source, loadState, chunkFilename);

  it('fails the load with a diagnostic naming the referring chunk and the dependency that was never built', () => {
    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const loadState = buildLoadState();

    let thrown: unknown;
    try {
      rewrite(
        handler,
        "import './never-built.js';\nexport const v = 1;",
        loadState,
        'assets/referrer.js'
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MfeLoadError);
    expect((thrown as Error).message).toContain('assets/referrer.js');
    expect((thrown as Error).message).toContain('assets/never-built.js');
    // The whole point: no origin URL is emitted for it.
    expect((thrown as Error).message).toMatch(/origin URL/);
  });
});

/**
 * The headline invariant: for every load, cyclic or acyclic, every module
 * this handler mints names its dependencies ONLY by inline-content URLs this
 * load produced. Any `http(s):` specifier would be a module the browser keys
 * by that URL and therefore shares with every other load reaching it; any
 * surviving bare specifier would be a module the browser cannot resolve at
 * all. The property is universal ("never emits"), so it is asserted by
 * scanning every minted source of every fixture rather than by exhibiting
 * one good case.
 */
describe('MfeHandlerMF — per-load isolation invariant over every fixture', () => {
  const FIXTURES: Record<
    string,
    {
      routes: Record<string, { body: string; delayMs?: number }>;
      shared: MfManifestShared[];
      loads: boolean;
    }
  > = {
    'a linear chunk chain': {
      routes: {
        'lifecycle.js': { body: "import './a.js';\nexport default {};" },
        'a.js': { body: "import './b.js';\nexport const a = 1;" },
        'b.js': { body: 'export const b = 1;' },
      },
      shared: [],
      loads: true,
    },
    'a diamond with no back edge': {
      routes: {
        'lifecycle.js': {
          body: "import './a.js';\nimport './b.js';\nexport default {};",
        },
        'a.js': { body: "import './c.js';\nexport const a = 1;", delayMs: 10 },
        'b.js': { body: "import './c.js';\nexport const b = 1;" },
        'c.js': { body: 'export const c = 1;' },
      },
      shared: [],
      loads: true,
    },
    'shared dependencies that import one another acyclically': {
      routes: {
        'lifecycle.js': { body: 'import "react";\nexport default {};' },
        'react.js': { body: 'import "scheduler";\nexport const react = 1;' },
        'scheduler.js': { body: 'export const scheduler = 1;' },
      },
      shared: [
        sharedDep('react', 'shared/react.js'),
        sharedDep('scheduler', 'shared/scheduler.js'),
      ],
      loads: true,
    },
    'a cyclic chunk graph': {
      routes: {
        'lifecycle.js': { body: "import './a.js';\nexport default {};" },
        'a.js': { body: "import './b.js';\nexport const a = 1;" },
        'b.js': { body: "import './a.js';\nexport const b = 1;" },
      },
      shared: [],
      loads: false,
    },
    'circular shared dependencies': {
      routes: {
        'lifecycle.js': { body: 'import "react";\nexport default {};' },
        'react.js': { body: 'import "scheduler";\nexport const react = 1;' },
        'scheduler.js': { body: 'import "react";\nexport const scheduler = 1;' },
      },
      shared: [
        sharedDep('react', 'shared/react.js'),
        sharedDep('scheduler', 'shared/scheduler.js'),
      ],
      loads: false,
    },
  };

  it.each(Object.keys(FIXTURES))(
    'mints no origin URL and no unrewritten bare specifier for %s',
    async (name) => {
      const fixture = FIXTURES[name];
      const { fetchImpl } = createFetchRouter(fixture.routes);
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(fetchImpl as typeof fetch);
      const minted = captureMintedSources();
      blobModuleStub.current = { default: { mount: (): void => {}, unmount: (): void => {} } };

      const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
      const entry = buildEntry(buildManifest(PUBLIC_PATH, fixture.shared));

      try {
        const settled = await handler
          .load(entry, `ext-invariant-${name}`)
          .then(
            () => 'fulfilled' as const,
            () => 'rejected' as const
          );
        expect(settled).toBe(fixture.loads ? 'fulfilled' : 'rejected');

        const sources = await minted.sources();
        // A successful load must actually have minted something, or the
        // scan below would pass vacuously. A failing one legitimately mints
        // nothing — refusing before any blob exists is the strongest form
        // of the property, and the diagnostic itself is asserted by the
        // dedicated cycle tests.
        if (fixture.loads) expect(sources.length).toBeGreaterThan(0);
        for (const source of sources) {
          expect(
            foreignSpecifiers(source),
            `minted source: ${source}`
          ).toEqual([]);
        }
      } finally {
        blobModuleStub.current = undefined;
        minted.restore();
        fetchSpy.mockRestore();
      }
    }
  );

  it('fails circular shared dependencies with a diagnostic naming the packages and the imports among them', async () => {
    // Today's alternative — minting them anyway with partial rewrites —
    // produces blobs with `from "react"` left intact, which cannot be
    // instantiated, and emits no diagnostic at all.
    const { fetchImpl } = createFetchRouter({
      'lifecycle.js': { body: 'import "react";\nexport default {};' },
      'react.js': { body: 'import "scheduler";\nexport const react = 1;' },
      'scheduler.js': { body: 'import "react";\nexport const scheduler = 1;' },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('react', 'shared/react.js'),
        sharedDep('scheduler', 'shared/scheduler.js'),
      ])
    );

    let thrown: unknown;
    try {
      await handler.load(entry, 'ext-shared-cycle');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MfeLoadError);
    const message = (thrown as Error).message;
    expect(message).toContain('circular shared dependencies');
    expect(message).toContain("'react' (imports 'scheduler')");
    expect(message).toContain("'scheduler' (imports 'react')");

    fetchSpy.mockRestore();
  });
});

describe('MfeHandlerMF — deterministic failures are not retried', () => {
  it('makes one attempt at a cyclic chunk graph, not one per configured retry', async () => {
    // A cycle is a property of the microfrontend's build: every attempt
    // reaches the same refusal, so retrying only multiplies the fetches and
    // delays the same error by the backoff. `retries: 2` is the default the
    // handler ships with, and would otherwise triple the fetch count.
    const { fetchImpl, callCounts } = createFetchRouter({
      'lifecycle.js': { body: "import './a.js';\nexport default {};" },
      'a.js': { body: "import './b.js';\nexport const a = 1;" },
      'b.js': { body: "import './a.js';\nexport const b = 1;" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 2 });
    const entry = buildEntry(buildManifest(PUBLIC_PATH));

    const startedAt = Date.now();
    await expect(handler.load(entry, 'ext-no-retry-cycle')).rejects.toThrow(
      /dependency cycle/
    );

    // One attempt's worth of fetches, not three — and none of the 1000ms /
    // 2000ms backoff a retried attempt would have waited.
    expect(fetchesFor(callCounts, 'lifecycle.js')).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(1000);

    fetchSpy.mockRestore();
  });

  it('still retries a failure a repeat attempt could change', async () => {
    // The guard above must not disable retrying in general: a transient
    // fetch failure keeps its attempts.
    let calls = 0;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((() => {
        calls += 1;
        return Promise.reject(new TypeError('network error for test'));
      }) as unknown as typeof fetch);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 1 });
    const entry = buildEntry(buildManifest(PUBLIC_PATH));

    await expect(handler.load(entry, 'ext-retryable')).rejects.toThrow(
      MfeLoadError
    );
    expect(calls).toBe(2);

    fetchSpy.mockRestore();
  });
});

describe('LruCache — capacity eviction and MRU re-insertion', () => {
  it('evicts the oldest entry once capacity is exceeded', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('re-inserting via get() marks a key most-recently-used, protecting it from the next eviction', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    // Touch 'a' so it becomes most-recently-used; 'b' is now the oldest.
    expect(cache.get('a')).toBe(1);

    cache.set('c', 3);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new LruCache<string, number>(0)).toThrow(RangeError);
    expect(() => new LruCache<string, number>(-1)).toThrow(RangeError);
  });
});

/**
 * Regression coverage for issue #621 / `cpt-frontx-adr-shared-dep-dedup-key`.
 *
 * The cross-MFE shared-dep source-text cache used to key solely on
 * `name@version`. A shared-dep chunk is built per consuming microfrontend,
 * so two manifests can legitimately declare the same name and version while
 * shipping structurally different chunk bytes; whichever manifest's load
 * reached the cache first served its chunk's text to every later manifest
 * declaring the same name and version, leaving the later manifest with an
 * unrewritten bare specifier baked into a `blob:` module and a silent mount
 * failure. The fix (not implemented by these tests) keys reuse on a
 * declared content hash when the manifest provides one, falls back to the
 * resolved absolute chunk URL (which is unique per microfrontend) when it
 * does not — emitting a one-time adoption notice per `name@version` and
 * manifest id in that case — and asserts no bare specifier survives a
 * shared-dep chunk's rewrite before minting its blob.
 */
describe('MfeHandlerMF — shared-dep cross-MFE cache key (issue #621)', () => {
  const PUBLIC_PATH_A = 'http://localhost:4101/mfe-a/';
  const PUBLIC_PATH_B = 'http://localhost:4102/mfe-b/';

  function stubSuccessfulImport(): void {
    blobModuleStub.current = {
      default: { mount: (): void => {}, unmount: (): void => {} },
    };
  }

  it('does not let a second manifest declaring the same name@version reuse the first manifest\'s shared-dep chunk text', async () => {
    // dep-x@1.0.0 is built differently by each consuming microfrontend:
    // MFE A's build externalizes 'helper-a', MFE B's build externalizes
    // 'helper-b' — disjoint dependencies a name@version-only key cannot
    // distinguish between.
    const routes = {
      [`${PUBLIC_PATH_A}assets/lifecycle.js`]: {
        body: 'import "dep-x";\nexport default {};',
      },
      [`${PUBLIC_PATH_A}shared/dep-x.js`]: {
        body: 'import "helper-a";\nexport const depx = 1;',
      },
      [`${PUBLIC_PATH_A}shared/helper-a.js`]: {
        body: 'export const helpera = 1;',
      },
      [`${PUBLIC_PATH_B}assets/lifecycle.js`]: {
        body: 'import "dep-x";\nexport default {};',
      },
      [`${PUBLIC_PATH_B}shared/dep-x.js`]: {
        body: 'import "helper-b";\nexport const depx = 1;',
      },
      [`${PUBLIC_PATH_B}shared/helper-b.js`]: {
        body: 'export const helperb = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const minted = captureMintedSources();
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const manifestA = {
      ...buildManifest(PUBLIC_PATH_A, [
        sharedDep('dep-x', 'shared/dep-x.js'),
        sharedDep('helper-a', 'shared/helper-a.js'),
      ]),
      id: 'mock.mfe.mf_manifest.v1~test.manifest-a.v1',
    };
    const manifestB = {
      ...buildManifest(PUBLIC_PATH_B, [
        sharedDep('dep-x', 'shared/dep-x.js'),
        sharedDep('helper-b', 'shared/helper-b.js'),
      ]),
      id: 'mock.mfe.mf_manifest.v1~test.manifest-b.v1',
    };

    try {
      await handler.load(buildEntry(manifestA), 'ext-dedup-a');
      await handler.load(buildEntry(manifestB), 'ext-dedup-b');

      // The whole point: every minted module, across BOTH loads, must be
      // rewritten against its own manifest's declared shared[] — never
      // another manifest's. Today, B's dep-x chunk is served A's cached
      // text (which externalizes 'helper-a', a package B never declared),
      // so 'helper-a' survives unrewritten inside B's dep-x blob.
      const sources = await minted.sources();
      const allForeign = sources.flatMap(foreignSpecifiers);
      expect(allForeign).toEqual([]);
    } finally {
      blobModuleStub.current = undefined;
      minted.restore();
      fetchSpy.mockRestore();
    }
  });

  it('reuses cached shared-dep text across manifests when their declared contentHash matches', async () => {
    const routes = {
      [`${PUBLIC_PATH_A}assets/lifecycle.js`]: {
        body: 'import "dep-x";\nexport default {};',
      },
      [`${PUBLIC_PATH_A}shared/dep-x.js`]: {
        body: 'export const depx = 1;',
      },
      [`${PUBLIC_PATH_B}assets/lifecycle.js`]: {
        body: 'import "dep-x";\nexport default {};',
      },
      [`${PUBLIC_PATH_B}shared/dep-x.js`]: {
        body: 'export const depx = 1;',
      },
    };
    const { fetchImpl, callCounts } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const manifestA = buildManifest(PUBLIC_PATH_A, [
      sharedDep('dep-x', 'shared/dep-x.js', { contentHash: 'same-hash' }),
    ]);
    const manifestB = buildManifest(PUBLIC_PATH_B, [
      sharedDep('dep-x', 'shared/dep-x.js', { contentHash: 'same-hash' }),
    ]);

    try {
      await handler.load(buildEntry(manifestA), 'ext-hash-match-a');
      await handler.load(buildEntry(manifestB), 'ext-hash-match-b');

      expect(fetchesFor(callCounts, `${PUBLIC_PATH_A}shared/dep-x.js`)).toBe(
        1
      );
      // B's load must take the cache hit: no second fetch for its own
      // resolved chunk URL.
      expect(fetchesFor(callCounts, `${PUBLIC_PATH_B}shared/dep-x.js`)).toBe(
        0
      );
    } finally {
      blobModuleStub.current = undefined;
      fetchSpy.mockRestore();
    }
  });

  it('does not reuse cached shared-dep text across manifests when their declared contentHash differs', async () => {
    const routes = {
      [`${PUBLIC_PATH_A}assets/lifecycle.js`]: {
        body: 'import "dep-x";\nexport default {};',
      },
      [`${PUBLIC_PATH_A}shared/dep-x.js`]: {
        body: 'export const depx = 1;',
      },
      [`${PUBLIC_PATH_B}assets/lifecycle.js`]: {
        body: 'import "dep-x";\nexport default {};',
      },
      [`${PUBLIC_PATH_B}shared/dep-x.js`]: {
        body: 'export const depx = 1;',
      },
    };
    const { fetchImpl, callCounts } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const manifestA = buildManifest(PUBLIC_PATH_A, [
      sharedDep('dep-x', 'shared/dep-x.js', { contentHash: 'hash-a' }),
    ]);
    const manifestB = buildManifest(PUBLIC_PATH_B, [
      sharedDep('dep-x', 'shared/dep-x.js', { contentHash: 'hash-b' }),
    ]);

    try {
      await handler.load(buildEntry(manifestA), 'ext-hash-mismatch-a');
      await handler.load(buildEntry(manifestB), 'ext-hash-mismatch-b');

      // Each manifest's declared hash disagrees with the other's, so each
      // load must fetch its own text rather than reuse the other's.
      expect(fetchesFor(callCounts, `${PUBLIC_PATH_A}shared/dep-x.js`)).toBe(
        1
      );
      expect(fetchesFor(callCounts, `${PUBLIC_PATH_B}shared/dep-x.js`)).toBe(
        1
      );
    } finally {
      blobModuleStub.current = undefined;
      fetchSpy.mockRestore();
    }
  });

  it('falls back to the resolved chunk URL and emits exactly one adoption notice per name@version + manifest id when contentHash is absent', async () => {
    const routes = {
      [`${PUBLIC_PATH_A}assets/lifecycle.js`]: {
        body: 'import "dep-y";\nexport default {};',
      },
      [`${PUBLIC_PATH_A}shared/dep-y.js`]: {
        body: 'export const depy = 1;',
      },
      [`${PUBLIC_PATH_B}assets/lifecycle.js`]: {
        body: 'import "dep-y";\nexport default {};',
      },
      [`${PUBLIC_PATH_B}shared/dep-y.js`]: {
        body: 'export const depy = 1;',
      },
    };
    const { fetchImpl, callCounts } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const manifestA = {
      ...buildManifest(PUBLIC_PATH_A, [sharedDep('dep-y', 'shared/dep-y.js')]),
      id: 'mock.mfe.mf_manifest.v1~test.notice-a.v1',
    };
    const manifestB = {
      ...buildManifest(PUBLIC_PATH_B, [sharedDep('dep-y', 'shared/dep-y.js')]),
      id: 'mock.mfe.mf_manifest.v1~test.notice-b.v1',
    };

    try {
      // Two loads of the SAME manifest: same resolved chunk URL, so the
      // fallback key reuses text — only the FIRST load's population should
      // ever emit the notice for this name@version + manifest id.
      await handler.load(buildEntry(manifestA), 'ext-notice-a-1');
      await handler.load(buildEntry(manifestA), 'ext-notice-a-2');
      expect(fetchesFor(callCounts, `${PUBLIC_PATH_A}shared/dep-y.js`)).toBe(
        1
      );

      // A load of a DIFFERENT manifest: different resolved chunk URL, so
      // the fallback key does NOT reuse A's text, and gets its own
      // one-time notice keyed on its own manifest id.
      await handler.load(buildEntry(manifestB), 'ext-notice-b-1');
      expect(fetchesFor(callCounts, `${PUBLIC_PATH_B}shared/dep-y.js`)).toBe(
        1
      );

      const depYNotices = warnSpy.mock.calls.filter((args) =>
        args.some((arg) => String(arg).includes('dep-y'))
      );
      // Exactly one notice per (name@version, manifest id) pair — two
      // distinct manifests declared dep-y, so exactly two notices total,
      // never one per load (which would be three).
      expect(depYNotices.length).toBe(2);
    } finally {
      blobModuleStub.current = undefined;
      warnSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('bounds the adoption-notice ledger: once more distinct pairs than its capacity have been observed, the earliest pair is renotified', async () => {
    // The ledger's capacity is an implementation detail (not exported), so
    // this drives enough distinct (name@version, manifest id) pairs to
    // guarantee eviction regardless of the exact number chosen, then
    // re-triggers the FIRST pair and asserts it is renotified — behaviour
    // that is only possible if its ledger entry was evicted.
    const PAIR_COUNT = 100;
    const routes: Record<string, { body: string }> = {};
    for (let i = 0; i < PAIR_COUNT; i++) {
      const publicPath = `http://localhost:5${String(i).padStart(3, '0')}/mfe/`;
      routes[`${publicPath}assets/lifecycle.js`] = {
        body: `import "dep-bound-${i}";\nexport default {};`,
      };
      routes[`${publicPath}shared/dep-bound-${i}.js`] = {
        body: `export const v = ${i};`,
      };
    }
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const manifestFor = (i: number): MfManifest => ({
      ...buildManifest(`http://localhost:5${String(i).padStart(3, '0')}/mfe/`, [
        sharedDep(`dep-bound-${i}`, `shared/dep-bound-${i}.js`),
      ]),
      id: `mock.mfe.mf_manifest.v1~test.notice-bound-${i}.v1`,
    });

    const noticeCountFor = (i: number): number =>
      warnSpy.mock.calls.filter((args) =>
        args.some((arg) => String(arg).includes(`dep-bound-${i}@`))
      ).length;

    try {
      for (let i = 0; i < PAIR_COUNT; i++) {
        await handler.load(buildEntry(manifestFor(i)), `ext-notice-bound-${i}`);
      }
      expect(noticeCountFor(0)).toBe(1);

      // Re-load pair 0. If the ledger were unbounded, this would still be
      // deduplicated (no second notice). Because it is LRU-bounded well
      // under PAIR_COUNT, pair 0's entry has been evicted by the later
      // pairs, so it is renotified.
      await handler.load(buildEntry(manifestFor(0)), 'ext-notice-bound-0-again');
      expect(noticeCountFor(0)).toBe(2);
    } finally {
      blobModuleStub.current = undefined;
      warnSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('fails the load when a DECLARED shared-dependency name survives rewriting, naming the chunk, the specifier, and the microfrontend', async () => {
    // Under normal operation this path is unreachable: dependency-order
    // resolution (`createBlobUrlsInDependencyOrder`) guarantees every
    // shared dep a chunk imports already has a blob URL by the time that
    // chunk is rewritten, so `rewriteBareSpecifiers` always removes a
    // declared name. The only way to exercise the "declared name survives"
    // branch is to simulate the rewrite step itself failing — a defect this
    // assertion exists specifically to catch, per
    // `inst-assert-shared-dep-no-bare-specifier` (the exact inverse of the
    // per-name rewrite).
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-b";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-a.js`]: {
        body: 'export const a = 1;',
      },
      [`${PUBLIC_PATH}shared/dep-b.js`]: {
        body: 'import "dep-a";\nexport const b = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    stubSuccessfulImport();

    const rewriteSpy = vi
      .spyOn(
        MfeHandlerMF.prototype as unknown as {
          rewriteBareSpecifiers: (
            source: string,
            blobUrls: Map<string, string>
          ) => string;
        },
        'rewriteBareSpecifiers'
      )
      .mockImplementation((source: string) => source);

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('dep-a', 'shared/dep-a.js'),
        sharedDep('dep-b', 'shared/dep-b.js'),
      ])
    );

    let thrown: unknown;
    try {
      await handler.load(entry, 'ext-declared-bare-specifier-survives');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MfeLoadError);
    const message = (thrown as Error).message;
    expect(message).toContain('dep-b');
    expect(message).toContain('dep-a');
    expect(message).toContain('ext-declared-bare-specifier-survives');

    blobModuleStub.current = undefined;
    rewriteSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not trip the bare-specifier detector on a dynamic import()', async () => {
    // `rewriteBareSpecifier` does not handle the `import("x")` form, so the
    // assertion must not either — otherwise a chunk using dynamic import
    // for an undeclared, genuinely-external package would fail a load that
    // was never broken.
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-w";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-w.js`]: {
        body: 'export const w = () => import("some-pkg");',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [sharedDep('dep-w', 'shared/dep-w.js')])
    );

    await expect(
      handler.load(entry, 'ext-dynamic-import-untouched')
    ).resolves.toBeDefined();

    blobModuleStub.current = undefined;
    fetchSpy.mockRestore();
  });
});

/**
 * `findUndeclaredWellFormedSpecifiers` (`mf-shared-dep-specifier-scan.ts`) —
 * the heuristic, warn-only half of the amended
 * `cpt-frontx-algo-mfe-isolation-build-shared-dep-blob-urls` algorithm
 * (`inst-if-undeclared-specifier` / `inst-warn-undeclared-specifier`).
 *
 * This half must NEVER fail a load: it reads chunk text without parsing it,
 * so it cannot distinguish an ordinary string literal from an actual
 * import. That is exactly the defect the REJECTED prior design had — it
 * called the generic (no-package-name) form of the trust kernel's
 * `bareSpecifierPattern` and failed the load on whatever it matched,
 * which took down every microfrontend on ordinary code containing the word
 * "import" inside a string (issue reproduced below). The decided design
 * keeps the generic scan, but demotes it to a `console.warn` and adds a
 * well-formed-specifier filter (no whitespace, quote, parenthesis, colon,
 * or line break) that rejects everything the reproducer would have matched.
 */
describe('MfeHandlerMF — undeclared shared-dep specifier diagnostic (warn, never fail)', () => {
  function stubSuccessfulImport(): void {
    blobModuleStub.current = {
      default: { mount: (): void => {}, unmount: (): void => {} },
    };
  }

  /**
   * Fixtures in this block declare no `contentHash`, so every load also
   * emits the unrelated one-time "carries no contentHash" adoption notice
   * (`inst-emit-adoption-notice`) through the same `console.warn` spy. Only
   * calls naming the undeclared-specifier diagnostic itself
   * (`inst-warn-undeclared-specifier`) are relevant here.
   */
  function undeclaredSpecifierWarnings(warnSpy: {
    mock: { calls: unknown[][] };
  }): string[] {
    return warnSpy.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .filter((message: string) => message.includes('not declared in manifest.shared[]'));
  }

  it('warns naming the chunk, specifier, and microfrontend when an undeclared specifier survives — the issue #621 symptom (react-redux surviving where only @reduxjs/toolkit is declared)', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-toolkit";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-toolkit.js`]: {
        body: 'import { createSlice } from "react-redux";\nexport const t = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('@reduxjs/toolkit', 'shared/dep-toolkit.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-undeclared-react-redux')
    ).resolves.toBeDefined();

    const undeclaredWarning = undeclaredSpecifierWarnings(warnSpy).find((message) =>
      message.includes('react-redux')
    );
    expect(undeclaredWarning).toBeDefined();
    expect(undeclaredWarning).toContain('@reduxjs/toolkit');
    expect(undeclaredWarning).toContain('react-redux');
    expect(undeclaredWarning).toContain('ext-undeclared-react-redux');

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('warns on an undeclared side-effect import — import "some-polyfill"', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-poly";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-poly.js`]: {
        body: 'import "some-polyfill";\nexport const p = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [sharedDep('dep-poly', 'shared/dep-poly.js')])
    );

    await expect(
      handler.load(entry, 'ext-undeclared-side-effect')
    ).resolves.toBeDefined();

    const undeclaredWarning = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes('some-polyfill')
    );
    expect(undeclaredWarning).toBeDefined();

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('warns on an undeclared scoped specifier with a subpath — from "@scope/pkg/sub"', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-scoped";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-scoped.js`]: {
        body: 'import { helper } from "@scope/pkg/sub";\nexport const s = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('dep-scoped', 'shared/dep-scoped.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-undeclared-scoped-subpath')
    ).resolves.toBeDefined();

    const undeclaredWarning = warnSpy.mock.calls.find((args) =>
      String(args[0]).includes('@scope/pkg/sub')
    );
    expect(undeclaredWarning).toBeDefined();

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not warn and does not fail on the exact issue reproducer — the word "import" occurring inside ordinary string literals', async () => {
    // This is the REJECTED design's failure mode, reproduced verbatim: none
    // of these lines contain an actual import of an unresolved package —
    // "import" and "from" only ever appear as substrings of string VALUES.
    // The old generic `findSurvivingBareSharedDepSpecifiers` matched the
    // keyword-then-quote adjacency regardless of context and took the load
    // down; the well-formedness filter here rejects every resulting
    // "specifier" candidate (multi-word text containing spaces, parens, and
    // newlines is never well-formed as a package module specifier).
    const reproducerSource = [
      "const KEY = 'import';",
      "function f(a) { return a.indexOf('import', 0); }",
      "const msg = 'use A instead of B';",
      'export const q = 1;',
    ].join('\n');
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-repro";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-repro.js`]: {
        body: reproducerSource,
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [sharedDep('dep-repro', 'shared/dep-repro.js')])
    );

    await expect(
      handler.load(entry, 'ext-reproducer-no-false-positive')
    ).resolves.toBeDefined();

    expect(undeclaredSpecifierWarnings(warnSpy)).toEqual([]);

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not warn and does not fail on real bundled chunk excerpts containing @reduxjs/toolkit and a @gears-frontx/* package as DECLARED shared deps', async () => {
    // Excerpts are copied verbatim from real, already-built dist output —
    // not hand-written — precisely because a synthetic fixture is what let
    // the rejected design's false-positive bug through undetected:
    //  - '@reduxjs/toolkit' import line: node_modules/recharts/es6/state/mouseEventsMiddleware.js:1
    //  - '@gears-frontx/api' + '@gears-frontx/state' import lines:
    //    template-shell/packages/framework/dist/index.js:15-16
    // Each excerpt is the chunk of a CONSUMER dep, distinct from the
    // package it imports, so declaring the imported names does not create a
    // self-import.
    const rechartsExcerpt =
      "import { createAction, createListenerMiddleware } from '@reduxjs/toolkit';\nexport const mw = 1;";
    const frameworkExcerpt =
      '// src/createFrontX.ts\nimport { getStore, registerSlice } from "@gears-frontx/state";\nimport { apiRegistry } from "@gears-frontx/api";\nexport const useApi = 1;';
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "consumer-recharts";\nimport "consumer-framework";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/toolkit.js`]: { body: 'export const rtk = 1;' },
      [`${PUBLIC_PATH}shared/state.js`]: { body: 'export const st = 1;' },
      [`${PUBLIC_PATH}shared/api.js`]: { body: 'export const api = 1;' },
      [`${PUBLIC_PATH}shared/consumer-recharts.js`]: { body: rechartsExcerpt },
      [`${PUBLIC_PATH}shared/consumer-framework.js`]: { body: frameworkExcerpt },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('@reduxjs/toolkit', 'shared/toolkit.js'),
        sharedDep('@gears-frontx/state', 'shared/state.js'),
        sharedDep('@gears-frontx/api', 'shared/api.js'),
        sharedDep('consumer-recharts', 'shared/consumer-recharts.js'),
        sharedDep('consumer-framework', 'shared/consumer-framework.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-real-bundle-excerpts')
    ).resolves.toBeDefined();

    expect(undeclaredSpecifierWarnings(warnSpy)).toEqual([]);

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not warn and does not fail on a fully rewritten source where every specifier is already a blob: URL', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-leaf";\nimport "dep-top";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-leaf.js`]: {
        body: 'export const leaf = 1;',
      },
      [`${PUBLIC_PATH}shared/dep-top.js`]: {
        // Genuinely rewritten by the time `dep-top` is processed — `dep-leaf`
        // already has a blob URL, and the resulting source's only surviving
        // specifier is that minted blob: URL.
        body: 'import "dep-leaf";\nexport const top = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('dep-leaf', 'shared/dep-leaf.js'),
        sharedDep('dep-top', 'shared/dep-top.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-fully-rewritten-no-warn')
    ).resolves.toBeDefined();

    expect(undeclaredSpecifierWarnings(warnSpy)).toEqual([]);

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not warn and does not fail on a dynamic import() of an undeclared package — outside the rewrite/assert/warn surface entirely', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-dynamic";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-dynamic.js`]: {
        body: 'export const d = () => import("react-redux");',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('dep-dynamic', 'shared/dep-dynamic.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-dynamic-import-silent')
    ).resolves.toBeDefined();

    expect(undeclaredSpecifierWarnings(warnSpy)).toEqual([]);

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not fail when a DECLARED specifier appears textually as "from \\"react\\"" inside a string literal — the rewriter already substituted the real import, so nothing bare survives', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-quoted";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/react.js`]: {
        body: 'export const r = 1;',
      },
      [`${PUBLIC_PATH}shared/dep-quoted.js`]: {
        // The real import of 'react' is textually identical to the string
        // literal below, so the rewrite step — which is purely textual —
        // substitutes BOTH occurrences once 'react' has a blob URL. Nothing
        // bare survives either the per-name assertion or the
        // undeclared-specifier scan.
        body: 'import "react";\nconst s = \'from "react"\';\nexport const q = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('react', 'shared/react.js'),
        sharedDep('dep-quoted', 'shared/dep-quoted.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-quoted-declared-name')
    ).resolves.toBeDefined();

    expect(undeclaredSpecifierWarnings(warnSpy)).toEqual([]);

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not warn on a relative specifier like "./local-thing" — not a package module specifier', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-relative";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-relative.js`]: {
        body: 'import "./local-thing";\nexport const rel = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('dep-relative', 'shared/dep-relative.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-relative-no-warn')
    ).resolves.toBeDefined();

    expect(undeclaredSpecifierWarnings(warnSpy)).toEqual([]);

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('does not warn on a bare comma fragment — not a package module specifier', async () => {
    const routes = {
      [`${PUBLIC_PATH}assets/lifecycle.js`]: {
        body: 'import "dep-fragment";\nexport default {};',
      },
      [`${PUBLIC_PATH}shared/dep-fragment.js`]: {
        body: 'import ",";\nexport const frag = 1;',
      },
    };
    const { fetchImpl } = createFetchRouter(routes);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchImpl as typeof fetch);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSuccessfulImport();

    const handler = new MfeHandlerMF(ENTRY_BASE_ID, { retries: 0 });
    const entry = buildEntry(
      buildManifest(PUBLIC_PATH, [
        sharedDep('dep-fragment', 'shared/dep-fragment.js'),
      ])
    );

    await expect(
      handler.load(entry, 'ext-fragment-no-warn')
    ).resolves.toBeDefined();

    expect(undeclaredSpecifierWarnings(warnSpy)).toEqual([]);

    blobModuleStub.current = undefined;
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
