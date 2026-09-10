---
status: accepted
date: 2026-07-16
---

# How a Template Declares the Boundaries of What It Owns

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Two-tier boundary: exclusive subtrees plus shared-file region ownership with a declared merge](#two-tier-boundary-exclusive-subtrees-plus-shared-file-region-ownership-with-a-declared-merge)
  - [Single path-glob ownership list](#single-path-glob-ownership-list)
  - [Inferred ownership from emitted output](#inferred-ownership-from-emitted-output)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-template-ownership-boundary-declaration`

## Context and Problem Statement

A repository is assembled from one or more independently-authored templates that write into the same repository, so two templates can claim the same ground unless each declares what it owns (`cpt-frontx-fr-cli-template-boundary-declaration`). Some of what a template writes is exclusive to it — files and directories it alone creates — while some is shared: a `package.json`, a `tsconfig`, or a CI workflow that several templates must each contribute a part of. A single "this template owns these paths" declaration cannot express both cases, because a shared file cannot be owned whole by any one template. What shape should a template's ownership-boundary declaration take so that both exclusively-owned regions and jointly-written shared files can be declared, checked before writing, and arbitrated between independently-applied templates?

## Decision Drivers

* **Two ownership modes** — a template owns some subtrees exclusively and contributes into some shared files jointly; the declaration must express both, because collapsing them loses the distinction the conflict check needs.
* **Declared, not inferred** — the boundary a template claims must be an authored, inspectable property of the template, so what it owns is reviewable before it is applied rather than discovered from what it happened to write.
* **Granular enough to share a file** — for shared files the declaration must name ownership below the file level (a key path, a section, a region), so two templates can each own a disjoint part of one `package.json` or CI file without claiming the whole.
* **Checkable in isolation and against others** — a declaration must be well-formed on its own (validated at pre-publish) and comparable against another template's declaration to detect an intersection before any write.
* **Declared merge for shared regions** — where two templates legitimately contribute to the same shared file at disjoint regions, the declaration must state how their contributions combine, so a shared file is composed predictably rather than clobbered.

## Considered Options

* **Two-tier boundary: exclusive subtrees plus shared-file region ownership with a declared merge** — a template declares (a) the subtrees it owns exclusively — paths it alone may create or modify — and (b) for named shared files, the specific keys or regions it owns within them together with the merge by which its contribution combines with others'. The two tiers are the unit the conflict check compares.
* **Single path-glob ownership list** — a template declares one flat list of path globs it owns; a shared file is either owned whole by one template or excluded from ownership entirely.
* **Inferred ownership from emitted output** — a template declares nothing; the tool records what each template wrote and treats that as its boundary after the fact.

## Decision Outcome

Chosen option: **Two-tier boundary: exclusive subtrees plus shared-file region ownership with a declared merge**, because it is the only option that expresses both ownership modes and stays checkable before any write. A template's manifest declares two tiers: the **exclusive subtrees** it alone may create or modify, and, for each **shared file** it must write into (such as `package.json`, `tsconfig`, or a CI workflow), the specific keys or regions it owns within that file plus the **declared merge** by which its contribution combines with the contributions of other templates that own disjoint regions of the same file. The two tiers together are the ownership boundary the pre-flight conflict check compares across templates (`cpt-frontx-adr-assembly-conflict-prevention`).

The declaration is an authored property of the template carried in its manifest (`cpt-frontx-adr-template-manifest-contract`), so what a template owns is reviewable before it is applied and validated for well-formedness at pre-publish (`cpt-frontx-fr-cli-template-validate-prepublish`). The single-path-glob option is rejected because it cannot let two templates each own a disjoint part of one shared file — it forces a shared file to be owned whole or not at all, which either blocks legitimate joint contribution or leaves shared files unowned and unprotected. The inferred-ownership option is rejected because a boundary discovered only after writing cannot prevent a conflict before it lands and is not reviewable in advance.

The scope of this decision is the shape and tiers of the ownership-boundary declaration and that it is authored in the manifest. It does not decide the concrete field-level schema of the boundary declaration — that is owned by the manifest FEATURE (`cpt-frontx-feature-template-manifest`) per `cpt-frontx-adr-contract-schema-ownership` — nor how the check compares two declarations and refuses a conflict (`cpt-frontx-adr-assembly-conflict-prevention`).

### Consequences

* Good, because both ownership modes — exclusive subtrees and jointly-written shared files — are expressible in one declaration, so the conflict check has a complete picture of what each template claims.
* Good, because region-level ownership lets independently-authored templates each own a disjoint part of a `package.json`, `tsconfig`, or CI file without one clobbering another.
* Good, because the declaration is authored and inspectable, so what a template owns is reviewable and pre-publish-checkable before it is ever applied.
* Good, because a declared merge makes composing a shared file from several templates' contributions predictable rather than order-dependent or destructive.
* Bad, because a template author must maintain a richer, two-tier declaration than a flat path list, an authoring obligation the simpler option would avoid.
* Bad, because region-level ownership within a file requires the tool to reason about file-internal structure (keys, sections) for shared files, which is more than path comparison.

### Confirmation

Compliance is confirmed by pre-publish validation and a continuous-integration check on the CLI package: pre-publish validation rejects a template whose boundary declaration is malformed — an exclusive subtree that is not a well-formed path, or a shared-file region without a declared merge (`cpt-frontx-fr-cli-template-validate-prepublish`). A fixture check asserts two templates each declaring disjoint regions of one shared file are both accepted and that their declared merges compose the file, while two templates declaring intersecting exclusive subtrees — the same subtree, one nested inside the other, or one directory written with and without a trailing slash — or the same shared-file region are detected as an intersection by the conflict check (`cpt-frontx-adr-assembly-conflict-prevention` owns what "intersecting" means). Design and code review confirm the two tiers are carried in the manifest and that the concrete schema is owned by the manifest FEATURE.

## Pros and Cons of the Options

### Two-tier boundary: exclusive subtrees plus shared-file region ownership with a declared merge

A template declares exclusive subtrees and, per shared file, the regions it owns plus the merge combining its contribution with others'.

* Good, because it expresses both exclusive and jointly-written ownership.
* Good, because region-level ownership lets templates share one file without clobbering.
* Good, because it is authored, reviewable, and pre-publish-checkable.
* Neutral, because the concrete schema is owned by the manifest FEATURE rather than fixed here.
* Bad, because it is a richer declaration to author and requires file-internal reasoning for shared files.

### Single path-glob ownership list

A template declares one flat list of owned path globs; shared files are owned whole or excluded.

* Good, because the declaration is simple to author and to compare (path intersection only).
* Bad, because it cannot let two templates each own a disjoint part of one shared file.
* Bad, because shared files must be owned whole (blocking joint contribution) or left unowned (unprotected).

### Inferred ownership from emitted output

The tool records what each template wrote and treats that as its boundary after the fact.

* Good, because a template author declares nothing.
* Bad, because a boundary known only after writing cannot prevent a conflict before it lands.
* Bad, because inferred ownership is not reviewable in advance and cannot be validated at pre-publish.

## More Information

The manifest that carries the boundary declaration is decided in `cpt-frontx-adr-template-manifest-contract`; the pre-flight check that compares two templates' boundaries and refuses a conflicting assembly is decided in `cpt-frontx-adr-assembly-conflict-prevention`; the uniform mechanism this boundary model serves is decided in `cpt-frontx-adr-uniform-template-mechanism`. The concrete field-level schema of the boundary declaration is owned by `cpt-frontx-feature-template-manifest` per `cpt-frontx-adr-contract-schema-ownership`. These are non-binding pointers and do not form part of this decision's durable identity.

Applicability of the remaining checklist categories: **PERF** — Not applicable, because a declaration-shape decision binds no latency or throughput budget. **SEC** — Not applicable, because the declaration carries descriptive structure, not secret material. **REL** — Not applicable, because there is no service-availability target for a local declaration. **DATA** — addressed by deliberate omission: this decision fixes the boundary's tiers but not its field-level schema, which is owned by `cpt-frontx-feature-template-manifest` per `cpt-frontx-adr-contract-schema-ownership` (DATA-ADR-NO-001). **INT** — addressed: the boundary declaration is part of the manifest conformance contract compared across templates. **OPS** — Not applicable, because no operational procedure attaches to the declaration. **MAINT** — addressed: an explicit two-tier boundary makes what a template owns clear and comparable. **COMPL** — Not applicable. **UX** — addressed implicitly: a developer can read what ground a template claims before applying it. **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-cli-template-boundary-declaration` — Fixes the shape of the ownership-boundary declaration a template makes: exclusive subtrees plus shared-file region ownership with a declared merge.
* `cpt-frontx-contract-template-manifest` — The two-tier ownership boundary is declared in the manifest; this decision fixes its tiers while the concrete schema stays with `cpt-frontx-feature-template-manifest`.
* `cpt-frontx-fr-cli-template-validate-prepublish` — Pre-publish validation checks that a template's declared ownership boundaries are well-formed, which this two-tier shape makes checkable.
