// The engine-provider FEATURE's own authored public surface — the names
// `src/index.ts` declares itself, excluding the `@tanstack/react-router`
// pass-through re-exports at the bottom of that file (those are a
// third-party surface this package merely forwards, not one whose
// declarations this package's own build can regress). Pinned once here so
// `dist-imports.test.ts`'s presence and consumer type-check assertions stay
// in sync with what `src/index.ts` actually exports, mirroring
// `packages/routing`'s own `ROUTING_RUNTIME_SURFACE`/`ROUTING_TYPE_ONLY_SURFACE`
// (`packages/routing/src/__tests__/helpers.ts`).
export const TANSTACK_RUNTIME_SURFACE = [
  'projectParamsToVirtualLocation',
  'projectVirtualLocationToParams',
  'ROUTE_PARAM_NAME',
  'adaptVirtualLocationHistory',
  'createComposedVirtualLocationSource',
  'adaptComposedHistory',
  'createStandaloneVirtualLocationSource',
  'adaptStandaloneHistory',
  'adaptProviderHistory',
  'locationPreservingRedirect',
  'createProviderRouter',
  'createEngineProviderRouter',
  'EngineProvider',
] as const;

export const TANSTACK_TYPE_ONLY_SURFACE = [
  'EngineProviderInput',
  'EngineProviderPort',
  'EntryAddress',
  'VirtualLocationParts',
  'AdaptHistoryOptions',
  'VirtualLocationSource',
  'EngineProviderProps',
  'EngineProviderFromRouterProps',
] as const;
