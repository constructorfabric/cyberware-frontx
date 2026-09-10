---
status: accepted
date: 2026-08-27
decision-makers: German Bartenev
---

# Mount Trigger Ownership

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Actions-chains originates every post-boot mount; navigation resolves cold load and replays history restoration](#actions-chains-originates-every-post-boot-mount-navigation-resolves-cold-load-and-replays-history-restoration)
  - [Navigation continues to drive mounting for every post-boot transition](#navigation-continues-to-drive-mounting-for-every-post-boot-transition)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-routing-adr-mount-trigger-ownership`

## Context and Problem Statement

`cpt-frontx-routing-principle-publishes-not-orchestrates` already states that Route Ownership Signal publishes ownership transitions and never orchestrates mounting itself, leaving mounting to whichever mount mechanism already holds the occupancy registry — the `mfes` runtime's mount strategies and `crossValidateHandlers` cardinality matrix (`cpt-frontx-adr-extension-domain-occupancy`). That leaves open a narrower question this record settles: after the application has booted, which channel is allowed to *originate* a mount or unmount not yet represented in any history entry — the URL, through navigation, or the runtime's own actions-chains mediator (`cpt-frontx-adr-action-dispatch-and-chaining`)? That question is distinct from a second, related one this record must also settle: when navigation instead moves the location to a state a history entry already represents — a back/forward step, or any other navigation restoring a previously-projected state — what happens then, given the runtime's own occupancy authority still lives entirely in actions-chains and the cardinality matrix, never in this package? A `NavigationHistory` singleton is realm-global, and its `location`/subscriber notification exposes each subscriber the browser's full current URL — path, search, and hash together, not scoped to any one domain's own slice. If navigation could originate a mount after boot, that visibility would let one runtime's mount react to another runtime's own URL segment, reintroducing cross-runtime coordination through the address bar that PR #585's own review history already flagged once: an earlier revision of this work had a routing feature orchestrate mounting through injected ports, and two review rounds put ten of their seventeen findings against it, because it was modelling domain occupancy the runtime already owns.

## Decision Drivers

* Single-writer occupancy authority (primary) — the runtime's actions-chains mediator, together with `crossValidateHandlers`'s cardinality matrix (`cpt-frontx-adr-extension-domain-occupancy`), already owns exactly one decision channel for "what occupies a placement, and why." If navigation could originate a mount or unmount post-boot, this package's own signal would become a second, competing occupancy-decision channel running alongside that one — precisely what `cpt-frontx-routing-principle-publishes-not-orchestrates` forbids outright. This driver holds regardless of how broadly or narrowly the URL's own visibility is scoped, and it is the real reason for the decision below.
* Publishes, does not orchestrate — the routing package's own design principle (`cpt-frontx-routing-principle-publishes-not-orchestrates`) already forbids this package from holding an occupancy model; whichever channel originates mounting post-boot must not force this package to hold one anyway just to keep the URL and the mounted set honest.
* Cross-runtime isolation despite a realm-global history (secondary) — `NavigationHistory` is one realm-shared singleton (`cpt-frontx-routing-principle-single-history-authority`) whose fan-out and `location` are visible to every subscriber regardless of which runtime it belongs to; no runtime should need to read another runtime's own route segment to react correctly to its own domain's occupancy. This driver is now also structurally addressed by ADR 0003's own domain-key scoping (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`): because a level resolves only the keys whose domain-path is its own, a level no longer depends on navigation's silence to avoid reading another runtime's own segment. It remains a secondary note here, not the primary justification, and it does not touch the single-writer-occupancy driver above.
* Review-proven failure mode — an earlier revision of this same body of work already modelled domain occupancy through navigation-adjacent orchestration and drew ten of seventeen findings across two review rounds for exactly that reason (PR #585 description); the chosen mechanism must not reintroduce that shape.
* Deep-link, reload, and history-restoration correctness — a cold load or reload has no actions-chains history to replay, so the URL must still be authoritative at that one moment, even though it is not the origination channel afterward. A back/forward step, or any navigation that moves the location to a state a history entry already represents, has no new intent to originate either — it restores a state actions-chains itself already authorized, so each affected level must be free to re-resolve and reconcile without that re-resolution being mistaken for a second origination channel.

## Considered Options

* **Actions-chains originates every post-boot mount; navigation resolves cold load and replays history restoration** — originating a mount or unmount not yet represented in any history entry happens exclusively through the actions-chains channel post-boot, never through navigation; every such mount calls the URL back-projection helper afterward, so every reachable history entry's projected state is itself the product of an actions-chains-originated mount. Navigation still resolves the URL at observer creation for the initial/cold load, and it still drives restoration — a back/forward step, or any other navigation reaching a previously-projected state — by causing each affected level to re-resolve and its consumer to reconcile its mounted set against a state actions-chains already authorized. Restoring is not a second origination channel; it is replay of state actions-chains itself produced.
* **Navigation continues to drive mounting for every post-boot transition** — every mount and unmount, cold or not, originating or restoring, is triggered by a navigation event that Route Ownership Signal reports, with the consumer's mount mechanism reacting to that report at every domain level for the application's whole lifetime, with no distinction between originating new intent and restoring already-projected state.

## Decision Outcome

Chosen option: **actions-chains originates every post-boot mount; navigation resolves cold load and replays history restoration**, because it is the only option that keeps the runtime's occupancy authority single-writer while still resolving correctly on cold load, reload, and back/forward. Originating a new mount or unmount intent — one not yet represented in any history entry — happens exclusively through actions-chains post-boot; navigation is never the origin of new intent once the application has booted. Restoring — a back/forward step, or any navigation moving the location to a state a history entry already represents — is a different thing entirely: it causes each affected level to re-resolve and its consumer to reconcile its mounted set, exactly as `cpt-frontx-routing-seq-deep-link-cold-mount`'s own back/forward fan-out already shows ("report transition, if ownership-relevant"), and exactly as DESIGN §4's own worked example already shows ("a back step taken right after opening the modal ... the console's own glue unmounts the modal in response to the modal domain's own reported transition, not through any action of this library's own"). Restoring is not a second occupancy driver alongside actions-chains; it is that same driver's own prior decision, replayed.

The premise that makes this coherent is this record's own existing consequence, unchanged below: every post-boot mount, because it originates only through actions-chains, must call the URL back-projection helper afterward. That consequence's cumulative effect is what closes the loop — every reachable history entry's projected state was itself produced by an actions-chains-originated mount, never by navigation inventing one. Restoring can therefore never surface an occupancy the runtime never authorized in the first place; there is no state a back/forward step can land on whose occupancy actions-chains did not already decide when that state was first projected. This is precisely why the sequence diagram's back/forward fan-out and both DESIGN §4 worked examples' back-step scenarios are consistent with actions-chains being the sole *originating* channel, rather than contradicting it: what they show is restoration, not origination.

One residual case remains, and this record decides it explicitly rather than leaving it open: a post-boot deep link, a hand-edited address bar entry, or a third-party in-tab navigation reaching a projected state no live consumer currently recognizes is not a history-restoration case at all — no history entry authorized that occupancy, because no actions-chains-originated mount ever projected it. A consumer's own reconciliation MAY treat such an unrecognized projected state as an origination request, but only by routing it *through* actions-chains — re-resolving the state, dispatching a mount action for it, and letting that mount's own back-projection call reflect the result — never by mounting directly off the observed navigation signal. This is exactly what this record's own Confirmation clause already implies below ("no consumer wires the post-boot transition report directly to a mount call"): even this residual, origination-shaped case must still cross through actions-chains to become a mount, so it never becomes navigation acting as a second occupancy-decision channel.

Making navigation the post-boot origination channel would mean every mount decision, at every domain level in every runtime, has to originate from the one realm-global `NavigationHistory` fan-out — the same singleton every other runtime's own levels also subscribe to (`cpt-frontx-routing-principle-single-history-authority`) — which is precisely the shape that drew ten of PR #585's own seventeen review findings when an earlier revision tried it through injected ports instead, and which would make this package's own signal a second occupancy-decision channel running alongside the runtime's actions-chains mediator and cardinality matrix (`cpt-frontx-routing-principle-publishes-not-orchestrates`, `cpt-frontx-adr-extension-domain-occupancy`) — the primary reason for this decision. That cross-runtime visibility concern is now also structurally narrowed by ADR 0003's own domain-key scoping (`cpt-frontx-routing-adr-domain-occupancy-addressing-granularity`): because each level resolves only the keys carrying its own domain-path, a level no longer needs navigation's silence alone to avoid reacting to another runtime's own segment. That narrowing is a secondary benefit of ADR 0003, not the reason for this decision, which rests on single-writer occupancy authority regardless of how the URL happens to be scoped.

### Consequences

* Good, because originating a mount or unmount stays single-writer: actions-chains and the cardinality matrix remain the one occupancy-decision channel, with navigation never able to invent an occupancy the runtime did not already authorize.
* Good, because restoring — back/forward, or any navigation reaching a previously-projected state — still works without a second driver: each affected level re-resolves and its consumer reconciles, replaying a decision actions-chains itself already made, exactly as the sequence diagram's back/forward fan-out and both DESIGN §4 worked examples' back-step scenarios already show.
* Good, because cold load and reload still resolve correctly: navigation-driven resolution at observer creation, not post-boot navigation, is what a deep link and a reload actually need.
* Good, because the residual case — a deep link or third-party navigation to a state no live consumer recognizes — has an explicit answer: reconciliation may treat it as an origination request, but only by routing it through actions-chains, never by mounting directly off the navigation signal.
* Neutral, because cross-runtime isolation, this record's original secondary driver, is now also structurally narrowed by ADR 0003's own domain-key scoping — a level need not rely on navigation's silence alone to avoid another runtime's segment — though this does not change what this record itself decides.
* Bad, because three distinct facts now exist for "why is this mounted" — cold-load navigation, post-boot restoration replaying an already-authorized state, and post-boot origination through action chains — and a maintainer must know which applies to a given transition rather than treating navigation as the single uniform driver.
* Bad, because the URL back-projection helper becomes load-bearing for every post-boot origination, not an occasional convenience: every actions-chains-originated mount must call it, or a later restoration would replay a state the address bar never actually reflected.

### Confirmation

Architecture and code review confirm that no consumer wires Route Ownership Signal's post-boot transition report directly to a mount call for a state no history entry already represents; every post-boot origination traces to an actions-chains dispatch instead, with the URL back-projection helper invoked afterward. Restoration is confirmed separately and is not held to that same rule: a consumer's mount mechanism reconciling its mounted set in response to a back/forward-triggered transition report is expected and correct, precisely because that report describes a state actions-chains itself already authorized when the entry was first projected, not a new occupancy decision. Where a transition report describes a projected state no live consumer recognizes — the residual case above — review confirms the consumer's own reconciliation still only reaches a mount by re-dispatching through actions-chains, never by mounting directly off that report. The cold-load path is confirmed by `cpt-frontx-routing-seq-deep-link-cold-mount`, whose own diagram already shows resolution running once at observer creation from an already-current location, and whose own back/forward fan-out ("report transition, if ownership-relevant") is the restoration case this confirmation now names explicitly rather than leaving implicit.

## Pros and Cons of the Options

### Actions-chains originates every post-boot mount; navigation resolves cold load and replays history restoration

Cold load and reload resolve from the URL at observer creation. Every subsequent origination of a mount or unmount not yet represented in any history entry is triggered by the runtime's actions-chains mediator, with the URL back-projection helper reflecting the result afterward. A back/forward step, or any navigation reaching a state a history entry already represents, causes each affected level to re-resolve and its consumer to reconcile — replaying a decision actions-chains itself already authorized, not originating a new one.

* Good, because it keeps occupancy origination single-writer: navigation can restore an already-authorized state but can never invent a new one post-boot.
* Good, because it keeps route resolution's realm-global visibility from becoming a cross-runtime coordination surface for origination post-boot.
* Good, because it does not reintroduce the specific occupancy-modelling shape two prior review rounds already rejected in this same work.
* Good, because restoration — back/forward, or reaching a previously-projected state by any other navigation — still works without inventing a second origination channel, since it is replay of a state actions-chains already produced.
* Neutral, because it requires every consumer to remember to call the back-projection helper after an actions-chains-originated mount, rather than getting URL reflection for free from navigation.
* Bad, because "why is this mounted" now depends on whether the application has finished booting, and, if not, whether the transition is an origination or a restoration — extra facts a maintainer must track.

### Navigation continues to drive mounting for every post-boot transition

Route Ownership Signal's report, at every domain level, is what triggers the consumer's mount mechanism for the application's whole lifetime, cold load included, with no distinction drawn between originating new intent and restoring already-projected state.

* Good, because there is exactly one driver to reason about for the whole lifecycle, with no origination/restoration split.
* Bad, because it makes the URL a de facto cross-runtime control channel: every runtime's mount decision reacts to the one realm-global `NavigationHistory` fan-out every other runtime also subscribes to.
* Bad, because it is the shape an earlier revision of this same work already tried through injected ports, drawing ten of seventeen review findings for modelling domain occupancy the runtime already owns.
* Bad, because it duplicates, inside this package's own consumer wiring, an occupancy-orchestration responsibility `cpt-frontx-routing-principle-publishes-not-orchestrates` already assigns entirely to the runtime.

## More Information

Diagram note: this decision is a single binary comparison — actions-chains as the sole post-boot origination channel against the one rejected alternative of navigation continuing to drive every post-boot mount, origination and restoration alike — matching the shape this repository's own root ADRs already use for a decision of this kind (`cpt-frontx-adr-core-package-boundaries`, `cpt-frontx-adr-extension-domain-occupancy`), both recorded in prose and comparison tables with no diagram. No diagram is included here for the same reason.

**Scope of impact.** Governs which channel is permitted to originate a new mount or unmount intent after the application has booted, and how history restoration (back/forward, or navigation reaching a previously-projected state) is reconciled without becoming a second such channel. It does not decide the mount strategies or cardinality matrix themselves (owned by `cpt-frontx-adr-extension-domain-occupancy`) or the actions-chains dispatch and chaining mechanism itself (owned by `cpt-frontx-adr-action-dispatch-and-chaining`); it decides only that the latter, not navigation, is the post-boot origination channel the former reacts to, and that restoration is replay of that channel's own prior decisions, never a second one.

**Review trigger.** Revisit if a requirement emerges for the residual case above — a deep link, hand-edited address bar entry, or third-party in-tab navigation reaching a projected state no live consumer recognizes — to mount something directly off the observed navigation signal, rather than by routing that reconciliation through an actions-chains dispatch as this record requires; that would require re-admitting navigation as a post-boot origination channel and re-examining the single-writer-occupancy-authority driver this decision otherwise resolves.

**Checklist applicability.**

* ARCH — applicable and addressed above (a coordination-pattern decision affecting every consumer that mounts extensions after boot, already proven hard to get right by two prior review rounds on this same work).
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern.
* PERF — Not applicable because the choice of origination channel is a correctness/coupling decision, not a throughput or latency target.
* REL — Not applicable because it governs coordination shape, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — applicable: this decision fixes which of the ecosystem's two coordination channels (URL vs. actions-chains) a consumer integrates against for post-boot mount origination, and is therefore part of what a consumer must conform to.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: keeping the URL a pure reflection of origination bounds the blast radius of a future occupancy-model change to the runtime's actions-chains mediator, never to this package.

## Traceability

- **PRD**: [../PRD.md](../PRD.md)
- **DESIGN**: [../DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-routing-principle-publishes-not-orchestrates` — this decision is what keeps the routing package from becoming a second occupancy-orchestration channel once actions-chains, not navigation, originates post-boot mounting; restoration and the residual re-dispatch path preserve that same boundary rather than reopening it.
* `cpt-frontx-routing-principle-single-history-authority` — names the realm-global visibility this decision's cross-runtime isolation note depends on, now also narrowed by ADR 0003's own domain-key scoping.
* `cpt-frontx-routing-fr-route-ownership-signal` — the signal this decision restricts to cold-load/reload resolution, to restoration reconciliation, and to reflecting — rather than originating — every post-boot mount.
* `cpt-frontx-routing-seq-deep-link-cold-mount` — the sequence whose cold-load resolution and back/forward fan-out this decision leaves unchanged as, respectively, the one navigation-driven origination path and the one navigation-driven restoration path.
* `cpt-frontx-adr-action-dispatch-and-chaining` — the mechanism this decision names as the sole post-boot mount-origination channel.
* `cpt-frontx-adr-extension-domain-occupancy` — the occupancy model this decision keeps exclusively in the runtime's own mount mechanism, never duplicated by navigation-originated mounting.
* `cpt-frontx-routing-adr-domain-occupancy-addressing-granularity` — cross-referenced as the record whose domain-key scoping now structurally narrows this decision's secondary cross-runtime-isolation driver, without altering this decision's own primary single-writer-occupancy-authority rationale or its outcome.
