# PRD — AI Tooling Framework (`@gears-frontx/cyber-pilot-kit-frontx`)


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
  - [5.1 Agent Capabilities](#51-agent-capabilities)
  - [5.2 Template AI Extensions](#52-template-ai-extensions)
  - [5.3 Upgrade Orchestration](#53-upgrade-orchestration)
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

`@gears-frontx/cyber-pilot-kit-frontx` is the ecosystem's AI Tooling Framework. It equips AI agents with ecosystem-wide capabilities. It provides FrontX-specific skills. It declares every capability it offers so any conforming AI agent host can discover and invoke it. It lets templates bundle their own AI extensions. It activates trusted extensions automatically in consuming projects. It orchestrates AI-driven template upgrades over the CLI's change-set engine. It makes ecosystem knowledge available at session start. It ships zero template-specific content. This PRD owns the framework's requirements; ecosystem-level requirements are owned by the [root PRD](../../../architecture/PRD.md).

### 1.2 Background / Problem Statement

AI agents do the ecosystem's work — scaffolding, extending, upgrading — but an agent is only as reliable as the knowledge and capabilities available to it. Without the framework, every project would hand-assemble agent instructions, template knowledge would be recreated per project, and upgrades would run without analysis or review gates. The framework closes those gaps once, for every project.

### 1.3 Goals (Business Outcomes)

- **Automatic activation of allowed template AI extensions** — capabilities a trusted template bundles become available to agents with no developer activation work. Baseline: not yet measured (new product); Target: zero manual activation steps and 100% of declared applicable, policy-allowed template AI-extension resources discoverable on the first conforming-host invocation after installation; Timeframe: first platform release.
- **Ecosystem-aware agents from the first interaction** — knowledge artifacts are available at session start with no training step. Baseline: not yet measured (new product); Target: 100% of declared applicable ecosystem-knowledge resources discoverable on the first conforming-host invocation after installation; Timeframe: first platform release.
- **Nothing agent-facing undeclared** — every capability delivered into a project carries its identity and applicability. Baseline: not yet measured (new product); Target: 100% of agent-facing capabilities declared; Timeframe: first platform release.

### 1.4 Glossary

This PRD uses the root PRD's shared vocabulary ([root PRD §1.4](../../../architecture/PRD.md#14-glossary)) for *template* and *project*, the CLI PRD's glossary ([CLI PRD §1.4](../../cli/architecture/PRD.md#14-glossary)) for *project state file*, and relies on the root actors for *Template Developer* and *Project Developer*. Framework-specific terms are defined here.

| Term | Definition |
|------|------------|
| template-bundled AI extension | AI-specific content that ships with a template so the template's expertise arrives with that template in a consuming project. |
| declared agent resource | A named agent-facing capability or artifact that the project can discover and account for. |
| AI agent host | The agent runtime that discovers the framework's declared resources and makes them available during a coding session. |
| upgrade | An AI-driven template version change orchestrated through the CLI's reviewable change-set flow. |
| project state file | The single Git-tracked document, `.frontx/project.json`, recording every registered template's origin, version, and applied targets. Owned and defined by the [CLI PRD §1.4](../../cli/architecture/PRD.md#14-glossary); this framework only reads it. |

## 2. Actors

### 2.1 Human Actors

#### Template Developer

**Role**: Bundles template-specific AI extensions — skills, workflows, guidelines, reference artifacts — with the templates they publish. The root PRD's Template Developer (`cpt-frontx-actor-template-developer`) at the framework surface.
**Needs**: A documented extension contract, and confidence the bundled expertise activates uniformly in every consuming project.

#### Project Developer

**Role**: Works with AI agents in a FrontX project; directs AI-driven upgrades and reviews their change sets. The root PRD's Project Developer (`cpt-frontx-actor-project-developer`) at the framework surface.
**Needs**: Agents that already know the ecosystem and the installed templates; upgrade orchestration with analysis and review built in.

### 2.2 System Actors

#### AI Agent Host

**Role**: The coding-agent environment that discovers the framework's declared resources in a project and activates them for the agent. Third-party; honours the kit-installation contract (`cpt-frontx-contract-kit-installation`). The root PRD's AI Agent Host actor (`cpt-frontx-actor-ai-agent-host`).

#### AI Tooling CLI

**Role**: The command-line integration through which the framework is installed into a consuming project. The root PRD's AI Tooling CLI actor (`cpt-frontx-actor-ai-tooling-cli`).

## 3. Operational Concept & Environment

The framework is installed into a consuming project through the AI Tooling CLI. Installation materializes its declared agent resources; the agent host discovers and activates them. Template AI bundles become project-visible artifacts when templates are applied. The framework and CLI remain independent release units with zero intra-ecosystem package dependency. Their interaction is limited to documented public surfaces and project-visible artifacts.

### 3.1 Module-Specific Environment Constraints

- Requires an AI agent host honouring the kit-installation contract during AI-driven sessions.
- Holds no intra-ecosystem package dependency; it reaches the CLI's change-set engine only over the `frontx` command surface.

## 4. Scope

### 4.1 In Scope

- FrontX-specific skills available to AI agents, such as creating microfrontends, validating templates, generating type definitions, and orchestrating template upgrades.
- Every capability the framework offers to AI agents declared, with its own identity and a statement of when it applies.
- Template-bundled AI extensions operating alongside the ecosystem's base AI capabilities.
- Automatic discovery of installed-template AI extensions and activation of policy-allowed extensions in consuming projects.
- AI-driven project-upgrade orchestration, including review gates, migration analyses, and downstream impact assessments.
- Ecosystem-knowledge artifacts available to AI agents at session start.
- The framework itself template-agnostic, shipping zero template-specific content.

### 4.2 Out of Scope

- The change-set engine and every repository-lifecycle command (owned by the [CLI PRD](../../cli/architecture/PRD.md)); the framework orchestrates, never reimplements.
- Application-domain AI workflows, skills, or guidelines (root PRD §4.2).
- The agent host itself (third-party).

## 5. Functional Requirements

### 5.1 Agent Capabilities

#### FrontX-specific skills available to AI agents

- [x] `p1` - **ID**: `cpt-frontx-fr-ai-frontx-skills`

The system **MUST** make this closed minimum baseline of FrontX-specific skills available to AI agents working in a FrontX-based project: scaffolding a new project from a developer's stated intent by choosing among the templates installed locally, creating new microfrontends, validating templates, generating type definitions, and orchestrating template upgrades.

**Rationale**: Gives AI agents fluency in ecosystem operations from the start, so developers receive ecosystem-aware assistance from declared resources without configuring it for each project — including reaching a scaffolded project from what they want built rather than from a template reference they must already know.

**Actors**: `cpt-frontx-actor-template-developer`, `cpt-frontx-actor-project-developer`

#### Framework capabilities discoverable by any AI agent host

- [x] `p1` - **ID**: `cpt-frontx-fr-ai-agent-skill-resources`

Every capability the AI Tooling Framework offers to AI agents **MUST** carry a defined identity. Every capability **MUST** state when it applies. Each invocable entry point **MUST** be discoverable and invocable by any AI agent host honouring the kit-installation contract (`cpt-frontx-contract-kit-installation`), without per-host configuration by the developer.

If a host cannot discover or activate a declared applicable resource, the failure **MUST** be surfaced with the affected resource and obligation. The framework **MUST NOT** claim successful activation for that resource. The framework **MUST NOT** deliver into a consuming project any agent-facing capability the project cannot account for.

**Rationale**: A uniform discovery guarantee lets every AI agent host find and use the framework's capabilities without per-host configuration, and leaves nothing agent-facing in a project that the project cannot account for.

**Actors**: `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-ai-agent-host`, `cpt-frontx-actor-ai-tooling-cli`

#### Ecosystem-knowledge artifacts available at session start

- [x] `p1` - **ID**: `cpt-frontx-fr-ai-session-start-knowledge`

The system **MUST** make the mandatory ecosystem-knowledge baseline available to AI agents at session start, with no training step required. The baseline is rules, examples, guidelines, and reference artifacts.

**Rationale**: Makes AI agents ecosystem-aware from the first interaction, so declared guidance resources are available immediately rather than after a setup or learning step.

**Actors**: `cpt-frontx-actor-template-developer`, `cpt-frontx-actor-project-developer`

#### AI Tooling Framework is template-agnostic

- [x] `p1` - **ID**: `cpt-frontx-fr-ai-tooling-template-agnostic`

The AI Tooling Framework **MUST** ship zero template-specific content; template-specific AI capabilities **MUST** arrive exclusively via template bundles.

**Rationale**: Keeps the framework free of coupling to any particular template's domain, so it stays portable across every template and templates remain the single source of their own AI capabilities.

**Actors**: `cpt-frontx-actor-template-developer`, `cpt-frontx-actor-project-developer`

### 5.2 Template AI Extensions

#### Template-bundled AI extensions

- [x] `p1` - **ID**: `cpt-frontx-fr-ai-template-bundle-extensions`

The system **MUST** allow a Template Developer to bundle a template with AI extensions that operate alongside the ecosystem's base AI capabilities.

The supported template AI-extension categories are:
- skills
- workflows
- guidelines
- reference artifacts

**Rationale**: Lets templates carry their own AI expertise, so the knowledge specific to a template travels with it instead of being recreated in each consuming project.

**Actors**: `cpt-frontx-actor-template-developer`

#### Automatic discovery and activation of template-supplied AI extensions

- [x] `p1` - **ID**: `cpt-frontx-fr-ai-extension-discovery-activation`

When a template is installed in a project, the system **MUST** discover the template's AI extensions and activate allowed extensions for AI agents working in that project, without the developer needing to wire them up manually.

In v1, the project's trust policy for template AI extensions is registration-gated: automatic activation applies only to extensions whose template identity carries a registered, pinned origin in the project's single state document. Activated capabilities **MUST** remain scoped to declared project-visible resources. Denied or untrusted capabilities **MUST NOT** activate. A configurable per-identity deny surface beyond registration-gating is out of scope for v1 (§11 Open Questions).

**Rationale**: Delivers zero-configuration extensibility, so template-supplied AI capabilities become available with no developer activation work.

**Actors**: `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-ai-tooling-cli`

#### Template AI-extension freshness

- [ ] `p2` - **ID**: `cpt-frontx-fr-ai-extension-version-currentness`

The system **MUST** expose template AI extensions that match the installed template version. After a template upgrade is accepted, the discoverable AI-extension resources for that template **MUST** reflect the accepted newer template version.

**Rationale**: Agents must act from the same template knowledge the repository actually installed, not from stale extension resources.

**Actors**: `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-ai-agent-host`

### 5.3 Upgrade Orchestration

#### AI-driven project-upgrade orchestration

- [x] `p1` - **ID**: `cpt-frontx-fr-ai-upgrade-orchestration`

The system **MUST** allow a Project Developer to use AI agents to orchestrate template upgrades. The workflow **MUST** support change analysis, reviewable change-set preparation, and downstream-effect validation. The workflow may include review gates, migration analyses, and downstream impact assessments.

**Rationale**: Complements direct CLI invocation with guided, AI-driven upgrades, so developers can adopt newer template versions with analysis and review built into the flow.

**Actors**: `cpt-frontx-actor-project-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

The ecosystem-wide NFRs — evolvability and scaling without an architectural ceiling — bind this package and are owned by the [root PRD §6.1](../../../architecture/PRD.md#61-nfr-inclusions).

#### Surface-Only Integration

- [x] `p1` - **ID**: `cpt-frontx-cyber-pilot-kit-frontx-nfr-surface-only-integration`

The system **MUST** hold no intra-ecosystem package dependency. The system **MUST** interact with the CLI's change-set engine only through documented public surfaces. The system **MUST** interact with template-bundled content and provenance only through project-visible artifacts.

**Threshold**: Zero intra-ecosystem package coupling. CLI interaction remains limited to documented public surfaces and project-visible artifacts.

**Rationale**: The framework orchestrates the lifecycle without becoming part of it. A package edge in either direction would couple the two orchestration units' release lines and reopen exactly the lockstep the layer partition removed.

#### Agent-resource discovery scale and latency

- [ ] `p2` - **ID**: `cpt-frontx-cyber-pilot-kit-frontx-nfr-resource-scale`

The system **MUST** keep discovery and activation usable as installed templates and declared resources grow.

**Thresholds**:
- Discover at least 200 declared agent resources across the framework and installed templates in no more than 2 seconds at p95 on a normal developer workstation.
- Make resources from at least 20 installed templates available without manual per-template activation.
- Reflect an accepted template upgrade in discoverable resources on the first conforming-host invocation after the upgraded template version is installed.

**Rationale**: Agent hosts need current resources quickly enough for session startup and repeated project work.

#### Developer and agent-host usability

- [ ] `p2` - **ID**: `cpt-frontx-cyber-pilot-kit-frontx-nfr-usability`

The system **MUST** make framework capabilities understandable to developers and predictable for agent hosts.

**Thresholds**:
- Declared resources expose names, applicability, and failed-obligation diagnostics suitable for an agent host to present without source inspection.
- A Project Developer can identify which template supplied an activated resource and which installed template version it matches.
- Authorization failures identify the denied resource and do not require the developer to infer whether activation partially succeeded.

**Rationale**: The framework is developer tooling; its resource model must be inspectable and efficient for both humans and agent hosts.

### 6.2 NFR Exclusions

The root PRD's §6.2 exclusions (safety, privacy, accessibility, internationalization, inclusivity, regulatory compliance) apply here for the same reasons stated there.

- **Authentication** (SEC-PRD-001) — Not applicable: the framework introduces no login surface of its own; it runs inside a developer's own already-authenticated local environment and CLI session.
- **Data Classification** (SEC-PRD-003) — Not applicable: the framework processes no end-user or sensitive data; the only content it reads is project-visible template identity, origin, version, and target metadata the CLI already writes.
- **Audit** (SEC-PRD-004) — Not applicable: the framework keeps no audit trail of its own; every mutation it drives runs through the CLI's `frontx` command surface, which owns its own reporting.
- **Availability** (REL-PRD-001) — Not applicable: the framework is not a hosted or deployed service; it runs synchronously inside a developer's own invocation, so no uptime expectation attaches to it.
- **Data Lifecycle** (DATA-PRD-003) — Not applicable: the framework owns no persistent data store; the project state file and template AI-extension bundles it reads are owned and lifecycle-managed by the CLI ([CLI PRD](../../cli/architecture/PRD.md)).
- **Deployment** (OPS-PRD-001) — Not applicable: the framework ships as a versioned npm package and Constructor Studio kit installed into a project, not a deployed or hosted service; publishing a version is the only "deployment" this product has.
- **Monitoring** (OPS-PRD-002) — Not applicable: there is no running service to monitor; observability is local to the developer's own invoking session.
- **Recovery** (REL-PRD-002) — Not applicable: the framework holds no durable state of its own to recover. Every mutation it drives runs through the CLI, whose own all-or-nothing guarantees and Git-tracked project state file are where recovery is answered.
- **Error Handling Expectations** (REL-PRD-003) — Addressed: the framework relays what the CLI reports without reinterpreting it, and surfaces a discovery or activation failure rather than skipping the resource silently, so a developer sees the failure instead of an unexplained absence.
- **Data Ownership** (DATA-PRD-001) — Addressed: the framework owns none of the data it reads. The project state file belongs to the CLI's contract and the AI-extension bundles to the templates that ship them; the framework is a consumer of both.
- **Data Quality** (DATA-PRD-002) — Not applicable: the framework states no accuracy or completeness expectation of its own, because every value it reports is read from a manifest, a bundle, or the CLI's own output and is relayed as declared.
- **Support** (MAINT-PRD-002) — Not applicable beyond the ecosystem's own channels: the framework is supported through the same repository issue tracker and developer documentation as the rest of the ecosystem, with no dedicated SLA-bound support tier.

## 7. Public Library Interfaces

### 7.1 Public API Surface

#### AI Tooling Framework

- [ ] `p1` - **ID**: `cpt-frontx-interface-ai-tooling-framework`

**Type**: Library

**Stability**: unstable

**Description**: The AI Tooling Framework provides FrontX-specific skills to AI agents working in a project. It presents its agent-facing capabilities as declared agent resources that any conforming AI agent host can discover and invoke. It lets Template Developers bundle template-specific AI extensions. It discovers installed-template AI extensions and activates only those allowed by the project trust policy. It supports AI-driven orchestration of template upgrades. It makes ecosystem-knowledge artifacts available to AI agents at session start. It ships zero template-specific content.

**Breaking Change Policy**: A major version bump is required for any incompatible change to the component's public surface; minor and patch versions preserve backward compatibility.

### 7.2 External Integration Contracts

#### Kit-installation contract

- [ ] `p2` - **ID**: `cpt-frontx-contract-kit-installation`

**Direction**: required from client

**Description**: The AI Tooling Framework is installed into a consuming project through the AI-tooling CLI integration (`cpt-frontx-actor-ai-tooling-cli`). This is how AI agents come to have the framework's skills and activated template extensions available. Installation materializes the framework's declared agent resources into the project and surfaces its public entry points. An AI agent host (`cpt-frontx-actor-ai-agent-host`) honouring this contract can discover and invoke them without bespoke wiring. This discovery obligation is what `cpt-frontx-fr-ai-agent-skill-resources` relies on. A non-conforming host or failed resource discovery or activation **MUST** be surfaced with the affected resource and obligation. The framework **MUST NOT** silently claim successful activation.

**Compatibility**: The installation contract remains compatible across minor and patch versions; breaking changes follow `cpt-frontx-nfr-evolvability`.

#### Template AI-extension contract

- [ ] `p2` - **ID**: `cpt-frontx-contract-template-ai-extension`

**Direction**: bidirectional

**Description**: The product requires a template's bundled AI extensions to conform to a defined shape. The current closed set of extension categories is skills, workflows, guidelines, and reference artifacts. The same expertise a Template Developer bundles with a template is recognized uniformly in any project that installs it, and activated only when allowed by the project's trust policy. This is an internal contract between templates and the product. The Template Developer declares it at authoring. The AI Tooling Framework consumes it at discovery and activation. It names no external party.

**Compatibility**: Additive changes within the contract preserve conforming templates; admitting or removing an extension category is a breaking change that follows the platform's evolvability requirement (`cpt-frontx-nfr-evolvability`).

## 8. Use Cases

#### Template Developer bundles a template with AI extensions

- [ ] `p2` - **ID**: `cpt-frontx-usecase-bundle-template-ai-extensions`

**Actor**: `cpt-frontx-actor-template-developer`

**Preconditions**:
- A template exists.
- The AI Tooling Framework's extension contract is documented in the ecosystem-knowledge artifacts available to AI agents at session start.

**Main Flow**:
1. The Template Developer declares supported AI-extension categories inside the template bundle (`cpt-frontx-fr-ai-template-bundle-extensions`).
2. The Template Developer publishes the template via the source registry (`cpt-frontx-actor-github`).

**Postconditions**:
- When Project Developers install this template, the AI Tooling Framework discovers the bundled AI extensions and activates those allowed by the project trust policy for AI agents working in that project (`cpt-frontx-fr-ai-extension-discovery-activation`).

**Alternative Flows**:
- **Extension declaration malformed**: pre-publish validation reports the structural error before publication.

#### Project Developer runs an AI-driven template upgrade

- [ ] `p2` - **ID**: `cpt-frontx-usecase-ai-driven-template-upgrade`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- A repository has a template applied at an older version.
- A newer version of that template is available in the source registry.

**Main Flow**:
1. An AI agent uses the AI Tooling Framework's upgrade orchestration to analyse the change from the applied template's older version to the newer version (`cpt-frontx-fr-ai-upgrade-orchestration`).
2. The AI agent prepares the per-template upgrade as a reviewable change set (`cpt-frontx-fr-cli-project-upgrade-changeset`).
3. The Project Developer reviews and approves the upgrade changes before they apply to repository files (`cpt-frontx-fr-cli-upgrade-review-approval`).
4. Only after approval, the change set is applied to the repository files and that template's entry in the project state file (`.frontx/project.json`) is updated to the newer version.

**Postconditions**:
- The applied template is upgraded to its newer version with all reviewable changes accepted; other applied templates are unaffected.

**Alternative Flows**:
- **Change set rejected**: the Project Developer declines the change set; the applied template remains at its current version and no files are written.
- **Downstream impact assessment flags incompatibilities**: the AI agent surfaces the incompatibilities before the change set is applied, and the Project Developer decides whether to proceed.

#### Project Developer scaffolds a project from a stated intent

- [ ] `p2` - **ID**: `cpt-frontx-usecase-ai-driven-project-scaffolding`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- One or more templates are installed in the local template inventory (`cpt-frontx-fr-cli-template-install`).
- A target directory is chosen.
- The product is installed.

**Main Flow**:
1. The Project Developer states what the project should be, in their own words, rather than naming a template (`cpt-frontx-fr-ai-frontx-skills`).
2. An AI agent uses the AI Tooling Framework to read the locally installed templates and match the stated intent against the description each template declares about itself, producing an application plan it presents to the developer before anything is written.
3. The AI agent applies the plan through the CLI as one explicit, target-keyed batch naming every selected template and its target(s) — the template that establishes the repository together with each further distinct template — materialized through a single `apply` call, optionally previewed first by the stateless `assemble` command (`cpt-frontx-fr-cli-seed-repository`, `cpt-frontx-fr-cli-add-template-to-repository`), with the CLI checking declared ownership boundaries before every write (`cpt-frontx-fr-cli-assembly-conflict-prevention`).
4. The AI agent reports the applied set back to the developer from the project state file (`.frontx/project.json`), together with the work the applied templates do not themselves cover.

**Postconditions**:
- A repository on disk assembled from the templates the stated intent selected, recorded in the project state file (`.frontx/project.json`), and reported back to the developer.

**Alternative Flows**:
- **Nothing matches the intent**: the AI agent reports which templates are installed and which declare no description to match against, and writes no files.
- **Candidates match indistinguishably**: the AI agent asks the Project Developer to choose between the named candidates and their declared descriptions before anything is applied.
- **A CLI command refuses**: the AI agent relays the CLI's reported reason, names the templates applied before the refusal, and stops rather than retrying.

## 9. Acceptance Criteria

- [ ] Installing a template whose bundle carries AI extensions makes those extensions available to agents with no manual wiring — verifiable via `cpt-frontx-usecase-bundle-template-ai-extensions`.
- [ ] Denied or untrusted template AI extensions do not activate, while allowed extensions activate without manual wiring — verifiable via `cpt-frontx-fr-ai-extension-discovery-activation`.
- [ ] Discoverable template AI-extension resources match the installed template version — verifiable via `cpt-frontx-fr-ai-extension-version-currentness`.
- [ ] An AI-driven upgrade runs analysis, prepares a reviewable change set, and gates application on developer approval — verifiable via `cpt-frontx-usecase-ai-driven-template-upgrade`.
- [ ] FrontX-specific skills cover scaffolding a project from a stated intent, creating microfrontends, validating templates, generating type definitions, and orchestrating template upgrades — verifiable via `cpt-frontx-fr-ai-frontx-skills`.
- [ ] Ecosystem-knowledge artifacts are available at session start with no training step — verifiable via `cpt-frontx-fr-ai-session-start-knowledge`.
- [ ] Every agent-facing capability delivered into a project is declared with identity and applicability — verifiable via `cpt-frontx-fr-ai-agent-skill-resources`.
- [ ] Host discovery or activation failure is surfaced with the affected resource and obligation, with no silent success claim — verifiable via `cpt-frontx-contract-kit-installation`.
- [ ] The framework ships zero template-specific content — verifiable via `cpt-frontx-fr-ai-tooling-template-agnostic`.
- [ ] Resource discovery and usability satisfy `cpt-frontx-cyber-pilot-kit-frontx-nfr-resource-scale` and `cpt-frontx-cyber-pilot-kit-frontx-nfr-usability`.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| AI Tooling CLI (`cpt-frontx-actor-ai-tooling-cli`) | The integration through which the framework is installed into consuming projects. | p1 |
| FrontX CLI command surface | The public `frontx upgrade` surface the upgrade orchestration drives; no package dependency. | p1 |
| AI agent host (`cpt-frontx-actor-ai-agent-host`) | Third-party environment that discovers and activates the framework's declared resources. | p1 |

## 11. Assumptions

- AI agents capable of operating the framework are available to both human actor types during their work, subject to the consuming project's authorization and host availability.
- Templates and their bundled AI extensions are versioned together and upgrade in step as stated in [root PRD §11](../../../architecture/PRD.md#11-assumptions).

**Open Questions**:

- **Configurable per-identity deny.** v1's trust policy for template AI extensions is registration-gated only — an identity backed by a registered, pinned origin activates, and no other one does — with no configurable surface for a Project Developer to deny a specific registered identity's extensions. Owner: not yet assigned, tracked as a future decision in this area. Milestone: resolved if a project's need to deny a specific registered identity's extensions is demonstrated.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| The framework lacks initial concrete parity with the runtime and the CLI at the first published baseline. | AI Tooling capabilities may be perceived as aspirational rather than delivered. | Maintained reference template-bundled AI extensions demonstrate parity and contract conformance across extension, activation, and AI-driven upgrade orchestration. |
| Agent hosts diverge from the kit-installation contract. | Capabilities become discoverable in some hosts but not others. | The contract states the discovery obligation explicitly; conformance is the host's entry bar (`cpt-frontx-actor-ai-agent-host`). Failed discovery or activation is surfaced with the affected resource and obligation. |
