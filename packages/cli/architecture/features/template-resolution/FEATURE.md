# Feature: Template Externalization & Source-Spec Resolution


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
  - [1.5 Machine-Readable Catalog Envelope](#15-machine-readable-catalog-envelope)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Install Template by Versioned Source-Spec](#install-template-by-versioned-source-spec)
  - [List Local Template Inventory](#list-local-template-inventory)
  - [Update Installed Template in Local Inventory](#update-installed-template-in-local-inventory)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Source-Spec Parse and Validate](#source-spec-parse-and-validate)
  - [Resolve Source-Spec to Tracked Local Inventory](#resolve-source-spec-to-tracked-local-inventory)
  - [Bounded Local Inventory Update](#bounded-local-inventory-update)
- [4. States (CDSL)](#4-states-cdsl)
  - [Inventory Template State Machine](#inventory-template-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [CLI Installs Template by Versioned Source-Spec](#cli-installs-template-by-versioned-source-spec)
  - [CLI Lists Local Template Inventory](#cli-lists-local-template-inventory)
  - [CLI Updates Local Inventory Entry Without Touching Scaffolded Projects](#cli-updates-local-inventory-entry-without-touching-scaffolded-projects)
  - [Source-Spec Parser Rejects Invalid References](#source-spec-parser-rejects-invalid-references)
  - [Template Identity Comes From the Manifest and Collisions Are Rejected](#template-identity-comes-from-the-manifest-and-collisions-are-rejected)
  - [A Resolution Serving an Upgrade or a Restore Never Touches the Registered Slot](#a-resolution-serving-an-upgrade-or-a-restore-never-touches-the-registered-slot)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-template-resolution`
## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-template-resolution`

### 1.1 Overview

The CLI (`@gears-frontx/cli`) bundles no template and resolves each template from a versioned source-spec (`host:owner/repo[//subtree]@ref`) or a local `path:<relative-path>` origin naming a folder inside the project's own tree, materializing the template's actual files on disk in a tracked local inventory at an addressable installed content path — not a single manifest blob — so downstream apply and assembly read that content directly, and providing install, list, and bounded local update operations that never disturb already-scaffolded projects. The optional `//subtree` segment addresses a template occupying a subtree of a repository, so one repository can serve several templates; the acquired content is narrowed to that subtree and re-rooted, leaving a template unaware of where in a repository it lives. This same resolver is where a remote origin is pinned to the exact immutable commit or package version its fetch settles on — the value `register` writes into a project's `templates[name].origin` (`cpt-frontx-adr-source-spec-syntax`, DESIGN §3.2 "CLI Template Resolver") — while a local `path:` origin has nothing external to pin against and resolves to whatever the named folder currently holds. A template is tracked under the identity its own manifest declares, not under the name of the repository it came from, and an install whose declared identity is already occupied by a different source is rejected before any inventory write rather than merged into the occupant's content path.

### 1.2 Purpose

This feature ensures the CLI command surface is fully decoupled from the content it scaffolds: templates are acquired by versioned reference at runtime, stored in a tracked local inventory, and updatable locally without affecting any scaffolded project. This realizes the CLI-1 design constraint and the template-agnostic-tooling principle.

**Requirements**: `cpt-frontx-fr-cli-template-install`, `cpt-frontx-fr-cli-template-list`, `cpt-frontx-fr-cli-template-update-local`

**Principles**: `cpt-frontx-principle-template-agnostic-tooling`

**Applicability** (Often-N/A domains for a CLI Command feature, per the FEATURE checklist's Applicability Context): SEC and COMPL are not applicable — this feature enforces no authentication, authorization, or regulatory boundary; the closest security-adjacent control is the fail-closed path canonicalization a `path:` origin is checked against (`inst-resolve-local-path-check`), which is a path-traversal safeguard, not an auth boundary. OPS (observability) is not applicable — this feature introduces no logging, metrics, or tracing surface of its own beyond the uniform envelope and error-code vocabulary it already references. PERF is addressed by `cpt-frontx-cli-nfr-template-scale` (§6, Acceptance Criteria). UX is addressed by the human-readable and machine-readable forms of `list` (§2, "List Local Template Inventory").

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Installs, lists, and locally updates templates to maintain a reproducible local inventory for scaffolding |
| `cpt-frontx-actor-github` | Hosts versioned template repositories fetched by the CLI at install and update time via source-spec |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **Dependencies**: None

### 1.5 Machine-Readable Catalog Envelope

This feature owns the concrete shape of the listing command's `data` payload, because that shape is a **cross-boundary contract**: it is the surface over which the AI Tooling Framework obtains the selectable set (`cpt-frontx-feature-ai-project-scaffolding`) without linking the CLI or reading its inventory storage (DESIGN §3.4). A consumer on the far side of a process boundary cannot discover the shape by reading the producer's types, so the shape is fixed here rather than left to whichever formatter happens to emit it - the same reason `cpt-frontx-feature-template-manifest` fixes the manifest's field-level schema in its own §1.2 and `cpt-frontx-feature-template-ai-extensions` fixes the bundle convention in its §1.5.

**Request**: the listing command invoked with the `--json` flag. Absent the flag, the human-readable form is emitted unchanged; the two forms never mix on one invocation.

**Response**: the outer shape is the one uniform envelope every CLI command's `--json` mode emits - `{"ok": true, "data": {...}}` on success, `{"ok": false, "error": {"code", "message", "details"}}` on failure - fixed once for the whole command surface by `cpt-frontx-adr-cli-machine-readable-output` (CLI-9) and not redefined here. This feature fixes no bespoke top-level shape and no success discriminant of its own; it fixes only the `data` payload's field-level content on success, per `cpt-frontx-adr-contract-schema-ownership`.

On success, `data` reports the three sets a caller composing an explicit batch needs visibility into side by side, each entry carrying its `description` (`cpt-frontx-adr-project-provenance-record`, "Catalog visibility"):

```json
{
  "ok": true,
  "data": {
    "defaults": [{"name": "...", "version": "...", "description": "..."}],
    "registered": [{"name": "...", "origin": "...", "version": "...", "targets": ["..."], "description": "..."}],
    "installed": [{"name": "...", "origin": "...", "version": "...", "description": "..."}]
  }
}
```

This literal JSON form is a sanctioned exception to the general rule against hardcoding literal schemas in a FEATURE: `cpt-frontx-adr-contract-schema-ownership` (ADR 0027) makes this feature the legitimate owner of this specific cross-boundary contract's field-level shape, so fixing its concrete form here is the schema's authoritative definition, not an accidental leak of implementation detail.

- `defaults` - the platform's default templates, listed independently of the current project's `.frontx/project.json`.
- `registered` - one record per entry in the current project's `templates` map: the manifest name that keys it, its pinned `origin` (immutable for a remote origin, the literal path for a `path:` origin), its registered `version`, and the `targets` it has been applied to.
- `installed` - templates present in the local inventory but not (yet) registered to this project, each with the canonical origin `install` resolved it to.
- `version` means the same thing in all three sets: the version the entry's own manifest declares. `cpt-frontx-adr-project-provenance-record` fixes a registered entry's `version` as the one that came from its manifest, and `defaults` carries no `origin` at all, so no other source is even available to it. It is never the reference an origin was resolved through: the immutable value a remote fetch settled on already travels inside `origin` (`cpt-frontx-adr-source-spec-syntax`), so reporting it again under `version` would duplicate the pin, leave the manifest's declared version unreported, and make one key name mean a manifest version in two sets and a resolved ref in the third - the precise failure a cross-boundary contract exists to prevent. For a damaged installed entry the key is absent, on exactly the ground the next bullet states for `description`: both are manifest-declared, and neither can be read from a stored manifest that no longer satisfies the contract.
- Every entry in every set carries `description`, the same manifest-declared field that carries selection semantics (`cpt-frontx-adr-template-manifest-contract`). Under the current manifest contract `description` is required and non-empty (`cpt-frontx-feature-template-manifest`), so a conforming entry always declares one; **the key is absent, never empty and never a placeholder, only for a damaged installed entry** - one whose stored manifest satisfied the required-description contract when it was installed (a non-conforming manifest, carrying no such field or any undeclared one, is refused outright at install and never enters local inventory, `cpt-frontx-algo-template-manifest-refuse-legacy`), but whose on-disk copy has since been corrupted or manually altered - a consumer selects templates by this value, and a substituted placeholder would be indistinguishable from a declaration the template never made.
- An empty set is reported as `[]`, never an absent key.

On failure, the command emits `{"ok": false, "error": {"code": ..., "message": ..., "details": {...}}}` where the code is drawn from the one stable vocabulary `cpt-frontx-adr-cli-machine-readable-output` fixes (`cpt-frontx-constraint-cli-machine-envelope` in CLI DESIGN CLI-9) - this feature never invents a code of its own, and does not re-enumerate that vocabulary here. An unreadable `.frontx/project.json` is reported as `PROJECT_INVALID`, so a listing failure and a listing success are structurally distinguishable by `ok` rather than by an inventory-shaped absence.

The `data` payload's key names are the contract this feature owns; renaming one is a breaking change to the AI Tooling Framework's read path even though no compile-time edge would report it. The envelope's outer shape, its `ok` discriminant, and the `error.code` vocabulary are `cpt-frontx-adr-cli-machine-readable-output`'s contract, not this feature's, and are referenced rather than restated.

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor (human or external system) and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: `cpt-frontx-usecase-scaffold-composed-project`

### Install Template by Versioned Source-Spec

- [x] `p1` - **ID**: `cpt-frontx-flow-template-resolution-install`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer installs a template from a remote source-spec and it is added to the local inventory at the exact immutable commit or package version the fetch settled on
- Developer installs a template from a local `path:<relative-path>` origin naming a folder inside the project's own tree, and it is added to the local inventory as given, with no pin fabricated (`target`)

**Error Scenarios**:
- Source registry is unreachable; install fails with `ORIGIN_UNAVAILABLE` before any inventory write
- Source-spec is missing the `host:` prefix or the `@ref` selector, or carries a malformed subtree segment; rejected with `INVALID_INPUT` before any fetch
- Source-spec is well-formed but names a host the shared resolver carries no fetch adapter for; rejected with `INVALID_INPUT` before any fetch, naming the supported host(s) — never attempted against a fabricated address and never recorded with an unpinned origin
- The referenced subtree holds no content at the referenced version; install fails with `ORIGIN_UNAVAILABLE` before any inventory write
- The fetched template declares an identity the local inventory already tracks for a different template address; install is rejected with `REGISTRATION_CONFLICT` before any inventory write. A reference differing only in its version selector names the same template and is not a collision
- The fetched template declares an identity that nests with an already-installed identity, one being a leading path segment sequence of the other; install is rejected with `REGISTRATION_CONFLICT` before any inventory write, because the two are two inventory keys but not two directories
- A `path:<relative-path>` origin cannot be proven to resolve inside the project root, or names a path that does not exist; install is rejected with `INVALID_PATH` before any inventory write (`target`)
- The installed content path or the local inventory index's own file cannot be proven to resolve inside the local inventory store root once every symlink along it is resolved; install is rejected with `INVALID_PATH`, naming the escaping path, and neither the store's content nor its index is written — a symlink standing at either path and pointing outside the store is never followed for the write (`target`)
- A non-directory entry stands where the installed content path or the local inventory index's own file requires a directory or an ordinary regular file (a scoped identity's leading segment replaced by a plain file, or the index file replaced by a directory, FIFO, socket, or device); install is rejected with `CONTENT_CONFLICT`, naming the blocking entry, rather than reclaiming ground by deleting it or crashing with an unstructured filesystem error (`target`)
- The local inventory index's own file exists but cannot be parsed as JSON, or parses to a shape other than the tracked name-to-entry mapping; install is rejected with `CONTENT_CONFLICT`, naming the index file (`target`)

**Steps**:
1. [x] - `p1` - Developer invokes the CLI install command with a versioned source-spec (`host:owner/repo[//subtree]@ref`) or a local `path:<relative-path>` origin - `inst-install-invoke`
2. [x] - `p1` - **IF** the origin is a remote source-spec, CLI forwards the string to the source-spec parser - `inst-install-parse`
3. [x] - `p1` - **IF** the parser returns a parse error (missing `host:` prefix, missing `@ref` selector, or a malformed repository path or subtree segment): - `inst-install-parse-check`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT`; abort install with no inventory write - `inst-install-parse-reject`
4. [x] - `p1` - CLI forwards the parsed structured reference, or the local `path:` origin unparsed, to the shared resolver (`cpt-frontx-algo-template-resolution-resolve-to-inventory`) - `inst-install-resolve`
5. [x] - `p1` - For a remote origin, the shared resolver attempts to fetch template content from the source registry (`cpt-frontx-actor-github`) at the resolved ref; for a local origin, it reads the named folder's current content directly - `inst-install-fetch`
6. [x] - `p1` - **IF** the source registry is unreachable or returns an error, or a local path cannot be proven to stay inside the project root: - `inst-install-reach-check`
   1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE` for an unreachable registry, or `INVALID_PATH` for a local path that cannot be proven to stay inside the project root; abort install with no inventory write - `inst-install-reach-fail`
7. [x] - `p1` - CLI materializes the resolved content into the tracked local inventory under the identity the manifest declares, with the remote fetch's immutable pin or the local path recorded as given - `inst-install-materialize`
8. [x] - `p1` - **RETURN** install success with the installed identity and resolved version/origin to developer - `inst-install-success`

### List Local Template Inventory

- [x] `p1` - **ID**: `cpt-frontx-flow-template-resolution-list`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer sees the platform's default templates, the current project's registered templates, and the templates installed locally but not yet registered, each with its version
- Caller requests the machine-readable form and receives the uniform envelope's `data` carrying all three sets side by side, each entry with the description its manifest declares - the catalog a program reads to compose an explicit batch without parsing prose or reading inventory storage directly

**Error Scenarios**:
- All three sets are empty; CLI reports the empty state with no error, as the empty message in the human form and as three empty collections in the machine-readable form
- The invocation carries an argument that is not the recognized machine-readable flag: the command is refused with `INVALID_INPUT` and a usage line naming the unrecognized argument, and neither listing form is emitted. A near-miss flag must not fall through to the human form, because a calling program would then receive a success exit code alongside output it cannot parse - a silently wrong answer where a refusal it can act on was available. Repeating the recognized flag is not an error: it names the same form unambiguously.
- The current project's `.frontx/project.json` exists but does not satisfy the project-state contract: the machine-readable form emits `{"ok": false, "error": {"code": "PROJECT_INVALID", ...}}` (`cpt-frontx-adr-cli-machine-readable-output`) rather than a partial or silently-empty `registered` set.

**Steps**:
1. [x] - `p1` - Developer or calling program invokes the CLI list command, optionally requesting the machine-readable form - `inst-list-invoke`
2. [x] - `p1` - **IF** the invocation carries any argument that is not the recognized machine-readable flag - `inst-list-check-args`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT`, naming the unrecognized argument(s) and the accepted usage form; no listing is emitted in either form - `inst-list-abort-unknown-arg`
3. [x] - `p1` - CLI reads the platform's default templates, the tracked local inventory, and, when a `.frontx/project.json` is present, the current project's `templates` map (`target`) - `inst-list-read`
4. [x] - `p1` - **IF** a present `.frontx/project.json` does not satisfy the project-state contract (`target`) - `inst-list-project-invalid-check`
   1. [x] - `p1` - **RETURN**, in the machine-readable form, `{"ok": false, "error": {"code": "PROJECT_INVALID", ...}}` (`cpt-frontx-adr-cli-machine-readable-output`); the human-readable form reports the same failure as text (`target`) - `inst-list-project-invalid-return`
5. [x] - `p1` - **IF** all three sets contain no entries: - `inst-list-empty-check`
   1. [x] - `p1` - **RETURN** empty message to developer, or three empty collections when the machine-readable form was requested - `inst-list-empty-return`
6. [x] - `p1` - CLI formats each set's entries as name and version for the human-readable form - `inst-list-format`
7. [x] - `p1` - **IF** the machine-readable form was requested, CLI instead emits the uniform envelope's `{"ok": true, "data": {...}}` with `data.defaults`, `data.registered`, and `data.installed` populated per `1.5 Machine-Readable Catalog Envelope` - omitting `description` for a damaged installed entry whose stored manifest no longer declares one, rather than substituting a placeholder a caller could mistake for a declaration (`target`) - `inst-list-format-machine`
8. [x] - `p1` - **RETURN** formatted listing, or the emitted envelope, to developer - `inst-list-return`

### Update Installed Template in Local Inventory

- [x] `p1` - **ID**: `cpt-frontx-flow-template-resolution-update-local`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer updates a specific inventory entry to a newer version; no scaffolded project path is modified

**Error Scenarios**:
- Named template is not found in local inventory; CLI reports `TEMPLATE_NOT_REGISTERED` and makes no changes
- Source registry is unreachable; CLI reports `ORIGIN_UNAVAILABLE` and leaves the existing inventory entry unchanged
- The new source-spec resolves to a template declaring a different identity; CLI reports `REGISTRATION_CONFLICT` and leaves the existing inventory entry unchanged rather than substituting one template for another
- The local inventory index's own file cannot be parsed as JSON, or parses to a shape other than the tracked name-to-entry mapping; CLI reports `CONTENT_CONFLICT`, naming the index file, before looking up the named entry
- The installed content path or the local inventory index's own file cannot be proven to resolve inside the local inventory store root once every symlink along it is resolved; CLI reports `INVALID_PATH`, naming the escaping path, and leaves the existing inventory entry and its materialized files unchanged
- A non-directory entry stands where the installed content path or the local inventory index's own file requires a directory or an ordinary regular file; CLI reports `CONTENT_CONFLICT`, naming the blocking entry, and leaves the existing inventory entry and its materialized files unchanged

**Steps**:
1. [x] - `p1` - Developer invokes the CLI update-local command with the template name and a new versioned source-spec - `inst-update-invoke`
2. [x] - `p1` - CLI looks up the named entry in the tracked local inventory index - `inst-update-lookup`
3. [x] - `p1` - **IF** the named entry is absent from the local inventory: - `inst-update-notfound-check`
   1. [x] - `p1` - **RETURN** `TEMPLATE_NOT_REGISTERED`; abort update with no inventory write - `inst-update-notfound`
4. [x] - `p1` - CLI forwards the new source-spec to the source-spec parser - `inst-update-parse`
5. [x] - `p1` - **IF** the parser returns a parse error: - `inst-update-parse-check`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT`; abort update with no inventory write - `inst-update-parse-reject`
6. [x] - `p1` - CLI forwards the parsed reference to the shared resolver and fetches the updated content from the source registry - `inst-update-fetch`
7. [x] - `p1` - **IF** the source registry is unreachable or returns an error: - `inst-update-reach-check`
   1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE`; leave the existing inventory entry unchanged - `inst-update-reach-fail`
8. [x] - `p1` - CLI replaces the inventory store entry for the named template with the fetched content at the new pinned version - `inst-update-write`
9. [x] - `p1` - **RETURN** update success with the template name and new pinned version to developer - `inst-update-success`

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures that do not interact with actors directly. These are reusable building blocks called by Actor Flows or other processes.

### Source-Spec Parse and Validate

- [x] `p2` - **ID**: `cpt-frontx-algo-template-resolution-parse-spec`

**Input**: A raw source-spec string supplied by the developer

**Output**: A structured reference (host, owner, repo, optional subtree, ref) or `INVALID_INPUT`

**Steps**:
1. [x] - `p1` - Check that the input string contains a `:` separator - `inst-parse-prefix-check`
2. [x] - `p1` - **IF** no `:` separator is present: - `inst-parse-no-prefix`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT`: missing `host:` prefix; acquisition cannot proceed without an explicit host - `inst-parse-no-prefix-fail`
3. [x] - `p1` - Extract the host token as the substring before the first `:` - `inst-parse-extract-host`
4. [x] - `p1` - Check that the remainder after `:` contains an `@` separator - `inst-parse-at-check`
5. [x] - `p1` - **IF** no `@` separator is present: - `inst-parse-no-at`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT`: missing `@ref` version selector; acquisition cannot proceed without an explicit version pin - `inst-parse-no-at-fail`
6. [x] - `p1` - Extract the repository path as the substring between `:` and `@` - `inst-parse-extract-repo`
7. [x] - `p1` - Split the repository path on its first `//` separator into an `owner/repo` part and an optional subtree part - `inst-parse-extract-subtree`
8. [x] - `p1` - **IF** the `owner/repo` part is not exactly one owner segment followed by one repository segment, or a subtree separator is present with a subtree part that is empty, absolute, or carries an empty, `.`, or `..` segment: - `inst-parse-invalid-path`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT`: malformed repository path or subtree segment; acquisition cannot proceed without an unambiguous repository and subtree - `inst-parse-invalid-path-fail`
9. [x] - `p1` - Extract the ref selector as the substring after `@` - `inst-parse-extract-ref`
10. [x] - `p1` - **RETURN** structured reference containing host, owner, repo, the subtree when present, and ref - `inst-parse-return`

### Resolve Source-Spec to Tracked Local Inventory

- [x] `p2` - **ID**: `cpt-frontx-algo-template-resolution-resolve-to-inventory`

**Input**: Either a validated structured reference (host, owner, repo, optional subtree, ref) for a remote origin, or a local `path:<relative-path>` origin naming a folder inside the project's own tree

**Output**: For `install`, `register`, or the bounded local update below: a materialized inventory entry (identity, installed content path addressing the template's actual on-disk files, resolved version, and — for a remote origin — the pinned immutable origin the fetch settled on). For a resolution serving an upgrade or a restore — the candidate's, or a re-resolution of the baseline — the acquired content returned in memory (identity, the content itself, resolved version/origin), with the registered name's own slot untouched and nothing materialized anywhere. Either way, or a resolution failure (`INVALID_PATH`, `ORIGIN_UNAVAILABLE`, `INVALID_MANIFEST`, `CONTENT_CONFLICT`, or `REGISTRATION_CONFLICT`).

**Steps**:
1. [x] - `p1` - **IF** the input is a local `path:<relative-path>` origin rather than a remote structured reference: - `inst-resolve-origin-kind-check`
   1. [x] - `p1` - Canonicalize the path and confirm it resolves inside the project root under the same fail-closed check applied to every other CLI-checked path (`cpt-frontx-adr-assembly-conflict-prevention`); a path a symlink or a `..` segment could carry outside the root, or that does not exist, is refused - `inst-resolve-local-path-check`
   2. [x] - `p1` - **IF** the path cannot be proven to stay inside the project root, or does not exist: - `inst-resolve-local-path-fail-check`
      1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the path; do not write to local inventory - `inst-resolve-local-path-fail`
   3. [x] - `p1` - Read the folder's current content directly as the acquired content, and record the path exactly as given as the origin — **not pinned**, because a local origin has no separate publication to resolve to an immutable form (`cpt-frontx-adr-source-spec-syntax`) - `inst-resolve-local-path-read`
   4. [x] - `p1` - Proceed to manifest identity resolution (step 6) with this acquired content and this unpinned origin - `inst-resolve-local-path-continue`
2. [x] - `p1` - **ELSE** (a remote structured reference): construct the fetch address for the source registry (`cpt-frontx-actor-github`) from the structured reference, and the re-resolvable source-spec string that reproduces it — including its subtree when the reference carries one, so a later re-resolution addresses the same template rather than the repository root. An address shape belongs to the host that serves it, so this resolver constructs one only for a host it actually carries a pinning fetch adapter for - `inst-resolve-addr`
   1. [x] - `p1` - **IF** the reference names a host this resolver carries no fetch adapter for: - `inst-resolve-host-unsupported`
      1. [x] - `p1` - **RETURN** `INVALID_INPUT` naming the host and the host(s) this resolver does support; fetch nothing and write nothing to local inventory. A fabricated address for an unknown host has only bad outcomes: it fails as an unreachable registry, reporting an unsupported host as a reachability problem the developer cannot act on, or it succeeds against something this resolver cannot pin, leaving `templates[name].origin` holding the typed, moving `@ref` that step 7 (`inst-resolve-pin`) and `cpt-frontx-adr-source-spec-syntax` both forbid a project to store. Refusing today forecloses nothing: that decision's own evolvability note fixes additional hosts as an additive introduction that invalidates no reference already written - `inst-resolve-host-unsupported-fail`
3. [x] - `p1` - Fetch the template content from the source registry at the given ref - `inst-resolve-fetch`
4. [x] - `p1` - **IF** the fetch fails: - `inst-resolve-fetch-fail-check`
   1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE`; do not write to local inventory - `inst-resolve-fetch-fail`
5. [x] - `p1` - **IF** the reference carries a subtree, narrow the acquired content to that subtree and re-root every retained path so it is relative to the subtree rather than to the repository - `inst-resolve-subtree`
6. [x] - `p1` - **IF** the acquired content is not a multi-file bundle, the referenced subtree holds no content at the referenced version, or narrowing would re-root a retained path outside the subtree: - `inst-resolve-subtree-empty`
   1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE` when the subtree holds no content, or `INVALID_PATH` when a retained path would re-root outside the subtree, naming the subtree and, where a path is at fault, that path; do not write to local inventory - `inst-resolve-subtree-empty-fail`
7. [x] - `p1` - Settle the fetch's exact immutable commit SHA or exact package version as the pinned origin — never the typed, possibly-moving `@ref` — the value `register` later writes into `templates[name].origin` (`cpt-frontx-adr-source-spec-syntax`) - `inst-resolve-pin`
8. [x] - `p1` - Read the template's manifest from the acquired content against the primary four-field type (`cpt-frontx-contract-template-manifest`) and take the identity it declares as the template's identity - `inst-resolve-name`
9. [x] - `p1` - **IF** the manifest carries any undeclared field (`schemaVersion`; `ownershipBoundaries` or its `exclusiveSubtrees`/`sharedFiles` children; `referencedTemplates`) — a legacy manifest, per the discriminator `cpt-frontx-adr-template-manifest-contract` fixes (`cpt-frontx-algo-template-manifest-refuse-legacy`, `cpt-frontx-feature-template-manifest`) - `inst-resolve-if-legacy-manifest`
   1. [x] - `p1` - **RETURN** `INVALID_MANIFEST` naming the undeclared field(s) present; do not write to local inventory. There is no migration path — such a manifest never enters the local inventory, mirroring how a legacy `.frontx/provenance.json` is detected and refused outright (`cpt-frontx-adr-project-provenance-record`) - `inst-resolve-legacy-manifest-fail`
10. [x] - `p1` - **IF** the manifest is absent, unreadable, or declares an identity that is empty or not usable as an installed content path — an identity must be relative and free of empty, `.` and `..` segments, while a scoped identity carrying a `/` remains admissible - `inst-resolve-identity-missing`
    1. [x] - `p1` - **RETURN** `INVALID_MANIFEST`; do not write to local inventory - `inst-resolve-identity-missing-fail`
11. [x] - `p1` - **IF** this resolution serves an upgrade or a restore (`cpt-frontx-feature-upgrade-changeset`) — resolving the candidate payload, re-checking the baseline's honesty for validation, or re-resolving the baseline for failure recovery — rather than `install`, `register`, or the bounded local update below - `inst-resolve-if-upgrade-candidate`
    1. [x] - `p1` - Hold the acquired template content IN MEMORY and materialize it nowhere: not under the declared identity's own slot, not at any other address inside the local inventory store, and not in the inventory index or `list`. This is the resolver's own default posture rather than a mode it switches into — resolution acquires content and returns it; writing a slot is the caller's separate step (`inst-resolve-write`/`inst-resolve-index` below are the caller's, not this algorithm's) - `inst-resolve-stage-candidate`
    2. [x] - `p1` - **RETURN** a handle containing the identity, the acquired content, and the resolved version/origin; the registered name's own slot is untouched, and stays untouched unless and until the upgrade's own commit promotes content into it (`cpt-frontx-algo-upgrade-changeset-commit`). Because nothing was materialized, there is no location for this invocation to discard at its own end, none for a concurrent upgrade or restore of the same name to collide with — two resolutions of the same commit, or of the same name, are separate in-memory values by construction — and none for a killed process to orphan - `inst-resolve-return-staged`
12. [x] - `p1` - **ELSE** (`install`, `register`, or the bounded local update below) - `inst-resolve-else-slot`
    1. [x] - `p1` - **IF** the local inventory already tracks that identity for a different template address — the reference with its version selector removed, so that a reference differing only in version names the same template rather than a colliding one — **OR** the declared identity nests with an identity the inventory already tracks, one being a leading path segment sequence of the other, because two nesting identities are two inventory keys but not two directories and a bounded update of the outer one clears the inner one from disk while leaving it indexed: - `inst-resolve-collision-check`
       1. [x] - `p1` - **RETURN** `REGISTRATION_CONFLICT` naming the occupying identity together with the requested one, and for an address collision both sources; do not write to local inventory and do not merge into or nest beneath the occupant's content path - `inst-resolve-collision-fail`
    2. [x] - `p1` - Materialize the acquired template content — the template's actual files together with its manifest — on disk in the local inventory store under the declared identity, addressable at an installed content path - `inst-resolve-write`
       1. [x] - `p1` - **IF** the installed content path, once every symlink along it is resolved, cannot be proven to resolve inside the local inventory store root, **OR** a non-directory entry (a regular file, most commonly) stands where a directory component of that path is required (a scoped identity's own leading segment, e.g. `@x` in `@x/inv`, replaced by a plain file since an earlier install) - `inst-resolve-write-guard`
          1. [x] - `p1` - **RETURN** `INVALID_PATH` for an escaping path or `CONTENT_CONFLICT` naming the blocking non-directory component; nothing is written to the local inventory store, and nothing outside it is touched — a symlink pointing outside the store is never followed, and a non-directory ancestor is never replaced, since neither is ground this materialization step owns - `inst-resolve-write-guard-fail`
    3. [x] - `p1` - Record the installed identity, and either the pinned origin (remote) or the literal path (local), in the inventory index - `inst-resolve-index`
       1. [x] - `p1` - **IF** the local inventory index's own file (`index.json`), once every symlink along it is resolved, cannot be proven to resolve inside the local inventory store root, **OR** whatever currently stands at that path is neither absent nor an ordinary regular file (a directory, FIFO, socket, or device — the local inventory store is ground this CLI owns, but such a shape is refused rather than reclaimed by deleting it, for the same reason a read seam already refuses to open it) - `inst-resolve-index-guard`
          1. [x] - `p1` - **RETURN** `INVALID_PATH` for an escaping path or `CONTENT_CONFLICT` naming the non-regular shape; the index file is left exactly as it was, and nothing outside the local inventory store is touched — a symlink pointing outside the store is never followed for the write, so content the CLI does not own is never overwritten by a success report - `inst-resolve-index-guard-fail`
    4. [x] - `p1` - **RETURN** inventory entry containing identity, installed content path, and resolved version/origin - `inst-resolve-return`
13. [x] - `p1` - Every subsequent READ of an installed content path this algorithm's slot addresses — this store's own `read`/`has`, `cpt-frontx-algo-cli-scaffolding-uniform-apply`'s own content reader, or any other adapter that reads a template's actual on-disk files back out of that path — resolves the SAME containment the write step above proves (`inst-resolve-write-guard`), through the identical primitive, before ever reporting what it finds as this template's own content - `inst-resolve-read-guard`
    1. [x] - `p1` - **IF** the installed content path, once every symlink along it is resolved, cannot be proven to resolve inside the local inventory store root - `inst-resolve-read-guard-check`
       1. [x] - `p1` - **RETURN** `INVALID_PATH` naming the escaping path; nothing is read from outside the local inventory store, and nothing already recorded is disturbed — a payload reached only by following a symlink out of the store must never be materialized into a project, or reported back, as if it were this template's own content - `inst-resolve-read-guard-fail`

Note on identity: the identity this algorithm reads from the manifest (`name`) is what keys this local inventory and, once `register` runs, what keys a project's `.frontx/project.json` `templates` map (`cpt-frontx-adr-project-provenance-record`, whose uniqueness rule is fixed by `cpt-frontx-adr-template-manifest-contract`). It is a template's registration identity, not the identity of any one applied instance — an applied instance's identity is its unique `target` (`cpt-frontx-adr-composed-template-resolution`), never a second `instanceId` or `registryPath`; see the note under "Template Identity Comes From the Manifest and Collisions Are Rejected" (§5) for the full distinction.

Note on an upgrade's or a restore's resolutions: `inst-resolve-if-upgrade-candidate` above is why none of the resolutions an upgrade or a restore performs — the candidate's, or the baseline's own re-resolution for validation's honesty check or for commit's failure recovery — ever collides with the identity being upgraded: each declares that same, already-occupied identity by design, but this branch never reaches `inst-resolve-collision-check`, because none of them ever touches the identity's slot in the first place. Nothing is materialized for them at all, so a candidate that turns out to be doubly-changed, refused, or declined leaves no trace anywhere — not in the slot the identity-collision rule protects, and not beside it. Two resolutions of the same commit, or a concurrent upgrade and restore of the same name, are separate in-memory values and cannot share an address, so no addressing scheme is needed to keep them apart; there is likewise nothing for one invocation to reclaim out from under another's still-open review gate, and nothing a killed process can leave behind. The collision rule is otherwise unchanged, and continues to govern only `install`, `register`, and the bounded local update below, exactly as it always has.

An earlier revision of this algorithm required the same content be materialized into an invocation-scoped staging location inside the local inventory store, and carried the addressing scheme, the discard-at-own-end rule, and the accepted-orphan-residue consequence that mechanism needs. `cpt-frontx-adr-project-upgrade-mechanism`'s actual requirement is narrower — that such a resolution "reads its content without ever adopting a new identity into the project or disturbing the registered slot" — and an in-memory handle satisfies it strictly, while removing the orphaned-residue consequence that decision itself recorded as a cost. Nothing consumed the staged content on disk: an upgrade's commit promotes by re-resolving the now-recorded origin (`cpt-frontx-algo-template-resolution-bounded-update`), never by copying staged bytes.

### Bounded Local Inventory Update

- [x] `p2` - **ID**: `cpt-frontx-algo-template-resolution-bounded-update`

**Input**: Template name and a validated structured reference for the new version

**Output**: An updated inventory entry (name, new pinned version) or a failure (`TEMPLATE_NOT_REGISTERED`, `ORIGIN_UNAVAILABLE`, `REGISTRATION_CONFLICT`, `INVALID_PATH`, or `CONTENT_CONFLICT`); scaffolded projects are not touched

**Steps**:
1. [x] - `p1` - Look up the named entry in the inventory index - `inst-bupd-lookup`
   1. [x] - `p1` - **IF** the local inventory index's own file, once every symlink along it is resolved, cannot be proven to resolve inside the local inventory store root, **OR** it cannot be parsed as JSON, **OR** it parses to something other than the tracked name-to-entry mapping every reader of it assumes (a hand-edited or corrupted `index.json`) - `inst-bupd-lookup-guard`
      1. [x] - `p1` - **RETURN** `INVALID_PATH` for an escaping path, or `CONTENT_CONFLICT` naming the index file for a parse or shape failure; do not write to local inventory, and do not report content reached only by following a symlink out of the local inventory store as if it were tracked local inventory — the SAME containment `inst-resolve-index-guard`/`inst-bupd-index-guard` already prove before every WRITE to this file, proven here before every READ of it too, through the identical primitive. A fact about content this local inventory store itself wrote (the parse/shape half) is refused the same way any other unreadable content this feature already reports is, rather than reaching a caller as a raw parse error or a crash on a field the malformed shape does not carry - `inst-bupd-lookup-guard-fail`
2. [x] - `p1` - **IF** the named entry is absent: - `inst-bupd-absent-check`
   1. [x] - `p1` - **RETURN** `TEMPLATE_NOT_REGISTERED`; abort with no inventory write - `inst-bupd-absent-fail`
3. [x] - `p1` - Fetch the new template content from the source registry at the new ref using the shared resolver - `inst-bupd-fetch`
4. [x] - `p1` - **IF** the fetch fails: - `inst-bupd-fetch-fail-check`
   1. [x] - `p1` - **RETURN** `ORIGIN_UNAVAILABLE`; leave the existing inventory entry unchanged - `inst-bupd-fetch-fail`
5. [x] - `p1` - **IF** the newly fetched content declares an identity other than the entry being updated: - `inst-bupd-identity-mismatch`
   1. [x] - `p1` - **RETURN** `REGISTRATION_CONFLICT` naming both the entry's identity and the declared one; leave the existing inventory entry unchanged, since replacing it would substitute one template for another under the entry's identity - `inst-bupd-identity-mismatch-fail`
6. [x] - `p1` - Replace the named template's materialized files in the inventory store with the newly fetched content at its installed content path - `inst-bupd-replace`
   1. [x] - `p1` - **IF** the installed content path, once every symlink along it is resolved, cannot be proven to resolve inside the local inventory store root, **OR** a non-directory entry stands where a directory component of that path is required - `inst-bupd-replace-guard`
      1. [x] - `p1` - **RETURN** `INVALID_PATH` for an escaping path or `CONTENT_CONFLICT` naming the blocking non-directory component; the existing inventory entry and its materialized files are left exactly as they were - `inst-bupd-replace-guard-fail`
7. [x] - `p1` - Update the inventory index to record the new pinned ref for the named entry - `inst-bupd-index-update`
   1. [x] - `p1` - **IF** the local inventory index's own file, once every symlink along it is resolved, cannot be proven to resolve inside the local inventory store root, **OR** whatever currently stands at that path is neither absent nor an ordinary regular file - `inst-bupd-index-guard`
      1. [x] - `p1` - **RETURN** `INVALID_PATH` for an escaping path or `CONTENT_CONFLICT` naming the non-regular shape; the index file and the existing inventory entry are left exactly as they were - `inst-bupd-index-guard-fail`
   2. [x] - `p1` - Publish the updated index by writing a temp file beside its RESOLVED destination — `indexPath` itself for the ordinary case, or the real document a symlink standing at `indexPath` aliases otherwise — then renaming that temp file onto the SAME resolved destination, never onto a symlink found at the original `indexPath`: `fs.rename` does not follow a symlink standing at its destination, so renaming onto `indexPath` directly would replace the link itself and orphan the real document it named, still holding the OLD index with nothing in the report saying so. An internal symlink therefore survives the update and the real document it names is what carries the new index, exactly as `.frontx/project.json`'s own writer already does for the same reason (`cpt-frontx-algo-composed-provenance-project-state-io`'s `inst-psio-resolve-write-destination`) - `inst-bupd-index-resolve-write-destination`
8. [x] - `p1` - Confirm that no paths outside the local inventory store were written during this operation - `inst-bupd-boundary-confirm`
9. [x] - `p1` - **RETURN** updated inventory entry containing name and new pinned version - `inst-bupd-return`

This bounded update re-fetches a *remote* origin's inventory entry to a new ref; it does not apply to an entry installed from a local `path:` origin, which has no separate pinned copy to bound-update in the first place — the resolver reads that folder's current content at every resolution (`inst-resolve-local-path-read`), so the folder's own content is already "current" without a bound-update step, and a change reaching an already-applied target still happens only through the explicit `upgrade` path, never a local re-fetch (`cpt-frontx-adr-source-spec-syntax`). This developer-invoked replacement is also distinct from a resolution serving an upgrade or a restore: `update-local` always replaces the named entry's slot immediately, on the developer's own request, while an upgrade's or a restore's resolutions stage content, per invocation, without ever replacing that slot, leaving the replacement to the upgrade's own commit (`cpt-frontx-feature-upgrade-changeset`; see the note on an upgrade's or a restore's resolutions above).

## 4. States (CDSL)

Include when entities have explicit lifecycle states.

### Inventory Template State Machine

- [x] `p2` - **ID**: `cpt-frontx-state-template-resolution-inventory-lifecycle`

**States**: UNRESOLVED, RESOLVED, INSTALLED, UPDATED

**Initial State**: UNRESOLVED

**Transitions**:
1. [x] - `p1` - **FROM** UNRESOLVED **TO** RESOLVED **WHEN** the source-spec is successfully parsed and the source registry returns the template content for the given ref - `inst-state-to-resolved`
2. [x] - `p1` - **FROM** RESOLVED **TO** INSTALLED **WHEN** the fetched content is materialized into the local inventory store and the inventory index is updated with the pinned version - `inst-state-to-installed`
3. [x] - `p1` - **FROM** INSTALLED **TO** UPDATED **WHEN** a bounded local update fetches new content for the named inventory entry, replaces it in the inventory store, and updates the index without touching any scaffolded project - `inst-state-to-updated`
4. [x] - `p1` - **FROM** UNRESOLVED **TO** UNRESOLVED **WHEN** source-spec parse validation fails (missing `host:` prefix, missing `@ref` selector, or a malformed repository path or subtree segment) and the inventory is not written - `inst-state-parse-fail-loop`
5. [x] - `p1` - **FROM** RESOLVED **TO** UNRESOLVED **WHEN** the source registry fetch fails after a successful parse and the inventory is not written - `inst-state-fetch-fail-loop`
6. [x] - `p1` - **FROM** RESOLVED **TO** UNRESOLVED **WHEN** the referenced subtree holds no content, the acquired content declares no usable identity, or the declared identity is already tracked for a different source-spec, and the inventory is not written - `inst-state-reject-loop`

This machine models only the tracked local inventory's own lifecycle — a slot indexed under a declared identity. A resolution serving an upgrade or a restore (`inst-resolve-if-upgrade-candidate`) never reaches INSTALLED or UPDATED, because it is never indexed at all: it holds the acquired content in memory and materializes nothing, and whether that content ever reaches a slot is decided entirely outside this machine, by `cpt-frontx-feature-upgrade-changeset`'s own commit. Such a resolution sits outside this lifecycle rather than adding a state to it.

## 5. Definitions of Done

Specific implementation tasks derived from flows/algorithms above.

### CLI Installs Template by Versioned Source-Spec

- [x] `p1` - **ID**: `cpt-frontx-dod-template-resolution-install-by-spec`

The system **MUST** install a template into the local inventory by resolving a developer-supplied `host:owner/repo[//subtree]@ref` source-spec, or a local `path:<relative-path>` origin naming a folder inside the project's own tree, through the shared resolver, materialize the resolved content as the template's actual on-disk files in the tracked inventory store addressable at an installed content path (not a single manifest blob), and record the resolved version — with zero template content bundled in the CLI distribution. When the source-spec carries a subtree segment, the system **MUST** materialize only that subtree, re-rooted so every materialized path is relative to the subtree rather than to the repository, and **MUST** retain the subtree in the re-resolvable source-spec it records. For a remote source-spec, the system **MUST** record the origin as the exact immutable commit SHA or exact package version the fetch settled on, never the typed, possibly-moving `@ref` (`cpt-frontx-adr-source-spec-syntax`); for a `path:` origin, which has no separate publication to pin against, the system **MUST** record the path exactly as given and **MUST NOT** fabricate a pin. The system **MUST** refuse with `INVALID_INPUT` a malformed source-spec or one naming a host the shared resolver carries no fetch adapter for — refused before any fetch, so an unsupported host is never reported as an unreachable registry and never yields an origin the resolver could not pin — `INVALID_PATH` a local origin that cannot be proven to stay inside the project root or a subtree re-rooting escape, `ORIGIN_UNAVAILABLE` an unreachable registry or an empty referenced subtree, `INVALID_MANIFEST` unreadable or unusable acquired content, and `REGISTRATION_CONFLICT` a declared identity already tracked or nesting with one the inventory already tracks (`target`). Materializing content and recording it in the index **MUST NOT** write through a symlink that resolves outside the local inventory store root once every symlink along the installed content path or the index's own file is resolved — refused with `INVALID_PATH` naming the escaping path — and **MUST NOT** silently reclaim a non-directory entry standing where a directory component is required, or a directory, FIFO, socket, or device standing at the index's own file, both refused with `CONTENT_CONFLICT` naming the blocking entry rather than deleting it or crashing with an unstructured filesystem error; a local inventory index that cannot be parsed as JSON or does not conform to the tracked entry shape **MUST** likewise refuse with `CONTENT_CONFLICT` rather than propagate a malformed value into a caller's own logic (`target`).

**Implements**:
- `cpt-frontx-flow-template-resolution-install`
- `cpt-frontx-algo-template-resolution-parse-spec`
- `cpt-frontx-algo-template-resolution-resolve-to-inventory`

**Constraints**: `cpt-frontx-constraint-cli-template-independence`

**Touches**:
- Entities: `Template`

### CLI Lists Local Template Inventory

- [x] `p1` - **ID**: `cpt-frontx-dod-template-resolution-list-inventory`

The system **MUST** report, when the developer invokes the list command, the platform's default templates — drawn from the CLI's own built-in list of official default origins (`cpt-frontx-feature-cli-scaffolding`'s `seed`; `cpt-frontx-adr-project-provenance-record`, "Catalog visibility"), never from a `.frontx/project.json` or a third-party source — the current project's registered templates, and the templates installed locally but not yet registered, each with its version, and **MUST** additionally offer a machine-readable form carrying all three sets inside the one uniform envelope every command's `--json` mode emits (`{"ok": true, "data": {...}}` / `{"ok": false, "error": {...}}`, `cpt-frontx-adr-cli-machine-readable-output`) - the surface over which a calling program obtains the selectable set without reading the inventory's storage or the project state document directly. Each entry in every set carries the description its manifest declares; the key is omitted, never reported as empty or a placeholder, only for a damaged installed entry whose stored manifest no longer declares one — a non-conforming manifest is refused outright at install and never enters local inventory (`cpt-frontx-algo-template-manifest-refuse-legacy`), so a conforming entry under the current contract always carries one until its stored copy is corrupted or altered after installation. A `.frontx/project.json` that fails the project-state contract is reported as `{"ok": false, "error": {"code": "PROJECT_INVALID", ...}}` rather than a partial `registered` set; and the command **MUST** refuse an invocation carrying any argument that is not the recognized machine-readable flag with `INVALID_INPUT` rather than falling through to either listing form (`target` for the machine-readable form and for the argument refusal).

**Implements**:
- `cpt-frontx-flow-template-resolution-list`

**Constraints**: `cpt-frontx-constraint-cli-template-independence`

**Touches**:
- Entities: `Template`
- CLI: list command, machine-readable output form (`target`)

### CLI Updates Local Inventory Entry Without Touching Scaffolded Projects

- [x] `p1` - **ID**: `cpt-frontx-dod-template-resolution-bounded-local-update`

The system **MUST** replace a named inventory entry with the newly fetched content at the new pinned version, writing exclusively within the local inventory store and leaving every scaffolded project path unchanged, refusing with `TEMPLATE_NOT_REGISTERED` when the name is absent from the inventory, `ORIGIN_UNAVAILABLE` when the fetch fails, and `REGISTRATION_CONFLICT` when the fetched content declares a different identity. The system **MUST** refuse with `CONTENT_CONFLICT` when the local inventory index cannot be parsed as JSON or does not conform to the tracked entry shape, before the named entry is looked up, and **MUST NOT** write the replaced content or the updated index through a symlink resolving outside the local inventory store root (refused with `INVALID_PATH`, naming the escaping path) or over a non-directory entry blocking a required directory component, or a directory, FIFO, socket, or device standing at the index's own file (refused with `CONTENT_CONFLICT`, naming the blocking entry) — leaving the existing inventory entry and its materialized files exactly as they were on any such refusal (`target`).

**Implements**:
- `cpt-frontx-flow-template-resolution-update-local`
- `cpt-frontx-algo-template-resolution-bounded-update`

**Constraints**: `cpt-frontx-constraint-cli-template-independence`

**Touches**:
- Entities: `Template`

### Source-Spec Parser Rejects Invalid References

- [x] `p1` - **ID**: `cpt-frontx-dod-template-resolution-spec-parser-rejection`

The system **MUST** reject with `INVALID_INPUT` any source-spec that omits the `host:` prefix or the `@ref` version selector before any fetch or inventory write is attempted, **MUST** likewise reject rather than reinterpret a repository path whose segment count is not two, an empty or trailing-slash subtree segment, and a subtree segment carrying an empty, `.`, or `..` segment, **MUST** round-trip a valid `host:owner/repo//subtree@ref` reference into its five constituent parts (host, owner, repo, subtree, ref), and **MUST** parse a reference without the subtree segment into the same four parts as before, carrying no subtree.

**Implements**:
- `cpt-frontx-algo-template-resolution-parse-spec`

**Constraints**: `cpt-frontx-constraint-cli-template-independence`

**Touches**:
- Entities: `Template`

### Template Identity Comes From the Manifest and Collisions Are Rejected

- [x] `p1` - **ID**: `cpt-frontx-dod-template-resolution-manifest-identity`

The system **MUST** take a template's identity from the identity its own manifest declares rather than from the repository the reference names, and **MUST** use that identity as the inventory index key, as the installed content path, and as the identity recorded for the template. The system **MUST** reject with `INVALID_MANIFEST` a reference whose acquired content carries no readable manifest or declares an identity that is empty or not usable as an installed content path — relative, free of empty, `.` and `..` segments, with a scoped identity carrying a `/` remaining admissible — and **MUST** reject with `REGISTRATION_CONFLICT` an install whose declared identity is already tracked for a different template address — naming both the occupying source and the requested one — rather than writing into the occupant's content path, while admitting a reference that differs only in its version selector, which names the same template at another version. The system **MUST** likewise reject with `REGISTRATION_CONFLICT` an install whose declared identity nests with an identity the inventory already tracks, one being a leading path segment sequence of the other, naming the occupying identity: two nesting identities are two inventory keys but not two directories, so a bounded update of the outer one clears the inner one from disk while leaving it indexed.

**Two different uses of "identity" — not to be conflated.** The manifest-declared `name` this DoD fixes is a template's *registration identity*: it keys this local inventory, and, unchanged, it keys a project's `.frontx/project.json` `templates` map once `register` runs (`cpt-frontx-adr-project-provenance-record`, whose uniqueness rule is fixed by `cpt-frontx-adr-template-manifest-contract`) — one name maps to exactly one origin, never a caller-chosen alias. This is a distinct question from the identity of an *applied instance* of that template: once a template is applied, what distinguishes one applied instance from another is its unique `target`, not the template's registration identity — a `templates[name].targets` array can hold many targets under the one registered name, and there is no separate `instanceId` or `registryPath` naming an instance (`cpt-frontx-adr-composed-template-resolution`). A collision this DoD rejects is always a registration-identity collision inside the local inventory or the `templates` map; it is never a check over applied targets, which is the conflict checker's separate, target-keyed geometry (`cpt-frontx-adr-assembly-conflict-prevention`).

**Implements**:
- `cpt-frontx-flow-template-resolution-install`
- `cpt-frontx-algo-template-resolution-resolve-to-inventory`

**Constraints**: `cpt-frontx-constraint-cli-template-independence`

**Touches**:
- Entities: `Template`

### A Resolution Serving an Upgrade or a Restore Never Touches the Registered Slot

- [x] `p1` - **ID**: `cpt-frontx-dod-template-resolution-staged-mode`

The system **MUST** return a candidate or a baseline re-resolution an upgrade or a restore performs (`cpt-frontx-feature-upgrade-changeset`) as in-memory content, materializing it nowhere: not under the registered name's own inventory slot, not at any other address inside the local inventory store, and **MUST NOT** write it into the inventory index or report it through `list`. The registered name's own slot **MUST** remain exactly as it was until, and only if, that invocation's own commit promotes content into it (`cpt-frontx-algo-upgrade-changeset-commit`) — which that commit performs by re-resolving the now-recorded origin, never by copying resolved bytes from a staging location. Because nothing is materialized, no invocation has a location to discard at its own end, none can collide with a concurrent upgrade or restore of the same name, and none can be orphaned by a killed process. This mode sits outside the inventory template state machine (§4): such a resolution never reaches INSTALLED or UPDATED, because it is never indexed at all (`target`).

**Implements**:
- `cpt-frontx-algo-template-resolution-resolve-to-inventory`

**Constraints**: `cpt-frontx-constraint-cli-template-independence`

**Touches**:
- Entities: `Template`

## 6. Acceptance Criteria

- [x] CLI install command resolves a valid `host:owner/repo@ref` source-spec, fetches from the source registry, and writes the result to the local inventory at the exact immutable commit or package version the fetch settled on, never the typed `@ref`
- [x] CLI install command resolves a local `path:<relative-path>` origin by reading the named folder's current content directly, records the path exactly as given with no pin fabricated, and refuses a path that cannot be proven to stay inside the project root (`target`)
- [x] CLI install command with a source-spec missing the `host:` prefix or the `@ref` selector fails with `INVALID_INPUT` before any fetch or inventory write
- [x] CLI install command with a well-formed source-spec naming a host the shared resolver carries no fetch adapter for fails with `INVALID_INPUT` before any fetch or inventory write, naming both the offending host and the supported one(s) — never `ORIGIN_UNAVAILABLE`, which would report an unsupported host as a reachability problem, and never an origin recorded without a pin; a supported host's own unreachable repository still fails with `ORIGIN_UNAVAILABLE`, so the two remain distinguishable
- [x] CLI install command resolves a valid `host:owner/repo//subtree@ref` source-spec and materializes only that subtree, with every materialized path relative to the subtree rather than to the repository
- [x] A source-spec whose repository path does not consist of exactly one owner segment and one repository segment, or whose subtree segment is empty, trailing-slash, or carries an empty, `.`, or `..` segment, fails with `INVALID_INPUT` before any fetch or inventory write
- [x] A source-spec naming a subtree that holds no content at the referenced version fails with `ORIGIN_UNAVAILABLE` identifying the subtree, and nothing is written to the local inventory
- [x] A subtree whose acquired content carries a path that escapes the subtree once re-rooted is refused with `INVALID_PATH`, and nothing is written to the local inventory
- [x] The identity a template is tracked under is the identity its manifest declares, and it is the inventory index key, the installed content path segment, and the identity recorded in the re-resolvable source-spec's provenance
- [x] Two source-specs differing only in their subtree segment, whose manifests declare different identities, install as two distinct templates from one repository at one version, each at its own installed content path; if the two declare one identity the second install is refused with `REGISTRATION_CONFLICT`
- [x] Installing a template whose declared identity is already tracked for a different source-spec fails with `REGISTRATION_CONFLICT` naming both sources, and the occupying template's content path is left unmodified
- [x] Installing a template whose declared identity nests with an already-installed identity, such as `@acme/tools/extra` against an installed `@acme/tools`, fails with `REGISTRATION_CONFLICT` naming the occupying identity, and nothing is written under the occupant's content path
- [x] CLI list command returns all installed templates and their pinned versions from the local inventory
- [x] CLI list command reports the platform's default templates, the current project's registered templates, and the templates installed locally but not yet registered, as three distinct sets (`target`)
- [x] CLI list command reports an empty inventory when no templates are installed
- [x] CLI list command's machine-readable form emits the uniform envelope's `{"ok": true, "data": {defaults, registered, installed}}`, each set carrying every entry's name, version, and manifest-declared description (plus `origin` and, for `registered`, `targets`), with an empty set reported as `[]` and no `description` key for an entry whose manifest declares none — possible only for a damaged installed entry, since a legacy manifest is refused outright at install and never enters local inventory (`target`)
- [x] CLI list command refuses an unrecognized argument with `INVALID_INPUT` and a usage line naming it, emitting neither listing form, while a repeated recognized flag is accepted (`target`)
- [x] A `.frontx/project.json` that fails the project-state contract is reported as `{"ok": false, "error": {"code": "PROJECT_INVALID", ...}}` rather than a partial or silently-empty `registered` set (`target`)
- [x] The `defaults` set reported by `list` (human-readable or `--json`) is sourced from the CLI's own built-in list of official default origins, independent of any project's `.frontx/project.json`.
- [x] CLI update-local command replaces the named inventory entry with newly fetched content at the new pinned version, leaving every scaffolded project path unmodified
- [x] CLI update-local command reports `TEMPLATE_NOT_REGISTERED` when the named template is absent from the local inventory
- [x] Installing or update-locally replacing a template whose installed content path, or whose local inventory index's own file, resolves outside the local inventory store root once a symlink standing at either path is followed is rejected with `INVALID_PATH`, naming the escaping path; the file the symlink pointed at, outside the store, survives byte-for-byte and is never overwritten under a success report
- [x] Installing or update-locally replacing a template whose installed content path is blocked by a non-directory entry standing where a directory component is required, or whose local inventory index's own file is a directory, FIFO, socket, or device, is rejected with `CONTENT_CONFLICT`, naming the blocking entry, rather than reclaiming it by deletion or crashing with an unstructured filesystem error and no `--json` envelope
- [x] A local inventory index that cannot be parsed as JSON, or that parses to a shape other than the tracked name-to-entry mapping, is rejected with `CONTENT_CONFLICT`, naming the index file, rather than reaching a caller as a raw parse error or a crash on a field the malformed shape does not carry
- [x] No template content is bundled in the CLI distribution (zero template assets or dependencies in the CLI package)
- [x] Inventory template state machine cycles UNRESOLVED → RESOLVED → INSTALLED → UPDATED under successful install and update flows
- [x] Resolving a candidate or a baseline re-resolution for an upgrade or a restore never writes into the registered name's own inventory slot and never indexes the acquired content: the slot's pre-resolution content is still there immediately after the resolution returns, and nothing new appears in `list`.
- [x] Two upgrades of different template names resolved from the same commit SHA, and a concurrent upgrade and restore of the same name, each hold their own acquired content; neither invocation's content is visible to, or removable by, the other, and neither shares an address with the other because neither has one.
- [x] A refused, declined, or crashed upgrade or restore leaves nothing behind anywhere in the local inventory store — no slot change, no index entry, and no residue at any other address, because its resolution materialized nothing in the first place.
- [x] Every `RETURN`-level refusal in this feature's flows and algorithms names a code from the shared error-code vocabulary (`cpt-frontx-adr-cli-machine-readable-output`).
- [x] `list` satisfies `cpt-frontx-cli-nfr-template-scale`'s inventory threshold: listing at least 100 installed templates with version identity completes in no more than 2 seconds at p95 on a normal developer workstation.
- [x] `cfs --json validate --artifact packages/cli/architecture/features/template-resolution/FEATURE.md --skip-code` returns PASS.
- [x] `cfs --json validate-toc packages/cli/architecture/features/template-resolution/FEATURE.md` returns PASS.
