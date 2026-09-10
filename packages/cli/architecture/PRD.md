# PRD — FrontX CLI (`@gears-frontx/cli`)


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
  - [5.1 Template Acquisition](#51-template-acquisition)
  - [5.2 Registration & Project State](#52-registration--project-state)
  - [5.3 Assembly](#53-assembly)
  - [5.4 Ownership Management](#54-ownership-management)
  - [5.5 Upgrade & Removal](#55-upgrade--removal)
  - [5.6 Machine Interface](#56-machine-interface)
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

`@gears-frontx/cli` is the ecosystem's projects-orchestration unit for the repository lifecycle. It installs, lists, updates, and validates templates from the source registry or from a local origin. It registers a template's resolved origin under a project and applies a registered template to one or more targets as an explicit, previewable batch — seeding a new repository or extending an existing one — while detecting and preventing conflicting assembly. It keeps a project's entire registered-and-applied state in one project state file, upgrades every target of a registered template atomically as one reviewable change set, and deletes an applied template's target under explicit confirmation. This PRD owns the CLI's lifecycle, publication, registration, project-state, assembly, and upgrade requirements. Ecosystem-level requirements are owned by the [root PRD](../../../architecture/PRD.md), and template AI-extension obligations are owned by the [AI Tooling Framework PRD](../../cyber-pilot-kit-frontx/architecture/PRD.md).

### 1.2 Background / Problem Statement

Templates define what a project becomes, and they are authored independently of each other. Without one contracted lifecycle tool, every team improvises acquisition, assembly, and upgrades — and independently-authored templates writing into one repository is a multi-writer corruption problem. The CLI closes both gaps: one lifecycle surface an AI agent can drive end to end, and declared, arbitrated template ownership so composition is refused rather than corrupted when claims collide.

### 1.3 Goals (Business Outcomes)

- **Single-operation scaffold** — a repository is assembled from a template through one contracted apply operation. Baseline: not yet measured (new product); Target: 100% of successful scaffold operations use one contracted apply operation; Timeframe: first platform release.
- **Reviewable, approval-gated upgrades** — every upgrade of an applied template is a reviewable change set approved before it touches repository files. Baseline: not yet measured (new product); Target: 100% of upgrades review-gated before repository file writes; Timeframe: first platform release. What a developer reviews is a per-target, per-file plan of typed whole-file operations computed by a three-way classification against the registered baseline.
- **Conflicts refused, never merged** — no assembly writes a file two templates both claim. Baseline: not yet measured (new product); Target: zero silently merged ownership conflicts; Timeframe: first platform release.

### 1.4 Glossary

This PRD uses the root PRD's shared vocabulary ([root PRD §1.4](../../../architecture/PRD.md#14-glossary)) for *template* and *project*. CLI-specific terms are defined here.

| Term | Definition |
|------|------------|
| assembly | One CLI-driven operation — previewed statelessly by `assemble` and materialized by `apply` — that resolves an explicit batch of templates and targets, checks ownership claims, and writes accepted project content. |
| origin | The immutable source a registered template resolves to: a remote source-spec pinned to the exact commit or package version it resolved to at registration time, or a local `path:` reference to a folder inside the project. |
| target | The unique repository path a template is applied to. A target's identity is the identity of the applied instance; no separate instance identifier exists. |
| ownership boundary | The part of a repository one template arbitrates for upgrade, delete, and conflict purposes: its entire target, minus the manifest's declared `excludedSubtrees`, minus the project's `projectOwnedRoots`, minus the template's own local origin folder, minus `.frontx`, minus environment-owned entries (`.git`, `.DS_Store`, `Thumbs.db`). All six terms are subtracted, never a subset — the design fixes this enumeration once and every consumer of the term reads the same six. |
| project state file | The single Git-tracked document, `.frontx/project.json`, recording every registered template's origin and version, every target each has been applied to, and the project's own `projectOwnedRoots`. |
| projectOwnedRoots | Paths a project developer reserves against every template's ownership, recorded in the project state file and managed through ownership add/remove/list without creating, moving, or deleting any file. |
| template provenance | The recorded origin, version, and applied targets of a registered template, held as that template's entry in the project state file rather than as a separate per-template record. |
| scaffold | The first repository content created by applying a template into a target directory. |
| upgrade | Moving every target a registered template has been applied to onto a newer origin, atomically, as one reviewable change set. |
| update | Replacing the locally installed copy of a template with a newer version without changing any project. |

## 2. Actors

### 2.1 Human Actors

#### Template Developer

The root PRD's Template Developer (`cpt-frontx-actor-template-developer`) at the CLI surface. **Role**: Authors, versions, validates, and publishes templates. Uses the CLI for pre-publish validation and local template management. **Needs**: Pre-publish validation against the publication contract; a way to declare ownership boundaries; deterministic versioned publication. Every FR, use case, and acceptance criterion below cites the root-level ID directly; no package-scoped actor identity is declared for this actor.

#### Project Developer

The root PRD's Project Developer (`cpt-frontx-actor-project-developer`) at the CLI surface. **Role**: Assembles repositories from templates and keeps them current. Uses the CLI to install, register, seed, add, assemble, upgrade, and delete. **Needs**: Reproducible registration and assembly; per-template upgrades that are reviewable before they apply; refusal instead of corruption when templates conflict; a way to manage project-owned exceptions and delete safely with confirmation. Every FR, use case, and acceptance criterion below cites the root-level ID directly; no package-scoped actor identity is declared for this actor.

### 2.2 System Actors

#### Source Registry

The root PRD's GitHub actor (`cpt-frontx-actor-github`) at the CLI surface. **Role**: Hosts published templates, fetched by versioned source-spec at install and upgrade time. Every FR and use case below cites the root-level ID directly; no package-scoped actor identity is declared for this actor.

## 3. Operational Concept & Environment

The CLI runs as the `frontx` executable wherever the supported JavaScript/TypeScript runtime and required filesystem and process capabilities are available. Templates are externally hosted and resolved by versioned source-spec, or referenced locally by path, at runtime; the CLI bundles none. Every `apply` flows through one uniform mechanism regardless of how many templates or targets a batch names: canonicalize every target, compute each template's effective ownership, refuse conflicting or reserved ground before writing, write the accepted content, and record every applied target under its template's entry in the project's single state file.

### 3.1 Module-Specific Environment Constraints

- Requires the supported JavaScript/TypeScript runtime, filesystem access to the target repository, and process execution support for the CLI command surface.
- Requires network access to the source registry for install, local template update, and upgrade lifecycle operations that fetch template versions. This PRD makes no offline guarantee for inventory or inspection operations unless a requirement states one explicitly.
- Holds no intra-ecosystem package dependency; the AI Tooling Framework reaches it only over its command surface.

## 4. Scope

### 4.1 In Scope

- Installing a template — from the source registry by versioned reference or from a local `path:` origin — into the local inventory, without committing any project to depending on it.
- Listing the platform's default templates, the templates registered to the current project, and the templates installed locally but not yet registered, each with its version and its description.
- Updating an installed template locally to a newer version.
- Validating a template's structure — including that its declared `excludedSubtrees` are well-formed — against the publication contract before publishing.
- Registering a template's resolved origin under a project, pinning a remote origin to the immutable version it resolves to, and unregistering it once no target depends on it.
- Seeding a new, empty repository from one or more registered templates applied to their targets in a single operation.
- Applying a registered template into an existing repository at one or more targets, individually or as an explicit batch, previewed statelessly before it is materialized.
- Declaring, through algorithmic whole-target ownership and project-managed exceptions, the parts of a repository a template owns, and detecting and preventing conflicting assembly — including containment between one target and another — before any files are written.
- Managing project-owned ownership exceptions through `ownership add`, `remove`, and `list`.
- Upgrading every target a registered template has been applied to atomically to a newer origin, applied as one reviewable change set.
- Reviewing and approving upgrade changes before they apply to repository files.
- Deleting an applied template's target, with explicit confirmation before any destructive removal and preservation of its declared exclusions, any nested target, and the project's own ownership exceptions beneath it.
- Retaining, in one project state file, the state needed to determine each registered template's origin and version and every target it has been applied to.

### 4.2 Out of Scope

- What any template produces (owned by the template).
- Resolving a manifest-declared reference between templates: composition of several templates into one repository is expressed only through the caller's explicit batch, never through a template naming other templates to be applied alongside it.
- Template-bundled AI-extension obligations and AI-driven upgrade orchestration above the change-set engine (owned by the [AI Tooling Framework PRD](../../cyber-pilot-kit-frontx/architecture/PRD.md)).
- Runtime behaviour of composed applications (published libraries layer).

## 5. Functional Requirements

### 5.1 Template Acquisition

#### Template install from the source registry or a local origin

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-template-install`

The system **MUST** allow a developer to install a template — from the source registry by versioned reference or from a local `path:` origin — into the local inventory, without registering it to any project.

**Rationale**: Gives developers deterministic, version-pinned acquisition of a remote template, or direct use of a project's own local template, so the starting point for a project is reproducible and installing a template never by itself commits a project to depending on it.

**Actors**: `cpt-frontx-actor-template-developer`, `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-github`

#### List default, registered, and installed templates

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-template-list`

The system **MUST** allow a developer to list the platform's default templates, the templates registered to the current project, and the templates installed locally but not yet registered — each with its version and its description.

**Rationale**: Gives developers and AI agents one catalog to select from before composing a batch to apply, so a choice is always made against full visibility of what could be registered, not only what already is.

**Actors**: `cpt-frontx-actor-template-developer`, `cpt-frontx-actor-project-developer`

#### Update an installed template locally

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-template-update-local`

The system **MUST** allow a developer to update an installed template to a newer version locally. This update **MUST NOT** alter any project that was scaffolded from the template.

**Rationale**: Decouples acquiring a newer template version from applying it to a project, so developers can obtain and inspect updates without disturbing existing projects.

**Actors**: `cpt-frontx-actor-template-developer`, `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-github`

#### Validate a template's structure before publishing

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-template-validate-prepublish`

The system **MUST** allow a Template Developer to validate a template's structure — including that its declared `excludedSubtrees` are well-formed — against the publication contract before publishing it.

**Rationale**: Catches structural errors and malformed ownership exclusions before a template reaches other teams, so consumers are protected from malformed templates and from assembly conflicts, and the publisher avoids costly post-publication corrections.

**Actors**: `cpt-frontx-actor-template-developer`

### 5.2 Registration & Project State

#### Template registration and unregistration

- [ ] `p1` - **ID**: `cpt-frontx-fr-cli-template-registration`

The system **MUST** allow a Project Developer to register a template's resolved origin under a project, pinning a remote origin to the immutable version it resolves to and recording a local origin as given. The system **MUST** allow the developer to unregister a registered template only while it has no applied targets, and **MUST** refuse unregistration otherwise, listing every target that still depends on it.

**Rationale**: Gives a project one authoritative, reproducible record of which templates it depends on and at exactly which version, so a later upgrade or drift check always resolves the same content, and a registration can never be removed out from under ground it still occupies.

**Actors**: `cpt-frontx-actor-project-developer`

#### Single project state record

- [ ] `p1` - **ID**: `cpt-frontx-fr-cli-project-state`

The system **MUST** record a project's registered templates, each template's origin and version, every target each has been applied to, and the project's own ownership exceptions in one project state file, and **MUST** read and write that one file atomically for every operation that changes it.

**Rationale**: Gives every lifecycle command one consistent, self-contained source of truth for a project's CLI-managed state, so registration, applied targets, and ownership exceptions can never drift apart across separate documents.

**Actors**: `cpt-frontx-actor-project-developer`

### 5.3 Assembly

#### Apply templates to seed a new repository

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-seed-repository`

The system **MUST** allow a Project Developer to seed a new, empty repository from one or more registered templates applied to their targets in a single operation. Seeding **MUST** create the project's state file and **MUST** auto-register the batch's selected official default templates — resolving and pinning each one's origin exactly as an explicit registration would — against the platform's own built-in list of official origins, before applying the batch. This capability **MUST NOT** be used to add a template into a repository that already carries applied templates.

**Rationale**: Gives developers predictable, reproducible bootstrap of a repository from a known set of templates in one step — including the registration state that step depends on — keeping the simpler seed path distinct from adding a template into a repository that already has applied state to reconcile against.

**Actors**: `cpt-frontx-actor-project-developer`

#### Apply a registered template into an existing repository

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-add-template-to-repository`

The system **MUST** allow a Project Developer to apply a registered template to one or more targets in an existing repository, individually or as part of an explicit batch — an explicit, machine-composable mapping naming, for each registered template, the target or targets to apply it to, keyed by the identity the template's own manifest declares. Its concrete shape is fixed at design altitude and deliberately not restated here: a wire form written into a requirement would have to be edited in lockstep with the artifact that actually owns it. Applying the same template to the same target a second time with no change **MUST** be an idempotent no-op. When a target already carries content the apply did not itself place, the system **MUST** report identical files, conflicting content, and additional paths separately, **MUST** block on additional paths until the developer either passes `--adopt-existing` to adopt the existing content or reserves it as a project-owned root, and **MUST NOT** silently overwrite differing content.

**Rationale**: Lets a repository grow by layering in further templates over time, safely re-applying an unchanged target without risk, and gives a developer an explicit, reviewable decision whenever a target is not empty rather than guessing what to do with what is already there.

**Actors**: `cpt-frontx-actor-project-developer`

#### Template ownership-boundary declaration

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-template-boundary-declaration`

The system **MUST** treat a template as owning its entire applied target by default, and **MUST** allow the template to declare `excludedSubtrees` — strict descendants of its target where another template may be nested. A template's effective ownership **MUST** be computed as its target minus its declared exclusions and minus the project's own ownership exceptions, not as a separately declared or tracked set of owned paths.

**Rationale**: Makes the ground each template claims computable from its target and a short declared list rather than a separately maintained boundary record, so independently-authored templates can be assembled with conflicts detected up front and an author can still deliberately host a nested template.

**Actors**: `cpt-frontx-actor-template-developer`

#### Conflict-free assembly enforcement

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-assembly-conflict-prevention`

When one or more templates are applied to a repository, the system **MUST** detect when two targets coincide, when one target contains another outside a declared exclusion, or when a target lands on the project's reserved ground, and **MUST** report and refuse the conflicting assembly before any files are written. The system **MUST NOT** silently merge conflicting claims and **MUST NOT** offer a way to override a detected conflict.

**Rationale**: Turns the multi-writer problem into a declared, reviewable, design-time concern — including the case where one target is nested inside another without a declared exclusion — so a repository is never left in a corrupted or silently-clobbered state by two templates fighting over the same or overlapping ground.

**Actors**: `cpt-frontx-actor-project-developer`

### 5.4 Ownership Management

#### Project-owned ownership exceptions

- [ ] `p1` - **ID**: `cpt-frontx-fr-cli-ownership-management`

The system **MUST** allow a Project Developer to add an existing path as a project-owned root excluded from every template's ownership, to remove that exception, and to list every current exception, without creating, moving, or deleting any file. The system **MUST** refuse a project-owned root that coincides with or is an ancestor of any applied target.

**Rationale**: Gives a developer a lightweight, reversible way to protect the project's own files that live inside a template's target from a future upgrade or delete, without requiring the tool to track file content or the template author to anticipate every such file.

**Actors**: `cpt-frontx-actor-project-developer`

### 5.5 Upgrade & Removal

#### Per-template upgrade as a reviewable change set

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-project-upgrade-changeset`

The system **MUST** allow a developer to upgrade a registered template to a newer origin, with the upgrade applied atomically to every target that template has been applied to as one reviewable change set. The system **MUST NOT** allow one target of a template to move to the newer origin while a sibling target of the same template remains on the prior one.

**Rationale**: Makes adopting a newer template version non-destructive, auditable, and consistent across every place that template was applied, using the project's own registered origin and version as the one baseline the upgrade reads, so developers keep a repository current without a per-target provenance record to keep in step.

**Status note**: This requirement is in force from first release. The file-level change-set representation, diff, and per-file reconciliation mechanics it upgrades through are a per-target, per-file plan of typed whole-file operations computed by a three-way classification against the registered baseline — the version currently recorded for the name, the requested new origin, and the content on disk.

**Actors**: `cpt-frontx-actor-project-developer`

#### Review and approval of upgrade changes before they apply

- [x] `p1` - **ID**: `cpt-frontx-fr-cli-upgrade-review-approval`

The system **MUST** allow a developer to review and approve an atomic upgrade change set before it applies to the repository's files.

**Rationale**: Keeps a human in control of what an upgrade changes across every target it touches, so no modification reaches a repository's files without explicit approval.

**Status note**: The obligation to gate an upgrade behind explicit review and approval is in force from first release. What a developer reviews is the change-set plan `cpt-frontx-fr-cli-project-upgrade-changeset` computes — every `ADD`, `REPLACE`, `REMOVE`, `KEEP_LOCAL`, and `UNCHANGED` operation across every target of the name — and this requirement never relaxes review to cover less than that plan.

**Actors**: `cpt-frontx-actor-project-developer`

#### Applied upgrade reversibility

- [ ] `p2` - **ID**: `cpt-frontx-fr-cli-upgrade-restore`

After an approved upgrade is applied, the system **MUST** allow a developer to restore every target to the previously applied template state within the preceding template version's boundary by re-invoking `upgrade <templateName> --restore` — a flag on the upgrade command, not a separate command. Content the upgrade added into ground the new version newly claimed lies outside that boundary; restoring **MUST** leave it in place, reported as skipped, rather than removing it.

**Rationale**: Keeps approved upgrades reversible, so a bad template update can be backed out — reaching back exactly one generation. The project state file (`cpt-frontx-fr-cli-project-state`) records, alongside a template's current origin and version, the one `origin`/`version` pair the name held immediately before its most recent upgrade or restore, overwritten by the next such transition and cleared when `register --replace` starts a new lineage for the name; this one generation is what makes a restore possible without any separate history carrier. A `path:` origin whose folder has since moved on from that recorded generation is not reversible through the CLI; auditing or recovering anything beyond that one generation remains available only through the Git history of that Git-tracked file.

**Status note**: The obligation to restore stands from first release. A developer reaches it as `upgrade <templateName> --restore` — the same engine that carries out `cpt-frontx-fr-cli-project-upgrade-changeset`, run in the other direction against the one preceding `origin`/`version` recorded for the name. A successful restore records the origin it just left as the new preceding entry, so a second restore in a row is a redo that returns to where the first one came from; only the generation before that is unreachable through the CLI. It refuses with `NOTHING_TO_RESTORE` only when no preceding entry is recorded for the name — because the name has never been upgraded or restored, or because a later `register --replace` cleared the pair and started a new lineage; a recorded preceding `path:` origin that no longer resolves at all refuses with `ORIGIN_UNAVAILABLE`, and one that resolves but no longer reports the recorded version refuses with `VERSION_MISMATCH`.

**Actors**: `cpt-frontx-actor-project-developer`

#### Delete an applied template's target

- [ ] `p1` - **ID**: `cpt-frontx-fr-cli-template-delete`

The system **MUST** allow a developer to delete an applied template's target, removing the target's owned ground while preserving its declared exclusions, any nested target, and the project's own ownership exceptions beneath it. The system **MUST** require explicit confirmation before deleting, defaulting to not deleting, and **MUST** support a non-destructive preview that lists exactly what would be removed and what would be preserved without deleting anything.

**Rationale**: Lets a repository shrink deliberately without an accidental invocation destroying project-owned files or another template's nested content, and gives a developer or an AI agent acting for one a way to inspect the consequences of a destructive operation before committing to it.

**Actors**: `cpt-frontx-actor-project-developer`

### 5.6 Machine Interface

#### Uniform machine-readable result envelope

- [ ] `p1` - **ID**: `cpt-frontx-fr-cli-machine-envelope`

The system **MUST** report the result of every command's machine-readable mode as one structured success-or-failure result, drawn from one stable, finite vocabulary of failure reasons shared across all commands. The system **MUST NOT** block on interactive input in machine-readable mode, and **MUST** represent a decision that would otherwise require a prompt — including confirming a destructive operation — as part of that same structured result rather than as a blocking question.

**Rationale**: Lets an AI agent or a scripted caller parse one result shape and branch on one shared set of failure reasons across the whole command surface, instead of learning a bespoke shape and a bespoke failure signal per command as the surface grows.

**Actors**: `cpt-frontx-actor-project-developer`, `cpt-frontx-actor-template-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

The ecosystem-wide NFRs — evolvability and scaling without an architectural ceiling — bind this package and are owned by the [root PRD §6.1](../../../architecture/PRD.md#61-nfr-inclusions).

#### No Ecosystem Coupling, No Bundled Templates

- [x] `p1` - **ID**: `cpt-frontx-cli-nfr-no-ecosystem-coupling`

The system **MUST** hold no intra-ecosystem package dependency and **MUST** bundle no template: every template is resolved from the source registry by versioned source-spec at runtime.

**Threshold**: Zero intra-ecosystem package coupling and zero template content in the published package.

**Rationale**: The lifecycle tool must outlive any template and any library version. Bundling either would couple the command surface to content it exists to manage, and would turn every template release into a CLI release.

#### Multi-template lifecycle scale

- [ ] `p2` - **ID**: `cpt-frontx-cli-nfr-template-scale`

The system **MUST** keep inventory, assembly, conflict reporting, and upgrade preparation usable for repositories composed from multiple templates.

**Thresholds**:
- Inventory: list at least 100 installed templates with version identity in no more than 2 seconds at p95 on a normal developer workstation.
- Assembly and conflict reporting: evaluate at least 20 templates in one batch and report every ownership conflict found — including containment between targets — before any repository file is written.
- Upgrade preparation: prepare a reviewable upgrade change set for one registered template in a project with at least 20 registered templates without requiring unrelated templates to upgrade.

**Rationale**: Multi-template repositories are the normal composition case, so the CLI must stay useful as a project's registered templates and applied targets grow.

#### Developer CLI discoverability

- [ ] `p2` - **ID**: `cpt-frontx-cli-nfr-discoverability`

The system **MUST** support both first-time learning and expert use through its command help and lifecycle feedback.

**Thresholds**:
- A developer can discover install, register, validate, seed, add, assemble, list, update, upgrade, delete, and ownership capabilities from product help without reading source code.
- Lifecycle failures name the failed operation, affected template or boundary when known, and the next developer action.
- Repeated lifecycle commands expose enough stable command and argument names for scripted or AI-agent-driven use.

**Rationale**: A developer CLI must be teachable at the terminal and predictable enough for repeated expert use.

#### NFR Exclusions Addressed Elsewhere

Two NFR-exclusion categories that this package's own requirements address rather than exclude:

- **Audit Requirements** (SEC-PRD-004): Addressed implicitly — every state mutation is committed to the Git-tracked project state file, so a repository's own Git history is the audit trail of every registration, apply, upgrade, and delete; no separate audit-logging facility is required.
- **Data Lifecycle** (DATA-PRD-003): Addressed — a template's project-state entry lives exactly as long as it has an applied target (`cpt-frontx-fr-cli-project-state`), and `cpt-frontx-fr-cli-template-delete` purges that entry deterministically on removal; no retention question extends past the lifetime the repository's own state file already governs.

### 6.2 NFR Exclusions

The root PRD's §6.2 exclusions (safety, privacy, accessibility, internationalization, inclusivity, regulatory compliance) apply here for the same reasons stated there.

- **Authentication Requirements** (SEC-PRD-001): Not applicable — the CLI is a local command-line tool with no login surface; it acts under the invoking developer's own OS-level filesystem and network permissions.
- **Data Classification** (SEC-PRD-003): Not applicable — the CLI's persisted state (`cpt-frontx-contract-project-provenance`) holds only template identity, origin, version, and target paths; it processes no PII or other sensitive data.
- **Availability Requirements** (REL-PRD-001): Not applicable — the CLI is a locally invoked, on-demand command-line tool with no hosted service and no uptime target of its own.
- **Deployment Requirements** (OPS-PRD-001): Not applicable — the CLI has no deployment environment or rollback of its own; its distribution is a package publish through the package registry, governed by the root NFR `cpt-frontx-nfr-evolvability`.
- **Monitoring Requirements** (OPS-PRD-002): Not applicable — the CLI runs as a short-lived local command with no running service to monitor; failure discoverability is covered instead by `cpt-frontx-cli-nfr-discoverability`.
- **Support Requirements** (MAINT-PRD-002): Not applicable — as internal developer tooling operated by the team that builds it, there is no external support tier or SLA; `cpt-frontx-cli-nfr-discoverability` covers self-service diagnosis.
- **Recovery Requirements** (REL-PRD-002): Not applicable as an operational recovery position — the CLI runs no service and keeps no backup of its own. Its only durable state is `.frontx/project.json`, a Git-tracked file in the developer's own repository, so recovering a prior state is a Git operation rather than a product capability. What the CLI does guarantee instead is that a failed operation leaves no partial state to recover from: an upgrade is all-or-nothing and a refused batch writes nothing.
- **Error Handling Expectations** (REL-PRD-003): Addressed rather than excluded, and stated where the behaviour lives: every command answers in one uniform envelope drawing its code from a single closed vocabulary, every failure exits non-zero, and a destructive operation refuses rather than prompts in machine-readable mode. The per-command codes belong to the features that own those commands.
- **Data Ownership** (DATA-PRD-001): Addressed — the developer's repository owns everything the CLI writes; the CLI holds no store of its own outside the project it operates on, and the local template inventory is a cache re-derivable from the origins it records.
- **Data Quality** (DATA-PRD-002): Addressed narrowly — the recorded `version` is deliberately redundant with what an origin reports, so `validate` can detect a hand-edited or corrupted project state document. Beyond that check the CLI states no accuracy or timeliness expectation, because it stores only what a manifest and a resolver told it.

## 7. Public Library Interfaces

### 7.1 Public API Surface

#### CLI

- [ ] `p1` - **ID**: `cpt-frontx-interface-cli`

**Type**: CLI

**Stability**: unstable

**Description**: The CLI owns the repository lifecycle: it installs, lists, updates, and validates templates from the source registry or from a local origin; registers a template's resolved origin under a project and unregisters it once no target depends on it; applies one or more registered templates to one or more targets as an explicit batch, previewed statelessly before it is materialized, to seed a new repository or extend an existing one; detects and prevents conflicting assembly before any files are written by computing each template's whole-target ownership; records a project's entire registered-and-applied state in one project state file; upgrades every target of a registered template atomically to a newer origin as one reviewable change set that a developer approves before it applies; and deletes an applied template's target under explicit confirmation.

**Documentation / Help Obligation**: The developer-facing lifecycle surface **MUST** be documented and discoverable through product help so developers can understand the available lifecycle capabilities, stability expectations, and template-contract responsibilities without reading source code.

**Breaking Change Policy**: A major version bump is required for any incompatible change to the command surface; minor and patch versions preserve backward compatibility.

### 7.2 External Integration Contracts

This package owns repository-lifecycle contracts for templates. The contracts below define what a template must satisfy to be acquired, assembled, and upgraded by the CLI. Template-bundled AI-extension obligations are owned by the [AI Tooling Framework PRD](../../cyber-pilot-kit-frontx/architecture/PRD.md).

#### Source-spec contract

- [ ] `p2` - **ID**: `cpt-frontx-contract-source-spec`

**Direction**: required from client

**Description**: The product accepts versioned references that identify templates hosted on the source registry (`cpt-frontx-actor-github`), or a local origin naming a folder inside the project's own tree. References resolve generically; the contract does not prescribe a specific reference syntax at the product-requirements level. A remote reference **MUST** be pinned to the exact, immutable version it resolves to at the moment a project registers it, so every later resolution of that project's registered origin returns the same content regardless of any later change to the reference's moving parts (such as a branch). A local origin has no external publication to pin against and is recorded as given.

**Compatibility**: Reference resolution remains compatible across minor and patch versions; any breaking change follows the platform's evolvability requirement (`cpt-frontx-nfr-evolvability`).

#### Template manifest contract

- [ ] `p2` - **ID**: `cpt-frontx-contract-template-manifest`

**Direction**: bidirectional

**Description**: The product requires every template to publish a manifest declaring exactly four things: its name, its version, a required non-empty description that carries both selection and usage semantics, and the subtrees of its own target it excludes from its own ownership. The CLI checks a candidate template against this shape when it is validated for publication and consumes it when a template is installed, registered, applied, or checked for conflicts with others. The declared exclusions let the product compute a template's effective ownership and detect and refuse conflicting assembly — including containment between targets — before any files are written. This is an internal contract between templates and the product; it names no external party.

**Compatibility**: The manifest shape is versioned with the platform; changes that are not backward-compatible follow `cpt-frontx-nfr-evolvability`.

#### Project state (provenance) contract

- [ ] `p2` - **ID**: `cpt-frontx-contract-project-provenance`

**Direction**: provided by library

**Description**: The product records a project's entire CLI-managed template state — every registered template's name, origin, and version, every target it has been applied to, and the project's own ownership exceptions — in one project state file inside the repository, so a later upgrade, delete, or ownership check reads one authoritative document rather than reconciling several. Current state is authoritative for the repository's registered and applied templates; the file is mutated only by the product's own commands. This is an internal contract recorded inside the repository; it names no external party.

**Compatibility**: The project state file's own structural shape is versioned independently of any one template's version and remains readable across product versions; any change to its structural shape that is not backward-compatible follows `cpt-frontx-nfr-evolvability`.

## 8. Use Cases

#### Template Developer publishes a self-contained template with declared extension points

- [ ] `p2` - **ID**: `cpt-frontx-usecase-publish-template-with-extension-points`

**Actor**: `cpt-frontx-actor-template-developer`

**Preconditions**:
- A template repository exists with the template's content authored.
- The product is installed on the developer's machine.

**Main Flow**:
1. The Template Developer authors the template's content, owning its entire target by default.
2. Where the template is meant to host another template, the Template Developer declares that ground as an extension point in `excludedSubtrees` (`cpt-frontx-fr-cli-template-boundary-declaration`).
3. The Template Developer validates the template's structure, including that its declared exclusions are well-formed and that its manifest carries a required, non-empty description, against the publication contract before publishing (`cpt-frontx-fr-cli-template-validate-prepublish`).
4. The Template Developer publishes the template to the source registry (`cpt-frontx-actor-github`).

**Postconditions**:
- The template is available for installation and registration by Project Developers from the source registry, self-contained and with no declared reference to any other template.

**Alternative Flows**:
- **Validation fails**: the validation step reports specific errors — including malformed exclusions or a missing description; the Template Developer fixes them and re-validates before publishing.

#### Project Developer assembles a repository from multiple templates

- [ ] `p2` - **ID**: `cpt-frontx-usecase-scaffold-composed-project`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- The source registry (`cpt-frontx-actor-github`) is reachable.
- A target directory is chosen, in either of two admissible starting states: a virgin directory carrying no `.frontx/project.json` yet, or a repository that already carries applied state and is being extended.
- The product is installed.

**Main Flow**:
1. The Project Developer reads the catalog of default, registered, and installed templates, each with its description (`cpt-frontx-fr-cli-template-list`).
2. The Project Developer registers each template to apply, pinning its resolved origin under the project (`cpt-frontx-fr-cli-template-registration`) — this step alone creates `.frontx/project.json` on its first mutation if the target directory does not carry one yet, so this main flow needs no prior `seed` call regardless of which admissible starting state the target directory is in.
3. The Project Developer composes an explicit batch naming each registered template and the target or targets to apply it to, and previews the batch's resolution, effective ownership, and conflicts without writing any files.
4. The Project Developer applies the same batch: the CLI re-checks that no two targets coincide or improperly contain one another, honoring each template's whole-target ownership (`cpt-frontx-fr-cli-assembly-conflict-prevention`), writes the accepted content into the repository (`cpt-frontx-fr-cli-add-template-to-repository`) — comparing against reserved ground only when no target was already applied, and against every already-applied target otherwise — and records every target under its template's entry in the project state file (`cpt-frontx-fr-cli-project-state`).

**Postconditions**:
- A repository on disk assembled from its templates, with one project state file recording every registered template's origin, version, and applied targets.

**Alternative Flows**:
- **Source registry unreachable**: the CLI reports the failure and aborts the registration or assembly without writing any files.
- **Conflicting assembly**: the CLI detects that two targets coincide or that one target contains another outside a declared exclusion, and reports and refuses the assembly before any files are written (`cpt-frontx-fr-cli-assembly-conflict-prevention`).
- **Bootstrap from official defaults**: on a virgin directory that carries no `.frontx/project.json` yet, the Project Developer may skip the register-then-apply steps above and instead run `seed` naming the wanted official default templates and their targets in one batch; the CLI creates the project state file, auto-registers each named default exactly as an explicit registration would, and applies the batch in the same operation (`cpt-frontx-fr-cli-seed-repository`). This alternative flow exists only for the official-defaults case; the register-then-apply main flow above is the general path and, per its own step 2, is not limited to a repository that already carries applied state — it bootstraps a virgin directory equally well, and is the only path available for a non-official, forked, or `path:` template, which `seed` does not accept.

#### Project Developer adds a template into an existing repository

- [ ] `p2` - **ID**: `cpt-frontx-usecase-add-microfrontend-to-project`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- An existing repository is on disk.
- The template is available in the source registry.

**Main Flow**:
1. The Project Developer registers the template by versioned reference, pinning its resolved origin (`cpt-frontx-fr-cli-template-registration`).
2. The Project Developer applies the registered template to a target in the existing repository (`cpt-frontx-fr-cli-add-template-to-repository`); before writing, the CLI checks the new target against every template already applied, honoring each template's whole-target ownership (`cpt-frontx-fr-cli-assembly-conflict-prevention`).
3. The CLI writes the accepted repository content and records the target under the template's entry in the project state file.

**Postconditions**:
- The template is applied to the repository with its target recorded in the project state file. Runtime behavior for any contributed microfrontend is owned by the [MFE Runtime PRD](../../mfes/architecture/PRD.md).

**Alternative Flows**:
- **Conflicting assembly**: the CLI detects that the new target coincides with or improperly contains a target an already-applied template owns and refuses the addition before any files are written.
- **Target already carries content**: the CLI reports identical files, conflicting content, and additional paths separately, and blocks until the Project Developer adopts the existing content or reserves it as a project-owned root and retries.

#### Project Developer upgrades one applied template

- [ ] `p2` - **ID**: `cpt-frontx-usecase-upgrade-applied-template`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- A repository has at least one registered template with at least one applied target.
- A newer origin for that registered template is available.
- The product is installed.

**Main Flow**:
1. The Project Developer selects one registered template to upgrade to a newer origin (`cpt-frontx-fr-cli-project-upgrade-changeset`).
2. The CLI validates the newer origin against every target that template has been applied to and prepares one atomic, reviewable change set covering all of them, without writing those changes to repository files (`cpt-frontx-fr-cli-project-upgrade-changeset`, `cpt-frontx-fr-cli-upgrade-review-approval`).
3. The Project Developer reviews and approves the change set before file writes (`cpt-frontx-fr-cli-upgrade-review-approval`).
4. The CLI applies the approved changes to every target of that template atomically and updates the template's origin and version in the project state file.

**Postconditions**:
- Every target of the selected registered template moves together to the approved newer origin; other registered templates are unaffected.
- The developer can restore every target to the previously applied template state, within the preceding version's boundary, by running `upgrade <templateName> --restore` (`cpt-frontx-fr-cli-upgrade-restore`); content this upgrade added into newly claimed ground lies outside that boundary and stays in place, reported skipped.

**Alternative Flows**:
- **Upgrade rejected**: the Project Developer rejects the change set; the CLI writes no repository files and leaves the project state file unchanged.
- **One target fails validation**: the CLI refuses the entire upgrade rather than moving some targets and not others, leaving the project state file unchanged for every target of that template.

#### Project Developer registers a custom template from a local path

- [ ] `p2` - **ID**: `cpt-frontx-usecase-register-local-template`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- A folder inside the project's own tree carries a valid template manifest.
- The product is installed.

**Main Flow**:
1. The Project Developer registers the template using a local `path:` origin naming that folder (`cpt-frontx-fr-cli-template-registration`).
2. The CLI validates the manifest at that path — its name, version, non-empty description, and well-formed exclusions — and records the path as given, together with the manifest's declared version, in the project state file; a local origin is not pinned, because it has no external publication to pin against.
3. The Project Developer applies the registered template to one or more targets like any other registered template (`cpt-frontx-fr-cli-add-template-to-repository`).

**Postconditions**:
- The project state file records the template under its manifest name with the local path as its origin.
- Editing the folder's content afterward does not change any target already applied from it; propagating a later edit to an applied target requires an explicit upgrade.

**Alternative Flows**:
- **Invalid or incomplete manifest**: registration is refused, naming the missing or malformed field.

#### AI agent deletes an applied template's target with explicit confirmation

- [ ] `p2` - **ID**: `cpt-frontx-usecase-ai-driven-template-delete`

**Actor**: `cpt-frontx-actor-project-developer`

**Preconditions**:
- A repository has an applied template target.
- The product is installed and invoked in machine-readable mode by an AI agent acting for the Project Developer.

**Main Flow**:
1. The AI agent requests deletion of a target on the Project Developer's behalf.
2. Because deletion is destructive, the CLI refuses to delete without confirmation and returns one structured result identifying exactly what would be removed and what would be preserved (`cpt-frontx-fr-cli-template-delete`, `cpt-frontx-fr-cli-machine-envelope`).
3. Having the Project Developer's authorization, the AI agent inspects that result and re-issues the request with explicit confirmation.
4. The CLI deletes the target's owned ground, preserving its declared exclusions, any nested target, and the project's own ownership exceptions beneath it, and removes the target from the template's entry in the project state file.

**Postconditions**:
- The target's owned ground is removed from the repository and from the project state file; every excluded subtree, nested target, and project-owned root beneath it survives untouched.

**Alternative Flows**:
- **Confirmation withheld**: the AI agent does not re-issue the request with confirmation; the CLI deletes nothing and the repository is unchanged.
- **Dry run**: the Project Developer or the AI agent previews the delete/preserve lists without deleting anything.

## 9. Acceptance Criteria

- [ ] A developer (or an AI agent acting for one) can drive the full lifecycle end to end: install, register, validate, seed or apply a previewed batch, upgrade with review, and delete with confirmation — verifiable via `cpt-frontx-usecase-publish-template-with-extension-points`, `cpt-frontx-usecase-scaffold-composed-project`, `cpt-frontx-usecase-add-microfrontend-to-project`, `cpt-frontx-usecase-upgrade-applied-template`, `cpt-frontx-usecase-register-local-template`, and `cpt-frontx-usecase-ai-driven-template-delete`.
- [ ] A developer can see the platform's default templates, the project's registered templates, and the templates installed locally but not yet registered, each with its version and description — verifiable via `cpt-frontx-fr-cli-template-list`.
- [ ] A developer can update an installed template locally to a newer version without altering any project scaffolded from that template — verifiable via `cpt-frontx-fr-cli-template-update-local`.
- [ ] No assembly writes files when two targets coincide, when one target contains another outside a declared exclusion, or when a target lands on the project's reserved ground — verifiable via `cpt-frontx-fr-cli-assembly-conflict-prevention`.
- [ ] Every upgrade moves every target of a registered template atomically as one reviewable change set approved before files change — verifiable via `cpt-frontx-fr-cli-project-upgrade-changeset` and `cpt-frontx-fr-cli-upgrade-review-approval`.
- [ ] Deleting an applied template's target always requires explicit confirmation, defaults to not deleting, and preserves its declared exclusions, nested targets, and project-owned roots — verifiable via `cpt-frontx-fr-cli-template-delete`.
- [ ] An AI agent driving the CLI in machine-readable mode never blocks on an interactive prompt and can branch on one stable, finite vocabulary of failure reasons across every command — verifiable via `cpt-frontx-fr-cli-machine-envelope`.
- [ ] A developer can restore every target to the previously applied template state within the preceding version's boundary after an applied upgrade, with content added into newly claimed ground left in place and reported skipped — verifiable via `cpt-frontx-fr-cli-upgrade-restore`.
- [ ] The three template contracts in §7.2 are documented with direction and a compatibility commitment — verifiable via the §7.2 enumeration.
- [ ] CLI help and lifecycle failures satisfy the discoverability thresholds in `cpt-frontx-cli-nfr-discoverability`.
- [ ] Multi-template inventory, assembly/conflict reporting, and upgrade preparation satisfy `cpt-frontx-cli-nfr-template-scale`.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| GitHub (source registry, `cpt-frontx-actor-github`) | Hosts published templates; fetched by versioned source-spec for install, local template update, and upgrade operations that need template versions. | p1 |
| JavaScript / TypeScript runtime and repository filesystem/process capabilities | The execution boundary the CLI requires to run as `frontx` and read or write repository lifecycle changes. | p1 |

## 11. Assumptions

- Templates and their bundled AI extensions are versioned together as stated in [root PRD §11](../../../architecture/PRD.md#11-assumptions).
- Semantic versioning remains the version discipline for templates and their references.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Template-ecosystem adoption depends on the quality of the reference templates. | Without high-quality reference templates, Project Developers may not discover the product's strengths. | Separately governed reference templates demonstrate conflict-free composition and conformance to the publication contract. |
| A manifest-shape change breaks published templates. | Templates fail validation or assembly after a CLI upgrade. | The manifest contract is versioned with the platform and bound by the evolvability requirement's deprecation cycle. |
