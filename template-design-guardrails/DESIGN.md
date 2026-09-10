# FrontX design guardrails

Version: `0.1.0-alpha.0`  
UI base: `@gears-frontx/ui-kit`  
Scope: interface generation and advisory design review

## Before generating a screen

1. Inspect the installed FrontX templates and the existing application structure.
2. Read the UI kit's installed `llms.txt` and component documentation. Installed package documentation wins over this file when component APIs differ.
3. Use the activated `generate-interface` skill and its generation workflow.
4. Reuse the installed application shell, UI kit components, semantic tokens, typography ramp, icon family, and existing composition patterns.

## Contract layers

Apply these layers in order. Do not mix them into one improvised style:

1. The installed application, FrontX template manifests, and `@gears-frontx/ui-kit` documentation are the implementation truth.
2. The bundle's machine-readable contracts define non-negotiable quality gates and fallback layout constraints. Token values come only from the installed system.
3. The bundle guidelines define layout, tokens, typography, color, motion, interaction, accessibility, data-display, and composition rules. Which guidelines a screen task loads is routed through `reference-artifacts/guideline-index.json`, generated from each guideline's front matter (`summary`, `tier`, `loadWhen`) by the repository's `scripts/generate-guideline-index.mjs` — the front matter is the source of truth and the index is never edited by hand.
4. The screen request selects content and behavior; it does not authorize a new visual system.

Rules marked **MUST** are required. **SHOULD** rules may be changed only when the implementation records why (in the component's source comment or the change's PR description). **MAY** rules are optional.

## Required qualities

- Clear hierarchy and one obvious primary task per screen.
- Token-backed spacing, color, typography, radius, elevation, motion, and state treatment.
- A 4 px base grid with an 8 px primary rhythm — the shell's installed Tailwind scale.
- Shared alignment lines, explicit density, and declared wide, medium, and narrow transformations.
- Responsive behavior without shrinking controls or labels into ambiguity.
- Keyboard access, visible focus, semantic HTML, accessible names, useful validation copy, and WCAG 2.2 AA contrast.
- Loading, empty, error, restricted, partial, and success states where data or actions can produce them.
- Real component reuse instead of visually imitated controls.
- Motion that explains state or spatial change, uses the motion tokens, and respects reduced-motion preferences.
- Measurable review evidence: violated rule ID, location, impact, and correction.

## After generation

Use `review-interface`. The v0.1 review is advisory: it returns blockers and prioritized corrections but does not stop delivery. When the assembled application is running in dev mode, use `verify-interface` to turn the review's unverified items — contrast, rendered widths, live states — into observed findings from the runtime design-defect checker this template delivers (the `@gears-frontx/design-verify` workspace package). The package also ships a headless runner — `npm run verify:ui --workspace=@gears-frontx/design-verify` — that drives the checker across a routes × themes × widths matrix over the Chrome DevTools Protocol and emits `findings.json` plus screenshots, so sweep evidence is one command instead of an improvised browser script. Storybook checks, screenshot comparison, and release gates still belong to a separate testing stage.

Install this template into an existing FrontX shell project with `frontx add @gears-frontx/template-design-guardrails <target>`. After installing, run `npm install` — not `npm ci` — once: the shell's committed lockfile predates this template's workspace package, and `npm ci` fails on the out-of-sync lockfile instead of resolving it. In dev the shell reports verify-package load status under `[verify-packages]` and the running checker reports under `[design-defects]`, so absence, breakage, and a clean sweep are distinguishable; if verification cannot proceed, the correct outcome is an explicit environment-unavailable report, not a stalled run.

When authoring or changing a shell theme, use `create-theme`; theme token format is a contract with the UI kit, and violations render as broken components rather than errors.

## Do not

- Restyle UI kit internals or duplicate a kit component with ad-hoc markup.
- Hardcode visual values when a semantic token exists.
- Use color as the only status signal.
- Invent helper copy, decorative cards, gradients, or metrics to fill space.
- Assume the UI kit itself uses Tailwind. Its current implementation is React, Base UI, CSS Modules, and CVA; an application template may use Tailwind only for its own composition layer.
- Copy an external design system's visual identity. Material, Carbon, Fluent, W3C, and Vercel sources in this bundle are research references, not replacement themes.
