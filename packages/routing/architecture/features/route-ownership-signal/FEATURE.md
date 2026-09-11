# Feature: Route Ownership Signal


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
  - [1.5 Contract Shapes](#15-contract-shapes)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Deep Link Resolves Through The Route Ownership Signal, One Domain At A Time](#deep-link-resolves-through-the-route-ownership-signal-one-domain-at-a-time)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Entry Resolution](#entry-resolution)
  - [Observable Transition Signal](#observable-transition-signal)
  - [Observer Release](#observer-release)
  - [URL Back-Projection Helper Via Own-Key Rewrite](#url-back-projection-helper-via-own-key-rewrite)
- [4. States (CDSL)](#4-states-cdsl)
  - [No Feature-Owned State Machine](#no-feature-owned-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Entry Resolution And Observable Signal](#entry-resolution-and-observable-signal)
  - [Observer Release](#observer-release-1)
  - [URL Back-Projection Helper](#url-back-projection-helper)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-routing-route-ownership-signal`
## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-routing-route-ownership-signal`

### 1.1 Overview

Route Ownership Signal publishes, rather than enforces, small independent facts derived from the URL at one domain, and orchestrates no mounting. It exposes three surfaces, all scoped to a single domain key at a time. First, **entry resolution**: given every entry the current location carries under one domain key and that domain's own set of registered extensions, it names, for each such entry, the route owner its extension token resolves to, or reports the entry as unresolved when no registration matches. Second, an **observer** a consumer creates once per domain — passing that domain's own registered-extensions source as a plain argument, never an injected port, together with the domain key the enclosing level handed it: it subscribes to the navigation substrate's shared history and, on creation and on every subsequent navigation, reports one *transition* — the ordered list of entries currently carrying that domain key, resolved or unresolved, together with a diff against the previous report distinguishing entries added, removed, changed only in payload, reordered, or changed only in resolution status (an entry moving between resolved and unresolved with its own token and payload unchanged) — or no transition at all when the ordered list and its resolutions are unchanged, which is also what a navigation touching only a foreign domain key or the hash produces, since resolution reads only the entries carrying this domain's own key. Creating the observer also returns a release function the consumer calls to stop it. Third, a **URL back-projection helper** a consumer calls when a mount happened for a reason other than navigation: it replaces that one domain's own entries with the caller's given delta — entries added (appended at the end of the full list), removed (leaving no gap), changed only in payload (in place, at their existing position), replaced (an existing entry's own extension token swapped for a new entry at that same position, triggering the same subtree reset a removal of the old token would), or reordered (this domain's own entries taking a new relative order within the set of positions they already occupy, with no reset of their own) — removes every entry anywhere in the URL whose own domain key begins with a removed or replaced extension's domain key extended by that extension and a further path segment (structural reset), and copies everything else — including every entry under the same domain key that the delta does not name — verbatim. None of the three touches mounting, unmounting, a registry of route owners, or a state machine tracking which owner currently occupies a domain — those facts and that occupancy belong entirely to whichever mount mechanism the consumer already runs.

Resolving a URL several domains deep is a wave through the tree of domains, not one event: each domain's own observer resolves and reports independently the moment that domain comes to exist, reading whatever the shared history's `location` already is at that moment, never a value captured earlier. This package holds no registry of domains and publishes no signal asserting that a whole address resolved end to end — it cannot, by construction, since it never sees the tree a consumer's own mount mechanism assembles from each domain's own report. A domain resolving to no entries at all is, for exactly this reason, indistinguishable from "the wave has not reached this domain yet" until that domain's own observer comes to exist and reports.

### 1.2 Purpose

A composed application's routable domains must resolve the same way regardless of how the user arrived at a URL — typing it, reloading it, stepping back or forward through history, or following a link — and that must hold at every domain a composed application actually nests, not only at the outermost one, and at every occupant count a domain's own occupancy strategy admits, not only a single occupant. But the runtime that actually owns domain occupancy — named mount strategies, a cardinality matrix, and a registry of what is currently mounted — is the `mfes` runtime, not this library; the full boundary this draws is owned by `cpt-frontx-routing-principle-publishes-not-orchestrates` (DESIGN §2.1), not repeated here. Route Ownership Signal exists to give any consumer — this ecosystem's own host, built on the `mfes` runtime, or an unrelated one — the same URL-derived facts a domain needs to drive its own reconciliation, at whatever depth and whatever occupant count that domain has, without this package ever holding, orchestrating, or guessing at that reconciliation itself.

**Requirements**: `cpt-frontx-routing-fr-route-ownership-signal`, `cpt-frontx-routing-fr-concurrent-occupant-projection`, `cpt-frontx-routing-fr-per-occupant-addressable-parameters`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-routing-actor-application-developer` | Creates a route-ownership-signal observer for each domain it holds, passing that domain's own registered-extensions source as a plain argument; on each notified transition, mounts, unmounts, or re-parameterizes the named entries through its own mount mechanism (the Binding obligation, §1.4); calls the URL back-projection helper when a mount it initiated was not driven by navigation. |
| `cpt-frontx-routing-actor-microfrontend-developer` | Declares its own extension token, and relies on the consumer's own mount mechanism — driven by this signal — to unmount it when its entry no longer carries that token, and on the URL already being current when its own engine provider reads the entry address at mount. |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Use case**: `cpt-frontx-routing-usecase-deep-link-to-microfrontend-screen`
- **Component**: `cpt-frontx-component-routing-screen-binding`
- **Dependencies**: `cpt-frontx-feature-routing-navigation-substrate` — this feature's entry-resolution primitive matches an entry's own extension token against a domain's own registered extensions using the substrate's own name-equality predicate (`cpt-frontx-algo-routing-navigation-substrate-name-validity`); the ordered entry list it resolves against is exactly what the substrate's own grammar codec parses from, and serializes back into, the URL (`cpt-frontx-algo-routing-navigation-substrate-grammar-parse`, `cpt-frontx-algo-routing-navigation-substrate-grammar-serialize`); the observable signal subscribes to the substrate's shared history and fan-out (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`). None of these substrate algorithms is re-implemented here.

**Boundary note**: This feature holds no registry of route owners, executes no mount or unmount, at any domain, and carries no occupancy model of its own — the full boundary is owned by `cpt-frontx-routing-principle-publishes-not-orchestrates` (DESIGN §2.1), not repeated here. This feature's coupling to whichever mount mechanism the consumer runs is expressed only through the plain-argument registered-extensions source and the observable signal's transitions, per domain, never through an injected port and never through an import of the runtime that owns occupancy.

**Registry grounding**: The registered-extensions source a domain's own consumer supplies (§1.5) has a natural origin this feature does not decree: the runtime's own registry of GTS-typed route-owner declarations. A route owner's own extension token is that declaration's own normalized route-identity value — which concrete field on a registration supplies it is the `mfes` package's own contract (`cpt-frontx-routing-adr-occupant-identity-stability`) — the derivation itself is the navigation substrate's own name-validity primitive (`cpt-frontx-algo-routing-navigation-substrate-name-validity`, Extension-token derivation), not redefined here. Uniqueness of a declared extension token among a domain's own siblings is the consuming domain's own registration-time responsibility (PRD §11; DESIGN §2.3, O3b), exactly as before this grounding note. Which root domain name a host's own glue assigns to a domain it projects is likewise not decided by this feature — a transitional host-side table today, a `route` field on the domain registration targeted for tomorrow (PRD §11) — this feature only resolves against whatever domain key it was handed, never against how that key's own root segment was chosen. That every child microfrontend runs its own registry, unreachable by enumeration from its own parent, is what makes a per-domain registered-extensions source a structural necessity rather than a convenience — no single registry could enumerate every domain's own occupants even if this feature wanted one to.

**Binding obligation**: Two-way agreement between the URL and what is actually mounted is not a guarantee this package makes on its own, at any domain — it is a joint guarantee of this package plus the consumer's own host glue holding that domain. PRD §3.1 records it as a deployment obligation resting on the consumer rather than a library capability, exactly as it records the deployment obligations `cpt-frontx-feature-routing-engine-provider` places on a consumer rather than on that feature itself. This obligation is recursive: whichever consumer holds a domain carries it for that domain, with no lesser or different obligation for a domain several levels deep than for the outermost one, and no lesser or different obligation for a domain admitting several concurrent occupants than for one admitting a single occupant. A consumer that wants the URL and the mounted set to durably agree, at a domain it holds:
1. Creates the observer described in §3 (Observable Transition Signal) for that domain, supplying that domain's own registered-extensions source and the domain key the enclosing level handed it (§2.3, O2 of the package DESIGN).
2. On each notified transition, for every entry the diff reports added, mounts the named route owner through its own mount mechanism; for every entry the diff reports removed, unmounts it; for every entry the diff reports changed only in payload, hands the updated payload to the already-mounted occupant without mounting or unmounting anything; reordering alone implies no mount action of its own. This feature resolves no mount race of its own — a mount driven by this signal races against, and is resolved by, exactly the same mechanism a mount driven by any other trigger already is.
3. Calls the URL back-projection helper (§3, URL Back-Projection Helper Via Own-Key Rewrite) for that domain whenever a mount, unmount, or payload change was initiated by something other than a navigation-driven transition this feature reported, so the URL does not durably disagree with what actually got mounted — this includes every entry the consuming level itself removes or changes for any reason (§2.3, O7 of the package DESIGN): the helper's own subtree removal only reaches entries the caller's own delta actually names as removed.
4. Treats mounting an already-mounted route owner as idempotent. The back-projection helper's own history call (point 6) dispatches the navigation substrate's fan-out exactly like any other navigation (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`), so the observer reports a transition resolving to the very entries the consumer just finished mounting — an echo of the consumer's own back-projection, not a new fact. Without this obligation, that echo would double-mount or re-initialize what the consumer just finished mounting.
5. Does not wait for a transition to conclude a domain has no occupant. Creating the observer against a domain key no entry currently carries reports an initial transition with an empty entry list and an empty diff (§3, Observable Transition Signal) — not the absence of a report — so a consumer that treats an empty entry list as "no occupant" from the moment it creates the observer needs no separate signal for that state.
6. Follows a fixed asymmetry when it itself opens or closes an entry outside a navigation-driven transition: opens with `push` — so a back step closes what was just opened, matching the ordinary expectation that back undoes the last thing the user's own action caused — and closes with `replace` — so a back step after closing does not resurrect an entry the consumer just finished dismissing. A switch — the delta's `replaced` operation, swapping one extension token for another at the same position — extends the open convention: it too opens with `push`, so a back step returns to the entry it replaced, exactly as it would for any other newly opened entry. The helper accepts this choice as an explicit flag rather than fixing it itself (§3): this asymmetry is a recommended convention this obligation records, not a rule the helper enforces on every call.
7. Applies the "same domain, same entries → no transition" rule within its own domain key only: a change to an entry under a foreign domain key, or to the hash, is not itself a transition, because resolution reads only the entries carrying this domain's own key.

Two further obligations apply once more than one domain, or more than one occupant per domain, is in play:
- A domain key with no observer currently reading it is inert — not an error, not a fallback state, and indistinguishable from a domain whose own wave has not yet reached it. Because the back-projection helper resets a removed or changed extension's own subtree rather than carrying it forward by default (§3), an orphaned subtree is minimized rather than eliminated; an entry that does survive resolves correctly the moment a domain that reads it comes to exist, because every observer always reads the URL's current, live state, never a value captured earlier.
- Several domains wave independently: one domain's own transition and a sibling or nested domain's own transition carry no ordering guarantee relative to each other; a consumer that needs one to wait for the other coordinates that itself.
- A domain's own key is handed to it by its enclosing level at creation, and that same enclosing level owns re-handing it: this feature's own observer never updates a domain key in place (§3, Observable Transition Signal — Key-mismatch note). When the enclosing entry a nested domain's own composite key was composed from changes its own extension token, the enclosing level's own consumer completes releasing the observer holding the stale key before creating the fresh one carrying the new value — never creating the successor while the stale observer's own subscription is still live, since having both alive at once in the same round would let the enclosing level receive contradicting reports from each. This is release and recreate, in that order, never a protocol for updating the key of an observer still running, because a domain key is immutable by construction for the lifetime of the observer it was handed to (DESIGN §2.3, O4).
- Unmounting the occupant that owns a zone releases every observer this feature created for a domain nested within that zone, through the same consumer glue that created them — nested first, outermost last, or in whatever order that glue already tears down the zone's own contents. An observer left running past its own zone's unmount continues resolving and reporting against a domain key and a registered-extensions source whose owning zone no longer exists, reporting to a consumer that itself no longer has anything meaningful to do with the report.

Without this recipe running in the consumer's own host glue, at every domain it holds, the primitive, the signal, and the helper this feature publishes describe facts, not a maintained agreement — the two-way agreement is the combination's guarantee, not this package's alone.

**Multiplicity note**: More than one observer may exist in the same realm at once — one per domain a consumer holds, never more, regardless of how many occupants that domain's own occupancy strategy admits at once (`cpt-frontx-routing-fr-concurrent-occupant-projection`). A domain holding several concurrent occupants is resolved, observed, and back-projected by the identical one observer and one helper any domain uses; concurrency is a property of how many entries that domain's own ordered list carries, never a reason for a second observer. Each observer is independent, is created with its own registered-extensions source and its own domain key, tracks its own previously reported ordered entry list (§3, Observable Transition Signal), and is released independently (§3, Observer Release). All of them read the one navigation substrate's shared history and fan-out (`cpt-frontx-routing-principle-single-history-authority`), so every observer resolves against the same `location` a given round dispatches, but resolves it against its own domain's own registered extensions and its own domain key's own entries — which is exactly what makes resolving a deep URL a wave rather than one event (§1.1).

### 1.5 Contract Shapes

Field-level shapes for this feature's own inputs and outputs, per `cpt-frontx-adr-contract-schema-ownership` (owned contract role in DESIGN, decision rationale in the ADR, field-level schema in the owning FEATURE).

**Registered-extensions source** (consumer-supplied per domain, passed as a plain argument — never an injected port):
- A readable snapshot of the current set of registered extension tokens for that one domain, in the same shape this feature's entry-resolution primitive reads; no extension token appears twice (PRD §11; DESIGN §2.3, O3b).
- Optionally, a way to observe a change to that set, since a domain's own registered-extensions set is not fixed for the realm's lifetime — a microfrontend can be registered or deregistered after the observer has already been created. A consumer whose set never changes after creation may supply a static snapshot with no change notification.
- Declares no cardinality floor: zero registered extensions is legal and simply means every entry under that domain key resolves to unresolved.

**Transition** (this feature's own output, delivered to the callback the consumer registers when creating one domain's own observer; never delivered at all when nothing about the ordered entry list or its resolutions changed):
- The domain key this transition concerns.
- **Entries**: the ordered list of every entry the current location carries under this domain key, in the order the grammar codec's own parse preserves — each carrying its own extension token and its own ordered payload params, and each flagged either resolved (a registered extension matches) or unresolved (none does).
- **Diff**, against the previously reported ordered list:
  - *Added* — extension tokens present now that were absent from the previous report.
  - *Removed* — extension tokens present in the previous report that are absent now.
  - *Payload-changed* — extension tokens present in both reports whose ordered payload params differ between them, with the extension token itself unchanged; a payload-only change never appears in *Added*, *Removed*, or as a cause of *Reordered* on its own (§9 of the URL grammar's own edge rules; DESIGN §1.1, Structural reset).
  - *Reordered* — whether the relative order of the extension tokens present in both reports changed, independent of whether any of them also carries a payload change.
  - *Resolution-changed* — extension tokens present in both reports, with the identical token and the identical ordered payload params, whose resolution status (resolved versus unresolved) differs between the two reports — for example a registered-extensions-source change that newly matches, or newly stops matching, an entry's own token. Distinct from *Payload-changed*, which requires the payload itself to differ, and never overlapping with *Added*/*Removed*, since a *Resolution-changed* entry's own token is present in both reports.
  - *Unresolved* — the subset of Entries currently flagged unresolved, listed here so a consumer need not scan Entries to find them; not itself a diff category against the previous report, only a restated subset of the current Entries. An extension token moving into or out of this subset between two reports, with its own token and payload unchanged, is reported as *Resolution-changed* above.
  - A `replaced` back-projection write (§3, URL Back-Projection Helper) is not itself a sixth diff category: it is observed exactly as the old extension token appearing under *Removed* and the new extension token appearing under *Added*, both at the position the write assigned them — the diff stays agnostic to which back-projection operation produced the change it reports.
- No transition is delivered at all — not a further field value, an absence of delivery — when every one of the five diff categories above (*Added*, *Removed*, *Payload-changed*, *Reordered*, *Resolution-changed*) is empty or false relative to the previous report, regardless of whether the current Entries list itself is empty or non-empty; this is what a navigation that changes only a foreign domain key's own entries, or the hash, produces, since resolution reads only the entries carrying this domain's own key.

**Release function** (this feature's own output, returned to the consumer at observer creation, alongside registering its callback): a zero-argument function that, when called, unsubscribes the observer from everything it subscribed to — the navigation substrate's fan-out, and the registered-extensions source's own change notification when the source exposed one (§3, Observer Release). Calling it more than once is a no-op after the first call.

**URL back-projection — input**: the domain key whose own entries the caller wants reflected; a delta describing what changed for a reason other than navigation, naming five kinds of change, each keyed by extension token: an ordered list of entries to **add** (appended at the end of the full list); a list of extension tokens to **remove** (no gap left); a list of `{extension, params}` pairs whose payload changed **in place**, with the extension token itself unchanged — `params` is the entry's entire new ordered parameter list, replacing the one it already carries rather than merging into it (grammar §9 item 18); a caller wishing to keep a parameter that entry already had passes it again; a list of `{oldExtension, entry: {extension, params}}` pairs each **replacing** an existing entry's own extension token with a new entry at that same position, and triggering the same structural reset removing `oldExtension` would trigger, in the same history write; and, optionally, a **reordered** relative order for this domain's own currently-present entries, applied only within the set of positions those entries already occupy, leaving every other domain's own entries untouched and triggering no structural reset of its own. Together with the history verb the caller chooses, `push` or `replace` (§1.4, Binding obligation, point 6). The caller names only what changed; every entry under this domain key the delta does not name, and every entry under every other domain key, is left to the helper's own verbatim copy.

**URL back-projection — output**: one `push` or `replace` call, whichever verb the caller chose, against the shared history, that: writes this domain key's own ordered entry list with the delta's additions appended, the delta's removed extension tokens absent, the delta's payload changes applied in place at their existing position, each replaced extension token swapped for its new entry at that same position, and this domain's own entries reordered as given — within the positions they already occupied — when the delta names a reorder; removes, for every extension token the delta names as removed or replaced, every entry anywhere in the URL whose own domain key begins with this domain key extended by that extension token and a further path segment (structural reset, DESIGN §1.1) — never for an extension token the delta only names in a payload change or in the reorder; and copies every entry this domain key's own delta does not name, and every entry under any other domain key, verbatim. The helper reports nothing back to the caller beyond letting the underlying `push`/`replace` call either succeed or throw whatever the shared history itself throws.

## 2. Actor Flows (CDSL)

### Deep Link Resolves Through The Route Ownership Signal, One Domain At A Time

- [ ] `p1` - **ID**: `cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount`

**Actor**: `cpt-frontx-routing-actor-application-developer`

**Use cases**: `cpt-frontx-routing-usecase-deep-link-to-microfrontend-screen`

**Success Scenarios**:
- A URL naming route owners several domains deep is opened cold, reloaded, or reached by back/forward while none of the extensions along that path are yet mounted; each domain's own observer, as it comes to exist, reports its entries appearing, the consumer's own mount mechanism mounts each one, and once mounted its own engine provider reads the already-current location at start, so the mounted screen and the URL agree without a blank screen in between, at every domain.
- A URL under a domain's own already-mounted entries is opened; that domain's own observer reports a `Payload-changed` and/or `Reordered` diff (or nothing, if neither changed) and the consumer's own mount mechanism takes no mount or unmount action at that domain.

**Error Scenarios**:
- A domain's own entry carries an extension token no registration matches: that domain's own observer reports it as unresolved (an *Unresolved* entry in the transition, and an *Added* entry if it was not present in the previous report) and the consumer holding that domain shows its own fallback for that one entry; this feature takes no fallback action itself, and a domain several steps deeper that has not yet begun to exist is indistinguishable, at any shallower domain, from this same "nothing resolved" case.

**Steps**:
1. [ ] - `p1` - The consumer creates the observer for a domain, passing that domain's own registered-extensions source together with the domain key its enclosing level handed it - `inst-create-observer`
   1. [ ] - `p1` - The observer reads the current location, parses the entries via the grammar codec, and resolves every entry carrying this domain key through the entry resolution primitive (`cpt-frontx-algo-routing-route-ownership-signal-entry-resolution`) - `inst-resolve-entries-at-creation`
   2. [ ] - `p1` - The observer reports an initial transition to the consumer's registered callback: the resolved ordered entry list, with every present extension token reported as `Added` (`cpt-frontx-algo-routing-route-ownership-signal-observe-change`) - `inst-report-initial-transition`
2. [ ] - `p1` - **WHEN** the navigation substrate's fan-out subsequently notifies the observer of a back/forward step or any other navigation after creation (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`) - `inst-notify-navigation`
   1. [ ] - `p1` - The observer re-resolves every entry currently carrying this domain key through the entry resolution primitive - `inst-resolve-entries`
   2. [ ] - `p1` - The observer diffs the newly resolved ordered list against the previously reported one and reports the transition to the consumer's registered callback, or reports nothing if the diff is empty (`cpt-frontx-algo-routing-route-ownership-signal-observe-change`) - `inst-report-transition`
3. [ ] - `p1` - **FOR EACH** extension token the diff reports `Added` - `inst-foreach-added`
   1. [ ] - `p1` - The consumer mounts that route owner through its own mount mechanism (§1.4, Binding obligation) - `inst-consumer-mounts`
   2. [ ] - `p1` - Once mounted, the microfrontend's own engine provider reads the current location from the shared history at start and reads its own entry's own payload, as specified by whichever engine-provider package implements the port - `inst-mfe-reads-location-at-start`
   3. [ ] - `p1` - **IF** the newly mounted route owner's own zone contains a further domain - `inst-if-nested-domain`
      1. [ ] - `p1` - That domain's own consumer creates its own observer, supplying the domain key composed for it (`cpt-frontx-algo-routing-navigation-substrate-domain-key-compose`) and that domain's own registered extensions, repeating from step 1 at that domain - `inst-recurse-nested-domain`
4. [ ] - `p1` - **FOR EACH** extension token the diff reports `Payload-changed` - `inst-foreach-payload-changed`
   1. [ ] - `p1` - The consumer takes no mount or unmount action; the already-mounted microfrontend reads its own entry's own updated payload through its own routing table - `inst-no-mount-action-payload`
5. [ ] - `p1` - **FOR EACH** extension token the diff reports `Removed` - `inst-foreach-removed`
   1. [ ] - `p1` - The consumer's own mount mechanism unmounts that route owner; this feature takes no unmounting action itself - `inst-consumer-unmounts`
6. [ ] - `p1` - **IF** the resolved ordered entry list carries an entry flagged unresolved - `inst-if-unresolved`
   1. [ ] - `p1` - The consumer's own fallback is shown for that one entry; this feature takes no fallback action itself - `inst-consumer-fallback`

**Postconditions**:
- Each domain's own mounted set and the entries it resolved agree without a blank screen, because a freshly mounted router reads the already-current location rather than starting from a blank route, and because that domain's own consumer acted on the transition this feature reported — independently at every domain, with no event asserting that every domain resolved together.

## 3. Processes / Business Logic (CDSL)

### Entry Resolution

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-route-ownership-signal-entry-resolution`

**Input**: A domain key; the ordered list of entries the grammar codec's own parse produced (`cpt-frontx-algo-routing-navigation-substrate-grammar-parse`), each carrying its own `domainKey`, `extension`, and ordered `params`; that domain's own registered-extensions source, supplied by the caller as a plain argument.

**Output**: The ordered subsequence of the input entry list whose own `domainKey` equals the given one, each entry paired with a resolution: the route owner its `extension` names, when that token matches a registration in the given registered-extensions source, or "unresolved" when it matches none.

**Steps**:
1. [ ] - `p1` - Filter the input entry list to the ordered subsequence whose own `domainKey` equals the given domain key, preserving the parse's own left-to-right order - `inst-filter-by-domain-key`
2. [ ] - `p1` - **FOR EACH** entry in that subsequence, in order - `inst-foreach-filtered-entry`
   1. [ ] - `p1` - **IF** the entry's own `extension` matches an extension token in the given registered-extensions source, using the navigation substrate's own name-equality predicate (`cpt-frontx-algo-routing-navigation-substrate-name-validity`) - `inst-if-extension-matches`
      1. [ ] - `p1` - Pair the entry with the matching registration's own route owner - `inst-pair-resolved`
   2. [ ] - `p1` - **ELSE** no registration matches - `inst-else-no-match`
      1. [ ] - `p1` - Pair the entry with "unresolved" - `inst-pair-unresolved`
3. [ ] - `p1` - **RETURN** the ordered list of `{entry, resolution}` pairs - `inst-return-resolution`

**Rationale**: This algorithm is a thin filter-and-match over the substrate's own grammar codec and name-equality predicate, called once per domain; it defines no parsing or matching rule of its own, so a change to either — the codec's own parse rules, or the name-equality comparison — is a change to the navigation substrate's own algorithms alone (`cpt-frontx-feature-routing-navigation-substrate` §3), never to this one. Resolving to "unresolved" rather than dropping an unmatched entry is what lets a domain's own consumer report a fallback for it, and what lets a later registration change resolve it without the entry ever having left the URL (§1.1; DESIGN §1.1, Structural reset).

### Observable Transition Signal

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-route-ownership-signal-observe-change`

**Input**: A domain's own registered-extensions source, passed as a plain argument at creation (never an injected port); the domain key its enclosing level handed it at that same moment; a callback the consumer registers to receive a transition; the navigation substrate's shared history and its fan-out subscription; the observer's own internally tracked previously reported ordered entry list, updated after every resolution this algorithm performs.

**Output**: An observer subscribed to the navigation substrate's fan-out, plus a release function returned to the consumer at creation (`cpt-frontx-algo-routing-route-ownership-signal-release`); on creation, and on every subsequent navigation that changes something about this domain key's own entries, one call to the consumer's callback carrying a transition (§1.5, Transition); no call at all when nothing did.

**Steps**:
1. [ ] - `p1` - **WHEN** the consumer creates the observer, passing that domain's own registered-extensions source and the domain key it was handed, and registering its callback - `inst-when-create`
   1. [ ] - `p1` - Validate the given domain key against the navigation substrate's own `domain-key` production — an odd count of `.`-separated segments, each segment satisfying the name-validity check, exactly as `cpt-frontx-algo-routing-navigation-substrate-domain-key-compose` step 1 validates a parent key — and validate every extension token the given registered-extensions source declares against the name-validity check alone (`cpt-frontx-algo-routing-navigation-substrate-name-validity`) — synchronously, before any resolution runs — and **THROW** a clear error naming the first offending value if any fails; only once this validation passes, read the current location, parse it via the grammar codec, and resolve the entries carrying this domain key through the entry resolution primitive (`cpt-frontx-algo-routing-route-ownership-signal-entry-resolution`) - `inst-initial-resolve`
   2. [ ] - `p1` - Report an initial transition whose Entries are the just-resolved ordered list and whose diff reports every present extension token as `Added` (and as `Unresolved` too, for any entry paired with "unresolved") - `inst-initial-report`
   3. [ ] - `p1` - Record the just-resolved ordered entry list as the observer's previously reported state - `inst-record-initial-state`
   4. [ ] - `p1` - Subscribe to the navigation substrate's fan-out (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`) - `inst-subscribe-fanout`
   5. [ ] - `p1` - **IF** the registered-extensions source exposes a change notification (§1.5) - `inst-if-source-has-notification`
      1. [ ] - `p1` - Subscribe to it as well - `inst-subscribe-extensions-source`
   6. [ ] - `p1` - **RETURN** the release function (`cpt-frontx-algo-routing-route-ownership-signal-release`) to the consumer, closed over the subscription(s) registered in steps 1.4 and 1.5 - `inst-return-release`
2. [ ] - `p1` - **WHEN** the navigation substrate's fan-out notifies the observer of a navigation - `inst-when-navigation`
   1. [ ] - `p1` - Read the current location, parse it via the grammar codec, and resolve the entries currently carrying this domain key through the entry resolution primitive, reading the consumer's own registered-extensions source at this same moment - `inst-resolve-current`
   2. [ ] - `p1` - Compute the diff between the newly resolved ordered list and the previously reported one: extension tokens present now but not before are `Added`; present before but not now are `Removed`; present in both with different ordered payload params are `Payload-changed`; whether the relative order of tokens present in both changed at all is `Reordered`; present in both with the identical payload params but a resolution status (resolved versus unresolved) that differs from the previous report are `Resolution-changed`; entries currently paired with "unresolved" are also listed under `Unresolved`, restating a subset of the just-resolved Entries rather than computing a sixth diff category - `inst-compute-diff`
   3. [ ] - `p1` - **IF** every one of `Added`, `Removed`, `Payload-changed`, `Reordered`, and `Resolution-changed` is empty or false — regardless of whether the just-resolved Entries list itself is empty or non-empty - `inst-if-diff-empty`
      1. [ ] - `p1` - Report no transition — nothing about this domain key's own entries changed; this is, in particular, what a navigation that changes only a foreign domain key's own entries, or the hash, produces, since resolution reads only the entries carrying this domain's own key - `inst-no-report-unchanged`
   4. [ ] - `p1` - **ELSE** - `inst-else-diff-nonempty`
      1. [ ] - `p1` - Report a transition carrying the newly resolved Entries and the computed diff - `inst-report-transition`
   5. [ ] - `p1` - Record the newly resolved ordered entry list as the observer's new previously reported state, regardless of whether step 2.3 or 2.4 ran - `inst-record-navigation-state`
3. [ ] - `p1` - **WHEN** the registered-extensions source's own change notification fires, for a source that exposes one (§1.5) - `inst-when-extensions-source-changes`
   1. [ ] - `p1` - Validate every extension token the source's now-current set declares against the navigation substrate's own name-validity check (`cpt-frontx-algo-routing-navigation-substrate-name-validity`) — synchronously, before any re-resolution runs — and **THROW** the same clear error naming the first offending value that observer creation would throw, if any fails - `inst-validate-extensions-source-change`
   2. [ ] - `p1` - Re-run steps 2.1 through 2.5 against the current entries and the source's now-current registered extensions, exactly as if a navigation had occurred — a registration or deregistration can change which entries resolve, or which entries are unresolved, without the URL itself moving - `inst-reresolve-on-source-change`

**Key-mismatch note**: A domain's own key is fixed at this observer's own creation (§1.4, Binding obligation) and neither step 1 nor step 2 ever updates it in place. If no entry in the current location carries that key at all, steps 1.1 and 2.1 resolve an empty ordered list — not a fault condition, but the ordinary outcome for a domain key nothing currently addresses, reported (or diffed) exactly like any other resolution. This is what happens, in particular, when the enclosing entry a nested domain's own composite key was composed from changes its own extension token: the domain key this observer holds becomes obsolete, this observer honestly reports its own entries emptying out (typically every previously present token appearing under `Removed`), and it relies on its own enclosing level's consumer to release it and create its replacement carrying the newly composed key (§1.4, Binding obligation) — this algorithm itself has no mechanism, and no need for one, to detect that its own domain key has gone stale.

**Rationale**: Reporting the whole ordered entry list, not only what changed, is what lets a consumer render a domain's own current occupancy directly from one transition without reconstructing it from a sequence of diffs; carrying the diff alongside it is what lets that same consumer act only on what actually changed, at whatever occupant count the domain admits (`cpt-frontx-routing-fr-concurrent-occupant-projection`). Separating `Payload-changed` from `Added`/`Removed` is what keeps a domain from double-mounting an occupant whose parameters merely moved — the very case the URL grammar's own structural-reset rule treats as never resetting a nested subtree (§9 of the URL grammar; DESIGN §1.1, Structural reset) — and separating `Reordered` from both is what lets a domain that assigns meaning to entry order (a stack of sheets, a widget layout) react to a pure reorder without mistaking it for an occupancy change. Separating `Resolution-changed` from all three is what keeps a registration-set change that leaves an entry's own token and payload untouched — a route owner registering or deregistering — from going unreported entirely: without its own diff category, an entry moving between resolved and unresolved with nothing else about it changing would satisfy none of `Added`/`Removed`/`Payload-changed`/`Reordered`, and this observer would silently fire no transition on every such fan-out round even though a consumer showing a fallback for that one entry needs to know. Filtering out an empty diff is the one case this algorithm treats as not worth reporting: nothing about this domain's own occupancy, payload, order, or resolution status could have changed when every diff category is empty. Reporting an initial transition at creation, rather than only from the first subsequent navigation, is what covers a cold load or a reload — the very case a consumer most needs this signal for — from the first moment the observer exists, even when that initial transition's own Entries list is empty.

### Observer Release

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-route-ownership-signal-release`

**Input**: An observer created by `cpt-frontx-algo-routing-route-ownership-signal-observe-change`, at whichever domain it was created for, and the internal subscription(s) it registered at creation: the navigation substrate's fan-out, and the registered-extensions source's own change notification, when the source exposed one.

**Output**: Every subscription this observer itself registered, unsubscribed; the observer reports no further transitions after this point, including a transition from a fan-out round already in progress at the moment release was called (Round-in-progress note, below).

**Steps**:
1. [ ] - `p1` - **WHEN** the consumer calls the release function returned at observer creation - `inst-when-release-called`
   1. [ ] - `p1` - Unsubscribe from the navigation substrate's fan-out subscription registered at observer creation - `inst-unsubscribe-fanout`
   2. [ ] - `p1` - **IF** the observer also subscribed to the registered-extensions source's own change notification at creation - `inst-if-subscribed-extensions-source`
      1. [ ] - `p1` - Unsubscribe from that subscription as well - `inst-unsubscribe-extensions-source`
   3. [ ] - `p1` - **IF** the release function is called again after the first call - `inst-if-called-again`
      1. [ ] - `p1` - Treat the call as a no-op — nothing is subscribed to unsubscribe from a second time - `inst-release-idempotent`
2. [ ] - `p1` - **RETURN** - `inst-return-release-done`

**Round-in-progress note**: The navigation substrate's own fan-out dispatch fixes a round's composition from a snapshot taken when the round starts, but always skips a callback no longer present in the live subscriber registry by the time the round's own iteration reaches its slot (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`) — a callback's own release always wins over a still-pending, not-yet-invoked slot a round's snapshot reserved for it. Calling this observer's own release function removes its callback from that live registry immediately (step 1.1), so if a fan-out round is already in progress at that moment and this observer's own callback is part of that round's snapshot but has not yet been invoked, that pending invocation is skipped, not delivered. An invocation of this observer's callback that already completed earlier in the same round, before release was called, is not undone.

**Rationale**: This feature holds no lifecycle notion of its own beyond the subscriptions its own observer registers (§4, No Feature-Owned State Machine), so leaking one is entirely this algorithm's own responsibility to prevent. Releasing both subscriptions this observer itself registered — not only the fan-out one — is what DESIGN §4 already names this feature as the owner of preventing: an observer whose registered-extensions-source subscription outlives it leaks exactly as durably as one whose fan-out subscription does, at whichever domain it was created for. Unsubscribing from the fan-out immediately, in step 1.1, rather than deferring it to some later point, is what makes the Round-in-progress note's guarantee hold: release only ever prevents an invocation still pending in a round already in progress, it never needs to retract one already delivered.

### URL Back-Projection Helper Via Own-Key Rewrite

- [ ] `p2` - **ID**: `cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`

**Input**: A domain key; a delta — an ordered list of entries (`{extension, params}`) to add; a list of extension tokens to remove; a list of `{extension, params}` pairs whose payload changed in place with the extension unchanged; a list of `{oldExtension, entry: {extension, params}}` pairs each replacing an existing entry's own extension token with a new entry at that same position; and, optionally, a new relative order for this domain's own currently-present entries, applied only within the positions those entries already occupy — mounted, unmounted, replaced, reordered, or re-parameterized for a reason other than a navigation-driven transition this feature's observer reported; the history verb the caller chooses, `push` or `replace` (§1.4, Binding obligation, point 6).

**Output**: One `push` or `replace` call, whichever verb the caller supplied, against the shared history, that mutates only this domain key's own entries and the subtree entries named below, leaving every other entry in the URL exactly as it was.

**Steps**:
1. [ ] - `p1` - The consumer calls this helper with the domain key, the delta, and the chosen verb, when its own mount mechanism performed a mount, unmount, or payload change that was not initiated by a navigation-driven transition from the observer (§3, Observable Transition Signal) - `inst-consumer-calls-helper`
   1. [ ] - `p1` - Validate the given domain key against the navigation substrate's own `domain-key` production — an odd count of `.`-separated segments, each segment satisfying the name-validity check, exactly as `cpt-frontx-algo-routing-navigation-substrate-domain-key-compose` step 1 validates a parent key — and validate every extension token named anywhere in the delta (its added list, its removed list, the old and new extension of every replaced pair, and its reordered list, when given) against the name-validity check alone (`cpt-frontx-algo-routing-navigation-substrate-name-validity`) — synchronously, before any parsing runs — and **THROW** a clear error naming the first offending value if any fails - `inst-validate-back-projection-tokens`
2. [ ] - `p1` - Read the current location and parse it via the grammar codec (`cpt-frontx-algo-routing-navigation-substrate-grammar-parse`), preserving the full parsed entry list of every domain key, not only the given one - `inst-parse-current`
3. [ ] - `p1` - Compose this domain key's own new ordered entry list, preserving position: keep every currently parsed entry under this domain key whose own extension is named by neither the delta's removed list nor, as an old extension, the delta's replaced list, in its existing position; apply the delta's payload-changed pairs to the matching entries in place, at their existing position, by replacing each matching entry's own parameter list wholesale with the pair's own `params` — never merging it with the parameter list that entry already carried; replace, at its existing position, each entry the delta's replaced list names by its old extension token with the delta's given new entry for that pair; **IF** the delta names a reorder for this domain, reassign the entries surviving the steps above to the identical set of positions they already occupy among this domain's own entries, in the given new relative order, touching no other domain's own entries and triggering no structural reset of its own; append the delta's added entries, in the order the caller supplied them, at the end - `inst-compose-own-entries`
4. [ ] - `p1` - **FOR EACH** extension token in the delta's removed list, and each old extension token the delta's replaced list names - `inst-foreach-removed-token`
   1. [ ] - `p1` - Remove every entry anywhere in the currently parsed entry list — under any domain key — whose own `domainKey` begins with this domain key extended by that extension token and a further path segment (structural reset, DESIGN §1.1), in the same history write as step 7 - `inst-structural-reset-subtree`
5. [ ] - `p1` - Compose the full entry list to serialize, in one pass over the currently parsed full list rather than as a separate own-key block appended to a foreign-entries block: every currently parsed entry under this domain key that step 3 kept unchanged, applied a payload change to, replaced with a new entry, or reassigned within the reordered positions, retains its own absolute position in the full list, exactly where the currently parsed list already had it — a replaced entry's new extension token occupies the old entry's own position, and a reordered entry occupies whichever of this domain's own positions the given new order assigns it; every entry under every other domain key is copied verbatim at its own existing position, minus whatever step 4 removed; every entry the delta names as added is appended once, in the caller's own given order, at the very end of the full list, after every entry named above. This domain key's own entries are never regrouped into a single contiguous block — an own-key entry that was interleaved among foreign entries in the currently parsed list stays interleaved there in the composed list, at that same position - `inst-compose-full-list`
6. [ ] - `p1` - Serialize the composed entry list, the current shell subroute, and the current hash via the grammar codec (`cpt-frontx-algo-routing-navigation-substrate-grammar-serialize`) - `inst-serialize`
7. [ ] - `p1` - Call the shared history's `push` or `replace` — whichever verb the caller supplied in step 1, never a verb this helper fixes itself — with the serialized URL - `inst-call-history`
8. [ ] - `p1` - **RETURN** - `inst-return-reflected`

**Timing note**: This helper's guarantee — that a call issued eagerly still lands on the browser's own current, post-move entry list — holds for a user's own back/forward step, and for a third-party history move that has already completed by the time this helper is called: in both cases the browser's own location has already settled to its post-move value before any of this library's own code runs, even though this library's own notification of that move still lags asynchronously behind it (`cpt-frontx-algo-routing-navigation-substrate-fanout-dispatch`). It does not hold for a `go` call issued through this same navigation-substrate instance: unlike a user's own gesture or an already-completed third-party move, this instance's own `go` call does not complete synchronously at its own call site — the browser processes the move, and raises the event this library's fan-out observes, only afterward. Calling this helper in the window between this instance's own `go` call and the fan-out's own notification of the move that call produced is therefore not a supported use. A consumer that wants to reflect a mount after issuing its own `go` call instead waits for the transition that call produces (§3, Observable Transition Signal) before calling this helper, exactly as it would for any other navigation-driven mount.

**Rationale**: Reading and re-serializing the full currently parsed entry list, rather than mutating a fragment of the raw URL string directly, is what lets this helper touch only the domain key it was asked to change plus the structural-reset subtree of a token it removed or replaced — every other domain key's own entries pass through step 5 unexamined and unchanged, satisfying the Control boundary (DESIGN §1.1) that keeps this helper from ever reading or editing another domain's own part of the URL beyond the one narrow exception structural reset requires. Restricting subtree removal to the delta's removed list and the old extension of its replaced list, never to its payload-changed list or its reorder, is the grammar's own edge rule (§9; DESIGN §1.1, Structural reset): a payload-only change or a pure reorder of a parent entry leaves every nested entry composed beneath it untouched, because nothing about which extension occupies that entry changed. Giving `replaced` its own operation, rather than expressing a switch as a `removed` plus an `added`, is what keeps the new entry at the old entry's own position instead of at the end of the full list — the very defect that produced the wrong entry order for the structural-reset worked example (§6) before this operation existed; `reordered` needs its own operation for the identical reason, since a domain's own entries taking a new relative order among themselves is not expressible as any combination of the other four without also implying an add, a remove, or a position at the end that was never asked for. Leaving the choice of `push` versus `replace` to the caller, rather than fixing one verb for every call the way an earlier design once did, is what lets the same helper serve both an opening reflection — where a `push` lets a later back step undo exactly what was just opened — and a closing reflection — where a `replace` avoids resurrecting a dismissed entry on a later back step — without this algorithm needing two names for what is otherwise one identical composition (§1.4, Binding obligation, point 6).

## 4. States (CDSL)

### No Feature-Owned State Machine

Not applicable. This feature holds no occupancy or binding lifecycle of its own to model as named states with guarded transitions — an observer's own lifecycle is only "subscribed" or "released" (§3, Observer Release), a lifetime, not an occupancy state machine, at any domain. Occupancy, cardinality, and any state machine tracking which route owner currently occupies a domain belong entirely to whichever mount mechanism the consumer already runs — for this ecosystem's own host, the `mfes` runtime's own mount strategies and registry (`cpt-frontx-adr-extension-domain-occupancy`). Modeling that lifecycle here would duplicate a domain this package does not own and must stay agnostic of (`cpt-frontx-routing-principle-publishes-not-orchestrates`), so no state machine is defined for this feature.

## 5. Definitions of Done

### Entry Resolution And Observable Signal

- [ ] `p1` - **ID**: `cpt-frontx-dod-routing-route-ownership-signal-resolution-and-observation`

The system **MUST** resolve, for one domain key, every entry currently carrying that key against that domain's own registered extensions, naming the matching route owner or reporting the entry unresolved, and **MUST** let a consumer create an observer per domain — passing that domain's own registered-extensions source as a plain argument, never an injected port, together with the domain key it was handed — that reports, on creation and on every subsequent navigation or registered-extensions-source change that changes something about that domain key's own entries, one transition carrying the full ordered entry list and a diff distinguishing entries added, removed, changed only in payload, reordered, or changed only in resolution status, to a callback the consumer registers, while reporting no transition at all when none of those changed — including, in particular, a navigation that changes only a foreign domain key's own entries, or the hash.

**Implements**:
- `cpt-frontx-flow-routing-route-ownership-signal-deep-link-cold-mount`
- `cpt-frontx-algo-routing-route-ownership-signal-entry-resolution`
- `cpt-frontx-algo-routing-route-ownership-signal-observe-change`

**Addresses**:
- `cpt-frontx-routing-fr-route-ownership-signal`
- `cpt-frontx-routing-fr-concurrent-occupant-projection`
- `cpt-frontx-routing-fr-per-occupant-addressable-parameters`
- `cpt-frontx-routing-usecase-deep-link-to-microfrontend-screen`

**Touches**:
- Component: `cpt-frontx-component-routing-screen-binding`

### Observer Release

- [ ] `p1` - **ID**: `cpt-frontx-dod-routing-route-ownership-signal-release`

The system **MUST** return a release function to the consumer when an observer is created, at whichever domain it was created for, and **MUST**, when that function is called, unsubscribe the observer from the navigation substrate's fan-out and from the registered-extensions source's own change notification when the source exposed one, immediately enough that a fan-out round already in progress skips any still-pending, not-yet-invoked delivery to this observer's own callback without undoing one already delivered earlier in that same round, with a call after the first treated as a no-op.

**Implements**:
- `cpt-frontx-algo-routing-route-ownership-signal-release`

**Addresses**:
- `cpt-frontx-routing-fr-route-ownership-signal`

**Touches**:
- Component: `cpt-frontx-component-routing-screen-binding`

### URL Back-Projection Helper

- [ ] `p1` - **ID**: `cpt-frontx-dod-routing-route-ownership-signal-url-back-projection`

The system **MUST** provide a single helper that reflects a mount, unmount, replacement, reorder, or payload change not driven by navigation back into the URL for one domain key: it **MUST** accept a delta of added entries, removed extension tokens, payload-changed entries, replaced entries (an old extension token swapped for a new entry at that old entry's own position), and, optionally, a new relative order for this domain's own currently-present entries confined to the positions they already occupy, together with a history verb the caller chooses; **MUST** compose that domain key's own new ordered entry list from the delta, leaving every entry under that key the delta does not name in its existing position, placing each replaced entry's new extension token at its old entry's own position, and reassigning entries per a given reorder only within the positions this domain's own entries already occupy; **MUST** remove, for every removed or replaced extension token, every entry anywhere in the URL whose own domain key begins with that token's own subtree prefix (structural reset), and **MUST NOT** remove any subtree entry for a token named only in a payload change or in a reorder; and **MUST** leave every entry under every other domain key untouched, issuing exactly one `push` or `replace` call, whichever verb the caller supplied, for the whole composed result.

**Implements**:
- `cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`

**Addresses**:
- `cpt-frontx-routing-fr-route-ownership-signal`

**Touches**:
- Component: `cpt-frontx-component-routing-screen-binding`

## 6. Acceptance Criteria

- [ ] Given every entry currently carrying one domain key and that domain's own set of registered extensions, entry resolution names each entry's own matching route owner or reports it unresolved, using the navigation substrate's own name-equality predicate and never re-implementing it.
- [ ] A consumer creates the observer per domain by passing that domain's own registered-extensions source as a plain argument, never through an injected port, together with the domain key it was handed.
- [ ] On creation, the observer resolves and reports the current ordered entry list for its own domain key before any subsequent navigation occurs, so a cold load or reload is covered from the observer's first moment, not only from the first navigation after it — including when that initial list is empty.
- [ ] On every subsequent navigation that changes something about a domain key's own entries, the observer reports exactly one transition carrying the full ordered entry list and a diff: extension tokens newly present are `Added`, extension tokens no longer present are `Removed`, an extension token present both before and after with different payload params is `Payload-changed`, a change to the relative order of persisting tokens is `Reordered`, an extension token present both before and after with the identical payload params but a resolution status that flipped is `Resolution-changed`, and an entry whose own extension token matches no registration is listed under `Unresolved`, a restated subset of Entries rather than a sixth diff category.
- [ ] No transition is reported when every one of `Added`, `Removed`, `Payload-changed`, `Reordered`, and `Resolution-changed` is empty, regardless of whether the current Entries list itself is empty or non-empty — including a navigation that changes only a foreign domain key's own entries or the hash, because resolution reads only the entries carrying this domain's own key.
- [ ] **Resolution-changed scenario**: a `widgets` domain's own registered extensions stop including `chart-old` after having included it; the entry `widgets=chart-old;range=90d` carries the identical token and the identical payload across both reports, but its resolution status flips from resolved to unresolved. The domain's own observer reports a transition whose diff carries `Resolution-changed: [chart-old]` and empty `Added`/`Removed`/`Payload-changed`/`Reordered`.
- [ ] A payload-only change to an entry is reported as `Payload-changed` alone, never as `Added`/`Removed`, and never causes the back-projection helper to remove that entry's own nested subtree.
- [ ] A change to the registered-extensions source's own declared set re-triggers resolution against the current entries, exactly as a navigation would, when the source exposes a change notification.
- [ ] Creating an observer returns a release function; calling it unsubscribes the observer from the navigation substrate's fan-out and, when the registered-extensions source exposed one, from that source's own change notification, and the observer reports no further transitions afterward — including skipping a still-pending, not-yet-invoked delivery from a fan-out round already in progress at the moment release was called, without undoing one the round already delivered earlier. Calling it again is a no-op.
- [ ] More than one observer may exist in the same realm at once — one per domain a consumer holds, regardless of how many concurrent occupants that domain admits — each independent, each with its own registered-extensions source and its own domain key, each released independently.
- [ ] Resolving a URL several domains deep is a wave of independent per-domain resolutions, not one event: a deeper domain's own observer exists and reports only once its enclosing level's own consumer has mounted the route owner whose zone contains it, this feature publishes no signal asserting that an address resolved end to end, and a domain several steps deeper reporting nothing yet is indistinguishable, at any shallower domain, from that deeper domain's own wave simply not having arrived.
- [ ] The back-projection helper issues exactly one `push` or `replace` call, whichever verb the caller supplied, that writes the given domain key's own delta, removes the subtree entries of every removed extension token only, and leaves every entry under every other domain key, and every entry under this domain key the delta does not name, exactly as it was.
- [ ] A consumer that opens an entry outside a navigation-driven transition passes `push` to the helper, so a back step closes what was opened; a consumer that closes one passes `replace`, so a back step afterward does not reopen it.
- [ ] A consumer's own mount mechanism treats mounting an already-mounted route owner as a no-op, so the transition the back-projection helper's own history call produces — an echo of the consumer's own reflection — does not double-mount or re-initialize it.
- [ ] This feature holds no registry of route owners, executes no mount or unmount itself, at any domain, and defines no occupancy state machine; a consumer that wants the URL and a mounted set to durably agree implements that agreement itself, per the Binding obligation (§1.4), recursively at every domain it holds, on top of the primitive, the signal, and the helper this feature publishes.
- [ ] A domain's occupancy cardinality — how many route owners a domain may hold simultaneously, and how a race between two mounts resolves — is decided entirely by the consumer's own mount mechanism; this feature carries no notion of exclusive versus concurrent occupancy, and resolves no mount race of its own, at any domain.
- [ ] A domain key with no observer currently reading it is inert, not an error and not a fallback state; it is resolved correctly the moment a domain that reads it comes to exist, because every observer reads the URL's current, live state rather than a value captured earlier.
- [ ] A domain's own key is fixed at its observer's own creation and is never updated on a live observer; when the enclosing entry a nested domain's own composite key was composed from changes its own extension token, the observer resolves an empty entry list under its own now-stale key and reports the transition that implies, as ordinary operation rather than an error. The enclosing level that handed the key is the only party that ever replaces it, and only by releasing the observer holding the stale key and creating a new one carrying the updated key — never by updating the key of the observer already running.
- [ ] Unmounting the occupant that owns a zone releases every observer this feature created for a domain nested within that zone, through the same consumer glue that created them, so no observer keeps resolving and reporting against a domain key or a registered-extensions source whose owning zone no longer exists.
- [ ] The console layout worked example resolves and back-projects exactly as pictured:

  ```
  /en?screen=tenants;tenantId=ABC
     &screen.tenants.tabs=contacts
     &modal=create-contact
  ```

  `screen.tenants.tabs` is composite because the tabs domain lives inside the `tenants` extension's zone; `modal` is bare because the console declared it at the root. An implementation **MUST** reproduce this example as one of its own acceptance scenarios.

- [ ] The structural reset worked example resolves exactly as pictured, in both directions:

  ```
  before: /en?screen=tenants;tenantId=ABC&screen.tenants.tabs=contacts&modal=create-contact
  after:  /en?screen=settings&modal=create-contact
  ```

  The `screen` domain's own consumer calls the back-projection helper with `{oldExtension: tenants, entry: {extension: settings, params: []}}` in the delta's replaced list, choosing `push` as the call's own verb; the helper's own single call swaps `screen=tenants;tenantId=ABC` for `screen=settings` at that same position and removes every entry whose own domain key begins with `screen.tenants.` — here, `screen.tenants.tabs=contacts` — while `modal=create-contact` is untouched, because its own domain key does not begin with `screen.tenants.`. Had the consuming level skipped the back-projection call for this change, `screen.tenants.tabs=contacts` would have survived as a stranded, inert entry. An implementation **MUST** reproduce this example as one of its own acceptance scenarios.

- [ ] Nesting under a repeated domain key resolves exactly as pictured:

  ```
  /en?widgets=line-a;range=7d
     &widgets.line-a.legend=right
     &widgets=line-b;range=30d
  ```

  The `widgets.line-a.legend` domain's own observer resolves the one entry addressed to it; `widgets.line-b.legend`, if no consumer ever created an observer for it, is simply a domain key with no live observer — inert, not an error — and `line-b` itself carries no legend entry at all.

- [ ] **Reordered scenario**: a `widgets` domain resolves `widgets=line-a;range=7d` then `widgets=line-b;range=30d`; the consuming level's own back-projection call names a reorder for the `widgets` domain giving the new relative order `[line-b, line-a]`, with neither entry's own payload changed. The helper reassigns the domain's own two entries to the same two positions they already occupied, in that new order, triggering no structural reset; every other domain's own entries are untouched. The domain's own observer reports a transition whose diff carries `Reordered: true` and empty `Added`/`Removed`/`Payload-changed`.
- [ ] **Replaced scenario**: the `screen` domain's own consumer calls the back-projection helper with `{oldExtension: dashboard, entry: {extension: settings, params: []}}` in the delta's replaced list; the helper's single call swaps the entry at `dashboard`'s own position for the new `settings` entry, at that same position, and removes every entry whose own domain key begins with `screen.dashboard.` (structural reset), exactly as a removal of `dashboard` would. The domain's own observer reports the transition as `Removed: [dashboard]` and `Added: [settings]`, both at that position, never as a distinct `Replaced` diff category of its own.
- [ ] **Unresolved scenario**: a `widgets` domain's own registered extensions do not include `chart-old`; an entry `widgets=chart-old;range=90d` resolves with that entry paired with "unresolved," appears in the transition's `Unresolved` list, and is left in place — the consumer holding the domain shows its own fallback for that one entry without this feature removing it.
- [ ] **Inert-key scenario**: a URL carries `screen.tenants.tabs=contacts` while no consumer has yet created an observer for that domain key, because the `tenants` screen has not yet mounted; the entry is neither reported nor treated as an error, and resolves correctly the moment the `tenants` screen's own zone creates that domain's own observer.
- [ ] **Payload-only-change scenario**: the `screen` domain's own consumer changes `screen=dashboard;orientation=left` to `screen=dashboard;orientation=right` and calls the back-projection helper with `dashboard` in the delta's payload-changed list, not its removed list; the helper's own single call updates that one entry's own payload in place and removes no subtree entry — any domain key beginning with `screen.dashboard.` survives untouched, because the extension token `dashboard` itself never changed.
