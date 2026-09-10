---
status: accepted
date: 2026-06-05
---

# Template Acquisition and Location

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Bundled templates inside the CLI distribution](#bundled-templates-inside-the-cli-distribution)
  - [Externalized templates resolved by source-spec at runtime, with a tracked local inventory](#externalized-templates-resolved-by-source-spec-at-runtime-with-a-tracked-local-inventory)
  - [On-demand fetch with no local inventory](#on-demand-fetch-with-no-local-inventory)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-template-acquisition-and-location`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) drives the full template and repository lifecycle — installing templates by versioned reference, listing them, updating them, and applying them to seed or extend a repository. A command surface that scaffolds contracted content must decide where that content lives relative to the command tool itself: inside the tool's own distribution, or external to it and acquired on demand. How should the CLI obtain the templates it operates on, and where should installed templates live, so that the command surface stays fully decoupled from the content it scaffolds and a developer can acquire and inspect template versions independently of any scaffolded project?

## Decision Drivers

* **Separation of command surface from content** — the act of scaffolding is a stable capability; the content scaffolded evolves on its own cadence. Binding the two into one distribution couples a slow-moving tool to fast-moving content and the reverse, so the surface must own no template.
* **Independent versioning and release cadence** — templates are authored, versioned, and published by their owners on a schedule unrelated to the CLI's releases; a developer must be able to acquire any published template version without waiting for a CLI release that bundles it.
* **Reproducible, version-pinned acquisition** — acquisition of a template must be deterministic and pinned to an explicit version (`cpt-frontx-fr-cli-template-install`), so a project's foundation is reproducible rather than tied to whatever happens to ship inside the command tool.
* **Decoupling acquisition from application** — obtaining or refreshing a template version locally (`cpt-frontx-fr-cli-template-update-local`) must not disturb any project already scaffolded from it; the local inventory is a staging concern, distinct from changing a project.
* **Inventory visibility** — a developer must be able to see what is installed and at which version (`cpt-frontx-fr-cli-template-list`), which presumes templates form an addressable local inventory rather than opaque internals of the tool.
* **Single resolution path** — every consumer of installed templates (the local inventory, and every template application and assembly) must resolve a reference the same way, so resolution behaviour is defined once and shared.

## Considered Options

* **Bundled templates inside the CLI distribution** — the command tool ships templates as part of its own package; scaffolding reads from the bundled set, and a new template version requires a new tool release.
* **Externalized templates resolved by source-spec at runtime, with a tracked local inventory** — the command tool bundles no template; it resolves each template from an external source by a versioned reference (`cpt-frontx-contract-source-spec`) at runtime, materializing it into a tracked local inventory that can be listed and updated locally, all behind one resolver shared across every template application and assembly.
* **On-demand fetch with no local inventory** — the tool resolves and fetches a template from its source on each scaffold operation, holding no persistent local copy and exposing no inventory to list or update.

## Decision Outcome

Chosen option: **Externalized templates resolved by source-spec at runtime, with a tracked local inventory**, because it is the only option that satisfies both the separation-of-concerns driver and the independent-versioning driver while still giving the developer a visible, updatable inventory. The command surface declares no dependency on any template and bundles none, so it is fully decoupled from the content it scaffolds; this is the design constraint **CLI-1** (`cpt-frontx-constraint-cli-template-independence`) that this decision establishes and the externalization realizes. Templates are acquired by a versioned source-spec at runtime and materialized into a tracked local inventory, which makes acquisition reproducible and the inventory listable and updatable. The bundled option fails the separation and independent-versioning drivers outright; the no-inventory option satisfies separation but forfeits inventory visibility and local update, and re-fetches content the developer cannot inspect or pin locally.

Resolution of a versioned reference is performed by a single resolver shared across the whole lifecycle: the local template inventory and every template application and assembly resolve references through that one resolver, established as one CLI component in `cpt-frontx-adr-cli-internal-decomposition` and used to resolve every template a caller names in an explicit batch (`cpt-frontx-adr-composed-template-resolution`). Updating an installed template in the local inventory is bounded to the inventory alone: a local template update does not alter any repository. Applying a newer template version to an already-applied template in a repository is a separate, reviewable operation decided by the upgrade change-set engine (`cpt-frontx-adr-project-upgrade-mechanism`); local template update and per-template upgrade are distinct concerns and this decision keeps them separate.

### Consequences

* Good, because the command surface owns no template content and therefore evolves independently of the templates it scaffolds, satisfying CLI-1.
* Good, because any published template version is acquirable by versioned reference without a CLI release, so template authors and the tool release on independent cadences.
* Good, because the developer has a visible, addressable local inventory that can be listed and updated locally, and that update is bounded so it never disturbs an existing project.
* Good, because one shared resolver defines reference resolution once for the local inventory and every template application and assembly, avoiding divergent resolution behaviour.
* Bad, because scaffolding depends on the external source being reachable at install time and on a successful first acquisition, rather than reading content already present in the tool.
* Bad, because a tracked local inventory introduces inventory-state management (what is installed, at which version) that a bundled or no-inventory tool would not carry.

### Confirmation

Compliance with the externalization decision is confirmed by enforcing the **CLI-1** constraint (`cpt-frontx-constraint-cli-template-independence`) as a continuous-integration check on the CLI package: a grep-style boundary check over the `@gears-frontx/cli` package manifest and sources that fails if any template is declared as a dependency or bundled as a packaged asset, asserting zero template dependency. Design and code review additionally confirm that (1) every template the CLI operates on is acquired through the shared source-spec resolver rather than read from the tool's own distribution, and (2) the local-update path mutates only the local inventory and writes nothing into any scaffolded project.

## Pros and Cons of the Options

### Bundled templates inside the CLI distribution

The command tool ships templates inside its own package; scaffolding reads the bundled set and a new template version requires a new tool release.

* Good, because scaffolding needs no external source at scaffold time — the content travels with the tool.
* Good, because a single installed artifact contains everything needed to scaffold.
* Neutral, because the bundled set can be versioned with the tool's own version.
* Bad, because the command surface is coupled to the content it scaffolds, defeating separation of concerns and CLI-1.
* Bad, because template authors cannot release a new template version independently of the tool's release cadence.

### Externalized templates resolved by source-spec at runtime, with a tracked local inventory

The tool bundles no template and resolves each by versioned source-spec at runtime into a tracked local inventory, behind one resolver shared with the namespace architecture.

* Good, because the command surface owns no content and is fully decoupled from it (CLI-1).
* Good, because acquisition is reproducible and version-pinned, and the inventory is listable and locally updatable.
* Good, because local update is bounded to the inventory and never disturbs a scaffolded project.
* Neutral, because the single shared resolver is a design link to the assembly mechanism rather than an isolated mechanism.
* Bad, because scaffolding depends on source reachability and successful acquisition, and the inventory carries state to manage.

### On-demand fetch with no local inventory

The tool resolves and fetches a template from its source on each scaffold, holding no persistent local copy and exposing no inventory.

* Good, because it keeps the command surface decoupled from content, like the chosen option.
* Good, because there is no inventory state to manage.
* Bad, because there is nothing to list and nothing to update locally, failing the inventory-visibility and decoupled-update drivers.
* Bad, because the developer cannot pin or inspect a locally held version between operations, weakening reproducibility.

## More Information

This decision establishes the **CLI-1** design constraint (`cpt-frontx-constraint-cli-template-independence`) for the `@gears-frontx/cli` package and is the resolution mechanism that constraint links. The versioned-reference form a developer supplies, and what a stored reference holds, are decided in `cpt-frontx-adr-source-spec-syntax`. The single shared resolver's standing as one CLI component is decided in `cpt-frontx-adr-cli-internal-decomposition`, and its use when a caller applies several templates in one batch in `cpt-frontx-adr-composed-template-resolution`. The separate, reviewable application of a newer origin to a registered template's targets is decided in `cpt-frontx-adr-project-upgrade-mechanism`. Registration on top of this acquisition core — adopting a resolved origin into a project under the template's own name — is decided in `cpt-frontx-adr-project-provenance-record`. These are non-binding pointers to related decisions and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because this is local developer tooling with no throughput or latency budget on the decision.
* **SEC** — Not applicable, because the decision introduces no secret material and no authentication surface; reachability of an external source is an availability note, not a security control.
* **REL** — Not applicable, because there is no service availability target; the tool runs locally and on demand.
* **DATA** — Not applicable, because no persistent database or schema is defined here; the local inventory's shape is a design-document concern, not this decision.
* **OPS** — Not applicable, because there are no runbooks or operational procedures for a local command tool.
* **MAINT** — addressed: separating the command surface from template content reduces coupling and lets each evolve independently.
* **UX** — addressed implicitly: a single predictable command surface with a listable inventory.
* **BIZ** — Not applicable, because product requirements are stated in the PRD and only cited here by ID.
* **INT** — addressed: acquisition crosses exactly one external boundary, the source registry (`cpt-frontx-actor-github`), and this decision fixes what the CLI may assume about it — content is fetched at a caller-named reference, nothing is bundled, and no other party participates.
* **COMPL** — Not applicable, because fetching a published template into a developer's own checkout processes no personal or regulated data and creates no retention or disclosure duty.

**Review cadence**: revisit if a second acquisition transport becomes a stated requirement — the location rule here is written against a git host, and a package registry would answer "where a template lives" differently.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-constraint-cli-template-independence` — This decision establishes and realizes the CLI-1 constraint: the CLI bundles no template and resolves all template content externally, so the command surface has zero dependency on the content it scaffolds.
* `cpt-frontx-fr-cli-template-install` — Externalized resolution by versioned source-spec at runtime is the mechanism that gives this requirement its reproducible, version-pinned acquisition.
* `cpt-frontx-fr-cli-template-list` — A tracked local inventory is what makes installed templates and their versions addressable and listable for this requirement.
* `cpt-frontx-fr-cli-template-update-local` — The decision bounds local update to the inventory alone, satisfying this requirement's guarantee that updating an installed template disturbs no scaffolded project.
* `cpt-frontx-contract-source-spec` — Resolution is keyed on the versioned-reference contract, which this decision consumes through the shared resolver.
