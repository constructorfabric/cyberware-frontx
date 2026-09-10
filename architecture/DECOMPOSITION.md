# Decomposition: FrontX Ecosystem

<!-- toc -->

- [1. Overview](#1-overview)
- [2. Entries](#2-entries)
  - [2.1 Opaque Type-Substrate Port - HIGH](#21-opaque-type-substrate-port---high)
  - [2.2 MFE Registry & Handler Resolution - HIGH](#22-mfe-registry--handler-resolution---high)
  - [2.3 GTS Default Type-System Provider - HIGH](#23-gts-default-type-system-provider---high)
  - [2.4 MFE Discovery & Lazy-Import Loading - HIGH](#24-mfe-discovery--lazy-import-loading---high)
  - [2.5 Host–MFE Communication: Actions-Chains Mediator & Parent–Child Bridge - HIGH](#25-hostmfe-communication-actions-chains-mediator--parentchild-bridge---high)
  - [2.6 Extension-Domain Governance: Mount Strategies, Cardinality & Contract Matching - HIGH](#26-extension-domain-governance-mount-strategies-cardinality--contract-matching---high)
  - [2.7 MFE Runtime Isolation - HIGH](#27-mfe-runtime-isolation---high)
  - [2.8 API Protocol Surface - MEDIUM](#28-api-protocol-surface---medium)
  - [2.9 Ecosystem Distribution & Versioning Policy - MEDIUM](#29-ecosystem-distribution--versioning-policy---medium)
  - [2.10 Template Externalization & Source-Spec Resolution - HIGH](#210-template-externalization--source-spec-resolution---high)
  - [2.11 Template Manifest Contract & Pre-Publish Validation - HIGH](#211-template-manifest-contract--pre-publish-validation---high)
  - [2.12 Kindless Template Assembly & Conflict-Checked Composition - HIGH](#212-kindless-template-assembly--conflict-checked-composition---high)
  - [2.13 Project State, Registration & Ownership Management - HIGH](#213-project-state-registration--ownership-management---high)
  - [2.14 Upgrade Change-Set Engine - HIGH](#214-upgrade-change-set-engine---high)
  - [2.15 AI Tooling Kit Packaging & Base Content - HIGH](#215-ai-tooling-kit-packaging--base-content---high)
  - [2.16 Template AI-Extension Contract & Discovery/Activation - HIGH](#216-template-ai-extension-contract--discoveryactivation---high)
  - [2.17 AI-Driven Upgrade Orchestration - HIGH](#217-ai-driven-upgrade-orchestration---high)
  - [2.18 CLI Executable Invocation Surface - HIGH](#218-cli-executable-invocation-surface---high)
  - [2.19 Ecosystem Layer-Partition Governance - MEDIUM](#219-ecosystem-layer-partition-governance---medium)
  - [2.20 Telemetry SDK Compatibility Anchor - MEDIUM](#220-telemetry-sdk-compatibility-anchor---medium)
  - [2.21 AI-Driven Project Scaffolding from Intent - HIGH](#221-ai-driven-project-scaffolding-from-intent---high)
  - [2.22 Template Territory Conversion to the Registration Contract - HIGH](#222-template-territory-conversion-to-the-registration-contract---high)
  - [2.23 Identifier Rename Wave for Names That Misstate Their Scope - LOW](#223-identifier-rename-wave-for-names-that-misstate-their-scope---low)
- [3. Feature Dependencies](#3-feature-dependencies)
- [4. Known Validator Debt](#4-known-validator-debt)

<!-- /toc -->

## 1. Overview

This decomposition contains root-owned work packages plus temporary compatibility anchors required by the installed SDLC kit.

The root owns two behaviors:

- Ecosystem distribution and versioning policy.
- Ecosystem layer-partition governance.

The installed SDLC kit currently defines feature-entry identifiers only in DECOMPOSITION and routes DESIGN coverage through DECOMPOSITION. Compatibility anchors below are therefore limited to feature IDs, member owner pointers and compact ID-only coverage references for member-owned components, constraints and principles; this document carries no central index of member-owned detail.

## 2. Entries

**Overall implementation status:**

- [ ] `p1` - **ID**: `cpt-frontx-status-overall`

### 2.1 [Opaque Type-Substrate Port](../packages/mfes/architecture/features/type-substrate-port/) - HIGH

- [ ] `p1` - **ID**: `cpt-frontx-feature-type-substrate-port`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/mfes/architecture/features/type-substrate-port/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-mfes-principle-opaque-substrate-vocabulary`

### 2.2 [MFE Registry & Handler Resolution](../packages/mfes/architecture/features/mfe-registry/) - HIGH

- [ ] `p1` - **ID**: `cpt-frontx-feature-mfe-registry`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/mfes/architecture/features/mfe-registry/FEATURE.md).

### 2.3 [GTS Default Type-System Provider](../packages/gts-plugin/architecture/features/gts-type-provider/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-gts-type-provider`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/gts-plugin/architecture/features/gts-type-provider/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-gts-plugin-principle-format-confinement`

### 2.4 [MFE Discovery & Lazy-Import Loading](../packages/mfes/architecture/features/mfe-loading/) - HIGH

- [ ] `p1` - **ID**: `cpt-frontx-feature-mfe-loading`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/mfes/architecture/features/mfe-loading/FEATURE.md).

### 2.5 [Host–MFE Communication: Actions-Chains Mediator & Parent–Child Bridge](../packages/mfes/architecture/features/mfe-host-communication/) - HIGH

- [ ] `p1` - **ID**: `cpt-frontx-feature-mfe-host-communication`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/mfes/architecture/features/mfe-host-communication/FEATURE.md).

### 2.6 [Extension-Domain Governance: Mount Strategies, Cardinality & Contract Matching](../packages/mfes/architecture/features/extension-domain-governance/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-extension-domain-governance`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/mfes/architecture/features/extension-domain-governance/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-principle-default-deny-admission`
- `cpt-frontx-constraint-mfes-no-layout-domain-values`

### 2.7 [MFE Runtime Isolation](../packages/mfes/architecture/features/mfe-isolation/) - HIGH

- [ ] `p1` - **ID**: `cpt-frontx-feature-mfe-isolation`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/mfes/architecture/features/mfe-isolation/FEATURE.md).

### 2.8 [API Protocol Surface](../packages/api/architecture/features/api-protocol-surface/) - MEDIUM

- [x] `p2` - **ID**: `cpt-frontx-feature-api-protocol-surface`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/api/architecture/features/api-protocol-surface/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-api-surface`
- `cpt-frontx-constraint-api-no-solution-content`
- `cpt-frontx-api-principle-solution-behavior-via-plugins`

### 2.9 [Ecosystem Distribution & Versioning Policy](./features/ecosystem-distribution/) - MEDIUM

- [x] `p2` - **ID**: `cpt-frontx-feature-ecosystem-distribution`

**Purpose**: Define and enforce the ecosystem-wide publication and compatibility policy for independently versioned published members.

**Depends On**: None

**Scope**:
- Independent version lines for published members.
- Compatibility expectations for consuming projects.
- Package-registry distribution rules.
- Deprecation discipline before removals.

**Out of scope**:
- Member public APIs and member internals.
- Template resolution, scaffolding or upgrade behavior.
- Member artifact-chain accounting.

**Requirements Covered**:
- [x] `p1` - `cpt-frontx-fr-versioned-platform-evolution`
- [x] `p2` - `cpt-frontx-fr-no-architectural-ceiling`
- [x] `p1` - `cpt-frontx-nfr-evolvability`
- [x] `p1` - `cpt-frontx-nfr-scalability-ceiling`

**Design Principles Covered**:
- [x] `p2` - `cpt-frontx-principle-per-concern-versioning`

**Design Components**:
- [x] `p2` - `cpt-frontx-component-ecosystem-version-policy`

**API / Contracts**:
- `cpt-frontx-contract-package-registry-distribution`
- `cpt-frontx-interface-package-registry-distribution`

### 2.10 [Template Externalization & Source-Spec Resolution](../packages/cli/architecture/features/template-resolution/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-template-resolution`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/template-resolution/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-cli-template-resolver`
- `cpt-frontx-constraint-cli-template-independence`
- `cpt-frontx-constraint-cli-shared-resolver`
- `cpt-frontx-principle-template-agnostic-tooling`

### 2.11 [Template Manifest Contract & Pre-Publish Validation](../packages/cli/architecture/features/template-manifest/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-template-manifest`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/template-manifest/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-cli-prepublish-validator`

### 2.12 [Kindless Template Assembly & Conflict-Checked Composition](../packages/cli/architecture/features/cli-scaffolding/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-cli-scaffolding`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/cli-scaffolding/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-constraint-cli-platform-path-identity`

### 2.13 [Project State, Registration & Ownership Management](../packages/cli/architecture/features/composed-provenance/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-composed-provenance`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/composed-provenance/FEATURE.md).

### 2.14 [Upgrade Change-Set Engine](../packages/cli/architecture/features/upgrade-changeset/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-upgrade-changeset`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/upgrade-changeset/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-cli-principle-reviewed-reversible-mutation`

### 2.15 [AI Tooling Kit Packaging & Base Content](../packages/cyber-pilot-kit-frontx/architecture/features/ai-kit-packaging/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-ai-kit-packaging`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cyber-pilot-kit-frontx/architecture/features/ai-kit-packaging/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-ai-tooling-kit`
- `cpt-frontx-component-ai-base-kit`
- `cpt-frontx-constraint-kit-prefixed-resource-ids`
- `cpt-frontx-constraint-kit-zero-solution-content`
- `cpt-frontx-cyber-pilot-kit-frontx-principle-surface-only-integration`

### 2.16 [Template AI-Extension Contract & Discovery/Activation](../packages/cyber-pilot-kit-frontx/architecture/features/template-ai-extensions/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-template-ai-extensions`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cyber-pilot-kit-frontx/architecture/features/template-ai-extensions/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-ai-extension-host`
- `cpt-frontx-constraint-kit-declared-skill-rule-resources`

### 2.17 [AI-Driven Upgrade Orchestration](../packages/cyber-pilot-kit-frontx/architecture/features/ai-upgrade-orchestration/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-ai-upgrade-orchestration`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cyber-pilot-kit-frontx/architecture/features/ai-upgrade-orchestration/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-ai-upgrade-orchestration`
- `cpt-frontx-constraint-kit-orchestrates-not-reimplements`

### 2.18 [CLI Executable Invocation Surface](../packages/cli/architecture/features/cli-invocation/) - HIGH

- [x] `p1` - **ID**: `cpt-frontx-feature-cli-invocation`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/cli-invocation/FEATURE.md).

### 2.19 [Ecosystem Layer-Partition Governance](./features/ecosystem-governance/) - MEDIUM

- [ ] `p1` - **ID**: `cpt-frontx-feature-ecosystem-governance`

**Purpose**: Account for layer membership and member artifact ownership so a new FrontX-owned package cannot bypass classification or artifact-chain visibility.

**Depends On**: None

**Scope**:
- Workspace package classification into a layer or explicit non-layer category.
- Member artifact-chain accounting through enforced registration or path-scoped debt.
- CI-facing reporting for missing classification or missing accounting.

**Out of scope**:
- Template-manifest classification outside this repository.
- Citation-direction enforcement beyond review-held documentation.
- The version-policy check, owned by ecosystem distribution.
- Member internals or member acceptance evidence.

**Requirements Covered**:
- [x] `p1` - `cpt-frontx-fr-layer-member-governance`

**Design Principles Covered**:
- [ ] `p2` - `cpt-frontx-principle-federated-artifacts`
- [ ] `p2` - `cpt-frontx-principle-property-based-membership`

**Design Constraints Covered**:
- [x] `p2` - `cpt-frontx-constraint-layer-total-classification`
- [x] `p2` - `cpt-frontx-constraint-member-artifact-chain`
- [x] `p2` - `cpt-frontx-constraint-root-cites-no-member`
- [ ] `p2` - `cpt-frontx-constraint-validator-warning-debt`

**Design Components**:
- [x] `p2` - `cpt-frontx-component-ecosystem-governance-guard`

**Sequences**:
- [ ] `p2` - `cpt-frontx-seq-member-admission-accounting`

### 2.20 [Telemetry SDK Compatibility Anchor](../packages/telemetry/architecture/) - MEDIUM

- [ ] `p2` - **ID**: `cpt-frontx-feature-telemetry-sdk`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [DESIGN.md](../packages/telemetry/architecture/DESIGN.md) and member FEATURE files.

**Installed-kit coverage references**:
- `cpt-frontx-telemetry-component-client`
- `cpt-frontx-telemetry-component-events-manager`
- `cpt-frontx-telemetry-component-session-manager`
- `cpt-frontx-telemetry-component-user-info-manager`
- `cpt-frontx-telemetry-component-plugins-manager`
- `cpt-frontx-telemetry-component-builtin-plugins`
- `cpt-frontx-telemetry-component-autocapture`
- `cpt-frontx-telemetry-constraint-standalone-boundary`
- `cpt-frontx-telemetry-constraint-browser-runtime`
- `cpt-frontx-telemetry-constraint-external-record-schema`
- `cpt-frontx-telemetry-constraint-reserved-plugin-names`
- `cpt-frontx-telemetry-principle-enrichment-via-plugins`
- `cpt-frontx-telemetry-principle-collection-delivery-separation`
- `cpt-frontx-telemetry-principle-untrusted-extensions`
- `cpt-frontx-telemetry-principle-sdk-owned-identity`
- `cpt-frontx-telemetry-principle-additive-cross-version`

### 2.21 [AI-Driven Project Scaffolding from Intent](../packages/cyber-pilot-kit-frontx/architecture/features/ai-project-scaffolding/) - HIGH

<!-- The [x] below is the cfs coverage rollup - this entry's references resolve
     and its coverage holds - and NOT a claim that the feature is implemented.
     Its FEATURE's own featstatus (`cpt-frontx-featstatus-ai-project-
     scaffolding`) is unchecked and governs implementation status: both entry
     points ship as documents rather than compiled modules, so no code marker
     pairs with their CDSL instructions and none may be checked. -->
- [x] `p1` - **ID**: `cpt-frontx-feature-ai-project-scaffolding`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cyber-pilot-kit-frontx/architecture/features/ai-project-scaffolding/FEATURE.md).

### 2.22 Template Territory Conversion to the Registration Contract - HIGH

- [ ] `p2` - **ID**: `cpt-frontx-feature-template-territory-conversion`

**Purpose**: Convert the ecosystem's own pre-existing templates (`template-shell`, `template-mfe`) from their legacy manifest shape onto the current four-field registration contract, so both become installable, registrable, and applicable under `cpt-frontx-adr-template-manifest-contract`, `cpt-frontx-adr-template-ownership-boundary-declaration`, and `cpt-frontx-adr-project-provenance-record` by direct conversion at the source rather than by relying on any runtime compatibility path. Until this conversion completes, zero templates in this repository are installable under the current contract — a legacy manifest carrying a retired field is refused at `install` itself, the earliest gate, not merely at `register`.

**Depends On**: `cpt-frontx-feature-template-manifest` (F11 — the four-field manifest contract both templates convert onto)

**Scope** — five concrete changes, across both templates:

1. Replace each legacy manifest (`schemaVersion` + `ownershipBoundaries`) with the current four-field shape: `name`, `version`, a required non-empty `description`, and `excludedSubtrees`.
2. Widen `template-shell`'s ownership from its current file-subset claim to whole-target ownership (its target minus its declared `excludedSubtrees`) — extending what it owns, or moving root files it does not claim into `projectOwnedRoots`. This is a **behavioural change requiring its own review**, not a mechanical manifest edit, and is tracked here rather than folded into item 1.
3. Remove both templates' own claim on `.frontx/ai/<manifest-name>/`; that bundle is a CLI-owned write (`cpt-frontx-adr-template-ownership-boundary-declaration`), never template-owned.
4. Add `src-app/mfe_packages/` to `template-shell`'s `excludedSubtrees` (a well-formed target-relative directory path with the trailing `/` the manifest schema requires — `cpt-frontx-feature-template-manifest` owns that field-level rule, which `cpt-frontx-adr-template-manifest-contract` deliberately leaves to it) and stop carrying payload inside it.
5. Extract each template's authoring/dev-harness machinery (a dev-only `package.json` with `file:` overrides, local build tooling) out of the template directory entirely, leaving pure payload plus the manifest and the conventional AI-extension bundle (`cpt-frontx-adr-template-manifest-contract`, "More Information").

A registered name using `/` as a path-segment separator (an npm-scoped name, as both templates already use) is valid under the bundle-root prefix-uniqueness and non-empty-segment invariants `cpt-frontx-adr-template-manifest-contract` fixes for `name`.

**Out of scope**: Any change to the registration contract, the conflict-checker geometry, or any other ecosystem template; this entry converts exactly the two named templates. A third, `template-design-guardrails`, arrived after this entry was written and carried the same retired manifest shape; its manifest was converted on arrival (items 1 and 3 only — it widens no ownership, reserves no nested ground, and ships no dev harness inside its own directory), so it needs nothing further from this entry. Also out of scope, and called out because completing this entry does not remove it: **publishing these two templates anywhere outside this repository**. Until that happens the CLI's built-in official defaults are generated as local `path:` origins resolvable only against this checkout, so a CLI published from here reports an empty `defaults` set in any other project and `seed`, which accepts official defaults and nothing else, does not work outside this checkout at all. The direction is known — the templates are to move to a repository of their own — and only the destination and the timing are not; that move is a separate future work item, not scoped or scheduled by this entry. A reader finishing this conversion should not expect `seed` to become usable elsewhere as a result.

**Note**: Template territory — the directories these manifests live in — sits outside this repository's `@cpt-` traceability chain (`cpt-frontx-adr-template-territory-traceability`); this entry is therefore a coordination work item tracking the conversion's completion, not a compatibility anchor into member architecture the way §2.10–§2.18 are.

### 2.23 Identifier Rename Wave for Names That Misstate Their Scope - LOW

- [ ] `p3` - **ID**: `cpt-frontx-feature-identifier-rename-wave`

**Purpose**: Rename four identifiers (one with its folder) whose literal names describe a narrower or different scope than the thing they name actually has, consolidating the "pending follow-up" notes carried in their own isolated locations into one tracked work item, per the precedent §2.22 sets for tracking a rename wave rather than scattering follow-up prose across unrelated sections.

**Depends On**: None — a pure identifier/folder rename with no behavioral, contract, or schema change.

**Scope** — four renames:

1. `cpt-frontx-feature-composed-provenance` (and its folder, `packages/cli/architecture/features/composed-provenance/`) — the name and folder describe transitive preset ("composed") resolution and a per-applied-template provenance record, neither of which exists in this model; its scope is the single project-state document, registration, and ownership management (`cpt-frontx-feature-composed-provenance/FEATURE.md` §1.1).
2. `cpt-frontx-component-cli-provenance-recorder` — [CLI DESIGN §4](../packages/cli/architecture/DESIGN.md) calls it the "CLI Project State Store" in prose; the identifier itself names a per-instance provenance-record role the component does not have.
3. `cpt-frontx-constraint-cli-per-template-provenance` — its name asserts a per-template provenance record; the constraint it actually fixes is the opposite, a single document shared across every template ([CLI DESIGN §3.1](../packages/cli/architecture/DESIGN.md)).
4. `cpt-frontx-feature-upgrade-changeset` — its name names only the changeset half of what this feature owns; `cpt-frontx-adr-project-upgrade-mechanism` fixes that the feature also owns the one-generation reversal (restore) path, a scope its name does not capture.

**Out of scope**: Any change to behavior, contract, or schema — renames only.

**Note**: Consolidates the "pending follow-up" notes at [composed-provenance/FEATURE.md §1.1](../packages/cli/architecture/features/composed-provenance/FEATURE.md), [CLI DESIGN §3.1](../packages/cli/architecture/DESIGN.md) (Domain Model table), and [CLI DESIGN §3.4](../packages/cli/architecture/DESIGN.md) (Applicability) into this one tracked item. Like §2.22, this is a coordination work item over identifier hygiene, not a compatibility anchor into member architecture the way §2.10–§2.18 are.

## 3. Feature Dependencies

```text
F1 ecosystem-distribution        (foundation)
F2 type-substrate-port           (foundation)
   ├─→ F3 gts-type-provider
   └─→ F4 mfe-registry
          ├─→ F5 mfe-loading ──────────────┐
          ├─→ F6 mfe-host-communication     │
          ├─→ F7 extension-domain-governance (also ← F3)
          └─→ F8 mfe-isolation ←────────────┘ (← F5)
F9 api-protocol-surface          (foundation, standalone)
F10 template-resolution          (foundation)
   ├─→ F11 template-manifest
   ├─→ F13a composed-provenance (the project-state document's schema and its read/write primitives)
   │      └─→ F12 cli-scaffolding ──┬─→ F13b composed-provenance (`ownership add|remove|list`, `validate --project`)
   │                                └─→ F14 upgrade-changeset
   └─→ F16 template-ai-extensions (also ← F15)
F15 ai-kit-packaging             (foundation)
   ├─→ F16 template-ai-extensions
   └─→ F17 ai-upgrade-orchestration (also ← F14)
F18 cli-invocation               (aggregator ← F10, F11, F12, F13, F14 — dispatches to each)
F19 ecosystem-governance         (foundation, standalone)
F20 ai-project-scaffolding       (← F10, F11, F12, F13, F15, F16)
F21 telemetry-sdk                (foundation, standalone)
F22 template-territory-conversion (← F11)
F23 identifier-rename-wave       (foundation, standalone)
```

**Dependency Rationale**:

- `cpt-frontx-feature-gts-type-provider` requires `cpt-frontx-feature-type-substrate-port`: the GTS provider implements the opaque type-substrate port the runtime defines.
- `cpt-frontx-feature-mfe-registry` requires `cpt-frontx-feature-type-substrate-port`: the registry façade is built with the type-system provider injected through the port contract.
- `cpt-frontx-feature-mfe-loading` requires `cpt-frontx-feature-mfe-registry`: on-demand loading is orchestrated from the registry.
- `cpt-frontx-feature-mfe-host-communication` requires `cpt-frontx-feature-mfe-registry`: the capability bridge delegates to the registry.
- `cpt-frontx-feature-extension-domain-governance` requires `cpt-frontx-feature-mfe-registry`: admission and mount strategies act on registry-resolved extensions.
- `cpt-frontx-feature-extension-domain-governance` requires `cpt-frontx-feature-gts-type-provider`: action–behavior consistency validation at admission uses type-of resolution from the provider.
- `cpt-frontx-feature-mfe-isolation` requires `cpt-frontx-feature-mfe-registry`: isolated mounts are driven by the registry's load orchestration.
- `cpt-frontx-feature-mfe-isolation` requires `cpt-frontx-feature-mfe-loading`: isolation wraps the load execution path.
- `cpt-frontx-feature-template-manifest` requires `cpt-frontx-feature-template-resolution`: the manifest is read at install/scaffold through the resolver.
- `cpt-frontx-feature-cli-scaffolding` requires `cpt-frontx-feature-template-resolution`: scaffolding consumes templates from the resolved inventory.
- `cpt-frontx-feature-composed-provenance` requires `cpt-frontx-feature-cli-scaffolding`: this FEATURE owns the single project-state document (`.frontx/project.json`) that scaffolding/apply reads and writes at materialization time (`cpt-frontx-adr-project-provenance-record`).
- `cpt-frontx-feature-composed-provenance` requires `cpt-frontx-feature-template-resolution`: template registration (register/install) resolves through the same shared resolver, and the project-state store records the pinned origin it returns (`cpt-frontx-adr-source-spec-syntax`).
- `cpt-frontx-feature-cli-scaffolding` also requires `cpt-frontx-feature-composed-provenance`: the conflict checker's geometry check — run by `assemble`, `apply`, `delete`, and `ownership add|remove` alike — reads already-applied `targets[]` and `projectOwnedRoots` out of the single project-state document `composed-provenance` owns. Read together with the `composed-provenance` → `cli-scaffolding` edge above, the two look mutually dependent, and an earlier revision of this section recorded them that way. They are not: the edge runs between SLICES of F13, not between whole features, and stating the slices restores an executable order. F13a — the project-state document's schema and the primitives that read and write it — depends on nothing in F12 and ships first. F12's conflict checker and assembler consume F13a. F13b — `ownership add|remove|list` and `validate --project`, the only parts of F13 that need the conflict checker's geometry — consumes F12. F13a → F12 → F13b is a directed acyclic order, and it is the order the work actually took. The concrete component-level structure behind it — which component reads, which writes, and when — is owned by the [CLI's member DESIGN §3.2](../packages/cli/architecture/DESIGN.md#32-component-model) (CLI Conflict Checker and CLI Project State Store).
- `cpt-frontx-feature-upgrade-changeset` requires `cpt-frontx-feature-composed-provenance`: the change-set diffs against the `templates[name] = {origin, version, targets[]}` entry in the single project-state document this FEATURE owns, not a per-instance provenance record; the unit of upgrade is the whole template name — all of its targets — applied atomically (`cpt-frontx-adr-project-upgrade-mechanism`).
- `cpt-frontx-feature-upgrade-changeset` also requires `cpt-frontx-feature-cli-scaffolding`: the engine applies an approved transition within each target's effective ownership, reusing the Conflict Checker's canonicalized geometry (`cpt-frontx-algo-cli-scaffolding-conflict-check`) rather than redefining it — the same reuse `composed-provenance` already cites for `ownership add` and `validate --project` above (§3, F12 ← F13 rationale).
- `cpt-frontx-feature-template-ai-extensions` requires `cpt-frontx-feature-ai-kit-packaging`: extensions activate into the base kit's capability set.
- `cpt-frontx-feature-template-ai-extensions` requires `cpt-frontx-feature-template-resolution`: discovery is triggered on template install (cross-package edge F16 ← F10).
- `cpt-frontx-feature-ai-upgrade-orchestration` requires `cpt-frontx-feature-upgrade-changeset`: orchestration drives the single CLI change-set engine (cross-package edge F17 ← F14).
- `cpt-frontx-feature-ai-upgrade-orchestration` requires `cpt-frontx-feature-ai-kit-packaging`: the orchestration workflow ships inside the base AI kit.
- `cpt-frontx-feature-cli-invocation` requires `cpt-frontx-feature-template-resolution`, `cpt-frontx-feature-template-manifest`, `cpt-frontx-feature-cli-scaffolding`, `cpt-frontx-feature-composed-provenance`, and `cpt-frontx-feature-upgrade-changeset`: the invocation surface is the cross-command aggregator that dispatches `frontx <command>` to each owning behavior; it sits above them in the graph and none depend back on it.
- `cpt-frontx-feature-ai-project-scaffolding` requires `cpt-frontx-feature-ai-kit-packaging` (its entry points ship in the base kit), `cpt-frontx-feature-template-manifest` (selection matches intent against manifest-declared descriptions), `cpt-frontx-feature-template-resolution` (the local inventory it selects over), `cpt-frontx-feature-cli-scaffolding` (the seed/add assembly it drives over the command surface), `cpt-frontx-feature-composed-provenance` (the applied set is reported from the single project-state document's `templates[name].targets`), and `cpt-frontx-feature-template-ai-extensions` (per-unit realization drives the applied templates' activated extension skills).
- `cpt-frontx-feature-telemetry-sdk` has no feature-level dependency: the package imports no other package in this ecosystem (`cpt-frontx-telemetry-constraint-standalone-boundary`), so it stands alone in the graph like `cpt-frontx-feature-ecosystem-distribution` and `cpt-frontx-feature-ecosystem-governance`.
- `cpt-frontx-feature-template-territory-conversion` requires `cpt-frontx-feature-template-manifest`: the conversion moves both legacy templates (`template-shell`, `template-mfe`) onto the four-field manifest contract F11 fixes; it is a coordination work item over template territory rather than a member-owned anchor (`cpt-frontx-adr-template-territory-traceability`), so it depends on F11 only and carries no dependents of its own in this graph.
- `cpt-frontx-feature-identifier-rename-wave` has no feature-level dependency: it renames four identifiers (and one folder) whose current owners are already fixed by `cpt-frontx-feature-composed-provenance` (F13) and `cpt-frontx-feature-upgrade-changeset` (F14); the rename touches only how those two FEATUREs and their components are cited, not what they do, so it stands alone in the graph like `cpt-frontx-feature-telemetry-sdk` above.

## 4. Known Validator Debt

The installed SDLC kit requires feature-entry definitions in root DECOMPOSITION and routes DESIGN coverage through DECOMPOSITION. The member compatibility anchors in this file are limited to feature IDs, owner pointers and compact ID-only component/constraint/principle coverage references; member purpose, scope, requirements, prose, flows, dependencies, algorithms, acceptance criteria and design decisions remain owned by member FEATURE and DESIGN files.

This debt is removable when the upstream or project-installed SDLC kit supports member-scoped DECOMPOSITION coverage and member-owned FEATURE identity.

Root requirement `cpt-frontx-fr-ui-framework-agnostic` (PRD:177) is realized through member-owned core-package boundaries (`cpt-frontx-adr-core-package-boundaries`) and is tracked in the MFE Runtime's own FEATURE-level requirements coverage, not in this file: compatibility anchors 2.1–2.7 carry no `Requirements Covered` field by convention (ID, Owner and optional Installed-kit coverage references only, matching every other member-owned anchor in this file), so this FR has no DECOMPOSITION-level coverage line. This is recorded here as debt rather than silently omitted; it is removable when the anchor convention is extended to carry a `Requirements Covered` field, or when the owning member FEATURE cites this root FR ID directly.
