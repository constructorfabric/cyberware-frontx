# Feature: Ecosystem Layer-Partition Governance


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Boundary Guards Run in Continuous Integration](#boundary-guards-run-in-continuous-integration)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Total Workspace Classification](#total-workspace-classification)
  - [Member-Registration Gate](#member-registration-gate)
- [4. States (CDSL)](#4-states-cdsl)
  - [No Lifecycle To Model](#no-lifecycle-to-model)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Every Workspace Candidate Is Classified or CI Fails](#every-workspace-candidate-is-classified-or-ci-fails)
  - [Every Member's Artifact Chain Is Registered for Enforcement or Recorded as Debt](#every-members-artifact-chain-is-registered-for-enforcement-or-recorded-as-debt)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-ecosystem-governance`
## 1. Feature Context

- [ ] `p2` - `cpt-frontx-feature-ecosystem-governance`

### 1.1 Overview

This feature is the governance machinery for the layer partition's root-owned constraints (root DESIGN §2.2). Total classification (`cpt-frontx-constraint-layer-total-classification`) is checked by package-boundary tests for workspace packages. The member artifact chain (`cpt-frontx-constraint-member-artifact-chain`) is checked by a registration gate over the artifacts registry. Citation direction (`cpt-frontx-constraint-root-cites-no-member`) remains review-held because the validator cannot scope citations across registered systems.

The machinery lives in root-owned code outside any package: `scripts/package-edge-tests.ts` and `scripts/verify-guard-configs.ts`, reading the layer model from `internal/depcruise-config/layer-constants.cjs`. The reason is the same as for the version-policy check: the partition binds the relationships between members, so no single member may own its enforcement.

### 1.2 Purpose

The layer partition only keeps members decoupled while its rules bind new arrivals. This feature makes two failures visible. First, a package added to the workspace without a classification fails continuous integration instead of being skipped. Second, a member's artifact chain cannot silently degrade into an honour system: the member must be registered as its own child system with its required artifact kinds enforced, or it must remain covered by a path-anchored debt ignore whose reason records both the current debt and the removal criterion.

**Requirements**: `cpt-frontx-fr-layer-member-governance`

**Principles**: `cpt-frontx-principle-federated-artifacts`, `cpt-frontx-principle-property-based-membership` — realized by enforcement rather than by structure, which is the only way a principle of this kind is realized at all. Total classification is what keeps membership a property of the role a unit plays rather than of whether someone remembered it, and requiring each member to be registered as its own child system with its artifact kinds enforced — or covered by a path-anchored debt ignore that records its removal criterion — is what keeps artifact ownership federated instead of drifting into an honour system. The root DECOMPOSITION records this feature as their coverage; an earlier revision of this line claimed none, which left both principles with no realizing feature anywhere.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| N/A | N/A |

Not applicable — there is no end-user-facing usecase; the single flow models the continuous-integration run that executes the guards.

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md) — §1.3 (the ratified layer model), §2.2 (the LAYER constraints this machinery enforces)
- **Constraints**: `cpt-frontx-constraint-layer-total-classification`, `cpt-frontx-constraint-member-artifact-chain`; `cpt-frontx-constraint-root-cites-no-member` is review-held and deliberately not machine-claimed here
- **Dependencies**: None

## 2. Actor Flows (CDSL)

Note: there is no actor-facing PRD usecase for governance machinery. The flow below models the continuous-integration run that executes both guards; it traces to the enforcement claims in DESIGN §2.2 (LAYER-1: "an unresolved candidate fails continuous integration rather than being skipped"; LAYER-2: "the registration must use the form that enforces the declared kinds").

### Boundary Guards Run in Continuous Integration

- [x] `p1` - **ID**: `cpt-frontx-flow-ecosystem-governance-ci-guard-run`

**Actor**: Continuous integration

**Success Scenarios**:
- Every workspace candidate resolves to exactly one layer or stated non-layer category, every classified package has a reviewed edge allowlist, and every FrontX-owned member's artifact chain is either registered for enforcement or covered by a path-scoped debt ignore; the run passes.

**Error Scenarios**:
- A workspace exists on disk that no layer list mentions; the run fails naming the unclassified candidate. (DESIGN LAYER-1: "a new package cannot pass enforcement it was never subjected to".)
- A FrontX-owned member is unregistered, or registered in the explicit-artifact-list form that validates while enforcing nothing; the run fails naming the member. (DESIGN LAYER-2.)

**Steps**:
1. [x] - `p1` - Run the package-boundary edge tests, including total workspace classification, over the workspace manifests - `inst-cgr-edges`
2. [x] - `p1` - Run the guard-config verification, including the member-registration gate, over the guard configs and the artifacts registry - `inst-cgr-guards`
3. [x] - `p1` - **IF** any check fails: exit nonzero so the continuous-integration run fails rather than skipping the candidate - `inst-cgr-fail`
4. [x] - `p1` - **RETURN** PASS — the partition's machine-checked constraints hold for this revision - `inst-cgr-pass`

## 3. Processes / Business Logic (CDSL)

### Total Workspace Classification

- [x] `p1` - **ID**: `cpt-frontx-algo-ecosystem-governance-total-classification`

Traces to `cpt-frontx-constraint-layer-total-classification` (its workspace-package half; the template-manifest half is review-held per the constraint's own text). The classification source is the layer model in `internal/depcruise-config/layer-constants.cjs`; discovery is from the root manifest so the universe is the repository's, not an authored list.

**Input**: The root manifest's `workspaces` globs, the workspace directories on disk, and the layer model (published-library properties, projects-orchestration and build-internals lists, edge allowlist).

**Output**: PASS if every workspace on disk is classified and every classified package has an explicit edge allowlist entry; FAIL naming each offender otherwise.

**Steps**:
1. [x] - `p1` - Resolve every workspace directory that exists on disk from the root manifest's `workspaces` globs; an unsupported glob shape throws rather than silently skipping the packages it would hide - `inst-tc-discover`
2. [x] - `p1` - **IF** a discovered workspace is absent from the layer classification: FAIL, naming each unclassified workspace and where to classify it - `inst-tc-unmapped`
3. [x] - `p1` - **IF** a classified package has no explicit edge-allowlist entry: FAIL, naming it — a missing entry would let a default stand in for a reviewed decision - `inst-tc-unlisted`
4. [x] - `p1` - **RETURN** the per-check results; all passing means every candidate in the workspace universe resolved - `inst-tc-return`

### Member-Registration Gate

- [x] `p1` - **ID**: `cpt-frontx-algo-ecosystem-governance-member-registration-gate`

Traces to `cpt-frontx-constraint-member-artifact-chain`: every FrontX-owned layer member must be registered as its own child system with PRD, DESIGN and at least one FEATURE required, in the autodetect form. The explicit-artifact-list form validates while enforcing nothing, so it does not count. A member whose package is still covered by a path-anchored `[[ignore]]` is accepted only when the ignore reason records artifact-chain debt and an objective removal criterion.

**Input**: The artifacts registry (`.cf-studio/config/artifacts.toml`) and the layer model's member lists.

**Output**: One PASS/FAIL result per FrontX-owned member; FAIL names the member and the specific registration defect.

**Steps**:
1. [x] - `p1` - Derive the member list from the layer classification: published libraries plus projects orchestration; build internals are exempt from the chain by DESIGN §1.3 - `inst-mrg-members`
2. [x] - `p1` - Read the child-system registrations and the path-anchored ignore roots from the artifacts registry - `inst-mrg-read`
3. [x] - `p1` - **IF** the member's package directory is covered by a path-anchored ignore whose reason records artifact-chain debt and an objective removal criterion: PASS as recorded debt; otherwise FAIL naming the missing metadata - `inst-mrg-debt`
4. [x] - `p1` - **IF** no child system's artifacts directory lies under the member's package: FAIL — an unregistered member's chain is an honour system - `inst-mrg-unregistered`
5. [x] - `p1` - **IF** the child declares no autodetect artifact kinds, or does not require PRD, DESIGN and FEATURE: FAIL naming the unenforced kinds — the explicit-artifact-list form validates while enforcing nothing - `inst-mrg-unenforcing`
6. [x] - `p1` - **RETURN** PASS for the member, naming the kinds its registration requires - `inst-mrg-pass`

## 4. States (CDSL)

### No Lifecycle To Model

Not applicable — the guards are stateless checks over the repository's current revision; no entity here has a lifecycle to model.

## 5. Definitions of Done

### Every Workspace Candidate Is Classified or CI Fails

- [x] `p1` - **ID**: `cpt-frontx-dod-ecosystem-governance-total-classification-enforced`

The system **MUST** resolve every workspace package on disk to exactly one layer or one of the stated non-layer categories, and **MUST** fail the continuous-integration run — naming the offender — on any workspace the layer model does not mention or any classified package without an explicit edge-allowlist entry.

**Implements**:
- `cpt-frontx-flow-ecosystem-governance-ci-guard-run`
- `cpt-frontx-algo-ecosystem-governance-total-classification`

**Constraints**: `cpt-frontx-constraint-layer-total-classification` — this DoD is that constraint's workspace-package enforcement; the template-manifest half is review-held per the constraint's text.

**Touches**:
- `scripts/package-edge-tests.ts` — discovery and classification checks
- `internal/depcruise-config/layer-constants.cjs` — the layer model being enforced
- `cpt-frontx-fr-layer-member-governance`

### Every Member's Artifact Chain Is Registered for Enforcement or Recorded as Debt

- [x] `p1` - **ID**: `cpt-frontx-dod-ecosystem-governance-member-registration-enforced`

The system **MUST** fail the continuous-integration run when a FrontX-owned layer member is neither registered in the artifacts registry as its own child system requiring PRD, DESIGN and FEATURE via the autodetect form, nor covered by a path-anchored ignore whose reason records current artifact-chain debt and an objective removal criterion.

**Implements**:
- `cpt-frontx-flow-ecosystem-governance-ci-guard-run`
- `cpt-frontx-algo-ecosystem-governance-member-registration-gate`

**Constraints**: `cpt-frontx-constraint-member-artifact-chain`.

**Touches**:
- `scripts/verify-guard-configs.ts` — the registration gate
- `.cf-studio/config/artifacts.toml` — the registry being gated
- `cpt-frontx-fr-layer-member-governance`

## 6. Acceptance Criteria

- [x] Adding a workspace package without classifying it in the layer model fails the continuous-integration run, naming the package.
- [x] A classified package with no explicit edge-allowlist entry fails the run, naming the package.
- [x] Removing a member's child-system registration — or downgrading it to the explicit-artifact-list form, or dropping a `required = true` on PRD, DESIGN or FEATURE — fails the run, naming the member and the defect, unless a path-anchored ignore records the package debt.
- [x] Lifting a member's path-anchored ignore arms the registration gate for that member with no other change.
- [x] The citation-direction constraint is claimed by no machinery; its enforcement status (held by review) is stated in the constraint's own text.
- [x] An ignored member whose ignore reason lacks clear debt text or a removal criterion fails mechanically; a matching ignore with `reason = "temporary"` is rejected.
