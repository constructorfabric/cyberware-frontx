# Feature: Component Contracts

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-featstatus-component-contracts`

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Compile A Component's Contracts](#compile-a-components-contracts)
  - [Guard A Change Against The Base Reference](#guard-a-change-against-the-base-reference)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Component Fact Extraction](#component-fact-extraction)
  - [Overlay Admission](#overlay-admission)
  - [Contract Compilation](#contract-compilation)
  - [Metamodel Instance Assembly](#metamodel-instance-assembly)
  - [Inherited-Surface Type Construction](#inherited-surface-type-construction)
  - [Contract Identifier Construction](#contract-identifier-construction)
  - [Trait Schema Derivation](#trait-schema-derivation)
  - [Freshness Comparison](#freshness-comparison)
  - [Compatibility Decision](#compatibility-decision)
  - [Comparison Source Beyond The Repository](#comparison-source-beyond-the-repository)
  - [Per-Contract Comparison Against The Base Reference](#per-contract-comparison-against-the-base-reference)
  - [Contracts Removed Since The Base Reference](#contracts-removed-since-the-base-reference)
  - [Guard Scope And Verdicts](#guard-scope-and-verdicts)
  - [Coverage Report](#coverage-report)
  - [Conformance Suite Construction](#conformance-suite-construction)
- [4. States (CDSL)](#4-states-cdsl)
  - [No Lifecycle To Model](#no-lifecycle-to-model)
- [5. Definitions of Done](#5-definitions-of-done)
  - [An Overlay States Meaning Only](#an-overlay-states-meaning-only)
  - [Facts Come From The Code, By Symbol Identity](#facts-come-from-the-code-by-symbol-identity)
  - [A Contract Joins Meaning To The Extracted Surface](#a-contract-joins-meaning-to-the-extracted-surface)
  - [Contracts Are Named In The Type System's Grammar](#contracts-are-named-in-the-type-systems-grammar)
  - [The Validator-Read Block Is Derived, Not Restated](#the-validator-read-block-is-derived-not-restated)
  - [A Described Component's Artifacts Equal A Fresh Compile](#a-described-components-artifacts-equal-a-fresh-compile)
  - [Each Described Component Carries Its Own Conformance Suite](#each-described-component-carries-its-own-conformance-suite)
  - [An Incompatible Change Moves The Contract Major](#an-incompatible-change-moves-the-contract-major)
  - [Enforcement Is Scoped To The Change](#enforcement-is-scoped-to-the-change)
  - [Kit-Wide Coverage Is Reported, Never Enforced](#kit-wide-coverage-is-reported-never-enforced)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

## 1. Feature Context

The feature-entry identifier the kit's template places here is deliberately absent. That identifier kind is owned by a DECOMPOSITION, and a layer member owns no DECOMPOSITION, so declaring one here would be a reference with no definition. `cpt-frontx-ui-kit-featstatus-component-contracts` above carries this feature's identity instead.

### 1.1 Overview

The agent knowledge layer of the kit: for a component that has been described, a compiled contract that states the component's meaning next to the prop facts read out of its own TypeScript, and the checks that keep the two from disagreeing - a per-component conformance suite, a freshness comparison, a compatibility comparison against the change's base reference, and a guard scoped to the components a change touches.

### 1.2 Purpose

Prose describing a component can only be reviewed by a person, one screen at a time. This feature produces a description a tool can act on and then refuses to let it rot: a described component's committed contract must equal a fresh compile of that component, and a change that narrows a described surface must move the contract's own major version or be refused. The scope of enforcement is the change under review, never the whole kit, because a gate that starts almost entirely red is a gate that gets switched off.

**Requirements**: `cpt-frontx-ui-kit-fr-component-contract`, `cpt-frontx-ui-kit-fr-contract-single-fact-owner`, `cpt-frontx-ui-kit-fr-contract-freshness`, `cpt-frontx-ui-kit-fr-contract-compatibility`, `cpt-frontx-ui-kit-fr-contract-incremental-coverage`, `cpt-frontx-ui-kit-nfr-gate-adoptability`

**Principles**: `cpt-frontx-ui-kit-principle-code-is-the-fact-owner`, `cpt-frontx-ui-kit-principle-scoped-enforcement`

**Components**: `cpt-frontx-ui-kit-component-contract-harness`, `cpt-frontx-ui-kit-component-component-surface`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-ui-kit-actor-kit-developer` | Authors a component's overlay, compiles its contracts, commits them beside the component, and recompiles when the component changes |
| `cpt-frontx-ui-kit-actor-continuous-integration` | Invokes the guard, the compatibility check and the coverage report with the base reference of the change under review |
| `cpt-frontx-ui-kit-actor-ai-agent` | The reader the contract exists for; it consumes a described component's contract rather than its prose |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Dependencies**: None inside this package. The invocation and the base reference come from outside it: a repository-level policy script passes the base reference of the change under review to the commands this feature specifies, so the same commands serve a developer's local run and a continuous-integration run without knowing which they are in. That script and its workflow step are repository tooling and are not specified here.

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-ui-kit-usecase-describe-and-change-component`

### Compile A Component's Contracts

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-flow-component-contracts-compile`

**Actor**: `cpt-frontx-ui-kit-actor-kit-developer`

**Realizes**: `cpt-frontx-ui-kit-seq-contract-compile-and-guard`

