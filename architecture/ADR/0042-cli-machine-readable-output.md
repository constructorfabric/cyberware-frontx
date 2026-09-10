---
status: accepted
date: 2026-08-12
---

# What Every CLI Command's Machine-Readable Output Must Look Like

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [One discriminated-union envelope for every command](#one-discriminated-union-envelope-for-every-command)
  - [A multi-valued `status` field](#a-multi-valued-status-field)
  - [Command-specific JSON without envelope](#command-specific-json-without-envelope)
  - [JSON Lines / event-stream output](#json-lines--event-stream-output)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-cli-machine-readable-output`

## Context and Problem Statement

The CLI (`cpt-frontx-component-cli`, the `@gears-frontx/cli` package) is driven by both a human Project Developer and an AI agent acting for one, and many commands across its surface need a machine-readable form: template registration, listing, assembly preview, apply, seeding, deletion, ownership management, upgrade, and validation each produce their own success data and can each fail in ways an agent must distinguish and act on — a missing manifest, a version mismatch, an unregistered template, a target already claimed, conflicting content, an existing path the agent must decide about, a destructive operation awaiting confirmation, an unreachable origin, or an invalid project. Absent one contract shared across all of them, every command declares its own `--json` shape and its own way of signaling failure, so an AI orchestrator needs a bespoke parser and a bespoke error-detection strategy per command instead of one parser and one finite vocabulary of failure codes it can branch on across the whole surface. What single machine-readable output contract should every CLI command's `--json` mode produce, so that an AI agent and a human reviewing the same operation see the same data and only the presentation differs?

## Decision Drivers

* **One consumer contract across many commands** — an AI orchestrator (and any other external caller) should parse one envelope shape and branch on one finite set of error codes, not learn a bespoke shape and a bespoke failure signal per command as the surface grows.
* **Reliable, structural failure signaling** — success and failure must be distinguishable by structure, not by scraping stderr text or inferring meaning from an exit code alone; a failure must carry a stable machine code an agent can match against, not just a human sentence.
* **No interactive prompts in machine mode** — `--json` is read by a process, not a person, so a command must never block on a TTY prompt in that mode; a destructive operation (delete) still needs a way to require confirmation, expressed as data an agent can inspect and re-issue against, not a blocking question.
* **One data model, two renderings** — the human-readable form and the machine-readable form must present the same underlying result; formatting the same data as text or as JSON keeps the two renderings from silently drifting apart, and CLI-suggested next steps stay hints the agent or human still decides whether to take, never an automatic action.
* **A clean channel** — the one JSON value a machine-mode invocation emits must be the only thing on stdout, so an agent can parse the entire stream as one value without filtering progress lines or diagnostics out of it first.
* **Room to grow without breaking the contract** — a future need for incremental progress or streamed events (a long-running `apply`, for instance) must be addable as a distinct opt-in mode, not a redesign of the settled result shape every existing command and consumer already depends on.

## Considered Options

* **One discriminated-union envelope for every command** — every command's `--json` mode emits exactly one final JSON object on stdout: `{"ok": true, "data": {...}}` on success or `{"ok": false, "error": {"code", "message", "details"}}` on failure or a decision the agent must make, drawn from one finite set of stable codes.
* **A multi-valued `status` field** — replace the two-way `ok` boolean with an open string field such as `status: "success" | "error" | "warning" | ...`, letting the result carry more than two outcomes.
* **Command-specific JSON without envelope** — each command emits whatever JSON shape fits its own result, with failure signaled through the process exit code and a message on stderr rather than through the JSON itself.
* **JSON Lines / event-stream output** — each command emits a stream of newline-delimited JSON events (progress, diagnostics, and a final result) rather than one final value.

## Decision Outcome

Chosen option: **One discriminated-union envelope for every command**, because it is the only option that gives an AI agent one parser and one finite vocabulary of failure codes across a command surface that keeps growing. In `--json` mode, every command emits exactly one JSON object on stdout as its last and only output: `{"ok": true, "data": {...}}` on success, or `{"ok": false, "error": {"code": "...", "message": "...", "details": {...}}}` on failure or whenever a decision is required that the command cannot make on the agent's behalf. Progress reporting and diagnostic output never reach stdout in this mode, so the one object is the entire stream an agent needs to parse. `ok: false` always pairs with a non-zero process exit code, so a caller that only checks the exit code still gets a correct pass/fail signal, and `--json` never blocks on an interactive prompt — a command that would otherwise ask a question returns `ok: false` with a code identifying the decision instead.

The v1 vocabulary of stable `error.code` values is sixteen codes, set out below in two groups for readability rather than as a partition of the command surface. Nine are listed by name alone, because the refusal each stands for is evident from the name: `INVALID_MANIFEST`, `VERSION_MISMATCH`, `TEMPLATE_NOT_REGISTERED`, `TARGET_CONFLICT`, `CONTENT_CONFLICT`, `EXISTING_PATHS_REQUIRE_DECISION`, `CONFIRMATION_REQUIRED`, `ORIGIN_UNAVAILABLE`, and `PROJECT_INVALID`. Seven are stated together with the condition each one covers, because the name alone does not settle which invocation earns it: `REGISTRATION_CONFLICT` (`register` with a different origin for a name that already has one, without `--replace`; an identity mismatch discovered during `register` or `upgrade`), `TARGETS_EXIST` (`unregister`, or `register --replace`, attempted against a name whose `targets` array is non-empty), `TARGET_NOT_APPLIED` (`delete` or `upgrade` naming a target or template name with no applied instance), `INVALID_PATH` (a path passed to `ownership add` that does not exist, that escapes the project root, or that fails the fail-closed canonicalization every path the CLI checks is subject to), `NOTHING_TO_RESTORE` (a restore operation invoked when no restorable state is available), `INVALID_INPUT` (a malformed batch JSON payload, or a usage error in how a command was invoked), and `INTERNAL` (an unexpected I/O or other failure not attributable to any of the above). `VERSION_MISMATCH` is fixed specifically to `validate --project`'s detection that a registered template's manifest no longer resolves to the `version` recorded for it, and to the analogous version discrepancy `upgrade` detects between what it expects and what it finds. This decision fixes that the codes are stable, string-valued, and drawn from one shared vocabulary rather than invented per command; the codes' exhaustive definitions and which command emits which belong to the FEATUREs that own each command's behavior, per `cpt-frontx-adr-contract-schema-ownership`. Every refusal a FEATURE specifies for its own command's behavior must name one of these sixteen codes; a genuinely new failure mode is added to this shared vocabulary by amending this decision's list, never invented locally inside a FEATURE's own text.

Destructive operations resolve the "no interactive prompt in machine mode" driver through the same envelope rather than a side channel: in `--json`, a delete that would remove files returns `ok: false` with `error.code: "CONFIRMATION_REQUIRED"` and `details` listing what would be deleted and what would be preserved, so an agent inspects the lists and re-issues the command with `--yes` to proceed — no prompt is ever written and no input is ever read in this mode. Interactively, the same operation asks for confirmation with a default of No. `--dry-run` reports the same delete/preserve lists without deleting anything and without requiring confirmation in either mode, because nothing is at stake to confirm.

The human-readable mode is not a second implementation: it formats the same result the envelope carries — the same `data` on success, the same `code`/`message`/`details` on failure — as text for a person, optionally suggesting CLI commands to run next, but the decision of what to do with a failure or a required confirmation is always the agent's or the human's, never the CLI's own. The discriminated union on `ok` is chosen deliberately over a wider `status` enumeration and is scoped narrowly: it fixes the two-way success/failure shape, the fixed field names, and that codes are drawn from one stable vocabulary; it does not fix each command's `data` payload shape, which remains owned by that command's FEATURE. A future need to stream incremental progress or events is left to a possible separate `--jsonl` mode, introduced later without changing this envelope.

### Consequences

* Good, because an AI agent parses one envelope shape and branches on one shared, finite set of error codes across every command, instead of learning a bespoke shape and bespoke failure signal per command.
* Good, because `ok: false` is both a structural marker and paired with a non-zero exit code, so a caller that checks only one of the two still gets a correct result.
* Good, because a destructive delete's confirmation is expressible as data (`CONFIRMATION_REQUIRED` plus delete/preserve lists) that an agent can inspect and act on, rather than a blocking prompt that only a human can answer.
* Good, because the human-readable and machine-readable modes render the same underlying result, so the two forms cannot silently disagree about what happened.
* Bad, because every command must route its result through the shared envelope and the shared code vocabulary rather than shaping its own JSON freely, constraining how a new command's failure modes are expressed.
* Bad, because the stable code vocabulary is a contract of its own to steward: adding a genuinely new failure mode means extending the shared vocabulary, not inventing a local code.

### Confirmation

Compliance is confirmed by design and code review plus a continuous-integration check on the CLI package: for every command supporting `--json`, a fixture exercises at least one success path and one induced-failure path and asserts that stdout, parsed as a whole, is exactly one JSON value matching `{"ok": true, "data": ...}` or `{"ok": false, "error": {"code": ..., "message": ..., "details": ...}}`, with no other output on stdout. A further check asserts every `ok: false` fixture exits with a non-zero process code, that `error.code` in each is one of the fixed v1 codes, and that invoking a destructive delete in `--json` mode never reads from stdin and never blocks, returning `CONFIRMATION_REQUIRED` with delete/preserve lists instead; a companion `--dry-run` fixture asserts no files are removed and no confirmation code is returned.

## Pros and Cons of the Options

### One discriminated-union envelope for every command

Every command's `--json` mode emits one final `{"ok": true, "data": {...}}` or `{"ok": false, "error": {"code", "message", "details"}}` object, drawn from a shared, finite code vocabulary.

* Good, because one parser and one code vocabulary serve every command, present and future.
* Good, because `ok` is a two-way discriminant a type system and a caller can both narrow on unambiguously.
* Good, because destructive confirmation is representable as data (`CONFIRMATION_REQUIRED`) instead of a blocking prompt.
* Neutral, because each command's `data` payload shape is still owned by that command's FEATURE, not fixed here.
* Bad, because every command is constrained to route through the shared envelope and vocabulary rather than shaping its own result freely.

### A multi-valued `status` field

Replace the boolean `ok` with an open string, such as `status: "success" | "error" | "warning" | ...`, admitting more than two outcomes.

* Good, because a result with partial success or a soft warning has a state to occupy that a strict two-way boolean does not.
* Bad, because the contract stops being a clean two-way discriminant: a consumer must enumerate and handle every current and future status string instead of narrowing on one boolean.
* Bad, because it type-checks more weakly across languages and tooling than a boolean discriminant, and invites new intermediate statuses to accrete over time without a forcing function to keep the vocabulary small.

### Command-specific JSON without envelope

Each command emits whatever JSON shape fits its result; failure is signaled by the process exit code and a stderr message, not by the JSON payload itself.

* Good, because each command's result can be shaped exactly to its own data with no shared structure to conform to.
* Bad, because an agent needs a bespoke parser per command with no shared shape to rely on.
* Bad, because failure detection depends on the exit code and stderr text rather than the JSON itself, so a caller that only reads stdout cannot tell success from failure structurally.

### JSON Lines / event-stream output

Each command emits a stream of newline-delimited JSON events — progress, diagnostics, and a final result — rather than one final value.

* Good, because it can represent incremental progress and diagnostics for long-running operations that a single final value cannot.
* Neutral, because it is a plausible future extension for streaming needs, not a rejection of the envelope's final-result shape.
* Bad, because it is unnecessary complexity for v1: no current command has a progress-reporting need that a single final result cannot satisfy, and a consumer would have to buffer and demultiplex a stream instead of parsing one value.

## More Information

A command's FEATURE fixes only the `data` payload its own success carries and takes the outer shape from here: `cpt-frontx-feature-template-resolution` §1.5 does exactly that for the listing command, fixing that command's `data` fields and citing this record for the `ok` discriminant and the `error.code` vocabulary rather than declaring an envelope of its own. This decision fixes the envelope's structure, its two-way discriminant, that failure codes are drawn from one shared, stable vocabulary, and the non-interactive confirmation protocol for destructive operations; it does not fix any one command's `data` payload fields, which remain owned by that command's FEATURE per `cpt-frontx-adr-contract-schema-ownership`, nor does it fix the deferred `--jsonl` streaming mode's shape, left to a future decision if that need materializes.

Applicability of the remaining checklist categories:

* **PERF** — Not applicable, because emitting one JSON object binds no latency or throughput budget beyond the command's own work.
* **SEC** — Not applicable, because the envelope carries operation results and paths, not secret material.
* **REL** — Not applicable, because there is no service-availability target for a local CLI invocation.
* **DATA** — Not applicable as a complete schema, because each command's `data` payload is owned by that command's FEATURE; this decision fixes only the envelope's outer shape and the shared code vocabulary.
* **INT** — addressed directly: this is the cross-boundary contract an external AI orchestrator or any scripted caller integrates against for every command, uniformly.
* **OPS** — Not applicable, because no operational procedure attaches to a command's output format.
* **MAINT** — addressed: one shared envelope and one shared code vocabulary keep new commands from each inventing their own machine-readable shape.
* **UX** — addressed directly: the human-readable mode renders the same result as text, so a person and an agent never see disagreeing accounts of the same operation.
* **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by ID.
* **COMPL** — Not applicable, because the envelope carries command outcomes, error codes and repository-relative paths; it declares no field that could hold personal or regulated data.

**Review cadence**: revisit if a new command's result shape cannot be expressed within the shared code vocabulary without overloading an existing code's meaning, or once a validated need emerges for envelope versioning as the number of commands and codes sharing this contract grows.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-cli-template-list` — The listing command's machine-readable output is one instance of this envelope rather than a shape of its own, so a caller reading a catalogue gets the same success discriminant, the same failure variant, and the same stable codes it gets from every other command.
* `cpt-frontx-usecase-scaffold-composed-project` — A Project Developer's AI agent installs, seeds, and checks assembly for conflicts through this CLI surface; the uniform envelope is what lets the agent drive that sequence end to end on one parser and react correctly to a refused assembly.
* `cpt-frontx-usecase-add-microfrontend-to-project` — Adding a template to an existing repository and checking its declared boundaries against those already applied surfaces its outcome, including a refused conflict, through this same envelope.
* `cpt-frontx-nfr-evolvability` — The envelope's scope is bounded so a future streaming extension (a possible `--jsonl` mode) is additive rather than a breaking change to this decision's settled shape.
