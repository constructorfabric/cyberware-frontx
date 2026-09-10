# FrontX Standard Template

A complete, runnable **FrontX application** — a host shell wired to the FrontX
microfrontend runtime, a set of demo microfrontends, solution packages
(theming, i18n, state, auth, a development Studio), and the build/test tooling
to develop and ship it.

You are (typically) reading this inside a project that was scaffolded from this
template with the FrontX CLI. `seed` bootstraps a project from the CLI's
built-in official defaults, which only resolve inside this monorepo checkout —
useful for developing the templates themselves. Each default is a `path:`
origin resolved against the directory being seeded, so seeding a bare empty
folder has nothing to resolve against; the template must be vendored into it
first. See [QUICK_START.md § 4, "Or seed a new project from the built-in
defaults"](../QUICK_START.md#4-or-seed-a-new-project-from-the-built-in-defaults)
in the root of this repository for the exact command — a plain recursive copy
also drags in `node_modules`, `dist`, `dist-lib`, and `.frontx`, so vendoring
uses `git archive` to transfer tracked content only.

Anywhere else — a fresh external folder — `register` a remote origin and
`apply` it instead, which is the path that actually works outside this
checkout:

```bash
frontx register <origin>
frontx apply --input '{"templates":{"@gears-frontx/frontx-template-shell":["."]}}'
```

From here on, this repository is **your application**. This template gives you a
working starting point; what you build on top is yours.

## What you get

- **A host application** (`src-app/app`) — the shell that boots the FrontX
  runtime, renders the layout (menu, header, footer, screen container), and
  mounts microfrontends on demand.
- **The MFE runtime, pre-wired** — screens are contributed by microfrontends and
  appear in the menu automatically; no central screen registry to maintain.
- **Demo microfrontends** (`src-app/mfe_packages`, added separately via
  `frontx-template-mfe`) — `demo-mfe` (Hello World, Profile, Current Theme,
  UIKit Elements, Widgets Host), a minimal `_blank-mfe`
  to copy from, and two widget fixtures. A shell-only seed has zero MFEs; the
  host, build, and manifest pipeline all work with none present. These ship to be
  read and copied and stay out of your running app; `src-app/mfe_packages/README.md`
  says how, and how to run them anyway.
- **Solution packages** (`packages/`) — `react`, `framework`, `state`, `i18n`,
  `studio`, `auth`: the application-layer libraries the FrontX ecosystem
  deliberately does not bundle.
- **Theming, i18n, and a dev Studio** — CSS-variable theme tokens, translation
  scaffolding, and an in-app FrontX Studio panel for toggling mock APIs, themes,
  and language during development.

## Who it's for

Applications built from this template target teams delivering modern SaaS
control panels:

- **Cloud SaaS providers** needing multitenant architectures with tenant isolation and customization
- **Service vendors** building white-label solutions with per-customer branding and feature sets
- **Corporate software vendors** building control panels for complex business applications
- **System integrators** creating pluggable control panels with third-party integrations
- **Platform/IT teams** building internal tools and admin portals with role-based access control

## What you can build with it

This template is designed for the hard problems of modern control-panel UIs and
gives you a foundation for:

- **Multitenancy** — isolated data, configuration, and branding per customer/organization
- **Role-based access control** — permissions that show/hide/disable UI by user role
- **White-label support** — per-tenant branding and themes via the theme registry
- **Plugin ecosystems** — runtime-composable microfrontends without core code changes
- **Global enablement** — multi-language, RTL/LTR, locale-aware formatting
- **Flexible builds** — web today, with room to grow to desktop / on-prem / cloud
- **High customization** — configurable views, dashboards, and workflows

Its aim is to make powerful in-product UI development approachable — as capable
as hand-rolled control-panel engineering, but structured so AI agents and humans
can build and evolve screens together.

## Capabilities

- **Human-configurable UI core** — layout, styles, and build targets
- **Layout-safe screen generation** — AI/human code separation
- **Component & style consistency** — design-system enforcement
- **Modular screen architecture** — composable building blocks
- **Pluggable UI microfrontends** — a secure plugin ecosystem
- **Shared/private store & global/local state** — performance and offline-first
- **Unified API layer** — typed contracts and observability
- **Security, multitenancy & RBAC** — enterprise SSO and compliance foundations
- **Internationalization & localization** — global-deployment ready
- **Testing & quality gates** — an automated QA pipeline

## Building UI with AI

This template is optimized for AI + human co-creation of UI, in three stages:

1. **Drafts (AI-driven)** — an AI agent generates initial screen layouts from
   prompts, requirements, and any existing API specs. Multiple variants can be
   generated and compared; drafts stay isolated from production code.
2. **Mockups (AI-assisted, human-refined)** — designers and PMs refine drafts
   with visual and interaction detail, with the agent assisting on component
   selection and style consistency.
3. **Production (human-polished)** — engineers integrate mockups with business
   logic and APIs, then review, test, and ship. Production screens inherit the
   template's theming, i18n, and access-control capabilities.

The result: up to 10x faster UI development with maintainable, enterprise-grade
code.

## Requirements

- Node.js 24+
- npm 10+

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Build the solution packages (the library builds first, via prebuild:packages)
npm run build:packages

# 3. Start everything — host + any MFE dev servers present
npm run dev:all

# 4. Open the app
#    Host:  http://localhost:5173
```

A shell-only project has no MFEs yet, so `dev:all` just runs the host, and
`generate:mfe-manifests` writes an empty manifest set — both expected, not
errors. Add MFE packages by registering and applying `frontx-template-mfe`
at `src-app/mfe_packages`:

```bash
frontx register <mfe-origin>
frontx apply --input '{"templates":{"@gears-frontx/frontx-template-mfe":["src-app/mfe_packages"]}}'
```

then run `npm install` again — applying a new template changes what the
workspace glob matches, so the lock must be regenerated — before their
preview ports (`:3001` demo, `:3099` blank, `:3201`/`:3202` widget fixtures)
come up alongside the host.

The FrontX ecosystem packages (`@gears-frontx/mfes`, `@gears-frontx/gts-plugin`,
`@gears-frontx/api`) resolve from the npm registry at exact pinned versions.

See **[QUICK_START.md](QUICK_START.md)** for the hands-on development workflow —
creating screens and microfrontends, layout, state, styling, and commands.

## Project structure

```text
my-app/
├── src-app/                 # Host application
│   ├── app/                 # Shell: App, providers, wiring
│   │   ├── components/ui/   # App-owned UI primitives (shadcn)
│   │   ├── layout/          # CoreLayout: menu, header, footer, screen slot
│   │   ├── mfe/             # MFE bootstrap + generated manifests
│   │   ├── themes/          # Theme tokens and registries
│   │   └── globals.css      # Tailwind entry + theme CSS variables
│   └── mfe_packages/        # Microfrontends (empty until `frontx-template-mfe` is applied)
├── src/                     # Shared solution lib (api, build, gts)
├── packages/                # Solution packages: react, framework, state, i18n, studio, auth
├── public/                  # Static assets + generated-mfe-manifests.json
├── scripts/                 # dev-all, build-mfes, manifest generation
├── tailwind.config.ts       # TailwindCSS configuration
├── vite.config.ts           # Host Vite + Module Federation config
└── .frontx/                 # Template provenance (managed by the frontx CLI)
```

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev:all` | Build MFEs, then run the host + every MFE preview server together |
| `npm run dev` | Host only (rebuilds packages + MFEs, then Vite dev server) |
| `npm run build` | Full production build |
| `npm run build:packages` | Build the solution workspace packages |
| `npm run build:mfes` | Build all microfrontend packages |
| `npm run generate:mfe-manifests` | Regenerate the host's MFE manifest index |
| `npm run preview` | Preview a production build |
| `npm run type-check` | Type-check the host app, packages, and MFEs |
| `npm run lint` | ESLint across the project |
| `npm run arch:deps` | Dependency-boundary rules check |
| `npm run test:unit` | Unit tests (package + host app + workspace MFEs) |

## Tech stack

- **React** + **TypeScript** + **Vite** with **Module Federation** for MFEs
- **Tailwind CSS** with CSS-variable theme tokens (shadcn/ui primitives)
- Built on the FrontX ecosystem: `@gears-frontx/mfes` (runtime),
  `@gears-frontx/gts-plugin` (type system), `@gears-frontx/api` (API layer)

## Upgrading

This project records its template provenance under `.frontx/`. When a newer
template version is released, upgrade with the FrontX CLI — changes are shown as
a reviewable change set before anything is written:

```bash
frontx upgrade @gears-frontx/frontx-template-shell <new-origin>
```

`upgrade` acts on one registered template name across every target it has been
applied to, so a project with more than one template registered (shell plus
`@gears-frontx/frontx-template-mfe`, say) upgrades each independently by name — there is no
restriction on upgrading once a second template has been added. `--restore`
reverses the immediately preceding upgrade for a name.
