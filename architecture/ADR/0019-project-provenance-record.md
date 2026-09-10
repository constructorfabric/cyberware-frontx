---
status: accepted
date: 2026-08-12
---

# Where a Repository Records Its CLI-Managed Template State

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [A set of per-applied-template provenance records plus a separate project-level registry document](#a-set-of-per-applied-template-provenance-records-plus-a-separate-project-level-registry-document)
  - [Project state kept only in a local, machine-level file outside the repository](#project-state-kept-only-in-a-local-machine-level-file-outside-the-repository)
  - [One Git-tracked project document inside the repository](#one-git-tracked-project-document-inside-the-repository)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-project-provenance-record`

## Context and Problem Statement

A repository assembled by the CLI (`cpt-frontx-component-cli`) carries several kinds of state that its own commands must read and write across a project's lifetime: which templates the project has registered for use (name, resolved origin, applied-from version), where each has actually been applied (`cpt-frontx-contract-project-provenance`), and which subtrees the project itself reserves against template ownership. Each concern could take a document of its own — a project-level registration/inventory file, a per-applied-template provenance record, a separate ownership-exceptions file — each carrying its own copy of overlapping identity (template name, origin, version, target). Because register, unregister, apply, delete, upgrade, restore, and ownership commands all read and mutate that same overlapping identity, keeping it in separate documents risks one write succeeding while a related write to a sibling document fails or races, leaving the set of documents internally inconsistent with no single one of them authoritative. Where should a repository record its CLI-managed template registration, applied-instance provenance, and project-owned ownership exceptions so that every command reads and writes one consistent, atomic source of truth instead of a set of documents that can drift apart?

## Decision Drivers

* **Atomicity across one shared identity** — template registration, applied-instance provenance, and project-owned exclusions all key off the same template name, origin, version, and target; a single document can be written atomically, while a set of related documents cannot be kept consistent across a partial or interrupted write.
* **No duplicated manifest-sourced fields** — a template's origin and version are already fixed at register time from its manifest; recording them again in a sibling provenance or ownership document duplicates fields that a single document can hold once per template.
* **One place per command** — register, unregister, apply, delete, upgrade, restore, and ownership commands each need to read and mutate this state; a single document gives every command one place to read from and write to, rather than requiring each to keep several documents in step.
* **Instance identity is the target itself** — an applied instance of a template is already uniquely identified by the repository path it was applied to; a single document can use that path directly as the applied-instance key, with no separate identifier or pointer document needed to relate a registration to its applied instances.
* **State stays inside the repository** — this state must travel with the repository a developer clones, shares, and opens in CI, not live only on the machine that ran the CLI.
* **A migration seam separate from a per-template version guard** — the document's own structural shape will itself evolve over time and needs one migration marker, distinct from the per-template expected version used to guard against an accidentally hand-edited manifest.

## Considered Options

* **A set of per-applied-template provenance records plus a separate project-level registry document** — one provenance record per applied template, a separate file listing registered templates, and a further ownership-exceptions file alongside them.
* **Project state kept only in a local, machine-level file outside the repository** — record registration, applied instances, and ownership exceptions in a file under the developer's home directory (e.g. `~/.frontx`) rather than inside the repository.
* **One Git-tracked project document inside the repository** — a single file, `.frontx/project.json`, holding template registration, every applied instance, and project-owned ownership exceptions together as one document that every CLI command reads and writes.

## Decision Outcome

Chosen option: **one Git-tracked project document inside the repository**, because it is the only option that gives the CLI's full command surface one atomic, self-contained source of truth for state that is otherwise scattered across documents sharing the same identity. The repository carries exactly one such file, `.frontx/project.json`, holding:

* `formatVersion` — an integer that versions the document's own structural shape, bumped only when the document's own layout changes, never when an individual template's expected version changes.
* `templates` — a map keyed by each registered template's manifest name, each entry holding the `origin` it was registered from, the `version` expected of that origin, and a `targets` array of the repository paths where it has been applied. An entry present in `templates` means that template is registered; a non-empty `targets` array means it has been applied to those paths; an empty `targets` array means it is registered but not yet applied. Every target under one template name shares that one entry's `origin` and `version` — an applied instance's identity is its target path, not a separate identifier. The recorded `version` is the version `validate` expects that origin to still resolve to. For a pinned remote origin (`cpt-frontx-adr-source-spec-syntax` guarantees an identical re-fetch), the manifest itself cannot drift, so this comparison degrades to a document-integrity check — a mismatch there can only mean this recorded `version` field, or `project.json` as a whole, was hand-edited or corrupted, not that the template moved. The comparison is meaningful as a genuine drift check in the two cases where the manifest *can* actually change out from under the recorded value: a `path:` origin, whose local manifest lives its own life independent of this document, and an accidentally hand-edited or corrupted `project.json` itself. The field is deliberately redundant with what the origin itself would report, in exchange for that cheap check in both cases. An entry may additionally carry one preceding `{ origin, version }` pair for the name — absent until the name's first upgrade, and a document without it is structurally valid — set by `cpt-frontx-adr-project-upgrade-mechanism`'s commit step to whichever `origin`/`version` the transition moved the name away from, forward or in reverse, never a longer history and never any file content. `register --replace` clears it, because that call is permitted only when `targets` is empty and starts a new lineage for the name that no preceding pair from the old one should survive into; `unregister` removes it along with the entry it belongs to.
* `projectOwnedRoots` — the paths a project reserves for itself against template ownership.

**How an entry gets into `templates`, and how it leaves.** `register <origin>` is the one operation that creates an entry. It resolves the origin — installing it into the local inventory first, through the one shared resolver, if its content is not already available there — validates the fetched manifest against the current contract (a present `name`, a present `version`, a required non-empty `description`, `cpt-frontx-adr-template-manifest-contract`), and refuses a missing or empty description rather than admitting a partially-described template. The entry's key is the manifest's own `name`, never a path or an alias supplied at the call site: a template's identity comes from the template, so two projects registering the same template key it the same way. Its `version` comes from the manifest; its `origin` is the value `cpt-frontx-adr-source-spec-syntax` fixes a stored reference to hold. A first registration initializes `targets` to an empty array.

Registering again with an origin that resolves to the same value is a no-op. Registering a *different* origin for a name that already has an entry is refused unless the caller passes `--replace`, and `--replace` is itself refused unless that name's `targets` array is empty: changing the origin of a name with at least one applied target happens only through `upgrade` (`cpt-frontx-adr-project-upgrade-mechanism`), never through a re-registration. `unregister <name>` removes an entry only when its `targets` array is empty; otherwise it is refused and every target still depending on that name is listed, directing the caller to `delete` each one first. An entry is never removed out from under ground it still occupies — the same invariant, read from the other end, that makes the `targets` array the authority on whether a name is in use.

`install <origin>` deliberately writes nothing here: it populates the local inventory only, so acquiring a template and adopting it into a project stay separate acts. `apply` may auto-install a registered name whose content is not locally available, because the entry already records what to fetch.

**Catalog visibility.** The listing surface reports three sets side by side, each entry carrying its `description`: the platform's default templates, this project's registered templates read from this document, and the templates installed locally but not yet registered here. That is the surface a caller reads before composing the explicit batch `apply` consumes (`cpt-frontx-adr-composed-template-resolution`), so a selection is made against full visibility of what *could* be registered, not only what already is. The default set is sourced from a list of official template origins built into the CLI — references naming where official templates live, never a bundled copy of their content, so it does not conflict with the no-bundled-template constraint (`cpt-frontx-adr-template-acquisition-and-location`).

This one document carries what a separate project-level registry document, a per-applied-template provenance record, and an ownership-exceptions file would each have carried alone. Provenance is not its own record or file: it is exactly the `targets` array nested inside each template's entry here. What a repository owns by way of an applied template's ownership boundary is not itself stored in this document; it is computed, at the time it is needed, from the manifest of the applied version together with the target and `projectOwnedRoots` — a separate concern this decision does not fix. The document is mutated only by the CLI's own commands (register, unregister, apply, delete, upgrade, restore, ownership); it is not a file a developer is expected to hand-edit as part of ordinary use.

### Consequences

* Good, because every command that touches template state reads and writes one document, so there is exactly one atomic write path and no possibility of the registration, provenance, and ownership-exception concerns drifting apart from each other.
* Good, because a template's origin and version are recorded exactly once per registered template, not copied across a registry document and a separate provenance document.
* Good, because an applied instance's identity is simply its target path, eliminating the bookkeeping a synthetic instance identifier or a pointer between a registry entry and its provenance record would otherwise require.
* Good, because a developer or reviewer can see a repository's entire CLI-managed footprint — every registered template, every applied target, every project-owned exception — in one file and one Git diff.
* Bad, because a repository with many registered templates and targets accumulates all of that state in one growing document rather than partitioning it across smaller, per-template files.
* Bad, because two CLI invocations that would mutate project state concurrently must serialize around one document rather than being able to touch independent files without contention.
* Bad, because every target registered under one template name is bound to that one entry's single `origin` and `version`, foreclosing two instances of the same template coexisting in one repository at two different applied versions — a deliberate simplification this decision accepts in exchange for one shared identity per template name.
* Bad, because a `templates[name]` entry holds the *current* `origin` and `version` for the name plus exactly one generation behind them — the pair the name held before whichever transition, forward or in reverse, produced its current values, recorded by that transition's own commit and overwritten by the next one (`cpt-frontx-adr-project-upgrade-mechanism`): this document carries no content and no longer history than that one generation, and cross-commit auditing of what a name's origin/version used to be beyond it remains available only through the Git history of this Git-tracked file, never through the document's own current-state shape.

### Confirmation

Compliance is confirmed by design and code review plus an end-to-end check on the CLI: a test registers two templates, applies one to two separate targets and the other to none, and asserts a single `.frontx/project.json` exists with one `templates` entry per registered template, the applied template's entry carrying both targets under its one `origin`/`version`, and the unapplied template's entry carrying an empty `targets` array. The test further asserts that `unregister` on the applied template is rejected while its `targets` array is non-empty, that an `ownership add` call only ever appends to `projectOwnedRoots` without creating or deleting any project file, and that no second file (registry, provenance, or ownership) is written anywhere in the repository. A further test simulates an interrupted write to the document and asserts the repository is left with the prior valid document, never a partially-merged one. A fifth test places a legacy `.frontx/provenance.json` in a repository with no `.frontx/project.json` and asserts the CLI refuses with an actionable message naming the mismatch (created by an older CLI version; recreate or re-register), rather than attempting to translate the legacy record into this document.

## Pros and Cons of the Options

### A set of per-applied-template provenance records plus a separate project-level registry document

A provenance record per applied template, a separate registry document for registered templates, and a further ownership-exceptions document.

* Good, because each document is scoped narrowly to one concern.
* Neutral, because it scopes each document to one concern, which reads cleanly per document.
* Bad, because template origin and version are duplicated between the registry document and each provenance record.
* Bad, because a write that touches registration and a write that touches provenance can succeed independently, leaving the documents inconsistent with each other with no single one of them authoritative.
* Bad, because a third, separate ownership-exceptions document would add a fourth concern to keep in step with the other two.

### Project state kept only in a local, machine-level file outside the repository

Registration, applied instances, and ownership exceptions recorded under the developer's home directory rather than inside the repository.

* Good, because the repository's own tree carries no extra CLI-authored file.
* Bad, because the state does not travel with the repository a developer clones, shares, or runs in CI, so a teammate or a CI runner cannot see what templates a repository was assembled from.
* Bad, because it breaks the self-contained-inside-the-repository property this decision requires, for no offsetting benefit.

### One Git-tracked project document inside the repository

A single `.frontx/project.json` file holding template registration, every applied instance, and project-owned ownership exceptions together.

* Good, because every command reads and writes one atomic, self-contained document.
* Good, because it eliminates duplicated origin/version fields and the drift risk of keeping several documents in step.
* Good, because it travels with the repository, keeping the state self-contained.
* Neutral, because the document's exact field-level schema is left to whichever FEATURE is assigned to own it, not fixed by this decision.
* Bad, because all of a repository's CLI-managed state lives in one growing document rather than being partitioned by template.

## More Information

This decision fixes that there is exactly one project-state document per repository, its top-level shape (`formatVersion`, `templates`, `projectOwnedRoots`), and the presence/emptiness semantics that distinguish "registered" from "applied" — not the document's complete field-level JSON Schema, which remains owned by whichever FEATURE this decision's schema-ownership assignment names, per `cpt-frontx-adr-contract-schema-ownership`.

A project whose repository carries a legacy `.frontx/provenance.json` and no `.frontx/project.json` is not migrated automatically: this decision fixes no migration path from a per-template provenance record into this single document. The CLI detects that combination — `provenance.json` present, `project.json` absent — and refuses with a clear, actionable message rather than guessing at a translation: the project was created by an older CLI version and must be recreated or re-registered against the current model before this decision's commands operate on it.

The schema-ownership rule `cpt-frontx-adr-contract-schema-ownership` fixes — that a contract's role lives in DESIGN, its rationale in its ADR, and its concrete field-level schema in exactly one owning FEATURE, never deferred back to DESIGN or fixed in an ADR — governs this document as it governs every other contract. Under it, `cpt-frontx-feature-composed-provenance` is the FEATURE that owns the concrete field-level schema of `.frontx/project.json`; this decision fixes the document's existence, its top-level shape, and its presence/emptiness semantics, and leaves the field layout there.

Reliability treatment (**REL**): concurrent mutation of `.frontx/project.json` is serialized through an atomic write — every command that mutates the document writes its full new content to a temporary file and renames it into place, so a reader never observes a partially-written document and two concurrent writers never interleave their bytes into a corrupt merge. This is also why an interrupted write cannot leave "no document" as an outcome distinct from "the prior document": a rename either lands, producing the new document whole, or does not, leaving the file the write started from untouched — there is no window in which the target path exists but is incomplete. A crash between a command materializing its target files and this document recording that write leaves the target unrecorded, so a re-run treats it as a first application and takes it down the unrecorded-target existing-content path (`cpt-frontx-adr-composed-template-resolution`). That converges without intervention in the common case: the files the interrupted run had already written are byte-identical to what the re-run would write, so they report as `identicalFiles` and the re-run completes and records the target. It does **not** converge for a torn target — one where the crash landed mid-write, or where the interrupted run had written only part of the payload. There, a partially-written file differs from what the payload would write and reports as `contentConflicts`, and any file the payload does not declare reports as `additionalPaths`; both refuse the batch. That refusal is the fail-closed behaviour this design wants — the alternative is silently overwriting a file whose state nobody has inspected — but it is a refusal the developer resolves, not a convergence: the remedy is to remove the partially-written target and re-run, since `delete` itself needs a recorded target it does not have. No separate crash-recovery procedure exists for this case, and none is invented here: `cpt-frontx-adr-project-upgrade-mechanism` owns file-level reconciliation for moving a registered name onto an already-applied target and for reversing that move, but it does not name a repair command for a torn target left behind by an interrupted first `apply`; the remedy above — removing the partially-written target and re-running — remains the developer's own recourse for that case.

Integration analysis (**INT**): the project-state document is a library-internal contract — written by the CLI's register, apply, upgrade, and restore operations and read by the CLI's unregister, apply, delete, upgrade, restore, validate, and ownership operations, all within the CLI; it names no external party. Its producers and consumers are the same command surface on both sides. Version-compatibility intent is forward-looking: the document remains readable across CLI versions, and its own structural shape evolves additively behind `formatVersion`, so a document written by an earlier CLI version remains readable by a later one; any non-backward-compatible change to its shape follows the platform evolvability requirement.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because reading and writing one small JSON document per command invocation has no throughput or latency budget at decision altitude.
* **SEC** — Not applicable, because the document holds template identity, origin, version, and target paths, not secret material.
* **REL** — addressed above: atomic tmp-then-rename writes serialize concurrent mutation and rule out a partially-written document, and a crash between materialization and the state write recovers through an idempotent re-apply.
* **DATA** — Not applicable as a complete schema, because the exact field layout is owned by the FEATURE this decision's schema-ownership assignment names, per `cpt-frontx-adr-contract-schema-ownership`; this decision fixes only the document's existence, its top-level shape, and its presence/emptiness semantics.
* **OPS** — Not applicable, because no operational procedure attaches to a repository-local file.
* **MAINT** — addressed: one document with one migration seam (`formatVersion`) eliminates cross-document drift and gives a future format change exactly one place to migrate.
* **COMPL** — Not applicable, because no regulatory obligation bears on this file.
* **UX** — addressed implicitly: a developer or reviewer can see a repository's entire CLI-managed template footprint in one file and one Git diff.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

**Review cadence**: revisit if a validated need emerges to shard `.frontx/project.json` across multiple files (for example at a repository scale where one document's read/write cost or Git-diff size becomes a real developer complaint), or once the `formatVersion` migration seam is exercised for the first real schema change and the single-migration-point assumption can be checked against practice.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-contract-project-provenance` — This decision satisfies the contract's requirement that a repository be able to determine which template and which version each applied instance came from, and it does so with one record per template name: the `targets` array nested inside that name's entry in the single `.frontx/project.json` document enumerates every instance applied from it, so a reader resolves an instance to its template and version by looking up the entry that lists its target.
* `cpt-frontx-fr-cli-project-upgrade-changeset` — The single project document is the one baseline a per-template upgrade reads to compute its change set, with every target registered under a template name sharing that entry's one `origin` and `version`.
* `cpt-frontx-adr-contract-schema-ownership` — The project-provenance schema-ownership assignment names `cpt-frontx-feature-composed-provenance` as the one owning FEATURE, and what it owns is the concrete field-level schema of `.frontx/project.json` — the document this decision fixes — rather than a standalone provenance record. The single-owning-FEATURE rule that assignment rests on is not touched here.
