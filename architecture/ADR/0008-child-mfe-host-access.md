---
status: accepted
date: 2026-06-05
---

# Child MFE Access to the Host


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Narrow capability bridge delegating to the registry](#narrow-capability-bridge-delegating-to-the-registry)
  - [Direct registry reference](#direct-registry-reference)
  - [Message-passing protocol only](#message-passing-protocol-only)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-child-mfe-host-access`
## Context and Problem Statement

A child microfrontend runs isolated from the host yet must still interact with it: execute actions chains, read and subscribe to shared properties, and register handlers for actions targeted at itself. A child may itself be a host to further-nested microfrontends, so the same bridge relationship recurs at every level of nesting. Handing the child a reference to the host runtime would couple child code to runtime internals and widen the surface a child can reach. What should the host give a child so the child gains exactly the capabilities it needs to participate — and nothing more — while the host retains a matching handle to manage and dispose the child instance, at any nesting depth?

## Decision Drivers

* Minimal capability surface — a child receives only the operations it needs to participate; the runtime's internals stay encapsulated behind that surface.
* Reachability across nesting levels without widening the surface — the same narrow four-capability bridge must remain sufficient no matter how many hosting levels separate a child from the shell; any additional cross-runtime bookkeeping this requires must be internal to the bridge/registry, not a new public method.
* Identity a child can rely on — a child must be able to name itself and the domain it occupies, in the same terms the host routes by, without that identity shifting between mounts or exposing anything about the host's internal lifecycle bookkeeping.
* Stable child-facing contract — the capabilities a child depends on must not change when runtime internals change (anchors `cpt-frontx-interface-mfe-runtime`).
* Delegation, not duplication — bridge operations route to the single runtime authority (the registry and its mediator) rather than re-implementing coordination inside the bridge.
* Symmetric parent handle — the host needs a matching narrow handle to identify a child instance and tear it down deterministically.
* Enforceable boundary — the rule that child code depends only on the capability surface, never on concrete runtime internals, must be expressible as a continuous-integration check.

## Considered Options

* **Narrow capability bridge delegating to the registry** — the child receives an abstract bridge exposing exactly the capability methods it needs (`executeActionsChain`, `subscribeToProperty`, `getProperty`, `registerActionHandler`), each delegating to the registry and its mediator, plus the identity of the extension and the domain it occupies; the host holds a matching narrow parent handle (instance identity plus disposal).
* **Direct registry reference** — the host hands the child a reference to the runtime registry object itself.
* **Message-passing protocol only** — child and host communicate solely through serialized messages over a transport, with no typed capability object given to the child.

## Decision Outcome

Chosen option: **narrow capability bridge delegating to the registry**, because it is the only option that gives a child exactly the participation capabilities it needs while keeping runtime internals encapsulated and the child-facing contract stable. The abstract child bridge exposes only four capability methods — `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler` — each delegating to the registry and its mediator rather than carrying coordination logic of its own, and, so that a child can name itself and its placement when it participates, exactly two readonly identity properties: the identifier of the extension itself and the identifier of the extension domain it is mounted into. Identity is not capability: these two carry no operation, reach nothing the four methods do not already reach, and are the same opaque identifiers the host already routes by, which is why the surface stays narrow with them on it. Both are the participants' own identifiers, fixed for the extension's whole registration lifetime rather than tokens minted per mount, so a child may key its own state by them without tracking mount cycles. The host holds a matching abstract parent handle exposing only the child's instance identity and `dispose()`, giving the host deterministic control over the child's lifecycle; that identity is the extension's own identifier and is likewise stable across every mount, and `dispose()` is permanent teardown at unregistration rather than a per-mount teardown. The bridge thereby exposes only a narrow capability surface, and the concrete implementation's transport and wiring internals — including whether the bridge is currently active — remain encapsulated behind the abstract contract.

The registry's own inbound bridge — the bridge its host extension received when it was mounted — is what lets registration reach beyond the immediate parent–child pair: it is the channel a registry uses both to propagate a forwarding advertisement upward when it admits a domain or extension, and to escalate a chain upward when its own resolution finds no handler (both decided in `cpt-frontx-adr-action-dispatch-and-chaining`). This inbound bridge is registry-internal plumbing, not part of the child-facing capability surface — it does not add a fifth method, and it is never handed to child code. The child-facing bridge therefore remains exactly the four capability methods and the two identity properties regardless of how many nesting levels separate a child from the shell: registration propagation and upward escalation are automatic behavior triggered by domain and extension admission and by unregistration or disposal, requiring no explicit registration call, no additional bridge method, and no action by the microfrontend author. This narrows, rather than widens, the bridge's manual cross-runtime-forwarding responsibility — what would otherwise require an explicit child-domain-registration step on the public surface instead becomes internal registry behavior — so automatic reachability across nesting is compliant with, not in tension with, the minimal-capability-surface driver.

Because the host extension that a nested registry links to may hold its own independently loaded copy of this package (`cpt-frontx-adr-mfe-load-isolation`), the registry cannot identify itself to the parent, nor the parent to it, through any shared class or module state — only the bridge object itself, and a realm-global rendezvous for the moment of adoption, cross that boundary reliably (mechanism decided in `cpt-frontx-adr-action-dispatch-and-chaining`). This is why a nested registry's lifetime is expected to track its host extension's registration: constructed no later than synchronously within that extension's own `mount` call, and holding the link the parent minted for that extension from then on. The link persists across the extension's mount cycles by construction, because the bridge that carries it is the same object at every mount — there is nothing for the parent to re-establish when the extension mounts again, and an unmount deactivates the bridge rather than severing anything. The parent unlinks a registry only in two cases: when a later mount constructs a new registry that adopts the link and thereby supersedes the earlier adopter, and when the extension is permanently unregistered or the parent registry is itself disposed, at which point the link is revoked outright. The parent owns the link; the microfrontend author still owns the registry object, decides when to `dispose()` it, and may reuse it across mount cycles without losing reachability, since nothing about a mount cycle takes the link away.

### Consequences

* Good, because a child depends only on a small, stable capability surface, so runtime internals can change without breaking child code.
* Good, because the bridge exposes only a narrow capability surface; the concrete implementation's transport and wiring internals remain encapsulated.
* Good, because each capability delegates to the single runtime authority, so behavior stays consistent with host-side dispatch and no coordination logic is duplicated in the bridge.
* Good, because the symmetric parent handle gives the host deterministic identity and disposal control over each child instance.
* Bad, because every capability a child may legitimately need must be deliberately added to the abstract surface, so extending child capability is an explicit contract change rather than incidental access.
* Bad, because the delegation indirection means a child cannot reach a runtime capability that the bridge does not expose, even when convenient.
* Good, because reachability across nesting levels is an automatic consequence of admission — already governed by the domain- and extension-admission decisions — rather than a second, separate act a microfrontend author must invoke; admission remains the sole enforceable gate for what becomes reachable, so there is no weaker second gate introduced by nesting.
* Good, because the abstract child-facing bridge contract stays at exactly four capability methods and two identity properties no matter how deep the nesting, since the inbound bridge that carries propagation and escalation is registry-internal and never exposed to child code.
* Good, because the parent owning link revocation, rather than depending on the microfrontend author to dispose their own registry, means a registry that outlives its host extension's registration degrades safely to unlinked rather than leaving stale state in every ancestor.
* Good, because handing the same bridge object to every mount of an extension makes a child's registrations and subscriptions survive a remount by default, so ordinary child code needs no re-registration step and no notion of mount generation.
* Bad, because that same persistence means a child wanting per-mount state must clear it in its own `unmount()` hook; the bridge will not do it, since it cannot know which of the child's registrations are meant to be mount-scoped.
* Bad, because automatic linking still requires the registry to have been constructed inside some mount window at least once — a registry constructed asynchronously after `mount` has already returned, or never inside any mount window at all, is never automatically linked and behaves as a root registry with a logged diagnostic. Reuse across remounts is not affected, since the link the registry adopted stays live across them.

### Confirmation

Architecture review confirms that the abstract child bridge exposes exactly the four capability methods and the two readonly identity properties, that neither identity value changes across the extension's mount cycles, that no member of either abstract surface reports or controls whether the bridge is currently active, and that the abstract parent handle exposes only instance identity and `dispose()`. A continuous-integration check (an import-boundary grep) confirms that child-facing code depends only on the abstract bridge — never on a concrete bridge implementation or on the registry directly — and that each capability method delegates to the registry or its mediator rather than implementing coordination inline.

## Pros and Cons of the Options

### Narrow capability bridge delegating to the registry

The child holds an abstract bridge of exactly the capabilities it needs; each delegates to the registry and mediator. The host holds a matching narrow parent handle.

* Good, because the child-facing surface is minimal and stable while runtime internals stay encapsulated.
* Good, because delegation keeps child-initiated behavior consistent with host-side dispatch.
* Good, because the parent handle gives deterministic lifecycle control.
* Neutral, because it requires an abstract contract on both the child and parent sides plus wiring that injects the delegation callbacks.
* Bad, because extending what a child can do is an explicit contract change.

### Direct registry reference

The host gives the child the registry object directly.

* Good, because the child can reach any runtime capability without a mediating contract.
* Bad, because the child couples to runtime internals, so internal changes ripple into child code and the reachable surface is unbounded.
* Bad, because there is no narrow, enforceable boundary between participation capability and runtime internals.

### Message-passing protocol only

Child and host exchange serialized messages over a transport, with no typed capability object.

* Good, because it imposes a hard process-style boundary and avoids sharing any object across the divide.
* Bad, because every capability must be re-expressed as ad hoc message conventions, losing the typed, discoverable contract a capability object provides.
* Bad, because request/response capabilities like reading a property synchronously become awkward round-trips, complicating ordinary child participation.

## More Information

The present concrete instantiation is the abstract `ChildMfeBridge` (`packages/mfes/src/handler/types.ts`), which exposes `executeActionsChain`, `subscribeToProperty`, `getProperty`, and `registerActionHandler` alongside the readonly `extensionId` and `extDomainId`, holding the GTS identifiers of the extension and of the extension domain it is mounted into; its concrete implementation `ChildMfeBridgeImpl` (`packages/mfes/src/bridge/ChildMfeBridge.ts`) delegates `executeActionsChain` to an injected registry callback and `registerActionHandler` to a mediator-registration callback, while its transport, activity-state, and wiring members — including the explicit `registerChildDomain`/`unregisterChildDomain` entry points a caller reaches only by narrowing to the concrete type — are not part of the abstract surface. The matching abstract `ParentMfeBridge` (`packages/mfes/src/handler/types.ts`) exposes only `instanceId`, carrying that same extension identifier, and `dispose()`. Forwarding of actions to a child's own domains is carried by the mediator's catch-all tier through `ChildDomainForwardingHandler` (`packages/mfes/src/bridge/ChildDomainForwardingHandler.ts`), and the routing that tier participates in — including registration propagation and upward escalation through the registry's own inbound bridge — is decided in `cpt-frontx-adr-action-dispatch-and-chaining`.

**Scope of impact.** Applies to the capability surface a child microfrontend receives and the parent handle the host retains, at any nesting depth. It does not decide how a bundle is loaded or isolated, nor how the mediator routes, propagates, or escalates actions internally (decided in `cpt-frontx-adr-action-dispatch-and-chaining`).

**Review trigger.** Revisit if a child requires a participation capability that cannot be expressed as a delegating method on the bridge, or if the host needs richer lifecycle control than instance identity and disposal.

**Checklist applicability.**

* ARCH — applicable and addressed above (a boundary decision affecting every child microfrontend and the host, and hard to reverse once children depend on the capability surface).
* ARCH-ADR-008 (supersession) — Not applicable because this is a new, standalone decision that supersedes no prior record.
* INT — applicable: the bridge is the child-facing half of the host↔MFE communication contract; its breaking-change policy is governed by `cpt-frontx-interface-mfe-runtime`.
* PERF — Not applicable because this is a surface-shape decision, not a runtime-performance decision.
* SEC — Not applicable because, while the narrow surface constrains what a child can reach, this decision introduces no secret, credential, or authorization mechanism of its own.
* REL — Not applicable because it governs the capability surface, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.
* MAINT — applicable: the decision deliberately trades ease of extension for stability — every capability a child may legitimately need must be added to the abstract surface as an explicit contract change rather than incidental access (noted in Consequences) — and the parent owning link revocation, rather than the microfrontend author's own disposal, keeps a registry that outlives its host extension's registration from leaving stale state in an ancestor, which is a maintainability property that any future change to the bridge or link-ownership rules must not regress.
* TEST — applicable and addressed above: the Confirmation section requires a continuous-integration import-boundary grep confirming child-facing code depends only on the abstract bridge, never on a concrete implementation or the registry directly, and that each capability method delegates rather than implements coordination inline.
* COMPL — Not applicable because this is an internal capability-surface boundary between host and child microfrontend code with no regulated data, personal data, or external audit surface.
* UX — Not applicable because this decision shapes a developer-facing capability contract between runtime code, not an end-user-facing interaction.
* BIZ — Not applicable because this is an internal architecture decision about an API boundary, not a business or product decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-host-communication` — the capability bridge is how a child microfrontend communicates with the host and reacts to host state, through a narrow delegating surface; the requirement is unqualified as to how many hosting levels separate a microfrontend from the host, and its own assumptions already anticipate multiple registry instances coexisting, so the bridge's reachability guarantee holds regardless of nesting depth.
* `cpt-frontx-interface-mfe-runtime` — the child bridge and parent handle are part of the runtime's public surface and are governed by its breaking-change policy.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the parent–child communication boundary of the MFE Runtime component.
* `cpt-frontx-principle-agnostic-core` — the bridge carries only opaque type and property identifiers, holding no type-format knowledge of its own.
