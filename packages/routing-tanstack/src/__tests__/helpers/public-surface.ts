import * as tanstackIndex from '../../index.js';

// The `@tanstack/react-router` names `src/index.ts` forwards verbatim at its
// own bottom (DESIGN §3.3, "API Contracts" — the concrete engine's own
// component-tree hooks and components) — a third-party surface this
// package's own build cannot regress, so it is excluded from the derived
// runtime list below rather than pinned alongside this package's own
// exports.
const REACT_ROUTER_PASSTHROUGH = [
  'createRouter',
  'RouterProvider',
  'useNavigate',
  'useParams',
  'useSearch',
  'useRouterState',
  'Link',
  'Outlet',
  'redirect',
  'notFound',
] as const;

// The engine-provider FEATURE's own authored public surface — the runtime
// values `src/index.ts` exports itself, excluding the pass-through re-exports
// above. Pinned once here so `dist-imports.test.ts`'s presence and consumer
// type-check assertions stay in sync with what `src/index.ts` actually
// exports, mirroring `packages/routing`'s own `ROUTING_RUNTIME_SURFACE`
// (`packages/routing/src/__tests__/helpers.ts`).
//
// MEDIUM (review round 16-re5, `packages/routing`'s own surface pin):
// derived from `../../index.js`'s own actual runtime exports (`Object.keys`,
// sorted) rather than maintained by hand, for the identical reason
// `ROUTING_RUNTIME_SURFACE` now is — a hand-listed subset can silently stop
// covering a real export with no test failing.
export const TANSTACK_RUNTIME_SURFACE = Object.keys(tanstackIndex).filter(
  (name) => !(REACT_ROUTER_PASSTHROUGH as readonly string[]).includes(name),
);

// Type-only exports cannot be derived the same way — `export type { ... }`
// erases entirely at compile time, so there is no runtime object to call
// `Object.keys` on. Cross-checked by hand against every type-only
// `export type { ... }` statement in `src/index.ts` and every DESIGN §3.3
// row naming a type: the engine-provider port re-exported from
// `@gears-frontx/routing` (`EngineProviderInput`, `EngineProviderPort`,
// `EntryAddress`), the virtual-location projection shapes
// (`VirtualLocationParts`, `VirtualLocationSource`), the shared history-
// adaptation options (`AdaptHistoryOptions`), and the component prop shapes
// (`EngineProviderProps`, `EngineProviderFromRouterProps`).
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
