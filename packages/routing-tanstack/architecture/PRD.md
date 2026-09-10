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

`@gears-frontx/routing-tanstack` is the ecosystem's default routing-engine provider: the published library that implements the engine-provider port the navigation substrate (`@gears-frontx/routing`) declares, binding that substrate's `NavigationHistory` contract to TanStack Router. It projects the substrate's shared history and the occupant's own entry address into a virtual location this engine can navigate, constructs the engine's router over that virtual history, and mounts it into that microfrontend's own component tree. This PRD owns the provider's requirements; ecosystem-level requirements are owned by the [root PRD](../../../architecture/PRD.md), and the navigation substrate's own requirements — including the engine-provider port this package implements and the URL grammar this package's virtual location is projected from — are owned by the [routing PRD](../../routing/architecture/PRD.md).

### 1.2 Background / Problem Statement

The navigation substrate carries a single realm-shared navigation history and one uniform URL grammar for every domain in a composed application's tree, but declares no dependency on a concrete router engine: a router engine renders routes and matches search parameters, and evolves on its own release cadence, independent of the substrate and of every other microfrontend in the realm. Something must bind the substrate's own `NavigationHistory` contract to a concrete engine, project the one entry this occupant owns into a location that engine can navigate, construct that engine's router, and mount it — without that binding reaching back into the substrate, the host, or a sibling microfrontend, and without that binding ever reading or writing a sibling's own entry or another domain's own entries. This package is that binding: the ecosystem's default, TanStack-Router-backed engine provider.

### 1.3 Goals (Business Outcomes)

- **A working router out of the box** — a microfrontend gets a mounted router, addressed at the one entry it owns, by depending on this package alone, with no adapter code of its own. Target: zero provider-side adaptation work for a microfrontend using the default engine; Timeframe: first platform release.
- **The engine stays replaceable per microfrontend** — the concrete engine dependency is confined to this package, so a microfrontend can adopt a different conforming provider without a change to the substrate, the host, or a sibling microfrontend. Target: zero router-engine leakage outside this package; Timeframe: ongoing.
- **Deployment-mode parity** — the same provider code runs a microfrontend's router whether it is composed under a host, at any depth of the domain tree, or served standalone. Target: no code branch keyed on deployment mode beyond where the virtual location's own pathname and search come from; Timeframe: first platform release.

### 1.4 Glossary

