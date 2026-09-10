# PRD — Routing (`@gears-frontx/routing`)


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
  - [5.1 Navigation Coordination](#51-navigation-coordination)
  - [5.2 Concurrent Occupant Projection](#52-concurrent-occupant-projection)
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

`@gears-frontx/routing` is the ecosystem's navigation library: the published library through which a composed application and its independently bundled microfrontends share one browser navigation history and keep the URL and the screen a user is looking at in agreement. It exposes a framework-agnostic navigation substrate carrying that shared history, a resolution primitive that names which declared unit or units own a URL segment at any depth of a composed application's own nesting of extension domains, and an engine-provider port so a concrete routing engine can be swapped inside a single microfrontend's own territory without touching the substrate, the host, or any sibling microfrontend. This library carries no dependency on any concrete router engine itself; a separately published engine-provider package satisfies the port, and the ecosystem provides a default implementation of it. This PRD owns the library's requirements; ecosystem-level requirements are owned by the [root PRD](../../../architecture/PRD.md).

### 1.2 Background / Problem Statement

A composed application is many independently bundled units running in one browser tab, each capable of owning some slice of the URL — and those units nest: a unit that owns one slice may itself contain further units, each owning its own slice beneath it, to whatever depth the composed application actually has. Left alone, each unit would create its own navigation history, so a programmatic navigation issued by one unit produces no change the others observe, and back/forward, deep links, and reloads stop agreeing with what is actually mounted at any depth. The Routing library gives every unit in the realm one navigation history to read and write, a declared way to scope a unit's own router to the URL segment it owns, and a signal — reported independently at every depth of that nesting, through each domain's own dedicated slot in the URL — of when the URL's resolved owner or owners change, from which the consumer keeps the mounted screen and the URL as two views of the same fact rather than two independent ones that can drift.

### 1.3 Goals (Business Outcomes)

- **Single navigation history across independently bundled units** — Target: exactly one navigation-history instance answers `push`/`replace`/`go`/`location`/`subscribe` for the host and every independently bundled microfrontend in the realm; Timeframe: first platform release.
- **URL is the single source of truth for which unit(s) occupy a routable placement** — Target: a cold load, a reload, and a back/forward step all resolve the same mounted occupant(s) from the URL through the same resolution path; Timeframe: first platform release.
- **Router engine swappable within one microfrontend's own territory** — Target: replacing the engine used by one microfrontend changes no file outside that microfrontend's own route tree, search-parameter handling, and its own imports of its provider package; Timeframe: first platform release.
- **Composition does not force every microfrontend onto one router-engine version** — Target: the navigation substrate itself declares no dependency on a concrete router engine; Timeframe: first platform release.

### 1.4 Glossary

This PRD uses the ecosystem's shared vocabulary: *application* means what the root glossary defines ([root PRD §1.4](../../../architecture/PRD.md#14-glossary)), and *microfrontend*, *extension*, and *extension domain* mean what the runtime's glossary defines ([mfes PRD §1.4](../../mfes/architecture/PRD.md#14-glossary)). The terms below are this library's own.

| Term | Definition |
|------|------------|
| navigation substrate | The framework-agnostic core owning the single shared navigation history, the `basepath` contract, and route-owner resolution; it depends on no router engine and no UI framework. |
| engine provider | A separately published package that binds the navigation substrate's shared history to a concrete router engine so the engine can drive rendering and matching, by satisfying this library's engine-provider port. Not owned by this library: an engine provider's own requirements, behavior, and package boundary are owned by that provider's own PRD and DESIGN — the ecosystem's own default is `@gears-frontx/routing-tanstack`. |
| zone | The territory an extension owns once mounted into an extension domain; a zone may itself contain further extension domains, so a composed application is a tree of domains and the zones their occupants open, to whatever depth the application actually composes. |
| level | One extension domain's own position in that tree, and the point at which this library resolves and reports ownership: resolution and observation both run against one domain at a time, never against the whole URL in one step, using only that domain's own declared route-owner pairs and the portion of the URL local to it. |
| domain key | The value that anchors one domain's own dedicated slot or slots in the URL, assigned to that domain by the enclosing level the moment the domain begins to exist — a value fixed at that moment for the observer created with it, never a declaration carried in a registration, and never updated on a live observer: replacing it means the enclosing level releases the observer holding the old value and creates its successor carrying the new one. The outermost level's own domain key is the host's own choice, or the deployment's own when that level is served on its own; a nested domain's own domain key is derived by its enclosing level from the enclosing occupant's own slot, which is how this model expresses hierarchy — never by continuing or branching the pathname (DESIGN §4). |
| basepath | The pathname prefix an engine-provider package consumes to scope a constructed router, supplied directly by the application or by the deployment that owns the pathname — never derived from a domain's own key or from route-owner resolution, since matching a domain's own declared route owner never reads a pathname segment in this model ([DESIGN](./DESIGN.md) §3.1, Basepath; this package's own Domain Occupancy Addressing Granularity decision record). |
| projection | The act by which a domain's resolved occupancy is represented in the URL at all, through that domain's own dedicated slot — chosen by that domain's own consuming level, with no domain type privileged over another. A domain never projected into the URL is ordinary application state this library takes no part in. |
| route owner | The opaque identifier of whichever extension currently occupies a declared prefix within one domain, supplied to the navigation substrate by that domain's own level as a plain argument; the substrate never interprets what the identifier names. A route owner's own declared prefix is one or more non-empty path segments — the same extension mounted more than once is a distinct route owner at each mount, each with its own declared prefix, never one route owner declaring a second prefix alongside its first. A domain governed by a concurrent occupancy strategy resolves more than one route owner at once rather than exactly one (§5.2). |
| occupant | Every route owner this PRD already defines is also an occupant: an occupant is a route owner that additionally carries its own parameters, addressable independently once more than one occupant exists in the same domain at once (§5.2). |
| occupancy strategy | The rule that governs how many occupants a domain may hold mounted at once: exactly one, for every domain this PRD describes outside §5.2, or several concurrently, for a domain a concurrent occupancy strategy governs (§5.2). |
| route ownership signal | The observable signal this library publishes, independently at every domain level, when that level's own locally resolved route owner or owners change — an owner appearing, disappearing, changing, or its own parameters changing — together with the URL back-projection helper a consumer calls after a mount not driven by navigation. A domain governed by a concurrent occupancy strategy reports more than one such transition at once, independently, rather than exactly one (§5.2). Two-way agreement between the URL and which unit is actually mounted, at any level, is not this library's own guarantee; it is the consumer's, built on top of this signal (§11). |

## 2. Actors

### 2.1 Human Actors

#### Application Developer

**ID**: `cpt-frontx-routing-actor-application-developer`

**Role**: Mounts the navigation substrate at the host application, creates the route ownership signal's observer for the host's own domain level with its own source of declared identifier-to-prefix pairs, and wires the host's own router to the shared history; the same role recurs one domain level deeper whenever a mounted extension's own zone contains a further domain, with that extension's own consumer creating that level's own observer. Fills the root PRD's Project Developer role (`cpt-frontx-actor-project-developer`) at the navigation surface.
**Needs**: A single history usable from the host and from every independently bundled microfrontend, a declared way to bind a URL segment to whichever unit currently owns it at any domain level, no obligation to standardize every microfrontend on one router-engine version, and — for a domain whose own occupancy strategy admits more than one occupant at once — every concurrently mounted occupant staying independently addressable in the URL.

#### Microfrontend Developer

**ID**: `cpt-frontx-routing-actor-microfrontend-developer`

**Role**: Builds a microfrontend's own router scoped to its own basepath, an application- or deployment-supplied pathname prefix unrelated to which domain's own resolution mounted it there. The extension declares its own prefix in its own registered declaration, not in this library's own contract; the enclosing level assigns the domain its own domain key, and through it the slot the extension's own declared prefix resolves against, the moment it mounts that extension — the host is that enclosing level for a microfrontend mounted at the outermost domain, and the deployment supplies the microfrontend's own basepath directly when the same microfrontend is served on its own. Fills the root PRD's Template Developer role (`cpt-frontx-actor-template-developer`) where a template contributes a microfrontend.
**Needs**: A stable basepath contract, freedom to choose or swap the router engine inside the microfrontend's own territory, a documented way to navigate outside that territory when the microfrontend legitimately needs to, and — when the same microfrontend entry is mounted more than once in one domain at once — each of those instances, and its own live parameters, staying independently addressable rather than conflated with the other.

### 2.2 System Actors

#### Router Engine

**ID**: `cpt-frontx-routing-actor-router-engine`

**Role**: The pluggable, replaceable engine an engine-provider package binds the shared navigation history to, through this library's engine-provider port. Treated as opaque and substitutable by the navigation substrate and by every microfrontend other than the one that chose it; this library carries no concrete engine dependency of its own and no opinion on which engine a provider package chooses.

## 3. Operational Concept & Environment

The host application mounts the navigation substrate once per realm and creates the route ownership signal's observer for its own domain level, supplying its own source of declared identifier-to-prefix pairs as a plain argument; the substrate exposes the shared history to the host's own router and to every microfrontend an engine provider mounts under its own basepath. Every navigation — a link click, a back/forward step, a cold load, a reload, an imperative call — is read from or written to the one shared history, and the route ownership signal reports the resulting ownership transition to whichever level's own consumer created that level's observer; that consumer mounts or unmounts through its own mount mechanism and keeps the URL and the mounted route owner in agreement by acting on that signal and calling the URL back-projection helper when it mounts for a reason other than navigation — this library publishes the signal and takes no part in deciding when a mount or unmount actually happens, including after the application has already booted (see this package's own Mount Trigger Ownership decision record for which channel drives a mount at that point). The same recurs one domain level deeper whenever a mounted extension's own zone contains a further domain: that extension's own consumer creates the deeper level's own observer, supplying that domain's own pairs, and resolves that level's own dedicated slot exactly as the host resolved its own.

The same microfrontend runs under two deployment modes without a change to its routing code. **Composed**: the host mounts the substrate, creates the route ownership signal's observer, and hands each nested domain the domain key its own resolution derives from the enclosing occupant's own slot. **Standalone**: the microfrontend is served on its own, no observer is required, and its own basepath comes from the deployment's own configuration — empty when served at a root, or the sub-path it is published under. The substrate and the engine provider behave identically in both; only whether an observer exists differs, and nothing in standalone operation depends on one not existing.

### 3.1 Module-Specific Environment Constraints

- Requires a browser environment with a navigation-history API for the substrate's own realm-shared instance.
- Requires a single JavaScript realm shared by the host and every independently bundled microfrontend: the navigation substrate's single-shared-history guarantee is a realm-scoped property, not a per-bundle one.
- The router engine is never a dependency of the navigation substrate itself: every engine-specific dependency is confined to whichever separately published engine-provider package implements this library's engine-provider port (`cpt-frontx-routing-fr-engine-provider-port`).
- Standalone by construction: no intra-ecosystem package dependency; the binding to route owners is expressed only through a consumer-supplied owner-prefix pairs source, passed as a plain argument, and the binding to mounting only through the observable signal this library publishes — never through an import of the runtime that manages either one. The composed and standalone modes differ only in whether a route-ownership-signal observer is created and in where the `basepath` comes from, not in any port supplied to the package.
- Third-party code on the page may call the browser's own navigation-history API directly, bypassing the shared navigation history. This is an environmental condition the library does not prevent, not a supported way to navigate: a call that bypasses the shared instance leaves its `location` stale and its fan-out silent for that change (see DESIGN §4 failure modes).

## 4. Scope

### 4.1 In Scope

- A single, realm-shared navigation history with fan-out subscription: one real subscription to the browser's navigation history, redistributed to every listener.
- Imperative navigation outside the UI tree: `push`, `replace`, `go`, `location`, `subscribe` against the shared history.
- The `basepath` contract, and the engine-provider port a separately published provider package implements against it.
- The route ownership signal: resolving, at each domain level, that domain's own dedicated slot in the URL to that domain's own declared route owner, observing and reporting every ownership-relevant transition at that level to the consumer, and a URL back-projection helper the consumer calls after a mount not driven by navigation — the two-way agreement between the URL and a mounted owner is the consumer's own guarantee, built on this signal (§11).
- Concurrent occupant projection and per-occupant addressable parameters: for a domain whose own occupancy strategy admits more than one occupant mounted side by side at once, projecting every concurrently mounted occupant into the URL and keeping each one's own parameters independently addressable and resolvable back to the specific occupant that produced them (§5.2).
- The channel boundary: this library owns the URL channel only, among the ecosystem's host–microfrontend communication channels.

### 4.2 Out of Scope

- Addressed action dispatch and shared-property broadcast between microfrontends and the host — owned by the runtime that provides those channels ([mfes PRD](../../mfes/architecture/PRD.md)); this library neither duplicates nor mediates either one.
- Microfrontend loading, admission, placement, and isolation — owned by the runtime ([mfes PRD](../../mfes/architecture/PRD.md)).
- The registry of route owners, the execution of a mount, and any reconciliation between a competing pair of mounts — all owned by the consumer's own mount mechanism at every domain level, reached only through the plain-argument owner-prefix pairs source and the observable signal this library publishes, never through an injected port or an import of the runtime that implements them.
- Any router-engine implementation, and any provider-side concern — router construction, deployment-mode parity for a microfrontend's own routing code, and location-preserving navigation helpers — all owned entirely by whichever separately published engine-provider package a microfrontend depends on, including the ecosystem's own default engine-provider package.

## 5. Functional Requirements

### 5.1 Navigation Coordination

#### Single navigation substrate shared across independently bundled units

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-single-navigation-substrate`

The system **MUST** expose exactly one navigation-history instance per realm, reachable by the host and by every independently bundled microfrontend, and **MUST** fan out one underlying browser-history subscription to every listener that subscribes to it.

**Rationale**: Independently bundled units cannot share a compile-time singleton; a realm-shared instance is what keeps `push`/`replace`/`go` and back/forward consistent for every unit without requiring them to coordinate with each other directly.

**Actors**: `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

#### Engine provider port

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-engine-provider-port`

The system **MUST** expose the shared navigation history to a router engine only through a pluggable engine-provider port, satisfied by a separately published provider package, and **MUST** let a microfrontend replace its provider package with a different one without changing the navigation substrate, the `basepath` contract, the host, or any sibling microfrontend. The port describes only what a provider **MUST** accept from the substrate — the shared `NavigationHistory` instance, an assigned or deployment-supplied `basepath`, an opaque route tree — and that a provider is responsible for producing a constructed, mounted router from them; it names no concrete engine.

**Rationale**: Concrete router engines evolve independently of the substrate; confining engine choice to a swappable, separately published provider package is what keeps that evolution from reaching outside the microfrontend that made the choice, and what keeps the substrate itself free of any concrete engine dependency.

**Actors**: `cpt-frontx-routing-actor-microfrontend-developer`

#### Route ownership signal

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-route-ownership-signal`

The system **MUST** resolve, at each domain level independently, that domain's own dedicated slot in the URL to that domain's own declared route owner by longest matching declared prefix against the occupant identity that slot carries — a nested domain's own slot derived by its enclosing level from its enclosing occupant's own slot, never from a segment of the pathname — and **MUST** publish an observable signal, per level, reporting every ownership-relevant transition at that level to a consumer that supplies its own set of declared identifier-to-prefix pairs for that domain as a plain argument: an owner appearing, disappearing, changing, or its own parameters changing. The system **MUST** also provide a URL back-projection helper the consumer calls to reflect a mount that was not driven by navigation back into the URL under a specific declared prefix — replacing the entire value of the slot that owner's own domain projects — using a `replace` that — unlike a `push` — does not truncate the forward portion of the history stack after a back step the user has already taken; when the mount being reflected changes one domain's own occupancy, that reflection **MUST NOT** silently discard any sibling domain's own state already projected in the URL. Two-way agreement between the URL and which unit is actually mounted, at any level, is the consumer's own guarantee, built on top of this signal and this helper — not a guarantee this library makes on its own (§11).

**Rationale**: Treating the URL as the single source of truth for occupancy at every domain level — not only the outermost one — and publishing that fact as an observable signal per level rather than orchestrating mounting itself, is what lets a deep link into a nested domain, a reload, and a back/forward step all resolve to the same declared owner an ordinary click-driven navigation would reach, one level at a time, as each level comes to exist. Because this library holds no registry of levels, it publishes no signal asserting that a deep path resolved end to end; only each level's own local transition, which the consumer's own mount mechanism composes across levels into whatever end-to-end fact it needs. Which channel is allowed to drive a mount or unmount once the application has already booted — as opposed to the cold-load/reload resolution this signal always performs — is settled by this package's own Mount Trigger Ownership decision record, not by this signal itself. Giving every domain its own dedicated slot, derived from its enclosing occupant's own slot rather than sharing any single URL segment with a sibling domain, is what lets any number of domains — and, within one domain, any number of occupants — project into the URL at once without one ever displacing another's own address.

**Actors**: `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

#### Imperative navigation outside the UI tree

- [ ] `p2` - **ID**: `cpt-frontx-routing-fr-imperative-navigation`

The system **MUST** expose `push`, `replace`, `go`, `location`, and `subscribe` against the shared navigation history for use outside any UI component tree.

**Rationale**: Not every caller that needs to read or change the URL is a rendered component; a mounting resolver, a host action handler, or a bootstrapping routine needs the same navigation surface without needing a mounted router to reach it.

**Actors**: `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

### 5.2 Concurrent Occupant Projection

A domain's own occupancy strategy may hold more than one occupant mounted side by side at once rather than exactly one — for example two occupants of the same kind mounted concurrently (two instances of the same extension, each with its own live parameters) alongside a third occupant of a different kind, all within the same domain. The worked case evaluated against this pair of requirements is a domain nested one level inside another domain: the outer domain holds a single occupant, addressed by the same construct as every other domain in the tree, plus a sibling domain governed by a concurrent occupancy strategy that itself holds two occupants concurrently; the inner, nested domain holds three occupants concurrently — two of them separate instances of the very same microfrontend entry, each with its own live parameter value, alongside a third occupant of a different kind. What must hold true for this tree: every one of the inner domain's three concurrent occupants, and both of the sibling concurrent domain's occupants, is projected into the URL; each occupant — including each of the two same-entry instances — stays independently addressable; and each same-entry instance's own live parameter value resolves back to that specific instance and never to the other, so neither instance's parameter is ever conflated with or overwritten by the other's. This PRD requires only that such a domain's concurrent occupants each get projected and each stay independently addressable, including the two same-entry instances remaining individually resolvable; the exact mechanics of how a level's own contribution to the URL is assembled are DESIGN's own concern (§11 open items).

The tree this requirement is evaluated against, in outline:

```
outer domain (1 occupant)
├── sibling domain, concurrent occupancy (2 occupants)
└── inner domain, one level deeper, concurrent occupancy (3 occupants: two same-entry instances + one of a different kind)
```

This worked scenario is evaluated as a structural invariant on a fixed tree — every occupant projected and addressable — rather than as a sequence of steps with branching alternatives; a formal Use Case (§8), built around a main flow and alternative flows, would add flow-structure this requirement does not have without adding a fact this PRD does not already state, so this outline stands in place of one.

#### Concurrent occupant projection

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-concurrent-occupant-projection`

For a domain whose own occupancy strategy admits more than one occupant mounted side by side at once, the system **MUST** project every one of those concurrently mounted occupants into the URL, and **MUST** resolve and report each one's own transition through the route ownership signal independently of the others, at the same domain level. This requirement extends, and does not weaken, the existing per-prefix disambiguation guarantee (§11) for a domain whose own occupancy strategy admits only one occupant at a time.

**Rationale**: Today's route ownership signal reports occupancy for a domain's own single resolved owner; a domain governed by a concurrent occupancy strategy has, by construction, more than one. Leaving such a domain unprojected means every one of its concurrent occupants — that they are mounted at all, and each one's own live parameters — has no representation in the URL at all, defeating the URL-as-source-of-truth goal (§1.3) for exactly the domains where it is admitted to matter most.

**Actors**: `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

#### Per-occupant addressable parameters

- [ ] `p1` - **ID**: `cpt-frontx-routing-fr-per-occupant-addressable-parameters`

For a domain projected under `cpt-frontx-routing-fr-concurrent-occupant-projection`, the system **MUST** keep each concurrently mounted occupant's own parameters addressable and resolvable back to the specific occupant that produced them, without requiring every occupant's own parameters to share one flat query-string namespace in which two occupants' own parameter names could collide.

**Rationale**: A flat query string gives every occupant of a domain the same namespace for its own parameters; two occupants that each name their own parameter identically — including, most plainly, two occupants that are both instances of the same underlying extension and therefore name their own parameter the same way by construction, not by coincidence — would otherwise silently collide or overwrite one another rather than each staying independently addressable and bookmarkable.

**Actors**: `cpt-frontx-routing-actor-application-developer`, `cpt-frontx-routing-actor-microfrontend-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

#### Standalone Package Boundary

- [ ] `p1` - **ID**: `cpt-frontx-routing-nfr-standalone`

The system **MUST** import no other package in this ecosystem, and **MUST** call no consumer of its own: the source of declared owner-prefix pairs reaches the system only as a plain argument supplied by the consumer, and the system never itself invokes a mounting operation — mounting is performed by the consumer, acting on the system's published signal.

**Threshold**: Zero intra-ecosystem edges in the package manifest, and zero intra-ecosystem edges in the import graph, both verified mechanically by the boundary guards.

**Rationale**: This is the membership property the package claims in the published-libraries layer, and what lets an application adopt shared navigation while using none of the rest of the ecosystem.

#### Agnostic Navigation Core

- [ ] `p1` - **ID**: `cpt-frontx-routing-nfr-agnostic-core`

The navigation substrate **MUST** carry no dependency on any router engine or UI framework whatsoever; every dependency on a concrete engine **MUST** live in a separately published engine-provider package that implements the engine-provider port, never inside this package.

**Threshold**: This package's own module carries zero import of any router engine or of a UI-framework rendering primitive; checked mechanically by the boundary guards as a package-boundary property — no engine or UI-framework package can appear in this package's manifest or import graph at all, not merely inside a designated internal component.

**Rationale**: Keeping the substrate free of engine or framework knowledge is what lets one microfrontend's routing table change engines, or lets the default engine-provider package itself be replaced ecosystem-wide, without the substrate, the host, or any other microfrontend noticing. Making this a package boundary rather than an intra-package convention is what turns "confined to one component" into "absent from this package's own dependency graph, mechanically checkable without inspecting which module inside the package a given import lives in."

### 6.2 NFR Exclusions

The root PRD's §6.2 exclusions (safety, privacy, accessibility, internationalization, inclusivity, regulatory compliance) apply here for the same reasons stated there.

## 7. Public Library Interfaces

### 7.1 Public API Surface

The package's public surface is specified by this package's [DESIGN](./DESIGN.md) §3.3.

### 7.2 External Integration Contracts

None owned here. The package is distributed under the root PRD's package-registry distribution contract (`cpt-frontx-contract-package-registry-distribution`). The mapping from a route owner's identifier to the concrete unit it names, and the execution of a mount, are the consumer's own contracts, reached only through the plain-argument owner-prefix pairs source and the observable signal this package publishes — never products this package publishes itself.

## 8. Use Cases

#### Deep link resolves to a not-yet-mounted extension's screen, level by level

- [ ] `p2` - **ID**: `cpt-frontx-routing-usecase-deep-link-to-microfrontend-screen`

**Actor**: `cpt-frontx-routing-actor-application-developer`

**Preconditions**:
- The navigation substrate is mounted at the host, and the host has created the route ownership signal's observer for the host's own domain level, supplying its own source of declared identifier-to-prefix pairs.
- A URL naming a route owner several domain levels deep is opened cold, reloaded, or reached by back/forward, and none of the extensions along that path are yet mounted.

**Main Flow**:
1. The host's own domain-level observer resolves its own dedicated slot in the URL to a declared route owner by longest matching declared prefix against the occupant identity that slot carries, and reports the owner appearing (`cpt-frontx-routing-fr-route-ownership-signal`); the observer supplies only that slot's value and the host's own declared pairs to the resolution primitive itself, never performing the matching directly.
2. The host's own mount mechanism mounts that route owner in response to the reported transition.
3. Once mounted, that extension's own zone may itself contain a further domain; for each such domain that comes to exist, its own consumer creates that level's own observer, which resolves the slot its enclosing level derives for it from the mounted extension's own slot against that domain's own declared pairs, exactly as the host's own level did, and reports its own transition.
4. This repeats one domain level deeper each time a resolved owner's own zone contains a further domain that has come to exist, until every domain level along the URL's path has resolved, or until a level resolves to no owner.
5. At every level, once its own owner is mounted, that extension's own engine-provider package reads the current location from the shared history at start and matches the remainder of the path under its own basepath — a guarantee the engine-provider port's consumer, not this library, makes about its own construction (owned by that provider's own PRD).

**Postconditions**:
- Each mounted extension and the URL segment its own domain level resolved agree without a blank screen, because each freshly mounted router reads the already-current location rather than starting from a blank route. This library never asserts that every level along the path resolved together as one event — only that each level resolved from a location already current the moment that level began observing.

**Alternative Flows**:
- **No declared owner matches a level's local remainder**: that level's own observer reports no owner; the consumer holding that level shows its own fallback and mounts nothing beneath it. A level several steps deeper along the same URL reporting nothing is indistinguishable, at any shallower level's own observer, from that deeper level's own wave simply not having arrived yet, since no level's own signal ever asserts that a path resolved beyond that level's own domain.
- **The URL later moves outside a mounted owner's declared prefix at some level**: that level's own observer reports the owner disappearing or changing, and the consumer holding that level unmounts through its own mount mechanism. A navigation issued while several levels are still resolving is safe: the resolution restarts as a fresh wave from the outermost level, every stale level is torn down by whichever level mounted it, and no level ever holds onto a remainder of its own — every level always reads the shared history's current location.

## 9. Acceptance Criteria

- [ ] A single navigation-history instance answers `push`/`replace`/`go`/`location`/`subscribe` for the host and for every independently bundled microfrontend registered in the same realm, and every one of those five members is callable by a caller with no mounted router or UI-framework component tree in its call path — verifiable via `cpt-frontx-routing-fr-single-navigation-substrate` and `cpt-frontx-routing-fr-imperative-navigation`.
- [ ] Replacing the engine-provider package used by one microfrontend changes no file outside that microfrontend's own route tree, search-parameter handling, and its own imports of its provider package — verifiable via `cpt-frontx-routing-fr-engine-provider-port`.
- [ ] A cold load, a reload, and a back/forward step all resolve the same declared route owner from a domain level's own local URL portion through the same resolution path, at every level a consumer holds an observer for, reported as an observable transition to that level's own consumer — verifiable via `cpt-frontx-routing-fr-route-ownership-signal`.
- [ ] For a domain whose own occupancy strategy admits more than one occupant at once, every concurrently mounted occupant is projected into the URL and its own transition is reported independently through the route ownership signal — verifiable via `cpt-frontx-routing-fr-concurrent-occupant-projection`.
- [ ] Each concurrently mounted occupant's own parameters resolve back to the specific occupant that produced them, with no collision between two occupants' own parameter names — verifiable via `cpt-frontx-routing-fr-per-occupant-addressable-parameters`.
- [ ] The package declares no intra-ecosystem dependency, and its navigation substrate carries no import of any router engine or a UI framework — verifiable via the boundary guards.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| Browser navigation-history API | The primitive the substrate's own realm-shared history implementation is built on. | p1 |

## 11. Assumptions

- The host and every independently bundled microfrontend composed into one application share a single JavaScript realm; the navigation substrate's sharing boundary is the realm.
- The host mounts the navigation substrate, and creates the route ownership signal's observer for its own domain level with its own owner-prefix pairs source, before any deep link into any domain level's screen is resolved; a nested level's own consumer does the same for its own level, once that level begins to exist.
- A domain-level conflict — two route owners registered at the same domain declaring the same prefix — is caught at the point that domain's own consumer registers its route owners, not by this library; prefix equality for this purpose is decided by this library's own segment-normalization rule (equivalently, an equivalence predicate over declared prefixes), published precisely so a domain's own consumer can apply the same rule the library itself uses to resolve either prefix at navigation time. Nesting a further domain inside one route owner's own zone is not a same-domain conflict: it is a separate domain, one level deeper, with its own independent set of route owners and its own independent conflict check. This check compares distinct registrations against one another, so it catches two separately registered route owners that declare the same prefix — including two mounts of the identical underlying extension, since each mount is its own distinct route owner with its own independently declared prefix (§11, below), never one route owner or one registration shared between them. There is no case this check cannot see: a same-entry mount declaring the same prefix as another occupant is caught exactly as any other pair of route owners declaring the same prefix is.
- A route owner's own declared prefix is one or more non-empty path segments: the owner-prefix pairs source a domain's own consumer supplies is a set of pairs, but no identifier appears in it against two different prefixes. The same underlying extension mounted more than once — to present the same UI at more than one place — is a distinct route owner at each mount, each with its own declared prefix, never one route owner declaring several; an ownership-change transition therefore never needs to carry more than the new owner's own current prefix, since that prefix is fixed for as long as the registration producing it exists. This guarantee disambiguates identifier-to-prefix mapping only; it does not by itself bound how many declared prefixes' own route owners one domain may report as concurrently resolved at once. A domain whose own occupancy strategy admits only one occupant at a time still has exactly one resolved owner per prefix, as this bullet states; a domain whose own occupancy strategy admits several occupants side by side reports each concurrently resolved owner independently, without weakening this same per-prefix guarantee for any one of them (`cpt-frontx-routing-fr-concurrent-occupant-projection`, §5.2).
- A microfrontend declares the routes in its own routing table relative to its own basepath, never as absolute paths carrying that basepath. An absolute path pins the routing table to one deployment mode's basepath, which is what would make the composed and standalone modes diverge.
- A consumer that needs the URL and the mounted route owner to durably agree, at any domain level, implements that reconciliation itself at that level, on top of the route ownership signal and the URL back-projection helper that level's own observer publishes (`cpt-frontx-routing-fr-route-ownership-signal`); this library publishes the facts the reconciliation acts on but does not perform the reconciliation itself, at the outermost level or at any level nested beneath it — a level several domains deep carries exactly the same obligation as the outermost one, never a lesser or different one. Which channel is permitted to drive that reconciliation's own mount or unmount once the application has already booted is decided outside this library, by whichever mount mechanism the consumer's runtime already owns, per this package's own Mount Trigger Ownership decision record; this library's own contribution stops at the signal and the helper, at cold load exactly as at every later transition.
- More than one route-ownership-signal observer may exist in the same realm at once — one per domain level a consumer holds — with no conflict between them: each observer is independent, reads its own owner-prefix pairs source, resolves against its own slot or slots in the URL, and reports its own transitions against the one shared navigation history every observer in the realm reads. Resolving a URL several domain levels deep is therefore not one event but a wave of independent, per-level resolutions: each level's own observer resolves and reports the moment that level begins to exist, this library holds no registry of levels and so publishes no signal asserting that a path resolved end to end, and a level several steps deeper reporting nothing yet is indistinguishable, at any shallower level, from that deeper level's own wave simply not having arrived — until the deeper level itself begins to exist and reports its own first resolution. This wave describes one domain level's own multiplicity across levels; several occupants sharing the same domain at the same level is a distinct multiplicity, addressed by this library's own concurrent-occupant requirements rather than by this bullet (§5.2).
- **Corrected — same-entry mounts are ordinary distinct route owners, not a shared-registration gap**: `cpt-frontx-routing-fr-concurrent-occupant-projection` (§5.2) requires two concurrently mounted instances of the identical underlying extension to stay independently addressable within one domain. This already holds by construction: an extension is an instance, and each mount is its own separately registered route owner with its own independently declared prefix (§11, above) — never one route owner or one registration two mounts share. Two same-entry mounts that happened to declare the same prefix would therefore be caught by the ordinary registration-time conflict check (§11, above), exactly as any other pair of route owners declaring the same prefix is; there is no special same-entry case, no missing discriminator to mint, and no gap for another package's requirements to close.
- **Open — an occupant's own internal routing state alongside domain-occupancy addressing**: this PRD requires each concurrently mounted occupant of a domain to stay independently addressable, with its own parameters resolving back to it alone (§5.2), but it does not state how an occupant's own internal navigation state — whatever screen or view that occupant itself is currently showing inside its own zone — is expected to coexist with that addressing once the occupant is one of several mounted side by side, rather than a domain's sole occupant. Left open; not resolved by this PRD's own requirements.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Two independently bundled copies of this package end up with two separate history instances instead of one shared instance. | Programmatic navigation in one copy produces no change the other observes, so routers drift out of agreement with each other and with the URL. | The navigation substrate is reached through a single realm-shared instance rather than a per-bundle one, by construction, for every copy built against the same `NavigationHistory` contract version. This prevention holds within one contract version only: a copy built against a different version resolves under its own versioned key and constructs its own instance, so a cross-version mismatch yields one instance per version rather than a single shared one. |
| A replacement router engine's history adapter does not fully satisfy the shared history's contract. | The microfrontend that adopted it may navigate correctly in isolation while disagreeing with the rest of the realm. | The engine-provider port states the history contract the substrate expects; the engine-behind-port constraint keeps every other unit unaffected by the substitution either way. |
