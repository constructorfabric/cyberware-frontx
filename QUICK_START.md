# FrontX Quick Start Guide

> **TARGET AUDIENCE:** Humans
> **PURPOSE:** Quick start guide for developers using the FrontX ecosystem

FrontX is an **ecosystem for AI-driven creation of frontend projects**. It does
not prescribe what your app looks like — that comes from **templates**. Instead
it provides three capability sets that let AI agents and their human
collaborators scaffold, extend, and evolve a project against stable, contracted
capabilities.

## What FrontX Provides

- **Core Framework.** Makes an application runtime-extensible by
  composable microfrontends over a substrate for typed entities.
  Packages: `@gears-frontx/mfes`, `@gears-frontx/gts-plugin`, `@gears-frontx/api`.
- **CLI.** Owns the full lifecycle of assembling and evolving a
  repository from templates. Package: `@gears-frontx/cli` (the `frontx` binary).
- **AI Tooling Framework.** Equips AI agents with ecosystem
  capabilities and lets templates contribute their own.
  Package: `@gears-frontx/cyber-pilot-kit-frontx`.

Everything below is how you drive those capabilities. What each project
*becomes* is owned by the template you apply, not by the ecosystem.

## Install the CLI

```bash
npm install -g @gears-frontx/cli
```

Requirements: Node.js 24+, npm 10+. Verify with `frontx help`.

## Using the CLI

The CLI resolves templates from a source you name, into a local inventory, then
applies them to repositories. It bundles no templates of its own.

### 1. Install a template

Templates are addressed by a source-spec, `host:owner/repo[//subtree]@ref`. The optional
`//subtree` segment addresses a template that occupies a subtree of a repository, so
one repository can publish several templates:

```bash
frontx install github:acme/my-template@v1.0.0        # template at the repository root
frontx install github:acme/templates//shell@v1.0.0   # template in the shell/ subtree
frontx list          # show built-in defaults, this project's registered templates, and the local inventory
frontx list --json   # {"ok":true,"data":{"defaults":[...],"registered":[...],"installed":[...]}}
```

A template is tracked under the identity its own `frontx-template.json` declares, not under
the repository name. Installing a template whose identity is already taken by a different
source fails rather than overwriting the installed one.

### 2. Register a template's origin

Before a project can apply a template, register its origin — this creates
`.frontx/project.json` on first use:

```bash
# A remote origin is pinned to the exact commit the fetch settled on
frontx register github:acme/my-template@v1.0.0

# A path: origin naming a folder inside the project is recorded as given,
# unpinned — there is nothing external to pin against
frontx register path:vendor/my-local-template
```

Registering the identical origin again is a no-op. Registering a *different*
origin for an already-registered name fails unless `--replace` is given, and
`--replace` itself refuses once the name has any applied target — `upgrade`
(below) is how an applied template's origin changes.

### 3. Apply the template to a target

`apply` and `assemble` both take an explicit, target-keyed batch —
`{"templates": {"<name>": ["<target>", ...]}}` — naming, for each already-registered
template, the target or targets to apply it to:

```bash
# Preview the batch first — resolves every named template and checks ownership
# geometry against everything already applied; writes nothing
frontx assemble --input '{"templates":{"@acme/my-template":["."]}}'

# Apply the identical batch for real
frontx apply --input '{"templates":{"@acme/my-template":["."]}}'
```

A repository can be assembled from **multiple independently-registered
templates**; conflicting assembly is detected and prevented before any file is
written. `apply` writes only the ground each template declares, and refuses —
naming the paths — where that ground already holds content the batch does not
account for, unless `--adopt-existing` is given to adopt it as-is. The exact
rule and the reasoning behind it live in
[`architecture/features/cli-scaffolding/FEATURE.md`](architecture/features/cli-scaffolding/FEATURE.md).

### 4. Or seed a new project from the built-in defaults

`seed` creates `.frontx/project.json`, auto-registers each named template, and
applies the batch in one call — but it accepts **only the CLI's own built-in
default templates** (there is nothing else yet registered for a virgin
directory to resolve a batch against), and in this repository's own build
those defaults are `path:` origins, which resolve **relative to the directory
being seeded** — not to this monorepo's checkout, wherever `seed` happens to
be invoked from. A bare empty target directory has nothing at that relative
path to resolve against and `seed` refuses it; the template must already be
vendored into the target first:

