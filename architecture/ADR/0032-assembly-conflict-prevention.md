---
status: accepted
date: 2026-07-16
---

# Detecting and Preventing Conflicting Assembly Before Any Files Are Written

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Pre-flight intersection check over a staged change set, refuse-not-merge, plus a post-materialization boundary-honesty guard](#pre-flight-intersection-check-over-a-staged-change-set-refuse-not-merge-plus-a-post-materialization-boundary-honesty-guard)
  - [Write-then-detect with rollback](#write-then-detect-with-rollback)
  - [Last-writer-wins merge](#last-writer-wins-merge)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-assembly-conflict-prevention`

## Context and Problem Statement

When a repository is assembled from more than one independently-applied template — several templates at seed time, a template added into an existing repository, or the templates a preset references — two of them can claim the same ground and, if both write, leave the repository corrupted or silently clobbered (`cpt-frontx-fr-cli-assembly-conflict-prevention`). Each template declares the boundaries of what it owns (`cpt-frontx-adr-template-ownership-boundary-declaration`), so the raw material to detect a clash exists. What mechanism should the CLI use to detect a conflicting assembly and prevent it, and at what point in the operation, so that no conflicting write ever reaches the repository and conflicting claims are never silently merged?

## Decision Drivers

* **Refuse, never silently merge** — when two templates claim the same ground the operation must stop and report, not guess a resolution; a silent merge is exactly the corruption the check exists to prevent.
* **Before any write** — the detection must happen before a single file is written, so a conflicting assembly never lands partially on disk; the operation is all-or-nothing.
* **Over the whole assembly at once** — the check must consider every template being applied together (including a preset's referenced templates) as one set, so a conflict between any pair is caught, not just conflicts with what is already present.
* **Boundaries are declarations, not promises** — a template could write outside what it declared; the mechanism needs a way to catch a template that violates its own declared boundary during materialization, not only to compare declarations.
* **Deterministic and reviewable** — the same set of templates must always yield the same conflict verdict, and a reported conflict must name the templates and the ground they contest so a developer can act on it.

## Considered Options

* **Pre-flight intersection check over a staged change set, refuse-not-merge, plus a post-materialization boundary-honesty guard** — the CLI computes the full set of writes every applied template intends against a staged (in-memory) change set, checks whether a staged template's declared ownership boundaries intersect another applied template's at an exclusive subtree or at the same shared-file region, and refuses the whole assembly before any write if they do; after materialization it verifies each template wrote only within its declared boundary, catching a template that violated its own declaration.
* **Write-then-detect with rollback** — templates write to the repository (or a scratch copy) and the tool detects a collision from the resulting files, rolling back if two templates wrote the same ground.
* **Last-writer-wins merge** — templates apply in order and a later write to the same ground overwrites an earlier one, with the tool reporting what it overwrote.

## Decision Outcome

Chosen option: **Pre-flight intersection check over a staged change set, refuse-not-merge, plus a post-materialization boundary-honesty guard**, because it is the only option that guarantees no conflicting write reaches the repository while never silently merging conflicting claims. Before any file is written, the CLI stages the full change set the whole assembly intends — every applied template, including the templates a preset references, considered as one set — and runs a **pre-flight intersection check**: it compares the declared ownership boundaries (`cpt-frontx-adr-template-ownership-boundary-declaration`) of every pair of applied templates in which at least one side is a staged claim, and flags an intersection when two claim intersecting exclusive subtrees or the same shared-file region without a compatible declared merge. If any intersection is found, the CLI **refuses the whole assembly and reports the contesting templates and the contested ground before writing anything** — it does not merge, and it does not write a partial result.

Arbitration judges the incoming assembly against the state the repository already records, never two recorded boundaries against each other: an inconsistency between two templates already applied is one the incoming operation did not create and cannot repair, so refusing that operation would block unrelated work without resolving anything. The accepted cost is that such an overlap goes unreported. A boundary declaration is read from the installed template's current manifest rather than frozen when the template was applied, so reinstalling one at a widened version can make two recorded boundaries overlap after both were admitted, and no check reports it.

Two exclusive subtrees intersect when they address ground that cannot be held independently, compared by whole path segments: the same subtree, the same directory written with and without a trailing slash, or one subtree lying inside the other. Nesting is the same impossibility as an identical claim, because `src` and `src/config` both make their owner the exclusive owner of `src/config/app.ts`, and this check is the only place that arbitrates it among the shapes it compares - exclusive subtree against exclusive subtree, and shared file against shared file. A cross-kind collision, where one template's exclusive subtree contains another's declared shared-file path, is compared by neither pairing and is not yet judged anywhere (issue #546). The segment comparison bounds the refusal in the other direction as well: `src` and `src-app/` share a string prefix and no ground, so an assembly declaring both is materialized. A report over two claims that are not spelled identically names both of them, since either one alone identifies half of what the developer has to reconcile.

Because a declared boundary is a claim a template could violate, the mechanism adds a **post-materialization boundary-honesty guard**: after the approved change set is written, the CLI verifies each template wrote only within the boundary it declared, so a template that writes outside its declaration is caught rather than trusted. The write-then-detect option is rejected because it lets a conflicting write land (even to a scratch copy) before detection and makes atomicity depend on rollback rather than on never writing a conflict; the last-writer-wins option is rejected outright because it is the silent merge the refuse-not-merge driver forbids.

The scope of this decision is the conflict-detection mechanism and its placement (pre-flight over a staged change set, plus a post-materialization honesty guard) and the refuse-not-merge rule. It does not decide the shape of the boundary declaration it compares (`cpt-frontx-adr-template-ownership-boundary-declaration`), how a preset's references are resolved into the set being checked (`cpt-frontx-adr-composed-template-resolution`), or the manifest that carries the declarations (`cpt-frontx-adr-template-manifest-contract`).

### Consequences

* Good, because no conflicting write ever reaches the repository — detection is before the first write, so a conflicting assembly is impossible to land even partially.
* Good, because conflicting claims are reported and refused, never silently merged, so a developer sees the contested ground and decides how to resolve it.
* Good, because staging the whole assembly at once catches a conflict between any pair of applied templates with a staged claim on at least one side, including a preset's referenced templates, not only conflicts with what is already present.
* Good, because the post-materialization guard turns a declared boundary into an enforced one, catching a template that writes outside its own declaration.
* Bad, because staging the full intended change set before writing costs an extra pass over what every template would produce.
* Bad, because the check refuses rather than resolves, so a developer facing a genuine conflict must restructure or drop a template rather than have the tool reconcile it.

### Confirmation

Compliance is confirmed by continuous-integration checks on the CLI package: a fixture assembly of two templates that declare the same exclusive subtree is refused with a report naming both templates and the contested subtree, and no file is written (asserted byte-for-byte). Synthetic fixture templates, authored for the test rather than resolved from any published template, cover the other two intersection shapes — one subtree nested inside another, and one directory written with and without a trailing slash — each refused with a report naming both claims and both templates, alongside a fixture pinning that two subtrees sharing only a string prefix are not refused. A second fixture of two templates declaring disjoint regions of one shared file with compatible merges is accepted and materialized. A third fixture, in which a template writes outside its declared boundary, is caught by the post-materialization guard. Design and code review confirm the intersection check runs before any write, that there is no code path that merges conflicting claims, and that a preset's referenced templates are included in the staged set the check considers.

## Pros and Cons of the Options

### Pre-flight intersection check over a staged change set, refuse-not-merge, plus a post-materialization boundary-honesty guard

Stage the whole assembly's intended writes, compare declared boundaries pairwise, refuse before writing if any intersect, and verify honesty after materialization.

* Good, because no conflicting write can land, even partially.
* Good, because conflicts are reported and refused, never silently merged.
* Good, because the whole assembly is checked at once and the honesty guard enforces declarations.
* Neutral, because it depends on the boundary declaration and preset resolution as separate decisions.
* Bad, because it costs a pre-write staging pass and refuses rather than reconciles.

### Write-then-detect with rollback

Templates write, the tool detects a collision from results, and rolls back on conflict.

* Good, because it needs no staged model of intended writes.
* Bad, because a conflicting write lands before detection, so atomicity rests on rollback rather than on never writing a conflict.
* Bad, because rollback of a partially-written repository is itself a failure surface.

### Last-writer-wins merge

Templates apply in order; a later write overwrites an earlier one at the same ground.

* Good, because assembly never stops and always produces a result.
* Bad, because it is precisely the silent merge the refuse-not-merge driver forbids.
* Bad, because the result depends on application order and quietly discards a template's contribution.

## More Information

The declared ownership boundaries this check compares are decided in `cpt-frontx-adr-template-ownership-boundary-declaration`; the resolution that produces the set of templates for a preset is decided in `cpt-frontx-adr-composed-template-resolution`; the manifest carrying the declarations is decided in `cpt-frontx-adr-template-manifest-contract`; the uniform mechanism this check is part of is decided in `cpt-frontx-adr-uniform-template-mechanism`. These are non-binding pointers and do not form part of this decision's durable identity.

Reliability treatment (REL): the refuse-before-write rule is the mechanism's reliability design. **Failure modes** — an intersection between two templates' boundaries, or a preset reference that cannot be resolved, surfaces during the pre-flight check before any file is written; the repository is untouched. **Non-destructive** — nothing is written until the staged assembly passes the check; a refused assembly writes zero files. **Recovery** — a refused assembly leaves the repository exactly as it was, so there is nothing to roll back. **Operational readiness (REL-ADR-002)** — service-oriented items (deployment, monitoring, alerting, runbooks, SLA) are Not applicable, because this is a local command with no running service; the post-materialization guard is the recovery point for a template that violated its declaration.

Applicability of the remaining checklist categories: **PERF** — Not applicable, because there is no latency or throughput budget bound to a local pre-flight check. **SEC** — Not applicable, because the check introduces no secret material or authentication surface. **DATA** — Not applicable, because this decision fixes no schema; boundary shape is owned by `cpt-frontx-feature-template-manifest` per `cpt-frontx-adr-contract-schema-ownership`. **INT** — addressed: the check reads the manifest's boundary declarations, an internal contract between templates and the CLI. **OPS** — Not applicable, per the operational-readiness note above. **MAINT** — addressed: one pre-flight check localizes all conflict arbitration in a single mechanism. **COMPL** — Not applicable. **UX** — addressed: a refused assembly reports the contesting templates and the contested ground so a developer can act. **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-cli-assembly-conflict-prevention` — The pre-flight intersection check with the refuse-not-merge rule is the mechanism that detects two templates claiming the same ground and refuses the assembly before any files are written.
* `cpt-frontx-adr-template-ownership-boundary-declaration` — This check compares the two-tier boundaries that decision defines to detect an intersection.
* `cpt-frontx-component-cli` — The CLI component owns the conflict-prevention mechanism; this decision constrains where in the operation the check runs and that it refuses rather than merges.
