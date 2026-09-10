# Feature: AI Tooling Kit Packaging & Base Content


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Kit Base-Capability Session Availability](#kit-base-capability-session-availability)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Manifest Validation & Prefix Enforcement](#manifest-validation--prefix-enforcement)
- [4. States (CDSL)](#4-states-cdsl)
  - [Kit Lifecycle State Machine](#kit-lifecycle-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Kit Installs and Activates Base Capabilities](#kit-installs-and-activates-base-capabilities)
  - [Public Entry Points are Declared Skill/Rule Resources](#public-entry-points-are-declared-skillrule-resources)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-ai-kit-packaging`
## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-ai-kit-packaging`

### 1.1 Overview

Ships the AI Tooling Framework as a Constructor Studio kit (`cyber-pilot-kit-frontx`) with a declarative manifest, `frontx_`-prefixed resource identifiers, and solution-agnostic base ecosystem capabilities — making those capabilities available to AI agents at session start with no solution-specific content bundled into the base.

### 1.2 Purpose

The framework must reach consuming projects through the AI Tooling CLI so that AI agents working in those projects gain ecosystem-fluency skills, workflows, guidelines, and reference artifacts from the first session interaction. This feature realizes the kit-installation contract and enforces the template-agnostic base boundary mandated by the FRs and the KIT-1 constraint.

**Requirements**: `cpt-frontx-fr-ai-session-start-knowledge`, `cpt-frontx-fr-ai-frontx-skills`, `cpt-frontx-fr-ai-tooling-template-agnostic`, `cpt-frontx-fr-ai-agent-skill-resources`

**Principles**: `cpt-frontx-principle-template-agnostic-tooling`

**Applicability** (Often-N/A domains for an AI Tooling feature, per the FEATURE checklist's Applicability Context): PERF is addressed by `cpt-frontx-cyber-pilot-kit-frontx-nfr-resource-scale` (kit PRD §6.1) — the discover-at-least-200-resources threshold binds this feature's base-capability declaration surface. SEC and COMPL are not applicable: the kit introduces no authentication surface of its own (kit PRD §6.2, SEC-PRD-001) and no regulatory obligation attaches to a locally installed developer tool. OPS (observability) is not applicable — this feature introduces no logging, metrics, or tracing surface beyond the resource-discovery diagnostics `cpt-frontx-cyber-pilot-kit-frontx-nfr-usability` already requires. UX is addressed by `cpt-frontx-cyber-pilot-kit-frontx-nfr-usability` (kit PRD §6.1) and the declared applicability metadata every public resource carries (§1.1).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-ai-tooling-cli` | Installs the AI Tooling kit into a consuming project; surfaces `frontx_`-prefixed resources to agents at session start through the installation contract |
| `cpt-frontx-actor-ai-agent-host` | Conforming AI agent host that discovers and invokes the kit's declared `skill`/`rule` resources through the kit-installation contract, reading applicability metadata from each resource document |

### 1.4 References

- **PRD**: [PRD.md](../../../../../architecture/PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Dependencies**: None

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor (human or external system) and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: none direct — flow models session-start base-capability availability (no PRD usecase)

### Kit Base-Capability Session Availability

- [x] `p1` - **ID**: `cpt-frontx-flow-ai-kit-packaging-session-availability`

**Actor**: `cpt-frontx-actor-ai-tooling-cli`

**Note**: No PRD usecase backs this flow. It models the system behavior by which, after kit installation, the AI Tooling Framework's base capabilities become available to agents at session start — not a human-actor journey.

**Success Scenarios**:
- The kit is installed and registered; on next session start the agent receives all `frontx_`-prefixed resources declared in the kit manifest.

**Error Scenarios**:
- The kit manifest is absent or malformed; the agent session starts without AI Tooling Framework capabilities and a diagnostic error is surfaced.
- A required resource declared in the manifest is missing from the installed kit; the resource is skipped and the agent is notified of the partial-capability state.

**Steps**:
1. [x] - `p1` - AI agent session starts in a project that has `cyber-pilot-kit-frontx` installed - `inst-session-start`
2. [x] - `p1` - AI Tooling CLI locates the kit registration at `[kits.cyber-pilot-kit-frontx]` in `core.toml` - `inst-locate-registration`
3. [x] - `p1` - **IF** the kit registration is missing or `core.toml` is unreadable - `inst-if-no-registration`
   1. [x] - `p1` - Surface a diagnostic error indicating the kit is not installed; agent session proceeds without AI Tooling capabilities - `inst-no-registration-error`
   2. [x] - `p1` - **RETURN** partial-capability state, reported as `PACKAGED` — the kit is not installed - `inst-return-no-kit`
4. [x] - `p1` - Read the kit's `.cf-studio-kit.toml` from the path recorded in `[kits.cyber-pilot-kit-frontx].path` - `inst-read-manifest`
5. [x] - `p1` - Invoke **Process**: `cpt-frontx-algo-ai-kit-packaging-manifest-validation` to validate the manifest and enforce `frontx_`-prefix and solution-agnostic-base rules - `inst-invoke-validation`
6. [x] - `p1` - **IF** manifest validation fails - `inst-if-manifest-invalid`
   1. [x] - `p1` - Surface validation errors; agent session proceeds without AI Tooling capabilities - `inst-manifest-invalid-error`
   2. [x] - `p1` - **RETURN** partial-capability state with validation errors - `inst-return-invalid`
7. [x] - `p1` - **FOR EACH** resource entry declared across the validated manifest's kits - `inst-for-each-resource`
   1. [x] - `p1` - Resolve the resource's effective path from the manifest — from `source` for a register-mode kit (the kit is read in place, never copied), from `install_path` for a copy-mode install - `inst-resolve-resource-path`
   2. [x] - `p1` - **IF** the resource path does not exist on disk - `inst-if-resource-missing`
      1. [x] - `p1` - Record the resource as unavailable; continue iterating remaining resources - `inst-record-missing`
   3. [x] - `p1` - **ELSE** - `inst-else-resource-present`
      1. [x] - `p1` - Make the resource available to the agent session under its `frontx_`-prefixed resource id - `inst-expose-resource`
8. [x] - `p1` - **IF** any resources were recorded as unavailable - `inst-if-partial`
   1. [x] - `p1` - Surface a diagnostic warning listing unavailable resources; agent session proceeds with partial base capabilities - `inst-partial-warning`
9. [x] - `p1` - **RETURN** session-active capability set to the agent - `inst-return-session-active`

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures that do not interact with actors directly.

### Manifest Validation & Prefix Enforcement

- [x] `p1` - **ID**: `cpt-frontx-algo-ai-kit-packaging-manifest-validation`

**Input**: kit `.cf-studio-kit.toml` content (parsed as `{ manifest_version, kits[] }`) and optional presence flag indicating whether a no-solution-content scan is requested

**Output**: validation result — PASS or FAIL with a list of specific violations

**Steps**:
1. [x] - `p1` - Confirm the manifest object has the required top-level fields: `manifest_version` and a non-empty `kits` array - `inst-check-required-fields`
2. [x] - `p1` - **FOR EACH** kit, confirm its `slug` and `version` are present and non-empty - `inst-check-version`
3. [x] - `p1` - Confirm the kit's `resources` is a non-empty array - `inst-check-resources-array`
4. [x] - `p1` - **FOR EACH** entry in the kit's `resources` - `inst-for-each-entry`
   1. [x] - `p1` - Confirm the entry has required fields: `id`, `source`, `install_path`, `type` - `inst-check-entry-required`
   2. [x] - `p1` - Confirm `id` matches the pattern `^[a-z][a-z0-9_]*$` (base schema requirement) - `inst-check-id-pattern`
   3. [x] - `p1` - **[target]** Confirm `id` begins with literal prefix `frontx_` (KIT-1 enforcement specific to `cyber-pilot-kit-frontx`) - `inst-check-frontx-prefix`
   4. [x] - `p1` - **IF** the `frontx_` prefix check fails - `inst-if-prefix-fail`
      1. [x] - `p1` - Record violation: resource id `id` does not carry the required `frontx_` prefix - `inst-record-prefix-violation`
   5. [x] - `p1` - Confirm `type` is one of `file` or `directory` - `inst-check-type-enum`
   6. [x] - `p1` - Confirm `source` and `install_path` are relative paths contained within the kit root — no leading separator, no drive letter, and no `..` segment under either separator convention - `inst-check-contained-paths`
   7. [x] - `p1` - **IF** either path escapes the kit root - `inst-if-path-escapes`
      1. [x] - `p1` - Record violation: the path may resolve outside the kit directory, which the kit substrate refuses - `inst-record-path-escape`
   8. [x] - `p1` - **IF** `public` is present, confirm it is a boolean and, when true, that `kind` is one of `skill`, `agent`, or `rule` (the only kinds the kit substrate admits as public) - `inst-check-public-kind`
   9. [x] - `p2` - **[target]** **IF** `public` is `true`, confirm `kind` is `skill` or `rule` (KIT-4 restricts public agent-facing entry points in `cyber-pilot-kit-frontx` to these two kinds; the kit declares no `agent`-kind resource) - `inst-check-public-kind-restricted`
   10. [x] - `p2` - **IF** the KIT-4 public-kind check fails - `inst-if-public-kind-restricted-fail`
       1. [x] - `p2` - Record violation: resource `id` is declared `public` with a `kind` other than `skill` or `rule` - `inst-record-public-kind-violation`
   11. [x] - `p2` - **[target]** **IF** `public` is `true`, confirm the resource's own document (the file at `source`, in its frontmatter or `description`) carries non-empty applicability metadata stating when the capability applies (KIT-4: applicability metadata lives in the resource document, not the manifest) - `inst-check-applicability-metadata`
   12. [x] - `p2` - **IF** the applicability-metadata check fails - `inst-if-applicability-metadata-fail`
       1. [x] - `p2` - Record violation: resource `id` is declared `public` without non-empty applicability metadata in its resource document - `inst-record-applicability-violation`
5. [x] - `p1` - **[target]** Scan the manifest resource set for any entry whose `id` or `description` names a known solution or template-specific concept (solution-agnostic-base enforcement for `cyber-pilot-kit-frontx`) - `inst-scan-solution-content`
6. [x] - `p1` - **IF** any solution-specific entry is detected - `inst-if-solution-content`
   1. [x] - `p1` - Record violation: base kit contains solution-specific content, which is prohibited by `cpt-frontx-adr-solution-ai-content-placement` - `inst-record-solution-violation`
7. [x] - `p1` - **IF** any violations were recorded - `inst-if-violations`
   1. [x] - `p1` - **RETURN** FAIL with the complete violation list - `inst-return-fail`
8. [x] - `p1` - **RETURN** PASS - `inst-return-pass`

## 4. States (CDSL)

### Kit Lifecycle State Machine

- [x] `p1` - **ID**: `cpt-frontx-state-ai-kit-packaging-kit-lifecycle`

**States**: `PACKAGED`, `INSTALLED`, `SESSION_ACTIVE`

**Initial State**: `PACKAGED`

**Transitions**:
1. [x] - `p1` - **FROM** `PACKAGED` **TO** `INSTALLED` **WHEN** the AI Tooling CLI installs `cyber-pilot-kit-frontx` into the consuming project and records the kit registration at `[kits.cyber-pilot-kit-frontx]` in `core.toml` with its `format`, `path`, `install_mode`, and `version` - `inst-transition-packaged-to-installed`
2. [x] - `p1` - **FROM** `INSTALLED` **TO** `SESSION_ACTIVE` **WHEN** an AI agent session starts, locates the kit registration, reads the manifest, passes manifest validation (including `frontx_`-prefix and solution-agnostic-base checks), and exposes all available resources to the agent session - `inst-transition-installed-to-active`
3. [x] - `p1` - **FROM** `SESSION_ACTIVE` **TO** `INSTALLED` **WHEN** the agent session ends; the kit registration and installed resources remain on disk unchanged - `inst-transition-active-to-installed`
4. [x] - `p1` - **FROM** `INSTALLED` **TO** `PACKAGED` **WHEN** the AI Tooling CLI uninstalls or removes the kit from the consuming project, deleting the `[kits.cyber-pilot-kit-frontx]` registration and installed resources - `inst-transition-installed-to-packaged`

Transitions 1, 3, and 4 are performed outside this package: the AI Tooling CLI writes and deletes the registration, and a session ends with its process. This package realizes transition 2 (`loadKitSession` returning `SESSION_ACTIVE`) and names the states; no code here writes `core.toml`.

## 5. Definitions of Done

### Kit Installs and Activates Base Capabilities

- [x] `p1` - **ID**: `cpt-frontx-dod-ai-kit-packaging-install-and-activate`

The system **MUST** install `cyber-pilot-kit-frontx` through the AI Tooling CLI such that all `frontx_`-prefixed resources declared in the kit manifest are made available to AI agents at session start, the kit lifecycle reaches `SESSION_ACTIVE`, and the installed base carries no solution-specific content.

**Implements**:
- `cpt-frontx-flow-ai-kit-packaging-session-availability`
- `cpt-frontx-algo-ai-kit-packaging-manifest-validation`

**Constraints**: `cpt-frontx-constraint-kit-prefixed-resource-ids`

**Touches**:
- Entities: `Kit`
- Resource shape: canonical kit manifest (`manifest_version` + `kits[]`, each kit carrying `slug`, `version`, and a `resources[]` array with `id`, `kind`, `source`, `install_path`, `type`, `user_modifiable`, `public` per entry)
- Registration: `[kits.cyber-pilot-kit-frontx]` block in `core.toml` (fields: `format`, `path`, `install_mode`, `version`); register-mode installs record no per-resource sub-tables and re-derive resource locations from the manifest
- No API surface; no persistent database

### Public Entry Points are Declared Skill/Rule Resources

- [x] `p1` - **ID**: `cpt-frontx-dod-ai-kit-packaging-declared-resource-surface`

The system **MUST** declare every public agent-facing entry point in the kit manifest as a resource of kind `skill` or `rule`, carry non-empty applicability metadata in each such resource document's frontmatter or description, and ship supporting knowledge content only as declared non-public resources — with the kit's test suite asserting all three.

**Implements**:
- `cpt-frontx-algo-ai-kit-packaging-manifest-validation`

**Constraints**: `cpt-frontx-constraint-kit-declared-skill-rule-resources`

**Touches**:
- Entities: `Kit`
- Resource shape: canonical kit manifest `resources[]` entries (`kind`, `public`, `source` document frontmatter/description)
- No API surface; no persistent database

**Verifiable clauses**:
- [x] Every manifest resource with `public = true` has `kind` equal to `skill` or `rule`
- [x] Each such resource's document (the file at `source`) carries non-empty applicability metadata in its frontmatter or `description`
- [x] Supporting knowledge content (for example the guidelines directory) ships as declared non-public resources of the kind that fits it
- [x] The kit's test suite asserts the three clauses above, per `cpt-frontx-adr-ai-tooling-framework-packaging` Confirmation

## 6. Acceptance Criteria

- [x] `cyber-pilot-kit-frontx` installs through the Constructor Studio CLI and the kit registration appears at `[kits.cyber-pilot-kit-frontx]` in `core.toml` with `format`, `path`, `install_mode`, and `version` fields
- [x] Every resource `id` declared in the kit's `.cf-studio-kit.toml` begins with the literal prefix `frontx_` (KIT-1); the package test suite parses the shipped manifest from disk and asserts all ids match `^frontx_`
- [x] The kit manifest validates against the canonical kit-manifest schema (`manifest_version` + non-empty `kits[]`, each kit carrying a non-empty `resources[]`; required fields present on every entry, `source`/`install_path` contained within the kit root, and `public` admitted only for `skill`/`agent`/`rule` kinds)
- [x] No solution-specific content is present in the base kit manifest; the solution-agnostic-base admission check passes
- [x] On agent session start in a project with the kit installed, all declared `frontx_`-prefixed resources are available to the agent; the kit lifecycle state is `SESSION_ACTIVE`
- [x] When the kit manifest is absent or malformed, the agent session starts without AI Tooling Framework capabilities and a diagnostic error is surfaced
- [x] When an installed resource file is missing, the agent session starts with partial capabilities and a diagnostic warning is surfaced listing unavailable resources
- [x] The state machine covers all three lifecycle states (`PACKAGED` → `INSTALLED` → `SESSION_ACTIVE`) with defined FROM/TO/WHEN transitions
- [x] Every manifest resource declared `public = true` has `kind` `skill` or `rule`, each such resource's document carries non-empty applicability metadata in its frontmatter or `description`, supporting knowledge content ships only as declared non-public resources, and the kit test suite asserts all three
