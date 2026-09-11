---
name: frontx-template-mfe-add-mfe-package
description: "Scaffold a new microfrontend (MFE) package inside template-mfe — copy the _blank-mfe reference scaffold, assign a port and GTS identifiers that conform to this bundle's naming scheme, and register it with the shell's manifest pipeline."
---

# Add an MFE Package (template-mfe)

This skill is specific to **template-mfe**. It relies on template-mfe's concrete
scaffold (`src-app/mfe_packages/_blank-mfe/`) and manifest pipeline
(`scripts/generate-mfe-manifests.ts`, `public/generated-mfe-manifests.json`) — none of
which is base-kit (F15) content, which stays solution-agnostic.

**Precondition:** requires an applied `template-shell` (root `package.json`,
`src-app/app/`, and the build/test/manifest pipeline) already in the project —
`template-mfe` only adds MFE packages into that shell; it does not scaffold a
repository standalone.

## When to use

The Project Developer wants to add a new microfrontend screen to a project that
already has `template-shell` applied (a new screenset entry, a new isolated UI unit
to mount into an extension domain). When the task adds two or more MFE packages,
follow `workflows/add-mfe-packages-parallel.md` in this bundle: it phases this
skill's steps so the per-package work runs concurrently — this skill remains the
authority on each step.

## What template-mfe provides

- A working, disposable MFE scaffold at `src-app/mfe_packages/_blank-mfe/`: Shadow DOM
  isolation, bridge communication (`ChildMfeBridge`), theme/language shared-property
  subscriptions, per-MFE i18n, and a Module Federation `vite.config.ts` already wired.
- An `mfe.json` manifest describing the MFE's Module Federation `manifest`, its
  `entries[]` (exposed modules + required shared properties), and its `extensions[]`
  (domain + presentation metadata for the screen it contributes).
- `npm run generate:mfe-manifests` (`scripts/generate-mfe-manifests.ts`), which reads
  every MFE package's built manifest and aggregates them into
  `public/generated-mfe-manifests.json` — the file every FrontX app instance (host or
  nested) reads at runtime to discover MFEs.
- `npm run dev:all` (`scripts/dev-all.ts`), which auto-discovers any package under
  `src-app/mfe_packages/*/package.json` by reading the port out of its `dev`/`preview`
  script — no manual wiring required once the package exists.
- Packages template-mfe ships as its own worked examples, and the scaffold itself,
  all declare `"templateExample": true` in their `mfe.json`. Manifest generation,
  `dev:all`, and `type-check:mfe` all leave those out, so a project runs and
  type-checks the packages its developer added and nothing else;
  `FRONTX_INCLUDE_TEMPLATE_EXAMPLES=1` puts them back for anyone wanting to see
  the shipped examples run and compile.

## Steps

1. **Copy the scaffold and strip its example flag** — one step, because a copy
   that keeps the flag registers nothing and nothing fails to say so. Name the
   new directory after the screenset/screen being added:

   ```bash
   NEW=src-app/mfe_packages/{name}-mfe
   cp -r src-app/mfe_packages/_blank-mfe "$NEW"
   node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f,"utf8"));delete m.templateExample;fs.writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$NEW/mfe.json"
   ```

   `_blank-mfe/mfe.json` declares `"templateExample": true`, which is what keeps
   the scaffold itself out of the running application; a copy that keeps it is
   invisible the same way. Such a copy still installs and still runs its own
   tests, and `type-check:mfe` skips it by default too, so it compiles only when
   the run sets `FRONTX_INCLUDE_TEMPLATE_EXAMPLES=1`. The only report is one line
   in the `generate:mfe-manifests` / `dev:all` / `type-check:mfe` output naming
   what was left out - nothing fails, and the new screen is simply absent from
   the menu. Verify the strip landed before moving on:

   ```bash
   grep -q templateExample "$NEW/mfe.json" && echo "FLAG STILL PRESENT - remove it" || echo "flag stripped"
   ```
2. **Pick a free port** — template-mfe's convention reserves `3001` for `demo-mfe`;
   pick the next free `30N0` slot (`3010`, `3020`, ...) and set it in both the `dev`
   (`vite --port {port}`) and `preview` (`vite preview --port {port}`) scripts of the
   copied package's `package.json`. `dev:all`'s port auto-discovery depends on the
   `preview`/`dev` script carrying `--port <N>` literally.
3. **Rename package identity** — update the copied `package.json` `name` and the
   Module Federation `name` in `vite.config.ts` (camelCase, must match across both).