This PRD uses the ecosystem's shared vocabulary: *application* means what the root glossary defines ([root PRD §1.4](../../../architecture/PRD.md#14-glossary)), and *microfrontend* means what the runtime's glossary defines ([mfes PRD §1.4](../../mfes/architecture/PRD.md#14-glossary)). *Navigation substrate*, *entry*, *entry address*, *domain key*, *extension token*, *payload*, *occupant*, *zone*, *route owner*, and *route ownership signal* mean what the [routing PRD §1.4](../../routing/architecture/PRD.md#14-glossary) defines. The terms below are this package's own.

| Term | Definition |
|------|------------|
| engine-provider port | The port the navigation substrate declares, describing what a provider must accept from the substrate (the shared `NavigationHistory` instance, the entry address this occupant was mounted at, or its absence when the occupant runs standalone, and an opaque route tree) and what it is responsible for producing (a constructed, mounted router). This package is the default implementation of that port. |
| virtual location | The pathname-and-search pair this package's adapter constructs for the engine to navigate: the entry's own reserved `route` parameter as the pathname (`/` when the entry carries none), and every other parameter of that same entry as the search. A convention this package adopts to give a concrete, page-shaped engine something to route against; not a value the navigation substrate itself produces or reads. |
| reserved parameter `route` | The one payload parameter name this package's adapter treats specially: it becomes the virtual location's own pathname. Every other parameter of the occupant's entry is left to the constructed router as its own search. A convention of this provider, never a rule the navigation substrate imposes. |

## 2. Actors

### 2.1 Human Actors

#### Microfrontend Developer

**ID**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

**Role**: Depends on this package to construct and mount a microfrontend's own router, addressed at the one entry that microfrontend was mounted at; may replace this package with a different engine-provider port implementation inside that microfrontend's own build without touching the navigation substrate, the host, or a sibling microfrontend. Fills the root PRD's Template Developer role (`cpt-frontx-actor-template-developer`) where a template contributes a microfrontend.
**Needs**: A router constructed from the navigation substrate's shared history and this occupant's own entry with no adapter code of its own, a stable virtual-location convention for its own internal route, and a documented port to satisfy if a different engine is chosen instead.

### 2.2 System Actors

#### Router Engine

**ID**: `cpt-frontx-routing-tanstack-actor-router-engine`

**Role**: The concrete engine this package binds the navigation substrate's shared history to — TanStack Router, constructed as `createRouter({ routeTree, history })` over this package's own adapted, virtual history. Treated as an implementation detail of this package alone; no other package in the ecosystem depends on it.

## 3. Operational Concept & Environment

A microfrontend declares this package as its engine-provider dependency. At mount, the package accepts the entry this occupant was mounted at — its own domain key and extension, handed to it by the mounting level at construction, never read from the substrate itself — adapts the substrate's shared `NavigationHistory` into a virtual history whose pathname is that entry's own reserved `route` parameter (default `/` when absent) and whose search is every other parameter of that same entry, constructs TanStack Router's router over that virtual history and the microfrontend's route tree, and mounts it into the microfrontend's own component tree. The microfrontend's own routing table matches only its own virtual location; navigating outside its own entry happens through the navigation substrate's imperative surface, never through this package's own routing table, and every navigation the constructed router performs writes back only that same entry's own parameters — through exactly one call to the core's URL back-projection helper, naming this occupant's own entry address, the full new parameter list (`route` first, then every TanStack search key in the serializer's own order), and the verb TanStack requested, with that one call itself parsing the current URL, applying the change, serializing, and issuing the single `push` or `replace` — never a sibling's entry, another domain's entry, or the shell subroute; this package parses the current URL itself, through the navigation substrate's own grammar parser, only to read its own virtual location, never to write one back.

The same microfrontend runs under two deployment modes without a change to its routing code. **Composed**: the enclosing level assigns this microfrontend its entry address — its own domain key and extension — the moment it mounts it, and this package's virtual history is projected from that one entry's own payload. **Standalone**: the microfrontend is served on its own, with no entry address at all, and this package projects the identical virtual location directly onto the page's own pathname and search instead — the same `route`-parameter convention applied to the page's own address rather than to one entry inside a larger composed URL. This package runs the same construction path in both modes, selecting between them by whether an entry address was supplied; only where the virtual location's own pathname and search come from, and whether the substrate's route ownership signal has an observer, differs.

### 3.1 Module-Specific Environment Constraints

- Requires the navigation substrate (`@gears-frontx/routing`) to already expose its realm-shared `NavigationHistory` instance; this package adapts that instance, it does not construct one of its own.
- Requires a browser environment with the primitives TanStack Router's own history contract assumes.
- The only intra-ecosystem package this package imports is the navigation substrate; nothing else in this ecosystem is imported (`cpt-frontx-routing-tanstack-nfr-single-ecosystem-edge`).
- A standalone deployment serving the paths its own virtual routing table declares requires its server to answer every such path with the application's entry document; without that rewrite a deep link fails before any code of this package runs. This is a deployment obligation, not a capability this package provides.
- The build's asset base URL is configured independently of this package's own virtual location; neither is derived from the other, exactly as the navigation substrate's own PRD states for the entry address, and this package derives neither on a consumer's behalf.

## 4. Scope

### 4.1 In Scope

- Adapting the navigation substrate's `NavigationHistory` contract, together with the occupant's own entry address, into a virtual history TanStack Router can navigate.
- Reserving the entry's own `route` parameter as the virtual location's pathname, and projecting every other parameter of that entry as the virtual location's search.
- Constructing TanStack Router's router over that virtual history and mounting it into the microfrontend's own component tree.
- Writing every navigation the constructed router performs back to the occupant's own entry alone, through the navigation substrate's own control boundary — never a sibling's entry, another domain's entry, or the shell subroute.
- Composing a full composed-application URL, via the navigation substrate's own grammar serializer, from an updated virtual location — the mechanism `createHref` uses to produce a shareable link.
- Reusable, location-preserving navigation helpers that carry the current virtual location's search and the page's own hash onto a target path.
- Deployment-mode parity: the same provider code running a microfrontend composed at any domain in the tree and standalone under its own deployment, selected by whether an entry address was supplied.
- Unsubscribing a constructed router from the shared navigation history when the microfrontend that owns it unmounts.

### 4.2 Out of Scope

- The navigation substrate itself, the URL grammar's own definition, and the route ownership signal — all owned by the navigation substrate ([routing PRD](../../routing/architecture/PRD.md)); this package consumes them, it does not define them.
- Microfrontend loading, admission, placement, and isolation — owned by the runtime ([mfes PRD](../../mfes/architecture/PRD.md)).
- Any router-engine implementation other than TanStack Router; a microfrontend needing a different engine supplies its own provider satisfying the same engine-provider port.

## 5. Functional Requirements

### 5.1 Engine Adaptation

#### Engine adaptation and router construction

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-engine-adaptation`

The system **MUST** adapt the navigation substrate's `NavigationHistory` contract, together with the occupant's own entry address, into a virtual history satisfying TanStack Router's own history contract — deriving every member that contract requires beyond `NavigationHistory`'s five, projecting the entry's own reserved `route` parameter as the virtual location's pathname (`/` when the entry carries none) and every other parameter as its search, and translating `NavigationHistory`'s own subscriber notification into the shape TanStack Router's `subscribe` callback expects — and **MUST** construct TanStack Router's router via `createRouter({ routeTree, history })` from that virtual history, mounting it into the microfrontend's own component tree.

**Rationale**: The navigation substrate's own contract is deliberately narrower than a concrete engine's, and carries no notion of pathname and search at all beyond the shell subroute; someone must bridge that gap so a microfrontend gets a working, mounted router without writing its own adapter or its own virtual-location convention.

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

#### Own-entry navigation boundary

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-scoped-navigation-zone`

The system **MUST** confine every navigation a microfrontend's own constructed router performs to that microfrontend's own entry — writing only that entry's own parameters back through the navigation substrate's own control boundary — and **MUST NOT** read or write a sibling occupant's entry under the same domain key, an entry under another domain key, or the shell subroute, through its own routing table.

**Rationale**: An entry is a microfrontend's namespace; a router that could reach outside it would let one microfrontend's routing table silently claim state another microfrontend, another domain, or the shell owns.

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

#### Deployment-mode parity

- [ ] `p1` - **ID**: `cpt-frontx-routing-tanstack-fr-standalone-deployment`

The system **MUST** run a microfrontend's router unchanged whether the microfrontend is composed within an application, at any domain in the tree, or served as a standalone deployment, selecting between the two by whether an entry address was supplied: projecting the virtual location from that one entry's own payload in the first case, and projecting the identical virtual location directly onto the page's own pathname and search in the second. A navigation to a path the microfrontend's own route tree does not declare **MUST** resolve to the engine's own not-found route in both modes rather than failing.

**Rationale**: A microfrontend is developed, previewed, and sometimes shipped on its own, and composed into an application later; one construction path that only varies in where the virtual location's own pathname and search come from is what keeps the two modes from silently diverging.

**Actors**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

#### Location-preserving navigation helpers

- [ ] `p2` - **ID**: `cpt-frontx-routing-tanstack-fr-location-preserving-helpers`

The system **MUST** provide reusable navigation helpers that carry the current virtual location's search, and the page's own hash, forward onto a target path within the occupant's own entry, so a consumer building a redirect or an imperative navigation does not have to assemble that carry-forward by hand. The virtual location itself carries no hash of its own; the hash is the page's, copied verbatim regardless of deployment mode.

**Rationale**: Dropping search or the page's own hash on a redirect is an easy, repeatable mistake — the naive form, building a target from the path alone, looks correct until a query parameter or a hash fragment disappears; a shared helper makes the correct behavior the path of least resistance for every consumer that redirects.

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

The package's public surface is specified by this package's [DESIGN](./DESIGN.md) §3.3 and by its `engine-provider` FEATURE.

### 7.2 External Integration Contracts

None owned here. The package is distributed under the root PRD's package-registry distribution contract (`cpt-frontx-contract-package-registry-distribution`). The engine-provider port this package implements is owned by the navigation substrate's own PRD, DESIGN, and navigation-substrate FEATURE, not by this package.

## 8. Use Cases

#### Swap the router engine used by one microfrontend

- [ ] `p2` - **ID**: `cpt-frontx-routing-tanstack-usecase-swap-router-engine`

**Actor**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

**Preconditions**:
- A microfrontend is mounted at a declared entry address, currently depending on this package as its engine provider.

**Main Flow**:
1. The Microfrontend Developer replaces this package inside that microfrontend's own build with a different one satisfying the same engine-provider port (`cpt-frontx-routing-tanstack-fr-engine-adaptation`).
2. The replacement provider is handed the same navigation substrate's shared `NavigationHistory` instance and the same entry address this package used.
3. The microfrontend's own route tree, its search-parameter handling, and every one of its own imports of this package — rewritten throughout that microfrontend's own code to the replacement provider's own hooks and components — move to the new engine; nothing outside that one microfrontend's own code changes.

**Postconditions**:
- The navigation substrate, the host, and every sibling microfrontend observe no change; the rewrite is confined to the one microfrontend that swapped providers, across all of its own code, not only its route tree and search-parameter handling.

**Alternative Flows**:
- **The replacement provider does not satisfy the engine-provider port's history contract**: it cannot receive the shared history, and the microfrontend's routing does not initialize.

## 9. Acceptance Criteria

- [ ] The navigation substrate's shared `NavigationHistory` is adapted, together with the occupant's own entry address, into a virtual history satisfying TanStack Router's own history contract, and a router constructed from it is mounted into the microfrontend's own component tree — verifiable via `cpt-frontx-routing-tanstack-fr-engine-adaptation`.
- [ ] A microfrontend's own router writes only its own entry's own parameters, never a sibling's entry, another domain's entry, or the shell subroute — verifiable via `cpt-frontx-routing-tanstack-fr-scoped-navigation-zone`.
- [ ] The same microfrontend routing code runs composed within an application, at any domain level, and standalone under its own deployment, differing only in where the virtual location's own pathname and search come from — verifiable via `cpt-frontx-routing-tanstack-fr-standalone-deployment`.
- [ ] A redirect or an imperative navigation built with this package's location-preserving helper carries the current virtual location's search, and the page's own hash, onto the target path, within the occupant's own entry — verifiable via `cpt-frontx-routing-tanstack-fr-location-preserving-helpers`.
- [ ] The package imports exactly one ecosystem package — the navigation substrate — and no other — verifiable via the boundary guards.
- [ ] Replacing this package with a different engine-provider port implementation changes no file outside that one microfrontend's own code — its route tree, its search-parameter handling, and every one of its own imports of this package — and changes no file belonging to the navigation substrate, the host, or a sibling microfrontend — verifiable via `cpt-frontx-routing-tanstack-usecase-swap-router-engine`.
- [ ] An implementation **MUST** reproduce the navigation substrate's own examples 7.3 and 7.4 as its own acceptance scenarios (routing PRD/DESIGN, URL Grammar):

  **7.3 A microfrontend's own router.** Under this default engine provider, an occupant's internal route is the reserved parameter `route`; its remaining parameters are its router's search.

  ```
  /en?screen=dashboard;route=settings/general;orientation=left
     &sheet=tenant-details;route=contacts;tenantId=456
  ```

  The dashboard's router sees pathname `/settings/general` and search `orientation=left`.

  **7.4 The same microfrontend served standalone.** Virtual location projected onto the page's own address; same code, different adapter mode.

  ```
  /settings/general?orientation=left
  ```

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| `@gears-frontx/routing` | The navigation substrate whose `NavigationHistory` contract this package adapts, and whose engine-provider port this package implements. | p1 |
| TanStack Router and its history contract | The concrete router engine this package binds the adapted history to. | p1 |

## 11. Assumptions

- A microfrontend depending on this package has also depended on the navigation substrate — directly or transitively — so the shared `NavigationHistory` instance this package adapts already exists in the realm.
- A microfrontend declares the routes in its own routing table relative to its own virtual location, never as absolute paths carrying the shell subroute or another domain's own entries; this is the navigation substrate's own assumption ([routing PRD §11](../../routing/architecture/PRD.md#11-assumptions)), unchanged by which engine provider a microfrontend uses.
- The reserved parameter `route` is this package's own convention for carrying an occupant's internal navigation state inside its own entry, decided at provider level, as the navigation substrate's own PRD §11 records ([routing PRD §11](../../routing/architecture/PRD.md#11-assumptions)); a microfrontend that adopts a different engine-provider port implementation is not bound to this same convention, only to producing a virtual location its own engine can navigate from the entry it was handed.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| TanStack Router's own history contract changes incompatibly. | A microfrontend depending on this package's default adaptation faces a breaking change. | The concrete engine dependency is confined to this package's own product surface; a breaking change is bounded to this package's own major-version line, per the root evolvability requirement. |
| A replacement provider's adaptation does not fully satisfy the navigation substrate's history contract. | The microfrontend that adopted it may navigate correctly in isolation while disagreeing with the rest of the realm. | The engine-provider port, owned by the navigation substrate, states the history contract every provider must satisfy; this package's own adaptation is a worked example, not the only conforming shape. |
| A replacement provider adopts a different reserved-parameter convention, or none at all, for an occupant's own internal route. | Two microfrontends in the same composed application encode their own internal route differently, with no shared convention a tool built across both could rely on. | The reserved parameter `route` is documented as this provider's own convention, not a rule the navigation substrate imposes (§11); a consumer standardizing across providers documents and enforces its own convention at that level. |