**Success Scenarios**:
- Developer writes an overlay stating meaning only, runs the compile command for the component's directory, and the contract, the metamodel instance and any shared inherited-surface type are written beside the component and under the harness, each written path reported.
- A directory exporting several components compiles one contract per overlay in it, each named for the export it describes.
- Developer asks for the shared schemas instead of a directory, and the abstract base type, the metamodel and every vocabulary type are written from their builders, each written path reported.

**Error Scenarios**:
- No directory named: the usage line is printed and the run fails.
- The directory carries no overlay: the directory is named and the run fails, so a mistyped directory cannot look like a successful no-op.
- The overlay restates a fact the compiler reads from the code, carries a field the vocabulary does not define, or names a prop the component does not declare: the compile is refused naming the offence and nothing is written.
- The component inherits props from a primitive whose origin the compiler cannot place: the compile is refused naming the props it would have had to drop.

**Steps**:
1. [x] - `p1` - Developer authors the overlay beside the component, stating meaning only - `inst-author-overlay`
2. [x] - `p1` - Developer runs the compile command naming the component's directory - `inst-invoke-compile`
3. [x] - `p1` - **IF** the shared schemas are asked for instead of a directory - `inst-write-shared`
   1. [x] - `p1` - Write the vocabulary types, then the abstract base type and the metamodel that reference them, reporting each path, and **RETURN** - `inst-write-shared`
4. [x] - `p1` - **IF** no directory is named - `inst-missing-argument`
   1. [x] - `p1` - Print the usage line and **RETURN** a non-zero exit - `inst-usage-exit`
5. [x] - `p1` - **IF** the directory carries no overlay - `inst-no-overlay`
   1. [x] - `p1` - Name the directory and **RETURN** a non-zero exit - `inst-no-overlay-exit`
6. [x] - `p1` - **FOR EACH** overlay in the directory, compile the contract and the metamodel instance and write both beside the component - `inst-compile-each`
7. [x] - `p1` - **RETURN** each written path to the developer as it is written - `inst-report-paths`
8. [x] - `p1` - Write the shared inherited-surface type when the component resolves an origin for it, reporting that path too - `inst-write-passthrough`

### Guard A Change Against The Base Reference

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Actor**: `cpt-frontx-ui-kit-actor-continuous-integration`

**Realizes**: `cpt-frontx-ui-kit-seq-contract-compile-and-guard`

**Success Scenarios**:
- The guard holds every component in the change's scope to a fresh, complete contract and reports each verdict; a change touching only undescribed components passes with each reported as not yet requiring one.
- The compatibility check compares every committed contract against the base reference and reports each as compatible, as incompatible with the contract major moved, or as refused.
- The coverage report prints the described set against the component set and never fails.

**Error Scenarios**:
- A subcommand invoked without the base reference it needs, or a subcommand the command does not answer to: the usage line is printed and the run fails.
- A covered component's committed artifacts no longer equal a fresh compile: the run fails naming the component and the command that regenerates it.
- A covered component's directory no longer exists: the run fails, because the allowlist still names it.
- A contract narrowed at an unchanged major: the run fails naming every reason.

**Steps**:
1. [x] - `p1` - Continuous integration invokes the check command with a subcommand and the change's base reference - `inst-invoke-check`
2. [x] - `p1` - **IF** the subcommand needs a base reference and none was given - `inst-usage`
   1. [x] - `p1` - Print the usage line and **RETURN** a non-zero exit - `inst-usage-exit`
3. [x] - `p1` - **IF** the subcommand is not one this command answers to - `inst-unknown-subcommand`
   1. [x] - `p1` - Print the usage line naming every subcommand and **RETURN** a non-zero exit - `inst-unknown-subcommand-exit`
4. [x] - `p1` - **IF** the base reference given does not name a commit in this repository - a typo, a branch never fetched, a clone missing the commit - name it and **RETURN** a non-zero exit without running the check, because against a reference that does not exist every contract reads as new and every removal reads as nothing - `inst-verify-base`
5. [x] - `p1` - **IF** the subcommand is the guard - `inst-dispatch-guard`
   1. [x] - `p1` - Hold every in-scope component to a fresh contract and **RETURN** a non-zero exit on any violation - `inst-guard-exit`
6. [x] - `p1` - **IF** the subcommand is the compatibility check - `inst-dispatch-compat`
   1. [x] - `p1` - Compare every committed contract against the base reference, sweep for the contracts that only exist there, and **RETURN** a non-zero exit on any refusal - `inst-compat-exit`
7. [x] - `p1` - **IF** the subcommand is the coverage report - `inst-dispatch-coverage`
   1. [x] - `p1` - Print the report and **RETURN** success whatever the numbers are - `inst-coverage-exit`

## 3. Processes / Business Logic (CDSL)

