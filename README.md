# Gears FrontX — An Ecosystem for AI-Built Frontend Projects

![Badge](./.github/badgeHN.svg)



**FrontX** (part of Gears) is an **ecosystem for AI-driven creation of frontend projects**. It gives AI agents stable, narrow, explicitly-contracted capabilities to scaffold, extend, and evolve a project — instead of improvising against an open-ended codebase — while the human developers steering the work stay in control of intent and review.

**Templates** define what any given project *becomes*; the ecosystem provides the lifecycle and runtime mechanisms for assembling, extending, and evolving a project from them.

## Why FrontX?

Teams increasingly rely on AI agents to build and maintain frontends. For an agent to do that reliably it needs a product surface that is **stable, narrow, and explicitly contracted** — not an open-ended codebase to guess at. FrontX provides exactly that, across three recurring needs:

- **Stable contracts an agent can target** — a versioned runtime and type-system substrate held to semantic-versioning discipline.
- **A repository lifecycle an agent can drive end to end** — install, apply, assemble, validate, and upgrade templates, with per-template provenance and review-gated, reversible upgrades.
- **AI tooling that knows the ecosystem out of the box** — and can be extended with knowledge specific to each template in use.

## Who FrontX is for

FrontX serves two groups of developers, each working alongside AI agents:

- **Template Developers** design, version, and publish the templates other teams build from. They need stable product contracts, pre-publish validation, semantic-versioning discipline, a way to declare the boundaries of what a template owns so independently-authored templates assemble without conflict, and a way to bundle template-specific AI capabilities.
- **Project Developers** assemble a repository from one or more templates and build business code on top. They need predictable assembly output, reliable per-template upgrades, a clear boundary between what the ecosystem provides and what the application must supply, and AI agents that already understand both the ecosystem and the templates in use.

---

## What FrontX Delivers

