# Feature: AI-Driven Upgrade Orchestration


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [AI-Driven Template Upgrade](#ai-driven-template-upgrade)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Upgrade Enrichment](#upgrade-enrichment)
- [4. States (CDSL)](#4-states-cdsl)
  - [Orchestrated-Upgrade Lifecycle State Machine](#orchestrated-upgrade-lifecycle-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [AI Upgrade Orchestration Implemented](#ai-upgrade-orchestration-implemented)
  - [Review Gate Enforced Before Apply](#review-gate-enforced-before-apply)
  - [Single Engine Enforced](#single-engine-enforced)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-ai-upgrade-orchestration`
## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-ai-upgrade-orchestration`

### 1.1 Overview

Provides the AI workflow surface through which an AI agent orchestrates a template upgrade by reading the project's single state document, `.frontx/project.json` (DESIGN §3.1 `ProjectProvenance`, per `cpt-frontx-adr-project-provenance-record`), selecting which registered template **name** to upgrade (the document holds one `templates[name]` entry per registered name, each carrying one `origin`, one `version`, and every target that name has been applied to — never a single whole-repository origin and never a per-target origin/version), invoking and enriching the CLI change-set engine with change-impact analysis, review gates, and downstream-effect assessment, then applying the approved change set — atomically across every target listed under that name — or leaving the project unchanged if the developer declines. Upgrade's unit is the template name, not an individual applied instance: a partial upgrade that moves one of a name's targets forward while leaving a sibling target behind is not a supported state in v1 (`cpt-frontx-adr-project-upgrade-mechanism`).

**Command surface and engine invocation**: the engine's own invocation is `upgrade <templateName> <new-origin>` (`cpt-frontx-adr-project-upgrade-mechanism`), so the orchestration and the engine cannot disagree about which template is being upgraded: the template name is a required argument the engine reads its baseline from directly, and the project's single state document keys `templates` by name with exactly one entry per name. Neither layer selects a template by heuristic — there is no "first provenance record" to guess from — so the enriched review package and the engine's own change set name the same template even in a repository with more than one registered template. The shipped command surface passes that name through: `upgrade <templateName> <new-origin>` takes the template name as a required first argument, and the orchestration supplies its own selected name there (`inst-invoke-engine`), so the two layers cannot disagree about which template is being upgraded — the implementation-status question issue #508 recorded no longer stands open against this feature.

### 1.2 Purpose

Delivers the AI-guided upgrade path defined in `cpt-frontx-seq-ai-driven-template-upgrade`: an AI agent that reads provenance, drives the single CLI change-set engine (F14), enriches the output with analysis and downstream-effect assessment, and gates apply on an explicit developer decision — ensuring the identical change set is applied by both the AI-orchestrated path and the direct CLI path.

**Requirements**: `cpt-frontx-fr-ai-upgrade-orchestration`

**Components**: `cpt-frontx-component-ai-upgrade-orchestration` (the internal sub-component that owns this behavior), within the package anchor `cpt-frontx-component-ai-tooling-kit`

**Applicability** (Often-N/A domains for an AI Tooling feature, per the FEATURE checklist's Applicability Context): PERF and OPS (observability) are not applicable — this feature owns no scale NFR of its own (upgrade throughput is bound by the CLI change-set engine it orchestrates, `cpt-frontx-feature-upgrade-changeset`, F14) and introduces no logging, metrics, or tracing surface beyond the reviewable change set it already presents. SEC is not applicable — this feature enforces no authentication or authorization boundary of its own; supply-chain integrity checks on the upgrade target belong to F14. COMPL is not applicable — no regulatory obligation attaches to a local, developer-approved upgrade workflow. UX is addressed by the mandatory review gate enforced before apply (§5, "Review Gate Enforced Before Apply").

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Initiates the AI-driven upgrade, reviews the enriched change set, and approves or declines the apply |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Dependencies**: `cpt-frontx-feature-upgrade-changeset` (F14 — the CLI change-set engine this feature orchestrates), `cpt-frontx-feature-ai-kit-packaging` (F15 — the base kit this workflow ships inside)

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-usecase-ai-driven-template-upgrade`

### AI-Driven Template Upgrade

- [x] `p1` - **ID**: `cpt-frontx-flow-ai-upgrade-orchestration-upgrade`

**Actor**: `cpt-frontx-actor-project-developer`

**Realizes**: `cpt-frontx-seq-ai-driven-template-upgrade`

**Success Scenarios**:
- Developer initiates upgrade, AI presents the enriched change set, developer approves, and the engine applies the change set non-destructively, updating project provenance to the newer template version.

**Error Scenarios**:
- The project's single state document, `.frontx/project.json`, is absent or unreadable: `PROJECT_INVALID`; upgrade cannot proceed.
- The named template has no `templates[name]` entry in the project's single state document: `TEMPLATE_NOT_REGISTERED`; upgrade cannot proceed.
- The named template is registered but its `targets` array is empty: `TARGET_NOT_APPLIED`; upgrade cannot proceed.
- Engine returns an empty or unresolvable change set; AI relays the engine's own reported code and presents the finding, halting before the review gate.
- The command surface's first, unconfirmed call refuses outright before any change set is ever computed — a genuine refusal such as `CONTENT_CONFLICT`, `TARGET_CONFLICT`, or another non-`CONFIRMATION_REQUIRED` code — distinct from an empty or unresolvable change set: `onChangeSet` is never invoked for either, so both leave no review package behind, but only a genuine refusal is a real failure to relay rather than "nothing to update." AI relays the command surface's own reported code and message verbatim, halting before the review gate exactly as the empty-changeset case does, but recognized by the command surface's own status rather than inferred from the absence of a review package.
- Developer declines at the review gate; no project files are written and the project remains at its current version.
- Downstream-effect assessment flags incompatibilities; AI surfaces them before the gate so the developer can decline.

**Steps**:
1. [x] - `p1` - Developer requests an AI-driven template upgrade for the current project, naming the registered template **name** to upgrade (or asking the AI to list the templates recorded in the project's single state document, `.frontx/project.json`, so one can be chosen) - `inst-request-upgrade`
2. [x] - `p1` - AI reads the project's single state document (`.frontx/project.json`, `cpt-frontx-contract-project-provenance`, per `cpt-frontx-adr-project-provenance-record`) and selects the `templates[name]` entry for the named template, determining its current `origin`, its current `version`, and every target listed under it - the unit the upgrade will validate and move atomically (`cpt-frontx-adr-project-upgrade-mechanism`) - `inst-read-provenance`
3. [x] - `p1` - **IF** `.frontx/project.json` is absent or unreadable - `inst-check-provenance-unreadable`
   1. [x] - `p1` - **RETURN** `PROJECT_INVALID`: the project's single state document could not be read; upgrade cannot proceed - `inst-provenance-unreadable`
4. [x] - `p1` - **IF** the document holds no `templates[name]` entry for the named template - `inst-check-not-registered`
   1. [x] - `p1` - **RETURN** `TEMPLATE_NOT_REGISTERED`: no matching entry for that name; upgrade cannot proceed - `inst-provenance-not-registered`
5. [x] - `p1` - **IF** that entry's `targets` array is empty - `inst-check-no-targets`
   1. [x] - `p1` - **RETURN** `TARGET_NOT_APPLIED`: the name is registered but has no applied target to upgrade; upgrade cannot proceed - `inst-provenance-no-targets`
6. [x] - `p1` - AI invokes the Upgrade Enrichment algorithm with the selected template name's `{origin, version, targets[]}` entry and the target template version - `inst-invoke-enrichment`
7. [x] - `p1` - **IF** the engine returns an empty or unresolvable change set — checked here alongside the distinct case of the command surface's first, unconfirmed call refusing outright before any change set is computed at all (a genuine refusal — `CONTENT_CONFLICT`, `TARGET_CONFLICT`, `PROJECT_INVALID`, or any other non-`CONFIRMATION_REQUIRED` code the command surface reports on that first call): the two are told apart by the command surface's own reported status, checked before the empty-changeset case is assumed, since a genuine refusal leaves no review package behind either and would otherwise be indistinguishable from "nothing to update"; a genuine refusal returns the finding relaying the command surface's own reported code and message verbatim, exactly as the empty-changeset case below does, and halts before the review gate the same way - `inst-check-changeset`
   1. [x] - `p1` - **RETURN** finding to developer, relaying the engine's own reported error code unreinterpreted: no applicable change set; upgrade halted before review gate - `inst-empty-changeset`
8. [x] - `p1` - AI presents the enriched change set (change-impact analysis + downstream-effect assessment) to the developer for review - `inst-present-review`
9. [x] - `p1` - **IF** developer approves the change set - `inst-gate-approve`
   1. [x] - `p1` - Trigger engine apply: engine writes the change set to project files non-destructively, within each target's effective ownership, atomically across every target listed under the upgraded name - every target moves together, or none do (`cpt-frontx-adr-project-upgrade-mechanism`) - `inst-engine-apply`
   2. [x] - `p1` - Engine updates the `templates[name]` entry's `origin` and `version` in the project's single state document to the newer template version, as one atomic commit covering every target listed under that name; the entry's `targets` array itself is untouched, since upgrade changes which version a name is at, not which targets belong to it - `inst-update-provenance`
   3. [x] - `p1` - **RETURN** upgrade complete with summary of applied changes - `inst-return-applied`
10. [x] - `p1` - **ELSE** developer declines or incompatibilities are flagged - `inst-gate-decline`
    1. [x] - `p1` - Engine writes no project files; project remains at current version - `inst-no-write`
    2. [x] - `p1` - **RETURN** decline acknowledged; no changes applied - `inst-return-declined`

## 3. Processes / Business Logic (CDSL)

### Upgrade Enrichment

- [x] `p1` - **ID**: `cpt-frontx-algo-ai-upgrade-orchestration-enrich`

**Input**: the selected template name's `templates[name]` entry from the project's single state document (`origin`, `version`, every target listed under it), target template version

**Output**: Enriched review package containing the proposed change set, change-impact analysis, and downstream-effect assessment

**Steps**:
1. [x] - `p1` - Extract the selected template's name, its current `origin`/`version`, and every target listed under it from its `templates[name]` entry - `inst-extract-provenance`
2. [x] - `p1` - Invoke the single CLI change-set engine (F14) via `upgrade <templateName> <new-origin>` (`cpt-frontx-adr-project-upgrade-mechanism`), passing the selected template's name and the target version's resolved origin directly, so the engine validates the new origin against every target listed under that name as one atomic unit; the orchestration's selected name is the same name the engine's own baseline reads, so neither layer can name a template the other did not (§1.1) - `inst-invoke-engine`
3. [x] - `p1` - Receive the proposed reviewable change set from the engine (the identical, atomic all-targets change set the direct CLI upgrade path would produce) - `inst-receive-changeset`
4. [x] - `p1` - **IF** the change set is empty or unresolvable, or validation fails for any one of the name's targets - `inst-check-empty`
   1. [x] - `p1` - **RETURN** empty change set signal to the caller; a validation failure on any one target refuses the entire upgrade rather than a partial one, per `cpt-frontx-adr-project-upgrade-mechanism` - `inst-empty-signal`
5. [x] - `p1` - Run change-impact analysis over the change set — assess, across every target the change touches, what the version transition to the new origin means for the project's current state, and flag anything that needs the developer's attention before approval. The file-level mechanics behind the engine's own change set are owned by `cpt-frontx-feature-upgrade-changeset`, per the decision `cpt-frontx-adr-project-upgrade-mechanism` fixes, and are not reimplemented here: this analysis works from whatever reviewable transition the engine reports, not from a file-level diff mechanism this feature defines - `inst-impact-analysis`
6. [x] - `p1` - Run downstream-effect assessment — determine which project capabilities or configuration depend on the templates the upgrade touches and surface any incompatibilities the atomic all-targets transition would introduce, without presuming a file-level diff mechanism this feature does not own - `inst-downstream-assess`
7. [x] - `p1` - Combine engine change set, change-impact analysis, and downstream-effect assessment into a single enriched review package - `inst-combine-results`
8. [x] - `p1` - **RETURN** enriched review package to the AI agent for presentation at the review gate - `inst-return-enriched`

## 4. States (CDSL)

### Orchestrated-Upgrade Lifecycle State Machine

- [x] `p2` - **ID**: `cpt-frontx-state-ai-upgrade-orchestration-lifecycle`

**States**: PROVENANCE_READ, ANALYZED, REVIEWED, APPLIED, DECLINED

**Initial State**: PROVENANCE_READ

**Transitions**:
1. [x] - `p1` - **FROM** PROVENANCE_READ **TO** ANALYZED **WHEN** the project's single state document has been read, the template **name** to upgrade and every target listed under it have been selected, and the CLI change-set engine has been invoked with that name and the new origin and has returned a change set and change-impact analysis and downstream-effect assessment are complete - `inst-to-analyzed`
2. [x] - `p1` - **FROM** ANALYZED **TO** REVIEWED **WHEN** the enriched change set with downstream-impact assessment has been presented to the developer at the review gate - `inst-to-reviewed`
3. [x] - `p1` - **FROM** REVIEWED **TO** APPLIED **WHEN** developer approves and the engine has applied the change set non-destructively, atomically across every target listed under the upgraded name, and the `templates[name]` entry's `origin`/`version` has been updated to the newer template version as that same atomic commit - `inst-to-applied`
4. [x] - `p1` - **FROM** REVIEWED **TO** DECLINED **WHEN** developer declines or incompatibilities are flagged at the review gate, or validation fails for any one of the name's targets; no project files written; every target of that name remains at its current version - `inst-to-declined`

## 5. Definitions of Done

### AI Upgrade Orchestration Implemented

- [x] `p1` - **ID**: `cpt-frontx-dod-ai-upgrade-orchestration-flow-complete`

The system **MUST** implement the AI-driven upgrade orchestration flow such that an AI agent can read the project's single state document (`.frontx/project.json`) and select a template name and every target listed under it, invoke and enrich the single CLI change-set engine with change-impact analysis and downstream-effect assessment, present the enriched review package at a developer review gate, and apply the approved change set non-destructively and atomically across every target of that name, or leave the project unchanged on decline — matching the frozen design intent of `cpt-frontx-seq-ai-driven-template-upgrade` as updated by `cpt-frontx-adr-project-upgrade-mechanism`. The shipped surface takes the template name as the required first argument of `upgrade <templateName> <new-origin>` and the orchestration passes its selected name there (`inst-invoke-engine`), so the invocation this DoD requires is the invocation the implementation makes.

**Implements**:
- `cpt-frontx-flow-ai-upgrade-orchestration-upgrade`
- `cpt-frontx-algo-ai-upgrade-orchestration-enrich`

**Cites**:
- `cpt-frontx-seq-ai-driven-template-upgrade`
- `cpt-frontx-component-ai-upgrade-orchestration`
- `cpt-frontx-component-ai-tooling-kit`

**Touches**:
- Entities: ProjectProvenance, AiExtension

### Review Gate Enforced Before Apply

- [x] `p1` - **ID**: `cpt-frontx-dod-ai-upgrade-orchestration-gate-enforced`

The system **MUST** ensure that the engine apply step is never triggered without an explicit developer approval at the review gate — the engine writes no project files until the developer approves, and a decline, a flagged incompatibility, or a validation failure on any one of the name's targets leaves every target of that name at its current version with no files written.

**Implements**:
- `cpt-frontx-flow-ai-upgrade-orchestration-upgrade`

**Cites**:
- `cpt-frontx-seq-ai-driven-template-upgrade`
- `cpt-frontx-component-ai-upgrade-orchestration`
- `cpt-frontx-component-ai-tooling-kit`

**Touches**:
- Entities: ProjectProvenance

### Single Engine Enforced

- [x] `p1` - **ID**: `cpt-frontx-dod-ai-upgrade-orchestration-single-engine`

The system **MUST** invoke only the CLI change-set engine (F14 — `cpt-frontx-feature-upgrade-changeset`) to produce the upgrade change set; the AI orchestration layer **MUST NOT** implement a second change-set engine, so that the AI-driven upgrade and the direct CLI upgrade produce the identical change set. The "identical change set" claim now holds on the same ground: `inst-invoke-engine` passes the orchestration's selected name as the engine's own first argument, so both paths compute the change set for the same name from the same recorded baseline.

**Implements**:
- `cpt-frontx-algo-ai-upgrade-orchestration-enrich`

**Cites**:
- `cpt-frontx-seq-ai-driven-template-upgrade`
- `cpt-frontx-component-ai-upgrade-orchestration`
- `cpt-frontx-component-ai-tooling-kit`

**Touches**:
- Entities: ProjectProvenance

## 6. Acceptance Criteria

- [x] The AI-driven upgrade flow reads the project's single state document (`.frontx/project.json`), selects the named template's `templates[name]` entry and every target listed under it, invokes the single CLI change-set engine via `upgrade <templateName> <new-origin>` for that name, enriches the result with change-impact analysis and downstream-effect assessment, and presents it to the developer before any apply. The shipped command surface passes the selected name through this invocation as its required first argument.
- [x] An unreadable `.frontx/project.json` returns `PROJECT_INVALID`, a named template with no `templates[name]` entry returns `TEMPLATE_NOT_REGISTERED`, and a registered name with an empty `targets` array returns `TARGET_NOT_APPLIED` — each refusal naming its dictionary code and stopping before any engine invocation.
- [x] The review gate stands unconditionally before the engine apply step: no project files are written until an explicit developer approval.
- [x] On developer decline, flagged incompatibilities, or a validation failure on any one of the name's targets, every target of that name remains at its current version with no files written — a partial upgrade of one target while a sibling target of the same name is left behind is never produced (`cpt-frontx-adr-project-upgrade-mechanism`).
- [x] The AI orchestration layer contains no second change-set engine implementation and defines no file-level diff or merge mechanics of its own; the identical, atomic all-targets change set is applied by both the AI-orchestrated path and the direct CLI path.
- [x] The `templates[name]` entry's `origin` and `version` are updated to the newer template version, atomically across every target listed under that name, only after a successful non-destructive apply.
- [x] The orchestrated-upgrade state machine transitions correctly through PROVENANCE_READ → ANALYZED → REVIEWED → APPLIED on approval and PROVENANCE_READ → ANALYZED → REVIEWED → DECLINED on decline. Reaching ANALYZED no longer depends on an open question: `inst-invoke-engine` passes the selected name and the target version's resolved origin to the engine.