4. **Assign GTS IDs** — rewrite every placeholder ID in `mfe.json` following
   template-mfe's ID taxonomy (see the `gts-id-conventions` guideline and the
   `gts-id-patterns-reference` reference artifact in this same bundle): a manifest ID,
   one entry ID per exposed module, and one extension ID per screen contributed to a
   domain (typically `gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1`
   for a screen-domain contribution).
5. **Implement the lifecycle** — `src/lifecycle.tsx` extends `ThemeAwareReactLifecycle`
   from `@gears-frontx/react`; the MFE's own `init.ts` builds its app instance with
   `createFrontX().use(effects()).use(queryCacheShared()).use(mock()).build()` so it
   joins the host's shared `QueryClient` without owning a second one.
6. **Build the screen's UI from `@gears-frontx/ui-kit`** — the shell installs the
   kit, and its installed `llms.txt` is the component inventory. The kit is the
   only component source: no other component library, and no shadcn components
   or APIs — the kit follows shadcn conventions, so shadcn patterns may guide
   which kit component maps to a UI pattern, nothing more. Confirm the copied
   package declares `@gears-frontx/ui-kit` in its dependencies (add it if the
   scaffold copy predates the kit migration and lacks it). Before writing any
   markup, produce an explicit plan: map every visible UI pattern on the
   screen to a concrete kit component or approved composition from the
   inventory, and record the screen's grid columns, alignment anchors, and
   responsive breakpoints. A pattern with no kit mapping is reported in the
   plan as a gap — never guessed at or recreated locally. Then compose from
   kit components and semantic tokens; hand-rolling a
   look-alike of an existing kit component is a defect, not a style choice. If a
   design-contract bundle is installed in the project — any AI bundle that ships a
   `generate-interface` skill (check for `.frontx/ai/*/*/skills/generate-interface/`) —
   that skill and its design contract govern how the screen is generated — follow
   them. If none is installed, say so in the plan: the screen is being generated
   without a design contract.
   Replace the scaffold's `HomeScreen` content wholesale: its "Bridge Info"
   card (domain id, instance id, theme, language) is scaffold demo residue,
   the screen equivalent of the `templateExample` flag — a shipped screen
   that still renders it is a defect. Keep the lifecycle wiring the scaffold
   demonstrates; drop the demo markup and its i18n keys, and add the
   replacement keys to every locale file the scaffold ships
   (`src/screens/home/i18n/*.json`) — the key sets must stay identical across
   locales, or non-default locales render missing-translation placeholders.
   One runtime fact to build against: under `dev:all` the MFEs are served
   from a production build (`vite build && vite preview`), so
   `import.meta.env.DEV` is `false` inside MFE code even in development —
   never gate dev-only hooks or debug affordances on it in an MFE package;
   only the host app runs on a true dev server.
7. **Regenerate manifests** — run `npm run generate:mfe-manifests` so the host's
   `public/generated-mfe-manifests.json` picks up the new package; this step is
   mandatory before the new MFE is discoverable at runtime.
8. **Verify** — while iterating on the MFE, scope checks to its workspace:
   `npm run type-check --workspace=<package-name>` and
   `npm run test:unit --workspace=<package-name>` (a full `type-check` or
   `test:unit` sweep re-checks the shell and every other MFE on each fix —
   repeated minutes that add no evidence about this package). When the MFE is
   complete, run the full gate exactly once: `npm run type-check`,
   `npm run test:unit`, `npm run arch:deps` (dependency-cruiser boundaries,
   shell-owned script), then `npm run dev:all` and confirm the new screen
   mounts with zero console errors. Automated checks passing is not the end
   of verification: complete a final visual review of the screen at its
   target widths and themes before calling the MFE complete — when a
   design-contract bundle is installed, its `verify-interface` flow is that
   review; without one, look at the rendered screen yourself and check
   layout alignment, overflow, and each visual state.

## Boundaries

- Do not add Redux/host-store imports inside the MFE; MFEs stay isolated and consume
  only bridge-provided shared properties and mock/local state.
- Do not hand-edit `public/generated-mfe-manifests.json`; it is a generated artifact —
  always regenerate via `npm run generate:mfe-manifests`.
- This skill does not cover ecosystem-level MFE runtime concepts (registration,
  cardinality, mount strategies) — those are base-kit (`@gears-frontx/mfes`) fluency,
  already provided by the framework's base AI capabilities.
