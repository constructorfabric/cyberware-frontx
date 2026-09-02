# UI Kit — Design

Status: in development (MVP)
Repo-doc only, not published with the package. Backing CDSL artifacts (PRD
requirement, DESIGN component, FEATURE) are planned; until they land the
package is covered by an `[[ignore]]` entry in `.cf-studio/config/artifacts.toml`
(same interim state as `@gears-frontx/telemetry`).

> **History.** The kit was designed and prototyped in the now-retired gears-web
> repository (issue gears-web#7): first as a shadcn-style source registry, then
> as an npm package, with the styling stack settled by the architects as
> **CSS Modules instead of Tailwind** and **Base UI instead of Radix**. The
> tsup + CSS Modules pipeline and the Button prototype were proven there and
> moved here as gears-web was decommissioned. Where published runtime libraries
> live in the FrontX architecture is tracked by #495.

## Problem

Front-end templates in the Constructor Fabric ecosystem — from which FrontX and
Studio assemble interfaces — each build their UI layer from scratch. There is no
standard component base for templates, and nothing AI agents can rely on to
generate screens consistently.

## Goals

- A curated set of React components covering a typical admin application.
- The **standard component base for FrontX templates**: one version everywhere,
  fixes and design updates propagate via a dependency bump.
- Self-contained styling: the package ships its own compiled CSS; consumers
  need no CSS framework, preprocessor, or build plugins.
- AI-ready: agents generate screens from the kit using its bundled docs.
- Curate, don't write: behavior comes from Base UI (headless, tested upstream);
  styles are authored as CSS Modules, translated from shadcn/ui's design.

## Non-goals (MVP)

- White-label theming APIs. Basic branding = overriding CSS-variable tokens;
  deep customization = fork the kit or build the template on another kit.
- Framework-agnostic components (React is a hard requirement).
- `data-table`, date-picker, charts, page layout templates, form validation
  integration (RHF/zod), i18n helpers, Storybook.

`insight-front` uses shadcn's `calendar`, `chart` and `sidebar`, and the kit
will not cover them — a known gap, not an oversight. `calendar` (date-picker)
needs `react-day-picker` + `date-fns` and `chart` (charts) needs `recharts`, so
both fall to the architecture's "behavior from Base UI, no extra runtime deps"
rule. `sidebar` (page layout templates) adds no dependencies but is a large
composite over `sheet`, `button`, `input`, `separator`, `skeleton` and
`tooltip` plus a mobile-detection hook: app layout, not a base component.

The F-mockups draw larger blocks too — Sidebar Navigation, Top Bar / Page
Header, an App Shell, a Data Table with toolbar, bulk-selection bar and row
states, and the Studio AI cards. Those frames are titled "MVP Building
blocks / shadcn compositions" in the design file itself: compositions over
kit primitives, not kit components. They stay with consumers/templates, and
the kit's contribution is composition recipes (see AI layer) — which keeps
the `sidebar` / `data-table` exclusions above intact.

## Architecture

- Component stack: **React 19 + Base UI (`@base-ui/react`) + CSS Modules + CVA**.
- Build: **Vite library mode**, ESM only (no CJS build). One entry per
  component — `src/components/<name>/public.ts`, globbed — plus the
  `src/index.ts` barrel, mirroring Constructor's internal react-kit
  (`scripts/buildPlugin.ts` there) rather than tsup's single-entry bundle.
  Per-entry splitting is what makes the kit tree-shakeable at both the JS and
  CSS level, *including through the barrel*: each entry compiles to its own
  `dist/<name>.js` + `dist/<name>.d.ts` (`vite-plugin-dts`, with a small
  `afterBuild` hook writing the flat `dist/<name>.d.ts` a consumer's `./*`
  subpath import resolves to — see `scripts/buildPlugin.ts`) and its own CSS
  chunk (`vite-plugin-lib-inject-css`); `dist/index.js` only re-exports those
  already-separate files, so a consumer's bundler can drop the ones it never
  imports rather than receiving one bundle with everything inlined.
  `rollup-plugin-node-externals` externalizes `dependencies`/
  `peerDependencies` (`@base-ui/react`, CVA, `lucide-react`, react, react-dom
  and subpaths like `react/jsx-runtime`) in place of tsup's hand-maintained
  `external` array. CSS Modules support is native to Vite — the esbuild `local-css`
  loader override tsup needed (and the fragile convention its comment
  documented, that JS may only import `*.module.css`) is gone.
- CSS pipeline: per-component `*.module.css`, each compiled to its own CSS
  chunk and auto-imported by that component's JS chunk
  (`vite-plugin-lib-inject-css`) — no combined stylesheet, no `./styles.css`
  export; importing a component's JS is what pulls in its CSS. Design tokens
  remain a plain-CSS file (`./theme.css` export), hand-copied into `dist/` at
  build, unchanged: Vite's lib build only emits CSS reachable from a JS
  import, and theme.css is deliberately never imported by JS. A consumer
  imports `theme.css` once; component CSS then arrives for free with each
  component import. No PostCSS/Tailwind requirements on either side.
- Theme: semantic CSS variables (colors, spacing, radii, control metrics,
  and the Studio type ramp — families plus per-role size/line-height/
  weight/tracking, `--text-<role>-*` for display/heading-1/heading-2/body/
  label/meta/mono; see step 4 below), light/dark via `data-theme` /
  `prefers-color-scheme`; shadcn-style token structure carrying the Studio
  BLUE palette from the mockups' token spec frame "02 · Tokens, type &
  elevation" (node 40001232:5254), which superseded the original violet
  "Studio / shadcn" collection — see the "Studio blue rebrand" entry in
  step 4 below. The token NAMES stay unprefixed per the shadcn convention
  even though that frame labels its WEB syntax `var(--color-*)`: renaming
  the public token surface would break every consumer for zero semantic
  gain (a standing ruling, recorded in theme.css's header). Component CSS
  consumes only these variables — the theme file is
  the single seam between kit styles and consumer brand. The theme file
  also paints the page surface itself (`body`/`[data-theme]` background and
  color, plus `color-scheme`), not just the tokens: a bare consumer page
  goes correctly dark under `prefers-color-scheme` with no attribute and no
  CSS of its own.
- Publishing: version-gated like every ecosystem package. Originally
  `private: true` gated *any* publication on the full MVP set plus #495; that
  gate was consciously revised (2026-08-07) — the `alpha` pre-release channel
  opened with the 19-component set so templates can consume the kit while the
  remaining MVP components land. The original gates now guard the *stable*
  (`latest`) release instead: the full MVP component set, #495 approving the
  package's architecture ownership, traceability, and version policy, and the
  required CDSL artifacts replacing the temporary `artifacts.toml` ignore.

## Component set (MVP, 31 components)

19 built, 12 planned — the ⏳-marked entries are the `insight-front` gap set
plus the two the F-mockups added (`pagination`, `breadcrumb`), delivery-plan
step 5 (see below), not yet in the package.

| Group    | Components |
|----------|------------|
| Forms    | `button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `label`, `field`, ⏳ `toggle`, ⏳ `toggle-group` |
| Overlays | `dialog`, `dropdown-menu`, `tooltip`, `toast`, ⏳ `popover`, ⏳ `sheet`, ⏳ `preview-card` |
| Structure| `card`, `tabs`, `badge`, `separator`, `skeleton`, ⏳ `alert`, ⏳ `avatar`, ⏳ `breadcrumb`, ⏳ `collapsible`, ⏳ `empty`, ⏳ `spinner` |
| Data     | `table` (primitive markup), ⏳ `pagination` |

Behavior and accessibility come from Base UI primitives; variant logic is CVA;
styles are CSS Modules translated from shadcn/ui's Tailwind design (MIT,
attribution in this package's NOTICE). Wrapping conventions follow Constructor's
internal react-kit (gitlab.constr.dev/frontend/react-kit): per-component
directories, colocated tests and docs, `render`-prop polymorphism. A composite
`data-table` is deliberately deferred.

Ten entries — `toggle`, `toggle-group` (Forms), `popover`, `sheet`,
`preview-card` (Overlays), `alert`, `avatar`, `collapsible`, `empty`, `spinner`
(Structure) — come from the kit's first consumer, `insight-front`
(`constructorfabric/insight-front`): of the shadcn/Base UI components that team
uses today, these are the ones the kit lacked. `toggle` and `toggle-group` wrap
`@base-ui/react/toggle` and `/toggle-group`; `avatar` and `collapsible` have
Base UI primitives too. `alert`, `empty` and `spinner` are pure styling with no
primitive, like `card`, `badge` and `skeleton`. All three new overlays portal
their popup, so each needs the same `container` escape hatch the existing
overlays document. Two names diverge from their sources and will confuse the
next reader: shadcn's registry calls `preview-card` `hover-card`, and `sheet`
maps onto Base UI's `drawer` primitive.

`pagination` and `breadcrumb` come from the F-mockups instead: the mockups'
component mapping pairs pagination with the table (Toolbar · Row ·
Pagination) and places breadcrumb inside the Top Bar composition. Both are
pure markup/styling with no Base UI primitive, like `card` and `badge`;
shadcn ships both, so the usual translation path applies.

`toast` is built on Base UI's own Toast primitive (`@base-ui/react/toast`),
not sonner: base-vega ships a `sonner.json` variant too, but that pulls in
`sonner` + `next-themes` as extra runtime dependencies, breaking the kit's
"behavior from Base UI, no extra runtime deps" architecture for the sake of
one component. Base UI's Toast keeps sonner's call-anywhere ergonomics
(`toast.add({...})` from any file, no JSX composed at the call site) via its
own manager object, without the extra dependencies.

## AI layer

Shipped in the package so agents read it from `node_modules`: `llms.txt` at
the package root (entry point: setup rules + component index) and a short
usage doc per component (when to use, kit-level props, examples,
anti-patterns) colocated as `src/components/<name>/<name>.md` and copied to
`dist/docs/` at build. A unit test enforces that every component has a doc,
is indexed in `llms.txt`, and documents every variant/size its CSS module
defines. Still planned: composition recipes — the original trio (CRUD page,
settings form, confirmation dialog) plus the F-mockups' building blocks
(app shell with sidebar navigation, data-table page with toolbar and
bulk-selection bar). The trio's components all exist, so writing those is
unblocked; the mockup-block recipes additionally wait on step-5 components
(`pagination`, `breadcrumb`, `avatar`).

## Upstream update procedure

How to update a component when upstream shadcn changes (any maintainer or
agent asked to "update <component> from shadcn" follows this):

1. Upstream has no package versions; its git history IS the version. The
   source of truth per component is
   `apps/v4/registry/bases/base/ui/<component>.tsx` in
   `github.com/shadcn-ui/ui`. The component's `<name>.md` records our
   deliberate deviations and the last sync date.
2. Diff the upstream file between our recorded sync date and current HEAD
   (`gh api` over the file's commit history). No diff - nothing to do;
   refresh the recorded date.
3. Classify each upstream change into three buckets:
   - API/structure (new parts, props, variant axes, data attributes) -
     port into our tsx over the Base UI primitives;
   - behavior (logic, a11y, handlers) - port by meaning;
   - styling (their utility classes) - never copy classes; read them as a
     spec ("radius grew", "inset appeared") and decide whether to express
     it in our CSS via theme tokens. The kit and the Constructor Studio
     mockups outrank pixel parity with shadcn.
4. Check the diff against the deviations listed in `<name>.md`: if
   upstream changed something we deliberately diverged from, re-decide the
   deviation explicitly (keep it or drop it) - never silently overwrite it.
5. Same-pass tail (mandatory): guard tests green (`npm run test` - the
   tokens/docs guards scan raw CSS text including comments), `<name>.md`
   and `llms.txt` synced with any contract change.

Hard constraints that always apply: existing theme.css token values are
frozen FOR UPSTREAM SYNCS (additive only, all theme blocks) — an upstream
shadcn change never moves a token value; only an explicit design-source
ruling does (the 2026-08-31 Studio blue rebrand is the precedent, see step
4); no raw values in module.css including comments; icons via direct
`lucide-react` imports; CSS Modules + CVA; Base UI primitives only.

## Testing and acceptance

- Unit tests are written along with components: render + interaction smoke per
  component (vitest + jsdom + testing-library, versions pinned by the root
  test-dependency gate).
- Kitchen-sink demo app: started as `demo/` inside the package (`npm run
  demo`) — the same in-package pattern the telemetry demo actually uses,
  superseding the separate `packages/ui-kit-example-web` package an earlier
  revision of this plan named. Two hash-routed pages sharing an
  auto/light/dark switch (`#/tokens`: the full token set — color swatches,
  radius/spacing/control scales, and the Studio type ramp; `#/components`:
  all 19 components in every variant/size/state) — split from the original
  single page once both grew large enough to want their own scroll; see
  `demo/README.md`. Consumes the package by name, so it exercises the built
  artifact, not src. Grow it to every component in every state as the set
  lands; it doubles as the agent playground.
- Acceptance: (1) `scripts/verify-consumer.sh` packs the package, installs the
  tarball into a clean Vite project, builds a page that imports a single
  component (`Button`) and asserts tokens, that component's styles and class
  map are present in the bundle — *and*, the proof the repackaging exists
  for, that a component never imported (`Table`, `Dialog` — both have large,
  distinctive CSS) is absent from both the JS and CSS output; (2) an agent
  assembles a CRUD screen from kit components from a single prompt using the
  bundled docs.

## Risks

1. The kit dictates React for consumers — acceptable for ecosystem templates.
2. Fork is the only deep-customization path — accepted; the standard optimizes
   for consistency across templates.
3. Authored styles replace curated styles — the largest share of MVP effort and
   where visual bugs will live; the kitchen-sink demo exists to catch them.

## Delivery plan

Oldest first; steps 1–4 are done (step 4's design answers are still
pending, see its entry), 5–6 remain. The first `alpha` publication
(0.3.0-alpha.1, 2026-08-07) happened *before* step 5, per the revised
Publishing gate above — steps 5–6 now gate the stable release, not
publication as such. Completed
steps are a log, not a description of the current build (see Architecture
for that; the tsup pipeline step 1 names was later replaced by Vite, per
Architecture's build bullet).

1. Package skeleton + proven tsup/CSS Modules pipeline (later replaced by
   Vite; see Architecture) + Button.
2. Tokens polish + first component batch (forms) on `@base-ui/react`.
3. Remaining components — done, the 19-component MVP set exists.
4. **Studio reskin (done, design answers pending).** The design source
   moved from shadcn's neutral defaults to the Studio design: the
   F-mockups Figma file, page `00 · Foundations`, tokens from its
   "Studio / shadcn" variable collection. Landed: theme.css carries the
   palette and the new token groups (see Architecture's theme bullet), and
   the existing components follow the mockups' component specs — Badge on
   semantic intents (`pill`/`plain` shapes, with `dot` and `icon` both
   opt-in; the shadcn variant list retired), Button's
   `icon` slot + auto icon-only + `loading`, Tabs on the trackless Kind=tab
   look (the spec's Kind=segment is the planned `toggle-group`'s styling,
   per the design file's own component description), the unified Field set
   for Input/Textarea/Select with the `filter` type (Select's compact
   toolbar chip) and `search`'s native searchbox role (no automatic icon;
   pass one via `icon`), Table
   density + selected/stale/restricted row hooks, and component CSS on the
   metric tokens. The drawn-vs-spec control-height discrepancy was ruled
   in favor of the drawn specimens (32/36/40; buttons map sm/default/lg
   directly, fields sit on the lg step, the filter chip on md). A later
   typography pass added `--font-sans`/`--font-mono` (families only — the
   kit ships no font files) and the Studio type ramp as `--text-<role>-*`
   tokens (frame 175:371), then moved the remaining shadcn-legacy 14px
   text onto ramp roles: Body for card/dialog/toast/tab-panel/caption
   text, Label for button-role text (the drawn buttons are bound to the
   Studio/Label style), Meta for field helpers and Badge; dropdown/select
   options and the tooltip follow the drawn Overlay specimen (12/17)
   instead. A follow-up ruling then settled the metric conflicts
   wholesale: the token system wins over hand-set specimen values.
   Component CSS now consumes the token scales
   everywhere — off-grid drawn spacing snapped to the nearest --space-*
   step (the fields' 10px → 12, menu options' 6px → 8, the compact
   table's 6px → 4), the specimens' 13/18 and 12/17 text normalized onto
   Label/Meta, and the 10px table header onto Meta at the lg control
   height — and a tokens.test.ts guard now rejects literal metrics in
   spacing and type declarations (documented exceptions: the fields' 16px
   iOS anti-zoom floor, the switch thumb's 2px inset geometry). Still
   open: the token values marked `derived:` in theme.css; and the drawn
   Overlay options' muted/active color language (a component-phase item,
   not a token one).

   **Accessibility + spec-alignment pass.** (Predates the Studio blue
   rebrand below — palette words like "violet" and the measured ratios in
   this entry describe the pre-rebrand theme; the tests named here
   recompute against the live values.) A pass over the reskin found
   WCAG failures and undocumented deviations from the drawn spec; all
   resolved as rulings rather than left flagged, per the standing
   instruction that a color failing WCAG gets a new color, not a "kept as
   drawn" footnote:
   - **Button focus rings** (every variant, both themes) now clear the
     3:1 floor against the page background. Originally shipped two-toned
     (an outer border color plus a separately colorable inset shadow,
     because the ring was drawn ON the button's edge and so had two WCAG
     neighbors — the page outside, the button's own fill inside) — revised
     after ship because `--info` (the `default` variant's outer tone) is
     cyan in dark mode and blue in light, a hue that appears nowhere else
     near the violet button, and because two custom properties per variant
     was more machinery than the fix needed. The ring now sits OUTSIDE the
     button instead (`outline` + `outline-offset`, not a border recolor
     plus inset shadow), so its only WCAG neighbor is ever the page
     background and a single tone per variant is enough: `default` and
     `destructive` get their own family color (new tokens
     `--primary-ring`/`--destructive-ring`, since violet/red read better
     against the page than the plain kit-wide ring does), everything else
     (`outline`, `secondary`, `ghost`, `link`) falls through to the
     kit-wide `--ring`. `outline` was already on `--ring`, unchanged by
     this revision. Ratios as measured (light/dark), with button.test.tsx
     recomputing them from the live CSS on every run:

     | variant | ring tone vs page bg |
     |---|---|
     | `default` | `--primary-ring` 6.79 / 7.23 |
     | `destructive` | `--destructive-ring` 6.01 / 7.89 |
     | `outline`, `secondary`, `ghost`, `link` | `--ring` 4.05 / 3.78 |

     `outline`/`secondary`/`ghost`/`link` share one number because they all
     resolve to the same `--ring` token; 3.78 (dark) is the tightest in the
     table and the one to watch if `--ring` ever moves.
   - **`--subtle-foreground`** (the table header label): each mode's drawn
     value failed the 4.5:1 AA floor against the header's own `--surface`
     fill — light `#94a3b8` at 2.56:1, dark `#667085` at 3.74:1. Both
     corrected to values clearing 4.5:1 (theme.css). Note the measurement
     is per-mode against that mode's fill: `#94a3b8` reads 7.25:1 on the
     dark `--surface` and fails only in light. Open designer question: pin
     AA-passing values in the Figma file for both modes.
   - **Button's `link` variant** had no drawn counterpart and read
     `--primary` directly (3.78:1 dark, a clear AA fail); given a
     text-safe `--link-foreground` token instead (theme.css). Light takes
     `--primary-hover`'s value — 4.98:1, real headroom — rather than
     `--primary`'s own, which clears the 4.5:1 floor by 0.005 and would
     silently fail again on any one-step nudge to `--background`.
   - **Outline variant fill/border** aligned to the drawn "secondary"
     specimen (`--surface-elevated` + `--border-strong`, was `--background`
     + `--border`) — the button.md-documented outline↔secondary mapping
     was already correct, only the paint wasn't.
   - **Ghost variant rest text** aligned to the drawn `--muted-foreground`
     (was always `--foreground`) — verified first that `--muted-foreground`
     clears 4.5:1 against the page background in both themes before
     aligning, per the standing "recolor only if it still passes" check.
   - **Disabled dim** unified on 0.42 everywhere (Button/Input/Textarea/
     Select, plus DropdownMenu's/Select's disabled items) — Checkbox/
     RadioGroup/Switch/Label already matched the mockups' 0.42 specimens;
     these were the outliers still at the shadcn-inherited 0.5.
   - **Hand-set `font-weight: 500`** (five spots: Table's header/footer,
     DropdownMenu's `.label`, Tooltip, Toast's `.title`) now read
     `--text-label-weight` — same numeral, but a real ramp reference
     instead of a literal, and their comments no longer claim a "Meta at
     500" style that has no entry in the Studio ramp.
   - **Badge label colors.** No raw status color clears 4.5:1 for the 12px
     label against all three surfaces it can sit on (the pill fill,
     `--card`, `--background`) — raw, in light: success 3.36:1, warning
     2.84:1, info 3.65:1. So `--badge-text` mixes `--foreground` into the
     accent; the dot keeps the raw color and is exempt from the 3:1
     non-text floor as pure decoration duplicating the label. Worst case
     across the three surfaces, light/dark:

     | variant | mix | ratio |
     |---|---|---|
     | `success` | 80/20 | 4.72 / 9.63 |
     | `info` | 80/20 | 5.04 / 10.12 |
     | `danger` | 80/20 | 5.63 / 4.96 |
     | `muted` | 80/20 | 5.70 / 6.91 |
     | `warning` | 70/30 | 4.91 / 11.26 |

     Warning is the lightest accent and misses at 80/20 (4.07:1 light),
     hence its deeper mix. These are `color-mix()` results, resolved by
     the browser at runtime — unlike Button's focus rings, no test can
     recompute them from the CSS, so this table is their only record.

   **Consumer-facing changes from this pass** (flagged for `insight-front`,
   the kit's first consumer — see the architecture's Non-goals/AI-layer
   framing for why that team migrates onto the kit's API rather than the
   kit chasing theirs):
   - Button's `loading` no longer sets the native `disabled` attribute; it
     now reports state via `aria-disabled` and stays focusable
     (`focusableWhenDisabled`, forced on while `loading` — see button.md
     and button.tsx). Consumer code asserting `button:disabled` in CSS, or
     the native `disabled` DOM property/`toBeDisabled()` in tests, will no
     longer see a `loading` Button that way; check `aria-disabled`/
     `aria-busy` instead. Also: a raw DOM listener attached via `ref`/
     `addEventListener` is not suppressed while `loading` the way `onClick`
     is — see button.md's anti-patterns note.
   - `--subtle-foreground` changed VALUE in both themes (light #94a3b8 ->
     #5f6f88, dark #667085 -> #7a8396) — same token name, same single
     consumer (Table's header label), but a visibly darker/dimmer color in
     both themes now that it clears AA against the header's fill.
   - Badge's props are `variant`/`shape`, not `intent`/`form`. The
     semantic-only rule is unchanged — the values are still states, never
     paint jobs — but it is carried by the value names and the doc rather
     than by an axis name only this component used, so every component in
     the kit is driven by `variant` (+ `size`, or the occasional real extra
     axis: Badge's `shape`, Table's `density`). `shape` rather than `size`
     because the values are pill vs. plain (dot is a separate opt-in flag,
     orthogonal to shape) and Badge has no size axis;
     not `form`, which is a real HTML attribute a styling prop would shadow
     for anyone rendering a form-associated element via `render`.
   - Four new tokens: `--link-foreground` (Button's `link` variant text),
     `--popover-border`/`--popover-shadow` (the ring-plus-shadow recipe
     every card-like popup — Dialog/DropdownMenu/Select/Toast — now shares
     instead of hand-duplicating; see Architecture's theme bullet), and
     `--ring-inset` (the inward thickness that lets a 2px ring — focus,
     `aria-invalid`, Table's selected row — thicken without changing the
     element's box; eight modules previously spelled the same `calc()` out
     by hand). None replace an existing consumer-facing token; a consumer
     overriding theme.css wholesale (rather than layering on top of it)
     should add these four to stay in sync.

   **Studio blue rebrand (2026-08-31).** The design moved from the violet
   "Studio / shadcn" collection to the blue Studio palette recorded on the
   mockups' token spec frame "02 · Tokens, type & elevation" (node
   40001232:5254). theme.css adopted the frame's semantic color values in
   both modes wholesale — brand axis onto the blue ramp (primary
   `#0065e3`, hover/accent-foreground `#2668c5`, accent tint `#e6effa`),
   the light page onto slate-50 `#f1f5f9`, the dark mode onto the slate
   ramp (surfaces `#0f172a`, borders `#334155`, foreground pure white) —
   including two collapses the frame itself draws (dark
   surface = surface-elevated, dark border = border-strong) and the
   frame's own resolution of the old `--subtle-foreground` AA question
   (its new drawn values pass: 10.35:1 light / 6.96:1 dark). Undrawn
   entries were re-derived per theme.css's `derived:` convention
   (card/popover mirror surface; secondary stepped one neutral away from
   the now-page-equal muted in each mode; sidebar/code blocks follow their
   same-role tokens; ring family and `--link-foreground` from the brand
   ramp — ratios at each token). `--popover-shadow` adopted the frame's
   Studio/Elevation/200 geometry (0 8 24 @ 12% foreground). The frame's
   `color/scenario-canvas` and `color/artifact-accent-icon` entries were
   briefly carried as new tokens on the namespace argument, then removed
   before merge — see the inline-review pass below.

   Per the user ruling that a drawn value failing WCAG gets corrected in
   code (the same standing instruction as the accessibility pass above),
   the rebrand deviates from the frame in exactly four status colors, all
   12px label text over their own -soft fills (worst-case ratios across
   soft/card/page):

   | token | drawn | shipped | worst case |
   |---|---|---|---|
   | light `--success` | `#059669` (3.43:1) | `#047857` | 5.00:1 |
   | light `--warning` | `#f59e0b` (1.96:1) | `#b45309` | 4.58:1 |
   | light `--danger`  | `#e11d48` (4.28:1) | `#be123c` | 5.72:1 |
   | dark `--danger`   | `#e11d48` (3.63:1) | `#fb7185` | 6.34:1 |

   Light `--info` (`#2563eb`, 4.59:1 worst case) passes as drawn and was
   kept. `--destructive` tracks the DRAWN red (`#e11d48` both modes — its
   text is the on-color, 4.70:1, not the token itself), so the one-red
   alias now diverges from the corrected `--danger` by design. Component
   fallout, same ruling: Avatar's `solid` treatment labels each status
   tone with that tone's own `-soft` value instead of the mockup's
   all-white `--primary-foreground` binding (which fails at ~1.5–2:1 on
   the light dark-mode tones); Badge's `link` variant moved onto
   `--link-foreground` (dark `--primary` is 3.72:1 on the page); Badge's
   tone-label contrast debt (previously "raised for a design decision") is
   resolved by the token corrections — every pair now clears 4.5:1, per
   the recomputed table in badge.module.css. Contrast guards
   (tokens.test.ts floors, button.test.tsx ring cases) recompute from the
   live CSS and pass.

   **Typography follow-up (same rebrand, second pass).** The frame's
   "Studio/Type" ramp was adopted onto the existing `--text-*` role names
   (the roles are the public API; values moved, names didn't): display
   28/34 → 26/32 (Page Title), body 15/20 → 14/20 (UI Primary Regular),
   label 13/16 → 12/16 medium (UI Secondary Medium), mono 11/16 → 10/14
   (System Micro), every role's tracking normalized to the ramp's 0;
   heading-2 was already Section Title's 16/24 and meta already UI
   Secondary Regular's 12/16. Evidence, since most first-generation spec
   frames are already deleted from the design file: the ramp sheet itself,
   plus the live "Phase 3 / Remaining core controls" frame (40001414:5973)
   whose drawn Tabs trigger binds UI Secondary Medium, drawn compact
   Button binds UI Secondary Semi Bold, and drawn Badge sits on UI
   Secondary Medium — the metrics Badge already had via its
   meta-size + label-weight mix. Deliberate residue: heading-1 (20/28)
   kept as a kit interpolation (the new ramp has no slot between 16 and
   26, and collapsing it into heading-2 would merge two heading levels);
   Display Metric 36/40, Foundation Hero 56/64 and Avatar Micro 10/14
   carried nowhere (no kit consumer at those slots); Button stays on
   label's 500 weight although the drawn compact button's cut is 600 — a
   per-component weight question for the components pass, since label
   also dresses menus, tooltips and table headers.

   **Post-review contrast pass (2026-08-31, PR #604 review).** The review
   found the rebrand audit had measured resting token pairs only; the
   fixes extend the same WCAG ruling to interactive and foreground seats:
   - `--destructive` is a FILL token, verified only under
     `--destructive-foreground` — every component that painted it as
     TEXT (FieldError, destructive Alert/Bubble/Attachment/Toast icon,
     QuestionnaireError) moved to the AA-corrected `--danger`;
   - new `--destructive-hover` token (`#be123c` both modes): Badge's
     destructive hover previously mixed the fill toward `--foreground`,
     which darkens in light mode but LIGHTENS in dark (foreground flips
     to white), dropping the white label to ~3.9:1;
   - Badge tone hovers underline instead of recoloring the fill — the
     tightest tone labels sit at 4.59–4.68:1 on their own fills with
     almost no headroom, so any darkening mix breaks the floor;
   - Badge focus gained an outside outline (Button's idiom): light
     `--ring` equals `--primary`, so the inset-only ring on a default
     link Badge painted blue over blue and vanished;
   - the remaining `--primary`-as-text-link hovers
     (Field/Empty/ItemDescription) moved to `--link-foreground`;
   - `@gears-frontx/ui-kit` bumped to 0.4.0-alpha.2 with the template
     pins (the version-bump-on-change CI gate);
   - guards added so none of this regresses silently: tokens.test.ts now
     asserts the status-label matrix (each status color vs its -soft
     fill, page, surface, card, popover), the accent pair, the
     solid-fill on-colors at rest and hover, and link text on
     surface/card; badge.test.tsx asserts the outside outline and its
     3:1 tone, mirroring button.test.tsx.

   **Inline-review pass (2026-09-01, PR #604 second review).** A reviewer
   pass over the rebrand diff itself; every numeric claim was re-measured
   before acting. Two substantive fixes and one demo fix:
   - **`--muted` stepped off its backdrops.** The frame draws muted AT the
     light page value and AT the dark card value — a 1.00:1 fill that
     makes Skeleton, outline/ghost Button hover and the other muted
     consumers vanish. Same one-step correction --secondary already took;
     muted now lands ON secondary's value in both modes (upstream shadcn's
     own default arrangement): light `#f1f5f9 → #e2e8f0` (1.13:1 vs page),
     dark `#0f172a → #1e293b` (1.22:1 vs card). Every text seat re-checked
     (muted-foreground on the new fill 8.40:1 light / 5.71:1 dark);
     tokens.test.ts pins the separation at ≥ 1.1:1 so a later palette move
     cannot silently re-collapse it. `--sidebar` follows per its documented
     derivation (it carries muted's value in both modes — CodeRabbit
     caught the light half going stale), restoring the pre-rebrand
     tinted-panel-on-lighter-page relationship; the light active item
     improves (1.07:1 → 1.23:1 vs the panel) and every sidebar text seat
     re-measures clear. A follow-up review round then caught the knock-on:
     `--sidebar-border` derived from `--border`, whose light value IS the
     new panel fill — separators, the menu-sub rail and the floating
     outline vanished at 1.00:1. The border now derives from
     `--border-strong` (1.20:1 light / 1.41:1 dark against the panel;
     dark's collapsed border family already was border-strong), and
     tokens.test.ts pins the pair alongside the muted guard. This is a fifth deviation from the
     drawn frame — visibility, not WCAG-text, so it sits outside the
     status-token table above — and joins the open designer question on
     whether the drawn collapses are intent.
   - **The last two `--destructive`-mix seats moved onto the corrected
     tokens.** Button's destructive hover still mixed the fill toward
     `--foreground` (3.90:1 under the white label in dark — the exact
     failure the Badge fix above removed) and both menus' destructive
     items painted mix-derived text/highlights that landed under 4.5:1
     highlighted in dark. Button now paints `--destructive-hover` like
     Badge; the menu items paint `--danger` text with a popover-anchored
     12% danger tint as the highlight (first shipped as `--danger-soft`,
     which the follow-up round measured too faint for the only focus cue —
     1.10:1/1.05:1 vs the popover against the sibling accent highlight's
     1.16/1.12; the tint measures 1.20/1.17 with the text clear at
     5.26/5.68). Unlike the removed recipe the tint is anchored to
     `--popover`, so its direction never flips with the theme. Per-file
     CSS guards added (button.test.tsx, dropdown-menu.test.tsx,
     context-menu.test.tsx) so a foreground-anchored mix cannot come back.
   - **The demo chart palette lost its `--info` slot**: after the rebrand
     `--primary` and `--info` are ~1.02:1 apart in light mode, and two
     demo configs drew both in one chart — two indistinguishable series.
     The neutral fifth slot is `--foreground` (first landed as
     `--muted-foreground`, which the follow-up round pointed out is the
     charts' own chrome color — axes, ticks and legend labels — so a
     series in it read as furniture; ink separates from that chrome at
     1.72:1 light / 2.56:1 dark).
   - **`--scenario-canvas`/`--artifact-accent-icon` removed** before they
     ever published (added by the rebrand commit, consumed by nothing,
     absent from every released version). The rebrand admitted them
     because the Figma variables moved into the `color/` namespace; the
     review challenged that, and the ruling is ownership over namespace:
     they name one consumer's workflow surfaces (Studio's scenario
     canvas, its artifact cards), which the FrontX handoff contract
     classifies as Studio-only — product-domain names do not enter the
     kit's public token API on a folder move alone. theme.css's header
     now records the rule.
   - Doc/comment sync from the same review: badge.md's tone-contrast
     caveat replaced with the resolution it had already received; stale
     pre-rebrand ratios refreshed in button/tabs/table/avatar comments;
     the two pre-rebrand entries above marked as historical; review
     finding codes (F-00x) replaced with self-contained references, since
     the offline review file is not in the repo.

   Still NOT part of the rebrand: the elevation scale beyond the popover
   shadow (Elevation/100/300/Dock top have no kit consumer yet). Open
   designer questions: pin AA-passing status values in the Figma file
   (the four deviations above), confirm the dark surface/border collapses
   are intent rather than spec-sheet shorthand (now also load-bearing for
   the `--muted` step-off above), and rule the button label weight (500 vs
   the drawn 600).
5. The twelve gap components, mockups-first: `popover`, `alert`, `avatar`,
   `empty` are in both the mockups and the `insight-front` set and go first;
   `pagination` and `breadcrumb` are the mockups-only additions;
   `toggle`, `toggle-group`, `sheet`, `preview-card`, `collapsible`,
   `spinner` close the `insight-front` list. Before the stable release, not
   after: they are part of the MVP set the stable gate names, and the
   kitchen-sink app and composition recipes should cover the whole set once
   rather than be extended right after the stable release.
6. Composition recipes (incl. the mockup building blocks) + kitchen-sink to
   full coverage; satisfy the #495 gates, remove the temporary
   artifact ignore, then cut the first stable (`latest`) version.
