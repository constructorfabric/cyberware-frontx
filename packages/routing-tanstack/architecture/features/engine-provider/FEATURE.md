# Feature: Engine Provider


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
  - [1.5 Worked Example: Satisfying The Engine-Provider Port](#15-worked-example-satisfying-the-engine-provider-port)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Swap The Router Engine Used By One Microfrontend](#swap-the-router-engine-used-by-one-microfrontend)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [History Adaptation To The RouterHistory Contract](#history-adaptation-to-the-routerhistory-contract)
  - [Router Creation And Mount Over A Virtual History](#router-creation-and-mount-over-a-virtual-history)
  - [Location-Preserving Navigation Helper](#location-preserving-navigation-helper)
  - [Teardown On Unmount](#teardown-on-unmount)
  - [Standalone Deployment Of A Single Microfrontend](#standalone-deployment-of-a-single-microfrontend)
- [4. States (CDSL)](#4-states-cdsl)
  - [No Feature-Owned State Machine](#no-feature-owned-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [History Adaptation And Router Construction Over A Virtual History](#history-adaptation-and-router-construction-over-a-virtual-history)
  - [Location-Preserving Redirect And Standalone Deployment](#location-preserving-redirect-and-standalone-deployment)
  - [Teardown Unsubscription On Unmount](#teardown-unsubscription-on-unmount)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-routing-engine-provider`
## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-routing-engine-provider`

### 1.1 Overview

The Engine Provider is the sole component permitted to import a concrete router engine. It receives the entry address this occupant was mounted at — its own domain key and extension, or the absence of one when the occupant runs standalone — from the mounting level at construction, never read from the navigation substrate itself, and, once mounted, projects that entry's own payload into a **virtual location** (its reserved `route` parameter as pathname, defaulting to `/` when absent, and every other parameter as search), and adapts that virtual location, together with the navigation substrate's `NavigationHistory` contract, into the `RouterHistory` contract a concrete engine expects — filling in the members `NavigationHistory` does not provide and translating `NavigationHistory`'s own notification into the `SubscriberArgs` shape (`location`, `action`) the engine's `subscribe` callback expects — constructs that engine's router with `createRouter({ routeTree, history })`, and mounts it into the microfrontend's own component tree via `RouterProvider`. Every navigation the constructed router performs is written back to this occupant's own entry alone, through the navigation substrate's own control boundary — never a sibling occupant's entry, another domain's entry, or the shell subroute — and `createHref` composes a full, shareable composed-application URL from an updated virtual location by calling the navigation substrate's own grammar serializer, never by concatenating path fragments. The default provider this package ships binds this adapter to TanStack Router, using its React binding (`@tanstack/react-router`) and `@tanstack/history`; a microfrontend may replace its own provider with a different one satisfying the same engine-provider port, including one that adopts a different internal-route convention of its own. The `route` parameter's own value, as it sits in the URL, carries no leading `/` — the navigation substrate's `name`/`param-value` grammar admits one just as any other character, but this provider's own convention never writes one there; this adapter prepends exactly one `/` to build the virtual location's own pathname on read, and strips exactly one leading `/` back off before writing the pathname back into the entry's own `route` parameter on write-back.

### 1.2 Purpose

A router engine renders routes and matches search parameters, and concrete engines evolve on their own release cadence, independent of the navigation substrate and of every other microfrontend in the realm. Confining engine choice to a swappable, per-microfrontend adapter is what keeps that evolution — or an outright engine replacement — from reaching the substrate, the host, or a sibling microfrontend. The navigation substrate's own URL grammar carries no notion of pathname and search beyond the shell subroute it never interprets; giving a page-shaped engine something to route against therefore requires a convention layered on top of one occupant's own entry, and this feature exists to be that adapter: it is the only place a concrete engine's package is imported, the only place a virtual location is projected from an entry, and the only place `NavigationHistory` is translated into what `createRouter` expects as `RouterHistory`.

**Requirements**: `cpt-frontx-routing-fr-engine-provider-port` (core), `cpt-frontx-routing-tanstack-fr-engine-adaptation`, `cpt-frontx-routing-tanstack-fr-scoped-navigation-zone`, `cpt-frontx-routing-tanstack-fr-standalone-deployment`, `cpt-frontx-routing-tanstack-fr-location-preserving-helpers`, `cpt-frontx-routing-tanstack-nfr-single-ecosystem-edge`

**Principles**: `cpt-frontx-routing-tanstack-principle-engine-confined`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-routing-tanstack-actor-microfrontend-developer` | Builds a microfrontend's own router addressed at its own entry, may replace the engine provider inside that microfrontend's own build without touching anything outside it, and uses the location-preserving navigation helper for a redirect that must carry search, and the page's own hash, forward within that same entry. |
| `cpt-frontx-routing-tanstack-actor-router-engine` | The pluggable, replaceable engine an engine provider binds the shared history to; TanStack Router is the default, constructed via `createRouter({ routeTree, history })` over this package's own virtual history. |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Use case**: `cpt-frontx-routing-tanstack-usecase-swap-router-engine`
- **Component**: `cpt-frontx-component-routing-engine-provider`
- **Constraints**: `cpt-frontx-constraint-routing-tanstack-sole-engine-import`
- **Dependencies**: `cpt-frontx-feature-routing-navigation-substrate` — the core package's own feature ([routing DESIGN](../../../../routing/architecture/DESIGN.md)); the provider implements the engine port the substrate defines, and projects its own virtual location from the entry and the URL grammar that feature owns.

**Territory boundary**: Replacing the engine provider used by one microfrontend is scoped to that microfrontend's own code — its route tree, its own search-parameter handling, and every one of its own imports of this package, since the package split means a microfrontend reaches this adapter only through such an import and a swap rewrites every one of them throughout that microfrontend. It reaches no further: the navigation substrate, the URL grammar, and the route ownership signal — all owned by the core package (`cpt-frontx-feature-routing-navigation-substrate`, `cpt-frontx-feature-routing-route-ownership-signal`, [routing DESIGN](../../../../routing/architecture/DESIGN.md)) — the host's code, and every sibling microfrontend are unaffected and may remain on a different engine provider of their own, including one that projects a virtual location by a different convention.

### 1.5 Worked Example: Satisfying The Engine-Provider Port

The engine-provider port's normative schema — what a conforming provider **MUST** accept from the navigation substrate and what it is responsible for producing — is owned by the navigation substrate's own artifacts, not by this provider (`cpt-frontx-feature-routing-navigation-substrate` §1.5, Engine-provider port shape: [routing FEATURE](../../../../routing/architecture/features/navigation-substrate/FEATURE.md#15-contract-shapes)), per `cpt-frontx-adr-contract-schema-ownership` (owned contract role in DESIGN, decision rationale in the ADR, field-level schema in the owning FEATURE — here, the *port-declaring* feature, since the port belongs to the core package). What follows is this package's own worked example of satisfying that schema with a concrete engine; it demonstrates the normative form, it does not restate it.

This package accepts the navigation substrate's `NavigationHistory` instance, the entry address this occupant was mounted at — its own domain key and extension — or its absence when the occupant runs standalone, and the microfrontend's own route tree exactly as the port requires (linked above). It produces a constructed, mounted router in two steps the port itself does not mandate but that this provider's own worked example follows throughout: first, projecting the given entry's own payload into a **virtual location** — the payload parameter reserved by this package's own convention, `route`, becomes the virtual location's pathname (defaulting to `/` when the entry carries no such parameter), and every other parameter of that same entry becomes the virtual location's search; second, deriving this engine's own history-contract object from that virtual location and the substrate's `NavigationHistory` — deriving the members `RouterHistory` requires beyond `location`/`subscribe`/`push`/`replace`/`go`, and translating `NavigationHistory`'s notification into the `SubscriberArgs` shape (`location`, `action`) `RouterHistory`'s `subscribe` callback expects. The full derivation this worked example follows is §3, History Adaptation, below.

**Reserved parameter `route` — this provider's own convention, verbatim.** The navigation substrate treats this reserved parameter only as a convention a provider adopts, never a rule the substrate itself imposes (`packages/routing/architecture/DESIGN.md`, "Navigation Substrate"). This provider's own PRD states the convention normatively and gives its own worked examples (`packages/routing-tanstack/architecture/PRD.md` §9, Examples 1 and 2); Example 1 is reproduced here because this package is the provider that implements it — an implementation **MUST** reproduce this example as one of its own acceptance scenarios:

> **A microfrontend's own router.** Under the default engine provider, an occupant's internal route is the reserved parameter `route`; its remaining parameters are its router's search.
>
> ```
> /en?screen=dashboard;route=settings/general;orientation=left
>    &sheet=tenant-details;route=contacts;tenantId=456
> ```
>
> The dashboard's router sees pathname `/settings/general` and search `orientation=left`.

This is a convention this provider adopts, not a rule the navigation substrate's own port imposes on every conforming provider (routing DESIGN §1.1, Navigation Substrate; §3.3, Engine-provider port); a different engine-provider port implementation is free to project an entry's own payload into a virtual location by a different rule, as long as it, too, reads and writes only its own entry.

**Diagnostic of mismatch, for this worked example**: this provider fails at construction, not at first navigation, if it cannot accept `NavigationHistory` as-is — the same construction-time failure the port's normative definition records at the link above. For this package specifically, that means the router is never constructed and the microfrontend's routing does not initialize (`cpt-frontx-routing-tanstack-usecase-swap-router-engine`, Alternative Flow). This failure is local to the microfrontend that adopted the mismatched provider; it does not reach the substrate, the host, or a sibling microfrontend.

## 2. Actor Flows (CDSL)

### Swap The Router Engine Used By One Microfrontend

- [ ] `p1` - **ID**: `cpt-frontx-flow-routing-engine-provider-swap-engine`

**Actor**: `cpt-frontx-routing-tanstack-actor-microfrontend-developer`

**Use cases**: `cpt-frontx-routing-tanstack-usecase-swap-router-engine`

**Success Scenarios**:
- A microfrontend mounted at a declared entry address, currently using the default TanStack Router engine provider, has its engine provider replaced with a different one satisfying the same engine-provider port (§1.5); the microfrontend's own route tree, its search-parameter handling, and every one of its own imports of this package move to the new engine, and nothing outside that one microfrontend's own code changes.

**Error Scenarios**:
- The replacement provider does not satisfy the engine-provider port (§1.5): it cannot accept the shared `NavigationHistory` instance and adapt it into whatever history contract its own engine requires, and the microfrontend's routing does not initialize.

**Steps**:
1. [ ] - `p1` - The Microfrontend Developer replaces the engine provider inside that microfrontend's own build with a different one satisfying the same engine-provider port - `inst-replace-provider`
2. [ ] - `p1` - The replacement provider is handed the same navigation substrate's shared `NavigationHistory` instance and the same entry address the previous provider used - `inst-hand-same-history-entry`
3. [ ] - `p1` - The replacement provider adapts that shared `NavigationHistory` and entry into whatever virtual location and history contract its own engine expects (the default provider's own worked example is `cpt-frontx-algo-routing-engine-provider-history-adaptation`, translating into `RouterHistory`/`SubscriberArgs`) - `inst-adapt-history`
4. [ ] - `p1` - **IF** the replacement provider does not satisfy the engine-provider port - `inst-if-contract-unsatisfied`
   1. [ ] - `p1` - **RETURN** failure — the microfrontend's routing does not initialize - `inst-return-init-failure`
5. [ ] - `p1` - **ELSE** the replacement provider constructs its engine's router and mounts it over its own virtual history (`cpt-frontx-algo-routing-engine-provider-router-creation`) - `inst-construct-and-mount`
6. [ ] - `p1` - The microfrontend's own route tree, its search-parameter handling, and every one of its own imports of this package — rewritten throughout that microfrontend's own code to the replacement provider's own surface — move to the new engine; nothing outside that one microfrontend's own code changes - `inst-territory-confined`

**Postconditions**:
- The navigation substrate, the host, and every sibling microfrontend observe no change.

## 3. Processes / Business Logic (CDSL)

### History Adaptation To The RouterHistory Contract

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-engine-provider-history-adaptation`

**Input**: The navigation substrate's shared `NavigationHistory` instance, exposing `location`, `subscribe`, `push`, `replace`, `go`; the entry address this occupant was mounted at — its own domain key and extension — or its absence when the occupant runs standalone.

**Output**: An object satisfying the `RouterHistory` contract of `@tanstack/history`, usable as `createRouter`'s `history` input, navigating a virtual location projected from this occupant's own entry.

**Steps**:
1. [ ] - `p1` - Project this occupant's own entry into a virtual location — the entry's own reserved `route` parameter, which itself carries no leading `/`, with exactly one `/` prepended to form the pathname (`/` alone when the parameter is absent), and every other parameter as search. When an entry address is supplied, obtain that entry by parsing `NavigationHistory`'s own current location via the navigation substrate's own grammar parser (`cpt-frontx-algo-routing-navigation-substrate-grammar-parse`) and selecting, from the resulting entry list, the one entry whose own `{domainKey, extension}` equals the given entry address — equality checked with the navigation substrate's own name-equality predicate (`cpt-frontx-algo-routing-navigation-substrate-name-validity`) on each of the two fields — never by asking the route ownership signal to resolve an owner: this provider never performs, and never depends on, entry resolution. When running standalone, project from the deployment-supplied virtual location directly instead (`cpt-frontx-algo-routing-engine-provider-standalone-deployment`). This entry's own parameter order, on write, is fixed by this provider's own convention: `route` first, then every TanStack search key in the order TanStack's own search serializer emits them. Each TanStack search key becomes exactly one parameter name of the identical name; its value is TanStack's own string serialization of that key, which this package's own adapter treats as an opaque string — the navigation substrate's own codec encodes and decodes it, but never inspects or re-parses its content - `inst-project-virtual-location`
2. [ ] - `p1` - Expose the projected virtual location as `RouterHistory`'s `location` member, and derive `push`/`replace`/`go` as functions that write a new virtual location back through exactly one call to the core's own URL back-projection helper (`cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`) — never through a fragment of the raw URL string, and never through a separate parse/serialize/push sequence of this provider's own, since the helper itself parses the current URL, applies the change, serializes the result, and issues the single history call: the call names this occupant's own entry address, the entry's own new, full parameter list — `route` first, with exactly one leading `/` stripped off the virtual location's own pathname before writing it back as that parameter's value, then every remaining parameter as given, in the order TanStack's own search serializer emits them — and the verb `RouterHistory`'s own caller requested, `push` or `replace`. This provider parses the current URL itself, via the grammar parser (`cpt-frontx-algo-routing-navigation-substrate-grammar-parse`), only when reading its own virtual location (step 1 above), never when writing one back. Because `payload-changed` replaces an entry's entire parameter list rather than merging into it, any parameter of this occupant's own entry that is not `route` and not a member of TanStack's own current search is dropped unless TanStack's own search still carries it — never a sibling's entry, another domain's entry, or the shell subroute - `inst-expose-direct-members`
3. [ ] - `p1` - Derive the `RouterHistory` members that translate directly from the virtual history's own state and calls: `back` and `forward` from `go(-1)` and `go(1)`; `createHref`, `flush`, `destroy`, `notify`, and `subscribers`. `length` and `canGoBack` are not derivable from the virtual location itself — this adapter reports `length` as the count of virtual pushes this constructed history has itself issued since construction, and `canGoBack` as `true` exactly when that count is greater than zero, delegating to the page's own history's `canGoBack` otherwise (standalone, before this router's own first virtual push) - `inst-derive-missing-members`
4. [ ] - `p1` - Derive `createHref` specifically as: compose the full composed-application URL by calling the navigation substrate's own grammar serializer (`cpt-frontx-algo-routing-navigation-substrate-grammar-serialize`) over the current parsed entry list with this occupant's own entry replaced by the one the given virtual location projects back to — never by concatenating the virtual location's own pathname and search as if they were a page's own URL - `inst-derive-create-href`
5. [ ] - `p1` - Construct `block` as a recognized, degraded adaptation rather than a member routinely derived like steps 3 and 4's: `NavigationHistory`'s fan-out notifies a subscriber only after a navigation has already taken effect (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`), so nothing in the substrate's own contract lets this adapter intercept and cancel a navigation before it happens. The constructed `block` can stop only a navigation issued through this same constructed router's own `RouterHistory` object — a call the engine routes back through this adapter before it ever reaches the shared history; it cannot stop a back/forward step, a `go` call issued by another unit, or a navigation any other unit performs directly through the shared `NavigationHistory` — the shared history commits any of those regardless of a block state this adapter holds - `inst-derive-block-degraded`
6. [ ] - `p1` - Expose `RouterHistory`'s `subscribe(cb)` by registering an internal callback against `NavigationHistory`'s own `subscribe`, re-projecting this occupant's own entry into a virtual location on every notification, and from inside that internal callback, construct the `SubscriberArgs` shape (`location`, `action`) `RouterHistory`'s `cb` expects before invoking `cb` with it: `SubscriberArgs.location` is the re-projected virtual location, and `SubscriberArgs.action` is derived directly from `NavigationHistory`'s own notification's navigation-kind field (`cpt-frontx-feature-routing-navigation-substrate` §1.5, Contract Shapes — `push`, `replace`, or a third kind covering both a history move and an observed third-party addition such as fragment navigation) — `action` is never invented or independently inferred by this adapter - `inst-adapt-subscribe`
7. [ ] - `p1` - **IF** this occupant's own entry is absent from the newly parsed entry list at the moment step 6's own re-projection runs — removed by a back step, or by a structural reset, while this occupant has not yet been unmounted - `inst-if-own-entry-absent`
   1. [ ] - `p1` - The virtual location keeps its own last-projected value rather than re-projecting to some default; no write-back runs, because there is no longer an entry of this occupant's own to write to; and `cb` is not invoked for this occupant's own `RouterHistory` — the constructed router receives no navigation of its own from this round. Teardown (§3, Teardown On Unmount) still runs normally once whichever consumer's mount mechanism actually unmounts this occupant, in response to the same removal - `inst-own-entry-absent-inert`
8. [ ] - `p1` - **RETURN** the adapted `RouterHistory` object - `inst-return-adapted-history`

**Rationale**: `block`'s narrowed scope is a property of the substrate's own contract, not a defect in this adaptation — `NavigationHistory` reports a navigation only once it has already committed (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`), so no adapter built on top of it can synchronously veto a navigation it did not itself initiate. Recording that narrowed scope here, rather than shipping a `block` that reads as general-purpose but is not, is what keeps a consumer that adopts a blocking route guard from assuming a stronger guarantee than this adapter can make. Deriving `createHref` from the substrate's own serializer, rather than from string concatenation of the virtual location alone, is what keeps a link this package hands out valid against the full composed-application URL — including every sibling entry the link must leave untouched — rather than only against this occupant's own slice of it.

### Router Creation And Mount Over A Virtual History

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-engine-provider-router-creation`

**Input**: The adapted `RouterHistory` object, itself built over a virtual location projected from this occupant's own entry; the microfrontend's own route tree.

**Output**: A router instance built via `createRouter({ routeTree, history })`, mounted into the microfrontend's own component tree via `RouterProvider`.

**Steps**:
1. [ ] - `p1` - Call `createRouter({ routeTree, history })` with the microfrontend's own route tree and the adapted, virtual history - `inst-call-create-router`
2. [ ] - `p1` - The constructed router matches only its own virtual location — the pathname and search this package projected from the occupant's own entry — and never a sibling occupant's own virtual location or another domain's - `inst-scope-to-entry`
3. [ ] - `p1` - Mount the constructed router into the microfrontend's own component tree via `RouterProvider` - `inst-mount-router-provider`
4. [ ] - `p1` - **RETURN** the mounted router - `inst-return-mounted-router`

### Location-Preserving Navigation Helper

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-engine-provider-index-redirect`

**Input**: A target path a consumer is redirecting or navigating to, within the occupant's own virtual location; the current virtual location's search; the page's own current hash. The virtual location itself is a `{pathname, search}` pair carrying no hash of its own — the hash the navigation substrate copies verbatim on every read and write is the page's own, unaffected by whether this occupant is composed or standalone (routing DESIGN §1.1, Navigation Substrate; ruling: a mounted occupant's virtual location has no hash, the page hash stays the application's) — so this helper carries the two forward as what they are: the occupant's own virtual search, and the page's own hash alongside it.

**Output**: A `redirect` (or other navigation call) to the target path carrying the current virtual location's search, and the page's own current hash, forward — reusable by any consumer redirect — an index-route redirect is one call site, not the only one.

**Steps**:
1. [ ] - `p1` - Accept the target path from the caller — a route's own redirect target, an index route's resolved destination, or any other consumer-supplied path — interpreted against this occupant's own virtual location, never against the composed-application URL directly - `inst-accept-target-path`
2. [ ] - `p1` - Read the current virtual location's search, and the page's own current hash - `inst-read-current-search-hash`
3. [ ] - `p1` - Carry that search and that hash forward onto the target path, rather than requiring the caller to assemble the carry-forward itself - `inst-carry-search-hash`
4. [ ] - `p1` - **RETURN** the `redirect` (or navigation call) to the target path with search and hash intact, to be written back to this occupant's own entry alone through the navigation substrate's own control boundary — the search into that entry's own payload, the hash exactly as read, since this package never interprets it - `inst-return-redirect`

**Rationale**: A redirect built from the target path alone silently drops the current virtual location's search and the page's own hash — a mistake that looks correct until a query parameter or hash fragment disappears in front of a user. Generalizing this helper to any consumer redirect, rather than leaving it as private knowledge inside one application's own index-route handling, is what makes the correct behavior the path of least resistance for every redirect this package's consumers write (`cpt-frontx-routing-tanstack-fr-location-preserving-helpers`). This helper is this package's own instance of an explicit carry-forward, not an exception to it: the navigation substrate's own back-projection helper resets a removed or changed entry's own nested subtree by default and carries a payload forward only when the caller's own delta explicitly says so (`cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`), and an index-route redirect within an already-mounted microfrontend's own virtual location is exactly the ordinary, in-territory case where a caller wants that explicit carry-forward, since it never reaches outside this occupant's own entry.

### Teardown On Unmount

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-engine-provider-teardown`

**Input**: A constructed router whose microfrontend is being unmounted; the internal callback (§3, History Adaptation) that router's adapted `RouterHistory` registered against the shared `NavigationHistory`'s `subscribe`.

**Output**: The internal callback unsubscribed from the shared `NavigationHistory`, so the unmounted router's own `RouterHistory` stops receiving the fan-out.

**Steps**:
1. [ ] - `p1` - **WHEN** the microfrontend that owns this constructed router is unmounted (whichever level's own consumer mounted it — the host's, at the outermost domain, or an enclosing extension's, at any level nested deeper — unmounting it, informed by `cpt-frontx-feature-routing-route-ownership-signal`'s observable ownership-change transition, or that same consumer's own teardown for any other reason) - `inst-when-unmount`
   1. [ ] - `p1` - Invoke the unsubscribe function returned when this adapter registered its internal callback against the shared `NavigationHistory`'s `subscribe` - `inst-invoke-unsubscribe`
2. [ ] - `p1` - **RETURN** - `inst-return-teardown`

**Rationale**: If this step is skipped, the torn-down router's own `RouterHistory` callback keeps receiving the shared history's fan-out for a component tree that no longer exists — a leaked subscription that grows with every mount/unmount cycle a long-lived host session runs through. This is the Engine Provider's own responsibility because it is the component that registered the internal callback in the first place (§3, History Adaptation); the navigation substrate has no notion of "this listener's microfrontend was unmounted" to act on even if it wanted to.

### Standalone Deployment Of A Single Microfrontend

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-engine-provider-standalone-deployment`

**Input**: The microfrontend's own route tree and the substrate's `NavigationHistory`; no entry address — the microfrontend runs standalone; whether the consumer has created a route-ownership-signal observer (`cpt-frontx-feature-routing-route-ownership-signal`) for this deployment — a plain argument-driven choice the consumer makes, not a port-injection state.

**Output**: A router constructed and mounted through the same path the composed case uses, projecting the identical virtual location directly onto the page's own pathname and search instead of onto one entry's own payload, independent of whether the consumer has created a route-ownership-signal observer for this deployment.

**Steps**:
1. [ ] - `p1` - **IF** no entry address is supplied — the microfrontend is served standalone - `inst-if-standalone`
   1. [ ] - `p1` - Project the virtual location directly onto the page's own current pathname and search — the identical `route`-parameter convention applied to the page's own address as a whole, rather than to one entry inside a larger composed-application URL: the page's own pathname is this occupant's entire virtual pathname, and the page's own search is its entire virtual search, with no `route` parameter to extract because there is no enclosing entry to extract it from - `inst-project-standalone-location`
   2. [ ] - `p1` - Write-back in this mode goes directly through the page's own history — no entry, no grammar codec, and no back-projection helper are involved at all, because there is no composed-application URL and no domain key to target; `push`/`replace`/`go` call the page's own `history.pushState`/`replaceState`/`go` with the page's own pathname and search built from the virtual location directly - `inst-standalone-write-back`
2. [ ] - `p1` - **IF** the consumer has not created a route-ownership-signal observer for this deployment - `inst-if-no-signal`
   1. [ ] - `p1` - No entry resolution, no mount, and no URL back-projection runs — the deliberate standalone-deployment case - `inst-no-signal-inert`
3. [ ] - `p1` - **ELSE** the consumer has created the observer, supplying its own registered-extensions source - `inst-else-signal-created`
   1. [ ] - `p1` - The observer resolves and reports ownership transitions exactly as in the composed case (`cpt-frontx-feature-routing-route-ownership-signal` §3), and the consumer's own mount mechanism acts on them - `inst-signal-active`
4. [ ] - `p1` - Construct the router through the same `createRouter({ routeTree, history })` call the composed case uses, over the standalone-projected virtual history from step 1 - `inst-construct-with-standalone-virtual-history`
5. [ ] - `p1` - Mount the router via `RouterProvider` through the same construction path as the composed case - `inst-mount-standalone-router`
6. [ ] - `p1` - **IF** a navigation targets a `route=` path the microfrontend's own route tree does not declare — this occupant's own router, internally, not the entry it was mounted at — in either mode - `inst-if-undeclared-path`
   1. [ ] - `p1` - Resolution reaches the engine's own `notFound` route inside this microfrontend's own route tree, identically whether the occupant is composed or standalone: this is the occupant's own router's own not-found, never the consumer-level fallback a domain's own consumer shows for an entry the route ownership signal reports unresolved. The two are distinct levels — an undeclared internal path is always this router's own concern; an unresolved extension token is a decision the route ownership signal reports and this provider never makes, in either mode - `inst-standalone-fallback`
7. [ ] - `p1` - **RETURN** the mounted router — differing from the composed case only in whether an entry address was supplied, and in whether a route-ownership-signal observer exists at all - `inst-return-standalone-router`

Two conditions of this mode fall on the deployment rather than on this feature: the server answering every path this package's own virtual routing table declares with the entry document, without which a deep link fails before any of this package's code runs; and the build's asset base URL, configured independently of this package's own virtual location since neither derives from the other.

## 4. States (CDSL)

### No Feature-Owned State Machine

Not applicable. The Engine Provider projects a virtual location, adapts a history, and constructs a router; it holds no binding or occupancy lifecycle of its own to model as named states with guarded transitions — no feature in this package defines one, since mounting and occupancy belong entirely to whichever mount mechanism the consumer already runs (`cpt-frontx-feature-routing-route-ownership-signal` §4). A constructed router's internal request/route-matching state is the concrete engine's own concern, opaque to this adapter, and not something this package specifies, so no state machine is defined for this feature.

## 5. Definitions of Done

### History Adaptation And Router Construction Over A Virtual History

- [ ] `p1` - **ID**: `cpt-frontx-dod-routing-engine-provider-adaptation-and-creation`

The system **MUST** project this occupant's own entry — its reserved `route` parameter as pathname, defaulting to `/` when absent, and every other parameter as search — into a virtual location, **MUST** adapt that virtual location and the navigation substrate's shared `NavigationHistory` into a `RouterHistory` object — exposing `location` as the projected virtual location, deriving `push`/`replace`/`go` to write only this occupant's own entry back through the navigation substrate's own control boundary, deriving the further members the engine's contract requires beyond those, constructing `block` as the recognized, degraded adaptation specified in `cpt-frontx-algo-routing-engine-provider-history-adaptation` rather than a routinely derived member, deriving `createHref` by calling the navigation substrate's own grammar serializer over the full current entry list, and constructing `SubscriberArgs` (`location`, `action`) for `RouterHistory`'s `subscribe` callback from `NavigationHistory`'s own notification — and **MUST** construct the engine's router via `createRouter({ routeTree, history })` and mount it into the microfrontend's own component tree via `RouterProvider`. No package in this ecosystem other than this one **MUST** import a concrete router engine; this package is the sole, deliberate exception to that prohibition.

**Implements**:
- `cpt-frontx-flow-routing-engine-provider-swap-engine`
- `cpt-frontx-algo-routing-engine-provider-history-adaptation`
- `cpt-frontx-algo-routing-engine-provider-router-creation`

**Addresses**:
- `cpt-frontx-routing-fr-engine-provider-port`
- `cpt-frontx-routing-tanstack-fr-engine-adaptation`
- `cpt-frontx-routing-tanstack-fr-scoped-navigation-zone`
- `cpt-frontx-routing-tanstack-principle-engine-confined`

**Constraints**: `cpt-frontx-constraint-routing-tanstack-sole-engine-import`

**Touches**:
- Component: `cpt-frontx-component-routing-engine-provider`

### Location-Preserving Redirect And Standalone Deployment

- [ ] `p1` - **ID**: `cpt-frontx-dod-routing-engine-provider-redirect-and-standalone`

The system **MUST** provide a reusable navigation helper that carries the current virtual location's search and hash forward onto any consumer-supplied redirect target within the occupant's own entry, rather than dropping them as a naive redirect would — usable from an index-route redirect or any other consumer redirect alike — and **MUST** run the same router construction when the microfrontend is deployed on its own, projecting the identical virtual location directly onto the page's own pathname and search instead of onto one entry's own payload. An undeclared `route=` path inside this microfrontend's own route tree **MUST** resolve to the engine's own `notFound` route identically in both composed and standalone deployment — never to whichever level's own consumer shows as a fallback for an entry the route ownership signal reports unresolved, a distinct level this provider never decides in either mode.

**Implements**:
- `cpt-frontx-algo-routing-engine-provider-index-redirect`
- `cpt-frontx-algo-routing-engine-provider-standalone-deployment`

**Addresses**:
- `cpt-frontx-routing-tanstack-fr-location-preserving-helpers`
- `cpt-frontx-routing-tanstack-fr-standalone-deployment`

**Touches**:
- Component: `cpt-frontx-component-routing-engine-provider`

### Teardown Unsubscription On Unmount

- [ ] `p1` - **ID**: `cpt-frontx-dod-routing-engine-provider-teardown`

The system **MUST** unsubscribe a constructed router's adapted `RouterHistory` from the shared `NavigationHistory` when the microfrontend that owns that router is unmounted, so a torn-down router's callback stops receiving the fan-out.

**Implements**:
- `cpt-frontx-algo-routing-engine-provider-teardown`

**Addresses**:
- `cpt-frontx-routing-fr-engine-provider-port`

**Touches**:
- Component: `cpt-frontx-component-routing-engine-provider`

## 6. Acceptance Criteria

- [ ] The default engine provider projects this occupant's own entry into a virtual location — the reserved `route` parameter as pathname, defaulting to `/` when absent, and every other parameter as search — and adapts it, together with the navigation substrate's shared `NavigationHistory`, into a `RouterHistory` object: `location` exposed as the projected virtual location; `push`/`replace`/`go` deriving to write only this occupant's own entry back through the navigation substrate's own control boundary; the further members the engine's contract requires beyond those derived per `cpt-frontx-algo-routing-engine-provider-history-adaptation`, including `block` constructed with that algorithm's recognized degraded semantics rather than as a routine derivation; and `SubscriberArgs` (`location`, `action`) constructed for `RouterHistory`'s `subscribe` callback from `NavigationHistory`'s own notification — `action` derived from that notification's navigation-kind field, never invented by this adapter.
- [ ] The constructed `block` stops only a navigation issued through the same constructed router's own `RouterHistory` object; it does not stop a back/forward step, a `go` call issued by another unit, or a navigation another unit performs directly through the shared `NavigationHistory` — this narrowed scope is documented, not silently assumed.
- [ ] `createRouter({ routeTree, history })` is called with the adapted, virtual history and the microfrontend's own route tree; the resulting router is mounted via `RouterProvider`, and matches only its own virtual location.
- [ ] `createHref` composes a full composed-application URL by calling the navigation substrate's own grammar serializer over the current entry list with this occupant's own entry replaced, never by concatenating the virtual location's own pathname and search as if they were a standalone URL.
- [ ] Replacing the engine provider used by one microfrontend changes no file outside that one microfrontend's own code — its route tree, its search-parameter handling, and every one of its own imports of this package — and changes no file belonging to the navigation substrate, the host, or a sibling microfrontend.
- [ ] A replacement provider that cannot accept the shared `NavigationHistory` and adapt it into its own engine's history contract fails to receive the shared history, and the microfrontend's routing does not initialize.
- [ ] No package in this ecosystem other than this one imports a concrete router engine or its packages directly; this package is the sole, deliberate exception (`cpt-frontx-constraint-routing-tanstack-sole-engine-import`).
- [ ] The location-preserving navigation helper preserves the current virtual location's search, and the page's own hash, for any consumer redirect within the occupant's own entry, including but not limited to a redirect issued from an index route.
- [ ] A microfrontend deployed on its own runs the same router construction, projecting the identical virtual location directly onto the page's own pathname and search, with no route-ownership-signal observer created for this deployment. An undeclared `route=` path inside the microfrontend's own route tree resolves to the engine's own `notFound` identically in composed and standalone deployment — never to whichever level's own consumer shows as a fallback for an entry the route ownership signal reports unresolved, a distinct level this provider never decides in either mode.
- [ ] When a microfrontend is unmounted, its constructed router's adapted `RouterHistory` is unsubscribed from the shared `NavigationHistory`, so it stops receiving further fan-out.
- [ ] Mode selection by presence of an entry address: given an entry address, the constructed history projects its virtual location from that entry's own payload; given none, it projects the identical convention onto the page's own pathname and search — the same route tree and the same adaptation logic run in both cases, differing only in where the projected pathname and search come from.
- [ ] One navigation sequence performed against the constructed router produces the identical resulting virtual location — the same reserved `route` parameter and the same remaining search parameters — whether the microfrontend is running composed, with the virtual location backed by one entry, or standalone, with the virtual location backed by the page's own address.
- [ ] The provider never writes to a sibling occupant's own entry, another domain's own entry, or the shell subroute, for any navigation the constructed router performs, in either mode.
- [ ] An implementation **MUST** reproduce this provider's own Example 1 (`packages/routing-tanstack/architecture/PRD.md` §9) as one of its own acceptance scenarios (§1.5):

  ```
  /en?screen=dashboard;route=settings/general;orientation=left
     &sheet=tenant-details;route=contacts;tenantId=456
  ```

  The dashboard's router sees pathname `/settings/general` and search `orientation=left`.

- [ ] An implementation **MUST** reproduce this provider's own Example 2 (`packages/routing-tanstack/architecture/PRD.md` §9) as one of its own acceptance scenarios — the same microfrontend served standalone, virtual location projected onto the page's own address:

  ```
  /settings/general?orientation=left
  ```
