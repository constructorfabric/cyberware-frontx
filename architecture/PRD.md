# PRD - FrontX Ecosystem

<!-- toc -->

- [1. Overview](#1-overview)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Background / Problem Statement](#12-background--problem-statement)
  - [1.3 Goals (Business Outcomes)](#13-goals-business-outcomes)
  - [1.4 Glossary](#14-glossary)
- [2. Actors](#2-actors)
  - [2.1 Human Actors](#21-human-actors)
  - [2.2 System Actors](#22-system-actors)
- [3. Operational Concept & Environment](#3-operational-concept--environment)
  - [3.1 Module-Specific Environment Constraints](#31-module-specific-environment-constraints)
- [4. Scope](#4-scope)
  - [4.1 In Scope](#41-in-scope)
  - [4.2 Out of Scope](#42-out-of-scope)
- [5. Functional Requirements](#5-functional-requirements)
  - [5.1 Ecosystem-Level Requirements](#51-ecosystem-level-requirements)
- [6. Non-Functional Requirements](#6-non-functional-requirements)
  - [6.1 NFR Inclusions](#61-nfr-inclusions)
  - [6.2 NFR Exclusions](#62-nfr-exclusions)
- [7. Public Library Interfaces](#7-public-library-interfaces)
  - [7.1 Public API Surface](#71-public-api-surface)
  - [7.2 External Integration Contracts](#72-external-integration-contracts)
- [8. Use Cases](#8-use-cases)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Dependencies](#10-dependencies)
- [11. Assumptions](#11-assumptions)
- [12. Risks](#12-risks)

<!-- /toc -->

## 1. Overview

### 1.1 Purpose

The FrontX Ecosystem exists to enable AI-driven creation of frontend projects. It gives teams a product set in which AI agents can reliably scaffold, extend, and evolve frontend projects by targeting stable, narrow, explicitly-contracted product capabilities instead of improvising against an open-ended codebase.

The ecosystem is delivered in three layers, and this PRD describes the layer approach. **Published libraries** are consumed as versioned dependencies. **Templates** define what any given project becomes; they are hosted outside this repository and applied to produce content the receiving project owns. **Projects orchestration** acts on a project's lifecycle across the other two layers: it creates, assembles, and upgrades projects, and gives AI agents the fluency to do so. Membership in each layer is a property, not a list this document maintains; the current members and their artifacts are located through the [DESIGN's member pointers](./DESIGN.md#member-pointers).

Each member of each layer owns the PRD that explains its own requirements, in its package's `architecture/` tree; the CLI's artifacts own the ecosystem's contract to templates. This root PRD owns what no member can: the layer approach itself, the actors and vocabulary shared across layers, and the requirements that bind every member equally.

Together the layers let an AI agent carry a frontend project from first scaffold through ongoing extension and version upgrades, while the human Template Developers and Project Developers steering the work stay in control of intent and review. The product's value is measured by how predictably and safely AI agents and their human collaborators can produce and maintain real frontend applications on top of it.

### 1.2 Background / Problem Statement

Teams building frontend projects increasingly depend on AI agents to do the work — scaffolding new projects, adding features, and keeping projects current as their foundations evolve. For an AI agent to do this reliably, it needs a product surface that is stable, narrow, and explicitly contracted, so the agent targets well-defined capabilities rather than guessing at the shape of an open-ended codebase.

Two groups of people, each working alongside AI agents, have distinct needs. **Template Developers** design, version, and publish the templates that other teams build from; they need stable product contracts, pre-publish validation, semantic-versioning discipline, a way to declare the boundaries of what a template owns so independently-authored templates assemble without conflict, and a way to bundle template-specific AI capabilities. **Project Developers** assemble a repository from one or more templates and then build business code on top; they need predictable assembly output, reliable per-template upgrades, a clear boundary between what the product provides and what the application must supply, and AI agents that already understand both the ecosystem and the specific templates in use.

Across both groups, three needs recur: stable, narrow contracts an AI agent can target; a repository lifecycle — install, apply, assemble, validate, and upgrade — that an AI agent can drive end to end; and AI tooling that knows the ecosystem out of the box and can be extended with knowledge specific to each template. The FrontX Ecosystem addresses these needs directly, so that AI-driven frontend development is predictable and safe for both the people directing it and the agents performing it.

### 1.3 Goals (Business Outcomes)

- **Single-operation scaffolding** — A Project Developer (or an AI agent acting for one) can assemble a working repository from one or more templates in a single operation: one command, no manual wiring step between templates, and no partially-assembled repository left behind when it refuses. Baseline: not yet measured (new product); Target: 100% of supported assemblies complete or refuse whole in one invocation; Timeframe: at the first platform release. A duration ceiling is deliberately NOT stated here: no baseline measurement exists yet, and an unquantified "bounded" target would be unfalsifiable at approval time. The scale thresholds the assembly path is actually held to are the ones its NFRs carry (`cpt-frontx-cli-nfr-template-scale`), and a wall-clock ceiling is published with the release-notes figure once there is a measurement to set it from.
- **Reviewable, reversible upgrades** — Every upgrade of an applied template to a newer version is applied as a reviewable change set that a developer approves before it touches repository files, with non-destructive rollback. Baseline: none (new product); Target: 100% of upgrades review-gated; reversible for one generation, where the preceding origin still resolves to the version recorded beside it; Timeframe: first platform release.
- **Automatic activation of template AI extensions** — When a template that bundles AI capabilities is installed in a project, those capabilities become available to AI agents automatically, with no manual wiring by the developer. Baseline: none (new product); Target: zero manual wiring steps for template-bundled AI capabilities; Timeframe: first platform release.
- **Compatibility within a major version** — Platform releases preserve backward compatibility within a major version, so consuming applications are not forced to upgrade in lockstep with the product. Baseline: none (new product); Target: zero breaking changes to published product contracts within a major version line; Timeframe: ongoing from the first major release.
- **No architectural ceiling on application scale** — The platform places no upper limit on the number of microfrontends or type definitions an application integrates, beyond the thresholds stated in the non-functional requirements. Baseline: none (new product); Target: scale governed only by the stated NFR thresholds, not by product architecture; Timeframe: first platform release.
- **Accounted member governance** — every FrontX-owned workspace package is classified in the layer model, and every classified member owns local architecture artifacts or visible debt with a removal criterion. Target: 100% classified, 100% with a local PRD/DESIGN/FEATURE chain or path-scoped debt entry; Timeframe: maintain on every accepted release.

### 1.4 Glossary

| Term | Definition |
|------|------------|
| ecosystem | The FrontX product set as a whole. |
| platform | The versioned runtime foundation an application is built upon and depends on at runtime. Distinct from "ecosystem", which is the whole FrontX product set. |
| published library | A versioned dependency installed by a consuming application. |
| template | A generator of project content, applied into a receiving repository. |
| projects orchestration | Tooling that creates, assembles, upgrades, or reasons about a project. |
| member | A FrontX-owned unit classified into one ecosystem layer. |
| artifact chain | A member-owned PRD, DESIGN and at least one FEATURE. |
| project | The repository a Project Developer builds and maintains. |
| application | The running frontend product built from a project. |

Runtime vocabulary used by the requirements below is owned by the members that implement it: *microfrontend* and *extension* are defined by the runtime member's PRD ([mfes PRD §1.4](../packages/mfes/architecture/PRD.md#14-glossary)); *type definition* is defined by the type-system member's PRD ([gts-plugin PRD §1.4](../packages/gts-plugin/architecture/PRD.md#14-glossary)).

## 2. Actors

### 2.1 Human Actors

#### Template Developer

**ID**: `cpt-frontx-actor-template-developer`

**Role**: Designs, authors, versions, and publishes templates that other teams build from. Works alongside AI agents throughout this work.
**Needs**: Stable product contracts; pre-publish validation tooling; semantic-versioning discipline tooling; reference templates; a way to declare the boundaries of what a template owns; support for bundling template-specific AI capabilities.

#### Project Developer

**ID**: `cpt-frontx-actor-project-developer`

**Role**: Assembles a repository from one or more templates, then builds business code on top of it. Works alongside AI agents throughout this work.
**Needs**: Predictable assembly output; reliable per-template upgrades; a clear boundary between what the product provides and what the application must provide; AI agents that already understand both the ecosystem and the specific templates in use.

### 2.2 System Actors

#### AI Tooling CLI

**ID**: `cpt-frontx-actor-ai-tooling-cli`

**Role**: The AI-tooling command-line integration. The FrontX AI Tooling Framework is installed into a consuming project through it, and AI agents discover the ecosystem's skills, workflows, and guidelines through it.
**Direction**: Inbound (installs the framework into a consuming project).
**Availability**: Required at template-project install and upgrade time and during AI-driven development sessions.
**Root-level usage**: Declared here as shared vocabulary, not because a root-owned requirement or use case exercises it — none does. It is exercised by the AI Tooling Framework's own PRD (`packages/cyber-pilot-kit-frontx/architecture/PRD.md` §5.1) and by the CLI's; a reader finding no root-level citation is seeing a deliberate absence, not a dead declaration.

#### AI Agent Host

**ID**: `cpt-frontx-actor-ai-agent-host`

**Role**: The coding-agent environment an AI agent works in. It discovers the framework's declared resources in a consuming project and activates them for the agent, so the framework's capabilities become usable without per-host configuration.
**Direction**: Inbound (consumes the declared resources installed into a consuming project).
**Conformance expectation**: Honors the discovery obligations of the kit-installation contract, owned by the AI Tooling Framework's PRD ([cyber-pilot-kit-frontx PRD §7.2](../packages/cyber-pilot-kit-frontx/architecture/PRD.md#72-external-integration-contracts)).
**Availability**: Third-party, outside the product's control; required during AI-driven development sessions.
**Root-level usage**: Declared here as shared vocabulary on the same footing as the AI Tooling CLI above — no root-owned requirement or use case exercises it; the AI Tooling Framework's PRD (§5.1) does.

#### GitHub

**ID**: `cpt-frontx-actor-github`

**Role**: Public source registry that hosts the templates published by Template Developers, and hosts the FrontX AI Tooling Framework. Both the FrontX CLI and the AI Tooling CLI fetch from it by versioned reference.
**Direction**: Outbound (publications flow to the registry); inbound (the CLI and AI Tooling CLI fetch from the registry into a consuming project).
**Availability**: Required at install and upgrade time.

#### Package Registry

**ID**: `cpt-frontx-actor-package-registry`

**Role**: npm-compatible package registry that hosts FrontX's published packages. Project Developers install FrontX packages from it using their chosen npm-compatible package manager.
**Direction**: Outbound (FrontX publishes packages to the registry); inbound (an application installs packages from the registry).
**Availability**: Required at publish time and at application install time.

## 3. Operational Concept & Environment

The ecosystem operates as a set of products that Template Developers and Project Developers use, together with AI agents, across two recurring activities: publishing templates and the AI capabilities bundled with them, and scaffolding and evolving projects from those templates. These activities run in ordinary developer environments and require nothing beyond standard project defaults.

### 3.1 Module-Specific Environment Constraints

The root layer model does not require a specific UI framework, build tool, state library, authentication system, data store, or deployment topology.

## 4. Scope

### 4.1 In Scope

#### Published libraries

The units an application consumes as versioned dependencies. Each unit's capability is owned by that member's own PRD; the current members and their artifacts are located through the [DESIGN's member pointers](./DESIGN.md#member-pointers). This root PRD keeps only what binds them all: any UI framework works, versioned evolution with compatibility commitments, and no architectural ceiling (§5.1).

#### Templates

Externally hosted, versioned generators of project content. What a template produces is defined by the template itself; the ecosystem's contract to templates — the source-spec reference, the manifest with declared ownership boundaries, and per-template provenance — is owned by the CLI's artifacts ([cli PRD §7.2](../packages/cli/architecture/PRD.md#72-external-integration-contracts)).

#### Projects orchestration

The units that act on a project's lifecycle across the other two layers — creating, assembling, and upgrading projects, and giving AI agents the fluency to do so. Each lifecycle or AI capability is owned by the PRD of the member that implements it, located through the [DESIGN's member pointers](./DESIGN.md#member-pointers). Root governance classifies every FrontX-owned workspace package into the layer model and accounts for each member's artifact chain (§5.1).

### 4.2 Out of Scope

- Member-specific behavior in any layer — owned by member PRDs.
- The runtime substrate and the lifecycle tooling do not dictate a UI component library (buttons, modals, forms, and the like) or a theming and styling system. FrontX-published libraries may provide such capabilities as ordinary published libraries, and a template may choose a different library in the same role; nothing in the platform's contracts privileges one choice.
- FrontX does not include a specific state management library.
- FrontX does not include specific internationalization or locale handling.
- FrontX does not include specific authentication or authorization implementations.
- FrontX does not include specific layout choices — which extension domains exist, what they are called, or what microfrontends occupy them.
- FrontX does not include specific shared application state schemas, such as theme, language, or user-locale schemas.
- FrontX does not include specific build-tooling configurations.
- FrontX does not include specific AI workflows, skills, or guidelines tied to a particular application domain.
- FrontX is not a host for application-domain business logic of any kind.

## 5. Functional Requirements

The requirements below bind every published member equally; no member can own them. Every member-specific requirement is owned by the member's own PRD §5; the members and their artifacts are located through the [DESIGN's member pointers](./DESIGN.md#member-pointers).

### 5.1 Ecosystem-Level Requirements

#### UI-framework-agnostic application components

- [ ] `p1` - **ID**: `cpt-frontx-fr-ui-framework-agnostic`

The system **MUST** allow an application built on the platform to use any UI framework for its components, including React, Vue, Svelte, and vanilla JavaScript. The core framework **MUST NOT** constrain the UI library choice.

**Rationale**: Lets applications and templates choose their UI stack independently of the platform, protecting that choice across platform updates and broadening the set of teams the product can serve.

**Actors**: `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-template-developer`

#### Versioned platform evolution with compatibility commitments

- [x] `p1` - **ID**: `cpt-frontx-fr-versioned-platform-evolution`

The system **MUST** evolve through versioned releases under semantic-versioning discipline. The system **MUST** isolate breaking changes from consuming applications through versioning and compatibility commitments.

**Rationale**: Gives consuming applications predictable upgrades and frees them from upgrading in lockstep with the product, protecting investment in code built on the platform.

**Actors**: `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-template-developer`

#### No architectural ceiling on application complexity

- [x] `p2` - **ID**: `cpt-frontx-fr-no-architectural-ceiling`

The system **MUST NOT** place an upper limit on the number of microfrontends or type definitions an application integrates, beyond the thresholds stated in the non-functional requirements.

**Rationale**: Lets the platform scale with the complexity of the applications built on it, so growth is governed by stated performance thresholds rather than by product architecture.

**Actors**: `cpt-frontx-actor-project-developer`

#### Layer-member governance

- [x] `p1` - **ID**: `cpt-frontx-fr-layer-member-governance`

The ecosystem **MUST** classify every FrontX-owned workspace package as exactly one layer member or an explicit non-layer category, and each FrontX-owned member **MUST** either own its local artifact chain or carry visible, path-scoped debt.

**Rationale**: A federated artifact tree only stays authoritative if new members cannot avoid classification or artifact ownership.

**Actors**: `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-template-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

#### Evolvability

- [x] `p1` - **ID**: `cpt-frontx-nfr-evolvability`

The ecosystem **MUST** let published members evolve without forcing every consuming project or sibling member to upgrade at the same time.

**Threshold**: Packages are versioned independently. While a package remains pre-1.0, breaking changes may ship in a minor release and patch releases remain non-breaking. Once a package has a stable major line, breaking changes require that owning member's next major release. Where the active channel promises compatibility, removals require a documented deprecation or migration path before enforcement.

**Rationale**: Independent adoption is part of the value of separating the ecosystem into members that each own their own artifacts and version line.

#### Scaling without structural ceilings

- [x] `p1` - **ID**: `cpt-frontx-nfr-scalability-ceiling`

The ecosystem **MUST** avoid a fixed architectural ceiling and express concrete scale floors through member-owned thresholds.

**Threshold**: The architecture defines no fixed ceiling on member count, template count, project count, microfrontend count, or type-definition count. Concrete accepted floors are owned by member requirements, including `cpt-frontx-nfr-runtime-performance` for concurrently registered microfrontends and `cpt-frontx-fr-application-type-definitions` for registered type definitions.

**Rationale**: AI-driven projects accumulate complexity over time; the platform must not impose architectural limits that force teams to re-platform. A root count ages quickly and turns documentation into an artificial product limit, so the concrete floors live with the members that verify them.

### 6.2 NFR Exclusions

- **Safety** (SAFE-PRD-001/002) — Not applicable as a safety-critical concern. FrontX is frontend developer tooling; it does not control, monitor, or interact with physical or safety-critical systems, so it cannot directly cause harm to people, property, or the environment. Risks arising from loading and running independently-developed microfrontends at runtime are addressed by the runtime's Security NFR (mfes PRD §6.1), not as a physical-safety concern.
- **Privacy by Design** (SEC-PRD-005): Not applicable — the product is developer tooling that does not collect, store, or process end-user personal data.
- **Accessibility** (UX-PRD-002): Not applicable — the product ships no end-user-facing interface; applications and templates built on the product own their own accessibility posture.
- **Internationalization** (UX-PRD-003): Not applicable — the product ships no end-user-facing text; applications and templates built on the product own their own internationalization.
- **Inclusivity** (UX-PRD-005): Not applicable — for the same reason as Accessibility, the product ships no end-user-facing interface.
- **Regulatory Compliance** (COMPL-PRD-001 / COMPL-PRD-002 / COMPL-PRD-003): Not applicable — the product is developer tooling that does not process regulated data; applications and templates built on the product own their own compliance posture.
- Privacy of end-user telemetry belongs to the telemetry member and to consuming applications, not to this root PRD.
- **Recovery Requirements** (REL-PRD-002): Not applicable at root altitude — the root runs nothing and holds no data, so it has no RPO, RTO, backup or disaster-recovery position; each member states its own, and for the CLI the durable state is a Git-tracked file whose recovery story is Git's own history.
- **Error Handling Expectations** (REL-PRD-003): Owned by members — the root fixes no failure surface of its own. The one root-level behaviour that can fail, the governance guard, is required to fail continuous integration loudly rather than pass silently (§1.3).
- **Data Ownership** (DATA-PRD-001): Addressed by the layer model rather than by a separate requirement — each member owns the data its own behaviour holds (§1.3, federated artifacts), and the root holds none.
- **Data Quality** (DATA-PRD-002): Not applicable at root altitude — the root defines no data whose accuracy, completeness or timeliness could be stated; each member states quality expectations for the data it holds.

## 7. Public Library Interfaces

### 7.1 Public API Surface

Each public surface is owned by the PRD of the member that publishes it, in that member's own §7.1; a member whose surface deliberately sits below actor altitude states that there as well. The root restates none of them. Every surface carries the same breaking-change policy: a major version bump for any incompatible change; minor and patch versions preserve backward compatibility.

### 7.2 External Integration Contracts

The ecosystem's contract to templates and its AI-tooling contracts are owned by the projects-orchestration members, each in its own PRD §7.2. The root owns the one contract that governs every published member equally:

#### Package-registry distribution contract

- [ ] `p2` - **ID**: `cpt-frontx-contract-package-registry-distribution`

**Direction**: bidirectional

**Description**: The product publishes its packages to the package registry (`cpt-frontx-actor-package-registry`) and is installed from that registry by consuming applications using their chosen package manager.

**Compatibility**: Published packages follow semantic versioning; consuming applications rely on the platform's evolvability commitments (`cpt-frontx-nfr-evolvability`).

## 8. Use Cases

Member-level use cases are owned by each member's own PRD §8, located through the [DESIGN's member pointers](./DESIGN.md#member-pointers). The use case below is the cross-layer journey only the root can own.

#### A project crosses all three layers from scaffold to running application

- [ ] `p2` - **ID**: `cpt-frontx-usecase-cross-layer-project-delivery`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- Templates are published on the source registry (`cpt-frontx-actor-github`).
- The published libraries are available on the package registry (`cpt-frontx-actor-package-registry`).

**Main Flow**:
1. The Project Developer assembles a repository from templates using the projects-orchestration layer's repository lifecycle; AI agents assist with that layer's AI capabilities active.
2. The assembled project depends on the published-libraries layer as versioned dependencies installed from the package registry (`cpt-frontx-contract-package-registry-distribution`).
3. At runtime the application composes microfrontends over the published libraries; any UI framework works (`cpt-frontx-fr-ui-framework-agnostic`).
4. As the ecosystem evolves, each artifact upgrades on its own version line (`cpt-frontx-fr-versioned-platform-evolution`), and the project grows without an architectural ceiling (`cpt-frontx-fr-no-architectural-ceiling`).

**Postconditions**:
- A running application composed across the three layers, each member upgradeable on its own cadence.

**Alternative Flows**:
- **A member releases a breaking change**: the change is isolated to that member's own major version line; the project adopts it on its own schedule (`cpt-frontx-nfr-evolvability`).

#### Classify and account for a new ecosystem package

- [ ] `p1` - **ID**: `cpt-frontx-usecase-classify-new-member`

**Actor**: `cpt-frontx-actor-project-developer`

**Main Flow**:
1. A developer adds or changes a workspace package.
2. The package is classified into one ecosystem layer or an explicit non-layer category.
3. If it is a member, the member owns a local PRD, DESIGN and FEATURE chain, or carries visible debt with a removal criterion.
4. Governance reports any missing classification or missing artifact accounting before the change is accepted.

**Postconditions**:
- The root layer model and member artifact ownership remain accurate.

## 9. Acceptance Criteria

- [ ] The three layers are each delivered by identified members whose own PRDs state their requirements: four published libraries, externally hosted templates under the CLI-owned contract, and two projects-orchestration units — verifiable via the member PRD links in §1.1 and §4.1.
- [ ] The layer-level requirements hold across every member: any UI framework, versioned evolution, no architectural ceiling — verifiable via `cpt-frontx-fr-ui-framework-agnostic`, `cpt-frontx-fr-versioned-platform-evolution`, and `cpt-frontx-fr-no-architectural-ceiling`.
- [ ] A project can cross all three layers from scaffold to running application — verifiable via `cpt-frontx-usecase-cross-layer-project-delivery`.
- [ ] The PRD is structurally valid and internally consistent: `cfs validate --artifact architecture/PRD.md --skip-code` returns PASS, and the standing content-quality checks — citation discipline, design-agnostic prose, controlled product vocabulary, and external-system-name scope — all clear.
- [ ] Downstream SDLC artifacts authored against this PRD trace back to specific requirement, component, or contract IDs owned either here or by the owning member PRD.
- [x] Governance has a real product requirement, `cpt-frontx-fr-layer-member-governance`, rather than borrowing unrelated requirement traces.
- [ ] `ui-kit` remains visible as a published-library member while its local artifact chain remains recorded debt.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| GitHub (source registry, `cpt-frontx-actor-github`) | Public source registry hosting the templates and the FrontX AI Tooling Framework; referenced by versioned source-spec contract at install and upgrade time. | p1 |
| npm-compatible package registry (`cpt-frontx-actor-package-registry`) | Package registry hosting the product's published packages; consumed by applications at install time using their chosen npm-compatible package manager. | p1 |
| AI Tooling CLI (`cpt-frontx-actor-ai-tooling-cli`) | The AI-tooling command-line integration through which the AI Tooling Framework is installed into consuming projects and AI agents discover the ecosystem's skills, workflows, and guidelines. | p1 |
| JavaScript / TypeScript runtime | The runtime environment on which the platform and its consuming applications execute. | p1 |
| Type-definition specification | The specification language the product uses to describe and validate entity shapes; resolved generically at the product-requirements level so the contract, not any single specification, is what the product depends on. | p1 |
| AI agent host (`cpt-frontx-actor-ai-agent-host`) | Runs agents that consume project-visible AI resources. | p2 |

## 11. Assumptions

- AI agents capable of operating FrontX's AI tooling are available to both human actor types — Template Developer and Project Developer — during their work.
- Humans-using-AI is the dominant interaction model for the product's two human actor types; the product is designed for work driven by AI agents under human direction rather than for unaided manual operation.
- The package registry and its compatible package managers remain the dominant distribution channel for frontend libraries throughout the product's release horizon.
- Semantic versioning remains the dominant version-discipline convention for the product's published artifacts and for the templates that consume them.
- Templates and their bundled AI extensions are versioned together; a template's AI extensions are part of the template bundle, not separate publications, and upgrade in step with the template.
- Member artifacts remain the source of truth for member behavior.
- Templates outside this repository own their own local artifacts and review path.
- The project-local SDLC constraints support member FEATURE identifiers in member FEATURE files.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| A member is classified in code before its local artifact chain exists. | Documentation and tooling disagree about ownership. | Record path-scoped debt with a removal criterion, and keep the member visible in the root layer model. |
| Root artifacts drift back into member behavior. | Member evolution again requires root edits. | Keep root requirements and design limited to layer-level contracts and governance. |
