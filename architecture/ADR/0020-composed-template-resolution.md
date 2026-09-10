---
status: accepted
date: 2026-08-12
---

# How Several Templates Are Applied Together into One Repository

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Manifest-declared transitive preset composition](#manifest-declared-transitive-preset-composition)
  - [Explicit instance specifications with a persisted, fingerprinted execution plan](#explicit-instance-specifications-with-a-persisted-fingerprinted-execution-plan)
  - [Explicit target-keyed batch, no saved plan](#explicit-target-keyed-batch-no-saved-plan)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-composed-template-resolution`

## Context and Problem Statement

A repository is assembled from one or more independently-applied templates, whether at seed time or by adding a template into an existing repository (`cpt-frontx-fr-cli-seed-repository`, `cpt-frontx-fr-cli-add-template-to-repository`). One way to express that assembly is to let a template's manifest declare other templates it references as a preset, and have the CLI transitively resolve and apply that declared set as part of one operation. Under the AI-driven workflow this tool serves — the AI composes the call from `frontx list --json` and the CLI executes it deterministically — a manifest-declared reference graph would be a hidden dependency the AI's call never named: the CLI could pull in templates the invocation itself does not mention, so the change actually applied would not be fully described by the call that requested it. Separately, once a repository can apply the same template more than once at different locations — two microfrontends from one `@frontx/template-mfe`, each on its own page — each applied instance needs an identity distinct from the template it came from, and that identity must not require the tool to generate or persist anything beyond what the caller already supplies. What should identify an applied instance, and how should a request to apply several templates together be expressed and executed, so that every application is fully described by an explicit, inspectable call rather than by resolving a manifest-declared reference graph or by replaying a previously saved plan?

## Decision Drivers

* **AI composes, CLI executes, deterministically** — the call an AI or developer issues must be the complete description of what gets applied; no manifest-declared reference may pull in a template the call itself did not name.
* **Identity without new bookkeeping** — a normalized target already uniquely names where one template-owner is applied; an applied instance needs no separate generated identifier to track alongside it.
* **A one-shot selection, not persisted execution state** — a batch is the record of what the caller decided to apply now, not a saved plan whose staleness against a changed target must be tracked between preview and materialization.
* **Preview stays optional and stateless** — a developer or AI should be able to preview an intended batch's resolution, ownership, and conflicts without that preview writing anything or becoming an artifact `apply` must later reconcile against.
* **Idempotent re-application** — applying the same template to the same target a second time must be safe by default; an intentional overwrite of an already-applied instance is a distinct, explicitly-invoked operation.
* **Minimal but sufficient contract surface** — the batch-application contract should carry exactly what materialization needs and no generated instance identifiers, plan files, or content fingerprints beyond that.

## Considered Options

* **Manifest-declared transitive preset composition** — a template's manifest declares other templates it references as a preset; the CLI resolves those references transitively into the full set to apply.
* **Explicit instance specifications with a persisted, fingerprinted execution plan** — an `assemble` step writes an execution plan to disk, generating an `instanceId` for each requested application and recording a content fingerprint per target; `apply` reads that saved plan, checks each target's fingerprint for staleness against what `assemble` last saw, and refuses or re-derives on mismatch before materializing from the plan.
* **Explicit target-keyed batch, no saved plan** — a batch input names, for each registered template, the target or targets to apply it to (`{"templates": {"<manifestName>": ["<target>", ...]}}`); `assemble` is a stateless preview that runs the same resolution, ownership, and conflict checks `apply` will run but writes nothing; `apply` re-derives and re-validates directly from the batch input at call time and materializes it; an applied instance's identity is simply its normalized target.

## Decision Outcome

Chosen option: **Explicit target-keyed batch, no saved plan**, because it is the only option that keeps every application fully described by the call that requested it while adding no identity or plan-state concept beyond what the caller already supplies. The batch input — a file or stdin payload shaped `{"templates": {"<manifestName>": ["<target>", ...]}}` — is the AI's or developer's selection after reading `frontx list --json`; it is not a saved execution plan the tool must later validate for staleness. `assemble` accepts this batch and reports resolution, effective ownership, and conflicts as a **preview that writes nothing**; `apply` accepts the same shape and **independently repeats every check `assemble` performs** before materializing, so `apply` never trusts a prior `assemble` run and needs no persisted plan, fingerprint, or generated identifier to reconcile against it. The identity of an applied instance is its **unique normalized target**: one target names exactly one owning template, and applying the same template to two different targets — two microfrontends from one `@frontx/template-mfe` — produces two independent applied instances distinguished only by their targets, with no `instanceId` or `registryPath` introduced to name them separately.

This contract declares no `referencedTemplates` field and no transitive resolver: a template does not name other templates to be applied alongside it. Composition of several templates into one assembly is expressed only as an explicit batch naming every target the caller wants populated, resolved and checked once at the point of `apply`. Re-applying the same template to the same target a second time is an **idempotent no-op determined by record, not by content**: `apply` checks only whether that target is already listed under that template's name in `.frontx/project.json`, and if so takes no action — no disk read, no content comparison, no existing-content reconciliation against what is actually sitting at that target. A target a project developer has since edited is still a recorded, applied instance; the edit does not un-record it, so re-issuing the same batch remains a no-op for that target and never blocks or re-triggers on the retry. A deliberate overwrite of an already-applied instance's content is available only through the separate upgrade mechanism (`cpt-frontx-adr-project-upgrade-mechanism`), never through a repeated `apply`. The existing-content protocol — reporting a target's content as `identicalFiles`, `contentConflicts`, or `additionalPaths` — applies exclusively to a target **not yet recorded** under the applying template's name: only there does `apply` have reason to inspect what is already on disk before writing, because only there is there no record yet to make the decision by. `additionalPaths` block the apply until the caller passes `--adopt-existing` or registers the paths via `ownership add` and retries, and content that differs from what the template would write is never silently overwritten.

The manifest-declared preset option is rejected because a reference the manifest resolves transitively is exactly the hidden dependency the AI-composes/CLI-executes model forbids: the applied set would no longer equal the set the call named. The persisted, fingerprinted execution-plan option is rejected because it introduces two new identity and state concepts — a generated `instanceId` and a saved plan with per-target fingerprints — to solve a problem the unique-target identity and a stateless, re-validating `apply` already solve without them; carrying a plan that can go stale between `assemble` and `apply` is exactly the transient bookkeeping this decision avoids by having `apply` re-derive everything at call time.

The scope of this decision is what identifies an applied instance (its normalized target), how a batch of templates-to-targets is expressed and consumed by `assemble` and `apply`, that `assemble` never writes, that `apply` never trusts a prior `assemble` run, and that re-applying an already-applied target is a no-op. It does not decide the concrete shape of the ownership-boundary declaration a batch's conflict check compares (`cpt-frontx-adr-template-ownership-boundary-declaration`), the mechanism by which an intentional overwrite of an applied instance is computed and approved (`cpt-frontx-adr-project-upgrade-mechanism`), or the field-level schema of the project-state file that records each applied target (owned by its FEATURE per `cpt-frontx-adr-contract-schema-ownership`).

### Consequences

* Good, because every applied change is fully described by the batch the caller supplied — no manifest-declared reference can introduce a template the call did not name, preserving the AI-composes/CLI-executes determinism.
* Good, because an applied instance needs no generated identifier: its normalized target already uniquely names it, and applying the same template to several targets needs no new identity concept to distinguish the instances.
* Good, because `assemble` stays a pure, side-effect-free preview, so previewing a batch is safe to run repeatedly and never drifts into a stale-plan state that must be reconciled later.
* Good, because `apply` re-validates independently of any prior `assemble`, so there is no second, persisted state that can fall out of sync with the repository it describes.
* Good, because re-applying an already-applied target is a harmless no-op, so an accidental repeat of a batch cannot silently overwrite work; intentional overwrite has one explicit path, the upgrade mechanism.
* Bad, because a preset-shaped combination of templates is not a single manifest-declared reference the tool expands automatically: whoever selects templates must name the same combination explicitly in the batch every time it is wanted.
* Bad, because without a saved plan, `apply` fully repeats `assemble`'s resolution, ownership, and conflict checks at materialization time, doing that work twice whenever both commands are run in sequence on the same batch.
* Bad, because record-determined idempotency means a repeated `apply` cannot repair a recorded target whose on-disk content has been deleted or corrupted outside the CLI: the record alone marks it applied, so `apply` never re-reads or rewrites it, and drift between the record and reality is never detected or fixed by this path. Repairing such a target today means `delete`ing it (under its own explicit confirmation, which removes both the record and the content) and then re-`apply`ing it fresh; `upgrade` (`cpt-frontx-adr-project-upgrade-mechanism`) does not repair it either, because content that differs from the baseline on disk while the candidate also differs from the baseline classifies as doubly-changed and refuses the whole upgrade with `CONTENT_CONFLICT` rather than overwriting it — drift repair is deliberately outside what either `apply` or `upgrade` does.

### Confirmation

Compliance is confirmed by design and code review plus a continuous-integration check on the CLI package: a fixture applies one template to two distinct targets in the same batch and asserts two independent applied instances are recorded, distinguished only by their targets, with no generated `instanceId` or `registryPath` field anywhere in the project state. A second fixture supplies a batch naming only directly-selected templates and targets and asserts that no template outside the batch is applied, confirming there is no manifest-declared reference resolution reintroducing a hidden dependency. A third fixture runs `assemble` on a batch and asserts the repository is byte-identical afterward (nothing written), then runs `apply` on the same batch and asserts it independently re-computes and re-validates rather than reading any artifact `assemble` produced. A fourth fixture runs `apply` twice with the same batch against already-applied targets and asserts the second run is a no-op that leaves every file byte-identical, while a deliberate content change to an applied target is achievable only through the upgrade command. A companion fixture edits a file inside an already-applied target and re-issues the same batch, asserting `apply` performs no disk read or content comparison for that target — it consults only the target's presence in `.frontx/project.json` — and the edit survives untouched, confirming the retry is neither blocked nor reconciled by the edit. A fifth fixture applies into a target **not yet recorded** under the applying template's name and pre-populated with foreign content, and asserts the existing-content report distinguishes `identicalFiles`, `contentConflicts`, and `additionalPaths` for that unrecorded target only, that `additionalPaths` block the apply until `--adopt-existing` or `ownership add` resolves them, and that differing content is never silently overwritten.

## Pros and Cons of the Options

### Manifest-declared transitive preset composition

A template's manifest declares other templates it references as a preset; the CLI resolves those references transitively into the full set to apply.

* Good, because a preset delivers a whole combination of templates in one operation with no extra step from the developer.
* Good, because the referenced set is an authored, inspectable property of the manifest.
* Bad, because a manifest-declared reference is a dependency the AI's call never names, so the applied set can silently exceed what the call actually requested — precisely the hidden-dependency behavior the AI-composes/CLI-executes model forbids.
* Bad, because whether a combination of templates is semantically sensible to apply together (a microfrontend template referencing a shell) is a judgment about fitness for use, not a mechanical property a manifest reference can encode; collapsing that judgment into a manifest-declared graph blurs a boundary this platform otherwise keeps outside the CLI's mechanics.

### Explicit instance specifications with a persisted, fingerprinted execution plan

`assemble` writes an execution plan to disk with a generated `instanceId` per requested application and a content fingerprint per target; `apply` reads the saved plan, checks fingerprints for staleness, and materializes from the plan.

* Good, because a saved plan gives an auditable artifact that captures exactly what a prior `assemble` computed.
* Good, because a staleness check can catch a target that changed between preview and apply.
* Neutral, because it still delivers one batch operation over several templates, just through a persisted intermediate rather than a stateless call.
* Bad, because it introduces `instanceId` and a plan file as new identity and state concepts to steward, when the normalized target already uniquely identifies an applied instance without them.
* Bad, because a saved plan with fingerprints is a second piece of state that can drift out of sync with the project's actual files, and the staleness handling it requires is exactly the transient bookkeeping a call-time re-derivation avoids.

### Explicit target-keyed batch, no saved plan

A batch input names, per registered template, the targets to apply it to; `assemble` previews without writing; `apply` re-derives and re-validates from the batch at call time; identity is the normalized target.

* Good, because the batch is exactly the caller's selection off `frontx list --json` — nothing hidden, nothing generated.
* Good, because identity is the target itself, so no `instanceId` or `registryPath` needs to be generated, stored, or kept in sync.
* Good, because `assemble` is a pure preview and `apply` is self-sufficient, so there is no second state that can go stale between them.
* Neutral, because `apply` repeats work `assemble` already did when both are run in sequence — an accepted cost of not persisting an intermediate plan.
* Bad, because there is no separately-persisted approval artifact from `assemble`; approval is implicit in the caller re-supplying the same batch to `apply` after reviewing the preview.

## More Information

This decision fixes no manifest-declared `referencedTemplates` field and no transitive, cycle-detecting resolver, and the pre-flight ownership-boundary conflict check (`cpt-frontx-adr-assembly-conflict-prevention`) runs over an explicit target-keyed batch rather than over a resolver-expanded reference graph.

This decision bounds `cpt-frontx-adr-uniform-template-mechanism` (ADR 0030) on one point: a template arranging others does so through the caller's explicit target-keyed batch, not "by reference" through a manifest field. ADR 0030's core holding is untouched and is reinforced here: the platform still fixes **no template taxonomy**, and install, apply, assemble, conflict-check, and upgrade remain **one mechanism** operating identically over any template — uniform now also in that any combination of templates, however many or however each is shaped, is described and applied through the same batch, never through a per-template or per-preset special case.

The ownership-boundary declaration a batch's conflict check compares is unchanged in kind by this decision and continues to be shaped by `cpt-frontx-adr-template-ownership-boundary-declaration`; how an intentional overwrite of an already-applied instance is computed, reviewed, and approved remains the separate concern decided in `cpt-frontx-adr-project-upgrade-mechanism`. The field-level schema of the project-state file that records each applied target is owned by its FEATURE per `cpt-frontx-adr-contract-schema-ownership`, not by this decision. These are non-binding pointers to related decisions and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because this is local developer tooling with no throughput or latency budget bound to how a batch is expressed.
* **SEC** — Not applicable, because a target-keyed batch and a normalized target carry no secret material.
* **REL** — addressed implicitly: `apply`'s refuse-on-`additionalPaths` and never-silently-overwrite behavior, and `assemble`'s write-nothing guarantee, are this decision's reliability posture; there is no service-availability target for a local command.
* **DATA** — Not applicable as a complete schema, because the project-state file's field-level shape is owned by its FEATURE per `cpt-frontx-adr-contract-schema-ownership`; this decision fixes only that an applied instance's identity is its target and that no generated instance identifier is introduced.
* **INT** — addressed: the batch shape is an internal contract between the caller (AI or developer) and the CLI's `assemble`/`apply` commands; it names no external party.
* **OPS** — Not applicable, because no operational procedure attaches to a local batch call.
* **MAINT** — addressed directly: removing manifest-declared references and saved, fingerprinted plans collapses two persisted-state concepts into a single call-time-validated one, reducing the surface a maintainer must reason about.
* **UX** — addressed implicitly: a developer or AI previews a batch with `assemble` and applies the identical batch with `apply`, with no separate plan artifact to track between the two.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.
* **COMPL** — Not applicable, because resolving which templates a batch names governs ordering and refusal, not data handling, and imposes no regulatory obligation.

**Review cadence**: revisit if a validated need emerges for a persisted, re-usable plan artifact beyond a call-time batch (for example very large multi-template compositions repeated across sessions), or if a future multi-instance-per-target model requires reintroducing a generated instance identifier this decision retires.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-cli-seed-repository` — Seeding a repository from one or more templates is expressed as an explicit target-keyed batch applied in one `apply` call, not as a manifest-resolved reference graph.
* `cpt-frontx-fr-cli-add-template-to-repository` — Adding a template into an existing repository is one more entry in an explicit batch, identified by its target, with no generated instance identifier.
* `cpt-frontx-fr-cli-assembly-conflict-prevention` — The pre-flight ownership-boundary conflict check now runs over the batch's resolved targets and effective ownership rather than over a transitively-resolved preset reference graph; `assemble` previews this check without writing and `apply` repeats it before materializing.
* `cpt-frontx-contract-template-manifest` — The manifest contract declares no `referencedTemplates` field: a template does not name other templates to be applied alongside it, and composition is expressed only through the caller's explicit batch.
* `cpt-frontx-component-cli` — The CLI component's assembly mechanism is constrained by this decision to operate on an explicit, caller-supplied batch identified by target, with `assemble` as a stateless preview and `apply` as the self-sufficient, re-validating materializer.
