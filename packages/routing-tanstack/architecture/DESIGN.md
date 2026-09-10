---
type: DESIGN
system: frontx-routing-tanstack
status: draft
---

# Technical Design — Routing TanStack Provider

- [ ] `p3` - **ID**: `cpt-frontx-routing-tanstack-design-engine-provider`

<!-- toc -->

- [1. Architecture Overview](#1-architecture-overview)
  - [1.1 Architectural Vision](#11-architectural-vision)
  - [1.2 Architecture Drivers](#12-architecture-drivers)
  - [1.3 Architecture Layers](#13-architecture-layers)
- [2. Principles & Constraints](#2-principles--constraints)
  - [2.1 Design Principles](#21-design-principles)
  - [2.2 Constraints](#22-constraints)
- [3. Technical Architecture](#3-technical-architecture)
  - [3.1 Domain Model](#31-domain-model)
  - [3.2 Component Model](#32-component-model)
  - [3.3 API Contracts](#33-api-contracts)
  - [3.4 Internal Dependencies](#34-internal-dependencies)
  - [3.5 External Dependencies](#35-external-dependencies)
  - [3.6 Interactions & Sequences](#36-interactions--sequences)
  - [3.7 Database schemas & tables](#37-database-schemas--tables)
- [4. Additional context](#4-additional-context)
- [5. Traceability](#5-traceability)

<!-- /toc -->

## 1. Architecture Overview

### 1.1 Architectural Vision

`@gears-frontx/routing-tanstack` is the default implementation of the engine-provider port the navigation substrate declares (`cpt-frontx-routing-fr-engine-provider-port`, owned by [routing DESIGN](../../routing/architecture/DESIGN.md)). Where the substrate stays agnostic of any concrete router engine, this package is the deliberately concrete side of that boundary: it is the only place in the ecosystem a router engine's package is imported, and the only place the substrate's own `NavigationHistory` contract is translated into what a concrete engine expects.

The package holds exactly one component, the Engine Provider, moved here unchanged from the navigation substrate's own DESIGN under the package split recorded in `cpt-frontx-adr-core-package-boundaries`: the substrate needed to stay UI-framework- and engine-agnostic to remain a core member, and the only way to make that a package boundary rather than an intra-package convention was to give the provider its own published artifact. The Engine Provider adapts the substrate's `NavigationHistory` contract into TanStack Router's own `RouterHistory` contract — deriving the members that contract requires beyond the substrate's five, and translating the substrate's own subscriber notification into the `SubscriberArgs` shape (`location`, `action`) `RouterHistory`'s `subscribe` callback expects — before calling `createRouter({ routeTree, history, basepath })` and mounting the result into the microfrontend's own component tree via `RouterProvider`. Since the package split, a microfrontend reaches this adapter only by importing this package's own hooks and components directly, so replacing this package with a different engine-provider port implementation is scoped to that one microfrontend's own code — its route tree, its search-parameter handling, and every one of its own imports of this package, all rewritten to the replacement's own surface — and reaches no further: the navigation substrate, the host, and every sibling microfrontend are unaffected.

This package is also where a parametric segment is legal territory. A dynamic segment declared in the microfrontend's own route tree remains legal inside this microfrontend's own pathname territory beneath its `basepath`, and nothing in the navigation substrate competes with it there, because the substrate's own occupancy resolution reads no pathname segment as a declared prefix at all any more — "the pathname is not part of this model at all" ([routing DESIGN §1.1](../../routing/architecture/DESIGN.md#11-architectural-vision), *Uniform compound-key addressing*; `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`). There is no core-side resolution left for a dynamic segment to lose to: no domain, nested or sibling, claims a pathname segment by static declaration under this model.

What the core does leave opaque is not a pathname remainder but the compound key's own value — the occupant's own parameter payload, which every level's resolution carries without inspecting and which [routing DESIGN §1.1](../../routing/architecture/DESIGN.md#11-architectural-vision) describes as belonging "entirely to that occupant and to whichever engine-provider package it depends on." That payload does not reach this package through the URL's pathname; it reaches the occupant as the value of its own compound key, handed in by that occupant's consuming level at mount ([routing DESIGN §3.6](../../routing/architecture/DESIGN.md#36-interactions--sequences), "mount Owner A, handing it the value of its own compound key"). Turning that handed-in payload into whatever this microfrontend's own route tree and search handling expect is the microfrontend's own concern, built on this package's surface.

### 1.2 Architecture Drivers

#### Functional Drivers

The package's requirements are owned by its own [PRD](./PRD.md).

| Requirement | Design Response |
|-------------|------------------|
| `cpt-frontx-routing-tanstack-fr-engine-adaptation` | The Engine Provider adapts the navigation substrate's `NavigationHistory` into TanStack Router's `RouterHistory` and `SubscriberArgs` shapes, then constructs the router via `createRouter({ routeTree, history, basepath })` (`cpt-frontx-component-routing-engine-provider`). |
| `cpt-frontx-routing-tanstack-fr-scoped-navigation-zone` | The constructed router is scoped to the assigned `basepath`; its routing table matches only what lies beneath it (`cpt-frontx-component-routing-engine-provider`). |
| `cpt-frontx-routing-tanstack-fr-standalone-deployment` | The same construction path runs whether the application that composes the microfrontend supplied its `basepath` or the deployment did — the "assigned or deployment-supplied `basepath`" of the port ([routing PRD §1.4](../../routing/architecture/PRD.md#14-glossary), `cpt-frontx-routing-fr-engine-provider-port`), never a value derived from a domain key, a nesting level, or route-owner resolution (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`); no route-ownership-signal observer is required for either. |
| `cpt-frontx-routing-tanstack-fr-query-namespace-containment` | Every write this package issues — through the adapted `RouterHistory` or through its own `Link`/`useNavigate`/`redirect` wrappers — is a delta against the live shared search touching only the issuing occupant's own compound key, and never an occupancy write (`cpt-frontx-constraint-routing-tanstack-delta-only-query-writes`, §2.2; `cpt-frontx-component-routing-engine-provider`). |
| `cpt-frontx-routing-tanstack-fr-location-preserving-helpers` | A redirect/navigation helper carries the live search and hash onto a target path, generalized from index-route redirects to any consumer redirect, so the default form of a redirect preserves every other occupant's own compound key rather than dropping it. |

#### NFR Allocation

| NFR ID | NFR Summary | Allocated To | Design Response | Verification Approach |
|--------|-------------|--------------|-----------------|------------------------|
| `cpt-frontx-routing-tanstack-nfr-single-ecosystem-edge` | Exactly one intra-ecosystem import: the navigation substrate | The published package | The manifest declares exactly one intra-ecosystem dependency — `@gears-frontx/routing` — and the import graph carries no other ecosystem edge (`cpt-frontx-constraint-routing-tanstack-sole-engine-import`). | The boundary guards (`arch:edges`, `arch:deps`) hold the manifest and the import graph to the declared single-edge property. |

This member records its decisions here rather than in a decision record of its own. `cpt-frontx-adr-core-package-boundaries` is the record whose "Scope relative to other published-libraries members" note names this package's own sole-engine-import constraint (ROUTING-TANSTACK-1, defined and owned by this DESIGN's §2.2) as sitting outside that ADR's core partition; that note names that one constraint alone, not this DESIGN's second constraint (ROUTING-TANSTACK-2, likewise defined and owned by §2.2 here).

Two of the navigation substrate's own decision records constrain this package directly, and this DESIGN cites them rather than restating what they decide: `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`, which makes the shared query string the whole of occupancy addressing — so every key in it beyond the issuing occupant's own compound key is another occupant's address — and `cpt-frontx-routing-adr-mount-trigger-ownership`, which keeps originating an occupancy in the runtime's actions-chains channel and therefore out of this package's own navigation surface. Both are cited by ROUTING-TANSTACK-2 (§2.2) and listed in §5.

### 1.3 Architecture Layers

- [ ] `p3` - **ID**: `cpt-frontx-routing-tanstack-tech-stack`

```mermaid
graph TD
    MFE["Microfrontend (own basepath)"] -->|depends on| Provider[Engine Provider]
    Provider -->|adapts| Substrate["Navigation Substrate (@gears-frontx/routing)"]
    Provider -->|createRouter history, basepath| Engine["Router engine (TanStack Router)"]
    Substrate -.->|NavigationHistory| Provider
    Provider -.->|adapts to RouterHistory + SubscriberArgs| Engine
    Engine -->|RouterProvider| MFE
```

| Layer | Responsibility | Technology |
|-------|---------------|------------|
| Engine provider | Adapts the navigation substrate's shared history to TanStack Router via `createRouter({ routeTree, history, basepath })`; the sole package in the ecosystem permitted an engine import | TypeScript over `@tanstack/react-router` (React, this provider's UI framework) and `@tanstack/history` |

## 2. Principles & Constraints

### 2.1 Design Principles

#### Engine Confined To This Package

- [ ] `p2` - **ID**: `cpt-frontx-routing-tanstack-principle-engine-confined`

No package in this ecosystem other than this one imports a concrete router engine. The navigation substrate reaches the shared history only through its own `NavigationHistory` contract — `location`, `subscribe`, `push`, `replace`, `go` — never through the engine-specific `RouterHistory` contract this package builds on top of it. This is what lets a microfrontend swap this package for a different engine-provider port implementation without the substrate, the host, or a sibling microfrontend noticing that a swap occurred.

### 2.2 Constraints

#### ROUTING-TANSTACK-1 — Sole engine import in the ecosystem

- [ ] `p2` - **ID**: `cpt-frontx-constraint-routing-tanstack-sole-engine-import`

No other package in this ecosystem imports a concrete router engine or its packages directly — concretely, no package other than this one imports `@tanstack/react-router` or `@tanstack/history`. This package is the sole, deliberate exception, so a mechanical import-graph guard can name exactly those two packages against exactly this one package.

**ADRs**: `cpt-frontx-adr-core-package-boundaries` — cited for the partition context this constraint sits outside of (that record's `More Information` states the core partition's scope excludes an engine-bound member like this one); it does not own this constraint, which this DESIGN defines and owns directly.

#### ROUTING-TANSTACK-2 — Delta-only query writes

- [ ] `p2` - **ID**: `cpt-frontx-constraint-routing-tanstack-delta-only-query-writes`

No write this package issues to the shared navigation history replaces the query string; every one of them changes exactly one key — the compound key naming the occupant that issued the navigation — and leaves every other key as the live search held it at write time. Concretely, three adapter obligations carry that:

- **(a) The adapted `RouterHistory`'s `push` and `replace` delegate, they do not synthesize.** Each one passes the caller's change to the navigation substrate's own `push`/`replace` and applies it against the search read live from `NavigationHistory` at that moment. Neither may build the outgoing search string from the engine's own validated search for the current match — that value describes only what the issuing router's own schema declares, so making it the outgoing search deletes every key the schema does not declare, which is every other occupant's compound key.
- **(b) This package's `Link`, `useNavigate`, and `redirect` are wrappers, not re-exports.** Each wraps the engine's own and enforces merge-against-live-search semantics for the search it is given: a search object reaching one of them is a delta applied over the live search, never a replacement for it. The object-replace form the engine's own surface admits never reaches the history through this package.
- **(c) A narrowing `validateSearch`, or a `stripSearchParams`-style middleware, at any router root is forbidden.** At a router root the unknown keys are precisely the other occupants' compound keys — every domain's and every occupant's, at every depth — so a schema that narrows the search, or a middleware that strips what it does not recognize, deletes them on the next write this router performs. Search validation stays scoped to what the microfrontend itself owns inside its own compound key's value.

Adding or removing a compound key is outside this constraint's own surface entirely, because it is outside this package's: that is an occupancy write, and it reaches the URL through the navigation substrate's own URL back-projection helper after an actions-chains-originated mount (§3.2, Responsibility boundaries).

**ADRs**: `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity` — the record that makes the shared query string the whole of occupancy addressing, one compound key per occupant at every depth, which is what turns a whole-search write by one microfrontend's router into a deletion of every sibling and ancestor occupant's own address; `cpt-frontx-routing-adr-mount-trigger-ownership` — the record that reserves originating an occupancy to the actions-chains channel, which is why this package's navigation surface never adds or removes a compound key. Neither record owns this constraint; both are owned by the navigation substrate, and this DESIGN defines and owns the adapter obligations above directly.

## 3. Technical Architecture

### 3.1 Domain Model

| Entity | Definition | Representation |
|--------|------------|-----------------|
| Basepath | The URL path segment prefix a mounted microfrontend's own router is scoped to; passed to `createRouter({ routeTree, history, basepath })`. Defined by the navigation substrate ([routing DESIGN §3.1](../../routing/architecture/DESIGN.md#31-domain-model)); consumed here as this package's own construction input. | String, provider input |

### 3.2 Component Model

#### Engine Provider

- [ ] `p2` - **ID**: `cpt-frontx-component-routing-engine-provider`

Concrete artifact: `@gears-frontx/routing-tanstack` (package entry).

##### Why this component exists

A router engine renders routes and matches search parameters, and engines evolve on their own cadence. The Engine Provider is the sole adapter that hands the navigation substrate's shared history to a concrete engine, so the choice of engine is a per-microfrontend decision rather than a substrate-wide one — and, since the split recorded in `cpt-frontx-adr-core-package-boundaries`, a package-level decision rather than an in-package one.

##### Responsibility scope

- Adapts the navigation substrate's `NavigationHistory` into the concrete engine's `RouterHistory` input — filling in the members the engine's contract requires beyond the substrate's five (`block`'s adaptation is deliberately degraded, §4) — and translating `NavigationHistory`'s own subscriber notification into the `SubscriberArgs` shape (`location`, `action`) `RouterHistory`'s `subscribe` callback expects — then calls `createRouter({ routeTree, history, basepath })`.
- Owns the concrete engine dependency: `@tanstack/react-router` and `@tanstack/history`.
- Unsubscribes the constructed router from the shared history when the microfrontend that owns it unmounts, so a torn-down router's callback stops receiving the fan-out.

##### Responsibility boundaries

- Is the only package in this ecosystem permitted to import a concrete router engine (`cpt-frontx-constraint-routing-tanstack-sole-engine-import`).
- Its replacement is scoped to one microfrontend's own code — its route tree, its search-parameter handling, and every one of its own imports of this package, which the replacement requires rewriting throughout that microfrontend; it does not reach the navigation substrate, the `basepath` contract, the host, or a sibling microfrontend (`cpt-frontx-routing-fr-engine-provider-port`).
- Does not resolve which route owner a URL belongs to; that is the navigation substrate's Route Ownership Signal component, owned by [routing DESIGN](../../routing/architecture/DESIGN.md). This component only renders once a microfrontend using it is already mounted.
- Never writes a query-string key it does not own. Every write it issues — through the adapted `RouterHistory` or through its own `Link`/`useNavigate`/`redirect` wrappers — is a delta against the live search touching only the compound key naming the occupant that issued the navigation (`cpt-frontx-constraint-routing-tanstack-delta-only-query-writes`, `cpt-frontx-routing-tanstack-fr-query-namespace-containment`).
- Does not originate or end an occupancy. Adding or removing a compound key is an occupancy write, and it reaches the URL through the navigation substrate's own URL back-projection helper after an actions-chains-originated mount ([routing DESIGN §3.3](../../routing/architecture/DESIGN.md#33-api-contracts), URL back-projection helper; `cpt-frontx-routing-adr-mount-trigger-ownership`) — never through this package's own navigation surface.
- Does not namespace, filter, or decode compound keys. `useSearch`, and every other engine search hook this package re-exports, exposes the whole shared query string — which now carries every domain's and every occupant's compound keys at every depth, not this occupant's own private namespace. An occupant's own parameter payload is not something this package extracts from that search: it reaches the occupant as the value of its own compound key, handed in by that occupant's consuming level at mount ([routing DESIGN §3.6](../../routing/architecture/DESIGN.md#36-interactions--sequences), "mount Owner A, handing it the value of its own compound key"), and interpreting it is the microfrontend's own concern.

##### Related components (by ID)

- `cpt-frontx-component-routing-navigation-substrate` — the core package's own component ([routing DESIGN §3.2](../../routing/architecture/DESIGN.md#32-component-model)); supplies the `NavigationHistory` this component adapts into `RouterHistory`.

### 3.3 API Contracts

- [ ] `p2` - **ID**: `cpt-frontx-routing-tanstack-interface-package-entry`

- **Contracts**: `createRouter`, `RouterProvider`, `useNavigate`, `useParams`, `useSearch`, `useRouterState`, `Link`, `Outlet`, `redirect`, `notFound`, a location-preserving navigation helper; the engine-provider port this package implements, owned by the navigation substrate's own PRD and DESIGN.
- **Technology**: TypeScript library API, single entry point.
- **Location**: Not authored yet — no source exists for this package. The entry (e.g. `src/index.ts`) carries this package's default TanStack Router adapter's contract.

| Public surface | Purpose |
|----------------|---------|
| `createRouter({ routeTree, history, basepath })` | Builds the router instance bound to the navigation substrate's shared history and scoped to a `basepath`. |
| `RouterProvider` | Mounts the built router into the microfrontend's own component tree. |
| `useNavigate`, `useParams`, `useSearch`, `useRouterState` | Component-tree hooks against the mounted router's state and navigation. `useNavigate` is a wrapper enforcing delta-only search writes; `useSearch` reads the whole shared query string, compound keys of other occupants included (`cpt-frontx-constraint-routing-tanstack-delta-only-query-writes`). |
| `Link`, `Outlet` | Declarative navigation and nested-route rendering components. `Link` is a wrapper enforcing delta-only search writes (`cpt-frontx-constraint-routing-tanstack-delta-only-query-writes`). |
| `redirect`, `notFound` | Route-resolution helpers for redirect and not-found outcomes. `redirect` is a wrapper enforcing delta-only search writes (`cpt-frontx-constraint-routing-tanstack-delta-only-query-writes`). |
| Location-preserving navigation helper | Carries the current location's search and hash onto a target path for any consumer redirect or imperative navigation (`cpt-frontx-routing-tanstack-fr-location-preserving-helpers`). |
| `RouterHistory` contract | The engine's own history contract (`@tanstack/history`). This package builds it from the navigation substrate's `NavigationHistory`, adding the members the engine's contract requires beyond the substrate's five, and translating the substrate's subscriber notification into the `SubscriberArgs` shape (`location`, `action`) this contract's `subscribe` callback expects. Its `push`/`replace` delegate to the substrate and apply a delta against the live search rather than a synthesized search string (`cpt-frontx-constraint-routing-tanstack-delta-only-query-writes`). |

### 3.4 Internal Dependencies

Exactly one: `@gears-frontx/routing`, the navigation substrate whose `NavigationHistory` contract this package adapts and whose engine-provider port this package implements — the single-edge property this member claims under the layer's membership rules (root DESIGN §1.3), held to the cross-member dependency policy of root DESIGN §3.4.

**Dependency Rules** (per project conventions):
- No circular dependencies at the design level: the navigation substrate never depends on this package; the dependency runs one way only.
- No import of template territory.
- No import of any other ecosystem package beyond the navigation substrate (`cpt-frontx-routing-tanstack-nfr-single-ecosystem-edge`).

### 3.5 External Dependencies

#### Router engine

| Dependency Module | Interface Used | Purpose |
|-------------------|-----------------|---------|
| `@tanstack/react-router` | `createRouter`, `RouterProvider`, `useNavigate`, `useParams`, `useSearch`, `useRouterState`, `Link`, `Outlet`, `redirect`, `notFound` | The concrete router engine's React binding — the exact framework-specific package this provider adapts `NavigationHistory` for. This package's UI framework is React; a provider bound to a different UI framework is a different, non-default provider this package does not ship. |
| `@tanstack/history` | `RouterHistory` contract | The framework-independent history contract this package adapts the navigation substrate's shared `NavigationHistory` into. |

**Engine contract ownership**: the `RouterHistory` member list and the `SubscriberArgs` callback shape are the engine's own contract, not this package's. This package adapts `NavigationHistory` to whatever that contract requires at the time it is built, and a change to it is a change to this package alone — the navigation substrate, its `NavigationHistory` contract, and every consumer of it are unaffected, which is the isolation the engine-provider port exists to give.

**Dependency Rules** (per project conventions):
- `@tanstack/react-router` and `@tanstack/history` are dependencies of this package alone; no other ecosystem package imports either.
- This package is replaceable per microfrontend; a consumer supplying a different engine-provider port implementation is not required to depend on this package at all.

### 3.6 Interactions & Sequences

#### Engine Provider Adapts History And Constructs A Router

- [ ] `p3` - **ID**: `cpt-frontx-routing-tanstack-seq-adapt-and-construct`

**Use cases**: `cpt-frontx-routing-tanstack-usecase-swap-router-engine`

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

```mermaid
sequenceDiagram
    participant MFE as Microfrontend build
    participant Provider as Engine Provider
    participant Substrate as Navigation Substrate (@gears-frontx/routing)
    participant Engine as TanStack Router
    MFE->>Provider: mount(routeTree, basepath)
    Provider->>Substrate: read NavigationHistory (location, subscribe, push, replace, go)
    Provider->>Provider: adapt to RouterHistory + SubscriberArgs
    Provider->>Engine: createRouter({ routeTree, history, basepath })
    Engine-->>Provider: constructed router
    Provider-->>MFE: mount via RouterProvider
    Note over Provider,Substrate: On unmount, Provider unsubscribes from Substrate's fan-out.
```

**Description**: The path every mount of this provider takes: it reads the navigation substrate's shared history, adapts it into the concrete engine's own history contract, constructs the engine's router, and mounts it. The core deep-link cold-mount sequence this participates in — a URL resolving to this microfrontend and the host mounting it — is owned by the navigation substrate's own DESIGN ([routing DESIGN §3.6](../../routing/architecture/DESIGN.md#36-interactions--sequences), `cpt-frontx-routing-seq-deep-link-cold-mount`), which names this package's mounted router as the participant that reads the already-current location at start; this sequence documents only what happens once that mount reaches this package's own construction path.

### 3.7 Database schemas & tables

Not applicable. The package holds no database and no durable persistence.

## 4. Additional context

The package's central design tension is the same one the navigation substrate's own DESIGN names as its central tension, now expressed as a package boundary rather than an in-package one: a router engine is a real, concrete dependency that a consumer needs ready to use, and the navigation substrate that dependency sits behind must not carry it. Splitting this package out of the navigation substrate — recorded in `cpt-frontx-adr-core-package-boundaries` — is what turns the engine-behind-port discipline the substrate's own DESIGN describes into a package-level guarantee: no import-graph guard confined to one package's internals is needed, because the concrete engine simply cannot appear anywhere the substrate's own source lives.

Recorded failure modes — this package's own, whether they arrived with the split out of the navigation substrate or with the substrate's later redesign of occupancy addressing. The navigation substrate's own DESIGN §4 (`cpt-frontx-routing-design-routing`) no longer carries a matching bullet for most of them: what follows is owned and maintained here, against this package's own adapter and its own navigation surface, and is not a restatement of that list.

- **A route guard built on this package's `block` expects it to stop every navigation.** It cannot: the substrate's fan-out notifies only after a navigation has already committed, so the adapted `block` can stop a navigation issued through the same constructed router's own `RouterHistory` object, but not a back/forward step, a `go` call from another unit, or a navigation another unit performs directly through the shared `NavigationHistory` — this is a recognized, degraded adaptation, not a routinely derived member.
- **Unmounting a microfrontend without unsubscribing its router.** If this package does not unsubscribe the constructed router from the shared history at teardown, the unmounted router's callback keeps receiving the fan-out for a component tree that no longer exists. This package's own teardown responsibility (§3.2) is what prevents this.
- **A redirect from an index route, or any other consumer redirect.** The location-preserving navigation helper (`cpt-frontx-routing-tanstack-fr-location-preserving-helpers`) carries the live search and hash onto the target path, so they survive rather than being dropped — and with them every other occupant's own compound key, not only this occupant's own parameters.
- **An in-microfrontend search write clobbering a sibling occupant's compound key.** A router inside one microfrontend navigates with a search object built from its own validated search schema — or its root declares a narrowing `validateSearch`, or strips unrecognized keys — and the write that reaches the shared history carries only the keys that microfrontend's own schema knows about. Every other key in the shared query string is deleted by that one navigation: a sibling occupant's compound key under the same domain path, an ancestor occupant's key, a key belonging to a domain in another runtime entirely. The user-visible result is other, unrelated parts of the application unmounting, because their consuming levels observe their compound keys disappear and act on the transition ([routing DESIGN §4](../../routing/architecture/DESIGN.md#4-additional-context), "A compound key an occupant was addressed by disappears from the URL, at some domain level"). ROUTING-TANSTACK-2 (§2.2) is what prevents it, in all three of its forms: delegating history writes rather than synthesizing them, wrapping `Link`/`useNavigate`/`redirect` to merge rather than replace, and forbidding a narrowing `validateSearch` or a stripping middleware at a router root.
- **Two instances of the identical entry both reading the whole shared search.** Two mounts of the same microfrontend entry in one domain are two separate occupants with two separate compound keys ([routing DESIGN §4](../../routing/architecture/DESIGN.md#4-additional-context), Worked Example: Concurrent Occupancy And Same-Entry Instances), but this package's `useSearch` gives each of them the identical value: the whole shared query string, both instances' keys and every other occupant's included. Neither instance can tell its own parameters from its twin's by reading the search, because nothing in that read is scoped to either one. Each instance's own payload reaches it as the value of its own compound key, handed in by its consuming level at mount ([routing DESIGN §3.6](../../routing/architecture/DESIGN.md#36-interactions--sequences)) — that hand-in, not a search read, is what distinguishes them. This package invents no mechanism for the distinction, and the substrate's own DESIGN is explicit that none is owed here: "With the pathname retired from this package's occupancy model, how a mounted occupant's own router expresses and persists its own internal route — inside the opaque parameter payload of its own compound key, beneath the application-owned `basepath` in the pathname, or not durably at all — is a separate and larger question about the engine-provider port and whichever provider satisfies it, not about this package's addressing mechanism. It is tracked separately and deliberately not resolved in this pass; nothing in this subsection requires a change to `@gears-frontx/routing-tanstack` for the concurrent-occupancy case." ([routing DESIGN §4](../../routing/architecture/DESIGN.md#4-additional-context), "An occupant's own internal routing inside its own zone").
- **Standalone deployment of a single microfrontend.** The router construction this package runs is identical whether a route-ownership-signal observer exists or not; when none exists, an undeclared path resolves to this package's own `notFound` route rather than to whichever level's own consumer would otherwise show a fallback in composed mode — the host's, at the outermost domain, or an enclosing extension's, at any level nested deeper. Two obligations fall on the deployment rather than on this package: its server must answer every path beneath the `basepath` with the entry document, and the build's asset base URL is configured independently of the router's `basepath`.

## 5. Traceability

- **Features**: No FEATURE exists for this package and none is planned — FEATURE is permanently out of scope for the Routing TanStack Provider system per `.cf-studio/config/artifacts.toml`, whose own note records the prior `engine-provider` FEATURE as retired for good rather than deferred, with this DESIGN owning its field-level shapes directly.
- **Root chain**: [PRD](../../../architecture/PRD.md), [DESIGN](../../../architecture/DESIGN.md), [DECOMPOSITION](../../../architecture/DECOMPOSITION.md)
- **Core chain**: [routing PRD](../../routing/architecture/PRD.md), [routing DESIGN](../../routing/architecture/DESIGN.md) — the navigation substrate whose engine-provider port this package implements.
- **Cited decision records**: `cpt-frontx-adr-core-package-boundaries` — the split that gave this package its own artifact (§1.1, §2.2); `cpt-frontx-routing-adr-mount-trigger-ownership` ([routing ADR 0002](../../routing/architecture/ADR/0002-mount-trigger-ownership.md)) — reserves originating an occupancy to the actions-chains channel, which is why this package's navigation surface never adds or removes a compound key; `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity` ([routing ADR 0003](../../routing/architecture/ADR/0003-domain-occupancy-addressing-granularity.md)) — makes the shared query string the whole of occupancy addressing and retires the pathname from it, which is what ROUTING-TANSTACK-2 (§2.2) and §1.1's parametric-segment paragraph both rest on. The two routing records are owned by the navigation substrate; this package is directly constrained by both and restates neither.

This package's requirements are owned by its own [PRD](./PRD.md), per the 3-layer model: each member explains its own requirements, and the root PRD describes the layers and the requirements binding every member equally. FEATURE is out of scope for this package; this DESIGN, its own component and interface IDs above, and the package's PRD are the complete chain of authority for its behavior.
