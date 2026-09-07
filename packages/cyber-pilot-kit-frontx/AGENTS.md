---
description: "Agent navigation rules for FrontX ecosystem package boundaries, CLI, and MFEs, and the standing rules for how work in a FrontX project is searched for, built, and verified."
---

# FrontX AI Tooling Kit — Agent Navigation Rules

## Package Boundaries (always enforce)

- Ecosystem packages: `mfes`, `gts-plugin`, `api`, `cli`, `cyber-pilot-kit-frontx`
- Template packages: the active template (external, source-spec-resolved) and its sub-packages
- Never add ecosystem→template imports; never add template→ecosystem src-level coupling

## When running a command

- macOS ships no `timeout` command, so a call wrapped in `timeout <seconds> ...` dies with "command not found" and reads as a broken tool rather than a missing binary. Bound a slow call with the timeout parameter the tool issuing it already carries, never with a shell wrapper

## When searching the filesystem

- Scope every search to the tree being worked in: the project directory, the repository, or the single package under change. Never search from `/`, from the home directory, or from any parent of the working tree
- An unscoped search is not thorough, it is a scan of everything the machine holds: it costs a full filesystem walk and surfaces nothing the project tree does not already carry
- A path that is not where it should be is absent. Widen the search inside the tree, or report the absence; widening past the tree answers a different question than the one asked

## When adding code to ecosystem packages

- Check DESIGN.md for the relevant component boundary constraint (MFES-*, API-*, CLI-*, KIT-*)
- Run `npm run build` and `npm run test` inside the package before reporting done
- All resource ids in kit manifests MUST begin with `frontx_` (KIT-1)

## When implementing an action a user invokes

- The action must let a user reach the outcome its own label names, carrying data they supplied. A handler that produces the payload itself - a constant, an empty field, a record nobody entered - is a stub: the control is there and the outcome the user came for is not reachable
- Where an intent names an action but says nothing about how the user's data gets in, that gap is what to report. Filling it with a fixed value satisfies the wording of the intent and defeats the action

## When verifying a user interface

- Judge the rendered pixels, not the tree behind them. A DOM snapshot proves an element exists and a click proves it can be operated; neither proves a person can see it. Every interactive element must be visually distinguishable while at rest, under every value of every UI dimension the interface varies along - one that emerges only under hover or focus fails. The archetype is a destructive action wearing a ghost or text-only style: a delete control that renders as bare text is at rest indistinguishable from a caption, and it is the one control a person must be able to tell apart before they touch it. Shipped in a screenshot that was looked at and passed, it is the failure this rule exists to catch
- Where an interface varies along a UI dimension, the state it opens in is one value of that dimension, never the set - and on a browser attached to an existing profile it is not even a value this run chose, it is whatever that profile last persisted. A pass that captured only the value it happened to find has seen a fraction of the surface, and a run that reported a verified interface while a whole value stayed unvisited claimed a coverage it never had
- A screenshot is evidence only once it has been examined. Take one at every point the run declared it would visit, under every value it declared it would walk, in the states that carry the meaning - a form before it is submitted, a list before and after it changes - with no debug or development overlay across the surface, and read each for what a structural check cannot see: elements invisible or cramped, chrome over content, layers colliding. Verification is not complete while a captured screenshot is unexamined
- A judgement on a screenshot names what it looked at: which elements, in which state, under which value. "Looks correct" records a feeling and conceals whatever went unexamined, and a cramped button survived two consecutive runs behind judgements phrased that way
- A verification reports its coverage, not its verdict. A value that never became active is a legitimate outcome and belongs in the report as one, and so is a dimension the run was never asked to walk - reported as not exercised, which says what the run did not do rather than what the interface does not have. A closing summary phrased so that no reader can tell either apart from full coverage is how two consecutive runs shipped one value as a verified interface. What the coverage list has to contain, and where it is produced, is stated by the procedure the run followed
- A workaround is a finding. If confirming something took piercing a shadow root, evaluating script, or reading markup the interface does not display, then the user cannot perceive it either. Record it as a defect - a check that needed the bypass did not pass
- The command that runs the headless browser is `npx --yes agent-browser`, and every later call repeats that exact prefix. The bare binary is not on `PATH`, so a call that drops the prefix fails as a command that does not exist, and six consecutive runs each rediscovered that
- How a browser is reached, which UI dimension a run walks and how the run is driven between captures is procedure, and belongs in the numbered steps of the capability being run rather than here. Three consecutive runs read these rules as prose and produced none of it; the same runs executed every check that reached them as a numbered step. A rule of this kind that has to be obeyed is written where the steps are

