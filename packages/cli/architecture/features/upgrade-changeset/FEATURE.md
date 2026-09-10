# Feature: Upgrade Change-Set Engine


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Developer Review and Approval of an Upgrade Change Set](#developer-review-and-approval-of-an-upgrade-change-set)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Compute Template-Version Diff Against Provenance Baseline](#compute-template-version-diff-against-provenance-baseline)
  - [Apply Change Set Non-Destructively; Support Rollback; Update Provenance](#apply-change-set-non-destructively-support-rollback-update-provenance)
  - [Rollback an Applied Change Set](#rollback-an-applied-change-set)
- [4. States (CDSL)](#4-states-cdsl)
  - [Change-Set Lifecycle](#change-set-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Change-Set Computation and Presentation](#change-set-computation-and-presentation)
  - [Non-Destructive Application and Provenance Update](#non-destructive-application-and-provenance-update)
  - [Rollback to Pre-Upgrade State](#rollback-to-pre-upgrade-state)
  - [Single Authoritative Engine](#single-authoritative-engine)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-upgrade-changeset`
## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-upgrade-changeset`

### 1.1 Overview

The Upgrade Change-Set Engine is the single `target` CLI-owned mechanism (`cpt-frontx-component-cli`) that upgrades each applied template independently: for a selected applied template it re-resolves the baseline version through the shared resolver using the source-spec its provenance record carries, computes a diff to a target version scoped to that template's occupied ownership boundary (whole files for exclusive subtrees, owned regions only for shared files), presents it as a reviewable and approvable change set, applies it non-destructively within that boundary on approval, and supports rollback to the pre-upgrade repository state. Each applied template adopts a newer version on its own cadence — there is no forced whole-repository upgrade, and one template's upgrade never touches another template's regions in a shared file.

Recorded debt — upgrade-target selection: how a developer names WHICH applied template to upgrade is a not-yet-made design decision. The shipped command surface takes no template argument (`upgrade <projectRoot> <targetVersion>`), and the engine resolves its baseline from the first provenance record in the set, printing a which-record-was-picked notice when more records exist (`packages/cli/src/adapters/provenance-io.ts`). This feature's status stays unchecked until selection lands and the flow's first two instructions are true as written (tracked by issue #508).

### 1.2 Purpose

This feature exists to let a project developer safely adopt newer versions of any applied template without hand-editing files or risking unreviewed changes. It satisfies the requirement that upgrades are expressed as approvable change sets (`cpt-frontx-fr-cli-project-upgrade-changeset`) and that no modification reaches repository files until the developer grants explicit approval (`cpt-frontx-fr-cli-upgrade-review-approval`). Each applied template is diffed and applied independently against its own provenance record. The engine is reusable across invokers — direct CLI and AI orchestration (F17) both drive the same engine without a second implementation.

**Requirements**: `cpt-frontx-fr-cli-project-upgrade-changeset`, `cpt-frontx-fr-cli-upgrade-review-approval`

**Principles**: —

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Triggers the upgrade, reviews the computed change set, and approves or declines it |

### 1.4 References

- **PRD**: [PRD.md](../../../../../architecture/PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Dependencies**: `cpt-frontx-feature-composed-provenance` (F13) — owns `ProjectProvenance` and `cpt-frontx-contract-project-provenance`; this engine reads the per-applied-template provenance records written at apply time but does not redefine the entity or the contract.

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor (human or external system) and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: `cpt-frontx-usecase-ai-driven-template-upgrade`

### Developer Review and Approval of an Upgrade Change Set

- [x] `p1` - **ID**: `cpt-frontx-flow-upgrade-changeset-review-approval`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer approves the change set; engine applies it non-destructively and updates provenance to the newer version.

**Error Scenarios**:
- Developer declines the change set; no project files are written and the project remains at its current version.
- Target template version cannot be resolved; the engine reports the failure and aborts before any file is written.
- The recorded source-spec address serves a different template at the target version than at the baseline version; the engine reports both declared identities and aborts before computing a diff or writing any file.
- The provenance record names an identity that neither resolved version declares and that is not the repository its own source-spec addresses; the engine reports the refusal and aborts before computing a diff or writing any file.
- Change set contains conflicts with developer modifications; engine surfaces them in the presented change set for manual resolution before approval.

**Steps**:
1. [x] - `p1` - Developer invokes the upgrade command, naming the applied template to upgrade and providing the target version or requesting the latest available version - `inst-invoke-upgrade`
2. [x] - `p1` - Engine reads the selected applied template's provenance record via `cpt-frontx-contract-project-provenance` to determine that template's identity and current version - `inst-read-provenance`
3. [x] - `p1` - **IF** the target version cannot be resolved: - `inst-if-no-target`
   1. [x] - `p1` - Engine reports the resolution failure and **RETURN** without writing any files - `inst-abort-no-target`
4. [x] - `p1` - Engine computes the template-version diff against the provenance baseline (see `cpt-frontx-algo-upgrade-changeset-compute`) - `inst-compute-diff`
5. [x] - `p1` - Engine presents the change set to the developer for review, including any flagged conflicts - `inst-present-changeset`
6. [x] - `p1` - **IF** developer approves the change set: - `inst-if-approved`
   1. [x] - `p1` - Engine applies the change set non-destructively (see `cpt-frontx-algo-upgrade-changeset-apply`) - `inst-apply-changeset`
   2. [x] - `p1` - Engine updates the selected applied template's provenance record to the newer version - `inst-update-provenance`
   3. [x] - `p1` - **RETURN** success: change set applied and provenance updated - `inst-return-success`
7. [x] - `p1` - **ELSE** (developer declines): - `inst-else-declined`
   1. [x] - `p1` - Engine makes no changes to project files - `inst-no-write-on-decline`
   2. [x] - `p1` - **RETURN** declined: project remains at current version, no files written - `inst-return-declined`

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures that do not interact with actors directly. Reusable building blocks called by Actor Flows or other processes.

### Compute Template-Version Diff Against Provenance Baseline

- [x] `p2` - **ID**: `cpt-frontx-algo-upgrade-changeset-compute`

**Input**: Project root path; target template version reference.

**Output**: A change set describing the diff between the provenance-recorded baseline version and the target version (added, modified, and removed files; flagged conflicts), scoped to the selected template's occupied ownership boundary.

**Steps**:
1. [x] - `p1` - Read `target` the selected applied template's provenance record from the repository via `cpt-frontx-contract-project-provenance`; extract that template's identity, current (baseline) version, re-resolvable source-spec, and occupied ownership boundary - `inst-cmp-read-provenance`
2. [x] - `p1` - Resolve `target` the baseline-version template content by re-fetching it through the shared resolver (`cpt-frontx-feature-template-resolution`) using the provenance record's source-spec at the baseline version — never from the local inventory, which retains only one version per entry and cannot supply an older baseline - `inst-cmp-resolve-baseline`
3. [x] - `p1` - Resolve `target` the target-version template content through the same shared resolver using the same source-spec at the target version - `inst-cmp-resolve-target`
4. [x] - `p1` - Verify `target`, before computing any diff, that the baseline-resolved and target-resolved content are two versions of the one template the provenance record describes — the record's identity is what the diff scopes ownership and matches region markers by, so a mismatch would diff one template's boundaries and markers against another template's content - `inst-cmp-verify-identity`
   1. [x] - `p1` - **IF** the identity the target version's manifest declares differs from the identity the baseline version's manifest declares: - `inst-cmp-if-identity-drift`
      1. [x] - `p1` - Report that the recorded source-spec address serves a different template at the target version than at the baseline version, naming both declared identities, the address and both versions, and **RETURN** failure having computed no diff - `inst-cmp-abort-identity-drift`
   2. [x] - `p1` - **IF** the provenance record's identity differs from the identity both resolved versions declare: - `inst-cmp-if-record-identity-differs`
      1. [x] - `p1` - **IF** the record's identity is the repository name its own source-spec addresses and that source-spec addresses no subtree — the shape of a record written before identity came from the manifest, which no resolved version can declare any more: - `inst-cmp-if-legacy-record`
         1. [x] - `p1` - Accept the record as naming this template, treating the difference as the identity-scheme change it is, and mark the acceptance as a pre-manifest-identity one so the diff step can tell such a record from one whose identity the resolved manifests declare, then continue - `inst-cmp-accept-legacy-record`
      2. [x] - `p1` - **ELSE**: - `inst-cmp-else-record-unrecognized`
         1. [x] - `p1` - Report that the record's identity is neither the identity the resolved versions declare nor the repository its own source-spec addresses, so the template being upgraded cannot be established, and **RETURN** failure having computed no diff - `inst-cmp-abort-record-unrecognized`
5. [x] - `p1` - Compute the file-level diff between the baseline-version and target-version template files, scoped to the template's occupied ownership boundary: for an exclusive subtree, diff whole files; for a `region-union` shared file, diff only within that template's owned marker-delimited region(s), leaving co-owning templates' regions out of the diff - `inst-cmp-diff-files`
   1. [x] - `p1` - **IF** the record was accepted as a pre-manifest-identity one: leave every `region-union` shared file out of the diff entirely, so no such file contributes an entry whichever identity its markers carry, because the record's identity matches no marker the resolved content carries and any entry a region comparison produced would report a region the template still owns as added or removed - `inst-cmp-skip-region-union-legacy`
6. [x] - `p1` - **FOR EACH** changed file in the diff: - `inst-cmp-for-each-file`
   1. [x] - `p1` - Check whether the developer has locally modified the file in the project - `inst-cmp-check-local-mod`
   2. [x] - `p1` - **IF** both the template diff and a local developer modification affect the same file: - `inst-cmp-if-conflict`
      1. [x] - `p1` - Mark the file as a conflict in the change set, recording both the template-level change and the local modification - `inst-cmp-flag-conflict`
   3. [x] - `p1` - **ELSE**: - `inst-cmp-else-clean`
      1. [x] - `p1` - Add the file as a clean change-set entry (add / modify / remove) - `inst-cmp-add-clean-entry`
7. [x] - `p1` - Assemble and **RETURN** the computed change set (clean entries + flagged conflicts) - `inst-cmp-return-changeset`

### Apply Change Set Non-Destructively; Support Rollback; Update Provenance

- [x] `p2` - **ID**: `cpt-frontx-algo-upgrade-changeset-apply`

**Input**: Approved change set; project root path.

**Output**: Applied project state with provenance updated; rollback capability retained until explicitly released.

**Steps**:
1. [x] - `p1` - Capture `target` a pre-upgrade snapshot of all files affected by the change set so rollback can restore exact pre-upgrade state - `inst-app-snapshot`
2. [x] - `p1` - **TRY**: - `inst-app-try`
   1. [x] - `p1` - **FOR EACH** clean entry in the change set, in dependency order: - `inst-app-for-each-entry`
      1. [x] - `p1` - Apply the entry to the project root within the template's ownership boundary: for an exclusive subtree, write or remove the whole file; for a `region-union` shared file, rewrite only the template's own marker-delimited region(s) in place, leaving every co-owning template's region byte-for-byte untouched - `inst-app-apply-entry`
   2. [x] - `p1` - Update `target` the selected applied template's provenance record to the newer version, as part of the same atomic application as the project-file writes above — not after it - `inst-app-update-prov`
3. [x] - `p1` - **CATCH** application error, including a failure writing the updated provenance record: - `inst-app-catch`
   1. [x] - `p1` - Restore `target` all affected files, including the provenance file, from the pre-upgrade snapshot, leaving the project byte-for-byte unchanged - `inst-app-restore-on-error`
   2. [x] - `p1` - Report the error and **RETURN** failure without leaving a partially-upgraded repository - `inst-app-return-failure`
4. [x] - `p1` - Retain `target` the pre-upgrade snapshot for rollback until the developer explicitly releases it or a new upgrade cycle begins - `inst-app-retain-snapshot`
5. [x] - `p1` - **RETURN** success: applied entries, updated provenance, rollback available - `inst-app-return-success`

### Rollback an Applied Change Set

- [x] `p2` - **ID**: `cpt-frontx-algo-upgrade-changeset-rollback`

**Input**: Project root path; retained pre-upgrade snapshot.

**Output**: Project files and provenance restored to exact pre-upgrade state.

**Steps**:
1. [x] - `p1` - **IF** no retained pre-upgrade snapshot exists for the project: - `inst-rb-if-no-snapshot`
   1. [x] - `p1` - Report that rollback is not available and **RETURN** failure - `inst-rb-no-snapshot`
2. [x] - `p1` - **FOR EACH** file in the pre-upgrade snapshot: - `inst-rb-for-each`
   1. [x] - `p1` - Restore the file from the snapshot, overwriting the post-apply state - `inst-rb-restore-file`
3. [x] - `p1` - Restore `target` the provenance record to the pre-upgrade version from the snapshot - `inst-rb-restore-provenance`
4. [x] - `p1` - Release the snapshot - `inst-rb-release-snapshot`
5. [x] - `p1` - **RETURN** success: project and provenance at exact pre-upgrade state - `inst-rb-return-success`

## 4. States (CDSL)

### Change-Set Lifecycle

- [x] `p2` - **ID**: `cpt-frontx-state-upgrade-changeset-lifecycle`

**States**: COMPUTED, PRESENTED, APPROVED, APPLIED, ROLLED_BACK, REJECTED

**Initial State**: COMPUTED

**Transitions**:
1. [x] - `p1` - **FROM** COMPUTED **TO** PRESENTED **WHEN** the change set has been built and shown to the developer for review - `inst-st-computed-to-presented`
2. [x] - `p1` - **FROM** PRESENTED **TO** APPROVED **WHEN** the developer grants explicit approval - `inst-st-presented-to-approved`
3. [x] - `p1` - **FROM** PRESENTED **TO** REJECTED **WHEN** the developer declines the change set - `inst-st-presented-to-rejected`
4. [x] - `p1` - **FROM** APPROVED **TO** APPLIED **WHEN** the engine has applied all change-set entries non-destructively and updated provenance - `inst-st-approved-to-applied`
5. [x] - `p1` - **FROM** APPLIED **TO** ROLLED_BACK **WHEN** the developer requests rollback and the engine restores the pre-upgrade snapshot - `inst-st-applied-to-rolledback`

## 5. Definitions of Done

### Change-Set Computation and Presentation

- [x] `p1` - **ID**: `cpt-frontx-dod-upgrade-changeset-computation`

The system **MUST** compute a reviewable change set by re-resolving the baseline version through the shared resolver from the source-spec recorded in the selected template's provenance record (not from the single-version local inventory), diffing the target template version against that baseline scoped to the template's occupied ownership boundary — whole files for exclusive subtrees and owned marker-delimited regions only for shared files — and presenting it to the developer before writing any project file; no project file may be created, modified, or deleted until the developer explicitly approves.

Because a source-spec address may legitimately begin serving a different template, the system **MUST**, before computing any diff, confirm that the baseline-resolved and target-resolved content declare one and the same template identity, and that the provenance record's recorded identity is either that declared identity or the repository name its own subtree-less source-spec addresses — the identity a record written before identity came from the manifest carried. Any other combination **MUST** be refused with the identities that were compared named, and no diff computed; an identity that cannot be read is never treated as a match.

The change set for a record admitted on the repository-name match covers that template's exclusive subtrees only. Owned regions are matched by the identity the record carries, which no resolved version declares in its markers any more, so every `region-union` shared file **MUST** be left out of that change set whichever identity its markers carry, rather than contributing an entry a region comparison across the two identity schemes produced.

**Implements**:
- `cpt-frontx-flow-upgrade-changeset-review-approval`
- `cpt-frontx-algo-upgrade-changeset-compute`

**Touches**:
- Entities: `ProjectProvenance`

### Non-Destructive Application and Provenance Update

- [x] `p1` - **ID**: `cpt-frontx-dod-upgrade-changeset-apply`

The system **MUST** apply the approved change set non-destructively by writing only the approved entries to the repository within the selected template's ownership boundary — rewriting only that template's own marker-delimited region(s) in a shared file and leaving every co-owning template's region untouched — retain a pre-upgrade snapshot for rollback, and update the selected applied template's provenance record to the newer version upon successful application.

The provenance write **MUST** be treated as part of the same atomic application as the project-file writes, not as a step that follows it: if writing the updated provenance fails, the system **MUST** restore every snapshotted project file and the prior provenance bytes to their pre-upgrade state and **RETURN** a typed failure, rather than throwing after project files have already been changed.

**Implements**:
- `cpt-frontx-flow-upgrade-changeset-review-approval`
- `cpt-frontx-algo-upgrade-changeset-apply`

**Touches**:
- Entities: `ProjectProvenance`

### Rollback to Pre-Upgrade State

- [x] `p1` - **ID**: `cpt-frontx-dod-upgrade-changeset-rollback`

The system **MUST** support rollback of an applied change set by restoring all affected project files and the provenance record to their exact pre-upgrade state from the retained snapshot.

**Implements**:
- `cpt-frontx-flow-upgrade-changeset-review-approval`
- `cpt-frontx-algo-upgrade-changeset-rollback`

**Touches**:
- Entities: `ProjectProvenance`

### Single Authoritative Engine

- [x] `p1` - **ID**: `cpt-frontx-dod-upgrade-changeset-single-engine`

The system **MUST** provide exactly one change-set engine in `cpt-frontx-component-cli`; both direct CLI invocation and AI-driven orchestration (`cpt-frontx-feature-ai-upgrade-orchestration`, F17) **MUST** drive this same engine — no second implementation is permitted.

**Implements**:
- `cpt-frontx-flow-upgrade-changeset-review-approval`
- `cpt-frontx-algo-upgrade-changeset-apply`

**Touches**:
- Entities: `ProjectProvenance`

## 6. Acceptance Criteria

- [x] Invoking the upgrade command with an available newer template version produces a reviewable change set and writes no project files until the developer approves.
- [x] The baseline version is re-resolved through the shared resolver from the source-spec recorded in the selected template's provenance record, so the diff baseline is obtainable even though the local inventory retains only one version per entry.
- [x] The computed diff and the applied change set are scoped to the selected template's occupied ownership boundary: whole files for exclusive subtrees, and only the template's own marker-delimited region(s) for a shared file, leaving every co-owning template's region byte-for-byte unchanged.
- [x] Approving the change set writes only the approved entries and updates the selected applied template's provenance record to the newer version.
- [x] Declining the change set leaves the project byte-for-byte unchanged, with no file created, modified, or deleted.
- [x] Applying a change set and then rolling it back restores the exact pre-upgrade project state, including the provenance record.
- [x] Both direct CLI invocation and AI-driven orchestration (F17) drive the same change-set engine; no second diff-and-apply implementation exists.
- [x] A target version that cannot be resolved causes the engine to report the failure and abort before writing any project file.
- [x] An address whose target version declares a different template identity than its baseline version causes the engine to refuse the upgrade, naming both declared identities, and to compute no diff and write no project file.
- [x] A provenance record written before identity came from the manifest, its recorded identity being the repository name its subtree-less source-spec addresses, still upgrades without a refusal, provided both resolved versions declare one identity.
- [x] The change set computed for such a record covers that template's exclusive subtrees only: every `region-union` shared file is excluded from it, contributing neither a clean entry nor a conflict whichever identity its markers carry.
- [x] A provenance record whose identity is neither the identity the resolved versions declare nor the repository its own source-spec addresses causes the engine to refuse rather than assume a match.
- [x] A provenance-write failure occurring after at least one project file has already been applied restores every changed project file and the prior provenance bytes byte-for-byte, and the engine returns a typed failure rather than throwing.
