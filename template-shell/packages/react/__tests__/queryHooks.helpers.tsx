/**
 * Shared test helpers for query hook integration tests.
 *
 * All builder and factory functions here push created apps into `ownedApps` so
 * each individual test file's `afterEach` can destroy them without needing to
 * track ownership manually.
 */

import React from 'react';
import { QueryClient } from '@tanstack/react-query';
import { vi } from 'vitest';
import {
  createFrontX,
  createFrontXApp,
  FrontXProvider,
  queryCache,
  queryCacheShared,
  RestEndpointProtocol,
  RestProtocol,
  type ChildMfeBridge,
  type EndpointDescriptor,
  type MfeContextValue,
  type MutationDescriptor,
  type StreamDescriptor,
} from '@gears-frontx/react';

const APP_QUERY_CLIENT_SYMBOL = Symbol.for('frontx:query-cache:app-client');

/**
 * Apps created during a test are registered here so the per-file `afterEach`
 * can call `.destroy()` on every one of them.  Because Vitest runs each test
 * file in its own worker, each worker gets its own module instance, so this
 * array is isolated per file.
 */
export const ownedApps: import('@gears-frontx/framework').FrontXApp[] = [];

// ============================================================================
// QueryClient factories
// ============================================================================

/**
 * Build a fresh QueryClient with settings that prevent test interference:
 *   retry: 0  — avoids slow retry backoffs on intentional failures
 *   gcTime: 0 — drops cache entries immediately after a query becomes inactive
 */
export function buildTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 0, gcTime: 0 },
      mutations: { retry: 0 },
    },
  });
}

/**
 * Build a QueryClient for mutation cache tests that need entries to survive
 * without an active observer. gcTime: 0 would evict seed data immediately,
 * making queryCache.get/set assertions impossible without a mounted useApiQuery.
 */
export function buildMutationCacheTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 0, gcTime: 300_000 },
      mutations: { retry: 0 },
    },
  });
}

// ============================================================================
// App factories
// ============================================================================

export function attachQueryClient(
  app: import('@gears-frontx/framework').FrontXApp,
  client: QueryClient
): import('@gears-frontx/framework').FrontXApp {
  Reflect.set(app as object, APP_QUERY_CLIENT_SYMBOL, client);
  return app;
}

export function getAttachedQueryClient(app: import('@gears-frontx/framework').FrontXApp): QueryClient {
  const queryClient = Reflect.get(app as object, APP_QUERY_CLIENT_SYMBOL) as QueryClient | undefined;
  if (!queryClient) {
    throw new Error('expected app query client');
  }
  return queryClient;
}

export function buildAppWithQueryClient(client: QueryClient): import('@gears-frontx/framework').FrontXApp {
  const app = attachQueryClient(createFrontXApp(), client);
  ownedApps.push(app);
  return app;
}

export function buildPresetApp(): import('@gears-frontx/framework').FrontXApp {
  const app = createFrontXApp();
  ownedApps.push(app);
  return app;
}

/** Host + child pattern keeps `retainSharedFetchCache()` active (real queryCache wiring). */
export function buildHostAppWithQueryCache(
  staleTime: number
): import('@gears-frontx/framework').FrontXApp {
  const app = createFrontX()
    .use(
      queryCache({
        staleTime,
        gcTime: 300_000,
        refetchOnWindowFocus: false,
      })
    )
    .build();
  ownedApps.push(app);
  return app;
}

export function buildChildAppWithQueryCacheShared(): import('@gears-frontx/framework').FrontXApp {
  const app = createFrontX().use(queryCacheShared()).build();
  ownedApps.push(app);
  return app;
}

// ============================================================================
// React wrapper factories
// ============================================================================

/**
 * React wrapper that provides an isolated QueryClient for each test.
 * Re-created per test via the factory pattern to avoid shared state.
 */
export function makeQueryWrapper(client: QueryClient) {
  const app = buildAppWithQueryClient(client);
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return <FrontXProvider app={app}>{children}</FrontXProvider>;
  };
}

export function makeSuspenseQueryWrapper(client: QueryClient) {
  const app = buildAppWithQueryClient(client);
  return function SuspenseQueryWrapper({ children }: { children: React.ReactNode }) {
    return (
      <FrontXProvider app={app}>
        <React.Suspense fallback={<div>loading</div>}>{children}</React.Suspense>
      </FrontXProvider>
    );
  };
}

// ============================================================================
// Descriptor factories
// ============================================================================

/**
 * Build a minimal EndpointDescriptor for read queries.
 */
export function makeQueryDescriptor<TData>(
  key: readonly unknown[],
  fetchFn: (options?: { signal?: AbortSignal; staleTime?: number }) => Promise<TData>,
  options?: { staleTime?: number; gcTime?: number }
): EndpointDescriptor<TData> {
  return { key, fetch: fetchFn, ...options };
}

export function makeRestQueryDescriptor<TData>(
  path: string,
  fetchFn: (path: string, options?: { signal?: AbortSignal }) => Promise<TData>,
  options?: { staleTime?: number; gcTime?: number }
): EndpointDescriptor<TData> {
  const rest = new RestProtocol();
  rest.initialize({ baseURL: '/api/test' });
  vi.spyOn(rest, 'getWithSharedCache').mockImplementation((requestPath, requestOptions) =>
    fetchFn(requestPath, requestOptions ? { signal: requestOptions.signal } : undefined)
  );

  const endpoints = new RestEndpointProtocol(rest);
  endpoints.initialize({ baseURL: '/api/test' });
  return endpoints.query<TData>(path, options);
}

/**
 * Build a minimal MutationDescriptor for write mutations.
 */
export function makeMutationDescriptor<TData, TVariables>(
  key: readonly unknown[],
  fetchFn: (variables: TVariables, options?: { signal?: AbortSignal }) => Promise<TData>
): MutationDescriptor<TData, TVariables> {
  return { key, fetch: fetchFn };
}

/**
 * Minimal StreamDescriptor for useApiStream tests (no QueryClient).
 */
export function makeStreamDescriptor<TEvent>(config: {
  key: readonly unknown[];
  connect: StreamDescriptor<TEvent>['connect'];
  disconnect?: StreamDescriptor<TEvent>['disconnect'];
}): StreamDescriptor<TEvent> {
  return {
    key: config.key,
    connect: config.connect,
    disconnect: config.disconnect ?? vi.fn(),
  };
}

// ============================================================================
// MFE context helpers
// ============================================================================

/**
 * Minimal ChildMfeBridge stub — only the fields that MfeContext types require.
 */
export function makeMockBridge(): ChildMfeBridge {
  return {
    extDomainId: 'gts.frontx.mfes.ext.domain.v1~test.isolation.v1',
    extensionId: 'isolation-test',
    executeActionsChain: vi.fn().mockResolvedValue(undefined),
    subscribeToProperty: vi.fn().mockReturnValue(() => undefined),
    getProperty: vi.fn().mockReturnValue(undefined),
    registerActionHandler: vi.fn(),
  };
}

export function makeContextValue(id: string): MfeContextValue {
  return {
    bridge: makeMockBridge(),
    extensionId: id,
    domainId: 'gts.frontx.mfes.ext.domain.v1~test.isolation.v1',
  };
}
