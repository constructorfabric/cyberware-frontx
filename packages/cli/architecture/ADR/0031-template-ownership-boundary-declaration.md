---
status: accepted
date: 2026-08-12
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
  - [Whole-target ownership minus declared and project-specific exclusions](#whole-target-ownership-minus-declared-and-project-specific-exclusions)
  - [Two-tier boundary: exclusive subtrees plus shared-file region ownership with a declared merge](#two-tier-boundary-exclusive-subtrees-plus-shared-file-region-ownership-with-a-declared-merge)
  - [Per-file provenance with baseline hashes and drift tracking](#per-file-provenance-with-baseline-hashes-and-drift-tracking)
  - [Hierarchical delegation through a parent-instance relationship](#hierarchical-delegation-through-a-parent-instance-relationship)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-template-ownership-boundary-declaration`

## Context and Problem Statement

A template is applied to a single target directory and, per `cpt-frontx-adr-project-provenance-record`, that target is the boundary a later upgrade or delete must respect (`cpt-frontx-fr-cli-template-boundary-declaration`). One way to express that boundary is to have a template enumerate exclusive subtrees and shared-file regions with a declared merge, treating ownership as a standing claim over content the tool tracks and reconciles. In practice a project developer edits every file a template applies freely the moment `apply` finishes — the CLI has no mechanism and no mandate to detect or resist that edit — and the only ground the tool actually needs to arbitrate is whether a *second* template instance may write into ground a first instance already occupies. A per-file or per-region declaration is more contract than that arbitration requires and does not by itself express the one case that also matters: a project developer's own files living inside a template's target that must survive that template's upgrade or delete. What should a template's target ownership mean, and what should it exclude, so that ownership answers exactly the question — which template arbitrates this ground, and which parts of it are exempt for authored extension points or a project's own files — without the tool trying to police what a project developer does to files after apply?

## Decision Drivers

* **Ownership arbitrates lifecycle, not content** — after `apply`, the files a template wrote belong to the project and are edited freely; the tool must resolve only which template instance governs a given path for the purposes of upgrade, delete, and a competing instance's writes, never what that path's content should be.
* **Whole target as the default, not an enumerated list** — a template's target is exactly the ground it was told to occupy; requiring every owned path to be separately declared repeats information the target already carries and invites a declaration that drifts from what the template actually writes.
* **Author-declared extension points, not shared-file regions** — a template author needs a way to mark specific descendants of its own target where a nested template instance may legitimately sit, but does not need a merge-region contract for jointly-written files, because no two template instances write into the same target.
* **Project-specific exclusions distinct from template-declared ones** — a project developer's own files can land inside a template's target for reasons the template author could never anticipate; excluding them from ownership is a project decision, made and revoked in the project's own state, not something a template manifest can declare in advance.
* **Fail-closed geometry over the exclusion set** — whichever paths are excluded, their relationship to the target (nested, coincident, ancestor) must be checked the same way ownership conflicts are checked, so an exclusion cannot silently create a gap or a hidden double claim.
* **No per-file bookkeeping** — per-region declarations imply the kind of per-file tracking `cpt-frontx-adr-project-provenance-record` and this decision's driver both reject; ownership must be computable from a target plus a short list of excluded subtrees, not from a record that grows with every file a template writes.

## Considered Options

* **Whole-target ownership minus declared and project-specific exclusions** — a template owns its entire target by default; the manifest may declare `excludedSubtrees` as static, authored extension points (strict descendants of the target, where a nested template instance is permitted); the project's `.frontx/project.json` may separately declare `projectOwnedRoots`, project-specific paths excluded from ownership by the developer, added and removed after apply without touching files. Effective ownership is the target minus both exclusion sets and minus the further subtractions the Decision Outcome below enumerates in full; that enumeration is stated once there rather than repeated here.
* **Two-tier boundary: exclusive subtrees plus shared-file region ownership with a declared merge** — a template declares the subtrees it owns exclusively and, for shared files, the regions it owns within them plus a merge rule for combining contributions from other templates.
* **Per-file provenance with baseline hashes and drift tracking** — the CLI records a hash of every file a template wrote at apply time and compares against that baseline at upgrade or delete time to detect a project developer's edits (drift), treating a changed file as no longer template-owned.
* **Hierarchical delegation through a parent-instance relationship** — a nested template instance records the identity of the template instance whose target contains it, and ownership of a path is resolved by walking that parent chain rather than by set subtraction over a flat target-and-exclusions model.

## Decision Outcome

Chosen option: **Whole-target ownership minus declared and project-specific exclusions**, because it is the only option that treats ownership purely as lifecycle arbitration — computable from a target and two short exclusion lists — while still expressing both an author's static extension points and a project developer's own files, without any per-file bookkeeping. A template applied to a target owns that **entire target** by default. Two disjoint mechanisms subtract from that default:

* **`excludedSubtrees`**, declared statically in the template manifest, are the template author's own extension points: strict descendants of the target (no `..`, no coincidence with the target itself) where the author intends a nested template instance to be applied. A template's own payload must not write files inside its own declared exclusions, and a nested template's target is permitted only when it lies at or inside one of the parent's declared exclusions — the declared entry itself is admissible ground for the nested target, not merely the space beneath it (`cpt-frontx-adr-assembly-conflict-prevention` fixes this containment test) — anywhere else, a nested target is a conflict, not an exclusion.
* **`projectOwnedRoots`**, recorded in `.frontx/project.json`, are project-specific exclusions a developer manages directly through `ownership add | remove | list`: `add` accepts only a path that already exists and marks it (and everything beneath it) as outside any template's ownership; `remove` un-marks it without touching files. A root that falls inside a target is a valid dynamic subtraction from that target's ownership; a root that coincides with or is an ancestor of a target is a conflict, checked with the same geometry used to detect two templates claiming the same ground (`cpt-frontx-adr-assembly-conflict-prevention`). A payload file that would land inside a protected root is skipped at apply time with an explicit `skipped` entry in the report, rather than silently written or silently dropped.

`.frontx` is excluded from every template's ownership without exception, but that exclusion does not leave `.frontx/ai/<manifest-name>/` ownerless. The CLI itself materializes that bundle as a CLI-owned step distinct from any template's ownership-governed writes, exactly as it materializes `.frontx/project.json`: the bundle lives in the template's payload by convention at `.frontx/ai/<manifest-name>/` in the template directory's root — keyed to the template's manifest *identity*, not to any one target — and is delivered once, the first time that name's `apply` gives it its first target; refreshed on `upgrade` when the new version's payload carries a bundle; and removed when `delete` removes that name's last remaining target. No template ever claims this path through `excludedSubtrees` or any other ownership declaration; the CLI, not the template, is the sole writer and remover of `.frontx/ai/<manifest-name>/`.

Effective ownership of a target is therefore: **target − manifest `excludedSubtrees` − `projectOwnedRoots` − the template's own local origin folder (when installed by local path) − `.frontx` − environment-owned entries (`.git`, `.DS_Store`, `Thumbs.db`)**. This is the whole surface `delete` may remove for that template (itself excluding the same subtractions, plus any nested target and its own exclusions), and the whole surface a second template instance must stay out of. Nothing in this model tracks file content, hashes, or per-file state: once a file is written by `apply`, it is the project's, and the only thing the CLI still knows about it is which subtraction rule, if any, keeps it out of the next `delete` or the next competing template's ownership.

The two-tier boundary option is rejected because shared-file region ownership and a declared merge solve a problem this design does not have — no two template instances ever write into the same target, so there is nothing to merge — and because per-region declarations are exactly the standing content contract the first driver rejects: a template author would be declaring merge behavior for edits a project developer, not another template, will make. The per-file provenance option is rejected because baseline hashes and drift detection are the bookkeeping this decision explicitly avoids, and because they contradict the premise that a file belongs to the project the moment `apply` writes it — drift is not corruption to be detected, it is the expected, permitted state. The hierarchical-delegation option is rejected because a parent-instance chain introduces a lifecycle relationship between template instances (what happens to a child instance when its parent upgrades or is deleted) that this decision does not need to answer yet: a nested target's ownership is fully determined by whether it sits inside a declared `excludedSubtrees` entry, with no walk up a parent chain required.

### Consequences

* Good, because ownership is computable from a target plus two short, inspectable exclusion lists, so no per-file state is written, read, or kept in sync as a template's target grows.
* Good, because a project developer edits every applied file freely with no tool-enforced content contract, matching the reality that a template's job ends at `apply` and the files it wrote are the project's from that point on.
* Good, because `excludedSubtrees` gives a template author exactly the one thing they need — a place to declare a nested template is expected — without a merge contract for a case (jointly-written shared files) that whole-target ownership makes structurally impossible.
* Good, because `projectOwnedRoots` gives a project developer a lightweight, reversible way to protect their own files from a future `delete` or upgrade, managed through `ownership add | remove | list` without ever touching the files themselves.
* Good, because the same conflict geometry (coincidence, ancestor, descendant) arbitrates both `excludedSubtrees`-vs-nested-target and `projectOwnedRoots`-vs-target, so there is one fail-closed check rather than two different ones.
* Bad, because a template author cannot express "I own only these specific files inside my target and nothing else" — whole-target ownership means everything not explicitly excluded is claimed, so an author who wants a narrower claim must model it as an exclusion instead.
* Bad, because a payload file that lands inside a `projectOwnedRoots` path is silently skipped rather than applied, so a template upgrade can leave a project on an older version of a file the developer did not realize was protected, discoverable only through the apply or upgrade report's `skipped` entries.
* Bad, because ownership scales with the target, and a template applied at the repository root therefore owns the entire repository minus the subtractions above — so `delete` on it proposes removing every file the developer has ever added at root that no subtraction covers. `projectOwnedRoots` is the instrument that protects those files, but it is opt-in and, for a developer who has not met it, is learned after the loss rather than before it. Two things bound the hazard rather than closing it: `delete` is confirmation-gated and never proceeds on a first call, reporting the full remove/preserve lists first (`--dry-run` produces the same lists with nothing at stake), and those lists name the root-owned files explicitly, so the blast radius is stated before it is executed rather than discovered afterwards. This decision deliberately fixes no special rule for a root target — a root target is geometrically an ordinary target, and carving out an exception would make ownership depend on where a template happens to be applied. The concrete case this repository is about to create, `template-shell` moving from a file-subset claim to whole-target ownership at the root, is exactly the behavioural change `cpt-frontx-feature-template-territory-conversion` flags for its own review rather than a mechanical manifest edit.
* Neutral, because `.frontx` is unconditionally excluded from every template's ownership, so no template may materialize files there through the ownership mechanism this decision defines; content under `.frontx/ai/<manifest-name>/` is instead materialized, refreshed, and removed by a CLI-owned step outside any template's ownership (see More Information).

### Confirmation

Compliance is confirmed by design and code review plus a continuous-integration check on the CLI package: a fixture template with a manifest declaring `excludedSubtrees` is applied, and `apply` refuses payload files the template itself places inside its own declared exclusion; a nested template applied inside that exclusion succeeds, while a nested template applied to a target outside the parent's declared exclusions is refused as a conflict. A second fixture registers a `projectOwnedRoots` entry via `ownership add` on an existing path inside an applied template's target, then re-applies (or upgrades) that template with a payload file landing inside the protected root: the report — apply's or upgrade's, whichever ran — lists that file under `skipped` and the file on disk is left untouched. A third fixture asserts that `ownership add` on a path coincident with or an ancestor of an applied target is refused, that `delete` on a target preserves its declared exclusions, any nested target, and every `projectOwnedRoots` entry beneath it, and that `.frontx` and the environment-owned entries `.git`, `.DS_Store`, and `Thumbs.db` are never included in any computed ownership set or delete plan. A fourth fixture applies a template whose payload carries a `.frontx/ai/<manifest-name>/` bundle to a target and asserts the bundle is materialized once the name's first target exists, is refreshed on `upgrade` when the new payload carries one, and is removed only when `delete` removes that name's last remaining target — never claimed by the template's own `excludedSubtrees`.

## Pros and Cons of the Options

### Whole-target ownership minus declared and project-specific exclusions

A template owns its whole target by default; the manifest's `excludedSubtrees` mark static author extension points, and the project's `projectOwnedRoots` mark project-specific, developer-managed exclusions; effective ownership is the target minus both and minus the remaining subtractions the Decision Outcome enumerates in full.

* Good, because it needs no per-file state and treats a project developer's post-apply edits as expected, not as drift.
* Good, because it expresses both an author's extension points and a project's own protected files with two small, disjoint, reversible lists.
* Good, because the same fail-closed geometry check arbitrates every exclusion against every target.
* Neutral, because a template cannot claim a narrower slice of its target than "everything except the declared exclusions."
* Bad, because a payload file silently skipped inside a protected root is discoverable only through the apply or upgrade report, not enforced automatically.

### Two-tier boundary: exclusive subtrees plus shared-file region ownership with a declared merge

A template declares exclusive subtrees plus, for shared files, the regions it owns and a merge rule for combining with other templates' contributions.

* Good, because it can express two templates jointly contributing to one shared file.
* Bad, because no two template instances write into the same target in this design, so the shared-file case the merge rule exists for cannot occur, making the contract pure overhead.
* Bad, because per-region declarations imply a standing content contract that contradicts a project developer's freedom to edit applied files.

### Per-file provenance with baseline hashes and drift tracking

The CLI hashes every file a template writes at apply time and diffs against that baseline at upgrade or delete time to detect edited files.

* Good, because it gives the tool precise, automatic knowledge of exactly which files a project developer changed.
* Bad, because it is exactly the per-file bookkeeping this decision rejects, growing with every file a template ever writes.
* Bad, because it treats an expected, permitted edit (drift) as an anomaly to detect, contradicting the premise that applied files belong to the project.

### Hierarchical delegation through a parent-instance relationship

A nested template instance records its parent instance's identity; ownership of a path resolves by walking that parent chain.

* Good, because it can express multi-level lifecycle relationships between nested instances explicitly.
* Bad, because it introduces parent-child lifecycle questions (what happens to a child on the parent's upgrade or delete) that are premature: a nested target's ownership is already fully determined by whether it sits inside a declared `excludedSubtrees` entry.
* Bad, because a lookup requires walking a chain rather than a flat target-and-exclusions subtraction, adding a resolution mechanism the flat model does not need.

## More Information

This decision declares no two-tier exclusive-subtree-plus-shared-file-region model, no declared-merge contract, and no region-level ownership: ownership is whole-target minus `excludedSubtrees` and `projectOwnedRoots`. Every consumer of the boundary shape — the manifest's boundary shape (`cpt-frontx-contract-template-manifest`, narrowed by `cpt-frontx-adr-template-manifest-contract` and owned by `cpt-frontx-feature-template-manifest` per `cpt-frontx-adr-contract-schema-ownership`), the pre-flight intersection check (now decided by `cpt-frontx-adr-assembly-conflict-prevention`), and the applied-state record (now the `targets` entries of the single project-state document, `cpt-frontx-adr-project-provenance-record`) — now resolves against this decision's whole-target-minus-exclusions model instead: the conflict check compares targets and their `excludedSubtrees`/`projectOwnedRoots` geometry rather than shared-file regions and merge compatibility, and an applied instance's occupied boundary is the target itself minus its declared `excludedSubtrees`, not a set of region claims.

`cpt-frontx-adr-extension-discovery-activation` (ADR 0024) describes AI extension bundles materialized under `.frontx/ai/<identity>/`, and this decision unconditionally subtracts `.frontx` from every template's effective ownership, so no template may claim that write path through the ownership mechanism defined here. The write-path owner is the CLI itself, not a template: `apply` materializes `.frontx/ai/<manifest-name>/` from the applying template's payload as a CLI-owned step, keyed to the template's manifest name rather than to any one target — delivered once, on the first target that name acquires; refreshed on `upgrade` when the new version's payload carries a bundle; removed when `delete` removes that name's last remaining target. This mechanism sits alongside the CLI's other self-owned write, `.frontx/project.json`, and is governed by the same unconditional `.frontx` exclusion this decision fixes, not by a separate ownership carve-out or a template-declared exclusion.

The environment-owned entries `.git`, `.DS_Store`, and `Thumbs.db` are subtracted unconditionally alongside `.frontx`: they belong to the developer's environment and to version control, never to a template, so no ownership declaration may claim them and no `delete` may remove them. The subtraction is stated as part of the enumeration above rather than left implicit in a validator's constant list, so a reader of this decision sees every term of the boundary in one place.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because computing a target-minus-exclusions set is a small, local comparison with no throughput or latency budget at decision altitude.
* **SEC** — Not applicable, because ownership subtraction operates on path structure, not secret material; the same path-escape protections (`..`, symlink traversal) already required for the target itself apply identically to `excludedSubtrees` and `projectOwnedRoots`.
* **REL** — Not applicable, because there is no service-availability target for a local ownership computation; the skip-not-overwrite behavior for `projectOwnedRoots` is this decision's failure-mode treatment, covered under Confirmation.
* **DATA** — Not applicable as a complete schema, because the concrete field layout of `excludedSubtrees` and `projectOwnedRoots` is owned by their respective manifest and project-state FEATUREs per `cpt-frontx-adr-contract-schema-ownership`; this decision fixes only what each set means and how it subtracts from a target.
* **INT** — addressed: this decision changes what the conflict check (`cpt-frontx-adr-assembly-conflict-prevention`) and the provenance record (`cpt-frontx-adr-project-provenance-record`) each compare, as described above.
* **OPS** — Not applicable, because no operational procedure attaches to a local ownership computation.
* **MAINT** — addressed: replacing a per-region declaration with a flat target-minus-exclusions model means the tool carries no merge-compatibility logic at all — an entire class of behaviour this model never introduces.
* **UX** — addressed: a developer can see exactly what a template owns by reading one target path and two short exclusion lists, and can protect their own files with a single reversible `ownership add`.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.
* **COMPL** — Not applicable, because ownership arbitration decides which files a template may write inside a developer's own repository; no regulated data and no disclosure duty attaches to that.

**Review cadence**: revisit if a validated need emerges for ownership finer-grained than whole-target-minus-exclusions (for example a recurring shared-file-region use case a two-tier model would serve), or once real template authoring shows `excludedSubtrees` lists growing large enough to erode the "read one target path and two short lists" usability property this decision relies on.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-cli-template-boundary-declaration` — Fixes the shape of what a template's ownership boundary declaration means: whole-target ownership by default, narrowed only by manifest-declared `excludedSubtrees` and project-managed `projectOwnedRoots`, with no exclusive-subtree or shared-file-region category.
* `cpt-frontx-fr-cli-assembly-conflict-prevention` — The pre-flight intersection check now compares targets and their `excludedSubtrees`/`projectOwnedRoots` geometry (coincidence, ancestor, descendant) instead of shared-file regions and declared merges.
* `cpt-frontx-contract-template-manifest` — The manifest's ownership declaration is now a single static list, `excludedSubtrees`, rather than a two-tier exclusive-subtree-plus-shared-file-region structure; the concrete schema remains owned by `cpt-frontx-feature-template-manifest`.
* `cpt-frontx-contract-project-provenance` — An applied instance's occupied boundary is now derived from its recorded target minus the manifest's declared `excludedSubtrees`, not stored as a set of region-level ownership claims.
