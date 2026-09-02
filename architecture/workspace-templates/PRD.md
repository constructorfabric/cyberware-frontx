# PRD - Workspace Template Family

<!-- toc -->

- [1. Overview](#1-overview)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Background / Problem Statement](#12-background--problem-statement)
  - [1.3 Goals (Business Outcomes)](#13-goals-business-outcomes)
  - [1.4 Glossary](#14-glossary)
- [2. Actors](#2-actors)
  - [2.1 Human Actors](#21-human-actors)
  - [2.2 System Actors](#22-system-actors)
- [3. Operational Concept & Environment](#3-operational-concept--environment)
  - [3.1 Module-Specific Environment Constraints](#31-module-specific-environment-constraints)
- [4. Scope](#4-scope)
  - [4.1 In Scope](#41-in-scope)
  - [4.2 Out of Scope](#42-out-of-scope)
- [5. Functional Requirements](#5-functional-requirements)
  - [5.1 Family Composition and Independent Release](#51-family-composition-and-independent-release)
  - [5.2 Shell-Screen Integration Contract](#52-shell-screen-integration-contract)
  - [5.3 i18n Namespace Registration](#53-i18n-namespace-registration)
- [6. Non-Functional Requirements](#6-non-functional-requirements)
  - [6.1 NFR Inclusions](#61-nfr-inclusions)
  - [6.2 NFR Exclusions](#62-nfr-exclusions)
- [7. Public Library Interfaces](#7-public-library-interfaces)
  - [7.1 Public API Surface](#71-public-api-surface)
  - [7.2 External Integration Contracts](#72-external-integration-contracts)
- [8. Use Cases](#8-use-cases)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Dependencies](#10-dependencies)
- [11. Assumptions](#11-assumptions)
- [12. Risks](#12-risks)

<!-- /toc -->

## 1. Overview

### 1.1 Purpose

The Workspace Template Family is a co-authored, independently-versioned group of five top-level templates - `template-workspace`, the shell, plus `template-workspace-contacts`, `template-workspace-dashboard`, `template-workspace-chat`, and `template-workspace-mail`, each a screen sibling - that together produce one composed application: a shell hosting up to four screens, mounted through the ecosystem's existing screen extension domain. Each of the five is its own template-territory directory, carrying its own manifest, its own version line, and its own release cadence ([ADR-0017](../ADR/0017-source-spec-syntax.md), as amended for a co-authored family that releases its siblings apart). What one template directory contains internally is not this PRD's subject: template payload sits outside the ecosystem artifact universe ([ADR-0033](../ADR/0033-template-territory-traceability.md)), and the file-level shape of the split is carried by the domain-model mapping this PRD is generated from, not restated here ([mapping](../explorations/2026-09-02-workspace-template-domain-mapping.md)).

This PRD owns what none of the five templates' own (nonexistent) artifact trees could own and what no existing member fully owns either: the ecosystem-facing contract the split introduces between independently-versioned siblings that must nonetheless compose into one working application - the shell-screen integration surface, the GTS conventions the family's manifests share, the i18n and guard obligations the split adds, and the versioning and release model the family follows. It is root-owned nested content, not a templates-layer member's own artifact chain: template territory is deliberately not given one until template ownership has settled ([ADR-0033](../ADR/0033-template-territory-traceability.md), More Information), and this PRD does not revisit that deferral. Ecosystem-level requirements binding every layer member equally are owned by the [root PRD](../PRD.md); the CLI's own PRD owns the generic template mechanism - source-spec resolution, the manifest contract, ownership-boundary declaration - that every template, including these five, resolves through ([CLI PRD](../../packages/cli/architecture/PRD.md)); the runtime's own PRD owns extension-domain governance and host-microfrontend communication generically ([mfes PRD](../../packages/mfes/architecture/PRD.md)). This PRD owns only what is specific to this one family composing on top of those generic mechanisms.

### 1.2 Background / Problem Statement

Today a single template, `template-inbox`, ships one shell and four screens - contacts, dashboard, chat, mail - as one repository, one version, one release. A Project Developer who wants the shell without chat, or who wants dashboard alone against a different shell, cannot have it: the four screens and their shell version and release together, whether or not a given project uses all four. Splitting the monolith into five independently-versioned templates removes that coupling, but a split only pays off if the five pieces, built and released independently, still compose into one working application when a Project Developer applies the shell and any subset of the screens.

That is the problem this PRD addresses: independently-versioned siblings need an ecosystem-visible contract to agree on, discoverable without reading each other's source, so that a screen template built by one Template Developer against one shell version still mounts correctly, deep-links correctly, and labels its own menu entry correctly when applied alongside three other screens built by other Template Developers on their own schedules. Without that contract stated at ecosystem altitude, each sibling's author would have to read the other four templates' source to discover the shape they must agree on - exactly the kind of open-ended-codebase guessing the root PRD's own problem statement identifies as what a stable, narrow, explicitly-contracted surface is for ([root PRD §1.2](../PRD.md#12-background--problem-statement)).

### 1.3 Goals (Business Outcomes)

- **Independent release per sibling** - A Template Developer publishes a new version of one screen sibling without coordinating a release of the shell or of any other screen sibling. Target: each of the five templates carries its own version line and its own source-spec ref; Timeframe: first split release.
- **Deep-linkable multi-screen navigation** - A URL naming one of the family's screens resolves to that screen through the shell's own hash-based routing, driven by the registered extension set rather than a closed route union. Target: every mounted screen sibling is reachable by a stable URL prefix it declares; Timeframe: first split release.
- **Discoverable menu labels across independently-versioned siblings** - A screen sibling's own menu entry renders in the shell's own chosen language without the shell importing that sibling's translation bundle at build time. Target: the shell resolves a registering screen's menu label through a namespace the screen hands it at mount, not a build-time import; Timeframe: first split release.
- **No template-kind taxonomy introduced** - The manifest contract gains no field distinguishing a shell template from a screen template; the distinction stays prose-only, in each template's own description. Target: zero manifest-readable classification fields added by this split; Timeframe: first split release, held indefinitely.
- **Registry parity maintained through a five-directory addition** - The artifact registry's template-territory exclusion stays equal to the set of manifest-carrying top-level directories through the addition of all five family directories. Target: zero unenumerated manifest-carrying directories after the split lands; Timeframe: each directory's own creation commit.

### 1.4 Glossary

This PRD uses the root PRD's shared vocabulary ([root PRD §1.4](../PRD.md#14-glossary)) for *template*, *project*, and *application*, and the runtime's own vocabulary ([mfes PRD §1.4](../../packages/mfes/architecture/PRD.md#14-glossary)) for *microfrontend*, *extension*, and *extension domain*. The terms below are specific to this family and are prose-only: none names a manifest field, and none is a classification a template's own manifest declares ([ADR-0018](../ADR/0018-template-manifest-contract.md); rule against introducing a template-kind taxonomy).

| Term | Definition |
|------|------------|
| family | The five templates this PRD describes, co-authored and independently versioned, that compose into one application when applied together. |
| sibling | Any one of the family's five templates, named for its position in the family rather than for a manifest-declared kind. |
| shell | The family's sibling that owns the application shell, the icon rail, theming, i18n core, and the domain-neutral API glue: `template-workspace`. Plays the runtime's Application Developer role (`cpt-frontx-mfes-actor-application-developer`) at the family's own surface. |
| screen | Any one of the family's four siblings that mounts as an occupant of the shell's screen extension domain: `template-workspace-contacts`, `-dashboard`, `-chat`, `-mail`. Plays the runtime's Microfrontend Developer role (`cpt-frontx-mfes-actor-microfrontend-developer`) at the family's own surface. |
| screen extension domain | The existing runtime extension domain every screen sibling's own extension entry targets (`gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1`), the same domain `demo-mfe`'s own screen extensions already target today. Not a new domain this split declares. |
| order band | The convention by which each screen sibling's own `presentation.order` value is reserved a range of 100, so independently-versioned siblings do not have to coordinate an exact value to avoid colliding (§5.2). A documented convention, not a runtime-enforced one (§11). |

## 2. Actors

### 2.1 Human Actors

#### Shell Template Developer

**ID**: `cpt-frontx-workspace-templates-actor-shell-developer`

**Role**: Authors, versions, and publishes `template-workspace`. Declares the screen extension domain's admission rules the shell already inherits from the runtime, wires the shared i18n core and the two existing chrome-facing conventions the split plan carries forward, and implements the hash-based routing that resolves a URL to a registered screen. Fills the root PRD's Template Developer role (`cpt-frontx-actor-template-developer`) and the runtime's Application Developer role (`cpt-frontx-mfes-actor-application-developer`) at the family's own surface.
**Needs**: A stable, ecosystem-visible statement of what a screen sibling registers and how, so the shell can be built and released without waiting on any particular screen sibling's own release.

#### Screen Template Developer

**ID**: `cpt-frontx-workspace-templates-actor-screen-developer`

**Role**: Authors, versions, and publishes one of the four screen siblings. Registers one extension entry against the shell's existing screen extension domain, declares the sibling's own `presentation.route` and `presentation.order`, and authors the sibling's own thin API glue against `@gears-frontx/api` rather than importing the shell's. Fills the root PRD's Template Developer role (`cpt-frontx-actor-template-developer`) and the runtime's Microfrontend Developer role (`cpt-frontx-mfes-actor-microfrontend-developer`) at the family's own surface.
**Needs**: A documented order band and route-prefix convention to avoid colliding with a sibling built independently; a documented way to hand the shell a menu label without the shell importing the sibling's translations; no obligation to read another sibling's source to discover either.

### 2.2 System Actors

#### MFE Runtime

**ID**: `cpt-frontx-workspace-templates-actor-mfe-runtime`

**Role**: Admits each screen sibling's extension into the shell's screen extension domain by contract matching, mediates the i18n-namespace registration this PRD adds as an addressed action over the actions-chains channel, and isolates each independently-bundled sibling at load time. Owned entirely by `@gears-frontx/mfes`; this PRD adds no capability to it beyond what its own PRD already commits to generically ([mfes PRD §5.1](../../packages/mfes/architecture/PRD.md#51-runtime-composition)).

#### GTS Type System

**ID**: `cpt-frontx-workspace-templates-actor-gts-type-system`

**Role**: Validates every extension entry, shared property, and addressed-action payload the family's manifests declare, including the new i18n-namespace registration action once its concrete schema is authored. Owned entirely by `@gears-frontx/gts-plugin`.

## 3. Operational Concept & Environment

A Project Developer applies the shell and any subset of the four screen siblings to a project, in any order the CLI's own composed-template resolution supports. Each applied screen sibling registers one extension entry against the shell's screen extension domain at the sibling's own declared `presentation.route`, `presentation.order`, and menu icon; the shell resolves the registered set into an icon-rail menu and a hash-based router driven by that set, never a closed union of known screen names. A screen sibling that registers a menu label hands the shell a namespace-and-dictionary pair through the i18n-namespace registration action this PRD adds (§5.3); the shell resolves the label against that namespace rather than importing the sibling's translations at build time. Two screen siblings that read shell-provided data - contacts records, for instance - do so through the shell's own REST surface, never through a build-time import of one another's or the shell's application code, because each sibling is bundled and versioned independently and no import can cross that boundary at runtime.

### 3.1 Module-Specific Environment Constraints

- Requires the runtime's Module Federation composition and its screen extension domain to already be admitting the shell and its screens as it admits `demo-mfe`'s own screen extensions today.
- Requires a browser environment with Shadow DOM support, since every screen sibling's own kit-styled UI renders inside a shadow root the shell's own trust-kernel isolation manages (owned by `@gears-frontx/mfes`, not restated here).
- Carries no environment constraint of its own beyond what the runtime and the CLI's template mechanism already state; this PRD introduces no new runtime dependency, only a new documented usage of the existing communication channel (§5.3).

## 4. Scope

### 4.1 In Scope

- The family's own composition shape: one shell sibling plus up to four screen siblings, each an independently-versioned, independently-released top-level template directory, resolved and applied through the CLI's existing generic mechanism.
- The shell-screen integration contract: registration of each screen sibling as an occupant of the existing screen extension domain, the order-band and route-prefix conventions that keep independently-versioned siblings from colliding, and the shell's obligation to resolve the registered set into hash-based deep linking rather than a closed route union (§5.2).
- The i18n-namespace registration action this split adds to the family's own usage of the runtime's existing host-microfrontend communication channel, so a screen sibling's menu label renders without a build-time import (§5.3).
- The guard obligation the split's five simultaneous directory additions place on the artifact registry's template-territory exclusion ([ADR-0033](../ADR/0033-template-territory-traceability.md)), restated here as a family-scoped acceptance criterion (§9).
- The family's versioning and release model: per-sibling independent version lines and source-spec refs, already fixed by [ADR-0017](../ADR/0017-source-spec-syntax.md) as amended, restated here as the model this family follows.

### 4.2 Out of Scope

- Any sibling's own internal file contents, directory layout, dataset, or styling: template payload sits outside the ecosystem artifact universe ([ADR-0033](../ADR/0033-template-territory-traceability.md)) and is carried at file-level detail by the domain-model mapping this PRD is generated from, not by this PRD ([mapping](../explorations/2026-09-02-workspace-template-domain-mapping.md)).
- The concrete field-level JSON schema of the i18n-namespace registration action: owned by whichever FEATURE eventually specifies it, per the [contract-schema-ownership decision's](../ADR/0027-contract-schema-ownership.md) own division of role, rationale, and field-level schema across DESIGN, ADR, and FEATURE; this PRD states only that the action exists and what it carries in prose (§5.3).
- The generic template mechanism - source-spec resolution, manifest publication, ownership-boundary declaration, assembly-conflict prevention - all owned by the [CLI's own PRD](../../packages/cli/architecture/PRD.md); this PRD adds no requirement to it.
- Generic extension-domain governance and host-microfrontend communication - both owned by the [runtime's own PRD](../../packages/mfes/architecture/PRD.md); this PRD adds no requirement to it, only a family-specific usage of what it already commits to.
- Where the shell's MF-host build layer is sourced from, whether a screen manifest can declare a required shell-provided endpoint, whether the per-screen API-glue pattern should be standardized, whether the `shared/` presentation utilities move into `@gears-frontx/ui-kit`, and whether component CSS reaches a shadow root through an actual Module-Federation build - all five stay open (§11).

## 5. Functional Requirements

### 5.1 Family Composition and Independent Release

#### Independently-versioned sibling composition

- [ ] `p1` - **ID**: `cpt-frontx-workspace-templates-fr-independent-sibling-release`

The family **MUST** be composed of five top-level template directories - one shell sibling and four screen siblings - each carrying its own manifest, its own version line, and its own source-spec ref, resolvable and applicable independently of the others' release state.

**Rationale**: The whole point of splitting a monolithic template into a family is that a screen sibling's own release does not wait on the shell's, or on any other screen sibling's; a shared version line would reintroduce the coupling the split exists to remove.

**Actors**: `cpt-frontx-workspace-templates-actor-shell-developer`, `cpt-frontx-workspace-templates-actor-screen-developer`

#### Registry-parity guard obligation

- [ ] `p1` - **ID**: `cpt-frontx-workspace-templates-fr-registry-parity`

Each of the five family directories' own creation, rename, or relocation **MUST** carry the corresponding artifact-registry exclusion-pattern change in the same commit, per the [territory-traceability decision's](../ADR/0033-template-territory-traceability.md) own authoring obligation.

**Rationale**: Creating five template directories at once is exactly the scenario the territory-traceability decision's own risk framing names as turning one missed pattern into five; stating the obligation at the family's own altitude keeps it from being rediscovered per directory.

**Actors**: `cpt-frontx-workspace-templates-actor-shell-developer`, `cpt-frontx-workspace-templates-actor-screen-developer`

### 5.2 Shell-Screen Integration Contract

#### Screen registration against the existing screen extension domain

- [ ] `p1` - **ID**: `cpt-frontx-workspace-templates-fr-screen-domain-registration`

Each screen sibling **MUST** register exactly one extension entry against the shell's screen extension domain (`gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1`), the same domain identifier the runtime's own `demo-mfe` reference already targets. The family **MUST NOT** declare a new extension domain of its own.

**Rationale**: The screen extension domain, its admission rules, and its cardinality matrix are already specified generically by the runtime (`cpt-frontx-fr-mfe-extension-domain-governance`, `cpt-frontx-fr-mfe-multi-occupant-domain`); reusing it rather than declaring a family-specific domain keeps the family from duplicating a contract the runtime already owns.

**Actors**: `cpt-frontx-workspace-templates-actor-screen-developer`

#### Shell resolves the registered set into hash-based deep linking

- [ ] `p1` - **ID**: `cpt-frontx-workspace-templates-fr-hash-routing`

The shell **MUST** resolve a URL to a mounted screen by hash-prefix matching against each registered extension's own declared `presentation.route`, rather than against a closed union of known screen identifiers. A screen sibling applied to a project after the shell was built **MUST** be reachable by its own declared route without a shell rebuild.

**Rationale**: `presentation.route` is already schema-required on every extension entry but has never had a real consumer in this ecosystem; a closed route union would reintroduce, inside the shell's own routing code, exactly the coupling to a fixed screen set the split exists to remove.

**Actors**: `cpt-frontx-workspace-templates-actor-shell-developer`

### 5.3 i18n Namespace Registration

#### Menu-label namespace registration as an addressed action

- [ ] `p1` - **ID**: `cpt-frontx-workspace-templates-fr-i18n-namespace-registration`

A screen sibling **MUST** be able to hand the shell a namespace-and-dictionary pair for its own menu-chrome label, on mount, through an addressed action dispatched over the runtime's existing actions-chains channel - symmetric to the two chrome-facing actions the split plan already carries forward (theme and menu-collapsed state) - so the shell resolves the label without importing the sibling's translation bundle at build time. The system **MUST NOT** prop-drill a translation function through the mount call as a substitute: doing so ties every sibling's internal strings to the exact shape of a function value crossing the Module Federation boundary, and gives a sibling's own namespace nowhere to register independently of the shell's dictionary.

**Rationale**: The runtime already commits generically to microfrontend-host communication (`cpt-frontx-fr-mfe-host-communication`); this is the family's own concrete, named usage of that existing channel, needed because the shell cannot read a key out of a bundle it does not import, and no existing chrome action carries this payload shape.

**Actors**: `cpt-frontx-workspace-templates-actor-shell-developer`, `cpt-frontx-workspace-templates-actor-screen-developer`

#### Self-contained internal-copy translation

- [ ] `p2` - **ID**: `cpt-frontx-workspace-templates-fr-internal-copy-i18n`

A screen sibling's own internal UI copy **MUST** resolve from a namespace local to that sibling's own bundle, driven only by the existing `language` shared property, needing no registration with the shell beyond that property.

**Rationale**: A screen sibling's own internal strings are not shell-rendered chrome; requiring shell registration for them would place a build-time or registration cost on every string a sibling owns entirely, for no benefit the shell needs.

**Actors**: `cpt-frontx-workspace-templates-actor-screen-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

#### No template-kind taxonomy

- [ ] `p1` - **ID**: `cpt-frontx-workspace-templates-nfr-no-kind-taxonomy`

No manifest field introduced by this split **MUST** classify a template as a "shell template" or a "screen template," or by any other kind. The distinction between the shell and a screen **MUST** stay entirely in each template's own prose description.

**Threshold**: Zero new manifest fields, in any of the five templates' own manifests, whose value names a template kind.

**Rationale**: A classification taxonomy hardens the system and narrows what future templates can compose; its absence is a deliberate ecosystem-wide decision this family does not get an exception to.

#### Registry-scan universe stays ecosystem-only

- [ ] `p1` - **ID**: `cpt-frontx-workspace-templates-nfr-territory-exclusion`

None of the five family directories **MUST** be scanned for `@cpt-` traceability by the artifact registry; each stays excluded exactly as `template-shell` and `template-mfe` already are.

**Threshold**: All five directories present in the registry's template-territory exclusion pattern list, verified mechanically.

**Rationale**: This is the direct, mechanical consequence of the [territory-traceability decision](../ADR/0033-template-territory-traceability.md); stating it here as a threshold this family's own guard obligation (`cpt-frontx-workspace-templates-fr-registry-parity`) is checked against.

### 6.2 NFR Exclusions

The root PRD's §6.2 exclusions (safety, privacy, accessibility, internationalization beyond the namespace-registration mechanism this PRD states, inclusivity, regulatory compliance) apply here for the same reasons stated there.

## 7. Public Library Interfaces

### 7.1 Public API Surface

None owned here. This PRD describes no published package of its own; the runtime's public surface that the family's addressed action rides on is owned by [mfes PRD §7.1](../../packages/mfes/architecture/PRD.md#71-public-api-surface).

### 7.2 External Integration Contracts

None owned here beyond the package-registry distribution contract every published artifact carries (`cpt-frontx-contract-package-registry-distribution`), which does not apply to template territory. The family's own manifest publication contract is owned by the CLI's PRD ([CLI PRD §7.2](../../packages/cli/architecture/PRD.md#72-external-integration-contracts)).

## 8. Use Cases

#### A screen sibling applied after the shell was built resolves a deep link

- [ ] `p2` - **ID**: `cpt-frontx-workspace-templates-usecase-deep-link-to-screen-sibling`

**Actor**: `cpt-frontx-workspace-templates-actor-shell-developer`

**Preconditions**:
- The shell is applied to a project and built; a screen sibling built and released after the shell's own release is subsequently applied to the same project.
- A URL naming that screen sibling's own declared `presentation.route` is opened cold or reloaded.

**Main Flow**:
1. The runtime admits the newly-applied screen sibling's extension into the shell's screen extension domain by contract matching (`cpt-frontx-workspace-templates-fr-screen-domain-registration`), the same admission path `demo-mfe`'s own screen extensions already exercise.
2. The shell's own icon-rail menu includes the newly-registered sibling, at the order value the sibling's own manifest declares.
3. The shell's hash-based router resolves the opened URL's route segment against the registered extension set's own declared routes, by prefix match (`cpt-frontx-workspace-templates-fr-hash-routing`), and mounts the matching sibling.
4. On mount, the sibling hands the shell its own menu-label namespace and dictionary through the i18n-namespace registration action (`cpt-frontx-workspace-templates-fr-i18n-namespace-registration`); the shell resolves the sibling's own menu label against that namespace.

**Postconditions**:
- The deep-linked screen is mounted and its menu entry renders labeled in the shell's own chosen language, without the shell having been rebuilt to know about this sibling in advance.

**Alternative Flows**:
- **No registered route matches the opened URL's route segment**: the shell shows its own fallback; no sibling mounts. This is the shell's own routing behavior, not a runtime guarantee this PRD or the runtime makes.
- **Two applied screen siblings declare the same `presentation.order` band or an overlapping route prefix**: nothing in the runtime arbitrates the collision; it is a documented, review-enforced convention rather than a mechanically-checked one (§11).

## 9. Acceptance Criteria

- [ ] All five family directories carry their own manifest, version line, and source-spec ref, independently applicable and independently releasable - verifiable via `cpt-frontx-workspace-templates-fr-independent-sibling-release`.
- [ ] Each of the five directories' own creation, rename, or relocation commit carries the corresponding artifact-registry exclusion-pattern change - verifiable via `cpt-frontx-workspace-templates-fr-registry-parity`.
- [ ] Every screen sibling registers exactly one extension entry against the existing screen extension domain, with no new domain declared by the family - verifiable via `cpt-frontx-workspace-templates-fr-screen-domain-registration`.
- [ ] A screen sibling applied after the shell was built is reachable by its own declared route without a shell rebuild - verifiable via `cpt-frontx-workspace-templates-fr-hash-routing`.
- [ ] A screen sibling's own menu-chrome label renders in the shell's chosen language without the shell importing that sibling's translation bundle at build time - verifiable via `cpt-frontx-workspace-templates-fr-i18n-namespace-registration`.
- [ ] A screen sibling's own internal UI copy resolves from its own bundle-local namespace, driven only by the existing `language` shared property - verifiable via `cpt-frontx-workspace-templates-fr-internal-copy-i18n`.
- [ ] No manifest field added by this split classifies a template by kind - verifiable via `cpt-frontx-workspace-templates-nfr-no-kind-taxonomy`.
- [ ] All five family directories are present in the artifact registry's template-territory exclusion - verifiable via `cpt-frontx-workspace-templates-nfr-territory-exclusion`.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| `@gears-frontx/mfes` screen extension domain and actions-chains mediator | The existing runtime capability this family composes on; owns extension-domain governance and host-microfrontend communication generically. | p1 |
| `@gears-frontx/gts-plugin` | Validates every extension entry, shared property, and addressed-action payload the family's manifests declare. | p1 |
| CLI's generic template mechanism | Source-spec resolution, manifest publication, and assembly-conflict prevention that every one of the five templates resolves through. | p1 |
| Domain-model mapping | File-level detail for the split, referenced rather than duplicated by this PRD ([mapping](../explorations/2026-09-02-workspace-template-domain-mapping.md)). | p2 |

## 11. Assumptions

- The five open questions the domain-model mapping raises stay open and are not resolved by this PRD:
  - **Open - MF-host build-layer sourcing.** Whether the shell's Module-Federation host layer is sourced from `template-shell`'s own published build export or from a `packages/`-promoted framework is not decided here; either choice is compatible with the requirements this PRD states.
  - **Open - endpoint-availability declaration.** Whether a screen sibling's manifest gets a way to declare a required shell-provided endpoint, enforced by the runtime's existing subset-admission check, is not decided here; today a version mismatch surfaces as a runtime 404 rather than a refused mount, and this PRD states no requirement that changes that.
  - **Open - API-glue standardization.** Whether the per-screen pattern of authoring thin glue against `@gears-frontx/api` (rather than importing the shell's own `registry.ts`/`queries.ts`) should be standardized by `@gears-frontx/react` is not decided here; this PRD requires only that each screen sibling author its own glue, not where that pattern is eventually owned.
  - **Open - `shared/` utilities placement.** Whether `PresenceAvatar`, `IdentityAvatar`, and `format.ts` move into `@gears-frontx/ui-kit` is not decided here; it is a decision about the kit's own scope, owned by whoever authors the kit's own DESIGN.
  - **Open - component CSS through Module Federation, confirmed.** Whether component (not token) CSS reaches a shadow root through an actual Module-Federation build, rather than only through the in-repo fixture already proven, is not confirmed by this PRD; the domain-model mapping's own risk framing places this before the first screen sibling (contacts) is split, not after.
- Order-band and route-prefix uniqueness across independently-versioned screen siblings is a documented convention this PRD states (§5.2) and a review obligation on each Screen Template Developer; it is not a runtime-enforced or mechanically-checked invariant, because `presentation.order` is a flat number across the whole domain and nothing in the runtime arbitrates a collision between two siblings claiming the same band or prefix.
- Every family member composes inside the same JavaScript realm and the same Module-Federation graph the runtime already governs; this PRD introduces no new isolation model and relies entirely on the runtime's existing one.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| A new family directory is created without a matching artifact-registry exclusion-pattern addition. | The directory's payload enters the ecosystem traceability scan and fails validation on a later run rather than on the change that caused it - a precedent that already occurred once, for `template-inbox` itself. | The registry-parity guard obligation (`cpt-frontx-workspace-templates-fr-registry-parity`) states the requirement at the family's own altitude, in the same commit as each directory's own creation. |
| Two independently-versioned screen siblings declare the same order band or an overlapping route prefix. | The shell's icon-rail ordering or hash-routing resolution becomes ambiguous between the two siblings, with no runtime error surfaced. | Documented as a review obligation (§11); not resolved by a runtime guard in this pass. |
| `lucide-react` sits at two different major lines across the family's own dependency graph, and every ecosystem-package pin bump now touches five `package.json` files instead of two. | A future kit-icon change is not guaranteed to be observed by a screen sibling that pins its own copy; pin-bump review cost is multiplied by five. | Not addressed by this PRD; the pin-drift guard catches an inconsistency once it exists but does not reduce the number of files a bump touches, and the version-surface fact predates this split. |
| The shell's MF-host build layer depends on `template-shell`'s own published build export rather than a `packages/`-promoted framework (Open Question 1, leaning toward this option for the first iteration). | The pin-drift guard, which compares every manifest-carrying directory's ecosystem-package pins against `packages/*`, does not cover a dependency on a template-published package; a drift here would not be caught by the same mechanism that catches every other pin. | Not resolved by this PRD; carried as part of Open Question 1's own go/no-go (§11). |
| Component CSS reaching a shadow root through an actual Module-Federation build has not been traced, only the token path and an in-repo fixture. | If component CSS does not reach the shadow root the way the fixture suggests, the first screen sibling split (contacts) discovers this only after the split rather than before. | Confirm before contacts is split, per the domain-model mapping's own sequencing risk (§11, Open - component CSS confirmation). |