```bash
# Vendor the template into the target directory yourself, then seed on top of
# it — <default-name> must be one of the CLI's built-in defaults (see the
# "defaults" set in `frontx list` / `frontx list --json`), and the folder you
# copy it into must be that default's own path: origin, relative to
# ./my-app (here, "template-shell" — see that default's own path in
# `packages/cli/src/generated/official-defaults.ts`)
mkdir -p ./my-app/template-shell
cp -R template-shell/. ./my-app/template-shell/
frontx seed ./my-app --input '{"templates":{"@gears-frontx/frontx-template-shell":["."]}}'
```

Outside this checkout there is nothing to vendor from, so `register` a remote
origin and `apply` it instead (above) — the path that works anywhere.

`seed` refuses a directory that already carries a `.frontx/project.json` — a
project once seeded is extended through `apply`, never re-seeded.

### 5. Upgrade a registered template

```bash
# Interactive: review the change set, then approve
frontx upgrade @acme/my-template github:acme/my-template@1.1.0

# Non-interactive (CI/agent): accept automatically
frontx upgrade @acme/my-template github:acme/my-template@1.1.0 --yes

# Reverse the most recent upgrade, back to the origin it just left
frontx upgrade @acme/my-template --restore
```

Each registered template upgrades **independently**: the CLI diffs every one
of its applied targets against the new origin's payload, presents the
resulting whole-file operation plan (`ADD`/`REPLACE`/`REMOVE`/`KEEP_LOCAL`/
`UNCHANGED` — never a textual diff) for review, and commits it atomically
across every target once approved. `.frontx/project.json` records the origin
a name is upgrading (or restoring) away from, so exactly one generation is
reversible with `--restore`.

### 6. Delete an applied target

```bash
frontx delete ./existing-repo/packages/mfe-a
```

`delete` computes what it would remove and what it would preserve, prompts for
confirmation (defaulting to No), and only then removes the target's ground
from disk and its entry from `.frontx/project.json`. `--dry-run` reports the
same plan without deleting anything or requiring confirmation. Once every
target under a name has been deleted, `frontx unregister <name>` removes the
now-targetless registration; unregistering a name that still has applied
targets is refused, naming them.

### 7. Manage the project's own reserved paths

A project can carve out paths no template may claim:

```bash
frontx ownership add ./docs
frontx ownership list
frontx ownership remove ./docs
```

These `projectOwnedRoots` are checked by the same conflict check that guards
`assemble`/`apply`/`seed`, so a batch entry that would land on one is refused
before anything is written.

### 8. Validate a template, or the project itself

Validate a template's structure — including that its ownership boundaries are
well-formed — against the publication contract before publishing:

```bash
frontx validate ./path/to/template
```

Validate the current project's `.frontx/project.json` against reality — every
registered origin still resolvable, every recorded version still matching its
manifest, and no ownership-geometry conflict among recorded targets:

```bash
frontx validate --project
```

### CLI command reference

| Command | Purpose |
|---------|---------|
| `frontx install <spec>` | Install a template from `host:owner/repo[//subtree]@ref` into the inventory |
| `frontx list [--json]` | List built-in defaults, this project's registered templates, and the local inventory; `--json` emits `{"ok":true,"data":{"defaults":[...],"registered":[...],"installed":[...]}}` |
| `frontx register <origin> [--replace] [--json]` | Register a template's origin under the current project |
| `frontx unregister <name> [--json]` | Unregister a template that has no applied targets |
| `frontx assemble --input <batch-json> [--json]` | Preview an explicit batch against every registered template's declared ownership; writes nothing |
| `frontx apply --input <batch-json> [--adopt-existing] [--json]` | Apply an explicit batch into the current project |
| `frontx seed <dir> --input <batch-json> [--adopt-existing] [--json]` | Bootstrap a **new** project directory from the CLI's built-in default templates only |
| `frontx upgrade <name> <origin> [--yes] [--json]` | Upgrade a registered template to a new origin (reviewable change set) |
| `frontx upgrade <name> --restore [--yes] [--json]` | Reverse a template's most recent upgrade |
| `frontx delete <target> [--yes] [--dry-run] [--json]` | Delete an applied template target; confirmation-gated |
| `frontx ownership add\|remove\|list <path> [--json]` | Manage the project's own reserved paths (`projectOwnedRoots`) |
| `frontx validate <templateDir> [--json]` | Validate a template for publication |
| `frontx validate --project [--json]` | Validate `.frontx/project.json` against the registry, the local inventory, and the filesystem |
| `frontx update-local <identity> <spec> [--json]` | Refresh a locally installed template from its source |
| `frontx help` | Show the usage summary |

