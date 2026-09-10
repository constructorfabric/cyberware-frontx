---
type: DESIGN
system: frontx-ui-kit
status: draft
---

# Technical Design - UI Kit

- [ ] `p3` - **ID**: `cpt-frontx-ui-kit-design-component-base`

<!-- toc -->

- [1. Architecture Overview](#1-architecture-overview)
  - [1.1 Architectural Vision](#11-architectural-vision)
  - [1.2 Architecture Drivers](#12-architecture-drivers)
  - [1.3 Architecture Layers](#13-architecture-layers)
- [2. Principles & Constraints](#2-principles--constraints)
  - [2.1 Design Principles](#21-design-principles)
  - [2.2 Constraints](#22-constraints)
- [3. Technical Architecture](#3-technical-architecture)
  - [3.1 Domain Model](#31-domain-model)
  - [3.2 Component Model](#32-component-model)
  - [3.3 API Contracts](#33-api-contracts)
  - [3.4 Internal Dependencies](#34-internal-dependencies)
  - [3.5 External Dependencies](#35-external-dependencies)
  - [3.6 Interactions & Sequences](#36-interactions--sequences)
  - [3.7 Database schemas & tables](#37-database-schemas--tables)
- [4. Additional context](#4-additional-context)
- [5. Traceability](#5-traceability)

<!-- /toc -->

## 1. Architecture Overview

### 1.1 Architectural Vision

The package is two things built on one component surface. It is a published React component library: behaviour taken from headless primitives, appearance expressed only through a semantic token vocabulary, one build entry per component so a consumer pays for what it imports, and documentation carried inside the artifact so a reader in a consuming project reads the version that project resolved. And it is the ecosystem's first attempt at making a component library's knowledge checkable rather than reviewable: for a component that has been described, a compiled contract states the component's meaning next to the prop facts read out of its own TypeScript.

The shape of the second half follows from one decision. The code is the owner of every fact the code can state - the exported components, their variant axes and defaults, the props they declare, the surface they inherit - and the hand-authored overlay owns only meaning: what the component is for, where it is the wrong choice, what may compose into it, what must never be done with it. The compiler joins the two and refuses an overlay that reaches into the machine's half. Everything downstream exists to keep that join honest: a conformance suite per described component, a freshness comparison that fails a change whose committed artifacts no longer equal a fresh compile, a compatibility comparison against the change's base reference that refuses a narrowing of a described surface unless the contract major moved, and a guard scoped to the components the change touches so the described set can grow without a kit-wide gate anyone would switch off.

The package is a full member of the published-libraries layer that is deliberately not *core*: it is committed to React, which is exactly what the layer's two independent properties exist to permit ([root DESIGN §1.3](../../../architecture/DESIGN.md#13-architecture-layers)).

### 1.2 Architecture Drivers

#### Functional Drivers

| Requirement | Design Response |
|-------------|------------------|
| `cpt-frontx-ui-kit-fr-component-set` | `cpt-frontx-ui-kit-component-package-build` emits one library entry per component's public barrel plus a package barrel, and the export map publishes the barrel, the per-component subpath and the three stylesheets while blocking every internal path. |
| `cpt-frontx-ui-kit-fr-token-styling` | `cpt-frontx-ui-kit-component-token-system` owns the whole appearance vocabulary; component stylesheets are CSS Modules that may consume only that vocabulary, and the seam is asserted rather than trusted (UIKIT-2). |
| `cpt-frontx-ui-kit-fr-theme-selection` | The token system defines the light values on the root and redefines them under both the preference query and the explicit theme attribute, so both selection paths resolve the same values. |
| `cpt-frontx-ui-kit-fr-client-boundary` | The build re-applies the client directive to the emitted chunk of every source module that declared one, deriving the classification from the source rather than from a maintained list. |
| `cpt-frontx-ui-kit-fr-agent-documentation` | `cpt-frontx-ui-kit-component-agent-documentation` keeps a usage document beside each component and copies them into the published artifact at build, with the index shipped at the package root. |
| `cpt-frontx-ui-kit-fr-consumer-acceptance` | `cpt-frontx-ui-kit-component-consumer-acceptance` packs the artifact and installs it into clean projects per bundler and module-resolution mode, probing for class names taken from the just-built artifact rather than hardcoded. |
| `cpt-frontx-ui-kit-fr-component-contract` | `cpt-frontx-ui-kit-component-contract-harness` compiles a described component's overlay together with facts read from its TypeScript into a props schema and a metamodel instance. |
| `cpt-frontx-ui-kit-fr-contract-single-fact-owner` | The compiler rejects an overlay carrying a machine-owned field, an unknown field, or a reference to a prop the component does not declare (UIKIT-1). |
| `cpt-frontx-ui-kit-fr-contract-unchecked-prop-report` | A contract's derived type stays open, annotating the classification of a prop nothing evaluates instead of rejecting it, and `cpt-frontx-ui-kit-component-contract-harness` owns the report that classifies a props object against a contract - known, unchecked, or one edit from a prop the contract declares. |
| `cpt-frontx-ui-kit-fr-contract-freshness` | The harness's freshness comparison is reached from two directions: a per-component conformance suite in the unit run, and the guard in the continuous-integration run. |
| `cpt-frontx-ui-kit-fr-contract-compatibility` | The harness compares a contract against the same contract at the change's base reference across three signals - the type system's own comparison, the declared-prop diff and the forwarded-surface diff - and accepts an incompatible result only when the contract major moved. |
| `cpt-frontx-ui-kit-fr-contract-incremental-coverage` | The guard's scope is the change's own file set widened to every enrolled component when the shared tooling itself changed; the enrollment report is a report and never an exit code (`cpt-frontx-ui-kit-principle-scoped-enforcement`). |

#### NFR Allocation

| NFR ID | NFR Summary | Allocated To | Design Response | Verification Approach |
|--------|-------------|--------------|-----------------|----------------------|
| `cpt-frontx-ui-kit-nfr-selective-cost` | A consumer pays only for what it imports | `cpt-frontx-ui-kit-component-package-build` | One build entry per component, per-entry style emission, side effects declared for stylesheets only, and shared code split into chunks rather than inlined into every entry. | The consumer acceptance run asserts both directions on a real consumer build: the imported component's style rules present, every other component's absent. |
| `cpt-frontx-ui-kit-nfr-gate-adoptability` | Enforcement scoped to the change | `cpt-frontx-ui-kit-component-contract-harness` | The guard evaluates only the components the change touches; the enrolled set is an opt-in allowlist and the enrollment report never sets an exit code. | The harness's own unit suites fix the guard's decisions and the enrollment report's non-blocking behaviour. |
| `cpt-frontx-ui-kit-nfr-standalone-verification` | Package-local verification | The package | Test and build configuration live in the package, including the contract tooling's own suites; nothing reaches into template territory. | The dependency-edge and boundary guards hold the package to its declared edges. |
| `cpt-frontx-nfr-evolvability` | Versioned releases without lockstep upgrades | The published package | The package publishes on its own version line with React as a peer range, and a substantive change to its shipping sources requires a version bump before it can merge. | The ecosystem version-policy and version-bump checks. |

**ADR coverage references:**

- `cpt-frontx-adr-ai-tooling-framework-packaging` - establishes the kit mechanism this package is the second adopter of, and the reserved resource prefix its own kit is to carry. The kit itself is decided and unbuilt.
- `cpt-frontx-adr-default-type-substrate-provider` - fixes the concrete type-definition specification the contract harness names its identifiers in and takes one of its three compatibility signals from. The dependency is on the specification's own build-time library, taken as a development dependency by the harness; nothing here reaches the runtime provider or the port it implements, and no published artifact carries it.

### 1.3 Architecture Layers

- [x] `p3` - **ID**: `cpt-frontx-ui-kit-tech-kit-stack`

```mermaid
graph TD
    subgraph Published[Published artifact]
        Comp["Components (one build entry each)"]
        Tokens["Token system (theme, utilities, typeset)"]
        Docs["Agent documentation (index + per-component docs)"]
    end
    subgraph Repo[Repository only]
        Harness["Contract harness (extract, compile, check)"]
        Overlay["Hand-authored overlays"]
        Artifacts["Committed contracts and metamodel instances"]
    end
    Comp --> Tokens
    Comp -- "behaviour" --> Primitives["Headless primitives"]
    Harness -- "reads props, axes, heritage" --> Comp
    Overlay -- "meaning only" --> Harness
    Harness --> Artifacts
    CI["Continuous integration"] -- "guard and compat, base ref" --> Harness
    Consumer["Consuming application"] -- "imports" --> Comp
    Consumer -- "reads" --> Docs
```

| Layer | Responsibility | Technology |
|-------|---------------|------------|
| Component surface | The exported components, their styles, their public entry points and the export map | React over TypeScript; headless primitives for behaviour; CSS Modules for styling; a variant-authoring library for the axes |
| Appearance vocabulary | The tokens every component's styling consumes, and the theme selection over them | Plain CSS custom properties in three global stylesheets |
| Package build | One entry per component, per-entry style emission, client-directive preservation, declaration emission and documentation copying | Library-mode bundler with a package-local build plugin |
| Agent documentation | A usage document per component and the index that lists them, shipped inside the artifact | Markdown, copied into the artifact at build |
| Contract harness | Fact extraction, contract compilation, conformance, freshness, compatibility, guard and enrollment | TypeScript run directly; the TypeScript compiler API for extraction; JSON Schema 2020-12 for the compiled surface; the ecosystem's type-definition specification for identifiers and one of the compatibility signals |

## 2. Principles & Constraints

### 2.1 Design Principles

#### The code owns every fact the code can state

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-principle-code-is-the-fact-owner`

A component's exports, variant axes, defaults, declared props, the primitive props it forwards as its own API and the host element it renders are read out of its TypeScript, never transcribed. The hand-authored half of a contract carries meaning and nothing else. This is what keeps the cost of describing a component proportional to the meaning being added, and it is why a contract cannot quietly disagree with the component: there is only one writable statement of each fact.

The alternative - authoring the surface and generating the code from it - was considered and not taken. It would move every component author onto a new authoring path to solve a problem the compatibility comparison solves directly, and it would make the description normative for components whose surface the kit does not own.

#### Appearance is a vocabulary, not a set of values

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-principle-styling-through-tokens`

Every appearance decision a component makes is expressed as a reference to a token the kit defines. A component stylesheet that introduces a colour or an off-scale metric has taken a decision away from the consumer, because rebranding then requires editing the kit rather than overriding it. The seam is one-directional: components consume the vocabulary, and the vocabulary knows nothing about any component.

#### Enforcement is scoped to the change, never to the kit

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-principle-scoped-enforcement`

Contract checks apply to the components a change touches and to the components explicitly opted in. Kit-wide completeness is reported and never enforced. A gate that fails on everything not yet described would start almost entirely red on a kit of this size, and a gate in that state is switched off rather than satisfied. Scoping enforcement to the change makes an enrolled component a by-product of ordinary work instead of a campaign.

### 2.2 Constraints

#### UIKIT-1 - An overlay states meaning only

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-constraint-overlay-meaning-only`

The hand-authored overlay may not restate a fact the compiler reads from the code, may not carry a field the overlay vocabulary does not define, and may not reference a prop the component does not declare. Each of the three is refused by name at compile time. This is the enforcement of `cpt-frontx-ui-kit-principle-code-is-the-fact-owner`.

#### UIKIT-2 - Component styling consumes only the kit's vocabulary

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-constraint-token-seam`

A component stylesheet may consume only variables the token system defines, plus the variables the underlying primitive supplies at runtime for positioning and animation. It may not declare a raw colour or an off-scale metric. The rule is asserted over the stylesheets themselves rather than left to review.

#### UIKIT-3 - A standalone published-libraries member that is not core

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-constraint-ui-committed-member`

The package is a member of the published-libraries layer holding one of that layer's two independent properties and not the other. It is not *core*, because it is committed to a UI framework. It is *standalone*, because standalone means declaring no intra-ecosystem package dependency, and the package declares none - the libraries it wraps are all external. Reading "not core" as "neither property" is exactly the conflation the root design keeps the two apart to prevent ([root DESIGN §1.3](../../../architecture/DESIGN.md#13-architecture-layers)); a UI-committed library that depends on no other member is precisely the case that separation admits. No ecosystem contract is permitted to privilege this package over another library in the same role.

#### UIKIT-4 - Contract artifacts are repository artifacts

- [ ] `p2` - **ID**: `cpt-frontx-ui-kit-constraint-contracts-repository-only`

Contracts, metamodel instances, overlays and the harness that produces them stay inside the repository and outside the published artifact. Nothing a consumer installs depends on them, and nothing in them may become load-bearing for a consumer while that holds. Lifting this is `cpt-frontx-ui-kit-fr-contract-distribution`, which is not built; until it is, a check against a contract can run here and not in a consuming project.

## 3. Technical Architecture

### 3.1 Domain Model

| Entity | Definition | Representation |
|--------|------------|----------------|
| Component | One exported React component together with its stylesheet, its usage document, its unit suite and its public entry point. | A directory under the component root; one build entry per public barrel |
| Token | A named appearance value the kit defines once for every component to consume. | A CSS custom property on the theme's root and theme blocks |
| Overlay | The hand-authored half of a contract: everything asserted about a component that its code cannot state - what it is for, where it is the wrong answer, what may nest inside it, what it claims about itself, what its schema cannot assert. | A YAML document beside the component, one per described export |
| Extraction | The machine-owned half: the exported components of a file with their variant axes, defaults, the host element each renders, and every prop filed by where its declaration lives - the component's own source, the primitive library's props for the part it wraps, or React's attributes for that element. | An in-memory result of reading the component's TypeScript through the compiler API |
| Contract | The compiled join of an overlay and an extraction, and the ONE document a reader needs: a props schema whose annotations carry everything the component means, deriving from the abstract type and no other, naming the surface of the element it renders as an identifier it holds, and annotating rather than rejecting a prop nothing evaluates. | A JSON Schema 2020-12 document committed beside the component |
| Metamodel instance | A thin typed record naming the contract as its props schema and the same host element surface the contract names. It repeats nothing the contract says: it exists so the two references resolve through a type registry. | A JSON document committed beside the component |
| Abstract component type | The one type every component contract derives from, and the only one: it declares no props, states which concepts a contract's meaning block carries, and says outright that nothing is ever validated against it. | A JSON Schema 2020-12 document under the harness, with its own type identifier |
| Metamodel type | The type every metamodel instance is an instance of: the shape of that thin record. | A JSON Schema 2020-12 document under the harness, with its own type identifier |
| Element type | The attributes React declares for one host element, forwarded by every component that renders it. Hand-written per element kind, not derived: the attributes of a `<button>` are the same for whoever renders one, so a per-component derivation produced near-copies of one fact. Referenced, never inherited: a set shared kit-wide by every component that renders the same element is something a component uses, so a contract holds its identifier and whoever wants its assertions applies it beside the contract. What more than one kind declares, each file declares identically, checked on the compile path; whether a file is complete is deliberately unverified. A prop the primitive library declares for its own part is NOT here - that is the component's API and lives in its contract's properties. | A hand-written JSON Schema 2020-12 document under the harness, one per element kind, with its own type identifier |
| Vocabulary type | One concept the overlay states, defined once and referenced by everything that carries it - a structured trait field's own shape, or a name/reference grammar several fields repeat. | A JSON Schema 2020-12 document under the harness, one per concept, each with its own type identifier |
| Enrolled set | The set of components opted into contract enforcement. | A committed list of component directory names |

#### One meaning document

Everything a component means is emitted ONCE, into its contract's own
`x-gts-traits` block: what it is for, where it is the wrong answer, what may
nest inside it, where it may be mounted, which family it belongs to, what it
claims about itself, what its schema cannot assert, and the props the kit does
not advertise. A component's meaning is processing metadata OF ITS TYPE, so a
runtime that acts on it reads the type's own annotations. The other block,
`x-uikit`, carries what the SOURCE says: the vocabulary version the contract
was compiled against, the props whose type no schema shape can express with
the checker's own printed type, where the variant axes come from, and every
fact the extraction could not read. The split is authored-versus-extracted,
and one routing map decides it for every field.

The metamodel instance carries no copy of any of it. It is a thin record - its
own identity, the metamodel version, its props schema and its host element's
surface - and it exists because those last two are the references the type
system resolves against a registry, which is a thing an annotation inside a
schema cannot be.

The normative reader is an agent holding one contract document with nothing
else loaded. Every choice between materializing a fact and deriving it on
demand is decided by that reader: what it needs in order to act correctly is
written into the document, even where the harness could recompute it, and what
only the harness needs stays computed. That is why a component's mount points
and a family root's member list are materialized although both are views over
other contracts' statements.

#### Contract type relationships

A contract has ONE parent: the abstract component type, which is what its
chained identifier says and what its schema body says. Everything else a
contract relates to it holds as an identifier, the host element's surface
included - a set shared kit-wide by every component that renders the same
element is something a component uses, not a second thing it is. The abstract
type is marked abstract: no props object is ever validated against it, only
against a component's own derived type.

The abstract type states which concepts a contract's meaning block carries;
each concept is a type of its own. A reference to another component is that
component's own derived contract identifier: a component IS the type derived
from the abstract type, so nothing else stands in for it.

Two kinds of edge, and the diagram distinguishes them: a **solid** arrow means
the source embeds an instance of the target, by reference to its identifier
from inside the schema; a **dashed** arrow means the source holds the target's
identifier as a value, annotated with what that identifier must resolve to.
Inheritance keeps its own arrow.

An identifier held as a value names a SPECIFIC contract major. When a
component's contract major moves, every reference to it moves with it: a
reference to a component that ships a contract must equal that contract's
current props-schema identifier exactly, and a reference to a component that
ships none may only name major 1. Those identifiers are resolved by each
component's conformance suite - against the component directory, and against
the contract identifier where a contract exists - not by the type registry:
the type system's own reference validator does not follow a reference into
another type, and most referenced components ship no contract yet, so the
directory is what says the kit ships that component at all.

A meaning field whose shape another type owns references that type; only
`intent`, `typical_uses` and `forwards_to` stay inline. `intent` and
`typical_uses` are the two fields a selection card is read from - a sentence
and a capped list of strings, with no shape of their own worth a type.
`forwards_to` is the one meaning-block identifier the type system's own
reference walk must find directly on an instance property rather than behind
another reference, and also the one field of the block an overlay may not
write - which element a component forwards to is a fact of its source - so
the compiler supplies it, and it is absent for a component that forwards to
no host element of its own.

Every other structured field is a vocabulary type of its own, including the
ones that read as prose: `invariants` and `anti_patterns` are lists of a
named type (`invariant`, `anti_pattern`), `examples` embeds `example_pair`,
and `withheld` embeds `withheld_prop`. What the schema cannot assert about a
component's own properties is authored in `props`, keyed on the property
itself (`prop_statement`, the compiler emits it into that property's
description); what the kit composes internally but does not expose as a
component of its own is `unexposed_parts` (`unexposed_part`) - the other half
of "what the kit deliberately does not offer" beside `withheld`, which names
a prop rather than a part.

A component's derived type is left open rather than closed: its
`unevaluatedProperties` carries the annotation `x-uikit-classification:
unchecked`, so a prop nothing in the schema evaluates is admitted and reported
by the harness rather than rejected by a validator that cannot tell a typo'd
kit prop from an attribute nobody has classified yet. That openness is also
what admits a forwarded attribute, which is why holding the surface as an
identifier rather than merging it in changes nothing a consumer may pass: a
validator that resolves the identifier applies the surface's own assertions
beside the contract, and one that does not gets the open classification.

Where a surface and a meaning field speak about the same thing, the meaning
governs. The surface for `<div>` admits `children`, because React does; a
contract whose `accepts` says `content: nothing` states that the component
takes no children at all, and that statement is the answer - the validator
accepting a `children` prop against the element surface is not a permission to
pass one. The surface describes the element; `accepts` describes the component.

Two relationships are FILLED by the compiler rather than authored, and both
run in the direction the fact actually runs. A component's accepted components
are stated by that component; its mount points are computed from every other
contract's accepted components across the whole described set, so the two
directions of one relationship cannot disagree - authored on both sides, a
part could name a parent whose own accepted list never mentioned the part. A
mount point outside the kit has no contract to compute from, so it is authored
beside the filled ones. A family works the same way: every member names the
family by a token and states its own role, and the root's member list is the
view over those statements. Exactly one member of a family is its root, and a
family with no root is refused by name.

```mermaid
classDiagram
    class AbstractType["Abstract component type"]
    class MetaType["Metamodel type"]
    class Contract["Component contract"]
    class Instance["Metamodel instance"]
    class Element["Element type"]
    class Rule["dont_use_when_rule"]
    class Recommendation["recommendation"]
    class Accepted["accepted_content"]
    class MountPoint["mount_point"]
    class Invariant["invariant"]
    class AntiPattern["anti_pattern"]
    class Deprecations["deprecations"]
    class PropDeprecation["prop_deprecation"]
    class Attestation["attestation"]
    class PropStatement["prop_statement"]
    class UnexposedPart["unexposed_part"]
    class ExamplePair["example_pair"]
    class WithheldProp["withheld_prop"]
    class Family["family_membership"]
    class Slot["slot"]
    class Capability["capability"]
    class Companion["companion"]

    Contract --|> AbstractType : derives from
    Contract ..> Element : host element surface
    Instance ..> MetaType : typed by
    Instance ..> Contract : props schema
    Instance ..> Element : host element surface
    AbstractType --> Rule : dont_use_when
    AbstractType --> Accepted : accepts
    AbstractType --> MountPoint : mounted_in (filled)
    AbstractType --> Invariant : invariants
    AbstractType --> AntiPattern : anti_patterns
    AbstractType --> Deprecations : deprecations
    AbstractType --> Attestation : attestations
    AbstractType --> PropStatement : props
    AbstractType --> UnexposedPart : unexposed_parts
    AbstractType --> ExamplePair : examples
    AbstractType --> WithheldProp : withheld
    AbstractType --> Family : family_membership
    AbstractType --> Slot : slots
    AbstractType --> Capability : capabilities
    AbstractType --> Companion : companions
    Rule --> Recommendation : instead
    Recommendation ..> Contract : the kit component to use
    Accepted ..> Contract : accepted component
    MountPoint ..> Contract : filled from another contract's accepts
    Deprecations --> PropDeprecation : per prop
    Family ..> Contract : members, filled on the root
```

| Type | References | Cardinality | Owner of the fact |
|------|------------|-------------|-------------------|
| Component contract | the abstract component type, and the element type for its host element as an identifier it holds | exactly one abstract parent, zero or one element type | the compiler builds it; the extraction owns the prop facts, the overlay author the meaning |
| Metamodel instance | the metamodel type, the component contract, the same element type its contract names | exactly one of each of the first two, zero or one element type | the compiler |
| Abstract component type | one field-level vocabulary type per meaning field whose shape that type owns | one each | the builder of the schema it carries |
| Metamodel type | nothing; it describes a record of identifiers | one | the metamodel builder |
| Element type | nothing; component contracts and their instances hold its identifier | one type per element kind, referenced by one or more contracts - a committed file no contract names fails a described component's conformance suite | hand-written; whoever adds an element kind decides what that element accepts |
| dont_use_when_rule | a recommendation | exactly one per rule; at least one rule per contract | the overlay author |
| recommendation | a component contract, optionally | zero or one component per recommendation; `target` always | the overlay author, the reference resolved by the conformance suite |
| accepted_content | component contracts | required, exactly one per contract; `components`/`text` only where `content` is `specified`; `icons_via` names one of the component's own props, and only where `content` is `specified` | the overlay author, prop name and references checked against the extraction and the kit |
| mount_point | a component contract, optionally | zero or more; absent when there is none; `container` always, `component` filled by the compiler from every other contract's accepted components, `note` authored on the half `component` leaves unfilled | the compiler fills `container`+`component` for a kit component; the overlay author writes `container`+`note` for a container outside the kit |
| invariant | nothing | zero or more per contract | the overlay author |
| anti_pattern | nothing | zero or more per contract | the overlay author |
| deprecations | prop deprecations | zero or more, keyed by prop name | the overlay author |
| prop_deprecation | nothing; `replacement` names one of the component's own props | exactly one per deprecated prop | the overlay author, prop name and replacement checked against the extraction |
| attestation | nothing | one per claim; the map is open beyond the kit's two required claims, so a claim name the kit adds validates without a schema change | the overlay author |
| prop_statement | nothing; keyed by one of the component's own properties | zero or more per contract, keyed on the property; required for every property the schema does not state in full and forbidden for one it states completely, paired both ways against the compiled properties | the overlay author, key checked against the extraction; the compiler emits it into that property's own description |
| unexposed_part | nothing | zero or more per contract | the overlay author |
| example_pair | nothing | one or more per `good`/`bad` list; a `bad` entry additionally requires `why` | the overlay author |
| withheld_prop | nothing; `prop` names one of the primitive's own props | zero or more per contract | the overlay author, prop name checked against the extraction |
| family_membership | component contracts | one membership per member; a root carries the filled member list, a part carries none; exactly one root per family name | the overlay author for the family token and the role, the compiler for the members |
| slot | nothing; `prop` names one of the component's own props | zero or more per contract; `typed_by` present only where the schema cannot state the type | the overlay author, prop name checked against the extraction |
| capability | nothing; `enabled_by` names one of the component's own props | zero or more per contract | the overlay author, prop name checked against the extraction |
| companion | nothing; `export` names another export of the component's own module | zero or more per contract | the overlay author |

### 3.2 Component Model

#### Component Surface

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-component-component-surface`

Concrete artifact: the component directories and the package barrel of `@gears-frontx/ui-kit`.

##### Why this component exists

A consuming application needs components whose behaviour it does not have to implement and whose appearance it can rebrand. This is that surface: each component takes its interaction behaviour and accessibility from a headless primitive, declares its own variant axes and props, and carries its styling in a module scoped to itself.

##### Responsibility scope

- Exports one React component per component directory, behind that directory's public entry point and the package barrel.
- Declares each component's variant axes and defaults in the code, which is what makes them machine-readable.
- Redeclares the props the kit narrows or adds, leaving everything else to the primitive's own surface.
- Carries the client-boundary directive in the source of exactly those components that call a hook in their own render body.

##### Responsibility boundaries

- Owns no appearance value: every one is a reference to the token system (UIKIT-2).
- Owns no interaction mechanics that the primitive it wraps already provides.
- Owns no application domain content and no data access.
- Does not decide how it is bundled or published; that is the package build's responsibility.

##### Related components (by ID)

- `cpt-frontx-ui-kit-component-token-system` - supplies the entire appearance vocabulary these components consume.
- `cpt-frontx-ui-kit-component-package-build` - turns each public entry point into a published entry.
- `cpt-frontx-ui-kit-component-contract-harness` - reads these components' TypeScript as the machine-owned half of a contract.

#### Token System

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-component-token-system`

Concrete artifact: the package's three global stylesheets and the seam guard over them.

##### Why this component exists

Rebranding must be an override, not a fork. That requires exactly one place where an appearance value is decided, and a rule that components reference it rather than restating it.

##### Responsibility scope

- Defines the radius, spacing, control-metric, elevation, colour and type-ramp vocabulary as custom properties.
- Defines both themes: the light values on the root, redefined under the viewer's preference and under an explicit theme declaration, so a document or any subtree can be pinned.
- Ships as global stylesheets an application imports once, separate from the per-component style emission.

##### Responsibility boundaries

- Knows nothing about any component: the dependency runs one way only.
- Does not own component layout or component-local structural CSS; those live in the component's own module and consume this vocabulary.
- Does not ship font files; it names families and leaves their delivery to the consuming application.

##### Related components (by ID)

- `cpt-frontx-ui-kit-component-component-surface` - the sole consumer of this vocabulary.

#### Package Build

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-component-package-build`

Concrete artifact: the package's library build configuration and its build plugin.

##### Why this component exists

Nearly every property a consumer depends on is decided at build time and invisible in the source: whether a component's styles are emitted as their own artifact, whether the client directive survives bundling, whether the declaration files resolve under a consumer's module resolution, and whether importing one component pulls in the rest.

##### Responsibility scope

- Emits one library entry per component public entry point plus the package barrel, with shared code split into chunks rather than duplicated.
- Emits each entry's styles as their own artifact and marks stylesheets as the package's only side effects, so a bundler that honours the declaration can drop the rest.
- Re-applies the client-boundary directive to the emitted chunk of every source module that declared one, deriving the set from the source rather than from a maintained list.
- Emits declarations and the flat re-export shims that make the per-component subpath resolve under both module-resolution modes.
- Copies the global stylesheets and the per-component usage documents into the published artifact.

##### Responsibility boundaries

- Decides nothing about a component's behaviour or appearance.
- Publishes no contract artifact and no harness source (UIKIT-4).
- Does not verify its own output; that is the consumer acceptance component's responsibility, and deliberately so, because a build cannot observe the properties that only fail at a consumer.

##### Related components (by ID)

- `cpt-frontx-ui-kit-component-component-surface` - supplies the entry points.
- `cpt-frontx-ui-kit-component-agent-documentation` - supplies the documents this build copies into the artifact.
- `cpt-frontx-ui-kit-component-consumer-acceptance` - checks this component's output from outside.

#### Agent Documentation

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-component-agent-documentation`

Concrete artifact: the per-component usage documents, the index at the package root, and the guard that holds them to the component set.

##### Why this component exists

An agent writing application code reads what the project installed. Documentation that lives anywhere else describes a version the project may not have, and the reader cannot tell.

##### Responsibility scope

- Keeps one usage document per component beside that component, and ships a copy of each inside the published artifact.
- Ships an index at the package root naming every component's document path together with the rules that apply across the kit.
- Holds the set to the component set: every exported component has a document, is named in the index, and has the values of its stylesheet's styling axes named in its document.

##### Responsibility boundaries

- Carries prose, not a checkable contract. What a tool can verify lives in the contract harness's artifacts, not here.
- The documents are authored, not generated; the build copies them and adds nothing.
- Does not describe composition above a single component.

##### Related components (by ID)

- `cpt-frontx-ui-kit-component-package-build` - copies these documents into the published artifact.
- `cpt-frontx-ui-kit-component-contract-harness` - the checkable description of the same components, for the described subset.

#### Contract Harness

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-component-contract-harness`

Concrete artifact: the contract tooling under the package's `scripts/contracts/` directory, together with the compiled artifacts committed beside each described component.

##### Why this component exists

Prose describing a component can only be reviewed. This component produces a description a tool can act on, and then keeps that description honest: nothing else in the package can tell whether a description has fallen behind the code it describes, or whether a change narrowed a surface a consumer depends on.

##### Responsibility scope

- Reads a component's TypeScript for its exported components, variant axes and defaults, the host element each renders, and every prop filed by where its declaration lives - the component's own source, the primitive library's props for the part it wraps, or React's attributes for that element.
- Validates the hand-authored overlay against the overlay vocabulary and refuses one that reaches into the machine's half (UIKIT-1).
- Compiles the two into a props schema carrying everything the component means, and a thin metamodel instance naming it - filling the component's mount points from every other contract's accepted components and a family root's members from every contract naming that family.
- Constructs the identifiers the contracts are named in, following the type-definition specification's segment grammar, taking each component's contract major from that component's own overlay so the compatibility gate's acknowledgement costs one component rather than the kit.
- Routes each meaning field to the block a validator reads through one map, emits what the extraction found into the other, and defines every meaning field once for both the schema that checks a contract and the schema an author is held to, by reference to the vocabulary type that owns each concept (see 3.1).
- Writes the schemas that belong to no single component - the abstract component type, the metamodel, the vocabulary types - from their builders, so the identifier grammar has one source and a stale committed copy is a comparison failure rather than a silent divergence.
- Supplies the per-component conformance suite that fails when a committed artifact no longer equals a fresh compile.
- Decides compatibility against a base reference and requires a contract major move for an incompatible difference.
- Reports the classification of a prop nothing in a contract evaluates - known, unchecked, or a near miss of a prop the contract declares - because the contract is left open rather than closed and a schema cannot make that distinction.
- Decides which components a change must be held to - the directories it touches, widened to every described component when anything that reshapes a compiled contract changes, including a dependency the checker's printed type text comes from - and reports how much of the kit is enrolled without failing on it.
- Changes the package's own build tooling where its own compilation and linting need it - the TypeScript project layout separating shipping source from tooling and tests, and the lint scope that covers the harness - since that configuration is the package's own (`cpt-frontx-ui-kit-nfr-standalone-verification`) and reaches no consumer (UIKIT-4); such a change is recorded in the package's committed configuration, which the package's own type-check and lint scripts run against.

##### Responsibility boundaries

- Never edits a component: the code is the fact owner, and a disagreement is reported, not repaired (`cpt-frontx-ui-kit-principle-code-is-the-fact-owner`).
- Produces nothing a consumer installs (UIKIT-4).
- Does not decide when it runs. The base reference and the invocation come from outside the package, so the same tool serves a local run and a continuous-integration run without knowing which it is in.
- Owns no meaning of its own: every semantic statement in a contract came from an overlay a person wrote.

##### Related components (by ID)

- `cpt-frontx-ui-kit-component-component-surface` - the subject it reads and the code it holds the contracts to.
- `cpt-frontx-ui-kit-component-agent-documentation` - the prose description of the same components; the two are independent and neither generates the other.

#### Consumer Acceptance

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-component-consumer-acceptance`

Concrete artifact: the package's consumer verification script and the clean projects it builds.

##### Why this component exists

The properties a consumer depends on most - that styles survive, that unimported components cost nothing, that types resolve - are decided by the interaction between this package's manifest and a consumer's bundler. None of them can be observed from inside this package's own build.

##### Responsibility scope

- Packs the artifact and installs it into clean projects, one per bundler and module-resolution mode a consumer may use.
- Asserts both directions on each: the imported component's code and styles present, every other component's absent, using probes taken from the just-built artifact rather than hardcoded.
- Asserts that the artifact carries the documentation index and the per-component documents.
- Asserts the client-boundary classification against the built artifact, and fails on a component the classification does not mention.

##### Responsibility boundaries

- Reports on this package only; it is not a test of the bundlers, which is why their versions are pinned.
- Does not run in the unit lane: it packs and installs, and belongs in a slower one.
- Checks the published artifact, not the source.

##### Related components (by ID)

- `cpt-frontx-ui-kit-component-package-build` - the component whose output this one accepts or rejects.

### 3.3 API Contracts

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-interface-package-entry`

- **Contracts**: `cpt-frontx-ui-kit-interface-component-package`, `cpt-frontx-ui-kit-interface-agent-documentation`
- **Technology**: ECMAScript-module package with TypeScript declarations; CSS Modules per component; global stylesheets as separate exports
- **Location**: [src/index.ts](../src/index.ts)

| Public surface | Purpose |
|----------------|---------|
| Package barrel | Every exported component, for a consumer that prefers one import site. |
| Per-component subpath | One component and its styles, for a consumer minimizing what it takes. |
| Global stylesheets | The token vocabulary, the utility layer and the type ramp, imported once by an application. |
| Documentation index and per-component documents | The agent-facing description, read from the install. |

Two path shapes are deliberately not public: the internal component module layout, which is blocked in the export map so it stays free to change, and the contract artifacts, which are not in the published artifact at all (UIKIT-4).

### 3.4 Internal Dependencies

The package declares no dependency on another ecosystem package, which is what makes it standalone (UIKIT-3). Every library it does depend on is external; being committed to a UI framework costs it the core property, not the standalone one.

What the package may depend on, and which members may depend on it, is not yet settled by an accepted decision. Until one lands, that policy is enforced by the repository's interim dependency-cruiser rules, which hold the package isolated in both directions: no existing ecosystem package may acquire a dependency on it, and it may acquire none of its own. Those rules are deliberately untraced - there is no decision for them to cite yet - and they remain the enforcement of this boundary until there is.

**Dependency Rules** (per project conventions):
- No import of template territory
- No dependency on another ecosystem package's implementation
- The contract harness imports from the package's own sources only through the TypeScript compiler API, so it reads components without linking them

### 3.5 External Dependencies

#### Headless component primitives

| Dependency Module | Interface Used | Purpose |
|-------------------|----------------|---------|
| Primitive component libraries | Component props and behaviour of unstyled primitives | Supply interaction behaviour and accessibility so the kit owns appearance and composition only. The props they declare for a part are the wrapping component's own API, and reach its contract as such. |

**Dependency Rules** (per project conventions):
- Behaviour comes from a primitive; a component does not reimplement interaction mechanics the primitive provides
- A primitive's appearance decisions are overridden through the token vocabulary, never adopted

#### Component capability libraries

| Dependency Module | Interface Used | Purpose |
|-------------------|----------------|---------|
| Data-grid library | Table model, column definitions, row selection, pagination | Supplies the data-table component's model layer, which is why that component's props carry type parameters the contract compiler can only record as slots. |
| Charting library | Chart primitives | Supplies the chart component's rendering. |
| Command-palette library | Filterable command list | Supplies the command component's matching and keyboard model. |
| Date libraries | Calendar rendering and date arithmetic | Supply the calendar and date-picker components. |
| Carousel library | Carousel engine | Supplies the carousel component. |
| Resizable-panels library | Panel group and drag handles | Supplies the resizable component. |
| Icon set | Icon components | The kit's icon vocabulary, referenced by components that render icons. |
| Secondary primitive library | Headless behaviour for two components | Supplies the behaviour of the two components not built on the main primitive family. The contract compiler can place their props in neither of the two families it recognizes, which is why they are outside the enrolled set today. |

**Dependency Rules** (per project conventions):
- Each of these belongs to the component that needs it; none becomes a kit-wide concern, and none is re-exported
- A component's appearance stays on the token vocabulary regardless of what its capability library ships (UIKIT-2)
- `cpt-frontx-ui-kit-nfr-selective-cost` is about what reaches a consumer's *bundle*, not what reaches its install graph: these are runtime dependencies of the package and are installed whether or not the components needing them are imported. Keeping them out of an unimporting consumer's build is the per-entry emission the package build is responsible for.

#### Variant authoring

| Dependency Module | Interface Used | Purpose |
|-------------------|----------------|---------|
| Variant-authoring library | Variant declaration and the type it derives | Declares each component's axes and defaults in the code, which is what lets the contract compiler read them rather than have them transcribed. |

**Dependency Rules** (per project conventions):
- Axes are declared through this library so they stay machine-readable; a component that hides its axes behind an indirection the compiler cannot follow is a component to change

#### Type-definition specification and schema validation

| Dependency Module | Interface Used | Purpose |
|-------------------|----------------|---------|
| Type-definition specification | Identifier grammar, entity validation, backward-compatibility comparison | Names the contracts, validates a contract's validator-read block against the base type's trait schema, and contributes one of the three compatibility signals. |
| JSON Schema validator | Draft 2020-12 validation | Validates an overlay against the overlay vocabulary and an assembled artifact against the metamodel before anything is written. |
| TypeScript compiler API | Program, type checker, declaration resolution | Reads a component's exports, axes, props and heritage by resolved symbol identity rather than by written name. |

**Dependency Rules** (per project conventions):
- These three are used by the contract harness only and reach no published artifact (UIKIT-4)

### 3.6 Interactions & Sequences

#### Describing a component and guarding a change to it

- [x] `p3` - **ID**: `cpt-frontx-ui-kit-seq-contract-compile-and-guard`

**Use cases**: `cpt-frontx-ui-kit-usecase-describe-and-change-component`

**Actors**: `cpt-frontx-ui-kit-actor-kit-developer`, `cpt-frontx-ui-kit-actor-continuous-integration`

```mermaid
sequenceDiagram
    participant Dev as Kit developer
    participant CLI as Contract compiler
    participant TS as TypeScript program
    participant FS as Committed artifacts
    participant CI as Continuous integration
    Dev->>CLI: compile the component's contracts
    CLI->>TS: read exports, axes, defaults, props, heritage
    TS-->>CLI: extraction (or an unresolvable-axis failure)
    CLI->>CLI: validate the overlay; refuse a machine-owned, derived or unknown field
    alt a prop the extractor cannot place, or no host element for the forwarded ones
        CLI-->>Dev: refuse, naming the props and where they are declared
    else
        CLI->>FS: write the contract and the instance
        CLI-->>Dev: the written paths
    end
    Dev->>CI: submit the change
    CI->>CLI: guard against the base reference
    CLI->>FS: recompile each in-scope component and compare
    CLI-->>CI: stale or missing artifacts, or clear
    CI->>CLI: compatibility against the base reference
    CLI->>FS: read each contract here and at the base reference
    CLI-->>CI: compatible, incompatible with the major moved, or refused
```

**Description**: The two halves of the harness meet the same artifacts from opposite directions. Compilation is a developer action that writes; guarding and compatibility are continuous-integration actions that only read and compare. The failure that matters most is the quiet one in the middle: a component changed without recompiling. It is caught twice - by the component's conformance suite in the unit run, and by the guard in the continuous-integration run - because those two runs fail for different people at different moments.

### 3.7 Database schemas & tables

Not applicable. The package holds no database and no persistence. Its schemas are JSON Schema documents committed in the repository and read from disk.

## 4. Additional context

Two facts about the current state are worth stating so they are not read as design intent. The enrolled set is a small opt-in subset of the component set, by the design in `cpt-frontx-ui-kit-principle-scoped-enforcement`, and the number is expected to grow with ordinary work rather than through a campaign. And the compiler places a prop's declaration in two families - the primitive family most of the kit is built on, whose props for a part are the component's own API, and React's DOM attribute types, which are the surface a component forwards. A component built on another primitive family has props the compiler can place in neither, and is refused rather than described with half its API filed as forwarded surface; extending that is design work on the classifier, not configuration.

The package is also the second adopter of the Constructor Studio kit mechanism, reserving its own resource prefix so its resources cannot collide with the AI tooling framework's (`cpt-frontx-adr-ai-tooling-framework-packaging`). That kit is decided and unbuilt; this design describes no part of it as existing.

One decision inside the knowledge layer is open, and it gets more expensive the longer the enrolled set grows:

- **The vendor namespace the contract identifiers are built on.** A shorter form and a form carrying a design segment were both proposed and neither was settled. The identifier construction keeps the namespace in a single constant precisely so the change stays a one-line edit, but every committed contract, instance and host-element surface carries the namespace in its own identifier, so the cost of changing it is proportional to the described set. Trigger: settle it before the enrolled set grows past the pilot components.
Two questions that were open are settled, and the answers are stated here because both shape the artifacts a reader gets:

- **Where a component's meaning lives.** It is processing metadata of the type, and it lives in the type's own annotations: everything a component means is emitted once, into its contract's `x-gts-traits`, and a runtime that acts on it reads it there. The metamodel instance carries no copy - it names the contract and the surface of the host element, which are the two references a type registry resolves. The routing map remains the one place that would change if the answer changed.
- **What a contract's version is.** One version: the props schema's own major, moved when a shape narrows under the compatibility rules. The guidance a contract carries - what the component is for, the recommendations, the invariants, the attestations - is not versioned by the contract, because nothing consumes it under a compatibility promise: its currency is guarded by the freshness comparison against the source, and a guidance change that reflects a behaviour change rides the kit's own package version the way the behaviour does. The metamodel version is a third axis and belongs to the vocabulary, not to any component.

## 5. Traceability

- **PRD**: [PRD.md](./PRD.md)
- **ADRs**: [root ADR/](../../../architecture/ADR/) - this package owns no ADR of its own; the decisions it answers to are `cpt-frontx-adr-ai-tooling-framework-packaging` and `cpt-frontx-adr-default-type-substrate-provider`, both root-owned.
- **Features**: [features/](./features/)
- **Root chain**: [PRD](../../../architecture/PRD.md), [DESIGN](../../../architecture/DESIGN.md), [DECOMPOSITION](../../../architecture/DECOMPOSITION.md)

This package's requirements are owned by its own [PRD](./PRD.md), per the 3-layer model: each member explains its own requirements, and the root PRD describes the layers and the requirements binding every member equally.
