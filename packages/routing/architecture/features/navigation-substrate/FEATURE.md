# Feature: Navigation Substrate


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
  - [1.5 Contract Shapes](#15-contract-shapes)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Imperative Navigation Outside The UI Tree](#imperative-navigation-outside-the-ui-tree)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Realm-Global Singleton Resolution](#realm-global-singleton-resolution)
  - [Fan-Out Subscription Dispatch](#fan-out-subscription-dispatch)
  - [Position Tracking](#position-tracking)
  - [Grammar Parse](#grammar-parse)
  - [Grammar Serialize](#grammar-serialize)
  - [Name Validity And Equality](#name-validity-and-equality)
  - [Domain-Key Composition](#domain-key-composition)
- [4. States (CDSL)](#4-states-cdsl)
  - [No Feature-Owned State Machine](#no-feature-owned-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Single Realm-Shared History With Fan-Out Subscription And URL Grammar Codec](#single-realm-shared-history-with-fan-out-subscription-and-url-grammar-codec)
  - [Imperative Navigation Surface Outside The UI Tree](#imperative-navigation-surface-outside-the-ui-tree)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-routing-navigation-substrate`
## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-routing-navigation-substrate`

### 1.1 Overview

*Navigation substrate* in this document names this agnostic core component alone, not the whole published package: `@gears-frontx/routing` is this core plus the Route Ownership Signal component specified in the sibling FEATURE (root DESIGN and ADR 0002 use the same term at package granularity — a broader use than this FEATURE's own; see the package's own [DESIGN §1.1](../../DESIGN.md#11-architectural-vision)). The Engine Provider is not part of this package at all: it is a separately published member (`cpt-frontx-feature-routing-engine-provider`) — the ecosystem provides a default implementation of it — that consumes this component's contract from outside.

The Navigation Substrate is exactly one navigation-history instance per realm, reachable by the host and by every independently bundled microfrontend, with one real subscription against the browser's own navigation history fanned out to every listener — a fan-out its own `push`/`replace` calls also trigger directly, as a second dispatch path alongside that one subscription; the full reasoning for both dispatch triggers, including why a `go` call is observed through the subscription rather than dispatched directly, belongs to §3 (Fan-Out Subscription Dispatch), not repeated here. It exposes that history's `push`, `replace`, `go`, `location`, and `subscribe` — its own `NavigationHistory` contract — for use outside any mounted UI-framework component tree, and it owns the URL grammar codec every domain in the tree is addressed through: parsing the query string into an ordered list of entries and serializing that list back into a URL (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`), together with the name-validity and name-equality rule every domain key and extension token is checked against and the domain-key-composition function a nested domain's own mounting level calls to compose its own key. Which declared extension a domain's own entries actually resolve to is a separate concern this component never performs — the sibling Route Ownership Signal FEATURE (`cpt-frontx-feature-routing-route-ownership-signal`) exposes that resolution, built on top of this codec, never re-implementing it. It carries no dependency on a concrete router engine or UI framework whatsoever; `NavigationHistory` is deliberately narrower than what any concrete engine's own history contract typically requires — a separately published engine-provider package is responsible for adapting one into the other, never this component.

### 1.2 Purpose

Independently bundled units cannot share a compile-time singleton — each is its own module graph, built and shipped on its own schedule. A composed application built from such units still needs exactly one navigation history: programmatic navigation performed through `pushState` produces no `popstate` event, so it is invisible to any second copy of a history-managing module that did not perform the call itself. Left alone, two independently bundled copies of this package would each construct their own history instance, and a `push`/`replace`/`go` issued through one would leave the other holding a stale `location` — the two copies, and the routers built on top of them, would drift out of agreement with each other and with the address bar. The Navigation Substrate exists to make that divergence structurally impossible: every unit in the realm reaches the same instance, by construction, rather than by convention. How the substrate's own fan-out stays visible to every subscriber despite that same `pushState`/`popstate` gap is §3's own concern (Fan-Out Subscription Dispatch), not this one's.

**Requirements**: `cpt-frontx-routing-fr-single-navigation-substrate`, `cpt-frontx-routing-fr-imperative-navigation`, `cpt-frontx-routing-fr-route-ownership-signal`, `cpt-frontx-routing-fr-engine-provider-port`, `cpt-frontx-routing-nfr-agnostic-core`

**Principles**: `cpt-frontx-routing-principle-single-history-authority`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-routing-actor-application-developer` | Reaches the realm-shared history to navigate imperatively from code outside any UI-framework component tree — a mounting resolver, a host action handler, or a bootstrapping routine. |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Component**: `cpt-frontx-component-routing-navigation-substrate`
- **ADR**: `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity` — the normative URL grammar this feature's codec algorithms implement.
- **Constraints**: `cpt-frontx-constraint-routing-no-engine-leak`, `cpt-frontx-constraint-routing-no-intra-ecosystem-dependency`
- **Dependencies**: None — this feature is the ecosystem-facing foundation of the package; `cpt-frontx-feature-routing-route-ownership-signal` and `cpt-frontx-feature-routing-engine-provider` both depend on it.

### 1.5 Contract Shapes

Field-level shape of `NavigationHistory`'s own `location` value and of the notification its `subscribe` callback receives, per `cpt-frontx-adr-contract-schema-ownership` (owned contract role in DESIGN, decision rationale in the ADR, field-level schema here in the owning FEATURE — this feature owns the `NavigationHistory` contract, `cpt-frontx-component-routing-navigation-substrate`).

**Location shape** — the shape `NavigationHistory`'s own `location` member exposes, and the shape carried inside every subscriber notification below:
- **Path** — the shell subroute: the pathname component of the current URL, everything between the first `/` and `?`. This package never interprets it for occupancy — it is the shell's own private territory, copied verbatim by the grammar codec on every parse and every write (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`).
- **Search** — the current URL's query string.
- **Hash** — the current URL's fragment.
- **Position** — the 0-based index of the current entry within the shared history (F8/D3, review round 16-re; §3, Position Tracking, below): incremented by one over the previous entry's own position on this instance's own `push`, left unchanged by `replace`, and restored from the browser's own persisted per-entry state on an externally observed navigation — the substrate's own position bookkeeping, never an engine's or an occupant's (Entry-carried state, below).

**Subscriber notification shape** — the value passed to each callback a `subscribe` caller registers, once per dispatched round (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`):
- **Location** — the current Location shape (above), current as of the moment this round dispatches.
- **Navigation kind** — which of three kinds of navigation triggered this round: an added history entry performed through this instance's own `push`, a replaced history entry performed through this instance's own `replace`, or a navigation delivered through the browser's own subscription rather than dispatched directly from this instance's own call site. This third kind covers a `go` call issued through this instance, a user's own back/forward step, and a third-party call to the browser's own history API that moves through existing entries (e.g. `history.go`) — and it equally covers an observed third-party addition the same browser subscription delivers, such as a fragment-only anchor activation that adds a new history entry rather than moving through existing ones: the underlying subscription cannot tell a movement among existing entries apart from an observed addition, and this classification does not promise to either — both surface as the same third kind. This is `NavigationHistory`'s own classification, carried in every notification regardless of which of the two dispatch paths (§3, Fan-Out Subscription Dispatch) produced it.

**Observed browser events** — stated explicitly because not every third-party mutation of the browser's own history produces one:
- A user's own back/forward step, and a third-party call that moves through existing history entries (e.g. `history.go` invoked outside this instance), are both observed: the browser raises an event for each, and this substrate's one underlying subscription listens for it.
- A same-document navigation that changes only the URL's fragment — a fragment-only anchor activation, or a third-party mutation of `location.hash` alone — is also observed: the browser raises an event for it too, and the dispatched round's Location shape carries the changed fragment exactly as any other round's does, classified under the same third navigation kind as any other browser-subscription-delivered navigation (Navigation kind, above) even though it adds a history entry rather than moving through existing ones.
- A third-party call that adds or replaces a history entry directly (`pushState`/`replaceState` invoked outside this instance) raises no event this substrate's underlying subscription listens for, so it produces no notification at all — the one third-party history mutation this substrate cannot observe (PRD §3.1; DESIGN §4 failure modes).

This shape is `NavigationHistory`'s own notification, internal to this contract until an adapter translates it into a different contract's shape — the Engine Provider is that adapter for whatever contract shape its own concrete engine's `subscribe` callback expects (`cpt-frontx-feature-routing-engine-provider`), deriving that shape's own action/kind field from this shape's navigation-kind field and its own location field from this shape's Location field, rather than inventing either. A caller who subscribes directly against `NavigationHistory`, without an adapter in between, receives this shape as-is.

**Navigation method signatures** — `NavigationHistory`'s own imperative surface, referenced by `cpt-frontx-feature-routing-engine-provider`'s claim of exposing it directly:
- **`push(path)`** — accepts a path string (pathname, and optionally a query string and a fragment, exactly as the caller composes it) and appends a new history entry for it.
- **`replace(path)`** — accepts a path string composed exactly like `push`'s own argument and overwrites the current history entry with it, leaving every entry before and after the current one untouched.
- **`go(delta)`** — accepts a signed step count (negative for back, positive for forward) and moves through existing history entries; observed asynchronously through the underlying browser subscription (§3, Fan-Out Subscription Dispatch) rather than dispatched directly at the call site.

**Name-equality predicate** — published as its own callable entry point, alongside the name-validity check it shares its alphabet rule with (`cpt-frontx-algo-routing-navigation-substrate-name-validity`): given two candidate `name`-alphabet values — two extension tokens, or two domain-name segments — it reports whether they are identical, character-by-character, under the same case-sensitive comparison the grammar's own `name` production requires (there is no percent-decoding to normalize away, because `name` admits no percent-escapes in the first place). A domain's own consumer calls this predicate at registration time to check two candidate extension tokens for a same-token conflict (PRD §11), applying the identical rule the parser itself applies when it decides whether a later entry's extension token duplicates an earlier one under the same domain key, rather than approximating it with a separate comparison of its own.

**Grammar codec shapes** — the ordered entry list every parse produces and every serialize consumes, per `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`:

- **Parse result** — the shell subroute and the hash, each copied verbatim from the input and returned untouched; an ordered list of entries, each carrying its own `domainKey`, its own `extension`, and its own ordered list of `params` (`{name, value}` pairs, in the order encountered, later occurrences of a duplicate name overwriting the value in place); and an ordered list of warnings, each naming the raw text of the entry it concerns and which of the parse-time edge rules it was produced by (malformed entry, duplicate parameter, duplicate extension). A well-formed input with zero entries parses to an empty entry list, not an error.
- **Serialize input** — the identical shape: a shell subroute, a hash, and an ordered entry list of `{domainKey, extension, params}`. Serializing is this parse result's own inverse for every entry the parser actually kept, for canonical input only — never fed a raw parse warning, only the entries that survived them. A bare `param-name` with no `=` and a `param-name=` with an explicit, empty value both parse to the identical empty-string value (§9 of the URL grammar's own edge rules), and the serializer always re-emits that value as a bare name; a parse→serialize round-trip is therefore byte-exact only when the input already used the canonical bare form for every empty value, not when it used the explicit `k=` form. This feature does not claim "own inverse" unqualified.

A caller that already holds a parse result may pass it to serialize unchanged to reproduce the original URL exactly (Worked example 7.1, below), and a caller that only ever constructs entries programmatically never touches parse at all.

**Entry-carried state — not part of this contract**: a concrete engine's own history contract may let a caller attach an opaque state value to a history entry alongside its path. `NavigationHistory` carries no such member for a caller's own use: `push` and `replace` take a path alone, and the Location shape above carries no field for an engine's or an occupant's own state. This is a stated limitation of the substrate's own contract, not an omission from this description — a replacement engine provider that needs entry-carried state gets it from its own engine's contract, never by reading it back out of `NavigationHistory`. The substrate does record one number of its own on the underlying browser entry — Position, above — housekeeping it needs to keep a consumer's own `length`/`canGoBack` accurate (F8/D3, review round 16-re; §3, Position Tracking): this is substrate bookkeeping, not entry-carried state in the sense this paragraph forbids, and it is the *only* thing this substrate ever writes into the browser's own per-entry state.

**Contract commitment**: by the time any subscriber callback executes for a given round, `NavigationHistory`'s own `location` already reflects the navigation that triggered that round — this holds for both dispatch paths in §3 (Fan-Out Subscription Dispatch) equally, including a history move observed only asynchronously through the underlying browser subscription. A subscriber never observes a round whose notification is stale relative to `location` at the moment its callback runs; this is what lets a callback trust `location` as current without re-reading it defensively, and it is why `go` is deliberately excluded from the substrate's direct-dispatch path (§3) rather than dispatched synchronously at its own call site — a synchronous dispatch would notify a subscriber before the browser's actual post-move `location` was in place, breaking this commitment for exactly that one case.

**Engine-provider port shape** — the field-level schema this feature owns as the normative contract every engine-provider port implementation must satisfy, per `cpt-frontx-adr-contract-schema-ownership` (owned contract role in DESIGN, decision rationale in the ADR, field-level schema here in the owning FEATURE). This schema lives here, in the core package's own tree, because the port is declared by this component (`cpt-frontx-component-routing-navigation-substrate`, `cpt-frontx-routing-fr-engine-provider-port`), not by whichever separately published package implements it — the same reasoning that keeps every other contract shape in this section owned by the declaring side, not the consuming one.

A conforming provider **MUST** accept, as its construction input:
- The navigation substrate's `NavigationHistory` instance (`location`, `subscribe`, `push`, `replace`, `go`) — the same realm-shared instance every other unit reads and writes, never a copy or a wrapper that diverges from it.
- The **entry address** this occupant was mounted at — its own domain key and its own extension, `{domainKey, extension}` — assigned by the enclosing level the moment it mounts the unit in a composed application, or its absence entirely when the unit is served standalone, with no entry address at all. An entry address is uniform across every domain in the tree, at any depth and any occupant count — there is no separate case for a domain holding one occupant against a domain holding several, and no case that withholds an entry address from a nested domain's own occupant (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`).
- The microfrontend's own route tree, carried as an opaque value this feature never inspects and imposes no shape on.

A conforming provider is responsible for producing, from those inputs:
- Its own concrete engine's history-contract object, derived from `NavigationHistory` — deriving whatever members that engine's own contract requires beyond `location`/`subscribe`/`push`/`replace`/`go`, and translating `NavigationHistory`'s own subscriber notification (Subscriber notification shape, above) into whatever shape its own engine's `subscribe` callback expects. This feature names no concrete engine and mandates no particular translation target; it constrains only what a provider receives from the substrate, never how a provider's own engine wants that input reshaped.
- A constructed, mounted router, scoped to the given entry address when one is supplied, reading and writing only that one entry's own payload — never a sibling occupant's entry under the same domain key, and never an entry under another domain key, and never a bare top-level query-string key of its own: a bare key is exactly the flat namespace per-occupant addressing exists to eliminate (`cpt-frontx-routing-fr-per-occupant-addressable-parameters`).

**Subscription and lifecycle obligations.** A conforming provider **MUST** register exactly one `subscribe` callback against `NavigationHistory` per router it constructs — never more than one for the same router — and **MUST** invoke that subscription's own release when the unit owning that router unmounts, so a torn-down router's callback stops receiving the fan-out. A provider **MUST** originate every location change through `push`, `replace`, or `go` on the shared `NavigationHistory` instance, and **MUST NOT** add a dispatch of its own alongside any of them: `push`/`replace` already dispatch the substrate's fan-out directly and `go` already arrives through the browser's own `popstate` (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`), so a compensating dispatch of the provider's own would deliver one navigation to every subscriber twice. The constructed router **MUST** read the already-current `location` at construction rather than starting from a blank route, so no blank frame appears between mount and first render at any domain (§3.6 of this package's own DESIGN).

**Diagnostic of mismatch**: a provider that cannot accept `NavigationHistory` as-is — for example, one whose own engine's history contract requires a constructor argument this port does not supply — fails at construction rather than at first navigation: it cannot receive the shared history, so the microfrontend's routing does not initialize. This failure is local to the microfrontend that adopted the mismatched provider; it does not reach the substrate, the host, or a sibling microfrontend.

This shape is the port's normative contract, binding on every conforming provider, and is this package's single normative statement of the engine-provider port — no other artifact in this package or in a provider's own package restates it as normative. A provider's own adaptation of it into a concrete engine's history and subscriber-notification shapes is a worked example of satisfying this schema, not a restatement of it — the ecosystem's own default provider records its worked example in its own FEATURE (`cpt-frontx-feature-routing-engine-provider` §1.5), which points back here for the normative form rather than repeating it.

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor and describe the end-to-end flow of a use case. The Navigation Substrate is reached directly whenever a caller needs to read or change the URL without a mounted router in the call path.

### Imperative Navigation Outside The UI Tree

- [x] `p1` - **ID**: `cpt-frontx-flow-routing-navigation-substrate-imperative-navigation`

**Actor**: `cpt-frontx-routing-actor-application-developer`

**Success Scenarios**:
- The caller obtains the one realm-shared navigation-history instance and issues `push`, `replace`, or `go` against it; every other unit in the realm subscribed to the instance observes the resulting `location` change through the fan-out.
- The caller reads `location` directly, without subscribing, to inspect the current URL synchronously.

**Error Scenarios**:
- A caller that constructs its own history instance instead of resolving the realm-shared one observes no change when another unit navigates, and produces no change any other unit observes when it navigates itself — the divergence this feature exists to prevent.

**Steps**:
1. [x] - `p1` - Caller resolves the single navigation-history instance for the current realm (`cpt-frontx-algo-routing-navigation-substrate-singleton-resolution`) - `inst-resolve-instance`
2. [x] - `p1` - **IF** the caller needs to react to future navigation - `inst-branch-subscribe`
   1. [x] - `p1` - Caller registers a listener via `subscribe`, joining the instance's fan-out (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`) - `inst-subscribe`
   2. [x] - `p1` - Caller retains the returned unsubscribe function for later teardown - `inst-retain-unsubscribe`
3. [x] - `p1` - **IF** the caller also needs to act immediately — independently of step 2, and commonly alongside it, since a typical caller both reads or writes the URL once now and subscribes for later changes - `inst-branch-immediate`
   1. [x] - `p1` - Caller reads `location` for the current URL, or calls `push`/`replace`/`go` to change it - `inst-immediate-call`
4. [x] - `p1` - **RETURN** control to the caller; any subscribed listener across the realm is notified through the same fan-out the caller's own call reached - `inst-return`

Which declared extension currently owns an entry the caller reads from `location` is not this flow's own concern: that resolution is the Route Ownership Signal's own public entry point, built on the grammar codec below rather than duplicated here (`cpt-frontx-feature-routing-route-ownership-signal`).

## 3. Processes / Business Logic (CDSL)

Internal system functions that do not interact with actors directly. All six are the building blocks the Route Ownership Signal (`cpt-frontx-feature-routing-route-ownership-signal`) and the Engine Provider (`cpt-frontx-feature-routing-engine-provider`) are built on.

### Realm-Global Singleton Resolution

- [x] `p2` - **ID**: `cpt-frontx-algo-routing-navigation-substrate-singleton-resolution`

**Input**: The calling realm's global object; a well-known key the package reserves on it, carrying the `NavigationHistory` contract's own version (e.g. `__frontx_routing_navigation_history_v1__`).

**Output**: The single navigation-history instance for that realm and that contract version — freshly constructed on the first call for that version, reused on every later call from any independently bundled copy of this package built against the same contract version.

**Steps**:
1. [x] - `p1` - Inspect the realm global for an existing instance stored under this package's version-carrying well-known key - `inst-peek-global`
2. [x] - `p1` - **IF** no instance is present under that key - `inst-if-absent`
   1. [x] - `p1` - Construct the navigation-history instance over the browser's own navigation-history API, registering its one underlying subscription against that API at this same construction moment — not deferred until a first caller subscribes, per `cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch` — so `location` is live from the instant this instance exists, for a reader who never subscribes at all - `inst-construct-instance`
   2. [x] - `p1` - Store the instance on the realm global under the version-carrying well-known key, so the next caller — from this bundle or any other built against the same contract version — finds it already there - `inst-store-global`
3. [x] - `p1` - **ELSE** the instance already present is the one every earlier caller of this contract version in this realm is already holding - `inst-else-present`
4. [x] - `p1` - **RETURN** the realm-global instance - `inst-return-instance`

**Rationale**: A realm-global key, not a module-scoped variable, is what makes the instance reachable across independently bundled copies of this package — each copy is its own module graph and cannot see another copy's module-scoped state, but every copy runs in the same realm and can see the same global. The key carries the `NavigationHistory` contract's own version rather than naming the package alone, so a copy built against an incompatible future or past contract version resolves under its own key and constructs its own instance instead of silently capturing and reusing one whose shape it cannot actually satisfy — trading a same-version sharing guarantee for a per-version instance instead of a single instance quietly used the wrong way (PRD §12 records this as a bounded risk: prevention holds within one contract version, and a cross-version mismatch yields one instance per version, without a detection mechanism of its own). Registering the underlying browser subscription at construction, rather than waiting for a first `subscribe` call, is what keeps `location` from being stale for a caller who only ever reads it (§2 permits reading without subscribing) — a lazily-registered subscription would leave `location` frozen at its construction-time value for exactly the callers who never subscribe. A version-carrying string key, held for the page's own lifetime with no retain/release discipline of its own, is deliberate rather than an omission: the browser's own history is itself page-lifetime by nature, so nothing needs releasing before the page itself goes away; retain/release exists for resources with their own teardown semantics, which a realm-global singleton with no teardown does not have; and a well-known key without the contract's own version folded in would not tell two incompatible copies apart in the first place, which is the entire reason the key carries a version at all.

### Fan-Out Subscription Dispatch

- [x] `p2` - **ID**: `cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`

**Input**: A subscriber callback passed to `subscribe`; the singleton instance's own registry of subscribers; its one underlying subscription against the browser's navigation-history API, registered at instance construction (`cpt-frontx-algo-routing-navigation-substrate-singleton-resolution`), not deferred until a first subscriber arrives; and the instance's own `push` and `replace` calls.

**Output**: The subscriber registered or removed; on a browser navigation-history change — which also covers a `go` call made through this instance, observed asynchronously through this same underlying subscription — *or* on a `push`/`replace` call made through this instance, every subscriber registered at the start of that dispatch round invoked once.

**Steps**:
1. [x] - `p1` - Add the caller's callback to the instance's internal subscriber registry and return an unsubscribe function closed over that registry entry - `inst-add-subscriber`
2. [x] - `p1` - **WHEN** the one underlying browser navigation-history subscription fires — registered at instance construction rather than at a first `subscribe` call, this covers a navigation this instance did not dispatch directly at its own call site: a back/forward step, a `go` call issued through this instance (moving through history raises `popstate` only asynchronously, so `go` is observed here rather than dispatched directly in step 3), a third-party call that moves through existing history entries from outside this instance (e.g. `history.go`), or an observed third-party addition such as a fragment-only navigation — never a third-party `pushState`/`replaceState` call made outside this instance, which raises no event this subscription listens for, produces no notification at all, and so is not observed here or anywhere else in this instance (§1.5, Observed browser events) - `inst-when-underlying-fires`
   1. [x] - `p1` - Dispatch a round (`inst-dispatch-round`) - `inst-underlying-dispatch-round`
3. [x] - `p1` - **WHEN** this instance's own `push` or `replace` is called - `inst-when-own-navigation-call`
   1. [x] - `p1` - Dispatch a round (`inst-dispatch-round`) directly from the call itself, without waiting for or depending on a `popstate` event — a call made through `pushState`/`replaceState` never raises one, so step 2's browser subscription alone would never observe a navigation this instance performed itself; `go` is deliberately excluded from this direct path because, unlike `push`/`replace`, it does eventually raise `popstate`, and dispatching it synchronously here would notify subscribers before `location` reflects the browser's actual post-move state - `inst-own-call-dispatch-round`
4. [x] - `p1` - **Dispatch a round** (`inst-dispatch-round`, invoked by both step 2 and step 3) - `inst-dispatch-round`
   1. [x] - `p1` - Take a snapshot of the callbacks currently in the subscriber registry — this snapshot fixes which callbacks are eligible for this round, never which of them actually get invoked - `inst-snapshot-subscribers`
   2. [x] - `p1` - **FOR EACH** callback in that snapshot, in registration order - `inst-foreach-subscriber`
      1. [x] - `p1` - **IF** that callback is still present in the live subscriber registry at the moment this iteration reaches its slot — i.e., nothing has unsubscribed it since the snapshot was taken - `inst-if-still-live`
         1. [x] - `p1` - **TRY** invoke the callback with this instance's own notification payload for the triggering navigation - `inst-invoke-subscriber`
         2. [x] - `p1` - **CATCH** an error thrown by the callback - `inst-catch-subscriber-error`
            1. [x] - `p1` - Isolate the failing callback's error so it does not stop delivery to the remaining callbacks in the snapshot - `inst-isolate-error`
      2. [x] - `p1` - **ELSE** that callback was unsubscribed after the snapshot was taken but before this iteration reached its slot - `inst-else-unsubscribed-before-turn`
         1. [x] - `p1` - Skip it without invoking it — an unsubscribe always wins over a still-pending, not-yet-invoked slot in this round, even though the snapshot already fixed that slot as eligible - `inst-skip-unsubscribed-slot`
   3. [x] - `p1` - **IF** a callback unsubscribes during this round - `inst-if-unsubscribe-mid-round`
      1. [x] - `p1` - Remove it from the live subscriber registry immediately. The round in progress still finishes iterating the snapshot taken in step 4.1, so removing it mid-round does not corrupt this round's iteration; if the round has not yet reached that callback's own slot, step 4.2's liveness check skips invoking it when the iteration gets there, and if the round already invoked it earlier in this same round, that completed invocation is not undone - `inst-unsubscribe-mid-round-safe`
   4. [x] - `p1` - **IF** a callback triggers a new navigation during this round (reentrant navigation) - `inst-if-reentrant-navigation`
      1. [x] - `p1` - That navigation's own dispatch is deferred to a new, later round rather than folded into the round already in progress - `inst-reentrant-new-round`
5. [x] - `p1` - **WHEN** the caller invokes the returned unsubscribe function - `inst-when-unsubscribe`
   1. [x] - `p1` - Remove the callback from the subscriber registry - `inst-remove-subscriber`

**Rationale**: Exactly one subscription reaches the browser's navigation-history API regardless of how many listeners the realm accumulates, and that subscription lives from instance construction onward rather than from a first `subscribe` call, so every listener's fan-out — and every reader's `location` — traces back to that same single, already-live subscription. Dispatch has two triggers rather than one because the browser's own `popstate` event never fires for a `pushState`/`replaceState` call made through this same instance — without step 3's direct dispatch, this instance's own `push` and `replace` would be invisible to every subscriber, including the very Route Ownership Signal observer that depends on observing them. `go` deliberately stays out of that direct path: it does eventually raise `popstate`, only asynchronously, so folding it into step 3 would notify subscribers with a `location` that does not yet reflect the completed move — step 2's subscription, the same one back/forward relies on, is what observes `go` correctly. The snapshot-and-defer rules in step 4 are what make a listener free to unsubscribe or navigate from inside its own callback without corrupting the round it is currently part of: the snapshot fixes which callbacks are eligible for the round, but a callback's own release always wins over a still-pending, not-yet-invoked slot the snapshot reserved for it — an invocation already completed earlier in the same round is never undone, only one still pending is ever skipped.

### Position Tracking

- [x] `p2` - **ID**: `cpt-frontx-algo-routing-navigation-substrate-position-tracking`

**Input**: This instance's own current position (a running value this algorithm itself owns, initialized per step 1 below); the `path` argument of a `push` or `replace` call made through this instance; the browser's own per-entry state, read and written through the `HistoryAdapter` seam (`getState`, and the `state` argument `pushState`/`replaceState` now also accept).

**Output**: `Location.position` (§1.5) current as of the moment any reader observes it — advanced by `push`, held by `replace`, and restored from the browser's own persisted per-entry state on an externally observed navigation — and, as a side effect, this instance's own position recorded into the browser's own per-entry state under a namespaced key (`@gears-frontx/routing`) on every `push`/`replace` this instance itself issues.

**Steps**:
1. [x] - `p1` - At construction, read this instance's own position back out of the current entry's own browser-persisted state, under this package's own namespaced key, defaulting to `0` when none is present — a cold mount (the page's very first entry, never written by this instance) or a "foreign" entry (one a real back/forward step or a third-party addition landed on, that this instance never itself wrote a position onto); nothing is written back to the browser's own state for this default yet — recorded for real only the first time this instance's own `push` or `replace` runs (step 2) - `inst-cold-mount-default`
2. [x] - `p1` - **WHEN** this instance's own `push` or `replace` is called (§3, Fan-Out Subscription Dispatch, step 3) - `inst-on-own-write`
   1. [x] - `p1` - **IF** the call is `push` — advance this instance's own position by one over its own previous value, and record that new position under this package's own namespaced key on the *new* entry's own state — never carrying the previous entry's own state forward onto it, exactly as a real `pushState` call never does on its own - `inst-advance-on-push`
   2. [x] - `p1` - **ELSE** the call is `replace` — leave this instance's own position exactly as it already is, and record it under this package's own namespaced key merged into whatever raw state the browser already carries on the *current* entry — every other key already present on that entry's own state survives this write untouched - `inst-preserve-on-replace`
3. [x] - `p1` - **WHEN** the one underlying browser navigation-history subscription fires (§3, Fan-Out Subscription Dispatch, step 2) — a back/forward step, a third-party `go`, or an observed third-party addition — read this instance's own position back out of the entry this navigation landed on, under this package's own namespaced key, exactly as step 1 does at construction; when the entry carries none, default to `0` identically to step 1 — a delta is deliberately never applied here, because this is the one case no fixed delta can be attributed reliably (a `forward()`/`go(+n)` may have moved through several entries, or none, or a different router entirely may have moved the shared history) - `inst-restore-on-external-navigation`

**Rationale**: The position of the current entry is recorded as substrate state, not as a per-provider counter, because only the substrate itself sits on both sides of every write *and* every externally observed traversal — a provider-local counter (the defect this algorithm replaces, F8/D3, review round 16-re) can only ever see the writes and traversals its own calls initiated, and drifts the moment a real back/forward gesture, a third-party `history.go`, or a second router sharing the identical shared history moves the stack without going through it. Recording it in the browser's own per-entry state, under a namespaced key merged with whatever else is already there, is what lets a real `popstate` hand it back on step 3 the way a real browser hands back `window.history.state` — the one channel this substrate has for recovering a fact about an entry it did not itself just write. `push` starts the new entry fresh, never inheriting the previous entry's own state, because a real `pushState` call never does either; `replace` merges rather than overwrites outright, because it is rewriting the *current* entry in place and must not destroy a value some other code already stored there. This is substrate bookkeeping, not entry-carried state in the sense `cpt-frontx-constraint-routing-no-engine-leak` forbids (§1.5, "Entry-carried state — not part of this contract") — it is the *only* value this substrate ever writes into the browser's own per-entry state, and no engine or occupant reads or writes through this same channel.

### Grammar Parse

- [x] `p2` - **ID**: `cpt-frontx-algo-routing-navigation-substrate-grammar-parse`

**Input**: A URL string, or the caller's already-split shell subroute, query string, and hash.

**Output**: The shell subroute and the hash, each copied verbatim from the input; an ordered list of entries, each `{domainKey, extension, params}` with `params` itself an ordered list of `{name, value}` pairs; and an ordered list of warnings, each naming the raw entry text it concerns and which rule produced it. Parsing never throws — a malformed entry is dropped and reported, every other entry is kept (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`).

**Steps**:
1. [x] - `p1` - Split the input into the shell subroute (everything before the first `?`), the query string (between `?` and `#`, or the rest of the string if no `#` is present), and the hash (everything from `#` onward, or absent) - `inst-split-url`
2. [x] - `p1` - Copy the shell subroute and the hash into the output unchanged; this package never inspects either one further - `inst-copy-verbatim`
3. [x] - `p1` - **IF** the query string is empty — including a URL whose `?` is present with nothing after it (e.g. `/en?`), which is a present, empty query string, not the absence of one - `inst-if-empty-query`
   1. [x] - `p1` - **RETURN** an empty entry list, no warnings, and the copied shell subroute and hash - `inst-return-empty`
4. [x] - `p1` - Split the query string on `&` into raw entry strings, preserving their left-to-right order - `inst-split-entries`
5. [x] - `p1` - **FOR EACH** raw entry string, in order - `inst-foreach-raw-entry`
   0. [x] - `p1` - **IF** this raw entry string is empty — produced by two consecutive `&` characters (`a=b&&c=d`) or a trailing `&` at the end of the query string — silently skip it and continue to the next raw entry string: no warning is recorded for an empty raw entry, unlike every other malformed case this algorithm reports - `inst-skip-empty-raw-entry`
   1. [x] - `p1` - Split it on `;` into its head segment and zero or more param segments - `inst-split-on-semicolon`
   2. [x] - `p1` - **IF** the head segment carries no `=`, or the text before that `=` (the candidate domain key) does not conform to the `domain-key` production — an odd count of `.`-separated segments, each segment matching the `name` alphabet — or the text after it (the candidate extension) does not match the `name` alphabet - `inst-if-malformed-head`
      1. [x] - `p1` - Drop this entry, record a warning citing its raw text and "malformed entry", and continue to the next raw entry string - `inst-drop-malformed`
   3. [x] - `p1` - Set `domainKey` and `extension` from the head segment's own two sides of its first `=` - `inst-set-domain-key-extension`
   4. [x] - `p1` - **IF** `extension` already appears in an entry already kept for this same `domainKey` earlier in this same parse - `inst-if-duplicate-extension`
      1. [x] - `p1` - Drop this entry (the first occurrence already kept stands), record a warning citing its raw text and "duplicate extension", and continue to the next raw entry string - `inst-drop-duplicate-extension`
   5. [x] - `p1` - **FOR EACH** param segment, in order - `inst-foreach-param-segment`
      1. [x] - `p1` - **IF** the segment carries no `=`, set that param's `name` to the whole segment, percent-decoded, and its `value` to the empty string - `inst-bare-param`
      2. [x] - `p1` - **ELSE** set `name` and `value` from the segment's own two sides of its first `=`, each percent-decoded once - `inst-keyed-param`
      3. [x] - `p1` - Percent-decoding replaces each `%XX` escape with the byte it encodes and leaves every other character, including a raw `+`, exactly as read — this grammar performs no form-style `+`-to-space decoding; a run of one or more consecutive `%XX` escapes is assembled as a run of raw bytes and decoded together as UTF-8, so a multi-byte character split across consecutive escapes decodes to the one character it encodes, not to several - `inst-decode-once`
      4. [x] - `p1` - **IF** a `%` in this segment is not followed by two hexadecimal digits (a malformed escape, e.g. `%zz` or a trailing `%`), or the bytes a run of `%XX` escapes assembles are not valid UTF-8 - `inst-if-malformed-escape`
         1. [x] - `p1` - Drop the *whole entry* this segment belongs to — not only this one param — record a warning citing the entry's raw text and "malformed entry", and continue to the next raw entry string, abandoning whatever params of this entry were already collected - `inst-drop-entry-malformed-escape`
      5. [x] - `p1` - **IF** a param of this same `name` was already collected earlier in this same entry - `inst-if-duplicate-param`
         1. [x] - `p1` - Overwrite that earlier param's value with this one's, in its original position, and record a warning citing this entry's raw text and "duplicate parameter" - `inst-overwrite-duplicate-param`
      6. [x] - `p1` - **ELSE** append `{name, value}` to this entry's own ordered `params` list - `inst-append-param`
   6. [x] - `p1` - Append `{domainKey, extension, params}` to the output entry list, in this raw entry string's own position - `inst-append-entry`
6. [x] - `p1` - **RETURN** the entry list, the warnings collected, and the copied shell subroute and hash - `inst-return-parsed`

**Rationale**: Malformed-entry, duplicate-extension, and duplicate-parameter are three independent edge rules the grammar deliberately resolves differently — a malformed entry is discarded outright because there is no well-formed fact to keep; a duplicate extension under one domain key keeps the first occurrence because entries are an ordered list a domain reads meaning from; a duplicate parameter name keeps the last occurrence because parameters are a map, the same rule `URLSearchParams` itself would apply if this grammar's own delimiters let it be used at all. Every rule reports a warning rather than throwing, because a consumer resolving an existing, possibly bookmarked URL cannot recover from a thrown parse error the way it can from a dropped or overwritten entry.

### Grammar Serialize

- [x] `p2` - **ID**: `cpt-frontx-algo-routing-navigation-substrate-grammar-serialize`

**Input**: A shell subroute, an ordered entry list of `{domainKey, extension, params}` (`params` itself ordered), and a hash — the identical shape `cpt-frontx-algo-routing-navigation-substrate-grammar-parse` produces.

**Output**: A URL string, or a thrown error naming the offending entry when the input violates a structural invariant this package itself enforces on write.

**Steps**:
1. [x] - `p1` - **FOR EACH** entry in the input list - `inst-foreach-entry-validate`
   1. [x] - `p1` - **IF** `domainKey` does not conform to the `domain-key` production, or `extension` does not match the `name` alphabet - `inst-if-invalid-tokens`
      1. [x] - `p1` - **THROW** an error naming this entry - `inst-throw-invalid-tokens`
   2. [x] - `p1` - **IF** this entry's own `params` list carries two params of the identical `name` - `inst-if-duplicate-param-name`
      1. [x] - `p1` - **THROW** an error naming this entry - `inst-throw-duplicate-param`
   3. [x] - `p1` - **IF** an entry earlier in this same input list already carries the identical `domainKey` and `extension` - `inst-if-duplicate-extension-serialize`
      1. [x] - `p1` - **THROW** an error naming both entries — serializing a duplicate extension under one domain key is an error, never a silent first-wins, because a caller assembling a list to serialize controls the whole list and has no need of the parser's own tolerance for a stray URL it does not control - `inst-throw-duplicate-extension`
2. [x] - `p1` - **FOR EACH** entry, in the input list's own order - `inst-foreach-entry-build`
   1. [x] - `p1` - Start this entry's own text with `domainKey` + `"="` + `extension` - `inst-build-head`
   2. [x] - `p1` - **FOR EACH** param in this entry's own `params`, in order - `inst-foreach-param-build`
      1. [x] - `p1` - Append `";"` + the percent-encoded param name - `inst-append-param-name`
      2. [x] - `p1` - **IF** the param's value is non-empty - `inst-if-nonempty-value`
         1. [x] - `p1` - Append `"="` + the percent-encoded param value - `inst-append-param-value`
      3. [x] - `p1` - **ELSE** append nothing further for this param — a bare name with no `=` is a complete, empty-valued param - `inst-append-bare`
   3. [x] - `p1` - Percent-encode a param name or value by escaping `;`, `=`, `&` as `%3B`, `%3D`, `%26`; `#` as `%23`; `%` as `%25`; `+` and space as `%2B` and `%20`; and every non-ASCII character as its UTF-8 bytes, each percent-escaped; every other character — the `pchar-safe` set — is left raw - `inst-percent-encode`
3. [x] - `p1` - Join the built entry texts with `"&"` - `inst-join-entries`
4. [x] - `p1` - **IF** the input entry list is empty - `inst-if-zero-entries`
   1. [x] - `p1` - **RETURN** the shell subroute alone, followed by the hash if one is present, with no `"?"` at all - `inst-return-bare-subroute`
5. [x] - `p1` - **ELSE** - `inst-else-nonzero-entries`
   1. [x] - `p1` - **RETURN** the shell subroute, `"?"`, the joined entry texts, and the hash if one is present - `inst-return-full-url`

**Rationale**: Serialize enforces at write time exactly the invariants parse tolerates at read time, and for the opposite reason: a caller building an entry list controls every entry in it, so a duplicate extension, a duplicate parameter name, or a malformed token is a programming error to surface immediately rather than a stray input to recover from. The zero-entries case emits no trailing `?` (grammar draft example 7.8) because a bare shell subroute is a valid, fully resolved state — every domain at zero occupants — not a partial or error state calling for a placeholder query string.

### Name Validity And Equality

- [x] `p2` - **ID**: `cpt-frontx-algo-routing-navigation-substrate-name-validity`

**Input**: Either (a) a candidate string to validate as a `name`; (b) a raw `presentation.route` value to normalize into an extension token; or (c) two candidate `name`-alphabet values to compare for equality.

**Output**: (a) a boolean, valid or not; (b) the normalized extension token, or "not routable" when the input carries no route at all or its normalized form is not a valid `name`; (c) a boolean, equal or not.

**Steps**:
1. [x] - `p1` - **Validity (a)**: **RETURN** true only if the candidate is non-empty, its first character is a lowercase letter `a`–`z`, and every remaining character is a lowercase letter, a digit `0`–`9`, or `-`; **RETURN** false otherwise — this rejects `.`, `/`, `;`, `=`, `&`, `#`, any upper-case letter, and any percent-escape, none of which the `name` production admits - `inst-validate-name`
2. [x] - `p1` - **Extension-token derivation (b)**: **IF** the input carries no route at all - `inst-if-no-route`
   1. [x] - `p1` - **RETURN** "not routable" - `inst-return-not-routable-absent`
3. [x] - `p1` - **ELSE** strip exactly one leading `/` from the route value, if present, to produce a candidate - `inst-strip-leading-slash`
   1. [x] - `p1` - **IF** that candidate satisfies Validity (a) - `inst-if-candidate-valid`
      1. [x] - `p1` - **RETURN** the candidate as the extension token - `inst-return-token`
   2. [x] - `p1` - **ELSE** - `inst-else-candidate-invalid`
      1. [x] - `p1` - **RETURN** "not routable" - `inst-return-not-routable-invalid`
4. [x] - `p1` - **Equality (c)**: **RETURN** true only if the two candidates are identical character-by-character; **RETURN** false otherwise — no percent-decoding is applied, because a value satisfying Validity (a) already carries no percent-escape to decode - `inst-name-equality`

**Rationale**: All three operations share one alphabet rule, published together because every caller of one is a caller a domain-key or extension-token decision already reaches: observer creation and the URL back-projection helper validate a consumer-supplied token synchronously with (a); a domain's own consumer derives its own registered extensions from `presentation.route` with (b) before ever handing them to an observer; and a domain's own consumer checks two candidate extension tokens for a same-token conflict at registration time with (c), using the identical rule the parser applies when deciding whether a later entry's extension duplicates an earlier one (`cpt-frontx-routing-adr-occupant-reference-boundary`; PRD §11).

### Domain-Key Composition

- [x] `p2` - **ID**: `cpt-frontx-algo-routing-navigation-substrate-domain-key-compose`

**Input**: The enclosing entry's own `domainKey`; the enclosing entry's own `extension`; the nested domain's own locally-chosen `name`.

**Output**: The composed domain key for the nested domain, or a thrown error naming which of the three inputs — the enclosing `domainKey`, the enclosing `extension`, or the nested domain's own `name` — failed validity.

**Steps**:
1. [x] - `p1` - **IF** the given `domainKey` does not conform to the `domain-key` production — an odd count of `.`-separated segments, each segment satisfying the name-validity check (`cpt-frontx-algo-routing-navigation-substrate-name-validity`, Validity) - `inst-if-invalid-parent-key`
   1. [x] - `p1` - **THROW** an error naming `domainKey` as invalid - `inst-throw-invalid-parent-key`
2. [x] - `p1` - **IF** the given `extension` does not satisfy the name-validity check - `inst-if-invalid-parent-extension`
   1. [x] - `p1` - **THROW** an error naming `extension` as invalid - `inst-throw-invalid-parent-extension`
3. [x] - `p1` - **IF** `name` does not satisfy the name-validity check - `inst-if-invalid-name`
   1. [x] - `p1` - **THROW** an error naming `name` as invalid - `inst-throw-invalid-name`
4. [x] - `p1` - **RETURN** `domainKey` + `"."` + `extension` + `"."` + `name` - `inst-return-composed-key`

**Invariant**: A root domain key has one segment; this function's own output always has the enclosing key's own segment count plus two, so a domain key's segment count is odd at every depth by induction — a root key is one segment, and every composition step adds exactly two. This is the invariant `cpt-frontx-algo-routing-navigation-substrate-grammar-parse` checks when it rejects a domain key with an even segment count as malformed (Grammar Parse, step 5.2): an even count can only arise from a hand-written or corrupted URL, never from this function's own output.

**Rationale**: The mounting level supplies all three parts rather than this function deriving any of them, because only that level knows the enclosing entry's own domain key and extension at the moment it mounts the occupant whose zone contains the nested domain — this function's own contribution is composing them correctly and rejecting an invalid locally-chosen name before an ill-formed key ever reaches the URL, never discovering any of the three parts itself (§2.3, O2 of the package DESIGN).

## 4. States (CDSL)

### No Feature-Owned State Machine

Not applicable. The Navigation Substrate itself is stateless beyond the realm-global singleton and its subscriber registry (§3) — neither is a state machine with named states and guarded transitions. No feature in this package defines an occupancy or binding state machine: mounting, unmounting, and the lifecycle of which owner currently occupies a placement belong entirely to whichever mount mechanism the consumer already runs, never to this library (`cpt-frontx-routing-principle-publishes-not-orchestrates`; `cpt-frontx-feature-routing-route-ownership-signal` §4).

## 5. Definitions of Done

### Single Realm-Shared History With Fan-Out Subscription And URL Grammar Codec

- [x] `p1` - **ID**: `cpt-frontx-dod-routing-navigation-substrate-shared-history`

The system **MUST** expose exactly one navigation-history instance per realm and per `NavigationHistory` contract version, resolved through a version-carrying realm-global key so that every independently bundled copy of this package built against the same contract version converges on the same instance, **MUST** register that instance's one underlying browser navigation-history subscription at construction rather than deferring it to a first `subscribe` call, **MUST** dispatch its fan-out both on that one underlying subscription — which also observes a `go` call made through this instance, asynchronously, the same way it observes back/forward — and directly from its own `push`/`replace` calls — since neither raises the `popstate` event the underlying subscription listens for — to every listener registered at the start of that dispatch round whose registration still stands at the moment the round reaches it — a listener that unsubscribes after the round's own snapshot was taken but before its own slot is reached is skipped rather than invoked — without letting one listener's error, or a listener that unsubscribes or navigates mid-round, corrupt delivery to the rest, **MUST** record and expose the current entry's own position (`Location.position`, §1.5) as substrate state — advanced by this instance's own `push`, held unchanged by `replace`, and restored from the browser's own persisted per-entry state on an externally observed navigation, defaulting to `0` for a cold mount or an entry this instance never itself recorded a position on (`cpt-frontx-algo-routing-navigation-substrate-position-tracking`) — and **MUST** expose the URL grammar codec: a parser that turns a URL into the shell subroute, the hash, and an ordered entry list — dropping a malformed entry with a warning, keeping the first occurrence of a duplicate extension under one domain key with a warning, and keeping the last value of a duplicate parameter name with a warning, never throwing — and a serializer that is that parser's own inverse for every entry it kept, for canonical input (a round-trip is byte-exact only when the input already used the canonical bare form for an empty parameter value, never for the explicit `k=` form, since the serializer always re-emits a bare name), throwing on a duplicate extension, a duplicate parameter name, or an invalid token, and emitting the bare shell subroute with no trailing `?` for zero entries — together with the name-validity, name-equality, and domain-key-composition functions every domain key and extension token in that grammar is checked against and composed through.

**Implements**:
- `cpt-frontx-flow-routing-navigation-substrate-imperative-navigation`
- `cpt-frontx-algo-routing-navigation-substrate-singleton-resolution`
- `cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`
- `cpt-frontx-algo-routing-navigation-substrate-position-tracking`
- `cpt-frontx-algo-routing-navigation-substrate-grammar-parse`
- `cpt-frontx-algo-routing-navigation-substrate-grammar-serialize`
- `cpt-frontx-algo-routing-navigation-substrate-name-validity`
- `cpt-frontx-algo-routing-navigation-substrate-domain-key-compose`

**Addresses**:
- `cpt-frontx-routing-fr-single-navigation-substrate`
- `cpt-frontx-routing-fr-route-ownership-signal` (the grammar codec this DoD exposes is what that requirement's own entry-resolution step, exposed publicly by `cpt-frontx-feature-routing-route-ownership-signal`, parses its input from and serializes its back-projection into)
- `cpt-frontx-routing-fr-engine-provider-port` (the `NavigationHistory` contract this DoD exposes is exactly what a conforming provider's own construction input accepts, per §1.5's Engine-provider port shape)
- `cpt-frontx-routing-nfr-agnostic-core`
- `cpt-frontx-routing-principle-single-history-authority`
- `cpt-frontx-routing-principle-control-boundary`

**Constraints**: `cpt-frontx-constraint-routing-no-engine-leak`, `cpt-frontx-constraint-routing-no-intra-ecosystem-dependency`

**Touches**:
- Component: `cpt-frontx-component-routing-navigation-substrate`

### Imperative Navigation Surface Outside The UI Tree

- [x] `p1` - **ID**: `cpt-frontx-dod-routing-navigation-substrate-imperative-navigation`

The system **MUST** expose `push`, `replace`, `go`, `location`, and `subscribe` against the realm-shared navigation-history instance for use by a caller with no mounted router in its call path.

**Implements**:
- `cpt-frontx-flow-routing-navigation-substrate-imperative-navigation`

**Addresses**:
- `cpt-frontx-routing-fr-imperative-navigation`

**Touches**:
- Component: `cpt-frontx-component-routing-navigation-substrate`

## 6. Acceptance Criteria

- [x] A single navigation-history instance answers `push`/`replace`/`go`/`location`/`subscribe` for the host and for every independently bundled microfrontend registered in the same realm, resolved by a version-carrying realm-global key rather than a module-scoped singleton; a copy built against an incompatible contract version resolves its own instance under its own key instead of reusing this one.
- [x] The one underlying subscription against the browser's own navigation-history API is registered at instance construction, not deferred until a first `subscribe` call, so `location` is current for a reader who never subscribes at all.
- [x] Exactly one subscription is registered against the browser's own navigation-history API regardless of how many listeners subscribe through this instance; every listener is invoked on every navigation-history change.
- [x] A `push` or `replace` call made through this instance dispatches the same fan-out directly, without depending on a `popstate` event, since a same-instance call never raises one for either. A `go` call made through this instance is not dispatched directly; it is observed through the same underlying browser-history subscription used for back/forward, since a history move raises `popstate` only asynchronously.
- [x] A listener that throws during dispatch does not prevent delivery to the remaining listeners in the same fan-out round.
- [x] A listener that unsubscribes during a dispatch round does not corrupt that round's iteration and receives no further invocation from that round once unsubscribed — the round's snapshot fixes which listeners are eligible for it, but an unsubscribe always wins over a still-pending, not-yet-invoked slot in that same round, without undoing an invocation the round already completed; a listener that triggers a new navigation during a round has that navigation dispatched as a new, later round.
- [x] `push`, `replace`, `go`, `location`, and `subscribe` are usable from a caller with no mounted router in its call path.
- [x] The `NavigationHistory` contract's `location` shape (path, search, hash) and its subscriber-notification shape (a `location` plus a navigation kind distinguishing `push`, `replace`, and a third kind covering both a history move and an observed third-party addition such as fragment navigation) are as specified in §1.5, and are what the Engine Provider's own subscriber-notification translation (`cpt-frontx-feature-routing-engine-provider`) consumes as input.
- [x] By the time any subscriber callback executes for a dispatched round, `NavigationHistory`'s own `location` already reflects the navigation that triggered that round, for both dispatch paths in §3 alike, including a history move observed only asynchronously.
- [x] `Location.position` starts at `0` for a cold mount, advances by one over the previous position on this instance's own `push`, stays unchanged on `replace`, and is restored from the browser's own persisted per-entry state — never a fixed delta — on an externally observed navigation (a real back/forward step, a third-party `go`, a second router sharing the same shared history), defaulting to `0` when that entry carries no position this substrate itself recorded (F8/D3, review round 16-re).
- [x] The Navigation Substrate's own module carries no import of a router engine or a UI-framework rendering primitive.
- [x] Parsing the pictured URL and serializing the resulting entry list, shell subroute, and hash back unchanged reproduces the original URL exactly (round-trip). An implementation **MUST** reproduce this example as one of its own acceptance scenarios:

  ```
  /en?screen=dashboard;orientation=left
     &sheet=tenant-details;tenantId=456
     &sheet=user-contacts;contactId=123;view=active
     &widgets=line-a;range=7d
     &widgets=line-b;range=30d
     &widgets=pie;metric=revenue
  ```

  Written on one line, this is exactly the URL in the address bar; the line breaks are typographic.
- [x] A payload value containing `&`, `=`, and a space round-trips through parse then serialize unchanged, and the occupant reads its own decoded value correctly:

  ```
  /en?sheet=search;q=a%26b%3Dc%20d
  ```

  Parsing this URL yields the param `q` with value `a&b=c d`; serializing that entry list back produces the identical URL text, byte for byte.
- [x] Parsing a query string in which every domain is at zero occupants — an empty query string — and serializing the resulting empty entry list back reproduces the bare shell subroute alone, with no trailing `?`:

  ```
  /en
  ```
- [x] A malformed raw entry — no `=` between a candidate domain key and extension, a token outside the `name` alphabet, or a domain key with an even segment count, e.g. `/en?screen&a.b=x&widgets=line-a;range=7d` — is dropped from the parsed entry list with a warning citing its own raw text; here, `screen` has no `=` at all, and `a.b=x` is its own entry whose candidate domain key `a.b` has an even segment count (two), so both are dropped for that reason, while `widgets=line-a;range=7d` is kept and parsing does not throw.
- [x] A query string carrying the parameter `q` twice within one entry, e.g. `sheet=search;q=first;q=second`, parses to a single `q` param holding `second`, with a warning reporting the duplicate; serializing two params of the identical name within one entry throws rather than silently picking one.
- [x] A query string carrying the extension `line-a` twice under the same domain key, e.g. `widgets=line-a;range=7d&widgets=line-a;range=30d`, parses to one `widgets=line-a;range=7d` entry — the first occurrence — with a warning reporting the duplicate, and the second raw entry dropped; serializing two entries that share both the identical domain key and the identical extension throws rather than writing a duplicate.
