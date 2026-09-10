# Feature: AI-Driven Project Scaffolding from Intent


<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
  - [1.5 Agent Entry-Point Surface](#15-agent-entry-point-surface)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Scaffold a Project from a Stated Intent](#scaffold-a-project-from-a-stated-intent)
  - [Route a FrontX Request to the Capability That Serves It](#route-a-frontx-request-to-the-capability-that-serves-it)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Select the Application Set from Intent and Declared Descriptions](#select-the-application-set-from-intent-and-declared-descriptions)
  - [Report the Applied Set from Project Provenance](#report-the-applied-set-from-project-provenance)
- [4. States (CDSL)](#4-states-cdsl)
  - [Application Plan Lifecycle](#application-plan-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Declared Agent Entry Points for Routing and Scaffolding](#declared-agent-entry-points-for-routing-and-scaffolding)
  - [Selection Is Description-Matched over the Local Inventory Only](#selection-is-description-matched-over-the-local-inventory-only)
  - [The Kit Drives Scaffolding Only Through the Command Surface](#the-kit-drives-scaffolding-only-through-the-command-surface)
  - [Multiplicity Is Description-Driven](#multiplicity-is-description-driven)
  - [The Applied Set Is Reported from Provenance](#the-applied-set-is-reported-from-provenance)
  - [The Ecosystem Is Enabled for Intent-Driven Scaffolding](#the-ecosystem-is-enabled-for-intent-driven-scaffolding)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-frontx-featstatus-ai-project-scaffolding`
## 1. Feature Context

- [x] `p2` - `cpt-frontx-feature-ai-project-scaffolding`

### 1.1 Overview

Closes the selection gap between a developer's stated intent and the template reference the CLI requires: the CLI's apply commands take a template reference the caller must already know, and nothing helps the caller decide which installed template answers "a project with a main menu and two screens". This feature adds two declared agent entry points to the base AI kit - a top-level routing entry that recognizes which FrontX capability a request belongs to, and a scaffolding entry that turns a stated project intent into an application plan, executes it, and then realizes the units the intent names inside the applied ground. Selection matches the intent against the descriptions installed templates declare in their manifests (`cpt-frontx-feature-template-manifest`), over the local template inventory only. The plan is then executed strictly by invoking the installed `frontx` executable: one explicit, target-keyed batch naming the template that establishes the project together with every further distinct template and the target each applies to, materialized through a single `apply` call (optionally preceded by a stateless `assemble` preview), never through a series of separate per-template invocations (`cpt-frontx-adr-composed-template-resolution`). After that, the applied set is reported back to the developer from the project's single state document, `.frontx/project.json` (`cpt-frontx-adr-project-provenance-record`). Multiplicity is description-driven, not a universal cap of one application per identity: a template whose description declares an apply-per-unit discipline (for example, `template-mfe`'s "apply once per page") is applied once per unit the intent names, each unit its own target attributed to that one template identity in the composed batch (`cpt-frontx-adr-composed-template-resolution`). A template whose description declares an apply-once-then-import discipline gets exactly one target, and per-unit multiplicity within that single applied ground is not a further application: the flow realizes it by driving, once per unit, the extension skills that template activates in the project (`cpt-frontx-feature-template-ai-extensions`), and then placing the content the intent states for each unit into the unit that skill created. What the developer receives is therefore a project that realizes the stated intent, not a plan for one. An intent that names **only** units inside ground an applied template already holds, with no template to apply, is not this flow's case at all: the routing entry point sends it straight to that template's own skills (`cpt-frontx-flow-ai-project-scaffolding-route-request`), because there is nothing here to select, plan, or apply. All CDSL behavior is `target` (GREENFIELD - grounded in `cpt-frontx-adr-template-manifest-contract`, `cpt-frontx-adr-solution-ai-content-placement`, `cpt-frontx-adr-ai-driven-upgrade-orchestration`, `cpt-frontx-adr-composed-template-resolution`, `cpt-frontx-adr-project-provenance-record`, and DESIGN §3.4).

**Description is advisory input, not executable instruction.** The manifest `description` a Template Developer writes may originate from a third party, so this feature treats it strictly as advisory text for intent-matching (`cpt-frontx-algo-ai-project-scaffolding-select-templates`) and nothing more. No mechanical gate this feature depends on - ownership-boundary computation, conflict prevention, or registration invariants, all owned by the `cli` package - reads or depends on a description's content; each of those gates runs identically no matter what a description says. No code path in this feature, or in the CLI it drives, executes a description's text, parses it as a directive, or otherwise interprets it as an instruction. A misleading or manipulative description can at most cause the wrong template to be selected - a mismatch the developer sees and can reject at the presented application plan (`inst-sfi-present-plan`) before anything is applied - never a bypass of a mechanical safeguard. This risk is accepted by design, not left open.

### 1.2 Purpose

This feature realizes the selection mechanism the existing decisions already fix between them: `cpt-frontx-adr-template-manifest-contract` makes the manifest's declared description the statement a caller chooses a template by, and `cpt-frontx-adr-solution-ai-content-placement` requires a base capability that acts on solutions to read that declaration at invocation time rather than name templates. A template therefore declares what it is in prose the base kit matches an intent against, and the kit reads the installed set over the CLI command surface rather than classifying templates (`cpt-frontx-adr-uniform-template-mechanism` leaves no template kinds to match against) or carrying a built-in map of template names (which `cpt-frontx-adr-solution-ai-content-placement` forbids in the base kit). It extends the agent-facing capability set required by `cpt-frontx-fr-ai-frontx-skills` with the intent-to-application-plan capability, and delivers the AI-guided leg of `cpt-frontx-usecase-ai-driven-project-scaffolding` alongside the direct CLI path, never in place of it.

The process boundary is the same one `cpt-frontx-adr-ai-driven-upgrade-orchestration` established for upgrades and DESIGN §3.4 records as the kit's only coordination edge with the CLI: the kit drives the built `frontx` executable's command surface and neither links `@gears-frontx/cli` nor reproduces any part of what its commands do. Applying this to the assembler as well as the change-set engine is what `cpt-frontx-constraint-kit-orchestrates-not-reimplements` requires; the reporting leg reads the CLI-written project state document - `.frontx/project.json`, the `ProjectProvenance` entity of DESIGN §3.1 - through the filesystem handoff DESIGN §3.4 already sanctions.

**Requirements**: `cpt-frontx-fr-ai-frontx-skills`, `cpt-frontx-fr-ai-agent-skill-resources`

**Principles**: `cpt-frontx-principle-template-agnostic-tooling` (cross-package, defined in the CLI package's own DESIGN) - the entry points name no template and gain their knowledge of the installed set at invocation time, so a newly installed conforming template becomes selectable without a kit change.

**Components**: `cpt-frontx-component-ai-base-kit` (the internal sub-component these entry points ship in), within the package anchor `cpt-frontx-component-ai-tooling-kit`

**Applicability** (Often-N/A domains for an AI Tooling feature, per the FEATURE checklist's Applicability Context): PERF is addressed only insofar as selection reads the same locally installed template inventory `cpt-frontx-cyber-pilot-kit-frontx-nfr-resource-scale` bounds; this feature allocates no separate latency budget of its own. SEC and COMPL are not applicable — selection reads only manifest-declared descriptions and drives the CLI's own gated command surface, introducing no authentication, authorization, or regulatory surface of its own (§1.1, "Description is advisory input, not executable instruction"). OPS (observability) is not applicable — no logging, metrics, or tracing surface is introduced beyond the application plan and reporting this feature already presents. UX is addressed by the presented application plan (`inst-sfi-present-plan`) and the applied set reported back to the developer (§1.2).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-actor-project-developer` | States the project intent in natural language, chooses between candidates when selection is ambiguous, and receives the application plan, the applied set, the units realized inside the applied ground, and the residual work the applied templates and their extension skills do not cover |
| `cpt-frontx-actor-ai-agent-host` | Surfaces the kit's declared `skill` entry points from their applicability metadata and invokes the routing and scaffolding entry points on the developer's behalf |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: `cpt-frontx-adr-template-manifest-contract`, `cpt-frontx-adr-solution-ai-content-placement`, `cpt-frontx-adr-ai-driven-upgrade-orchestration`, `cpt-frontx-adr-ai-tooling-framework-packaging`
- **Dependencies**:
  - `cpt-frontx-feature-ai-kit-packaging` (F15) - the base kit these entry points ship inside, and the manifest-declaration rules they are declared under
  - `cpt-frontx-feature-template-manifest` (F11) - owns the declared description this feature matches an intent against
  - `cpt-frontx-feature-template-resolution` (F10) - owns the installed-template inventory and the listing command this feature reads the selectable set from
  - `cpt-frontx-feature-cli-scaffolding` (F12) - owns the seed and add behavior this feature invokes without reimplementing
  - `cpt-frontx-feature-composed-provenance` (F13) - owns the schema of the project's single state document, `.frontx/project.json` (DESIGN §3.1 `ProjectProvenance`, per `cpt-frontx-adr-project-provenance-record`), from whose `templates[name].targets` this feature reads the applied set it reports back
  - `cpt-frontx-feature-template-ai-extensions` (F16) - discovers and activates the applied templates' own extension skills, which this flow then drives once per unit to carry per-unit work inside an applied template's own ground

### 1.5 Agent Entry-Point Surface

This is the concrete declared shape of the two entry points, owned by this feature; the rules they satisfy are owned by `cpt-frontx-feature-ai-kit-packaging` (KIT-1 prefixing, KIT-4 declared-kind and applicability metadata) and the solution-agnostic admission check by `cpt-frontx-adr-solution-ai-content-placement`.

**Routing entry point** - the kit's existing top-level `skill` resource, whose applicability metadata already covers ecosystem-scoped work, gains the routing responsibility. It is extended, not duplicated: an entry point whose only content is a pointer to one other entry point would add a hop and no capability, and a second resource claiming the same top-level name is not declarable. Its document gains a delimited section that states, for each kind of FrontX request, which capability serves it - including that a request to create a new project is served by the scaffolding entry point below.

**Scaffolding entry point** - a new `skill` resource declared in `.cf-studio-kit.toml` with a `frontx_`-prefixed identifier, `kind = "skill"`, `public = true`, a `source` and `install_path` that address a document nested under a directory the kit ships, `type = "file"`, and non-empty applicability metadata in its own document frontmatter stating that it applies when a developer wants a new FrontX project created from a stated intent. Neither the resource identifier nor any manifest field names a solution, a framework, or a concrete template, because the manifest's identifier and description fields are scanned against the solution-term list; and neither entry-point document names a concrete template, because resource bodies are scanned against the specific-template-name list. The declared `source` must additionally be covered by the package's published file set, or the resource is declared, validated in the monorepo, and absent from the published package.

Both entry points are documents, not compiled modules: the scaffolding flow is a sequence of one-shot command invocations with no mid-stream protocol to hold open, so it needs no in-kit module at the process boundary and adds none. The realization leg is documents for the same reason and a stronger one: it is carried out by following the instructions an applied template's own activated extension skill states. The base kit contributes the sequencing - which unit, in which order, how many - and the intent-specific content that only the stated intent can supply, and contributes none of the structure, naming, identifiers, or registration, every one of which the template's own skill states. KIT-3's invariant - that the framework holds no code path materializing or modifying a project file - therefore stands unweakened, because the framework ships no such code path on either leg.

## 2. Actor Flows (CDSL)

User-facing interactions that start with an actor and describe the end-to-end flow of a use case. Each flow has a triggering actor and shows how the system responds to actor actions.

**Use cases**: `cpt-frontx-usecase-ai-driven-project-scaffolding`

### Scaffold a Project from a Stated Intent

- [ ] `p1` - **ID**: `cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`

**Actor**: `cpt-frontx-actor-project-developer`

**Realizes**: `cpt-frontx-seq-ai-project-scaffolding-from-intent`

**Success Scenarios**:
- Developer states a project intent and a target directory; the scaffolding entry point reads the installed inventory, matches the intent against the templates' declared descriptions, presents the application plan, applies the selected templates through the `frontx` executable, reports the applied set from provenance, realizes each unit the intent names inside the applied ground through the applied templates' activated extension skills, places the content the intent states into each realized unit, and names whatever residual work is left over.
- Developer states an intent naming several units of one kind whose owning template's description declares an apply-once-then-import discipline - a project with a stated number of screens - and receives a project holding one realized unit per stated screen, each carrying that screen's stated content, from a single application of the template whose ground those units live in.
- Developer states an intent naming several units of one kind whose owning template's description declares an apply-per-unit discipline - a project with a stated number of microfrontends - and receives a project holding one application of that template per stated unit, each at its own target, all attributed to the same template identity in one composed batch.
- Developer states an intent against a directory that already holds applied templates; the seed step is omitted and only the further distinct templates are added.

**Error Scenarios**:
- Developer declines the presented application plan: the entry point returns the declined plan and invokes no `frontx` command that writes files; the target directory and its project state are left exactly as they were.
- The target directory holds content but its `.frontx/project.json` records no applied template: this is existing work the flow did not start, so no template is planned to establish the project against it. The developer is told what was found and offered either a fresh directory to establish a project in or a batch that only extends the directory as it stands - qualified by what that batch does with the content found there, since it writes only the ground the applied template declares and refuses, naming the paths, where content already stands on that ground.
- No template is installed in the local inventory: the developer is told that selection has nothing to choose from and how to install a template, and no command that writes files is invoked.
- No installed template's declared description matches the intent: the developer is told which templates are installed and which were not considered — because their stored manifest no longer satisfies the manifest's required-description contract, having been corrupted or altered after installation (a legacy manifest is refused outright at install and never enters local inventory in the first place) — and is asked to restate the intent or install a template that answers it; nothing is guessed and no files are written.
- Two or more installed templates match the project-establishing part of the intent indistinguishably: the developer is asked to choose between the named candidates and their declared descriptions before anything is applied.
- Two or more installed templates match one supplemental part of the intent indistinguishably: the same choice is put to the developer, naming the part and each tied candidate, because the identity applied is the one the project then carries in provenance.
- The target directory holds no applied template and nothing installed claims to establish a project, though something matches a supplemental part: the developer is told which supplemental candidates matched and that none of them lays the ground the others would contribute to, and is asked to install a template that establishes a project or restate the intent; no files are written.
- An installed template's stored manifest no longer satisfies the manifest contract — corrupted or altered after installation, since a legacy manifest is refused outright at install and never enters local inventory in the first place: it is reported as a repairable installation with reinstallation as the remedy, never treated as a valid candidate with nothing to match against.
- A selected template's target is already recorded under that identity in the target directory's `.frontx/project.json`: that target is dropped from the plan and reported as already applied, an idempotent no-op by target rather than by identity — a template whose description declares an apply-per-unit discipline may still gain a further target for a further unit the intent names, because what repeats is the target, not the identity.
- An invoked `frontx` command exits non-zero: the flow stops at that command, relays the CLI's own reported reason without reinterpreting it, invokes no further command, and reports which templates were applied before the failure.
- The target directory's `.frontx/project.json` cannot be read after a command reported success: the developer is told the applied set could not be confirmed and is pointed at the target directory, rather than being shown an applied set that was not read. **The flow stops there and realizes nothing** - realization needs to know which templates are applied, and to read their bundles, so with the applied set unconfirmed it would be building on a guess.
- A unit the intent names falls inside an applied template's ground but no activated extension skill covers that ground: the unit is reported as residual work naming the ground it falls in, and nothing is written into that ground, because the template that owns the ground has declared no way to add a unit to it.
- Realizing a unit fails: the flow stops at that unit, relays the failure's own reported reason without reinterpreting it, names the units realized before it, and realizes no further unit and attempts no correction retry.
- The verification an applied template's extension skill declares fails after the units were created: the flow reports the project as applied and realized but not verified, relays that verification's own output unreinterpreted, and does not report scaffolding complete - a failing type-check or lint is the difference between a project that was written and one that works, and no correction retry is attempted for it either.

**Steps**:
1. [ ] - `p1` - Developer states the intent for a project and the target directory, and the agent host invokes the scaffolding entry point. - `inst-sfi-invoke`
2. [ ] - `p1` - The entry point obtains the installed-template inventory - each entry's identity, pinned reference, declared description, and the marker the listing sets when an entry's stored manifest no longer satisfies the manifest contract (`cpt-frontx-feature-template-resolution`) - by invoking the CLI's machine-readable listing command through the `frontx` executable's command surface, never by reading the CLI's inventory storage and never from any remote source. The marker is carried, not discarded: without it, a damaged installation — a legacy manifest is refused outright at install and never reaches local inventory, so post-install damage is the only remaining cause of a non-conforming entry — is indistinguishable from a candidate the algorithm should simply skip, and the developer is sent to find a better-described template instead of repairing the one they have. - `inst-sfi-read-inventory`
3. [ ] - `p1` - The entry point establishes whether the target directory already holds applied templates by reading its `.frontx/project.json` - specifically, whether any `templates[name]` entry carries a non-empty `targets` array - so that the plan omits establishing the project a second time for a directory that already holds one, **and** whether the directory holds content no such entry accounts for - because an absent or empty project state document alone does not license treating the directory as empty: the CLI refuses to apply over content it did not write, so a plan built on the state document alone can name a batch the CLI will refuse. - `inst-sfi-read-target-state`
4. [ ] - `p1` - **IF** the target directory holds content and its `.frontx/project.json` records no applied template - `inst-sfi-if-target-unowned`
   1. [ ] - `p1` - **RETURN** a refusal naming what the directory holds: this is existing work the flow did not start, so no template is planned to establish the project against it. Offer a fresh directory to establish a project in, or a batch that only extends the directory as it stands - qualified by what that batch does with the content found there, since it writes only the ground the applied template declares and refuses, naming the paths, where content already stands on that ground - and wait for the developer's choice rather than acting on either. No `frontx` command that writes files is invoked. - `inst-sfi-return-target-unowned`
5. [ ] - `p1` - The entry point invokes the selection algorithm (`cpt-frontx-algo-ai-project-scaffolding-select-templates`) with the intent, the inventory, and the already-applied set. - `inst-sfi-select`
6. [ ] - `p1` - **IF** selection returns a refusal - `inst-sfi-if-refused`
   1. [ ] - `p1` - **RETURN** the refusal and its reason to the developer - nothing installed, nothing matched, nothing establishes the project, or a choice required - with no `frontx` command invoked that writes files. - `inst-sfi-return-refused`
7. [ ] - `p1` - The entry point presents the application plan to the developer before executing it: the template that establishes the project with its pinned reference, each further template to apply in order with its target(s) — one per unit for an apply-per-unit discipline, one otherwise — each already-applied target dropped from the plan, and the residual intent no installed template's description covers. - `inst-sfi-present-plan`
8. [ ] - `p1` - **IF** the developer does not approve the presented plan - `inst-sfi-if-declined`
   1. [ ] - `p1` - **RETURN** that the plan was declined, with the plan itself so the developer can see what was not applied, and with no `frontx` command invoked that writes files. This branch is what makes §1.1's own security argument true: a misleading manifest description can at most steer selection, because "the developer sees and can reject at the presented application plan before anything is applied" — a rejection the flow has to actually offer, not merely assert. `cpt-frontx-feature-ai-upgrade-orchestration` gates its own materialization the same way - `inst-sfi-return-declined`
9. [ ] - `p1` - **IF** the plan carries at least one template to apply - `inst-sfi-if-batch`
   1. [ ] - `p1` - The entry point composes a single, explicit, target-keyed batch - the batch shape `cpt-frontx-feature-cli-scaffolding` owns and `assemble`/`apply` accept (see that FEATURE for the exact JSON form) - naming every template the plan selects by its **identity**, the name the inventory record carries and the same identity the apply commands take, together with the target(s) it applies to: the target directory for the template that establishes the project, and the target(s) the plan attributes to each further distinct template. No manifest-declared reference between templates is ever resolved into this set (`cpt-frontx-adr-composed-template-resolution`); the pinned reference reported in the plan is never passed as a batch value. - `inst-sfi-compose-batch`
   2. [ ] - `p1` - **OPTIONAL** - the entry point may preview the composed batch through the CLI's stateless `assemble` command before materializing anything, surfacing resolution, effective ownership, and any conflict the preview finds; a clean preview does not skip the apply step below, because `apply` never trusts a prior `assemble` run and independently re-derives and re-checks the identical batch. - `inst-sfi-preview-assemble`
   3. [ ] - `p1` - The entry point invokes the CLI's `apply` command through the `frontx` executable with the composed batch (`cpt-frontx-feature-cli-scaffolding`), materializing no file itself. - `inst-sfi-invoke-apply`
   4. [ ] - `p1` - **IF** the apply command exits non-zero - `inst-sfi-if-apply-failed`
      1. [ ] - `p1` - **RETURN** the CLI's reported reason unreinterpreted. Because the pre-flight, nesting-aware conflict check refuses a colliding batch before any file is written, a refusal ordinarily leaves the whole batch unapplied; the flow relays exactly what the CLI itself reports about what, if anything, was applied before the failure, rather than assuming a partial result. - `inst-sfi-return-apply-failed`
10. [ ] - `p1` - The entry point invokes the provenance reporting algorithm (`cpt-frontx-algo-ai-project-scaffolding-report-provenance`) to surface the applied set from the target directory's `.frontx/project.json`. - `inst-sfi-report-provenance`
11. [ ] - `p1` - **IF** the target directory's `.frontx/project.json` is absent or cannot be read - `inst-sfi-if-provenance-unreadable`
    1. [ ] - `p1` - **RETURN** the applied set as unconfirmed, naming the target directory, and perform **no** realization step. Realization depends on knowing which templates are applied and on reading their bundles; with the applied set unconfirmed, both are guesses, and a unit created into ground that may not be there is worse than a unit not created. The developer is pointed at the target directory to establish its state before the flow is invoked again. - `inst-sfi-return-provenance-unreadable`
12. [ ] - `p1` - The entry point reads the AI-extension bundles the CLI materialized into the target directory during apply, locating each by its identity-scoped path and each entry by its declared role, so that per-unit work inside an applied template's ground is carried by the capability that template itself declares rather than by any knowledge held in this entry point. This is a read of content already on disk in the current session, **not** the formal discovery-and-activation pass `cpt-frontx-feature-template-ai-extensions` owns: that pass runs on the framework's next invocation and makes the same capabilities available as activated resources thereafter. The bundle convention this read depends on is F16's (`.frontx/ai/<template-identity>/` with its declared entries); the activation lifecycle is not. How that bundle came to be materialized under `.frontx` is F16's own open follow-up (`cpt-frontx-adr-template-ownership-boundary-declaration`), not a question this read answers. - `inst-sfi-activate-extensions`
13. [ ] - `p1` - **FOR EACH** unit the plan attributed to an applied template's own ground, in plan order - `inst-sfi-foreach-unit`
    1. [ ] - `p1` - **IF** no activated extension skill covers that template's ground - `inst-sfi-if-no-extension`
       1. [ ] - `p1` - Record the unit as residual work naming the ground it falls in, write nothing into that ground, and continue with the next unit - a template that declares no way to add a unit to its ground is not one this entry point may improvise into. - `inst-sfi-record-uncovered-unit`
    2. [ ] - `p1` - **ELSE** follow the covering extension skill's own instructions once for that unit, creating the unit inside the applied template's ground exactly as that skill directs, and touching no ground that skill does not itself claim. - `inst-sfi-realize-unit`
       1. [ ] - `p1` - Place the content the intent states for that unit into the unit just created, following the same extension skill's conventions, so the delivered unit carries what the developer asked it to carry rather than the scaffold's placeholder content. - `inst-sfi-place-unit-content`
       2. [ ] - `p1` - **IF** realizing the unit fails - `inst-sfi-if-unit-failed`
          1. [ ] - `p1` - **RETURN** the failure's own reported reason unreinterpreted, naming the applied templates and the units realized before it; no further unit is realized and no correction retry is attempted. - `inst-sfi-return-unit-failed`
14. [ ] - `p1` - The entry point runs the verification each covering extension skill declares for the units it created, so what is handed back is a project that builds and runs rather than one that was merely written. - `inst-sfi-verify-realized`
15. [ ] - `p1` - **IF** a declared verification reports failure - `inst-sfi-if-verify-failed`
    1. [ ] - `p1` - **RETURN** the project as applied and realized but **not verified**, relaying that verification's own output unreinterpreted and naming the units it covered; scaffolding complete is not reported, and no correction retry is attempted. - `inst-sfi-return-verify-failed`
16. [ ] - `p1` - The entry point reports as the work remaining only the intent that no applied template's ground contains and no activated extension skill covers; it neither modifies any applied template's content as part of applying it nor retries a failed command in a correction loop. - `inst-sfi-report-residual`
17. [ ] - `p1` - **RETURN** scaffolding complete - the applied set as read from `.frontx/project.json`, the units realized inside the applied ground and verified, plus the residual work. - `inst-sfi-return-done`

### Route a FrontX Request to the Capability That Serves It

- [ ] `p1` - **ID**: `cpt-frontx-flow-ai-project-scaffolding-route-request`

**Actor**: `cpt-frontx-actor-ai-agent-host`

**Success Scenarios**:
- The host invokes the top-level routing entry point for a FrontX request; the entry point identifies the request as one to create a new project and names the scaffolding entry point as the capability that serves it.
- The host invokes the routing entry point for a request the kit's other declared capabilities serve; the entry point names that capability instead.

**Error Scenarios**:
- The request matches no capability the kit declares: the routing entry point says so and names the capabilities it does declare, rather than routing to the closest one.

**Steps**:
1. [ ] - `p1` - The agent host invokes the top-level routing entry point for a FrontX request stated by the developer. - `inst-rr-invoke`
2. [ ] - `p1` - The routing entry point determines which of the kit's declared capabilities the request belongs to, from the request itself and from whether the working directory already holds applied templates. - `inst-rr-classify`
3. [ ] - `p1` - **IF** the request is to create a new project - `inst-rr-if-create`
   1. [ ] - `p1` - **RETURN** the scaffolding entry point (`cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`) as the capability that serves the request. - `inst-rr-return-scaffolding`
4. [ ] - `p1` - **IF** the request matches no capability the kit declares - `inst-rr-if-unmatched`
   1. [ ] - `p1` - **RETURN** that no declared capability serves the request, naming the capabilities the kit does declare. - `inst-rr-return-unmatched`
5. [ ] - `p1` - **RETURN** the declared capability that serves the request. - `inst-rr-return-capability`

## 3. Processes / Business Logic (CDSL)

Internal system functions and procedures called by actor flows above.

### Select the Application Set from Intent and Declared Descriptions

- [ ] `p1` - **ID**: `cpt-frontx-algo-ai-project-scaffolding-select-templates`

**Input**: The developer's stated intent; the installed-template inventory as obtained over the command surface, each entry carrying identity, pinned reference, the description its manifest declares (which the required-description manifest contract makes non-empty for every conforming entry, so an entry carrying none is damaged or otherwise non-conforming — a legacy manifest is refused outright at install and never enters local inventory), and the marker set when the entry's stored manifest no longer satisfies the manifest contract; and the set of (identity, target) pairs already applied in the target directory, per `templates[name].targets`.

**Output**: An application plan - a single batch-application configuration naming, for each selected template, its identity and the target(s) it applies to - one target for a template whose description declares an apply-once-then-import discipline (or declares no discipline), or one target per named unit for a template whose description declares an apply-per-unit discipline - with at most one entry marked as the template that establishes the project and the rest as further distinct templates to apply, the targets dropped as already applied (by target, never by identity: an apply-per-unit identity may carry both an already-applied target and a newly-planned one in the same plan), the units the intent names inside an apply-once-then-import template's own ground each **provisionally** attributed to the template whose description claims that ground, and the residual intent no selected template's description covers and no selected or already-applied template's ground contains - or a refusal naming which of the four refusal reasons applies: nothing installed, nothing matched, nothing establishes the project, or a choice required. The unit attributions are the plan's best reading of the descriptions, not a resolved ownership fact: realization re-resolves each against the applied bundles' declared roles and may find no cover. This plan is the input the flow composes into the one explicit, target-keyed batch it hands to `assemble`/`apply` (`cpt-frontx-adr-composed-template-resolution`); this algorithm selects candidates and does not itself shape the batch's JSON.

**Steps**:
1. [ ] - `p1` - Receive the intent, the inventory, and the already-applied (identity, target) pairs. - `inst-st-receive`
2. [ ] - `p1` - **IF** the inventory carries no entry - `inst-st-if-empty`
   1. [ ] - `p1` - **RETURN** a refusal: selection has nothing to choose from, and a template must be installed first. - `inst-st-return-empty`
3. [ ] - `p1` - Partition the inventory into two classes: the entries that declare a description, which alone are candidates because a template that describes nothing offers nothing to match an intent against; and the entries whose stored manifest no longer satisfies the manifest contract - a damaged or manually-altered installation, since a legacy manifest is refused outright at install and never enters local inventory in the first place. The manifest contract requires a non-empty `description` on every conforming entry, so an installed entry with none is not a template working as intended; this reason is recorded as not considered and reported as a repairable installation whose remedy is reinstalling that template. - `inst-st-partition`
4. [ ] - `p1` - **IF** no entry declares a description - `inst-st-if-no-candidates`
   1. [ ] - `p1` - **RETURN** a refusal: nothing matched, listing the installed templates each with its own reason for being skipped - every one of them carrying a manifest damaged or altered after installation, no longer satisfying the required-description contract - naming reinstalling that template as the remedy. - `inst-st-return-no-candidates`
5. [ ] - `p1` - Match the intent against each candidate's declared description, treating the description as the template's own statement of what it establishes and what it contributes, and special-casing no identity, namespace, or naming pattern. - `inst-st-match`
6. [ ] - `p1` - **IF** no candidate's declared description matches any part of the intent - `inst-st-if-no-match`
   1. [ ] - `p1` - **RETURN** a refusal: nothing matched, listing the candidates considered and those skipped - each skipped entry's manifest failing the required-description contract, whether unreadable or damaged after installation - with reinstallation as its remedy; no nearest-match is chosen. - `inst-st-return-no-match`
7. [ ] - `p1` - **IF** the target directory holds no applied template, select as the template that establishes the project the single candidate whose declared description matches the project-establishing part of the intent. - `inst-st-select-seed`
8. [ ] - `p1` - **IF** the target directory holds no applied template and no candidate's declared description matches the project-establishing part of the intent, even though some candidate matches a supplemental part - `inst-st-if-no-establishing-match`
   1. [ ] - `p1` - **RETURN** a refusal: nothing establishes the project. Name the supplemental candidates that did match and state that none of them claims to establish a project, so a plan built from them would carry no entry to lay the ground - and a supplemental template contributes *to* a project, leaving nothing for it to contribute to. The refusal rests on that alone and claims nothing about what the CLI's `apply` command would do with such a directory. Ask the developer to install a template that establishes a project, or to restate the intent. Nothing is guessed and no files are written. - `inst-st-return-no-establishing-match`
9. [ ] - `p1` - **IF** two or more candidates match the project-establishing part of the intent indistinguishably - `inst-st-if-ambiguous`
   1. [ ] - `p1` - **RETURN** a refusal: a choice is required, naming each tied candidate with its declared description, because guessing between them would write a project the developer did not ask for. - `inst-st-return-ambiguous`
10. [ ] - `p1` - **FOR EACH** remaining part of the intent, select at most one candidate whose declared description matches it: a candidate whose description declares an apply-once-then-import discipline (or declares no discipline) is skipped once already in the plan, because that discipline's single target absorbs every further unit within its own ground; a candidate whose description declares an apply-per-unit discipline is **not** skipped for a further, distinct unit, because that discipline's multiplicity is exactly one target per unit - a further such unit is a new target to attribute under the same identity, not a repeat of ground already claimed. - `inst-st-select-further`
    1. [ ] - `p1` - **IF** two or more candidates match that part of the intent indistinguishably - `inst-st-if-ambiguous-further`
       1. [ ] - `p1` - **RETURN** the same choice-required refusal the project-establishing tie returns, naming the part of the intent in question and each tied candidate with its declared description. A supplemental contribution is not a lesser decision: picking arbitrarily between two templates that both claim to contribute the same thing applies one the developer never chose, and the identity applied is the one the project then carries in provenance. - `inst-st-return-ambiguous-further`
11. [ ] - `p1` - Drop from the plan every selected **target** already recorded under its template's identity in the target directory's `.frontx/project.json`, recording it as already applied - an idempotent no-op by target (`cpt-frontx-adr-composed-template-resolution`), never a reason to drop a further, not-yet-applied target the plan attributes to the same identity under an apply-per-unit discipline. - `inst-st-drop-applied`
12. [ ] - `p1` - **FOR EACH** part of the intent that names a unit within a selected or already-applied template's own ground - `inst-st-record-unit-work`
    1. [ ] - `p1` - **IF** that template's description declares an apply-per-unit discipline - `inst-st-if-apply-per-unit`
       1. [ ] - `p1` - Attribute the unit a further, distinct target under that template's identity in the plan, so the batch this plan feeds carries one target per named unit for that identity; a unit naming a target already recorded under that identity is the already-applied case the prior step drops, not a new attribution. - `inst-st-attribute-further-target`
    2. [ ] - `p1` - **ELSE** (the template's description declares an apply-once-then-import discipline, or declares no discipline) - `inst-st-else-apply-once`
       1. [ ] - `p1` - Record it as one unit of per-unit work **provisionally** attributed to that template's single target - one record per unit the intent names, so an intent naming several units of one kind yields several records against the single application that owns their ground. The attribution is provisional because this algorithm's only evidence is what the templates' descriptions say about the ground they establish; it holds no bundle contents. The authoritative answer comes at realization, where the covering capability is looked up by declared role in the applied template's own bundle (`cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`), and a unit no bundle covers takes the explicit no-covering-skill branch there rather than being forced onto the template this step guessed. - `inst-st-record-unit-provisional`
13. [ ] - `p1` - Record as the residual intent every part of the intent no selected template's declared description covers and no selected or already-applied template's ground contains, so that per-unit work the flow goes on to realize is not reported as work left undone. - `inst-st-record-residual`
14. [ ] - `p1` - **RETURN** the application plan: the template that establishes the project if any, the further distinct templates each with its target(s) - one per unit for an apply-per-unit identity, one for any other - the targets dropped as already applied, the per-unit work provisionally attributed to each apply-once-then-import template, and the residual intent - ready for the flow to compose into the one batch it hands to `assemble`/`apply`. - `inst-st-return-plan`

### Report the Applied Set from Project Provenance

- [ ] `p1` - **ID**: `cpt-frontx-algo-ai-project-scaffolding-report-provenance`

**Input**: The target directory whose apply commands reported success.

**Output**: The applied set as recorded by the CLI - each applied template's identity, the version it was applied from, and its re-resolvable source address - or a report that the applied set could not be confirmed.

**Steps**:
1. [ ] - `p1` - Read the target directory's single project state document, `.frontx/project.json`, written by the CLI's project state store (`cpt-frontx-feature-composed-provenance`, DESIGN §3.1 `ProjectProvenance`, per `cpt-frontx-adr-project-provenance-record`), through the filesystem handoff DESIGN §3.4 sanctions in the kit-reads-project direction. - `inst-rp-read`
2. [ ] - `p1` - **IF** the document is absent or cannot be read - `inst-rp-if-unreadable`
   1. [ ] - `p1` - **RETURN** that the applied set could not be confirmed, naming the target directory; report no applied set that was not read. - `inst-rp-return-unreadable`
3. [ ] - `p1` - Report one entry per `templates[name]` entry whose `targets` array is non-empty - identity, applied-from version, and re-resolvable source address (origin) - as the authoritative applied set, in place of restating what the plan intended to apply. - `inst-rp-report-records`
4. [ ] - `p1` - **RETURN** the reported applied set. - `inst-rp-return-set`

## 4. States (CDSL)

### Application Plan Lifecycle

- [ ] `p2` - **ID**: `cpt-frontx-state-ai-project-scaffolding-plan-lifecycle`

**States**: REQUESTED, INVENTORY_READ, PLANNED, BATCH_APPLIED, APPLIED_REPORTED, REALIZED, VERIFIED, REFUSED

`BATCH_APPLIED` replaces the prior two-step `SEEDED`/`EXTENDED` pair: the plan is now materialized by exactly one `apply` call over one explicit, target-keyed batch (`cpt-frontx-adr-composed-template-resolution`), so there is one state for "the batch is applied," not one for the establishing template and a second for the further ones. `APPLIED_REPORTED` is named for what it reports: the applied set has been read back from the project's single state document, `.frontx/project.json`, and the flow continues into realization. It is not terminal, and naming it `REPORTED` would suggest the developer has been handed a finished result while the units the intent named are still missing. `VERIFIED` is the terminal success state, reached only once the applied templates' own declared verification has passed over the units created.

**Initial State**: REQUESTED

**Transitions**:
1. [ ] - `p1` - **FROM** REQUESTED **TO** INVENTORY_READ **WHEN** the installed-template inventory and the target directory's already-applied set have been obtained over the command surface. - `inst-pl-req-inventory`
2. [ ] - `p1` - **FROM** INVENTORY_READ **TO** PLANNED **WHEN** selection returns an application plan carrying at least one template to apply. - `inst-pl-inventory-planned`
3. [ ] - `p1` - **FROM** INVENTORY_READ **TO** REFUSED **WHEN** selection returns a refusal - nothing installed, nothing matched, or a choice required; no command that writes files has been invoked. - `inst-pl-inventory-refused`
4. [ ] - `p1` - **FROM** PLANNED **TO** BATCH_APPLIED **WHEN** the plan's composed batch - the template that establishes the project and every further distinct template, each with its target(s) - has been materialized by the CLI's `apply` command exiting successfully (optionally preceded by a stateless `assemble` preview). - `inst-pl-planned-seeded`
5. [ ] - `p1` - **FROM** PLANNED **TO** REFUSED **WHEN** the `apply` command exits non-zero; the CLI's reported reason is relayed, naming what the CLI itself reports as applied before the failure. - `inst-pl-planned-refused`
6. [ ] - `p1` - **FROM** PLANNED **TO** REFUSED **WHEN** the developer declines the presented plan; no command that writes files has been invoked, and the plan is returned with the refusal so what was not applied stays visible. - `inst-pl-planned-declined`
7. [ ] - `p1` - **FROM** BATCH_APPLIED **TO** APPLIED_REPORTED **WHEN** the applied set has been read from the target directory's `.frontx/project.json` and reported. - `inst-pl-extended-reported`
8. [ ] - `p1` - **FROM** BATCH_APPLIED **TO** REFUSED **WHEN** `.frontx/project.json` is absent or unreadable after the apply command reported success; the applied set is reported as unconfirmed, the target directory is named, and no realization is attempted. - `inst-pl-extended-unconfirmed`
9. [ ] - `p1` - **FROM** APPLIED_REPORTED **TO** REALIZED **WHEN** every unit the plan attributed to an applied template's ground has either been created through that template's activated extension skill and filled with the content the intent states for it, or been recorded as residual for want of a covering extension skill; the residual work is reported with the realized units. - `inst-pl-reported-realized`
10. [ ] - `p1` - **FROM** APPLIED_REPORTED **TO** REFUSED **WHEN** realizing a unit fails; the units realized before the failure are named, no further unit is realized, and no correction retry is attempted. - `inst-pl-reported-refused`
11. [ ] - `p1` - **FROM** REALIZED **TO** VERIFIED **WHEN** the verification each covering extension skill declares has passed over the units it created; this is the terminal success state, and only from it is scaffolding reported complete. - `inst-pl-realized-verified`
12. [ ] - `p1` - **FROM** REALIZED **TO** REFUSED **WHEN** a declared verification reports failure; the project is reported as applied and realized but not verified, that verification's own output is relayed unreinterpreted, and no correction retry is attempted. - `inst-pl-realized-refused`

## 5. Definitions of Done

### Declared Agent Entry Points for Routing and Scaffolding

- [ ] `p1` - **ID**: `cpt-frontx-dod-ai-project-scaffolding-declared-skill-surface`

The system **MUST** expose both the top-level routing entry point and the scaffolding entry point as kit-manifest resources of kind `skill` with `frontx_`-prefixed identifiers and non-empty applicability metadata in each resource document, extending the existing top-level resource with the routing responsibility rather than declaring a second resource under the same top-level name, and **MUST** keep both resource documents free of any concrete template, solution, or framework name so the solution-agnostic admission check passes (`target`).

**Implements**:
- `cpt-frontx-flow-ai-project-scaffolding-route-request`

**Cites**:
- `cpt-frontx-component-ai-base-kit`
- `cpt-frontx-component-ai-tooling-kit`

**Constraints**: `cpt-frontx-constraint-kit-zero-solution-content` - the entry points carry the selection mechanism, and the installed templates carry the names it selects among.

**Touches**:
- Entities: `Kit`
- Resource shape: two `resources[]` entries of `kind = "skill"` with `public = true`, each `source` addressing a shipped document and covered by the package's published file set
- No API surface; no persistent database

**Verifiable clauses**:
- [ ] Both entry points appear in the shipped manifest as `kind = "skill"`, `public = true`, with identifiers matching the `frontx_` prefix rule
- [ ] Each entry point's document carries non-empty applicability metadata in its frontmatter
- [ ] Each declared `source` exists on disk and is covered by the package's published file set
- [ ] Neither entry-point document nor either manifest entry names a concrete template, solution, or framework

### Selection Is Description-Matched over the Local Inventory Only

- [ ] `p1` - **ID**: `cpt-frontx-dod-ai-project-scaffolding-description-matched-selection`

The system **MUST** select the templates to apply by matching the developer's stated intent against the descriptions installed templates declare in their manifests, over the local template inventory obtained through the CLI command surface and no other source, special-casing no template identity or namespace; and **MUST** refuse - reporting nothing installed, nothing matched, or a choice required, and writing no files - rather than choosing a nearest match, consulting any remote source, or falling back to a template name built into the kit (`target`).

**Implements**:
- `cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`
- `cpt-frontx-algo-ai-project-scaffolding-select-templates`

**Cites**:
- `cpt-frontx-component-ai-base-kit`
- `cpt-frontx-component-cli-template-resolver`

**Constraints**: (none owned by this feature)

**Touches**:
- Entities: `Template`
- No API surface; no persistent database

### The Kit Drives Scaffolding Only Through the Command Surface

- [ ] `p1` - **ID**: `cpt-frontx-dod-ai-project-scaffolding-command-surface-only`

The system **MUST** apply every selected template by composing one explicit, target-keyed batch and invoking the installed `frontx` executable's `apply` command over it (optionally preceded by a stateless `assemble` preview of the identical batch), never a series of separate per-template invocations (`cpt-frontx-adr-composed-template-resolution`), and **MUST NOT** import `@gears-frontx/cli`, read the CLI's inventory storage, materialize or modify any project file as part of applying a template, or reproduce any part of resolution, assembly, conflict checking, or project-state writing - relaying the command's own reported reason on a non-zero exit and stopping rather than retrying in a correction loop. Content placed into a unit an activated extension skill has just created, following that skill's conventions, is not an application and is outside this prohibition: the unit's structure comes from the template's own skill, no template is applied a second time, and the base kit holds no code path that writes any of it, so no second assembler comes into existence (`target`).

**Implements**:
- `cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`

**Cites**:
- `cpt-frontx-component-ai-base-kit`
- `cpt-frontx-component-cli-assembler`

**Constraints**: `cpt-frontx-constraint-kit-orchestrates-not-reimplements` - the rule that the framework orchestrates rather than reimplements a CLI engine applies to the assembler on this path exactly as it applies to the change-set engine on the upgrade path.

**Touches**:
- Entities: `Template`, `Assembly`
- Command surface: the built `frontx` executable's listing, `assemble`, and `apply` commands (`cpt-frontx-interface-cli`)
- No API surface; no persistent database

### Multiplicity Is Description-Driven

- [ ] `p1` - **ID**: `cpt-frontx-dod-ai-project-scaffolding-single-application-per-identity`

The system **MUST** plan an application per template identity according to that template's declared discipline, never a universal cap of one application per identity per project: exactly one target for a template whose description declares an apply-once-then-import discipline or declares no discipline, and one target per unit the intent names for a template whose description declares an apply-per-unit discipline. The system **MUST** drop and report as already applied a selected **target** the target directory's `.frontx/project.json` already records under that identity's `targets` array, whether or not a further, not-yet-applied target remains to plan under the same identity, and **MUST NOT** plan the identical target twice. For a template whose description declares an apply-once-then-import discipline, the system **MUST** realize repetition of a unit within that template's single applied ground by driving its activated extension skills once per unit, rather than by a further application, because a further application of that identity would re-claim ground the single target already occupies and the CLI refuses the whole operation; only a unit whose ground no activated extension skill covers is handed back as residual. For a template whose description declares an apply-per-unit discipline, the system **MUST** instead realize a further unit by attributing it a further, distinct target under the same identity in the plan's composed batch (`target`).

**Implements**:
- `cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`
- `cpt-frontx-algo-ai-project-scaffolding-select-templates`
- `cpt-frontx-state-ai-project-scaffolding-plan-lifecycle`

**Cites**:
- `cpt-frontx-component-ai-base-kit`
- `cpt-frontx-component-ai-extension-host`
- `cpt-frontx-component-cli-conflict-checker`

**Constraints**: (none owned by this feature)

**Touches**:
- Entities: `Template`, `OwnershipBoundary`, `ProjectProvenance`, `AiExtension`
- No API surface; no persistent database

### The Applied Set Is Reported from Provenance

- [ ] `p1` - **ID**: `cpt-frontx-dod-ai-project-scaffolding-provenance-reported`

The system **MUST** report the applied set after applying by reading the target directory's single project state document, `.frontx/project.json`, and surfacing each `templates[name]` entry with a non-empty `targets` array as identity, applied-from version, and source address (origin), and **MUST** report that the applied set could not be confirmed - rather than restating what the plan intended to apply - when that document is absent or unreadable after the apply command reported success (`target`).

**Implements**:
- `cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`
- `cpt-frontx-algo-ai-project-scaffolding-report-provenance`

**Cites**:
- `cpt-frontx-component-ai-base-kit`
- `cpt-frontx-component-cli-provenance-recorder`

**Constraints**: (none owned by this feature)

**Touches**:
- Entities: `ProjectProvenance`
- Filesystem handoff: the CLI-written project state document, `.frontx/project.json`, read in the kit-reads-project direction (DESIGN §3.4)
- No API surface; no persistent database

### The Ecosystem Is Enabled for Intent-Driven Scaffolding

- [ ] `p1` - **ID**: `cpt-frontx-dod-ai-project-scaffolding-ecosystem-enabled`

The system **MUST** leave the ecosystem in a state where the capability is reachable and correctly described: every template the repository publishes declares a description, since a capability that selects on declared descriptions demonstrates nothing while no shipped template declares one; and the repository's own developer documentation describes scaffolding as an operation a kit capability drives from a stated intent alongside the direct CLI path, replacing any statement that scaffolding is not a kit capability, since a document contradicting the architecture is a defect even where the code is right (`target`).

**Implements**:
- `cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`

**Cites**:
- `cpt-frontx-component-ai-base-kit`

**Constraints**: (none owned by this feature)

**Touches**:
- Entities: `Template`
- Resource shape: each published template's manifest description (schema owned by `cpt-frontx-feature-template-manifest`)
- Developer documentation: the repository's quick-start description of which operations a kit capability drives
- No API surface; no persistent database

**Verifiable clauses**:
- [ ] Every template manifest the repository publishes declares a non-empty description of what that template establishes and contributes
- [ ] No developer document states that scaffolding is not a kit capability
- [ ] The developer documentation names the routing and scaffolding entry points as the intent-driven path, and the direct `frontx` commands as the path that remains available unchanged

## 6. Acceptance Criteria

- [ ] `architecture/features/ai-project-scaffolding/FEATURE.md` exists with all template sections in order.
- [ ] The kit declares a top-level routing entry point and a scaffolding entry point as `skill` resources with `frontx_`-prefixed identifiers, `public = true`, and non-empty applicability metadata in each document; the kit's own validation suite asserts each declared `source` exists and is covered by the published file set. (`target`)
- [ ] Neither entry-point document nor either manifest entry names a concrete template, solution, or framework, and the solution-agnostic admission check passes over the shipped resource bodies. (`target`)
- [ ] Stating a project intent in a directory with templates installed yields an application plan naming the template that establishes the project with its pinned reference and each further template to apply, presented before any command that writes files is invoked. (`target`)
- [ ] The selectable set is obtained by invoking the CLI's machine-readable listing command over the command surface; no code path reads the CLI's inventory storage and no code path consults a remote source. (`target`)
- [ ] An installed template whose stored manifest carries no description — damaged or altered after installation, since a legacy manifest is refused outright at install and never enters local inventory in the first place — is excluded from matching and reported as not considered, with reinstallation named as its remedy; it remains applicable by its exact reference through the direct CLI path. (`target`)
- [ ] Selection refuses with no files written when nothing is installed, when no declared description matches the intent, when a greenfield target has no project-establishing match though a supplemental part matched, and when two or more candidates match indistinguishably - whether on the project-establishing part or on a supplemental one - the tie refusals naming each tied candidate and its declared description. (`target`)
- [ ] An entry whose stored manifest no longer satisfies the manifest contract — damaged or altered after installation — is reported as a repairable installation with reinstallation named as the remedy. (`target`)
- [ ] A selected **target** already recorded under its template's identity in the target directory's `.frontx/project.json` is dropped from the plan and reported as already applied, by target rather than by identity; no plan ever carries the identical target twice, but an identity whose description declares an apply-per-unit discipline may carry both an already-applied target and a further, newly-planned one in the same plan. (`target`)
- [ ] For a template whose description declares an apply-once-then-import discipline, repetition of a unit within its applied ground is realized through that template's activated extension skills as part of the flow, not planned as a further application. For a template whose description declares an apply-per-unit discipline, a further unit is realized as a further, distinct target attributed to that identity in the composed batch. Either way, an intent naming several units of one kind yields several realized units. (`target`)
- [ ] The content the intent states for each unit is present in the unit the flow created, so a realized unit carries what the developer asked for rather than the scaffold's placeholder content. (`target`)
- [ ] A unit whose ground no activated extension skill covers is reported as residual work naming that ground, and nothing is written into it. (`target`)
- [ ] A failure while realizing a unit stops the flow at that unit, relays the failure's own reported reason, names the units realized before it, and attempts no correction retry. (`target`)
- [ ] A failing verification declared by a covering extension skill is reported as applied and realized but not verified, relaying that verification's own output, and scaffolding complete is not reported; no correction retry is attempted. (`target`)
- [ ] Every selected template is applied by composing one explicit, target-keyed batch and invoking the installed `frontx` executable's `apply` command once over it (optionally previewed via a stateless `assemble` call); the kit holds no import of `@gears-frontx/cli` and no code path that materializes or modifies a project file. (`target`)
- [ ] A non-zero exit from the `apply` command stops the flow, relays the CLI's own reported reason, names what the CLI itself reports as applied before the failure, and invokes no further command and no correction retry. (`target`)
- [ ] After applying, the applied set is reported from the target directory's `.frontx/project.json` - each `templates[name]` entry with a non-empty `targets` array reported as identity, applied-from version, and source address - and an absent or unreadable document is reported as an unconfirmed applied set, after which the flow stops and realizes nothing. (`target`)
- [ ] Every template the repository publishes declares a non-empty manifest description, so the capability is demonstrable against the shipped templates. (`target`)
- [ ] No developer document states that scaffolding is not a kit capability; the documentation names the intent-driven path and the unchanged direct CLI path side by side. (`target`)
- [ ] A project scaffolded through this flow from templates that declare descriptions realizes the stated intent - every unit the intent names is present in the delivered project, carrying the content stated for it - and builds and runs in a browser without errors, verified end to end against the installed templates. (`target`)
