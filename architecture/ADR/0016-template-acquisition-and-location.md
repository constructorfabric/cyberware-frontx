---
status: accepted
date: 2026-09-10
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
  - [A dedicated templates repository holding the whole family](#a-dedicated-templates-repository-holding-the-whole-family)
  - [Template directories inside the ecosystem repository](#template-directories-inside-the-ecosystem-repository)
  - [A separate repository embedded here as a submodule or a subtree](#a-separate-repository-embedded-here-as-a-submodule-or-a-subtree)
  - [One repository per published template](#one-repository-per-published-template)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-template-acquisition-and-location`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) drives the full template and repository lifecycle — installing templates by versioned reference, listing them, updating them, and applying them to seed or extend a repository. A command surface that scaffolds contracted content must decide where that content lives relative to the command tool itself: inside the tool's own distribution, or external to it and acquired on demand. How should the CLI obtain the templates it operates on, and where should installed templates live, so that the command surface stays fully decoupled from the content it scaffolds and a developer can acquire and inspect template versions independently of any scaffolded project?

Where the templates are published is the other half of the same question. Content is only external if it is actually somewhere else: while template directories sit in the repository that publishes the packages a template pins, template-only guards run on every unrelated ecosystem change, ecosystem tooling can borrow configuration out of template payload, and the tool's own tests can read a template off the disk beside them through a path no consumer has. So this decision fixes both halves — how the tool obtains a template, and which repository holds the templates it obtains.

## Decision Drivers

* **Separation of command surface from content** — the act of scaffolding is a stable capability; the content scaffolded evolves on its own cadence. Binding the two into one distribution couples a slow-moving tool to fast-moving content and the reverse, so the surface must own no template.
* **Independent versioning and release cadence** — templates are authored, versioned, and published by their owners on a schedule unrelated to the CLI's releases; a developer must be able to acquire any published template version without waiting for a CLI release that bundles it.
* **Reproducible, version-pinned acquisition** — acquisition of a template must be deterministic and pinned to an explicit version (`cpt-frontx-fr-cli-template-install`), so a project's foundation is reproducible rather than tied to whatever happens to ship inside the command tool.
* **Decoupling acquisition from application** — obtaining or refreshing a template version locally (`cpt-frontx-fr-cli-template-update-local`) must not disturb any project already scaffolded from it; the local inventory is a staging concern, distinct from changing a project.
* **Inventory visibility** — a developer must be able to see what is installed and at which version (`cpt-frontx-fr-cli-template-list`), which presumes templates form an addressable local inventory rather than opaque internals of the tool.
* **One repository, one subject** — the ecosystem repository's guards, its release pipeline and its artifact tree describe the published packages, the CLI and the AI tooling kit. Template-only machinery in the same repository gives it a second subject and a second reason to change.
* **Keep the family together** — published templates share conventions, share the packages they pin, and are reviewed by the same people. Whatever holds them should let one change touch several of them at once.
* **Drift must still be caught** — a template that pins ecosystem packages, and mirrors some of their configuration, can fall behind them. Separating the two sides must not turn that into an unwatched divergence.
* **Single resolution path** — every consumer of installed templates (the local inventory, and every template application and assembly) must resolve a reference the same way, so resolution behaviour is defined once and shared.

## Considered Options

* **Bundled templates inside the CLI distribution** — the command tool ships templates as part of its own package; scaffolding reads from the bundled set, and a new template version requires a new tool release.
* **Externalized templates resolved by source-spec at runtime, with a tracked local inventory** — the command tool bundles no template; it resolves each template from an external source by a versioned reference (`cpt-frontx-contract-source-spec`) at runtime, materializing it into a tracked local inventory that can be listed and updated locally, all behind one resolver shared across every template application and assembly.
* **On-demand fetch with no local inventory** — the tool resolves and fetches a template from its source on each scaffold operation, holding no persistent local copy and exposing no inventory to list or update.

Once the tool bundles none, the templates still have to be published from somewhere:

* **A dedicated templates repository holding the whole family** — every published template lives in one repository of its own, one addressable top-level directory each, reached by the subtree form of a source-spec (`cpt-frontx-adr-source-spec-syntax`).
* **Template directories inside the ecosystem repository** — template directories at the root of the repository that publishes the packages, with their guards and their release steps in that repository's continuous integration.
* **A separate repository embedded here as a submodule or a subtree** — the templates get their own repository, and the ecosystem repository embeds it so the directories still appear at its root.
* **One repository per published template** — each template gets a repository of its own.

## Decision Outcome

Chosen option: **Externalized templates resolved by source-spec at runtime, with a tracked local inventory**, because it is the only option that satisfies both the separation-of-concerns driver and the independent-versioning driver while still giving the developer a visible, updatable inventory. The command surface declares no dependency on any template and bundles none, so it is fully decoupled from the content it scaffolds; this is the design constraint **CLI-1** (`cpt-frontx-constraint-cli-template-independence`) that this decision establishes and the externalization realizes. Templates are acquired by a versioned source-spec at runtime and materialized into a tracked local inventory, which makes acquisition reproducible and the inventory listable and updatable. The bundled option fails the separation and independent-versioning drivers outright; the no-inventory option satisfies separation but forfeits inventory visibility and local update, and re-fetches content the developer cannot inspect or pin locally.

Resolution of a versioned reference is performed by a single resolver shared across the whole lifecycle: the local template inventory and every template application and assembly resolve references through that one resolver, established as one CLI component in `cpt-frontx-adr-cli-internal-decomposition` and used for preset reference resolution in `cpt-frontx-adr-composed-template-resolution`. Updating an installed template in the local inventory is bounded to the inventory alone: a local template update does not alter any repository. Applying a newer template version to an already-applied template in a repository is a separate, reviewable operation decided by the upgrade change-set engine (`cpt-frontx-adr-project-upgrade-mechanism`); local template update and per-template upgrade are distinct concerns and this decision keeps them separate.

**Where the templates are published**: from **a dedicated templates repository holding the whole family**, because it is the only option that puts the content outside the repository that publishes the packages it pins while keeping templates that share conventions in one place to review and release together. A consumer addresses one template by the subtree form the source-spec already defines (`cpt-frontx-adr-source-spec-syntax`). Nothing in the resolution mechanism changes: publication from a repository of its own is what makes externalization physical rather than nominal, not an amendment to how a reference resolves. What that repository publishes, and how it governs itself, are its own business and are not described here.

**The ecosystem repository therefore holds no template, and nothing that existed only to serve one.** No template-only guard, job or publish step belongs in its continuous integration: manifest validation of a candidate template, template composition, template publication and the checks over template payload all sit with the side that holds the payload. Version-bump governance for packages a template contains belongs to the repository that releases them. The CLI's end-to-end tests resolve **synthetic fixture templates**, which is also the honest test: a fixture is resolved through the same path a consumer uses, and it does not break when unrelated content changes. Ecosystem tooling borrows no configuration out of template payload.

**A guard whose subject spans both sides runs on both sides.** Where a rule is structural — a published barrel exports a name or it does not — one side answers for every consumer anywhere. Where a rule walks a tree of consumers, it reaches only that tree, so each repository runs it over its own; the reach of each half is recorded with the boundary it guards, in the owning member's DESIGN.

**Release sequencing across the boundary is ordered.** The ecosystem packages publish first; a template re-pins to the published versions and publishes after. A change that spans both sides is two pull requests in that order, and the second cannot be prepared until the first has published.

### Consequences

* Good, because the command surface owns no template content and therefore evolves independently of the templates it scaffolds, satisfying CLI-1.
* Good, because any published template version is acquirable by versioned reference without a CLI release, so template authors and the tool release on independent cadences.
* Good, because the developer has a visible, addressable local inventory that can be listed and updated locally, and that update is bounded so it never disturbs an existing project.
* Good, because one shared resolver defines reference resolution once for the local inventory and every template application and assembly, avoiding divergent resolution behaviour.
* Bad, because scaffolding depends on the external source being reachable at install time and on a successful first acquisition, rather than reading content already present in the tool.
* Bad, because a tracked local inventory introduces inventory-state management (what is installed, at which version) that a bundled or no-inventory tool would not carry.
* Good, because the repository layout now agrees with the layer partition the PRD and DESIGN state, so a reader is not told one thing by the artifacts and another by the directory listing.
* Good, because the CLI is exercised the way a developer uses it: every template a test resolves is resolved through the source-spec path, from a fixture rather than from a neighbouring directory.
* Good, because the ecosystem repository keeps one subject — its published packages, the CLI and the AI tooling kit — and carries no guard or pipeline step for content it does not hold.
* Good, because templates release in their own review queue and on their own cadence, without waiting for an ecosystem release or dragging one along.
* Good, because templates that share conventions stay together, so a convention spanning them is changed once.
* Bad, because a change spanning both sides is two pull requests in a fixed order, and the second waits for the first to publish. Work that a single repository made one atomic commit no longer is one.
* Bad, because drift between the published packages and what a template pins against them is no longer caught on the pull request that causes it. It surfaces after merge, on the owning repository's own schedule and in that repository's log, which is a real detection latency and needs someone to watch it rather than a red check on the change that caused it.
* Bad, because that comparison needs a checkout of the packages side to run against, so it carries a setup convention a single-repository check did not need.
* Bad, because a guard whose consumer half walks a tree now exists on both sides, so tightening it on one side does not tighten it on the other, and the two copies can diverge.
* Bad, because a contributor working across the boundary needs both repositories and needs to know how each finds the other.

### Confirmation

Compliance with the externalization decision is confirmed by enforcing the **CLI-1** constraint (`cpt-frontx-constraint-cli-template-independence`) as a continuous-integration check on the CLI package: a grep-style boundary check over the `@gears-frontx/cli` package manifest and sources that fails if any template is declared as a dependency or bundled as a packaged asset, asserting zero template dependency. Design and code review additionally confirm that (1) every template the CLI operates on is acquired through the shared source-spec resolver rather than read from the tool's own distribution, and (2) the local-update path mutates only the local inventory and writes nothing into any scaffolded project.

Compliance with the publication half is confirmed by the repository state and by continuous integration: no top-level directory in this repository carries a template manifest, template discovery over this repository returns an empty set, no template-only guard, job or publish step remains in its continuous integration, and the CLI's end-to-end tests resolve synthetic fixture templates only. The rest is review-held, because this repository does not own the artifacts on the other side: that the comparison against the published packages runs there and is acted on by re-pinning, and that a change spanning the boundary publishes the packages before the re-pin, are confirmed by review in the repository that owns them.

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
* Neutral, because the single shared resolver is a design link to the assembly and preset-resolution mechanism rather than an isolated mechanism.
* Bad, because scaffolding depends on source reachability and successful acquisition, and the inventory carries state to manage.

### On-demand fetch with no local inventory

The tool resolves and fetches a template from its source on each scaffold, holding no persistent local copy and exposing no inventory.

* Good, because it keeps the command surface decoupled from content, like the chosen option.
* Good, because there is no inventory state to manage.
* Bad, because there is nothing to list and nothing to update locally, failing the inventory-visibility and decoupled-update drivers.
* Bad, because the developer cannot pin or inspect a locally held version between operations, weakening reproducibility.

### A dedicated templates repository holding the whole family

Every published template lives in one repository of its own, one addressable top-level directory each, reached by the subtree form of a source-spec.

* Good, because the layout matches the layer partition and the resolution mechanism needs no change to support it.
* Good, because the family stays together, so a shared convention is changed once and reviewed once.
* Good, because each repository keeps one subject, one guard set and one release pipeline.
* Neutral, because it rests on subtree addressing, which the source-spec already defines and the resolver already implements.
* Bad, because changes that span the boundary become ordered pairs of pull requests, and pin drift is caught later than a single repository caught it.

### Template directories inside the ecosystem repository

Template directories at the root of the repository that publishes the packages, with their guards and release steps in its continuous integration.

* Good, because a change spanning packages and templates stays one atomic commit, and pin drift is caught immediately.
* Good, because it needs no migration and no convention for one side to find the other.
* Bad, because the layout contradicts the architecture, which states templates are hosted outside this repository.
* Bad, because it lets the tool's tests read a real template off the disk beside them, a path no consumer has, so resolution stays under-tested.
* Bad, because template-only machinery gives the repository a second subject and slows every unrelated change with guards that do not apply to it.
* Bad, because templates cannot release on their own cadence.

### A separate repository embedded here as a submodule or a subtree

The templates get their own repository, which the ecosystem repository then embeds so the directories still appear at its root.

* Good, because it separates ownership and history while keeping one working tree for contributors.
* Neutral, because the templates would still be resolvable by source-spec from their own repository.
* Bad, because the directories still appear here, so every path-based guard, discovery script and test can still reach them, and the entanglement the separation removes stays reachable.
* Bad, because it adds submodule or subtree mechanics — pointer commits, sync steps, partial clones — to every contributor and every job, in exchange for an appearance the separation was meant to end.

### One repository per published template

Each template gets a repository of its own.

* Good, because each template has the smallest blast radius and the most independent release.
* Neutral, because a source-spec addresses a whole repository as easily as a subtree of one.
* Bad, because a convention shared by several templates is changed once per repository, in as many reviews, with as many chances to diverge.
* Bad, because the comparison against the published packages is set up and maintained once per repository.
* Bad, because it multiplies repository administration ahead of any demonstrated need for the templates to move apart.

## More Information

This decision establishes the **CLI-1** design constraint (`cpt-frontx-constraint-cli-template-independence`) for the `@gears-frontx/cli` package and is the resolution mechanism that constraint links. The versioned-reference form a developer supplies is decided in `cpt-frontx-adr-source-spec-syntax`. The single shared resolver's standing as one CLI component is decided in `cpt-frontx-adr-cli-internal-decomposition`, and its use for preset reference resolution in `cpt-frontx-adr-composed-template-resolution`. The separate, reviewable application of a newer template version to an already-applied template is decided in `cpt-frontx-adr-project-upgrade-mechanism`. The repository that publishes the templates governs itself: what it publishes, and whether it authors an artifact tree over template internals, are its decisions, not this one's (`cpt-frontx-adr-template-territory-traceability`). These are non-binding pointers to related decisions and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories: **PERF** — Not applicable, because this is local developer tooling with no throughput or latency budget on the decision. **SEC** — Not applicable, because the decision introduces no secret material and no authentication surface; reachability of an external source is an availability note, not a security control. **REL** — Not applicable, because there is no service availability target; the tool runs locally and on demand. **DATA** — Not applicable, because no persistent database or schema is defined here; the local inventory's shape is a design-document concern, not this decision. **OPS** — addressed: release ordering across the boundary is part of this decision — the packages publish first and a template re-pins after — and the comparison that keeps the pinning honest runs on the side that holds the pins, against a checkout of this one. **MAINT** — addressed: separating the command surface from template content, and the packages from the templates that pin them, reduces coupling and lets each side evolve independently, at the cost of ordered cross-repository changes and a guard whose walking half exists on both sides. **UX** — addressed implicitly: a single predictable command surface with a listable inventory. **BIZ** — Not applicable, because product requirements are stated in the PRD and only cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-constraint-cli-template-independence` — This decision establishes and realizes the CLI-1 constraint: the CLI bundles no template and resolves all template content externally, so the command surface has zero dependency on the content it scaffolds.
* `cpt-frontx-fr-cli-template-install` — Externalized resolution by versioned source-spec at runtime is the mechanism that gives this requirement its reproducible, version-pinned acquisition.
* `cpt-frontx-fr-cli-template-list` — A tracked local inventory is what makes installed templates and their versions addressable and listable for this requirement.
* `cpt-frontx-fr-cli-template-update-local` — The decision bounds local update to the inventory alone, satisfying this requirement's guarantee that updating an installed template disturbs no scaffolded project.
* `cpt-frontx-contract-source-spec` — Resolution is keyed on the versioned-reference contract, which this decision consumes through the shared resolver.
* `cpt-frontx-adr-source-spec-syntax` — The subtree form of a reference is what lets one repository publish a whole family of addressable templates, and it is the form a consumer uses to address one.
* `cpt-frontx-principle-template-agnostic-tooling` — The tooling bundles no template or solution content; publishing the templates from a repository of their own draws the same line through the repository layout, so the decoupling holds in the directory structure as well as in the code.
* `cpt-frontx-principle-per-concern-versioning` — Templates version and release on their own line, in their own repository, rather than sharing this repository's branch and release train.
* `cpt-frontx-nfr-evolvability` — Each side evolves on its own cadence, and the ecosystem repository stops carrying guards and pipeline steps for content it does not hold.
