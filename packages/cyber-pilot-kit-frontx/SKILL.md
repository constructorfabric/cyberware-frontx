---
name: frontx
description: "FrontX ecosystem AI capabilities: MFE runtime substrate, GTS type system, API protocol surface, CLI scaffolding, and AI tooling kit. Routes a FrontX request to the capability that serves it. Solution-agnostic base only."
---

# FrontX AI Tooling Kit

Provides AI agents with ecosystem-level fluency for FrontX projects, and routes
a FrontX request to the capability that serves it.

<!-- frontx:routing:begin -->

## Request Routing

Read this before answering a FrontX request. Decide from the request itself and
from whether the working directory already holds applied templates - a
`.frontx/project.json` whose `templates[name]` carries a non-empty `targets[]`
for some name means it does.

| The request is to | Served by |
|---|---|
| Create a new project from what the developer wants to be built, holding no reference to start from | `frontx_project_scaffolding` - matches the stated intent against what the installed inventory declares, applies the chosen set through the `frontx` executable, and realizes the units the intent names |
| Apply a specific template whose reference the developer already holds | The `frontx` executable directly - `frontx register <origin>` to pin it under the current project, then `frontx apply --input '<batch>'` (optionally previewed, unchanged, with `frontx assemble --input '<batch>'`). This path is unchanged and needs no capability here |
| Add a unit inside ground an applied template already owns - one more screen, one more isolated UI unit | The skills that applied template activates in this project, discovered under `.frontx/ai/<template-identity>/`. The base kit adds no unit itself |
| Move an applied template to a newer version | `frontx upgrade <templateName> <new-origin> [--yes] [--json]` directly, or `frontx upgrade <templateName> --restore [--yes] [--json]` to move it back to its immediately preceding origin. Its `--json` form without `--yes` emits the change set as `CONFIRMATION_REQUIRED` for review and takes a decision back via `--yes` before anything is applied |
| Understand the ecosystem - runtime substrate, type system, API surface, package boundaries | This document and the guidelines it ships with |
| Check that a template is publishable | The `frontx` executable directly - `frontx validate <templateDir>` |
| Check that the current project's `.frontx/project.json` still matches reality | The `frontx` executable directly - `frontx validate --project [--json]` |

If the request matches none of these, say so and name the capabilities above.
Do not route it to the closest one; a capability applied to a request it does
not serve produces a confident wrong answer.

<!-- frontx:routing:end -->

## Packages

| Package | Scope | Purpose |
|---|---|---|
| `@gears-frontx/mfes` | Ecosystem | MFE runtime substrate — registration, loading, isolation, mediation |
| `@gears-frontx/gts-plugin` | Ecosystem | GTS default type-system plugin |
| `@gears-frontx/api` | Ecosystem | API protocol surface — handler-agnostic fetch, cache sharing |
| `@gears-frontx/cli` | Ecosystem | Template resolution CLI — zero bundled template content (CLI-1) |
| `@gears-frontx/cyber-pilot-kit-frontx` | Ecosystem | This AI tooling kit |

## Architecture Principles

- **CLI-1**: CLI has zero dependency on any template; resolves by source-spec at runtime.
- **KIT-1**: All resource identifiers in this kit carry the `frontx_` prefix.
- **MFES-2 / MFES-3**: MFE packages do not depend on template packages.
- **API-1**: API package is handler-agnostic; mocks are template territory.
- **GTS-PLUGIN-2**: GTS plugin ships no solution schemas; schemas are template territory.

## Key Concepts

- **MFE** (Microfrontend): isolated UI unit registered through the MFE registry.
- **Extension domain**: capability grouping that governs which MFEs may mount in a given area.
- **Source-spec**: `host:owner/repo[//subtree]@ref` — the address the CLI resolves to a template at runtime; the optional `//subtree` addresses a template occupying a subdirectory of a repository.
- **Template**: an external project-type deliverable (not bundled into core packages).
- **Constructor Studio kit**: declarative content bundle installable via `cfs kit install`.
