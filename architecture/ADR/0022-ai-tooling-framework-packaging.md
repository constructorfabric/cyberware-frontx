---
status: accepted
date: 2026-06-05
---

# AI Tooling Framework Packaging


<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Constructor Studio kit](#constructor-studio-kit)
  - [Bespoke library package with a custom installer](#bespoke-library-package-with-a-custom-installer)
  - [In-repo scaffolding](#in-repo-scaffolding)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-ai-tooling-framework-packaging`
## Context and Problem Statement

The AI Tooling Framework (`cpt-frontx-component-ai-tooling-kit`, packaged as `cyber-pilot-kit-frontx`) must reach a consuming project so that AI agents working in that project gain the framework's skills and ecosystem-knowledge artifacts at session start (`cpt-frontx-fr-ai-session-start-knowledge`). Delivery flows through the AI-tooling command-line integration (`cpt-frontx-actor-ai-tooling-cli`) as the installation contract requires (`cpt-frontx-contract-kit-installation`), and the framework exposes a single versioned public surface (`cpt-frontx-interface-ai-tooling-framework`). What packaging and distribution form should the framework take so that it installs through that integration, presents one governed public surface, and carries no template-specific content of its own?

## Decision Drivers

* **Capabilities available at session start** — installing the framework must make its skills and ecosystem-knowledge artifacts available to AI agents from the first interaction, with no separate training or setup step (`cpt-frontx-fr-ai-session-start-knowledge`).
* **Install through the AI-tooling CLI integration** — the framework reaches a consuming project through the command-line integration, which is the channel the installation contract defines (`cpt-frontx-contract-kit-installation`, `cpt-frontx-actor-ai-tooling-cli`).
* **One governed, versioned public surface** — the delivered artifact is the framework's public interface (`cpt-frontx-interface-ai-tooling-framework`); its compatibility must be governed by an explicit versioning policy rather than left implicit.
* **Declarative, repeatable install and update** — what gets installed, and where, should be declared rather than imperative, so installation and later updates are deterministic and inspectable.
* **Collision-free resource identity** — the framework's resources coexist with other installed kits in one project, so each resource needs a namespaced identifier that cannot collide with another kit's.
* **Reuse of a proven distribution substrate** — a declarative kit-manifest install mechanism and a versioned source-reference convention already serve this purpose; a bespoke alternative would duplicate them.

## Considered Options

* **Constructor Studio kit** — the framework ships as a Constructor Studio kit with a declarative `.cf-studio-kit.toml`; every resource identifier is `frontx_`-prefixed (constraint KIT-1); the package is published as a versioned npm artifact and installed through the AI Tooling CLI by source reference. The kit is the framework's delivered public surface.
* **Bespoke library package with a custom installer** — the framework ships as a standalone package with its own install-and-load logic and its own resource layout, independent of the kit-manifest mechanism.
* **In-repo scaffolding** — the framework's capabilities are copied into each consuming project at scaffold time, with no separately versioned package to install or update.

## Decision Outcome

Chosen option: **Constructor Studio kit**, because it is the only option that installs through the CLI integration the contract defines, presents one declaratively-described public surface, and reuses the existing declarative install substrate instead of duplicating it. The framework ships as a kit whose `.cf-studio-kit.toml` enumerates exactly the resources to install and their destinations; every resource identifier carries the `frontx_` prefix (KIT-1) so the framework's resources cannot collide with another kit installed in the same project. The package is published as a versioned npm artifact and installed and updated through the AI Tooling CLI by source reference, and the kit as a whole IS the framework's delivered public surface (`cpt-frontx-interface-ai-tooling-framework`).

The kit's public surface is a library boundary whose stability is governed by the matched-version artifact-distribution policy decided in `cpt-frontx-adr-artifact-versioning-and-distribution`: an incompatible change to the surface requires a major version bump, while minor and patch versions preserve backward compatibility. The scope of this decision is the framework's packaging form, its resource-identity rule, its agent-facing resource-kind model — public agent entry points are declared as resources of kind `skill` or `rule`, with each entry point's applicability metadata carried in the resource document itself rather than in manifest fields, and supporting knowledge content declared as non-public resources (KIT-4) — and its distribution and install path; it does not decide the shape of any template-carried AI extension (that is `cpt-frontx-adr-template-ai-extension-contract`) nor how installed extensions are discovered (that is `cpt-frontx-adr-extension-discovery-activation`). The bespoke-package option fragments the install path away from the CLI integration and reimplements a declarative install mechanism that already exists; the in-repo-scaffolding option gives no separately versioned surface and no clean update path, so the framework's capabilities could not evolve and be re-delivered independently of each project.

**Extension (2026-08-20): a second, independently-versioned Constructor Studio kit.** The Constructor Studio kit mechanism this decision establishes is not exclusive to the AI Tooling Framework: any FrontX package that needs to deliver agent-facing capability from its own published surface may ship its own kit rather than growing the framework's kit into a catalog of unrelated packages' capabilities. The owner accepted `@gears-frontx/ui-kit` as the second adopter; the kit itself is planned work, not yet built. As planned, the npm package will ship its own `.cf-studio-kit.toml` alongside its existing `llms.txt`, declaring exactly two resources: one of kind `skill` that teaches an agent to use the kit — component inventory, variant axes, token system, composition rules — and one of kind `rule`, a compact instruction block for `CLAUDE.md`/`AGENTS.md` that points at the skill and at the package's own generated docs. The skill is to carry no duplicated component knowledge of its own: it reads the installed package's `llms.txt` and its per-component `dist/docs/<component>.md` at whatever version the consuming project has installed, so the skill and the component surface it describes version together with the code and cannot drift apart — the first time ui-kit's own `llms.txt`/`dist/docs` output would actually be consumed by the ecosystem rather than left unread. Delivery is to reach the same target surfaces this decision already names — `.claude/skills/`, `.agents/skills/`, `CLAUDE.md`, `AGENTS.md` — through the same `cfs generate-agents` mechanism; no new delivery channel is introduced. The kit is scoped to the ui-kit package surface alone (components, API, tokens, generated docs): design-process skills — creating a theme, generating an interface, reviewing one against the kit — remain outside it, in the territory of the design-guardrails template (draft PR #586). Granularity is a single ui-kit-scoped kit, not an ecosystem-wide "FrontX skills" umbrella, consistent with the per-package artifact-ownership direction (federation PR #495, PR #517) and with this ADR's own one-kit-per-package shape; it is independent of the `.frontx/ai` template-extension ownership redesign proposed in issue #587, which is a template-territory contract and does not apply to a published npm library's own kit.

Resource identity for the new kit follows KIT-1's collision-avoidance *intent*, not its literal prefix. KIT-1 (`cpt-frontx-constraint-kit-prefixed-resource-ids`) fixes `frontx_` as the identifier prefix of one specific package's resources, `cyber-pilot-kit-frontx`'s, so that package's contributed resources cannot collide with another kit in the same project. Giving ui-kit's kit that same `frontx_` prefix would defeat that intent rather than honour it: two independently released, independently versioned kits would share one identifier namespace, and a `frontx_`-prefixed resource would no longer reliably identify a capability of the AI Tooling Framework component (`cpt-frontx-component-ai-tooling-kit`), which ui-kit's kit is not part of. ui-kit's kit therefore reserves its own prefix, `uikit_`, applied to both of its resource identifiers. KIT-1 itself is unchanged and stays scoped to `cyber-pilot-kit-frontx`; a further FrontX package that ships its own kit is expected to reserve a prefix of its own the same way rather than reuse `frontx_` or `uikit_`.

### Consequences

* Good, because installing the kit makes the framework's skills and ecosystem-knowledge artifacts available to AI agents at session start through the standard install path.
* Good, because the kit manifest declares exactly what is installed and where, so installation and update are deterministic and inspectable.
* Good, because the `frontx_` resource-identity rule guarantees the framework's resources never collide with another kit in the same project.
* Good, because the kit is one governed public surface whose compatibility is bound to the matched-version policy.
* Bad, because the framework's deliverable form is constrained to what the kit-manifest mechanism can express; a capability that does not fit the manifest's resource model needs the mechanism extended.
* Bad, because the framework's delivery is coupled to the AI Tooling CLI and the kit substrate, so a consuming project must adopt that toolchain to receive the framework.
* Good, because a second package can deliver agent-facing capability through the same install path, the same target surfaces, and the same `cfs generate-agents` mechanism without inventing a new one.
* Good, because deriving a package's skill content from its own installed `llms.txt`/`dist/docs` at each version keeps the skill and the component surface it describes from drifting apart, and puts ui-kit's already-generated docs to their first actual use.
* Good, because a package-scoped prefix (`uikit_`) keeps ui-kit's resources out of the AI Tooling Framework's `frontx_` namespace, preserving KIT-1's collision-avoidance intent while keeping each kit's resources attributable to the package that ships it.
* Bad, because the ecosystem now carries two independently versioned kits to keep current against kit-manifest tooling changes instead of one, and each further package that ships its own kit adds another line to keep current the same way.
* Bad, because resource-identity collision avoidance is now a per-package convention (each kit reserves its own prefix) rather than one fixed rule; nothing in the kit-manifest schema itself enforces prefix uniqueness across independently authored kits.

### Confirmation

Compliance is confirmed by the `cyber-pilot-kit-frontx` package's own test suite, which parses the shipped `.cf-studio-kit.toml` from disk and asserts that every resource identifier matches `^frontx_` (KIT-1), that each declared resource source exists, and that the manifest passes `validateKitManifest`. The same suite asserts the agent-facing resource-kind model: every resource the packaged kit declares public is of kind `skill` or `rule`, and each such resource's document carries non-empty applicability metadata in its frontmatter or description (KIT-4). Because the kit is registered at `[kits.cyber-pilot-kit-frontx]` in `.cf-studio/config/core.toml`, the repository's `cfs validate-kits` CI job additionally validates it against the kit specification (only declared resources install, each at its declared or user-overridden path). A public-interface compatibility check (tied to the matched-version policy) asserts that an incompatible change to the kit's public surface is accompanied by a major version bump. Design and code review confirm the kit carries no template-specific content.

ui-kit's kit does not exist yet — `@gears-frontx/ui-kit` ships no `.cf-studio-kit.toml` and no test over one — so nothing about it is confirmed today. When it lands, compliance is to be confirmed the same way, scaled to that package: the package's own test suite parses its shipped `.cf-studio-kit.toml` and asserts that both declared resource identifiers match `^uikit_`, that each declared resource source exists, and that the manifest passes `validateKitManifest`; once registered under its own `[kits.*]` entry in `.cf-studio/config/core.toml`, `cfs validate-kits` validates it against the same kit specification `cyber-pilot-kit-frontx` is validated against. Design and code review are to confirm ui-kit's kit carries no design-process content and no duplicated component knowledge, and that its skill resource reads rather than repeats the package's own `llms.txt` and `dist/docs/<component>.md`.

## Pros and Cons of the Options

### Constructor Studio kit

The framework ships as a Constructor Studio kit with a declarative `.cf-studio-kit.toml`, `frontx_`-prefixed resource ids, versioned npm distribution, and CLI install by source reference; the kit is the public surface.

* Good, because it installs through the CLI integration the installation contract defines.
* Good, because the manifest declares install targets deterministically and supports repeatable updates.
* Good, because `frontx_`-prefixed identifiers give collision-free resource identity in a shared project.
* Good, because it reuses a proven declarative install substrate rather than duplicating one.
* Neutral, because it composes with the matched-version policy, which is a separate decision it relies on for compatibility governance.
* Bad, because the deliverable is bounded by what the kit-manifest resource model can express.

### Bespoke library package with a custom installer

The framework ships as a standalone package with its own install-and-load logic.

* Good, because the framework controls its own install behaviour without conforming to a manifest model.
* Bad, because it reimplements a declarative install mechanism that already exists, duplicating substrate.
* Bad, because it fragments the install path away from the CLI integration the contract defines.
* Bad, because resource-identity collision avoidance must be re-solved instead of inherited from a kit-wide prefix rule.

### In-repo scaffolding

The framework's capabilities are copied into each project at scaffold time, with no separately versioned package.

* Good, because there is no separate artifact to publish or install.
* Bad, because there is no separately versioned public surface to govern for compatibility.
* Bad, because there is no clean update path: capabilities cannot evolve and be re-delivered independently of each project's scaffolded copy.

## More Information

The kit ships inside the `constructorfabric/gears-frontx` monorepo — no
standalone kit repository exists — and is published to npm as
`@gears-frontx/cyber-pilot-kit-frontx`. The AI-tooling CLI's kit installer does
not consume npm artifacts; it resolves the kit by generic-Git subdirectory
reference or by local path. The npm artifact serves the package-registry
distribution policy (`cpt-frontx-adr-artifact-versioning-and-distribution`),
while the source-reference install path is what delivers the kit into a
consuming project.

The kit-installation substrate this decision rides on is the declarative kit manifest defined by the Constructor Studio kit specification (`.cf-studio/.core/architecture/specs/kit/kit.md`) (only declared resources install, each at its declared `install_path` or a user-overridden path) and the `[kits.*]` registration in `.cf-studio/config/core.toml` (each kit records its `path`, `version`, and install mode or resolved source); the `.cf-studio/config/kits/sdlc/` kit is a working exemplar of this packaging. These are neutral substrate citations and are not part of this decision's durable identity. KIT-1's `frontx_` prefix maps to the `resource.id` field of the kit-manifest schema, layered above that field's general identifier pattern. The matched-version policy that governs the kit's public-surface compatibility is decided in `cpt-frontx-adr-artifact-versioning-and-distribution` — a non-binding pointer to a related decision.

Unlike `cyber-pilot-kit-frontx`, whose entire package IS the kit, `@gears-frontx/ui-kit`'s kit files (`.cf-studio-kit.toml`, and the `llms.txt`/`dist/docs` content its resources point at) ship inside the same published-library npm artifact as the package's own component source — the package is a published library and a kit at once. It is expected to register under its own `[kits.*]` entry in `.cf-studio/config/core.toml`, the way `[kits.cyber-pilot-kit-frontx]` does today, and to be installed and updated by source reference through the same AI-tooling CLI integration this ADR already decided; no new install path, resolver, or registry convention is introduced for it. These are neutral substrate citations, not part of this decision's durable identity.

Integration treatment (INT): the kit installation is the integration contract (`cpt-frontx-contract-kit-installation`), required from the consuming side and serviced through the CLI integration. **Interface stability and versioning (INT-ADR-001)** — the kit's public surface is `cpt-frontx-interface-ai-tooling-framework`; an incompatible change to it requires a major version bump, while minor and patch versions preserve backward compatibility, governed by the matched-version policy. **Contract changes (INT-ADR-002)** — the installation contract remains backward-compatible across minor and patch versions; an incompatible change to it is a public-interface change subject to the same compatibility policy, and consumers are notified through the version bump. There is no wire protocol to version here.

Applicability of the remaining checklist categories: **PERF** — Not applicable, because no latency or throughput budget is bound to the packaging form. **SEC** — Not applicable, because no secret material and no authentication surface are introduced by the packaging decision. **REL** — Not applicable, because there is no service-availability target; install and update run locally and on demand. **DATA** — Not applicable, because no persistent database or schema is defined here. **OPS** — Not applicable, because there are no runbooks or operational procedures for a local kit install. **COMPL** — Not applicable, because no regulatory obligation bears on the packaging form. **ARCH-ADR-008 (supersession)** — Not applicable, because this ADR supersedes no live ADR. **Review cadence**: revisit if the kit-manifest resource model cannot express a required framework capability, or if a distribution channel beyond the present npm-artifact and source-reference install paths becomes a requirement.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-contract-kit-installation` — This decision defines the packaging and install path that realizes the kit-installation contract through the CLI integration.
* `cpt-frontx-fr-ai-session-start-knowledge` — Installing the kit is what makes the framework's skills and ecosystem-knowledge artifacts available to AI agents at session start.
* `cpt-frontx-fr-ai-agent-skill-resources` — This decision fixes the agent-facing resource-kind model that exposes the framework's capabilities as declared resources a conforming agent host can discover and invoke.
* `cpt-frontx-actor-ai-tooling-cli` — The CLI integration is the install channel; this decision binds the framework's delivery to it.
* `cpt-frontx-interface-ai-tooling-framework` — The kit is the delivered public surface of this interface; this decision fixes its packaging form and binds its compatibility to the matched-version policy.
* `cpt-frontx-component-ai-tooling-kit` — This component is packaged as `cyber-pilot-kit-frontx`; this decision determines that packaging and its resource-identity rule.
