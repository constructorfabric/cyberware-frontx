---
status: proposed
date: 2026-06-04
---

# Partition the Core Framework into Boundary-Governed Concerns


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Boundary-governed partition of separately bounded concerns](#boundary-governed-partition-of-separately-bounded-concerns)
  - [Single combined core](#single-combined-core)
  - [Runtime and type system merged, protocol surface separate](#runtime-and-type-system-merged-protocol-surface-separate)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-core-package-boundaries`
## Context and Problem Statement

The Core Framework provides the substrate that composed applications build on: a microfrontend runtime, a concrete type-system provider, and a protocol surface for back-end communication. These concerns differ in what they must be agnostic to — the runtime must not assume any UI framework, type-system format, or solution vocabulary, whereas the type-system provider exists precisely to embody a concrete type-definition specification. How should the Core Framework be partitioned so that each concern's agnosticism guarantees hold and a change in one concern does not ripple into the others?

## Decision Drivers

* Agnostic core — the runtime substrate must remain independent of UI framework, type-system format, and solution-specific vocabulary (anchors requirement `cpt-frontx-fr-ui-framework-agnostic`, design principle `cpt-frontx-principle-agnostic-core`).
* Isolated blast radius — a change to the concrete type system or to the protocol surface must not reach the runtime substrate.
* Independent substitutability — the type-system provider is injected through an opaque port, so any conforming provider can be composed in; this is only expressible if the runtime and the provider are separately bounded.
* Enforceable boundaries — each separation must be expressible as a CI-checkable invariant rather than a convention.

## Considered Options

* **Boundary-governed partition of separately bounded concerns** — the runtime, the type-system provider, and the protocol surface are each their own concern, each governed by CI-enforceable boundary constraints.
* **Single combined core** — runtime, type system, and protocol surface live in one unit.
* **Runtime and type system merged, protocol surface separate** — a partial partition that keeps the runtime bound to a concrete type system.

## Decision Outcome

Chosen option: **boundary-governed partition of separately bounded concerns**, because it is the only option that keeps the runtime substrate agnostic (it carries no concrete type-format dependency or literals), bounds the blast radius of a change to the concern that owns it, and lets a conforming type-system provider be injected through an opaque port. The separations are made enforceable by the boundary constraints `cpt-frontx-constraint-mfes-no-type-format-literals`, `cpt-frontx-constraint-mfes-no-solution-shared-properties`, `cpt-frontx-constraint-mfes-no-layout-domain-values`, `cpt-frontx-constraint-mfes-no-type-format-dependency`, `cpt-frontx-constraint-mfes-opaque-schema-surface`, `cpt-frontx-constraint-gts-plugin-owns-infra-schemas`, `cpt-frontx-constraint-gts-plugin-excludes-solution-schemas`, and `cpt-frontx-constraint-api-no-solution-content`.

### Consequences

* Good, because the runtime substrate stays agnostic to UI framework, type-system format, and solution vocabulary, so applications compose against a stable, narrow surface.
* Good, because each concern's blast radius is bounded and a conforming type-system provider is substitutable through the opaque port.
* Good, because every boundary is a CI-enforceable invariant, not a convention.
* Bad, because more separately bounded concerns mean more cross-concern contracts to maintain and version.
* Bad, because injection through the opaque port adds a layer of indirection between the runtime and the concrete type system.

### Confirmation

Architecture review confirms each concern's responsibilities stay within its boundary, and continuous-integration checks enforce the boundary constraints: greps that assert the runtime carries no type-format literals, no solution-specific shared-property identifiers, no layout-domain values, and no concrete type-format dependency, and that its schema surface is opaque (`cpt-frontx-constraint-mfes-no-type-format-literals`, `cpt-frontx-constraint-mfes-no-solution-shared-properties`, `cpt-frontx-constraint-mfes-no-layout-domain-values`, `cpt-frontx-constraint-mfes-no-type-format-dependency`, `cpt-frontx-constraint-mfes-opaque-schema-surface`); that the type-system provider owns infrastructure schemas and no solution schemas (`cpt-frontx-constraint-gts-plugin-owns-infra-schemas`, `cpt-frontx-constraint-gts-plugin-excludes-solution-schemas`); and that the protocol surface carries no solution-specific content (`cpt-frontx-constraint-api-no-solution-content`).

## Pros and Cons of the Options

### Boundary-governed partition of separately bounded concerns

* Good, because the runtime substrate is agnostic and applications integrate against a fixed, narrow surface.
* Good, because the type-system provider is substitutable through the opaque port.
* Good, because boundaries are CI-enforceable invariants.
* Neutral, because it requires explicit cross-concern contracts.
* Bad, because it introduces more units to coordinate and an indirection layer.

### Single combined core

* Good, because there is one unit to build and release.
* Bad, because the runtime substrate becomes bound to a concrete type-system format, losing agnosticism.
* Bad, because a change to any concern can ripple across the whole unit.

### Runtime and type system merged, protocol surface separate

* Good, because it isolates the protocol surface.
* Bad, because the runtime stays coupled to a concrete type system and cannot accept an alternative conforming provider.
* Neutral, because it only partially bounds the blast radius.

## More Information

The present concrete instantiation of the Core Framework concerns is `@gears-frontx/mfes` (runtime), `@gears-frontx/gts-plugin` (type-system provider), and `@gears-frontx/api` (protocol surface); this mapping is descriptive and non-binding. The boundary constraints governing these concerns are defined in DESIGN §2.2; the CLI and AI-tooling boundary rules (`cpt-frontx-constraint-cli-template-independence`, `cpt-frontx-constraint-kit-prefixed-resource-ids`) belong to other pillars and are outside this decision's scope.

**Scope of impact.** This decision governs only the partition of the Core Framework into runtime, type-system provider, and protocol surface, and the boundary constraints between them. It does not decide the internal structure of any concern, the concrete type-definition specification (a separate decision), or distribution and versioning (decided in `cpt-frontx-adr-artifact-versioning-and-distribution`).

**Review trigger.** Revisit if a requirement emerges for the runtime to depend directly on a single canonical type-system format, which would remove the rationale for the opaque-port boundary.

**Scope relative to other published-libraries members (present detail, non-binding).** The partition decided here covers the core subset of the published-libraries layer: concerns that must stay UI-framework-agnostic. The navigation substrate (`@gears-frontx/routing`) is inside this partition: it carries no dependency on any router engine or UI framework whatsoever, so it is both core and standalone at once, per the same pattern already accepted for the type-system port (`cpt-frontx-adr-runtime-type-system-coupling`, `cpt-frontx-adr-default-type-substrate-provider`). A layer member that is deliberately bound to a concrete UI framework and a concrete engine sits outside this partition and introduces its own bounded concern rather than extending this decision's boundary constraints. `@gears-frontx/routing-tanstack` is such a case: it is the separately published default implementation of the navigation substrate's own engine-provider port, bound to a concrete UI framework and a concrete routing engine, and depending on `@gears-frontx/routing` — so it is neither core nor standalone. It carries its own boundary constraint — labeled ROUTING-TANSTACK-1 (sole engine import in the ecosystem) in that member's own DESIGN at [packages/routing-tanstack/architecture/DESIGN.md](../../packages/routing-tanstack/architecture/DESIGN.md) §2.2, which owns and defines it — which extends no core constraint listed in this decision's Decision Outcome. The navigation substrate's own DESIGN at [packages/routing/architecture/DESIGN.md](../../packages/routing/architecture/DESIGN.md) §2.2 carries two constraints of its own, labeled ROUTING-1 (no engine import in the navigation substrate) and ROUTING-2 (no intra-ecosystem package dependency) — both unchanged in effect by the split, with ROUTING-1 now reinforcing the core property as a package-boundary fact rather than an intra-package one.

**Checklist applicability.**

* ARCH — applicable and addressed above (a fundamental, hard-to-reverse structural decision affecting all Core Framework consumers).
* ARCH-ADR-008 (supersession) — Not applicable because this is a new, standalone decision that supersedes no prior record.
* PERF — Not applicable because this is a package-boundary decision, not a runtime-performance decision.
* SEC — Not applicable because the partition introduces no secret, credential, or authorization concern.
* REL — Not applicable because this governs structural boundaries, not runtime availability or fault tolerance.
* DATA — Not applicable because no persistent data store or schema is involved.
* INT — Not applicable because cross-concern integration is governed by the boundary constraints cited above rather than an external integration-protocol choice.
* OPS — Not applicable because no deployed-service operational procedure is governed by this decision.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements or design elements:

* `cpt-frontx-fr-ui-framework-agnostic` — the partition keeps the runtime substrate free of UI-framework assumptions, which this requirement mandates.
* `cpt-frontx-interface-mfe-runtime` — defines the runtime as a separately bounded concern whose public surface is the opaque type-substrate port together with registration and placement.
* `cpt-frontx-interface-type-system` — establishes the type-system provider as a distinct concern behind the runtime's opaque port.
* `cpt-frontx-component-mfe-runtime` — the runtime concern of the partition.
* `cpt-frontx-component-type-system-plugin` — the type-system-provider concern of the partition.
* `cpt-frontx-component-api-surface` — the protocol-surface concern of the partition.
* `cpt-frontx-principle-agnostic-core` — this decision is the structural realization of the agnostic-core principle.
* `cpt-frontx-constraint-mfes-no-type-format-literals` — boundary invariant enforced for the runtime concern.
* `cpt-frontx-constraint-mfes-no-solution-shared-properties` — boundary invariant enforced for the runtime concern.
* `cpt-frontx-constraint-mfes-no-layout-domain-values` — boundary invariant enforced for the runtime concern.
* `cpt-frontx-constraint-mfes-no-type-format-dependency` — boundary invariant enforced for the runtime concern.
* `cpt-frontx-constraint-mfes-opaque-schema-surface` — boundary invariant enforced for the runtime concern.
* `cpt-frontx-constraint-gts-plugin-owns-infra-schemas` — boundary invariant enforced for the type-system-provider concern.
* `cpt-frontx-constraint-gts-plugin-excludes-solution-schemas` — boundary invariant enforced for the type-system-provider concern.
* `cpt-frontx-constraint-api-no-solution-content` — boundary invariant enforced for the protocol-surface concern.
