---
status: accepted
date: 2026-06-05
---

# Template Manifest as the Published Conformance Contract

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [A single published manifest as the conformance contract](#a-single-published-manifest-as-the-conformance-contract)
  - [Convention-over-manifest structural inference](#convention-over-manifest-structural-inference)
  - [Per-command ad-hoc descriptors](#per-command-ad-hoc-descriptors)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-template-manifest-contract`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) installs, validates, applies, and assembles templates it does not own, authored and published by separate teams. For the command surface to operate on a template it has never seen — and to assemble it alongside other independently-applied templates without conflict — the template must describe itself in a defined, machine-readable shape that the CLI can both check at publication time and read at install, apply, and assembly time. The template-manifest contract (`cpt-frontx-contract-template-manifest`) requires every template to publish such a manifest, produced when a template is validated for publication and consumed when a template is installed, applied, or assembled with others. What shape should that manifest take, and what should it declare, so that a single contract lets the CLI validate a template before publication and assemble it with others at apply time without coupling the command surface to any specific template?

## Decision Drivers

* **Self-description for an unknown template** — the CLI owns no template, so a template must declare its own identity and version in a form the CLI reads generically rather than the CLI hard-coding knowledge of any template.
* **One contract for produce and consume** — the same manifest is checked at pre-publish validation (`cpt-frontx-fr-cli-template-validate-prepublish`) and read at install, apply, and assembly; a single defined shape avoids two divergent descriptions of the same template.
* **Declared ownership boundaries** — a template is assembled alongside others that write into the same repository, so the manifest must declare the boundaries of what the template owns, giving the conflict check an authoritative source to compare (`cpt-frontx-fr-cli-template-boundary-declaration`).
* **Declared referenced templates (presets)** — a template may reference other templates to be applied together as a set (a preset), so the manifest must declare those references for resolution to read (`cpt-frontx-fr-cli-composed-template-resolution`).
* **Self-description a caller can choose by** - a caller who holds no reference must be able to tell what a template establishes and contributes in order to choose it at all, and because the mechanism classifies no template (`cpt-frontx-adr-uniform-template-mechanism`) there is no taxonomy to consult, so the manifest must carry the template's own statement of what it is.
* **Versioned, evolvable shape** — the manifest shape must be versioned so the contract can evolve while older published templates remain readable, consistent with the platform evolvability requirement.
* **Pre-publish checkability** — the shape, including the well-formedness of the declared ownership boundaries, must be checkable in isolation before publication, so a structurally malformed template is caught by its author rather than by a consumer.

## Considered Options

* **A single published manifest as the conformance contract** - every template publishes one manifest, in a defined and versioned shape, declaring the template's identity, its version, the boundaries of what it owns, any templates it references to be applied together, and a description of what it establishes and contributes; the CLI produces a pass/fail check against this shape at pre-publish validation and reads the same manifest at install, apply, and assembly.
* **Convention-over-manifest structural inference** — the CLI infers a template's identity, ownership, and references from file-layout conventions and naming, with no published descriptor.
* **Per-command ad-hoc descriptors** — each command (validate, install, apply, assemble) reads its own purpose-built descriptor file, so a template carries several partial descriptions rather than one.

## Decision Outcome

Chosen option: **A single published manifest as the conformance contract**, because it is the only option that serves the produce-and-consume driver with one authoritative description: the same defined, versioned shape is the target of pre-publish validation and the source of install-time, apply-time, and assembly-time reading, so a template describes itself once and every command reads that one description. The manifest declares the template's identity, its version, the **ownership boundaries** it claims (the subtrees it owns exclusively and the shared-file regions it contributes to, in the shape decided by `cpt-frontx-adr-template-ownership-boundary-declaration`), the **referenced templates** it composes as a preset (resolved by `cpt-frontx-adr-composed-template-resolution`), and a **description** of what the template establishes and contributes, which is what lets a caller holding no reference choose the template at all. The declared boundaries are what let the conflict check refuse a clashing assembly before any write (`cpt-frontx-adr-assembly-conflict-prevention`). The manifest carries no template-classification field: the mechanism operates identically over any template regardless of what it produces (`cpt-frontx-adr-uniform-template-mechanism`). The manifest declares these categories only and carries no file content: a template's content is delivered from its resolved on-disk installed path - materialized into the tracked local inventory at install time (`cpt-frontx-adr-template-acquisition-and-location`) and read from there at apply and assembly time - never embedded in or read from the manifest.

One category is deliberately absent and is recorded here so its absence reads as a decision rather than an oversight: the manifest declares **no compatibility requirement against another template**. A template whose content only functions inside ground another template establishes has no field in which to say so, and none is added. The five categories are what the CLI must read to install, validate, apply, assemble, and choose a template; a requirement on a sibling is none of those, because the mechanism that would have to enforce it does not exist either — the pre-flight check arbitrates contested ground, not absent ground, and admits an assembly in which a required template is simply not present. Adding the field without the enforcement would publish a declaration nothing reads, which is worse than the honest gap: a template states its precondition in the **description**, where a human or an agent choosing the template reads it, and whatever runtime the applied content composes into enforces at composition time what the manifest does not. This is a deferral with a revisit criterion, not a permanent exclusion: it is revisited when a template family's runtime enforcement is shown to surface an incompatibility too late for the consumer to act on, at which point the enforcement is designed first and the declaration follows it.

The convention-inference option couples the CLI to brittle layout heuristics and offers nothing concrete to validate before publication; the per-command-descriptor option fragments one description into several that can drift out of agreement. The manifest is the conformance contract a template MUST satisfy to be publishable: pre-publish validation checks a candidate template against the manifest shape - including that its declared ownership boundaries are well-formed - and reports a structural pass or fail, and install, apply, and assembly read the published manifest to learn what the template is, what it owns, and what it references. The manifest shape is versioned so the contract can evolve while manifests already published remain readable. The concrete field-by-field schema is owned by the manifest FEATURE (`cpt-frontx-feature-template-manifest`) per `cpt-frontx-adr-contract-schema-ownership` and is not fixed here or deferred to DESIGN; this decision fixes the manifest's role, the categories of information it declares (identity, version, ownership boundaries, referenced templates, description), and its produce-once / consume-many lifecycle.

### Consequences

* Good, because one authoritative self-description serves validation, install, apply, and assembly, so a template is described once and never inconsistently across commands.
* Good, because the CLI operates on any conforming template generically, reading the manifest rather than embedding knowledge of specific templates, reinforcing the command surface's independence from content.
* Good, because declared ownership boundaries give the conflict check an authoritative source to compare, declared references give preset resolution an authoritative set to apply, and the declared description gives selection something to match an intent against without any consumer holding knowledge of specific templates.
* Good, because a versioned shape lets the contract evolve while older published manifests remain readable.
* Bad, because every template author must author and maintain a conforming manifest, including its ownership-boundary declaration, adding an authoring obligation that pure convention-inference would avoid.
* Bad, because the manifest shape becomes a contract whose evolution must be governed for compatibility, adding contract-stewardship overhead.
* Bad, because a template that requires another can state that requirement only in prose the tool does not read, so applying such a template alone succeeds and produces content with nothing to compose into; the failure surfaces where the content runs rather than where it was applied.
* The **description is optional**, so that manifests published before it was declared stay conforming and installable; the exclusion this buys is that a template declaring no description is not selectable from a stated intent and is reachable only by its exact reference.
* The manifest still carries **no template-classification field**: the description is the template's own prose about itself, not a value drawn from a taxonomy, so declaring it does not reintroduce the classification `cpt-frontx-adr-uniform-template-mechanism` removed.

### Confirmation

Compliance is confirmed by the pre-publish validation command itself acting as the contract check: a continuous-integration step runs pre-publish validation against a candidate template and fails the build if the template's manifest does not conform to the published shape, including a malformed ownership-boundary declaration (`cpt-frontx-fr-cli-template-validate-prepublish`). Design and code review additionally confirm that install, apply, and assembly read the same manifest shape that validation checks — one shape, one contract — that the manifest carries no template-classification field, that no command reads template file content from the manifest (content is read from the resolved installed path), and that no command embeds template-specific knowledge the manifest is meant to carry.

## Pros and Cons of the Options

### A single published manifest as the conformance contract

Every template publishes one defined, versioned manifest declaring identity, version, ownership boundaries, referenced templates, and a description of what the template establishes and contributes; validated at pre-publish and read at install, apply, and assembly.

* Good, because one description is the single source for validation, install, apply, and assembly.
* Good, because the CLI reads any conforming template generically without template-specific code.
* Good, because declared boundaries feed the conflict check, declared references feed preset resolution, and the declared description feeds selection.
* Neutral, because the concrete field schema is owned by the manifest FEATURE (`cpt-frontx-feature-template-manifest`) rather than fixed in the contract.
* Bad, because template authors must author and maintain a conforming manifest and boundary declaration.

### Convention-over-manifest structural inference

The CLI infers identity, ownership, and references from file-layout conventions and naming, with no published descriptor.

* Good, because template authors write no descriptor.
* Good, because there is no manifest shape to version.
* Bad, because the CLI is coupled to brittle layout heuristics that a template can break silently.
* Bad, because there is nothing concrete to validate before publication, and ownership boundaries cannot be declared for the conflict check to read, failing the pre-publish-checkability and declared-boundaries drivers.

### Per-command ad-hoc descriptors

Each command reads its own purpose-built descriptor file, so a template carries several partial descriptions.

* Good, because each descriptor is shaped exactly for its command.
* Bad, because several descriptions of one template can drift out of agreement.
* Bad, because there is no single conformance contract to validate or to evolve coherently.

## More Information

This decision fixes the manifest's role and the categories it declares at decision altitude only; the complete field-by-field manifest schema belongs to the owning FEATURE `cpt-frontx-feature-template-manifest`, per `cpt-frontx-adr-contract-schema-ownership`, and not to this decision record or DESIGN. The shape of the ownership-boundary declaration the manifest carries is decided in `cpt-frontx-adr-template-ownership-boundary-declaration`; the references a manifest declares are resolved and applied together by `cpt-frontx-adr-composed-template-resolution`, and the boundaries it declares are compared by `cpt-frontx-adr-assembly-conflict-prevention`; the base AI framework's capability that matches a stated intent against the description a manifest declares is bounded by `cpt-frontx-adr-solution-ai-content-placement`; that the manifest carries no template-classification field follows `cpt-frontx-adr-uniform-template-mechanism`. The pre-publish validation requirement is `cpt-frontx-fr-cli-template-validate-prepublish`. These are non-binding pointers and do not form part of this decision's durable identity.

Integration analysis (**INT**): the manifest is a bidirectional internal contract (`cpt-frontx-contract-template-manifest`) between templates and the CLI — produced when a template is validated for publication, consumed when a template is installed, applied, or assembled. Its producer is the template author (through pre-publish validation); its consumers are the install, apply, and assembly operations, preset resolution, and the conflict check. Version-compatibility intent is forward-looking: the manifest shape is versioned so the contract can evolve while manifests already published stay readable; any change to the shape that is not backward-compatible follows the platform evolvability requirement. The contract names no external party; it is internal between templates and the command surface.

Applicability of the remaining checklist categories: **PERF** — Not applicable, because reading a per-template manifest has no throughput or latency budget at decision altitude. **SEC** — Not applicable, because the manifest carries descriptive structure, not secret material or an authentication surface. **REL** — Not applicable, because there is no service availability target for a local manifest read. **DATA** — addressed by deliberate omission: this decision fixes the manifest's categories of information but does NOT define a complete schema; the full schema is owned by `cpt-frontx-feature-template-manifest` per `cpt-frontx-adr-contract-schema-ownership` (DATA-ADR-NO-001). **OPS** — Not applicable, because no operational procedure attaches to a manifest contract. **MAINT** — addressed: one versioned contract governs how every template describes itself, concentrating evolution in one place. **UX** — addressed implicitly: authors get a single descriptor to maintain and a single pre-publish check. **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-contract-template-manifest` - This decision fixes the role, declared categories (identity, version, ownership boundaries, referenced templates, description), and produce-once / consume-many lifecycle of the manifest contract every template conforms to.
* `cpt-frontx-fr-cli-template-validate-prepublish` — Pre-publish validation is defined here as the conformance check of a candidate template — including that its declared ownership boundaries are well-formed — against the published manifest shape.
* `cpt-frontx-fr-cli-template-boundary-declaration` — The manifest is where a template declares the boundaries of what it owns; this decision establishes the manifest as the carrier of that declaration.