### Component Fact Extraction

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-extraction`

**Input**: The path of a component's source file.

**Output**: One extraction per exported React component - its variant axes and defaults, its declared props, its inherited props, the origin of its inherited surface, and a note for each thing the walk could not read: an unresolvable variant declaration, a conflicting axis or default, an unclassifiable heritage node, a property with no declaration behind it.

**Steps**:
1. [x] - `p1` - Build a TypeScript program over the component's source alone, using the package's own shipping-source compiler options, so an extraction depends on the file it reads and on nothing else that shared the run - `inst-ex-program`
   1. [x] - `p1` - Where an answer is only counted and never written into an artifact - which of a file's exports are components, what every export is called - take it from one program shared across every file the run asks about, or from the parsed syntax with no program at all, and keep it out of the extraction an artifact is compiled from - `inst-ex-shared-program`
2. [x] - `p1` - **FOR EACH** exported declaration, keep the ones that are React components, unwrapping a wrapper by its resolved symbol rather than by the name it was imported under - `inst-ex-candidates`
3. [x] - `p1` - Walk the first parameter's props type, classifying each heritage reference by its resolved symbol and the file that declares it - `inst-ex-heritage`
4. [x] - `p1` - Trace each variant-type reference to the variant declaration it derives from and read the axes and their defaults there - `inst-ex-axes`
5. [x] - `p1` - **IF** two heritage entries declare the same axis - `inst-ex-axis-conflict`
   1. [x] - `p1` - Record the conflict naming both sources, rather than letting one silently overwrite the other - `inst-ex-axis-conflict-note`
6. [x] - `p1` - **IF** two heritage entries declare the same default - `inst-ex-default-conflict`
   1. [x] - `p1` - Record it the same way, for the same reason - `inst-ex-default-conflict-note`
7. [x] - `p1` - Resolve the origin of the inherited surface from the outermost heritage member the walk can place - `inst-ex-origin`
8. [x] - `p1` - **FOR EACH** resolved property of the props type, classify it as declared here or inherited by where its declaration lives - `inst-ex-props`
9. [x] - `p1` - Record a heritage node the walk cannot classify as a note, instead of silently returning with the props behind it unaccounted for - `inst-ex-cannot`
10. [x] - `p1` - Record a property the checker resolves but no declaration backs, and skip it, rather than reporting an invented declaration site for it - `inst-ex-undeclared-prop`
11. [x] - `p1` - **RETURN** one extraction per exported component, with both prop lists ordered by name - `inst-ex-return`

### Overlay Admission

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-overlay-admission`

**Input**: The artifact being compiled and the parsed overlay document.

**Output**: The admitted overlay, or a refusal naming the offence. Every check before the return reads the document alone and runs as it is parsed; the last needs the extraction and so runs once the overlay has been returned, against the component's real props.

**Steps**:
1. [x] - `p1` - **IF** the overlay carries a field the code owns - `inst-oa-machine-owned`
   1. [x] - `p1` - Refuse, naming each such field - `inst-oa-machine-owned-refuse`
2. [x] - `p1` - **IF** the overlay carries a field the vocabulary does not define, or a field of the wrong shape - `inst-oa-unknown-field`
   1. [x] - `p1` - Refuse, naming the field and its position in the document - `inst-oa-unknown-field-refuse`
3. [x] - `p1` - Admit the alternative a "don't" names in either of the two forms that resolve - a reference to a component this kit ships, or an explicit statement of what to use outside the kit with the reason no kit component fits - and refuse any other shape - `inst-oa-alternative`
4. [x] - `p1` - **IF** the component the overlay declares is not the one being compiled - `inst-oa-name-mismatch`
   1. [x] - `p1` - Refuse, naming both - `inst-oa-name-mismatch-refuse`
5. [x] - `p1` - **RETURN** the admitted overlay - `inst-oa-return`
6. [x] - `p1` - **IF** the admitted overlay references a prop the component does not declare - `inst-oa-absent-prop`
   1. [x] - `p1` - Refuse, naming the prop - `inst-oa-absent-prop-refuse`

### Contract Compilation

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compilation`

**Input**: A component directory and the artifact stem being compiled.

**Output**: The compiled contract - a closed props schema carrying the component's meaning in a validator-read block and a prose block.

**Steps**:
1. [x] - `p1` - Select the extraction whose exported component is the one being compiled, failing when no export matches - `inst-cc-select`
2. [x] - `p1` - **IF** the extraction could not resolve a variant declaration - `inst-cc-axis-failure`
   1. [x] - `p1` - Fail rather than emit a contract silently missing its axes - `inst-cc-axis-failure-refuse`
3. [x] - `p1` - Fail when the component inherits props and no origin was resolved for them, naming the props no type could have declared - `inst-cc-orphan-inherited`
4. [x] - `p1` - Turn each variant axis into an enumerated property carrying its default - `inst-cc-axes`
5. [x] - `p1` - Leave a prop the inherited surface already declares to that surface, failing when the two declare conflicting shapes - `inst-cc-owner-conflict`
6. [x] - `p1` - Represent a declared prop that has no schema equivalent as an annotated property recorded as a slot, letting no property leave the compiler asserting nothing and saying nothing - `inst-cc-slots`
7. [x] - `p1` - Route each meaning field to the block a validator reads or to the block that is prose, exactly once - `inst-cc-route`
8. [x] - `p1` - Close the derived type so an undeclared prop is refused while the inherited surface still resolves - `inst-cc-close`
9. [x] - `p1` - **RETURN** the contract after validating its validator-read block against the base type's trait schema - `inst-cc-return`

### Metamodel Instance Assembly

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-instance`

**Input**: A component directory and the artifact stem being compiled.

**Output**: The metamodel instance for that artifact.

**Steps**:
1. [x] - `p1` - Assemble the instance from the admitted overlay in the metamodel's own field order, naming the contract as its props schema - `inst-mi-assemble`
2. [x] - `p1` - **RETURN** it after validating it against the metamodel - `inst-mi-validate`

