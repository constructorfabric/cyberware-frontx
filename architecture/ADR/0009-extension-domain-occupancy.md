---
status: accepted
date: 2026-06-05
---

# Extension-Domain Occupancy


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Composable named mount strategies plus a cardinality matrix](#composable-named-mount-strategies-plus-a-cardinality-matrix)
  - [A single configurable strategy with occupancy flags](#a-single-configurable-strategy-with-occupancy-flags)
  - [Free-form per-domain mount handlers, no cardinality enforcement](#free-form-per-domain-mount-handlers-no-cardinality-enforcement)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-extension-domain-occupancy`
## Context and Problem Statement

An extension domain is a governed placement slot into which microfrontends are mounted, and different domains need fundamentally different occupancy semantics: some hold many occupants side by side, some hold at most one with an explicit way to empty the slot, and some hold exactly one that is swapped pre-emptively with no explicit teardown. The runtime must let a domain author pick the occupancy semantics for a domain while guaranteeing the domain's declared lifecycle actions are consistent with the chosen semantics. How should the runtime model occupancy so that a domain author selects a well-defined behavior and the runtime rejects domains whose declared actions are incompatible with that behavior?

## Decision Drivers

* Distinct, well-defined occupancy semantics — many-occupant, zero-or-one, and pre-emptive-single must each be a first-class, named behavior rather than ad hoc per-domain code.
* Author selection at composition time — a domain author selects occupancy when building the domain implementation, keeping placement policy with the domain that owns it.
* Action–behavior consistency — a domain's declared lifecycle actions must match the occupancy behavior it selects, so an unmount-less behavior cannot advertise an unmount action and a many-occupant behavior cannot omit one.
* Fail-at-admission, not at runtime — an inconsistent domain must be rejected when it is registered, not discovered when a user triggers an action.
* Enforceable as a continuous-integration check — the consistency rule must be expressible as an automated invariant, not a convention.
* Substrate neutrality — occupancy semantics must carry no solution-specific domain vocabulary (anchors `cpt-frontx-constraint-mfes-no-layout-domain-values`).

## Considered Options

* **Composable named mount strategies plus a cardinality matrix** — the runtime ships a small set of named strategy classes (a concurrent many-occupant strategy, an optional zero-or-one strategy, and an exclusive pre-emptive-single strategy); a domain author composes the chosen strategy inside the domain implementation factory; at registration the runtime looks up the strategy's required/forbidden action row and rejects a domain whose declared actions do not match.
* **A single configurable strategy with occupancy flags** — one strategy class parameterized by booleans (allow-multiple, allow-explicit-unmount) instead of distinct classes, with the same actions validated against the flag combination.
* **Free-form per-domain mount handlers, no cardinality enforcement** — each domain supplies its own mount/unmount handlers directly, with no shared strategy abstraction and no admission-time check that declared actions match occupancy intent.

## Decision Outcome

Chosen option: **composable named mount strategies plus a cardinality matrix**, because it is the only option that makes each occupancy behavior a first-class, named, reusable unit while guaranteeing — at admission — that a domain's declared actions are consistent with the behavior it selected. The runtime exposes three distinct strategy classes: a concurrent strategy where occupants mount side by side, an optional strategy where mounting displaces a prior occupant and an explicit unmount empties the slot, and an exclusive strategy where mounting pre-emptively evicts any other occupant and no explicit unmount path exists. A domain author composes the chosen strategy inside the domain implementation factory. When the domain is registered, the runtime identifies the strategy and consults a cardinality matrix that defines, per strategy, which lifecycle actions the domain's declaration must include and which it must exclude; a domain whose declared actions do not satisfy that row is rejected at registration. The matrix governs only the named strategies and rejects any unrecognized strategy, keeping the occupancy model closed and well-defined.

### Consequences

* Good, because each occupancy behavior is a named, reusable unit a domain author selects deliberately, rather than re-implemented per domain.
* Good, because an inconsistent domain (for example a pre-emptive-single domain that advertises an explicit unmount, or a many-occupant domain that omits one) is rejected when it is registered, before any user can trigger an inconsistent action.
* Good, because the consistency rule is a deterministic lookup against a fixed matrix, so it is enforceable as an automated invariant.
* Good, because the strategies and matrix carry no solution-specific domain names, keeping placement vocabulary out of the runtime.
* Bad, because the occupancy model is closed: a genuinely new occupancy behavior requires adding a strategy and a matrix row rather than configuring an existing one.
* Bad, because a domain author must understand which strategy implies which required and forbidden actions, so the matrix's rules must be documented and discoverable.

### Confirmation

Architecture review confirms that each shipped strategy is a distinct named class and that the cardinality matrix defines a required/forbidden lifecycle-action row per strategy and rejects unrecognized strategies. An automated check exercises domain registration: a domain composed with each strategy and a matching action declaration is admitted, and a domain whose declaration breaks the strategy's row (a missing required action or a present forbidden action) is rejected at registration time. The grounding mechanism is the strategy set in `packages/screensets/src/mfe/runtime/mount-strategies.ts` and the registration-time matrix check `crossValidateHandlers` in `packages/screensets/src/mfe/runtime/DefaultMfeRegistry.ts`.

## Pros and Cons of the Options

### Composable named mount strategies plus a cardinality matrix

The runtime ships distinct named strategy classes; the domain author composes one; a matrix validates the domain's declared actions against the strategy at registration.

* Good, because occupancy semantics are first-class, named, and reusable.
* Good, because action–behavior consistency is guaranteed at admission rather than at action time.
* Good, because the matrix is a deterministic, automatable invariant.
* Neutral, because it requires a small, fixed catalog of strategies plus a maintained matrix row per strategy.
* Bad, because adding a new occupancy behavior means adding a class and a matrix row rather than flipping a flag.

### A single configurable strategy with occupancy flags

One strategy class parameterized by occupancy flags rather than distinct classes.

* Good, because there is one class to learn and the occupancy space is expressed compactly.
* Neutral, because the same matrix-style action validation can still run against flag combinations.
* Bad, because flag combinations admit nonsensical or untested permutations, weakening the guarantee that every supported behavior is well-defined.
* Bad, because behavior is selected by parameters rather than by a named, self-documenting type, making intent at the call site harder to read.

### Free-form per-domain mount handlers, no cardinality enforcement

Each domain supplies mount/unmount handlers directly with no shared abstraction or admission-time consistency check.

* Good, because it imposes no catalog and lets a domain do anything its author writes.
* Bad, because occupancy behavior is duplicated and inconsistent across domains, with no shared, named guarantee.
* Bad, because an action declaration inconsistent with the intended occupancy is not caught at admission and surfaces only when a user triggers the action.

## More Information

The present concrete instantiation ships three strategy classes — `ConcurrentMountStrategy`, `OptionalMountStrategy`, and `ExclusiveMountStrategy` — in `packages/screensets/src/mfe/runtime/mount-strategies.ts`, composed by a domain inside its `ExtensionDomainImplementationFactory.build(ctx)`. The cardinality matrix is applied by `crossValidateHandlers` in `packages/screensets/src/mfe/runtime/DefaultMfeRegistry.ts`: the concurrent and optional strategies require both a mount and an unmount lifecycle action in the domain's declaration, the exclusive strategy requires a mount action and forbids an explicit unmount action, and any unrecognized strategy is rejected. The specific class names and the present matrix rows are descriptive of the current instantiation and non-binding; the durable decision is the strategy-plus-matrix model.

**Scope of impact.** Applies to how an extension domain's occupancy behavior is selected and how its declared lifecycle actions are validated at registration. It does not decide how an extension's entry is matched for compatibility with a domain (decided in `cpt-frontx-adr-domain-extension-compatibility`), nor how a microfrontend bundle is loaded or isolated (decided in `cpt-frontx-adr-mfe-load-isolation`).

**Review trigger.** Revisit if an extension domain requires an occupancy behavior that none of the named strategies expresses, or if the action–behavior consistency rule needs to vary by domain beyond a fixed per-strategy matrix row.

**URL projection of domain occupancy (present detail, non-binding).** Extension-domain occupancy has a URL projection, and this release's own projection rule carries at most one entry of a domain's own key at a time — zero-or-one, never several at once — regardless of which strategy governs the domain. A domain governed by the exclusive strategy, always holding exactly one occupant with no empty state to represent, is the natural fit for a zone's own axial domain: its occupant's own declared prefix continues the address bar's own pathname, making the pathname an observable reflection of which occupant currently holds the domain. The same exclusive strategy may instead be projected as a parallel axis — legal, and still zero-or-one, with a new occupant's pre-emptive replacement of the value the key already holds mirroring the strategy's own pre-emptive replacement with no explicit unmount — but the axial projection is preferred whenever a domain holds a zone's own sole occupancy, since continuing the pathname needs no dedicated key of its own. A domain governed by the optional strategy may be axial the same way when a zone's own author chooses it as that zone's one axial domain — the pathname simply ends where the domain currently holds no occupant — or may instead be projected as a parallel axis: an unrepeated, optional entry present while the domain holds its one occupant and absent while it holds none. A domain governed by the concurrent strategy — several occupants held side by side at once — is projected: this decision's own prior deferral of concurrent-domain projection is lifted, because the navigation substrate's own addressing decision ([packages/routing/architecture/ADR/0003-domain-occupancy-addressing-granularity.md](../../packages/routing/architecture/ADR/0003-domain-occupancy-addressing-granularity.md)) now supplies a projection mechanism for every domain this decision governs, of any occupant count, with no privileged domain per zone and no single-entry cap. That decision owns the mechanism's own shape; this decision's own role is only to record that the deferral no longer holds. Only one domain within a zone is ever axial; every other domain that zone projects into the URL at all is necessarily a parallel axis, regardless of which of these strategies it runs. Either way, a navigation act is an entry into the same mount mechanism this decision governs, not a second occupancy mechanism running alongside it. The URL is the source of truth for that reflection, and occupancy is its derivative; the reverse mapping — recovering the URL from an occupancy change — applies only when a mount is triggered by something other than navigation. The routing package publishes that reflection as a signal, not as a guarantee it keeps itself: its Route Ownership Signal feature ([packages/routing/architecture/features/route-ownership-signal/FEATURE.md](../../packages/routing/architecture/features/route-ownership-signal/FEATURE.md)) exposes the owner-resolution primitive, an observable owner-change signal, and a URL back-projection helper for either projection, but the binding mechanics — actually mounting or unmounting an occupant in response to that signal, and resolving a race between two mounts — are performed by the host's own glue on top of this decision's mount strategies and registry, not by the routing package. This decision continues to own the mount strategies and the cardinality matrix.

**Checklist applicability.**

* ARCH — applicable and addressed above (a runtime placement decision affecting every extension domain and the microfrontends that occupy it, and hard to reverse once domains depend on the strategy catalog).
* ARCH-ADR-008 (supersession) — Not applicable because this is a new, standalone decision that replaces no prior record.
* SEC — Not applicable because occupancy selection and cardinality validation introduce no secret, credential, authorization, or admission-trust mechanism; arbitrary-code admission and isolation are decided in `cpt-frontx-adr-mfe-load-isolation`.
* PERF — Not applicable because this is a behavior-selection and admission-validation decision, not a runtime-performance decision.
* REL — Not applicable because it governs occupancy semantics and registration validation, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — Not applicable because it shapes internal occupancy semantics, not an external integration contract.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-multi-occupant-domain` — mount strategies are how a domain declares whether it permits multiple occupants, and the cardinality matrix admits or rejects domains accordingly.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the extension-domain occupancy and admission behavior of the MFE Runtime component.
* `cpt-frontx-constraint-mfes-no-layout-domain-values` — the strategies and matrix carry no specific domain values, leaving which domains exist and what they are named to the application.
* `cpt-frontx-principle-agnostic-core` — occupancy semantics are expressed as substrate-level strategies that hold no solution-specific vocabulary.
