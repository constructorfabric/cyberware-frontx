# PRD - UI Kit (`@gears-frontx/ui-kit`)

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
  - [5.1 Component Surface](#51-component-surface)
  - [5.2 Agent Knowledge Layer](#52-agent-knowledge-layer)
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

`@gears-frontx/ui-kit` is the ecosystem's standard React component base. It publishes a set of components whose behaviour comes from headless primitives, whose appearance is expressed only through a semantic token vocabulary, and whose documentation ships inside the installed package so an AI agent writing application code can read it at the version the project actually has. On top of that library it carries an agent knowledge layer: a machine-readable contract per described component, stating what the component means and what its prop surface actually is, so an agent's use of the kit can be checked rather than reviewed by eye.

This PRD owns the package's product requirements. Ecosystem-level requirements that bind every member equally are owned by the [root PRD](../../../architecture/PRD.md); the package's structure is owned by this package's [DESIGN](./DESIGN.md).

### 1.2 Background / Problem Statement

A project that composes a screen from a component library needs two things the library usually supplies only informally. The first is a component surface a consumer can adopt selectively: importing one component must not drag in the rest, and the styling must be rebrandable without forking the library. The second is knowledge. When the code is written by an agent rather than by a person, prose documentation is the only description available, and prose cannot be checked. Nothing tells a tool that a component has a `size` axis with three values, that one component is the wrong choice where a neighbouring one is right, or that a change removed a prop consumers depend on. The failure surfaces at human review, one screen at a time.

The package answers the first need with per-component entry points, token-only styling and consumer-side acceptance checks. It answers the second by compiling, for each component that has been described, a contract that carries the component's meaning next to the prop facts read out of its TypeScript, and by holding that contract to the code through the same continuous-integration run that holds the code to its tests.

### 1.3 Goals (Business Outcomes)

- **A component base a product can adopt without inheriting the whole kit** - a consumer importing one component ships that component's code and styles and no other's, and rebrands by overriding tokens rather than by forking. Target: no consumer-visible cost for components the consumer never imports; Timeframe: ongoing, verified on every change.
- **Kit knowledge an agent can be held to** - for a described component, an agent's choice and use of the component can be checked against a machine-readable contract instead of against prose. Target: the described set grows monotonically as ordinary work touches components; Timeframe: ongoing.
- **Description that cannot drift from the code** - a described component's contract and its implementation cannot disagree in a merged change, and an incompatible change to a described surface cannot land silently. Target: zero merged changes where a described component's committed contract disagrees with its source; Timeframe: ongoing.

### 1.4 Glossary

This PRD uses the root PRD's vocabulary ([root PRD §1.4](../../../architecture/PRD.md#14-glossary)) for *application*, *published library* and *template*. Defined here:

| Term | Definition |
|------|------------|
| Component | A React export of this package that a consuming application renders, together with the styles, documentation and public entry point that belong to it. |
| Token | A named appearance value the kit defines once and every component's styling consumes; the unit of rebranding. |
| Component contract | A machine-readable description of one component: its meaning, stated by hand, joined to the prop facts read out of its TypeScript. |
| Overlay | The hand-authored half of a contract. It carries meaning only and may not restate a fact the compiler can read from the code. |
| Described component | A component the kit has opted into contract coverage for. An undescribed component is not a defect; coverage is incremental. |
| Passthrough surface | The attributes React declares for the element a component renders, forwarded rather than declared. One statement per element kind, shared by every component that renders it. A prop the primitive library declares for its own part is not part of this: that is the wrapping component's own API. |

## 2. Actors

### 2.1 Human Actors

#### Application Developer

**ID**: `cpt-frontx-ui-kit-actor-application-developer`

**Role**: Installs the package into a product and composes screens from its components. Fills the root PRD's Project Developer role (`cpt-frontx-actor-project-developer`) at the component surface.
**Needs**: A component that can be imported on its own, styled through tokens rather than overrides, and used correctly from the documentation that came with the install.

#### Kit Developer

**ID**: `cpt-frontx-ui-kit-actor-kit-developer`

**Role**: Adds and changes components inside this package, and describes a component by authoring its overlay.
**Needs**: To state a component's meaning once, without restating what the code already says, and to be told at review time when a change breaks a described surface or leaves a contract stale.

### 2.2 System Actors

#### AI Agent

**ID**: `cpt-frontx-ui-kit-actor-ai-agent`

**Role**: Writes application code that uses this package. It reads the documentation shipped inside the installed package, and for a described component it can read that component's contract.

#### Continuous Integration

**ID**: `cpt-frontx-ui-kit-actor-continuous-integration`

**Role**: Runs the package's checks on a change: its unit suites, its consumer acceptance run, and the contract guard and compatibility check over the change's own scope.

## 3. Operational Concept & Environment

The package is installed by a consuming application as a versioned dependency and rendered in a browser. Components are consumed either from the package barrel or from a per-component subpath; the three global stylesheets are imported by the application once. Documentation travels with the install, so an agent working in a project reads the description of the version that project resolved rather than a description published elsewhere.

Inside this repository the package additionally carries the contract tooling: a compiler that produces a described component's contract, per-component conformance suites, and the guard and compatibility check the continuous-integration run invokes with the base reference of the change under review.

### 3.1 Module-Specific Environment Constraints

- Components target React 19 as a peer dependency and are consumed from an ECMAScript-module build; no CommonJS output is published.
- Consumers build with more than one bundler and more than one module-resolution mode, so the published artifact must satisfy all of them rather than the one this repository happens to use.
- A component that calls a hook in its own render body must carry the client-boundary directive into the published artifact; a component that only composes primitives must not, so that server rendering stays available to consumers who use it.
- Contract tooling runs in the repository against a git base reference. It is not part of the published artifact and imposes no runtime cost on a consumer.

## 4. Scope

### 4.1 In Scope

- The published component surface: components, their styles, their public entry points and the package's export map.
- The semantic token vocabulary and the theme mechanism every component's styling is expressed through.
- The client-boundary classification of the published components.
- The agent-facing documentation shipped inside the package: the index and one usage document per component.
- Consumer-side acceptance of the published artifact across the bundlers and module resolutions consumers use.
- The agent knowledge layer: the component contract, its compiler, its per-component conformance suites, and the freshness, compatibility and coverage checks over it.

### 4.2 Out of Scope

- The choice of component library made by a project - a template may choose a different library in the same role, and nothing in the ecosystem's contracts privileges this one ([root PRD §4.2](../../../architecture/PRD.md#42-out-of-scope)).
- Application domain content, data access and back-end integration.
- Design-process capability - producing a theme, generating an interface, reviewing one against the kit - which belongs to template territory rather than to a published library.
- Composition-level artifacts above a single component, such as reusable screen blocks and their catalogue.
- The consumer of the unchecked-prop verdict: the plan validator or lint that reads a component's props before anything renders and acts on the report belongs to whatever runs that check, not to this package, which owns the rule and the report only.
- Visual-regression testing and automated accessibility auditing of consuming applications.

## 5. Functional Requirements

### 5.1 Component Surface

#### Selectively consumable component set

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-component-set`

The system **MUST** publish each component behind both the package barrel and a per-component subpath, and **MUST** keep the internal module layout unreachable from a consumer.

**Threshold**: Every component the package exports resolves from the barrel and from its own subpath, under both the node and the bundler module-resolution modes; no deep path into the package's internals resolves.

**Rationale**: A consumer chooses how much of the kit to take, and a component's internal file layout must stay free to change without breaking anyone.

**Actors**: `cpt-frontx-ui-kit-actor-application-developer`

#### Appearance expressed only through tokens

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-token-styling`

The system **MUST** express every component's appearance through the kit's own semantic token vocabulary, and **MUST NOT** let a component's styling introduce an appearance value of its own.

**Threshold**: No component stylesheet declares a raw colour or an off-scale metric; every variable a component stylesheet consumes is either defined by the kit's theme or supplied by the primitive's own runtime.

**Rationale**: Rebranding a product must be an override of the kit's vocabulary, not a fork of the kit.

**Actors**: `cpt-frontx-ui-kit-actor-application-developer`

#### Theme selection by preference and by declaration

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-fr-theme-selection`

The system **MUST** follow the viewer's colour-scheme preference by default and **MUST** allow an application to select a theme explicitly, for the whole document or for a subtree of it.

**Threshold**: Every token the light theme defines is redefined in the dark theme, and the preference-driven and declaration-driven dark definitions are identical.

**Rationale**: An application needs both the default that is right for most viewers and the ability to pin a region, and a token defined in one theme but not the other is a visual defect that only appears for some viewers.

**Actors**: `cpt-frontx-ui-kit-actor-application-developer`

#### Correct client boundary in the published artifact

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-client-boundary`

The system **MUST** carry the client-boundary directive into the published artifact for exactly those components that call a hook in their own render body, and **MUST** leave every other component server-renderable.

**Threshold**: The classification is derived from the source directives rather than maintained by hand, and every place the classification is stated agrees with the source.

**Rationale**: A component that silently loses its directive fails at a consumer's build; a component that gains one it does not need removes server rendering from consumers who rely on it.

**Actors**: `cpt-frontx-ui-kit-actor-application-developer`

#### Documentation shipped with the install

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-agent-documentation`

The system **MUST** ship, inside the published artifact, an index of the component surface and one usage document per component, so a reader working in a consuming project reads the description of the version that project installed.

**Threshold**: Every component the package exports has a usage document in the published artifact and is reachable from the index; the styling axes a component's stylesheet defines are named in its document.

**Rationale**: Documentation published anywhere other than inside the artifact drifts from the version a project resolved, which is exactly the drift an agent cannot detect.

**Actors**: `cpt-frontx-ui-kit-actor-ai-agent`, `cpt-frontx-ui-kit-actor-application-developer`

#### Acceptance from a consumer's position

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-consumer-acceptance`

The system **MUST** be verified by installing the packaged artifact into clean consumer projects and asserting the surviving component code and styles there, across the bundlers and module-resolution modes its consumers use.

**Threshold**: A component's styles are present in a consumer's build when that component is imported and absent when it is not; the type surface resolves under both module-resolution modes; the packaged artifact carries the documentation index and the per-component documents.

**Rationale**: The properties that matter here - side-effect declarations, style emission, type specifiers - are invisible to the package's own build and only fail at a consumer.

**Actors**: `cpt-frontx-ui-kit-actor-application-developer`, `cpt-frontx-ui-kit-actor-continuous-integration`

### 5.2 Agent Knowledge Layer

#### Machine-readable contract per described component

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-component-contract`

The system **MUST** produce, for each described component, a machine-readable contract carrying the component's meaning together with its checkable prop surface: its variant axes and their values, the props it declares itself, the props the primitive it wraps declares for that part - which are the component's own API, reached through the wrapping - and a reference to the attributes it forwards to the element it renders.

**Threshold**: A described component's contract states every variant axis and its default, carries both the props the component declares and the props the primitive declares for the part it wraps, references the forwarded attribute surface of its host element rather than restating it, and represents a prop that has no machine-checkable shape as an explicitly annotated one - stating the type the type system checks - rather than omitting it or leaving it blank.

**Rationale**: An agent choosing and using a component needs a description a tool can check its output against; prose can only be reviewed by a person.

**Actors**: `cpt-frontx-ui-kit-actor-ai-agent`, `cpt-frontx-ui-kit-actor-kit-developer`

#### One fact, one owner

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-contract-single-fact-owner`

The system **MUST** refuse a hand-authored overlay that restates a fact the compiler reads from the code, and **MUST** refuse an overlay that names a prop the component does not have.

**Threshold**: An overlay carrying a machine-owned field is rejected by name; an overlay referencing an absent prop is rejected naming the prop.

**Rationale**: Two writable statements of the same fact drift. Describing a component must cost only its meaning.

**Actors**: `cpt-frontx-ui-kit-actor-kit-developer`

#### A prop nothing evaluates is reported, not rejected

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-contract-unchecked-prop-report`

The system **MUST** leave a described component's contract open to a prop nothing in it evaluates, carrying the verdict on such a prop as an annotation rather than rejecting it, and **MUST** provide the report that classifies a set of props against a contract: which the contract accounts for, which nothing accounts for, and which of the latter is one edit from a prop the contract declares.

**Threshold**: A prop no part of a contract evaluates validates rather than failing; the harness's report names that prop as unchecked, and names a name one edit from a prop the contract declares as a probable misspelling of it, in preference to any pattern that would otherwise admit it.

**Rationale**: A closed schema answered "invalid" to a misspelled kit prop and to a name this harness has not classified - a new React attribute, a prop of a primitive part nobody has described - and only the first is a mistake. Telling them apart needs a comparison a schema cannot make, so the schema admits the value and the harness owns the verdict.

**Actors**: `cpt-frontx-ui-kit-actor-ai-agent`, `cpt-frontx-ui-kit-actor-kit-developer`

**Status**: The report is built and is the harness's own. Its intended consumer - a plan validator or a lint that reads a component's props before anything renders and acts on the verdict - is out of scope for this package.

#### A described component's contract matches its code

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-contract-freshness`

The system **MUST** hold a described component's committed contract to a fresh compile of that component, and **MUST** fail a change in which the two disagree.

**Threshold**: A change touching a described component whose committed artifacts do not equal a fresh compile is refused, naming the component and the command that regenerates it.

**Rationale**: A description that may lag the code is worse than none, because a reader cannot tell which of the two is current.

**Actors**: `cpt-frontx-ui-kit-actor-continuous-integration`, `cpt-frontx-ui-kit-actor-kit-developer`

#### An incompatible change moves the contract major

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-contract-compatibility`

The system **MUST** compare a described component's contract against the same contract at the change's base reference, and **MUST** refuse a backward-incompatible difference unless the contract's own major version moved.

**Threshold**: Removing a prop, making an optional prop required, dropping a value from a variant axis, constraining a property that accepted more before, or narrowing the forwarded surface is refused at an unchanged major and accepted with the major moved, in both cases naming every reason. The major is the described component's own, so giving that acknowledgement costs one component's identifiers rather than the kit's.

**Rationale**: Consumers depend on a described surface. The point of describing it is that a break becomes a decision rather than an accident.

**Actors**: `cpt-frontx-ui-kit-actor-continuous-integration`

#### Coverage grows by opt-in

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-fr-contract-incremental-coverage`

The system **MUST** apply contract enforcement only to components explicitly opted into coverage, **MUST** report kit-wide coverage without failing on it, and **MUST** re-check every covered component when any input that can change what a covered component compiles to changes.

**Threshold**: A change touching an undescribed component passes; a coverage report never sets a non-zero exit; a change to any input a compiled contract depends on - the compiler, the extractor, the shared schemas, the freshness comparison and the comparison logic those depend on, the file that decides which components are covered, any overlay whose allowed children decide another component's mount points, and the dependency versions the checker's printed type text comes from - re-checks every covered component rather than only the touched ones.

**Rationale**: A gate switched on across a whole kit starts almost entirely red and is switched off within a week. Scoping it to the change under review lets coverage expand as a by-product of ordinary work.

**Actors**: `cpt-frontx-ui-kit-actor-continuous-integration`, `cpt-frontx-ui-kit-actor-kit-developer`

#### Package-scoped agent resource manifest

- [ ] `p2` - **ID**: `cpt-frontx-ui-kit-fr-agent-resource-manifest`

The system **MUST** ship its own Constructor Studio kit manifest declaring a skill and a rule under the package's reserved resource prefix, where the skill reads the installed package's documentation rather than duplicating it.

**Threshold**: The shipped manifest validates against the kit specification, both declared resource identifiers carry the reserved prefix, and each declared resource source exists.

**Rationale**: It is how the package's own documentation reaches an agent through the ecosystem's delivery mechanism instead of relying on a project to have wired it up by hand.

**Actors**: `cpt-frontx-ui-kit-actor-ai-agent`

**Status**: Not built. The decision is recorded in [ADR 0022](../../../architecture/ADR/0022-ai-tooling-framework-packaging.md); the package ships no such manifest today.

#### Contracts reaching a consuming project

- [ ] `p2` - **ID**: `cpt-frontx-ui-kit-fr-contract-distribution`

The system **MUST** make a described component's contract readable from an install, so a tool running in a consuming project can check that project's code against the contract of the version it resolved.

**Threshold**: A described component's contract is present in the packaged artifact and reachable by a documented path.

**Rationale**: A contract that stays in this repository can only guard this repository. The check that matters to a product runs in the product.

**Actors**: `cpt-frontx-ui-kit-actor-ai-agent`

**Status**: Not built. Contract artifacts are committed in the repository and are not part of the published artifact today.

- [ ] `p3` - **ID**: `cpt-frontx-ui-kit-fr-contract-release-compatibility`

The system **MUST** be able to compare a described component's contracts against the contracts of a published version of the package, and **MUST** run that comparison before a release is tagged.

**Threshold**: A compatibility run names a published version as its comparison source, reads that version's shipped contracts, and reports the verdict an upgrading consumer would experience; the release job runs it before tagging.

**Rationale**: The comparison against a reference in this repository answers what a change did since a branch point. A consumer upgrading from one release to the next holds no such reference, and the development branch can carry several unreleased contract changes at once, so a set of individually-passing changes does not add up to a passing release. Depends on the contracts reaching the published artifact at all.

**Actors**: `cpt-frontx-ui-kit-actor-ai-agent`, `cpt-frontx-ui-kit-actor-continuous-integration`

**Status**: Not built. Depends on `cpt-frontx-ui-kit-fr-contract-distribution`.

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

The ecosystem-wide NFRs are owned by the [root PRD §6.1](../../../architecture/PRD.md#61-nfr-inclusions) and apply here unchanged. The following are this package's own.

#### Consumer pays only for what it imports

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-nfr-selective-cost`

The system **MUST** keep a consumer's build free of the code and the styles of components that consumer never imports.

**Threshold**: A page importing one component contains that component's style rules and contains no other component's style rules or module code, measured on a real consumer build rather than on this package's own.

**Rationale**: A component base whose cost is all-or-nothing is adopted grudgingly and then partially forked.

#### Enforcement scoped to the change under review

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-nfr-gate-adoptability`

The system **MUST** scope contract enforcement to the components a change touches, and **MUST NOT** derive a build failure from kit-wide coverage.

**Threshold**: The number of components without contracts never affects an exit code.

**Rationale**: Adoptability is the property that decides whether the layer survives its first busy month.

#### Package-local test infrastructure

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-nfr-standalone-verification`

The system **MUST** carry its own test and build configuration and **MUST NOT** depend on infrastructure owned by a template.

**Threshold**: The package's suites and its consumer acceptance run execute from the package alone.

**Rationale**: A published library whose verification depends on template territory cannot be released independently of it.

### 6.2 NFR Exclusions

The root PRD's §6.2 exclusions apply here for the same reasons stated there, with two additions specific to this package:

- **Visual-regression coverage** is excluded. The kit asserts the token seam and two contrast floors; comparing rendered output belongs to the design-verification capability in template territory, not to a published library.
- **Automated accessibility auditing of consuming applications** is excluded for the same reason. The kit takes accessible behaviour from the primitives it wraps and asserts roles and labelling in its own component suites; auditing a product's rendered pages is a template-territory capability.

## 7. Public Library Interfaces

### 7.1 Public API Surface

#### Component package

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-interface-component-package`

**Type**: Library

**Stability**: unstable

**Description**: The component surface, published as an ECMAScript-module package with a barrel entry, a per-component subpath entry, three global stylesheets, and TypeScript declarations resolvable under both module-resolution modes. Internal module paths are explicitly unreachable.

**Documentation Obligation**: Every exported component **MUST** have a usage document in the published artifact and an entry in the shipped index.

**Breaking Change Policy**: A major version bump is required for any incompatible change to the exported surface; minor and patch versions preserve backward compatibility. The package is on a pre-release line until its component set is complete.

#### Shipped agent documentation

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-interface-agent-documentation`

**Type**: Data

**Stability**: unstable

**Description**: The documentation index at the package root and the per-component usage documents in the published artifact. Consumed by agents and by template-owned skills, which read the installed copy rather than duplicating its content.

**Documentation Obligation**: The index **MUST** name the path of every component document it lists, so a reader resolves it against the install.

**Breaking Change Policy**: Removing a document or renaming its path is a breaking change to this surface and follows the package's major line.

### 7.2 External Integration Contracts

None owned here. The package is distributed under the root PRD's package-registry distribution contract (`cpt-frontx-contract-package-registry-distribution`). Component contracts are not an external contract today - they are repository artifacts, and making them consumer-readable is `cpt-frontx-ui-kit-fr-contract-distribution`, which is not built.

## 8. Use Cases

#### Kit Developer describes a component and changes it

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-usecase-describe-and-change-component`

**Actor**: `cpt-frontx-ui-kit-actor-kit-developer`

**Preconditions**:
- The component exists in the package and declares its variant axes and props in TypeScript.

**Main Flow**:
1. The Kit Developer authors the component's overlay, stating meaning only (`cpt-frontx-ui-kit-fr-contract-single-fact-owner`).
2. The Kit Developer compiles the contract, which joins the overlay to the facts read from the component's TypeScript (`cpt-frontx-ui-kit-fr-component-contract`).
3. The Kit Developer opts the component into coverage and commits the compiled artifacts alongside the source.
4. The Kit Developer later changes the component; the conformance suite fails until the artifacts are recompiled (`cpt-frontx-ui-kit-fr-contract-freshness`).
5. Continuous integration compares the changed contract against the base reference and reports whether the change is backward compatible (`cpt-frontx-ui-kit-fr-contract-compatibility`).

**Postconditions**:
- The component's committed contract equals a fresh compile, and any incompatible difference has been named.

**Alternative Flows**:
- **Overlay restates a machine-owned fact**: the compile is refused naming the field; nothing is written.
- **Incompatible change with the contract major moved**: the comparison passes and names the move and every reason.
- **Component is not opted into coverage**: the change passes with the component reported as not yet requiring a contract.

#### AI Agent composes a screen from the kit

- [ ] `p1` - **ID**: `cpt-frontx-ui-kit-usecase-compose-screen`

**Actor**: `cpt-frontx-ui-kit-actor-ai-agent`

**Preconditions**:
- A project has the package installed and the agent can read the installed artifact.

**Main Flow**:
1. The AI Agent reads the shipped index and the usage document of each candidate component (`cpt-frontx-ui-kit-fr-agent-documentation`).
2. The AI Agent selects components and writes the screen, importing each from the barrel or its subpath (`cpt-frontx-ui-kit-fr-component-set`).
3. The AI Agent styles the screen through the kit's tokens rather than introducing appearance values (`cpt-frontx-ui-kit-fr-token-styling`).
4. For a described component, a tool checks the written code against that component's contract (`cpt-frontx-ui-kit-fr-component-contract`).

**Postconditions**:
- The screen composes kit components and carries no appearance value the kit does not define.

**Alternative Flows**:
- **Component not described**: only the usage document is available, and the check in step 4 does not apply.

**Status**: Step 4 depends on `cpt-frontx-ui-kit-fr-contract-distribution`, which is not built: contracts do not reach an install today, so the check is available inside this repository only.

## 9. Acceptance Criteria

- [x] Every exported component resolves from the barrel and from its own subpath under both module-resolution modes, and no internal path resolves - verifiable via `cpt-frontx-ui-kit-fr-component-set`.
- [x] A consumer build that imports one component carries that component's styles and no other component's styles or code - verifiable via `cpt-frontx-ui-kit-nfr-selective-cost` and `cpt-frontx-ui-kit-fr-consumer-acceptance`.
- [x] No component stylesheet introduces an appearance value the kit's theme does not define, and every token defined for one theme is defined for the other - verifiable via `cpt-frontx-ui-kit-fr-token-styling` and `cpt-frontx-ui-kit-fr-theme-selection`.
- [x] The client-boundary classification is derived from the source and agrees everywhere it is stated, and the published artifact carries the directive for exactly the classified components - verifiable via `cpt-frontx-ui-kit-fr-client-boundary`.
- [x] Every exported component has a usage document in the published artifact and an entry in the shipped index - verifiable via `cpt-frontx-ui-kit-fr-agent-documentation`.
- [x] A described component's contract states its variant axes with defaults, carries both the props the component declares and the props the primitive states for the part it wraps, references the forwarded surface of the element it renders rather than restating it, and marks a prop with no machine-checkable shape rather than dropping it - verifiable via `cpt-frontx-ui-kit-fr-component-contract`.
- [x] An overlay that restates a machine-owned fact, or names a prop that does not exist, is refused naming the offence - verifiable via `cpt-frontx-ui-kit-fr-contract-single-fact-owner`.
- [x] A prop a described component's contract does not evaluate validates and is reported as unchecked, and a name one edit from a prop that contract declares is reported as a probable misspelling of it - verifiable via `cpt-frontx-ui-kit-fr-contract-unchecked-prop-report`.
- [x] A change leaving a described component's committed contract unequal to a fresh compile is refused, naming the regeneration command - verifiable via `cpt-frontx-ui-kit-fr-contract-freshness`.
- [x] A backward-incompatible contract difference is refused at an unchanged contract major and accepted once the major moves, naming every reason in both cases - verifiable via `cpt-frontx-ui-kit-fr-contract-compatibility`.
- [x] A change touching an undescribed component passes, kit-wide coverage never sets a non-zero exit, and a change to the shared contract tooling re-checks every covered component - verifiable via `cpt-frontx-ui-kit-fr-contract-incremental-coverage` and `cpt-frontx-ui-kit-nfr-gate-adoptability`.
- [ ] A consuming project can read a described component's contract from its install - verifiable via `cpt-frontx-ui-kit-fr-contract-distribution`.
- [ ] A release is gated by a compatibility verdict computed against the previously published version, not only against a reference in this repository - verifiable via `cpt-frontx-ui-kit-fr-contract-release-compatibility`.
- [ ] The package ships a validating Constructor Studio kit manifest whose resources carry the reserved prefix - verifiable via `cpt-frontx-ui-kit-fr-agent-resource-manifest`.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| Headless component primitives | Supply the behaviour and accessibility of the components the kit styles, so the kit owns appearance and composition rather than interaction mechanics. Two components take their behaviour from a second primitive library rather than the main one. | p1 |
| Component capability libraries | Supply the model layers a handful of components could not implement themselves: the data grid, charting, the command palette, calendar and date arithmetic, the carousel, resizable panels, and the icon set. Each belongs to the component that needs it. They are installed with the package whether or not those components are imported; keeping them out of a consumer's build is the package build's per-entry emission, which is what `cpt-frontx-ui-kit-nfr-selective-cost` measures. | p2 |
| React | The rendering model the components are written against, taken as a peer dependency so a consuming application owns the version. | p1 |
| Variant-authoring library | Declares each component's variant axes and defaults in the code, which is what makes those axes machine-readable rather than documented by hand. | p1 |
| TypeScript compiler API | Reads a component's prop surface for the contract compiler; the reason a contract can be derived rather than transcribed. | p1 |
| Type-definition specification | Supplies the identifier grammar the contracts are named in and the backward-compatibility comparison the compatibility check builds on. It is the same specification the ecosystem's default type-system provider implements. | p1 |
| npm-compatible package registry (`cpt-frontx-actor-package-registry`) | Distributes the published artifact to consuming applications. | p1 |

## 11. Assumptions

- A consuming application owns its React version and its bundler; the package adapts to the consumer rather than the reverse.
- A component's variant axes and props are declared in its own TypeScript, which is what makes them extractable. A component that hides them behind an indirection the compiler cannot follow is a component the kit must change, not a case for restating the facts by hand.
- The components the compiler must describe are built on the primitive family it recognizes, so it can tell that family's props for a part - the component's own API - from React's attributes for the element underneath. A component built on a different primitive family is new work on the compiler.
- Coverage is expected to grow with ordinary work rather than through a dedicated campaign.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Description cost outweighs its value for components whose props resist machine representation. | Coverage stalls on exactly the complex components where description would help most. | The contract records what could not be represented instead of pretending completeness, so the gap is visible rather than silently absorbed; coverage stays opt-in so a costly component does not block the rest. |
| The compiler recognizes only some primitive families, so a component built on another cannot be described at all. | Parts of the kit are structurally out of reach of the knowledge layer. | The limit is stated in this PRD's assumptions and the compiler refuses loudly rather than emitting a contract with an invented surface. Extending it is design work on the compiler, not configuration. |
| Contracts stay inside the repository, so the check that matters to a product cannot run in the product. | The knowledge layer guards the kit's own changes but not an agent's output in a consuming project. | Recorded as `cpt-frontx-ui-kit-fr-contract-distribution`, unbuilt and marked as such rather than implied by the layer's existence. |
| The kit's own prose documentation drifts from the component set it describes. | An agent reads a description that does not match the installed surface. | The documentation guard holds every exported component to having an indexed document; the drift risk that remains is in the prose bodies, which no check reads. |
| The vendor namespace the contract identifiers are built on is not settled: a shorter form and a form carrying a design segment were both proposed and neither was chosen. | Every committed contract, instance and passthrough surface carries the namespace in its own identifier, so the migration cost rises with every component described. | The namespace lives in one constant, so the change itself stays a one-line edit. The decision is to be taken before coverage grows past the pilot components, which is the point at which the rewrite stops being cheap. |
| Whether a type-system runtime is expected to act on the meaning fields, or only to validate and store them, is unanswered. | If a runtime acts on them, the fields currently held as prose have to move into the validator-read half, changing every compiled contract's shape. | The two halves are produced from one routing map rather than two hand-maintained lists, so the move is a change to that map and a recompile. The trigger is the answer to that question in the ecosystem's type-substrate decision. |