### Inherited-Surface Type Construction

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-passthrough`

**Input**: An origin, the element kind behind it, the inherited props, and the components already recorded against that origin.

**Output**: The shared type for that origin, or a refusal.

**Steps**:
1. [x] - `p1` - Declare each inherited prop under the origin's own type, giving a schema shape where one exists and, where none does, stating the prop's TypeScript type and that nothing asserts it rather than leaving the property blank, and list it in the type's own `required` when the extraction reported it as non-optional; the props that carry no consumer-visible shape at all - the element key and the forwarded ref - are left out entirely - `inst-ps-props`
2. [x] - `p1` - Admit the accessibility and data attribute families by pattern rather than by name - `inst-ps-patterns`
3. [x] - `p1` - Record which components the type was generated from, and leave the type open so a component's own contract can close its surface instead - `inst-ps-open`
4. [x] - `p1` - **IF** compiling one component would change the shape another component on the same origin already relies on - the declared props or which of them are mandatory, the whole surface the origin owns - `inst-ps-collision`
   1. [x] - `p1` - Refuse, naming the other components and the file they share - `inst-ps-collision-refuse`

### Contract Identifier Construction

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-identifiers`

**Input**: A component name, a contract major, an inherited-surface origin, or a vocabulary concept.

**Output**: The identifier for the artifact, and the patterns that recognize each identifier shape.

**Steps**:
1. [x] - `p1` - Derive the identifier token from the name of the export being described - the directory name where a directory describes one component, the overlay stem where it describes a part of a compound one - `inst-id-token`
2. [x] - `p1` - Build the props-schema identifier by chaining the component's segment onto the abstract base type, and make that identifier what a reference to the component holds - a component is the type derived from the base, so there is no second identifier to point at - `inst-id-props-schema`
3. [x] - `p1` - Build the metamodel instance identifier from the same segment, without the terminator that would make it a type - `inst-id-instance`
4. [x] - `p1` - Build the inherited-surface type identifier from the origin - `inst-id-passthrough`
5. [x] - `p1` - Build the vocabulary type identifier from its concept token - `inst-id-trait-type`
6. [x] - `p1` - **RETURN** the patterns that recognize each identifier shape - `inst-id-patterns`

### Trait Schema Derivation

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-trait-schema`

**Input**: The metamodel's field definitions.

**Output**: The vocabulary types the overlay is made of, and the trait schema the abstract base type carries, against which every contract's validator-read block is checked. How those types relate is the domain model in section 3.1 of the package DESIGN.

**Steps**:
1. [x] - `p1` - Build one type per concept the metamodel references, currently twelve - a rule against a use and the alternative outside the kit it may name, a composition and each of its two directions, a deprecation and the per-prop deprecation it holds, a coverage claim with its verdict and its assumptions, a family membership, an extension point - each with its own identifier - `inst-ts-vocabulary`
   1. [x] - `p1` - State the child-composition kind that means "no children at all" as the only kind a list may hold, so a list cannot say both that nothing may appear inside a component and that something may - `inst-ts-children-exclusive`
2. [x] - `p1` - Take the metamodel's definitions of exactly the fields a validator reads - `inst-ts-fields`
3. [x] - `p1` - State each of those fields as a reference to the type that owns its shape, so the trait schema and the metamodel resolve one definition rather than each carrying a copy - `inst-ts-ref`
4. [x] - `p1` - Declare a field that HOLDS another type's identifier with all three of what it must resolve to, the value kind and the grammar of the identifier, because the type store removes the resolution annotation before validating and drops a branch left carrying nothing else - `inst-ts-id-value`
5. [x] - `p1` - Give each field the metamodel does not require a null alternative and a null default, placed after the reference so the referenced type does not overwrite it, so the store finds a value for every declared trait - `inst-ts-nullable`
6. [x] - `p1` - **RETURN** the trait schema - `inst-ts-return`

### Freshness Comparison

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-freshness`

**Input**: A component directory and the artifact stem to check.

**Output**: The differences found, and whether the artifact is fresh.

**Steps**:
1. [x] - `p1` - Compare the committed contract and the committed metamodel instance against a fresh compile - `inst-fr-artifacts`
2. [x] - `p1` - Compare every committed schema that belongs to no single component - the abstract base type, the metamodel, and each vocabulary type they reference - against a fresh build on every run, so a stale shared schema is caught by whichever component is checked first - `inst-fr-base`
3. [x] - `p1` - **IF** the component resolves an inherited-surface origin - `inst-fr-passthrough`
   1. [x] - `p1` - Compare that type too, carrying forward the record of which components it was generated from rather than recomputing a fact one component cannot know - `inst-fr-passthrough-compare`
4. [x] - `p1` - Report an annotated property with no slot record, and a slot record on a property that has a schema shape - `inst-fr-slots`
5. [x] - `p1` - **RETURN** fresh only when every comparison came back empty - `inst-fr-return`

