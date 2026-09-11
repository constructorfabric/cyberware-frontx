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
  - [2.13 Preset Resolution & Per-Applied-Template Provenance - HIGH](#213-preset-resolution--per-applied-template-provenance---high)
  - [2.14 Upgrade Change-Set Engine - HIGH](#214-upgrade-change-set-engine---high)
  - [2.15 AI Tooling Kit Packaging & Base Content - HIGH](#215-ai-tooling-kit-packaging--base-content---high)
  - [2.16 Template AI-Extension Contract & Discovery/Activation - HIGH](#216-template-ai-extension-contract--discoveryactivation---high)
  - [2.17 AI-Driven Upgrade Orchestration - HIGH](#217-ai-driven-upgrade-orchestration---high)
  - [2.18 CLI Executable Invocation Surface - HIGH](#218-cli-executable-invocation-surface---high)
  - [2.19 Ecosystem Layer-Partition Governance - MEDIUM](#219-ecosystem-layer-partition-governance---medium)
  - [2.20 Telemetry SDK Compatibility Anchor - MEDIUM](#220-telemetry-sdk-compatibility-anchor---medium)
  - [2.21 AI-Driven Project Scaffolding from Intent - HIGH](#221-ai-driven-project-scaffolding-from-intent---high)
  - [2.22 Routing Navigation Substrate - MEDIUM](#222-routing-navigation-substrate---medium)
  - [2.23 Routing Route Ownership Signal - MEDIUM](#223-routing-route-ownership-signal---medium)
  - [2.24 Routing Engine Provider - MEDIUM](#224-routing-engine-provider---medium)
- [3. Feature Dependencies](#3-feature-dependencies)
- [4. Known Validator Debt](#4-known-validator-debt)

<!-- /toc -->

## 1. Overview

This decomposition contains root-owned work packages plus temporary compatibility anchors required by the installed SDLC kit.

The root owns two behaviors:

- Ecosystem distribution and versioning policy.
- Ecosystem layer-partition governance.

The installed SDLC kit currently defines feature-entry identifiers only in DECOMPOSITION and routes DESIGN coverage through DECOMPOSITION. Compatibility anchors below are therefore limited to feature IDs, member owner pointers and compact ID-only coverage references for member-owned components, constraints and principles; the previous central member-detail index remains removed.

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

- [ ] `p1` - **ID**: `cpt-frontx-feature-template-resolution`

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

- [ ] `p1` - **ID**: `cpt-frontx-feature-cli-scaffolding`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/cli-scaffolding/FEATURE.md).

### 2.13 [Preset Resolution & Per-Applied-Template Provenance](../packages/cli/architecture/features/composed-provenance/) - HIGH

- [ ] `p1` - **ID**: `cpt-frontx-feature-composed-provenance`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/cli/architecture/features/composed-provenance/FEATURE.md).

### 2.14 [Upgrade Change-Set Engine](../packages/cli/architecture/features/upgrade-changeset/) - HIGH

- [ ] `p1` - **ID**: `cpt-frontx-feature-upgrade-changeset`

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

**Design Constraints Covered**:
- [x] `p2` - `cpt-frontx-constraint-layer-total-classification`
- [x] `p2` - `cpt-frontx-constraint-member-artifact-chain`
- [x] `p2` - `cpt-frontx-constraint-root-cites-no-member`

**Design Components**:
- [x] `p2` - `cpt-frontx-component-ecosystem-governance-guard`

**Sequences**:
- [ ] `p2` - `cpt-frontx-seq-member-admission-accounting`

### 2.20 [Telemetry SDK Compatibility Anchor](../packages/telemetry/architecture/) - MEDIUM

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

### 2.22 [Routing Navigation Substrate](../packages/routing/architecture/features/navigation-substrate/) - MEDIUM

- [ ] `p2` - **ID**: `cpt-frontx-feature-routing-navigation-substrate`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/routing/architecture/features/navigation-substrate/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-routing-navigation-substrate`
- `cpt-frontx-routing-principle-single-history-authority`
- `cpt-frontx-constraint-routing-no-intra-ecosystem-dependency`

### 2.23 [Routing Route Ownership Signal](../packages/routing/architecture/features/route-ownership-signal/) - MEDIUM

- [ ] `p2` - **ID**: `cpt-frontx-feature-routing-route-ownership-signal`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/routing/architecture/features/route-ownership-signal/FEATURE.md).

**Installed-kit coverage references**:
- `cpt-frontx-component-routing-screen-binding`
- `cpt-frontx-routing-principle-publishes-not-orchestrates`
- `cpt-frontx-constraint-routing-no-intra-ecosystem-dependency`

### 2.24 [Routing Engine Provider](../packages/routing-tanstack/architecture/features/engine-provider/) - MEDIUM

- [ ] `p2` - **ID**: `cpt-frontx-feature-routing-engine-provider`

**Owner**: Member-owned compatibility anchor only; behavior is defined in [FEATURE.md](../packages/routing-tanstack/architecture/features/engine-provider/FEATURE.md). This feature lives in the separately published `@gears-frontx/routing-tanstack`, under the package split recorded in `cpt-frontx-adr-core-package-boundaries`.

**Installed-kit coverage references**:
- `cpt-frontx-component-routing-engine-provider`
- `cpt-frontx-routing-tanstack-principle-engine-confined`
- `cpt-frontx-constraint-routing-tanstack-sole-engine-import`

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
   ├─→ F12 cli-scaffolding ──→ F13 composed-provenance ──→ F14 upgrade-changeset
   └─→ F16 template-ai-extensions (also ← F15)
F15 ai-kit-packaging             (foundation)
   ├─→ F16 template-ai-extensions
   └─→ F17 ai-upgrade-orchestration (also ← F14)
F18 cli-invocation               (aggregator ← F10, F11, F12, F13, F14 — dispatches to each)
F19 ecosystem-governance         (foundation, standalone)
F20 ai-project-scaffolding       (← F10, F11, F12, F13, F15, F16)
F21 routing-navigation-substrate (foundation, standalone)
   ├─→ F22 routing-route-ownership-signal
   └─→ F23 routing-engine-provider (cross-package: routing-tanstack ← routing)
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
- `cpt-frontx-feature-composed-provenance` requires `cpt-frontx-feature-cli-scaffolding`: composition extends the scaffolding path.
- `cpt-frontx-feature-composed-provenance` requires `cpt-frontx-feature-template-resolution`: recursive composition resolves each composed template through the shared resolver.
- `cpt-frontx-feature-upgrade-changeset` requires `cpt-frontx-feature-composed-provenance`: the change-set diffs against the provenance record written at scaffold time.
- `cpt-frontx-feature-template-ai-extensions` requires `cpt-frontx-feature-ai-kit-packaging`: extensions activate into the base kit's capability set.
- `cpt-frontx-feature-template-ai-extensions` requires `cpt-frontx-feature-template-resolution`: discovery is triggered on template install (cross-package edge F16 ← F10).
- `cpt-frontx-feature-ai-upgrade-orchestration` requires `cpt-frontx-feature-upgrade-changeset`: orchestration drives the single CLI change-set engine (cross-package edge F17 ← F14).
- `cpt-frontx-feature-ai-upgrade-orchestration` requires `cpt-frontx-feature-ai-kit-packaging`: the orchestration workflow ships inside the base AI kit.
- `cpt-frontx-feature-cli-invocation` requires `cpt-frontx-feature-template-resolution`, `cpt-frontx-feature-template-manifest`, `cpt-frontx-feature-cli-scaffolding`, `cpt-frontx-feature-composed-provenance`, and `cpt-frontx-feature-upgrade-changeset`: the invocation surface is the cross-command aggregator that dispatches `frontx <command>` to each owning behavior; it sits above them in the graph and none depend back on it.
- `cpt-frontx-feature-ai-project-scaffolding` requires `cpt-frontx-feature-ai-kit-packaging` (its entry points ship in the base kit), `cpt-frontx-feature-template-manifest` (selection matches intent against manifest-declared descriptions), `cpt-frontx-feature-template-resolution` (the local inventory it selects over), `cpt-frontx-feature-cli-scaffolding` (the seed/add assembly it drives over the command surface), `cpt-frontx-feature-composed-provenance` (the applied set is reported from provenance), and `cpt-frontx-feature-template-ai-extensions` (per-unit realization drives the applied templates' activated extension skills).
- `cpt-frontx-feature-routing-route-ownership-signal` requires `cpt-frontx-feature-routing-navigation-substrate`: the entry-resolution primitive it exposes, and the observable signal it builds on top of that primitive, both bind against the single navigation history the substrate owns.
- `cpt-frontx-feature-routing-engine-provider` requires `cpt-frontx-feature-routing-navigation-substrate`: the provider implements the engine port the substrate defines — a cross-package edge (`@gears-frontx/routing-tanstack` depends on `@gears-frontx/routing`) since the package split recorded in `cpt-frontx-adr-core-package-boundaries`.

## 4. Known Validator Debt

The installed SDLC kit requires feature-entry definitions in root DECOMPOSITION and routes DESIGN coverage through DECOMPOSITION. The member compatibility anchors in this file are limited to feature IDs, owner pointers and compact ID-only component/constraint/principle coverage references; member purpose, scope, requirements, prose, flows, dependencies, algorithms, acceptance criteria and design decisions remain owned by member FEATURE and DESIGN files.

This debt is removable when the upstream or project-installed SDLC kit supports member-scoped DECOMPOSITION coverage and member-owned FEATURE identity.
