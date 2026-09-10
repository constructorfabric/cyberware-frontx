# Feature: Template Manifest Contract & Pre-Publish Validation


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Validate Template for Publication](#validate-template-for-publication)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Validate Template Structure Against the Manifest Contract](#validate-template-structure-against-the-manifest-contract)
  - [Validate Content Self-Containment](#validate-content-self-containment)
  - [Refuse a Legacy Manifest Outright](#refuse-a-legacy-manifest-outright)
- [4. States (CDSL)](#4-states-cdsl)
  - [TemplateManifest Validation State Machine](#templatemanifest-validation-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Manifest Contract Validation Command](#manifest-contract-validation-command)
  - [Manifest as Single Authoritative Description](#manifest-as-single-authoritative-description)
  - [Legacy Manifest Is Refused Outright, Never Migrated](#legacy-manifest-is-refused-outright-never-migrated)
  - [Content Self-Containment Is Checked at Pre-Publish Validation](#content-self-containment-is-checked-at-pre-publish-validation)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-template-manifest`
## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-template-manifest`

### 1.1 Overview

The template manifest contract defines the single versioned descriptor every publishable template exposes, validated at pre-publish time and consumed at install, register, apply, and assembly time - giving the CLI one authoritative description to check and read generically. This feature owns the manifest's concrete schema: exactly four declared fields - (1) `name`, (2) `version`, (3) `excludedSubtrees` (the strict descendants of the template's own target where the author permits another template to nest), and (4) a required, non-empty `description` - where a template declares what it produces, the ground it excludes from its own default whole-target ownership, and, in its own prose, what it establishes, how it should be used once applied, and what it contributes so that a caller holding no reference can choose it.

### 1.2 Purpose

This feature defines and enforces the conformance contract (`cpt-frontx-contract-template-manifest`) that every template must satisfy to be publishable, and owns its concrete field-level schema per `cpt-frontx-adr-contract-schema-ownership`. The manifest is a single file named `frontx-template.json` located at the root of the template directory. The CLI validates a candidate template's manifest against exactly four declared fields before publication, and the same manifest is read at install, register, apply, and assembly time so one authoritative description serves all commands (`cpt-frontx-adr-template-manifest-contract`). The four fields are: **`name`** (the template's identity); **`version`** (a versioned shape); **`excludedSubtrees`** (the strict descendants of the template's own target where the author intends another template to nest - the one input to a template's effective ownership boundary that whole-target ownership cannot derive on its own, `cpt-frontx-adr-template-ownership-boundary-declaration`); each entry names a directory reserved for a nested template's own target, never a single file or a glob pattern - a glob is discovery mechanics belonging to the content of a file the host still owns (an npm `workspaces` array, say), and a shared file the host owns stays host-owned rather than becoming an entry itself, so its post-instantiation evolution is a developer's or an AI-scaffolding step's concern, not this manifest's; and **`description`** (a required, non-empty prose statement that is the sole carrier of both selection semantics - what the template establishes, for a caller with no reference to choose it by - and post-instantiation usage semantics, `cpt-frontx-adr-template-manifest-contract`). A template owns its entire applied target by default; the manifest declares no separate ownership category for that default, only the exclusions to it. `referencedTemplates`, `sharedFiles` (with its merge strategies and region markers), `exclusiveSubtrees`, and `schemaVersion` are not declared by this contract: composition is now driven by the caller's explicit application of each template rather than by one template naming the others it composes with, and a template's ownership is now computed algorithmically as its whole target minus its declared exclusions rather than separately declared as exclusive subtrees or shared-file regions (`cpt-frontx-adr-template-manifest-contract`, `cpt-frontx-adr-template-ownership-boundary-declaration`). A manifest declaring any of them is never read directly by the four-field type, and this feature owns no migration path from that shape into this one: any manifest carrying an undeclared field — the discriminator `cpt-frontx-adr-template-manifest-contract` fixes — is refused outright by every command that reads a manifest (install, register, apply, assembly), mirroring how a legacy `.frontx/project.json` predecessor, `.frontx/provenance.json`, is already refused rather than translated (`cpt-frontx-adr-project-provenance-record`). A template published with any of those fields is converted manually to the four-field shape before any command will read it; for this repository's own two templates, that conversion is `cpt-frontx-feature-template-territory-conversion`'s scope.

The **description** field is **required and non-empty**: a manifest omitting it, or declaring it as anything other than a non-empty string, fails pre-publish validation - a field declared empty says nothing and is a violation rather than a silent absence. It carries prose only and is drawn from no closed set, so declaring it reintroduces none of the template classification `cpt-frontx-adr-uniform-template-mechanism` removed. Its primary consumer is template selection (`cpt-frontx-feature-ai-project-scaffolding`), which matches a stated intent against it; because `description` is now the manifest's sole semantic carrier, it also states any post-instantiation usage discipline the template requires - for example, that it is applied once per unique target and later projects import from it rather than reapplying it - so an AI agent or human reads one field for both concerns instead of cross-referencing a second structured field that could drift out of agreement with it (`cpt-frontx-adr-template-manifest-contract`). Pre-publish validation checks the field's presence-and-shape only - that it is present and is a non-empty string - and never judges whether the prose accurately describes the template or correctly states its usage discipline, which no structural check can establish.

**Authoring checklist for `description` - guidance, not a validated rule.** Pre-publish validation checks only that `description` is present and non-empty (§3, "Validate Template Structure Against the Manifest Contract"); it never checks whether the prose is any good, because no structural check can. The following is guidance for a template author writing that prose well, not a further rejection rule this feature's algorithm enforces:
- **When to choose this template** - what the template establishes, in terms a caller holding no other reference can match against a stated intent (the selection use `cpt-frontx-feature-ai-project-scaffolding` matches against).
- **Usage discipline** - whether the template is meant to be applied once and then imported from by every later consumer (apply-once-then-import), or applied again per unit of the caller's own choosing (apply-per-unit, e.g. "apply once per page"; `cpt-frontx-feature-ai-project-scaffolding`'s description-driven multiplicity reads exactly this).
- **Semantic preconditions** - a condition this contract cannot structurally enforce but a caller must satisfy before applying, such as "requires an applied shell" or "expects a sibling template already applied at a named target."
- **Expectations about the target** - what shape or role the caller's chosen target should have (a package directory, an app root, a feature folder) so the template lands where its own assumptions hold.

**Payload - owned here.** A template's *payload* is the concrete file set `install` acquires and `apply` materializes into a target: the whole template directory minus its own manifest (`frontx-template.json`) minus the conventional `.frontx/ai/<manifest-name>/` bundle folder, when the template carries one - the latter delivered to a project through a separate CLI-owned step this feature does not own (`cpt-frontx-algo-cli-scaffolding-ai-bundle`, `cpt-frontx-feature-cli-scaffolding`), never through a template's own ownership. A template directory carries only its payload: authoring or development tooling a template's own maintainer needs to build, lint, or test the template against a live dependency - a dev-time `package.json` with `file:` overrides, a local dev-harness, and the like - does not live inside the template directory at all (a **pure-payload** convention), so nothing a maintainer runs to develop the template is ever confused with what the template ships or scanned as if it were shipped content. The content self-containment check (`cpt-frontx-algo-template-manifest-validate-content-self-containment`) enumerates exactly this payload, minus the manifest's own declared `excludedSubtrees`, when scanning for an escaping filesystem-path reference — the payload as this paragraph defines it, not the template directory undifferentiated from its manifest or its AI-extension bundle convention.

**AI-extension bundle write path - resolved.** `.frontx` is unconditionally excluded from every template's effective ownership under whole-target ownership (`cpt-frontx-adr-template-ownership-boundary-declaration`), so a template's manifest cannot claim any path under `.frontx` - including an identity-scoped AI-extension bundle root such as `.frontx/ai/<manifest-name>/` - as an `excludedSubtrees` entry or through any other category this contract declares. That write path is not left to this contract: a template's payload may carry a conventional `.frontx/ai/<manifest-name>/` folder at the root of the template directory (per `cpt-frontx-feature-template-manifest`'s own payload definition, §1.2), and a dedicated CLI-owned step this feature does not own copies that folder out to the project's `.frontx/ai/<manifest-name>/` the first time the name gains an applied target (`cpt-frontx-algo-cli-scaffolding-ai-bundle`, `cpt-frontx-feature-cli-scaffolding`) - never through this manifest's `excludedSubtrees` or any category it declares.

**Reserved CLI-owned `.frontx/` namespace.** `.frontx` as a whole holds CLI-owned metadata, never template content: the single project state document, `.frontx/project.json` (schema owned by `cpt-frontx-feature-composed-provenance`), is the CLI's own record of a project's registered templates, their origins and versions, and their applied targets, and is written only by the CLI's own commands. Because whole-target ownership already subtracts `.frontx` unconditionally from every template's effective ownership (`cpt-frontx-adr-template-ownership-boundary-declaration`, CLI-5), this manifest contract has no declared category through which a template could claim ground under `.frontx` in the first place; this paragraph documents that reservation as a fact of the domain model rather than as a further rule this feature's validation algorithm enforces.

**Requirements**: `cpt-frontx-fr-cli-template-validate-prepublish`, `cpt-frontx-fr-cli-template-boundary-declaration`

**Contracts (owned)**: `cpt-frontx-contract-template-manifest`

**Principles**: none owned by this feature

**Applicability** (Often-N/A domains for a CLI Command feature, per the FEATURE checklist's Applicability Context): PERF, OPS (observability), and COMPL are not applicable — pre-publish validation owns no scale NFR, introduces no logging/metrics/tracing surface, and carries no regulatory scope. SEC is partially addressed rather than N/A: content self-containment validation (`cpt-frontx-algo-template-manifest-validate-content-self-containment`) is itself a path-traversal-adjacent control, rejecting a template whose own content would escape its own directory; this feature otherwise enforces no authentication or authorization boundary. UX is addressed by the violations list reported to the template developer (§2).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-template-developer` | Authors a template's manifest to conform to the contract, runs pre-publish validation to confirm the template is publishable, and resolves any reported violations before publication. |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: `cpt-frontx-adr-template-manifest-contract`, `cpt-frontx-adr-template-ownership-boundary-declaration`
- **Dependencies**: `cpt-frontx-feature-template-resolution` (F10)

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor (human or external system) and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: `cpt-frontx-usecase-publish-template-with-extension-points`

### Validate Template for Publication

- [x] `p1` - **ID**: `cpt-frontx-flow-template-manifest-validate-for-publication`

**Actor**: `cpt-frontx-actor-template-developer`

**Success Scenarios**:
- Template manifest conforms to the contract; the developer receives a PASS and proceeds to publish.

**Error Scenarios**:
- Template manifest is missing, structurally malformed, or fails contract checks; the developer receives a FAIL with a list of violations and must correct the manifest before retrying.
- A file within the template's own content - the candidate template directory outside its declared `excludedSubtrees` - references a filesystem path - per the known-carrier registry (currently: a `package.json` `file:` specifier; a tsconfig file's `compilerOptions.paths` mapping, `extends` target, `references[].path` entry, `files`/`include`/`exclude` entry, or one of its path-valued `compilerOptions` (`baseUrl`, `rootDir`, `rootDirs`, `outDir`, `declarationDir`, `outFile`, `tsBuildInfoFile`, `typeRoots`); or a lockfile workspace-member key/`resolved` entry) - that resolves outside the candidate template directory; the developer receives a FAIL naming the offending file and path and must correct the reference before retrying.
- The candidate's content cannot be inspected at all - the filesystem refuses to enumerate the candidate template directory or a declared `excludedSubtrees` entry (a permission-denied directory, a path that vanished mid-walk), or a declared `excludedSubtrees` entry cannot be honestly resolved because it is a broken symlink or resolves outside the candidate template directory; the developer receives a FAIL naming the path that could not be read, never a PASS and never a raw runtime error. A check that cannot look must not report the outcome of having looked, and a declared boundary that does not hold is refused rather than treated as empty content.

**Steps**:
1. [x] - `p1` - Template developer invokes the CLI pre-publish validate command on the candidate template directory - `inst-invoke-validate`
2. [x] - `p1` - CLI locates the manifest file (`frontx-template.json` at the root of the candidate template directory) - `inst-locate-manifest`
3. [x] - `p1` - **IF** the manifest file is absent - `inst-if-manifest-absent`
   1. [x] - `p1` - **RETURN** FAIL with violation: manifest file not found - `inst-return-manifest-absent`
4. [x] - `p1` - CLI delegates to the manifest validation algorithm (`cpt-frontx-algo-template-manifest-validate-contract`) - `inst-delegate-to-algo`
5. [x] - `p1` - **IF** the validation result is REJECTED - `inst-if-rejected`
   1. [x] - `p1` - CLI reports all violations to the developer with their locations - `inst-report-violations`
   2. [x] - `p1` - **RETURN** FAIL exit code - `inst-return-fail`
6. [x] - `p2` - **ELSE** (manifest contract is VALIDATED), CLI additionally delegates to the content self-containment algorithm (`cpt-frontx-algo-template-manifest-validate-content-self-containment`), which inspects every file reachable under the candidate template directory outside its declared `excludedSubtrees` - the template's own content, as distinct from ground reserved for a nested template; a refusal raised while enumerating that surface - a filesystem refusal, or a declared `excludedSubtrees` entry that is a broken symlink or resolves outside the candidate template directory - is converted here into a FAIL naming what could not be read, since the command is the one boundary that owns the exit code - `inst-delegate-to-content-algo`
7. [x] - `p2` - **IF** the content self-containment result carries violations - `inst-if-content-violations`
   1. [x] - `p2` - CLI reports all content violations to the developer, naming the offending file and the escaping path - `inst-report-content-violations`
   2. [x] - `p2` - **RETURN** FAIL exit code - `inst-return-content-fail`
8. [x] - `p1` - **ELSE** (manifest contract VALIDATED and content self-containment carries no violations) - `inst-else-pass`
   1. [x] - `p1` - CLI reports PASS to the developer - `inst-report-pass`
   2. [x] - `p1` - **RETURN** success exit code - `inst-return-pass`

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures that do not interact with actors directly. Examples: validation routines, library functions. These are reusable building blocks called by Actor Flows or other processes.

### Validate Template Structure Against the Manifest Contract

- [x] `p1` - **ID**: `cpt-frontx-algo-template-manifest-validate-contract`

**Input**: candidate template directory path, manifest contract shape (the single authoritative description read at install, register, apply, and assembly time - `cpt-frontx-contract-template-manifest`) whose concrete schema declares exactly four fields: `name`, `version`, `excludedSubtrees`, and a required non-empty `description`

**Output**: validation result (VALIDATED with no violations, or REJECTED with a list of violations)

**Steps**:
1. [x] - `p1` - Read the manifest file from the candidate template directory - `inst-read-manifest`
2. [x] - `p1` - Parse the manifest into an in-memory structure - `inst-parse-manifest`
3. [x] - `p1` - **IF** the manifest cannot be parsed (malformed format) - `inst-if-parse-error`
   1. [x] - `p1` - Add violation: manifest is unparseable - `inst-add-parse-violation`
   2. [x] - `p1` - **RETURN** REJECTED with violations - `inst-return-parse-rejected`
4. [x] - `p1` - Verify that the manifest declares an identity field (name) - `inst-check-identity`
5. [x] - `p1` - **IF** identity field is absent or empty, or is not usable as a repository-relative path - the identity addresses the template's installed content path, so pre-publish validation refuses a value install would refuse - `inst-if-identity-missing`
   1. [x] - `p1` - Add violation: identity field is required and must be usable as a repository-relative path - `inst-add-identity-violation`
6. [x] - `p1` - Verify that the manifest declares a version field conforming to the versioned shape - `inst-check-version`
7. [x] - `p1` - **IF** version field is absent or malformed - `inst-if-version-missing`
   1. [x] - `p1` - Add violation: version field is required and must conform to the versioned shape - `inst-add-version-violation`
8. [x] - `p1` - Verify that the manifest declares the `excludedSubtrees` category - the list (possibly empty) of strict descendants of the template's own target where the author intends another template to nest; no other boundary category is declared - `inst-check-excluded-subtrees`
9. [x] - `p1` - **FOR EACH** declared `excludedSubtrees` entry - `inst-for-each-excluded-subtree`
   1. [x] - `p1` - **IF** the entry is not a well-formed target-relative path, lacks a trailing `/`, or contains a `..` segment - `inst-if-excluded-subtree-malformed`
      1. [x] - `p1` - Add violation: an `excludedSubtrees` entry must be a well-formed target-relative directory path ending in a trailing `/`, with no `..` segment - relative to the template's own target, not to the repository the template is eventually applied into, since the manifest is authored before any target is known. The trailing `/` is the one directory marker pre-publish validation can decide without inspecting the filesystem: the entry names ground reserved for a nested template's target, and the same contract forbids the host's own payload from writing inside it, so the path normally does not exist in the candidate directory and has no on-disk type to check - the trailing slash is a syntactic contract, not a filesystem fact, and its absence is a violation regardless of whether anything happens to exist at the path. A glob pattern is malformed for the same underlying reason: the entry reserves a directory for a nested template's target, not a hook into a file's own content or a discovery pattern over one - `inst-add-excluded-subtree-malformed-violation`
   2. [x] - `p1` - **IF** the entry does not resolve to a strict descendant of the template's own target - it is empty, coincides with the target itself, or otherwise escapes it - `inst-if-excluded-subtree-escapes-target`
      1. [x] - `p1` - Add violation: an `excludedSubtrees` entry must be a strict descendant of the template's own target - `inst-add-excluded-subtree-escapes-violation`
10. [x] - `p1` - Verify the description category: the template's own required, non-empty prose statement of what it establishes, how it is used, and what it contributes, which selection matches a stated intent against - `inst-check-description`
11. [x] - `p1` - **IF** the manifest omits `description`, or declares a `description` that is not a non-empty string - `inst-if-description-invalid`
    1. [x] - `p1` - Add violation: `description` is required and must be a non-empty string - its absence is itself a violation, not a permitted omission - `inst-add-description-violation`
12. [x] - `p1` - **IF** any violations were accumulated - `inst-if-violations`
    1. [x] - `p1` - **RETURN** REJECTED with the accumulated violations list - `inst-return-rejected`
13. [x] - `p1` - **RETURN** VALIDATED with no violations - `inst-return-validated`

### Validate Content Self-Containment

- [x] `p2` - **ID**: `cpt-frontx-algo-template-manifest-validate-content-self-containment`

Closes the gap the manifest-contract check alone leaves open: the contract validates the manifest's *declared* `excludedSubtrees`, but nothing about that check inspects the *content* the template itself owns. A file within the template's own content can carry a filesystem-path reference - per the known-carrier registry (currently: a `package.json` `file:` dependency specifier; a tsconfig file's `compilerOptions.paths` mapping, `extends` target, `references[].path` entry, `files`/`include`/`exclude` entry, or one of its path-valued `compilerOptions` (`baseUrl`, `rootDir`, `rootDirs`, `outDir`, `declarationDir`, `outFile`, `tsBuildInfoFile`, `typeRoots`); or a lockfile workspace-member key / `resolved` entry) - that resolves outside the candidate template directory, and the contract check has no way to observe it. The registry is extensible: a carrier is anything this algorithm can parse structurally, and adding one is a code change here, not a spec rewrite. Deliberately out of scope: a `package.json` `workspaces` glob (a discovery pattern, not a literal path reference) and any file that is not a JSON carrier by name (e.g. a Vite config alias) - this algorithm parses every carrier structurally and never scans raw text, so a form it cannot parse is not in the carrier set at all. That is not the same as tolerating an unparseable carrier: a file the registry DOES claim, whose content cannot be read or parsed, is a violation rather than a skip.

This algorithm inspects the actual on-disk content the template itself owns - its **payload** (§1.2): the candidate template directory as a whole, minus the manifest file itself, minus the conventional `.frontx/ai/<manifest-name>/` bundle folder when present (a CLI-owned delivery, never this template's own content, `cpt-frontx-feature-cli-scaffolding`), minus its declared `excludedSubtrees` (ground reserved for a nested template's own content, not this template's, `cpt-frontx-adr-template-ownership-boundary-declaration`) - generically: it reads the manifest's own `excludedSubtrees` declaration and knows no template name, so it applies unchanged to every template.

**Input**: candidate template directory path, the manifest's declared `excludedSubtrees`

**Output**: validation result (VALIDATED with no violations, or REJECTED with a list of violations naming the offending file and either the escaping path or the reserved naming convention it collides with)

**Steps**:
1. [x] - `p2` - Enumerate every regular file reachable under the candidate template directory that is part of the payload (§1.2) - excluding the manifest file itself, the conventional `.frontx/ai/<manifest-name>/` bundle folder when present, and anything that falls within a declared `excludedSubtrees` entry (ground reserved for a nested template, not this template's own content) - including a dot-prefixed directory or dot-file (legitimate template content, e.g. `.gitignore`), never descending into a `node_modules` directory (install-time output, never committed template content) - `inst-csc-enumerate-files`
2. [x] - `p2` - **FOR EACH** enumerated file - `inst-csc-foreach-enumerated`
   1. [x] - `p2` - **IF** the file's path matches the CLI's reserved temporary-file naming convention (`inst-com-materialize-temp`, `cpt-frontx-feature-upgrade-changeset`) - `inst-csc-if-reserved-name`
      1. [x] - `p2` - Add violation naming the file and the reserved convention it collides with - a payload path carrying this name is never classified, written, or reported once an upgrade's own write phase excludes it from comparison, so it is not admissible payload in the first place - `inst-csc-add-reserved-name-violation`
3. [x] - `p2` - **FOR EACH** enumerated file whose name identifies it as a carrier of filesystem-path specifiers (`package.json`, a `tsconfig*.json` file, or an npm lockfile) - `inst-csc-for-each-carrier`
   1. [x] - `p2` - Read and parse the carrier file's content structurally - never by pattern-matching the raw text; a `tsconfig*.json` carrier is parsed JSONC-tolerantly (comments, trailing commas, and a leading byte-order mark allowed, matching what `tsc`'s own config reader accepts), while a `package.json` or lockfile carrier is parsed as strict JSON; a carrier that cannot be read, or whose content cannot be parsed under its own tolerance, is itself a violation naming the file and the carrier kind, since a carrier the algorithm did not inspect must not be indistinguishable from one it inspected and found clean - `inst-csc-parse-carrier`
   2. [x] - `p2` - Extract every path-like specifier the carrier's shape declares, per the known-carrier registry (currently: a `file:` dependency specifier in `package.json`; a `compilerOptions.paths` mapping entry (resolved against `baseUrl`), an `extends` target, a `references[].path` entry, a `files`/`include`/`exclude` entry, or a path-valued `compilerOptions` entry (`baseUrl`, `rootDir`, `rootDirs`, `outDir`, `declarationDir`, `outFile`, `tsBuildInfoFile`, `typeRoots`) in a tsconfig file; or a workspace-member key or a non-registry `resolved` entry in a lockfile) - `inst-csc-extract-specifiers`
   3. [x] - `p2` - **FOR EACH** extracted specifier - `inst-csc-for-each-specifier`
      1. [x] - `p2` - Resolve the specifier to a path relative to the candidate template directory, taken relative to the carrier file's own directory (and, for a tsconfig `paths` entry, relative to its `baseUrl`) rather than by pattern-matching `..` segments; a glob pattern resolves by the directory prefix it is anchored at, since that prefix is the whole of what containment can be decided from; an absolute, drive-prefixed, or home-relative (`~`) specifier is outside the root by definition, since every specifier in this resolution is contractually root-relative - `inst-csc-resolve-specifier`
      2. [x] - `p2` - **IF** the resolved path lies outside the candidate template directory - `inst-csc-if-outside-root`
         1. [x] - `p2` - Add violation naming the carrier file, the specifier, and the resolved path - `inst-csc-add-violation`
4. [x] - `p2` - **IF** any violations were accumulated - `inst-csc-if-violations`
   1. [x] - `p2` - **RETURN** REJECTED with the accumulated violations list - `inst-csc-return-rejected`
5. [x] - `p2` - **RETURN** VALIDATED with no violations - `inst-csc-return-validated`

### Refuse a Legacy Manifest Outright

- [x] `p2` - **ID**: `cpt-frontx-algo-template-manifest-refuse-legacy`

Closes the read-side counterpart to pre-publish validation: a manifest declaring any category this contract does not define is never read as, or translated into, the four-field shape (`cpt-frontx-adr-template-manifest-contract`). This is the one check every manifest-reading command (install, register, apply, assembly) runs before reading a manifest as the primary type; its output is either the manifest unchanged (already current) or an outright refusal — never a translated shape, and never a partial one.

**Input**: A parsed manifest JSON structure.

**Output**: The manifest unchanged, ready for the primary manifest type, when it is already current; or a validation refusal naming the undeclared field(s) present, when it declares any. There is no migrated output: a legacy manifest never reaches the primary four-field type by any path, so this refusal blocks every command that reads a manifest, `install` included — mirroring how a legacy `.frontx/provenance.json` is detected and refused outright, with no migration path of any kind (`cpt-frontx-adr-project-provenance-record`).

**Steps**:
1. [x] - `p2` - Determine whether the manifest carries at least one undeclared field (`schemaVersion`; `ownershipBoundaries` or its `exclusiveSubtrees`/`sharedFiles` children; `referencedTemplates`) — the discriminator `cpt-frontx-adr-template-manifest-contract` fixes for "legacy" versus "current" - `inst-mrl-discriminate`
2. [x] - `p2` - **IF** no undeclared field is present - `inst-mrl-if-current`
   1. [x] - `p2` - **RETURN** the manifest unchanged; a current-shape manifest is never subject to this refusal - `inst-mrl-return-current`
3. [x] - `p2` - **ELSE** (at least one undeclared field is present) - `inst-mrl-else-legacy`
   1. [x] - `p2` - **RETURN** a validation refusal (`INVALID_MANIFEST`) naming every undeclared field present, regardless of whether the description is usable or the declared `exclusiveSubtrees`/`sharedFiles` were already effectively whole-target: this decision fixes no partial credit for a legacy manifest that happens to be close to the current shape. The refusal directs the template's author to convert it manually, choosing a deliberate `excludedSubtrees` for the current shape, the same conversion path `cpt-frontx-feature-template-territory-conversion` already performs for this repository's own templates - `inst-mrl-return-legacy-refused`

## 4. States (CDSL)

Include when entities have explicit lifecycle states.

### TemplateManifest Validation State Machine

- [x] `p1` - **ID**: `cpt-frontx-state-template-manifest-validation-lifecycle`

**States**: DRAFT, VALIDATED, PUBLISHED, REJECTED

**Initial State**: DRAFT

**Transitions**:
1. [x] - `p1` - **FROM** DRAFT **TO** VALIDATED **WHEN** the CLI pre-publish validate command completes with no violations - `inst-draft-to-validated`
2. [x] - `p1` - **FROM** DRAFT **TO** REJECTED **WHEN** the CLI pre-publish validate command reports one or more violations - `inst-draft-to-rejected`
3. [x] - `p1` - **FROM** REJECTED **TO** DRAFT **WHEN** the template developer corrects the manifest and prepares a new candidate - `inst-rejected-to-draft`
4. [x] - `p1` - **FROM** VALIDATED **TO** PUBLISHED **WHEN** the template developer publishes the template to its distribution channel - `inst-validated-to-published`

## 5. Definitions of Done

Specific implementation tasks derived from flows/algorithms above.

### Manifest Contract Validation Command

- [x] `p1` - **ID**: `cpt-frontx-dod-template-manifest-validate-command`

The system **MUST** implement the CLI pre-publish validate command (`target`) that locates the manifest file in a candidate template directory, executes the manifest validation algorithm, reports a PASS on success or a FAIL with a full violations list on failure, and returns appropriate exit codes so CI pipelines can gate publication automatically.

**Implements**:
- `cpt-frontx-flow-template-manifest-validate-for-publication`
- `cpt-frontx-algo-template-manifest-validate-contract`

**Constraints**: none directly owned; `cpt-frontx-adr-template-manifest-contract` governs contract evolution

**Touches**:
- CLI: pre-publish validate command (`target`)
- Entities: `TemplateManifest`
- Component: `cpt-frontx-component-cli`

### Manifest as Single Authoritative Description

- [x] `p1` - **ID**: `cpt-frontx-dod-template-manifest-single-description`

The system **MUST** ensure the same manifest shape (`cpt-frontx-contract-template-manifest`) - exactly `name`, `version`, `excludedSubtrees`, and a required non-empty `description` - that the pre-publish validate command checks is the shape consumed at install, register, apply, and assembly time; there is exactly one descriptor per template, no per-command divergence, and no command reads a different or partial descriptor. `description` is required: a manifest omitting it, or declaring it as anything other than a non-empty string, is rejected (`target`). A manifest declaring any undeclared field **MUST NOT** reach this shape by any path: `cpt-frontx-algo-template-manifest-refuse-legacy` refuses it outright at every command surface, `install` included, never admitting an undeclared field onto the primary type and never translating one into it (`cpt-frontx-adr-template-manifest-contract`).

**Implements**:
- `cpt-frontx-algo-template-manifest-validate-contract`
- `cpt-frontx-algo-template-manifest-refuse-legacy`

**Constraints**: none directly owned

**Touches**:
- CLI: install command, register command, apply command (`target`)
- Entities: `TemplateManifest`, `OwnershipBoundary`
- Component: `cpt-frontx-component-cli`

### Legacy Manifest Is Refused Outright, Never Migrated

- [x] `p2` - **ID**: `cpt-frontx-dod-template-manifest-legacy-refused-outright`

The system **MUST** ensure a manifest carrying any undeclared field (`schemaVersion`; `ownershipBoundaries` or its `exclusiveSubtrees`/`sharedFiles` children; `referencedTemplates`) is refused with `INVALID_MANIFEST` by every command that reads a manifest, including `install` — never read through a translation into `excludedSubtrees`, and never accepted regardless of whether its `exclusiveSubtrees`/`sharedFiles` were already effectively whole-target or its `description` is usable. There is no partial credit and no migrated output (`target`).

**Implements**:
- `cpt-frontx-algo-template-manifest-refuse-legacy`

**Constraints**: none directly owned; `cpt-frontx-adr-template-manifest-contract` governs the refusal's existence and fail-closed posture

**Touches**:
- CLI: install command, register command, apply command (`target`)
- Entities: `TemplateManifest`, `OwnershipBoundary`
- Component: `cpt-frontx-component-cli`

### Content Self-Containment Is Checked at Pre-Publish Validation

- [x] `p2` - **ID**: `cpt-frontx-dod-template-manifest-content-self-containment`

The system **MUST** ensure the CLI pre-publish validate command additionally rejects a candidate template whose own content - the candidate template directory minus its declared `excludedSubtrees` - contains a file referencing a filesystem path - per the known-carrier registry (currently: a `package.json` `file:` specifier; a tsconfig file's `compilerOptions.paths` mapping, `extends` target, `references[].path` entry, `files`/`include`/`exclude` entry, or one of its path-valued `compilerOptions` (`baseUrl`, `rootDir`, `rootDirs`, `outDir`, `declarationDir`, `outFile`, `tsBuildInfoFile`, `typeRoots`); or a lockfile workspace-member key/`resolved` entry) - that resolves outside the candidate template directory, reporting the offending file and path. A reference that resolves to a location still inside the template directory (a legitimate relative reference to the template's own subpackages) is not a violation; an absolute, drive-prefixed, or home-relative (`~`) reference is always a violation, since every reference this check resolves is contractually root-relative. The check resolves paths structurally and never flags a reference by pattern-matching `..` segments. Deliberately out of scope: a `package.json` `workspaces` glob and any carrier that is not JSON (e.g. a Vite config alias) - the registry only covers carriers this algorithm can parse structurally. The system **MUST** also reject a candidate template carrying a payload path that matches the CLI's reserved temporary-file naming convention (`inst-com-materialize-temp`, `cpt-frontx-feature-upgrade-changeset`), naming the offending file: an upgrade's write phase excludes any such path from every comparison, so a payload carrying one is never classified, written, or reported once applied, and is not admissible payload.

**Implements**:
- `cpt-frontx-flow-template-manifest-validate-for-publication`
- `cpt-frontx-algo-template-manifest-validate-content-self-containment`

**Constraints**: `cpt-frontx-constraint-cli-template-independence` - the check inspects the candidate's own content generically; it declares no template name and bundles no template content.

**Touches**:
- CLI: pre-publish validate command (`target`)
- Entities: `TemplateManifest`, `OwnershipBoundary`
- Component: `cpt-frontx-component-cli`

## 6. Acceptance Criteria

- [x] The CLI pre-publish validate command locates the manifest in a candidate template directory and reports PASS or FAIL with violations.
- [x] A missing manifest file causes an immediate FAIL with a clear "manifest not found" violation.
- [x] A manifest lacking `name`, `version`, or the `excludedSubtrees` field causes a FAIL listing each missing field as a violation.
- [x] A structurally malformed manifest (unparseable) causes a FAIL with a parse-error violation.
- [x] A manifest whose `excludedSubtrees` declares an entry that is not a well-formed target-relative path, lacks a trailing `/`, contains a `..` segment, or is not a strict descendant of the template's own target (including an entry that coincides with the target itself), causes a FAIL naming each offending entry. Pre-publish validation's verdict on `packages`, `packages/`, and `packages/config.json` is determined by this spec alone, without inspecting the filesystem: only `packages/` passes the well-formedness check (subject to the descendant check below); `packages` and `packages/config.json` both fail for lacking a trailing `/`, regardless of whether either happens to exist in the candidate directory.
- [x] A manifest declaring a `description` that is missing, or that is not a non-empty string, causes a FAIL naming the description field - `description` is required, so its absence is itself a violation rather than a permitted omission.
- [x] A file within the template's own content (the candidate template directory minus its declared `excludedSubtrees`) that references a filesystem path resolving outside the candidate template directory - per the known-carrier registry (currently: a `package.json` `file:` specifier; a tsconfig file's `compilerOptions.paths` mapping, `extends` target, `references[].path` entry, `files`/`include`/`exclude` entry, or one of its path-valued `compilerOptions` (`baseUrl`, `rootDir`, `rootDirs`, `outDir`, `declarationDir`, `outFile`, `tsBuildInfoFile`, `typeRoots`); or a lockfile workspace-member key/`resolved` entry) - causes a FAIL naming the offending file and path; a reference that resolves to a location still inside the template directory is not flagged, and an absolute, drive-prefixed, or home-relative (`~`) reference always is.
- [x] A candidate template whose payload carries a file path matching the CLI's reserved temporary-file naming convention causes a FAIL naming the offending file, regardless of the file's own content.
- [x] A declared `excludedSubtrees` entry that is a broken symlink, or resolves outside the candidate template directory, causes a FAIL naming the path, never a silent PASS from enumerating no content.
- [x] A conforming manifest declaring exactly the four fields (`name`, `version`, `excludedSubtrees`, `description`) causes a PASS result and a zero exit code.
- [x] The same manifest shape checked at pre-publish validation is consumed at install, register, apply, and assembly - no command reads a different or partial descriptor.
- [x] The manifest shape is versioned, but not backward-compatible at this boundary: a manifest declaring any undeclared category is refused outright, never read through a migration path into the current four-field shape, per `cpt-frontx-adr-template-manifest-contract`.
- [x] Per the CI fixture `cpt-frontx-adr-template-manifest-contract`'s Confirmation fixes: a non-conforming manifest (discriminated by any undeclared field) is refused with `INVALID_MANIFEST` by `install` as well as `register`, regardless of whether it carries a usable `description` — verifiable via `cpt-frontx-algo-template-manifest-refuse-legacy`.
- [x] A non-conforming manifest is refused with `INVALID_MANIFEST` the same way whether its `exclusiveSubtrees` was already effectively whole-target (absent, empty, or exactly `["."]`, with empty `sharedFiles`) or named a genuine proper subset of its target (for example, a 30-entry whitelist that never claimed its entire target — the shape `template-shell`'s own pre-conversion manifest had); this decision draws no distinction between the two at the refusal boundary, and neither is registrable or installable until converted by hand.
- [x] `cfs --json validate --artifact packages/cli/architecture/features/template-manifest/FEATURE.md --skip-code` returns PASS.
- [x] `cfs --json validate-toc packages/cli/architecture/features/template-manifest/FEATURE.md` returns PASS.