### Compatibility Decision

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compat-decision`

**Input**: The two revisions of a contract, their contract majors, and the type system's own backward verdict.

**Output**: A pass or a refusal, with the reasons.

**Steps**:
1. [x] - `p1` - Diff the inherited surface: a removed prop, a changed shape or a dropped value is incompatible, while an added prop is not - `inst-cd-passthrough`
   1. [x] - `p1` - Where the two revisions inherit from different origins, or the newer one inherits nothing, diff by property name and requiredness alone: a name that disappears rejects a call site whichever surface declared it, while a shape that differs between two unrelated surfaces narrows nothing, there having been no one surface to narrow - `inst-cd-passthrough-origin`
2. [x] - `p1` - Diff the declared props: a removed prop and a newly required prop are both incompatible, whether the prop was required before or not - `inst-cd-own`
3. [x] - `p1` - Combine those two with the type system's own backward verdict, which sees neither of them - `inst-cd-combine`
4. [x] - `p1` - **IF** nothing is incompatible - `inst-cd-pass`
   1. [x] - `p1` - **RETURN** a pass - `inst-cd-pass-return`
5. [x] - `p1` - **IF** the contract major moved - `inst-cd-major`
   1. [x] - `p1` - **RETURN** a pass naming the move and every reason - `inst-cd-major-return`
6. [x] - `p1` - **RETURN** a refusal naming the unchanged major and every reason - `inst-cd-fail`

### Comparison Source Beyond The Repository

Planned, not built. The requirement is `cpt-frontx-ui-kit-fr-contract-release-compatibility` in the package PRD; this section states what the algorithm above has to grow when it is built, so the limit is recorded where the comparison is specified rather than only where the requirement is.

**Input**: The comparison source a run is given: a base reference in this repository, or a published version of the package.

**Output**: The contracts to compare the committed ones against.

A base reference answers the question a reviewer has - did this change narrow a surface since the branch point - and it is the only source that exists while contracts stay in the repository. It cannot answer the question a consumer has. Someone upgrading from one released version to the next holds no reference into this repository, and the development branch may carry several unreleased contract changes at once, so a change that passes per pull request does not add up to a release that passes: three individually-acknowledged majors and one unacknowledged narrowing look the same at the branch point and different at the tag.

**What it has to do**:
- [ ] Take the comparison source as a parameter rather than assuming a repository reference, so a run states which question it is answering.
- [ ] Resolve a published version to the contracts shipped in that version's package artifact, or to a cached copy of them, and compare the committed contracts against those.
- [ ] Keep the repository reference as the source a per-change run uses, unchanged.
- [ ] Return the same verdict shape either way, so one decision rule serves both sources.

**Depends on**: `cpt-frontx-ui-kit-fr-contract-distribution` - contracts have to be part of the published artifact before a published version can be read for them. The release job would run the published form before tagging, so that the verdict gating a release is the one a consumer experiences.

### Per-Contract Comparison Against The Base Reference

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compat-unit`

**Input**: One committed contract, the base reference, the rename records and the contracts present at the base reference.

**Output**: That contract's compatibility verdict.

**Steps**:
1. [x] - `p1` - Read the committed contract and the same contract at the base reference - `inst-cu-read`
2. [x] - `p1` - **IF** the contract is absent at the base reference - `inst-cu-rename`
   1. [x] - `p1` - Look for its earlier path by the rename record, then by identifier, then by name, and note the move on every reason if one is found - `inst-cu-rename-resolve`
3. [x] - `p1` - **IF** no earlier version resolves - `inst-cu-new`
   1. [x] - `p1` - Report the contract as new and **RETURN** a pass - `inst-cu-new-return`
4. [x] - `p1` - Register both revisions under distinct synthesized versions, so the type system can compare two states of what is otherwise one identifier - `inst-cu-register`
5. [x] - `p1` - Compare the inherited-surface type at both revisions, reading the origin from each revision's own contract as it shipped rather than from the source as it is now - `inst-cu-passthrough`
   1. [x] - `p1` - Read the origin from the base revision as well as the current one, and decide the comparison from both: nothing to compare when neither inherits; nothing to report when only the current one does, because an inherited surface that arrives only widens; a comparison by forwarded property name and requiredness when the origin moved or the current revision inherits nothing at all, those being the only signals two different surfaces share; the full shape comparison when the origin is unchanged - `inst-cu-passthrough-both`
   2. [x] - `p1` - **IF** the comparison genuinely cannot be made - the base reference carries passthrough types but none for the origin this contract shipped with, or no type is committed for the origin it names now - report the inherited-surface signal as skipped for that origin, without refusing the change - `inst-cu-passthrough-skipped`
6. [x] - `p1` - **RETURN** the decision for this contract, and the base-reference path it was compared against, so a contract that no longer has an heir can be told from one that was never compared - `inst-cu-decide`

### Contracts Removed Since The Base Reference

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compat-removal`

**Input**: The contracts present at the base reference, the base-reference path each committed contract was compared against, and the coverage allowlist.

**Output**: One verdict per contract that exists only at the base reference.

The comparison above walks the contracts on disk and asks each one what it used to be. A contract that is only in the past is walked by nobody, so a deletion was not passed so much as never looked at - and a rename whose two halves neither the rename record nor the identifier nor the name could pair up looks the same. Removing a contract is backward-incompatible on its face: a consumer holding that identifier now resolves nothing, and unlike a narrowing there is no surviving contract whose major could move to acknowledge it. The one acknowledgement this harness records is the one the guard already demands of a removed directory - the allowlist no longer naming the component - so both rules are the same rule.

**Steps**:
1. [x] - `p1` - Subtract every base-reference path some committed contract was compared against from the contracts present at the base reference - `inst-cr-find`
2. [x] - `p1` - **IF** the coverage allowlist still names the component the removed contract described - `inst-cr-decide`
   1. [x] - `p1` - **RETURN** a refusal naming the removed path and the allowlist entry that still promises it - `inst-cr-decide`
   2. [x] - `p1` - Otherwise **RETURN** a pass reporting the removal as acknowledged, naming what disappeared - `inst-cr-decide`
3. [x] - `p1` - Report those verdicts alongside the per-contract ones, so one run states both what changed and what is gone - `inst-cr-sweep`

### Guard Scope And Verdicts

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-guard`

**Input**: The base reference and the coverage allowlist.

**Output**: One verdict per component directory in scope.

