# Guideline: The `src-app/mfe_packages/*` Contract

template-shell discovers, builds, and aggregates MFE packages under
`src-app/mfe_packages/*` **by convention, not by name** — none of the shell's
scripts or configs reference a specific MFE package name (only glob/scan). This
is the concrete, code-verified shape every directory under that path must have
to be picked up. It is the same shape `template-mfe` ships (`demo-mfe`,
`_blank-mfe`, `widgets-fixture-a`, `widgets-fixture-b`); any other source of MFE
packages (hand-authored, generated, a different template) must match it too.

This guideline is a snapshot of what the shell-owned scanners actually check —
not a separate spec. If the scanners change, this file must be updated to match
(`scripts/lib/mfe-tools.ts`, `scripts/generate-mfe-manifests.ts`).

## Directory-level rules

- Must live directly under `src-app/mfe_packages/<name>/`.

Three scanners read this directory: manifest generation
(`generate:mfe-manifests`), dev/build discovery (`getMFEPackages`, behind
`dev:all` and `build:mfes`), and `type-check:mfe`. Every rule below holds in all
three, on one shared predicate per rule rather than a copy each.

- `<name>` must not start with `.` and must not be `shared` — all three exclude
  these (`shared` is reserved for cross-MFE helper code the isolation boundary
  still applies to; it is never itself an MFE).
- A package whose `mfe.json` declares `"templateExample": true` is excluded by
  all three as well. It is content a template ships to be read and copied - a
  worked example, or the scaffold new packages are copied from - and a project
  that registered it would offer screens nobody asked for. Setting
  `FRONTX_INCLUDE_TEMPLATE_EXAMPLES` to exactly `1` puts those packages back
  into all three at once, for a run that means to watch the shipped examples
  work. A package copied from a flagged scaffold **must drop the flag**, or the
  copy is invisible to the shell for the same reason the scaffold is; the
  `add-mfe-package` procedure strips it as part of the copy so this cannot be
  forgotten. The root `workspaces` glob is not one of the three - it installs a
  flagged package unconditionally, so `npm install` keeps working on a scaffold.
  The compile guarantee for a flagged example rests on `type-check:mfe` with
  `FRONTX_INCLUDE_TEMPLATE_EXAMPLES=1`, which the `template-validate` composition
  job in CI sets for exactly that reason: every package it composes is a flagged
  example, so without the opt-in it would compile nothing.

## Required files

1. **`package.json`** with a `preview` or `dev` script that carries a literal
   `--port <N>` flag (e.g. `"preview": "vite preview --port 3010"`).
   `scripts/lib/mfe-tools.ts`'s `getMFEPackages()` (used by `dev-all.ts` and
   `build-mfes.ts`) tries `preview` first, falls back to `dev`, and extracts the
   port with `/--port\s+(\d+)/` — a differently-spelled flag (`--port=3010`, no
   space) will not match and the package is silently skipped with a warning.
2. **`mfe.json`** at the package root. This is the actual discovery predicate
   `scripts/generate-mfe-manifests.ts`'s `discoverPackages()` checks for — a
   directory without it is invisible to manifest generation even if it has a
   valid `package.json`. Declares `manifest` (this package's own MF manifest
   ID), `entries[]` (exposed modules + required/optional shared properties +
   actions), and `extensions[]` (domain + presentation metadata per screen or
   widget the package contributes), plus the optional `templateExample` flag
   described above. See the `gts-id-conventions` guideline in the `template-mfe`
   AI bundle for the ID taxonomy these fields use.
3. **`vite.config.ts`** that runs `@module-federation/vite`'s `federation()`
   plugin, then `frontxMfGts()` (imported from
   `@gears-frontx/frontx-template-shell/build/mf-gts`) with `enforce: 'post'` so
   it runs after federation. Building without `frontxMfGts()` fails manifest
   generation with an explicit error naming the missing plugin.

## Build-output contract (produced by `vite build`, consumed by the shell)

- `dist/mf-manifest.json` — the raw Module Federation manifest, written by
  `@module-federation/vite` itself.
