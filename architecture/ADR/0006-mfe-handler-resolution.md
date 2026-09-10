---
status: accepted
date: 2026-06-05
---

# MFE Handler Resolution


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Registry-owned resolution by declared base type](#registry-owned-resolution-by-declared-base-type)
  - [Handler self-selection via a `canHandle(entry)` predicate](#handler-self-selection-via-a-canhandleentry-predicate)
  - [Static entry-type-to-handler map](#static-entry-type-to-handler-map)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-mfe-handler-resolution`
## Context and Problem Statement

The MFE Runtime loads microfrontends whose bundles are produced by different build and packaging technologies, so loading itself is technology-specific and must be delegated to an extensible set of loaders ("handlers"). For any given microfrontend entry, exactly one handler must be chosen, and that choice must respect a type hierarchy without the runtime embedding knowledge of any concrete type format. Where should the authority to match an entry to a handler live — inside each handler, or inside the runtime — and how should a handler declare the entries it is able to load?

## Decision Drivers

* Type-agnostic core — the runtime must select a handler without embedding type-format string literals; matching must be expressed through the injected type-system provider (anchors `cpt-frontx-principle-agnostic-core`, `cpt-frontx-constraint-mfes-no-type-format-literals`).
* Deterministic selection — exactly one handler is chosen per entry, by a single rule applied consistently across all handlers.
* Extensibility — a new handler can be added without modifying the runtime's selection logic or any other handler.
* Encapsulation of loading mechanics — a handler owns *how* a bundle is loaded; the runtime owns *which* handler is responsible.
* Enforceable boundary — the rule that a handler does not select itself must be expressible as a continuous-integration check, not a convention.

## Considered Options

* **Registry-owned resolution by declared base type** — each handler declares the base type identifier it serves plus a selection priority; the registry chooses a handler by asking the injected type system whether an entry's type is a subtype of a handler's declared base type. The Module Federation handler is the shipped default.
* **Handler self-selection via a `canHandle(entry)` predicate** — each handler inspects a candidate entry and decides whether it can load it; the runtime polls handlers in turn until one accepts.
* **Static entry-type-to-handler map** — a configuration table maps each concrete entry type identifier directly to a handler, consulted by the runtime at load time.

## Decision Outcome

Chosen option: **registry-owned resolution by declared base type**, because it is the only option that keeps the runtime free of type-format knowledge while still producing a single deterministic handler per entry. Each handler declares a `handledBaseTypeId` and a `priority`; the registry resolves a handler by evaluating `typeSystem.isTypeOf(entryTypeId, handledBaseTypeId)` against the injected provider and ordering candidates by priority. The handler exposes only the loading capability (`load(entry, extensionId)`) and the bridge factory it provides — it carries no authority over whether it is selected. The Module Federation handler is the shipped default, registered at the lowest priority so that more specific handlers can take precedence.

### Consequences

* Good, because the runtime selects handlers purely through the injected type system, so it embeds no type-format literals and stays agnostic to any concrete type format.
* Good, because selection is deterministic — subtype matching against `handledBaseTypeId` with a priority order yields one handler per entry.
* Good, because handlers compose additively: a new handler declares its base type and registers, with no change to the runtime or to peer handlers.
* Good, because the "handler does not self-select" boundary is a continuous-integration-checkable invariant.
* Bad, because resolution depends on the injected type system being able to answer subtype queries for handler base types, coupling handler registration to type-hierarchy correctness.
* Bad, because two handlers declaring overlapping base types rely on the priority ordering to disambiguate, which must be set deliberately rather than inferred.

### Confirmation

Architecture review confirms that handlers expose no `canHandle`-style self-selection method and that the registry performs resolution exclusively through `typeSystem.isTypeOf(entryTypeId, handledBaseTypeId)` ordered by handler priority. A continuous-integration check (an import-and-surface grep over the runtime package) confirms that the runtime contains no type-format string literal used for handler matching and that the handler abstraction declares `handledBaseTypeId` and `load` but no selection predicate.

## Pros and Cons of the Options

### Registry-owned resolution by declared base type

Each handler declares the base type it serves and a priority; the registry matches entries via the injected type system's subtype query.

* Good, because the runtime stays agnostic — all type reasoning is delegated to the injected provider.
* Good, because adding a handler is additive and requires no runtime change.
* Good, because resolution is centralized and deterministic, easing reasoning and testing.
* Neutral, because it requires every handler to declare a base type identifier and priority.
* Bad, because correctness depends on the injected type system answering subtype queries faithfully.

### Handler self-selection via a `canHandle(entry)` predicate

Each handler decides for itself whether it can load an entry; the runtime asks each in turn.

* Good, because a handler can use arbitrary entry detail to decide, allowing very fine-grained matching.
* Bad, because selection authority is dispersed across handlers, so the system has no single deterministic rule and ordering effects are hard to reason about.
* Bad, because each handler tends to re-implement type reasoning, inviting type-format knowledge to spread across handlers and into the runtime.

### Static entry-type-to-handler map

A table maps concrete entry types to handlers.

* Good, because lookup is explicit and trivially deterministic.
* Bad, because it does not respect a type hierarchy — every concrete subtype must be enumerated, so the map grows with the type vocabulary and cannot match newly defined subtypes automatically.
* Bad, because maintaining the map centrally recouples the runtime to the concrete type vocabulary it is meant to stay agnostic to.

## More Information

The present concrete instantiation of the handler abstraction is the abstract `MfeHandler` class (`packages/mfes/src/handler/types.ts`), which declares `handledBaseTypeId`, `priority`, the `bridgeFactory` it provides, and `load(entry, extensionId)`; its documented resolution rule is that the registry matches entries using `typeSystem.isTypeOf(entryTypeId, handledBaseTypeId)` rather than the handler choosing itself. The shipped default handler is the Module Federation handler `MfeHandlerMF` (`packages/mfes/src/handler/MfeHandlerMF.ts`), constructed at priority `0`. The handler's live loading path is manifest-driven and is decided separately in `cpt-frontx-adr-mfe-asset-discovery`. The opaque type-substrate port that the injected type system satisfies is decided in `cpt-frontx-adr-runtime-type-system-coupling`, and the runtime surface that exposes the handler-bearing registry is decided in `cpt-frontx-adr-mfe-runtime-public-surface`.

**Scope of impact.** Applies to how the runtime matches a registered microfrontend entry to a loader and to the abstract surface every handler implements. It does not decide how any specific handler loads or isolates a bundle, nor the choice of type-system provider (decided in `cpt-frontx-adr-default-type-substrate-provider`).

**Review trigger.** Revisit if a requirement emerges for an entry to be served by more than one handler simultaneously, or for handler selection to depend on entry detail that the type hierarchy cannot express.

**Checklist applicability.**

* ARCH — applicable and addressed above (a structural decision affecting every runtime consumer that contributes a loader, and hard to reverse once handlers depend on the resolution contract).
* ARCH-ADR-008 (supersession) — Not applicable because this is a new, standalone decision that supersedes no prior record.
* INT — applicable: the handler abstraction and its bridge factory are the contract by which externally-built microfrontend bundles integrate into the runtime; its breaking-change policy is governed by `cpt-frontx-interface-mfe-runtime`.
* PERF — Not applicable because this governs selection authority, not load-time performance.
* SEC — Not applicable because this decision introduces no secret, credential, or authorization concern.
* REL — Not applicable because it shapes handler resolution, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-runtime-registration` — registry-owned handler resolution is how a registered microfrontend is matched to the loader that brings it on demand.
* `cpt-frontx-interface-mfe-runtime` — the handler abstraction is part of the runtime's public integration surface and is governed by its breaking-change policy.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the handler-resolution mechanism of the MFE Runtime component.
* `cpt-frontx-principle-agnostic-core` — resolving handlers through the injected type system keeps the runtime free of type-format literals.
* `cpt-frontx-constraint-mfes-no-type-format-literals` — selecting handlers via `typeSystem.isTypeOf` rather than format strings upholds this boundary rule.