**Steps**:
1. [x] - `p1` - Collect the change set from the base-reference diff, the working tree and the untracked files, so an uncommitted edit cannot slip past - `inst-gd-changed`
2. [x] - `p1` - Map the changed paths to component directories - `inst-gd-map`
3. [x] - `p1` - **IF** the change touches the shared contract tooling - `inst-gd-widen`
   1. [x] - `p1` - Widen the scope to every covered component, because a change there can change what any of them compiles to - `inst-gd-widen-scope`
   2. [x] - `p1` - Widen it the same way when the change touches the coverage allowlist itself, for a different reason: the allowlist decides which components are held to the standard at all, so the one file that grants coverage must not be the one file coverage never looks at - `inst-gd-widen-allowlist`
4. [x] - `p1` - **IF** nothing is in scope - `inst-gd-empty`
   1. [x] - `p1` - Report it and **RETURN** without failing - `inst-gd-empty-return`
5. [x] - `p1` - **FOR EACH** directory in scope, decide its verdict - `inst-gd-each`
6. [x] - `p1` - A covered directory that no longer exists is a violation naming the allowlist; an absent directory that is not covered is only reported - `inst-gd-removed`
7. [x] - `p1` - A directory that is not covered requires no contract yet and is only reported - `inst-gd-uncovered`
8. [x] - `p1` - A covered directory needs an overlay for every component it exports, and its committed artifacts must equal a fresh compile - `inst-gd-covered`
9. [x] - `p1` - **RETURN** the verdicts - `inst-gd-return`

### Coverage Report

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-coverage`

**Input**: The component directories and the coverage allowlist.

**Output**: The described set against the component set, with a per-directory breakdown of what is not yet described.

**Steps**:
1. [x] - `p1` - Count the component directories and the ones the allowlist covers - `inst-cv-count`
2. [x] - `p1` - **FOR EACH** uncovered directory, pair its described exports with its component exports and the exports that are correctly not components - `inst-cv-uncovered`
3. [x] - `p1` - Report every allowlist entry that grants coverage over nothing - one naming no component directory, one naming a directory that carries no overlay - and leave those entries out of the described count, which is meant to say how much of the kit is described - `inst-cv-allowlist`
4. [x] - `p1` - **RETURN** the report by whichever output path was asked for, setting no exit code either way - `inst-cv-return`

### Conformance Suite Construction

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-conformance`

**Input**: A component directory and the artifact stem to assert.

**Output**: A test suite for that artifact, and a trait-validation helper the per-component suites share.

**Steps**:
1. [x] - `p1` - Declare a suite asserting the committed contract, the committed instance and the inherited-surface type equal a fresh compile, reporting each difference - `inst-cf-freshness`
2. [x] - `p1` - Assert every annotated property has a slot record and no property with a schema shape has one - `inst-cf-slots`
3. [x] - `p1` - Assert every committed shared schema - the abstract base type, the metamodel, each vocabulary type - equals a fresh build, and that each vocabulary identifier obeys its own grammar - `inst-cf-base`
4. [x] - `p1` - Validate a contract's traits through the type store against the base type's trait schema, in a registry holding the vocabulary that schema references - `inst-cf-traits`
5. [x] - `p1` - Resolve every component identifier the contract holds - a `don't` alternative, a composition kind, a family member - against the kit itself rather than against the type registry, because the type system's reference validator does not follow a reference into another type and most referenced components ship no contract yet: each must name a component the kit ships, and where that component ships a contract the identifier must equal that contract's current props-schema identifier in full, majors included, so a component moving its major moves every reference to it - `inst-cf-refs`
6. [x] - `p1` - Resolve the instance's own props-schema identifier through the type store, which does reach a reference declared directly on an instance property, so a contract absent from the registry fails by name - `inst-cf-instance-ref`

## 4. States (CDSL)

### No Lifecycle To Model

Not applicable. Nothing here has a lifecycle: extraction, compilation and every check are computations over the repository at one revision, and a contract holds no state between runs. The nearest thing to a state - whether a component is described, fresh, stale or removed - is the guard's per-directory verdict, and it is derived on every run rather than stored. It is specified as `cpt-frontx-ui-kit-algo-component-contracts-guard`.

## 5. Definitions of Done

### An Overlay States Meaning Only

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-overlay-admission`

The system **MUST** refuse a hand-authored overlay that restates a field the code owns, carries a field the overlay vocabulary does not define, declares a component other than the one being compiled, or references a prop the component does not declare - naming the offence in each case and writing nothing. Where an overlay states an alternative to a use it rules out, the system **MUST** admit both a reference to a component this kit ships and an explicit statement that the alternative lies outside the kit, and no other shape: a reader that cannot tell a recommendation from a stand-in named only because the field demanded one is worse served than by no alternative at all.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-overlay-admission`
- `cpt-frontx-ui-kit-flow-component-contracts-compile`

**Constraints**: `cpt-frontx-ui-kit-constraint-overlay-meaning-only`

**Touches**:
- Entities: `Overlay`

### Facts Come From The Code, By Symbol Identity

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-extraction`

The system **MUST** read a component's exported components, variant axes and defaults, declared props, inherited props and inherited-surface origin from its TypeScript through the compiler's own resolution - never from the names an identifier happens to be written under - and **MUST** record any shape it cannot classify rather than dropping it. An extraction that a contract is compiled from **MUST** depend on the component's own source and nothing else that shared the run: the compiler prints a type's module specifier and orders a union's members from what the whole compilation holds, so an extraction taken from a compilation covering several components is a different extraction, and **MUST NOT** reach an artifact. Where the answer is only counted - which of a file's exports are components, what every export is called - the system **MAY** take it from one shared compilation, or from the syntax with no compilation at all.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-extraction`

