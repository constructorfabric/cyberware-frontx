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
  - [Host Element Surface](#host-element-surface)
  - [Structure derivation](#structure-derivation)
  - [Property Statements And Their Pairing](#property-statements-and-their-pairing)
  - [Prop Classification Report](#prop-classification-report)
  - [Contract Identifier Construction](#contract-identifier-construction)
  - [Meaning Schema Derivation](#meaning-schema-derivation)
  - [Freshness Comparison](#freshness-comparison)
  - [Compatibility Decision](#compatibility-decision)
  - [Comparison Source Beyond The Repository](#comparison-source-beyond-the-repository)
  - [Per-Contract Comparison Against The Base Reference](#per-contract-comparison-against-the-base-reference)
  - [Contracts Removed Since The Base Reference](#contracts-removed-since-the-base-reference)
  - [Guard Scope And Decisions](#guard-scope-and-decisions)
  - [Enrollment Report](#enrollment-report)
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
  - [Kit-Wide Enrollment Is Reported, Never Enforced](#kit-wide-enrollment-is-reported-never-enforced)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

## 1. Feature Context

The feature-entry identifier the kit's template places here is deliberately absent. That identifier kind is owned by a DECOMPOSITION, and a layer member owns no DECOMPOSITION, so declaring one here would be a reference with no definition. `cpt-frontx-ui-kit-featstatus-component-contracts` above carries this feature's identity instead.

### 1.1 Overview

The agent knowledge layer of the kit: for a component that has been described, a compiled contract that states the component's meaning next to the prop facts read out of its own TypeScript, and the checks that keep the two from disagreeing - a per-component conformance suite, a freshness comparison, a compatibility comparison against the change's base reference, and a guard scoped to the components a change touches.

### 1.2 Purpose

Prose describing a component can only be reviewed by a person, one screen at a time. This feature produces a description a tool can act on and then refuses to let it rot: a described component's committed contract must equal a fresh compile of that component, and a change that narrows a described surface must move the contract's own major version or be refused. The scope of enforcement is the change under review, never the whole kit, because a gate that starts almost entirely red is a gate that gets switched off.

**Requirements**: `cpt-frontx-ui-kit-fr-component-contract`, `cpt-frontx-ui-kit-fr-contract-single-fact-owner`, `cpt-frontx-ui-kit-fr-contract-unchecked-prop-report`, `cpt-frontx-ui-kit-fr-contract-freshness`, `cpt-frontx-ui-kit-fr-contract-compatibility`, `cpt-frontx-ui-kit-fr-contract-incremental-coverage`, `cpt-frontx-ui-kit-nfr-gate-adoptability`

**Principles**: `cpt-frontx-ui-kit-principle-code-is-the-fact-owner`, `cpt-frontx-ui-kit-principle-scoped-enforcement`

**Components**: `cpt-frontx-ui-kit-component-contract-harness`, `cpt-frontx-ui-kit-component-component-surface`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-ui-kit-actor-kit-developer` | Authors a component's overlay, compiles its contracts, commits them beside the component, and recompiles when the component changes |
| `cpt-frontx-ui-kit-actor-continuous-integration` | Invokes the guard, the compatibility check and the enrollment report with the base reference of the change under review |
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
- Developer writes an overlay stating meaning only, runs the compile command for the component's directory, and the contract - carrying everything the component means - and the thin metamodel instance naming it are written beside the component, each written path reported. The surface a component forwards to its host element is hand-written source and nothing is written for it.
- A directory exporting several components compiles one contract per overlay in it, each named for the export it describes.
- Developer asks for the shared schemas instead of a directory, and the abstract component type, the metamodel and every vocabulary type are written from their builders, each written path reported.

**Error Scenarios**:
- No directory named: the usage line is printed and the run fails.
- The directory carries no overlay: the directory is named and the run fails, so a mistyped directory cannot look like a successful no-op.
- The overlay restates a fact the compiler reads from the code, writes an entry the compiler fills, carries a field the vocabulary does not define, or names a prop the component does not declare: the compile is refused naming the offence and nothing is written.
- The component carries a prop the compiler cannot place - declared by neither the component, the primitive library it wraps, nor React's DOM attribute types: the compile is refused naming those props and where they are declared.
- The component forwards DOM attributes and no host element resolves for them, or the host element it resolves has no committed surface: the compile is refused naming the props, or the element and the file to write.

**Steps**:
1. [x] - `p1` - Developer authors the overlay beside the component, stating meaning only - `inst-author-overlay`
2. [x] - `p1` - Developer runs the compile command naming the component's directory - `inst-invoke-compile`
3. [x] - `p1` - **IF** the shared schemas are asked for instead of a directory - `inst-write-shared`
   1. [x] - `p1` - Write the vocabulary types, then the abstract component type and the metamodel that reference them, reporting each path, and **RETURN** - `inst-write-shared`
4. [x] - `p1` - **IF** no directory is named - `inst-missing-argument`
   1. [x] - `p1` - Print the usage line and **RETURN** a non-zero exit - `inst-usage-exit`
5. [x] - `p1` - **IF** the directory carries no overlay - `inst-no-overlay`
   1. [x] - `p1` - Name the directory and **RETURN** a non-zero exit - `inst-no-overlay-exit`
6. [x] - `p1` - **FOR EACH** overlay in the directory, compile the contract and the metamodel instance and write both beside the component - `inst-compile-each`
7. [x] - `p1` - **RETURN** each written path to the developer as it is written - `inst-report-paths`

### Guard A Change Against The Base Reference

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Actor**: `cpt-frontx-ui-kit-actor-continuous-integration`

**Realizes**: `cpt-frontx-ui-kit-seq-contract-compile-and-guard`

**Success Scenarios**:
- The guard holds every component in the change's scope to a fresh, complete contract and reports each decision; a change touching only undescribed components passes with each reported as not yet requiring one.
- The compatibility check compares every committed contract against the base reference and reports each as compatible, as incompatible with the contract major moved, or as refused.
- The enrollment report prints the described set against the component set and never fails.

**Error Scenarios**:
- A subcommand invoked without the base reference it needs, or a subcommand the command does not answer to: the usage line is printed and the run fails.
- An enrolled component's committed artifacts no longer equal a fresh compile: the run fails naming the component and the command that regenerates it.
- An enrolled component's directory no longer exists: the run fails, because the enrolled set still names it.
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
7. [x] - `p1` - **IF** the subcommand is the enrollment report - `inst-dispatch-enrollment`
   1. [x] - `p1` - Print the report and **RETURN** success whatever the numbers are - `inst-enrollment-exit`

## 3. Processes / Business Logic (CDSL)

### Component Fact Extraction

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-extraction`

**Input**: The path of a component's source file.

**Output**: One extraction per exported React component - its variant axes and defaults, its props filed into three sets by where each one is declared, the props it could file nowhere, the host element it renders, and a note for each thing the walk could not read: an unresolvable variant declaration, a conflicting axis or default, an unclassifiable heritage node, a property with no declaration behind it.

**Steps**:
1. [x] - `p1` - Build a TypeScript program over the component's source alone, using the package's own shipping-source compiler options, so an extraction depends on the file it reads and on nothing else that shared the run - `inst-ex-program`
   1. [x] - `p1` - Where an answer is only counted and never written into an artifact - which of a file's exports are components, what every export is called - take it from one program shared across every file the run asks about, or from the parsed syntax with no program at all, and keep it out of the extraction an artifact is compiled from - `inst-ex-shared-program`
2. [x] - `p1` - **FOR EACH** exported declaration, keep the ones that are React components, unwrapping a wrapper by its resolved symbol rather than by the name it was imported under - `inst-ex-candidates`
3. [x] - `p1` - Walk the first parameter's props type, classifying each heritage reference by its resolved symbol and the file that declares it - `inst-ex-heritage`
4. [x] - `p1` - Trace each variant-type reference to the variant declaration it derives from and read the axes and their defaults there - `inst-ex-axes`
   1. [x] - `p1` - Name the axes whose values are exactly the two boolean keys, or the true one alone: the variant library types such an axis as a boolean prop rather than as the string union its keys look like, and read as a string axis the contract stated a prop accepting only the two strings, which no caller can satisfy. Read a default written as a boolean for those axes, and REFUSE a default of any other kind rather than noting it - a variant whose documented default silently vanished is the same loss as an axis that vanished - `inst-ex-boolean-axis`
5. [x] - `p1` - **IF** two heritage entries declare the same axis - `inst-ex-axis-conflict`
   1. [x] - `p1` - Record the conflict naming both sources, rather than letting one silently overwrite the other - `inst-ex-axis-conflict-note`
6. [x] - `p1` - **IF** two heritage entries declare the same default - `inst-ex-default-conflict`
   1. [x] - `p1` - Record it the same way, for the same reason - `inst-ex-default-conflict-note`
7. [x] - `p1` - Resolve the host element the component renders from the element argument of the props helper its heritage names - `inst-ex-heritage`
8. [x] - `p1` - **FOR EACH** resolved property of the props type, read its type, its optionality and the file that declares it - `inst-ex-props`
   1. [x] - `p1` - File it by that declaration site into one of three sets: declared by the component itself, declared by the primitive library as part of the API of the part being wrapped, or declared by React as an attribute of the host element. A prop declared in none of the three is filed nowhere and named, because which side of the API-versus-forwarded line it falls on is a question about that library's conventions and not one the extractor may answer by default - `inst-ex-file-class`
   2. [x] - `p1` - Name the type without the module it was resolved from. The printer qualifies a type it cannot name in scope with the importing path, which puts the machine's own filesystem layout and a foreign package's internal file names into a committed artifact - and neither is part of what the type is called - `inst-ex-props`
9. [x] - `p1` - Record a heritage node the walk cannot classify as a note, instead of silently returning with the props behind it unaccounted for - `inst-ex-cannot`
10. [x] - `p1` - Record a property the checker resolves but no declaration backs, and skip it, rather than reporting an invented declaration site for it - `inst-ex-undeclared-prop`
11. [x] - `p1` - **RETURN** one extraction per exported component, with every prop list ordered by name - `inst-ex-return`

### Overlay Admission

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-overlay-admission`

**Input**: The artifact being compiled and the parsed overlay document.

**Output**: The admitted overlay, or a refusal naming the offence. Every check before the return reads the document alone and runs as it is parsed; the last needs the extraction and so runs once the overlay has been returned, against the component's real props.

**Steps**:
1. [x] - `p1` - **IF** the overlay carries a field the code owns - `inst-oa-machine-owned`
   1. [x] - `p1` - Refuse, naming each such field - `inst-oa-machine-owned-refuse`
2. [x] - `p1` - **IF** the overlay carries a field the vocabulary does not define, or a field of the wrong shape - `inst-oa-unknown-field`
   1. [x] - `p1` - Refuse, naming the field and its position in the document - `inst-oa-unknown-field-refuse`
3. [x] - `p1` - Admit a recommendation that states what to use instead in the words a reader acts on, with the kit component to resolve when the kit ships one and without it when the kit ships nothing - and refuse any other shape - `inst-oa-alternative`
4. [x] - `p1` - **IF** the overlay writes an entry the compiler FILLS - a component reference among the mount points, which is computed from every other contract's accepted components, or a family root's member list, which is computed from every contract naming that family as a part - `inst-oa-derived-field`
   1. [x] - `p1` - Refuse, naming what fills the entry and where the fact belongs instead. Refused ahead of the shape check, whose own answer would be "unknown key": the field admits the filled shape for the compiled artifact's sake, so what an author needs told is which side of the relationship states it - `inst-oa-derived-field-refuse`
5. [x] - `p1` - **IF** the component the overlay declares is not the one being compiled - `inst-oa-name-mismatch`
   1. [x] - `p1` - Refuse, naming both - `inst-oa-name-mismatch-refuse`
6. [x] - `p1` - **RETURN** the admitted overlay - `inst-oa-return`
7. [x] - `p1` - **IF** the admitted overlay references a prop the component does not have - a deprecation's key, a deprecation's own replacement, the prop icons arrive through, a declared slot, the prop a capability is turned on by, a prop the overlay withholds, a key of the `props` map - `inst-oa-absent-prop`
   1. [x] - `p1` - Refuse, naming the prop. A deprecation and its replacement, an icon slot, a declared slot and a capability's switch may only name a prop the component declares itself; a withheld name and a `props` key may also name one the primitive declares, and a withheld name may NOT name one the component declares, which would be the overlay asking the compiler to drop what the source states - `inst-oa-absent-prop-refuse`
8. [x] - `p1` - **IF** the admitted overlay claims an attestation the kit's own claim registry does not name - `inst-oa-attestation-claims`
   1. [x] - `p1` - Refuse, naming the claim and where to add it. A claim name passing the trait schema's own shape check (lowercase, snake_case) is not the same fact as the kit recognizing it, and a typo of a real claim is well-formed by that check alone - `inst-oa-attestation-claims`

### Contract Compilation

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compilation`

**Input**: A component directory and the artifact stem being compiled.

**Output**: The compiled contract - a props schema carrying the component's meaning in a validator-read block and a prose block, deriving from one type, naming the surface of the element it renders as a reference, and annotating rather than rejecting what nothing evaluates.

**Steps**:
1. [x] - `p1` - Select the extraction whose exported component is the one being compiled, failing when no export matches - `inst-cc-select`
2. [x] - `p1` - **IF** the extraction could not resolve a variant declaration - `inst-cc-axis-failure`
   1. [x] - `p1` - Fail rather than emit a contract silently missing its axes - `inst-cc-axis-failure-refuse`
3. [x] - `p1` - Fail when the component carries a prop the extraction could file nowhere, or when it forwards DOM attributes and no host element was resolved for them - naming the props either way, because a contract compiled without them would claim the component does not have them - `inst-cc-orphan-inherited`
4. [x] - `p1` - Turn each variant axis into an enumerated property carrying its default - `inst-cc-axes`
   1. [x] - `p1` - Emit a boolean-keyed axis as a boolean property with a boolean default, which is what the variant library types the prop as and therefore the only shape a caller can satisfy - `inst-cc-boolean-axis`
5. [x] - `p1` - Represent a declared prop the schema cannot state IN FULL as a slot, carrying whatever the schema does state alongside the type text for the rest - a prop whose kind is checkable and whose shape is not is both, and letting no property leave the compiler asserting nothing and saying nothing - `inst-cc-slots`
6. [x] - `p1` - Declare each prop the primitive library states for the part being wrapped as a property of this contract, stating as much of its type as the schema carries and annotating it with its own TypeScript type for the rest, unless the overlay hides it - such a prop is this component's API, not surface it merely forwards, and filing it as forwarded surface is what buried a compound component's whole domain API in a file no reader opened - `inst-cc-api`
7. [x] - `p1` - Where a property's name is also declared by the host element's surface, fail when the two shapes disagree: both apply to the same value, so a disagreement is a props object that can satisfy neither - `inst-cc-owner-conflict`
   1. [x] - `p1` - Refuse, naming the prop, where it was declared and what the element surface states - `inst-cc-owner-conflict-refuse`
8. [x] - `p1` - Route each meaning field to its block through ONE map, exactly once, and emit the extraction's own facts into the other. Every meaning field goes to the block a validator reads, because the meaning of a component is processing metadata of its type; the map keeps both targets so that answer stays reversible in one edit - `inst-cc-route`
9. [x] - `p1` - Derive the contract from exactly ONE type, the abstract component type - which is what its chained identifier already says. The surface of the host element it renders is NOT a second parent: it is a hand-written set shared kit-wide by every component that renders the same element, so it is something the component uses rather than a second thing the component is - `inst-cc-close`
   1. [x] - `p1` - Name that surface as a reference the contract HOLDS in its validator-read block, and give the metamodel instance the same reference, so the two halves of one artifact name one surface. Decide it from the extraction in one place, for both halves: a component that resolves an element but forwards nothing to it names no surface, and two copies of that rule would disagree the day one of them changed - `inst-cc-close`
   2. [x] - `p1` - Leave the derived type OPEN: `unevaluatedProperties` carries the annotation `x-uikit-classification: unchecked` rather than `false`, stating that a prop nothing evaluates is unchecked rather than invalid - a schema cannot tell a typo'd kit prop from an attribute this harness has not classified, and answering "invalid" to both made the second unusable. This is also why dropping the surface out of the schema body changes nothing a consumer may pass: a forwarded attribute was already admitted by the openness, not by the merge - `inst-cc-close`
10. [x] - `p1` - **RETURN** the contract after validating its meaning block against the schema the abstract component type carries - `inst-cc-return`

### Metamodel Instance Assembly

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-instance`

**Input**: A component directory and the artifact stem being compiled.

**Output**: The metamodel instance for that artifact: a thin typed record.

The instance NAMES the contract and repeats nothing it says. What a component means is processing metadata of its type and is emitted once, into the props schema's own validator-read block; an instance carrying a second copy would be one fact in two documents with nothing keeping them in step. What is left is what only an instance can carry: its own identity, the type it is an instance of, the vocabulary version it was compiled against, and the two references the type system itself resolves against a registry - which is the reason the document exists at all.

**Steps**:
1. [x] - `p1` - Assemble the record: its own instance identifier, the metamodel type it is an instance of, the vocabulary version, the component's name, and the two references - its props schema and the surface of the host element it renders, the second decided from the extraction in the same one place the contract's own reference is - `inst-mi-assemble`
2. [x] - `p1` - **RETURN** it after validating it against the metamodel - `inst-mi-validate`

### Host Element Surface

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-element-surface`

**Input**: The host element a component renders.

**Output**: The hand-written surface for that element, or a refusal naming the element and the file to write.

The surface a component forwards to its host element is hand-written source, one file per element kind, and nothing about it is derived. React's attributes for a `<button>` are the same attributes for every component that renders one, so there is no per-component fact to compile. Each file states the attributes common to every element, the ones the element itself takes, and the accessibility, data and event-handler families by pattern rather than by name; each is a type of its own, identified the same way every other type here is, and referenced - not inherited - by every contract whose component renders that element.

A surface therefore reaches a props object through whoever resolves the reference, not through the contract's own body. That is the whole difference between a set a component uses and a type it is: the contract states which surface applies, and a reader that wants the surface's assertions applies it beside the contract.

Two properties of a hand-written set are worth stating, because one is checked and the other deliberately is not. What more than one element kind declares, every file declaring it declares identically - the files are written by hand, so nothing constructs that agreement, and the compile refuses a disagreement by attribute name. Whether a file is COMPLETE is unchecked: nothing compares it against the attributes a component actually forwards, so an attribute no file declares reaches a consumer as unchecked and is never rejected, and the enrollment report lists the forwarded props no surface declares so the gap is visible without being a gate.

**Steps**:
1. [x] - `p1` - Load the committed surface for that element - `inst-es-load`
2. [x] - `p1` - **IF** no file is committed for it, refuse naming the element and the path expected, rather than compiling a contract that forwards an undeclared surface - `inst-es-load`
3. [x] - `p1` - Refuse when two element kinds declare one attribute differently, naming the attribute and what each file states: the global attributes and the three patterns are typed out per file, so only this comparison keeps the copies in step, and the compatibility check reads a difference between two surfaces as a narrowing a consumer feels - `inst-es-agree`
4. [x] - `p1` - Resolve the surface a contract NAMES through the reference it holds - one reader for every check that needs it, rather than each check walking the schema body its own way - and answer "none" for a contract that names no surface - `inst-es-compose`
   1. [x] - `p1` - Compose the two at the point of validation: the contract and that surface applied to the same props object, so what the surface asserts about an attribute it types is still asserted - by the reader that resolved the reference rather than by the contract's own body. A reader that never looks the surface up gets the open classification instead, which is the honest answer for a reader that never asked - `inst-es-compose`

### Structure derivation

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-structure-derivation`

**Input**: The artifact stem being compiled, and its admitted overlay.

**Output**: Where the component may be mounted, and which family it belongs to, as its contract carries them.

Where a component may be mounted is not a fact about that component: it is a fact about the components that accept it inside them. Authored on both sides it was a claim about somebody else's contract, free to disagree with it - a part could name a parent whose own accepted list never mentioned the part - and only a test comparing the two would notice. Filled, there is one statement and the other direction is a view of it. A family's membership runs the same way: every member states which family it belongs to and its role in it, and the root's member list is the view over those statements.

Both are materialized into the contract rather than left to a reader to compute, because the reader this feature is for holds one contract document and nothing else: what it needs to act correctly is written down, and what only the harness needs is computed.

**Steps**:
1. [x] - `p1` - Read every overlay in the kit and collect the ones whose accepted components name this component; those components are its mount points. Overlays, not compiled contracts: an overlay is the authored source, so the derivation is right even while a committed contract is stale, which is the state every recompile passes through - `inst-co-derive`
2. [x] - `p1` - Merge the containers the overlay states outside the kit - where a typed reference has nothing to point at - into the same field, so one field answers "where may this be mounted" whatever the answer is - `inst-co-derive`
3. [x] - `p1` - Emit the field only when there is something to say: an empty list would read as "may be mounted nowhere", and most of the kit is mounted anywhere - `inst-co-derive`
4. [x] - `p1` - **IF** an accepted-components list names this component at a major it no longer ships - `inst-co-stale-major`
   1. [x] - `p1` - Refuse, naming the overlay, the reference it holds and the identifier the component ships now. A reference carries the target's major, so moving a major is an edit to every overlay naming the component; dropping the filled mount point for the ones left behind would hide exactly the edit the move demands - `inst-co-stale-major`
5. [x] - `p1` - Group the same overlays by the family token each one names, and fill a root's member list from the ones naming that family as a part. Refuse two roots for one family name, naming both - with two roots there is no single place a reader can ask what the family contains - and refuse a family with no root at all, naming the component whose membership points at nothing. A part carries its own membership and no member list: reading the family's whole shape is what the root is for - `inst-co-family`

### Property Statements And Their Pairing

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-untyped-props`

**Input**: A prop's resolved TypeScript type, and the compiled contract its property lands in.

**Output**: The properties a validator will not fully check, and the disagreements between them and the contract's own statements about a prop.

**Steps**:
1. [x] - `p1` - State as much of a prop's type in schema terms as the RESOLVED type carries, and say which of the two it is: the whole of it, or a bound on it. A name is not evidence - an alias printed as itself is still whatever it unwraps to, and a list of item values read as inexpressible because its alias matched no keyword is the misreading this exists to stop - `inst-up-express`
   1. [x] - `p1` - Resolve an open type parameter to its CONSTRAINT and never to its default: every instantiation satisfies the constraint, and none is bound by a default the caller may override. A parameter the caller already bound is resolved by the type system before it is read here, which is where a default belongs - `inst-up-express`
   2. [x] - `p1` - Withhold a constraint that only SOME members of a union carry: a shape covering the expressible members alone would reject a value the rest of the union allows - `inst-up-express`
   3. [x] - `p1` - Constrain the elements of a list only where the element type is stated in full, since a partial element shape constrains what the element does not - `inst-up-express`
2. [x] - `p1` - Unwrap first, and describe only what is left. A property carries the checker's own printed type and the statement that the type system, not the schema, is what checks it exactly where the schema does NOT state the whole type - never an empty schema, which in a props contract reads as "anything, so probably the obvious thing", and never over a type the schema states in full, which would be a second answer to a question already answered - `inst-up-describe`
   1. [x] - `p1` - Say how much is left, not that the prop is beyond reach: "not expressible" said of a type that partly IS - a list whose elements the caller chooses - is the same false claim as an empty schema, made in words instead of silence - `inst-up-describe`
   2. [x] - `p1` - Where the overlay's own `props` map carries a statement keyed on this property, emit it into the SAME description, beside the checker's printed type - the fact that could not be typed lives beside the fact that could not be checked, one property, one description, read once - `inst-up-emit`
3. [x] - `p1` - List every property of the contract a validator will not fully check, whichever side of the API-versus-declared split it came from: what they have in common is the only thing that matters to a reader, that passing validation there is not the same as being right. Read it off the prose, which is the compiler's own record of that gap - `inst-up-list`
4. [x] - `p1` - Pair that list against the contract's own `props` statements BOTH WAYS, keyed on the property itself: a property nothing checks and nothing explains is the gap an evaluation walked into, and a statement naming a property the schema states IN FULL tells a reader something false about the contract in front of them. Keying on the property is what makes the pairing possible without a subject to read first - what used to be a flat list of statements read by an `about` discriminant (a prop, an unexposed part, a mount point outside the kit, a behaviour) is now a map keyed on the property for the prop case, and three separate facts (`unexposed_parts`, `mounted_in`, `invariants`) for the rest, each already the right shape for what it states - `inst-up-pair`
5. [x] - `p1` - **RETURN** the disagreements for a caller to report rather than raising them: a missing statement is a documentation gap, and a compile that refused it would make a component uncompilable until its prose caught up - `inst-up-pair`

### Prop Classification Report

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-props-classification`

**Input**: A props object, a contract, and the host element surface that contract names.

**Output**: Which of those props the contract accounts for, which nothing accounts for, and which of the latter are one edit away from a prop the contract declares.

This is what replaced closing the schema. A closed schema answered "invalid" to a typo'd kit prop and to a name this harness has not classified yet - a new React attribute, a prop of a primitive part nobody has described - and only the first is a mistake. Telling them apart needs a comparison a schema cannot make.

**Steps**:
1. [x] - `p1` - Count a prop as known when the contract declares it or the element surface declares it BY NAME: an exact declaration on either side accounts for the value - `inst-pc-classify`
2. [x] - `p1` - Upgrade a name that is one edit from a prop the CONTRACT declares to a near miss, naming what it is probably meant to be. Only the contract's own props: a near miss of a forwarded DOM attribute is a typo in React's surface, not in the thing this contract exists to describe, and reporting those would make the report noisier than the closure it replaced - `inst-pc-near-miss`
   1. [x] - `p1` - Decide this BEFORE the surface's patterns are consulted: a pattern cannot tell a typo of a name it was written for from that name, so `^on[A-Z]` answered "known" to `onValuechange` against a contract declaring `onValueChange` - a typo in the one half of a contract this report exists to protect - `inst-pc-near-miss`
   2. [x] - `p1` - Measure the distance as a bounded edit distance, since the only question asked of it is whether two names are exactly one edit apart - `inst-pc-distance`
3. [x] - `p1` - Count a prop as known when it matches one of the surface's patterns and no prop the contract declares is one edit from it - `inst-pc-classify`
4. [x] - `p1` - Report every other name as unchecked, which is a report and not a refusal - `inst-pc-classify`

### Contract Identifier Construction

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-identifiers`

**Input**: A component name and its own overlay's contract major, a host element, or a vocabulary concept.

**Output**: The identifier for the artifact, and the patterns that recognize each identifier shape.

**Steps**:
1. [x] - `p1` - Derive the identifier token from the name of the export being described - the directory name where a directory describes one component, the overlay stem where it describes a part of a compound one - `inst-id-token`
2. [x] - `p1` - Take the contract major from the component's own overlay, defaulting to the first major when it states none, and take the TARGET's major wherever an identifier names another component - a reference carries the major that component ships, which is a fact about its overlay and not about the referrer's. Read from a kit-wide constant instead, the one acknowledgement the compatibility check accepts for a narrowing could only be given by rewriting every identifier in the kit at once - `inst-id-major`
3. [x] - `p1` - Build the props-schema identifier by chaining the component's segment onto the abstract component type, and make that identifier what a reference to the component holds - a component is the type derived from that one type, so there is no second identifier to point at - `inst-id-props-schema`
4. [x] - `p1` - Build the metamodel instance identifier from the same segment, without the terminator that would make it a type - `inst-id-instance`
5. [x] - `p1` - Build the host-element surface identifier from the element the component renders, normalizing the tag into the token grammar every other identifier here uses - the element kind stays the real tag for a reader, and the token is what an identifier and a file name can carry. Expose it in both spellings for the same reason the abstract type is: bare for the reference a contract holds as a VALUE, and in the form a schema keyword requires for the surface file's own identifier - and expose the token back out of a reference, because that token is the surface file's name - `inst-id-element`
6. [x] - `p1` - Build the vocabulary type identifier from its concept token - `inst-id-vocabulary-type`
7. [x] - `p1` - **RETURN** the patterns that recognize each identifier shape - `inst-id-patterns`

### Meaning Schema Derivation

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema`

**Input**: Nothing but the vocabulary itself.

**Output**: The vocabulary types the overlay is made of, the field-by-field definition of what an author may state, and the schema the abstract component type carries - against which every contract's meaning block is checked. How those types relate is the domain model in section 3.1 of the package DESIGN.

**Steps**:
1. [x] - `p1` - Build one type per concept the vocabulary names - a recommendation and the "don't" rule that holds one, what a component accepts inside it, the one shape a mount point takes whether it is filled or authored, a deprecation and the per-prop deprecation it holds, an attestation, a family membership, a per-property statement of what the schema cannot state, an unexposed part, an example pair, a withheld prop, and one type each for the three growth surfaces - each with its own identifier. Every structured field is a vocabulary type; only a scalar, an array of strings, or the one reference the type system's own walk must find directly on an instance property stays inline - `inst-ts-vocabulary`
   1. [x] - `p1` - Let the value that answers "what may appear inside" answer it alone: detail beside "unconstrained" or "nothing" would say both that nothing may appear inside a component and that something may, and detail is required beside "specified", which otherwise says nothing at all. The prop icons arrive through is governed by the same rule: it is a fact about WHAT is specified to appear inside, so it is legal only where content is - `inst-ts-content-exclusive`
   2. [x] - `p1` - Define the non-component content kind in the type itself rather than in prose beside it: a string, a number, a fragment or a formatted inline element - never a kit component, which would be a reference instead - `inst-ts-vocabulary`
   3. [x] - `p1` - Require a recommendation to state what to use in the words a reader acts on, and let the kit component beside it be optional - its ABSENCE is the statement that the kit ships nothing for this case, which naming the nearest component as a stand-in hid - `inst-ts-vocabulary`
   4. [x] - `p1` - Give a mount point ONE shape whichever way it is known - a container, what a reader acts on either way, required; a component reference, filled by the compiler and never authored; a note, authored only where the container is outside the kit - rather than two shapes split by resolvability, the split "what may appear inside" already ruled out for its own field - `inst-ts-vocabulary`
   5. [x] - `p1` - Key what the schema cannot state about a component's own property on the property itself rather than naming it inside a flat list: a statement without a key to check against could drift from the properties it claims to be about with nothing to notice, and a subject-and-list shape needs a subject read first before the pairing is even askable - `inst-ts-vocabulary`
   6. [x] - `p1` - Keep the three answers a contract can give apart, because they answer different questions: an attestation carries an outcome (verified, failed, or nobody looked), a prop carries a classification, and a comparison against a base reference carries a decision. One word each - `inst-ts-vocabulary`
   7. [x] - `p1` - State the props the kit does not advertise, and the internal structure it composes but does not expose, as name/part-and-reason entries, both required in each - a bare name leaves every later reader to rediscover why the prop or part is gone. Two fields, because a prop the kit does not advertise and a part it does not expose are two different facts, not two spellings of one - `inst-ts-withheld`
2. [x] - `p1` - Define every meaning field once, field by field, and hand the same definitions to both readers - the schema the abstract type carries and the schema an author is held to - so the two can never disagree about what a field looks like - `inst-ts-fields`
   1. [x] - `p1` - Include the one field the OVERLAY may not write, the host element's surface it forwards to, and leave it out of what an overlay may state: which element a component forwards to is a fact of its source - `inst-ts-host`
3. [x] - `p1` - State each of those fields as a reference to the type that owns its shape, so a concept is defined once and every reader resolves the same definition - `inst-ts-ref`
4. [x] - `p1` - Declare a field that HOLDS another type's identifier with all three of what it must resolve to, the value kind and the grammar of the identifier, because the type store removes the resolution annotation before validating and drops a branch left carrying nothing else - `inst-ts-id-value`
5. [x] - `p1` - Give each field the vocabulary does not require a null alternative and a null default, so the store finds a value for every declared field. A field that is nothing but a reference widens with an `anyOf` of the reference and null rather than a `type` written beside the reference - the type system merges a resolved reference in at the reference's own position, so a sibling `type` depends on where in the document it landed - `inst-ts-nullable`
6. [x] - `p1` - **RETURN** the schema the abstract type carries - `inst-ts-return`

### Freshness Comparison

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-freshness`

**Input**: A component directory and the artifact stem to check.

**Output**: The differences found, and whether the artifact is fresh.

The surface a component forwards to its host element is not compared here: it is hand-written source, so there is no fresh build to diff it against. Nor is it compared against the attributes a component actually forwards - the completeness of a hand-written surface is deliberately unchecked, and what an undeclared attribute gets is the unchecked classification rather than a refusal. What the conformance suite checks about it instead is that the reference a contract holds resolves to a committed file, that the file's own identifier obeys the grammar, and that no committed file is named by nothing.

**Steps**:
1. [x] - `p1` - Compare the committed contract and the committed metamodel instance against a fresh compile - `inst-fr-artifacts`
2. [x] - `p1` - Compare every committed schema that belongs to no single component - the abstract component type, the metamodel, and each vocabulary type they reference - against a fresh build on every run of this comparison, so a stale shared schema is caught by whichever component is checked first. The builders are pure and each is built once per process, so the repetition costs a JSON copy and a small file read rather than a rebuild. Drive the vocabulary comparison from the union of what the builder produces and what the directory holds, not from the builder alone: a committed type the builder no longer produces was compared by nobody while every registry went on registering it - a definition the harness applies and no comparison covers - `inst-fr-base`
3. [x] - `p1` - Report a property of a DECLARED prop the schema does not state in full and that has no partially-typed-props record, and a partially-typed-props record on a property the schema DOES state in full or on a prop the component does not declare. Scoped to declared props: a prop of the primitive underneath can also assert nothing, and its type is documented in its own description and its own `props` statement rather than in the kit's partially-typed-props record - `inst-fr-slots`
4. [x] - `p1` - **RETURN** fresh only when every comparison came back empty - `inst-fr-return`

### Compatibility Decision

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compat-decision`

**Input**: The two revisions of a contract, their contract majors, and the type system's own backward comparison.

**Output**: A pass or a refusal, with the reasons.

**Steps**:
1. [x] - `p1` - Diff the forwarded surface: a removed prop, a changed shape or a dropped value is incompatible, while an added prop is not. One comparison covers a change of host element as well as a change to a surface itself, because the surfaces are hand-written and shared kit-wide: what two element kinds have in common they state identically, checked by the rule the compile enforces on the surfaces themselves, so a difference between them is a real difference rather than one hand-written file having drifted from another - `inst-cd-element-surface`
2. [x] - `p1` - Diff the declared props: a removed prop and a newly required prop are both incompatible, whether the prop was required before or not - `inst-cd-own`
   1. [x] - `p1` - Apply the same shape rule to a declared prop that the forwarded surface already gets - a changed type, a type appearing where none existed, a dropped enum value, an enum appearing where the prop accepted any value of its type. One rule, one function, because a narrowing does not mean something different depending on which half of a contract the property lives in; and the type system's own comparison does not report an enum appearing over an existing type, which is the shape this compiler emits the day a plain string prop becomes a literal union - `inst-cd-shape`
   2. [x] - `p1` - Reconcile a declared prop that left the properties against the forwarded surface: a name that surface still accepts, by declaration or by pattern, is not gone - a component dropping its own narrower declaration of a forwarded attribute changes nothing a consumer passes. Report the move either way, because the component's own declaration really did disappear, and compare the shapes where the surface declares one - accepted is not the same as accepted unchanged - `inst-cd-own-forwarded`
3. [x] - `p1` - Combine those two with the type system's own backward comparison, which sees neither of them - `inst-cd-combine`
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
- [ ] Return the same decision shape either way, so one decision rule serves both sources.

**Depends on**: `cpt-frontx-ui-kit-fr-contract-distribution` - contracts have to be part of the published artifact before a published version can be read for them. The release job would run the published form before tagging, so that the decision gating a release is the one a consumer experiences.

### Per-Contract Comparison Against The Base Reference

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compat-unit`

**Input**: One committed contract, the base reference, the rename records and the contracts present at the base reference.

**Output**: That contract's compatibility decision.

**Steps**:
1. [x] - `p1` - Read the committed contract and the same contract at the base reference - `inst-cu-read`
2. [x] - `p1` - **IF** the contract is absent at the base reference - `inst-cu-rename`
   1. [x] - `p1` - Look for its earlier path by the rename record, then by identifier, then by name, and note the move on every reason if one is found - `inst-cu-rename-resolve`
3. [x] - `p1` - **IF** no earlier version resolves - `inst-cu-new`
   1. [x] - `p1` - Report the contract as new and **RETURN** a pass - `inst-cu-new-return`
4. [x] - `p1` - Register both revisions under distinct synthesized versions, so the type system can compare two states of what is otherwise one identifier - `inst-cu-register`
5. [x] - `p1` - Compare the forwarded surface at both revisions, reading the host element from the reference each revision's own contract shipped with rather than from the source as it is now - `inst-cu-element-surface`
   1. [x] - `p1` - Read the element from the base revision as well as the current one, and decide the comparison from both: nothing to compare when neither names a surface; nothing to report when only the current one does, because a forwarded surface that arrives only widens; the shape comparison otherwise, against the empty surface when the current revision names none, and naming the move when the element changed - `inst-cu-element-surface-both`
   2. [x] - `p1` - **IF** the comparison genuinely cannot be made - no file at the base reference for the element this contract shipped with, or none committed for the element it names now - report the forwarded-surface signal as skipped for that element, without refusing the change - `inst-cu-element-surface-both`
6. [x] - `p1` - **RETURN** the decision for this contract, and the base-reference path it was compared against, so a contract that no longer has an heir can be told from one that was never compared - `inst-cu-decide`

### Contracts Removed Since The Base Reference

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-compat-removal`

**Input**: The contracts present at the base reference, the base-reference path each committed contract was compared against, and the enrolled set.

**Output**: One decision per contract that exists only at the base reference.

The comparison above walks the contracts on disk and asks each one what it used to be. A contract that is only in the past is walked by nobody, so a deletion was not passed so much as never looked at - and a rename whose two halves neither the rename record nor the identifier nor the name could pair up looks the same. Removing a contract is backward-incompatible on its face: a consumer holding that identifier now resolves nothing, and unlike a narrowing there is no surviving contract whose major could move to acknowledge it. The one acknowledgement this harness records is the one the guard already demands of a removed directory - the enrolled set no longer naming the component - so both rules are the same rule.

**Steps**:
1. [x] - `p1` - Subtract every base-reference path some committed contract was compared against from the contracts present at the base reference - `inst-cr-find`
2. [x] - `p1` - **IF** the enrolled set still names the component the removed contract described - `inst-cr-decide`
   1. [x] - `p1` - **RETURN** a refusal naming the removed path and the entry that still promises it - `inst-cr-decide`
   2. [x] - `p1` - Otherwise **RETURN** a pass reporting the removal as acknowledged, naming what disappeared - `inst-cr-decide`
3. [x] - `p1` - Report those decisions alongside the per-contract ones, so one run states both what changed and what is gone - `inst-cr-sweep`

### Guard Scope And Decisions

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-guard`

**Input**: The base reference and the enrolled set.

**Output**: One decision per component directory in scope.

**Steps**:
1. [x] - `p1` - Collect the change set from the base-reference diff, the working tree and the untracked files, so an uncommitted edit cannot slip past - `inst-gd-changed`
2. [x] - `p1` - Map the changed paths to component directories - `inst-gd-map`
3. [x] - `p1` - **IF** the change touches the shared contract tooling - `inst-gd-widen`
   1. [x] - `p1` - Widen the scope to every enrolled component, because a change there can change what any of them compiles to - `inst-gd-widen-scope`
   2. [x] - `p1` - Widen it the same way when the change touches the enrolled set itself, for a different reason: that file decides which components are held to the standard at all, so the one file that grants enrollment must not be the one file enrollment never looks at - `inst-gd-widen-allowlist`
   3. [x] - `p1` - Widen it the same way when the change touches any overlay, for a third reason: one overlay's accepted components decide another component's mount points, so an overlay edit can move a compiled contract in a directory the change never touched - `inst-gd-widen-overlay`
   4. [x] - `p1` - Widen it the same way when a dependency manifest changes, for a fourth reason that is not about this repository's code at all: a committed contract carries the type system's printed type text for every property no schema shape can express, so a dependency bump reshapes every described component's artifacts. Take both the package's own manifest and the repository's lockfile - one says which version is asked for and the other which is installed, either can move alone, and the lockfile is not even visible to the package-scoped change set the rest of this reads - `inst-gd-widen-deps`
   5. [x] - `p1` - Widen the scope to the union of the enrolled set as it is and as it was at the base reference, so a component DROPPED from it is still in scope for the change that drops it - `inst-gd-widen-allowlist-union`
4. [x] - `p1` - **IF** nothing is in scope - `inst-gd-empty`
   1. [x] - `p1` - Report it and **RETURN** without failing - `inst-gd-empty-return`
5. [x] - `p1` - **FOR EACH** directory in scope, decide it - `inst-gd-each`
6. [x] - `p1` - An enrolled directory that no longer exists is a violation naming the enrolled set; an absent directory that is not enrolled is only reported - `inst-gd-removed`
7. [x] - `p1` - A directory that is not enrolled requires no contract yet and is only reported - `inst-gd-unenrolled`
   1. [x] - `p1` - A directory the enrolled set named at the base reference and does not name now is reported as dropped from the enrolled set rather than as ordinarily unenrolled, and does not fail: de-listing is legitimate - it is the acknowledgement a removed contract needs - but it is also the last moment anything states that the component's artifacts stop being guarded, and silence is how one left the enrolled set with no line in any output - `inst-gd-delisted`
8. [x] - `p1` - An enrolled directory needs an overlay for every component it exports, and its committed artifacts must equal a fresh compile - `inst-gd-enrolled`
   1. [x] - `p1` - An enrolled directory must also ship its own conformance suite: the freshness comparison is asserted in two runs on purpose, and without the suite the second of them - the unit run of whoever changed the component - never happens - `inst-gd-suite`
9. [x] - `p1` - **RETURN** the decisions - `inst-gd-return`

### Enrollment Report

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-enrollment`

**Input**: The component directories and the enrolled set.

**Output**: The described set against the component set, with a per-directory breakdown of what is not yet described.

**Steps**:
1. [x] - `p1` - Count the component directories and the ones the enrolled set names - `inst-en-count`
2. [x] - `p1` - **FOR EACH** unenrolled directory, pair its described exports with its component exports and the exports that are correctly not components - `inst-en-unenrolled`
3. [x] - `p1` - Report every enrolled-set entry that grants enrollment over nothing - one naming no component directory, one naming a directory that carries no overlay - and leave those entries out of the described count, which is meant to say how much of the kit is described - `inst-en-allowlist`
4. [x] - `p1` - **FOR EACH** described contract, report the props it forwards that the surface for its host element declares by neither name nor pattern: the surface's completeness is unchecked by design, so this is the gap made visible next to the enrollment numbers rather than a decision on anything - `inst-en-forwarded`
5. [x] - `p1` - **RETURN** the report by whichever output path was asked for, setting no exit code either way - `inst-en-return`

### Conformance Suite Construction

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-algo-component-contracts-conformance`

**Input**: A component directory and the artifact stem to assert.

**Output**: A test suite for that artifact, and a trait-validation helper the per-component suites share.

**Steps**:
1. [x] - `p1` - Declare a suite asserting the committed contract, the committed instance and the inherited-surface type equal a fresh compile, reporting each difference - `inst-cf-freshness`
2. [x] - `p1` - Assert every annotated property has a slot record and no property the schema states in full has one - `inst-cf-slots`
3. [x] - `p1` - Assert every committed shared schema - the abstract component type, the metamodel, each vocabulary type - equals a fresh build, and that each vocabulary identifier obeys its own grammar - `inst-cf-base`
4. [x] - `p1` - Validate a contract's meaning block through the type store against the schema the abstract component type carries, in a registry holding the vocabulary that schema references - `inst-cf-traits`
5. [x] - `p1` - Resolve every component identifier the contract holds - a recommendation's component, an accepted component, a mount point, a family member - against the kit itself rather than against the type registry, because the type system's reference validator does not follow a reference into another type and most referenced components ship no contract yet: each must name a component the kit ships, and where that component ships a contract the identifier must equal that contract's current props-schema identifier in full, majors included, so a component moving its major moves every reference to it. A part's identifier extends its directory's name, so resolution takes the LONGEST directory the identifier extends and fails when two of the same length could claim it - the first match found would otherwise resolve a part into the wrong component silently - `inst-cf-refs`
6. [x] - `p1` - Assert the pairing between the properties a validator will not fully check and the contract's own `props` statements, both ways - `inst-cf-untyped`
   1. [x] - `p1` - Assert no type text anywhere in the compiled artifact names the module it was resolved from, over the whole artifact rather than over the descriptions alone: the same printed text sits in the slot records one field away - `inst-cf-no-specifier`
7. [x] - `p1` - Assert every filled mount point is a contract that really does accept this component inside it, and - where the contract states a family - that it is a member of that family, so the parts of a compound component are not independently mountable. Assert the membership from both ends as well: a part carries no member list and appears in its family's roster, a root's member list IS that roster, and the family has exactly one root - `inst-cf-parent`
8. [x] - `p1` - Assert the contract derives from exactly one type, the abstract component type - the schema body says one parent where the chained identifier says one, and a second entry would say two - and that the marker naming a type as never instantiated is on that one type and on no component's contract, which every props object a consumer passes does instantiate - `inst-cf-element`
   1. [x] - `p1` - Assert the host-element surface reference the contract holds obeys the reference grammar and resolves to a committed file, that every committed surface's identifier obeys the element-surface grammar, and that no committed surface is named by no contract - the surfaces are hand-written, so nothing recompiles them into place, and the union rule the vocabulary comparison applies belongs here too: a file nothing names is registered in every store and read by nobody - `inst-cf-element`
9. [x] - `p1` - Resolve the identifiers the instance itself holds - its props schema and its host element's surface - through the type store, which does reach a reference declared directly on an instance property, so a type absent from the registry fails by name either way - `inst-cf-instance-ref`

## 4. States (CDSL)

### No Lifecycle To Model

Not applicable. Nothing here has a lifecycle: extraction, compilation and every check are computations over the repository at one revision, and a contract holds no state between runs. The nearest thing to a state - whether a component is described, fresh, stale or removed - is the guard's per-directory decision, and it is derived on every run rather than stored. It is specified as `cpt-frontx-ui-kit-algo-component-contracts-guard`.

## 5. Definitions of Done

### An Overlay States Meaning Only

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-overlay-admission`

The system **MUST** refuse a hand-authored overlay that restates a field the code owns, writes an entry the compiler fills, carries a field the overlay vocabulary does not define, declares a component other than the one being compiled, or references a prop the component does not have - naming the offence in each case and writing nothing. A prop the overlay may name differs by field: a deprecation, a deprecation's own replacement, the prop icons arrive through, a declared slot and the prop a capability is turned on by may only name a prop the component declares itself, while a withheld prop and a key of the `props` map may also name one the primitive underneath declares, and a withheld prop may never name one the component declares. A withheld entry **MUST** carry the reason the kit does not advertise that prop next to the name, so the reason reaches every reader of the contract rather than being restated as a claim beside it. An attestation claim **MUST** be one the kit's own registry names, refused by name and by where to add it otherwise - a well-formed key (lowercase, snake_case) is not the same fact as a recognized one. Where an overlay states what to use instead of a use it rules out, the system **MUST** require what a reader acts on and **MUST** admit the kit component to resolve only where the kit ships one: a reader that cannot tell a recommendation from a stand-in named only because the field demanded one is worse served than by no alternative at all, so the absence of that reference is itself the statement that the kit ships nothing for the case. The two entries the compiler fills - a component reference and container on a mount point, and a family root's member list - **MUST** be refused with the fact that fills them and the side that states it, ahead of the shape check whose own answer would be "unknown key".

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-overlay-admission`
- `cpt-frontx-ui-kit-flow-component-contracts-compile`

**Constraints**: `cpt-frontx-ui-kit-constraint-overlay-meaning-only`

**Touches**:
- Entities: `Overlay`

### Facts Come From The Code, By Symbol Identity

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-extraction`

The system **MUST** read a component's exported components, variant axes and defaults, props and host element from its TypeScript through the compiler's own resolution - never from the names an identifier happens to be written under - and **MUST** record any shape it cannot classify rather than dropping it. It **MUST** file every prop by WHERE ITS DECLARATION LIVES into three sets - the component's own source, the primitive library's props for the part being wrapped, React's attributes for the host element - and **MUST** name, rather than file, a prop declared in none of the three: the primitive library's own props for a part are the component's API, React's attributes are surface it forwards, and which of the two a third library's props are is a question about that library that the extractor may not answer by default. Where a variant axis is keyed by the boolean literals, the system **MUST** say so, because the variant library types such an axis as a boolean prop and the string union its keys look like is a shape no caller can satisfy; and a default it cannot read **MUST** fail the compile rather than leave the axis shipping without one. An extraction that a contract is compiled from **MUST** depend on the component's own source and nothing else that shared the run: the compiler prints a type's module specifier and orders a union's members from what the whole compilation holds, so an extraction taken from a compilation covering several components is a different extraction, and **MUST NOT** reach an artifact. Where the answer is only counted - which of a file's exports are components, what every export is called - the system **MAY** take it from one shared compilation, or from the syntax with no compilation at all.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-extraction`

**Constraints**: `cpt-frontx-ui-kit-constraint-overlay-meaning-only`

**Touches**:
- Entities: `Extraction`, `Component`

### A Contract Joins Meaning To The Extracted Surface

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-compilation`

The system **MUST** compile an admitted overlay and an extraction into a props schema whose properties carry the variant axes with their defaults, the component's declared props and the props the primitive library states for the part it wraps, and whose annotations carry everything the component means - once. Every meaning field **MUST** be emitted into the block a validator reads, because the meaning of a component is processing metadata of its type; what the extraction found **MUST** be emitted into the other block; and ONE map **MUST** decide that for every field, so the answer stays reversible in a single edit. The metamodel instance **MUST** carry no copy of any of it: it is a thin record naming the props schema and the surface of the host element, which are the two references a type registry resolves. That schema **MUST** derive from exactly ONE type, the kit's abstract component type, which **MUST** say outright that it is never instantiated, and **MUST** name the surface of the host element it renders as a reference it HOLDS rather than as a second parent it derives from - a surface shared kit-wide by every component that renders the same element is something a component uses, not a second thing it is - with the instance carrying the same reference, decided from the extraction in one place for both. A validator that wants the surface's own assertions **MUST** be able to resolve that reference and apply the surface beside the contract, so nothing a consumer may pass depends on the surface having been merged into the schema body. A prop the overlay withholds **MUST NOT** appear among the properties. Every property it emits **MUST** either assert something about the value or state the TypeScript type behind it and that the type system, not the schema, is what checks it - a property that asserts nothing and says nothing reads to its intended reader as a property that accepts anything - and where a property's name is also declared by the host element's surface the two shapes **MUST** agree or the compile **MUST** fail, both applying to the same value. The derived type **MUST** be left open with the classification of an unevaluated prop annotated rather than closed against it: a schema cannot tell a typo'd kit prop from an attribute this harness has not classified, so the harness **MUST** provide the report that does - which props a contract accounts for, which nothing accounts for, and which of the latter are one edit from a prop the contract declares. It **MUST** fail rather than emit a contract whose axes could not be resolved, whose props it could not place, or whose forwarded attributes belong to no resolvable host element.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-compilation`
- `cpt-frontx-ui-kit-algo-component-contracts-instance`
- `cpt-frontx-ui-kit-algo-component-contracts-element-surface`
- `cpt-frontx-ui-kit-algo-component-contracts-structure-derivation`
- `cpt-frontx-ui-kit-algo-component-contracts-untyped-props`
- `cpt-frontx-ui-kit-algo-component-contracts-props-classification`

**Constraints**: `cpt-frontx-ui-kit-constraint-contracts-repository-only`

**Touches**:
- Entities: `Contract`, `Metamodel instance`, `Element type`

### Contracts Are Named In The Type System's Grammar

- [x] `p2` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-identifiers`

The system **MUST** construct every contract, instance, host-element-surface and vocabulary identifier from one vendor namespace, so that a contract is a type derived from the kit's abstract component type and an instance is not a type at all, and **MUST** expose the patterns that recognize each shape rather than leaving callers to write their own. A reference to a component **MUST** be that component's own derived identifier, not a second identifier standing for the same component, and **MUST** be spelled in the form the type system parses rather than the form a schema keyword requires. A component identifier's token is derived from the name of the export it describes - the directory name where a directory describes one component, the overlay stem where it describes one part of a compound one, so a part carries its own identifier rather than its family's; the major it carries **MUST** come from that component's own overlay and default to the first major, and a reference to another component **MUST** carry the target's major rather than the referrer's; a host-element-surface identifier takes the element the extractor resolved, normalized into the same token grammar, so the element kind stays the real tag wherever a reader sees it and only an identifier carries the normalized form, and it **MUST** exist in both spellings - the bare form a contract holds as a value, and the form a schema keyword requires - with the element token readable back out of a reference, because that token is the surface file's own name.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-identifiers`

**Touches**:
- Entities: `Contract`, `Metamodel instance`, `Element type`

### The Validator-Read Block Is Derived, Not Restated

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-gts-traits-schema`

The system **MUST** express the meaning vocabulary as one type per concept, each with its own identifier, and **MUST** define every meaning field ONCE and hand the same definitions to both readers - the schema the abstract component type carries and the schema an author is held to - rather than maintaining a second copy of them, so the two can never disagree about what a field looks like. It **MUST** make the one mechanical adjustment the type store requires, an optional field given a null alternative and default placed so the referenced type cannot overwrite it, without changing the shape a component that sets those fields must satisfy. Where a field holds the identifier of another type, the declaration **MUST** carry both the reference and the grammar that rejects a malformed identifier, because the type store removes the reference annotation before validating and a declaration left with nothing else in it stops constraining the value at all. Where one value of a field settles the question every other value leaves open - "what may appear inside this component" answered as unconstrained or as nothing - the vocabulary **MUST** refuse detail beside it, so a contract cannot say both that nothing may appear inside and that something may, and **MUST** require detail beside the value that answers nothing on its own. Every value a field admits **MUST** be defined in the type that admits it, including what "text" means, so a reader never has to find the definition elsewhere. Where a component may be mounted **MUST** be optional, because most of the kit is mounted anywhere; and a statement about what the schema cannot assert **MUST** say what it is about, from a closed list, with the one about a property naming that property and no other carrying a name, so a family of such claims can be checked against the contract instead of read one at a time. The three answers a contract gives **MUST** stay three: an attestation carries an outcome, a prop carries a classification, a comparison carries a decision. The fields nothing else references - what the component is for, its typical uses, the invariants, the anti-patterns, the examples, the props the kit does not advertise and the host element's surface reference - stay inline rather than becoming types of their own; the props the kit does not advertise **MUST** pair every name with the reason it is not advertised. The host element's surface reference is the one field of that block an overlay **MUST NOT** write, because which element a component renders is a fact of its source, and it **MUST** resolve for a component that renders none - which is what the null alternative and default are for.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-gts-traits-schema`

**Touches**:
- Entities: `Contract`

### A Described Component's Artifacts Equal A Fresh Compile

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-freshness`

The system **MUST** compare a component's committed contract and metamodel instance - and, on every run, every committed schema that belongs to no single component: the abstract component type, the metamodel, and each vocabulary type they reference - against a fresh build, and **MUST** report every difference by path rather than reporting only that something differs. The vocabulary comparison **MUST** be driven from the union of what the builders produce and what is committed, so a committed type no builder produces is reported rather than left as a definition every registry applies and no comparison covers. The surface a component forwards to its host element is hand-written source and **MUST NOT** be compared against a build; what **MUST** hold of it instead is that the reference a contract holds resolves to a committed file whose identifier obeys the grammar, and that no committed file is named by nothing - the same union rule, over the one directory a build cannot reach. Its completeness against the attributes a component actually forwards **MUST** stay unverified: an attribute no file declares is classified as unchecked, never rejected, and the enrollment report is where that set is visible.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-freshness`

**Touches**:
- Entities: `Contract`, `Metamodel instance`, `Element type`

### Each Described Component Carries Its Own Conformance Suite

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-conformance`

The system **MUST** provide a reusable suite that fails a component's unit run when its committed artifacts no longer equal a fresh compile, when an annotated declared prop has no slot record or a shaped property has one, or when any committed shared schema has fallen behind - so that staleness reaches the developer who caused it, in the run they already execute. It **MUST** also fail that run when a property the schema cannot type has no statement naming it or a statement names a property the schema does constrain, when a filled mount point is a contract that does not accept the component inside it or lies outside the component's own family, when a family's membership disagrees with the roster every member produces, when a contract derives from anything other than the abstract component type alone, when a contract carries the marker that says a type is never instantiated, when the host-element surface a contract names is not committed, and when a committed surface is named by no contract at all. Every identifier an artifact carries **MUST** be checked through the type system's own parser as well as through this kit's patterns, because the segment grammar is a rule no local pattern restates. A component's contract **MUST** be validated in a registry holding the vocabulary its meaning schema references and the element surfaces its contracts name, and an instance's references - to its own props schema and to its host element's surface - **MUST** be resolved against that registry rather than checked for grammar alone.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-conformance`

**Touches**:
- Entities: `Contract`

### An Incompatible Change Moves The Contract Major

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-compatibility`

The system **MUST** decide a contract's backward compatibility from three signals - the type system's own comparison, the declared-prop diff and the forwarded-surface diff - **MUST** treat an addition as compatible and a removal, a narrowing or a newly required prop as not, and **MUST** accept an incompatible difference only when the contract's own major moved, naming every reason either way. The narrowing rule **MUST** be one rule over both halves of a contract: a changed type, a type appearing where none existed, a dropped enum value and an enum appearing over an existing type all reject a value a consumer used to pass, whether the property is one the component declares or one it forwards, and the type system's own comparison reports only some of them. A declared prop that left the properties but is still accepted by the forwarded surface **MUST NOT** count as a removal - nothing a consumer passes stops validating - and **MUST** still be reported, with the shapes compared where that surface declares one. The major a contract is held to **MUST** be the one its own overlay states: the acknowledgement this gate demands is worthless if giving it costs a rewrite of every identifier in the kit. It **MUST** read the forwarded surface from the reference BOTH revisions of the contract shipped with rather than from the current one alone, so that a contract which drops its host-element reference, or renders a different host element, is compared by what a consumer can still pass rather than skipped for want of something to look up. It **MUST** compare every contract present at the base reference, including one that no committed contract is the heir of: such a removal is backward-incompatible and is accepted only once the enrolled set no longer names the component, the same acknowledgement the guard demands of a removed directory. It **MUST** refuse to run at all against a base reference that names no commit in this repository, because every decision it could give against one would be vacuous. Where a comparison genuinely cannot be made - no file at the base reference for the element this contract shipped with, no committed file for the element it names now - the system **MUST** report that signal as skipped rather than let its absence read as agreement.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-compat-decision`
- `cpt-frontx-ui-kit-algo-component-contracts-compat-unit`
- `cpt-frontx-ui-kit-algo-component-contracts-compat-removal`
- `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Touches**:
- Entities: `Contract`, `Element type`

### Enforcement Is Scoped To The Change

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-guard-scope`

The system **MUST** hold to the full standard only the components a change touches that are also opted into the enrolled set, **MUST** widen that scope to every enrolled component when any file that produces or compares a compiled contract changed - the extractor, the compiler, the identifier and schema inputs, the freshness comparison and the shared comparison logic it depends on - and **MUST** treat a touched but unenrolled component as information rather than as a failure. It **MUST** widen the scope the same way, for its own reason, when the enrolled set itself changed: the file that decides which components are checked cannot be the one file no check reads, and an entry naming a directory that does not exist or an overlay that was never written **MUST** fail the guard rather than count as enrollment. It **MUST** widen it the same way again, for a third reason, when any overlay changed: one overlay's accepted components decide another component's mount points, so an overlay edit can leave a compiled contract stale in a directory the change never touched. It **MUST** widen it for a fourth reason that is not about this repository's code at all - a change to the package's own dependency manifest or to the repository's lockfile - because a committed contract carries the type system's printed type text for the packages it depends on, and the lockfile is not even visible to the package-scoped change set the rest of the guard reads. The widened scope **MUST** be the union of the enrolled set as it is and as it was at the base reference, and a component the enrolled set has DROPPED **MUST** be reported as such rather than passing as ordinarily unenrolled: de-listing is legitimate, and it is also the last moment anything can say that the component's artifacts stop being guarded. An enrolled component **MUST** ship its own conformance suite, because the freshness comparison is asserted in two runs on purpose and without the suite only the slower of them happens. Excluded from the compile-or-compare widening are only the guard's own entry point, because nothing on the comparison path imports it and re-checking on it would be circular, its own tests, and prose.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-guard`
- `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Constraints**: `cpt-frontx-ui-kit-constraint-contracts-repository-only`

**Touches**:
- Entities: `Enrolled set`, `Component`

### Kit-Wide Enrollment Is Reported, Never Enforced

- [x] `p1` - **ID**: `cpt-frontx-ui-kit-dod-component-contracts-enrollment-report`

The system **MUST** report the described set against the component set, with a per-directory breakdown that distinguishes an export still to be described from an export that is correctly not a component, **MUST** name every entry that grants enrollment over nothing and leave it out of the described count, and **MUST NOT** derive an exit code from any of those numbers.

**Implements**:
- `cpt-frontx-ui-kit-algo-component-contracts-enrollment`
- `cpt-frontx-ui-kit-flow-component-contracts-guard-change`

**Touches**:
- Entities: `Enrolled set`

## 6. Acceptance Criteria

- [x] An overlay restating a field the code owns - the host element's surface reference among them - carrying an undefined field, declaring the wrong component, or naming an absent prop is refused by name, and no artifact is written.
- [x] An overlay's recommendation for a ruled-out use always states what a reader acts on, and names the kit component by reference where the kit ships one; where it ships none, the absence of that reference is the statement, rather than the nearest kit component standing in for one. A recommendation with no target is refused.
- [x] A component's variant axes, their values and their defaults appear in its contract as read from the code, and an axis declared twice by two heritage entries is reported naming both rather than silently resolved.
- [x] A variant axis keyed by the boolean literals compiles to a boolean property with a boolean default, not to the string enum its keys look like; a string axis is unaffected; a default of any other kind fails the compile instead of vanishing.
- [x] A wrapper import renamed at its import site, and a locally shadowed utility type of the same name as a real one, are both classified by what they resolve to rather than by what they are called.
- [x] A prop the component declares appears in its contract; so does a prop the primitive library declares for the part it wraps, unless the overlay hides it; a prop React declares as an attribute of the host element appears in the shared surface for that element and not in the contract's own properties.
- [x] A declared prop with no schema equivalent appears as an annotated property with a matching slot record; an API prop with no schema equivalent appears as an annotated property with no slot record, because the kit's slot record is for the kit's own slots.
- [x] No property of a compiled contract or a host-element surface is empty: one that asserts nothing names its TypeScript type and says the type system checks it, so a generic, a function or a union of non-literal members is never readable as an unconstrained value. Checked across every committed surface, not one of them, so the file written next is held to the rule as well.
- [x] Every property that asserts nothing (or asserts only part of its shape) is named by exactly one `props` statement, and every key of `props` names a property that asserts nothing (or only part of its shape) - checked both ways on every described component's run, keyed on the property itself.
- [x] A component carrying a prop declared by neither itself, the primitive library nor React's DOM attribute types is refused naming those props and where they are declared; one forwarding DOM attributes with no resolvable host element is refused naming those props; one whose host element has no committed surface is refused naming the element and the file to write.
- [x] A prop a component declares and a prop the primitive declares for the same name resolve to one property, with the component's own declaration kept; a property whose name the host-element surface also declares with a conflicting shape is refused naming both sides.
- [x] A contract derives from exactly one type, the abstract component type: its `allOf` carries that one parent and nothing else, and the surface of the host element it renders is a reference both its props schema and its metamodel instance hold, resolving to a committed file. A component that renders no host element of its own holds no such reference in either half. The abstract type carries the marker that says a type is never instantiated, and no component's contract does.
- [x] A validator that resolves that reference and applies the surface beside the contract rejects a value the surface types; one that ignores the reference gets the open unchecked classification, which is the honest answer for a reader that never looked the surface up. A malformed reference is refused by grammar, and one naming a surface no committed file declares is refused by name.
- [x] A contract's identifier is a type derived from the abstract component type and parses into the expected segments through the type system's own parser; a metamodel instance's identifier is not a type; a reference to a component is that component's own derived identifier; a host-element surface's identifier carries the element in the same token grammar, with a hyphenated tag normalized only there.
- [x] A prop nothing in a contract evaluates is admitted rather than rejected, and the harness's own report says which props are known, which are unchecked, and which unchecked name is one edit from a prop the contract declares - a near miss of a forwarded DOM attribute among the unchecked ones, not among the near misses. A name a surface PATTERN would admit is still reported as a near miss when it is one edit from a prop the contract declares, and is known only when it is not.
- [x] Every attribute more than one host-element surface declares is declared identically in each of them, and a compile against surfaces that disagree is refused naming the attribute and what each file states.
- [x] A committed host-element surface no contract names fails a described component's run as stale, the way a committed vocabulary type no builder produces does.
- [x] The enrollment report lists, per described contract, the props it forwards that its host element's surface declares by neither name nor pattern, and sets no exit code for them: the surface's completeness is unchecked by design, and an undeclared attribute is reported unchecked rather than rejected.
- [x] Every entry in the props the kit does not advertise carries both the prop and the reason it is not advertised, the reason reaching the compiled contract rather than a separate claim beside it; an entry naming a prop the primitive does not declare, or one the component declares itself, is refused by name.
- [x] The schema carried by the abstract component type equals a fresh build from the one field-by-field definition an author is also held to, states each of its fields as a reference to the type that owns the concept, and rejects an unknown key in a contract's meaning block by name.
- [x] A contract validated in a registry that is missing one of the vocabulary types its meaning schema references fails naming the unresolved reference, rather than passing against a schema that was never applied.
- [x] A metamodel instance whose props schema is absent from the registry is refused naming the unresolved reference, and one whose reference is malformed is refused by grammar.
- [x] Every committed shared schema - the abstract component type, the metamodel, each vocabulary type - equals a fresh build on every described component's run.
- [x] Editing a described component without recompiling fails that component's own unit run, with the difference reported by path.
- [x] Removing a prop, making an optional prop required, dropping a value from a variant axis, or adding a type or an enum over a property that accepted more before, is refused at an unchanged contract major and accepted with the major moved, in both cases naming every reason; adding a prop is accepted either way. The major that moves is the one the component's own overlay states: moving it rewrites that component's own contract, instance and identifiers, and every reference another contract holds to it, because a reference carries the target's major - the acknowledgement costs one component and its referrers rather than the whole kit. A reference left at the old major fails the conformance suite's reference check, and an accepted-components list still naming the component at its old major fails the compile naming the overlay, rather than the filled mount point that reference produced quietly disappearing.
- [x] A declared prop that leaves the contract's properties while the forwarded surface still accepts it is reported as moved, not as removed, and does not require a major move; one the surface accepts with a stricter shape is still a narrowing.
- [x] A contract whose file moved is compared against its earlier path rather than reported as new.
- [x] A change touching a component that is not opted into the enrolled set passes with that component reported as not yet requiring a contract.
- [x] A change to any file on the compile-or-compare path - the shared comparison logic included - re-checks every enrolled component, not only the ones the change touched; a change to the guard's own entry point does not.
- [x] A contract that stops naming its host-element surface is refused naming every forwarded prop that disappeared with it, rather than passing because there was no element left to look up.
- [x] A contract whose host element moved is compared across the move and refused when a forwarded prop does not survive it; a move every prop survives passes, naming the move. Narrowing a shared element surface itself is refused for every contract that names it.
- [x] A contract present at the base reference that no committed contract is the heir of is reported as a removal: refused while the enrolled set still names its component, accepted and named once it does not; a contract that merely moved is reported as renamed and compared, not as a removal.
- [x] A base reference that names no commit in this repository stops both the guard and the compatibility check with that reference named, instead of a run in which every contract reads as new.
- [x] An enrolled component whose directory has been removed fails the guard, naming the enrolled-set entry to remove.
- [x] A change to the enrolled set re-checks every component it names; an entry naming no component directory, or a directory with no overlay, fails the guard and is reported by the enrollment report without being counted as enrollment.
- [x] A change to any overlay re-checks every enrolled component; a change to a compiled artifact alone does not.
- [x] A change to the package's dependency manifest, or to the repository's lockfile, re-checks every enrolled component.
- [x] An enrolled component that ships no conformance suite fails the guard; a component the enrolled set has dropped is reported as de-listed and does not fail.
- [x] A committed vocabulary type no builder produces is reported as stale, rather than being registered everywhere and compared nowhere.
- [x] A component's mount points are filled from every other contract's accepted components, never authored: an overlay writing a component reference there is refused with the fact that fills it, a container outside the kit is authored beside the filled ones, and a part of a compound component is only ever filled a mount point inside its own family.
- [x] What a component accepts inside it is always stated: "unconstrained" for a component that accepts whatever a consumer puts in it, "nothing" for one that renders its own body, and "specified" with at least one of accepted components or text beside it. Detail beside either of the first two is refused by the vocabulary, and "specified" with no detail is refused too.
- [x] Every `props` entry is keyed on a real property of the component, checked against the extraction; every `unexposed_parts` entry names the internal part and why it is not exposed.
- [x] The enrollment report prints the described set against the component set and sets no exit code, whatever the numbers are.
- [x] Every member of a compound component's family names the family by the same token and states its own role; the root carries the member list the other members' own statements produce, a part carries none, and a family with two roots or no root at all fails the compile naming both sides.
- [x] Every meaning field appears exactly once across a component's two artifacts: in the contract's own meaning block, and nowhere in the instance beside it - which carries its identity, the vocabulary version and the two references a type registry resolves, and nothing else.
- [x] Recompiling every described component produces byte-identical artifacts whatever else ran in the same process, and the counting that feeds the enrollment report and the guard's completeness check never reaches the extraction a contract is compiled from.
- [ ] A compatibility run states its comparison source, and a run against a published version of the package reports what a consumer upgrading to the committed contracts would experience - not only what changed since a branch point.
