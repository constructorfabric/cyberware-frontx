# PRD — Routing TanStack Provider (`@gears-frontx/routing-tanstack`)


<!-- toc -->

- [1. Overview](#1-overview)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Background / Problem Statement](#12-background--problem-statement)
  - [1.3 Goals (Business Outcomes)](#13-goals-business-outcomes)
  - [1.4 Glossary](#14-glossary)
- [2. Actors](#2-actors)
  - [2.1 Human Actors](#21-human-actors)
  - [2.2 System Actors](#22-system-actors)
- [3. Operational Concept & Environment](#3-operational-concept--environment)
  - [3.1 Module-Specific Environment Constraints](#31-module-specific-environment-constraints)
- [4. Scope](#4-scope)
  - [4.1 In Scope](#41-in-scope)
  - [4.2 Out of Scope](#42-out-of-scope)
- [5. Functional Requirements](#5-functional-requirements)
  - [5.1 Engine Adaptation](#51-engine-adaptation)
- [6. Non-Functional Requirements](#6-non-functional-requirements)
  - [6.1 NFR Inclusions](#61-nfr-inclusions)
  - [6.2 NFR Exclusions](#62-nfr-exclusions)
- [7. Public Library Interfaces](#7-public-library-interfaces)
  - [7.1 Public API Surface](#71-public-api-surface)
  - [7.2 External Integration Contracts](#72-external-integration-contracts)
- [8. Use Cases](#8-use-cases)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Dependencies](#10-dependencies)
- [11. Assumptions](#11-assumptions)
- [12. Risks](#12-risks)

<!-- /toc -->

## 1. Overview

### 1.1 Purpose

`@gears-frontx/routing-tanstack` is the ecosystem's default routing-engine provider: the published library that implements the engine-provider port the navigation substrate (`@gears-frontx/routing`) declares, binding that substrate's `NavigationHistory` contract to TanStack Router. It adapts the substrate's shared history into the concrete engine's own history contract, constructs the engine's router scoped to a microfrontend's `basepath`, and mounts it into that microfrontend's own component tree. This PRD owns the provider's requirements; ecosystem-level requirements are owned by the [root PRD](../../../architecture/PRD.md), and the navigation substrate's own requirements — including the engine-provider port this package implements — are owned by the [routing PRD](../../routing/architecture/PRD.md).

### 1.2 Background / Problem Statement

The navigation substrate carries a single realm-shared navigation history and a `basepath` contract, but declares no dependency on a concrete router engine: a router engine renders routes and matches search parameters, and evolves on its own release cadence, independent of the substrate and of every other microfrontend in the realm. Something must bind the substrate's own `NavigationHistory` contract to a concrete engine, construct that engine's router, and mount it — without that binding reaching back into the substrate, the host, or a sibling microfrontend. This package is that binding: the ecosystem's default, TanStack-Router-backed engine provider.

### 1.3 Goals (Business Outcomes)

- **A working router out of the box** — a microfrontend gets a mounted, `basepath`-scoped router by depending on this package alone, with no adapter code of its own. Target: zero provider-side adaptation work for a microfrontend using the default engine; Timeframe: first platform release.
- **The engine stays replaceable per microfrontend** — the concrete engine dependency is confined to this package, so a microfrontend can adopt a different conforming provider without a change to the substrate, the host, or a sibling microfrontend. Target: zero router-engine leakage outside this package; Timeframe: ongoing.
- **Deployment-mode parity** — the same provider code runs a microfrontend's router whether it is composed under a host or served standalone. Target: no code branch keyed on deployment mode beyond where `basepath` comes from; Timeframe: first platform release.

### 1.4 Glossary

This PRD uses the ecosystem's shared vocabulary: *application* means what the root glossary defines ([root PRD §1.4](../../../architecture/PRD.md#14-glossary)), and *microfrontend* means what the runtime's glossary defines ([mfes PRD §1.4](../../mfes/architecture/PRD.md#14-glossary)). *Navigation substrate*, *basepath*, and *route ownership signal* mean what the [routing PRD §1.4](../../routing/architecture/PRD.md#14-glossary) defines. The term below is this package's own.

| Term | Definition |
|------|------------|
| engine-provider port | The port the navigation substrate declares, describing what a provider must accept from the substrate (the shared `NavigationHistory` instance, an assigned or deployment-supplied `basepath`, an opaque route tree) and what it is responsible for producing (a constructed, mounted router). This package is the default implementation of that port. |

## 2. Actors

### 2.1 Human Actors

#### Microfrontend Developer

**ID**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

**Role**: Depends on this package to construct and mount a microfrontend's own router, scoped to its declared `basepath`; may replace this package with a different engine-provider port implementation inside that microfrontend's own build without touching the navigation substrate, the host, or a sibling microfrontend. Fills the root PRD's Template Developer role (`cpt-frontx-actor-template-developer`) where a template contributes a microfrontend.
**Needs**: A router constructed from the navigation substrate's shared history with no adapter code of its own, a stable `basepath` contract, and a documented port to satisfy if a different engine is chosen instead.

### 2.2 System Actors

#### Router Engine

**ID**: `cpt-frontx-routing-tanstack-actor-router-engine`

**Role**: The concrete engine this package binds the navigation substrate's shared history to — TanStack Router, constructed as `createRouter({ routeTree, history, basepath })`. Treated as an implementation detail of this package alone; no other package in the ecosystem depends on it.

## 3. Operational Concept & Environment

A microfrontend declares this package as its engine-provider dependency. At mount, the package adapts the navigation substrate's shared `NavigationHistory` into TanStack Router's own history contract, constructs the router with the microfrontend's route tree and its assigned `basepath`, and mounts it into the microfrontend's own component tree. The microfrontend's own routing table matches only the remainder of the URL beneath that `basepath`; navigating outside it happens through the navigation substrate's imperative surface, never through this package's own routing table.

The same microfrontend runs under two deployment modes without a change to its routing code. **Composed**: the application that composes the microfrontend supplies its `basepath` ([routing PRD §1.4](../../routing/architecture/PRD.md#14-glossary), *basepath*: "supplied directly by the application or by the deployment that owns the pathname"). **Standalone**: the microfrontend is served on its own, and the deployment supplies the `basepath` — empty when served at a root, or the sub-path it is published under. Either way it is the "assigned or deployment-supplied `basepath`" the engine-provider port names as a provider input (`cpt-frontx-routing-fr-engine-provider-port`); a `basepath` is never derived from a domain key, a nesting level, or route-owner resolution, because the navigation substrate's own Domain Occupancy Addressing Granularity decision record retires the pathname from occupancy resolution entirely — no domain key and no resolution outcome yields a pathname prefix for anyone to derive one from ([routing DESIGN §1.1](../../routing/architecture/DESIGN.md#11-architectural-vision)). This package runs the same construction path in both modes; only where `basepath` comes from, and whether the substrate's route ownership signal has an observer, differs.

### 3.1 Module-Specific Environment Constraints

- Requires the navigation substrate (`@gears-frontx/routing`) to already expose its realm-shared `NavigationHistory` instance; this package adapts that instance, it does not construct one of its own.
- Requires a browser environment with the primitives TanStack Router's own history contract assumes.
- The only intra-ecosystem package this package imports is the navigation substrate; nothing else in this ecosystem is imported (`cpt-frontx-routing-tanstack-nfr-single-ecosystem-edge`).
- A router's `basepath` and a build's asset base URL are independent values, exactly as the navigation substrate's own PRD states; neither is derived from the other, and this package derives neither on a consumer's behalf.
- A standalone deployment serving paths beneath its `basepath` requires its server to answer every such path with the application's entry document; without that rewrite a deep link fails before any code of this package runs. This is a deployment obligation, not a capability this package provides.

## 4. Scope

### 4.1 In Scope

- Adapting the navigation substrate's `NavigationHistory` contract into TanStack Router's own history contract.
- Constructing TanStack Router's router, scoped to a microfrontend's assigned or deployment-supplied `basepath`, and mounting it into that microfrontend's own component tree.
- Containing this package's own navigation surface to the compound query-string key of the occupant that issued a navigation, applying every search change as a delta against the live shared search.
- Reusable, location-preserving navigation helpers that carry the current location's search and hash onto a target path.
- Deployment-mode parity: the same provider code running a microfrontend composed under a host and standalone under its own deployment.
- Unsubscribing a constructed router from the shared navigation history when the microfrontend that owns it unmounts.

### 4.2 Out of Scope

- The navigation substrate itself, the `basepath` contract's own definition, the route ownership signal, and the URL back-projection helper through which an occupancy reaches the URL — all owned by the navigation substrate ([routing PRD](../../routing/architecture/PRD.md)); this package consumes them, it does not define them, and it never substitutes its own navigation surface for the back-projection helper (`cpt-frontx-routing-tanstack-fr-query-namespace-containment`).
- Microfrontend loading, admission, placement, and isolation — owned by the runtime ([mfes PRD](../../mfes/architecture/PRD.md)).
- Any router-engine implementation other than TanStack Router; a microfrontend needing a different engine supplies its own provider satisfying the same engine-provider port.

## 5. Functional Requirements

### 5.1 Engine Adaptation

#### Engine adaptation and router construction

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-engine-adaptation`

The system **MUST** adapt the navigation substrate's `NavigationHistory` contract into TanStack Router's own history contract — deriving every member that contract requires beyond `NavigationHistory`'s five, and translating `NavigationHistory`'s own subscriber notification into the shape TanStack Router's `subscribe` callback expects — and **MUST** construct TanStack Router's router via `createRouter({ routeTree, history, basepath })` from that adapted history, mounting it into the microfrontend's own component tree.

**Rationale**: The navigation substrate's own contract is deliberately narrower than a concrete engine's; someone must bridge that gap so a microfrontend gets a working, mounted router without writing its own adapter.

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

#### Scoped navigation zone

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-scoped-navigation-zone`

The system **MUST** scope a microfrontend's own router to the `basepath` it is assigned, so its router matches only the remainder of the URL beneath that prefix and cannot navigate it to a path outside that prefix through its own routing table.

**Rationale**: A `basepath` is a microfrontend's namespace; a router that could match outside it would let one microfrontend's routing table silently claim paths another microfrontend or the host owns.

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

#### Deployment-mode parity

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-standalone-deployment`

The system **MUST** run a microfrontend's router unchanged whether the microfrontend is composed within an application or served as a standalone deployment, taking its `basepath` from the application that composes the microfrontend in the first case and from the deployment's own configuration in the second — the "assigned or deployment-supplied `basepath`" the engine-provider port names as a provider input (`cpt-frontx-routing-fr-engine-provider-port`), never a value this package derives from a domain key, from a nesting level, or from route-owner resolution, none of which yields a pathname prefix under the navigation substrate's own Domain Occupancy Addressing Granularity decision record. A navigation to a path the microfrontend's own route tree does not declare **MUST** resolve to the engine's own not-found route in both modes rather than failing.

**Rationale**: A microfrontend is developed, previewed, and sometimes shipped on its own, and composed into an application later; one construction path that only varies in where `basepath` comes from is what keeps the two modes from silently diverging.

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

#### Query-namespace containment

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-query-namespace-containment`

This package's own navigation surface — its `Link` component, its `useNavigate` hook, its `redirect` helper, and the constructed router's own writes to the shared navigation history — **MUST NOT** add, remove, or replace any query-string key other than the compound key naming the occupant that issued the navigation. Every such navigation **MUST** apply its search change as a delta against the live search read from the shared `NavigationHistory` at write time, and **MUST NOT** apply it as a wholesale search string synthesized from the issuing router's own validated search schema. Originating or ending an occupancy — adding or removing a compound key — **MUST NOT** happen through this navigation surface at all: an occupancy is originated through the runtime's actions-chains channel and reflected into the URL afterward by the navigation substrate's own URL back-projection helper.

**Rationale**: The shared query string is now the whole address of a composed application's occupancy — one compound query-string key per occupant of every domain, at every depth — and an occupant "owns exactly one addressable slot in the address this library governs: its own compound key, and nothing else" ([routing DESIGN §1.1](../../routing/architecture/DESIGN.md#11-architectural-vision), *Visibility and zone boundaries*). A router that writes a whole search string therefore erases every sibling and ancestor occupant's own address with a single in-microfrontend navigation, and a router that adds or removes a compound key makes navigation a second occupancy-decision channel alongside actions-chains, which the navigation substrate's own Mount Trigger Ownership decision record reserves as the sole post-boot origination channel. Both follow from that substrate's own Domain Occupancy Addressing Granularity decision record retiring the pathname from occupancy addressing: the search string this package's engine treats as its own is shared territory. (Both records are named here rather than cited by ID, which a PRD may not carry; the citations live in this package's [DESIGN](./DESIGN.md) §2.2 and §5.)

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

#### Location-preserving navigation helpers

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-location-preserving-helpers`

The system **MUST** provide reusable navigation helpers that carry the current location's search and hash forward onto a target path, so a consumer building a redirect or an imperative navigation does not have to assemble that carry-forward by hand.

**Rationale**: Dropping the search on a redirect no longer drops only this occupant's own query parameters. The shared query string carries one compound key per occupant of every domain in the composed application, so a target assembled from the path alone drops every sibling and ancestor occupant's own address along with this one's ([routing DESIGN §1.1](../../routing/architecture/DESIGN.md#11-architectural-vision), *Visibility and zone boundaries*). A shared helper is what makes carrying the live search and hash forward the path of least resistance, and so what keeps `cpt-frontx-routing-tanstack-fr-query-namespace-containment` reachable for every consumer that redirects rather than a rule each one has to remember.

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

#### Single Ecosystem Edge

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-nfr-single-ecosystem-edge`

The system **MUST** import exactly one package from this ecosystem — the navigation substrate (`@gears-frontx/routing`) — and **MUST** import no other package in this ecosystem.

**Threshold**: Exactly one intra-ecosystem edge in the package manifest, and exactly one intra-ecosystem edge in the import graph, both verified mechanically by the boundary guards.

**Rationale**: This is the membership property the package claims in the published-libraries layer: it is not standalone, because it depends on the navigation substrate, but that dependency is bounded to a single, named edge rather than an unbounded one.

### 6.2 NFR Exclusions

The root PRD's §6.2 exclusions (safety, privacy, accessibility, internationalization, inclusivity, regulatory compliance) apply here for the same reasons stated there.

## 7. Public Library Interfaces

### 7.1 Public API Surface

The package's public surface is specified by this package's [DESIGN](./DESIGN.md) §3.3.

### 7.2 External Integration Contracts

None owned here. The package is distributed under the root PRD's package-registry distribution contract (`cpt-frontx-contract-package-registry-distribution`). The engine-provider port this package implements is owned by the navigation substrate's own PRD and DESIGN, not by this package.

## 8. Use Cases

#### Swap the router engine used by one microfrontend

- [ ] `p2` - **ID**: `cpt-frontx-routing-tanstack-usecase-swap-router-engine`

**Actor**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

**Preconditions**:
- A microfrontend is mounted under a declared `basepath`, currently depending on this package as its engine provider.

**Main Flow**:
1. The Microfrontend Developer replaces this package inside that microfrontend's own build with a different one satisfying the same engine-provider port (`cpt-frontx-routing-tanstack-fr-engine-adaptation`).
2. The replacement provider is handed the same navigation substrate's shared `NavigationHistory` instance and the same `basepath` this package used.
3. The microfrontend's own route tree, its search-parameter handling, and every one of its own imports of this package — rewritten throughout that microfrontend's own code to the replacement provider's own hooks and components — move to the new engine; nothing outside that one microfrontend's own code changes.

**Postconditions**:
- The navigation substrate, the host, and every sibling microfrontend observe no change; the rewrite is confined to the one microfrontend that swapped providers, across all of its own code, not only its route tree and search-parameter handling.

**Alternative Flows**:
- **The replacement provider does not satisfy the engine-provider port's history contract**: it cannot receive the shared history, and the microfrontend's routing does not initialize.

## 9. Acceptance Criteria

- [ ] The navigation substrate's shared `NavigationHistory` is adapted into TanStack Router's own history contract, and a router constructed from it is mounted into the microfrontend's own component tree — verifiable via `cpt-frontx-routing-tanstack-fr-engine-adaptation`.
- [ ] A microfrontend's own router matches only the remainder of the URL beneath the `basepath` it is assigned — verifiable via `cpt-frontx-routing-tanstack-fr-scoped-navigation-zone`.
- [ ] The same microfrontend routing code runs composed within an application, at any domain level, and standalone under its own deployment, differing only in whether the application or the deployment supplied the `basepath`, with no `basepath` value derived from a domain key, a nesting level, or route-owner resolution — verifiable via `cpt-frontx-routing-tanstack-fr-standalone-deployment`.
- [ ] A navigation issued through this package's own `Link`, `useNavigate`, `redirect`, or constructed router leaves every query-string key other than the issuing occupant's own compound key exactly as the live search held it at write time, including keys the issuing router's own search schema does not declare — verifiable via `cpt-frontx-routing-tanstack-fr-query-namespace-containment`.
- [ ] No navigation issued through this package's own navigation surface adds or removes a compound key, so no occupancy is originated or ended through it; an occupancy reaches the URL only through the navigation substrate's own back-projection helper after an actions-chains-originated mount — verifiable via `cpt-frontx-routing-tanstack-fr-query-namespace-containment`.
- [ ] A redirect or an imperative navigation built with this package's location-preserving helper carries the live search and hash onto the target path, leaving every other occupant's compound key intact — verifiable via `cpt-frontx-routing-tanstack-fr-location-preserving-helpers`.
- [ ] The package imports exactly one ecosystem package — the navigation substrate — and no other — verifiable via the boundary guards.
- [ ] Replacing this package with a different engine-provider port implementation changes no file outside that one microfrontend's own code — its route tree, its search-parameter handling, and every one of its own imports of this package — and changes no file belonging to the navigation substrate, the host, or a sibling microfrontend — verifiable via `cpt-frontx-routing-tanstack-usecase-swap-router-engine`.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| `@gears-frontx/routing` | The navigation substrate whose `NavigationHistory` contract this package adapts, and whose engine-provider port this package implements. | p1 |
| TanStack Router and its history contract | The concrete router engine this package binds the adapted history to. | p1 |

## 11. Assumptions

- A microfrontend depending on this package has also depended on the navigation substrate — directly or transitively — so the shared `NavigationHistory` instance this package adapts already exists in the realm.
- A microfrontend declares the routes in its own routing table relative to its `basepath`, never as absolute paths carrying the prefix; this is the navigation substrate's own assumption ([routing PRD §11](../../routing/architecture/PRD.md#11-assumptions)), unchanged by which engine provider a microfrontend uses.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| TanStack Router's own history contract changes incompatibly. | A microfrontend depending on this package's default adaptation faces a breaking change. | The concrete engine dependency is confined to this package's own product surface; a breaking change is bounded to this package's own major-version line, per the root evolvability requirement. |
| A replacement provider's adaptation does not fully satisfy the navigation substrate's history contract. | The microfrontend that adopted it may navigate correctly in isolation while disagreeing with the rest of the realm. | The engine-provider port, owned by the navigation substrate, states the history contract every provider must satisfy; this package's own adaptation is a worked example, not the only conforming shape. |