**Constraints**: `cpt-frontx-ui-kit-constraint-overlay-meaning-only`

**Touches**:
- Entities: `Extraction`, `Component`

### A Contract Joins Meaning To The Extracted Surface

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-compilation`

The system **MUST** compile an admitted overlay and an extraction into a closed props schema whose properties carry the variant axes with their defaults and the component's declared props, whose inherited surface is referenced rather than copied, and whose meaning fields are split between the block a validator reads and the block that is prose. Every property it emits, in the contract and in the inherited-surface type alike, **MUST** either assert something about the value or state the TypeScript type behind it and that the type system, not the schema, is what checks it - a property that asserts nothing and says nothing reads to its intended reader as a property that accepts anything. It **MUST** fail rather than emit a contract whose axes could not be resolved or whose inherited props no type could declare.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-compilation`
- `cpt-frontx-ui-kit-algo-component-contracts-instance`
- `cpt-frontx-ui-kit-algo-component-contracts-passthrough`

**Constraints**: `cpt-frontx-ui-kit-constraint-contracts-repository-only`

**Touches**:
- Entities: `Contract`, `Metamodel instance`, `Passthrough type`

### Contracts Are Named In The Type System's Grammar

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-identifiers`

The system **MUST** construct every contract, instance, inherited-surface and vocabulary identifier from one vendor namespace, so that a contract is a type derived from the kit's abstract base type and an instance is not a type at all, and **MUST** expose the patterns that recognize each shape rather than leaving callers to write their own. A reference to a component **MUST** be that component's own derived identifier, not a second identifier standing for the same component, and **MUST** be spelled in the form the type system parses rather than the form a schema keyword requires. A component identifier's token is derived from the name of the export it describes - the directory name where a directory describes one component, the overlay stem where it describes one part of a compound one, so a part carries its own identifier rather than its family's; an inherited-surface identifier takes the origin key the extractor already produced in that token form, so no second derivation applies to it.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-identifiers`

**Touches**:
- Entities: `Contract`, `Metamodel instance`, `Passthrough type`

### The Validator-Read Block Is Derived, Not Restated

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-trait-schema`

The system **MUST** express the overlay's validator-read vocabulary as one type per concept, each with its own identifier, and **MUST** derive the trait schema the abstract base type carries from the metamodel's own field definitions rather than maintaining a second copy of them - by reference, so that a concept is defined once and the trait schema and the metamodel resolve the same definition. It **MUST** make the one mechanical adjustment the type store requires, an optional field given a null alternative and default placed so the referenced type cannot overwrite it, without changing the shape a component that sets those fields must satisfy. Where a field holds the identifier of another type, the declaration **MUST** carry both the reference and the grammar that rejects a malformed identifier, because the type store removes the reference annotation before validating and a declaration left with nothing else in it stops constraining the value at all. Where one value of a field contradicts every other - the child-composition kind meaning "no children at all" - the vocabulary **MUST** state that in the type rather than in prose beside it, so a list cannot say both that nothing may appear inside a component and that something may.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-trait-schema`

**Touches**:
- Entities: `Contract`

### A Described Component's Artifacts Equal A Fresh Compile

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-freshness`

The system **MUST** compare a component's committed contract, metamodel instance and inherited-surface type - and, on every run, every committed schema that belongs to no single component: the abstract base type, the metamodel, and each vocabulary type they reference - against a fresh build, and **MUST** report every difference by path rather than reporting only that something differs.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-freshness`

**Touches**:
- Entities: `Contract`, `Metamodel instance`, `Passthrough type`

### Each Described Component Carries Its Own Conformance Suite

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-conformance`

The system **MUST** provide a reusable suite that fails a component's unit run when its committed artifacts no longer equal a fresh compile, when an annotated property has no slot record or a shaped property has one, or when any committed shared schema has fallen behind - so that staleness reaches the developer who caused it, in the run they already execute. A component's contract **MUST** be validated in a registry holding the vocabulary its trait schema references, and an instance's reference to its own props schema **MUST** be resolved against that registry rather than checked for grammar alone.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-conformance`

**Touches**:
- Entities: `Contract`

### An Incompatible Change Moves The Contract Major

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-compatibility`

The system **MUST** decide a contract's backward compatibility from three signals - the type system's own verdict, the declared-prop diff and the inherited-surface diff - **MUST** treat an addition as compatible and a removal, a narrowing or a newly required prop as not, and **MUST** accept an incompatible difference only when the contract's own major moved, naming every reason either way. It **MUST** read the inherited surface from BOTH revisions of the contract rather than from the current one alone, so that a contract which drops its inherited surface, or moves it to another origin, is compared by what a consumer can still pass rather than skipped for want of something to look up. It **MUST** compare every contract present at the base reference, including one that no committed contract is the heir of: such a removal is backward-incompatible and is accepted only once the coverage allowlist no longer names the component, the same acknowledgement the guard demands of a removed directory. It **MUST** refuse to run at all against a base reference that names no commit in this repository, because every verdict it could give against one would be vacuous. Where a comparison genuinely cannot be made - no file at the base reference for the origin this contract shipped with, no committed file for the origin it names now - the system **MUST** report that signal as skipped rather than let its absence read as agreement.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-compat-decision`
- `cpt-frontx-ui-kit-algo-component-contracts-compat-unit`
- `cpt-frontx-ui-kit-algo-component-contracts-compat-removal`
- `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Touches**:
- Entities: `Contract`, `Passthrough type`

### Enforcement Is Scoped To The Change

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-guard-scope`

