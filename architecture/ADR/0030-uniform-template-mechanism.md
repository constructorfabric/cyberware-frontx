---
status: accepted
date: 2026-07-16
---

# Whether the Platform Classifies Templates or Applies Any Template Uniformly

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Uniform template mechanism](#uniform-template-mechanism)
  - [A fixed template classification](#a-fixed-template-classification)
  - [An open, extensible type registry](#an-open-extensible-type-registry)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-uniform-template-mechanism`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) installs, applies, and assembles templates it does not own, and a repository is assembled from one or more independently-applied templates, each named explicitly by the call that applies it (`cpt-frontx-adr-composed-template-resolution`, `cpt-frontx-fr-cli-seed-repository`, `cpt-frontx-fr-cli-add-template-to-repository`). The question this decision settles is whether the platform fixes a taxonomy of template types that the mechanism branches on, or whether the assembly, resolution, and upgrade mechanism treats every template the same regardless of what it produces.

## Decision Drivers

* **Open-ended composition** — a repository is assembled from shells, microfrontends, libraries, configs, and combinations that no fixed taxonomy anticipates; the mechanism must admit any template a developer can author without the platform enumerating a type for it first.
* **One mechanism, not per-type branches** — install, apply, assemble, conflict-check, and upgrade should be one code path over any template; branching the mechanism by type multiplies the surface and couples the tool to a closed vocabulary.
* **Templates describe themselves** — what a template produces and the ground it claims are properties the template declares (its manifest and ownership boundaries), so the tool needs no type label to operate on it.
* **Evolvability without a vocabulary change** — introducing a new sort of template must not require a platform release that widens a fixed enumeration, so the contract and the tool stay stable as the ecosystem's templates diversify.
* **Composition expressed by the caller, not by type** — several templates are arranged into one repository by the caller naming them and their targets explicitly (`cpt-frontx-adr-composed-template-resolution`), not by a type the tool special-cases.

## Considered Options

* **Uniform template mechanism** — the platform fixes no taxonomy of template types; every template declares what it produces and the boundaries of what it owns, and the install/apply/assemble/conflict-check/upgrade mechanism operates identically over any template. Composition is expressed by the caller's explicit batch naming each template and the targets it is applied to (`cpt-frontx-adr-composed-template-resolution`), not by a type label the tool branches on.
* **A fixed template classification** — the platform enumerates a closed set of template types, each template declares its type in a required field, and the tooling branches on that type.
* **An open, extensible type registry** — the platform ships a set of types but lets templates register new types, so the taxonomy grows without a platform release while the mechanism still branches on a type value.

## Decision Outcome

Chosen option: **Uniform template mechanism**, because it is the only option that admits open-ended composition through a single mechanism while letting templates describe themselves. Every template declares what it produces and the boundaries of what it owns; the CLI installs, applies, assembles, conflict-checks, and upgrades any template through one path that never branches on a type. Several templates are arranged into one repository by the caller naming each of them and its targets in a single explicit batch (`cpt-frontx-adr-composed-template-resolution`), so the call itself — not a type, and not a reference a manifest declares — is what expresses and resolves composition; each template's manifest describes only that template (`cpt-frontx-adr-template-manifest-contract`). Conflicts between what independently-applied templates claim are arbitrated by their declared ownership boundaries (`cpt-frontx-adr-template-ownership-boundary-declaration`, `cpt-frontx-adr-assembly-conflict-prevention`), a mechanism that likewise operates uniformly over any template.

The fixed template classification is rejected because a closed enumeration cannot anticipate the shells, libraries, configs, and combinations a developer assembles, so it forces every new sort of template through a widening of the vocabulary and a per-type branch in the tool; it also invites conflating a type with the output it produces. The extensible-type-registry option removes the closed-vocabulary limit but keeps the mechanism branching on a type value and adds a registry to steward, paying the cost of a taxonomy without the benefit of a closed one — when the self-describing manifest and ownership boundaries already carry everything the mechanism needs.

The scope of this decision is that the platform fixes no template taxonomy and the mechanism operates uniformly over any template. It does not decide the manifest's shape (`cpt-frontx-adr-template-manifest-contract`), how boundaries are declared (`cpt-frontx-adr-template-ownership-boundary-declaration`), or how a batch of templates and targets is expressed and resolved (`cpt-frontx-adr-composed-template-resolution`).

### Consequences

* Good, because any template a developer can author is admitted without the platform first enumerating a type for it, so composition is open-ended.
* Good, because install, apply, assemble, conflict-check, and upgrade are one mechanism over every template rather than per-type branches, keeping the tool surface small.
* Good, because a template describes itself through its manifest and ownership boundaries, so the tool needs no type label to operate on it.
* Good, because a new sort of template requires no widening of a fixed vocabulary and no platform release to admit it.
* Bad, because without a declared type the tool cannot offer type-specific affordances or validation shortcuts; any such behavior must be derived from what a template declares, not from a label.
* Bad, because composition carries no type constraint that could rule out a nonsensical combination in advance: an arrangement that does not make sense is refused by the ownership and conflict checks it fails, not by a taxonomy that would have forbidden it.

### Confirmation

Compliance is confirmed by design and code review plus a continuous-integration check on the CLI package: the manifest contract carries no `type` field, the install/apply/assemble/upgrade code path contains no branch on a template-type value, and a fixture assembles a repository from templates of visibly different sorts (a shell template, a library template, a config template) through the identical mechanism. A second check assembles several templates in one operation and asserts that the operation is driven entirely by one explicit batch naming each template and its targets, with no template-type value gating which templates the batch resolves to or how they are applied.

## Pros and Cons of the Options

### Uniform template mechanism

The platform fixes no taxonomy; templates self-describe, and one mechanism operates over any template, with composition expressed by the caller's explicit batch.

* Good, because composition is open-ended and admits any authored template.
* Good, because the mechanism is one path, not per-type branches.
* Good, because templates need no platform-blessed type to be operated on.
* Neutral, because it relies on the manifest and ownership-boundary contracts to carry the self-description the mechanism reads.
* Bad, because type-specific affordances are unavailable, and an unworkable combination surfaces only when the ownership and conflict checks refuse it.

### A fixed template classification

The platform enumerates a closed set of template types; each template declares its type in a required field, and the tool branches on that type.

* Good, because a declared type makes a template's role explicit in the surface.
* Good, because a closed set is simple to validate against.
* Bad, because a closed enumeration cannot anticipate the range of templates a repository is assembled from, forcing new sorts through a vocabulary change.
* Bad, because a type value invites conflating a template with the output it produces and branches the mechanism by type.

### An open, extensible type registry

The platform ships types but lets templates register new ones; the mechanism still branches on a type value.

* Good, because the taxonomy can grow without a platform release.
* Bad, because the mechanism still branches on a type, keeping the per-type surface.
* Bad, because a registry of types is itself a contract to steward, paying a taxonomy's cost without a closed set's benefit.

## More Information

The self-describing manifest this decision relies on is decided in `cpt-frontx-adr-template-manifest-contract`; the ownership-boundary declaration that lets independently-applied templates be arbitrated is decided in `cpt-frontx-adr-template-ownership-boundary-declaration`; how a batch of templates and targets is expressed and resolved is decided in `cpt-frontx-adr-composed-template-resolution`. These are non-binding pointers to related decisions and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because a taxonomy decision binds no latency or throughput budget.
* **SEC** — Not applicable, because it introduces no secret material or authentication surface.
* **REL** — Not applicable, because no service-availability target attaches to a local mechanism.
* **DATA** — Not applicable, because this decision fixes no schema; the manifest schema is owned by `cpt-frontx-feature-template-manifest` per `cpt-frontx-adr-contract-schema-ownership`.
* **INT** — addressed: removing a type field from the manifest keeps the published contract self-describing without a classification vocabulary.
* **OPS** — Not applicable, because no operational procedure attaches to the mechanism.
* **MAINT** — addressed directly: one mechanism over any template reduces the surface and removes a vocabulary to steward.
* **COMPL** — Not applicable.
* **UX** — addressed implicitly: a developer assembles any template through one predictable set of commands.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

**Review cadence**: revisit if a validated need for template typing emerges that one uniform mechanism cannot serve without reintroducing a taxonomy.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-adr-composed-template-resolution` — Multi-template assembly operates over any template without a template classification: the caller's explicit batch names what to apply and where, so composition needs no type to arrange by.
* `cpt-frontx-contract-template-manifest` — Fixes that the manifest carries no type field; a template is self-describing through what it produces and the boundaries it declares.
* `cpt-frontx-component-cli` — The CLI component operates one uniform mechanism over every template; this decision constrains it to hold no branch on a template type.
