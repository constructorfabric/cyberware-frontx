---
status: accepted
date: 2026-06-04
---

# The MFE Runtime's Public Access Surface


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Abstract registry facade with factory injection](#abstract-registry-facade-with-factory-injection)
  - [Direct dependency on concrete implementation classes](#direct-dependency-on-concrete-implementation-classes)
  - [Module-level singleton with free functions](#module-level-singleton-with-free-functions)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-mfe-runtime-public-surface`
## Context and Problem Statement

The MFE Runtime registers microfrontends and their extension domains, loads them on demand, mediates their communication with the host, and admits them only after type validation. Consumers — host applications and the microfrontends they compose — need a stable way to obtain and use this runtime, while the runtime's internal coordination machinery (mount management, action mediation, bridge wiring) must remain free to evolve. The runtime also needs a concrete type-system provider supplied to it at construction. How should the runtime's public surface be shaped so that consumers depend on a stable contract, the concrete implementation stays substitutable, and the type-system provider is injected at the single point where the runtime is created?

## Decision Drivers

* Narrow, stable public surface — consumers should depend on a contract that does not change when internal coordination machinery changes (anchors `cpt-frontx-interface-mfe-runtime`).
* Encapsulation of internal coordination — mount management, the actions-chains mediator, and bridge wiring are internal concerns that must not be part of the public surface.
* Substitutability — the concrete runtime implementation must be replaceable without breaking any consumer.
* Provider injection — the runtime depends on an injected type-system provider, which requires a single controlled construction point rather than implicit global wiring (anchors `cpt-frontx-principle-agnostic-core`).
* Enforceable encapsulation — the boundary between the public contract and internal implementation must be expressible as a continuous-integration check, not a convention.

## Considered Options

* **Abstract registry facade with factory injection** — consumers depend only on an abstract `MfeRegistry` contract and obtain an instance from an injected factory (`createMfeRegistryFactory().build({ typeSystem })`); the concrete implementation and its coordination machinery stay internal.
* **Direct dependency on concrete implementation classes** — consumers import and construct the concrete registry and its managers directly.
* **Module-level singleton with free functions** — registration and loading are exposed as standalone functions over a hidden module-global runtime instance.

## Decision Outcome

Chosen option: **abstract registry facade with factory injection**, because it is the only option that gives consumers a stable contract (`MfeRegistry`) independent of internal coordination machinery, keeps the concrete implementation substitutable behind that contract, and provides a single controlled construction point at which the type-system provider is injected. The abstract `MfeRegistry` (`packages/screensets/src/mfe/runtime/MfeRegistry.ts`) declares the runtime's public operations — domain and extension registration, actions-chain execution, query, and the read-only `typeSystem` provider — and instances are obtained through the factory's `build({ typeSystem })` (`packages/screensets/src/mfe/runtime/DefaultMfeRegistryFactory.ts`). The concrete factory and registry implementation are internal and are not part of the package's public surface.

### Consequences

* Good, because consumers couple only to the abstract `MfeRegistry` contract, so internal coordination machinery can change without breaking them.
* Good, because the concrete implementation is substitutable behind the contract and is reachable only through the factory.
* Good, because the type-system provider is injected at a single construction point, keeping the runtime agnostic to any concrete provider.
* Good, because the public/internal boundary is a continuous-integration-checkable invariant.
* Bad, because the indirection of an abstract contract plus a factory adds a layer between the consumer and the working implementation.
* Bad, because the factory's single-construction semantics require consumers to agree on one provider per composition root rather than constructing implementations ad hoc.
* Bad, because the boundary is not yet complete: the barrel still exports a handful of concrete-but-not-`Default*`-named internals that the naming rule cannot detect, recorded with owner and removal criterion in the public-surface debt register of `packages/mfes/architecture/DESIGN.md` (§3.3).

### Confirmation

Architecture review confirms that registry construction crosses the package's public surface only as the abstract `MfeRegistry` contract and the `createMfeRegistryFactory` creation function, and that the concrete implementation and factory remain internal. A continuous-integration check (`scripts/mfes-import-boundary-check.mjs`, wired as `npm run policy:mfes-import-boundary` in `.github/workflows/main.yml`) confirms both halves over this repository: the barrel exports no concrete-implementation name (the `Default*` naming rule), and no consumer in this repository imports a concrete class or deep-imports past the barrel — every instance is obtained through `createMfeRegistryFactory().build({ typeSystem })`.

The two halves do not reach equally far. The **barrel half** is structural and answers for every consumer anywhere, because a name the barrel does not export cannot be imported from any repository; that half is whole here. The **consumer half** reaches only as far as the tree it walks, so it answers for this repository's consumers and for no others: a repository that holds consumers of its own confirms that half by running the same rule over its own tree, and a consumer in a repository that runs no such check is unchecked. This is why the barrel half is the one that must stay complete. The reach of each half is recorded with the boundary it guards, in `packages/mfes/architecture/DESIGN.md` (§3.3).

## Pros and Cons of the Options

### Abstract registry facade with factory injection

Consumers depend on the abstract `MfeRegistry`; instances come from an injected factory that receives the type-system provider in its configuration.

* Good, because the public contract is narrow and stable while internals stay free to change.
* Good, because the concrete implementation is substitutable and encapsulated.
* Good, because provider injection happens at one controlled construction point.
* Neutral, because it requires a factory abstraction in addition to the registry contract.
* Bad, because it introduces an indirection layer between consumer and implementation.

### Direct dependency on concrete implementation classes

Consumers import the concrete registry and managers and construct them directly.

* Good, because there is no indirection — consumers use the implementation straight away.
* Bad, because consumers couple to internal coordination machinery, so internal changes ripple outward.
* Bad, because there is no single controlled point for injecting the type-system provider, inviting inconsistent wiring.

### Module-level singleton with free functions

Registration and loading are standalone functions over a hidden global runtime instance.

* Good, because the call sites are terse and require no explicit instance handling.
* Bad, because a hidden global makes the type-system provider's injection implicit and the lifecycle hard to reason about.
* Bad, because multiple isolated runtimes (for example in tests) cannot coexist.

## More Information

The present concrete instantiation of the runtime is `@gears-frontx/mfes`; the contract is the abstract `MfeRegistry` and instances are built through `createMfeRegistryFactory().build({ typeSystem })`. The factory itself is also an abstract contract (`packages/screensets/src/mfe/runtime/MfeRegistryFactory.ts`, which declares `build(config): MfeRegistry` and holds no knowledge of any concrete implementation), and the concrete implementation that satisfies the registry contract (`packages/screensets/src/mfe/runtime/DefaultMfeRegistry.ts`) is internal. This decision governs only the shape of the runtime's public surface and its construction; the internal coordination mechanisms it encapsulates (the actions-chains mediator, mount strategies, and the parent–child bridge) are decided in their own records, and the opaque type-substrate port the injected provider satisfies is decided in `cpt-frontx-adr-runtime-type-system-coupling`.

**Scope of impact.** Applies to the runtime's public surface and the way consumers obtain a runtime instance. It does not decide the internal structure of the concrete implementation, the choice of type-system provider (decided in `cpt-frontx-adr-default-type-substrate-provider`), or how microfrontend code is loaded and isolated.

**Review trigger.** Revisit if a requirement emerges for consumers to operate the runtime's internal coordination components directly, which would remove the rationale for a single narrow facade.

**Checklist applicability.**

* ARCH — applicable and addressed above (a structural decision affecting every runtime consumer and hard to reverse once consumers depend on the surface).
* ARCH-ADR-008 (supersession) — Not applicable because this is a new, standalone decision that supersedes no prior record.
* INT — applicable: the abstract `MfeRegistry` is the runtime's public integration surface; its breaking-change policy is governed by `cpt-frontx-interface-mfe-runtime`.
* PERF — Not applicable because the facade is a surface-shape decision, not a runtime-performance decision.
* SEC — Not applicable because the facade introduces no secret, credential, or authorization concern.
* REL — Not applicable because this governs the public surface, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-mfe-runtime-registration` — the facade is how microfrontends are registered with a running application and loaded on demand through a stable contract.
* `cpt-frontx-interface-mfe-runtime` — the abstract `MfeRegistry` is the public surface this interface names, and its breaking-change policy applies to it.
* `cpt-frontx-component-mfe-runtime` — this decision shapes the public surface and construction of the MFE Runtime component.
* `cpt-frontx-principle-agnostic-core` — factory injection of the type-system provider at a single construction point realizes the agnostic-core principle for the runtime surface.
