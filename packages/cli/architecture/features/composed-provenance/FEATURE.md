# Feature: Project State, Registration & Ownership Management

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Register a Template's Origin](#register-a-templates-origin)
  - [Unregister a Template](#unregister-a-template)
  - [Add a Project-Owned Root](#add-a-project-owned-root)
  - [Remove a Project-Owned Root](#remove-a-project-owned-root)
  - [List Project-Owned Roots](#list-project-owned-roots)
  - [Validate the Project State Document](#validate-the-project-state-document)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Atomic Project State Read/Write](#atomic-project-state-readwrite)
  - [Validate the Project State Document Against Reality](#validate-the-project-state-document-against-reality)
  - [Register a Template](#register-a-template)
  - [Unregister a Template](#unregister-a-template-1)
  - [Add a Project-Owned Root](#add-a-project-owned-root-1)
  - [Remove a Project-Owned Root](#remove-a-project-owned-root-1)
- [4. States (CDSL)](#4-states-cdsl)
  - [Template Registration Lifecycle](#template-registration-lifecycle)
  - [Project-Owned Root Lifecycle](#project-owned-root-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Atomic Single-Document Project State](#atomic-single-document-project-state)
  - [Manifest-Keyed Registration with Origin Pinning](#manifest-keyed-registration-with-origin-pinning)
  - [Project-Owned Ownership Exceptions](#project-owned-ownership-exceptions)
  - [Project State Contract Ownership](#project-state-contract-ownership)
  - [Project State Validated Against Reality](#project-state-validated-against-reality)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-composed-provenance`

## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-composed-provenance`

### 1.1 Overview

This feature owns the repository's single CLI-managed state document, `.frontx/project.json` — `formatVersion`, the `templates` map (each registered name's `origin`, `version`, `targets` array, and an optional `previous: {origin, version}` — one generation, absent until the name's first upgrade), and `projectOwnedRoots` — and every command that reads or writes it directly: `register`, `unregister`, and `ownership add|remove|list`. `previous` holds whichever `{origin, version}` the name's most recent transition — an upgrade or a restore — moved it away from, so after a restore it names the origin the restore just left, not necessarily "the one before the upgrade"; it is written and rotated only by a successful upgrade's or restore's commit (`cpt-frontx-feature-upgrade-changeset`). This feature declares the field as part of the schema it owns and does not read it, but its own `register --replace` clears it: that call is permitted only when `targets` is empty, and it starts a new lineage for the name, so a `previous` pair from the lineage it replaces must not survive it. `unregister` removes it along with the rest of the entry it belongs to. `validate --project` checks the document's structural shape and nothing more; `previous`'s absence is normal and never itself a drift finding, and its presence is never one either. It resolves and pins a template's origin to the identity a project depends on, keeps that dependency and the project's own ownership exceptions in one atomically-read-and-written document, and refuses to let a registration or an exception be removed out from under ground it still occupies. All CDSL behavior is `target` (GREENFIELD — grounded in `cpt-frontx-adr-project-provenance-record`, `cpt-frontx-adr-template-ownership-boundary-declaration`, `cpt-frontx-adr-source-spec-syntax`, and DESIGN §3.1/§3.2/§3.6).

This feature's identifier and folder name are narrower than its scope: it owns neither transitive preset (referenced-template) resolution nor a per-applied-template provenance record at `.frontx/provenance.json`, because neither exists in this model. Composition is driven only by the caller's explicit batch (`cpt-frontx-feature-cli-scaffolding`, `cpt-frontx-adr-composed-template-resolution`), and an applied instance's provenance is exactly the `targets` array nested inside this feature's own single document — there is no second record, no `identity`/`applied-from version`/`source-spec`/`occupied ownership boundary` tuple, and no whole-repository placeholder to carry forward. The feature keeps its identifier, `cpt-frontx-feature-composed-provenance`, and its folder path; renaming both to match the current scope is tracked as a coordination work item in the root DECOMPOSITION (`cpt-frontx-feature-identifier-rename-wave`), not invented or scheduled here.

### 1.2 Purpose

This feature realizes the single project-state document and the manifest-keyed registration decided in `cpt-frontx-adr-project-provenance-record`, over origins whose stored form is fixed by `cpt-frontx-adr-source-spec-syntax`, and the project-specific half of the whole-target ownership model decided in `cpt-frontx-adr-template-ownership-boundary-declaration` (the `projectOwnedRoots` exclusion, managed here). It covers: reading and writing `.frontx/project.json` atomically for every command that touches it; registering a template's resolved origin under a project and unregistering it once no target depends on it; and adding, removing, and listing the project's own `projectOwnedRoots` exceptions. It realizes the internal components `cpt-frontx-component-cli-registration` (register/unregister) and `cpt-frontx-component-cli-provenance-recorder`, renamed in DESIGN prose to "CLI Project State Store" (the atomic document read/write every other lifecycle command shares). This feature is the OWNER of `cpt-frontx-contract-project-provenance` ("Project state (provenance) contract" in DESIGN §3.3), including its concrete field-level schema.

Applying a registered template to a target (`apply`), computing and checking ownership geometry, and deleting a target are owned by `cpt-frontx-feature-cli-scaffolding`'s Assembler and Conflict Checker; this feature supplies the document those components read from and write into, and reuses the Conflict Checker's canonicalized geometry check for `ownership add`'s own refusal rule rather than redefining it. Upgrading a registered template's origin is owned by `cpt-frontx-feature-upgrade-changeset`'s Change-Set Engine, which reads this feature's `templates[name]` entry as its baseline and commits the post-upgrade `origin`/`version` back into it; this feature does not itself change a name's origin once that name has at least one applied target. `.frontx` as a whole is the CLI's own reserved namespace: this feature's `.frontx/project.json` is that namespace's provenance record, while a template name's materialized AI-extension bundle at `.frontx/ai/<manifest-name>/` is a separate CLI-owned write inside the same namespace whose step this feature does not own — that step belongs to `cpt-frontx-feature-cli-scaffolding` (`cpt-frontx-algo-cli-scaffolding-ai-bundle`).

**Requirements**: `cpt-frontx-fr-cli-template-registration`, `cpt-frontx-fr-cli-project-state`, `cpt-frontx-fr-cli-ownership-management`

**Contracts (owned)**: `cpt-frontx-contract-project-provenance`

**Applicability** (Often-N/A domains for a CLI Command feature, per the FEATURE checklist's Applicability Context): PERF, OPS (observability), and COMPL are not applicable — this feature owns no NFR of its own (multi-template scale is addressed by `cpt-frontx-feature-template-resolution`, `cpt-frontx-feature-cli-scaffolding`, and `cpt-frontx-feature-upgrade-changeset`), introduces no logging/metrics/tracing surface, and carries no regulatory scope. SEC is partially addressed rather than N/A: `ownership add`'s reuse of the Conflict Checker's fail-closed canonicalization (`inst-cpoadd-canonicalize`) is a path-traversal control, though this feature enforces no authentication or authorization boundary. UX is addressed by the register/unregister/ownership command outcomes reported in §2.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Registers and unregisters a template's origin under the project, and manages the project's own `projectOwnedRoots` exceptions |
| `cpt-frontx-actor-github` | Acts as the external source registry a remote origin is resolved and pinned against at registration time |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: `cpt-frontx-adr-project-provenance-record`, `cpt-frontx-adr-template-ownership-boundary-declaration`, `cpt-frontx-adr-source-spec-syntax`, `cpt-frontx-adr-assembly-conflict-prevention`, `cpt-frontx-adr-cli-machine-readable-output`
- **Dependencies**:
  - `cpt-frontx-feature-template-resolution` (F10 — the shared resolver `register` installs and pins a remote origin through)
  - `cpt-frontx-feature-cli-scaffolding` (F12 — this feature reuses the Conflict Checker's canonicalized geometry check for `ownership add`'s own refusal rule and for `validate --project`'s target-conflict check, rather than redefining that geometry)

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-usecase-register-local-template`, `cpt-frontx-usecase-scaffold-composed-project`, `cpt-frontx-usecase-add-microfrontend-to-project`

### Register a Template's Origin

- [x] `p1` - **ID**: `cpt-frontx-flow-composed-provenance-register-template`

**Actor**: `cpt-frontx-actor-project-developer`

**Involves**: `cpt-frontx-actor-github` (only when the origin is remote)

**Success Scenarios**:
- Developer registers a new remote origin: the CLI installs it if not already available, pins it to the exact commit or package version the fetch settled on, validates the manifest, and writes `templates[name] = { origin: <pinned>, version, targets: [] }`.
- Developer registers a local `path:` origin: the CLI records the path exactly as given (no pin — there is nothing external to pin against) and the version the manifest at that path declares.
- Developer registers an origin that resolves to the same immutable value (or the same local path) already recorded for that name: the call is a no-op for `origin`/`version`/`targets` — except that a legacy entry recorded before `excludedSubtrees` existed, and still carrying no recorded value, ACQUIRES it from the resolved manifest as part of this same call, since a no-op for the `{origin, version}` pair is not a no-op for a document missing a field this algorithm writes.
- Developer registers a different origin for an already-registered name with `--replace`, and that name's `targets` array is empty: the entry's `origin` and `version` are replaced.

**Error Scenarios**:
- The origin cannot be resolved or installed (unreachable registry, invalid local path): the CLI reports `ORIGIN_UNAVAILABLE` and aborts; `.frontx/project.json` is left unchanged.
- The resolved manifest is missing `name` or `version`, or its `description` is missing or empty: the CLI refuses registration with `INVALID_MANIFEST`, naming the missing or empty field; `.frontx/project.json` is left unchanged.
- A different origin is given for an already-registered name without `--replace`: the CLI refuses with `REGISTRATION_CONFLICT`, naming the currently registered origin and the requested one; the existing entry is preserved.
- `--replace` is given but the name's `targets` array is non-empty: the CLI refuses with `TARGETS_EXIST`, directing the developer to `upgrade` instead — `register --replace` never changes the origin of a name with at least one applied target.

**Steps**:
1. [x] - `p1` - Developer invokes `register <origin>` - `inst-reg-invoke`
2. [x] - `p1` - The CLI invokes the register algorithm (`cpt-frontx-algo-composed-provenance-register`) - `inst-reg-run-algorithm`
3. [x] - `p1` - **IF** the algorithm reports a resolution or manifest-validation failure (`ORIGIN_UNAVAILABLE` or `INVALID_MANIFEST`) - `inst-reg-if-failure`
   1. [x] - `p1` - **RETURN** the reported failure to the developer; `.frontx/project.json` unchanged - `inst-reg-return-failure`
4. [x] - `p1` - **IF** the algorithm reports a no-op, a refusal (origin conflict without `--replace`, or `--replace` with non-empty `targets`), or a success (created or replaced) - `inst-reg-if-outcome`
   1. [x] - `p1` - **RETURN** the corresponding result to the developer - `inst-reg-return-outcome`

### Unregister a Template

- [x] `p1` - **ID**: `cpt-frontx-flow-composed-provenance-unregister-template`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer unregisters a name whose `targets` array is empty: the entry is removed from `.frontx/project.json`.

**Error Scenarios**:
- The name has no entry in `.frontx/project.json`: the CLI refuses (`TEMPLATE_NOT_REGISTERED`).
- The name's `targets` array is non-empty: the CLI refuses with `TARGETS_EXIST`, listing every target still depending on the name, and directs the developer to `delete` each target first; the entry is preserved.

**Steps**:
1. [x] - `p1` - Developer invokes `unregister <name>` - `inst-unreg-invoke`
2. [x] - `p1` - The CLI invokes the unregister algorithm (`cpt-frontx-algo-composed-provenance-unregister`) - `inst-unreg-run-algorithm`
3. [x] - `p1` - **IF** the algorithm reports the name is not registered - `inst-unreg-if-not-registered`
   1. [x] - `p1` - **RETURN** `TEMPLATE_NOT_REGISTERED` to the developer - `inst-unreg-return-not-registered`
4. [x] - `p1` - **IF** the algorithm reports a non-empty `targets` array - `inst-unreg-if-targets`
   1. [x] - `p1` - **RETURN** `TARGETS_EXIST` naming every dependent target; entry preserved - `inst-unreg-return-targets`
5. [x] - `p1` - **ELSE** - `inst-unreg-else`
   1. [x] - `p1` - **RETURN** success; the entry is removed - `inst-unreg-return-success`

### Add a Project-Owned Root

- [x] `p1` - **ID**: `cpt-frontx-flow-composed-provenance-ownership-add`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer adds an existing path that falls inside an applied template's target, or that touches no applied target at all: the path is appended to `projectOwnedRoots`; no file is created, moved, or deleted.
- Developer adds a path already present in `projectOwnedRoots`: the call is a no-op.

**Error Scenarios**:
- The given path does not exist on disk: the CLI refuses with `INVALID_PATH` — `ownership add` accepts only an existing path.
- The path coincides with, or is an ancestor of, any applied target: the CLI refuses with `TARGET_CONFLICT`, naming the contesting target, using the canonicalized geometry `cpt-frontx-feature-cli-scaffolding`'s Conflict Checker runs for assembly (`cpt-frontx-algo-cli-scaffolding-conflict-check`) — but only in that one direction. A path that is a strict DESCENDANT of an applied target is the ordinary, intended case and is accepted: `cpt-frontx-fr-cli-ownership-management` exists to protect "the project's own files that live inside a template's target", and CLI DESIGN §2.2 states the same rule from the other side — "a root that falls inside a target is a valid dynamic subtraction from that target's ownership". Reusing the assembly check's both-directions containment rule here would refuse exactly the case the requirement was written for, leaving `projectOwnedRoots` unreachable for any path inside a target and, for a template applied at the project root, unreachable altogether.

**Steps**:
1. [x] - `p1` - Developer invokes `ownership add <path>` - `inst-oadd-invoke`
2. [x] - `p1` - The CLI invokes the ownership-add algorithm (`cpt-frontx-algo-composed-provenance-ownership-add`) - `inst-oadd-run-algorithm`
3. [x] - `p1` - **IF** the algorithm reports the path does not exist - `inst-oadd-if-missing`
   1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the path; `projectOwnedRoots` unchanged - `inst-oadd-return-missing`
4. [x] - `p1` - **IF** the algorithm reports a geometry conflict against an applied target - `inst-oadd-if-conflict`
   1. [x] - `p1` - **RETURN** `TARGET_CONFLICT` naming the path and the contesting target; `projectOwnedRoots` unchanged - `inst-oadd-return-conflict`
5. [x] - `p1` - **ELSE** - `inst-oadd-else`
   1. [x] - `p1` - **RETURN** success; the path is recorded in `projectOwnedRoots` (or was already present) - `inst-oadd-return-success`

### Remove a Project-Owned Root

- [x] `p1` - **ID**: `cpt-frontx-flow-composed-provenance-ownership-remove`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer removes a path present in `projectOwnedRoots`: the entry is removed from the array; no file on disk is touched.
- Developer removes a path not present in `projectOwnedRoots`: the call is a no-op.

**Error Scenarios**:
- (none — `ownership remove` never touches a file, so there is no destructive outcome to refuse)

**Steps**:
1. [x] - `p1` - Developer invokes `ownership remove <path>` - `inst-orem-invoke`
2. [x] - `p1` - The CLI invokes the ownership-remove algorithm (`cpt-frontx-algo-composed-provenance-ownership-remove`) - `inst-orem-run-algorithm`
3. [x] - `p1` - **RETURN** success; the path is absent from `projectOwnedRoots`, whether or not it was present before - `inst-orem-return-success`

### List Project-Owned Roots

- [x] `p1` - **ID**: `cpt-frontx-flow-composed-provenance-ownership-list`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer lists the current `projectOwnedRoots`: the CLI reads `.frontx/project.json` and returns the array unchanged; nothing is written.

**Error Scenarios**:
- `.frontx/project.json` exists but cannot be parsed as the expected document shape: the CLI refuses with `PROJECT_INVALID`.

**Steps**:
1. [x] - `p1` - Developer invokes `ownership list` - `inst-olist-invoke`
2. [x] - `p1` - The CLI reads the project state document (`cpt-frontx-algo-composed-provenance-project-state-io`, read-only) - `inst-olist-read`
3. [x] - `p1` - **IF** the document exists and cannot be parsed as the expected shape - `inst-olist-if-invalid`
   1. [x] - `p1` - **RETURN** `PROJECT_INVALID` - `inst-olist-return-invalid`
4. [x] - `p1` - **RETURN** the current `projectOwnedRoots` array (empty when the document does not yet exist) - `inst-olist-return-roots`

### Validate the Project State Document

- [x] `p1` - **ID**: `cpt-frontx-flow-composed-provenance-validate-project`

**Actor**: `cpt-frontx-actor-project-developer`

`validate` on the manifest side (`cpt-frontx-feature-template-manifest`) checks a candidate template before publication, while `validate --project` checks the project state document this feature owns against reality — the registry, the local inventory, and the filesystem — after it has been written by `register`, `apply`, `upgrade`, or a hand-edit.

**Success Scenarios**:
- Developer runs `validate --project`: the CLI structurally validates `.frontx/project.json`, confirms every registered name's installed manifest version still matches the version recorded for it, confirms every registered origin is still resolvable, confirms `targets[]` is normalized and duplicate-free within and across every registered name with no ownership-geometry conflict among them, and confirms every `projectOwnedRoots` entry still exists on disk — reporting PASS when every check clears.

**Error Scenarios**:
- `.frontx/project.json` does not parse as the expected top-level shape, or a `templates[name]` entry is malformed, or `targets[]` carries a duplicate or a non-canonical entry: `PROJECT_INVALID`, naming the offending entry.
- A registered name's currently resolvable manifest declares a `version` different from `templates[name].version`: `VERSION_MISMATCH`, naming the name, the recorded version, and the manifest's version.
- A registered name's origin can no longer be resolved (a remote origin's pin has become unreachable, or a local `path:` origin's folder no longer exists): `ORIGIN_UNAVAILABLE`, naming the name and its origin.
- Two recorded targets — under the same or different registered names — coincide or nest without a declared `excludedSubtrees` exemption, detected by resubmitting the full recorded set through the Conflict Checker's geometry (`cpt-frontx-algo-cli-scaffolding-conflict-check`): `TARGET_CONFLICT`, naming the contesting names and the contested ground.
- A `projectOwnedRoots` entry no longer exists on disk: `INVALID_PATH`, naming the path.

**Steps**:
1. [x] - `p1` - Developer invokes `validate --project` - `inst-valp-invoke`
2. [x] - `p1` - The CLI invokes the project-validation algorithm (`cpt-frontx-algo-composed-provenance-validate-project`) - `inst-valp-run-algorithm`
3. [x] - `p1` - **IF** the algorithm reports a structural failure - `inst-valp-if-invalid`
   1. [x] - `p1` - **RETURN** `PROJECT_INVALID` naming the offending entry - `inst-valp-return-invalid`
4. [x] - `p1` - **IF** the algorithm reports a manifest/recorded version mismatch for a name - `inst-valp-if-version-mismatch`
   1. [x] - `p1` - **RETURN** `VERSION_MISMATCH` naming the name and both versions - `inst-valp-return-version-mismatch`
5. [x] - `p1` - **IF** the algorithm reports an unresolvable origin for a name - `inst-valp-if-origin-unavailable`
   1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE` naming the name and its origin - `inst-valp-return-origin-unavailable`
6. [x] - `p1` - **IF** the algorithm reports an ownership-geometry conflict among recorded targets - `inst-valp-if-target-conflict`
   1. [x] - `p1` - **RETURN** `TARGET_CONFLICT` naming the contesting names and the contested ground - `inst-valp-return-target-conflict`
7. [x] - `p1` - **IF** the algorithm reports a `projectOwnedRoots` entry absent from disk - `inst-valp-if-invalid-path`
   1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the path - `inst-valp-return-invalid-path`
8. [x] - `p1` - **RETURN** PASS - `inst-valp-return-pass`

## 3. Processes / Business Logic (CDSL)

### Atomic Project State Read/Write

- [x] `p1` - **ID**: `cpt-frontx-algo-composed-provenance-project-state-io`

**Input**: Repository root path; either a read-only request, or a described mutation (a `templates[name]` entry to create, replace, or remove; a `projectOwnedRoots` path to add or remove).

**Output**: For a read: the current document, or the initial empty shape (`formatVersion: 1`, empty `templates`, empty `projectOwnedRoots`) when no document exists yet. For a mutation: the document reflecting exactly the described change and nothing else, written back as one document. A `PROJECT_INVALID` error when an existing document cannot be parsed as the expected top-level shape.

**Steps**:
1. [x] - `p1` - Determine the document's location inside the repository root: `.frontx/project.json` - `inst-psio-locate`
2. [x] - `p1` - **IF** the document does not exist - `inst-psio-if-absent`
   1. [x] - `p1` - Treat the current document as the initial empty shape without writing anything until a mutation is described - `inst-psio-absent-default`
3. [x] - `p1` - **IF** the document exists - `inst-psio-if-present`
   1. [x] - `p1` - Read and parse it as one document - `inst-psio-read`
   2. [x] - `p1` - **IF** it cannot be parsed as `{ formatVersion, templates, projectOwnedRoots }` - `inst-psio-if-malformed`
      1. [x] - `p1` - **RETURN** `PROJECT_INVALID`, naming the document; refuse the requesting operation rather than guessing at a partial shape - `inst-psio-return-invalid`
4. [x] - `p1` - **IF** the caller requested a read only - `inst-psio-if-read`
   1. [x] - `p1` - **RETURN** the parsed (or initial empty) document - `inst-psio-return-read`
5. [x] - `p1` - **IF** the caller requested a mutation - `inst-psio-if-mutate`
   1. [x] - `p1` - Construct the fully modified copy of the document in memory, reflecting exactly the described change and nothing else - `inst-psio-construct-copy`
   2. [x] - `p1` - Determine the write's actual destination: when `.frontx/project.json` already exists as a symlink whose target resolves inside the repository root, that RESOLVED target — never the link itself — so the link survives the write and the developer's own real document, wherever it actually lives, is the one updated; a symlink resolving outside the repository root is refused by containment before this step is ever reached, unchanged - `inst-psio-resolve-write-destination`
   3. [x] - `p1` - Write the modified copy to a temporary file alongside the write's destination and rename it onto that same destination as the atomic step: the original document is never truncated, edited in place, or removed before the replacement is fully written and the rename completes, so an interruption at any point before the rename leaves the repository holding the prior valid document, and an interruption after the rename leaves it holding the fully written new document — never a partially-written or partially-merged one, and never neither - `inst-psio-write-atomic`
   4. [x] - `p1` - **RETURN** the written document - `inst-psio-return-written`

### Validate the Project State Document Against Reality

- [x] `p1` - **ID**: `cpt-frontx-algo-composed-provenance-validate-project`

**Input**: The project state document, read via `cpt-frontx-algo-composed-provenance-project-state-io` (read-only); every registered name's currently installed manifest and installed content path, read through the shared resolver (`cpt-frontx-feature-template-resolution`); the filesystem state of every `projectOwnedRoots` entry.

**Output**: PASS, or one of `PROJECT_INVALID` (naming the offending structural entry), `VERSION_MISMATCH` (naming a name and its recorded vs. manifest-declared version), `ORIGIN_UNAVAILABLE` (naming a name and its unresolvable origin), `TARGET_CONFLICT` (naming contesting names and contested ground), or `INVALID_PATH` (naming a `projectOwnedRoots` entry absent from disk).

**Steps**:
1. [x] - `p1` - Read the project state document (read-only) - `inst-valpa-read`
2. [x] - `p1` - **IF** the document cannot be parsed as `{ formatVersion, templates, projectOwnedRoots }`, or any `templates[name]` entry is malformed, or any `targets[]` array carries a duplicate entry or an entry not normalized to a canonical project-relative path - `inst-valpa-if-malformed`
   1. [x] - `p1` - **RETURN** `PROJECT_INVALID` naming the offending entry; no further check runs - `inst-valpa-return-invalid`
3. [x] - `p1` - **IF** the document does not exist - `inst-valpa-if-absent`
   1. [x] - `p1` - **RETURN** PASS — an absent document has nothing to validate against reality - `inst-valpa-return-pass-absent`
4. [x] - `p1` - **FOR EACH** `templates[name]` entry - `inst-valpa-foreach-name`
   1. [x] - `p1` - **IF** the name's registered origin can no longer be resolved through the shared resolver - `inst-valpa-if-origin-unavailable`
      1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE` naming the name and its origin; no further name is checked - `inst-valpa-return-origin-unavailable`
   2. [x] - `p1` - **IF** the resolved manifest's declared `version` differs from `templates[name].version` - `inst-valpa-if-version-mismatch`
      1. [x] - `p1` - **RETURN** `VERSION_MISMATCH` naming the name, the recorded version, and the manifest's version; no further name is checked - `inst-valpa-return-version-mismatch`
5. [x] - `p1` - Resubmit every `targets[]` entry recorded across every registered name, tagged with its owning name, through the Conflict Checker's geometry check (`cpt-frontx-algo-cli-scaffolding-conflict-check`), checking the recorded set for internal consistency rather than against a new staged batch - `inst-valpa-conflict-check`
6. [x] - `p1` - **IF** the check reports an intersecting claim - `inst-valpa-if-target-conflict`
   1. [x] - `p1` - **RETURN** `TARGET_CONFLICT` naming the contesting names and the contested ground - `inst-valpa-return-target-conflict`
7. [x] - `p1` - **FOR EACH** entry in `projectOwnedRoots` - `inst-valpa-foreach-root`
   1. [x] - `p1` - **IF** the entry no longer exists on disk - `inst-valpa-if-root-missing`
      1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the path - `inst-valpa-return-root-missing`
8. [x] - `p1` - **RETURN** PASS - `inst-valpa-return-pass`

### Register a Template

- [x] `p1` - **ID**: `cpt-frontx-algo-composed-provenance-register`

**Input**: An `origin` argument — either a remote source-spec (`host:owner/repo[//subtree]@ref`) or a local `path:<relative-path>`.

**Output**: A created entry, a confirmed no-op, a replaced entry, a refusal (`REGISTRATION_CONFLICT` for an origin conflict without `--replace`, or `TARGETS_EXIST` for `--replace` with non-empty `targets`), or a resolution/manifest-validation failure (`ORIGIN_UNAVAILABLE`, `INVALID_MANIFEST`).

**Steps**:
1. [x] - `p1` - Accept the `origin` argument - `inst-cpreg-accept`
2. [x] - `p1` - Resolve and install the origin through the shared resolver (`cpt-frontx-feature-template-resolution`), pinning a remote origin to the exact immutable commit or package version the fetch settles on; a local `path:` origin is recorded as given. The install is unconditional, not conditional on the content being absent from the local inventory: what a project stores is never the ref a developer typed but the immutable value the resolver's fetch settled on (`cpt-frontx-adr-source-spec-syntax`), so skipping the fetch because content happens to be present locally would leave nothing to pin and would let a moved branch pass unnoticed as a no-op. A repeat install is a refresh, which is what makes the unconditional call safe rather than wasteful - `inst-cpreg-install`
   2. [x] - `p1` - **IF** resolution or installation fails - `inst-cpreg-if-install-fail`
      1. [x] - `p1` - **RETURN** an `ORIGIN_UNAVAILABLE` failure; nothing written - `inst-cpreg-return-unavailable`
3. [x] - `p1` - Read the resolved manifest's `name`, `version`, and `description` - `inst-cpreg-read-manifest`
4. [x] - `p1` - **IF** `name` or `version` is absent, or `description` is absent or empty - `inst-cpreg-if-invalid-manifest`
   1. [x] - `p1` - **RETURN** an `INVALID_MANIFEST` failure naming the missing or empty field; nothing written - `inst-cpreg-return-invalid-manifest`
5. [x] - `p1` - Read the current project state document (`cpt-frontx-algo-composed-provenance-project-state-io`) - `inst-cpreg-read-state`
6. [x] - `p1` - **IF** `templates[name]` does not exist - `inst-cpreg-if-new`
   1. [x] - `p1` - Write `templates[name] = { origin: <pinned-or-given>, version, targets: [], excludedSubtrees: <declared> }`, with no `previous` entry — a name carries one only once it has been through its first upgrade. `excludedSubtrees` is the resolved manifest's own declared list, recorded so `cpt-frontx-algo-cli-scaffolding-delete-plan` never has to re-resolve this name's origin to learn what it excludes — a `path:` origin folder is transient by design and may no longer exist by the time a target under it is deleted - `inst-cpreg-write-new`
   2. [x] - `p1` - **RETURN** success: entry created - `inst-cpreg-return-created`
7. [x] - `p1` - **ELSE** (`templates[name]` already exists) - `inst-cpreg-else-exists`
   1. [x] - `p1` - **IF** the resolved origin is the same immutable value (remote) or the same path (local) as the existing entry's `origin` - `inst-cpreg-if-same-origin`
      1. [x] - `p1` - **IF** the existing entry carries no RECORDED `excludedSubtrees` (a legacy entry from before that field existed) - `inst-cpreg-if-noop-missing-exclusions`
         1. [x] - `p1` - Write the existing entry back unchanged except for `excludedSubtrees`, set to the resolved manifest's own declared list read above (`inst-cpreg-read-manifest`) — a no-op for the `{origin, version}` pair is NOT a no-op for a document missing a field this algorithm writes: the entry otherwise stays exactly as recorded, including its `targets` and any `previous` pair. The outcome reported is its OWN, distinct from the no-op below: the document was written, and an envelope saying nothing happened after a write is not a description a caller can act on - `inst-cpreg-write-noop-exclusions`
      2. [x] - `p1` - **RETURN** a no-op; the entry is otherwise unchanged - `inst-cpreg-return-noop`
   2. [x] - `p1` - **IF** `--replace` was not given - `inst-cpreg-if-no-replace`
      1. [x] - `p1` - **RETURN** `REGISTRATION_CONFLICT` naming the currently registered origin and the requested one; entry preserved - `inst-cpreg-return-origin-conflict`
   3. [x] - `p1` - **IF** `--replace` was given but the existing entry's `targets` array is non-empty - `inst-cpreg-if-replace-applied`
      1. [x] - `p1` - **RETURN** `TARGETS_EXIST` directing the developer to `upgrade` instead; entry preserved - `inst-cpreg-return-replace-refused`
   4. [x] - `p1` - **ELSE** (`--replace` given, `targets` empty) - `inst-cpreg-else-replace-ok`
      1. [x] - `p1` - Write `templates[name].origin`, `.version`, and `.excludedSubtrees` to the newly resolved values, `targets` unchanged (empty), and clear any `previous` entry the name carries — `--replace` starts a new lineage, so a preceding pair from the lineage it replaces must not survive it - `inst-cpreg-write-replace`
      2. [x] - `p1` - **RETURN** success: entry replaced - `inst-cpreg-return-replaced`

### Unregister a Template

- [x] `p1` - **ID**: `cpt-frontx-algo-composed-provenance-unregister`

**Input**: A template `name`.

**Output**: A removed entry, a `TARGETS_EXIST` refusal naming every dependent target, or `TEMPLATE_NOT_REGISTERED`.

**Steps**:
1. [x] - `p1` - Accept the `name` argument - `inst-cpunreg-accept`
2. [x] - `p1` - Read the current project state document - `inst-cpunreg-read-state`
3. [x] - `p1` - **IF** `templates[name]` does not exist - `inst-cpunreg-if-absent`
   1. [x] - `p1` - **RETURN** `TEMPLATE_NOT_REGISTERED` - `inst-cpunreg-return-not-registered`
4. [x] - `p1` - **IF** `templates[name].targets` is non-empty - `inst-cpunreg-if-targets`
   1. [x] - `p1` - **RETURN** `TARGETS_EXIST` listing every target in `targets`; entry preserved - `inst-cpunreg-return-targets`
5. [x] - `p1` - **ELSE** - `inst-cpunreg-else`
   1. [x] - `p1` - Remove `templates[name]` from the document and write it - `inst-cpunreg-write-removed`
   2. [x] - `p1` - **RETURN** success - `inst-cpunreg-return-success`

### Add a Project-Owned Root

- [x] `p1` - **ID**: `cpt-frontx-algo-composed-provenance-ownership-add`

**Input**: A repository-relative `path`.

**Output**: The path recorded in `projectOwnedRoots` (or confirmed already present), or a refusal (`INVALID_PATH` when the path does not exist; `TARGET_CONFLICT`).

**Steps**:
1. [x] - `p1` - Accept the `path` argument - `inst-cpoadd-accept`
2. [x] - `p1` - **IF** `path` does not exist on disk - `inst-cpoadd-if-missing`
   1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the path; `ownership add` accepts only an existing path - `inst-cpoadd-return-missing`
3. [x] - `p1` - Canonicalize `path` to a project-relative form, fail-closed against a symlink or a `..` segment resolving outside the project root, per the same discipline `cpt-frontx-feature-cli-scaffolding`'s Conflict Checker applies to every target - `inst-cpoadd-canonicalize`
4. [x] - `p1` - Read the current project state document to obtain every applied target across every registered template's `targets` array - `inst-cpoadd-read-targets`
5. [x] - `p1` - Submit the canonicalized path against every applied target through the Conflict Checker's geometry check (`cpt-frontx-algo-cli-scaffolding-conflict-check`) - `inst-cpoadd-check-geometry`
6. [x] - `p1` - **IF** the path coincides with, or is an ancestor of, any applied target — that one direction only, never a strict descendant, which is the intended case this command serves - `inst-cpoadd-if-conflict`
   1. [x] - `p1` - **RETURN** `TARGET_CONFLICT` naming the path and the contesting target; `projectOwnedRoots` unchanged - `inst-cpoadd-return-conflict`
7. [x] - `p1` - **ELSE** - `inst-cpoadd-else`
   1. [x] - `p1` - **IF** the path is already present in `projectOwnedRoots` - `inst-cpoadd-if-present`
      1. [x] - `p1` - **RETURN** a no-op - `inst-cpoadd-return-noop`
   2. [x] - `p1` - **ELSE** - `inst-cpoadd-else-append`
      1. [x] - `p1` - Append the path to `projectOwnedRoots` and write the document; no file on disk is created, moved, or deleted - `inst-cpoadd-write`
      2. [x] - `p1` - **RETURN** success - `inst-cpoadd-return-success`

### Remove a Project-Owned Root

- [x] `p1` - **ID**: `cpt-frontx-algo-composed-provenance-ownership-remove`

**Input**: A repository-relative `path`.

**Output**: The path absent from `projectOwnedRoots`.

**Steps**:
1. [x] - `p1` - Accept the `path` argument - `inst-cporem-accept`
2. [x] - `p1` - Read the current project state document - `inst-cporem-read-state`
3. [x] - `p1` - Remove `path` from `projectOwnedRoots` if present, leaving the array unchanged if it was not - `inst-cporem-remove`
4. [x] - `p1` - Write the document; no file on disk is created, moved, or deleted - `inst-cporem-write`
5. [x] - `p1` - **RETURN** success - `inst-cporem-return-success`

## 4. States (CDSL)

### Template Registration Lifecycle

- [x] `p2` - **ID**: `cpt-frontx-state-composed-provenance-registration-lifecycle`

**States**: UNREGISTERED, REGISTERED_EMPTY, REGISTERED_APPLIED

**Initial State**: UNREGISTERED

**Transitions**:
1. [x] - `p1` - **FROM** UNREGISTERED **TO** REGISTERED_EMPTY **WHEN** `register` creates a new `templates[name]` entry with an empty `targets` array - `inst-rl-unreg-to-empty`
2. [x] - `p1` - **FROM** REGISTERED_EMPTY **TO** REGISTERED_EMPTY **WHEN** `register` is called again with the same resolved origin (no-op), or with `--replace` and a different origin while `targets` stays empty - `inst-rl-empty-to-empty`
3. [x] - `p1` - **FROM** REGISTERED_EMPTY **TO** UNREGISTERED **WHEN** `unregister` succeeds because `targets` is empty - `inst-rl-empty-to-unreg`
4. [x] - `p1` - **FROM** REGISTERED_EMPTY **TO** REGISTERED_APPLIED **WHEN** `apply` (owned by `cpt-frontx-feature-cli-scaffolding`) records this name's first target - `inst-rl-empty-to-applied`
5. [x] - `p1` - **FROM** REGISTERED_APPLIED **TO** REGISTERED_APPLIED **WHEN** `apply` records another target for this name, or `upgrade` (owned by `cpt-frontx-feature-upgrade-changeset`) commits a new `origin`/`version` for this name while `targets` remains non-empty - `inst-rl-applied-to-applied`
6. [x] - `p1` - **FROM** REGISTERED_APPLIED **TO** REGISTERED_EMPTY **WHEN** `delete` (owned by `cpt-frontx-feature-cli-scaffolding`) removes this name's last remaining target - `inst-rl-applied-to-empty`
7. [x] - `p1` - **FROM** REGISTERED_APPLIED **TO** REGISTERED_APPLIED **WHEN** `unregister` is attempted while `targets` is non-empty — the attempt is refused and the state does not change - `inst-rl-applied-unregister-refused`

### Project-Owned Root Lifecycle

- [x] `p2` - **ID**: `cpt-frontx-state-composed-provenance-ownership-root-lifecycle`

**States**: UNMARKED, MARKED

**Initial State**: UNMARKED

**Transitions**:
1. [x] - `p1` - **FROM** UNMARKED **TO** MARKED **WHEN** `ownership add` succeeds — the path exists and does not coincide with or contain an applied target - `inst-orl-unmarked-to-marked`
2. [x] - `p1` - **FROM** MARKED **TO** UNMARKED **WHEN** `ownership remove` is called for the path — no file on disk is touched - `inst-orl-marked-to-unmarked`

## 5. Definitions of Done

### Atomic Single-Document Project State

- [x] `p1` - **ID**: `cpt-frontx-dod-composed-provenance-atomic-project-state`

The system **MUST** implement atomic read and write of exactly one repository-local document, `.frontx/project.json`, holding `formatVersion`, a `templates` map keyed by manifest name (`origin`, `version`, `targets[]`, and an optional `previous: {origin, version}` per entry), and `projectOwnedRoots` — with no second registry, provenance, or ownership file anywhere in the repository. The write **MUST** go through a temporary file plus rename so an interrupted write always leaves the repository holding the prior valid document, never a partially-written or partially-merged one, and never no document where one previously existed (`target`).

**Implements**:
- `cpt-frontx-algo-composed-provenance-project-state-io`

**Constraints**: `cpt-frontx-constraint-cli-per-template-provenance`

**Touches**:
- Component: `cpt-frontx-component-cli-provenance-recorder`
- Entities: `ProjectProvenance`

### Manifest-Keyed Registration with Origin Pinning

- [x] `p1` - **ID**: `cpt-frontx-dod-composed-provenance-registration`

The system **MUST** implement `register <origin>` — resolving and installing the origin through the shared resolver when needed, pinning a remote origin to the exact immutable commit or package version the fetch settled on (a local `path:` origin recorded as given), validating the manifest's `name`, `version`, and required non-empty `description`, and writing or confirming `templates[name]` — idempotent on a repeated identical origin, refused on a different origin without `--replace`, and refusing `--replace` itself unless `targets` is empty. The system **MUST** implement `unregister <name>`, refusing while `targets` is non-empty and listing every dependent target (`target`).

**Implements**:
- `cpt-frontx-flow-composed-provenance-register-template`
- `cpt-frontx-flow-composed-provenance-unregister-template`
- `cpt-frontx-algo-composed-provenance-register`
- `cpt-frontx-algo-composed-provenance-unregister`

**Constraints**: `cpt-frontx-constraint-cli-registration-origin-pinning`

**Touches**:
- Component: `cpt-frontx-component-cli-registration`, `cpt-frontx-component-cli-provenance-recorder`
- Entities: `Template`, `ProjectProvenance`

### Project-Owned Ownership Exceptions

- [x] `p1` - **ID**: `cpt-frontx-dod-composed-provenance-ownership-management`

The system **MUST** implement `ownership add`, `remove`, and `list` against `projectOwnedRoots`, creating, moving, or deleting no file: `add` **MUST** accept only an existing path, refusing a nonexistent one with `INVALID_PATH`, and **MUST** be refused with `TARGET_CONFLICT` when that path coincides with, or is an ancestor of, any applied target — and **MUST NOT** be refused for a strict descendant of one, the case the requirement exists to serve — checked through the canonicalized geometry the Conflict Checker runs for assembly, applied in that one direction; `remove` **MUST** un-mark a path without touching files; `list` **MUST** read `projectOwnedRoots` without writing, refusing with `PROJECT_INVALID` when the document cannot be parsed (`target`).

**Implements**:
- `cpt-frontx-flow-composed-provenance-ownership-add`
- `cpt-frontx-flow-composed-provenance-ownership-remove`
- `cpt-frontx-flow-composed-provenance-ownership-list`
- `cpt-frontx-algo-composed-provenance-ownership-add`
- `cpt-frontx-algo-composed-provenance-ownership-remove`

**Constraints**: `cpt-frontx-constraint-cli-boundary-declaration`

**Touches**:
- Component: `cpt-frontx-component-cli`, `cpt-frontx-component-cli-provenance-recorder`
- Entities: `OwnershipBoundary`, `ProjectProvenance`

### Project State Contract Ownership

- [x] `p1` - **ID**: `cpt-frontx-dod-composed-provenance-contract-ownership`

The system **MUST** treat this feature as the owner of the project state (provenance) contract's concrete field-level schema — `formatVersion`, `templates[name] = { origin, version, targets[], previous?: {origin, version}, excludedSubtrees?: string[] }`, `projectOwnedRoots` — so every other feature that reads or writes the document (`cpt-frontx-feature-cli-scaffolding`'s Assembler and Conflict Checker, `cpt-frontx-feature-upgrade-changeset`'s Change-Set Engine) cites this feature's schema rather than declaring its own (`target`). `previous` is optional — one generation the name's most recent upgrade or restore moved it away from, absent until the name's first upgrade, never a longer history or any file content — written and rotated only by `cpt-frontx-feature-upgrade-changeset`'s commit, and cleared only by this feature's own `register --replace` (`inst-cpreg-write-replace`), which starts a new lineage for the name. `excludedSubtrees` is likewise optional — absent on any document written before this field existed — and, once present, **MUST** validate the identical way a manifest's own `excludedSubtrees` declaration does (`cpt-frontx-feature-template-manifest`'s well-formed, strict-descendant-of-target check, reused rather than reformulated): a malformed value (not an array, a non-string element, an empty string, or one escaping the target) makes the WHOLE document `PROJECT_INVALID` for every command that reads it, `validate --project` included, rather than being silently accepted, coerced, or dropped — a plan computed from an exclusion set this store never actually verified states a blast radius nobody checked. A structurally valid `excludedSubtrees` is the name's declared exclusions as of the origin currently registered: written by `register`/`register --replace` (`inst-cpreg-write-new`/`inst-cpreg-write-replace`) from the resolved manifest, carried forward unchanged when `apply` only extends `targets[]`, and re-recorded from the NEW payload's own declaration by `cpt-frontx-feature-upgrade-changeset`'s commit (`inst-com-commit-state`). A call that is otherwise an idempotent no-op for the `{origin, version}` pair — `register`/`register --replace` resolving the SAME origin (`inst-cpreg-if-noop-missing-exclusions`/`inst-cpreg-write-noop-exclusions`), or `cpt-frontx-feature-upgrade-changeset`'s engine landing on the SAME origin (its own `inst-if-noop-missing-exclusions`/`inst-record-noop-exclusions` and `inst-rst-if-noop-missing-exclusions`/`inst-rst-record-noop-exclusions`) — **MUST** still RECORD this field onto an entry that carries no recorded value: a no-op for `{origin, version}` is not a no-op for a document missing a field the current code writes, and a legacy entry (one recorded before this field existed) must be able to acquire it through the ordinary lifecycle rather than staying permanently unrecoverable. `cpt-frontx-feature-cli-scaffolding`'s deletion-plan algorithm resolves this fact through ONE order shared by every consumer: the template's CURRENT manifest, when it can be read and is contract-valid, wins; otherwise this RECORDED value, when present; otherwise the algorithm refuses — so `delete` and `assemble`/`apply` never disagree about a name's declared exclusions whenever the manifest is readable, while deletion still never depends on a `path:` origin folder still being on disk once a declaration has been recorded.

**Implements**:
- `cpt-frontx-algo-composed-provenance-project-state-io`

**Contracts**: `cpt-frontx-contract-project-provenance` (OWNER)

**Touches**:
- Entities: `ProjectProvenance`

### Project State Validated Against Reality

- [x] `p1` - **ID**: `cpt-frontx-dod-composed-provenance-validate-project`

The system **MUST** implement `validate --project`, checking the project state document this feature owns against reality rather than only against its own structural shape: the document **MUST** parse as `{ formatVersion, templates, projectOwnedRoots }` with every `targets[]` entry normalized and duplicate-free (`PROJECT_INVALID` otherwise), every registered name's currently resolvable manifest version **MUST** match its recorded `templates[name].version` (`VERSION_MISMATCH` otherwise), every registered origin **MUST** still resolve (`ORIGIN_UNAVAILABLE` otherwise), the full recorded `targets[]` set **MUST** carry no ownership-geometry conflict when resubmitted through the Conflict Checker's geometry (`TARGET_CONFLICT` otherwise, reusing `cpt-frontx-algo-cli-scaffolding-conflict-check` rather than redefining conflict geometry), and every `projectOwnedRoots` entry **MUST** still exist on disk (`INVALID_PATH` otherwise) (`target`). The version comparison is meaningful for `path:` origins and for document integrity; for a pinned remote origin the manifest cannot drift (`cpt-frontx-adr-source-spec-syntax`), so a mismatch there indicates a hand-edited or corrupted project state document rather than a moved template. A `templates[name]` entry's optional `previous` field is checked only for the structural shape the first clause above already covers; its absence is normal for a name never upgraded, and neither its absence nor its presence is itself a finding this check reports.

**Implements**:
- `cpt-frontx-flow-composed-provenance-validate-project`
- `cpt-frontx-algo-composed-provenance-validate-project`

**Constraints**: `cpt-frontx-constraint-cli-boundary-declaration`

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`, `cpt-frontx-component-cli-provenance-recorder`
- Entities: `ProjectProvenance`, `Template`, `OwnershipBoundary`

## 6. Acceptance Criteria

- [x] A repository carries exactly one CLI-managed state document, `.frontx/project.json`, with `formatVersion`, a `templates` map, and `projectOwnedRoots`; no second registry, provenance, or ownership file is ever written.
- [x] Registering a remote origin whose reference names a branch records a commit SHA (or exact package version) in `templates[name].origin`, never the branch name, and re-resolving it later returns byte-identical content.
- [x] Registering a local `path:` origin records the literal path, unpinned, with the version the manifest at that path declares at registration time.
- [x] Registering the same resolved origin twice performs no write on the second call — unless the existing entry carries no recorded `excludedSubtrees` (a legacy entry from before that field existed), in which case the second call records it from the resolved manifest while leaving `origin`/`version`/`targets` exactly as they were; `upgrade` landing on the same origin does the identical thing for the identical reason.
- [x] A `templates[name].excludedSubtrees` value that is not an array, or that carries a non-string element, an empty string, or an entry that is not a strict descendant of the template's own target, makes the WHOLE project state document `PROJECT_INVALID` for every command that reads it — `register`, `apply`, `delete`, `list`, and `validate --project` alike — never silently accepted, coerced to `[]`, or dropped; the developer's own files are untouched by any of those refusals.
- [x] Registering a different origin for an already-registered name without `--replace` is refused with `REGISTRATION_CONFLICT`; the same call with `--replace` succeeds only when `targets` is empty and is refused with `TARGETS_EXIST` when it is not.
- [x] A document holding a `templates[name]` entry with no `previous` field is structurally valid, and `validate --project` PASSes on it without reporting the absence — true both for a name never upgraded and for one whose upgrade or restore history a later `register --replace` cleared; when a `previous: {origin, version}` is present, its absence or presence is likewise never itself a `validate --project` finding.
- [x] `register --replace` against a name carrying a `previous` entry clears it as part of the same write that replaces `origin` and `version`, so the new lineage starts with no preceding pair; `unregister` removes any `previous` entry along with the rest of the name's entry.
- [x] A resolved manifest missing `name`, `version`, or a non-empty `description` fails registration with `INVALID_MANIFEST`, naming the missing or empty field, with no entry written.
- [x] `unregister` on a name with a non-empty `targets` array is refused with `TARGETS_EXIST` and lists every target named; the same call on a name with an empty array removes the entry.
- [x] `unregister` on a name with no entry returns `TEMPLATE_NOT_REGISTERED`.
- [x] `ownership add` on a path that does not exist is refused with `INVALID_PATH`; on a path coincident with or an ancestor of an applied target it is refused with `TARGET_CONFLICT`; otherwise the path is appended to `projectOwnedRoots` with no file created, moved, or deleted, and a repeated `add` of the same path is a no-op.
- [x] `ownership remove` removes a path from `projectOwnedRoots` (or no-ops if absent) without touching any file.
- [x] `ownership list` reads `projectOwnedRoots` without writing anything, refusing with `PROJECT_INVALID` when the document cannot be parsed.
- [x] `validate --project` PASSes on a structurally sound document whose every registered name's manifest version matches its recorded version, whose every origin still resolves, whose recorded targets carry no ownership-geometry conflict, and whose every `projectOwnedRoots` entry still exists on disk.
- [x] `validate --project` returns `PROJECT_INVALID` for a malformed document or a malformed/duplicated `targets[]` entry, `VERSION_MISMATCH` for a name whose resolvable manifest version differs from its recorded version, `ORIGIN_UNAVAILABLE` for a name whose origin no longer resolves, `TARGET_CONFLICT` for an ownership-geometry conflict among recorded targets (reusing the Conflict Checker's geometry, not a redefinition of it), and `INVALID_PATH` for a `projectOwnedRoots` entry no longer present on disk.
- [x] Every `RETURN`-level refusal in this feature's flows and algorithms names a code from the shared error-code vocabulary (`cpt-frontx-adr-cli-machine-readable-output`).
- [x] A simulated interrupted write to `.frontx/project.json` (via the temp-file-plus-rename mechanism) leaves the repository holding the prior valid document, never a partially-merged one and never no document where one previously existed.
- [x] `cfs --json validate --artifact packages/cli/architecture/features/composed-provenance/FEATURE.md --skip-code` returns PASS.
- [x] `cfs --json validate-toc packages/cli/architecture/features/composed-provenance/FEATURE.md` returns PASS.