## When working with the CLI

- CLI resolves templates by source-spec at runtime; it bundles no template content
- Source-spec format: `host:owner/repo[//subtree]@ref` — the optional `//subtree` addresses a template occupying a subdirectory of a repository
- Supported commands are `install`, `list`, `update-local`, `validate`, `assemble`, `seed`, `apply`, `upgrade`, `register`, `unregister`, `ownership`, `delete`, and `help`
- `register <origin> [--replace]` pins an origin under the current project's single state document, `.frontx/project.json` (`templates[name]`, keyed by the identity the origin's own manifest declares); `apply --input <batch-json>` and `assemble --input <batch-json>` (a stateless preview; `apply` never trusts a prior `assemble`) both take the identical `{"templates": {"<name>": ["<target>", ...]}}` batch shape and act only on names already registered; `seed <dir> --input <batch-json>` does the same into a new or empty repository. A project is established when some `templates[name]` entry carries a non-empty `targets[]` in `.frontx/project.json`
- `upgrade <templateName> <new-origin> [--yes] [--json]` moves a registered template to a new origin; `upgrade <templateName> --restore [--yes] [--json]` moves it back to its immediately preceding origin. `unregister <name>` refuses a name that still carries an applied target. `ownership add|remove|list` marks or lists paths the project owns outside any applied template's own ground. `delete <target> [--json] [--yes] [--dry-run]` removes an applied template target
- In `--json` mode a destructive command (`delete`, `upgrade`) never prompts and never reads stdin: without `--yes` it returns `CONFIRMATION_REQUIRED` carrying the computed plan instead of acting, and must be re-issued with `--yes` to proceed. Every command emits exactly one JSON envelope in `--json` mode
- `list --json` is the machine-readable form: `{"ok":true,"data":{"defaults":[...],"registered":[...],"installed":[...]}}` — `defaults` and `installed` entries carry `name`, `version`, `description` (`installed` entries may carry `manifestUnreadable: true` instead, when the stored manifest can no longer be read); `registered` entries carry `name`, `origin`, `version`, `targets`, and `description` when it can still be read back
- `seed` only works inside this monorepo's own checkout: the CLI's official defaults are local `path:` origins resolvable only against this repository. Do not point a project elsewhere at `seed` as the way to start it - `register` + `apply` is the path that works outside this checkout

## When a request is to create or extend a project

- Route it first — the routing section of this kit's `SKILL.md` maps each kind of request (create, apply a held reference, add a unit, upgrade, validate) to the capability or command that serves it. Read the routing table there; it is the only copy, and restating it here is how the two fall out of step
- **This kit describes no procedure for adding a unit inside ground an applied template owns** — no MFE package, no screen. That template owns its scaffold, its naming and its registration steps, and states them in the skills it activated under `.frontx/ai/<template-identity>/`. Writing such a procedure here would put solution knowledge in the solution-agnostic base and go stale the moment the template changed

## When working with MFEs

- MFEs register through the abstract `MfeRegistry` from `@gears-frontx/mfes`, obtained via `createMfeRegistryFactory().build({ typeSystem })`
- Extension domains control which MFEs may mount (`cpt-frontx-component-extension-domain-governance`)
- Isolation is via blob-URL sandboxing (`cpt-frontx-component-mfe-isolation`)
