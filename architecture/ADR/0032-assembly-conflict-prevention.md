---
status: accepted
date: 2026-08-12
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
  - [Exact-equality comparison of declared boundaries, plus a post-materialization honesty guard](#exact-equality-comparison-of-declared-boundaries-plus-a-post-materialization-honesty-guard)
  - [Allow coexistence through declared merge regions on shared files](#allow-coexistence-through-declared-merge-regions-on-shared-files)
  - [A nesting-aware, fail-closed algorithm over canonicalized, unique targets](#a-nesting-aware-fail-closed-algorithm-over-canonicalized-unique-targets)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-assembly-conflict-prevention`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) must refuse an assembly before any file is written when two independently-applied templates claim the same ground (`cpt-frontx-fr-cli-assembly-conflict-prevention`). A pairwise comparison that detects a clash only on **exact path equality** between two templates' claimed ground — recording a conflict only when one claimed path equals the other — does not answer that requirement. Two templates that claim overlapping but non-identical ground — one owning `src/` and another owning `src/config/` — pass the check silently, because neither subtree equals the other, even though the second is wholly contained in the first and a write into `src/config/` is a write into ground `src/`'s template already owns. Such a comparison also carries no rule for the project's own reserved ground (a project-owned root, `.frontx`, or a locally-installed template's own origin folder) intersecting a template's target, and no way for a template to deliberately carve out room for a nested template inside its own ownership. What comparison should the CLI perform over the targets an assembly and the already-applied project state claim, so that a containment relationship between two targets is treated as the conflict it is, while a template can still declare room for another template to nest inside it, and no path can ever escape the project root it is checked against?

## Decision Drivers

* **Containment is a conflict, not a pass** — one target being an ancestor or descendant of another means both templates would write into the same ground; an equality-only comparison lets it through, and closing that gap is what this decision exists to do.
* **Deliberate nesting must remain possible** — a template that hosts other templates (a shell, a monorepo root) needs a declared way to say "another template may target inside this specific subtree of mine," without that carve-out being indistinguishable from an undeclared clash.
* **The project keeps ground the mechanism must never grant** — `.frontx`, a project-owned root, and a locally-installed template's own origin folder are reserved; a template targeting into them is a conflict, while the reverse (the project reserving ground inside an applied template's target) is a legitimate subtraction from that template's ownership, not a clash.
* **Fail-closed path canonicalization** — a target must be resolved to one canonical, project-relative form before any comparison runs, and neither a symlink nor a `..` segment may resolve outside the project root; if a path cannot be proven to stay inside the root, the check refuses rather than guesses.
* **One check, applied twice, with the same rules** — `assemble` (preview) and `apply` (materialization) must both run the identical check over the whole batch plus everything already applied, so a conflict is never possible via a stale preview, a race between preview and apply, or a path that bypasses either command.
* **No escape hatch for an ownership conflict** — a boundary clash is a defect in what the batch asks for, not a judgment call an operator can override; there is no `--force`, and neither a template's `description` nor an AI layer selecting targets can suppress the check.

## Considered Options

* **Exact-equality comparison of declared boundaries, plus a post-materialization honesty guard** — two claims conflict only when their paths are identical; a guard after writing verifies each template wrote only inside what it declared.
* **Allow coexistence through declared merge regions on shared files** — extend the declaration so two templates can each own a disjoint, named region of one shared file (a `sharedFiles` construct), letting overlapping structural ground stand as long as the overlap is inside a jointly-owned file with compatible merge strategies.
* **A nesting-aware, fail-closed algorithm over canonicalized, unique targets** — canonicalize every target to a project-relative POSIX path with no possible escape from the project root, then classify every pair of targets after normalization as: an idempotent no-op (same target, same template), a conflict (same target, different templates), a conflict (ancestor/descendant containment) unless the inner target lies at or inside one of the outer template's declared `excludedSubtrees` entries, or a conflict (a target landing inside `projectOwnedRoot`, `.frontx`, or a local origin folder) — while a project-owned root or local origin folder landing inside a template's target is a permitted subtraction from that template's ownership, not a clash.

## Decision Outcome

Chosen option: **A nesting-aware, fail-closed algorithm over canonicalized, unique targets**, because it is the only option that turns containment into the conflict it actually is while still letting a template deliberately host another template, and it does so without reintroducing the shared-file machinery the project has separately decided to drop. Every target is first canonicalized to a project-relative POSIX path; a symlink or a `..` segment can never resolve outside the project root, and a path the CLI cannot prove stays inside the root is refused rather than passed through — resolution is fail-closed. Comparison then runs over the whole set of unique targets in the batch, combined with every target already recorded in `.frontx/project.json`:

* The same target claimed by two **different** templates is a conflict.
* The same target claimed twice by the **same** template is an idempotent no-op, not a conflict — re-applying a template to a target it already owns changes nothing.
* An ancestor/descendant relationship between two targets is a conflict, **unless** the inner (descendant) target lies **at or inside** one of the outer (ancestor) template's declared `excludedSubtrees` entries, in which case the outer template has deliberately carved out that ground and the nested target is permitted. The declared entry is itself admissible ground for the guest, not merely the space beneath it: a host that reserves `src/config/` has reserved it *for* a guest to occupy, so a guest targeting exactly `src/config/` is the ordinary case this carve-out exists to serve, not an edge one — and the same holds for a host reserving `src-app/mfe_packages/` for a nested template to land in. Ancestor/descendant is determined over **whole path segments of the canonicalized path, never a string prefix**: one target is an ancestor of another only when every one of its path segments matches the other's corresponding leading segments in order, so `packages/app` and `packages/app-shell` share no ancestor/descendant relationship despite one string being a character-prefix of the other — they are disjoint, sibling ground. An `excludedSubtree` must itself be a strict descendant of its own template's target (by the same segment-wise rule) and contain no `..` segment, and the template's own payload must not place files inside a subtree it has excluded from its own ownership — a template cannot declare a hole and then fill it.
* A target landing inside `projectOwnedRoot`, `.frontx`, an environment-owned entry (`.git`, `.DS_Store`, `Thumbs.db`), or a locally-installed template's own origin folder is a conflict: these are ground the mechanism never grants to a template, regardless of nesting.
* The reverse containment — a `projectOwnedRoot` or a local origin folder landing **inside** a template's target — is not a conflict; it is a subtraction from that template's effective ownership, computed as the whole target minus its `excludedSubtrees`, minus `projectOwnedRoots`, minus local origin folders, minus `.frontx`, minus the environment-owned entries.

The check runs over the **entire batch at once**, combined against everything already applied and recorded in project state, so a conflict between any two members of a batch — not only a conflict with what already exists — is caught in one pass. `assemble` runs this check as a preview and writes nothing; `apply` repeats the identical check immediately before materializing, so a conflict introduced between preview and apply, or reached by calling `apply` directly, is still caught. There is no override: an ownership conflict has no `--force`, and neither a template's `description` field nor any AI layer choosing targets can bypass the check — the check is mechanical and applies uniformly regardless of who or what selected the targets. Every refusal is reported through the CLI's single JSON error envelope so it is scriptable and does not require parsing prose. A *conflict* refusal — two claims contesting the same ground — carries the stable code `TARGET_CONFLICT` with the contesting templates and the contested ground in `details`. A path that fails the fail-closed canonicalization above carries `INVALID_PATH` instead: it is refused before any comparison runs, so there is no contesting template and no contested ground to report, and it is the same refusal every other CLI-checked path is subject to (`cpt-frontx-adr-cli-machine-readable-output` fixes both codes).

Exact-equality comparison is rejected because it is the defect this decision exists to fix: it passes a real containment conflict (`src/` against `src/config/`) as if the two templates claimed disjoint ground, and it has no rule at all for `projectOwnedRoot`, `.frontx`, or local origin folders. The declared-merge-on-shared-files option is rejected together with the `sharedFiles` construct it depends on: the project's registration and ownership model defines ownership over whole targets rather than file-level regions (see More Information), so introducing region-level coexistence here would add a file-region mechanism the surrounding design has no place for, and it does not address containment between two whole targets in any case.

### Consequences

* Good, because a real containment conflict (`src/` versus `src/config/`) is caught instead of silently passing — the defect an exact-equality comparison leaves open.
* Good, because a template can still deliberately host another template by declaring an `excludedSubtree`, so nesting remains possible without weakening the fail-closed default for undeclared overlap.
* Good, because canonicalization is fail-closed against symlinks and `..`, so no declared or resolved target can ever land outside the project root regardless of how it was authored.
* Good, because the same check runs identically in `assemble` and `apply` over the whole batch plus already-applied state, so no path — preview, direct apply, or a race between the two — can slip a conflict through.
* Good, because there is no override for an ownership conflict, so neither a careless `--force`, a persuasive `description`, nor an AI layer selecting targets can create a corrupted assembly.
* Bad, because an `excludedSubtree` is one more thing a template author must declare correctly — an outer template that forgets to exclude the ground a nested template needs will see a legitimate nesting refused as a conflict.
* Bad, because refusing rather than reconciling means a genuine, unanticipated nesting need still requires a template-manifest change and cannot be resolved by an operator flag at apply time.

### Confirmation

Compliance is confirmed by design and code review plus continuous-integration fixtures on the CLI package: (1) two different templates targeting the identical path are refused with `TARGET_CONFLICT` naming both templates and the path; (2) the same template applied twice to the same target is accepted as a no-op and writes nothing new; (3) a template targeting `src/config/` when another template already targets `src/` is refused, closing the known equality-only defect; (4) the same nested case is accepted when `src/`'s manifest declares `src/config/` inside `excludedSubtrees` — the guest's target being *equal to* the declared entry, not a strict descendant of it, is the case this fixture pins, since that is the shape a host reserving ground for one named guest actually produces; (5) a template's payload placing a file inside its own declared `excludedSubtree` is refused; (6) a target resolving via a symlink or a `..` segment to outside the project root is refused before any comparison runs; (7) a target landing inside `projectOwnedRoot`, `.frontx`, or an environment-owned entry (`.git`, `.DS_Store`, `Thumbs.db`) is refused, while a `projectOwnedRoot` declared inside an already-applied template's target is accepted and subtracted from that template's ownership; (8) `apply` run directly against a batch that `assemble` was never called on still refuses the same conflicts `assemble` would have reported, and no `--force` flag exists that changes any of these outcomes; (9) a template targeting `packages/app-shell` when another template already targets `packages/app` is accepted as disjoint, sibling ground — the anti-fixture confirming ancestor/descendant is decided by whole canonicalized path segments, not by string prefix.

## Pros and Cons of the Options

### Exact-equality comparison of declared boundaries, plus a post-materialization honesty guard

Two boundary claims conflict only when their paths are character-for-character identical; a guard after writing checks that each template wrote only inside what it declared.

* Good, because equality comparison is simple to implement and to reason about.
* Bad, because it misses every ancestor/descendant containment between two distinct targets, which is the exact defect motivating this decision.
* Bad, because the post-materialization honesty guard verifies a declared whole-target boundary after the fact, but the boundary itself carried no containment rule, so the guard has nothing correct to check a nested claim against.
* Bad, because it declares no rule for `projectOwnedRoot`, `.frontx`, or local origin folders intersecting a template's target.

### Allow coexistence through declared merge regions on shared files

Extend the declaration so two templates can each own a disjoint, named region of one shared file, letting overlapping ground stand when it is confined to compatible merge regions of a jointly-owned file.

* Good, because it lets two templates legitimately co-author one file, such as a root `package.json`.
* Bad, because it depends on the `sharedFiles` / region-ownership construct the surrounding registration and ownership design has removed in favor of whole-target ownership.
* Bad, because it addresses file-region coexistence, not containment between two whole targets — the defect this decision fixes is unaffected by it either way.
* Bad, because region-level merge reintroduces file-internal reasoning (keys, sections, merge strategies) the whole-target ownership model was chosen specifically to avoid.

### A nesting-aware, fail-closed algorithm over canonicalized, unique targets

Canonicalize every target, then classify every pair as a same-template no-op, a cross-template conflict, a containment conflict unless excluded, or a reserved-ground conflict, run over the whole batch plus already-applied state in both `assemble` and `apply`.

* Good, because containment is treated as the conflict it is, closing the known defect.
* Good, because deliberate nesting stays possible through a declared, strictly-scoped `excludedSubtree`.
* Good, because canonicalization is fail-closed against symlink and `..` escape.
* Neutral, because it depends on the manifest's `excludedSubtrees` field and the `.frontx/project.json` state shape, whose exact field layout belongs to the owning FEATURE.
* Bad, because correct nesting depends on the outer template author remembering to declare the exclusion.

## More Information

An exact-equality comparison plus a post-materialization honesty guard is the alternative this decision rejects, and the reason is a concrete defect: an equality check records a conflict only when `subtreeA === subtreeB`, so a template claiming `src/` and a template claiming `src/config/` are never flagged even though the second target is wholly contained in the first. Whole-target ownership expressed through a manifest's `excludedSubtrees`, a single project-state document (`.frontx/project.json`), and reserved project ground (`projectOwnedRoots`, `.frontx`, environment-owned entries, local origin folders) is the model this comparison arbitrates over. This ADR fixes the comparison algorithm and its fail-closed canonicalization; it does not fix the manifest's or the project-state document's exact field-by-field schema, which belongs to the owning FEATURE per `cpt-frontx-adr-contract-schema-ownership`. It also does not decide the CLI's command surface (`register`, `assemble`, `apply`, `delete`, `ownership add|remove|list`, and the rest) beyond the requirement that `assemble` and `apply` both run this check over the full batch before any write; that surface is a separate design concern.

This decision deliberately declares no post-materialization honesty guard, not even as defense-in-depth. Under whole-target ownership, "behind what a template declared" is the same question as "behind the target it was applied to": a template's declared boundary and its target coincide by construction, so a write such a guard would trip on is a write outside the target itself, and that is exactly the containment the fail-closed canonicalization and the pairwise comparison above already refuse before any file is written. A guard that re-checks the same boundary after materialization would only catch a bug in the materializer itself — a write that ignores the pre-flight-checked target — which is a correctness property of the assembler, not a second ownership contract this decision needs to carry. The guard is therefore removed as redundant contract surface, not as a relaxation of what is checked.

The comparison this decision fixes arbitrates only pairs where at least one side is a target under review — staged in the current batch or a candidate `apply`; two targets that are both already recorded in project state are never re-arbitrated against each other, since a prior successful `assemble`/`apply` already proved they do not conflict.

Reliability treatment (REL): fail-closed is the mechanism's reliability design. **Failure modes** — an unresolvable or escaping path, a cross-template target collision, a containment collision without a matching exclusion, and a target landing on reserved project ground all surface before any file is written, identically in both `assemble` and `apply`. They do not all carry the same code: a path that cannot be canonicalized or that escapes the project root is refused as `INVALID_PATH`, because nothing has been compared yet and no ground is contested — the refusal is about the path itself; the three collision modes, where two claims genuinely contest the same ground, are refused as `TARGET_CONFLICT` carrying the contesting templates and the contested ground in `details`. **Non-destructive** — nothing is written until the full batch, checked against already-applied state, passes; a refused batch writes zero files. **Recovery** — a refused batch leaves the repository and `.frontx/project.json` exactly as they were; there is no partial state to roll back. **No override (REL/COMPL)** — an ownership conflict has no `--force`; the only path past a refusal is correcting the manifest (declaring an `excludedSubtree`) or the requested targets, never a flag.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because comparing a batch's targets pairwise against already-applied state has no throughput or latency budget at decision altitude.
* **SEC** — addressed: fail-closed canonicalization against symlink and `..` escape is a security property of the mechanism, not merely a correctness one — a path the CLI cannot prove stays inside the project root is refused rather than trusted.
* **DATA** — Not applicable as a complete schema; the manifest's `excludedSubtrees` field and the `.frontx/project.json` document's shape are owned by their respective FEATUREs per `cpt-frontx-adr-contract-schema-ownership`.
* **INT** — addressed: the check reads the manifest's declared boundaries and the project-state document, both internal contracts between templates, the CLI, and the assembled repository.
* **OPS** — Not applicable, because this is a local command with no running service.
* **MAINT** — addressed: one algorithm, applied identically by `assemble` and `apply`, localizes all target-conflict arbitration in a single mechanism rather than duplicating comparison logic per command.
* **COMPL** — addressed: the absence of a `--force` path for an ownership conflict is a compliance property of the mechanism, not an oversight.
* **UX** — addressed: a refusal names the contesting templates and the contested ground in a stable, scriptable JSON envelope.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.
* **REL** — addressed: the check runs pre-flight, before any file is written, so a refused batch leaves the repository exactly as it was and there is no partially-applied state to recover from.

**Review cadence**: revisit if a validated need emerges for a supervised override of a refused ownership conflict (a `--force` escape hatch this decision deliberately omits), or once nesting scenarios beyond coincidence/ancestor/descendant surface an edge case the canonicalization algorithm does not yet cover.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-cli-assembly-conflict-prevention` — This decision fixes a nesting-aware, fail-closed algorithm over canonicalized targets rather than an exact-equality comparison, so containment between two templates' targets is refused before any write.
* `cpt-frontx-component-cli-conflict-checker` — This decision fixes the comparison algorithm this component runs, and that `assemble` and `apply` both run it identically over the full batch plus already-applied project state.