- `dist/mfe-manifest.json` — the **enriched** manifest `frontxMfGts()` writes in
  its `closeBundle` hook: `mfe.json` merged with `dist/mf-manifest.json`'s
  `metaData`/`exposes`, plus resolved shared-dependency versions and standalone
  ESM chunk paths. `scripts/generate-mfe-manifests.ts` reads **this** file, not
  `mf-manifest.json` directly, and throws if it is missing or was not built by
  a `frontxMfGts()`-configured pipeline.

## CSS delivery into shadow roots

MFE screens render inside open shadow roots, and shadow roots do not see the
host document's stylesheets by default. Three delivery paths exist; pick by
what the package owns:

1. **No package-owned CSS (the `template-mfe` examples).** The host's compiled
   Tailwind covers `src-app/mfe_packages/**` content paths, and
   `ThemeAwareReactLifecycle.adoptHostStylesIntoShadowRoot()` clones every host
   `<style>`/`<link>` into the shadow root. A package that only uses Tailwind
   utilities and UI-kit components needs no stylesheet of its own.
2. **Package-owned CSS, the reliable path: `?inline` + `initializeStyles()`.**
   Import the stylesheet as a string (`import styles from './styles.css?inline'`)
   and append it in an `initializeStyles(container)` override (the
   `ThemeAwareReactLifecycle` hook) via a `<style>` element. Delivery then
   travels with the lifecycle chunk itself and cannot be lost.
3. **Manifest-attributed CSS (fragile — guarded).** A plain
   `import './styles.css'` works only while the federation build keeps the
   extracted CSS attributed to the expose in `mf-manifest.json`
   (`exposeAssets.css`); the host injects exactly those files. Rollup may
   instead hoist the CSS into a chunk shared across exposes, the attribution
   list comes out empty, and the screen renders unstyled with no error
   anywhere. `frontxMfGts()` now fails the build when an expose that declares
   no CSS at all has package-own stylesheets in its chunk graph — the fix it
   prescribes is path 2. (UI-kit CSS-modules from `node_modules` are exempt:
   the host delivers those by style adoption, path 1.)

**Package-owned CSS must never carry Tailwind's preflight (`@tailwind base` /
the `@import "tailwindcss"` base layer).** A second preflight inside the shadow
root — one the package compiled itself — lands after the UI-kit component CSS
and its element resets (`button { background: transparent }` and friends)
visibly break kit controls. A package-owned stylesheet destined for
`initializeStyles()` must contain the utilities and components layers only;
`injectBaseResets()` already provides the box-model resets a shadow root needs.
This rule is about path 2 and 3 stylesheets. The shell's own preflight does
reach the shadow root through path 1 (`adoptHostStylesIntoShadowRoot()` clones
every host stylesheet), and the lifecycle deliberately neutralises it — see the
counter-declarations in `ThemeAwareReactLifecycle`.

## What the shell does with a conforming package

- `npm run dev:all` (`scripts/dev-all.ts`) builds every conforming package,
  starts its preview server on the port read from step 1, and runs the host.
- `npm run build:mfes` (`scripts/build-mfes.ts`) builds every conforming
  package with zero MFEs present, printing "skipping" and exiting 0 — the
  shell-only seed (no `template-mfe` applied) must stay green.
- `npm run generate:mfe-manifests` aggregates every package's
  `dist/mfe-manifest.json` into `public/generated-mfe-manifests.json`, the file
  every FrontX app instance (host or nested) reads at runtime to discover MFEs.
- `npm run type-check:mfe` (`scripts/run-mfe-type-checks.ts`) type-checks every
  conforming, non-example package independently; it degrades to a no-op when
  none exist. A flagged package is skipped unless
  `FRONTX_INCLUDE_TEMPLATE_EXAMPLES` is set to `1`, same as manifest generation
  and dev/build discovery.

## Non-requirements

- No MFE package name is ever referenced by shell code, config, or scripts —
  every shell-side consumer of this directory (`dev-all.ts`, `build-mfes.ts`,
  `generate-mfe-manifests.ts`, `run-mfe-type-checks.ts`, the `workspaces` glob,
  the `eslint.config.js`/`tsconfig.app.json`/`vitest.config.ts` overrides) reads
  it by glob/scan. Comments in `src-app/app/mfe/bootstrap.ts` may mention example
  MFE names for illustration only — that is documentation, not a dependency.
- The shell does not care how many packages exist under `src-app/mfe_packages/`,
  including zero.