Exit codes: `0` success, `1` user error, `2` internal error.

A destructive command's `--json` mode never prompts: without `--yes` it
returns `CONFIRMATION_REQUIRED` with the computed plan, and re-issuing the
identical command with `--yes` recomputes that plan from scratch before
acting on it — it never trusts the first call's result. Every command's
`--json` mode emits exactly one JSON value on stdout — either
`{"ok":true,"data":...}` or `{"ok":false,"error":{"code","message","details"}}`
— with a non-zero exit on failure.

## The Core Framework

An application built on FrontX becomes **runtime-extensible by microfrontends**.
The Core Framework provides the substrate; a template wires it into a concrete
app. Its guarantees:

- **Registration & loading** — microfrontends register with the application and
  load on demand (`@gears-frontx/mfes`).
- **Extension domains** — named slots a microfrontend can occupy; a domain may
  allow one or multiple occupants.
- **Typed entities** — microfrontends and their extensions are validated against
  type definitions at registration; applications register their own type
  definitions at build time or at runtime (`@gears-frontx/gts-plugin`).
- **Host communication** — microfrontends communicate with the host and react to
  host state changes over a bridge.
- **API layer** — typed API protocols and a service registry (`@gears-frontx/api`).
- **UI-framework-agnostic** — the framework never constrains your UI choice; UI
  libraries, styling, layout, and state management are the template's concern.

You consume these packages from within a template/application; the ecosystem
ships no application, host, or UI of its own.

## AI Tooling

The AI Tooling Framework is delivered as a **Constructor Studio kit**
(`cyber-pilot-kit-frontx`) — the kit *is* the framework's public surface. It is
published to npm as `@gears-frontx/cyber-pilot-kit-frontx` and installed and
updated through the **Constructor Studio CLI** (`cfs`), not npm. On install, its `frontx_`-prefixed resources register in
the project's `.cf-studio/config/core.toml` and become available to agents at
session start — no training step.

### Install the kit

```bash
# Install the FrontX AI Tooling kit into a project (via Constructor Studio, not the frontx CLI).
# The kit lives inside this monorepo, so install it from the repository subdirectory:
cfs kit install git/https://github.com/constructorfabric/gears-frontx//packages/cyber-pilot-kit-frontx

# ...or from a local checkout of this repository:
cfs kit install path/packages/cyber-pilot-kit-frontx

# Update it later to a newer version
cfs kit update cyber-pilot-kit-frontx
```

Every resource the kit installs carries the `frontx_` prefix (KIT-1), so it
cannot collide with other kits (e.g. the SDLC kit) installed in the same
project. As shipped today the kit provides four concrete capabilities.

### Ecosystem fluency and request routing

The kit hands agents ecosystem knowledge at session start: a top-level skill
(`SKILL.md`) covering the package surface, architecture principles, and key
concepts; navigation rules (`AGENTS.md`); and boundary guidelines
(`guidelines/`). This is what lets an agent reason correctly about MFEs,
extension domains, source-specs, and the ecosystem/template boundary without
being taught.

`SKILL.md` also carries a **routing** section: for each kind of FrontX request it
states which capability serves it — creating a project, applying a reference the
developer already holds, adding a unit inside ground an applied template owns,
upgrading, or validating a template. A request matching none of them is reported
as unmatched rather than routed to the nearest capability.

### Intent-driven project scaffolding

The developer states what they want built — "a console with two screens, one
showing X and one showing Y" — instead of naming a template they would have to
know already. The skill selects what to apply by matching that intent against
the **descriptions** installed templates declare in their manifests, applies the
chosen set by running the `frontx` commands, and then realizes each unit the
intent named through the applied templates' own activated skills. It refuses
rather than guessing when nothing is installed, nothing matches, or two
candidates tie — writing no files in any of those cases — and it learns what is
installed only by invoking the CLI, never by reading the CLI's own storage.

It is one of two paths to the same result, never a replacement for the other —
see the note below.