FrontX delivers on the above through three capability sets. Architecturally the
ecosystem is partitioned into three layers — **published libraries** (consumed as
versioned dependencies), **templates** (applied to produce project content), and
**projects orchestration** (tooling that drives a project's lifecycle) — described
in [DESIGN.md](./architecture/DESIGN.md).

### Core Framework

Makes an application **runtime-extensible by composable microfrontends** over a
substrate for typed entities:

- Microfrontends register with the application and load on demand
- Multiple microfrontends can share an extension domain when it permits it
- Microfrontends communicate with the host and react to host state changes
- Microfrontends and their extensions are validated against type definitions at registration
- Applications register their own type definitions, at build time or at runtime
- UI-framework-agnostic — the core framework never constrains that choice
- Versioned releases with semantic-versioning discipline

Packages: `@gears-frontx/mfes` (runtime substrate), `@gears-frontx/gts-plugin`
(default type-system provider), `@gears-frontx/api` (API protocols + registry).

### CLI

Owns the **full lifecycle of assembling and evolving a repository from
templates**:

- Install, list, update, and validate templates from a versioned source
- Apply a template to seed a new repository or extend an existing one
- Assemble a repository from multiple templates, resolving referenced presets
- Declare each template's ownership boundaries; detect and prevent conflicting assembly before any file is written
- Record each applied template's provenance independently
- Upgrade each applied template independently, as a reviewable change set

Package: `@gears-frontx/cli` — the `frontx` executable, which ships zero bundled
templates.

### AI Tooling Framework

Equips **AI agents with ecosystem-wide capabilities** and lets templates
contribute their own:

- FrontX-specific skills for agents (create microfrontends, validate templates, generate type definitions, …)
- Template-bundled AI extensions — skills, workflows, guidelines, reference artifacts — alongside the base capabilities
- Automatic discovery and activation of installed-template extensions, with no manual wiring
- AI-driven upgrade orchestration with review gates and impact analysis
- Ecosystem knowledge available at session start, with no training step
- Template-agnostic: ships zero template-specific content

Package: `@gears-frontx/cyber-pilot-kit-frontx` — the AI Tooling Kit.

Together these let an AI agent carry a project from first scaffold through
ongoing extension and version upgrades, while **Template Developers** and
**Project Developers** stay in control of intent and review.

---

## How AI agents and humans collaborate

FrontX is built so an **AI agent can carry a project through its whole
lifecycle** — from first scaffold, through ongoing extension, to version
upgrades — while **humans stay in control of intent and review**:

- **Agents drive the lifecycle** — installing and applying templates, assembling repositories, adding microfrontends, and proposing upgrades through the ecosystem's contracted CLI and AI-tooling surfaces.
- **Humans steer and approve** — Template Developers and Project Developers set intent, and every template upgrade lands as a **reviewable change set** approved before it touches repository files, with non-destructive rollback.
- **Template-bundled AI capabilities activate automatically** — when a template that ships its own skills, workflows, and guidelines is installed, agents gain those capabilities with no manual wiring.

## What FrontX does not include

FrontX is UI-framework-agnostic and ships **no application layer**. The
following are owned by **templates** and the projects assembled from them, never
by the ecosystem:

- UI component libraries, styling, and theming
- Layout choices — which extension domains exist, what they are called, and what occupies them
- State management, internationalization, and authentication
- Build-tooling configuration, and application business logic of any kind

That boundary is what lets one runtime host any application shape while the CLI
and AI Tooling Framework carry a project through its lifecycle.

## Getting Started

### Requirements

- Node.js 24+
- npm 10+

### Install the CLI

```bash
npm install -g @gears-frontx/cli
```

The `frontx` CLI is your entry point to the ecosystem. It resolves templates
from a source you name and manages them across a project's lifecycle; it ships
no templates of its own — what an application *becomes* is defined by whichever
template you apply.

### Scaffold and evolve a project

```bash
# Install a template from a versioned source (host:owner/repo[//subtree]@ref)
frontx install github:acme/starter-repo@v1.0.0

# Install a template that occupies a subtree of a repository
frontx install github:acme/templates//shell@v1.0.0

# List installed templates by the identity each manifest declares
frontx list

# Seed a new repository from an installed template, by that identity -
# which is what the manifest declares, not the repository it came from.
# Here github:acme/starter-repo declares "@acme/web-app" in its manifest.
frontx seed @acme/web-app ./my-app

# Or add a template into an existing repository — writes only the ground the
# template declares, and refuses, naming the paths, where that ground already
# holds content no provenance accounts for
frontx add @acme/web-app ./existing-repo

# Later, upgrade an applied template to a newer version (reviewable change set)
frontx upgrade ./my-app 1.1.0
```

`acme` above is a placeholder: any repository can publish templates. The FrontX
templates are published from
[`constructorfabric/gears-frontx-templates`](https://github.com/constructorfabric/gears-frontx-templates).
See that repository's README for the templates it publishes and the source-spec
to install one.

The CLI records each applied template's provenance under the project's
`.frontx/` and can upgrade each independently. See [QUICK_START.md](QUICK_START.md)
for the full command walkthrough and AI-tooling usage.

### The FrontX CLI

The `frontx` CLI resolves templates from a source you name and manages them
within a project. It bundles no templates of its own.

| Command | Purpose |
|---------|---------|
| `frontx install <spec>` | Install a template from a source-spec (`host:owner/repo[//subtree]@ref`) into the local inventory, tracked under the identity its manifest declares |
| `frontx list [--json]` | List installed templates; `--json` emits one machine-readable record per entry, carrying its identity, pinned reference, source address and the description its manifest declares |
| `frontx seed <templateRef> <targetDir>` | Seed a **new** repository from a template; `templateRef` is the identity shown by `frontx list`, not the repository name |
| `frontx add <templateRef> <targetDir>` | Add a template into an **existing** repository; writes only the ground the template declares and refuses, naming the paths, where that ground already holds content no applied template's provenance accounts for |
| `frontx upgrade <projectRoot> <version>` | Upgrade an applied template (reviewable change set) |
| `frontx validate <templateDir>` | Validate a template manifest for publication |
| `frontx update-local <identity> <spec>` | Refresh a locally installed template from its source |

### AI Tooling

The AI Tooling Framework is delivered as a **Constructor Studio kit**
(`cyber-pilot-kit-frontx`) — the kit *is* the framework's public surface. It is
installed/updated through the **Constructor Studio CLI** (`cfs`), not the
`frontx` CLI and not as an npm dependency. The kit lives inside this monorepo,
so it installs from the repository subdirectory:

```bash
cfs kit install git/https://github.com/constructorfabric/gears-frontx//packages/cyber-pilot-kit-frontx

# or, from a local checkout of this repository
cfs kit install path/packages/cyber-pilot-kit-frontx
```

On install, its `frontx_`-prefixed resources (KIT-1) register in the project's
`.cf-studio/config/core.toml` and become available to agents at session start —
no training step. As shipped today the kit provides four capabilities:

- **Ecosystem fluency and request routing** — a top-level skill (`SKILL.md`), navigation rules (`AGENTS.md`), and boundary guidelines that let agents reason correctly about MFEs, extension domains, source-specs, and the ecosystem/template boundary. Its routing section states which capability serves each kind of FrontX request.
- **Intent-driven project scaffolding** — the developer says what they want built rather than naming a template; the kit matches that intent against the descriptions installed templates declare, applies the chosen set by running `frontx seed`/`frontx add`, and then realizes each unit the intent names through the applied templates' own activated skills. The direct CLI path stays available unchanged for a developer who already holds a reference.
- **Template-extension discovery & activation** — a template can ship its own skills, workflows, guidelines, and reference artifacts; on `frontx install`, the kit discovers and activates them in the consuming project, with no manual wiring.
- **AI-driven upgrade orchestration** — the kit drives template upgrades over the CLI's machine-readable command surface (`frontx upgrade --json`), layering review gates, migration analysis, and downstream impact assessment onto the direct CLI path.

Standalone skills such as creating a microfrontend or generating type
definitions are PRD-declared (under the `project`/`mfe` namespaces) but not yet
shipped as discrete skills. The framework is template-agnostic and ships zero
template-specific content; template-specific capabilities arrive through
template bundles.

### Repository Structure

This repository ships the **ecosystem** — the runtime, type system, API layer,
CLI, and AI kit. What an application *becomes* is defined by templates, which
live and version outside this repository, in the templates repository linked
above.

```bash
FrontX/                              # Ecosystem repository root
├── architecture/                   # Constructor Studio SDLC artifacts (PRD, DESIGN, ADR, features)
├── packages/                       # Ecosystem packages (published to npm)
│   ├── mfes/                       # Published library (core, standalone): MFE runtime — registration, loading, mounting, isolation
│   ├── gts-plugin/                 # Published library (core, standalone): GTS default type-system provider plugin
│   ├── api/                        # Published library (core, standalone): API communication protocols + service registry
│   ├── telemetry/                  # Published library (core, standalone): browser telemetry SDK
│   ├── ui-kit/                     # Published library (standalone): UI components (artifact chain is recorded debt)
│   ├── cli/                        # Projects orchestration: template-resolution CLI (`frontx`)
│   └── cyber-pilot-kit-frontx/     # Projects orchestration: AI Tooling Kit
├── internal/                       # Internal build/lint config workspaces
├── scripts/                        # Architecture, version-policy, and test tooling
└── tsconfig.json                   # TypeScript config (ecosystem packages only)
```

### Developing the Ecosystem

To work on the ecosystem packages themselves — the runtime, type system, API
layer, CLI, and AI kit:

```bash
git clone https://github.com/constructorfabric/gears-frontx.git
cd gears-frontx
npm ci
npm run build:packages       # build all ecosystem packages
npm run test:unit            # unit tests across packages/* and scripts/
npm run arch:check           # architecture-boundary gates
npm run arch:deps            # dependency-boundary rules
```

`npm run test:unit` fans out to every ecosystem package under `packages/*` and to
the repo-root `scripts/` toolchain; use
`npm run test:unit:watch` while iterating. Contributors should read the
[Validation](CONTRIBUTING.md#validation) section in [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- **[DECOMPOSITION.md](architecture/DECOMPOSITION.md)**: Project roadmap and feature decomposition
- **[PRD.md](architecture/PRD.md)**: Core philosophy, principles, and values
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: How to contribute to the project (includes validation and unit-test commands)

## Community & Support

- **GitHub Issues**: Bug reports and feature requests
- **Discussions**: Architecture questions and best practices [discord](https://discord.com/channels/1364665811125670018/1428468824130191410)
- **Examples**: TODO


## License

FrontX is available under the [Apache License 2.0](LICENSE).

## Credits

Built with:
- [TypeScript](https://www.typescriptlang.org/) - Type safety across the ecosystem
- [Vitest](https://vitest.dev/) - Unit testing
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) - Architecture-boundary enforcement

UI framework, styling, component library, and build-target choices are made by
each template — FrontX itself is UI-framework-agnostic.
