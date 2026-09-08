# Feature: Kindless Template Assembly & Conflict-Checked Composition

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Preview an Explicit Batch](#preview-an-explicit-batch)
  - [Seed a New or Empty Repository](#seed-a-new-or-empty-repository)
  - [Apply a Batch into an Already-Assembled Repository](#apply-a-batch-into-an-already-assembled-repository)
  - [Delete an Applied Target](#delete-an-applied-target)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Resolve and Stage an Explicit Batch](#resolve-and-stage-an-explicit-batch)
  - [Pre-Flight, Nesting-Aware Target Conflict Check](#pre-flight-nesting-aware-target-conflict-check)
  - [Existing-Content Reconciliation](#existing-content-reconciliation)
  - [Compute a Target's Deletion Plan](#compute-a-targets-deletion-plan)
  - [Materialize or Remove the CLI-Owned AI-Extension Bundle](#materialize-or-remove-the-cli-owned-ai-extension-bundle)
- [4. States (CDSL)](#4-states-cdsl)
  - [Assembly Operation State Machine](#assembly-operation-state-machine)
  - [Delete Operation State Machine](#delete-operation-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [One Uniform Batch Path: Preview and Apply](#one-uniform-batch-path-preview-and-apply)
  - [Nesting-Aware, Fail-Closed Conflict Check](#nesting-aware-fail-closed-conflict-check)
  - [Existing-Content Protocol and Idempotent Re-Apply](#existing-content-protocol-and-idempotent-re-apply)
  - [Delete Under Explicit Confirmation](#delete-under-explicit-confirmation)
  - [CLI-Owned AI-Extension Bundle Materialization](#cli-owned-ai-extension-bundle-materialization)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-cli-scaffolding`

## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-cli-scaffolding`

### 1.1 Overview

`@gears-frontx/cli` applies any registered template through one uniform batch path: `assemble` previews an explicit, target-keyed batch statelessly and writes nothing; `apply` independently re-resolves and re-validates the identical batch shape and materializes it, whether the target repository has never had a template applied (seed) or already carries applied templates (add). A pre-flight, nesting-aware conflict check canonicalizes every target and refuses the whole batch before any file is written when two targets coincide, when one contains another outside a declared exclusion, or when a target lands on reserved project ground. This feature also owns `delete`, which computes a target's deletion plan through the same conflict-checker geometry and executes it only under explicit confirmation. All CDSL behavior is `target` (GREENFIELD — grounded in `cpt-frontx-adr-composed-template-resolution`, `cpt-frontx-adr-template-ownership-boundary-declaration`, `cpt-frontx-adr-assembly-conflict-prevention`, and DESIGN §3.2/§3.6).

Composition is not resolved from a manifest-declared reference graph: a batch names exactly the templates and targets a caller wants applied, and no template may pull in another through its own manifest. Ownership is not declared as a two-tier exclusive-subtree-plus-shared-file-region structure: a template owns its entire target by default, narrowed only by its manifest's `excludedSubtrees` and the project's `projectOwnedRoots`. There is no `sharedFiles` construct, no merge strategy, and no region marker of any kind — no two templates ever write into the same target, so there is nothing to compose at the file level.

### 1.2 Purpose

This feature realizes the explicit target-keyed batch model decided in `cpt-frontx-adr-composed-template-resolution`, the whole-target ownership model decided in `cpt-frontx-adr-template-ownership-boundary-declaration`, and the nesting-aware, fail-closed conflict check decided in `cpt-frontx-adr-assembly-conflict-prevention`. It covers previewing a batch (`assemble`), materializing a batch to seed a new repository or extend one that already holds applied templates (`apply`), and deleting an applied target (`delete`). It realizes the internal components `cpt-frontx-component-cli-assembler` (batch resolution, materialization, existing-content reconciliation, delete) and `cpt-frontx-component-cli-conflict-checker` (canonicalization and the nesting-aware intersection check, reused identically by `assemble`, `apply`, `delete`, and `cpt-frontx-feature-composed-provenance`'s `ownership add`).

This feature resolves no manifest-declared preset (`referencedTemplates`) and composes no shared files from declared, merge-strategy-tagged regions. Composition is driven only by the caller's explicit batch, and a target is owned wholly by one template — there is no region-level co-ownership, no `compose-shared-files` algorithm, and no marker-delimited block to locate, carry forward, or refuse. Delete is owned here: the Assembler computes a deletion plan through the Conflict Checker's geometry.

A template's AI-extension bundle at `.frontx/ai/<manifest-name>/` is delivered by a dedicated CLI-owned step this feature owns (`cpt-frontx-algo-cli-scaffolding-ai-bundle`), never through the template's own ownership. `cpt-frontx-adr-template-ownership-boundary-declaration` unconditionally subtracts `.frontx` from every template's effective ownership, so no template may claim or materialize a bundle there through the ownership mechanism this feature implements for targets; instead, the first `apply` that gives a template name its first target copies that name's `.frontx/ai/<manifest-name>/` convention folder — when the template's payload carries one — out of the template's installed content path and into the project's `.frontx/ai/<manifest-name>/`, exactly as the CLI itself writes `.frontx/project.json`: a CLI-owned write no template manifest declares and no ownership-boundary computation ever attributes to the template. The bundle is materialized once per name, refreshed by `upgrade` when a new version of the name's payload carries a new bundle (`cpt-frontx-feature-upgrade-changeset`), and removed by `delete` when a name's last remaining target is deleted. This feature's conflict check and materialization continue to treat `.frontx` as reserved ground no target may ever claim; that reservation is what makes the CLI-owned bundle step safe to run unconditionally rather than a further rule this feature's conflict check enforces per bundle.

**Requirements**: `cpt-frontx-fr-cli-seed-repository`, `cpt-frontx-fr-cli-add-template-to-repository`, `cpt-frontx-fr-cli-template-boundary-declaration`, `cpt-frontx-fr-cli-assembly-conflict-prevention`, `cpt-frontx-fr-cli-template-delete`

**Principles**: `cpt-frontx-principle-ownership-bounded-composition`, `cpt-frontx-cli-principle-reviewed-reversible-mutation`

**Applicability** (Often-N/A domains for a CLI Command feature, per the FEATURE checklist's Applicability Context): COMPL is not applicable — no regulatory or compliance scope attaches to file-lifecycle operations on a developer's own repository. OPS (observability) is not applicable — this feature introduces no logging, metrics, or tracing surface of its own beyond the uniform envelope and the `--dry-run`/preview reporting it already specifies. SEC is partially addressed rather than N/A: the Conflict Checker's fail-closed path canonicalization (`inst-cc-canonicalize`, `INVALID_PATH`) is a path-traversal control, though this feature enforces no authentication or authorization boundary. PERF is addressed by `cpt-frontx-cli-nfr-template-scale` (§6, Acceptance Criteria). UX is addressed by `assemble`'s preview report and `delete`'s confirmation/dry-run surface (§2).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Previews and applies an explicit batch to seed or extend a repository, resolves any reported conflict or existing-content decision, and confirms or declines a delete — directly or through an AI agent acting on their authorization |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: `cpt-frontx-adr-composed-template-resolution`, `cpt-frontx-adr-template-ownership-boundary-declaration`, `cpt-frontx-adr-assembly-conflict-prevention`, `cpt-frontx-adr-source-spec-syntax`, `cpt-frontx-adr-cli-machine-readable-output`, `cpt-frontx-adr-cli-internal-decomposition`
- **Dependencies**:
  - `cpt-frontx-feature-template-resolution` (F10 — resolves and auto-installs a registered template's content)
  - `cpt-frontx-feature-composed-provenance` (owns `.frontx/project.json`: this feature reads registered origins and every already-applied target and `projectOwnedRoots` from it, and records every newly applied or deleted target into it)

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-usecase-scaffold-composed-project`, `cpt-frontx-usecase-add-microfrontend-to-project`, `cpt-frontx-usecase-ai-driven-template-delete`

### Preview an Explicit Batch

- [x] `p1` - **ID**: `cpt-frontx-flow-cli-scaffolding-assemble-preview`

**Actor**: `cpt-frontx-actor-project-developer`

**Realizes**: `cpt-frontx-seq-composed-project-scaffold`

**Success Scenarios**:
- Developer supplies a batch `{"templates": {"<name>": ["<target>", ...]}}` to `assemble`; the CLI resolves each named template, computes effective ownership, and runs the nesting-aware conflict check against the batch plus everything already applied; the repository is byte-identical before and after — nothing is written.

**Error Scenarios**:
- A named template has no entry in the project state store: the CLI reports `TEMPLATE_NOT_REGISTERED` and previews nothing further for that entry.
- The conflict check reports an intersecting claim: the CLI reports `TARGET_CONFLICT`, naming the contesting templates and the contested ground.

**Steps**:
1. [x] - `p1` - Developer invokes `assemble` with a batch naming, for each registered template, the target or targets to apply it to - `inst-asm-invoke`
2. [x] - `p1` - The CLI invokes the batch resolution algorithm (`cpt-frontx-algo-cli-scaffolding-uniform-apply`) in preview mode, auto-installing a named template's registered origin when its content is not yet locally available - `inst-asm-resolve`
3. [x] - `p1` - **IF** any named template has no entry in the project state store, or its registered origin cannot be auto-installed - `inst-asm-if-resolve-fail`
   1. [x] - `p1` - **RETURN** the corresponding failure (`TEMPLATE_NOT_REGISTERED` or `ORIGIN_UNAVAILABLE`); nothing written - `inst-asm-return-resolve-fail`
4. [x] - `p1` - The CLI submits the staged batch to the pre-flight conflict check (`cpt-frontx-algo-cli-scaffolding-conflict-check`) against everything already applied, read from the project state store - `inst-asm-conflict-check`
5. [x] - `p1` - **IF** the check reports an intersecting claim - `inst-asm-if-conflict`
   1. [x] - `p1` - **RETURN** `TARGET_CONFLICT` naming the contesting templates and the contested ground; nothing written - `inst-asm-return-conflict`
6. [x] - `p1` - **RETURN** the preview report — resolution, effective ownership per target, and a clean pass; the repository and the project state store are untouched - `inst-asm-return-preview`

### Seed a New or Empty Repository

- [x] `p1` - **ID**: `cpt-frontx-flow-cli-scaffolding-seed-repository`

**Actor**: `cpt-frontx-actor-project-developer`

**Realizes**: `cpt-frontx-seq-composed-project-scaffold`

**Success Scenarios**:
- Developer invokes `seed <dir> --input <batch>` against a new or empty project directory that carries no `.frontx/project.json` yet: the CLI first resolves and validates every named official default template's origin — exactly as the register algorithm would, without writing anything — then creates `.frontx/project.json`, auto-registers each default — pinning it and writing its entry through the register algorithm (`cpt-frontx-algo-composed-provenance-register`, `cpt-frontx-feature-composed-provenance`) exactly as a direct `register` call would — then applies the batch through the identical apply mechanism `cpt-frontx-flow-cli-scaffolding-add-template` uses: resolving, conflict-checking against reserved ground only (nothing is applied yet), reconciling each target's existing on-disk content if any, and materializing every target in one operation, recording each under its template's entry.

**Error Scenarios**:
- `<dir>` does not exist, or names an existing file rather than a directory: `seed` refuses with `INVALID_PATH` before constructing any of its own dependencies; nothing written.
- `<dir>` already carries a `.frontx/project.json`: `seed` refuses with `INVALID_INPUT` — a project once seeded is extended through `apply`, never re-seeded; nothing written.
- A batch entry names a template that is not one of the CLI's built-in official default origins: `seed` accepts only the official defaults, since no `.frontx/project.json` can yet exist for anything to already be registered against; caught during the up-front validation, before the CLI writes anything, the CLI refuses with `TEMPLATE_NOT_REGISTERED`, naming the entry and directing the developer to `register` the template — which creates `.frontx/project.json` on this first mutation if it does not exist yet, exactly as `seed` itself would have — and then `apply` it: no prior `seed` call is required for this path, `register` then `apply` is the complete bootstrap on its own; whole batch aborted, nothing written.
- A named official default's origin cannot be resolved and pinned: caught during the same up-front validation, `ORIGIN_UNAVAILABLE` (or the probe's own failure code); whole batch aborted, `.frontx/project.json` left uncreated.
- Two batch entries collide or one contains another outside a declared `excludedSubtrees`, or a batch entry lands on `.frontx` or a reserved environment entry (there is no `projectOwnedRoots` yet to land on): `TARGET_CONFLICT`; whole batch aborted, and the CLI rolls back its own `.frontx/project.json` write and every registration made so far (removing the document, and the `.frontx` directory itself when this call created it and it is now empty again) before returning, so nothing remains written and a later `seed` call against the same directory is not refused as already-seeded.
- Materializing the batch refuses AFTER one or more payload files, or an AI-extension bundle, were already written (an `--adopt-existing`-adopted path altered by this same batch, a symlink-related containment escape or existing-symlink destination, an AI-extension bundle refusal, or any other error the apply mechanism converts to a structured failure): the apply mechanism's OWN internal rollback (`inst-add-rollback-writes`) already removes those files and bundles and prunes every directory its own pre-write pass proved this call created, so in the ordinary case there is nothing left for `seed`'s own rollback to do beyond its own two writes; `seed`'s own rollback additionally removes the exact files and bundles the apply mechanism's own outcome reports (`details.writtenPaths`/`details.bundledNames`) — redundant, and harmless, in the ordinary case, and the one real backstop for the narrow case where the apply mechanism deliberately left an earlier, already-committed name's files and bundle standing but `seed` still wants them gone, since a project either seeds completely or not at all. Nothing remains written, and the failure message reports what is true after `seed`'s own rollback runs, never the apply phase's own now-stale "files remain" (or bundle-materialized) wording.
- A target's existing on-disk content differs from what the template's payload would write at a path the payload declares: `CONTENT_CONFLICT`; whole batch aborted, with the identical rollback described above — nothing remains written.
- A target already holds content at a path the payload does not declare: `EXISTING_PATHS_REQUIRE_DECISION`; whole batch aborted unless `--adopt-existing` is given, with the identical rollback described above when it is aborted.

**Steps**:
1. [x] - `p1` - Developer invokes `seed <dir> --input <batch>`, naming in the batch the official default templates to apply - `inst-seed-invoke`
2. [x] - `p1` - **IF** `<dir>` does not exist, or exists but is not a directory - `inst-seed-if-invalid-dir`
   1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the path; nothing written. Checked before any other seam is constructed, because the canonicalizer this command builds from `<dir>` resolves the real path and throws on a missing one — an unhandled throw the entrypoint could only report as an internal error, with no envelope at all in `--json` mode. A caller-supplied path that is not there is an ordinary user error and answers like one - `inst-seed-return-invalid-dir`
3. [x] - `p1` - **IF** `<dir>` already carries a `.frontx/project.json` - `inst-seed-if-already-seeded`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT`, directing the developer to `apply` instead; nothing written - `inst-seed-return-already-seeded`
4. [x] - `p1` - **FOR EACH** batch entry naming a default template, before writing anything the CLI resolves and validates it exactly as the register algorithm would (`cpt-frontx-algo-composed-provenance-register`), without writing - `inst-seed-preflight-defaults`
   1. [x] - `p1` - **IF** the name does not name one of the CLI's official default templates, or probing its registration fails - `inst-seed-if-preflight-fail`
      1. [x] - `p1` - **RETURN** `TEMPLATE_NOT_REGISTERED` (unnamed default) or the probe's own failure code; nothing written, since this runs before the CLI's first write - `inst-seed-return-preflight-fail`
5. [x] - `p1` - The CLI creates `.frontx/project.json` with the initial empty shape (`cpt-frontx-algo-composed-provenance-project-state-io`) - `inst-seed-create-project-state`
6. [x] - `p1` - **IF** any step from here through the apply mechanism below fails - `inst-seed-rollback`
   1. [x] - `p1` - Before returning the failure, the CLI rolls back its own writes so far: removing every file the apply phase's own `details.writtenPaths` names as written and every CLI-owned AI-extension bundle its `details.bundledNames` names as materialized (reusing the identical removal formulation `apply`'s own rollback defines, `inst-add-rollback-writes`, rather than a second, independently-duplicated walk) — with an EMPTY created-set of its own, since by the time `seed` learns `writtenPaths` the apply phase has already finished writing and the one moment "did this directory already exist" is answerable has already passed; this step therefore prunes NO directory itself, relying entirely on the apply phase's OWN internal rollback (which does have that moment, and takes it) having already pruned everything it could safely prove was its own to remove — then removing `.frontx/project.json`, and removing the `.frontx` directory itself when this call created it (it did not already exist immediately before step 4 above) and it is now empty again — so the directory is left exactly as `seed` found it, with no empty directory the apply phase's own writes brought into being left standing, courtesy of the apply phase's own pruning rather than this step's own. The CLI composes its own failure message from what is true AFTER this rollback runs — it never repeats a file or bundle list the rollback has just made stale, and never states that files remain in the same breath it states that nothing remains - `inst-seed-rollback`
7. [x] - `p1` - **FOR EACH** batch entry naming an official default template not yet registered — every name here already passed the up-front validation above - `inst-seed-foreach-default`
   1. [x] - `p1` - The CLI resolves the built-in default's origin and invokes the register algorithm (`cpt-frontx-algo-composed-provenance-register`) to pin it and write `templates[name]` - `inst-seed-register-default`
   2. [x] - `p1` - **IF** resolution or registration fails - `inst-seed-if-register-fail`
      1. [x] - `p1` - Roll back (`inst-seed-rollback`) and **RETURN** `ORIGIN_UNAVAILABLE` naming the default and its origin; abort before any target is applied, nothing remains written - `inst-seed-return-register-fail`
8. [x] - `p1` - The CLI resolves and re-stages the batch (`cpt-frontx-algo-cli-scaffolding-uniform-apply`) against the now-registered names - `inst-seed-resolve`
9. [x] - `p1` - **IF** any named template still has no entry in the project state store, or its registered origin cannot be auto-installed - `inst-seed-if-resolve-fail`
   1. [x] - `p1` - Roll back (`inst-seed-rollback`) and **RETURN** the corresponding failure (`TEMPLATE_NOT_REGISTERED` or `ORIGIN_UNAVAILABLE`); nothing further remains written - `inst-seed-return-resolve-fail`
10. [x] - `p1` - The CLI runs the pre-flight conflict check (`cpt-frontx-algo-cli-scaffolding-conflict-check`); because no template has yet been applied in this project, the comparison set is the batch's own entries plus reserved ground only (`.frontx`, the reserved environment entries `.git`/`.DS_Store`/`Thumbs.db`; there is no `projectOwnedRoots` yet) - `inst-seed-conflict-check`
11. [x] - `p1` - **IF** the check reports an intersecting claim - `inst-seed-if-conflict`
    1. [x] - `p1` - Roll back (`inst-seed-rollback`) and **RETURN** `TARGET_CONFLICT`; nothing remains written - `inst-seed-return-conflict`
12. [x] - `p1` - The CLI runs existing-content reconciliation (`cpt-frontx-algo-cli-scaffolding-existing-content`) for every target in the batch — every target is unrecorded, since the project state store was just created empty - `inst-seed-existing-content`
13. [x] - `p1` - **IF** any target reports a content conflict, or reports additional paths and `--adopt-existing` was not given - `inst-seed-if-existing-conflict`
    1. [x] - `p1` - Roll back (`inst-seed-rollback`) and **RETURN** `CONTENT_CONFLICT` or `EXISTING_PATHS_REQUIRE_DECISION` naming the paths; nothing remains written for the whole batch - `inst-seed-return-existing-conflict`
14. [x] - `p1` - The CLI materializes every target in the batch in one operation, leaving any adopted additional paths untouched - `inst-seed-materialize`
15. [x] - `p1` - For each template name that just received its first target, the CLI materializes that name's CLI-owned AI-extension bundle (`cpt-frontx-algo-cli-scaffolding-ai-bundle`) into `.frontx/ai/<manifest-name>/`, when the template's payload carries one - `inst-seed-materialize-bundle`
16. [x] - `p1` - The CLI records every newly applied target under its template's entry in the project state store (`cpt-frontx-feature-composed-provenance`) - `inst-seed-record`
17. [x] - `p1` - **RETURN** success — repository seeded, every default registered, every target recorded - `inst-seed-return-done`

### Apply a Batch into an Already-Assembled Repository

- [x] `p1` - **ID**: `cpt-frontx-flow-cli-scaffolding-add-template`

**Actor**: `cpt-frontx-actor-project-developer`

**Realizes**: `cpt-frontx-seq-composed-project-scaffold`

**Success Scenarios**:
- Developer supplies a batch to `apply` for a project that already has at least one applied target: the CLI runs the identical mechanism as seeding, except the conflict check now also compares the batch against every already-applied target read from the project state store.
- Developer supplies a batch to `apply` for a project with zero applied targets: `.frontx/project.json` already exists — created by a prior, separate `register` call on its own first mutation, since `apply` requires every named template to already have a `templates[name]` entry to resolve against and so can never itself be the first thing to touch a truly virgin directory — but every template's `targets[]` in it is still empty. `apply` runs the identical mechanism as the already-applied case; this is the ordinary bootstrap path for a non-official, forked, or `path:` template into a fresh repository, requiring no prior `seed` call, and the conflict check's comparison set is reserved ground only, exactly as it is when `seed` runs against the same starting state.
- Developer re-applies the same template to the same target a second time — whether or not the on-disk content still matches exactly — and that target is already recorded under that template's `targets[]` entry in the project state store: the CLI treats it as an idempotent no-op purely by that record, reading no on-disk content and running no existing-content reconciliation for it.

**Error Scenarios**:
- Same as seeding, plus: a batch entry coincides with, or is an undeclared ancestor/descendant of, a target another template already occupies: `TARGET_CONFLICT`, naming the contesting templates and the contested ground; whole batch aborted, nothing written.
- A batch entry lands on `projectOwnedRoots`, `.frontx`, a local origin folder, or a reserved environment entry (`.git`, `.DS_Store`, `Thumbs.db`): `TARGET_CONFLICT`; whole batch aborted, nothing written.
- An unrecorded target's payload path is reached through a symlinked ancestor that escapes the project root: `INVALID_PATH` (step 8), naming the path; whole batch aborted, nothing written. Checked, and refused, BEFORE the existing-content refusals below (step 9) ever run — a containment escape and content reconciliation's own "this cannot be compared" verdict are different problems with different remedies, and an escaping path is `INVALID_PATH` even when the identical path would also be reported as an uncomparable `contentConflicts` entry by reconciliation's own, coarser symlink test.
- Materializing the batch (step 10 below) or its AI-extension bundle (step 11) refuses after one or more files were already written — a payload path already exists as a symlink (`CONTENT_CONFLICT`), a payload or project-state write resolves outside the project root through a symlink introduced since the pre-flight check (`INVALID_PATH`), an `--adopt-existing`-adopted path was altered by materializing this same batch (`CONTENT_CONFLICT`), or the AI-extension bundle step itself refuses (`INVALID_PATH`): the CLI removes every file this call itself wrote, removes every CLI-owned AI-extension bundle this SAME call itself materialized at step 11 (`.frontx/ai/<manifest-name>/` is reserved, CLI-owned ground per `cpt-frontx-adr-template-ownership-boundary-declaration` — reclaiming a bundle this call created is this rollback reclaiming its own ground, not a destructive guess), and prunes every directory the file removals leave empty (step 10.3, `inst-add-rollback-writes`) before returning, so a refused batch leaves nothing new behind — except for the one case where an earlier name in the SAME batch already had its targets recorded to the project state store before a later name's own record step failed, where that earlier name's files AND its bundle are left in place rather than deleted out from under its own just-committed record. The returned `details.writtenPaths` names every payload path this call wrote and `details.bundledNames` names every bundle it materialized, whether or not this rollback ran, and the message states plainly which is true for each.

**Steps**:
1. [x] - `p1` - Developer invokes `apply` with a batch naming one or more registered templates and targets, individually or together, against a repository that already has at least one applied target - `inst-add-invoke`
2. [x] - `p1` - The CLI independently re-resolves and re-stages the batch (`cpt-frontx-algo-cli-scaffolding-uniform-apply`) - `inst-add-resolve`
3. [x] - `p1` - **IF** any named template has no entry in the project state store, or its registered origin cannot be auto-installed - `inst-add-if-resolve-fail`
   1. [x] - `p1` - **RETURN** the corresponding failure (`TEMPLATE_NOT_REGISTERED` or `ORIGIN_UNAVAILABLE`); nothing written - `inst-add-return-resolve-fail`
4. [x] - `p1` - The CLI runs the pre-flight conflict check (`cpt-frontx-algo-cli-scaffolding-conflict-check`) against the batch's own entries and every target already recorded in the project state store - `inst-add-conflict-check`
5. [x] - `p1` - **IF** the check reports an intersecting claim against an already-applied target, or among the batch's own entries, or against reserved ground - `inst-add-if-conflict`
   1. [x] - `p1` - **RETURN** `TARGET_CONFLICT` naming the contesting templates and the contested ground; nothing written - `inst-add-return-conflict`
6. [x] - `p1` - **FOR EACH** target in the batch already recorded under its named template's `targets[]` entry in the project state store - `inst-add-if-recorded-noop`
   1. [x] - `p1` - Treat it as an idempotent no-op by that record alone: no on-disk content is read for it, existing-content reconciliation never runs for it, and no file is written for it - `inst-add-noop-target`
7. [x] - `p1` - The CLI runs existing-content reconciliation (`cpt-frontx-algo-cli-scaffolding-existing-content`) only for every target in the batch **not** already recorded under its template's `targets[]` entry, against whatever is already on disk there — nothing, or foreign content (never this template's own previously-applied content, since that case is already resolved as a no-op by record in the prior step) - `inst-add-existing-content`
8. [x] - `p1` - **IF** any unrecorded target's payload path cannot be proven to stay inside the project root, symlinks resolved — checked BEFORE the existing-content refusals in the next step, so a path escaping containment through a symlinked ancestor is refused for THAT reason first, even when reconciliation's own (coarser) symlink test would also have reported the identical path as an uncomparable `contentConflicts` entry - `inst-add-if-escape`
   1. [x] - `p1` - **RETURN** `INVALID_PATH` naming every such path; nothing written for the whole batch - `inst-add-return-escape`
9. [x] - `p1` - **IF** any unrecorded target reports a content conflict, or reports additional paths and `--adopt-existing` was not given - `inst-add-if-existing-conflict`
   1. [x] - `p1` - **RETURN** `CONTENT_CONFLICT` or `EXISTING_PATHS_REQUIRE_DECISION` naming the paths; nothing written for the whole batch - `inst-add-return-existing-conflict`
10. [x] - `p1` - The CLI materializes every target in the batch that is not an idempotent no-op-by-record, leaving any adopted additional paths untouched, tracking every path it writes (`writtenPaths`) - `inst-add-materialize`
    1. [x] - `p1` - **IF**, after materializing, any `--adopt-existing`-adopted additional path no longer reads exactly as it did beforehand — the telltale sign that a declared payload path elsewhere in this batch was itself a symlink aliasing it - `inst-add-if-adopted-corrupted`
       1. [x] - `p1` - **RETURN** `CONTENT_CONFLICT` naming the corrupted path(s); nothing is recorded, and every file this call wrote during this step is removed (`inst-add-rollback-writes`, step 10.3 below) rather than left on disk over content it silently altered - `inst-add-return-adopted-corrupted`
    2. [x] - `p1` - **IF** a write during this step, the AI-extension bundle step below (step 11), or the project-state record step below (step 12) throws a path-containment refusal (a payload or project-state path resolves outside the project root through a symlink introduced since the pre-flight check above) or an existing-symlink-destination refusal (a payload path materialized as a symlink in the narrow window between this algorithm's own read and this step's write) - `inst-add-if-write-refusal`
       1. [x] - `p1` - **RETURN** the corresponding structured refusal — `INVALID_PATH` for a path-containment refusal, `CONTENT_CONFLICT` for an existing-symlink-destination refusal, `INTERNAL` for any other unexpected error — naming the offending path; nothing further is recorded, and every file this call wrote is removed (`inst-add-rollback-writes`, step 10.3 below) unless an earlier name in this same batch already had its own targets committed to the project state store during this call, in which case that earlier name's files are left in place rather than deleted out from under its own just-committed record - `inst-add-return-write-refusal`
    3. [x] - `p1` - Whenever steps 10.1 or 10.2 above return a refusal that is safe to roll back (no target's record was yet committed to the project state store during this call): remove every file named in `writtenPaths`; remove every CLI-owned AI-extension bundle THIS CALL itself materialized at step 11 below — never a bundle that already stood before this call, which the same "not yet committed" guard already keeps untouched for the identical reason it keeps an already-recorded name's payload files untouched; and prune every directory the file removals (never the bundle removals — a CLI-owned bundle directory is reclaimed whole, not walked for emptiness) leave empty, deepest-first, bounded by the project root — never the project root itself, never anything above it, and never a directory this call did not itself bring into being: a pre-write probe run before any file was written records exactly which directories along each payload path's route did not yet exist, and only a directory in that recorded set is ever a pruning candidate, however empty a removal leaves some OTHER, already-standing directory. The identical formulation `seed` reuses for its own rollback (`inst-seed-rollback`) rather than a second, independently-duplicated directory-pruning-and-bundle-removal walk - `inst-add-rollback-writes`
11. [x] - `p1` - For each template name that just received its first target in this batch, the CLI materializes that name's CLI-owned AI-extension bundle (`cpt-frontx-algo-cli-scaffolding-ai-bundle`) into `.frontx/ai/<manifest-name>/`, when the template's payload carries one, recording which names this call actually materialized a bundle for so step 10.3 above knows exactly what is this call's own to remove on a later rollback - `inst-add-materialize-bundle`
12. [x] - `p1` - The CLI records every newly applied target under its template's entry in the project state store - `inst-add-record`
13. [x] - `p1` - **RETURN** success — new targets recorded; already-recorded targets reported as no-ops-by-record - `inst-add-return-done`

### Delete an Applied Target

- [x] `p1` - **ID**: `cpt-frontx-flow-cli-scaffolding-delete-target`

**Actor**: `cpt-frontx-actor-project-developer`

**Realizes**: `cpt-frontx-cli-seq-ai-driven-delete`

**Success Scenarios**:
- Developer runs `delete <target>` interactively: the CLI computes the deletion plan, shows what would be deleted and what would be preserved, prompts for confirmation defaulting to No, and on explicit confirmation removes the deletion plan's ground from disk and removes the target from its template's entry in the project state store.
- An AI agent acting for the developer runs `delete <target> --json`: the CLI returns `CONFIRMATION_REQUIRED` with the delete/preserve lists, never prompting or reading stdin; having obtained the developer's authorization out of band, the agent re-issues the identical command with `--yes`, and the CLI recomputes the identical geometry — never trusting the first call's result — before deleting.
- Developer or agent runs `delete <target> --dry-run`: the CLI reports the same delete/preserve lists without deleting anything and without requiring confirmation in either mode, because nothing is at stake to confirm.
- Deleting `<target>` empties its template name's last remaining target, and the CLI's own follow-up removal of that name's `.frontx/ai/<manifest-name>/` bundle fails: the deletion still reports success — the target's ground is gone and the project state document already reflects it, both correct — and names the surviving bundle path in the reported `aiBundleResidue`, rather than reporting the whole operation as failed over a destruction that already happened.

**Error Scenarios**:
- `<target>` is not found among any registered template's `targets` array: the CLI refuses with `TARGET_NOT_APPLIED`, naming the target as not an applied instance of any registered template.
- `<target>` IS found among a registered template's `targets` array, but its own on-disk location is no longer an ordinary directory — replaced by a regular file, or any other non-directory entry, since it was applied: the CLI refuses with `CONTENT_CONFLICT`, naming the target, rather than enumerating an empty candidate set (which would read as "nothing here to preserve or delete", false) or letting a bare filesystem error reach the caller with no structured envelope. This check runs on every plan computation — the initial one and the recomputation immediately before a confirmed deletion — so a target replaced between the two computations is still caught.
- Interactive confirmation is declined (the default): nothing is deleted, the repository and the project state store are unchanged.
- `--json` mode without `--yes`: `CONFIRMATION_REQUIRED`; nothing deleted.

**Steps**:
1. [x] - `p1` - Developer or AI agent invokes `delete <target>` (optionally `--json`, `--yes`, `--dry-run`) - `inst-del-invoke`
2. [x] - `p1` - Resolve WHICH recorded target the caller means before resolving WHERE on disk to act: compare the caller's own spelling, lexically normalized, against every registered template's `targets[]` first, and only when nothing matches compare the canonicalized form against the canonicalized form of each recorded entry. Canonicalization answers where the ground is, never which record the caller means — a target applied under one name whose on-disk location has since become a symlink canonicalizes to a path `targets[]` never held, and keying the lookup off that would leave the recorded target unreachable through the only command that can remove it. Everything downstream — the plan, the confirmation report, and the `targets[]` entry the deletion removes — uses the RECORDED spelling this step returns - `inst-del-resolve-recorded-name`
3. [x] - `p1` - The CLI invokes the deletion-plan algorithm (`cpt-frontx-algo-cli-scaffolding-delete-plan`) against `<target>` - `inst-del-compute-plan`
4. [x] - `p1` - **IF** `<target>` is not found in any template's `targets` array - `inst-del-if-not-applied`
   1. [x] - `p1` - **RETURN** `TARGET_NOT_APPLIED`, naming the target as not an applied instance of any registered template - `inst-del-return-not-applied`
   2. [x] - `p1` - **ELSE IF** `<target>` IS found, but its own on-disk location, or any component of the path leading to it, is no longer an ordinary directory — replaced by a regular file, or any other non-directory entry, since `<target>` was applied. The component that blocks the path is named whether it is `<target>` itself or one above it: a blocked ancestor makes the target exactly as unenumerable, and is otherwise indistinguishable from a target whose ground a developer removed by hand, which this flow deliberately treats as an ordinary empty deletion. The identical fact `apply` and `upgrade` already refuse for a payload path whose disk shape cannot be compared, applied here to the TARGET's own shape rather than a path beneath it: its recorded content can no longer be enumerated, compared, or removed the way a directory's content is. This check runs on every plan computation this flow makes — the initial one here and the recomputation immediately before a confirmed deletion, whichever route (`--json --yes` or interactive) reaches it — so a target replaced between the two computations is still caught - `inst-del-if-target-shape-drifted`
      1. [x] - `p1` - **RETURN** `CONTENT_CONFLICT`, naming the blocking component; nothing deleted, and `<target>` stays in its template's `targets[]` — striking a target from the record without having been able to look at its ground would report a deletion that never happened - `inst-del-return-target-shape-drifted`
5. [x] - `p1` - **IF** `--dry-run` was given - `inst-del-if-dry-run`
   1. [x] - `p1` - **RETURN** the delete/preserve lists; nothing is deleted and no confirmation is required - `inst-del-return-dry-run`
6. [x] - `p1` - **IF** `--json` was given - `inst-del-if-json`
   1. [x] - `p1` - **IF** `--yes` was not given - `inst-del-if-json-no-yes`
      1. [x] - `p1` - **RETURN** `CONFIRMATION_REQUIRED` with the delete/preserve lists; no prompt is shown and stdin is never read; nothing deleted - `inst-del-return-confirmation-required`
   2. [x] - `p1` - **ELSE** (`--yes` given) - `inst-del-else-json-yes`
      1. [x] - `p1` - Recompute the deletion plan from scratch, never trusting the first call's result - `inst-del-recompute-plan`
7. [x] - `p1` - **ELSE** (interactive) - `inst-del-else-interactive`
   1. [x] - `p1` - Prompt the developer to confirm, defaulting to No - `inst-del-prompt`
   2. [x] - `p1` - **IF** the developer declines - `inst-del-if-declined`
      1. [x] - `p1` - **RETURN** nothing deleted - `inst-del-return-declined`
8. [x] - `p1` - Remove the deletion plan's ground from disk, preserving every path in the plan's preserve list - `inst-del-remove`
9. [x] - `p1` - Remove `<target>` from its template's `targets` array in the project state store (`cpt-frontx-feature-composed-provenance`) - `inst-del-update-state`
10. [x] - `p1` - **IF** this removal empties the owning template name's `targets` array - `inst-del-if-last-target`
   1. [x] - `p1` - The CLI removes that name's CLI-owned AI-extension bundle at `.frontx/ai/<manifest-name>/`, if present (`cpt-frontx-algo-cli-scaffolding-ai-bundle`). By this point the target's ground is already off disk and its template-state entry already updated (steps 7–8 above), both real and correct; if this bundle removal itself fails, that failure is not surfaced as a refused operation over a deletion that in fact already happened — it is carried forward as `aiBundleResidue` (manifest name, path, and the failure's own message) on the success outcome step 10 returns, rather than reported as `ok: false` or silently dropped - `inst-del-remove-bundle`
11. [x] - `p1` - **RETURN** success — the deleted and preserved lists, the owning template name, whether this deletion emptied it, and `aiBundleResidue` when the CLI-owned bundle removal above failed (absent, never `null`, otherwise) - `inst-del-return-success`

## 3. Processes / Business Logic (CDSL)

### Resolve and Stage an Explicit Batch

- [x] `p1` - **ID**: `cpt-frontx-algo-cli-scaffolding-uniform-apply`

**Input**: An explicit batch `{"templates": {"<manifestName>": ["<target>", ...]}}`; the project state store's current document.

**Output**: A staged assembly — for each batch entry, the named template's resolved manifest, its installed content path, its declared `excludedSubtrees`, and the target(s) it is applied to — ready for the conflict check; or a resolution failure (`TEMPLATE_NOT_REGISTERED`, `ORIGIN_UNAVAILABLE`).

**Steps**:
1. [x] - `p1` - Receive the batch and the current project state document - `inst-ua-receive`
2. [x] - `p1` - **FOR EACH** template name in the batch - `inst-ua-foreach-name`
   1. [x] - `p1` - **IF** the name has no entry in the project state store's `templates` map - `inst-ua-if-not-registered`
      1. [x] - `p1` - **RETURN** `TEMPLATE_NOT_REGISTERED` naming the unregistered name; no further resolution - `inst-ua-return-not-registered`
   2. [x] - `p1` - **IF** the registered origin's content is not already available in the local inventory - `inst-ua-if-not-installed`
      1. [x] - `p1` - Auto-install it through the shared resolver (`cpt-frontx-feature-template-resolution`) using the registered, pinned origin - `inst-ua-auto-install`
      2. [x] - `p1` - **IF** installation fails - `inst-ua-if-install-fail`
         1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE` naming the name and its origin - `inst-ua-return-unavailable`
   3. [x] - `p1` - Read the resolved manifest's declared `excludedSubtrees` - `inst-ua-read-manifest`
   4. [x] - `p1` - Compute the template's effective ownership for each of its batch targets as the target minus `excludedSubtrees` minus `projectOwnedRoots` minus `.frontx` minus the reserved environment entries (`.git`, `.DS_Store`, `Thumbs.db`) minus the template's own local origin folder (when installed by local path) - `inst-ua-compute-ownership`
   5. [x] - `p1` - Subtract every OTHER registered template's local origin folder (when that template is installed by local path) from each batch target's effective ownership as well — the ground the Conflict Checker's reverse-containment rule already promises is "a permitted subtraction from that target's effective ownership, not a conflict" (`inst-cc-permit-reverse`). Without this the promise holds only in the checker: another template's origin folder — its own source on disk, and reserved ground the checker refuses a target for landing inside of — would stay inside the applying target's owned ground, so existing-content reconciliation would report that other template's real files as undeclared on-disk paths requiring a decision, and a colliding payload path would be written into them - `inst-ua-subtract-other-origins`
   6. [x] - `p1` - Stage the template's identity, installed content path, declared `excludedSubtrees`, and each target's effective ownership, tagged with the template's name - `inst-ua-stage-entry`
3. [x] - `p1` - **RETURN** the staged assembly for the conflict check to evaluate - `inst-ua-return-staged`

### Pre-Flight, Nesting-Aware Target Conflict Check

- [x] `p1` - **ID**: `cpt-frontx-algo-cli-scaffolding-conflict-check`

**Input**: A staged assembly's targets (per `cpt-frontx-algo-cli-scaffolding-uniform-apply`, or a single candidate path from `ownership add`); every target already recorded across every template's `targets` array in the project state store; the project's current `projectOwnedRoots`; the fixed set of reserved environment entries (`.git`, `.DS_Store`, `Thumbs.db`).

**Output**: A pass result, or a `TARGET_CONFLICT` report naming every contesting claim and the contested ground — produced before any file is written or any `projectOwnedRoots` entry is added.

**Steps**:
1. [x] - `p1` - **FOR EACH** target under check (a staged batch target, or a candidate `ownership add` path) - `inst-cc-foreach-target`
   1. [x] - `p1` - Canonicalize the target to a project-relative POSIX path; a symlink or a `..` segment can never resolve outside the project root. The canonical form is what is reported and recorded, not the string the caller typed: a caller naming a symlink is told, and has stored in `targets[]`, the real location its content went to. A DANGLING symlink is resolved the same way — through the text of the broken link — so a target reached that way materializes at the path the link names even though nothing stood there before; that stays inside the project root, and the applied target reported back names it, but it is not the path the caller spelled - `inst-cc-canonicalize`
   2. [x] - `p1` - **IF** the target cannot be proven to stay inside the project root - `inst-cc-if-escape`
      1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the unresolvable path; the check is fail-closed rather than guessing - `inst-cc-return-escape`
2. [x] - `p1` - Combine every canonicalized target under check with every target already recorded in the project state store, each tagged with its owning template name (or, for `ownership add`, with no owning name) - `inst-cc-combine`
3. [x] - `p1` - **FOR EACH** pair of targets in the combined set in which at least one side is a target under check - `inst-cc-foreach-pair`
   1. [x] - `p1` - **IF** the two targets are identical and claimed by the same template name - `inst-cc-if-same-template-noop`
      1. [x] - `p1` - Treat the pair as an idempotent no-op, not a conflict - `inst-cc-noop`
   2. [x] - `p1` - **IF** the two targets are identical and claimed by two different template names - `inst-cc-if-same-target-diff-template`
      1. [x] - `p1` - Record a conflict naming the contested target and both templates - `inst-cc-record-same-target`
   3. [x] - `p1` - **IF** one target is a strict ancestor of the other — decided by whole path segments of each canonicalized target, never by string-prefix comparison, so `packages/app` and `packages/app-shell` share a string prefix but no path segment and are siblings, not ancestor and descendant - `inst-cc-if-ancestor`
      1. [x] - `p1` - **IF** the inner (descendant) target lies at or inside one of the outer (ancestor) template's declared `excludedSubtrees` entries — a target equal to a declared entry is inside it, since the entry is ground the host reserved for a guest to occupy - `inst-cc-if-excluded-nest`
         1. [x] - `p1` - Treat the nesting as permitted — the outer template deliberately carved out that ground - `inst-cc-permit-nest`
      2. [x] - `p1` - **ELSE** - `inst-cc-else-undeclared-nest`
         1. [x] - `p1` - Record a conflict naming both targets and both templates - `inst-cc-record-ancestor`
   4. [x] - `p1` - **IF** the target under check lands inside a `projectOwnedRoot`, inside `.frontx`, inside a locally-installed template's own origin folder, or coincides with or lands inside a reserved environment entry (`.git`, `.DS_Store`, `Thumbs.db`) - `inst-cc-if-reserved-ground`
      1. [x] - `p1` - Record a conflict naming the target and the reserved ground it lands on; this direction is always a conflict regardless of nesting - `inst-cc-record-reserved`
   5. [x] - `p1` - **IF** a `projectOwnedRoot` or a local origin folder lands inside the target under check (the reverse containment) - `inst-cc-if-reverse-containment`
      1. [x] - `p1` - Treat it as a subtraction from that target's effective ownership, not a conflict - `inst-cc-permit-reverse`
4. [x] - `p1` - **IF** any conflict was recorded - `inst-cc-if-any-conflict`
   1. [x] - `p1` - **RETURN** `TARGET_CONFLICT` listing every contested ground and its contesting templates; refuse the whole operation, never silently merged - `inst-cc-return-conflict`
5. [x] - `p1` - **RETURN** pass - `inst-cc-return-pass`

### Existing-Content Reconciliation

- [x] `p1` - **ID**: `cpt-frontx-algo-cli-scaffolding-existing-content`

**Input**: For one target cleared by the conflict check and **not already recorded** under its named template's `targets[]` entry in the project state store — a target already recorded there is an idempotent no-op by that record alone and never reaches this algorithm (`cpt-frontx-dod-cli-scaffolding-existing-content-protocol`) — the payload — the file paths the template's effective ownership at that target would write, read from its installed content — and whatever already exists on disk within that target's effective ownership area.

**Output**: Three partitions — `identicalFiles` (already on disk, matching the payload exactly), `contentConflicts` (already on disk at a payload path, differing from it, **or** standing on, or beneath, a symlink; a directory where the payload declares a file; or a special filesystem entry (a FIFO, socket, or device) — either at that payload path or on the way to it — see step 3.1 below, an exception to "matching exactly" that holds even when a symlink's target happens to hold byte-identical content), `additionalPaths` (already on disk within the target's effective ownership area, at a path the payload does not write — an ordinary directory the walk recurses into on the way to a real payload path is never itself reported here, only the file, symlink, or special entries found within it), and `uncomparablePaths` — the subset of `contentConflicts` refused because a symlink, a directory, or a special entry stands at the payload path, or a symlink, a regular file, or a special entry stands on the way to it, rather than because the content there differs, together with `uncomparableCauses` naming, for each such path, the specific component responsible (the payload path itself, or the offending ancestor) and its kind — reported separately so a refusal can name each path's own cause and its own remedy (resolve the link, move the file or directory, or reconcile the edit) instead of offering both and leaving the reader to guess — or, when nothing pre-exists, all partitions empty.

**Steps**:
1. [x] - `p1` - Compute the payload's file path set from the template's installed content, scoped to the target's effective ownership - `inst-ec-compute-payload`
2. [x] - `p1` - Read what already exists on disk under the target's effective ownership area (empty when the target is new) - `inst-ec-read-existing`
3. [x] - `p1` - **FOR EACH** path in the payload set - `inst-ec-foreach-payload-path`
   1. [x] - `p1` - **IF** the payload path itself is reported as a symlink, a directory, or a special filesystem entry (a FIFO, socket, or device) — or any directory component of it — from the project root down to the path's own parent, the target's own components included — is reported as a symlink, a special filesystem entry, or as an ordinary regular file where a directory is required. The range reaches above the target because a regular file occupying a component at or above it blocks the payload path just as one below it does, and canonicalizing the target proves only that it resolves inside the project root, never that every component of it is a directory. A directory occupying the payload path's OWN position is checked only at the leaf, never as an ancestor condition — an ordinary directory ancestor is exactly the required shape for everything beneath it - `inst-ec-if-symlink-component`
      1. [x] - `p1` - Add it to `contentConflicts` and move on to the next payload path, without checking whether anything exists at the path by name. A symlink cannot be compared against the payload's declared text content, and writing through one lands somewhere the payload path does not name; a regular file standing where an ancestor directory component belongs makes the payload path unreachable on disk the way the payload declares it; a directory standing exactly at the payload path itself makes the declared file unreachable there too; and a special filesystem entry (a FIFO, socket, or device) can never be read or written safely at all — attempting to read one blocks indefinitely on a FIFO with no writer attached, which this algorithm's own real reader must never do. Either way "cannot be compared at all and refuses the same way, fail-closed, with `CONTENT_CONFLICT`" (`architecture/ADR/0021-project-upgrade-mechanism.md`, the identical ground already settled for the upgrade engine, whose own `inst-cls-if-not-regular` makes the identical extension to a regular-file ancestor). This is a conflict in BOTH modes: `--adopt-existing` means leaving what is already there untouched, and a write that follows a symlink, that attempts to create a directory or a file where the wrong shape already stands, or that would open a special file at all, touches something else entirely — never the thing adoption was asked to leave alone. The refusal names the specific offending component and its kind — the payload path itself, or the ancestor that blocked it — so a developer is told, for example, that `"app/dir" is a regular file` or `"app/README.md" is a directory` rather than being left to walk the path themselves - `inst-ec-add-symlink-conflict`
   2. [x] - `p1` - **IF** the path exists on disk - `inst-ec-if-exists`
      1. [x] - `p1` - **IF** its content matches the payload exactly - `inst-ec-if-match`
         1. [x] - `p1` - Add it to `identicalFiles` - `inst-ec-add-identical`
      2. [x] - `p1` - **ELSE** - `inst-ec-else-differs`
         1. [x] - `p1` - Add it to `contentConflicts` - `inst-ec-add-conflict`
4. [x] - `p1` - **FOR EACH** path that exists on disk under the target's effective ownership area but is not in the payload set - `inst-ec-foreach-extra`
   1. [x] - `p1` - Add it to `additionalPaths` - `inst-ec-add-additional`
5. [x] - `p1` - **RETURN** `identicalFiles`, `contentConflicts`, `additionalPaths`, `uncomparablePaths` — the subset of `contentConflicts` step 3.1 recorded, never a fourth disjoint partition, so a caller reading only the first three behaves exactly as before — and `uncomparableCauses`, naming the specific component step 3.1 blamed for each `uncomparablePaths` entry - `inst-ec-return-partitions`

### Compute a Target's Deletion Plan

- [x] `p1` - **ID**: `cpt-frontx-algo-cli-scaffolding-delete-plan`

**Input**: A canonicalized `<target>`; the project state store's current document.

**Output**: `{ toDelete, toPreserve }` — the plan's delete and preserve lists — or `TARGET_NOT_APPLIED` when `<target>` matches no template's applied `targets` array.

**Steps**:
1. [x] - `p1` - **FOR EACH** registered template's `targets` array in the project state store - `inst-dp-foreach-template`
   1. [x] - `p1` - **IF** `<target>` is present in that array - `inst-dp-if-found`
      1. [x] - `p1` - Record the owning template name and stop searching - `inst-dp-record-owner`
2. [x] - `p1` - **IF** no template's `targets` array contains `<target>` - `inst-dp-if-not-found`
   1. [x] - `p1` - **RETURN** `TARGET_NOT_APPLIED` — `<target>` is not an applied instance of any registered template - `inst-dp-return-not-found`
3. [x] - `p1` - Read the owning template's declared `excludedSubtrees` and compute `<target>`'s effective ownership by the same six-term subtraction the apply path computes (`inst-ua-compute-ownership`, CLI-5): `<target>` minus `excludedSubtrees` minus `projectOwnedRoots` beneath it minus `.frontx` minus the reserved environment entries (`.git`, `.DS_Store`, `Thumbs.db`) beneath it minus the template's own local origin folder (when installed by local path). The local-origin term is not optional here: a `path:`-installed template whose origin folder sits beneath its own target would otherwise have that folder — the developer's own source for the template — computed into this target's owned ground and removed - `inst-dp-compute-ownership`
4. [x] - `p1` - Identify every other template's target that is a strict descendant of `<target>` — a nested applied instance belonging to a different template - `inst-dp-find-nested`
5. [x] - `p1` - Identify every OTHER registered template's local origin folder (installed by local path) that is a strict descendant of `<target>` — a different template's own source, distinct from that template's applied target and never itself declared as an exclusion by the owning template being deleted, since the owning template has no reason to know about a folder that belongs to someone else's registration - `inst-dp-find-other-origins`
6. [x] - `p1` - Identify every entry inside `<target>` that cannot be enumerated as a regular file — a FIFO, a socket, a device, a dangling symlink. Such an entry occupies ground inside the target and survives the deletion, because the removal step acts on regular files only; it therefore belongs in `toPreserve`. Leaving it in neither list would break the property the confirmation gate rests on: that the two lists together state the blast radius before it is executed, so a developer approving a deletion is told what goes and what stays - `inst-dp-find-unenumerable`
7. [x] - `p1` - Set `toPreserve` to `excludedSubtrees` beneath `<target>`, every nested target found, every other template's local origin folder found, the OWNING template's own local origin folder when it too lies beneath `<target>`, every `projectOwnedRoots` entry beneath `<target>`, and every reserved environment entry beneath `<target>` — so a target `.` at the project root never lists `.git`, `.DS_Store`, or `Thumbs.db` in `toDelete`, since they were already subtracted from `<target>`'s effective ownership in the prior step. The owning template's own origin folder is named for the same reason a `projectOwnedRoots` entry is: both are the DEVELOPER's own ground, and `cpt-frontx-adr-template-ownership-boundary-declaration` rests delete's safety on these lists stating the blast radius before it is executed — a developer whose template source sits under the target would otherwise watch it survive with nothing in the report saying why. `.frontx` stays out on the opposite ground: it is CLI-owned, not the developer's, and no confirmation decision turns on it - `inst-dp-set-preserve`
8. [x] - `p1` - Set `toDelete` to `<target>`'s effective ownership minus every path in `toPreserve`. `toDelete` names files, never the directories that hold them: a directory the removal leaves empty is left standing, and pruning it is deliberately not part of this plan. A confirmed deletion removes exactly what the list it was confirmed against named, which is the property delete's whole confirmation gate rests on; pruning would remove ground the list never mentioned. It is also the identical choice `cpt-frontx-feature-upgrade-changeset` already fixes for the mirror case — an upgrade unlinks each `REMOVE` operation's path "without removing the directory it leaves empty" - `inst-dp-set-delete`
9. [x] - `p1` - **RETURN** `{ toDelete, toPreserve }` - `inst-dp-return-plan`

### Materialize or Remove the CLI-Owned AI-Extension Bundle

- [x] `p1` - **ID**: `cpt-frontx-algo-cli-scaffolding-ai-bundle`

Realizes resolution B1: a template's AI-extension bundle at `.frontx/ai/<manifest-name>/` is delivered by a CLI-owned step, never through the template's own ownership — `.frontx` stays unconditionally subtracted from every template's effective ownership (`cpt-frontx-adr-template-ownership-boundary-declaration`). This algorithm runs once per name transition — the first target a name gains, or the last target a name loses — never per target.

**Input**: A template name; whether the operation just gave that name its first target (`targets[]` was empty before this batch and non-empty after) or removed its last remaining target (`targets[]` was non-empty before this deletion and empty after); for a materialize trigger, the name's installed content path.

**Output**: `.frontx/ai/<manifest-name>/` materialized from that name's installed content path's own `.frontx/ai/<manifest-name>/` convention folder (copied verbatim, when present), or removed; a no-op when the template's payload carries no such folder, or when neither trigger condition holds.

**Steps**:
1. [x] - `p1` - **IF** this operation just gave `name` its first target - `inst-aib-if-first-target`
   1. [x] - `p1` - **IF** the name's installed content path contains a `.frontx/ai/<manifest-name>/` folder - `inst-aib-if-bundle-present`
      1. [x] - `p1` - Copy it verbatim into the project's `.frontx/ai/<manifest-name>/`, as a CLI-owned write attributed to no template's ownership - `inst-aib-copy`
   2. [x] - `p1` - **ELSE** - `inst-aib-else-no-bundle`
      1. [x] - `p1` - No-op — the payload carries no bundle for this name - `inst-aib-noop-no-bundle`
2. [x] - `p1` - **IF** this operation just removed `name`'s last remaining target - `inst-aib-if-last-target`
   1. [x] - `p1` - **IF** the project's `.frontx/ai/<manifest-name>/` exists - `inst-aib-if-bundle-exists`
      1. [x] - `p1` - Remove it as a CLI-owned deletion - `inst-aib-remove`
   2. [x] - `p1` - **ELSE** - `inst-aib-else-nothing-to-remove`
      1. [x] - `p1` - No-op — there is nothing to remove - `inst-aib-noop-no-removal`
3. [x] - `p1` - **RETURN** the outcome (materialized, removed, or no-op) - `inst-aib-return`

## 4. States (CDSL)

### Assembly Operation State Machine

- [x] `p2` - **ID**: `cpt-frontx-state-cli-scaffolding-assembly-op`

**States**: REQUESTED, RESOLVED, CONFLICT_CHECKED, RECONCILED, ASSEMBLED, ABORTED

**Initial State**: REQUESTED

**Transitions**:
1. [x] - `p1` - **FROM** REQUESTED **TO** RESOLVED **WHEN** every named template in the batch is registered and its content is locally available (installed if needed) - `inst-as-req-resolved`
2. [x] - `p1` - **FROM** REQUESTED **TO** ABORTED **WHEN** a named template has no entry in the project state store, or its registered origin cannot be auto-installed - `inst-as-req-aborted-unresolved`
3. [x] - `p1` - **FROM** RESOLVED **TO** CONFLICT_CHECKED **WHEN** the pre-flight conflict check finds no intersecting claim across the batch, everything already applied, and reserved ground - `inst-as-resolved-checked`
4. [x] - `p1` - **FROM** RESOLVED **TO** ABORTED **WHEN** the conflict check reports `TARGET_CONFLICT`; no files are written - `inst-as-resolved-aborted-conflict`
5. [x] - `p1` - **FROM** CONFLICT_CHECKED **TO** RECONCILED **WHEN** every target already recorded under its template's `targets[]` entry is treated as a no-op by that record alone, and existing-content reconciliation reports, for every remaining (unrecorded) target, no `contentConflicts` and either no `additionalPaths` or `--adopt-existing` was given - `inst-as-checked-reconciled`
6. [x] - `p1` - **FROM** CONFLICT_CHECKED **TO** ABORTED **WHEN** existing-content reconciliation reports a `contentConflicts` or an unadopted `additionalPaths` entry for any unrecorded target; no files are written - `inst-as-checked-aborted-existing-content`
7. [x] - `p1` - **FROM** RECONCILED **TO** ASSEMBLED **WHEN** every non-no-op target is materialized and recorded in the project state store - `inst-as-reconciled-assembled`

### Delete Operation State Machine

- [x] `p2` - **ID**: `cpt-frontx-state-cli-scaffolding-delete-op`

**States**: PLAN_COMPUTED, CONFIRMATION_PENDING, CONFIRMED, DELETED, DECLINED

**Initial State**: PLAN_COMPUTED

**Transitions**:
1. [x] - `p1` - **FROM** PLAN_COMPUTED **TO** CONFIRMATION_PENDING **WHEN** `<target>` matches an applied instance and the invocation is not `--dry-run`. The state means the plan now awaits a confirmation decision, not that a prompt is pending: the decision may still be asked for interactively, may be refused because `--json` carries no `--yes`, or may already have arrived with the call as `--json --yes` — all three leave through transition 2 or 3. A prior confirmation must NOT exclude entry here, or the `--json --yes` path named in transition 2 would have no way to reach the state it departs from. A `--dry-run` invocation never leaves PLAN_COMPUTED: it reports the delete/preserve lists and ends there, with nothing at stake to confirm - `inst-do-plan-pending`
2. [x] - `p1` - **FROM** CONFIRMATION_PENDING **TO** CONFIRMED **WHEN** the developer confirms interactively, or `--json --yes` is supplied and the plan is recomputed identically - `inst-do-pending-confirmed`
3. [x] - `p1` - **FROM** CONFIRMATION_PENDING **TO** DECLINED **WHEN** the developer declines interactively (the default), or `--json` is called without `--yes` (`CONFIRMATION_REQUIRED`) - `inst-do-pending-declined`
4. [x] - `p1` - **FROM** CONFIRMED **TO** DELETED **WHEN** the plan's `toDelete` ground is removed from disk and `<target>` is removed from the project state store - `inst-do-confirmed-deleted`

## 5. Definitions of Done

### One Uniform Batch Path: Preview and Apply

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-scaffolding-uniform-apply`

The system **MUST** apply any registered template through one uniform batch path (`target`): `assemble` previews an explicit, target-keyed batch statelessly and writes nothing to the repository or the project state store; `apply` independently re-resolves and re-validates the identical batch shape — never trusting a prior `assemble` run — and materializes it against a repository that already carries applied templates (extending). `seed` wraps this identical apply mechanism for a new or empty project — creating `.frontx/project.json`, auto-registering the batch's official default templates, then resolving, conflict-checking, and materializing exactly as `apply` does — rather than being a second materialization path. No per-template-category dispatch and no manifest-declared composition of any kind exists anywhere in this path. A refusal reached after materialization has already written one or more files, or materialized a CLI-owned AI-extension bundle, but before this call recorded any target to the project state store, **MUST** leave nothing behind: the system removes every file it wrote, removes every AI-extension bundle it materialized, and prunes every directory the file removals leave empty (`inst-add-rollback-writes`) before returning, so "nothing recorded" also means "nothing left" — never a batch a later `validate --project` reports PASS over content, or a bundle folder, no state document mentions.

**Implements**:
- `cpt-frontx-flow-cli-scaffolding-assemble-preview`
- `cpt-frontx-flow-cli-scaffolding-seed-repository`
- `cpt-frontx-flow-cli-scaffolding-add-template`
- `cpt-frontx-algo-cli-scaffolding-uniform-apply`

**Constraints**: `cpt-frontx-constraint-cli-boundary-declaration`

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`, `cpt-frontx-component-cli-assembler`
- Entities: `Template`, `Assembly`, `OwnershipBoundary`

### Nesting-Aware, Fail-Closed Conflict Check

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-scaffolding-conflict-check`

The system **MUST** canonicalize every target to a project-relative path before any comparison, refusing with `INVALID_PATH` a target that cannot be proven to stay inside the project root, and **MUST** run one nesting-aware intersection check — over the batch plus everything already applied plus reserved ground — that treats the same target claimed by two different templates as a conflict, the same target claimed twice by the same template as an idempotent no-op, an undeclared ancestor/descendant relationship as a conflict unless the inner target lies at or inside one of the outer template's declared `excludedSubtrees` entries, and a target landing inside `projectOwnedRoots`, `.frontx`, a local origin folder, or a reserved environment entry (`.git`, `.DS_Store`, `Thumbs.db`) as always a conflict. Ancestor/descendant is decided by whole path segments of the canonicalized path, never by string-prefix comparison — `packages/app` and `packages/app-shell` are siblings, not a conflict. The check **MUST** run identically in `assemble`, `apply`, `delete`, and `cpt-frontx-feature-composed-provenance`'s `ownership add`, with no `--force` override (`target`).

**Implements**:
- `cpt-frontx-flow-cli-scaffolding-assemble-preview`
- `cpt-frontx-flow-cli-scaffolding-seed-repository`
- `cpt-frontx-flow-cli-scaffolding-add-template`
- `cpt-frontx-algo-cli-scaffolding-conflict-check`

**Constraints**: `cpt-frontx-constraint-cli-assembly-conflict-prevention`

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`, `cpt-frontx-component-cli-conflict-checker`
- Entities: `Assembly`, `OwnershipBoundary`

### Existing-Content Protocol and Idempotent Re-Apply

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-scaffolding-existing-content-protocol`

The system **MUST** treat a target already recorded under its named template's `targets[]` entry in the project state store as an idempotent no-op by that record alone — reading no on-disk content and running no existing-content reconciliation for it, regardless of whether the on-disk content still matches what was last applied. For every target a batch was cleared to write to and **not** already so recorded, the system **MUST**, before materializing it, reconcile the template's payload against whatever already exists on disk within that target's effective ownership area, reporting `identicalFiles`, `contentConflicts`, and `additionalPaths` separately: the system **MUST** refuse the whole batch, writing no file, when any unrecorded target reports a `contentConflicts` entry or reports `additionalPaths` without `--adopt-existing`, and **MUST NOT** silently overwrite differing content. A payload path standing on, or beneath, a symlink is never a no-op even when the link's target happens to hold byte-identical content, a payload path beneath a regular file occupying a directory's position — at, above, or below the target — is never a no-op either, a payload path where a DIRECTORY occupies exactly the position the payload declares a file is never a no-op, and a payload path standing on, or beneath, a special filesystem entry (a FIFO, socket, or device) is never a no-op — the system **MUST** report each of these as `contentConflicts`, in both apply modes, and **MUST NOT** attempt to open a special filesystem entry for reading at all, since doing so can block indefinitely with no writer attached: a symlink cannot be compared against declared text content and a write that follows one lands somewhere the payload path does not name, a regular file where a directory is required makes the path unreachable on disk the way the payload declares it, a directory where a file is required makes the declared file unreachable there, and a special entry can never be read or written safely regardless of position — either way naming the specific offending component and its kind in the refusal (`cpt-frontx-algo-cli-scaffolding-existing-content`'s own `inst-ec-if-symlink-component`). An intentional overwrite of already-recorded, already-applied content is available only through `upgrade` (`cpt-frontx-feature-upgrade-changeset`); a repeated `apply` never re-inspects a recorded target's on-disk content and so can never move it onto new content (`target`).

**Implements**:
- `cpt-frontx-flow-cli-scaffolding-seed-repository`
- `cpt-frontx-flow-cli-scaffolding-add-template`
- `cpt-frontx-algo-cli-scaffolding-existing-content`

**Constraints**: `cpt-frontx-constraint-cli-assembly-conflict-prevention`

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`, `cpt-frontx-component-cli-assembler`
- Entities: `Template`, `Assembly`, `OwnershipBoundary`

### Delete Under Explicit Confirmation

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-scaffolding-delete`

The system **MUST** compute a target's deletion plan as that target's effective ownership — the six-term subtraction CLI-5 fixes, applied whole and never as a subset, so the plan is bounded by exactly the ground `apply` computed as owned — minus any nested target belonging to another template and minus any other registered template's local origin folder found beneath the target, through the Conflict Checker's canonicalized geometry, and **MUST** execute it only under explicit confirmation defaulting to no, or, in `--json` mode, the `CONFIRMATION_REQUIRED` code carrying the delete/preserve lists with a re-issued call carrying `--yes` — never a prompt or a blocking read of stdin in that mode. A `<target>` matching no registered template's applied `targets` array **MUST** be refused with `TARGET_NOT_APPLIED`. A `<target>` that IS matched, but whose own on-disk location can be resolved and is no longer an ordinary directory — replaced by a regular file, or any other non-directory entry, since it was applied — **MUST** be refused with `CONTENT_CONFLICT`, naming the target, on every plan computation this flow makes (never only the first): the target's recorded content can no longer be enumerated, compared, or removed the way a directory's content is, the identical fact `apply` and `upgrade` already refuse for a payload path whose disk shape cannot be compared, and this refusal **MUST** reach the caller as the same one-envelope-on-stdout/non-zero-exit structured shape every other refusal in this feature already does — never an empty `--json` envelope or a bare, unstructured filesystem error. The system **MUST** support a non-destructive `--dry-run` that reports the identical lists without deleting anything and without requiring confirmation, and **MUST** recompute the deletion plan at confirmed-execution time rather than trusting an earlier computed plan (`target`).

**Implements**:
- `cpt-frontx-flow-cli-scaffolding-delete-target`
- `cpt-frontx-algo-cli-scaffolding-delete-plan`
- `cpt-frontx-state-cli-scaffolding-delete-op`

**Constraints**: `cpt-frontx-constraint-cli-machine-envelope`

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`, `cpt-frontx-component-cli-assembler`, `cpt-frontx-component-cli-conflict-checker`
- Entities: `Template`, `Assembly`, `OwnershipBoundary`, `ProjectProvenance`

### CLI-Owned AI-Extension Bundle Materialization

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-scaffolding-ai-bundle`

The system **MUST** materialize a template name's AI-extension bundle at `.frontx/ai/<manifest-name>/` as a CLI-owned write — never through the template's own ownership, which unconditionally excludes `.frontx` — the first time `apply` or `seed` gives that name its first applied target, copying it verbatim from the name's installed content path's own `.frontx/ai/<manifest-name>/` convention folder when the payload carries one, and as a no-op otherwise. The system **MUST** remove that name's `.frontx/ai/<manifest-name>/` when `delete` removes the name's last remaining target, and **MUST** refresh it when `upgrade` commits a new version of the name whose payload carries a new bundle (`cpt-frontx-feature-upgrade-changeset`) (`target`).

**Implements**:
- `cpt-frontx-flow-cli-scaffolding-seed-repository`
- `cpt-frontx-flow-cli-scaffolding-add-template`
- `cpt-frontx-flow-cli-scaffolding-delete-target`
- `cpt-frontx-algo-cli-scaffolding-ai-bundle`

**Constraints**: `cpt-frontx-constraint-cli-boundary-declaration`

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`, `cpt-frontx-component-cli-assembler`
- Entities: `Template`, `ProjectProvenance`

## 6. Acceptance Criteria

- [x] `assemble` accepts an explicit batch `{"templates": {"<name>": ["<target>", ...]}}`, runs the same resolution, ownership, and conflict checks `apply` runs, and leaves the repository and the project state store byte-identical afterward.
- [x] `apply` never trusts a prior `assemble` run: called directly on a batch `assemble` never saw, it independently re-resolves, re-checks, and materializes or refuses on its own.
- [x] A batch naming an unregistered template name is refused with `TEMPLATE_NOT_REGISTERED`, resolving nothing further for that entry and writing no file.
- [x] A registered-but-not-yet-installed template's content is auto-installed through the shared resolver before staging; a failed auto-install is refused with `ORIGIN_UNAVAILABLE`.
- [x] Two batch entries claiming the same target, or one containing another with no matching `excludedSubtrees` declaration, are refused with `TARGET_CONFLICT` naming both templates and the contested ground; the same nesting inside a declared `excludedSubtrees` entry is accepted. `packages/app` and `packages/app-shell` share no path segment and are never reported as ancestor/descendant or in conflict.
- [x] A batch entry landing inside `projectOwnedRoots`, `.frontx`, a local origin folder, or a reserved environment entry (`.git`, `.DS_Store`, `Thumbs.db`) is refused with `TARGET_CONFLICT`; the reverse — one of those landing inside a template's target — is accepted as a subtraction from that target's ownership, not a conflict.
- [x] A target that cannot be canonicalized to a path proven to stay inside the project root is refused with `INVALID_PATH`, fail-closed rather than guessed.
- [x] The same template applied twice to the same target in one batch, or across two batches, is an idempotent no-op decided by the target's presence in that template's `targets[]` entry alone — never by reading or diffing the target's on-disk content.
- [x] A target already recorded under its template's `targets[]` entry is never passed to existing-content reconciliation, even when its on-disk content has since been locally edited; a repeated `apply` never reports `CONTENT_CONFLICT` for it and never overwrites it — the only path to intentionally move it onto new content is `upgrade`.
- [x] For a target not yet recorded, existing on-disk content matching the payload exactly is reported as `identicalFiles` and causes no refusal; content differing from the payload at a payload path is reported as `contentConflicts` and refuses the whole batch, writing no file; content at a path the payload does not declare is reported as `additionalPaths` and refuses the batch unless `--adopt-existing` is given, in which case it is left untouched. A payload path standing on, or beneath, a symlink, beneath a regular file occupying a directory's position, standing where a DIRECTORY occupies the exact position the payload declares a file, or standing on, or beneath, a special filesystem entry (a FIFO, socket, or device), is always `contentConflicts` — never `identicalFiles`, even when a symlink's target happens to hold byte-identical content, and never adopted, since `--adopt-existing` means leaving what is already there untouched and a write through a symlink, into a directory a file already occupies, or into a directory position a file already occupies, touches something else entirely; a special filesystem entry is never even opened for reading, since doing so can block indefinitely; the refusal names the specific offending component and its kind.
- [x] `delete <target>` on a path that matches no registered template's applied `targets` is refused with `TARGET_NOT_APPLIED`, naming the target as unmatched.
- [x] `delete <target>` on a path that DOES match a registered template's applied `targets`, but whose own on-disk location is no longer an ordinary directory, is refused with `CONTENT_CONFLICT`, naming the target — as one envelope on stdout in `--json` and a message on stderr otherwise, with a non-zero exit — never a hang, an empty `--json` envelope, or an unstructured internal error, and never an apparently-empty deletion plan silently reporting nothing to delete or preserve.
- [x] `delete <target>` interactively prompts for confirmation defaulting to No; declining leaves the repository and the project state store unchanged.
- [x] `delete <target> --json` without `--yes` returns `CONFIRMATION_REQUIRED` with the delete/preserve lists, never reading stdin or blocking; the identical call with `--yes` recomputes the plan and deletes only after recomputation.
- [x] `delete <target> --dry-run` reports the delete/preserve lists without deleting anything and without any confirmation step, in both interactive and `--json` modes.
- [x] A deletion plan preserves the target's declared `excludedSubtrees`, every nested target belonging to another template, every registered template's local origin folder beneath the target — the owning template's own included, since it is the developer's own source for that template — every `projectOwnedRoots` entry beneath the target, and every reserved environment entry (`.git`, `.DS_Store`, `Thumbs.db`) beneath the target; a `delete .` on the project root never lists a reserved environment entry in its delete list or its `additionalPaths`, and never lists `.frontx` in its preserve list, which is CLI-owned rather than the developer's.
- [x] A confirmed deletion removes exactly the files its `toDelete` list named and nothing else: a directory the removal leaves empty is left standing, never pruned, so no ground outside the confirmed list is touched.
- [x] `seed <dir> --input <batch>` on a directory that does not yet carry `.frontx/project.json` creates it, auto-registers each named official default template through the register algorithm (resolve → pin → write origin), and then applies the batch through the identical mechanism `apply` uses; `seed` on a directory that already carries `.frontx/project.json` is refused, directing the developer to `apply`.
- [x] The first `apply` or `seed` batch to give a template name its first target materializes that name's CLI-owned `.frontx/ai/<manifest-name>/` bundle from the template's payload, when the payload carries one, as a write attributed to the CLI, never to the template's own ownership; `delete` of a name's last remaining target removes that bundle.
- [x] No apply, assemble, or delete path silently merges conflicting claims or silently overwrites differing content.
- [x] A refusal reached after `apply` or `seed` has already written one or more payload files, or materialized a CLI-owned AI-extension bundle, but before this call recorded any target to the project state store, leaves nothing on disk: every file this call wrote is removed, every bundle this call materialized is removed, and every directory the file removals leave empty is pruned, deepest-first, bounded by the project root and by which directories this call's own pre-write pass proved it created. The JSON envelope's `details.writtenPaths` names every payload path this call wrote and `details.bundledNames` names every bundle it materialized, regardless of whether the rollback ran, and the returned message states plainly whether those files and bundles were removed or, in the one narrow case an earlier name in the same batch already had its own targets committed, still remain.
- [x] A deliberate, typed refusal thrown while materializing or recording a batch — a payload path that already exists as a symlink, or a payload/project-state write that resolves outside the project root through a symlink introduced since the pre-flight check — is reported through its own honest code (`CONTENT_CONFLICT` or `INVALID_PATH` respectively), never folded into `INTERNAL`.
- [x] Every `RETURN`-level refusal in this feature's flows and algorithms names a code from the shared error-code vocabulary (`cpt-frontx-adr-cli-machine-readable-output`).
- [x] The apply/assemble/seed/delete command surface is part of `cpt-frontx-interface-cli`; an incompatible change to the surface requires a major version bump per `cpt-frontx-adr-artifact-versioning-and-distribution`.
- [x] `assemble`/`apply` satisfy `cpt-frontx-cli-nfr-template-scale`'s assembly threshold: evaluating at least 20 templates in one batch and reporting every ownership conflict found — including containment between targets — before any repository file is written.
- [x] `cfs --json validate --artifact packages/cli/architecture/features/cli-scaffolding/FEATURE.md --skip-code` returns PASS.
- [x] `cfs --json validate-toc packages/cli/architecture/features/cli-scaffolding/FEATURE.md` returns PASS.