The procedure itself lives in
[`packages/cyber-pilot-kit-frontx/skills/project-scaffolding/SKILL.md`](packages/cyber-pilot-kit-frontx/skills/project-scaffolding/SKILL.md),
which is what the agent follows — read it there rather than here, so there is
one copy to keep true.

### Template-extension discovery & activation

A template can ship its own AI capabilities — skills, workflows, guidelines, and
reference artifacts. When you `frontx install` such a template, the kit
**discovers and activates** those extensions in the consuming project
(`src/extensions/`), with no manual wiring: installed-template capabilities
simply become available to agents.

### AI-driven upgrade orchestration

Beyond the direct `frontx upgrade` path, the kit **orchestrates** upgrades over
the CLI's machine-readable command surface (`src/upgrade-orchestration/`):

```bash
frontx upgrade @acme/my-template github:acme/my-template@1.1.0 --json
```

There is no stdin exchange: the surface is a two-call protocol. The first
`--json` invocation above writes nothing and returns `CONFIRMATION_REQUIRED`
with the computed plan in `details.plan`; approval is expressed by re-issuing
the identical command with `--yes` appended, which recomputes the plan and
acts on it. That two-call shape is what lets the kit layer review gates,
migration analysis, and downstream impact assessment onto the change set
between the two calls, before anything is applied.

> **Two paths, one engine.** Scaffolding is reachable both ways. State an intent
> and the kit's scaffolding skill chooses and applies for you; hold a template
> reference already and `frontx register` + `frontx apply` apply it directly,
> the same CLI path the skill itself drives. The kit adds the selection, the
> plan and the per-unit realization — never a second way to write a project,
> since both paths end in the same CLI commands. Validating a template
> (`frontx validate`) remains a direct CLI operation with no kit capability
> over it.

### Roadmap

The PRD also scopes standalone ecosystem skills — creating a microfrontend,
generating type definitions, and other ecosystem-scoped operations — to be
surfaced under the `project` and `mfe` command namespaces. These are declared
capabilities, not yet shipped as discrete skills; today those operations follow
the conventions documented in the ecosystem guidelines.

The framework is **template-agnostic** and ships zero template-specific content;
all template-specific capabilities arrive through template bundles.

## Developing the Ecosystem

To work on the ecosystem packages themselves, clone this repository:

```bash
git clone https://github.com/cyberfabric/FrontX.git
cd FrontX
npm ci
npm run build:packages   # build every ecosystem package
```

### Common commands

```bash
# Build
npm run build:packages        # build all ecosystem packages
npm run build --workspace=@gears-frontx/cli   # build a single package

# Validation (run before commits)
npm run lint                  # ESLint across the repo
npm run type-check            # type-check all ecosystem packages
npm run arch:check            # architecture tests (must pass)
npm run arch:deps             # dependency-boundary rules
npm run arch:unused           # unused-code report (knip); config hints fail the run

# Tests
npm run test:unit             # all package unit tests (packages/*)
npm run test:unit:watch       # watch mode
```

### Boundaries to respect

The ecosystem enforces package boundaries via ESLint + dependency-cruiser +
`scripts/test-architecture.ts`. In short: the Core Framework packages must not
carry solution-specific content (type-format literals, shared-property ids, or
layout-domain values) — those belong to templates and consuming applications.
Run `npm run arch:check` and `npm run arch:deps` before committing.

## Development Best Practices

1. **Keep the ecosystem template-agnostic** — no app, UI, layout, theme, or
   business-domain content in `packages/*`.
2. **Type everything** — no `any`, explicit return types, proper generics.
3. **Respect versioning** — the ecosystem commits to semantic-versioning
   discipline so breaking changes stay isolated from consumers.
4. **Prefer the contracts** — target the stable, contracted capabilities rather
   than internal implementation details.
5. **Let templates own the app** — screens, styling, and state are template
   concerns; the ecosystem provides only the substrate and tooling.

## Next Steps

- Read [PRD.md](./architecture/PRD.md) for the product vision and the full
  capability inventory
- Review [DESIGN.md](./architecture/DESIGN.md) for the ecosystem layers and
  package boundaries; each package's own design lives in
  `packages/<pkg>/architecture/`
- Explore the packages under `packages/`

## Getting Help

- Check the architecture docs under `architecture/`
- Run `frontx help` for the CLI command surface
- Refer to each package's types for its public API
