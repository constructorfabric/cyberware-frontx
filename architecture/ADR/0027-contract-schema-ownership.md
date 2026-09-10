---
status: accepted
date: 2026-07-16
---

# Concrete Contract Schemas Left Unowned by Circular DESIGN↔ADR Deferral

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [DESIGN owns role; owning FEATURE owns concrete schema; ADR owns rationale](#design-owns-role-owning-feature-owns-concrete-schema-adr-owns-rationale)
  - [DESIGN owns the concrete schema](#design-owns-the-concrete-schema)
  - [The ADR owns the concrete schema](#the-adr-owns-the-concrete-schema)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-contract-schema-ownership`

## Context and Problem Statement

Several ecosystem contracts — the template manifest (`cpt-frontx-contract-template-manifest`), the project-provenance record (`cpt-frontx-contract-project-provenance`), and the template AI-extension bundle (`cpt-frontx-contract-template-ai-extension`) — are described at role altitude in `architecture/DESIGN.md` and at decision altitude in their owning ADRs, but their concrete field-level schema is owned by neither: the DESIGN entity rows point to the ADR as the schema owner while each ADR points the concrete schema back to DESIGN. The result is a circular deferral in which no artifact actually owns the schema, and the CLI implementation has consequently chosen filenames, formats, and field layouts unilaterally, untraced to any specification. Where should the concrete field-level schema of a cross-artifact contract live so that role, decision rationale, and schema each have exactly one owner and the circular deferral is closed?

## Decision Drivers

* **Single owner per concern** — role, decision rationale, and concrete schema are three distinct concerns; each must have exactly one owning artifact so no concern is orphaned.
* **Purity gates** — DESIGN must not carry concrete field-level schemas (DATA-DESIGN-NO-001) and ADRs must not carry complete schema definitions (DATA-ADR-NO-001), so neither can be the schema owner.
* **Traceable implementation** — code must conform to a specified schema; today the CLI's manifest and provenance shapes trace to nothing, which the ownership rule must make impossible going forward.
* **Behavioral altitude already exists** — the FEATURE artifact is the altitude at which concrete shapes, flows, and definitions of done already live, and the owning FEATUREs for these three contracts already exist.
* **Stop the circularity** — the rule must forbid deferring the schema back to DESIGN or fixing it in the ADR, or the loop reopens.

## Considered Options

* **DESIGN owns role; owning FEATURE owns concrete schema; ADR owns rationale** — each contract's role and relationships live in DESIGN, its decision rationale in the ADR, and its concrete field-level schema in the one FEATURE that already specifies its behavior; the ADR and DESIGN explicitly delegate the schema to that FEATURE.
* **DESIGN owns the concrete schema** — relocate every contract schema into DESIGN and have ADRs point to it.
* **The ADR owns the concrete schema** — fix the full field-level schema inside each contract's ADR.

## Decision Outcome

Chosen option: **DESIGN owns role; owning FEATURE owns concrete schema; ADR owns rationale**, because it is the only option that gives each of the three concerns exactly one owner without violating a purity gate. DESIGN keeps the contract's role, producers, consumers, invariants, and relationships (its natural altitude); the ADR keeps the decision and its rationale (its natural altitude); and the concrete field-level schema is delegated to the single FEATURE that already owns the contract's behavior, flows, and definitions of done. Putting the schema in DESIGN would breach DATA-DESIGN-NO-001, and putting it in the ADR would breach DATA-ADR-NO-001 and freeze a volatile artifact inside an immutable-once-accepted record; the FEATURE is the artifact designed to carry exactly this level of detail.

The rule applies to every cross-artifact contract, and specifically resolves the three circular cases as follows: the template-manifest schema is owned by `cpt-frontx-feature-template-manifest`; the project-state document's schema (field layout and storage filename, `.frontx/project.json`, which is where a project's template provenance is recorded) is owned by `cpt-frontx-feature-composed-provenance`; and the template AI-extension bundle schema is owned by `cpt-frontx-feature-template-ai-extensions`. DESIGN and the contract ADRs delegate the schema to the named FEATURE and MUST NOT defer it back to DESIGN or fix it in the ADR. For the purpose of this decision, a contract's "concrete schema" owned by the FEATURE means the prose field specification PLUS the on-disk filename/location; serialized forms (JSON Schema, TypeScript interface, SQL DDL) live in code and are referenced, not inlined in any artifact. The existing CLI code that chose manifest and provenance shapes unilaterally must, in a later stage, be brought into conformance with the FEATURE-owned schema; that conformance work is out of scope for this decision, which fixes only ownership.

### Consequences

* Good, because every contract has exactly one role owner (DESIGN), one rationale owner (the ADR), and one schema owner (the FEATURE), so no contract's ownership defers in a circle.
* Good, because both purity gates (DATA-DESIGN-NO-001, DATA-ADR-NO-001) are honored by construction.
* Good, because code gains a single authoritative schema to trace to, replacing unilateral, untraced shapes.
* Neutral, because the ADR and DESIGN carry a pointer to the owning FEATURE rather than the schema itself.
* Bad, because a reader seeking a contract's full shape must follow one hop from DESIGN or the ADR to the owning FEATURE.
* Bad, because the ownership rule must be enforced (review or lint) to prevent a future author from reintroducing a schema into DESIGN or an ADR.

### Confirmation

Compliance is confirmed by design and code review plus a cross-artifact consistency check: for each of the three contracts, DESIGN's entity row and §3.3 entry name the owning FEATURE as the schema owner, the contract's ADR delegates the schema to that same FEATURE, and neither DESIGN nor the ADR inlines a field-level schema. A later stage additionally confirms that the CLI's manifest and provenance code conforms to the FEATURE-owned schema rather than a unilateral shape.

## Pros and Cons of the Options

### DESIGN owns role; owning FEATURE owns concrete schema; ADR owns rationale

Role in DESIGN, rationale in the ADR, concrete schema delegated to the one owning FEATURE.

* Good, because each concern has exactly one owner and no concern is orphaned.
* Good, because it honors both DESIGN and ADR schema-exclusion gates.
* Good, because the FEATURE is already the altitude for concrete shapes and definitions of done.
* Neutral, because it introduces an explicit delegation pointer in DESIGN and the ADR.
* Bad, because the rule needs enforcement to stay closed.

### DESIGN owns the concrete schema

Every contract's full field-level schema lives in DESIGN.

* Good, because a reader finds role and schema in one artifact.
* Bad, because it directly violates DATA-DESIGN-NO-001.
* Bad, because it inflates DESIGN with volatile field-level detail that churns independently of the architecture.

### The ADR owns the concrete schema

Each contract's full schema is fixed inside its ADR.

* Good, because decision and schema sit together.
* Bad, because it violates DATA-ADR-NO-001.
* Bad, because it couples schema churn to decision-record churn: every field-level change to a contract's shape becomes an edit to the record that fixes the decision, so a record whose holding has not moved is rewritten for reasons that have nothing to do with that holding.

## More Information

The three FEATUREs that own these schemas already exist under `architecture/features/` (`template-manifest`, `composed-provenance`, `template-ai-extensions`); this decision assigns ownership to them and does not itself author or edit them. The contract role descriptions remain in DESIGN §3.1 and §3.3, and the decision rationale for each contract remains in its own ADR (`cpt-frontx-adr-template-manifest-contract`, `cpt-frontx-adr-project-provenance-record`, `cpt-frontx-adr-template-ai-extension-contract`), and none of those records delegates its contract's field-level schema to DESIGN. These are non-binding pointers and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because a documentation-ownership rule has no latency or throughput budget.
* **SEC** — Not applicable, because the rule introduces no secret material or authentication surface.
* **REL** — Not applicable, because no service-availability target attaches to an ownership rule.
* **DATA** — addressed directly: this decision governs where concrete schemas live and deliberately fixes none itself.
* **INT** — addressed: it stabilizes how three internal contracts are specified across artifacts.
* **OPS** — Not applicable, because no operational procedure attaches to the rule.
* **MAINT** — addressed: single-owner-per-concern reduces drift and makes contracts traceable.
* **COMPL** — Not applicable, because no regulatory obligation bears on the rule.
* **UX** — Not applicable, because the product ships no end-user interface affected by this rule.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

**Review cadence**: revisit when a cross-boundary contract appears whose owner this rule does not obviously settle — it assigns ownership by which side a shape is a contract *of*, and a shape two sides genuinely co-own would strain that.

**Scope of the rule.** The rule this record fixes — DESIGN owns role, the ADR owns rationale, the owning FEATURE owns the concrete field-level schema — governs an ADR's *complete* schema. It does not forbid an ADR from fixing the categories a contract declares, or a discriminator that distinguishes one shape of a contract from another (a legacy manifest from a current one, a registered entry from an applied one), at decision altitude: naming what a contract declares, and by what property a reader tells two variants of it apart, is decision rationale, not the field-by-field layout DATA-ADR-NO-001 excludes. Four records rely on this reading: `cpt-frontx-adr-template-manifest-contract` fixes the manifest's four declared categories and the undeclared-field discriminator that marks a non-conforming manifest; `cpt-frontx-adr-project-provenance-record` fixes `.frontx/project.json`'s top-level shape and its presence/emptiness semantics; `cpt-frontx-adr-assembly-conflict-prevention` fixes the segment-wise ancestor/descendant discriminator; and `cpt-frontx-adr-cli-machine-readable-output` fixes the envelope's two-way discriminant and its shared code vocabulary. None of these inlines a field-by-field schema; each stops at the category or discriminator altitude this note names explicitly.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-contract-template-manifest` — Assigns its concrete schema to `cpt-frontx-feature-template-manifest` while DESIGN keeps its role and `cpt-frontx-adr-template-manifest-contract` keeps its rationale.
* `cpt-frontx-contract-project-provenance` — Assigns its concrete schema (field layout and filename) to `cpt-frontx-feature-composed-provenance` while DESIGN keeps its role and `cpt-frontx-adr-project-provenance-record` keeps its rationale.
* `cpt-frontx-contract-template-ai-extension` — Assigns its concrete schema to `cpt-frontx-feature-template-ai-extensions` while DESIGN keeps its role and `cpt-frontx-adr-template-ai-extension-contract` keeps its rationale.