The system **MUST** hold to the full standard only the components a change touches that are also opted into coverage, **MUST** widen that scope to every covered component when any file that produces or compares a compiled contract changed - the extractor, the compiler, the identifier and schema inputs, the freshness comparison and the shared comparison logic it depends on - and **MUST** treat a touched but uncovered component as information rather than as a failure. It **MUST** widen the scope the same way, for its own reason, when the coverage allowlist itself changed: the file that decides which components are checked cannot be the one file no check reads, and an entry naming a directory that does not exist or an overlay that was never written **MUST** fail the guard rather than count as coverage. Excluded from the compile-or-compare widening are only the guard's own entry point, because nothing on the comparison path imports it and re-checking on it would be circular, its own tests, and prose.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-guard`
- `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Constraints**: `cpt-frontx-ui-kit-constraint-contracts-repository-only`

**Touches**:
- Entities: `Coverage allowlist`, `Component`

### Kit-Wide Coverage Is Reported, Never Enforced

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-coverage-report`

The system **MUST** report the described set against the component set, with a per-directory breakdown that distinguishes an export still to be described from an export that is correctly not a component, **MUST** name every allowlist entry that grants coverage over nothing and leave it out of the described count, and **MUST NOT** derive an exit code from any of those numbers.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-coverage`
- `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Touches**:
- Entities: `Coverage allowlist`

## 6. Acceptance Criteria

- [x] An overlay restating a field the code owns, carrying an undefined field, declaring the wrong component, or naming an absent prop is refused by name, and no artifact is written.
- [x] An overlay whose alternative to a ruled-out use is a component the kit ships names it by reference; one whose honest alternative is outside the kit says so and why, rather than naming the nearest kit component as a stand-in; anything else in that position is refused.
- [x] A component's variant axes, their values and their defaults appear in its contract as read from the code, and an axis declared twice by two heritage entries is reported naming both rather than silently resolved.
- [x] A wrapper import renamed at its import site, and a locally shadowed utility type of the same name as a real one, are both classified by what they resolve to rather than by what they are called.
- [x] A prop the component declares appears in its contract; a prop it inherits appears in the shared type for its origin and not in the contract's own properties; a prop with no schema equivalent appears as an annotated property with a matching slot record.
- [x] No property of a compiled contract or an inherited-surface type is empty: one that asserts nothing names its TypeScript type and says the type system checks it, so a generic, a function or a union of non-literal members is never readable as an unconstrained value.
- [x] A component whose props inherit from an origin the compiler cannot place is refused naming those props, rather than compiled with them missing.
- [x] A contract's identifier is a type derived from the abstract base type and parses into the expected segments; a metamodel instance's identifier is not a type; a reference to a component is that component's own derived identifier.
- [x] The trait schema carried by the abstract base type equals a fresh derivation from the metamodel, states each of its fields as a reference to the type that owns the concept, and rejects an unknown key in a contract's validator-read block by name.
- [x] A contract validated in a registry that is missing one of the vocabulary types its trait schema references fails naming the unresolved reference, rather than passing against a schema that was never applied.
- [x] A metamodel instance whose props schema is absent from the registry is refused naming the unresolved reference, and one whose reference is malformed is refused by grammar.
- [x] Every committed shared schema - the abstract base type, the metamodel, each vocabulary type - equals a fresh build on every described component's run.
- [x] Editing a described component without recompiling fails that component's own unit run, with the difference reported by path.
- [x] Removing a prop, making an optional prop required, or dropping a value from a variant axis is refused at an unchanged contract major and accepted with the major moved, in both cases naming every reason; adding a prop is accepted either way.
- [x] A contract whose file moved is compared against its earlier path rather than reported as new.
- [x] A change touching a component that is not opted into coverage passes with that component reported as not yet requiring a contract.
- [x] A change to any file on the compile-or-compare path - the shared comparison logic included - re-checks every covered component, not only the ones the change touched; a change to the guard's own entry point does not.
- [x] A contract that stops composing its inherited surface is refused naming every forwarded prop that disappeared with it, rather than passing because there was no origin left to look up.
- [x] A contract whose inherited-surface origin moved is compared by forwarded property name and requiredness across the move, and refused when a prop does not survive it; a move every prop survives passes, naming the move.
- [x] A contract present at the base reference that no committed contract is the heir of is reported as a removal: refused while the coverage allowlist still names its component, accepted and named once it does not; a contract that merely moved is reported as renamed and compared, not as a removal.
- [x] A base reference that names no commit in this repository stops both the guard and the compatibility check with that reference named, instead of a run in which every contract reads as new.
- [x] A covered component whose directory has been removed fails the guard, naming the allowlist entry to remove.
- [x] A change to the coverage allowlist re-checks every component it names; an entry naming no component directory, or a directory with no overlay, fails the guard and is reported by the coverage report without being counted as coverage.
- [x] The coverage report prints the described set against the component set and sets no exit code, whatever the numbers are.
- [x] A children list stating that a component takes no children carries that kind alone; one pairing it with a component reference or with text is refused by the vocabulary.
- [x] Recompiling every described component produces byte-identical artifacts whatever else ran in the same process, and the counting that feeds the coverage report and the guard's completeness check never reaches the extraction a contract is compiled from.
- [ ] A compatibility run states its comparison source, and a run against a published version of the package reports what a consumer upgrading to the committed contracts would experience - not only what changed since a branch point.
