# Feature: CLI Executable Invocation Surface

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Run a CLI Command](#run-a-cli-command)
  - [Show Usage or Handle an Unrecognized Command](#show-usage-or-handle-an-unrecognized-command)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Parse Invocation and Dispatch](#parse-invocation-and-dispatch)
- [4. States (CDSL)](#4-states-cdsl)
  - [Invocation Run State Machine](#invocation-run-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Executable Entrypoint Dispatches Every Command](#executable-entrypoint-dispatches-every-command)
  - [Usage and Help Output](#usage-and-help-output)
  - [Exit-Code Convention](#exit-code-convention)
  - [Uniform Envelope Dispatch in `--json` Mode](#uniform-envelope-dispatch-in---json-mode)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [x] `p1` - **ID**: `cpt-frontx-featstatus-cli-invocation`
## 1. Feature Context

- [x] `p1` - `cpt-frontx-feature-cli-invocation`

### 1.1 Overview

`@gears-frontx/cli` is invoked as an executable command surface: a single `frontx` executable entrypoint parses the process invocation, selects the named command from `frontx <command> [args]`, and dispatches it to the one internal component that owns that lifecycle capability — the same command surface the package-level anchor `cpt-frontx-component-cli` owns and delegates from (`cpt-frontx-adr-cli-internal-decomposition`). The command surface is `install / register / unregister / list / update-local / validate / assemble / apply / seed / delete / upgrade / ownership add|remove|list` (DESIGN §3.2 "CLI"). This feature owns only the entrypoint behavior — argv parsing, command selection, dispatch to the owning behavior by ID, usage/help output, the success / user-error / internal-error exit-code convention, and, in `--json` mode, routing every dispatched command's outcome through the one uniform result envelope (`cpt-frontx-adr-cli-machine-readable-output`, CLI-9) — and redefines none of the command behaviors it dispatches to; each is owned by its own feature and referenced here by canonical ID. All CDSL behavior is `target` (GREENFIELD — grounded in `cpt-frontx-adr-cli-internal-decomposition`, `cpt-frontx-adr-uniform-template-mechanism`, `cpt-frontx-adr-cli-machine-readable-output`, and DESIGN §3.3).

### 1.2 Purpose

This feature closes the gap between the declared `frontx` executable and the library command behaviors: it specifies the runnable entrypoint that turns a shell invocation into a dispatched command, so a Project Developer (or an AI agent acting for them) can run `frontx <command>` and reach the owning behavior. It realizes the command-surface responsibility the anchor `cpt-frontx-component-cli` holds under `cpt-frontx-adr-cli-internal-decomposition` — owning the surface and dispatching each command to one internal component — and dispatches over the single uniform mechanism decided in `cpt-frontx-adr-uniform-template-mechanism`. The command surface it exposes is `cpt-frontx-interface-cli`; its stability is governed by `cpt-frontx-adr-artifact-versioning-and-distribution`. The behaviors reached by dispatch — template install and catalog listing (`cpt-frontx-feature-template-resolution`), pre-publish `validate` (`cpt-frontx-feature-template-manifest`), registration, project state, project-state `validate --project`, and ownership management (`cpt-frontx-feature-composed-provenance`, referenced at feature level: that FEATURE's scope is reworked to the single project-state-store model DESIGN §3.1 `ProjectProvenance` fixes, and this feature dispatches to it as the consumer of that store rather than of any one per-instance provenance flow), batch assembly, apply, seed, and delete (`cpt-frontx-feature-cli-scaffolding`, whose `seed` flow registers a new project's official default templates before applying the batch — only against a new or empty project), and per-template atomic upgrade (`cpt-frontx-feature-upgrade-changeset`) — are owned by those features and are not redefined here.

**Requirements**: N/A — the CLI functional requirements are owned by the dispatched command features and are exposed transitively by this invocation surface, not owned or covered here. The command-to-behavior dispatch targets are referenced by canonical ID in §1.2 Purpose and in the flows/algorithm below for dispatch-surface context only.

**Applicability** (Often-N/A domains for a CLI Command feature, per the FEATURE checklist's Applicability Context): SEC and COMPL are not applicable — the entrypoint enforces no authentication or authorization boundary, since `frontx` runs as the invoking developer's own local process, and carries no regulatory scope. OPS (observability) is not applicable — this feature introduces no logging, metrics, or tracing surface beyond the exit-code convention and uniform envelope it already specifies. PERF is not applicable — no measurable NFR is allocated to entrypoint dispatch itself. UX is addressed by the usage/help flow (`cpt-frontx-flow-cli-invocation-help`).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | Runs the `frontx` executable with a command and arguments to drive a template or repository lifecycle operation, reads usage/help when the invocation is incomplete or unrecognized, and observes the exit code. |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: `cpt-frontx-adr-cli-internal-decomposition`, `cpt-frontx-adr-uniform-template-mechanism`, `cpt-frontx-adr-artifact-versioning-and-distribution`, `cpt-frontx-adr-cli-machine-readable-output`
- **Dependencies**: `cpt-frontx-feature-template-resolution`, `cpt-frontx-feature-template-manifest`, `cpt-frontx-feature-cli-scaffolding`, `cpt-frontx-feature-composed-provenance`, `cpt-frontx-feature-upgrade-changeset`

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: `cpt-frontx-usecase-scaffold-composed-project`

### Run a CLI Command

- [x] `p1` - **ID**: `cpt-frontx-flow-cli-invocation-run-command`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer runs the `frontx` executable with a recognized command and its arguments; the entrypoint parses the invocation, dispatches to the internal component that owns that command's behavior, and exits with the success code once the behavior completes.
- Developer or a calling program runs the executable with `--json`; the entrypoint dispatches identically and renders the dispatched behavior's outcome as the one uniform envelope on stdout instead of the human-readable form, with no interactive prompt reached at any point in the dispatch.

**Error Scenarios**:
- The dispatched behavior reports a user/input error (for example an unresolvable template reference or a refused conflicting assembly): the entrypoint surfaces the behavior's report and exits with the user-error code.
- The dispatched behavior fails unexpectedly: the entrypoint surfaces a failure and exits with the internal-error code.
- The stream a command's output is being written to fails partway through delivery: a reader that closed its end early (a broken pipe) is not the dispatched behavior's failure and does not change the exit code it computed; any other write failure is surfaced as the internal-error code instead, since the outcome already computed can no longer be trusted as fully delivered.
- In `--json` mode, the dispatched behavior would otherwise require an interactive decision the caller must make (for example `delete` confirming a removal): the entrypoint never prompts and never reads stdin; it renders the decision as `{"ok": false, "error": {"code": "CONFIRMATION_REQUIRED", ...}}` on stdout and exits with the user-error code, exactly as any other `ok: false` outcome.
- A path the dispatched behavior needed to read exists but could not honestly be inspected or opened — a FIFO, socket, device, directory, or dangling symlink standing where a regular file belongs; a component above it that is not a directory, so it was never reached at all; or a permission refusal — is surfaced through the ordinary envelope rather than as an internal failure: `CONTENT_CONFLICT` when the path names template or payload content, `PROJECT_INVALID` when it names the single project state document specifically, since every other way that one document can be unusable (malformed JSON, an unrecognized `formatVersion`, a shape violation) already reports that same code regardless of cause. Never surfaced as an internal failure with empty stdout under `--json`.

**Steps**:
1. [x] - `p1` - Developer runs the `frontx` executable with a command token, its arguments, and optionally the `--json` flag. - `inst-run-invoke`
2. [x] - `p1` - The entrypoint parses the invocation and selects the named command (`cpt-frontx-algo-cli-invocation-parse-dispatch`). - `inst-run-parse`
3. [x] - `p1` - **IF** the invocation names no recognized command or requests help - `inst-run-if-no-command`
   1. [x] - `p1` - **RETURN** usage output is produced through `cpt-frontx-flow-cli-invocation-help`; the run-command flow does not dispatch. - `inst-run-defer-help`
4. [x] - `p1` - The entrypoint dispatches the selected command to the internal component that owns its behavior, referenced by ID and not redefined here: - `inst-run-dispatch`
   - `install` → `cpt-frontx-flow-template-resolution-install`
   - `list` → `cpt-frontx-flow-template-resolution-list`
   - `validate` → `cpt-frontx-flow-template-manifest-validate-for-publication`; `validate --project` → `cpt-frontx-flow-composed-provenance-validate-project` (same command token, routed by the `--project` flag to the project-state document's own validation rather than the manifest's)
   - `register`, `unregister`, `ownership add|remove|list` → `cpt-frontx-feature-composed-provenance` (referenced at feature level: these dispatch to the project-state store that FEATURE owns per DESIGN §3.1 `ProjectProvenance`, with no distinct per-command flow fixed here)
   - `seed` → `cpt-frontx-flow-cli-scaffolding-seed-repository` (registers the batch's official default templates, then applies it through the identical mechanism `apply` uses — only against a new or empty project; not a second materialization path)
   - `assemble`, `apply`, `delete` → `cpt-frontx-feature-cli-scaffolding` (referenced at feature level: that feature's own batch-application and removal behavior, not redefined here)
   - `upgrade` → `cpt-frontx-flow-upgrade-changeset-review-approval`; `upgrade <templateName> --restore` → `cpt-frontx-flow-upgrade-changeset-restore` (a flag on `upgrade`, not a second command; no `new-origin` argument)
5. [x] - `p1` - **IF** `--json` was requested, the entrypoint suppresses every interactive prompt reachable from the dispatched behavior; a decision the behavior would otherwise ask about is instead read back from the behavior as structured data (for example `delete`'s `CONFIRMATION_REQUIRED`) rather than triggered as a blocking question (`cpt-frontx-adr-cli-machine-readable-output`, CLI-9). - `inst-run-json-suppress-prompt`
6. [x] - `p1` - The entrypoint maps the dispatched behavior's outcome to an exit code — success, user error, or internal error — identically whether or not `--json` was requested. - `inst-run-map-exit`
   1. [x] - `p1` - **IF** the dispatched behavior failed because a path it needed to read names the single project state document and could not honestly be inspected or opened - `inst-run-if-project-state-unreadable`
      1. [x] - `p1` - **RETURN** the user-error exit code with `PROJECT_INVALID` naming the document's path — the same code every other way that document can be unusable already reports, regardless of which reason broke it this time. - `inst-run-return-project-state-unreadable`
   2. [x] - `p1` - **IF** the dispatched behavior failed because any OTHER path it needed to read could not honestly be inspected or opened - `inst-run-if-content-unreadable`
      1. [x] - `p1` - **RETURN** the user-error exit code with `CONTENT_CONFLICT` naming the path (or, for a path never reached at all because a component above it is not a directory, naming that blocking component) — never an internal-error exit with no envelope for a fact this ordinary and actionable. - `inst-run-return-content-unreadable`
7. [x] - `p1` - **IF** `--json` was requested, the entrypoint renders the dispatched behavior's outcome as the single envelope value on stdout — `{"ok": true, "data": {...}}` or `{"ok": false, "error": {"code", "message", "details"}}` — as the only content on that stream; **ELSE** it renders the same outcome as the human-readable form. - `inst-run-render-output`
8. [x] - `p1` - **RETURN** the process exits with the mapped exit code only once the write of the rendered output reports its own completion — the exit never races ahead of a backpressured pipe or redirect regardless of the payload's size — after the dispatched behavior completes or reports its outcome. - `inst-run-return`
   1. [x] - `p1` - **IF** the stream's reader closes its end before that delivery completes (a broken pipe) - `inst-run-return-if-broken-pipe`
      1. [x] - `p1` - the process still exits with the exit code already mapped in step 6; the closed reader is the reader's own decision, not a failure of the dispatched behavior. - `inst-run-return-broken-pipe-tolerate`
   2. [x] - `p1` - **IF** the write fails for any other reason - `inst-run-return-if-write-failed`
      1. [x] - `p1` - the process exits with the internal-error code instead of the one mapped in step 6, since the outcome already computed can no longer be trusted as fully delivered. - `inst-run-return-write-failed-escalate`

### Show Usage or Handle an Unrecognized Command

- [x] `p1` - **ID**: `cpt-frontx-flow-cli-invocation-help`

**Actor**: `cpt-frontx-actor-project-developer`

**Success Scenarios**:
- Developer runs the executable with no command or an explicit help request; the entrypoint prints the usage summary of the available commands and exits with the success code.

**Error Scenarios**:
- Developer runs the executable with a command token that matches no known command: the entrypoint prints usage and exits with the user-error code; in `--json` mode, it instead emits `{"ok": false, "error": {"code": "INVALID_INPUT", ...}}` naming the unrecognized token, since no dispatched command's envelope exists yet to carry the failure.
- Developer runs `help` (or `-h`/`--help`) with additional, unrecognized trailing arguments (`frontx help extra`): the entrypoint refuses with `INVALID_INPUT` naming the unrecognized argument(s) — usage in the human-readable form, or the envelope in `--json` mode — and exits with the user-error code, never the success code an explicit help request otherwise reaches.

**Steps**:
1. [x] - `p1` - Developer runs the executable with no command, an explicit help request, or an unrecognized command token. - `inst-help-invoke`
2. [x] - `p1` - The entrypoint produces the usage summary listing the available commands (`cpt-frontx-algo-cli-invocation-parse-dispatch`). - `inst-help-usage`
3. [x] - `p1` - **IF** the invocation was an unrecognized command token - `inst-help-if-unrecognized`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT` naming the unrecognized token; usage is emitted in the human-readable form, or the envelope in `--json` mode, and the process exits with the user-error code - `inst-help-return-user-error`
4. [x] - `p1` - **IF** the invocation was an explicit help request whose trailing arguments cannot be parsed under `help`'s own accepts-no-arguments usage - `inst-help-if-unrecognized-args`
   1. [x] - `p1` - **RETURN** `INVALID_INPUT` naming the unrecognized argument(s); usage is emitted in the human-readable form, or the envelope in `--json` mode, and the process exits with the user-error code — never the success code an explicit help request otherwise reaches - `inst-help-return-unrecognized-args`
5. [x] - `p1` - **RETURN** for no command, or an explicit help request whose arguments parsed cleanly, usage is emitted and the process exits with the success code. - `inst-help-return-success`

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures called by actor flows above.

### Parse Invocation and Dispatch

- [x] `p1` - **ID**: `cpt-frontx-algo-cli-invocation-parse-dispatch`

**Input**: The process invocation arguments passed to the `frontx` executable, including an optional `--json` flag.

**Output**: The exit code the process returns, and either the human-readable output or the single JSON envelope value on stdout, after either dispatching to the owning command behavior or producing usage output.

**Steps**:
1. [x] - `p1` - Receive the process invocation arguments. - `inst-pd-receive`
2. [x] - `p1` - Parse the arguments into a leading command token, the remaining arguments for that command, and whether `--json` was requested. - `inst-pd-parse`
3. [x] - `p1` - **IF** no command token is present or an explicit help request is present - `inst-pd-if-help`
   1. [x] - `p1` - Produce the usage summary of the available commands and **RETURN** the success exit code. - `inst-pd-return-help`
4. [x] - `p1` - **IF** the command token matches no known command, or the arguments cannot be parsed under that command's accepted usage - `inst-pd-if-unknown`
   1. [x] - `p1` - Produce the usage summary (or, in `--json` mode, the envelope naming `INVALID_INPUT`) and **RETURN** the user-error exit code. - `inst-pd-return-unknown`
5. [x] - `p1` - Select the internal component that owns the named command's behavior and dispatch the remaining arguments to it — the command-to-behavior mapping references each behavior by ID: `install` → `cpt-frontx-flow-template-resolution-install`; `list` → `cpt-frontx-flow-template-resolution-list`; `update-local` → `cpt-frontx-flow-template-resolution-update-local`; `validate` → `cpt-frontx-flow-template-manifest-validate-for-publication` (or, with `--project`, `cpt-frontx-flow-composed-provenance-validate-project`); `register`, `unregister`, `ownership add|remove|list` → `cpt-frontx-feature-composed-provenance` at feature level (project-state store consumer, DESIGN §3.1 `ProjectProvenance`); `seed` → `cpt-frontx-flow-cli-scaffolding-seed-repository` (registers the batch's official default templates then applies it, only against a new or empty project; not a second materialization path alongside `apply`); `assemble`, `apply`, `delete` → `cpt-frontx-feature-cli-scaffolding` at feature level; `upgrade` → `cpt-frontx-flow-upgrade-changeset-review-approval`; `upgrade <templateName> --restore` → `cpt-frontx-flow-upgrade-changeset-restore` (no `new-origin` argument) — and adds no second dispatch path. - `inst-pd-dispatch`
6. [x] - `p1` - **IF** `--json` was requested, instruct the dispatched behavior to suppress every interactive prompt and to report any decision it would otherwise ask about as structured data instead (`cpt-frontx-adr-cli-machine-readable-output`, CLI-9). - `inst-pd-json-mode`
7. [x] - `p1` - Map the dispatched behavior's outcome to an exit code: success when it completes, user error when it reports a user/input failure or a decision the caller must make (an `ok: false` envelope in `--json` mode) — including a path it needed to read that could not honestly be inspected or opened, reported as `PROJECT_INVALID` when that path is the single project state document and `CONTENT_CONFLICT` for any other content (`inst-run-if-project-state-unreadable` / `inst-run-if-content-unreadable`) — internal error when it fails unexpectedly. - `inst-pd-map-outcome`
8. [x] - `p1` - **IF** `--json` was requested, render the outcome as the single envelope value on stdout (`{"ok": true, "data": {...}}` or `{"ok": false, "error": {"code", "message", "details"}}`), with no other content on that stream; **ELSE** render the human-readable form. - `inst-pd-render`
9. [x] - `p1` - **RETURN** the mapped exit code. - `inst-pd-return-exit`

## 4. States (CDSL)

### Invocation Run State Machine

- [x] `p2` - **ID**: `cpt-frontx-state-cli-invocation-run`

**States**: REQUESTED, PARSED, DISPATCHED, SUCCEEDED, USER_ERROR, INTERNAL_ERROR

**Initial State**: REQUESTED

**Transitions**:
1. [x] - `p1` - **FROM** REQUESTED **TO** PARSED **WHEN** the invocation arguments parse to a recognized command token and its arguments. - `inst-st-req-parsed`
2. [x] - `p1` - **FROM** REQUESTED **TO** SUCCEEDED **WHEN** no command is present or an explicit help request is present and usage is emitted. - `inst-st-req-help-success`
3. [x] - `p1` - **FROM** REQUESTED **TO** USER_ERROR **WHEN** the command token matches no known command and usage is emitted. - `inst-st-req-unknown`
4. [x] - `p1` - **FROM** PARSED **TO** DISPATCHED **WHEN** the selected command is dispatched to the internal component that owns its behavior. - `inst-st-parsed-dispatched`
5. [x] - `p1` - **FROM** DISPATCHED **TO** SUCCEEDED **WHEN** the dispatched behavior completes and the outcome maps to the success exit code. - `inst-st-dispatched-success`
6. [x] - `p1` - **FROM** DISPATCHED **TO** USER_ERROR **WHEN** the dispatched behavior reports a user/input failure and the outcome maps to the user-error exit code. - `inst-st-dispatched-user-error`
7. [x] - `p1` - **FROM** DISPATCHED **TO** INTERNAL_ERROR **WHEN** the dispatched behavior fails unexpectedly and the outcome maps to the internal-error exit code. - `inst-st-dispatched-internal-error`
8. [x] - `p1` - **FROM** REQUESTED **TO** USER_ERROR **WHEN** an explicit help request carries trailing arguments that cannot be parsed under `help`'s own accepts-no-arguments usage, and the refusal is emitted. Distinct from transition 3 above, whose **WHEN** clause is specifically an unrecognized COMMAND token — `help` is itself a recognized token here, so reusing that transition for this case would make its own condition false the moment it fired. - `inst-st-req-help-user-error`

## 5. Definitions of Done

### Executable Entrypoint Dispatches Every Command

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-invocation-executable-entrypoint`

The system **MUST** provide a single `frontx` executable entrypoint that parses the process invocation and dispatches `frontx <command> [args]` to the one internal component that owns that command's behavior — referenced by ID and not redefined — across the full command surface (`install`, `register`, `unregister`, `list`, `update-local`, `validate`, `assemble`, `apply`, `seed`, `delete`, `upgrade`, `ownership add|remove|list`, per DESIGN §3.2 "CLI"), adding no second dispatch path (`target`). Every feature owning a dispatched command's behavior is now delivered (`cpt-frontx-featstatus-composed-provenance`, `cpt-frontx-featstatus-cli-scaffolding`, `cpt-frontx-featstatus-upgrade-changeset`, `cpt-frontx-featstatus-template-resolution`, `cpt-frontx-featstatus-template-manifest`), so this DoD is no longer limited to being exercised against a stub: `register`, `unregister`, `ownership add|remove|list`, `assemble`, `apply`, `seed`, `delete` and `upgrade` were each driven through this entrypoint against a real project on a real filesystem.

**Implements**:
- `cpt-frontx-flow-cli-invocation-run-command`
- `cpt-frontx-algo-cli-invocation-parse-dispatch`
- `cpt-frontx-state-cli-invocation-run`

**Constraints**: (none owned by this feature)

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`

### Usage and Help Output

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-invocation-usage-help`

The system **MUST** emit a usage summary of the available commands when the executable is run with no command, with an explicit help request, or with an unrecognized command token, dispatching no command in those cases; an unrecognized command token or an invocation whose arguments cannot be parsed under the dispatcher's own usage **MUST** be refused with `INVALID_INPUT` — as the human-readable usage line, or, in `--json` mode, as `{"ok": false, "error": {"code": "INVALID_INPUT", ...}}`, since no dispatched command's envelope exists yet at that point to carry the failure (`target`).

**Implements**:
- `cpt-frontx-flow-cli-invocation-help`
- `cpt-frontx-algo-cli-invocation-parse-dispatch`

**Constraints**: (none owned by this feature)

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`

### Exit-Code Convention

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-invocation-exit-codes`

The system **MUST** return a distinct process exit code for each outcome class — success, user error, and internal error — applied consistently across every dispatched command and across the usage/help paths (`target`).

**Implements**:
- `cpt-frontx-flow-cli-invocation-run-command`
- `cpt-frontx-algo-cli-invocation-parse-dispatch`
- `cpt-frontx-state-cli-invocation-run`

**Constraints**: (none owned by this feature)

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`

### Uniform Envelope Dispatch in `--json` Mode

- [x] `p1` - **ID**: `cpt-frontx-dod-cli-invocation-json-envelope-dispatch`

The system **MUST**, when a dispatched command is invoked with `--json`, render that command's outcome as the single JSON envelope value on stdout — `{"ok": true, "data": {...}}` on success or `{"ok": false, "error": {"code", "message", "details"}}` on failure or a decision the caller must make — as the only content on that stream, per the one envelope and code vocabulary `cpt-frontx-adr-cli-machine-readable-output` (CLI-9) fixes for the whole command surface; this feature does not redefine the envelope or any command's `data`/`error.code` values, which remain owned by the dispatched command's own feature. Every `error.code` reaching this envelope — whether produced by a dispatched command's own feature or by this feature's own dispatcher-level refusal (`INVALID_INPUT`) — **MUST** be drawn from that one shared vocabulary; this feature invents no code of its own. The process **MUST NOT** exit before the write of the envelope reports its own completion, whatever its size and whatever stdout is connected to — a terminal, a redirected file, or a piped reader — since a caller parsing the stream has no way to tell a truncated envelope from a malformed one; a write failure that completion reports (other than a closed reader) **MUST** escalate the exit code to the internal-error code. This guarantee is bounded by what that completion can report: a destination that accepts a short write without surfacing it as a failure — a file capped by a filesystem resource limit, for instance — never reaches the write callback as an error, so a truncation of that kind is not observable or escalated here. The system **MUST NOT** allow any dispatched command to read from stdin or block on an interactive prompt while `--json` is active, and **MUST** map an `ok: false` outcome — including a destructive operation's `CONFIRMATION_REQUIRED` in place of a blocking confirmation question — to the user-error exit code exactly as any other user/input failure (`target`).

**Implements**:
- `cpt-frontx-flow-cli-invocation-run-command`
- `cpt-frontx-algo-cli-invocation-parse-dispatch`

**Constraints**: `cpt-frontx-constraint-cli-machine-envelope`

**Touches**:
- Interface: `cli`
- Component: `cpt-frontx-component-cli`

## 6. Acceptance Criteria

- [x] `architecture/features/cli-invocation/FEATURE.md` exists with all template sections in order.
- [x] Running the `frontx` executable with a recognized command dispatches to the internal component that owns that command's behavior through a single dispatch path. (`target`) — every command-owning feature this dispatch reaches is now delivered, so it is verifiable end to end, and was: each command in the surface was driven against a real project
- [x] Running the executable with no command or an explicit help request emits the usage summary and exits with the success code. (`target`)
- [x] Running the executable with an unrecognized command token emits usage (or, in `--json` mode, `{"ok": false, "error": {"code": "INVALID_INPUT", ...}}`) and exits with the user-error code. (`target`)
- [x] Running `help` (or `-h`/`--help`) with additional, unrecognized trailing arguments is refused with `INVALID_INPUT` and the user-error exit code, never the success code a clean help request reaches. (`target`)
- [x] A dispatched behavior's user/input failure exits with the user-error code and an unexpected failure exits with the internal-error code. (`target`) — every dispatched command feature is now delivered, and the mapping is covered by the dispatcher's own tests, including an unexpected failure exiting with the internal-error code
- [x] A path a dispatched behavior needed to read that could not honestly be inspected or opened — regardless of which of the three ways that can happen — exits with the user-error code and a single envelope naming `PROJECT_INVALID` (the project state document) or `CONTENT_CONFLICT` (any other content), never the internal-error code with no envelope at all. (`target`)
- [x] A large `--json` payload piped into a reader that stops reading before EOF (for example `| head`) does not crash the process or print an unhandled-error stack, and the process exits with the exit code the dispatched behavior computed. (`target`)
- [x] The same tolerance holds for every write this entrypoint makes to stdout, not only the `--json` envelope: a reader that stops reading before EOF during an interactive listing or prompt (`delete`'s confirmation, `upgrade`'s plan review) does not crash the process or print an unhandled-error stack either. (`target`)
- [x] The write-completion guarantee in `cpt-frontx-dod-cli-invocation-json-envelope-dispatch` is bounded by what the write's own completion callback reports: a destination that silently accepts a short write without reporting it as a failure (a file capped by a filesystem resource limit, for instance) is not detected or escalated, and the artifact states this boundary rather than an unconditional guarantee. (`target`)
- [x] No command behavior is redefined in this feature; each dispatched behavior is referenced by its canonical ID. (`target`)
- [x] The command surface is part of `cpt-frontx-interface-cli`; an incompatible change to it requires a major version bump per `cpt-frontx-adr-artifact-versioning-and-distribution`. (`target`)
- [x] The command surface dispatched matches DESIGN §3.2 "CLI": `install`, `register`, `unregister`, `list`, `update-local`, `validate` (including `validate --project`), `assemble`, `apply`, `seed`, `delete`, `upgrade` (including `upgrade --restore`, a flag rather than a second command), `ownership add|remove|list`. (`target`) — the surface named here matches DESIGN, and every command-owning feature it dispatches to is delivered; this AC does not assert those commands are ready, only that this feature's own dispatch table is complete
- [x] `seed` dispatches to `cpt-frontx-flow-cli-scaffolding-seed-repository` — registering the batch's official default templates before applying it, only against a new or empty project — never to a second materialization path alongside `apply`. (`target`) — `cpt-frontx-feature-cli-scaffolding` is delivered, and the single materialization path is the one `runApplyPipeline` provides to both commands
- [x] Every code this feature's own dispatcher-level refusals emit (`INVALID_INPUT`) is drawn from the shared error-code vocabulary; this feature invents no code of its own. (`target`)
- [x] Invoking any dispatched command with `--json` renders that command's outcome as the single uniform envelope value on stdout, with no other content on that stream. (`target`)
- [x] No dispatched command reads from stdin or blocks on an interactive prompt while `--json` is active; a destructive operation's confirmation is rendered as `{"ok": false, "error": {"code": "CONFIRMATION_REQUIRED", ...}}` instead. (`target`)
- [x] An `ok: false` envelope in `--json` mode, including `CONFIRMATION_REQUIRED`, maps to the same user-error exit code as any other user/input failure. (`target`)
- [x] `cfs --json validate --artifact packages/cli/architecture/features/cli-invocation/FEATURE.md --skip-code` returns PASS.
- [x] `cfs --json validate-toc packages/cli/architecture/features/cli-invocation/FEATURE.md` returns PASS.
