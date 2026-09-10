# Feature: Template AI-Extension Contract & Discovery/Activation


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
  - [1.5 AI-Extension Bundle Convention](#15-ai-extension-bundle-convention)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Bundle, Publish, Install, Discover, and Activate AI Extensions](#bundle-publish-install-discover-and-activate-ai-extensions)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Extension Contract Scan and Activation](#extension-contract-scan-and-activation)
- [4. States (CDSL)](#4-states-cdsl)
  - [AiExtension Lifecycle](#aiextension-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Closed-Set Contract and Generalized Discovery Activation](#closed-set-contract-and-generalized-discovery-activation)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-template-ai-extensions`
## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-template-ai-extensions`

### 1.1 Overview

Defines the closed-set extension-bundle contract a template's AI bundle conforms to — skills, workflows, guidelines, and reference artifacts as named typed slots — and the generalized scan that discovers conforming installed-template extensions and activates them into the agent-visible capability set under explicit precedence, with no manual wiring; malformed extensions are reported as structural errors and not activated. A structurally conforming bundle is not activated on structure alone: its template identity must also be backed by a registered, pinned origin in the project's single state document, `.frontx/project.json`, or it is marked DENIED and excluded from activation — the trust gate that keeps a bundle placed under `.frontx/ai/` outside a legitimate `register`/`apply` operation from ever reaching an agent.

### 1.2 Purpose

This feature provides the mechanism by which template-specific AI expertise travels with a template to any project that installs it. It addresses the requirement that templates carry AI bundles conforming to a declared extension contract (`cpt-frontx-fr-ai-template-bundle-extensions`) and that installed-template extensions are discovered and activated without manual configuration (`cpt-frontx-fr-ai-extension-discovery-activation`). That same requirement fixes the trust boundary this feature enforces: in v1, the project's trust policy for template AI extensions is registration-gated, and denied or untrusted capabilities **MUST NOT** activate (kit PRD §5.2). This feature realizes that policy with the one trust fact already available to it without inventing a new mechanism — a bundle's identity is trusted exactly when that identity carries a registered, pinned origin in the project's single state document, because that pinning is what a legitimate `register`/`apply` operation produces and post-hoc content placed under `.frontx/ai/` outside the CLI cannot. A configurable per-identity deny surface beyond registration-gating is out of scope for v1 (kit PRD §11 Open Questions).

**Requirements**: `cpt-frontx-fr-ai-template-bundle-extensions`, `cpt-frontx-fr-ai-extension-discovery-activation`

**Applicability** (Often-N/A domains for an AI Tooling feature, per the FEATURE checklist's Applicability Context): PERF is addressed by `cpt-frontx-cyber-pilot-kit-frontx-nfr-resource-scale` (kit PRD §6.1) — the ≥200-declared-agent-resources discovery threshold (≤2s at p95) and the ≥20-installed-templates availability threshold are what this feature's discovery-and-activation scan binds. SEC is addressed directly, not deferred: the registered-pinned-origin trust gate (§1.1, §3 `inst-check-identity-trust`) is this feature's own authorization boundary, and the BUNDLED → DENIED transition (§4) is its enforcement mechanism. OPS (observability) is not applicable — no logging, metrics, or tracing surface is introduced beyond the structural-error and denial reporting this feature already specifies. COMPL is not applicable — no regulatory obligation attaches to a locally scanned extension bundle. UX is addressed by `cpt-frontx-cyber-pilot-kit-frontx-nfr-usability` and the denial/structural-error reporting named to the Project Developer (§2, §3).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-template-developer` | Declares AI extensions under the closed-set contract and publishes the template bundle |
| `cpt-frontx-actor-project-developer` | Installs the template into a project; receives template-specific AI capabilities without manual wiring |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Dependencies**:
  - `cpt-frontx-feature-template-resolution` (F10) — discovery reads whatever bundle ends up materialized under a scaffolded project's `.frontx/ai/<template-identity>/` (`<template-identity>` is the value of the applying template's own manifest `name` field — called `<manifest-name>` in the CLI package's own documentation, [How a Template Source Is Referenced and What a Stored Reference Holds](../../../../../architecture/ADR/0017-source-spec-syntax.md)): this feature's scan reads every such bundle on the AI Tooling Framework's own invocation, over a filesystem handoff via the project, not a CLI-to-Kit signal (root DESIGN §3.4).
  - `cpt-frontx-feature-cli-scaffolding` (F12) — owns the CLI-owned materialization step that puts an identity's `.frontx/ai/<template-identity>/` bundle on disk and keeps it current: the assembler copies it from the template's payload on the `apply` that gives that identity its first target, updates it on `upgrade`, and removes it when `delete` removes that identity's last remaining target. `cpt-frontx-adr-template-ownership-boundary-declaration` unconditionally subtracts `.frontx` from every template's own effective ownership, so no template's payload-write path ever claims this subtree — the CLI's assembler does, as a step distinct from writing the template's own target content (§1.5). This feature never writes the bundle, only discovers and activates what F12 has put there.
  - `cpt-frontx-feature-ai-kit-packaging` (F15) — bundled extensions activate into the base kit's capability set

### 1.5 AI-Extension Bundle Convention

This is the concrete on-disk shape the fs-discovery scan reads. A template author places the bundle at the template's content root, and the CLI's assembler copies it, unmodified, onto the same identity-scoped path under the scaffolded project — the same on-disk shape in both places. This section fixes that shape and the anchor/slot schema it declares, per `cpt-frontx-adr-contract-schema-ownership` (design altitude fixes the contract's existence and closed-set categories in `cpt-frontx-adr-template-ai-extension-contract`); the mechanism that gets the bundle from the template's content root onto that path at apply time is fixed by `cpt-frontx-feature-cli-scaffolding` (F12) as a CLI-owned step — see **Bundle materialization is CLI-owned** below — and this FEATURE's discovery-and-activation contract does not reimplement it.

**Bundle root**: `.frontx/ai/<template-identity>/` — a per-template, identity-scoped subtree whose `<template-identity>` segment is the applying template's manifest identity. At authoring time it lives relative to the template's content root, in the template's payload; the discovery scan reads it from that same identity-scoped path under the scaffolded project root, once the CLI's assembler has copied it there (see **Bundle materialization is CLI-owned** below). Because each applied template's bundle is scoped to its own identity, any number of co-applied templates' bundles co-locate under `.frontx/ai/` without colliding as discovered content — disjoint id-scoped subtrees never intersect. Same-named-slot precedence across bundles is resolved at activation time by the AI Tooling Framework (below), not by any assembly-time mechanism.

**Anchor**: `.frontx/ai/<template-identity>/extension.json` — declares the bundle's identity (`id`, non-empty string), a contract version (`contractVersion`), and the declared entry list (`entries: { id, category, path }[]`), where `category` is one of the closed-set `ExtensionCategory` values and `path` is relative to the bundle root `.frontx/ai/<template-identity>/`. A bundle whose anchor is missing, unparseable as JSON, or lacks a non-empty `id` yields a structural error and contributes no entries to discovery.

**Bundle materialization is CLI-owned**: the bundle is never a template's own written content and is never part of any template's ownership claim. No template declares this subtree as an ownership boundary in its manifest, because there is no declaration through which it could: `cpt-frontx-adr-template-ownership-boundary-declaration` unconditionally subtracts `.frontx` from every template's effective ownership without exception, so no template's payload-write path ever claims `.frontx/ai/<template-identity>/` as owned content. Instead, the CLI's assembler (`cpt-frontx-feature-cli-scaffolding`, F12) materializes the bundle as a step distinct from writing the template's own target content, by convention against the identity-scoped `.frontx/ai/<template-identity>/` path this section fixes:

- On the `apply` that gives a template identity its first target, the assembler copies that identity's bundle — living at `.frontx/ai/<template-identity>/` in the template's own content root, not target-relative, because the bundle is per-identity rather than per-target — from the template's payload into the scaffolded project at that same path.
- On `upgrade`, the assembler updates the materialized bundle in place if the newer version carries one, within the same atomic transition that moves the identity's targets forward.
- On `delete` of an identity's last remaining target, the assembler removes the materialized bundle, since nothing applied under that identity remains to have activated capabilities for.

This is the CLI-owned step F12 performs; this FEATURE never writes the bundle and does not reimplement any part of it. This FEATURE's discovery and activation contract depends only on the bundle's shape — fixed above — being present at that path when this feature's own scan runs, not on which of the three moments above most recently put it there.

**Slot subdirs** (closed set — a subdirectory of the bundle root `.frontx/ai/<template-identity>/` outside this set is a structural error, "category outside the closed set"):

| Category | Subdir | Required on-disk shape for a declared entry |
|---|---|---|
| `skills` | `skills/` | `path` names a subdirectory under `skills/`; that subdirectory MUST contain `SKILL.md` |
| `workflows` | `workflows/` | `path` names a single Markdown file under `workflows/` |
| `guidelines` | `guidelines/` | `path` names a single Markdown file under `guidelines/` |
| `reference_artifacts` | `reference-artifacts/` | `path` names a single file (any extension) under `reference-artifacts/` |

A declared entry whose on-disk content does not match its slot's required shape (e.g. a `skills` entry whose directory has no `SKILL.md`) is a structural error and is REJECTED — it is excluded from the bundle fed to the discovery scan, alongside entries whose declared `category` is outside the closed set.

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor (human or external system) and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: `cpt-frontx-usecase-bundle-template-ai-extensions`

### Bundle, Publish, Install, Discover, and Activate AI Extensions

- [x] `p1` - **ID**: `cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate`

**Realizes**: `cpt-frontx-seq-template-ai-extension-discovery-activation`

**Actors**: `cpt-frontx-actor-template-developer` (bundle + publish leg), `cpt-frontx-actor-project-developer` (install + discover + activate leg)

**Success Scenarios**:
- Template Developer declares conforming AI extensions and publishes the template; Project Developer installs the template; the AI Tooling Framework discovers the bundled extension and activates its capabilities for agents with no manual configuration step.

**Error Scenarios**:
- Template Developer provides an extension entry that names a category outside the closed set; pre-publish validation rejects the declaration and the template is not published.
- Template Developer publishes a template with a malformed extension declaration; on install, the AI Tooling Framework reports a structural error and does not activate the non-conforming entry.

**Steps**:

*Bundle and publish leg — Template Developer*

1. [x] - `p1` - Template Developer declares AI extensions for the template against the closed-set extension contract, providing named typed entries for each category the template bundles (skills, workflows, guidelines, reference artifacts) - `inst-declare-extensions`
2. [x] - `p1` - **IF** any declared entry names a category outside the closed set or omits a required structural element for its slot - `inst-check-contract-shape`
   1. [x] - `p1` - Pre-publish validation reports a structural error identifying the non-conforming entry and the violated constraint - `inst-report-prepublish-error`
   2. [x] - `p1` - **RETURN** validation failure; the template is not published - `inst-return-prepublish-fail`
3. [x] - `p1` - Pre-publish validation confirms all declared extension entries conform to the closed-set contract - `inst-confirm-contract-conformance`
4. [x] - `p1` - Template Developer publishes the template to the source registry with the bundled AI-extension declaration included - `inst-publish-template`

*Install, discover, and activate leg — Project Developer*

5. [x] - `p1` - Project Developer applies the template into the project via the CLI (`cpt-frontx-feature-template-resolution`, `cpt-frontx-feature-cli-scaffolding`); as the CLI-owned materialization step that `apply` performs when this identity gains its first target, the assembler copies the template's `.frontx/ai/<template-identity>/` bundle from its payload into the scaffolded project at that identity-scoped path, so by the time this flow's discovery leg runs the bundle is present there — no CLI-to-Kit signal is sent (root DESIGN §3.4). This flow's discovery leg does not depend on that step's internals, only on the bundle's shape (§1.5) being present where the convention says to look - `inst-install-template`
6. [x] - `p1` - On its own next invocation the AI Tooling Framework's extension-host component (`cpt-frontx-component-ai-extension-host`, within the package anchor `cpt-frontx-component-ai-tooling-kit`) initiates extension discovery by scanning each `.frontx/ai/<template-identity>/` bundle under the scaffolded project's `.frontx/ai/`, invoking the contract scan algorithm parameterized by the closed-set extension contract - `inst-initiate-discovery`
7. [x] - `p1` - **FOR EACH** discovered identity's bundle, before scanning any of its slots, the extension host checks whether that identity is backed by a registered, pinned origin in the project's single state document, `.frontx/project.json` (`templates[name].origin`) — the fact that the bundle arrived through a legitimate `register`/`apply` operation rather than through content placed under `.frontx/ai/` by some other means - `inst-check-bundle-trust`
   1. [x] - `p1` - **IF** the identity carries no such registered, pinned origin entry - `inst-if-untrusted-identity`
      1. [x] - `p1` - Mark every entry in that identity's bundle DENIED, report the denial naming the identity to the Project Developer, and exclude the whole bundle from discovery; proceed to the next identity's bundle without scanning any of its slots - `inst-deny-untrusted-bundle`
8. [x] - `p1` - **FOR EACH** named typed slot in the closed-set contract (skills, workflows, guidelines, reference artifacts), for each identity's bundle that passed the trust check above - `inst-scan-each-slot`
   1. [x] - `p1` - Scan the installed template's declared extension bundle for entries targeting the current slot - `inst-scan-slot-entries`
   2. [x] - `p1` - **IF** a located entry does not conform structurally to the contract's entry shape — a declared identifier, its slot, and a resolvable path; the check is slot-generic, and per-slot format enforcement is recorded debt - `inst-check-slot-conformance`
      1. [x] - `p1` - Record a structural error for the non-conforming entry; mark the entry as REJECTED - `inst-record-structural-error`
   3. [x] - `p1` - **ELSE** add the conforming entry to the discovered set for the current slot - `inst-add-to-discovered`
9. [x] - `p1` - **IF** any structural errors were recorded during the scan - `inst-check-errors`
   1. [x] - `p1` - Report all structural errors to the Project Developer; no errored entry is included in activation - `inst-report-errors`
10. [x] - `p1` - Compose the discovered conforming entries with the base kit's capabilities under explicit precedence, as computed by `cpt-frontx-algo-template-ai-extensions-contract-scan-activate` - `inst-compose-under-precedence`
11. [x] - `p1` - Activate the composed capability set into the AI agent's visible capability surface with no manual wiring required from the Project Developer - `inst-activate-capabilities`
12. [x] - `p1` - **RETURN** the activated agent-visible capability set, now including the template-specific extensions alongside the base kit capabilities - `inst-return-activated`

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures that do not interact with actors directly.

### Extension Contract Scan and Activation

- [x] `p2` - **ID**: `cpt-frontx-algo-template-ai-extensions-contract-scan-activate`

**Input**: Installed template's declared AI-extension bundle; closed-set extension contract (skills, workflows, guidelines, reference artifacts as named typed slots); base kit's capability set; the project's single state document, `.frontx/project.json`, read for the bundle's template identity's registered, pinned `origin`

**Output**: Composed agent-visible capability set, a structural-error list for any non-conforming entries, and a denial list for any bundle excluded on trust grounds

**Steps**:
1. [x] - `p1` - Load the closed-set extension contract, enumerating all named typed slots: skills, workflows, guidelines, and reference artifacts - `inst-load-contract`
2. [x] - `p1` - Load the installed template's declared AI-extension bundle - `inst-load-bundle`
3. [x] - `p1` - Check whether the bundle's template identity is backed by a registered, pinned origin in the project's single state document, `.frontx/project.json` - `inst-check-identity-trust`
   1. [x] - `p1` - **IF** the identity carries no such registered, pinned origin entry - `inst-if-identity-untrusted`
      1. [x] - `p1` - Mark every entry in the bundle DENIED, append a denial to the denial list naming the identity and the reason — untrusted origin, distinct from a malformed-shape structural error — and **RETURN** the composed capability set unchanged by this bundle, the structural-error list, and the denial list - `inst-return-denied-bundle`
4. [x] - `p1` - Initialize an empty discovered-extensions map keyed by contract slot - `inst-init-discovered-map`
5. [x] - `p1` - Initialize an empty structural-error list - `inst-init-error-list`
6. [x] - `p1` - **FOR EACH** named typed slot defined by the closed-set contract - `inst-iterate-slots`
   1. [x] - `p1` - Identify all declared entries in the bundle that target the current slot - `inst-identify-slot-entries`
   2. [x] - `p1` - **FOR EACH** identified entry - `inst-validate-each-entry`
      1. [x] - `p1` - Validate the entry's structural shape against the contract's entry requirements — identifier, slot, and resolvable path; the validation is slot-generic, and enforcing each slot's own file-format shape is recorded debt - `inst-validate-entry-shape`
      2. [x] - `p1` - **IF** the entry is malformed or missing a required structural element - `inst-check-malformed`
         1. [x] - `p1` - Append a structural error to the error list, naming the slot and the offending entry - `inst-append-error`
         2. [x] - `p1` - **SKIP TO** the next entry; do not add to the discovered map - `inst-skip-malformed`
      3. [x] - `p1` - Add the conforming entry to the discovered-extensions map under the current slot - `inst-add-conforming`
7. [x] - `p1` - **IF** the structural-error list is non-empty - `inst-check-error-list`
   1. [x] - `p1` - Surface all structural errors; each errored entry is permanently excluded from the activation set - `inst-surface-errors`
8. [x] - `p1` - Compose the discovered-extensions map with the base kit's capability set under the explicit precedence rule (`target`): entries compose per named slot **and entry identifier** — entries with different identifiers coexist within a slot, a template-contributed entry supersedes the base-kit entry carrying the same identifier, and among entries from multiple installed templates sharing slot and identifier, the defined installation-order precedence determines the surviving entry - `inst-compose-precedence`
9. [x] - `p1` - **RETURN** the composed capability set, the structural-error list, and the denial list - `inst-return-result`

## 4. States (CDSL)

### AiExtension Lifecycle

- [x] `p2` - **ID**: `cpt-frontx-state-template-ai-extensions-extension-lifecycle`

**States**: BUNDLED, DENIED, DISCOVERED, VALIDATED, ACTIVATED, REJECTED

**Initial State**: BUNDLED

**Transitions**:
1. [x] - `p1` - **FROM** BUNDLED **TO** DENIED **WHEN** the bundle's template identity carries no registered, pinned origin in the project's single state document, `.frontx/project.json` — checked before any entry in the bundle is scanned, so an untrusted bundle never reaches DISCOVERED - `inst-trans-bundled-to-denied`
   1. [x] - `p1` - Report a denial to the Project Developer identifying the untrusted identity - `inst-action-report-denial`
2. [x] - `p1` - **FROM** BUNDLED **TO** DISCOVERED **WHEN** the bundle's template identity passes the trust check above and an entry is located for a named typed slot in the closed-set contract - `inst-trans-bundled-to-discovered`
3. [x] - `p1` - **FROM** DISCOVERED **TO** VALIDATED **WHEN** the entry's structural shape is confirmed to conform to the required elements for its slot - `inst-trans-discovered-to-validated`
4. [x] - `p1` - **FROM** DISCOVERED **TO** REJECTED **WHEN** the entry's structural shape is malformed or missing a required element for its slot - `inst-trans-discovered-to-rejected`
   1. [x] - `p1` - Report a structural error to the Project Developer identifying the slot and the non-conforming entry - `inst-action-report-rejection`
5. [x] - `p1` - **FROM** VALIDATED **TO** ACTIVATED **WHEN** the entry passes the contract scan — the lifecycle records activation at scan time, before precedence composition, so an entry later superseded during composition still reports ACTIVATED - `inst-trans-validated-to-activated`

## 5. Definitions of Done

### Closed-Set Contract and Generalized Discovery Activation

- [x] `p1` - **ID**: `cpt-frontx-dod-template-ai-extensions-contract-conformance`

The system **MUST** implement the closed-set extension contract (skills, workflows, guidelines, reference artifacts as named typed slots), the generalized scan parameterized by that contract, composition under explicit precedence, structural-error reporting for non-conforming entries, and the BUNDLED → DISCOVERED → VALIDATED → ACTIVATED / REJECTED lifecycle — realizing the sequence `cpt-frontx-seq-template-ai-extension-discovery-activation` as specified in the flow `cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate` and the algorithm `cpt-frontx-algo-template-ai-extensions-contract-scan-activate`. The system **MUST** additionally check, before scanning any bundle's slots, that the bundle's template identity is backed by a registered, pinned origin in the project's single state document, `.frontx/project.json`; an identity that fails this check transitions the bundle's entries to DENIED and excludes the whole bundle from activation, closing the PRD's trust-policy requirement that denied or untrusted capabilities **MUST NOT** activate (`cpt-frontx-fr-ai-extension-discovery-activation`).

**Implements**:
- `cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate`
- `cpt-frontx-algo-template-ai-extensions-contract-scan-activate`
- `cpt-frontx-seq-template-ai-extension-discovery-activation`

**Touches**:
- Entities: AiExtension

## 6. Acceptance Criteria

- [x] A Template Developer can declare AI extensions (skills, workflows, guidelines, reference artifacts) against the closed-set contract and pre-publish validation confirms conformance before the template is published.
- [x] Pre-publish validation rejects a template whose AI-extension declaration names a category outside the closed set or omits a required structural element for a slot, reporting the violation before publication.
- [x] Installing a conforming template in a project — the CLI's assembler materializing its `.frontx/ai/<template-identity>/` bundle from the template's payload as the CLI-owned step described in §1.5 — makes its declared AI extensions agent-visible with no manual configuration step required in the consuming project.
- [x] The materialized bundle tracks applied targets, not any write this feature performs itself: it is copied in on the `apply` that gives a template identity its first target, kept current on `upgrade`, and removed when `delete` removes that identity's last remaining target.
- [x] The discovery scan is parameterized over the closed-set extension contract: any conforming template's extensions are found by the same scan path regardless of the template's namespace identity.
- [x] When base kit capabilities and one or more installed-template extensions contribute entries for the same named slot, the composed result is deterministic and governed by the explicit precedence rule.
- [x] A malformed extension entry (missing required element, unrecognized category name) is reported as a structural error and is not activated; conforming entries from the same bundle are not affected by the rejection.
- [x] An AiExtension follows the lifecycle BUNDLED → DISCOVERED → VALIDATED → ACTIVATED; a non-conforming entry transitions to REJECTED instead of ACTIVATED, and no REJECTED entry is present in the activated capability set.
- [x] A discovered bundle whose template identity is not backed by a registered, pinned origin record in the project's single state document, `.frontx/project.json`, transitions to DENIED before any of its slots are scanned, is reported to the Project Developer naming the untrusted identity, and no entry from that bundle is present in the activated capability set — distinct from a structurally REJECTED entry.
